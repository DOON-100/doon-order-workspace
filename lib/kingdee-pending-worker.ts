import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {type Entity,type State,newId} from './domain';
import {AppError,database} from './store';
import {sha} from './workbooks';
import {kingdeeConfig,kingdeeRead,kingdeeDetails,object,sourceId,sourceText,type KingdeeConfig} from './kingdee-client';
import {kingdeeDetailRows} from './kingdee-readonly-api';
import {planKingdeeCurrent,commitKingdeeCurrent,kingdeeCurrentVersion} from './kingdee-current';
import type {KingdeeQueryRow} from './kingdee-readonly-types';

type Lease={workerId:string;fence:number};
const actorId='service_kingdee_pending_schedule';
function configuration(){
 if((env as unknown as Record<string,unknown>).DOON_KINGDEE_PENDING_SYNC_ENABLED!=='1')throw new AppError('采购未上货定时同步未启用。',503);
 const c=kingdeeConfig();if(!c)throw new AppError('金蝶只读连接尚未配置。',503);return c;
}
const binding=(c:KingdeeConfig)=>JSON.stringify(['kingdee-pending-schedule-v1',c.clientId,c.instanceId,c.accountId]);
async function state():Promise<State>{
 const db=database();for(let retry=0;retry<3;retry++){
  const before=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  const result=await db.prepare("SELECT data FROM records WHERE kind IN ('kingdee_pending_sync_state','kingdee_pending_api_row') OR id GLOB 'kingdee_api_row_*' OR id GLOB 'kingdee_pending_schedule_*' OR id GLOB 'kingdee_pending_sync_state_*' ORDER BY rowid").all<{data:string}>();
  const after=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  if(before?.revision===after?.revision)return {revision:after?.revision||0,records:result.results.map(r=>JSON.parse(r.data))};
 }throw new AppError('采购来源正在变化，请稍后重试。',409);
}
async function leaseValid(lease:Lease){
 const valid=await database().prepare("SELECT 1 AS valid FROM kingdee_pending_schedule_lease WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+1000)").bind(lease.workerId,lease.fence).first();
 if(!valid)throw new AppError('采购定时任务租约已失效，本次未写入。',409);
}
/** Full pending window, not the manual button's latest-30 window. No upstream writes. */
async function scan(c:KingdeeConfig,signal:AbortSignal,lease:Lease){
 const cutoff=Date.now(),rows:KingdeeQueryRow[]=[],orders=new Set<string>();let count:number|undefined,unknown=0;
 for(let page=1;page<=1000;page++){
  await leaseValid(lease);
  const data=await kingdeeRead(c,'list',{page:String(page),page_size:'30',bill_status:'C',create_end_time:String(cutoff)},signal);
  if(!Number.isSafeInteger(data.count)||Number(data.count)<0||Number(data.count)>30000||data.page!==page||data.page_size!==30||!Array.isArray(data.rows)||data.current_page_size!==data.rows.length||data.rows.length!==Math.min(30,Math.max(0,Number(data.count)-(page-1)*30)))throw new AppError('金蝶采购分页不完整或超过全量范围上限，本次未写入。',502);
  if(count!==undefined&&count!==data.count)throw new AppError('金蝶采购分页期间总数变化，本次未写入。',409);count=Number(data.count);
  const summaries=data.rows.map(object);
  for(const s of summaries){const id=sourceId(s.id);if(orders.has(id)||s.bill_status!=='C')throw new AppError('金蝶采购身份或审核状态异常。',409);orders.add(id);}
  const pending=summaries.filter(s=>s.real_io_status!=='C');
  for(let offset=0;offset<pending.length;offset+=3){
   await leaseValid(lease);
   const batch=pending.slice(offset,offset+3),details=await kingdeeDetails(c,batch.map(s=>sourceId(s.id)),signal);
   for(let i=0;i<batch.length;i++){
    const s=batch[i],d=details[i];if(['bill_no','supplier_id'].some(k=>sourceText(s[k])!==sourceText(d[k])))throw new AppError('金蝶采购详情与列表身份不一致。',409);
    const mapped=kingdeeDetailRows(d,sourceId(s.id));unknown+=mapped.unknown;
    rows.push(...mapped.rows.filter(r=>!r.uncertain));if(rows.length>100000)throw new AppError('金蝶采购明细超过全量范围上限。',502);
   }
  }
  if(page*30>=count){
   if(unknown)throw new AppError('金蝶存在入库状态不明的明细，全量同步未执行，当前表保持原样。',409);
   return {rows,unknown,sourceAsOf:new Date(cutoff).toISOString()};
  }
 }throw new AppError('金蝶采购全量分页未完成。',502);
}
async function checked(s:State,receipt:Entity){
 // Receipts describe the completed transaction; current rows may have changed since then.
 return {inserted:receipt.inserted,existing:receipt.existing,held:receipt.held,changed:receipt.changed,removed:receipt.removed||0,total:receipt.total};
}
/** Native worker only; service identity is never accepted from HTTP or a browser. */
export async function runKingdeePendingWorker(input:{requestId:string;lease:Lease}){
 const parsed=z.object({requestId:z.string().uuid(),lease:z.object({workerId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),fence:z.number().int().positive().safe()}).strict()}).strict().parse(input);
 const c=configuration(),sourceBinding=binding(c),id='kingdee_pending_schedule_receipt_'+await sha(JSON.stringify([sourceBinding,parsed.requestId]));
 await leaseValid(parsed.lease);
 const initial=await state(),prior=initial.records.find(r=>r.id===id);if(prior){if(prior.kind!=='kingdee_pending_schedule_receipt'||prior.binding!==sourceBinding)throw new AppError('采购定时批次冲突。',409);return checked(initial,prior);}
 const source=await scan(c,AbortSignal.timeout(900000),parsed.lease),current=await state();
 if(await kingdeeCurrentVersion(current,c)!==await kingdeeCurrentVersion(initial,c))throw new AppError('全量读取期间采购来源已变化，本次未同步，请重新执行。',409);
 if(binding(configuration())!==sourceBinding)throw new AppError('金蝶账套配置已变化，本次未写入。',409);
 const previous=current.records.find(r=>r.id===id);if(previous){if(previous.kind!=='kingdee_pending_schedule_receipt'||previous.binding!==sourceBinding)throw new AppError('采购定时批次冲突。',409);return checked(current,previous);}
 const plan=await planKingdeeCurrent(current,c,source.rows,{full:true,sourceAsOf:source.sourceAsOf,actorId,batchId:id}),createdAt=String(plan.marker.createdAt);
 const {inserted,updated:changed,removed,unchanged:existing,held}=plan.result;
 const receipt:Entity={id,kind:'kingdee_pending_schedule_receipt',binding:sourceBinding,actorId,createdAt,sourceAsOf:source.sourceAsOf,inserted,existing,held,changed,removed,total:source.rows.length};
 const audit:Entity={id:newId('audit'),kind:'audit',targetId:id,lineId:'',actorId,actor:'金蝶采购未上货定时同步',action:'全量同步金蝶当前未上货明细',source:'固定程序定时任务',before:null,after:plan.result,createdAt};
 await commitKingdeeCurrent(current,plan,[receipt,audit],parsed.lease);return checked(await state(),receipt);
}
