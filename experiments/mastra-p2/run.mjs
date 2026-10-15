import {mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {validateRun, writeRunJson} from './transport.mjs';

const requiredFlags = ['--live', '--synthetic'];
const args = process.argv.slice(2);
let resumeBudget;
const resumeIndex=args.indexOf('--resume-budget');
if(resumeIndex>=0 && args[resumeIndex+1]) {resumeBudget=args[resumeIndex+1];args.splice(resumeIndex,2);}
const budgetFlag=args.find(flag=>flag==='--budget-cny=5' || flag==='--budget-cny=10');
if (args.length !== requiredFlags.length+1 || !requiredFlags.every(flag => args.includes(flag)) || !budgetFlag) {
  console.log('P2_RESULT ' + JSON.stringify({status: 'not-started', errorCode: 'P2_EXPLICIT_FLAGS_REQUIRED'}));
  process.exit(1);
}

const marker = {application: 'doon-mastra-p2', syntheticOnly: true, budgetCny: Number(budgetFlag.split('=')[1])};
let directory, summary, startupFailureCode;
const attemptId='attempt-'+Date.now();
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
function metadata(value, expected) {
  if (!value || !['passed', 'failed'].includes(value.status) || value.caseId !== expected.caseId || value.thinking !== expected.thinking || value.mode !== expected.mode) return null;
  const report = {...expected, status: value.status, assertionsPassed: value.assertionsPassed === true};
  for (const key of ['pid', 'elapsedMs', 'effects', 'readCalls', 'createCalls', 'stepsObserved']) {
    report[key] = Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null;
  }
  if (['stop', 'suspended'].includes(value.finishReason)) report.finishReason = value.finishReason;
  for (const key of ['runId', 'toolCallId', 'resumedRunId', 'resumedToolCallId']) if (safeId(value[key])) report[key] = value[key];
  if (['simulated-approve', 'simulated-decline'].includes(value.decision)) report.decision = value.decision;
  const allowedErrors = new Set(['P2_INVALID_INPUT','P2_PATH_REJECTED','P2_MARKER_REJECTED','P2_ASSERTION_FAILED','P2_ASSERTION_FINISH','P2_ASSERTION_READ_TOOL','P2_ASSERTION_READ_RESULT','P2_ASSERTION_NO_EFFECTS','P2_ASSERTION_EFFECT_COUNT','P2_ASSERTION_DUPLICATE_EFFECT','P2_ASSERTION_SUSPEND_IDS','P2_ASSERTION_FRESH_CASE','P2_EXECUTION_FAILED','P2_TIMEOUT','P2_BUDGET_EXCEEDED','P2_EFFECT_FILE_INVALID']);
  if (value.status === 'failed') report.errorCode = allowedErrors.has(value.errorCode) ? value.errorCode : 'P2_EXECUTION_FAILED';
  report.usage = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens']) if (Number.isFinite(value.usage?.[key]) && value.usage[key] >= 0) report.usage[key] = value.usage[key];
  return report;
}
async function persist() {
  await writeRunJson(directory, 'summary.json', summary);
  await writeRunJson(directory, attemptId + '.json', summary);
}
async function phase(caseId, thinking, mode, runId, toolCallId) {
  const expected = {caseId, thinking, mode};
  summary.activePhase = expected;
  await persist();
  const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, [worker, directory, caseId, thinking, mode, ...(runId ? [runId, toolCallId] : [])], {
      env: {...process.env}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let raw = '', overflow = false, timedOut = false, finished = false;
    const finish = value => {if (finished) return; finished = true; clearTimeout(timer); resolve(value);};
    const timer = setTimeout(() => {timedOut = true; child.kill('SIGKILL');}, 190_000);
    child.stdout.on('data', chunk => {
      if (overflow) return;
      raw += chunk.toString('utf8');
      if (raw.length > 65_536) {overflow = true; raw = ''; child.kill('SIGKILL');}
    });
    child.stderr.on('data', () => {}); // Never retain provider/error output.
    child.once('error', () => finish({...expected, status: 'failed', errorCode: 'P2_WORKER_START_FAILED', assertionsPassed: false}));
    child.once('close', code => {
      let report;
      if (!overflow && !timedOut) {
        const lines = raw.split(/\r?\n/).filter(line => line.startsWith('WORKER_RESULT '));
        if (lines.length === 1) try {report = metadata(JSON.parse(lines[0].slice('WORKER_RESULT '.length)), expected);} catch {}
      }
      if (!report) report = {...expected, status: 'failed', errorCode: timedOut ? 'P2_WORKER_TIMEOUT' : overflow ? 'P2_WORKER_OUTPUT_REJECTED' : 'P2_WORKER_RESULT_MISSING', assertionsPassed: false};
      if (code !== 0 || !report.assertionsPassed) {report.status = 'failed'; report.errorCode ||= 'P2_WORKER_FAILED';}
      finish(report);
    });
  });
  summary.phases.push(result);
  summary.activePhase = null;
  if (result.status !== 'passed') {
    summary.status = 'failed'; summary.failureCode = result.errorCode;
    await persist();
    throw Object.assign(new Error('P2_PHASE_FAILED'), {code: 'P2_PHASE_FAILED'});
  }
  await persist();
  return result;
}

