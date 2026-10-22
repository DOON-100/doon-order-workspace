import {z} from 'zod';
import {all,newId,now,personnelTypeOf,type Entity,type Member,type State} from './domain';
import {AppError,actor,audit,bucket,commit,json,snapshot} from './store';
import {sha} from './workbooks';
import {businessTeamHeader,filterBusinessTeamRows} from './business-team-scope';
import {requestedExportBusinessTeam} from './business-team-export';
import {kingdeeSalesConfig,kingdeeSalesWriteEnabled,kingdeeSalesRequest,object,sourceId,sourceText} from './kingdee-client';
import {kingdeeSalesInputSchema,salesPermissions,salesCustomer,sourceInputs,validateSalesInputs} from './kingdee-sales-core';
import {inspectSalesTemplate,salesTemplateWorkbook} from './kingdee-sales-template';
import {assertNoRemoteSalesOrder,salesRemotePayload,verifySalesReadback} from './kingdee-sales-remote';
import {KINGDEE_SALES_RULE,KINGDEE_SALES_CATEGORIES,type KingdeeSalesDraft,type KingdeeSalesPublicDraft,type KingdeeSalesData} from './kingdee-sales-types';
import type {SalesOrderSourceRecord} from './sales-order-sources';
import {kingdeeSalesSourceImportTemplate,parseKingdeeSalesSourceWorkbook} from './kingdee-sales-source-import';

const id=z.string().trim().min(1).max(160),version=z.number().int().positive(),change=z.object({id,version}).strict();
const uploadStatuses=new Set(['uploading','unknown','uploaded']);
const canonicalBill=(value:string)=>value.trim().toLowerCase();
const routes=['kingdee-sales-data','kingdee-sales-export','kingdee-sales-source-template','kingdee-sales-source-file'];
const postRoutes=['kingdee-sales-prepare','kingdee-sales-save','kingdee-sales-validate','kingdee-sales-confirm','kingdee-sales-upload','kingdee-sales-reconcile','kingdee-sales-source-preview','kingdee-sales-source-commit'];
type Attempt=Entity&{kind:'kingdee_sales_attempt';draftId:string;draftVersion:number;binding:string;payload:Record<string,unknown>;status:'uploading'|'unknown'|'uploaded';message:string;actorId:string;actor:string;createdAt:string;remoteId?:string;remoteNumber?:string};
/** This is a concrete protocol gap, not a write-permission override. No API can
 * report success while silently discarding the required template business type. */
