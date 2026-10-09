import {z} from 'zod';
import {all,broad,canRead,clean,newId,now,strictDate,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {countValue,colLabels,today} from './ledger';
import {factoryName,isFinishedOutsource} from './manufacturing';
import {canOperateFinished,canReadFinished,finishedBalance,finishedData,finishedReworks,finishedShipments,finishedTasks,isSupplierMember,pendingFinishedBaseline,publicFinishedAttachment,publicFinishedRework,publicFinishedShipment,publicFinishedTask,reworkComplete,supplierMemberId,type FinishedAttachment,type FinishedEvent,type FinishedRework,type FinishedShipment,type FinishedTask} from './finished-supplier';

const qty=z.number().int().min(0).max(10000000),positive=qty.refine(n=>n>0,'数量必须大于零');
const base=z.object({taskId:z.string().min(1),version:z.number().int().positive(),token:z.string().uuid()});
const dated=base.extend({date:z.string(),note:z.string().trim().max(2000).default('')});
const shipmentInput=z.object({reference:z.string().trim().min(1).max(100),quantity:positive,date:z.string()}).strict();
const baselineCounts={stepCompleted:z.record(qty.nullable()),inTransit:z.array(shipmentInput).max(30),pendingInspection:z.array(shipmentInput).max(30),reworks:z.array(shipmentInput.extend({note:z.string().trim().min(3).max(2000)}).strict()).max(30)};
const confirmedCreateBaseline=z.object({cutoffDate:z.string(),confirmed:z.literal(true),...baselineCounts,note:z.string().trim().min(3).max(2000)}).strict(),pendingCreateBaseline=z.object({cutoffDate:z.string(),confirmed:z.literal(false),note:z.string().trim().min(3).max(2000)}).strict();
const createSchema=z.object({lineId:z.string(),supplierId:z.string(),orderVersion:z.number().int().positive(),template:z.enum(['metal','acetate','custom']),steps:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),label:z.string().trim().min(1).max(40)}).strict()).min(1).max(20),dueDate:z.string(),baseline:z.discriminatedUnion('confirmed',[confirmedCreateBaseline,pendingCreateBaseline]),token:z.string().uuid()}).strict();
const orderConfirmationSchema=z.object({lineId:z.string().min(1),orderVersion:z.number().int().positive(),productType:z.literal('成品'),businessType:z.literal('finished_full_outsource'),unit:z.enum(['付','副']),note:z.string().trim().min(3).max(2000),token:z.string().uuid()}).strict();
const baselineConfirmationSchema=dated.extend({orderVersion:z.number().int().positive(),note:z.string().trim().min(3).max(2000),baseline:z.object({confirmed:z.literal(true),stock:qty,...baselineCounts}).strict()}).strict();
const schemas={accept:dated.strict(),progress:dated.extend({stageId:z.string(),quantity:qty}).strict(),promise:dated.extend({promisedDate:z.string()}).strict(),exception:dated.extend({category:z.enum(['delay','material','quality','technical','other','resolved']),expectedDate:z.string().default('')}).strict(),shipment:dated.extend({quantity:positive,reference:z.string().trim().min(1).max(100),expectedDate:z.string(),reworkId:z.string().default(''),attachmentIds:z.array(z.string()).max(8).default([])}).strict(),receive:dated.extend({shipmentId:z.string(),quantity:positive}).strict(),qc:dated.extend({shipmentId:z.string(),accepted:qty,rejected:qty}).strict(),stock:dated.extend({shipmentId:z.string(),quantity:positive,orderVersion:z.number().int().positive()}).strict(),return:dated.extend({shipmentId:z.string().default(''),quantity:positive,orderVersion:z.number().int().positive(),reference:z.string().trim().min(1).max(100)}).strict(),'rework-confirm':dated.extend({reworkId:z.string()}).strict(),'baseline-stage':dated.extend({stageId:z.string(),quantity:qty}).strict(),close:dated.extend({orderVersion:z.number().int().positive()}).strict()};
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new AppError('填写内容不完整或无效：'+result.error.issues.map(x=>x.path.join('.')+' '+x.message).slice(0,3).join('；'));return result.data;}
function date(value:string,label:string,required=true){try{const v=strictDate(value);if(required&&!v)throw new Error('不能为空');return v;}catch{throw new AppError(label+'：请填写完整有效的 YYYY-MM-DD 日期。');}}
function actualDate(value:string,t?:FinishedTask){const v=date(value,'业务日期');if(v>today())throw new AppError('实际业务日期不能晚于今天。');if(t&&v<t.baseline.cutoffDate)throw new AppError('业务日期不能早于已确认的期初截止日。');return v;}
function stable(value:any):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';}
async function hash(value:string|ArrayBuffer){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
function authenticated(s:State,m:Member){if(!m.active)throw new AppError('账号已停用。',403);if(isSupplierMember(m)&&(!supplierMemberId(m)||!all(s,'supplier').some(x=>x.id===supplierMemberId(m)&&x.active!==false)))throw new AppError('供应商账号未获有效授权。',403);}
function readTask(s:State,m:Member,id:string){const t=finishedTasks(s).find(x=>x.id===id);if(!t||!canReadFinished(s,m,t))throw new AppError('无权访问此协作任务。',403);return t;}
function live(s:State,t:FinishedTask){const o=all(s,'order').find(x=>x.id===t.lineId) as Order|undefined;if(t.closedAt||!o||o.lifecycle==='archived'||o.sourceStatus==='已取消')throw new AppError('任务或订单已关闭，不能继续登记。',409);if(!isFinishedOutsource(o)||factoryName(o)!==t.supplierName||o.quantity!==t.quantity||(o.unit||'副')!==(t.unit||'副'))throw new AppError('源订单的生产厂、数量或单位已变化，请 PMC 核对任务。',409);return o;}
function knownStock(t:FinishedTask){if(pendingFinishedBaseline(t)||t.baselineStock===null)throw new AppError('期初数量仍待公司核定，不能正式记账。',409);return t.baselineStock;}
function knownBalance(s:State,t:FinishedTask){const b=finishedBalance(s,t);if(b.stocked===null)throw new AppError('期初数量仍待公司核定，不能正式记账。',409);return b;}
function employee(m:Member,manage=false){if(isSupplierMember(m)||(manage?!broad(m):!canOperateFinished(m)))throw new AppError(manage?'仅 PMC 或管理员可执行此操作。':'仅 PMC、生产管理或成品部门文员可确认收货、验收和入仓。',403);}
function supplier(m:Member){if(!isSupplierMember(m))throw new AppError('此动作需由获授权供应商填报。',403);}
function changed(s:State,updates:Entity[]):State{const map=new Map(updates.map(x=>[x.id,x]));return {revision:s.revision+1,records:[...s.records.map(x=>map.get(x.id)||x),...updates.filter(x=>!s.records.some(y=>y.id===x.id))]};}
function event(action:string,t:FinishedTask,m:Member,p:any,fingerprint:string):FinishedEvent{const {taskId,version,token,date,note,...data}=p;return {id:'finished_event_'+token,kind:'finished_supplier_event',taskId:t.id,action,actorId:m.id,actor:m.name,actorType:isSupplierMember(m)?'supplier':'employee',token,fingerprint,date:date||t.baseline.cutoffDate,note:note||'',data,createdAt:now()};}
function repeated(s:State,m:Member,token:string,action:string,fingerprint:string){const old=all(s,'finished_supplier_event').find(x=>x.id==='finished_event_'+token) as FinishedEvent|undefined;if(!old)return null;if(old.actorId!==m.id||old.action!==action||old.fingerprint!==fingerprint)throw new AppError('提交编号已使用且内容不一致，请刷新后核对。',409);const t=readTask(s,m,old.taskId);return json({ok:true,reused:true,task:publicFinishedTask(s,t,isSupplierMember(m))});}
function getShipment(s:State,t:FinishedTask,id:string){const x=finishedShipments(s,t.id).find(x=>x.id===id);if(!x)throw new AppError('送货明细不属于此任务。',403);return x;}
function getRework(s:State,t:FinishedTask,id:string){const r=finishedReworks(s,t.id).find(x=>x.id===id);if(!r)throw new AppError('返工单不属于此任务。',403);return r;}
function freshOrder(s:State,t:FinishedTask,version:number){const o=live(s,t);if(o.version!==version)throw new AppError('源订单版本已变化，本次未记账，请刷新后核对。',409);const current=countValue(o.ledger?.columns.BF);if(current===null||current!==knownBalance(s,t).stocked)throw new AppError('原表入仓与协作账本不一致，本次未记账，请 PMC 对账。',409);return o;}
function stockOrder(o:Order,quantity:number,m:Member,businessDate:string){if(!o.ledger)throw new AppError('任务缺少原表入仓结构。');const c={...o.ledger.columns,BF:String(quantity),BG:businessDate};return {...o,ledger:{...o.ledger,columns:c},extra:{...o.extra,['BF · '+colLabels.BF]:String(quantity),['BG · '+colLabels.BG]:businessDate},version:o.version+1,updatedAt:now(),updatedBy:m.name};}
function rework(t:FinishedTask,quantity:number,date:string,note:string,source:FinishedRework['source'],shipmentId='',parentId='',reference=''):FinishedRework{return {id:newId('finished_rework'),kind:'finished_supplier_rework',taskId:t.id,reference:reference||'返工-'+crypto.randomUUID().slice(0,8),quantity,date,note,sourceShipmentId:shipmentId,parentId,source,confirmedAt:'',confirmedDate:'',shipped:0,accepted:0,stocked:0,transferred:0,createdAt:now(),updatedAt:now()};}
function duplicateReference(s:State,t:FinishedTask,reference:string){return finishedShipments(s,t.id).some(x=>clean(x.reference).toUpperCase()===clean(reference).toUpperCase());}
function attachmentIds(s:State,t:FinishedTask,ids:string[]){if(new Set(ids).size!==ids.length)throw new AppError('同一附件不能重复关联。');for(const id of ids)if(!all(s,'finished_supplier_attachment').some(x=>x.id===id&&x.taskId===t.id))throw new AppError('附件不属于此任务。',403);}
function validateBaseline(quantity:number,steps:{id:string;label:string}[],stock:number,p:{stepCompleted:Record<string,number|null>;inTransit:any[];pendingInspection:any[];reworks:any[]},cutoff:string){
 const ids=steps.map(x=>x.id);if(stock>quantity)throw new AppError('期初入仓不能超过订单数量。');
 if(Object.keys(p.stepCompleted).length!==ids.length||ids.some(id=>!(id in p.stepCompleted)))throw new AppError('每个适用工序都须明确填写期初数量或未知。');
 const stages=steps.map(x=>({...x,baseline:p.stepCompleted[x.id],completed:p.stepCompleted[x.id]}));if(stages.some(x=>x.completed!==null&&(x.completed>quantity||x.completed<stock)))throw new AppError('已知工序期初数量须介于期初入仓与订单数量之间。');
 const refs=[...p.inTransit,...p.pendingInspection,...p.reworks];if(new Set(refs.map(x=>clean(x.reference).toUpperCase())).size!==refs.length)throw new AppError('期初在途、待检与返工凭证号不能重复。');
 for(const row of refs)if(date(row.date,'期初单据日期')>cutoff)throw new AppError('期初单据日期不能晚于截止日。');
 const baselineRework=p.reworks.reduce((n,x)=>n+x.quantity,0),dispatched=stock+refs.reduce((n,x)=>n+x.quantity,0);if(dispatched>quantity)throw new AppError('期初入仓、在途、待检与返工合计不能超过订单数量。');
 const packing=stages.find(x=>x.id==='packing')!;if(packing.completed!==null&&packing.completed<dispatched)throw new AppError('包装期初完成数不能少于期初已经交出的数量。');return {stages,baselineRework};
}
function baselineEntities(t:FinishedTask,p:{inTransit:any[];pendingInspection:any[];reworks:any[]}){
 const shipments:FinishedShipment[]=[...p.inTransit.map(x=>({...x,source:'baseline-transit' as const})),...p.pendingInspection.map(x=>({...x,source:'baseline-inspection' as const}))].map(x=>({...x,id:newId('finished_shipment'),kind:'finished_supplier_shipment',taskId:t.id,expectedDate:'',note:'公司确认期初单据',reworkId:'',received:x.source==='baseline-inspection'?x.quantity:0,receivedDate:x.source==='baseline-inspection'?x.date:'',accepted:0,rejected:0,stocked:0,returned:0,attachmentIds:[],createdAt:now(),updatedAt:now()}));
 return [...shipments,...p.reworks.map(x=>rework(t,x.quantity,x.date,x.note,'baseline','','',x.reference))];
}
export function assertLegacyFinishedMutation(s:State,action:string,body:unknown){
 if(!['ledger-edit','ledger-lifecycle','pack'].includes(action)||!body||typeof body!=='object')return;
 const input=body as {id?:string;lineId?:string;patch?:Record<string,unknown>},id=input.id||input.lineId;
 if(!finishedTasks(s).some(t=>t.lineId===id&&!t.closedAt))return;
 if(action!=='ledger-edit'||['BF','BG','BH'].some(col=>Object.prototype.hasOwnProperty.call(input.patch||{},col)))throw new AppError('此订单已启用成品外发协作，入仓、退货与结单须在协作工作台确认，不能手改原表。',409);
}

export async function finishedSupplierGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['finished-supplier-data','finished-supplier-file'].includes(action))return null;authenticated(s,m);
 if(action==='finished-supplier-data')return json(finishedData(s,m));
 const id=new URL(req.url).searchParams.get('id'),item=all(s,'finished_supplier_attachment').find(x=>x.id===id) as FinishedAttachment|undefined;
 if(!item)throw new AppError('附件不存在。',404);readTask(s,m,item.taskId);const file=await bucket().get(item.fileKey);if(!file)throw new AppError('附件文件未找到。',404);
 return new Response(file.body,{headers:{'Content-Type':item.contentType,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(item.filename),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}

export async function finishedSupplierPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const prefix='finished-supplier-';if(!action.startsWith(prefix))return null;const name=action.slice(prefix.length);
 if(!['task-create','order-confirm','baseline-confirm','attachment'].includes(name)&&!Object.keys(schemas).includes(name))return null;authenticated(s,m);
 if(name==='attachment')return uploadAttachment(req,s,m);
 if(name==='order-confirm'){
  employee(m,true);const p=parse(orderConfirmationSchema,await req.json()),fingerprint=await hash(stable({action,...p})),receiptId='finished_order_confirmation_'+p.token,prior=all(s,'finished_supplier_order_confirmation').find(x=>x.id===receiptId);
  if(prior){if(prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('提交编号已使用且内容不一致，请刷新后核对。',409);return json({ok:true,reused:true,order:prior.order});}
  const o=all(s,'order').find(x=>x.id===p.lineId) as Order|undefined;if(!o||!canRead(m,o)||!isFinishedOutsource(o)||!o.ledger)throw new AppError('请选择有原表记录的成品外发订单。');
  if(o.lifecycle==='archived'||o.sourceStatus==='已取消'||o.version!==p.orderVersion)throw new AppError('订单已关闭或版本已变化，请刷新核对。',409);
  if(finishedTasks(s).some(t=>t.lineId===o.id&&!t.closedAt))throw new AppError('此订单已有协作任务，不能修改业务分类或单位。',409);
  const updated:Order={...o,productType:p.productType,businessType:p.businessType,unit:p.unit,ledger:{...o.ledger,columns:{...o.ledger.columns,W:p.productType}},extra:{...o.extra,['W · '+colLabels.W]:p.productType,['产品类型']:p.productType,['业务类型']:'成品整单外发',['计量单位']:p.unit},version:o.version+1,updatedAt:now(),updatedBy:m.name};
  const order={id:updated.id,version:updated.version,productType:updated.productType,businessType:updated.businessType,unit:updated.unit},receipt={id:receiptId,kind:'finished_supplier_order_confirmation',lineId:o.id,actorId:m.id,token:p.token,fingerprint,note:p.note,order,createdAt:now()};await commit(s.revision,[updated,receipt,audit(m,updated,o,'确认成品整单外发业务与单位',p.note)]);return json({ok:true,order});
 }
 if(name==='task-create'){
  employee(m,true);const p=parse(createSchema,await req.json()),fingerprint=await hash(stable({action,...p})),retry=repeated(s,m,p.token,name,fingerprint);if(retry)return retry;
  const o=all(s,'order').find(x=>x.id===p.lineId) as Order|undefined,master=all(s,'supplier').find(x=>x.id===p.supplierId&&x.active!==false);
  if(!o||!canRead(m,o)||!isFinishedOutsource(o)||!master||factoryName(o)!==clean(master.name))throw new AppError('请选择生产厂与有效供应商名称一致的成品外发订单。');
  if(o.lifecycle==='archived'||o.sourceStatus==='已取消'||o.version!==p.orderVersion)throw new AppError('订单已关闭或版本已变化，请刷新核对。',409);
  if(!o.ledger||!Number.isSafeInteger(o.quantity)||o.quantity<=0)throw new AppError('请先核定原表订单数量和工序结构。');const stock=p.baseline.confirmed?countValue(o.ledger.columns.BF):null;if(p.baseline.confirmed&&(stock===null||stock>o.quantity))throw new AppError('期初入仓必须为已核实的有效数量，空白不能当作零。');
  if(finishedTasks(s).some(t=>t.lineId===o.id&&!t.closedAt))throw new AppError('该明细已有活跃协作任务，不能重复建账。',409);
  const cutoff=actualDate(p.baseline.cutoffDate),due=date(p.dueDate,'要求交期',p.baseline.confirmed),ids=p.steps.map(x=>x.id);if(p.baseline.confirmed&&due<cutoff)throw new AppError('要求交期不能早于期初截止日。');
  if(new Set(ids).size!==ids.length||!ids.includes('packing'))throw new AppError('工序不得重复，且必须包含 packing 包装工序。');
  const opening=p.baseline.confirmed&&stock!==null?validateBaseline(o.quantity,p.steps,stock,p.baseline,cutoff):{stages:p.steps.map(x=>({...x,baseline:null,completed:null})),baselineRework:0};
  const t:FinishedTask={id:newId('finished_task'),kind:'finished_supplier_task',lineId:o.id,supplierId:master.id,supplierName:clean(master.name),orderNo:o.orderNo,drawing:o.drawing,color:o.color,lens:o.lens,productType:o.productType||o.ledger.columns.W||'',quantity:o.quantity,unit:o.unit||'副',businessType:o.businessType||'finished_full_outsource',baselineStatus:p.baseline.confirmed?'confirmed':'pending',template:p.template,stages:opening.stages,dueDate:due,promisedDate:'',baselineStock:stock,baselineStockReturned:0,baselineRework:opening.baselineRework,baseline:{cutoffDate:cutoff,note:p.baseline.note},acceptedAt:'',acceptedDate:'',closedAt:'',lastException:null,version:1,createdAt:now(),updatedAt:now()};
  const entities=p.baseline.confirmed?baselineEntities(t,p.baseline):[],e=event(name,t,m,{...p,date:cutoff,note:p.baseline.note},fingerprint);e.data={template:p.template,steps:p.steps,baselineStatus:t.baselineStatus,baselineStock:stock,baseline:p.baseline};
  const updates:Entity[]=[t,...entities,e,audit(m,t,null,'建立成品外发供应商协作任务',p.baseline.confirmed?'已核实期初基线':'已发布任务，期初数量待公司核定')];await commit(s.revision,updates);const next=changed(s,updates);return json({ok:true,task:publicFinishedTask(next,t)});
 }
 if(name==='baseline-confirm'){
  employee(m,true);const p=parse(baselineConfirmationSchema,await req.json()),t=readTask(s,m,p.taskId),fingerprint=await hash(stable({action,...p})),retry=repeated(s,m,p.token,name,fingerprint);if(retry)return retry;
  const o=live(s,t);if(!pendingFinishedBaseline(t))throw new AppError('任务已有完整期初基线，不能重复覆盖。',409);if(t.version!==p.version||o.version!==p.orderVersion)throw new AppError('任务或源订单版本已变化，请刷新核对。',409);const cutoff=actualDate(p.date,t);if(!o.ledger)throw new AppError('任务缺少原表入仓结构。');
  const raw=clean(o.ledger.columns.BF),existing=countValue(raw);if(raw&&existing===null)throw new AppError('原表 BF 存在无效值，请 PMC 先核对。',409);if(existing!==null&&existing!==p.baseline.stock)throw new AppError('核定数量与原表有效 BF 不一致，不能覆盖，请 PMC 对账。',409);
  const opening=validateBaseline(t.quantity,t.stages,p.baseline.stock,p.baseline,cutoff),next:FinishedTask={...t,baselineStatus:'confirmed',baselineStock:p.baseline.stock,baselineStockReturned:0,baselineRework:opening.baselineRework,stages:opening.stages,baseline:{cutoffDate:cutoff,note:p.note},version:t.version+1,updatedAt:now()};
  const updated:Order={...o,ledger:{...o.ledger,columns:{...o.ledger.columns,BF:String(p.baseline.stock)}},extra:{...o.extra,['BF · '+colLabels.BF]:String(p.baseline.stock)},version:o.version+1,updatedAt:now(),updatedBy:m.name},e=event(name,next,m,p,fingerprint);e.data={baselineStatus:'confirmed',baselineStock:p.baseline.stock,baseline:p.baseline,orderVersion:p.orderVersion};
  const updates:Entity[]=[updated,next,...baselineEntities(next,p.baseline),e,audit(m,updated,o,'核定成品外发期初入仓',p.note),audit(m,next,t,'核定成品外发完整期初基线',p.note)];await commit(s.revision,updates);return json({ok:true,task:publicFinishedTask(changed(s,updates),next)});
 }
 const schema=schemas[name as keyof typeof schemas] as z.ZodType<any>,p=parse(schema,await req.json()),t=readTask(s,m,p.taskId),fingerprint=await hash(stable({action,...p})),retry=repeated(s,m,p.token,name,fingerprint);if(retry)return retry;
 const supplierActions=['accept','progress','promise','exception','shipment','rework-confirm'];if(supplierActions.includes(name))supplier(m);else employee(m,['baseline-stage','close'].includes(name));
 live(s,t);if(t.version!==p.version)throw new AppError('任务已被其他人更新，本次未写入，请刷新核对。',409);if(pendingFinishedBaseline(t)&&!['accept','promise','exception'].includes(name))throw new AppError('期初数量仍待公司核定，当前仅可接单、回复交期和填写异常说明。',409);p.date=actualDate(p.date,t);
 if(name!=='accept'&&name!=='baseline-stage'&&!t.acceptedAt)throw new AppError('供应商尚未确认接单，请先接单。');
 const next:FinishedTask={...t,stages:t.stages.map(x=>({...x})),version:t.version+1,updatedAt:now()},updates:Entity[]=[],timestamp=now();let item:FinishedShipment|FinishedRework|undefined;
 if(name==='accept'){
  if(t.acceptedAt)throw new AppError('任务已经接单，无需重复确认。');next.acceptedAt=timestamp;next.acceptedDate=p.date;
 }else if(name==='progress'||name==='baseline-stage'){
  const stage=next.stages.find(x=>x.id===p.stageId);if(!stage)throw new AppError('此工序不在公司固定的适用工序中。');
  if(name==='baseline-stage'){if(stage.baseline!==null)throw new AppError('此工序已有期初基线，不能重复覆盖。');if(p.note.length<3||p.quantity<knownStock(t)||p.quantity>t.quantity)throw new AppError('核定期初须填写依据，且数量介于期初入仓与订单数量之间。');if(stage.id==='packing'&&p.quantity<knownBalance(s,t).normalDispatched)throw new AppError('包装期初数不能少于已经交出的数量。');stage.baseline=p.quantity;stage.completed=p.quantity;}
  else{if(stage.completed===null)throw new AppError('此工序期初数量仍待核，需 PMC 先确认基线。');if(p.quantity===0&&!p.note)throw new AppError('今日无增量请填写进度说明。');if(stage.completed+p.quantity>t.quantity)throw new AppError('累计有效完成数不能超过订单数量；返工不可重复计产量。');stage.completed+=p.quantity;}
 }else if(name==='promise'){
  const promise=date(p.promisedDate,'供应商承诺交期');if(promise<p.date)throw new AppError('承诺交期不能早于本次回复日期。');if(t.dueDate&&promise>t.dueDate&&p.note.length<3)throw new AppError('晚于要求交期，请填写延期原因。');next.promisedDate=promise;
  if(t.dueDate&&promise>t.dueDate)next.lastException={category:'delay',note:p.note,date:p.date,expectedDate:promise};
 }else if(name==='exception'){
  if(p.note.length<3)throw new AppError('请填写异常或解除异常的处理说明。');const expected=date(p.expectedDate,'预计恢复日期',false);if(expected&&expected<p.date)throw new AppError('预计恢复日期不能早于报告日期。');next.lastException=p.category==='resolved'?null:{category:p.category,note:p.note,date:p.date,expectedDate:expected};
 }else if(name==='shipment'){
  if(duplicateReference(s,t,p.reference))throw new AppError('该任务送货单号已登记，请勿重复发货。',409);attachmentIds(s,t,p.attachmentIds);const expected=date(p.expectedDate,'预计到货日');if(expected<p.date)throw new AppError('预计到货日不能早于发货日。');
  if(p.reworkId){const r=getRework(s,t,p.reworkId);if(!r.confirmedAt||reworkComplete(r)||p.quantity>r.quantity-r.shipped)throw new AppError('返工需先确认，且复送数量不能超过本返工单待复送量。');updates.push({...r,shipped:r.shipped+p.quantity,updatedAt:timestamp});}
  else{const packing=t.stages.find(x=>x.id==='packing'),b=knownBalance(s,t);if(packing?.completed===null||packing?.completed===undefined)throw new AppError('包装期初或有效完成数待核，不能发货。');if(p.quantity>t.quantity-b.normalDispatched||p.quantity>packing.completed-b.normalDispatched)throw new AppError('发货超过未发数量或已确认的包装完成数。');}
  item={id:newId('finished_shipment'),kind:'finished_supplier_shipment',taskId:t.id,reference:p.reference,quantity:p.quantity,date:p.date,expectedDate:expected,note:p.note,reworkId:p.reworkId,source:'supplier',received:0,accepted:0,rejected:0,stocked:0,returned:0,attachmentIds:p.attachmentIds,createdAt:timestamp,updatedAt:timestamp};updates.push(item);
 }else if(name==='receive'){
  const x=getShipment(s,t,p.shipmentId);if(p.date<x.date||p.quantity>x.quantity-x.received)throw new AppError('到货日期或本次到货量超过此批在途余量。');item={...x,received:x.received+p.quantity,receivedDate:p.date,updatedAt:timestamp};updates.push(item);
 }else if(name==='qc'){
  const x=getShipment(s,t,p.shipmentId);if(p.date<(x.receivedDate||x.date)||p.accepted+p.rejected<=0||p.accepted+p.rejected>x.received-x.accepted-x.rejected)throw new AppError('验收日期或合格、不良数量不符合此批待检余量。');if(p.rejected>0&&p.note.length<3)throw new AppError('不良验收须写明缺陷及返工依据。');item={...x,accepted:x.accepted+p.accepted,rejected:x.rejected+p.rejected,qcDate:p.date,updatedAt:timestamp};updates.push(item);
  if(p.rejected>0)updates.push(rework(t,p.rejected,p.date,p.note,'qc',x.id,x.reworkId));
  if(x.reworkId){const r=getRework(s,t,x.reworkId);updates.push({...r,accepted:r.accepted+p.accepted,transferred:r.transferred+p.rejected,updatedAt:timestamp});}
 }else if(name==='stock'){
  const x=getShipment(s,t,p.shipmentId);if(p.date<(x.qcDate||x.receivedDate||x.date)||p.quantity>x.accepted-x.stocked)throw new AppError('入仓日期或数量不符合此批已验收合格待入仓余量。');const o=freshOrder(s,t,p.orderVersion),b=knownBalance(s,t);if(b.stocked+p.quantity>t.quantity)throw new AppError('入仓超过订单数量，本次未记账。');
  item={...x,stocked:x.stocked+p.quantity,stockDate:p.date,updatedAt:timestamp};updates.push(item);const updated=stockOrder(o,b.stocked+p.quantity,m,p.date);updates.push(updated,audit(m,updated,o,'成品外发合格入仓','送货单 '+x.reference));
  if(x.reworkId){const r=getRework(s,t,x.reworkId);updates.push({...r,stocked:r.stocked+p.quantity,updatedAt:timestamp});}
 }else if(name==='return'){
  if(p.note.length<3)throw new AppError('已入仓退货必须填写依据。');const o=freshOrder(s,t,p.orderVersion),b=knownBalance(s,t);if(p.quantity>b.stocked)throw new AppError('退货超过已入仓净合格数。');
  if(p.shipmentId){const x=getShipment(s,t,p.shipmentId);if(p.quantity>x.stocked-x.returned||p.date<(x.stockDate||x.date))throw new AppError('此批退货超过可退净入仓数或日期早于入仓。');updates.push({...x,returned:x.returned+p.quantity,updatedAt:timestamp});}
  else{if(p.quantity>knownStock(t)-t.baselineStockReturned)throw new AppError('期初库存退货超过期初净入仓余量。');next.baselineStockReturned+=p.quantity;}
  if(finishedReworks(s,t.id).some(r=>r.source==='return'&&clean(r.reference).toUpperCase()===clean(p.reference).toUpperCase()))throw new AppError('此退货凭证号已登记。',409);
  item=rework(t,p.quantity,p.date,p.note,'return',p.shipmentId,'',p.reference);updates.push(item);const updated=stockOrder(o,b.stocked-p.quantity,m,o.ledger?.columns.BG||p.date);updates.push(updated,audit(m,updated,o,'成品外发已入仓退货冲销',p.reference));
 }else if(name==='rework-confirm'){
  const r=getRework(s,t,p.reworkId);if(r.confirmedAt||reworkComplete(r)||p.date<r.date)throw new AppError('返工已确认／完成，或确认日期早于返工单日期。');item={...r,confirmedAt:timestamp,confirmedDate:p.date,updatedAt:timestamp};updates.push(item);
 }else if(name==='close'){
  if(p.note.length<3)throw new AppError('请填写 PMC 结单依据。');const o=freshOrder(s,t,p.orderVersion),b=knownBalance(s,t);if(b.remaining!==0||b.inTransit||b.pendingInspection||b.pendingStock||b.openRework)throw new AppError('尚有订单欠数、在途、待检、待入仓或返工未结，不能正常结单。');next.closedAt=timestamp;
  const c={...o.ledger!.columns,BH:p.date},updated={...o,lifecycle:'archived' as const,closedDate:p.date,archivedAt:timestamp,archiveReason:p.note,ledger:{...o.ledger!,columns:c},extra:{...o.extra,['BH · '+colLabels.BH]:p.date},version:o.version+1,updatedAt:timestamp,updatedBy:m.name};updates.push(updated,audit(m,updated,o,'成品外发任务履约结单',p.note));
 }
 const e=event(name,next,m,p,fingerprint);updates.push(next,e,audit(m,next,t,'成品外发协作 · '+name,p.note||'供应商协作'));await commit(s.revision,updates);const final=changed(s,updates);
 return json({ok:true,task:publicFinishedTask(final,next,isSupplierMember(m)),...(item?{item:item.kind==='finished_supplier_shipment'?publicFinishedShipment(item as FinishedShipment):publicFinishedRework(item as FinishedRework)}:{})});
}

async function uploadAttachment(req:Request,s:State,m:Member){
 const form=await req.formData(),taskId=String(form.get('taskId')||''),token=String(form.get('token')||''),t=readTask(s,m,taskId);if(!isSupplierMember(m))employee(m);live(s,t);
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!z.string().uuid().safeParse(token).success)throw new AppError('请上传不超过 10 MB 的 PDF、PNG 或 JPEG，并使用有效提交编号。');
 const bytes=await file.arrayBuffer(),u=new Uint8Array(bytes);const type=u[0]===0xff&&u[1]===0xd8&&u[2]===0xff?'image/jpeg':u[0]===0x89&&u[1]===0x50&&u[2]===0x4e&&u[3]===0x47&&u[4]===0x0d&&u[5]===0x0a&&u[6]===0x1a&&u[7]===0x0a?'image/png':String.fromCharCode(...u.slice(0,5))==='%PDF-'?'application/pdf':'';
 if(!type)throw new AppError('附件内容仅支持 PDF、PNG 或 JPEG，不能仅修改扩展名。');const digest=await hash(bytes),filename=file.name.replace(/[\\/\r\n]/g,'_').slice(0,180)||'attachment',fingerprint=await hash(stable({taskId,filename,size:file.size,type,hash:digest}));
 const prior=all(s,'finished_supplier_attachment').find(x=>x.id==='finished_attachment_'+token) as FinishedAttachment|undefined;if(prior){if(prior.taskId!==t.id||prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('附件提交编号与原内容不一致。',409);return json({ok:true,reused:true,item:publicFinishedAttachment(prior)});}
 const item:FinishedAttachment={id:'finished_attachment_'+token,kind:'finished_supplier_attachment',taskId:t.id,filename,contentType:type,size:file.size,fileKey:newId('finished_file'),hash:digest,actorId:m.id,createdAt:now(),token,fingerprint};await bucket().put(item.fileKey,bytes);await commit(s.revision,[item,audit(m,{...item,lineId:t.lineId},null,'上传成品外发协作附件')]);return json({ok:true,item:publicFinishedAttachment(item)});
}
