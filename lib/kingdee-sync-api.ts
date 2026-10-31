import {z} from 'zod';
import {all,broad,type Entity,type Member,type State} from './domain';
import {AppError,audit,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {sha} from './workbooks';
import {kingdeeConfig,prepareKingdeeConnection} from './kingdee-client';
import {latestKingdeeRows} from './kingdee-latest';
import {kingdeeSyncState} from './kingdee-sync-state';
import {KINGDEE_SYNC_LIMIT,KINGDEE_SYNC_RULE} from './kingdee-sync-records';
import {planKingdeeCurrent,commitKingdeeCurrent,kingdeeCurrentVersion} from './kingdee-current';

type Receipt=Entity&{kind:'kingdee_sync_receipt';actorId:string;inserted:number;updated?:number;skipped:number;held:number;selected?:number;excludedComplete?:number;excludedUnknown?:number;sourceAsOf?:string;durationMs?:number;createdAt:string;records:{id:string;hash:string}[]};
const running=new Set<string>();
function access(req:Request,m:Member){
 if(!m.active||!broad(m))throw new AppError('仅有效 PMC / 采购和管理员可同步金蝶采购记录。',403);
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('金蝶同步尚未建立业务小组关联，请在有全表权限的全部范围操作。',403);
}
function configuration(){const config=kingdeeConfig();if(!config)throw new AppError('金蝶连接尚未配置，未写入中台。',503);return config;}
function binding(config:NonNullable<ReturnType<typeof kingdeeConfig>>){return JSON.stringify([KINGDEE_SYNC_RULE,config.clientId,config.instanceId,config.accountId]);}
async function receiptId(m:Member,requestId:string){return 'kingdee_sync_receipt_'+await sha(JSON.stringify([m.id,requestId]));}
function publicReceipt(receipt:Receipt){return {id:receipt.id,inserted:receipt.inserted,updated:receipt.updated||0,skipped:receipt.skipped,held:receipt.held,selected:receipt.selected,excludedComplete:receipt.excludedComplete||0,excludedUnknown:receipt.excludedUnknown||0,sourceAsOf:receipt.sourceAsOf,durationMs:receipt.durationMs,completedAt:receipt.createdAt,limit:KINGDEE_SYNC_LIMIT};}
async function checkedReceipt(s:State,receipt:Receipt){
 // Current rows are mutable and can be removed by a later full sync. The atomic receipt is the retry authority.
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
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(90000)]),initial=await kingdeeSyncState();
  const source=await latestKingdeeRows(config,signal);
  const currentState=await kingdeeSyncState(),currentMember=all(currentState,'member').find(item=>item.id===m.id) as Member|undefined;
  if(!currentMember)throw new AppError('当前账号已失效。',403);access(req,currentMember);
  if(binding(configuration())!==sourceBinding)throw new AppError('金蝶账套配置已变化，请重新同步。',409);
  const receipt=all(currentState,'kingdee_sync_receipt').find(item=>item.id===id) as Receipt|undefined;
  if(receipt)return json(await checkedReceipt(currentState,receipt));
  if(await kingdeeCurrentVersion(initial,config)!==await kingdeeCurrentVersion(currentState,config))throw new AppError('读取期间采购来源已变化，本次未同步，请重新执行。',409);
  if(source.rows.length>KINGDEE_SYNC_LIMIT)throw new AppError('一次最多同步 30 条采购商品行。');
  const plan=await planKingdeeCurrent(currentState,config,source.rows,{full:false,sourceAsOf:source.sourceAsOf,actorId:m.id,batchId:id});
  const {inserted,updated,unchanged:skipped,held}=plan.result,createdAt=String(plan.marker.createdAt);
  const result:Receipt={id,kind:'kingdee_sync_receipt',actorId:m.id,inserted,updated,skipped,held,selected:source.selected,excludedComplete:source.excludedComplete,excludedUnknown:source.excludedUnknown,sourceAsOf:source.sourceAsOf,durationMs:Date.now()-startedAt,createdAt,records:[]};
  if(currentState.records.some(item=>item.id===id))throw new AppError('同步回执标识冲突，请核查原批次。',409);
  // Revision guard makes dedup + new rows + receipt one atomic operation.
  // Only the selected source rows are replaced; no historical copies are created.
  await commitKingdeeCurrent(currentState,plan,[result,audit(m,result,null,'金蝶采购最近30条同步','金蝶只读 API',{inserted,updated,skipped,held,selected:source.selected,excludedUnknown:source.excludedUnknown,batchId:id})]);
  return json(await checkedReceipt(await kingdeeSyncState(),result));
 }finally{running.delete(sourceBinding);}
}
