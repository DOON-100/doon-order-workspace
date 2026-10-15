import {realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, relative, isAbsolute} from 'node:path';
import {createLab} from './lab.mjs';

const [command, directory, runId, mode = 'approved'] = process.argv.slice(2);
const root = await realpath(tmpdir()), target = await realpath(directory);
const pathFromTemp = relative(root, target);
if (isAbsolute(pathFromTemp) || pathFromTemp.startsWith('..') || !basename(target).startsWith('doon-mastra-'))
  throw new Error('Only a dedicated temporary lab directory is permitted.');
const lab = createLab(target, {sourceVersion: mode === 'stale' ? 2 : 1});
try {
  const run = await lab.workflow.createRun({runId});
  const result = command === 'start'
    ? await run.start({inputData: {taskId: runId, orderId: 'SYNTHETIC-ORDER-001', expectedVersion: 1, assignee: 'synthetic-pmc'}})
    : command === 'resume'
      ? await run.resume({step: 'human-review', resumeData: {approved: mode !== 'declined',
        reviewer: mode === 'wrong-reviewer' ? 'synthetic-outsider' : 'synthetic-sales', expectedVersion: 1}})
      : (() => { throw new Error('Unsupported lab command'); })();
  console.log(JSON.stringify({status: result.status, result: result.result,
    error: result.error?.message, tasks: lab.ledger.db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    audits: lab.ledger.db.prepare('SELECT COUNT(*) AS count FROM audit').get().count}));
} finally { await lab.close(); }
