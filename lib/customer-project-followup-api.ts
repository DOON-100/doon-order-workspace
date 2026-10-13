import {z} from 'zod';
import {all,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';
import {projectAccess} from './customer-projects';
import {followupAccess,followupMailAccess,followupCategories,followupStatuses} from './customer-project-followup';

const id=z.string().trim().min(1).max(160),text=(max=6000)=>z.string().max(max).default(''),token=z.string().uuid();
const day=text(10).refine(value=>{try{return !value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'日期须为有效 YYYY-MM-DD');
const ids=z.array(id).max(100).refine(a=>new Set(a).size===a.length,'编号重复').default([]);
const checklist=z.array(z.object({id,text:z.string().min(1).max(3000),checked:z.boolean()}).strict()).max(100).refine(a=>new Set(a.map(r=>r.id)).size===a.length,'检查项编号重复').default([]);
const original=z.unknown().refine(v=>v!==undefined&&JSON.stringify(v).length<=1024*1024,'原始记录不得超过 1 MiB');
const url=text(3000).refine(v=>{if(!v)return true;try{return ['http:','https:'].includes(new URL(v).protocol);}catch{return false;}},'链接仅支持 HTTP/HTTPS');
const fields={ownerId:id,customerId:text(160),projectId:text(160),title:z.string().trim().min(1).max(240),category:z.enum(followupCategories).default('other'),stars:z.number().int().min(0).max(3).default(0),status:z.enum(followupStatuses).default('pending'),followUpDate:day,notes:text(20000),nextAction:text(6000),checklist};
const saveSchema=z.object({token,id:id.optional(),version:z.number().int().positive().optional(),...fields}).strict();
const mailFields={subject:text(2000),from:text(3000),to:text(6000),sentAt:text(300),body:text(100000),summary:text(20000),draftStatus:z.enum(['draft','sent','received','unknown']).default('unknown'),sourceUrl:url,links:z.array(z.object({label:text(300),url}).strict()).max(100).default([])};
export const customerProjectFollowupSchemas={
 save:saveSchema,
 classify:z.object({token,id,version:z.number().int().positive(),followupIds:ids}).strict(),
 promote:z.object({token,id,version:z.number().int().positive(),customerId:id,title:z.string().trim().min(1).max(160),description:text(10000),code:text(120)}).strict(),
 import:z.object({token,format:z.literal('doon-customer-followup-v1'),sourceKey:id,ownerId:id,followups:z.array(z.object(fields).omit({ownerId:true}).extend({sourceId:id,source:original,sourceTitle:text(2000)}).strict()).max(1000).default([]),mails:z.array(z.object({sourceId:id,followupSourceIds:ids,...mailFields,source:original}).strict()).max(3000).default([]),sourceFiles:z.array(z.object({sourceId:id,filename:z.string().min(1).max(240),base64:z.string().max(28*1024*1024)}).strict()).max(20).default([])}).strict(),
};
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const result=schema.safeParse(value);if(!result.success)throw new AppError(result.error.issues.slice(0,4).map(e=>`${e.path.join('.')}: ${e.message}`).join('；'));return result.data;}
function meta(m:Member,before?:Entity){return {version:(before?.version||0)+1,createdAt:before?.createdAt||now(),createdBy:before?.createdBy||m.name,updatedAt:now(),updatedBy:m.name};}
function publicRecord(row:Entity){const {fileKey,...safe}=row;return safe;}
function record(s:State,kind:string,recordId:string){const row=all(s,kind).find(r=>r.id===recordId);if(!row)throw new AppError('记录不存在或无权限。',403);return row;}
function assertVersion(row:Entity,version:number|undefined){if(row.version!==version)throw new AppError('记录已更新，请刷新后重试。',409);}
function assertAccess(s:State,m:Member,row:Entity,write=false){if(!(row.kind==='customer_project_followup_mail'?followupMailAccess(s,m,row,write):followupAccess(s,m,row,write)))throw new AppError('没有当前跟进记录的权限。',403);}
function validateAssignment(s:State,m:Member,fields:any,before?:Entity){
 const owner=all(s,'member').find(r=>r.id===fields.ownerId&&r.active&&['admin','sales','clerk','pmc'].includes(r.role)) as Member|undefined;
 if(!owner)throw new AppError('跟进负责人不存在、已停用或不具备跟进权限。');
 if(m.role!=='admin'&&fields.ownerId!==(before?.ownerId||m.id))throw new AppError('只有管理员可转交跟进负责人。',403);
 if(fields.customerId){const actor=projectAccess(s,m,fields.customerId),assigned=projectAccess(s,owner,fields.customerId);if(!actor.write||!assigned.write)throw new AppError('客户须在操作人及跟进负责人的现有责任范围内。',403);}
 else if(fields.projectId)throw new AppError('关联项目须先指定客户。');
 if(fields.projectId&&!all(s,'customer_project').some(p=>p.id===fields.projectId&&p.customerId===fields.customerId))throw new AppError('项目不属于所选客户。');
 if(!fields.customerId&&m.role!=='admin'&&owner.id!==m.id)throw new AppError('仅跟进负责人或管理员可将记录退回待归属。',403);
}
async function replay(s:State,m:Member,action:string,input:any){
 const prior=all(s,'customer_project_followup_request').find(r=>r.id==='customer_project_followup_request_'+input.token);if(!prior)return null;
 if(prior.actorId!==m.id||prior.action!==action||prior.hash!==await sha(JSON.stringify(input)))throw new AppError('请求编号已用于其他内容。',409);
 for(const recordId of prior.resultIds||[]){const r=s.records.find(row=>row.id===recordId);if(!r)throw new AppError('原操作结果不存在。',409);if(['customer_project_followup','customer_project_followup_mail'].includes(r.kind))assertAccess(s,m,r);else if(r.kind==='customer_project_followup_source'&&m.role!=='admin'&&r.ownerId!==m.id)throw new AppError('无权读取原导入。',403);}
 if(prior.response?.item)assertAccess(s,m,prior.response.item);
 if(prior.response?.project&&!projectAccess(s,m,prior.response.project.customerId).read)throw new AppError('原操作所关联客户权限已变化。',403);
 return json({...prior.response,idempotent:true});
}
async function persist(s:State,m:Member,action:string,input:any,changes:{item:Entity;before?:Entity}[],response:any){
 const updates=changes.flatMap(({item,before})=>[item,audit(m,item,before||null,'客户跟进 · '+action,'客户跟进',publicRecord(item))]);
 updates.push({id:'customer_project_followup_request_'+input.token,kind:'customer_project_followup_request',actorId:m.id,action,hash:await sha(JSON.stringify(input)),resultIds:changes.map(c=>c.item.id),response,createdAt:now()});
 await commit(s.revision,updates);return json(response);
}
export async function customerProjectFollowupGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-project-followup-data','customer-project-followup-source-file','customer-project-followup-history'].includes(action))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 if(action==='customer-project-followup-source-file'){
  const row=record(s,'customer_project_followup_source',new URL(req.url).searchParams.get('id')||'');if(m.role!=='admin'&&row.ownerId!==m.id)throw new AppError('仅源工作台负责人及管理员可下载完整原始档案。',403);
  const object=await bucket().get(row.fileKey);if(!object)throw new AppError('原始档案暂不可用。',404);
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(action==='customer-project-followup-history'){
  const row=s.records.find(r=>r.id===new URL(req.url).searchParams.get('id')&&['customer_project_followup','customer_project_followup_mail'].includes(r.kind));if(!row)throw new AppError('记录不存在或无权限。',403);assertAccess(s,m,row);
  // Historical snapshots can contain earlier customer associations. Check those too.
  return json({history:all(s,'audit').filter(a=>a.targetId===row.id&&[a.before,a.after].filter(Boolean).every(r=>r.kind==='customer_project_followup_mail'?followupMailAccess(s,m,r):followupAccess(s,m,r))).map(a=>({...a,before:a.before?publicRecord(a.before):null,after:a.after?publicRecord(a.after):null})).reverse()});
 }
 const followups=all(s,'customer_project_followup').filter(r=>followupAccess(s,m,r)).map(r=>({...publicRecord(r),canWrite:followupAccess(s,m,r,true),canPromote:followupAccess(s,m,r,true)&&!r.projectId}));
 const customers=all(s,'customer_account').filter(c=>c.active&&projectAccess(s,m,c.id).read);
 const members=all(s,'member').filter(r=>r.active&&['admin','sales','clerk','pmc'].includes(r.role));
 const salesIds=new Set(all(s,'customer_account').filter(c=>c.active).flatMap(c=>c.salesMemberIds||[]));
 const people=members.filter(r=>r.role==='sales'||r.role==='admin'&&r.owner).sort((a,b)=>Number(!!b.owner)-Number(!!a.owner)||Number(salesIds.has(b.id))-Number(salesIds.has(a.id))).map(r=>({id:r.id,name:r.name}));
 return json({followups,mails:all(s,'customer_project_followup_mail').filter(r=>followupMailAccess(s,m,r)).map(r=>({...publicRecord(r),canClassify:followupMailAccess(s,m,r,true)})),sourceBundles:all(s,'customer_project_followup_source').filter(r=>m.role==='admin'||r.ownerId===m.id).map(publicRecord),customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode})),projects:all(s,'customer_project').filter(p=>customers.some(c=>c.id===p.customerId)).map(p=>({id:p.id,customerId:p.customerId,title:p.title,code:p.code})),people,members:members.map(r=>({id:r.id,name:r.name,role:r.role})),canImport:m.role==='admin'});
}
export async function customerProjectFollowupPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const names:Record<string,keyof typeof customerProjectFollowupSchemas>={'customer-project-followup-save':'save','customer-project-followup-mail-classify':'classify','customer-project-followup-promote':'promote','customer-project-followup-import':'import'};
 const name=names[action];if(!name)return null;if(!m.active||!['admin','sales','clerk','pmc'].includes(m.role))throw new AppError('没有客户跟进操作权限。',403);
 if(name==='import'&&m.role!=='admin')throw new AppError('只有管理员可迁入历史工作台。',403);
 const raw=await req.text();if(raw.length>80*1024*1024)throw new AppError('导入内容超过大小上限。');let body;try{body=JSON.parse(raw);}catch{throw new AppError('请求 JSON 无效。');}
 const input:any=parse(customerProjectFollowupSchemas[name],body);
 if(name==='import')return importWorkspace(s,m,action,input);
 if(name==='save'){
  const before=input.id?record(s,'customer_project_followup',input.id):undefined;if(before)assertAccess(s,m,before,true);
  if(before?.promotedProjectId&&input.projectId!==before.promotedProjectId)throw new AppError('已建立完整项目的跟进须保留该项目关联。',409);
  validateAssignment(s,m,input,before);const prior=await replay(s,m,action,input);if(prior)return prior;
  if(before)assertVersion(before,input.version);else if(input.version)throw new AppError('新记录不能带版本。');
  const {token:_,id:__,version:___,...editable}=input,item={...before,...editable,id:before?.id||newId('customer_project_followup'),kind:'customer_project_followup',...(!before?{sourceKey:'',sourceId:'',source:{},sourceTitle:''}:{}),...meta(m,before)};
  return persist(s,m,action,input,[{item,before}],{ok:true,item:publicRecord(item)});
 }
 const kind=name==='classify'?'customer_project_followup_mail':'customer_project_followup',before=record(s,kind,input.id);assertAccess(s,m,before,true);
 if(name==='classify'){
  for(const followupId of input.followupIds){const row=record(s,'customer_project_followup',followupId);assertAccess(s,m,row,true);if(row.ownerId!==before.ownerId)throw new AppError('邮件只能归入原工作台负责人的跟进记录。');}
  const prior=await replay(s,m,action,input);if(prior)return prior;assertVersion(before,input.version);
  const item={...before,followupIds:input.followupIds,...meta(m,before)};return persist(s,m,action,input,[{item,before}],{ok:true,item:publicRecord(item)});
 }
 validateAssignment(s,m,{...before,customerId:input.customerId,projectId:''},before);const prior=await replay(s,m,action,input);if(prior)return prior;
 assertVersion(before,input.version);if(before.projectId)throw new AppError('该跟进已关联项目，请打开现有项目。',409);
 const customer=record(s,'customer_account',input.customerId),serviceIds=(customer.serviceMemberIds||[]).filter((id:string)=>all(s,'member').some(r=>r.id===id&&projectAccess(s,r as Member,customer.id).write));
 const team=all(s,'customer_project_team').find(t=>t.active&&t.customerIds.includes(customer.id)&&(t.salesMemberIds.includes(before.ownerId)||t.leaderIds.includes(before.ownerId)));
 const project={id:newId('customer_project'),kind:'customer_project',customerId:input.customerId,code:input.code,title:input.title,description:input.description||before.notes.slice(0,10000),teamId:team?.id||'',salesMemberId:before.ownerId,serviceMemberId:serviceIds[0]||'',serviceMemberIds:serviceIds,serviceReviewerId:'',salesReviewerId:'',dueDate:'',status:'active',followupId:before.id,...meta(m)};
 const item={...before,customerId:input.customerId,projectId:project.id,promotedProjectId:project.id,...meta(m,before)};
 return persist(s,m,action,input,[{item,before},{item:project}],{ok:true,item:publicRecord(item),project});
}

