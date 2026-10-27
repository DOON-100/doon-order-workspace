import {z} from 'zod';
import {all,canRead,clean,newId,now,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {businessTeamData,businessTeamHeader,filterBusinessTeamRows,ungroupedBusinessTeam} from './business-team-scope';
import {sha} from './workbooks';
import {serviceAssignmentData,validateServiceAssignment} from './service-workspace-assignment';
import {paymentTermsReadOnly} from './payment-terms';
import {
 assignedServiceCustomer,canReadServiceRecord,canWriteServiceWorkspace,publicServiceAttachment,publicServiceReceipt,publicServiceRecord,
 serviceCustomerAccounts,serviceDetailsSchemas,serviceOrderCustomerKeys,serviceReceivedCents,serviceReceiptReverseSchema,serviceReceiptSchema,serviceSaveSchema,serviceTotalsByCurrency,
 type ServiceAttachment,type ServiceCurrency,type ServiceReceipt,type ServiceRecord,type ServiceRevision,
} from './service-workspace';

function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{
 const result=schema.safeParse(value);
 if(!result.success)throw new AppError(result.error.issues.slice(0,4).map(issue=>`${issue.path.join('.')||'内容'}：${issue.message}`).join('；'));
 return result.data;
}
function readable(s:State,m:Member,id:string):ServiceRecord{
 const record=all(s,'service_record').find(row=>row.id===id) as ServiceRecord|undefined;
 if(!record||!canReadServiceRecord(s,m,record))throw new AppError('该客服记录不存在或不在你负责的客户范围内。',403);
 return record;
}
function editable(s:State,m:Member,id:string){
 if(!canWriteServiceWorkspace(s,m))throw new AppError('仅管理员及负责客户的业务 / 客服人员可维护客服业务。',403);
 const record=readable(s,m,id),account=all(s,'customer_account').find(row=>row.id===record.customerId);
 if(!account?.active)throw new AppError('客户已停用，原业务记录仍保留；请由管理员核对客户档案。',409);
 return record;
}
function current(record:ServiceRecord,version:number|undefined){
 if(record.version!==version)throw new AppError('该记录已由其他同事更新，本次未覆盖；请刷新并核对最新版本。',409);
}
function linkedOrder(s:State,account:CustomerAccount,orderId:string){
 if(!orderId)return;
 const order=all(s,'order').find(row=>row.id===orderId) as Order|undefined;
 const key=(value:unknown)=>clean(value).toLowerCase();
 // Source codes are never inferred from a name or a neighbouring record.
 const identities=serviceOrderCustomerKeys(s,account).map(key).filter(Boolean);
 if(!order||!identities.includes(key(order.customer)))throw new AppError('关联订单的客户与当前客户档案不一致；若客户编码缺失，请先由管理员核对，不能猜测关联。');
 return order;
}
function nextState(s:State,updates:Entity[]):State{
 const ids=new Set(updates.map(row=>row.id));return {...s,records:[...s.records.filter(row=>!ids.has(row.id)),...updates]};
}
async function persist(s:State,m:Member,record:ServiceRecord,before:ServiceRecord|null,action:string,extra:Entity[]=[]){
 const revision:ServiceRevision={id:newId('service_revision'),kind:'service_revision',recordId:record.id,customerId:record.customerId,
  version:record.version,action,actorId:m.id,actor:m.name,createdAt:record.updatedAt,snapshot:structuredClone(record)};
 const updates=[record,revision,audit(m,record,before,action,'客服日常工作台'),...extra];
 await commit(s.revision,updates);return nextState(s,updates);
}
function advance(record:ServiceRecord,m:Member):ServiceRecord{return {...record,version:record.version+1,updatedAt:now(),updatedBy:m.name};}
function financial(record:ServiceRecord){
 if(record.type!=='receivable')throw new AppError('只能在应收账款记录中确认到账或冲销。');
 if(!Number.isSafeInteger(record.details.amountCents)||!['CNY','USD','EUR','GBP','HKD'].includes(String(record.details.currency)))throw new AppError('应收账款金额或币种异常，请联系管理员核对原记录。',409);
}
async function fingerprint(value:unknown){return sha(JSON.stringify(value));}
const canonicalSave=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonicalSave).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalSave(value[key])).join(',')+'}';
function serviceTeam(req:Request,s:State,m:Member,record:ServiceRecord|Record<string,unknown>){const team=(req.headers.get(businessTeamHeader)||'').trim();if(!team)return;if(team.length>160||team!==ungroupedBusinessTeam&&!businessTeamData(s,m).teams.some(row=>row.id===team)||!filterBusinessTeamRows(s,[record],team).length)throw new AppError('客服记录不在所选业务组范围。',403);}
const imageExtensions:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
function imageContentType(bytes:ArrayBuffer){
 const data=new Uint8Array(bytes),matches=(offset:number,values:number[])=>values.every((value,index)=>data[offset+index]===value);
 if(matches(0,[137,80,78,71,13,10,26,10]))return 'image/png';
 if(matches(0,[255,216,255]))return 'image/jpeg';
 if(matches(0,[71,73,70,56,55,97])||matches(0,[71,73,70,56,57,97]))return 'image/gif';
 if(matches(0,[82,73,70,70])&&matches(8,[87,69,66,80]))return 'image/webp';
 return '';
}
function verifiedImageType(bytes:ArrayBuffer,filename:string){
 const expected=imageExtensions[filename.split('.').at(-1)?.toLowerCase()||''],actual=imageContentType(bytes);
 return expected&&actual===expected?actual:'';
}
function repeatReceipt(s:State,m:Member,id:string,expected:string,record:ServiceRecord){
 const prior=s.records.find(row=>row.id===id) as ServiceReceipt|undefined;
 if(!prior)return null;
 if(prior.kind!=='service_receipt'||prior.recordId!==record.id||prior.actorId!==m.id||prior.requestFingerprint!==expected)
  throw new AppError('本次操作标识已用于不同内容；请刷新后重新核对，不得重复核销。',409);
 return json({ok:true,idempotent:true,record:publicServiceRecord(s,record),receipt:publicServiceReceipt(prior)});
}

