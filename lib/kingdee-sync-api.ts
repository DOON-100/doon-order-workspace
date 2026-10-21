import {z} from 'zod';
import {all,broad,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {sha} from './workbooks';
import {kingdeeConfig,prepareKingdeeConnection} from './kingdee-client';
import {latestKingdeeRows} from './kingdee-latest';
import {kingdeeSyncState} from './kingdee-sync-state';
import {KINGDEE_SYNC_LIMIT,KINGDEE_SYNC_RULE,apiRecordId,existingKingdeeIndex,classifyKingdeeRow,type KingdeeApiRecord} from './kingdee-sync-records';
import type {KingdeeQueryRow} from './kingdee-readonly-types';

type Receipt=Entity&{kind:'kingdee_sync_receipt';actorId:string;inserted:number;skipped:number;held:number;selected?:number;excludedComplete?:number;excludedUnknown?:number;sourceAsOf?:string;durationMs?:number;createdAt:string;records:{id:string;hash:string}[]};
const running=new Set<string>();
function access(req:Request,m:Member){
 if(!m.active||!broad(m))throw new AppError('仅有效 PMC / 采购和管理员可同步金蝶采购记录。',403);
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('金蝶同步尚未建立业务小组关联，请在有全表权限的全部范围操作。',403);
}
function configuration(){const config=kingdeeConfig();if(!config)throw new AppError('金蝶连接尚未配置，未写入中台。',503);return config;}
function binding(config:NonNullable<ReturnType<typeof kingdeeConfig>>){return JSON.stringify([KINGDEE_SYNC_RULE,config.clientId,config.instanceId,config.accountId]);}
async function receiptId(m:Member,requestId:string){return 'kingdee_sync_receipt_'+await sha(JSON.stringify([m.id,requestId]));}
function publicReceipt(receipt:Receipt){return {id:receipt.id,inserted:receipt.inserted,skipped:receipt.skipped,held:receipt.held,selected:receipt.selected,excludedComplete:receipt.excludedComplete||0,excludedUnknown:receipt.excludedUnknown||0,sourceAsOf:receipt.sourceAsOf,durationMs:receipt.durationMs,completedAt:receipt.createdAt,limit:KINGDEE_SYNC_LIMIT};}
async function checkedReceipt(s:State,receipt:Receipt){
 for(const expected of receipt.records){const record=s.records.find(item=>item.id===expected.id) as KingdeeApiRecord|undefined;if(!record||record.kind!=='kingdee_pending_api_row'||record.batchId!==receipt.id||record.sourceHash!==expected.hash||await sha(JSON.stringify(record.row))!==expected.hash)throw new AppError('批次已提交，但结果回读未通过，请核查原批次，不要重复新增。',409);}
 return publicReceipt(receipt);
}
export async function kingdeeSyncGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action==='kingdee-sync-ready'){
  access(req,m);if(new URL(req.url).search)throw new AppError('连接准备不接受查询参数。');
  await prepareKingdeeConnection(configuration());return json({ready:true});
 }
 if(action!=='kingdee-sync-result')return null;access(req,m);
 const params=new URL(req.url).searchParams;
 if([...params.keys()].some(key=>key!=='requestId')||params.getAll('requestId').length>1)throw new AppError('同步批次参数无效。');
 const key=params.get('requestId'),id=key?await receiptId(m,z.string().uuid().parse(key)):'';
 const receipt=(all(s,'kingdee_sync_receipt') as Receipt[]).filter(item=>item.actorId===m.id&&(!id||item.id===id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 return json(receipt?{status:'complete',receipt:await checkedReceipt(s,receipt)}:{status:'not-completed'});
}

/** One explicit click = one bounded batch. Kingdee business calls remain GET-only. */
export async function kingdeeSyncPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='kingdee-sync-run')return null;access(req,m);
 const input=z.object({requestId:z.string().uuid()}).strict().parse(await req.json()),id=await receiptId(m,input.requestId);
 const previous=all(s,'kingdee_sync_receipt').find(item=>item.id===id) as Receipt|undefined;
 if(previous)return json(await checkedReceipt(s,previous));
 const startedAt=Date.now(),config=configuration(),sourceBinding=binding(config);
 if(running.has(sourceBinding))throw new AppError('该账套已有同步正在进行，请稍后核查本批结果。',429);running.add(sourceBinding);
 try{
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(90000)]);
  const source=await latestKingdeeRows(config,signal);
  const currentState=await kingdeeSyncState(),currentMember=all(currentState,'member').find(item=>item.id===m.id) as Member|undefined;
  if(!currentMember)throw new AppError('当前账号已失效。',403);access(req,currentMember);
  if(binding(configuration())!==sourceBinding)throw new AppError('金蝶账套配置已变化，请重新同步。',409);
  const receipt=all(currentState,'kingdee_sync_receipt').find(item=>item.id===id) as Receipt|undefined;
  if(receipt)return json(await checkedReceipt(currentState,receipt));
  const index=await existingKingdeeIndex(currentState),candidates:KingdeeQueryRow[]=[],seen=new Set<string>();let skipped=0,held=0;
  for(const row of source.rows){
   const recordId=await apiRecordId(config.accountId,row);if(seen.has(recordId))throw new AppError('金蝶源行标识重复，本次未写入。',409);seen.add(recordId);
   const decision=classifyKingdeeRow(row,recordId,index);
   if(decision==='existing')skipped++;else if(decision==='uncertain')held++;else candidates.push(row);
  }
  if(candidates.length>KINGDEE_SYNC_LIMIT)throw new AppError('一次最多新增 30 条采购商品行。');
  // Save the captured source values directly. Existing rows are never refreshed,
  // so querying the same order again would only add latency, not improve dedup.
  const createdAt=now(),records:KingdeeApiRecord[]=[];
  for(const row of candidates){
   const recordId=await apiRecordId(config.accountId,row);if(currentState.records.some(item=>item.id===recordId))throw new AppError('记录标识已存在，本次未写入，请重新同步。',409);
   records.push({id:recordId,kind:'kingdee_pending_api_row',accountId:config.accountId,instanceId:config.instanceId,clientId:config.clientId,row,sourceHash:await sha(JSON.stringify(row)),createdAt,actorId:m.id,batchId:id});
  }
  const result:Receipt={id,kind:'kingdee_sync_receipt',actorId:m.id,inserted:records.length,skipped,held,selected:source.selected,excludedComplete:source.excludedComplete,excludedUnknown:source.excludedUnknown,sourceAsOf:source.sourceAsOf,durationMs:Date.now()-startedAt,createdAt,records:records.map(row=>({id:row.id,hash:row.sourceHash}))};
  if(new Set(records.map(row=>row.id)).size!==records.length)throw new AppError('同步批次存在重复标识，未写入。',409);
  if(currentState.records.some(item=>item.id===id))throw new AppError('同步回执标识冲突，请核查原批次。',409);
  // Revision guard makes dedup + new rows + receipt one atomic operation.
  // Existing business rows are never passed to commit(). No preview or approval step.
  await commit(currentState.revision,[...records,result,audit(m,result,null,'金蝶采购仅新增同步','金蝶只读 API',{inserted:records.length,skipped,held,selected:source.selected,excludedUnknown:source.excludedUnknown,batchId:id})]);
  return json(await checkedReceipt(await kingdeeSyncState(),result));
 }finally{running.delete(sourceBinding);}
}
