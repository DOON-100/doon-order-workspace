import {z} from 'zod';
import {all,broad,canRead,clean,newId,now,productTypeOf,strictDate,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {detectHeader,makeWorkbook,openWorkbook,sheetRows} from './workbooks';
import {factoryWorkbook,inspectFactoryTemplate,readFactoryRows} from './factory-order-workbook';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {serviceOrderCustomerKeys} from './service-workspace';

const excelType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const roles=(m:Member)=>broad(m)||m.role==='sales';
const manageCustomers=(m:Member)=>broad(m)||m.role==='admin';
function requireResponsibilityAdministrator(m:Member,before:Entity|undefined,next:{salesName:string;serviceName:string;pmcName:string;active?:boolean}){
 if(m.role==='admin')return;
 if((['salesName','serviceName','pmcName'] as const).some(k=>clean(before?.[k])!==clean(next[k])))throw new AppError('客户责任人变更须由管理员确认并操作；你仍可维护其他客户资料。',403);
 // Re-enabling a disabled responsibility mapping also restores its quotation access.
 if(before?.active===false&&next.active!==false)throw new AppError('重新启用客户责任关系须由管理员确认。',403);
}
const safe=(name:string)=>name.replace(/[\\/\r\n]/g,'_').slice(0,180);
function download(body:BodyInit,name:string){return new Response(body,{headers:{'Content-Type':excelType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
const responsibilityKey=(value:unknown)=>clean(value).toLowerCase();
function assigned(s:State,account:CustomerAccount|undefined,m:Member,side:'sales'|'service'|'pmc'){
 if(!m.active)return false;
 if(broad(m))return true;
 if(m.role!=='sales'||!account?.active||side==='pmc')return false;
 const policy=customerQuoteAccessPolicy(s),aliases=policy&&Object.prototype.hasOwnProperty.call(policy.aliasesByMember,m.id)?policy.aliasesByMember[m.id]:[];
 const names=new Set([m.name,...aliases].map(responsibilityKey).filter(Boolean));
 return names.has(responsibilityKey(side==='sales'?account.salesName:account.serviceName));
}
// Build the explicit identity index once per immutable request snapshot. Exports
// may resolve the same account for many cells; they must not rescan every record.
const accountIndexes=new WeakMap<State,{accounts:CustomerAccount[];keys:Map<string,string[]>;byIdentity:Map<string,CustomerAccount|null>}>();
function accountIndex(s:State){
 const cached=accountIndexes.get(s);if(cached)return cached;
 const accounts=all(s,'customer_account') as CustomerAccount[],keys=new Map<string,string[]>(),byIdentity=new Map<string,CustomerAccount|null>();
 for(const account of accounts){
  const identities=serviceOrderCustomerKeys(s,account);keys.set(account.id,identities);
  for(const identity of identities){const key=responsibilityKey(identity),prior=byIdentity.get(key);byIdentity.set(key,prior===undefined||prior?.id===account.id?account:null);}
 }
 const index={accounts,keys,byIdentity};accountIndexes.set(s,index);return index;
}
function accountFor(s:State,customer:string){return accountIndex(s).byIdentity.get(responsibilityKey(customer))||undefined;}
// Customer-master editing keeps exact-name semantics. A supplied customer code
// must never silently select and rename another existing master record.
function customerAccountByName(s:State,customer:string){return all(s,'customer_account').find(v=>responsibilityKey(v.customer)===responsibilityKey(customer)) as CustomerAccount|undefined;}
export function collaborationAssignments(s:State,m:Member){
 if(!m.active)return [];
 const index=accountIndex(s);
 return index.accounts.map(account=>({customerId:account.id,orderKeys:index.keys.get(account.id)||[],
  sales:assigned(s,account,m,'sales'),service:assigned(s,account,m,'service'),pmc:broad(m)}))
  .filter(row=>row.sales||row.service||row.pmc);
}
function orderFor(s:State,id:string){const o=all(s,'order').find(v=>v.id===id) as Order|undefined;if(!o)throw new AppError('订单不存在。',404);return o;}
function customerRows(bytes:ArrayBuffer){const book=openWorkbook(bytes),sheetName=book.SheetNames[0];let header=1;for(let i=1;i<=30;i++){const h=sheetRows(book,sheetName,i).headers.map(clean);if(h.some(v=>['客户','客户名称'].includes(v))&&h.some(v=>['业务员','业务负责人','业务'].includes(v))){header=i;break;}}const {headers,body}=sheetRows(book,sheetName,header);const find=(names:string[])=>headers.findIndex(h=>names.includes(clean(h))),indexes={customer:find(['客户','客户名称']),customerCode:find(['客户编码','客户代码']),salesName:find(['业务员','业务负责人','业务']),serviceName:find(['客服','客服负责人']),pmcName:find(['PMC','PMC跟进人']),notes:find(['备注','说明'])};for(const k of ['customer','salesName','serviceName','pmcName'] as const)if(indexes[k]<0)throw new AppError(`客户清单缺少“${{customer:'客户',salesName:'业务员',serviceName:'客服',pmcName:'PMC'}[k]}”列。`);return body.map(r=>({customer:clean(r.values[indexes.customer]),customerCode:indexes.customerCode<0?'':clean(r.values[indexes.customerCode]),salesName:clean(r.values[indexes.salesName]),serviceName:clean(r.values[indexes.serviceName]),pmcName:clean(r.values[indexes.pmcName]),notes:indexes.notes<0?'':clean(r.values[indexes.notes])})).filter(r=>r.customer);}

export async function collaborationGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action==='factory-order-table-export'){
  if(!roles(m))throw new AppError('无权导出内部订单。',403);
  const ids=new URL(req.url).searchParams.getAll('lineId');if(!ids.length||ids.length>500||new Set(ids).size!==ids.length)throw new AppError('请选择1至500条明细。');
  const orders=ids.map(id=>orderFor(s,id));if(orders.some(o=>!canRead(m,o)))throw new AppError('选择中包含无权读取的订单。',403);
  const latest=new Map<string,Entity>();for(const v of all(s,'factory_order'))if(!latest.has(v.lineId)||latest.get(v.lineId)!.version<v.version)latest.set(v.lineId,v);
  const template=all(s,'collaboration_template').filter(t=>t.templateType==='factory-order'&&t.customer===orders[0].customer).at(-1);
  let bytes:ArrayBuffer|undefined;if(template){const f=await bucket().get(template.fileKey);if(!f)throw new AppError('内部订单模板文件缺失。');bytes=await new Response(f.body).arrayBuffer();}
  const reference=clean(new URL(req.url).searchParams.get('reference')||template?.reference);const projected=orders.map(o=>reference?{...o,extra:{...o.extra,'翻单参考':reference}}:o);
  return download(factoryWorkbook(projected,latest,bytes),`中英内部订单_${safe(orders[0].orderNo)}_${safe(orders[0].customerPO)}.xlsx`);
 }
 if(action==='factory-order-templates'){if(!roles(m))throw new AppError('无权查看模板。',403);return json({templates:all(s,'collaboration_template').filter(t=>t.templateType==='factory-order'&&(broad(m)||m.customers.includes(t.customer))).map(t=>({customer:t.customer,filename:t.filename}))});}
 if(action==='factory-orders'){const ids=new Set((all(s,'order') as Order[]).filter(o=>canRead(m,o)).map(o=>o.id));return json({items:all(s,'factory_order').filter(v=>ids.has(v.lineId))});}
 if(action==='customer-template'){if(!roles(m))throw new AppError('无权下载客户清单模板。',403);return download(makeWorkbook([], '客户责任清单',['客户','客户编码','业务员','客服','PMC','备注']),'客户责任清单模板.xlsx');}
 if(action==='kingdee-export'){
  if(!roles(m))throw new AppError('无权生成金蝶导入表。',403);const ids=new URL(req.url).searchParams.getAll('id').slice(0,1000),orders=(all(s,'order') as Order[]).filter(o=>ids.length?ids.includes(o.id):['PMC已排期','生产中'].includes(o.workflowStatus||''));
  const template=all(s,'collaboration_template').filter(v=>v.templateType==='kingdee').at(-1);if(!template)throw new AppError('请先上传标准金蝶订单导入模板。');
  const value=(h:string,o:Order)=>{const a=accountFor(s,o.customer),key=clean(h).replace(/\s/g,'').toLowerCase();if(['客户编码','客户代码'].includes(key))return a?.customerCode||'';if(['客户','客户名称'].includes(key))return o.customer;if(['订单号','销售订单号'].includes(key))return o.orderNo;if(['客户po','客户订单号'].includes(key))return o.customerPO;if(['产品编码','物料编码'].includes(key))return o.productCode||'';if(key==='产品类型')return productTypeOf(o);if(['型号/图号','图纸编号','图号','型号'].includes(key))return o.drawing;if(['色号','颜色'].includes(key))return o.color;if(key.includes('镜片'))return o.lens;if(['数量','订单数量'].includes(key))return o.quantity;if(['交货日期','要求交货日期','交期'].includes(key))return o.promisedDate||o.requestedDate;if(['特殊要求','备注'].includes(key))return o.specialRequirements||o.notes||'';if(key==='业务员')return o.salesName||a?.salesName||'';if(key==='客服')return o.serviceName||a?.serviceName||'';if(key==='pmc')return o.pmcName||a?.pmcName||'';return '';},columns=(template.headers||[]).filter(Boolean);if(!columns.length)throw new AppError('金蝶模板没有可识别的表头。');const rows=orders.map(o=>Object.fromEntries(columns.map((h:string)=>[h,value(h,o)])));
  return download(makeWorkbook(rows,template.sheet||'金蝶订单导入',columns),`金蝶订单导入_${now().slice(0,10)}.xlsx`);
 }
 if(action==='factory-order-export'){
  if(!roles(m))throw new AppError('无权导出工厂内部订单。',403);const id=new URL(req.url).searchParams.get('id'),item=all(s,'factory_order').find(v=>v.id===id);if(!item)throw new AppError('内部订单版本不存在。',404);const o=orderFor(s,item.lineId);if(!canRead(m,o))throw new AppError('无权导出该订单。',403);const files=all(s,'attachment').filter(v=>v.lineId===o.id).map(v=>v.filename).join('、');const rows=[{'客户':o.customer,'客户 PO':o.customerPO,'订单号':o.orderNo,'产品类型':productTypeOf(o),'图纸编号':o.drawing,'客款号':o.extra?.['客款号']||'','客色号':o.color,'客户英文原文':item.sourceEnglish,'工厂中文工艺':item.chineseProcess,'板料规格':item.materialSpec,'电镀规格':item.platingSpec,'镜片规格':item.lensSpec||o.lens,'数量':o.quantity,'交期':o.promisedDate||o.requestedDate,'特殊要求':o.specialRequirements||'','生产资料附件':files,'版本':`R${item.version}`,'状态':item.status,'客服确认':item.serviceConfirmedBy||'','PMC确认':item.pmcConfirmedBy||''}];return download(makeWorkbook(rows,'中英对照内部订单'),`工厂内部订单_${safe(o.orderNo)}_R${item.version}.xlsx`);
 }
 return null;
}

export async function collaborationPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action==='factory-order-template'){
  if(!roles(m))throw new AppError('无权维护订单模板。',403);const form=await req.formData(),file=form.get('file'),customer=clean(form.get('customer'));
  if(!customer||(!broad(m)&&!m.customers.includes(customer)))throw new AppError('请填写你负责的客户。',403);
  if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!/\.xlsx$/i.test(file.name))throw new AppError('请上传不超过10 MB的xlsx模板。');
  const bytes=await file.arrayBuffer();inspectFactoryTemplate(bytes);const item={id:newId('template'),kind:'collaboration_template',templateType:'factory-order',customer,reference:clean(form.get('reference')),filename:safe(file.name),fileKey:newId('factory_template'),actor:m.name,createdAt:now()};await bucket().put(item.fileKey,bytes);await commit(s.revision,[item,audit(m,item,null,'上传中英内部订单模板')]);return json({ok:true});
 }
 if(action==='factory-order-table-preview'){
  if(!roles(m))throw new AppError('无权导入内部订单。',403);const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过10 MB的Excel。');
  const rows=readFactoryRows(await file.arrayBuffer(),{customer:clean(form.get('customer')),orderNo:clean(form.get('orderNo')),customerPO:clean(form.get('customerPO')),reference:clean(form.get('reference'))}),seen=new Set<string>();
  const parsed=rows.map(r=>{
   if(!r.customer||!r.orderNo||!r.lens||!Number.isSafeInteger(r.quantity)||r.quantity<=0||r.quantity>10000000)throw new AppError(`第${r.index}行缺少客户、订单号、镜片或有效大货数量。`);
   if(r.requestedDate)try{r.requestedDate=strictDate(r.requestedDate);}catch{throw new AppError(`第${r.index}行交期须为有效的YYYY-MM-DD日期。`);}
   const key=JSON.stringify([r.orderNo,r.drawing,r.color,r.lens,r.batch]);if(seen.has(key))throw new AppError(`第${r.index}行业务明细重复。`);seen.add(key);
   const matches=(all(s,'order') as Order[]).filter(o=>r.lineId?o.id===r.lineId:JSON.stringify([o.orderNo,o.drawing,o.color,o.lens,o.batch])===key);
   if(matches.length>1||(r.lineId&&!matches.length))throw new AppError(`第${r.index}行明细编号不明确。`);const before=matches[0];
   if(before&&!canRead(m,before)||!before&&!broad(m)&&!m.customers.includes(r.customer))throw new AppError('文件包含无权维护的客户订单。',403);
   if(before?.lifecycle==='archived')throw new AppError(`第${r.index}行已归档，不能导入新草稿。`);
   // Changing source quantities or identities requires the normal source-order workflow.
   if(before&&[before.customer,before.orderNo,before.customerPO,before.drawing,before.color,before.lens,before.quantity,before.requestedDate,before.batch].join('\u001f')!==[r.customer,r.orderNo,r.customerPO,r.drawing,r.color,r.lens,r.quantity,r.requestedDate,r.batch].join('\u001f'))throw new AppError(`第${r.index}行源订单字段已变化，请在订单表导入入口核对后更新。`);
   const prior=all(s,'factory_order').filter(v=>v.lineId===before?.id).sort((a,b)=>b.version-a.version)[0];
   if(r.orderVersion&&Number(r.orderVersion)!==before?.version||r.factoryVersion&&Number(r.factoryVersion)!==(prior?.version||0))throw new AppError(`第${r.index}行已过期，请重新导出。`,409);
   const o:Order=before||{id:newId('line'),kind:'order',version:1,createdAt:now(),updatedAt:now(),updatedBy:m.name,source:safe(file.name),orderNo:r.orderNo,customer:r.customer,customerPO:r.customerPO,drawing:r.drawing,color:r.color,lens:r.lens,quantity:r.quantity,batch:r.batch,requestedDate:r.requestedDate,ownerEmail:m.role==='sales'?m.email:'',stage:'待下达',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:r.notes,sourceStatus:'待正式订单确认',workflowStatus:'业务待提交',extra:r.extra};
   const item={id:newId('factory_order'),kind:'factory_order',lineId:o.id,version:(prior?.version||0)+1,priorId:prior?.id||'',sourceEnglish:r.sourceEnglish,chineseProcess:r.chineseProcess,materialSpec:r.materialSpec,platingSpec:r.platingSpec,lensSpec:r.lensSpec,materialImageConfirmed:false,status:'待客服确认',action:'draft',createdAt:now(),createdBy:m.name};
   return {index:r.index,order:o,item,expectedOrderVersion:before?.version||0,expectedFactoryVersion:prior?.version||0,isNew:!before};
  });const job={id:newId('factory_import'),kind:'factory_import',actorId:m.id,filename:safe(file.name),rows:parsed,status:'待确认',createdAt:now()};await commit(s.revision,[job]);return json({id:job.id,rows:parsed.map(r=>({index:r.index,orderNo:r.order.orderNo,drawing:r.order.drawing,color:r.order.color,quantity:r.order.quantity,sourceEnglish:r.item.sourceEnglish,chineseProcess:r.item.chineseProcess,status:r.isNew?'新增订单及草稿':'更新双语草稿'}))});
 }
 if(action==='factory-order-table-commit'){
  if(!roles(m))throw new AppError('无权导入内部订单。',403);const {id}=z.object({id:z.string()}).parse(await req.json()),job=s.records.find(r=>r.kind==='factory_import'&&r.id===id);if(!job||job.actorId!==m.id)throw new AppError('导入预览不存在或不属于你。',403);if(job.status==='已提交')return json({ok:true,count:job.rows.length,repeated:true});const updates:Entity[]=[];
  for(const r of job.rows){const before=all(s,'order').find(o=>o.id===r.order.id) as Order|undefined,prior=all(s,'factory_order').filter(v=>v.lineId===r.order.id).sort((a,b)=>b.version-a.version)[0];
   if(before&&!canRead(m,before)||!before&&!broad(m)&&!m.customers.includes(r.order.customer))throw new AppError('订单权限已变化。',403);
   if((before?.version||0)!==r.expectedOrderVersion||(prior?.version||0)!==r.expectedFactoryVersion||!before&&all(s,'order').some(o=>[o.orderNo,o.drawing,o.color,o.lens,o.batch].join('|')===[r.order.orderNo,r.order.drawing,r.order.color,r.order.lens,r.order.batch].join('|')))throw new AppError('预览后订单已变化，请重新上传核对。',409);
   if(!before)updates.push(r.order,audit(m,r.order,null,'表格导入内部订单',job.filename));updates.push(r.item,audit(m,r.item,prior||null,'表格保存双语草稿',job.filename));
  }updates.push({...job,status:'已提交',submittedAt:now()});await commit(s.revision,updates);return json({ok:true,count:job.rows.length});
 }
 if(action==='customer-import'){
  if(!manageCustomers(m))throw new AppError('仅管理员或 PMC 可导入客户责任清单。',403);const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的 Excel 客户清单。');const rows=customerRows(await file.arrayBuffer()),seen=new Set<string>(),updates:Entity[]=[];
  for(const row of rows){const key=row.customer.toLowerCase();if(seen.has(key))throw new AppError(`客户“${row.customer}”在文件中重复。`);seen.add(key);const before=customerAccountByName(s,row.customer);requireResponsibilityAdministrator(m,before,{...row,active:true});const item:CustomerAccount={...row,id:before?.id||newId('customer'),kind:'customer_account',active:true,version:(before?.version||0)+1,createdAt:before?.createdAt||now(),updatedAt:now(),updatedBy:m.name};updates.push(item,audit(m,item,before||null,'导入客户责任清单',safe(file.name)));}
  for(const member of all(s,'member') as Member[]){const customers=rows.filter(r=>[r.salesName,r.serviceName,r.pmcName].some(n=>clean(n).toLowerCase()===clean(member.name).toLowerCase())).map(r=>r.customer),merged=[...new Set([...(member.customers||[]),...customers])];if(merged.length!==(member.customers||[]).length)updates.push({...member,customers:merged});}
  await commit(s.revision,updates);return json({ok:true,count:rows.length});
 }
 if(action==='kingdee-template'){
  if(!manageCustomers(m))throw new AppError('仅管理员或 PMC 可上传金蝶模板。',403);const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!/\.(xlsx|xls)$/i.test(file.name))throw new AppError('请上传不超过 10 MB 的金蝶 Excel 模板。');const bytes=await file.arrayBuffer(),book=openWorkbook(bytes),sheet=book.SheetNames[0],header=detectHeader(book,sheet),headers=sheetRows(book,sheet,header).headers.filter(Boolean);const item={id:newId('template'),kind:'collaboration_template',templateType:'kingdee',filename:safe(file.name),fileKey:newId('kingdee_template'),sheet,header,headers,actorId:m.id,actor:m.name,createdAt:now()};await bucket().put(item.fileKey,bytes);await commit(s.revision,[item,audit(m,item,null,'上传金蝶订单模板')]);return json({ok:true,item});
 }
 if(action==='customer-save'){
  if(!manageCustomers(m))throw new AppError('仅管理员或 PMC 可修改客户责任。',403);const input=z.object({id:z.string().optional(),customer:z.string().trim().min(1).max(120),customerCode:z.string().trim().max(80).default(''),salesName:z.string().trim().max(80).default(''),serviceName:z.string().trim().max(80).default(''),pmcName:z.string().trim().max(80).default(''),notes:z.string().max(1000).default(''),active:z.boolean().default(true)}).parse(await req.json()),before=input.id?all(s,'customer_account').find(v=>v.id===input.id):customerAccountByName(s,input.customer);if(input.id&&!before)throw new AppError('客户记录不存在。');if(all(s,'customer_account').some(v=>v.id!==before?.id&&clean(v.customer).toLowerCase()===clean(input.customer).toLowerCase()))throw new AppError('客户名称已存在。');requireResponsibilityAdministrator(m,before,input);const item={...before,...input,id:before?.id||newId('customer'),kind:'customer_account',version:(before?.version||0)+1,createdAt:before?.createdAt||now(),updatedAt:now(),updatedBy:m.name};await commit(s.revision,[item,audit(m,item,before||null,'维护客户责任')]);return json({ok:true,item});
 }
 if(action==='factory-order-save'){
  if(!roles(m))throw new AppError('仅业务、客服、PMC 或管理员可维护内部订单。',403);const input=z.object({lineId:z.string(),sourceEnglish:z.string().max(12000).default(''),chineseProcess:z.string().max(12000).default(''),materialSpec:z.string().max(4000).default(''),platingSpec:z.string().max(4000).default(''),lensSpec:z.string().max(4000).default(''),materialImageConfirmed:z.boolean().default(false),action:z.enum(['draft','service-confirm','pmc-confirm','release'])}).parse(await req.json()),o=orderFor(s,input.lineId);if(!canRead(m,o))throw new AppError('该订单不在你的可见范围内。',403);const history=all(s,'factory_order').filter(v=>v.lineId===o.id).sort((x,y)=>y.version-x.version),before=history[0];if(input.action==='service-confirm'&&(!input.sourceEnglish.trim()||!input.chineseProcess.trim()))throw new AppError('请先补齐客户原文和中文工艺描述。');if(['pmc-confirm','release'].includes(input.action)&&!broad(m))throw new AppError('仅 PMC 或管理员可确认生产资料或下发工厂。',403);const needsBoard=/胶|AC|combined|组合/i.test(clean(o.productType||o.ledger?.columns?.W));if(['pmc-confirm','release'].includes(input.action)&&needsBoard&&!input.materialImageConfirmed)throw new AppError('该产品需要 PMC 确认板料图片。');if(input.action==='release'&&before?.status!=='待下发工厂')throw new AppError('请先完成客服确认和 PMC 补图确认。');const status=input.action==='draft'?'待客服确认':input.action==='service-confirm'?'待PMC补图':input.action==='pmc-confirm'?'待下发工厂':'已下发工厂',item={id:newId('factory_order'),kind:'factory_order',version:(before?.version||0)+1,priorId:before?.id||'',...input,status,serviceConfirmedBy:input.action==='service-confirm'?m.name:before?.serviceConfirmedBy||'',serviceConfirmedAt:input.action==='service-confirm'?now():before?.serviceConfirmedAt||'',pmcConfirmedBy:input.action==='pmc-confirm'?m.name:before?.pmcConfirmedBy||'',pmcConfirmedAt:input.action==='pmc-confirm'?now():before?.pmcConfirmedAt||'',releasedBy:input.action==='release'?m.name:'',releasedAt:input.action==='release'?now():'',createdAt:now(),createdBy:m.name};await commit(s.revision,[item,audit(m,item,before||null,'保存工厂内部订单',status)]);return json({ok:true,item});
 }
 if(action==='workflow'){
  if(!roles(m))throw new AppError('没有交接权限。',403);const input=z.object({id:z.string(),version:z.number().int(),action:z.enum(['submit-service','return-business','submit-pmc','accept-pmc','save-pmc']),note:z.string().max(2000).default(''),productionStartDate:z.string().default(''),productionFinishDate:z.string().default(''),materialStatus:z.string().max(100).default(''),scheduleStatus:z.string().max(100).default(''),exceptionReason:z.string().max(2000).default(''),promisedDate:z.string().default('')}).parse(await req.json()),o=orderFor(s,input.id),account=accountFor(s,o.customer);if(o.version!==input.version)throw new AppError('订单已由其他同事修改，请刷新后重试。',409);let patch:Partial<Order>={handoffNote:input.note};
  if(input.action==='submit-service'){if(!assigned(s,account,m,'sales'))throw new AppError('仅该客户业务员可提交客服。',403);for(const [v,label] of [[o.customer,'客户'],[o.orderNo,'订单号'],[o.customerPO,'客户 PO'],[o.drawing,'型号/图号'],[o.color,'色号'],[o.lens,'镜片'],[o.requestedDate,'客户要求交期']] as const)if(!v)throw new AppError(`提交前请补齐${label}。`);if(o.quantity<=0)throw new AppError('提交前请填写数量。');patch={...patch,workflowStatus:'客服待审核',submittedAt:now()};}
  if(input.action==='return-business'){if(!assigned(s,account,m,'service'))throw new AppError('仅该客户客服可退回。',403);if(!input.note.trim())throw new AppError('请填写退回原因。');patch={...patch,workflowStatus:'退回业务补充'};}
  if(input.action==='submit-pmc'){if(!assigned(s,account,m,'service'))throw new AppError('仅该客户客服可提交 PMC。',403);patch={...patch,workflowStatus:'PMC待接单',serviceReviewedAt:now()};}
  if(input.action==='accept-pmc'){if(!broad(m))throw new AppError('仅 PMC 或管理员可接单；客服只能提交 PMC，不能代为接单。',403);patch={...patch,workflowStatus:'PMC已接单',pmcAcceptedAt:now(),pmcName:account?.pmcName||m.name};}
  if(input.action==='save-pmc'){if(!broad(m))throw new AppError('仅 PMC 或管理员可回填排期。',403);for(const d of [input.productionStartDate,input.productionFinishDate,input.promisedDate])if(d)strictDate(d);patch={...patch,workflowStatus:'PMC已排期',productionStartDate:input.productionStartDate,productionFinishDate:input.productionFinishDate,plannedDate:input.productionFinishDate,materialStatus:input.materialStatus,scheduleStatus:input.scheduleStatus,exceptionReason:input.exceptionReason,promisedDate:input.promisedDate,promiseConfirmed:!!input.promisedDate};}
  const next={...o,...patch,salesName:o.salesName||account?.salesName||'',serviceName:o.serviceName||account?.serviceName||'',pmcName:o.pmcName||account?.pmcName||'',version:o.version+1,updatedAt:now(),updatedBy:m.name};await commit(s.revision,[next,audit(m,next,o,'业务客服PMC交接',input.note||input.action)]);return json({ok:true,item:next});
 }
 return null;
}