async function importWorkspace(s:State,m:Member,action:string,input:any){
 const owner=all(s,'member').find(r=>r.id===input.ownerId&&r.active&&['admin','sales','clerk','pmc'].includes(r.role));if(!owner)throw new AppError('源工作台负责人无效。');
 const prior=await replay(s,m,action,input);if(prior)return prior;
 const changes:{item:Entity;before?:Entity}[]=[],files:{key:string;bytes:Uint8Array}[]=[],created={followups:0,mails:0,sourceFiles:0},skipped={followups:0,mails:0,sourceFiles:0};
 const mapped=new Map<string,Entity>();
 const existing=(kind:string,sourceId:string)=>all(s,kind).find(r=>r.ownerId===input.ownerId&&r.sourceKey===input.sourceKey&&r.sourceId===sourceId);
 const base=(kind:string,sourceId:string)=>({id:newId(kind),kind,ownerId:input.ownerId,sourceKey:input.sourceKey,sourceId,...meta(m)});
 const unique=(rows:any[])=>{if(new Set(rows.map(r=>r.sourceId)).size!==rows.length)throw new AppError('同类原始记录 sourceId 不能重复。');};[input.followups,input.mails,input.sourceFiles].forEach(unique);
 for(const row of input.followups){
  validateAssignment(s,m,{...row,ownerId:input.ownerId});const found=existing('customer_project_followup',row.sourceId),sourceHash=await sha(JSON.stringify(row.source));
  if(found){if(found.sourceHash!==sourceHash)throw new AppError('原始跟进内容已变化，请建立新来源版本。',409);mapped.set(row.sourceId,found);skipped.followups++;continue;}
  const item={...row,...base('customer_project_followup',row.sourceId),sourceHash};mapped.set(row.sourceId,item);changes.push({item});created.followups++;
 }
 const mailResults:Entity[]=[],fileResults:Entity[]=[];
 for(const row of input.mails){
  const found=existing('customer_project_followup_mail',row.sourceId),sourceHash=await sha(JSON.stringify(row.source));if(found){if(found.sourceHash!==sourceHash)throw new AppError('原始邮件内容已变化，请建立新来源版本。',409);mailResults.push(found);skipped.mails++;continue;}
  const followupIds=row.followupSourceIds.map((sourceId:string)=>{const f=mapped.get(sourceId)||existing('customer_project_followup',sourceId);if(!f)throw new AppError('邮件关联的源跟进记录不存在。');return f.id;});
  const {followupSourceIds:_,...mail}=row,item={...mail,...base('customer_project_followup_mail',row.sourceId),followupIds,sourceHash};changes.push({item});mailResults.push(item);created.mails++;
 }
 let total=0;
 for(const row of input.sourceFiles){
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.base64))throw new AppError('原始文件 Base64 无效。');
  const decoded=atob(row.base64),bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));total+=bytes.length;if(!bytes.length||bytes.length>20*1024*1024||total>50*1024*1024)throw new AppError('原始文件限每件 20 MiB，合计 50 MiB，且不能为空。');
  const hash=await sha(bytes.buffer),found=existing('customer_project_followup_source',row.sourceId);if(found){if(found.hash!==hash)throw new AppError('原始文件已变化，请建立新来源版本。',409);fileResults.push(found);skipped.sourceFiles++;continue;}
  const filename=row.filename.replace(/[\\/\u0000-\u001f\u007f]/g,'_'),fileKey=newId('customer_project_followup_source_file'),item={...base('customer_project_followup_source',row.sourceId),filename,contentType:'application/octet-stream',size:bytes.length,hash,fileKey};files.push({key:fileKey,bytes});changes.push({item});fileResults.push(item);created.sourceFiles++;
 }
 // Immutable objects are written only after the entire payload has passed validation.
 for(const file of files)await bucket().put(file.key,file.bytes);
 const response={ok:true,created,skipped,followups:[...mapped.values()].map(r=>({id:r.id,sourceId:r.sourceId})),mails:mailResults.map(r=>({id:r.id,sourceId:r.sourceId})),sourceBundles:fileResults.map(r=>({id:r.id,sourceId:r.sourceId,filename:r.filename}))};
 return persist(s,m,action,input,changes,response);
}
