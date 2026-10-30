import {z} from 'zod';
import {all,newId,now,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {actor,AppError,audit,bucket,commit,json,snapshot} from './store';
import {businessTeamData,businessTeamHeader,filterBusinessTeamRows,ungroupedBusinessTeam} from './business-team-scope';
import {canReadIeQuote,iePolicyMember,ieQuotePolicy} from './ie-quote-access';
import {latestIeMaterialNameCatalog,materialPartChecklist} from './ie-material-names';
import {buildIeQuotePersistenceRecords} from './ie-quote-api';
import {calculateIeQuote,currentIeQuote,ieQuoteInput,type IeQuote} from './ie-quotes';
import {IE_ATTACHMENT_MAX_BYTES,ieAttachmentHash,validateIeAttachment} from './ie-quote-attachments';
import {assignedQuoteEngineer,availableQuoteEngineer,canCreateQuoteRequestFor,canEditQuoteRequest,canReadQuoteRequest,canStartQuoteRequest,publicQuoteRequest,quoteRequestId,quoteRequestSaveSchema,quoteRequestToken,requestAccount,type QuoteRequest,type QuoteRequestAttachment,type QuoteRequestRevision} from './quote-requests';

const change=z.object({id:quoteRequestId,version:z.number().int().positive(),token:quoteRequestToken}).strict();
const parse=<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>=>{const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(i=>`${i.path.join('.')}：${i.message}`).join('；'));return parsed.data;};
const merge=(s:State,rows:Entity[]):State=>{const ids=new Set(rows.map(r=>r.id));return {...s,records:[...s.records.filter(r=>!ids.has(r.id)),...rows]};};
function internal(m:Member){if(!m.active||m.role==='supplier')throw new AppError('没有报价需求访问权限。',403);}
function read(s:State,m:Member,id:string){const r=all(s,'quote_request').find(r=>r.id===id) as QuoteRequest|undefined;if(!r||!canReadQuoteRequest(s,m,r))throw new AppError('报价需求不存在或没有当前客户访问权限。',403);return r;}
function editable(s:State,m:Member,r:QuoteRequest){if(!canEditQuoteRequest(s,m,r))throw new AppError('只有需求发起人或管理员可以编辑尚未发送的需求草稿。',403);}
function current(r:QuoteRequest,version:number|undefined){if(r.version!==version)throw new AppError('需求版本已更新，本次未覆盖；请重新读取后核对。',409);}
async function fingerprint(value:unknown){return ieAttachmentHash(new TextEncoder().encode(JSON.stringify(value)));}
async function replay(s:State,m:Member,action:string,input:{token:string;[key:string]:unknown}){
 const hash=await fingerprint({action,input}),prior=(all(s,'quote_request_revision') as QuoteRequestRevision[]).find(r=>r.actorId===m.id&&r.token===input.token);
 if(!prior)return {hash,response:null};
 if(prior.fingerprint!==hash)throw new AppError('操作标识已用于不同内容，请核对后重新提交。',409);
 const r=read(s,m,prior.requestId);return {hash,response:json({ok:true,idempotent:true,request:publicQuoteRequest(s,m,r),ieQuoteId:r.ieQuoteId})};
}
async function persist(s:State,m:Member,r:QuoteRequest,before:QuoteRequest|null,action:string,token:string,hash:string,extra:Entity[]=[]){
 const revision:QuoteRequestRevision={id:newId('quote_request_revision'),kind:'quote_request_revision',requestId:r.id,version:r.version,action,actorId:m.id,actor:m.name,createdAt:r.updatedAt,snapshot:structuredClone(r),token,fingerprint:hash};
 const rows=[r,revision,audit(m,r,before,action,'报价需求表',r),...extra];await commit(s.revision,rows);return json({ok:true,request:publicQuoteRequest(merge(s,rows),m,r),ieQuoteId:r.ieQuoteId});
}
function teamForList(req:Request,s:State,m:Member){const team=(req.headers.get(businessTeamHeader)||'').trim();if(team.length>160||team&&team!==ungroupedBusinessTeam&&!businessTeamData(s,m).teams.some(t=>t.id===team))throw new AppError('业务工作组不存在或不在授权范围。',403);return team;}
export async function quoteRequestGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['quote-request-data','quote-request-detail','quote-request-file'].includes(action))return null;internal(m);const params=new URL(req.url).searchParams;
 if(action==='quote-request-data'){
  const mine=params.get('mine')==='1',team=mine?'':teamForList(req,s,m);
  const requests=(all(s,'quote_request') as QuoteRequest[]).filter(r=>canReadQuoteRequest(s,m,r)&&(!mine||assignedQuoteEngineer(s,m,r)&&currentIeQuote(s,r.ieQuoteId)?.status!=='released'));
  const customers=filterBusinessTeamRows(s,(all(s,'customer_account') as CustomerAccount[]).filter(a=>canCreateQuoteRequestFor(s,m,a)),team);
  const engineer=availableQuoteEngineer(s);return json({requests:filterBusinessTeamRows(s,requests,team).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(r=>publicQuoteRequest(s,m,r)),customers:customers.map(({id,customer,customerCode})=>({id,customer,customerCode})),engineer:engineer?{id:engineer.id,name:engineer.name}:null,canCreate:customers.length>0});
 }
 let requestId=params.get('id')||'';
 if(action==='quote-request-detail'&&!requestId&&params.get('quoteId')){
  const quoteId=params.get('quoteId')!,quote=currentIeQuote(s,quoteId);
  if(!quote||!canReadIeQuote(s,m,quote))throw new AppError('工程报价不存在或无权查看。',403);
  const matches=(all(s,'quote_request') as QuoteRequest[]).filter(r=>r.ieQuoteId===quoteId&&r.customerAccountId===quote.customerAccountId&&r.status==='quoting'&&canReadQuoteRequest(s,m,r));
  if(matches.length!==1)return json({request:null,history:[]});requestId=matches[0].id;
 }
 const r=read(s,m,requestId);
 if(action==='quote-request-detail')return json({request:publicQuoteRequest(s,m,r),history:(all(s,'quote_request_revision') as QuoteRequestRevision[]).filter(v=>v.requestId===r.id&&v.snapshot.customerAccountId===r.customerAccountId).sort((a,b)=>b.version-a.version).map(v=>({id:v.id,version:v.version,action:v.action,actor:v.actor,createdAt:v.createdAt,snapshot:publicQuoteRequest(s,m,v.snapshot)}))});
 const a=all(s,'quote_request_attachment').find(a=>a.id===params.get('attachmentId')&&a.requestId===r.id&&a.customerAccountId===r.customerAccountId) as QuoteRequestAttachment|undefined;
 if(!a||!r.attachmentIds.includes(a.id))throw new AppError('附件不属于当前报价需求。',403);
 const stored=await bucket().get(a.fileKey);if(!stored)throw new AppError('附件原件暂不可用。',404);const bytes=new Uint8Array(await new Response(stored.body).arrayBuffer());
 if(bytes.length!==a.size||await ieAttachmentHash(bytes)!==a.sha256)throw new AppError('附件完整性校验失败，已阻止下载。',409);
 const fresh=await snapshot(),who=await actor(fresh),latest=read(fresh,who,r.id);if(who.id!==m.id||!latest.attachmentIds.includes(a.id))throw new AppError('附件或登录状态已变化，请重新读取。',409);
 return new Response(bytes.buffer,{headers:{'Content-Type':a.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cross-Origin-Resource-Policy':'same-origin'}});
}
function attachmentMetadata(bytes:Uint8Array,name:string,type:string){
 if(!bytes.length||bytes.length>IE_ATTACHMENT_MAX_BYTES)throw new AppError('请选择非空且不超过 12 MB 的附件。');
 const filename=name.normalize('NFKC');if(!filename.trim()||filename.length>200||/[\\/\u0000-\u001f\u007f]/.test(filename))throw new AppError('附件文件名不能包含路径或控制字符。');
 const ext=filename.split('.').pop()?.toLowerCase()||'';if(['pdf','jpg','jpeg','png','webp'].includes(ext))return validateIeAttachment(bytes,filename,type);
 const types:Record<string,string>={txt:'text/plain',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',doc:'application/msword'};
 if(!types[ext]||type&&type!=='application/octet-stream'&&type!==types[ext]&&!(ext==='csv'&&type==='application/vnd.ms-excel'))throw new AppError('支持 PDF、JPG、PNG、WEBP、TXT、CSV、Excel 和 Word 附件。');
 if(['xlsx','docx'].includes(ext)&&!(bytes.length>30&&bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4)||['xls','doc'].includes(ext)&&![208,207,17,224,161,177,26,225].every((v,i)=>bytes[i]===v))throw new AppError('Office 附件内容与扩展名不一致。');
 if(['txt','csv'].includes(ext)){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new AppError('文字附件请保存为 UTF-8 编码。');}if(bytes.includes(0))throw new AppError('文字附件含二进制内容。');}
 return {filename,contentType:types[ext]};
}
export async function quoteRequestPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['quote-request-save','quote-request-submit','quote-request-start','quote-request-upload','quote-request-remove-attachment'].includes(action))return null;internal(m);
 if(action==='quote-request-upload'){
  if(Number(req.headers.get('Content-Length')||0)>IE_ATTACHMENT_MAX_BYTES+65536)throw new AppError('附件请求超过 12 MB 上限。');
  const form=await req.formData();if([...form.keys()].some(k=>!['id','version','file','token'].includes(k)||form.getAll(k).length!==1))throw new AppError('附件上传字段重复或无效。');
  const r=read(s,m,String(form.get('id')||'')),version=Number(form.get('version')),file=form.get('file');
  if(!(file instanceof File)||file.size>IE_ATTACHMENT_MAX_BYTES)throw new AppError('请选择不超过 12 MB 的附件。');
  const bytes=new Uint8Array(await file.arrayBuffer()),meta=attachmentMetadata(bytes,file.name,file.type),sha256=await ieAttachmentHash(bytes),token=String(form.get('token')||`upload:${r.id}:${version}:${sha256}`),input=parse(change,{id:r.id,version,token});
  const memo=await replay(s,m,action,{...input,sha256,...meta});if(memo.response)return memo.response;editable(s,m,r);current(r,input.version);if(r.attachmentIds.length>=20)throw new AppError('每份需求最多上传 20 个附件。');
  const at=now(),a:QuoteRequestAttachment={id:newId('quote_request_attachment'),kind:'quote_request_attachment',requestId:r.id,customerAccountId:r.customerAccountId,...meta,size:bytes.length,sha256,fileKey:newId('quote_request_file'),createdAt:at,createdBy:m.name,createdById:m.id};
  await bucket().put(a.fileKey,bytes.buffer);return persist(s,m,{...r,attachmentIds:[...r.attachmentIds,a.id],version:r.version+1,updatedAt:at,updatedBy:m.name,updatedById:m.id},r,'上传报价需求附件',input.token,memo.hash,[a]);
 }
 if(action==='quote-request-save'){
  const input=parse(quoteRequestSaveSchema,await req.json()),memo=await replay(s,m,action,input);if(memo.response)return memo.response;
  const before=input.id?read(s,m,input.id):null,a=all(s,'customer_account').find(a=>a.id===input.customerAccountId) as CustomerAccount|undefined;
  if(!a||!canCreateQuoteRequestFor(s,m,a))throw new AppError('不能为此客户维护报价需求。',403);
  if(before){editable(s,m,before);current(before,input.version);if(before.customerAccountId!==input.customerAccountId)throw new AppError('保存后不能改换客户，请另建需求。');}else if(input.version!==undefined)throw new AppError('新需求不能指定已有版本。');
  const {id,version,token,...fields}=input,at=now(),requestId=before?.id||newId('quote_request');
  const r:QuoteRequest={...fields,id:requestId,kind:'quote_request',version:(before?.version||0)+1,requestNo:before?.requestNo||'RFQ-'+at.slice(0,10).replaceAll('-','')+'-'+requestId.slice(-8).toUpperCase(),customerName:a.customer,customerCode:a.customerCode,status:'draft',ieQuoteId:'',attachmentIds:before?.attachmentIds||[],requestedById:before?.requestedById||m.id,requestedBy:before?.requestedBy||m.name,assigneeId:'',assigneeName:'',createdAt:before?.createdAt||at,updatedAt:at,updatedById:m.id,updatedBy:m.name};
  return persist(s,m,r,before,before?'更新报价需求草稿':'新增报价需求草稿',token,memo.hash);
 }
 const input=parse(action==='quote-request-remove-attachment'?change.extend({attachmentId:quoteRequestId}).strict():change,await req.json()),memo=await replay(s,m,action,input);if(memo.response)return memo.response;
 const r=read(s,m,input.id);current(r,input.version);const at=now(),next={...r,version:r.version+1,updatedAt:at,updatedBy:m.name,updatedById:m.id};
 if(action==='quote-request-remove-attachment'){
  editable(s,m,r);const attachmentId=(input as z.infer<typeof change>&{attachmentId:string}).attachmentId;if(!r.attachmentIds.includes(attachmentId))throw new AppError('附件引用已移除或不属于当前需求。',409);
  return persist(s,m,{...next,attachmentIds:r.attachmentIds.filter(id=>id!==attachmentId)},r,'移除需求附件引用（保留原件）',input.token,memo.hash);
 }
 if(action==='quote-request-submit'){
  editable(s,m,r);const engineer=availableQuoteEngineer(s);if(!engineer)throw new AppError('请管理员在 IE 工程报价中核对工程师账号绑定；接收人必须有效且具有工程报价填写权限，不能是只读账号。',409);
  if(!r.requirementText&&!r.attachmentIds.length&&!r.lines.some(l=>l.model||l.customerModel||l.requirements))throw new AppError('请填写款式需求、粘贴客户要求或上传附件后再发送。');
  return persist(s,m,{...next,status:'submitted',assigneeId:engineer.id,assigneeName:engineer.name,submittedAt:at},r,'发送报价需求给 IE 工程师',input.token,memo.hash);
 }
 if(r.status==='quoting'&&r.ieQuoteId&&canStartQuoteRequest(s,m,{...r,status:'submitted'})){
  const existing=currentIeQuote(s,r.ieQuoteId);if(!existing||existing.customerAccountId!==r.customerAccountId)throw new AppError('关联工程报价不一致，请核查。',409);
  return json({ok:true,idempotent:true,request:publicQuoteRequest(s,m,r),ieQuoteId:existing.id});
 }
 if(!canStartQuoteRequest(s,m,r))throw new AppError('只有本单指定的 IE 工程师或管理员可以开始报价。',403);
 if(!ieQuotePolicy(s)||!iePolicyMember(s,'engineer')||!iePolicyMember(s,'reviewer')||!iePolicyMember(s,'finalApprover'))throw new AppError('请管理员先核对工程师、复核人与最终批准人的账号绑定。',409);
 const checklist=materialPartChecklist(latestIeMaterialNameCatalog(s)).slice(0,200);
 const a=requestAccount(s,r)!,fields=ieQuoteInput.parse({customerAccountId:r.customerAccountId,materialPricingMode:'checklist',quoteNo:'IE-'+r.requestNo,quoteDate:new Date(at).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),validUntil:'',batchId:r.requestNo,exchangeRateCnyPerUsd:null,exchangeRateDate:'',exchangeRateSource:'',notes:`来源需求：${r.requestNo}\n${r.title}\n报价截止：${r.dueDate||'未指定'}\n完整要求与附件请查看报价需求单。`,lines:r.lines.map(l=>({id:l.id,model:l.model,customerModel:l.customerModel,color:l.color,drawingNo:l.drawingNo,drawingRevision:l.drawingRevision,quantityMin:l.quantity,quantityMax:l.quantity,structureNotes:l.material?`材料要求：${l.material}`:'',scopeNotes:l.requirements,materials:checklist.map(item=>({id:newId('ie_material'),name:item.name,nameReference:{catalogId:item.catalogId,catalogVersion:item.version,entryId:item.id,nameUsage:'part-v1'},specification:'',unit:'',basePrice:null,usage:1,coefficient:1,lossRate:0.1,lossAdjustmentReason:'',notApplicable:false,priceSource:'',notes:''})),processes:[],outsourcing:[]})),tooling:[]});
 // Preserve the full source in its immutable request; notes carry a bounded excerpt.
 fields.notes+='\n'+r.requirementText.slice(0,7000);
 const q:IeQuote={...fields,id:newId('ie_quote'),kind:'ie_quote',version:1,revision:1,status:'draft',customerName:a.customer,customerCode:a.customerCode,preparedByIds:[m.id],policyVersion:ieQuotePolicy(s)!.version,requiredReviewMemberId:'',costs:calculateIeQuote(fields),createdAt:at,createdBy:m.name,createdById:m.id,updatedAt:at,updatedBy:m.name,updatedById:m.id};
 return persist(s,m,{...next,status:'quoting',ieQuoteId:q.id,startedAt:at},r,'从需求开始 IE 工程报价',input.token,memo.hash,buildIeQuotePersistenceRecords(m,q,null,'根据报价需求创建工程报价草稿'));
}
