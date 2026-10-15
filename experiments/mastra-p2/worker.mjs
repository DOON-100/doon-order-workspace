import {readFile, writeFile, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

// Third-party loggers must never print provider bodies, reasoning, or headers.
const writeResult = process.stdout.write.bind(process.stdout);
const discard = (_chunk, encoding, callback) => {
  const done = typeof encoding === 'function' ? encoding : callback;
  if (typeof done === 'function') queueMicrotask(done);
  return true;
};
process.stdout.write = discard;
process.stderr.write = discard;
process.env.MASTRA_DEV = 'false';
process.env.MASTRA_AUTO_REFRESH_PROVIDERS = 'false';
process.env.MASTRA_OFFLINE = 'true'; // Registry refresh only; live DeepSeek requests remain enabled.

const [directoryArg, caseArg, thinkingArg, modeArg, requestedRunId, requestedToolCallId, ...extra] = process.argv.slice(2);
const modes = new Set(['generate', 'stream', 'suspend', 'approve', 'decline']);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const safeCase = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);
const identity = {
  caseId: safeCase(caseArg) ? caseArg : null,
  thinking: ['enabled', 'disabled'].includes(thinkingArg) ? thinkingArg : null,
  mode: modes.has(modeArg) ? modeArg : null,
};
const started = Date.now();
let emitted = false;
function emit(report) {
  if (emitted) return;
  emitted = true;
  writeResult('WORKER_RESULT ' + JSON.stringify({...identity, pid: process.pid, elapsedMs: Date.now() - started, ...report}) + '\n');
}
function failure(code) { throw Object.assign(new Error(code), {code}); }
function check(condition, code = 'P2_ASSERTION_FAILED') { if (!condition) failure(code); }
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
async function regularFile(file, required = false) {
  let stat;
  try {stat = await lstat(file);} catch (error) {if (error.code === 'ENOENT' && !required) return false; throw error;}
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && samePath(await realpath(file), file), 'P2_PATH_REJECTED');
  return true;
}
async function validateDirectory() {
  check(!extra.length && typeof directoryArg === 'string' && safeCase(caseArg) && identity.thinking && identity.mode, 'P2_INVALID_INPUT');
  const resume = ['approve', 'decline'].includes(modeArg);
  check(resume ? safeId(requestedRunId) && safeId(requestedToolCallId) : requestedRunId === undefined && requestedToolCallId === undefined, 'P2_INVALID_INPUT');
  const root = path.resolve(directoryArg), temporary = await realpath(os.tmpdir());
  check(samePath(path.dirname(root), temporary) && /^doon-mastra-p2-[A-Za-z0-9]+$/.test(path.basename(root)), 'P2_PATH_REJECTED');
  const stat = await lstat(root);
  check(stat.isDirectory() && !stat.isSymbolicLink() && samePath(await realpath(root), root), 'P2_PATH_REJECTED');
  const markerPath = path.join(root, 'run.json');
  await regularFile(markerPath, true);
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  check(marker.application === 'doon-mastra-p2' && marker.syntheticOnly === true && [5,10].includes(marker.budgetCny) && Object.keys(marker).length === 3, 'P2_MARKER_REJECTED');
  return root;
}
function numericUsage(value) {
  const result = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens']) {
    if (Number.isFinite(value?.[key]) && value[key] >= 0) result[key] = value[key];
  }
  return result;
}
const knownCodes = new Set([
  'P2_INVALID_INPUT', 'P2_PATH_REJECTED', 'P2_MARKER_REJECTED', 'P2_ASSERTION_FAILED',
  'P2_ASSERTION_FINISH', 'P2_ASSERTION_READ_TOOL', 'P2_ASSERTION_READ_RESULT',
  'P2_ASSERTION_NO_EFFECTS', 'P2_ASSERTION_EFFECT_COUNT', 'P2_ASSERTION_DUPLICATE_EFFECT',
  'P2_ASSERTION_SUSPEND_IDS', 'P2_ASSERTION_FRESH_CASE', 'P2_EXECUTION_FAILED',
  'P2_TIMEOUT', 'P2_BUDGET_EXCEEDED', 'P2_EFFECT_FILE_INVALID',
]);
function safeError(error) {
  if (knownCodes.has(error?.code)) return error.code;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'P2_TIMEOUT';
  return 'P2_EXECUTION_FAILED';
}