try {
  directory = resumeBudget ? await validateRun(resumeBudget,marker.budgetCny) : await mkdtemp(path.join(os.tmpdir(), 'doon-mastra-p2-'));
  if(!resumeBudget)await writeFile(path.join(directory, 'run.json'), JSON.stringify(marker) + '\n', {encoding: 'utf8', flag: 'wx', mode: 0o600});
  summary = {
    ...marker, attemptId, resumedBudget:Boolean(resumeBudget), startedAt: new Date().toISOString(), status: 'running', phases: [], activePhase: null,
    expectedWorkerPhases: 12, expectedProviderRequests: 16, budgetEvidence: 'budget.json',
    approvalMode: 'automated simulated human decisions', maxRetries: 0,
    notes: 'Synthetic tool/approval verification with a live model. No business data, real human approval, deployment, or Durable Agent crash replay is tested.',
  };
  await persist();
  for (const thinking of ['enabled', 'disabled']) {
    await phase(attemptId + '-' + thinking + '-generate', thinking, 'generate');
    await phase(attemptId + '-' + thinking + '-stream', thinking, 'stream');
    for (const decision of ['approve', 'decline']) {
      const caseId = attemptId + '-' + thinking + '-' + decision;
      const pending = await phase(caseId, thinking, 'suspend');
      if (!safeId(pending.runId) || !safeId(pending.toolCallId) || pending.effects !== 0 || pending.finishReason !== 'suspended') throw Object.assign(new Error('P2_SUSPEND_CONTRACT_FAILED'), {code: 'P2_SUSPEND_CONTRACT_FAILED'});
      const resumed = await phase(caseId, thinking, decision, pending.runId, pending.toolCallId);
      if (resumed.pid === pending.pid || resumed.effects !== (decision === 'approve' ? 1 : 0)) throw Object.assign(new Error('P2_RESUME_CONTRACT_FAILED'), {code: 'P2_RESUME_CONTRACT_FAILED'});
    }
  }
  summary.status = 'passed';
} catch (error) {
  if(!summary)startupFailureCode=error?.message==='P2_RESUME_BUDGET_MISMATCH'?'P2_RESUME_BUDGET_MISMATCH':'P2_RUN_FAILED';
  if (summary) {
    summary.status = 'failed';
    summary.failureCode ||= ['P2_PHASE_FAILED', 'P2_SUSPEND_CONTRACT_FAILED', 'P2_RESUME_CONTRACT_FAILED'].includes(error?.code) ? error.code : 'P2_RUN_FAILED';
  }
  process.exitCode = 1;
} finally {
  if (summary) {
    summary.finishedAt = new Date().toISOString();
    summary.passedPhases = summary.phases.filter(item => item.status === 'passed').length;
    try {await persist();} catch {process.exitCode = 1; summary.status = 'failed'; summary.failureCode = 'P2_SUMMARY_WRITE_FAILED';}
  }
  console.log('P2_RESULT ' + JSON.stringify({directory: directory ?? null, status: summary?.status ?? 'failed', passedPhases: summary?.passedPhases ?? 0, expectedWorkerPhases: 12, ...(summary?.failureCode || startupFailureCode ? {errorCode: summary?.failureCode || startupFailureCode} : {}), evidenceRetained: Boolean(directory)}));
}
