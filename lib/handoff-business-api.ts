import {z} from 'zod';
import {all,canRead,clean,newId,now,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {businessAccess,businessActionSchema,businessDocumentTypes,businessFields,businessGenerateSchema,businessMoneyCents,businessNames,businessOrder,businessOrigin,businessPublic,businessSaveSchema,businessSourceState,businessTotal,canCheckBusiness,type BusinessRow} from './handoff-business';
import {canReadDrawing,type EngineeringDrawing} from './engineering-drawings';
import {canReadSop,type EngineeringSop} from './engineering-sop';
import {canReadServiceRecord,serviceOrderCustomerKeys,publicServiceRecord,type ServiceRecord} from './service-workspace';
import {canReadProject,isProjectTrashed} from './customer-projects';
import {customerProjectFinanceGet} from './customer-project-finance-api';
import {canReadCustomerQuote,publicCustomerQuote,type CustomerQuote} from './customer-quotes';
import {productionAdoption,productionReviewData,productionReviewPost} from './handoff-production-review';
import {businessServiceConfig,businessSettingsPost} from './handoff-business-settings';
import {handoffProductionGate} from './handoff-production-gate';
import {businessPaymentPost} from './handoff-payment-actions';
import {publicFundingHistory} from './handoff-payment-state';
import {assertPaymentRequest,paymentRequestBasis} from './handoff-payment-request';

const prefix='handoff-business-',kinds=['handoff_business_source','handoff_business_document'];
function parse<T extends z.ZodTypeAny>(schema:T,raw:unknown):z.output<T>{const r=schema.safeParse(raw);if(!r.success)throw new AppError(r.error.issues.slice(0,4).map(i=>`${i.path.join('.')}: ${i.message}`).join('；'));return r.data;}
async function digest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function access(s:State,m:Member,r:BusinessRow|{customerId:string;projectId:string;orderId:string},write=false){if(!businessAccess(s,m,r,write))throw new AppError('资料不在当前客户、项目或订单权限内。',403);}
function record(s:State,m:Member,id:string,write=false){const r=s.records.find(r=>r.id===id&&kinds.includes(r.kind)) as BusinessRow|undefined;if(!r)throw new AppError('资料不存在或无权查看。',403);access(s,m,r,write);return r;}
function current(r:BusinessRow,v:number){if(r.version!==v)throw new AppError('资料已有新版本，请刷新核对；本次没有覆盖。',409);}
function sourceRefs(s:State,m:Member,owner:{customerId:string;projectId:string;orderId:string},refs:{id:string;version:number}[],self=''){
 const cycle=(id:string,seen:Set<string>):boolean=>{if(id===self)return true;if(seen.has(id))return true;const next=new Set(seen);next.add(id);const r=s.records.find(r=>r.id===id&&kinds.includes(r.kind));return !!r&&r.sourceRefs.some((ref:{id:string})=>cycle(ref.id,next));};
 return refs.map(ref=>{if(ref.id===self||cycle(ref.id,new Set()))throw new AppError('来源关联不能形成循环');const r=record(s,m,ref.id);current(r,ref.version);if(r.customerId!==owner.customerId||r.orderId!==owner.orderId||r.projectId!==owner.projectId)throw new AppError('所有来源须属于同一客户及同一项目/订单上下文');return structuredClone(r);});
}
function publicHistory(s:State,m:Member,h:Entity){return {...h,snapshot:businessPublic(s,m,h.snapshot)};}
function validateLines(s:State,m:Member,input:{customerId:string;orderId:string;type:string;lines:{orderLineId:string;description:string;quantity:number;unitPrice:string}[]}){
 const refs=new Set<string>();
 for(const line of input.lines){
  if(line.orderLineId){const o=businessOrder(s,m,input.customerId,line.orderLineId),anchor=input.orderId?businessOrder(s,m,input.customerId,input.orderId):null;if(!o||!anchor||o.orderNo!==anchor.orderNo||o.customerPO!==anchor.customerPO)throw new AppError('明细须来自当前客户及同一订单/PO，不能按同名款号混入其他订单。',403);if(refs.has(o.id))throw new AppError('同一订单明细不能重复');refs.add(o.id);if(line.quantity>o.quantity)throw new AppError('明细数量超过原订单数量，请先核对原订单或变更依据');}
  else if(['production_order','production_shipment'].includes(input.type))throw new AppError('生产和出货资料须逐行明确关联原订单明细');
  if(line.unitPrice)businessMoneyCents(line.unitPrice);
 }
}
function validateMembers(s:State,fields:Record<string,string>){
 if(fields.pmcId&&!all(s,'member').some(m=>m.id===fields.pmcId&&m.active&&['pmc','admin'].includes(m.role)))throw new AppError('请选择现有有效 PMC 或管理员');
 if(fields.recipientId&&!all(s,'member').some(m=>m.id===fields.recipientId&&m.active&&m.role==='finance'))throw new AppError('请选择现有有效财务成员');
}
function confirmable(s:State,m:Member,row:BusinessRow){
 if(row.type==='paymentrequest'){if(!row.fields.date||!row.fields.buyer)throw new AppError('请补齐请款日期与买方');assertPaymentRequest(s,m,row);return;}
 const sources=sourceRefs(s,m,row,row.sourceRefs,row.id),f=row.fields;
 if(!row.lines.length||!f.date||!f.buyer)throw new AppError('请补齐单据日期、买方和明细');
 const source=sources.find(r=>r.type===(row.type==='pi'?'po':'production_shipment'));
 if(!source)throw new AppError('PI须有客户PO来源；出货单据须有本批生产出货来源');
 const comparable=(r:BusinessRow,price:boolean)=>r.lines.map(l=>({orderLineId:l.orderLineId,description:l.description,quantity:l.quantity,...(price?{unitPrice:l.unitPrice}:{})}));
 if(JSON.stringify(comparable(row,row.type==='pi'))!==JSON.stringify(comparable(source,row.type==='pi')))throw new AppError('明细须与本次来源逐行一致，请核对生成依据');
 if(row.type==='pi')for(const key of ['currency','buyer','billingAddress','shippingAddress','paymentTerms','depositPercent','tradeTerms','paymentDueDate'])if(f[key]!==source.fields[key])throw new AppError('PI字段与客户PO来源不一致：'+key);
 if(['packing','waybill'].includes(row.type)){
  for(const key of ['shippingAddress','shippingContact','shippingPhone','cartonCount','netWeight','grossWeight','cartonDimensions','cartonDetails'])if(!f[key])throw new AppError('请补齐收货及装箱资料：'+key);
  if(row.lines.some(l=>l.unitPrice))throw new AppError('装箱单和运单资料不得携带价格');
 }else{
  if(!f.currency)throw new AppError('请明确核对商业单据币种');
  for(const key of ['seller','billingAddress','shippingAddress','paymentTerms','tradeTerms'])if(!f[key])throw new AppError('请补齐商业单据字段：'+key);
  if(businessTotal(row)===null)throw new AppError('请逐行核实对客单价');
 }
 if(row.type==='invoice'){
  const pi=sources.find(r=>r.type==='pi'&&r.kind==='handoff_business_document');if(!pi||pi.status!=='checked'||businessSourceState(s,m,pi).sourceChanged)throw new AppError('Invoice须引用当前内容已核对且来源未变化的PI');
  for(const key of ['currency','buyer','seller','billingAddress','paymentTerms','tradeTerms','paymentDueDate'])if(f[key]!==pi.fields[key])throw new AppError('Invoice商业字段须与已核对PI一致：'+key);
  const prior=s.records.filter(r=>r.kind==='handoff_business_document'&&r.id!==row.id&&r.type==='invoice'&&r.status==='checked'&&r.sourceRefs.some((ref:Entity)=>ref.id===pi.id)) as BusinessRow[];
  for(const l of row.lines){const p=pi.lines.filter(p=>p.orderLineId&&p.orderLineId===l.orderLineId);if(p.length!==1||p[0].unitPrice!==l.unitPrice)throw new AppError('Invoice每行须唯一对应PI原订单明细和单价');const used=prior.flatMap(r=>r.lines).filter(v=>v.orderLineId===l.orderLineId).reduce((n,v)=>n+v.quantity,0);if(used+l.quantity>p[0].quantity)throw new AppError('累计已核对Invoice数量超过PI数量');}
 }
}
async function persist(s:State,m:Member,action:string,input:{token:string},item:BusinessRow,before?:BusinessRow,extras:Entity[]=[]){
 const h={id:newId('handoff_business_history'),kind:'handoff_business_history',recordId:item.id,customerId:item.customerId,version:item.version,action,actorId:m.id,actor:m.name,createdAt:item.updatedAt,snapshot:structuredClone(item)};
 const request={id:'handoff_business_request_'+input.token,kind:'handoff_business_request',recordId:item.id,actorId:m.id,action,fingerprint:await digest(input),snapshot:structuredClone(item)};
 await commit(s.revision,[item,h,request,...extras,audit(m,item,before||null,'业务资料 · '+action,'人工资料/草稿')]);return json({ok:true,item:businessPublic(s,m,item)});
}
async function replay(s:State,m:Member,action:string,input:{token:string}){
 const r=s.records.find(r=>r.id==='handoff_business_request_'+input.token);if(!r)return null;
 if(r.kind!=='handoff_business_request'||r.actorId!==m.id||r.action!==action||r.fingerprint!==await digest(input))throw new AppError('操作编号已用于其他内容。',409);
 record(s,m,r.recordId,true);access(s,m,r.snapshot,true);return json({ok:true,idempotent:true,item:businessPublic(s,m,r.snapshot)});
}
function createRow(m:Member,values:Pick<BusinessRow,'kind'|'type'|'customerId'|'projectId'|'orderId'|'number'|'fields'|'lines'|'sourceRefs'|'sourceSnapshots'>,before?:BusinessRow):BusinessRow{
 const at=now();return {...values,id:before?.id||newId(values.kind),version:(before?.version||0)+1,status:'draft',attachmentRefs:before?.attachmentRefs||[],createdAt:before?.createdAt||at,createdById:before?.createdById||m.id,updatedAt:at,updatedBy:m.name} as BusinessRow;
}
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function printHtml(row:BusinessRow,stale:boolean){
 const f=row.fields,packing=['packing','waybill'].includes(row.type),total=packing?null:businessTotal(row);
 const billing=row.type==='paymentrequest'&&row.billingSummary?`<p>PI total: ${escape(row.billingSummary.currency)} ${(row.billingSummary.totalCents/100).toFixed(2)} · Posted net receipts: ${(row.billingSummary.receivedCents/100).toFixed(2)} · Outstanding balance: ${(row.billingSummary.balanceCents/100).toFixed(2)}</p><p>This is a payment request, not a commercial or tax invoice.</p>`:'';
 const metadata=[['Date',f.date],['Buyer',f.buyer],['Seller',f.seller],['Reference',f.reference],['Billing address',f.billingAddress],['Shipping address',f.shippingAddress],['Contact',f.shippingContact],['Phone',f.shippingPhone],['Courier account',f.courierAccount],['Payment terms',f.paymentTerms],['Trade terms',f.tradeTerms],['Payment due',f.paymentDueDate],['Delivery',f.delivery]].filter(([,v])=>v);
 return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(businessNames[row.type])} ${escape(row.number)}</title><style>body{font:14px/1.6 Arial,sans-serif;color:#182d38;max-width:1000px;margin:30px auto;padding:20px}h1{font-size:26px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px;border:1px solid #bbc6cd;text-align:left}pre{white-space:pre-wrap;font:inherit}.draft{border:2px solid #b45309;padding:12px;color:#9a3412}.meta{display:grid;grid-template-columns:170px 1fr;gap:4px 15px}@media print{body{margin:0;padding:10px}}</style><h1>${escape(businessNames[row.type])}</h1><p>${escape(row.number)} · Version ${row.version}</p><p class="draft">${row.status==='checked'?'CONTENTS CHECKED BY RESPONSIBLE SALES — NOT SENT OR ISSUED.':'DRAFT — FOR MANUAL REVIEW. NOT APPROVED, SENT OR ISSUED.'}${stale?' SOURCE HAS CHANGED; RECHECK REQUIRED.':''}</p><div class="meta">${metadata.map(([k,v])=>`<b>${escape(k)}</b><div>${escape(v).replace(/\n/g,'<br>')}</div>`).join('')}</div><table><thead><tr><th>Description / Style</th><th>Quantity</th>${packing?'':'<th>Unit price</th><th>Amount</th>'}</tr></thead><tbody>${row.lines.map(l=>`<tr><td>${escape(l.description)}</td><td>${l.quantity}</td>${packing?'':`<td>${escape(l.unitPrice||'To verify')}</td><td>${l.unitPrice?(businessMoneyCents(l.unitPrice)*l.quantity/100).toFixed(2):'To verify'}</td>`}</tr>`).join('')}</tbody></table><p>Total quantity: ${row.lines.reduce((n,l)=>n+l.quantity,0)}${packing?'':` · ${escape(f.currency)} ${total===null?'To verify':(total/100).toFixed(2)}`}</p>${packing?`<p>Cartons: ${escape(f.cartonCount||'To verify')} · Net weight (kg): ${escape(f.netWeight||'To verify')} · Gross weight (kg): ${escape(f.grossWeight||'To verify')}</p><p>Dimensions: ${escape(f.cartonDimensions)}</p><pre>${escape(f.cartonDetails)}</pre>`:''}${billing}<pre>${escape(f.notes)}</pre><p>Template: ${escape(f.templateLabel||'System draft layout')} · No external channel or carrier has been contacted.</p></html>`;
}

export async function handoffBusinessGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['data','history','print','review-data','file'].map(n=>prefix+n).includes(action))return null;if(!m.active)throw new AppError('账号已停用',403);
 if(action===prefix+'review-data')return json(productionReviewData(s,m));
 const params=new URL(req.url).searchParams;
 if(action===prefix+'file'){
  const a=all(s,'handoff_business_attachment').find(r=>r.id===params.get('id')),owner=a?s.records.find(r=>r.id===a.recordId&&kinds.includes(r.kind)) as BusinessRow|undefined:undefined;
  if(!a||!owner||a.customerId!==owner.customerId||!businessAccess(s,m,owner)&&!productionReviewData(s,m).drawings.some(r=>r.id===owner.id))throw new AppError('附件不存在或当前无权查看',403);
  const object=await bucket().get(a.fileKey);if(!object)throw new AppError('原附件暂不可用，请核实文件存储；附件记录仍保留',404);
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(action!==prefix+'data'){
  const row=record(s,m,params.get('id')||'');
  if(action===prefix+'history')return json({item:businessPublic(s,m,row),fundingHistory:row.type==='production_order'?publicFundingHistory(s,row):[],history:all(s,'handoff_business_history').filter(h=>h.recordId===row.id&&h.customerId===row.customerId&&h.snapshot?.id===row.id&&businessAccess(s,m,h.snapshot)).sort((a,b)=>b.version-a.version).map(h=>publicHistory(s,m,h))});
  if(row.kind!=='handoff_business_document')throw new AppError('请选择业务单据');let printed=row;
  if(params.has('version')){const v=Number(params.get('version'));if(!Number.isSafeInteger(v)||v<1)throw new AppError('版本无效');if(v!==row.version){const h=all(s,'handoff_business_history').find(h=>h.recordId===row.id&&h.version===v&&h.snapshot?.id===row.id);if(!h)throw new AppError('历史版本不存在',404);access(s,m,h.snapshot);printed=h.snapshot;}}
  return new Response(printHtml(printed,businessSourceState(s,m,printed).sourceChanged),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox allow-modals",'X-Content-Type-Options':'nosniff'}});
 }
 const customers=all(s,'customer_account').filter(c=>businessAccess(s,m,{customerId:c.id,projectId:'',orderId:''}));
 const keyMap=new Map<string,string>();for(const c of customers)for(const key of serviceOrderCustomerKeys(s,c as CustomerAccount))keyMap.set(clean(key).toLowerCase(),c.id);
 const orders=(all(s,'order') as Order[]).filter(o=>canRead(m,o)&&keyMap.has(clean(o.customer).toLowerCase())).map(o=>({id:o.id,version:o.version,customerId:keyMap.get(clean(o.customer).toLowerCase()),orderNo:o.orderNo,customerPO:o.customerPO,drawing:o.drawing,color:o.color,lens:o.lens,batch:o.batch,quantity:o.quantity,requestedDate:o.requestedDate,promisedDate:o.promisedDate,stage:o.stage,workflowStatus:o.workflowStatus}));
 const sourceRows=(s.records.filter(r=>kinds.includes(r.kind)) as BusinessRow[]).filter(r=>businessAccess(s,m,r));
 const drawings=(all(s,'engineering_drawing') as EngineeringDrawing[]).filter(r=>canReadDrawing(s,m,r)).map(r=>({id:r.id,customerId:r.customerId,version:r.version,modelNo:r.modelNo,drawingType:r.drawingType,status:r.status,approval:r.approval,assignee:r.assignee,deadline:r.deadline,requirement:r.requirement}));
 const sops=(all(s,'engineering_sop') as EngineeringSop[]).filter(r=>canReadSop(s,m,r)).map(r=>({id:r.id,customerId:r.customerId,drawingRecordId:r.drawingRecordId,modelNo:r.modelNo,targetVersion:r.targetVersion,status:r.status,version:r.version}));
 const pmcOrders=(all(s,'order') as Order[]).filter(o=>canRead(m,o)).map(o=>({id:o.id,orderNo:o.orderNo,drawing:o.drawing,color:o.color,customer:o.customer,quantity:o.quantity,stage:o.stage,workflowStatus:o.workflowStatus,materialStatus:o.materialStatus,scheduleStatus:o.scheduleStatus,productionStartDate:o.productionStartDate,productionFinishDate:o.productionFinishDate,promisedDate:o.promisedDate,exceptionReason:o.exceptionReason,version:o.version,productionGate:handoffProductionGate(s,m,o)}));
 const orderIds=new Set(pmcOrders.map(o=>o.id));const factory=all(s,'factory_order').filter(r=>orderIds.has(r.lineId)).map(r=>({id:r.id,lineId:r.lineId,version:r.version,status:r.status,createdAt:r.createdAt}));
 const service=(all(s,'service_record') as ServiceRecord[]).filter(r=>['shipment','receivable'].includes(r.type)&&canReadServiceRecord(s,m,r)).map(r=>publicServiceRecord(s,r));
 const financeResponse=await customerProjectFinanceGet('project-finance-data',new Request(new URL('/api/workspace/project-finance-data',req.url)),s,m),finance=financeResponse?await financeResponse.json():{};
 const quotes=(all(s,'customer_quote') as CustomerQuote[]).filter(q=>canReadCustomerQuote(s,m,q)).map(q=>{const safe=publicCustomerQuote(s,m,q);return {id:q.id,customerId:q.customerAccountId,quoteNo:q.quoteNo,version:q.version,status:q.status,currency:q.currency,lines:safe.lines};});
 const attachments=all(s,'handoff_business_attachment').filter(a=>sourceRows.some(r=>r.id===a.recordId&&r.customerId===a.customerId)).map(({fileKey,...a})=>a);
 const serviceConfig=businessServiceConfig(s);
 return json({revision:s.revision,serviceConfig:m.role==='admin'||sourceRows.length||drawings.length?serviceConfig:{...serviceConfig,drawingRoot:'',quoteRoot:''},items:sourceRows.map(r=>({...businessPublic(s,m,r),...(r.type==='engineering_drawing'?{productionAdoption:productionAdoption(s,r)}:{})})),attachments,customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,canWrite:businessAccess(s,m,{customerId:c.id,projectId:'',orderId:''},true),canReadEngineeringQuote:businessAccess(s,m,{customerId:c.id,projectId:'',orderId:'',type:'engineering_quote'}),canWriteEngineeringQuote:businessAccess(s,m,{customerId:c.id,projectId:'',orderId:'',type:'engineering_quote'},true)})),orders,projects:all(s,'customer_project').filter(p=>!isProjectTrashed(p)&&canReadProject(s,m,p)&&customers.some(c=>c.id===p.customerId)).map(p=>({id:p.id,customerId:p.customerId,title:p.title,code:p.code})),members:all(s,'member').filter(r=>r.active&&['pmc','admin','finance'].includes(r.role)).map(r=>({id:r.id,name:r.name,role:r.role,...(r.role==='finance'?{readableCustomerIds:customers.filter(c=>businessAccess(s,r as Member,{customerId:c.id,orderId:'',projectId:''})).map(c=>c.id),readableOrderIds:orders.filter(o=>businessAccess(s,r as Member,{customerId:o.customerId!,orderId:o.id,projectId:''})).map(o=>o.id),readableProjectIds:all(s,'customer_project').filter(p=>!isProjectTrashed(p)&&customers.some(c=>c.id===p.customerId)&&businessAccess(s,r as Member,{customerId:p.customerId,orderId:'',projectId:p.id})).map(p=>p.id)}:{})})),queues:{drawings,sops,orders:pmcOrders,factory,service,finance,quotes},capabilities:{canConfirm:true,canSend:false,canChangeFinance:false,canReleaseProduction:false}});
}