export function salesApiReadinessIssues(){return ['金蝶销售订单 API 尚无已核定的“现销／赊销”模板字段映射；需核定映射及回读规则后才能启用直接上传。当前可生成、客服确认并导出标准模板。'];}
function connection():KingdeeSalesData['connection']{
 const configured=!!kingdeeSalesConfig(),writeEnabled=kingdeeSalesWriteEnabled(),readinessIssues=salesApiReadinessIssues();
 const status=!configured?'尚未配置金蝶连接。':!writeEnabled?'金蝶销售订单直接写入尚未开启。':'金蝶销售订单连接已配置。';
 return {configured,writeEnabled,readinessIssues,message:status+(readinessIssues.length?readinessIssues.join('；'):'')};
}
function sources(s:State){return all(s,'sales_order_source') as SalesOrderSourceRecord[];}
function drafts(s:State){return all(s,'kingdee_sales_draft') as KingdeeSalesDraft[];}
function inTeam(s:State,m:Member,req:Request,customer:string){const team=requestedExportBusinessTeam(s,m,req);return !team||filterBusinessTeamRows(s,[{customer}],team).length>0;}
function readableSource(s:State,m:Member,req:Request,sourceId:string,write=false){
 const source=sources(s).find(v=>v.id===sourceId),rights=source&&salesPermissions(s,m,source.customer);
 if(!source||!rights?.read||write&&!rights.prepare||!inTeam(s,m,req,source.customer))throw new AppError('销售原单不存在或不在当前客户／工作组授权范围。',403);return source;
}
function getDraft(s:State,m:Member,req:Request,draftId:string,write=false){const draft=drafts(s).find(v=>v.id===draftId);if(!draft)throw new AppError('金蝶销售订单草稿不存在。',404);readableSource(s,m,req,draft.sourceId,write);return draft;}
function publicDraft(s:State,m:Member,draft:KingdeeSalesDraft):KingdeeSalesPublicDraft{
 const rights=salesPermissions(s,m,draft.customer),attempt=all(s,'kingdee_sales_attempt').find(v=>v.id===draft.attemptId) as Attempt|undefined;
 return {...draft,canPrepare:rights.prepare&&!uploadStatuses.has(draft.status),canConfirm:rights.confirm&&!uploadStatuses.has(draft.status),canUpload:rights.confirm&&draft.status==='confirmed'&&!!kingdeeSalesConfig()&&kingdeeSalesWriteEnabled()&&!salesApiReadinessIssues().length,...(attempt?{attempt:{id:attempt.id,status:attempt.status,message:attempt.message,createdAt:attempt.createdAt,remoteId:attempt.remoteId,remoteNumber:attempt.remoteNumber}}:{})};
}
function response(s:State,m:Member,item:KingdeeSalesDraft,extra:Record<string,unknown>={}){return json({ok:true,item:publicDraft(s,m,item),...extra});}
async function input<T>(req:Request,schema:z.ZodType<T>){const raw=await req.text();if(new TextEncoder().encode(raw).length>2*1024*1024)throw new AppError('请求超过 2 MiB 上限。');let value:unknown;try{value=JSON.parse(raw);}catch{throw new AppError('请提交有效 JSON。');}const parsed=schema.safeParse(value);if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(v=>v.path.join('.')+'：'+v.message).join('；'));return parsed.data;}
async function latestTemplate(s:State){
 const record=all(s,'collaboration_template').filter(v=>v.templateType==='kingdee').at(-1);if(!record)return null;
 const file=await bucket().get(record.fileKey);if(!file)throw new AppError('金蝶订单模板文件缺失，请管理员重新上传。');
 const bytes=await new Response(file.body).arrayBuffer(),inspected=inspectSalesTemplate(bytes);return {record,bytes,hash:await sha(bytes),headers:inspected.headers};
}
async function optionalTemplate(s:State){try{return {template:await latestTemplate(s),error:''};}catch(error){return {template:null,error:error instanceof AppError?error.message:'金蝶模板无法读取。'};}}
async function boundSource(s:State,draft:KingdeeSalesDraft){const source=sources(s).find(v=>v.id===draft.sourceId);if(!source||source.version!==1||source.customer!==draft.customer||source.orderNo!==draft.orderNo||source.source.customer!==source.customer||source.source.orderNo!==source.orderNo||source.contentFingerprint!==draft.sourceHash||await sha(JSON.stringify(source.source))!==draft.sourceHash)throw new AppError('销售原单内容或版本已变化，请重新生成并核对草稿。',409);return source;}
async function binding(draft:KingdeeSalesDraft){const config=kingdeeSalesConfig();return sha(JSON.stringify([draft.id,draft.version,draft.sourceId,draft.sourceHash,draft.templateId,draft.templateHash,draft.ruleVersion,draft.orderNo,draft.customer,draft.inputs,config?[config.clientId,config.instanceId,config.accountId]:null]));}
async function checked(s:State,draft:KingdeeSalesDraft){
 const source=await boundSource(s,draft),validation=validateSalesInputs(source,draft.inputs),current=await optionalTemplate(s);
 const account=salesCustomer(s,source.customer);
 if(!account?.active||!account.customerCode)validation.issues.push({field:'customerNumber',message:'原单客户尚未唯一关联启用客户档案及客户编码，请管理员核定客户身份。'});
 else if(draft.inputs.customerNumber!==account.customerCode)validation.issues.push({field:'customerNumber',message:'金蝶客户编码必须等于原单客户档案的已核定编码，不能改为其他客户。'});
 if(draft.inputs.taxMode==='inclusive')validation.issues.push({field:'taxMode',message:'当前金蝶 15 列模板仅有不含税单价 price 字段；请核对并填写不含税单价及税率后再确认，系统不会猜测含税价转换精度。'});
 if(!current.template)validation.issues.push({field:'template',message:current.error||'请管理员上传金蝶销售订单原始模板。'});
 else if(current.template.record.id!==draft.templateId||current.template.hash!==draft.templateHash)validation.issues.push({field:'template',message:'金蝶模板版本已变化，请保存草稿绑定最新模板后重新核对。'});
 if(draft.ruleVersion!==KINGDEE_SALES_RULE)validation.issues.push({field:'ruleVersion',message:'成品编码规则已变化，请重新生成并核对。'});
 validation.valid=validation.issues.length===0;return validation;
}
async function makeDraft(s:State,m:Member,source:SalesOrderSourceRecord){
 const current=await optionalTemplate(s),timestamp=now(),inputs=sourceInputs(s,source),item:KingdeeSalesDraft={id:'kingdee_sales_draft_'+await sha(source.id),kind:'kingdee_sales_draft',version:1,sourceId:source.id,sourceHash:source.contentFingerprint,templateId:current.template?.record.id||'',templateHash:current.template?.hash||'',ruleVersion:KINGDEE_SALES_RULE,customer:source.customer,orderNo:source.orderNo,inputs,status:'draft',validation:validateSalesInputs(source,inputs),createdAt:timestamp,updatedAt:timestamp,createdById:m.id,updatedById:m.id};
 item.validation=await checked(s,item);return item;
}
function safeFilename(value:string){return value.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_').slice(0,160);}
function download(bytes:ArrayBuffer,filename:string){return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':businessTeamHeader}});}
export async function kingdeeSalesGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!routes.includes(action))return null;
 if(!m.active||personnelTypeOf(m)!=='internal'||!['admin','sales','clerk','pmc','finance'].includes(m.role))throw new AppError('无权读取金蝶销售订单。',403);
 if(action==='kingdee-sales-source-template')return download(kingdeeSalesSourceImportTemplate(),'中英销售订单上传模板.xlsx');
 if(action==='kingdee-sales-source-file'){
  const sourceId=new URL(req.url).searchParams.get('id')||'';readableSource(s,m,req,sourceId);
  const attachment=all(s,'kingdee_sales_source_file').find(v=>v.sourceId===sourceId);if(!attachment)throw new AppError('此原单没有通过本入口上传的原始附件。',404);const file=await bucket().get(attachment.fileKey);if(!file)throw new AppError('原单附件缺失，请联系管理员。',404);return download(await new Response(file.body).arrayBuffer(),safeFilename(attachment.filename));
 }
 if(action==='kingdee-sales-export'){
  const params=new URL(req.url).searchParams,draft=getDraft(s,m,req,params.get('id')||''),expected=Number(params.get('version'));
  if(draft.version!==expected)throw new AppError('草稿版本已更新，请刷新后导出。',409);const validation=await checked(s,draft);if(!validation.valid)throw new AppError('全单校验尚未通过：'+validation.issues.slice(0,5).map(v=>v.message).join('；'));
  if(draft.status!=='confirmed'&&draft.status!=='uploaded')throw new AppError('请由负责客服确认整张订单后再导出金蝶模板。',409);
  const confirmer=all(s,'member').find(v=>v.id===draft.confirmation?.actorId) as Member|undefined;
  if(!draft.confirmation||draft.confirmation.expiresAt<now()||draft.confirmation.binding!==await binding(draft)||!confirmer||!salesPermissions(s,confirmer,draft.customer).confirm)throw new AppError('客服确认已失效或确认人权限已变化，请重新确认。',409);
  const template=await latestTemplate(s);return download(salesTemplateWorkbook(template!.bytes,draft),`金蝶销售订单_${safeFilename(draft.orderNo)}_V${draft.version}.xlsx`);
 }
 const permitted=sources(s).filter(v=>salesPermissions(s,m,v.customer).read&&inTeam(s,m,req,v.customer)),ids=new Set(permitted.map(v=>v.id)),current=await optionalTemplate(s);
 const result:KingdeeSalesData={sources:permitted,drafts:drafts(s).filter(v=>ids.has(v.sourceId)).map(v=>publicDraft(s,m,v)),template:current.template?{id:current.template.record.id,filename:current.template.record.filename,headers:current.template.headers}:null,connection:connection(),ruleVersion:KINGDEE_SALES_RULE,categories:KINGDEE_SALES_CATEGORIES};
 if(current.error)result.connection.readinessIssues.unshift(current.error);const out=json(result);out.headers.set('Vary',businessTeamHeader);return out;
}
async function preserveOutcome(attemptId:string,status:Attempt['status'],message:string,remote?:{id:string;number:string;lineIds?:string[]}){
 for(let retry=0;retry<5;retry++){
  const s=await snapshot(),attempt=all(s,'kingdee_sales_attempt').find(v=>v.id===attemptId) as Attempt|undefined,draft=attempt&&drafts(s).find(v=>v.id===attempt.draftId);if(!attempt||!draft)throw new AppError('上传记录缺失，请联系管理员核查，不能重复提交。',409);
  if(attempt.status==='uploaded')return {s,draft};
  const next={...draft,status,updatedAt:now(),...(remote?{remoteId:remote.id,remoteNumber:remote.number}:{})},event={...attempt,status,message,...(remote?{remoteId:remote.id,remoteNumber:remote.number,...(remote.lineIds?{remoteLineIds:remote.lineIds}:{})}:{})};
  try{await commit(s.revision,[next,event]);return {s:{...s,records:[...s.records.filter(v=>v.id!==next.id&&v.id!==event.id),next,event]},draft:next};}catch(error){if(!(error instanceof AppError)||error.status!==409||retry===4)throw error;}
 }
 throw new AppError('上传结果留痕未完成，请核查原操作，不能重复提交。',409);
}
export async function kingdeeSalesPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!postRoutes.includes(action))return null;
 if(!m.active||personnelTypeOf(m)!=='internal')throw new AppError('仅在职内部成员可维护金蝶销售订单。',403);
 if(action==='kingdee-sales-source-preview'){
  if(!m.active||!['admin','sales','clerk','pmc'].includes(m.role))throw new AppError('仅负责业务／客服可上传销售原单。',403);
  const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>8*1024*1024||!/\.xlsx$/i.test(file.name))throw new AppError('请上传不超过 8 MiB 的中英订单 XLSX。');
  const bytes=await file.arrayBuffer();let parsed:Awaited<ReturnType<typeof parseKingdeeSalesSourceWorkbook>>;try{parsed=await parseKingdeeSalesSourceWorkbook(new Uint8Array(bytes),file.name);}catch(error){throw new AppError(error instanceof Error?error.message:'无法读取中英销售原单。');}
  if(!salesPermissions(s,m,parsed.source.customer).prepare||!inTeam(s,m,req,parsed.source.customer))throw new AppError('原单客户不在当前授权范围。',403);
  const hash=await sha(bytes),preview={id:newId('kingdee_sales_source_preview'),kind:'kingdee_sales_source_preview',actorId:m.id,source:parsed.source,warnings:parsed.warnings,unmappedColumns:parsed.unmappedColumns,sourceHash:hash,fileKey:newId('kingdee_sales_source_file'),filename:safeFilename(file.name),createdAt:now()};
  await bucket().put(preview.fileKey,bytes);await commit(s.revision,[preview]);return json({preview:{id:preview.id,source:preview.source,warnings:preview.warnings,unmappedColumns:preview.unmappedColumns}});
 }
 if(action==='kingdee-sales-source-commit'){
  const p=await input(req,z.object({id,acknowledged:z.literal(true)}).strict()),preview=all(s,'kingdee_sales_source_preview').find(v=>v.id===p.id);if(!preview||preview.actorId!==m.id)throw new AppError('上传预览不存在或不属于当前成员。',403);
  if(!salesPermissions(s,m,preview.source.customer).prepare||!inTeam(s,m,req,preview.source.customer))throw new AppError('原单客户已不在当前授权范围。',403);
  if(preview.sourceId){const existing=getDraft(s,m,req,preview.draftId);return response(s,m,existing,{sourceId:preview.sourceId,idempotent:true});}
  const customerAccount=salesCustomer(s,preview.source.customer),contentFingerprint=await sha(JSON.stringify(preview.source));if(sources(s).some(v=>(v.customer.trim().toLowerCase()===preview.source.customer.trim().toLowerCase()||!!customerAccount&&salesCustomer(s,v.customer)?.id===customerAccount.id)&&canonicalBill(v.orderNo)===canonicalBill(preview.source.orderNo)))throw new AppError('此客户订单已存在，请使用已有原单；本入口不会覆盖资料或重复建单。',409);
  const original=await bucket().get(preview.fileKey);if(!original||await sha(await new Response(original.body).arrayBuffer())!==preview.sourceHash)throw new AppError('原始附件校验失败，请重新上传。',409);
  const source:SalesOrderSourceRecord={id:newId('sales_order_source'),kind:'sales_order_source',version:1,status:'待核对',customer:preview.source.customer,orderNo:preview.source.orderNo,source:preview.source,contentFingerprint,createdAt:now(),createdById:m.id},nextState={...s,records:[...s.records,source]},draft=await makeDraft(nextState,m,source),file={id:newId('kingdee_sales_source_file'),kind:'kingdee_sales_source_file',sourceId:source.id,filename:preview.filename,fileKey:preview.fileKey,hash:preview.sourceHash,actorId:m.id,createdAt:now()};
  await commit(s.revision,[source,draft,file,{...preview,sourceId:source.id,draftId:draft.id},audit(m,draft,null,'上传中英原单并生成金蝶销售草稿')]);return response(nextState,m,draft,{sourceId:source.id});
 }
 if(action==='kingdee-sales-prepare'){
  const p=await input(req,z.object({sourceId:id}).strict()),source=readableSource(s,m,req,p.sourceId,true),prior=drafts(s).find(v=>v.sourceId===source.id);if(prior)return response(s,m,prior,{idempotent:true});
  const item=await makeDraft(s,m,source);await commit(s.revision,[item,audit(m,item,null,'生成金蝶销售订单草稿')]);return response(s,m,item);
 }
 const p=action==='kingdee-sales-save'?await input(req,change.extend({inputs:kingdeeSalesInputSchema}).strict()):action==='kingdee-sales-confirm'?await input(req,change.extend({acknowledged:z.literal(true)}).strict()):await input(req,change);
 const draft=getDraft(s,m,req,p.id,true),source=await boundSource(s,draft),rights=salesPermissions(s,m,draft.customer);
 if(action==='kingdee-sales-upload'||action==='kingdee-sales-reconcile'){
  if(!rights.confirm)throw new AppError('仅负责客服或管理员可上传或核查此订单。',403);
  if(draft.attemptId){
   const attempt=all(s,'kingdee_sales_attempt').find(v=>v.id===draft.attemptId) as Attempt|undefined;if(!attempt)throw new AppError('上传留痕缺失，须管理员核查。',409);
   if(action==='kingdee-sales-upload')return response(s,m,draft,{idempotent:true,message:'已有上传操作，不能重复提交；结果不明时请核查原单。'});
   if(attempt.status==='uploaded')return response(s,m,draft,{idempotent:true});
   const config=kingdeeSalesConfig();if(!config)throw new AppError('金蝶连接未配置，无法核查原操作。',503);
   if(attempt.binding!==await binding(draft))throw new AppError('账套配置、草稿或原确认绑定已变化，禁止在不同目标查询原操作；请管理员核查原账套。',409);
   try{const detail=await kingdeeSalesRequest(config,'salesDetail',attempt.remoteId?{id:attempt.remoteId}:{number:draft.orderNo},AbortSignal.timeout(45000)),verified=verifySalesReadback(detail,attempt.payload),result=await preserveOutcome(attempt.id,'uploaded','金蝶订单回读已逐项核对。',verified);return response(result.s,m,result.draft);}catch{const result=await preserveOutcome(attempt.id,'unknown','原操作尚未核实；未查到或字段不一致不能证明未写入，请在金蝶人工核查。');return response(result.s,m,result.draft);}
  }
  if(action==='kingdee-sales-reconcile')throw new AppError('此订单没有待核查的上传记录。');
 }
 if(draft.version!==p.version)throw new AppError('草稿版本已变化，请刷新并重新核对。',409);
 if(uploadStatuses.has(draft.status))throw new AppError('该订单已有上传操作，禁止修改或重复确认。',409);
 if(action==='kingdee-sales-save'){
  if(!('inputs' in p))throw new AppError('草稿字段缺失。');
  const values=kingdeeSalesInputSchema.parse(p.inputs),validation=validateSalesInputs(source,values);
  if(values.lines.length!==source.source.lines.length||new Set(values.lines.map(v=>v.sourceLineId)).size!==values.lines.length||values.lines.some(v=>!source.source.lines.some(x=>x.id===v.sourceLineId)))throw new AppError('草稿必须逐行保留原单的全部来源标识。');
  const template=await optionalTemplate(s),next:KingdeeSalesDraft={...draft,version:draft.version+1,inputs:values,ruleVersion:KINGDEE_SALES_RULE,templateId:template.template?.record.id||'',templateHash:template.template?.hash||'',status:'draft',validation,confirmation:undefined,updatedAt:now(),updatedById:m.id};next.validation=await checked(s,next);
  await commit(s.revision,[next,audit(m,next,draft,'保存金蝶销售订单草稿')]);return response(s,m,next);
 }
 if(action==='kingdee-sales-validate'){
  const validation=await checked(s,draft),next:KingdeeSalesDraft={...draft,version:draft.version+1,status:validation.valid?'validated':'draft',validation,confirmation:undefined,updatedAt:now(),updatedById:m.id};
  if(validation.valid&&kingdeeSalesConfig())try{await salesRemotePayload(kingdeeSalesConfig()!,next,AbortSignal.timeout(90000));next.validation.remoteVerified=true;}catch(error){next.validation.warnings.push(error instanceof AppError?error.message:'金蝶基础资料未核实。');}
  await commit(s.revision,[next,audit(m,next,draft,'校验金蝶销售订单全单')]);return response(s,m,next);
 }
 if(action==='kingdee-sales-confirm'){
  if(!rights.confirm)throw new AppError('须由明确负责此客户的客服或管理员确认，业务员不能代确认。',403);
  if(draft.status!=='validated')throw new AppError('请先保存并完成全单校验，再由客服确认。',409);
  const validation=await checked(s,draft);if(!validation.valid)throw new AppError('全单校验未通过：'+validation.issues.slice(0,5).map(v=>v.message).join('；'));
  const next:KingdeeSalesDraft={...draft,version:draft.version+1,status:'confirmed',validation,updatedAt:now(),updatedById:m.id};next.confirmation={actorId:m.id,actor:m.name,at:now(),expiresAt:new Date(Date.now()+24*60*60*1000).toISOString(),binding:await binding(next)};
  await commit(s.revision,[next,audit(m,next,draft,'客服确认金蝶销售订单')]);return response(s,m,next);
 }
 if(action==='kingdee-sales-upload'){
  const config=kingdeeSalesConfig();if(!config||!kingdeeSalesWriteEnabled())throw new AppError('金蝶销售订单直接写入尚未启用，请管理员核定独立销售写入配置。',503);
  const blockers=salesApiReadinessIssues();if(blockers.length)throw new AppError(blockers.join('；'),409);
  if(draft.status!=='confirmed'||!draft.confirmation||draft.confirmation.expiresAt<now()||draft.confirmation.binding!==await binding(draft))throw new AppError('客服确认不存在、过期或内容已变化，请重新核对确认。',409);
  const confirmer=all(s,'member').find(v=>v.id===draft.confirmation!.actorId) as Member|undefined;if(!confirmer||!salesPermissions(s,confirmer,draft.customer).confirm)throw new AppError('原确认人的客户权限已变化，请重新核对确认。',403);
  const validation=await checked(s,draft);if(!validation.valid)throw new AppError('来源、模板或全单校验已变化，请重新核对。',409);
  const payload=await salesRemotePayload(config,draft,AbortSignal.timeout(90000));
  await assertNoRemoteSalesOrder(config,draft.orderNo,AbortSignal.timeout(60000));
  // Refresh identity, scope, snapshot and approval after remote reads, then reserve
  // one durable attempt atomically BEFORE the first possible remote mutation.
  const fresh=await snapshot(),member=await actor(fresh),current=getDraft(fresh,member,req,draft.id,true);if(member.id!==m.id||current.version!==draft.version||current.attemptId||!salesPermissions(fresh,member,current.customer).confirm||await binding(current)!==draft.confirmation.binding)throw new AppError('订单或权限已变化，本次未上传，请刷新核对。',409);await boundSource(fresh,current);
  const currentConfirmer=all(fresh,'member').find(v=>v.id===current.confirmation?.actorId) as Member|undefined;
  if(!current.confirmation||current.confirmation.expiresAt<now()||!currentConfirmer||!salesPermissions(fresh,currentConfirmer,current.customer).confirm||!kingdeeSalesWriteEnabled()||JSON.stringify(kingdeeSalesConfig())!==JSON.stringify(config))throw new AppError('确认有效期、人员权限或销售连接配置已变化，本次未上传。',409);
  const finalValidation=await checked(fresh,current);if(!finalValidation.valid)throw new AppError('模板或订单资料已变化，本次未上传。',409);
  const attempt:Attempt={id:'kingdee_sales_attempt_'+await sha(JSON.stringify([config.instanceId,config.accountId,canonicalBill(current.orderNo)])),kind:'kingdee_sales_attempt',draftId:current.id,draftVersion:current.version,accountId:config.accountId,instanceId:config.instanceId,binding:await binding(current),payload,status:'uploading',message:'已记录上传操作，等待金蝶结果；禁止重复提交。',actorId:member.id,actor:member.name,createdAt:now()},reserved:KingdeeSalesDraft={...current,status:'uploading',attemptId:attempt.id,updatedAt:now()};
  if(all(fresh,'kingdee_sales_attempt').some(v=>v.id===attempt.id||typeof v.payload?.bill_no==='string'&&canonicalBill(v.payload.bill_no)===canonicalBill(current.orderNo)))throw new AppError('此来源或单据编号已有上传操作，须核查原单，不能重复提交。',409);
  await commit(fresh.revision,[reserved,attempt,audit(member,reserved,current,'开始上传金蝶销售订单')]);
  try{
   const saved=await kingdeeSalesRequest(config,'salesSave',{},AbortSignal.timeout(45000),payload),ids=Array.isArray(saved.ids)?saved.ids:[];
   if(ids.length!==1)throw new AppError('金蝶保存未返回唯一订单标识。',502);const remoteId=sourceId(ids[0]);
   await preserveOutcome(attempt.id,'uploading','金蝶已返回订单标识，正在逐项回读核查；禁止重复提交。',{id:remoteId,number:current.orderNo});
   const detail=await kingdeeSalesRequest(config,'salesDetail',{id:remoteId},AbortSignal.timeout(45000)),verified=verifySalesReadback(detail,payload);if(verified.id!==remoteId)throw new AppError('金蝶回读订单标识不一致。',502);
   const outcome=await preserveOutcome(attempt.id,'uploaded','金蝶保存成功，订单内容已回读核对。',verified);return response(outcome.s,member,outcome.draft);
  }catch{const outcome=await preserveOutcome(attempt.id,'unknown','上传结果未完全核实，请核查原操作；系统不会重复提交。');return response(outcome.s,member,outcome.draft);}
 }
 return null;
}
