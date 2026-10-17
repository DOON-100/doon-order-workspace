import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadBusinessPolicy} from './business-policy.mjs';
const day=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
 const date=new Date(value);return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value?value:'';
};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pick=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]??null]));
const orderFields=['id','version','orderNo','customer','quantity','unit','requestedDate','plannedDate','shipDate','promisedDate','promiseConfirmed','stage','lifecycle','sourceStatus','updatedAt'];
const purchaseFields=['id','version','sourceVersion','po','supplier','buyer','itemCode','itemName','unit','quantity','balanceKnown','received','returnPending','promisedDate','expectedDate','dueDate','nextFollowupDate','customerOrder','auditStatus','closeStatus','lifecycle','sourceAsOf','sourceHash','updatedAt'];
const projectFields=['id','version','customerId','code','title','dueDate','status','salesMemberId','serviceMemberId','serviceMemberIds','updatedAt'];
const taskFields=['id','version','projectId','customerId','title','department','ownerId','dueDate','status','updatedAt'];
const followupFields=['id','version','projectId','customerId','title','category','stars','status','followUpDate','ownerId','updatedAt'];
const serviceFields=['id','version','customerId','orderId','type','title','status','waitingFor','dueDate','nextFollowUp','updatedAt'];

export async function createBusinessFacts({records,memberId,manifest,asOf=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}){
 if(!day(asOf)||!manifest?.snapshotId||!manifest?.capturedAt)throw new Error('快照时间或清单无效');
 // Defensive clone: tools cannot mutate the input; no SQL handle survives loading.
 const state={revision:0,records:structuredClone(records)},policy=await loadBusinessPolicy();
 const member=state.records.find(row=>row.kind==='member'&&row.id===memberId);
 if(!member?.active||member.role==='supplier')throw new Error('快照读取成员不存在、已停用或为供应商');
 const byKind=kind=>state.records.filter(row=>row.kind===kind);
 const orders=byKind('order').filter(row=>policy.canRead(member,row));
 const purchases=policy.visiblePurchases(state,member);
 const projects=byKind('customer_project').filter(row=>!row.trashedAt&&policy.canReadProject(state,member,row));
 const projectIds=new Set(projects.map(row=>row.id));
 const tasks=state.records.filter(row=>['customer_project_task','customer_project_collaboration_task'].includes(row.kind)&&projectIds.has(row.projectId)&&policy.canReadProject(state,member,row));
 const followups=policy.getVisibleProjectFollowups(state,member);
 const service=byKind('service_record').filter(row=>policy.canReadServiceRecord(state,member,row));
 const evidence=row=>({recordId:row.id,kind:row.kind,version:row.version??null,sourceAsOf:row.sourceAsOf||null,sourceHash:row.sourceHash||null,snapshotId:manifest.snapshotId});
 const eligiblePurchase=p=>p.lifecycle!=='archived'&&p.closeStatus==='未关闭'&&p.auditStatus==='已审核';
 function purchase(p){
  const valid=typeof p.balanceKnown==='boolean'&&Number.isFinite(p.quantity)&&p.quantity>=0&&Number.isFinite(p.received)&&p.received>=0&&Number.isFinite(p.returnPending)&&p.returnPending>=0;
  const missing=valid?policy.remaining(p):null,eligible=eligiblePurchase(p);
  const supplierPromise=day(p.promisedDate),internalExpected=day(p.expectedDate),sourceDue=day(p.dueDate);
  const status=!eligible?'excluded':!valid?'invalid-quantity':missing===null?'receipt-unknown':p.returnPending>missing?'balance-conflict':missing===0?'no-outstanding':supplierPromise&&supplierPromise<asOf?'supplier-promise-overdue':internalExpected&&internalExpected<asOf?'internal-expectation-overdue':sourceDue&&sourceDue<asOf?'source-due-overdue':'open';
  return {...pick(p,purchaseFields),remaining:missing,status,eligible,sourceAgeDays:day(p.sourceAsOf?.slice(0,10))?Math.floor((Date.parse(asOf)-Date.parse(p.sourceAsOf.slice(0,10)))/86400000):null,requiresCurrentVerification:true,evidence:evidence(p)};
 }
 const purchaseDtos=purchases.map(purchase);
 const statuses=rows=>rows.reduce((a,row)=>(a[row.status||'unknown']=(a[row.status||'unknown']||0)+1,a),{});
 const datasets={purchases:purchaseDtos,orders:orders.map(row=>({...pick(row,orderFields),evidence:evidence(row)})),projects:projects.map(row=>({...pick(row,projectFields),tasks:tasks.filter(t=>t.projectId===row.id).map(t=>({...pick(t,taskFields),evidence:evidence(t)})),evidence:evidence(row)})),followups:followups.map(row=>({...pick(row,followupFields),evidence:evidence(row)})),service:service.map(row=>({...pick(row,serviceFields),evidence:evidence(row)}))};
 const coverage=()=>({mode:'real-snapshot',readOnly:true,asOf,capturedAt:manifest.capturedAt,snapshotId:manifest.snapshotId,sourceLabel:manifest.sourceLabel||'本机选定业务库的在线快照',actor:{id:member.id,role:member.role},counts:Object.fromEntries(Object.entries(datasets).map(([key,rows])=>[key,rows.length])),statusCounts:Object.fromEntries(Object.entries(datasets).map(([key,rows])=>[key,statuses(rows)])),purchaseStatusCounts:statuses(purchaseDtos),limitations:['这是历史只读快照，不保证当前仍欠交或失约；快照生成日不等于业务来源截至日。所有建议待核验。','未提供 BOM、订单需求及分配记录，不能判断整单齐料。不能把库存、已收和已分配作为相互独立数量重复相减。','没有 MES 实绩、消息通道、正式派单、审批或调度能力。','不读取附件内容、账号表、密码、会话或密钥。',...(orders.length?[]:['当前授权快照没有订单记录，无法核对生产计划或对客订单复期。'])]});
 function list(dataset,{id='',query='',offset=0,limit=20,onlyRisk=false}={}){
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('分页范围无效');
  if(!Object.hasOwn(datasets,dataset))throw new Error('数据集无效');
  let rows=datasets[dataset];
  if(id)rows=rows.filter(row=>row.id===id);
  if(query){const q=query.toLocaleLowerCase();rows=rows.filter(row=>JSON.stringify(row).toLocaleLowerCase().includes(q));}
  if(onlyRisk)rows=rows.filter(row=>{
   if(dataset==='purchases')return row.eligible&&row.status!=='no-outstanding';
   if(['done','cancelled','archived','completed'].includes(row.status)||row.lifecycle==='archived'||row.sourceStatus==='已取消')return false;
   const dates=dataset==='orders'?[row.requestedDate,row.plannedDate,row.shipDate,row.promisedDate]:dataset==='service'?[row.dueDate,row.nextFollowUp]:[row.dueDate,row.followUpDate];
   return dates.some(value=>day(value)&&value<asOf);
  });
  rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
  const items=rows.slice(offset,offset+limit),nextOffset=offset+items.length<rows.length?offset+items.length:null;
  return structuredClone({mode:'real-snapshot',snapshotId:manifest.snapshotId,asOf,filters:{id,query,onlyRisk},total:rows.length,offset,nextOffset,atEnd:nextOffset===null,complete:offset===0&&nextOffset===null,riskDefinition:onlyRisk?(dataset==='purchases'?'有效未齐采购行或收货未知/数量异常，仅为内部核查候选':'未完成记录中有已过日期的候选；不证明失约，未设日期的记录不在此筛选中'):null,items});
 }
 function draftPurchase(id){
  const row=purchaseDtos.find(row=>row.id===id);if(!row)throw new Error('采购行不存在或不在读取范围内');
  return {mode:'real-snapshot',sent:false,persisted:false,requiresReview:true,audience:'internal',evidence:row.evidence,text:`内部核查草稿：请采购负责人核对采购行 ${row.id}（${row.po}，${row.itemName}）的当前状态。快照来源截至 ${row.sourceAsOf||'未知'}；${row.remaining===null?'收货基数未知，暂不能确认欠交':`快照未交量 ${row.remaining} ${row.unit||'单位待核对'}`}；供应商复期 ${row.promisedDate||'未记录'}，内部预计 ${row.expectedDate||'未记录'}。请核实最新合格收货、有效承诺和归责依据，再决定是否对外催交。`,status:row.status};
 }
 return Object.freeze({coverage,list,draftPurchase,fingerprint:hash(datasets)});
}

export async function loadBusinessFacts({snapshotDir,memberId,asOf}){
 const directory=path.resolve(snapshotDir),manifest=JSON.parse(await fs.readFile(path.join(directory,'snapshot-manifest.json'),'utf8'));
 if(manifest.kind!=='doon-agent-readonly-snapshot-v1')throw new Error('拒绝未标识的业务数据库');
 const file=path.join(directory,'workspace.sqlite');
 if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==manifest.databaseSha256)throw new Error('快照指纹已变化，拒绝读取');
 const db=new DatabaseSync(file,{readOnly:true});let records;
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('快照完整性检查失败');
  const kinds=['member','order','purchase','customer_account','customer_quote_access','service_record','customer_project','customer_project_team','customer_project_task','customer_project_collaboration_task','customer_project_followup','customer_workflow_identity'];
  records=db.prepare(`SELECT data FROM records WHERE kind IN (${kinds.map(()=>'?').join(',')})`).all(...kinds).map(row=>JSON.parse(row.data));
 }finally{db.close();}
 return createBusinessFacts({records,memberId,manifest,asOf});
}