let mastra, storage, root, effectsPath, readCalls = 0, createCalls = 0, stepsObserved = 0;
let success;
const deadline = setTimeout(() => {
  emit({status: 'failed', errorCode: 'P2_TIMEOUT', effects: null, readCalls, createCalls, stepsObserved, assertionsPassed: false});
  process.exit(1);
}, 180_000);

async function effects() {
  if (!effectsPath || !await regularFile(effectsPath)) return 0;
  const lines = (await readFile(effectsPath, 'utf8')).trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const item = JSON.parse(line);
    check(item.orderId === 'SYNTHETIC-P2-001' && item.taskId === 'SYNTHETIC-P2-TASK-001' && item.caseId === caseArg && Object.keys(item).length === 3, 'P2_EFFECT_FILE_INVALID');
  }
  return lines.length;
}

try {
  root = await validateDirectory();
  effectsPath = path.join(root, caseArg + '.effects.jsonl');
  const databasePath = path.join(root, caseArg + '.sqlite');
  const initialEffects = await effects();
  check(initialEffects === 0, 'P2_ASSERTION_NO_EFFECTS');
  for (const suffix of ['', '-wal', '-shm', '-journal']) await regularFile(databasePath + suffix);
  if (['generate', 'stream', 'suspend'].includes(modeArg)) check(!await regularFile(databasePath), 'P2_ASSERTION_FRESH_CASE');
  else await regularFile(databasePath, true);

  const [{Agent}, {Mastra}, {createTool}, {LibSQLStore}, {z}, {createP2Model}] = await Promise.all([
    import('@mastra/core/agent'), import('@mastra/core/mastra'), import('@mastra/core/tools'),
    import('@mastra/libsql'), import('zod'), import('./model.mjs'),
  ]);
  const {model, providerOptions} = await createP2Model({directory: root, thinking: thinkingArg, caseId: caseArg, phase: modeArg});
  const readOrder = createTool({
    id: 'p2-read-synthetic-order', description: 'Read the one synthetic order and its verification field.',
    inputSchema: z.object({orderId: z.literal('SYNTHETIC-P2-001')}).strict(),
    outputSchema: z.object({orderId: z.string(), quantity: z.number(), verification: z.string()}),
    execute: async () => {
      readCalls++;
      check(readCalls === 1, 'P2_ASSERTION_READ_TOOL');
      return {orderId: 'SYNTHETIC-P2-001', quantity: 17, verification: 'P2_READ_RESULT_17'};
    },
  });
  const createSyntheticTask = createTool({
    id: 'p2-create-synthetic-task', description: 'Create one synthetic test task after the simulated approval decision.',
    inputSchema: z.object({orderId: z.literal('SYNTHETIC-P2-001')}).strict(),
    outputSchema: z.object({taskId: z.string()}), requireApproval: true,
    execute: async () => {
      createCalls++;
      check(modeArg === 'approve' && createCalls === 1 && await effects() === 0, 'P2_ASSERTION_DUPLICATE_EFFECT');
      // Exclusive creation avoids a repeated call creating a second side effect.
      await writeFile(effectsPath, JSON.stringify({caseId: caseArg, orderId: 'SYNTHETIC-P2-001', taskId: 'SYNTHETIC-P2-TASK-001'}) + '\n', {encoding: 'utf8', flag: 'wx', mode: 0o600});
      return {taskId: 'SYNTHETIC-P2-TASK-001'};
    },
  });
  const readMode = modeArg === 'generate' || modeArg === 'stream';
  const agent = new Agent({
    id: 'p2-' + caseArg, name: 'P2 synthetic tool verification', model, maxRetries: 0,
    instructions: readMode
      ? 'This is a synthetic integration test. Call readOrder exactly once for SYNTHETIC-P2-001. After the tool result, return only its verification field verbatim. Do not invent the field or call any tool again.'
      : 'This is a synthetic approval test. Call createSyntheticTask exactly once for SYNTHETIC-P2-001. The test harness provides a simulated human decision. After approval, acknowledge the returned task ID. After denial, stop and acknowledge denial without retrying or calling tools again.',
    tools: readMode ? {readOrder} : {createSyntheticTask},
  });
  if (!readMode) storage = new LibSQLStore({id: 'p2-store-' + caseArg, url: pathToFileURL(databasePath).href});
  mastra = new Mastra({agents: {agent}, ...(storage ? {storage} : {}), logger: false});
  const options = {
    maxSteps: 3, toolChoice: 'auto', providerOptions, maxProcessorRetries: 0,
    modelSettings: {maxOutputTokens: 4096, maxRetries: 0, timeout: {totalMs: 180_000}},
    abortSignal: AbortSignal.timeout(180_000), onStepFinish: () => {stepsObserved++;},
  };
  let result;
  if (modeArg === 'generate') result = await agent.generate('Read SYNTHETIC-P2-001 using readOrder, then return the verification field.', options);
  else if (modeArg === 'stream') {
    const output = await agent.stream('Read SYNTHETIC-P2-001 using readOrder, then return the verification field.', options);
    result = await output.getFullOutput();
  } else if (modeArg === 'suspend') result = await agent.generate('Create the synthetic task for SYNTHETIC-P2-001 using createSyntheticTask. Wait for the simulated human decision.', options);
  else if (modeArg === 'approve') result = await agent.approveToolCallGenerate({...options, runId: requestedRunId, toolCallId: requestedToolCallId});
  else result = await agent.declineToolCallGenerate({...options, runId: requestedRunId, toolCallId: requestedToolCallId, reason: 'Simulated human decision: reject this synthetic task.'});
  check(!result.error, 'P2_EXECUTION_FAILED');
  const effectCount = await effects();
  if (readMode) {
    check(result.finishReason === 'stop', 'P2_ASSERTION_FINISH');
    check(readCalls === 1, 'P2_ASSERTION_READ_TOOL');
    check(typeof result.text === 'string' && result.text.trim() === 'P2_READ_RESULT_17', 'P2_ASSERTION_READ_RESULT');
    check(effectCount === 0, 'P2_ASSERTION_NO_EFFECTS');
  } else if (modeArg === 'suspend') {
    check(result.finishReason === 'suspended', 'P2_ASSERTION_FINISH');
    check(effectCount === 0 && createCalls === 0, 'P2_ASSERTION_NO_EFFECTS');
    check(safeId(result.runId) && safeId(result.suspendPayload?.toolCallId), 'P2_ASSERTION_SUSPEND_IDS');
  } else {
    check(result.finishReason === 'stop', 'P2_ASSERTION_FINISH');
    check(effectCount === (modeArg === 'approve' ? 1 : 0) && createCalls === (modeArg === 'approve' ? 1 : 0), 'P2_ASSERTION_EFFECT_COUNT');
  }
  success = {
    status: 'passed', finishReason: result.finishReason, effects: effectCount, readCalls, createCalls, stepsObserved,
    usage: numericUsage(result.totalUsage ?? result.usage), assertionsPassed: true,
    ...(safeId(result.runId) ? {runId: result.runId} : {}),
    ...(modeArg === 'suspend' ? {toolCallId: result.suspendPayload.toolCallId} : {}),
    ...(['approve', 'decline'].includes(modeArg) ? {decision: 'simulated-' + modeArg, resumedRunId: requestedRunId, resumedToolCallId: requestedToolCallId} : {}),
  };
} catch (error) {
  let count = null;
  try {count = await effects();} catch {}
  emit({status: 'failed', errorCode: safeError(error), effects: count, readCalls, createCalls, stepsObserved, assertionsPassed: false});
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  try {if (mastra) await mastra.shutdown();} catch {cleanupFailed = true;}
  try {if (storage) await storage.close();} catch {cleanupFailed = true;}
  if (cleanupFailed) {
    if (!emitted) emit({status: 'failed', errorCode: 'P2_EXECUTION_FAILED', effects: null, readCalls, createCalls, stepsObserved, assertionsPassed: false});
    process.exitCode = 1;
  }
  clearTimeout(deadline);
}
if (success && !emitted) emit(success);
