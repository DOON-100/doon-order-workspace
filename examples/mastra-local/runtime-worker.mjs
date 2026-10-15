import assert from 'node:assert/strict';
import {realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, relative, isAbsolute, join} from 'node:path';
import {Mastra} from '@mastra/core';
import {createTool} from '@mastra/core/tools';
import {LibSQLStore} from '@mastra/libsql';
import {z} from 'zod';
import {makeAgent, toolModel} from './lab.mjs';

const [mode, directory] = process.argv.slice(2);
const root = await realpath(tmpdir()), target = await realpath(directory), rel = relative(root, target);
if (isAbsolute(rel) || rel.startsWith('..') || !basename(target).startsWith('doon-mastra-'))
  throw new Error('Only a dedicated temporary lab directory is permitted.');
const url = `file:${join(target, 'runtime.sqlite').replaceAll('\\', '/')}`;
if (mode === 'approval') {
  const storage = new LibSQLStore({id: 'approval-lab', url});
  let effects = 0;
  const action = createTool({id: 'approved-action', description: 'Synthetic action requiring human review.',
    inputSchema: z.object({orderId: z.literal('SYNTHETIC-ORDER-001')}), requireApproval: true,
    execute: async () => { effects++; return {done: true}; }});
  const agent = makeAgent('approval-agent', toolModel('action', {orderId: 'SYNTHETIC-ORDER-001'}), {action});
  const mastra = new Mastra({storage, agents: {agent}, logger: false});
  try {
    const pending = await agent.generate('Prepare the synthetic action.', {maxSteps: 3});
    assert.equal(pending.finishReason, 'suspended');
    assert.equal(effects, 0);
    await agent.approveToolCallGenerate({runId: pending.runId, toolCallId: pending.suspendPayload.toolCallId});
    assert.equal(effects, 1);
    console.log(JSON.stringify({approvedEffects: effects}));
  } finally { await mastra.shutdown(); await storage.close(); }
} else if (mode === 'schedule') {
  function runtime() {
    const storage = new LibSQLStore({id: 'schedule-lab', url});
    const agent = makeAgent('scheduled-duty');
    return {storage, mastra: new Mastra({storage, agents: {agent}, logger: false})};
  }
  const first = runtime();
  let id;
  try {
    const row = await first.mastra.schedules.create({id: 'synthetic-daily-duty', agentId: 'scheduled-duty',
      cron: '0 9 * * *', timezone: 'Asia/Shanghai', prompt: 'Inspect synthetic pending tasks.', status: 'paused'});
    id = row.id;
    assert.equal(row.threadId, undefined);
  } finally { await first.mastra.shutdown(); await first.storage.close(); }
  const second = runtime();
  try {
    const row = await second.mastra.schedules.get(id);
    assert.equal(row.status, 'paused');
    assert.equal(row.timezone, 'Asia/Shanghai');
    assert.equal(row.threadId, undefined);
    console.log(JSON.stringify({scheduleId: row.id, timezone: row.timezone, status: row.status, threadless: true}));
  } finally { await second.mastra.shutdown(); await second.storage.close(); }
} else throw new Error('Unknown local runtime test');
