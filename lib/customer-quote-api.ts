import {z} from 'zod';
import {all,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';
import {customerQuoteAccessPolicy,canSeeCustomerQuoteInternal,isCustomerQuoteAdministrator} from './customer-quote-access';
import {assertCustomerQuoteConfirmable,completedCustomerQuoteRows,visibleCompletedCustomerQuotes} from './customer-quote-review';
import {
 canCreateCustomerQuote,canReadCustomerQuote,canUseCustomerQuotes,customerQuoteInput,eligibleCustomerQuoteAccounts,mayChangeQuoteCustomer,publicCustomerQuote,quoteAccount,
 changedQuoteCustomer,customerQuoteVersion,customerQuoteMedia,publicCustomerQuoteMedia,customerQuoteSentHistory,
 type CustomerQuote,type CustomerQuoteRevision,type CustomerQuoteMedia,type CustomerQuoteSend,
} from './customer-quotes';

function allowed(s:State,m:Member){if(!canUseCustomerQuotes(s,m))throw new AppError('没有客户报价权限，请联系管理员核对报价授权。',403);}
function quoteFor(s:State,id:string){const q=all(s,'customer_quote').find(v=>v.id===id) as CustomerQuote|undefined;if(!q)throw new AppError('客户报价不存在。',404);return q;}
function editable(s:State,m:Member,q:CustomerQuote){if(!canReadCustomerQuote(s,m,q))throw new AppError('只能修改客户责任清单中自己跟进客户的报价；未关联客户的报价须由管理员核对。',403);if(q.status!=='draft')throw new AppError('已确认报价不可覆盖，请先创建修订草稿。',409);}
function current(q:CustomerQuote,version:number){if(q.version!==version)throw new AppError('报价已由其他同事更新，你的输入未覆盖新版本；请刷新核对后再保存。',409);}
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const result=schema.safeParse(value);if(!result.success)throw new AppError(result.error.issues.map(v=>`${v.path.join('.')}: ${v.message}`).slice(0,4).join('；'));return result.data;}
async function persist(s:State,m:Member,q:CustomerQuote,before:CustomerQuote|null,action:string,additionalRecords:Entity[]=[]){
 // The current pointer may advance, but each snapshot has a new ID and is never overwritten.
 const revision:CustomerQuoteRevision={id:newId('customer_quote_revision'),kind:'customer_quote_revision',quoteId:q.id,version:q.version,action,updatedAt:q.updatedAt,updatedBy:m.name,snapshot:structuredClone(q)};
 const withoutStorageKey=(value:CustomerQuote|null)=>{if(!value)return null;const {sourceFileKey,...safe}=value;return safe;};
 const records:Entity[]=[q,revision,audit(m,q,withoutStorageKey(before),action,'客户报价工作台',withoutStorageKey(q)),...additionalRecords];
 await commit(s.revision,records);
 return json({ok:true,quote:publicCustomerQuote({...s,records:[...s.records.filter(v=>v.id!==q.id),...records]},m,q)});
}

