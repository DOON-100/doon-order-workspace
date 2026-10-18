import type {State} from './domain';
import {workflowOutboxSchema,workflowOutboxStatements} from '../standalone/workflow-outbox.mjs';
export {workflowOutboxSchema,workflowOutboxStatements};
/** Explicit opt-in. No migration, snapshot or historical replay when disabled. */
export const workflowEventsEnabled=(environment:unknown)=>(environment as Record<string,unknown>)?.WORKFLOW_EVENTS_ENABLED==='1';
export async function ensureWorkflowOutbox(db:any){for(const sql of workflowOutboxSchema.split(';').filter(v=>v.trim()))await db.prepare(sql).run();}
/** Read immutable deltas, rebuilding exact business versions, without restoring a DB. */
export async function workflowEventStates(db:any,cursor:number,currentRevision:number,limit=10){
 const base=await db.prepare('SELECT * FROM workflow_event_base WHERE id=1').first();
 if(!base)return{events:[],cursor:currentRevision};
 const rows=(await db.prepare('SELECT * FROM workflow_event_outbox WHERE revision<=? ORDER BY revision').bind(currentRevision).all()).results;
 const records=new Map<string,any>((JSON.parse(base.snapshot) as any[]).map(r=>[r.id,r]));let revision=base.revision;
 const events:{id:string;revision:number;at:string;before:State;after:State}[]=[];
 for(const row of rows){
  if(row.revision!==revision+1)throw new Error('变更日志出现间隔，暂停触发；需要核对未受控的写入入口。');
  const before:State={revision,records:[...records.values()]};
  for(const r of JSON.parse(row.after_data))records.set(r.id,r);
  revision=row.revision;
  if(revision>cursor)events.push({id:row.id,revision,at:row.created_at,before,after:{revision,records:[...records.values()]}});
  if(events.length>=limit)break;
 }
 if(events.length<limit&&revision!==currentRevision)throw new Error('变更日志与当前版本不一致，暂停自动触发。');
 return{events,cursor:events.at(-1)?.revision??Math.max(cursor,revision)};
}
