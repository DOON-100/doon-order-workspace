import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { makeScriptedModel } from '../mock-model.mjs';

// Additional synthetic SDK checks; the original 11+5 suite lives in examples/mastra-local.
// These do not certify DeepSeek or exercise production authentication/database layers.
const hasToolResult = prompt => prompt.some(message => message.role === 'tool');

function toolModel(name) {
  return makeScriptedModel(({ prompt }) => hasToolResult(prompt)
    ? 'Synthetic tool result received.'
    : { toolCalls: [{ name, args: { orderId: 'SYNTHETIC-001' } }] });
}

for (const mode of ['generate', 'stream']) {
  test(`SDK ${mode}: Agent executes a schema tool and sends its result back to the model`, { timeout: 20_000 }, async () => {
    const received = [];
    const tool = createTool({
      id: 'read-synthetic-order', description: 'Read the single synthetic order',
      inputSchema: z.object({ orderId: z.literal('SYNTHETIC-001') }),
      outputSchema: z.object({ orderId: z.string(), quantity: z.number() }),
      execute: async input => {
        received.push(input);
        return { orderId: input.orderId, quantity: 12 };
      },
    });
    const model = toolModel('readOrder');
    const agent = new Agent({ id: `tool-loop-${mode}`, name: 'Synthetic order reader', instructions: 'Use readOrder.', model, tools: { readOrder: tool } });
    const output = await agent[mode]('Read SYNTHETIC-001.', { maxSteps: 3 });
    const result = mode === 'stream' ? await output.getFullOutput() : output;
    assert.equal(result.error, undefined);
    assert.equal(result.text, 'Synthetic tool result received.');
    assert.deepEqual(received, [{ orderId: 'SYNTHETIC-001' }]);
    assert.equal(model.calls.length, 2);
    assert.equal(model.calls[0].tools[0].name, 'readOrder');
    assert.ok(model.calls[0].tools[0].inputSchema.properties.orderId);
    assert.match(JSON.stringify(model.calls[1].prompt), /"quantity":12/);
    assert.equal(model.calls[0].mode, mode);
  });
}

test('SDK: next independent no-memory call has no previous private marker', { timeout: 20_000 }, async () => {
  const marker = 'SYNTHETIC-PRIVATE-MARKER-42';
  const model = makeScriptedModel(() => 'Synthetic response.');
  const agent = new Agent({ id: 'fresh-context', name: 'No-memory agent', instructions: 'Answer briefly.', model });
  await agent.generate(`Private marker for this call: ${marker}`);
  await agent.generate('Start a separate daily run.');
  assert.equal(model.calls.length, 2);
  assert.ok(JSON.stringify(model.calls[0].prompt).includes(marker));
  assert.ok(!JSON.stringify(model.calls[1].prompt).includes(marker));
  assert.match(JSON.stringify(model.calls[1].prompt), /separate daily run/);
});

for (const approved of [true, false]) {
  test(`SDK requireApproval: ${approved ? 'approve executes once' : 'decline never executes'} after zero-side-effect suspension`, { timeout: 20_000 }, async () => {
    let effects = 0;
    const tool = createTool({
      id: 'create-synthetic-task', description: 'Create a task in an in-memory counter',
      inputSchema: z.object({ orderId: z.literal('SYNTHETIC-001') }),
      outputSchema: z.object({ taskId: z.string() }),
      requireApproval: true,
      execute: async () => { effects += 1; return { taskId: 'SYNTHETIC-TASK-001' }; },
    });
    const model = toolModel('createTask');
    const agent = new Agent({ id: `approval-${approved}`, name: 'Synthetic approval', instructions: 'Use createTask.', model, tools: { createTask: tool } });
    const mastra = new Mastra({ agents: { agent }, storage: new InMemoryStore() });
    try {
      const pending = await agent.generate('Create a synthetic task.', { maxSteps: 3 });
      assert.equal(pending.finishReason, 'suspended');
      assert.equal(effects, 0);
      assert.ok(pending.runId);
      assert.ok(pending.suspendPayload.toolCallId);
      const options = { runId: pending.runId, toolCallId: pending.suspendPayload.toolCallId, maxSteps: 3 };
      const result = approved
        ? await agent.approveToolCallGenerate(options)
        : await agent.declineToolCallGenerate({ ...options, reason: 'Synthetic reviewer declined.' });
      assert.equal(result.error, undefined);
      assert.equal(result.finishReason, 'stop');
      assert.equal(effects, approved ? 1 : 0);
      if (!approved) assert.match(JSON.stringify(model.calls.at(-1).prompt), /Synthetic reviewer declined/);
    } finally {
      await mastra.shutdown();
    }
  });
}

function runWorker(...args) {
  const worker = fileURLToPath(new URL('./sdk-worker.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [worker, ...args], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = result.stdout.split(/\r?\n/).find(line => line.startsWith('SDK_RESULT '));
  assert.ok(report, `Missing synthetic worker result: ${result.stdout}`);
  return JSON.parse(report.slice('SDK_RESULT '.length));
}

for (const decision of ['approve', 'decline']) {
  test(`SDK libSQL: approval survives process exit and ${decision} resumes in a fresh process`, { timeout: 70_000 }, async () => {
    // Fresh system temp only; never receives a project/business database path.
    const directory = await mkdtemp(path.join(tmpdir(), 'doon-mastra-sdk-'));
    const database = path.join(directory, 'synthetic.sqlite');
    const effects = path.join(directory, 'synthetic-effects.jsonl');
    try {
      const suspended = runWorker('suspend', pathToFileURL(database).href, effects);
      assert.equal(suspended.finishReason, 'suspended');
      assert.equal(suspended.effects, 0);
      assert.ok(existsSync(database));
      assert.equal(existsSync(effects), false);
      const resumed = runWorker(decision, pathToFileURL(database).href, effects, suspended.runId, suspended.toolCallId);
      assert.equal(resumed.finishReason, 'stop');
      assert.equal(resumed.effects, decision === 'approve' ? 1 : 0);
      assert.equal(resumed.reasoningRestored, true);
      assert.notEqual(suspended.pid, resumed.pid);
      if (decision === 'approve') {
        const entries = (await readFile(effects, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.deepEqual(entries, [{ orderId: 'SYNTHETIC-001', taskId: 'SYNTHETIC-TASK-001' }]);
      } else assert.equal(existsSync(effects), false);
    } finally {
      // Both libSQL-owning children have exited, releasing Windows file handles.
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
      assert.ok(path.basename(resolved).startsWith('doon-mastra-sdk-'));
      await rm(resolved, { recursive: true, force: true });
      assert.equal(existsSync(resolved), false);
    }
  });
}