export async function customerQuoteGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-quotes','customer-quote-file','customer-quote-access','customer-quote-completed','customer-quote-version','customer-quote-media-file'].includes(action))return null;
 if(action==='customer-quote-access'){
  if(!isCustomerQuoteAdministrator(m,s))throw new AppError('仅管理员可查看客户报价授权配置。',403);
  return json({policy:customerQuoteAccessPolicy(s)});
 }
 allowed(s,m);
 if(action==='customer-quote-version'){
  const url=new URL(req.url),q=archiveVersion(s,m,url.searchParams.get('quoteId'),url.searchParams.get('quoteVersion'));
  const quote=publicCustomerQuote(s,m,q);
  return json({quote:{...quote,canEdit:false,canConfirm:false,canRevise:false},media:quote.media,sentHistory:quote.sentHistory});
 }
 if(action==='customer-quote-media-file'){
  const url=new URL(req.url),media=all(s,'customer_quote_media').find(item=>item.id===url.searchParams.get('id')) as CustomerQuoteMedia|undefined;
  if(!media)throw new AppError('报价附件不存在。',404);
  const q=customerQuoteVersion(s,m,media.quoteId,media.quoteVersion);
  if(!q||!customerQuoteMedia(s,m,q).some(item=>item.id===media.id))throw new AppError('无权读取该客户或版本的报价附件。',403);
  if(!['image/png','image/jpeg','application/pdf'].includes(media.contentType))throw new AppError('附件类型无效。',400);
  const object=await bucket().get(media.fileKey);if(!object)throw new AppError('归档附件暂不可用。',404);
  return new Response(object.body,{headers:{'Content-Type':media.contentType,'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(media.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});
 }
 if(action==='customer-quote-completed')return json({rows:visibleCompletedCustomerQuotes(s,m)});
 if(action==='customer-quotes')return json({quotes:(all(s,'customer_quote') as CustomerQuote[]).filter(q=>canReadCustomerQuote(s,m,q)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(q=>publicCustomerQuote(s,m,q)),customers:eligibleCustomerQuoteAccounts(s,m).map(a=>({id:a.id,customer:a.customer,customerCode:a.customerCode})),canUse:canUseCustomerQuotes(s,m),canCreate:canCreateCustomerQuote(s,m),canSeeInternal:canSeeCustomerQuoteInternal(s,m),canUseUnbound:isCustomerQuoteAdministrator(m,s)});
 const q=quoteFor(s,new URL(req.url).searchParams.get('id')||'');
 if(!canReadCustomerQuote(s,m,q))throw new AppError('无权读取该客户报价的原附件。',403);
 if(!isCustomerQuoteAdministrator(m,s))throw new AppError('原附件可能含内部核价或多客户资料，仅报价管理员可读取。',403);
 if(!q.sourceFileKey)throw new AppError('该报价尚未上传原附件。',404);
 const object=await bucket().get(q.sourceFileKey);if(!object)throw new AppError('原报价附件暂不可用，请联系管理员核对存储。',404);
 return new Response(object.body,{headers:{'Content-Type':q.sourceContentType||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(q.sourceFilename||'quotation.xlsx')}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

export async function customerQuotePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-quote-save','customer-quote-upload','customer-quote-confirm','customer-quote-revise','customer-quote-media-upload','customer-quote-record-sent'].includes(action))return null;
 allowed(s,m);
 if(action==='customer-quote-media-upload')return uploadQuoteMedia(req,s,m);
 if(action==='customer-quote-record-sent')return recordQuoteSent(req,s,m);
 if(action==='customer-quote-confirm'){
  if(!isCustomerQuoteAdministrator(m,s))throw new AppError('最终英文报价须由管理员明确确认，业务成员可先修改并保存草稿。',403);
  const input=parse(z.object({id:z.string().trim().min(1).max(100),version:z.number().int().positive(),acknowledgeEnglish:z.literal(true)}).strict(),await req.json()),before=quoteFor(s,input.id);
  editable(s,m,before);current(before,input.version);assertCustomerQuoteConfirmable(before);
  if(all(s,'customer_quote_completed').some(row=>row.quoteId===before.id&&row.quoteVersion===before.version+1))throw new AppError('该确认版本已存在归档，请刷新核对。',409);
  const at=now(),quote:CustomerQuote={...before,status:'confirmed',version:before.version+1,confirmedAt:at,confirmedBy:m.name,confirmedById:m.id,updatedAt:at,updatedBy:m.name,updatedById:m.id};
  // Confirmation and immutable completed rows commit atomically under one
  // optimistic workspace revision; double-clicks cannot create duplicates.
  return persist(s,m,quote,before,'确认英文客户报价',completedCustomerQuoteRows(quote));
 }
 if(action==='customer-quote-revise'){
  const input=parse(z.object({id:z.string().trim().min(1).max(100),version:z.number().int().positive()}).strict(),await req.json()),before=quoteFor(s,input.id);
  if(!canReadCustomerQuote(s,m,before))throw new AppError('无权修订该客户报价。',403);
  current(before,input.version);if(before.status!=='confirmed')throw new AppError('仅已确认的报价可以创建修订草稿。',409);
  const at=now(),quote:CustomerQuote={...before,status:'draft',version:before.version+1,updatedAt:at,updatedBy:m.name,updatedById:m.id};
  delete quote.confirmedAt;delete quote.confirmedBy;delete quote.confirmedById;
  return persist(s,m,quote,before,'创建客户报价修订草稿');
 }
 if(!canCreateCustomerQuote(s,m))throw new AppError('客户责任清单中尚未分配你跟进的有效客户，不能创建或修改报价。',403);
 if(action==='customer-quote-save'){
  const input=parse(customerQuoteInput,await req.json()),{id,version,...fields}=input;
  const before=id?quoteFor(s,id):null;
  if(before){editable(s,m,before);current(before,version!);if(before.customerAccountId!==fields.customerAccountId&&!isCustomerQuoteAdministrator(m,s))throw new AppError('已保存报价的客户关联只能由管理员核对变更，请为其他客户新建报价。',403);}
  if(!canSeeCustomerQuoteInternal(s,m))for(const key of ['internalNotesZh','exchangeRateCnyPerUsd','internalCosts'] as const){if(Object.prototype.hasOwnProperty.call(fields,key)){const value=fields[key],empty=value==null||value===''||(Array.isArray(value)&&!value.length);if(!empty)throw new AppError('当前账号无权读取或修改内部核价字段。',403);delete fields[key];}if(before?.[key]!==undefined)(fields as Record<string,unknown>)[key]=before[key];}
  if(!mayChangeQuoteCustomer(s,m,fields))throw new AppError('只能关联客户责任清单中自己跟进的有效客户，未关联客户的报价不能由业务成员保存。',403);
  if(fields.customerAccountId){const account=quoteAccount(s,fields.customerAccountId);if(!account||!account.active)throw new AppError('选定的客户档案不存在或已停用。');if(fields.customerName!==account.customer||(account.customerCode&&fields.customerCode!==account.customerCode))throw new AppError('报价客户名称 / 编号与所选档案不一致，请先核对；系统不会自动修改客户档案。');}
  const at=now(),quote:CustomerQuote={...before,...fields,id:before?.id||newId('customer_quote'),kind:'customer_quote',status:'draft',version:(before?.version||0)+1,createdAt:before?.createdAt||at,createdBy:before?.createdBy||m.name,createdById:before?.createdById||m.id,updatedAt:at,updatedBy:m.name,updatedById:m.id};
  // Re-associating an already bound quote must not give the new customer access
  // to another customer's source. First administrator-confirmed binding retains
  // its source; immutable snapshots and stored bytes always remain intact.
  if(before?.customerAccountId&&before.customerAccountId!==fields.customerAccountId){delete quote.sourceFileKey;delete quote.sourceFilename;delete quote.sourceHash;delete quote.sourceContentType;}
  // A new customer's quote must never inherit customer-facing files from the
  // prior customer, including when an unbound prospect is first reassociated.
  if(before?.mediaIds){
   const lineIds=new Set(quote.lines.map(line=>line.id));
   quote.mediaIds=changedQuoteCustomer(before,quote)?[]:before.mediaIds.filter(id=>{const media=all(s,'customer_quote_media').find(item=>item.id===id);return !!media&&(!media.lineId||lineIds.has(media.lineId));});
  }
  return persist(s,m,quote,before,before?'更新客户报价草稿':'创建客户报价草稿');
 }
 const form=await req.formData(),input=parse(z.object({quoteId:z.string().min(1),version:z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger)}),{quoteId:form.get('quoteId'),version:form.get('version')}),before=quoteFor(s,input.quoteId);
 editable(s,m,before);current(before,input.version);
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的原报价单。');
 const ext=file.name.match(/\.(xlsx|xls|pdf|png|jpe?g)$/i)?.[1].toLowerCase();if(!ext)throw new AppError('原报价附件支持 XLSX、XLS、PDF、PNG 或 JPEG。');
 const bytes=await file.arrayBuffer(),header=new Uint8Array(bytes).slice(0,8);
 const signatures:Record<string,number[]>={xls:[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],pdf:[0x25,0x50,0x44,0x46,0x2d],png:[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],jpg:[0xff,0xd8,0xff],jpeg:[0xff,0xd8,0xff]};
 const valid=ext==='xlsx'?header[0]===0x50&&header[1]===0x4b:signatures[ext].every((v,i)=>header[i]===v);
 if(!valid)throw new AppError('文件内容与扩展名不匹配，请上传原始 Excel、PDF、PNG 或 JPEG 文件。');
 const contentTypes:Record<string,string>={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
 const hash=await sha(bytes),fileKey=newId('customer_quote_source'),at=now();
 const quote:CustomerQuote={...before,version:before.version+1,sourceFileKey:fileKey,sourceFilename:file.name.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,180),sourceHash:hash,sourceContentType:contentTypes[ext],updatedAt:at,updatedBy:m.name,updatedById:m.id};
 // Write a new immutable object. A failed optimistic commit cannot replace any prior file.
 await bucket().put(fileKey,bytes);
 return persist(s,m,quote,before,'上传客户报价原附件');
}

const archiveId=z.string().trim().min(1).max(120);
const archiveVersionInput=z.union([z.number().int().positive(),z.string().regex(/^[1-9]\d*$/).transform(Number)]).refine(Number.isSafeInteger);
function archiveVersion(s:State,m:Member,id:unknown,version:unknown){
 const input=parse(z.object({quoteId:archiveId,quoteVersion:archiveVersionInput}),{quoteId:id,quoteVersion:version});
 const q=customerQuoteVersion(s,m,input.quoteId,input.quoteVersion);
 if(!q)throw new AppError('报价版本不存在或没有此客户版本的权限。',403);
 return q;
}
function archiveIdentity(q:CustomerQuote){return {quoteId:q.id,customerAccountId:q.customerAccountId,customerName:q.customerName,customerCode:q.customerCode};}
async function uploadQuoteMedia(req:Request,s:State,m:Member){
 const form=await req.formData(),input=parse(z.object({quoteId:archiveId,quoteVersion:archiveVersionInput,lineId:z.string().trim().max(100),category:z.enum(['image','drawing','sent_quote','evidence']),title:z.string().trim().max(200),drawingNo:z.string().trim().max(200)}).strict(),{
  quoteId:form.get('quoteId'),quoteVersion:form.get('quoteVersion'),lineId:form.get('lineId')||'',category:form.get('category'),title:form.get('title')||'',drawingNo:form.get('drawingNo')||'',
 }),before=archiveVersion(s,m,input.quoteId,input.quoteVersion),currentQuote=quoteFor(s,input.quoteId);
 const lineMedia=input.category==='image'||input.category==='drawing';
 if(lineMedia&&!before.lines.some(line=>line.id===input.lineId))throw new AppError('款式图片和图纸须关联本报价版本中的有效产品行。');
 if(!lineMedia&&input.lineId)throw new AppError('已发报价和发送凭证属于整份报价版本，请勿关联产品行。');
 if(before.status==='draft'){
  if(!lineMedia)throw new AppError('请先最终确认英文报价，再归档已发报价或发送凭证。',409);
  editable(s,m,currentQuote);current(currentQuote,input.quoteVersion);
 }else if(before.status!=='confirmed')throw new AppError('该版本不能归档附件。',409);
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的 PNG、JPEG 或 PDF 文件。');
 const ext=file.name.match(/\.(png|jpe?g|pdf)$/i)?.[1].toLowerCase();
 if(!ext||(input.category==='image'&&ext==='pdf'))throw new AppError('款式主图仅支持 PNG/JPEG；图纸、已发报价及凭证支持 PNG/JPEG/PDF。');
 const bytes=await file.arrayBuffer(),header=new Uint8Array(bytes).slice(0,8),signatures:Record<string,number[]>={png:[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],jpg:[0xff,0xd8,0xff],jpeg:[0xff,0xd8,0xff],pdf:[0x25,0x50,0x44,0x46,0x2d]};
 if(!signatures[ext].every((byte,index)=>header[index]===byte))throw new AppError('文件内容与扩展名不匹配，请上传原始图片或 PDF。');
 const hash=await sha(bytes),filename=file.name.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,180),existing=customerQuoteMedia(s,m,before).find(item=>item.sha256===hash&&item.filename===filename&&item.lineId===input.lineId&&item.category===input.category&&item.title===input.title&&item.drawingNo===input.drawingNo);
 if(existing)return json({ok:true,alreadyPresent:true,quoteVersion:before.version,...(before.status==='draft'?{quote:publicCustomerQuote(s,m,before)}:{}),media:publicCustomerQuoteMedia(existing)});
 const at=now(),media:CustomerQuoteMedia={id:newId('customer_quote_media'),kind:'customer_quote_media',...archiveIdentity(before),quoteVersion:before.version+(before.status==='draft'?1:0),lineId:input.lineId,category:input.category,supplement:before.status==='confirmed',filename,contentType:ext==='pdf'?'application/pdf':ext==='png'?'image/png':'image/jpeg',size:file.size,sha256:hash,fileKey:newId('customer_quote_media_file'),title:input.title,drawingNo:input.drawingNo,uploadedAt:at,uploadedBy:m.name,uploadedById:m.id};
 // Always write a fresh object; an optimistic conflict can only leave an
 // unreferenced object, never change bytes behind an existing version.
 await bucket().put(media.fileKey,bytes);
 const log=audit(m,{id:media.id,kind:media.kind,quoteId:media.quoteId},null,before.status==='draft'?'添加客户报价款式附件':'补充归档已确认报价附件','客户报价工作台',publicCustomerQuoteMedia(media));
 if(before.status==='draft'){
  const quote:CustomerQuote={...before,version:before.version+1,mediaIds:[...(before.mediaIds||[]),media.id],updatedAt:at,updatedBy:m.name,updatedById:m.id};
  const response=await persist(s,m,quote,before,'添加客户报价款式附件',[media,log]),body=await response.json() as Record<string,unknown>;
  return json({...body,media:publicCustomerQuoteMedia(media),quoteVersion:quote.version,alreadyPresent:false});
 }
 await commit(s.revision,[media,log]);
 return json({ok:true,alreadyPresent:false,quoteVersion:before.version,media:publicCustomerQuoteMedia(media)});
}
async function recordQuoteSent(req:Request,s:State,m:Member){
 const input=parse(z.object({quoteId:archiveId,quoteVersion:z.number().int().positive(),sentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(date=>{try{return strictDate(date)===date;}catch{return false;}},'发送日期无效'),recipient:z.string().trim().min(1).max(240),channel:z.enum(['email','whatsapp','wechat','other']),mediaIds:z.array(archiveId).max(30).default([]),idempotencyKey:z.string().trim().min(8).max(120)}).strict(),await req.json());
 if(input.sentDate>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}))throw new AppError('发送日期不能晚于今天。');
 if(new Set(input.mediaIds).size!==input.mediaIds.length)throw new AppError('发送凭证编号不能重复。');
 const q=archiveVersion(s,m,input.quoteId,input.quoteVersion);
 if(q.status!=='confirmed')throw new AppError('只有已最终确认的英文报价版本才能登记已发送。',409);
 const media=customerQuoteMedia(s,m,q);
 if(input.mediaIds.some(id=>!media.some(item=>item.id===id&&item.quoteVersion===q.version&&['sent_quote','evidence'].includes(item.category))))throw new AppError('只能关联本报价确认版本的已发报价文件或发送凭证。',403);
 const {idempotencyKey,...payload}=input,normalized={...payload,mediaIds:[...input.mediaIds].sort()},payloadHash=await sha(new TextEncoder().encode(JSON.stringify(normalized)).buffer);
 const events=(all(s,'customer_quote_send') as CustomerQuoteSend[]).filter(event=>event.quoteId===q.id&&event.quoteVersion===q.version),sameKey=events.find(event=>event.idempotencyKey===idempotencyKey);
 if(sameKey&&sameKey.payloadHash!==payloadHash)throw new AppError('相同登记请求编号对应不同内容，请核对后重新登记。',409);
 if(sameKey||events.some(event=>event.payloadHash===payloadHash))return json({ok:true,alreadyPresent:true,sentHistory:customerQuoteSentHistory(s,m,q)});
 const event:CustomerQuoteSend={id:newId('customer_quote_send'),kind:'customer_quote_send',...archiveIdentity(q),quoteVersion:q.version,sentDate:input.sentDate,recipient:input.recipient,channel:input.channel,mediaIds:normalized.mediaIds,idempotencyKey,payloadHash,createdAt:now(),createdBy:m.name,createdById:m.id};
 const after={...s,records:[...s.records,event]},history=customerQuoteSentHistory(after,m,q),publicEvent=history.find(row=>row.id===event.id)!;
 await commit(s.revision,[event,audit(m,{id:event.id,kind:event.kind,quoteId:event.quoteId},null,'登记客户报价已发送','客户报价工作台',publicEvent)]);
 return json({ok:true,alreadyPresent:false,sentHistory:history});
}
