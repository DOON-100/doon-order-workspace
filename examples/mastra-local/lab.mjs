import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {Mastra} from '@mastra/core';
import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {createStep, createWorkflow} from '@mastra/core/workflows';
import {LibSQLStore} from '@mastra/libsql';
import {z} from 'zod';

// A deterministic local model exercises Mastra's real loop, without API keys.
// It deliberately does not measure language-model reasoning quality.
export function localModel(reply, calls = []) {
  const generate = async options => {
    calls.push(structuredClone(options));
    const content = await reply(options);
    return {content, finishReason: content.some(c => c.type === 'tool-call') ? 'tool-calls' : 'stop',
      usage: {inputTokens: 10, outputTokens: 10, totalTokens: 20}, warnings: []};
  };
  return {
    specificationVersion: 'v2', provider: 'doon-local-fixture', modelId: 'synthetic-v1', supportedUrls: {},
    doGenerate: generate,
    doStream: async options => {
      const result = await generate(options);
      return {stream: new ReadableStream({start(controller) {
        controller.enqueue({type: 'stream-start', warnings: []});
        for (const [i, item] of result.content.entries()) {
          if (item.type === 'text') {
            const id = `text-${i}`;
            controller.enqueue({type: 'text-start', id});
            controller.enqueue({type: 'text-delta', id, delta: item.text});
            controller.enqueue({type: 'text-end', id});
          } else controller.enqueue(item);
        }
        controller.enqueue({type: 'finish', finishReason: result.finishReason, usage: result.usage});
        controller.close();
      }})};
    },
  };
}

export function textModel(text = 'Synthetic task completed.', calls = []) {
  return localModel(async () => [{type: 'text', text}], calls);
}

export function toolModel(toolName, input, calls = []) {
  return localModel(async ({prompt}) => prompt.some(m => m.role === 'tool')
    ? [{type: 'text', text: 'Synthetic tool result received.'}]
    : [{type: 'tool-call', toolCallId: 'local-call-1', toolName, input: JSON.stringify(input)}], calls);
}

export function makeAgent(id, model = textModel(), tools = {}) {
  return new Agent({id, name: id, instructions: 'Operate only on synthetic DOON lab fixtures.', model, tools});
}

export function openLedger(directory) {
  const db = new DatabaseSync(join(directory, 'synthetic-ledger.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, event TEXT NOT NULL, details TEXT NOT NULL)`);
  return {
    db,
    save(input) {
      const data = JSON.stringify(input), hash = createHash('sha256').update(data).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT payload_hash,data FROM tasks WHERE id=?').get(input.taskId);
        if (previous && previous.payload_hash !== hash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        if (!previous) {
          db.prepare('INSERT INTO tasks VALUES (?,?,?)').run(input.taskId, hash, data);
          db.prepare('INSERT INTO audit(task_id,event,details) VALUES (?,?,?)').run(input.taskId, 'task-created', data);
        }
        db.exec('COMMIT');
        return {taskId: input.taskId, created: !previous};
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

export const taskSchema = z.object({taskId: z.string(), orderId: z.literal('SYNTHETIC-ORDER-001'),
  expectedVersion: z.number().int(), assignee: z.literal('synthetic-pmc')}).strict();

export function createLab(directory, {sourceVersion = 1, reviewer = 'synthetic-sales'} = {}) {
  const ledger = openLedger(directory);
  const createTask = createTool({id: 'create-followup', description: 'Create one synthetic follow-up task.',
    inputSchema: taskSchema, outputSchema: z.object({taskId: z.string(), created: z.boolean()}),
    execute: async input => {
      if (input.expectedVersion !== sourceVersion) throw new Error('SOURCE_VERSION_CHANGED');
      return ledger.save(input);
    }});
  const review = createStep({id: 'human-review', inputSchema: taskSchema, outputSchema: taskSchema,
    suspendSchema: z.object({taskId: z.string(), sourceVersion: z.number()}),
    resumeSchema: z.object({approved: z.boolean(), reviewer: z.string(), expectedVersion: z.number()}),
    execute: async ({inputData, resumeData, suspend}) => {
      if (!resumeData) return await suspend({taskId: inputData.taskId, sourceVersion: inputData.expectedVersion});
      if (!resumeData.approved) throw new Error('APPROVAL_DECLINED');
      if (resumeData.reviewer !== reviewer) throw new Error('REVIEWER_NOT_AUTHORIZED');
      if (resumeData.expectedVersion !== inputData.expectedVersion || sourceVersion !== inputData.expectedVersion)
        throw new Error('SOURCE_VERSION_CHANGED');
      return inputData;
    }});
  const workflow = createWorkflow({id: 'synthetic-order-followup', inputSchema: taskSchema,
    outputSchema: z.object({taskId: z.string(), created: z.boolean()})})
    .then(review).then(createStep(createTask)).commit();
  const storage = new LibSQLStore({id: 'doon-local-lab', url: `file:${join(directory, 'mastra.sqlite').replaceAll('\\', '/')}`});
  const mastra = new Mastra({storage, workflows: {followup: workflow}, logger: false});
  return {mastra, storage, workflow, ledger,
    async close() { await mastra.shutdown(); await storage.close(); ledger.db.close(); }};
}
