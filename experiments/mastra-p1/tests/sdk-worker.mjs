import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import { makeScriptedModel } from '../mock-model.mjs';

// Isolated child process: the only possible write target is a newly created test
// directory directly below the system temp directory, with the expected prefix.
const [mode, databaseUrl, effectsPath, runId, toolCallId] = process.argv.slice(2);
assert.ok(['suspend', 'approve', 'decline'].includes(mode));
const directory = path.dirname(fileURLToPath(databaseUrl));
assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
assert.ok(path.basename(directory).startsWith('doon-mastra-sdk-'));
assert.equal(path.basename(fileURLToPath(databaseUrl)), 'synthetic.sqlite');
assert.equal(path.resolve(effectsPath), path.join(directory, 'synthetic-effects.jsonl'));

const protocolMarker = 'SYNTHETIC-PROTOCOL-REASONING-MARKER';
const model = makeScriptedModel(({ prompt }) => prompt.some(message => message.role === 'tool')
  ? 'Synthetic approval processed.'
  : { reasoning: protocolMarker, toolCalls: [{ name: 'createTask', args: { orderId: 'SYNTHETIC-001' } }] });
const tool = createTool({
  id: 'persistent-synthetic-task', description: 'Append one synthetic task to the test directory',
  inputSchema: z.object({ orderId: z.literal('SYNTHETIC-001') }),
  outputSchema: z.object({ taskId: z.string() }),
  requireApproval: true,
  execute: async ({ orderId }) => {
    await appendFile(effectsPath, JSON.stringify({ orderId, taskId: 'SYNTHETIC-TASK-001' }) + '\n');
    return { taskId: 'SYNTHETIC-TASK-001' };
  },
});
const agent = new Agent({ id: 'persistent-synthetic-approval', name: 'Persistent synthetic approval', instructions: 'Use createTask.', model, tools: { createTask: tool } });
const storage = new LibSQLStore({ id: 'synthetic-sdk-store', url: databaseUrl });
const mastra = new Mastra({ agents: { agent }, storage });
try {
  const options = { runId, toolCallId, maxSteps: 3 };
  const result = mode === 'suspend'
    ? await agent.generate('Create SYNTHETIC-001 task.', { maxSteps: 3 })
    : mode === 'approve'
      ? await agent.approveToolCallGenerate(options)
      : await agent.declineToolCallGenerate({ ...options, reason: 'Synthetic reviewer declined after restart.' });
  assert.equal(result.error, undefined);
  // This checks internal message persistence only, not DeepSeek wire conversion.
  const reasoningRestored = mode !== 'suspend' && JSON.stringify(model.calls[0]?.prompt).includes(protocolMarker);
  if (mode !== 'suspend') assert.equal(reasoningRestored, true);
  let effects = 0;
  try { effects = (await readFile(effectsPath, 'utf8')).trim().split('\n').filter(Boolean).length; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('SDK_RESULT ' + JSON.stringify({
    pid: process.pid, finishReason: result.finishReason,
    runId: result.runId, toolCallId: result.suspendPayload?.toolCallId, effects, reasoningRestored,
  }));
} finally {
  await mastra.shutdown();
  await storage.close();
}
