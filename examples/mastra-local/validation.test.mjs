import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {z} from 'zod';
import {makeAgent, toolModel, textModel, openLedger} from './lab.mjs';

const exec = promisify(execFile);
const worker = fileURLToPath(new URL('./workflow-worker.mjs', import.meta.url));
const runtimeWorker = fileURLToPath(new URL('./runtime-worker.mjs', import.meta.url));
async function sandbox(t) {
  const directory = await mkdtemp(join(tmpdir(), 'doon-mastra-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
async function child(command, directory, runId, mode) {
  const {stdout} = await exec(process.execPath, [worker, command, directory, runId, ...(mode ? [mode] : [])],
    {timeout: 30000, maxBuffer: 1024 * 1024});
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}

test('new daily runs do not inherit the previous prompt', async () => {
  const calls = [], agent = makeAgent('daily-duty', textModel('Checked synthetic pending tasks.', calls));
  await agent.generate('Day 1 private marker: SYNTHETIC-DAY-ONE');
  await agent.generate('Day 2: load current tasks from business tools.');
  assert.equal(calls.length, 2);
  assert(!JSON.stringify(calls[1].prompt).includes('SYNTHETIC-DAY-ONE'));
});

test('agent invokes a schema-validated synthetic order tool', async () => {
  const seen = [];
  const lookup = createTool({id: 'lookup-order', description: 'Look up a synthetic order.',
    inputSchema: z.object({orderId: z.literal('SYNTHETIC-ORDER-001')}),
    outputSchema: z.object({orderId: z.string(), status: z.string()}),
    execute: async input => { seen.push(input); return {...input, status: 'awaiting-pmc'}; }});
  const agent = makeAgent('order-duty', toolModel('lookup', {orderId: 'SYNTHETIC-ORDER-001'}), {lookup});
  const result = await agent.generate('Check the synthetic order.', {maxSteps: 3});
  assert.equal(seen.length, 1);
  assert.match(result.text, /tool result received/);
});

test('tool approval prevents side effects until explicitly approved', async t => {
  const directory = await sandbox(t);
  const {stdout} = await exec(process.execPath, [runtimeWorker, 'approval', directory], {timeout: 30000});
  assert.equal(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)).approvedEffects, 1);
});

test('customer-service agent delegates to an order agent with filtered context', async () => {
  const orderCalls = [];
  const orders = makeAgent('order-specialist', textModel('Synthetic order awaits PMC.', orderCalls));
  const service = new Agent({id: 'service-coordinator', name: 'Synthetic customer service',
    instructions: 'Delegate synthetic order questions to the order specialist.', agents: {orders},
    model: toolModel('agent-orders', {prompt: 'Check SYNTHETIC-ORDER-001.'})});
  await service.generate('SYNTHETIC-PARENT-PRIVATE: inspect the order.', {
    maxSteps: 3, delegation: {messageFilter: () => [], hookErrorStrategy: 'throw'},
  });
  assert.equal(orderCalls.length, 1);
  assert(!JSON.stringify(orderCalls[0].prompt).includes('SYNTHETIC-PARENT-PRIVATE'));
});

test('agent runs a fixed local automation script through a validated tool', async () => {
  const script = fileURLToPath(new URL('./synthetic-status-script.mjs', import.meta.url));
  const results = [];
  const inspect = createTool({id: 'inspect-with-script', description: 'Read status using the fixed synthetic script.',
    inputSchema: z.object({orderId: z.literal('SYNTHETIC-ORDER-001')}),
    execute: async ({orderId}) => {
      const {stdout} = await exec(process.execPath, [script, orderId], {timeout: 5000});
      const result = JSON.parse(stdout); results.push(result); return result;
    }});
  const agent = makeAgent('script-duty', toolModel('inspect', {orderId: 'SYNTHETIC-ORDER-001'}), {inspect});
  await agent.generate('Inspect the synthetic order with the approved script.', {maxSteps: 3});
  assert.equal(results.length, 1);
  assert.equal(results[0].synthetic, true);
});

test('human workflow survives process exit and resumes once with an audit record', async t => {
  const directory = await sandbox(t);
  const pending = await child('start', directory, 'restart-test');
  assert.equal(pending.status, 'suspended');
  assert.equal(pending.tasks, 0);
  const done = await child('resume', directory, 'restart-test');
  assert.equal(done.status, 'success');
  assert.equal(done.tasks, 1);
  assert.equal(done.audits, 1);
});

for (const mode of ['declined', 'wrong-reviewer', 'stale']) {
  test(`human workflow blocks ${mode} without creating a task`, async t => {
    const directory = await sandbox(t);
    await child('start', directory, mode);
    const blocked = await child('resume', directory, mode, mode);
    assert.equal(blocked.status, 'failed');
    assert.equal(blocked.tasks, 0);
    assert.equal(blocked.audits, 0);
    assert.match(blocked.error, /APPROVAL_DECLINED|REVIEWER_NOT_AUTHORIZED|SOURCE_VERSION_CHANGED/);
  });
}

test('application ledger deduplicates retries and rejects changed payloads', async t => {
  const directory = await sandbox(t), ledger = openLedger(directory);
  try {
    const input = {taskId: 'stable-event-step-id', orderId: 'SYNTHETIC-ORDER-001', expectedVersion: 1};
    for (let i = 0; i < 100; i++) assert.equal(ledger.save(input).created, i === 0);
    assert.throws(() => ledger.save({...input, expectedVersion: 2}), /IDEMPOTENCY_PAYLOAD_MISMATCH/);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM audit').get().count, 1);
  } finally { ledger.db.close(); }
});

test('daily schedule persists across runtime recreation without retaining a thread', async t => {
  const directory = await sandbox(t);
  const {stdout} = await exec(process.execPath, [runtimeWorker, 'schedule', directory], {timeout: 30000});
  assert.equal(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)).threadless, true);
});