export async function handoffBusinessPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const declared=await businessPaymentPost(action,req,s,m);if(declared)return declared;
 const configured=await businessSettingsPost(action,req,s,m);if(configured)return configured;
 const reviewed=await productionReviewPost(action,req,s,m);if(reviewed)return reviewed;
 if(!['save','submit','return','generate','confirm','attachment'].map(n=>prefix+n).includes(action))return null;if(!m.active)throw new AppError('账号已停用',403);
 if(action===prefix+'attachment'){
  const form=await req.formData(),keys=[...form.keys()];if(new Set(keys).size!==keys.length||keys.some(k=>!['token','id','expectedVersion','file','note'].includes(k)))throw new AppError('附件请求含未知或重复字段');
  const input=parse(businessActionSchema,{token:form.get('token'),id:form.get('id'),expectedVersion:Number(form.get('expectedVersion')),note:String(form.get('note')||'')}),before=record(s,m,input.id,true),file=form.get('file');
  if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请选择一个非空且不超过10 MB的文件');
  const ext=file.name.split('.').at(-1)?.toLowerCase();if(!ext||!['pdf','png','jpg','jpeg','webp','gif','xlsx','xls','docx','txt','eml','step','stp','stl','igs','iges','dxf','dwg','3dm'].includes(ext))throw new AppError('附件类型不支持');
  const bytes=await file.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join(''),filename=file.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,240),requestInput={...input,hash,filename,size:file.size};
  const repeated=await replay(s,m,action,requestInput);if(repeated)return repeated;current(before,input.expectedVersion);
  const item={...before,version:before.version+1,status:'draft',updatedAt:now(),updatedBy:m.name} as BusinessRow;
  const attachment={id:newId('handoff_business_attachment'),kind:'handoff_business_attachment',recordId:before.id,customerId:before.customerId,sourceVersion:item.version,filename,size:file.size,hash,note:input.note,fileKey:newId('handoff_business_file'),createdAt:item.updatedAt,actorId:m.id,actor:m.name};
  item.attachmentRefs=[...(before.attachmentRefs||[]),{id:attachment.id,hash}];
  // Opaque immutable objects are never overwritten or deleted. A failed commit cannot damage an older file.
  await bucket().put(attachment.fileKey,bytes);return persist(s,m,action,requestInput,item,before,[attachment]);
 }
 const raw=await req.text();if(raw.length>250000)throw new AppError('内容过大');let body:unknown;try{body=JSON.parse(raw);}catch{throw new AppError('请求格式无效');}
 if(action===prefix+'save'){
  const input=parse(businessSaveSchema,body);access(s,m,input,true);const before=input.id?record(s,m,input.id,true):undefined;
  if(before&&[before.customerId,before.projectId,before.orderId,before.kind,before.type].join('\u001f')!==[input.customerId,input.projectId,input.orderId,'handoff_business_'+input.kind,input.type].join('\u001f'))throw new AppError('已登记资料不能更换客户、项目、订单或类型；请保留原资料另建。',409);
  const repeated=await replay(s,m,action,input);if(repeated)return repeated;if(before)current(before,input.expectedVersion!);
  let fields:Record<string,string>;try{fields=businessFields(input.type,input.kind,input.fields);}catch(e){throw new AppError((e as Error).message);}
  if(!input.orderId&&['po','production_order','production_shipment','finance_file','finance_request'].includes(input.type))throw new AppError('该业务资料须明确关联现有订单');
  if(['po','production_order','production_shipment'].includes(input.type)&&!input.lines.length)throw new AppError('至少填写一条款号/数量明细');
  validateLines(s,m,input);validateMembers(s,fields);
  if(fields.recipientId){const recipient=all(s,'member').find(r=>r.id===fields.recipientId) as Member|undefined;if(!recipient||!businessAccess(s,recipient,input))throw new AppError('拟接收财务目前没有此客户、项目或订单资料的读取权限，请先核实授权；资料不会自动派送',403);}
  if(fields.receivableId){const receivable=all(s,'service_record').find(r=>r.id===fields.receivableId&&r.type==='receivable'&&r.status!=='cancelled');if(!receivable||receivable.customerId!==input.customerId||receivable.orderId!==input.orderId||!canReadServiceRecord(s,m,receivable))throw new AppError('请选择同一客户及明确原订单下当前有权查看的应收账款',403);}
  for(const key of ['linkedDrawingId','engineeringTaskId'])if(fields[key]){const drawing=all(s,'engineering_drawing').find(r=>r.id===fields[key]) as EngineeringDrawing|undefined;if(!drawing||drawing.customerId!==input.customerId||!canReadDrawing(s,m,drawing))throw new AppError('所关联工程任务须属于当前客户并在权限内',403);}
  if(fields.piId){const pi=record(s,m,fields.piId);if(pi.type!=='pi'||pi.customerId!==input.customerId||pi.orderId!==input.orderId||pi.projectId!==input.projectId)throw new AppError('所关联PI须属于同一客户、项目和订单');}
  if(s.records.some(r=>kinds.includes(r.kind)&&r.id!==before?.id&&r.customerId===input.customerId&&r.type===input.type&&clean(r.number).toLowerCase()===clean(input.number).toLowerCase()))throw new AppError('此客户同类编号已存在，请更新原资料。',409);
  const sources=sourceRefs(s,m,input,input.sourceRefs,before?.id);
  if(new Set(input.originRefs.map(r=>r.id)).size!==input.originRefs.length)throw new AppError('原资料不能重复关联');
  if(before&&(before.originRefs||[]).some((ref:Entity)=>!input.originRefs.some(r=>r.id===ref.id&&r.kind===ref.kind)))throw new AppError('已关联原资料不能移除；请保留来源并建立修订',409);
  const origins=input.originRefs.map(ref=>{const live=businessOrigin(s,m,input,ref);if(!live)throw new AppError('原资料归属或权限不符，不能关联',403);if(live.version!==ref.version)throw new AppError('原资料已有新版本，请重新核对归类',409);return live;});
  const item=createRow(m,{kind:('handoff_business_'+input.kind) as BusinessRow['kind'],type:input.type,customerId:input.customerId,projectId:input.projectId,orderId:input.orderId,number:input.number,fields,lines:input.lines,sourceRefs:input.sourceRefs,sourceSnapshots:sources},before);businessTotal(item);
  item.originRefs=input.originRefs;item.originSnapshots=origins;if(before?.billingSummary)item.billingSummary=structuredClone(before.billingSummary);
  return persist(s,m,action,input,item,before);
 }
 if(action===prefix+'generate'){
  const input=parse(businessGenerateSchema,body),source=record(s,m,input.sourceId,true);const repeated=await replay(s,m,action,input);if(repeated)return repeated;current(source,input.sourceVersion);
  if(s.records.some(r=>r.kind==='handoff_business_document'&&r.id!==input.targetId&&r.customerId===source.customerId&&r.type===input.type&&clean(r.number).toLowerCase()===input.number.toLowerCase()))throw new AppError('单据号已存在，请编辑现有单据',409);
  if(input.type==='paymentrequest'){
   const basis=paymentRequestBasis(s,m,source),before=input.targetId?record(s,m,input.targetId,true):undefined;
   if(before){current(before,input.expectedVersion!);if(before.type!=='paymentrequest'||before.kind!=='handoff_business_document'||before.customerId!==source.customerId||before.projectId!==source.projectId||before.orderId!==source.orderId)throw new AppError('只能更新同一客户、项目和订单的原请款',409);}
   if(s.records.some(r=>r.kind==='handoff_business_document'&&r.type==='paymentrequest'&&r.id!==before?.id&&r.customerId===source.customerId&&r.projectId===source.projectId&&r.orderId===source.orderId))throw new AppError('本订单已有请款，请按最新依据更新原请款，避免重复催款',409);
   const fields=businessFields('paymentrequest','document',{...source.fields,date:now().slice(0,10),reference:source.number+' / '+basis.pi.number,notes:'This is a payment request, not a commercial or tax invoice. Based only on the explicitly linked receivable and posted receipts; unposted vouchers and sales declarations are not receipts.'});
   const item=createRow(m,{kind:'handoff_business_document',type:'paymentrequest',customerId:source.customerId,projectId:source.projectId,orderId:source.orderId,number:input.number,fields,lines:[{orderLineId:'',description:'Outstanding balance on '+source.number,quantity:1,unitPrice:(basis.summary.balanceCents/100).toFixed(2)}],sourceRefs:basis.sources.map(r=>({id:r.id,version:r.version})),sourceSnapshots:structuredClone(basis.sources)},before);
   item.billingSummary=basis.summary;item.originRefs=[{id:basis.receivable.id,kind:'service_record',version:basis.receivable.version}];item.originSnapshots=item.originRefs.map((ref:Entity)=>businessOrigin(s,m,item,ref as never));
   return persist(s,m,action,input,item,before);
  }
  if(input.type==='pi'&&source.type!=='po'||['packing','waybill','invoice'].includes(input.type)&&source.type!=='production_shipment')throw new AppError('PI须引用客户PO；物流单据须引用生产出货批次');
  let fields:Record<string,string>=businessFields(input.type,'document',{currency:source.fields.currency||'',...Object.fromEntries(Object.entries(source.fields).filter(([k])=>['date','currency','buyer','seller','billingAddress','shippingAddress','paymentTerms','depositPercent','tradeTerms','paymentDueDate','delivery','shippingContact','shippingPhone','courierAccount','cartonCount','netWeight','grossWeight','cartonDimensions','cartonDetails'].includes(k))),reference:source.number}),lines=structuredClone(source.lines),sources=[source];
  if(input.type==='invoice'){
   const pi=record(s,m,input.piId);if(pi.type!=='pi'||pi.kind!=='handoff_business_document'||pi.customerId!==source.customerId||pi.orderId!==source.orderId||pi.projectId!==source.projectId||input.piVersion!==pi.version)throw new AppError('请选择同一订单当前版本的PI资料');if(businessSourceState(s,m,pi).sourceChanged)throw new AppError('PI来源已有变化，须先核对更新');
   fields={...pi.fields,...fields,currency:pi.fields.currency,buyer:pi.fields.buyer,seller:pi.fields.seller,billingAddress:pi.fields.billingAddress,paymentTerms:pi.fields.paymentTerms,tradeTerms:pi.fields.tradeTerms,paymentDueDate:pi.fields.paymentDueDate};
   lines=lines.map(l=>{const matches=pi.lines.filter(p=>!!l.orderLineId&&p.orderLineId===l.orderLineId);if(matches.length!==1||!matches[0].unitPrice)throw new AppError('每条出货明细须唯一对应PI订单明细且单价已填写');if(l.quantity>matches[0].quantity)throw new AppError('本批数量超过PI数量');return {...l,unitPrice:matches[0].unitPrice};});sources.push(pi);
  }
  if(['packing','waybill'].includes(input.type))lines=lines.map(l=>({...l,unitPrice:''}));
  const item=createRow(m,{kind:'handoff_business_document',type:input.type,customerId:source.customerId,projectId:source.projectId,orderId:source.orderId,number:input.number,fields,lines,sourceRefs:sources.map(r=>({id:r.id,version:r.version})),sourceSnapshots:structuredClone(sources)});businessTotal(item);return persist(s,m,action,input,item);
 }
 const input=parse(businessActionSchema,body),before=record(s,m,input.id,true);
 if(action===prefix+'confirm'&&!canCheckBusiness(s,m,before))throw new AppError('只有当前指定负责销售可核对或重放内容核对操作。',403);
 const repeated=await replay(s,m,action,input);if(repeated)return repeated;current(before,input.expectedVersion);
 if(action===prefix+'confirm'){
  if(!canCheckBusiness(s,m,before))throw new AppError('只有该客户或项目当前指定负责销售可以核对单据内容。',403);
  if(before.status!=='pending_check')throw new AppError('请先提交当前单据版本待核对',409);
  if(businessSourceState(s,m,before).sourceChanged)throw new AppError('来源已变化，请更新草稿再提交',409);confirmable(s,m,before);
  const item={...before,status:'checked',version:before.version+1,updatedAt:now(),updatedBy:m.name,checkedById:m.id,checkedBy:m.name,checkedAt:now(),checkNote:input.note,checkedBasisVersion:before.version} as BusinessRow;return persist(s,m,action,input,item,before);
 }
 if(action===prefix+'submit'&&before.status!=='draft')throw new AppError('只有草稿可提交资料待核对',409);
 if(action===prefix+'return'&&before.status!=='pending_check')throw new AppError('只有待核对资料可以撤回修改',409);
 if(businessSourceState(s,m,before).sourceChanged)throw new AppError('来源版本已有变化，请先保存更新来源后再提交',409);
 const item={...before,status:action===prefix+'submit'?'pending_check':'draft',version:before.version+1,updatedAt:now(),updatedBy:m.name,submissionNote:input.note} as BusinessRow;return persist(s,m,action,input,item,before);
}
