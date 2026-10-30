import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {all,broad,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,database,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {kingdeeConfig,kingdeeSupplierCatalogPage,object,sourceId,type KingdeeConfig} from './kingdee-client';
import {sha} from './workbooks';

// Independent source catalog. Nothing here updates the existing supplier masters,
// external-portal bindings, Excel snapshots, or name-based outsourcing records.
const rule='kingdee-supplier-catalog-v1', pageSize=100, maxRows=10000;
const catalogPrefix='kingdee_supplier_catalog_', receiptPrefix='kingdee_supplier_catalog_receipt_';
const running=new Set<string>();
type Source={id:string;code:string;name:string;groupName:string|null;taxRate:string|null};
type Result={inserted:number;existing:number;changed:number;total:number;completedAt:string;durationMs?:number;scope?:'baseline'|'last-24-hours';addedSuppliers?:{code:string;name:string}[]};
function access(req:Request,m:Member){
 if(!m.active||!broad(m))throw new AppError('仅有效 PMC / 采购和管理员可访问金蝶供应商来源档案。',403);
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('供应商来源档案须在全部业务范围操作。',403);
}
function configuration(){const config=kingdeeConfig();if(!config)throw new AppError('金蝶只读连接尚未配置。',503);return config;}
function binding(c:KingdeeConfig){return JSON.stringify([rule,c.clientId,c.instanceId,c.accountId]);}
const normalized=(s:string)=>s.normalize('NFKC').trim().toUpperCase();
function number(value:unknown){
 const n=typeof value==='number'?value:typeof value==='string'&&/^\d{1,10}$/.test(value)?Number(value):NaN;
 if(!Number.isSafeInteger(n)||n<0)throw new AppError('金蝶供应商分页信息无效，本次未写入。',502);return n;
}
function field(value:unknown,max:number){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new AppError('金蝶供应商身份字段无效，本次未写入。',502);
 return value;
}
function optionalField(value:unknown,max:number){
 if(value===undefined||value===null)return null;
 if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new AppError('金蝶供应商来源字段无效，本次未写入。',502);
 return value;
}
async function idFor(accountId:string,id:string){return catalogPrefix+await sha(JSON.stringify([accountId,id]));}
async function receiptId(memberId:string,requestId:string){return receiptPrefix+await sha(JSON.stringify([memberId,requestId]));}
function publicReceipt(item:Entity):Result{return {inserted:item.inserted,existing:item.existing,changed:item.changed,total:item.total,completedAt:item.completedAt,...(typeof item.durationMs==='number'?{durationMs:item.durationMs}:{}),...(item.scope==='baseline'||item.scope==='last-24-hours'?{scope:item.scope}:{})};}
async function checkedReceipt(s:State,receipt:Entity,includeAdded=false){
 if(!Array.isArray(receipt.records)||!Array.isArray(receipt.issueRefs))throw new AppError('同步回执不完整，请核查原批次。',409);
 const byId=new Map(s.records.map(row=>[row.id,row]));
 for(const expected of receipt.records){const row=byId.get(expected.id);if(!row||row.batchId!==receipt.id||await sha(JSON.stringify(row))!==expected.hash)throw new AppError('同步回执回读未通过，请核查原批次。',409);}
 for(const expected of receipt.issueRefs){const row=byId.get(expected.id);if(!row||row.kind!=='kingdee_supplier_catalog_issue'||await sha(JSON.stringify(row))!==expected.hash)throw new AppError('同步核查记录回读未通过，请核查原批次。',409);}
 const result=publicReceipt(receipt);
 if(includeAdded){const added=receipt.records.map((expected:{id:string})=>byId.get(expected.id)).filter((row):row is Entity=>!!row&&row.kind==='kingdee_supplier_catalog');if(added.length!==receipt.inserted||added.some(row=>typeof row.code!=='string'||typeof row.name!=='string'))throw new AppError('同步回执的新增供应商不完整，请核查原批次。',409);result.addedSuppliers=added.map(row=>({code:row.code,name:row.name}));}
 return result;
}

/** Capture only the required source projection. Compare two complete scans; this
 * detects many paging races, but does not imply an atomic upstream snapshot. */
async function scan(c:KingdeeConfig,signal:AbortSignal,window?:{start:number;end:number}):Promise<Source[]>{
 const rows:Source[]=[],ids=new Set<string>(),codes=new Set<string>();let total=-1,pages=-1;
 for(let page=1;page<=100;page++){
  const data=await kingdeeSupplierCatalogPage(c,page,signal,window),count=number(data.count),totalPages=number(data.total_page);
  if(count>maxRows||totalPages>100||(count===0?![0,1].includes(totalPages):totalPages!==Math.ceil(count/pageSize)))throw new AppError('金蝶供应商总数或页数异常，本次未写入。',502);
  if(total<0){total=count;pages=totalPages;}else if(total!==count||pages!==totalPages)throw new AppError('金蝶供应商分页期间数量发生变化，本次未写入。',409);
  if(!Array.isArray(data.rows)||data.rows.length>pageSize||(data.page!==undefined&&number(data.page)!==page)||(data.page_size!==undefined&&number(data.page_size)!==pageSize)||(data.current_page_size!==undefined&&number(data.current_page_size)!==data.rows.length))throw new AppError('金蝶供应商分页内容无效，本次未写入。',502);
  const expected=Math.min(pageSize,Math.max(0,total-(page-1)*pageSize));if(data.rows.length!==expected)throw new AppError('金蝶供应商页数不完整，本次未写入。',502);
  for(const raw of data.rows){const row=object(raw),id=sourceId(row.id),code=field(row.number,100),name=field(row.name,200),groupName=optionalField(row.group_name,500),taxRate=optionalField(row.rate,100),codeKey=normalized(code);
   if(/[\u0000-\u001f\u007f]/.test(id)||ids.has(id)||codes.has(codeKey))throw new AppError('金蝶供应商标识或编码重复，本次未写入。',409);
   ids.add(id);codes.add(codeKey);rows.push({id,code,name,groupName,taxRate});
  }
  if(page>=pages||total===0)break;
 }
 if(rows.length!==total)throw new AppError('金蝶供应商读取不完整，本次未写入。',502);
 return rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
async function completeSource(c:KingdeeConfig,signal:AbortSignal,window?:{start:number;end:number}){
 const first=await scan(c,signal,window),second=await scan(c,signal,window);
 if(JSON.stringify(first)!==JSON.stringify(second))throw new AppError('金蝶供应商读取期间发生变化，本次未写入，请稍后重试。',409);
 return first;
}

/** Include prefix collisions of any kind so even a corrupt/foreign ID is never overwritten. */
export async function kingdeeSupplierCatalogState():Promise<State>{
 const db=database();for(let retry=0;retry<3;retry++){
  const start=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  const rows=await db.prepare("SELECT data FROM records WHERE kind IN ('member','kingdee_supplier_catalog','kingdee_supplier_catalog_receipt','kingdee_supplier_catalog_issue') OR id GLOB 'kingdee_supplier_catalog_*' ORDER BY rowid").all<{data:string}>();
  const end=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  if((start?.revision||0)===(end?.revision||0))return {revision:end?.revision||0,records:rows.results.map(row=>JSON.parse(row.data))};
 }
 throw new AppError('其他成员正在更新，请稍后重试。',409);
}

type Lease={workerId:string;fence:number};
async function manualLease():Promise<Lease>{
 const db=database(),workerId='manual_'+crypto.randomUUID().replaceAll('-',''),timestamp=Date.now();
 await db.prepare('CREATE TABLE IF NOT EXISTS kingdee_supplier_catalog_lease(id TEXT PRIMARY KEY,worker TEXT NOT NULL,fence INTEGER NOT NULL,expires_at INTEGER NOT NULL)').run();
 const lease=await db.prepare("INSERT INTO kingdee_supplier_catalog_lease VALUES('scheduler',?,1,?) ON CONFLICT(id) DO UPDATE SET worker=excluded.worker,fence=kingdee_supplier_catalog_lease.fence+1,expires_at=excluded.expires_at WHERE kingdee_supplier_catalog_lease.expires_at<=? RETURNING fence").bind(workerId,timestamp+180000,timestamp).first<{fence:number}>();
 if(!lease)throw new AppError('该账套的供应商读取正在进行，请稍后重试。',429);
 return {workerId,fence:lease.fence};
}
async function releaseLease(lease:Lease){await database().prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=0 WHERE id='scheduler' AND worker=? AND fence=?").bind(lease.workerId,lease.fence).run();}
async function append(revision:number,records:Entity[],lease?:Lease){
 const db=database(),guard=newId('txn');
 const statements=[db.prepare("INSERT INTO transaction_guards (id,valid) VALUES (?,CASE WHEN (SELECT revision FROM workspace_revision WHERE id='main')=? THEN 1 ELSE 0 END)").bind(guard,revision),
  ...(lease?[db.prepare("INSERT INTO transaction_guards (id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM kingdee_supplier_catalog_lease WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+1000)) THEN 1 ELSE 0 END)").bind(guard+'_lease',lease.workerId,lease.fence)]:[]),
  ...records.map(r=>db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?)').bind(r.id,r.kind,JSON.stringify(r))),
  db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'"),db.prepare('DELETE FROM transaction_guards WHERE id=? OR id=?').bind(guard,guard+'_lease')];
 try{await db.batch(statements);}catch(e){if(String(e).includes('revision_must_match')||String(e).includes('UNIQUE constraint failed'))throw new AppError('供应商资料或批次已变化，本次未写入，请核查后重试。',409);throw e;}
}

export async function kingdeeSupplierCatalogGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['kingdee-supplier-catalog','kingdee-supplier-catalog-result'].includes(action))return null;access(req,m);
 const c=configuration(),params=new URL(req.url).searchParams;
 if(action==='kingdee-supplier-catalog-result'){
  if([...params.keys()].some(k=>k!=='requestId')||params.getAll('requestId').length!==1)throw new AppError('请求编号无效。');
  const requestId=z.string().uuid().parse(params.get('requestId')),id=await receiptId(m.id,requestId),receipt=s.records.find(r=>r.id===id);
  if(!receipt)return json({status:'not-completed'});if(receipt.kind!=='kingdee_supplier_catalog_receipt'||receipt.actorId!==m.id||receipt.binding!==binding(c))throw new AppError('批次与当前账套不一致。',409);
  return json({status:'complete',receipt:await checkedReceipt(s,receipt,true)});
 }
 if([...params.keys()].length)throw new AppError('供应商目录不接受查询参数。');
 const rows=all(s,'kingdee_supplier_catalog').filter(r=>r.accountId===c.accountId&&r.instanceId===c.instanceId&&r.clientId===c.clientId).map(r=>({id:r.id,code:r.code,name:r.name,groupName:r.groupName??null,taxRate:r.taxRate??null,firstSeen:r.firstSeen}));
 const latest=all(s,'kingdee_supplier_catalog_receipt').filter(r=>r.binding===binding(c)).reverse().sort((a,b)=>b.completedAt.localeCompare(a.completedAt))[0];
 const issueIds=new Set<string>(latest?.issueRefs?.map((r:{id:string})=>r.id)||[]);
 const issues=latest?all(s,'kingdee_supplier_catalog_issue').filter(r=>issueIds.has(r.id)).map(r=>({code:r.code,name:r.name,groupName:r.groupName??null,taxRate:r.taxRate??null,reason:r.reason,previousCode:r.previousCode,previousName:r.previousName,previousGroupName:r.previousGroupName??null,previousTaxRate:r.previousTaxRate??null})):[];
 let autoStatus:null|{lastAttemptAt:string;lastResult:string;lastSuccessAt:string}=null;
 try{const status=await database().prepare("SELECT last_attempt_at,last_result,last_success_at,binding_hash FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").first<{last_attempt_at:string;last_result:string;last_success_at:string;binding_hash:string}>();
  if(status&&status.binding_hash===await sha(binding(c))&&['started','complete','failed'].includes(status.last_result)&&typeof status.last_attempt_at==='string'&&typeof status.last_success_at==='string')autoStatus={lastAttemptAt:status.last_attempt_at,lastResult:status.last_result,lastSuccessAt:status.last_success_at};
 }catch(error){if(!String(error).includes('no such table'))throw error;}
 return json({rows,lastSync:latest?await checkedReceipt(s,latest):null,issues,autoEnabled:(env as unknown as Record<string,unknown>).DOON_KINGDEE_SUPPLIER_SYNC_ENABLED==='1',autoStatus});
}
async function runCatalog(requestId:string,s:State,m:Member,signal:AbortSignal,req?:Request,lease?:Lease):Promise<Result>{
 const startedAt=Date.now();
 const c=configuration(),bound=binding(c),id=await receiptId(m.id,requestId);
 const previous=s.records.find(r=>r.id===id);if(previous){if(previous.kind!=='kingdee_supplier_catalog_receipt'||previous.actorId!==m.id||previous.binding!==bound)throw new AppError('请求编号已用于其他批次。',409);return checkedReceipt(s,previous,true);}
 if(running.has(bound))throw new AppError('该账套的供应商读取正在进行。',429);running.add(bound);
 try{
  const baseline=all(s,'kingdee_supplier_catalog_receipt').some(r=>r.binding===bound&&(r.scope==='baseline'||r.scope===undefined));
  const end=Date.now(),window=baseline?{start:end-86400000,end}:undefined;
  const captured=await completeSource(c,AbortSignal.any([signal,AbortSignal.timeout(120000)]),window),current=await kingdeeSupplierCatalogState(),member=req?all(current,'member').find(r=>r.id===m.id) as Member|undefined:m;
  if(!member)throw new AppError('当前账号已失效。',403);if(req)access(req,member);if(binding(configuration())!==bound)throw new AppError('金蝶账套配置已变化，请重新读取。',409);
  const repeated=current.records.find(r=>r.id===id);if(repeated){if(repeated.kind!=='kingdee_supplier_catalog_receipt'||repeated.actorId!==m.id||repeated.binding!==bound)throw new AppError('请求编号已用于其他批次。',409);return checkedReceipt(current,repeated,true);}
  const existing=all(current,'kingdee_supplier_catalog').filter(r=>r.accountId===c.accountId&&r.instanceId===c.instanceId&&r.clientId===c.clientId),byCode=new Map<string,Entity>();
  for(const old of existing){if(typeof old.code!=='string'||typeof old.name!=='string'||typeof old.sourceId!=='string')throw new AppError('已保存的供应商来源格式无效，请先核查。',409);const k=normalized(old.code);if(byCode.has(k)&&byCode.get(k)?.sourceId!==old.sourceId)throw new AppError('已保存的供应商编码对应多个来源，请先核查。',409);byCode.set(k,old);}
  const created:Entity[]=[],issues:Entity[]=[],issueRefs:Entity[]=[];let already=0,changed=0;const completedAt=now(),currentById=new Map(current.records.map(r=>[r.id,r]));
  for(const row of captured){
   const recordId=await idFor(c.accountId,row.id),old=currentById.get(recordId);
   const priorCode=byCode.get(normalized(row.code));
   if(old&&(old.kind!=='kingdee_supplier_catalog'||old.accountId!==c.accountId||old.instanceId!==c.instanceId||old.clientId!==c.clientId||old.sourceId!==row.id))throw new AppError('供应商来源标识冲突，本次未写入。',409);
   const prior=old&&(old.code!==row.code||old.name!==row.name||(old.groupName??null)!==row.groupName||(old.taxRate??null)!==row.taxRate)?old:!old&&priorCode&&priorCode.sourceId!==row.id?priorCode:undefined;
   if(prior){changed++;
    const previousGroupName=prior.groupName??null,previousTaxRate=prior.taxRate??null,reason=old?'来源字段已变化':'来源编码对应新的金蝶标识';
    const issueId=catalogPrefix+'issue_'+await sha(JSON.stringify([bound,row.id,row.code,row.name,row.groupName,row.taxRate,prior.id,prior.code,prior.name,previousGroupName,previousTaxRate,reason]));
    const oldIssue=currentById.get(issueId);
    if(oldIssue){if(oldIssue.kind!=='kingdee_supplier_catalog_issue'||oldIssue.accountId!==c.accountId||oldIssue.sourceId!==row.id||oldIssue.code!==row.code||oldIssue.name!==row.name||oldIssue.groupName!==row.groupName||oldIssue.taxRate!==row.taxRate||oldIssue.previousCode!==prior.code||oldIssue.previousName!==prior.name||oldIssue.previousGroupName!==previousGroupName||oldIssue.previousTaxRate!==previousTaxRate||oldIssue.reason!==reason)throw new AppError('供应商核查标识冲突，本次未写入。',409);issueRefs.push(oldIssue);}
    else{const issue={id:issueId,kind:'kingdee_supplier_catalog_issue',batchId:id,accountId:c.accountId,sourceId:row.id,code:row.code,name:row.name,groupName:row.groupName,taxRate:row.taxRate,previousCode:prior.code,previousName:prior.name,previousGroupName,previousTaxRate,reason,createdAt:completedAt};issues.push(issue);issueRefs.push(issue);}
    continue;
   }
   if(old){already++;continue;}
   created.push({id:recordId,kind:'kingdee_supplier_catalog',accountId:c.accountId,instanceId:c.instanceId,clientId:c.clientId,sourceId:row.id,code:row.code,name:row.name,groupName:row.groupName,taxRate:row.taxRate,firstSeen:completedAt,batchId:id});
  }
  if(current.records.some(r=>r.id===id))throw new AppError('批次标识冲突，本次未写入。',409);
  // Scheduled reads with no change do not add permanent receipts/audits every
  // interval. The scheduler separately records its last successful attempt.
  // A changed total or issue set is a new observable source fact and is saved.
  if(!req&&created.length===0&&issues.length===0){
   const latest=all(current,'kingdee_supplier_catalog_receipt').filter(r=>r.binding===bound).reverse().sort((a,b)=>b.completedAt.localeCompare(a.completedAt))[0];
   const oldIssueIds=Array.isArray(latest?.issueRefs)?latest.issueRefs.map((r:{id:string})=>r.id).sort():null,newIssueIds=issueRefs.map(r=>r.id).sort();
   if(latest&&latest.total===captured.length&&oldIssueIds&&JSON.stringify(oldIssueIds)===JSON.stringify(newIssueIds)){
    await checkedReceipt(current,latest);
    if(lease){const valid=await database().prepare("SELECT 1 AS valid FROM kingdee_supplier_catalog_lease WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+1000)").bind(lease.workerId,lease.fence).first<{valid:number}>();if(!valid)throw new AppError('供应商同步租约已失效，本次未写入。',409);}
    return {inserted:0,existing:already,changed,total:captured.length,completedAt};
   }
  }
  const receiptRecords=[];for(const item of [...created,...issues])receiptRecords.push({id:item.id,hash:await sha(JSON.stringify(item))});
  const receiptIssues=[];for(const item of issueRefs)receiptIssues.push({id:item.id,hash:await sha(JSON.stringify(item))});
  const receipt={id,kind:'kingdee_supplier_catalog_receipt',actorId:m.id,binding:bound,scope:window?'last-24-hours':'baseline',...(window?{windowStart:new Date(window.start).toISOString(),windowEnd:new Date(window.end).toISOString()}:{}),inserted:created.length,existing:already,changed,total:captured.length,completedAt,durationMs:Date.now()-startedAt,records:receiptRecords,issueRefs:receiptIssues};
  const auditEntry=audit(member,receipt,null,'读取金蝶供应商来源档案','金蝶只读 API',{inserted:created.length,existing:already,changed,total:captured.length,batchId:id});
  await append(current.revision,[...created,...issues,receipt,auditEntry],lease);
  const readback=await kingdeeSupplierCatalogState(),saved=readback.records.find(r=>r.id===id),byId=new Map(readback.records.map(r=>[r.id,r]));
  if(!saved||saved.kind!=='kingdee_supplier_catalog_receipt'||saved.binding!==bound||[...created,...issues].some(r=>{const v=byId.get(r.id);return !v||v.kind!==r.kind||v.batchId!==id||v.code!==r.code||v.name!==r.name;}))throw new AppError('批次已提交但回读未通过，请核查原批次，不要使用新编号重试。',409);
  return checkedReceipt(readback,saved,true);
 }finally{running.delete(bound);}
}
export async function kingdeeSupplierCatalogPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='kingdee-supplier-catalog-sync')return null;access(req,m);
 const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(await req.json());
 configuration();const lease=await manualLease();
 try{return json(await runCatalog(requestId,s,m,req.signal,req,lease));}
 finally{await releaseLease(lease);}
}
/** Native scheduler only. It has an explicit service identity and a fenced lease;
 * never exposed as an HTTP action or as a real employee. */
export async function runKingdeeSupplierCatalogWorker(input:{requestId:string;lease:Lease}):Promise<Result>{
 if((env as unknown as Record<string,unknown>).DOON_KINGDEE_SUPPLIER_SYNC_ENABLED!=='1')throw new AppError('金蝶供应商定时同步未启用。',503);
 const parsed=z.object({requestId:z.string().uuid(),lease:z.object({workerId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),fence:z.number().int().positive().safe()}).strict()}).strict().parse(input);
 const actor={id:'service_kingdee_supplier_catalog',name:'金蝶供应商定时同步',kind:'member'} as Member;
 return runCatalog(parsed.requestId,await kingdeeSupplierCatalogState(),actor,AbortSignal.timeout(120000),undefined,parsed.lease);
}