export async function serviceWorkspaceGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['service-data','service-history','service-file'].includes(action))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 if(action==='service-data'){
  const records=(all(s,'service_record') as ServiceRecord[]).filter(record=>canReadServiceRecord(s,m,record)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const ids=new Set(records.map(row=>row.id)),customers=serviceCustomerAccounts(s,m);
  const customerKeys=new Set(customers.flatMap(account=>serviceOrderCustomerKeys(s,account).map(key=>clean(key).toLowerCase())));
  return json({writeContract:'service-save-version-token-v1',saveToken:true,sourceOrderVersion:true,orders:(all(s,'order') as Order[]).filter(order=>canRead(m,order)&&customerKeys.has(clean(order.customer).toLowerCase())).map(order=>({id:order.id,version:order.version,customer:order.customer,orderNo:order.orderNo,drawing:order.drawing,color:order.color,quantity:order.quantity})),records:records.map(record=>publicServiceRecord(s,record)),
   receipts:(all(s,'service_receipt') as ServiceReceipt[]).filter(row=>ids.has(row.recordId)&&canReadServiceRecord(s,m,row)).map(publicServiceReceipt),
   attachments:(all(s,'service_attachment') as ServiceAttachment[]).filter(row=>ids.has(row.recordId)&&canReadServiceRecord(s,m,row)).map(publicServiceAttachment),
   customers:customers.map(account=>({id:account.id,customer:account.customer,customerCode:account.customerCode,active:account.active,salesName:account.salesName,serviceName:account.serviceName,orderKeys:serviceOrderCustomerKeys(s,account)})),
   ...serviceAssignmentData(s,customers,records),
   canWrite:canWriteServiceWorkspace(s,m),totalsByCurrency:serviceTotalsByCurrency(s,records)});
 }
 const id=new URL(req.url).searchParams.get('id')||'';
 if(action==='service-history'){
  const record=readable(s,m,id);
  return json({history:(all(s,'service_revision') as ServiceRevision[]).filter(row=>row.recordId===record.id&&row.customerId===record.customerId)
   .sort((a,b)=>b.version-a.version)});
 }
 const item=all(s,'service_attachment').find(row=>row.id===id) as ServiceAttachment|undefined;
 if(!item||!canReadServiceRecord(s,m,item))throw new AppError('附件不存在或没有该客户的访问权限。',403);
 const object=await bucket().get(item.fileKey);if(!object)throw new AppError('附件文件暂不可用，请联系管理员核对存储；原附件记录仍保留。',404);
 if(new URL(req.url).searchParams.get('preview')==='1'){
  const bytes=await new Response(object.body).arrayBuffer(),contentType=verifiedImageType(bytes,item.filename);
  if(!contentType||item.contentType!==contentType)throw new AppError('仅支持预览经校验的 PNG、JPG、GIF 或 WebP 图片，请下载原附件查看。',415);
  return new Response(bytes,{headers:{'Content-Type':contentType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 return new Response(object.body,{headers:{'Content-Type':item.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}

export async function serviceWorkspacePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['service-save','service-receipt','service-receipt-reverse','service-attachment'].includes(action))return null;
 if(paymentTermsReadOnly(s,m))throw new AppError('当前账号仅有取数与总览权限，不能修改客服记录、登记到账、冲销或上传附件。',403);
 if(!canWriteServiceWorkspace(s,m))throw new AppError('没有客服业务维护权限；只读或全订单查询权限不能用于修改、到账或核销。',403);
 if(action==='service-save'){
  const input=parse(serviceSaveSchema,await req.json()),before=input.id?editable(s,m,input.id):null;
  serviceTeam(req,s,m,input);if(before)serviceTeam(req,s,m,before);
  if(before){if(before.customerId!==input.customerId||before.type!==input.type)throw new AppError('已保存记录的客户和业务类型不能改换，请为其他客户或类型新建记录；原记录及历史会保留。');}
  const account=all(s,'customer_account').find(row=>row.id===input.customerId) as CustomerAccount|undefined;
  if(!account?.active||!assignedServiceCustomer(s,m,account))throw new AppError('只能选择客户责任清单中自己跟进的有效客户。',403);
  validateServiceAssignment(s,account.id,input,before);
  const sourceOrder=linkedOrder(s,account,input.orderId);
  if(input.token&&sourceOrder&&!canRead(m,sourceOrder))throw new AppError('没有关联订单的读取权限。',403);
  const requestId=input.token?'service_save_request_'+input.token:'',requestFingerprint=input.token?await sha(canonicalSave(input)):'',prior=requestId?s.records.find(row=>row.id===requestId):undefined;
  if(prior){if(prior.kind!=='service_save_request'||prior.actorId!==m.id||prior.action!=='service-save'||prior.requestFingerprint!==requestFingerprint)throw new AppError('客服保存请求标识已用于其他身份或内容。',409);const currentRecord=editable(s,m,prior.recordId);serviceTeam(req,s,m,currentRecord);return json({ok:true,idempotent:true,record:publicServiceRecord(s,currentRecord)});}
  if(before)current(before,input.version);
  if(input.token&&sourceOrder&&sourceOrder.version!==input.sourceOrderVersion)throw new AppError('关联订单版本已变化，请重新核对来源。',409);
  const validated=parse(serviceDetailsSchemas[input.type],input.details);
  let details:Record<string,string|number>=validated as Record<string,string|number>;
  if(input.type==='customer_profile'&&all(s,'service_record').some(row=>row.id!==before?.id&&row.type==='customer_profile'&&row.customerId===input.customerId))
   throw new AppError('该客户已有联系资料，请修改原资料，避免创建重复档案。',409);
  if(input.type==='shipment'&&input.status==='done'){
   if(!details.shipDate)throw new AppError('完成出货时须填写实际出货日期；包装入仓不能当作已发货。');
   if(input.orderId){
    const order=all(s,'order').find(row=>row.id===input.orderId) as Order;
    const shipped=all(s,'service_record').filter(row=>row.id!==before?.id&&row.type==='shipment'&&row.status==='done'&&row.orderId===order.id)
     .reduce((sum,row)=>sum+Number(row.details.quantity),0);
    if(!Number.isSafeInteger(shipped)||shipped+Number(details.quantity)>order.quantity)
     throw new AppError('该订单累计实际出货数量将超过订单数量；请核对分批出货及重复记录。');
   }
  }
  if(input.type==='receivable'){
   const {amount,...other}=validated as {amount:number;invoiceNo:string;currency:ServiceCurrency;terms:string};details={...other,amountCents:amount};
   const receipts=before?all(s,'service_receipt').filter(row=>row.recordId===before.id):[],received=before?serviceReceivedCents(s,before.id):0;
   if(receipts.length&&(before!.details.currency!==other.currency||before!.details.invoiceNo!==other.invoiceNo))throw new AppError('已有到账或冲销凭证，不能改变币种和发票号；请保留原凭证关联。');
   if(amount<received)throw new AppError('应收金额不能少于已到账净额；请先核对到账凭证。');
   if(input.status==='done'&&amount!==received)throw new AppError('应收尚有余额，不能标记完成。');
   if(input.status==='cancelled'&&received!==0)throw new AppError('已有有效到账，不能取消；请先按实际情况冲销并填写原因。');
   if(all(s,'service_record').some(row=>row.id!==before?.id&&row.type==='receivable'&&row.customerId===input.customerId&&row.status!=='cancelled'
    &&clean(row.details?.invoiceNo).toLowerCase()===other.invoiceNo.toLowerCase()&&row.details?.currency===other.currency))throw new AppError('该客户相同发票号及币种已登记应收，请修改原记录，避免重复应收。',409);
  }
  const {id,version,token,sourceOrderVersion,...fields}=input,at=now(),record:ServiceRecord={...before,...fields,details,id:before?.id||newId('service_record'),kind:'service_record',version:(before?.version||0)+1,
   createdAt:before?.createdAt||at,updatedAt:at,updatedBy:m.name};
  const request=requestId?[{id:requestId,kind:'service_save_request',recordId:record.id,customerId:record.customerId,actorId:m.id,action:'service-save',requestFingerprint,sourceOrderId:record.orderId,sourceOrderVersion:sourceOrder?.version||0,createdAt:at}]:[];
  const next=await persist(s,m,record,before,before?'更新客服业务记录':'新增客服业务记录',request);return json({ok:true,record:publicServiceRecord(next,record)});
 }
 if(action==='service-receipt'){
  const input=parse(serviceReceiptSchema,await req.json()),before=editable(s,m,input.recordId);financial(before);
  const id='service_receipt_'+input.token,requestFingerprint=await fingerprint({action,...input}),repeat=repeatReceipt(s,m,id,requestFingerprint,before);if(repeat)return repeat;
  current(before,input.version);if(before.status==='cancelled')throw new AppError('已取消的应收不能确认到账。');
  if(input.amount>Number(before.details.amountCents)-serviceReceivedCents(s,before.id))throw new AppError('本次到账金额超过未收余额；请核对金额，不能重复或超额核销。');
  const record=advance(before,m),receipt:ServiceReceipt={id,kind:'service_receipt',recordId:record.id,customerId:record.customerId,entryType:'payment',
   amountCents:input.amount,currency:record.details.currency as ServiceCurrency,date:input.date,reference:input.reference,note:input.note,reversesId:'',reason:'',
   actorId:m.id,actor:m.name,createdAt:record.updatedAt,requestFingerprint};
  const next=await persist(s,m,record,before,'客服确认到账并核销',[receipt]);return json({ok:true,record:publicServiceRecord(next,record),receipt:publicServiceReceipt(receipt)});
 }
 if(action==='service-receipt-reverse'){
  const input=parse(serviceReceiptReverseSchema,await req.json()),original=all(s,'service_receipt').find(row=>row.id===input.receiptId) as ServiceReceipt|undefined;
  if(!original||original.entryType!=='payment')throw new AppError('原到账凭证不存在或不是可冲销的到账凭证。',404);
  const before=editable(s,m,original.recordId);financial(before);
  if(original.customerId!==before.customerId||original.currency!==before.details.currency)throw new AppError('原到账凭证与应收客户或币种不一致，请由管理员核对。',409);
  const id='service_receipt_'+input.token,requestFingerprint=await fingerprint({action,...input}),repeat=repeatReceipt(s,m,id,requestFingerprint,before);if(repeat)return repeat;
  current(before,input.version);
  if(all(s,'service_receipt').some(row=>row.entryType==='reversal'&&row.reversesId===original.id))throw new AppError('该到账凭证已经冲销，不得重复冲销。',409);
  const record=advance(before,m);if(record.status==='done')record.status='open';
  const receipt:ServiceReceipt={id,kind:'service_receipt',recordId:record.id,customerId:record.customerId,entryType:'reversal',amountCents:original.amountCents,
   currency:original.currency,date:new Date(Date.parse(record.updatedAt)+8*60*60*1000).toISOString().slice(0,10),reference:original.reference,note:'',reversesId:original.id,reason:input.reason,
   actorId:m.id,actor:m.name,createdAt:record.updatedAt,requestFingerprint};
  const next=await persist(s,m,record,before,'冲销客服到账凭证（保留原凭证）',[receipt]);return json({ok:true,record:publicServiceRecord(next,record),receipt:publicServiceReceipt(receipt)});
 }
 const form=await req.formData(),recordId=String(form.get('recordId')||''),before=editable(s,m,recordId),version=Number(form.get('version'));serviceTeam(req,s,m,before);
 if(!Number.isSafeInteger(version)||version<1)throw new AppError('上传附件时必须提供当前版本号。');current(before,version);
 const file=form.get('file'),note=parse(z.string().trim().max(3000),String(form.get('note')||'')),category=parse(z.enum(['general','reference-image']),form.get('category')??'general');
 if(!(file instanceof File)||file.size===0||file.size>10*1024*1024)throw new AppError('请选择不超过 10 MB 的附件。');
 const extensions:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',
  xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 const ext=file.name.split('.').at(-1)?.toLowerCase()||'';if(!extensions[ext])throw new AppError('附件支持 PDF、PNG、JPG、WebP、GIF、XLS、XLSX 和 DOCX。');
 if(category==='reference-image'&&!imageExtensions[ext])throw new AppError('参考图片仅支持 PNG、JPG、GIF 和 WebP。');
 const filename=file.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,240);if(!filename)throw new AppError('附件名称不能为空。');
 const bytes=await file.arrayBuffer();
 if(category==='reference-image'&&!verifiedImageType(bytes,filename))throw new AppError('参考图片内容与扩展名不一致，请上传有效的 PNG、JPG、GIF 或 WebP 图片。');
 const hash=await sha(bytes);
 const prior=all(s,'service_attachment').find(row=>row.recordId===recordId&&row.hash===hash&&row.filename===filename&&row.note===note&&(row.category||'general')===category) as ServiceAttachment|undefined;
 if(prior)return json({ok:true,idempotent:true,record:publicServiceRecord(s,before),attachment:publicServiceAttachment(prior)});
 const record=advance(before,m),attachment:ServiceAttachment={id:newId('service_attachment'),kind:'service_attachment',recordId,customerId:record.customerId,filename,category,
  fileKey:newId('service_file'),contentType:extensions[ext],size:file.size,hash,note,actorId:m.id,actor:m.name,createdAt:record.updatedAt};
 // New opaque keys make every object immutable. A failed optimistic commit can
 // leave an unreferenced object, but never delete or overwrite a historical one.
 await bucket().put(attachment.fileKey,bytes);
 const next=await persist(s,m,record,before,'新增客服业务附件',[attachment]);return json({ok:true,record:publicServiceRecord(next,record),attachment:publicServiceAttachment(attachment)});
}
