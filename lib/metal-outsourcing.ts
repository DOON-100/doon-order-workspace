import {all,canRead,clean,newId,now,personnelTypeOf,strictDate,type Entity,type Member,type Order,type State} from './domain';
import {active} from './ledger';
import {isFinishedOutsource} from './manufacturing';
import {businessTeamData,filterBusinessTeamRows} from './business-team-scope';
import {catalogGrants} from './outsourcing-catalog';
import {canSeeSupplierPrice} from './suppliers';
import {assertHandoffProductionGate,hasRecordedProduction,handoffProductionGate} from './handoff-production-gate';
import {AppError} from './store';
import {metalChargeAmount,metalNetAmount} from './metal-outsourcing-money';
import type {MetalAction,MetalBase,MetalBom,MetalContribution,MetalData,MetalDelivery,MetalDeliveryLine,MetalDemand,MetalDemandBalance,MetalIssue,MetalJob,MetalJobLine,MetalPart,MetalPermissions,MetalPlan,MetalPostInputs,MetalProcess,MetalQc,MetalQuote,MetalReceipt,MetalSettlement,MetalSourceGroup,MetalStock} from './metal-outsourcing-contract';

export * from './metal-outsourcing-contract';
const key=(v:unknown)=>clean(v).toLocaleUpperCase();
const live=(r:Entity)=>r.voided!==true;
export const metalRows=<T extends Entity=Entity>(s:State,kind:string):T[]=>all(s,kind).filter(live) as T[];
const sum=(rows:readonly any[],fn:(r:any)=>number)=>roundQuantity(rows.reduce((n,r)=>n+fn(r),0));
export const roundQuantity=(n:number)=>Math.round((n+Number.EPSILON)*1e6)/1e6;
const eq=(a:number,b:number)=>Math.abs(a-b)<0.0000005;
const fits=(a:number,b:number)=>a<=b+0.0000005;
const unique=(ids:string[])=>[...new Set(ids)];
function assertUnique(ids:string[],label:string){if(new Set(ids).size!==ids.length)throw new AppError(label+'不可重复。');}
function ensure(condition:unknown,message:string,status=400):asserts condition{if(!condition)throw new AppError(message,status);}
/** Decimal arithmetic at six input places; round each charge to cents, never round its price. */
export function metalAmount(quantity:number,price:number,factor=1){try{return metalChargeAmount(quantity,price,factor);}catch(e){throw new AppError(e instanceof Error?e.message:'加工金额无效。');}}
export function metalNet(gross:number,taxRate:number){try{return metalNetAmount(gross,taxRate);}catch(e){throw new AppError(e instanceof Error?e.message:'加工税额无效。');}}
const money=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
function date(v:string){try{return strictDate(v);}catch(e){throw new AppError((e as Error).message);}}
function dateOrder(after:string,before:string,label:string){ensure(date(after)>=date(before),label+'不能早于上游日期。');}
function base(kind:string,m:Member):MetalBase {const at=now();return {id:newId(kind),kind,version:1,createdAt:at,updatedAt:at,createdBy:m.id,updatedBy:m.id};}
function changed<T extends Entity>(r:T,m:Member,patch:Partial<T>):T{return {...r,...patch,version:r.version+1,updatedBy:m.id,updatedAt:now()};}
function version(r:Entity,n:number){ensure(r.version===n,'记录已更新，请刷新后重新核对。',409);}
function requirePermission(m:Member,s:State,p:keyof MetalPermissions){ensure(metalPermissions(s,m)[p],'没有此金属外发操作权限。',403);}
export function metalPermissions(s:State,m:Member):MetalPermissions {
 const internal=m.active&&m.role!=='supplier'&&personnelTypeOf(m)==='internal',admin=internal&&m.role==='admin',pmc=internal&&m.role==='pmc',production=internal&&m.role==='production';
 const dept=(names:string[])=>internal&&m.role==='clerk'&&!!m.departments?.some(d=>names.includes(d));
 const granted=internal&&catalogGrants(s,m).some(g=>g.departments.some(d=>['titanium','semifinished','outsourcing'].includes(d)));
 return {read:internal,master:admin||pmc||dept(['engineering']),plan:admin||pmc,operate:admin||pmc||production||dept(['titanium','semifinished','outsourcing'])||granted,
  stock:admin||pmc||production||dept(['warehouse','logistics']),quality:admin||production||dept(['quality','qc']),issue:admin||pmc||production,
  price:internal&&canSeeSupplierPrice(m),approvePrice:admin||pmc,settle:admin||internal&&m.role==='finance',pay:admin||internal&&m.role==='finance'};
}
export function metalVisibleOrderIds(s:State,m:Member,teamId=''){
 if(!metalPermissions(s,m).read)return new Set<string>();
 return new Set(filterBusinessTeamRows(s,(all(s,'order') as Order[]).filter(o=>canRead(m,o)),teamId).map(o=>o.id));
}
export function metalVisible(r:Entity,ids:Set<string>){return Array.isArray(r.sourceLineIds)&&r.sourceLineIds.length>0&&r.sourceLineIds.every((id:string)=>ids.has(id));}
function get<T extends Entity>(s:State,m:Member,teamId:string,id:string,kind:string):T{
 const r=metalRows(s,kind).find(r=>r.id===id);ensure(r,'记录不存在或已冲销。',404);
 if(Array.isArray(r.sourceLineIds))ensure(metalVisible(r,metalVisibleOrderIds(s,m,teamId)),'记录不存在或来源不完全在当前授权范围。',403);
 if(kind==='metal_quote')ensure(quoteVisible(s,m,teamId,r),'报价不属于当前授权工作组。',403);
 return r as T;
}
function groupKey(o:Order){return JSON.stringify([key(o.customer),key(o.orderNo),key(o.drawing)]);}
export function metalSourceGroups(s:State,m:Member,teamId=''):MetalSourceGroup[]{
 const ids=metalVisibleOrderIds(s,m,teamId),groups=new Map<string,Order[]>(),planned=new Map<string,number>(),legacy=new Map<string,number>();
 for(const p of metalRows<MetalPlan>(s,'metal_plan').filter(p=>p.status==='approved'))planned.set(p.groupKey,roundQuantity((planned.get(p.groupKey)||0)+p.quantity));
 for(const x of all(s,'outsource'))legacy.set(x.lineId,(legacy.get(x.lineId)||0)+1);
 for(const o of all(s,'order') as Order[])if(active(o)&&!isFinishedOutsource(o)&&o.quantity>0&&clean(o.orderNo)&&clean(o.drawing)){
  const k=groupKey(o);groups.set(k,[...(groups.get(k)||[]),o]);
 }
 return [...groups.entries()].filter(([,rows])=>rows.every(o=>ids.has(o.id))).map(([k,rows])=>{
  rows.sort((a,b)=>a.id.localeCompare(b.id));const first=rows[0],quantity=sum(rows,o=>o.quantity),plannedQuantity=planned.get(k)||0;
  const productionBlockers=unique(rows.flatMap(o=>hasRecordedProduction(o)?[]:handoffProductionGate(s,m,o).missing));
  const legacyOutsourceCount=rows.reduce((n,o)=>n+(legacy.get(o.id)||0),0);
  return {key:k,customer:first.customer,orderNo:first.orderNo,style:first.drawing,quantity,plannedQuantity,availableQuantity:Math.max(0,roundQuantity(quantity-plannedQuantity)),lines:rows.map(o=>({lineId:o.id,version:o.version,quantity:o.quantity,color:o.color,batch:o.batch,pmcPlannedDate:o.plannedDate,pmcRequestedDate:o.requestedDate})),productionReady:productionBlockers.length===0,productionBlockers,legacyOutsourceCount,historyNote:legacyOutsourceCount?'已有旧外发凭证；新增计划前须核对历史占用，不能将旧成品数量直接换算为本次配件需求。':''};
 });
}
function sourceGroup(s:State,m:Member,teamId:string,k:string){const g=metalSourceGroups(s,m,teamId).find(g=>g.key===k);ensure(g,'款式全部有效SKU不在当前授权范围或已退出在制。',409);return g;}
function assertProduction(s:State,m:Member,ids:string[]){for(const id of ids){const o=all(s,'order').find(o=>o.id===id) as Order|undefined;ensure(o&&active(o)&&!isFinishedOutsource(o),'来源已归档、取消或转为成品外发，请核对。',409);if(!hasRecordedProduction(o))assertHandoffProductionGate(s,m,o);}}
function process(s:State,id:string,expected?:number):MetalProcess{
 const p=all(s,'outsourcing_catalog_entry').find(p=>p.id===id&&p.category==='process'&&p.active===true);
 ensure(p,'请选择启用的共享外发工序。');if(expected!==undefined)version(p,expected);
 ensure(!all(s,'outsourcing_catalog_setting').some(x=>x.entryId===id&&x.department==='titanium'&&x.enabled===false),'此工序已在钛架部停用。');
 return {id:p.id,version:p.version,name:p.name,code:p.code||'',actions:p.actions||[],active:true,statProcess:p.statProcess||'',includeCost:p.includeCost||''};
}
function part(s:State,m:Member,teamId:string,id:string,expected?:number){const p=get<MetalPart>(s,m,teamId,id,'metal_part');ensure(p.active,'此配件已经停用。');if(expected!==undefined)version(p,expected);return p;}
function supplier(s:State,id:string){const p=all(s,'supplier').find(p=>p.id===id&&p.active===true);ensure(p,'请选择已启用的供应商。');return p;}
function newNumber(prefix:string,id:string,day:string){return prefix+day.replace(/-/g,'')+'-'+id.slice(-12).toUpperCase();}
function deliveryLines(s:State,status?:string){return metalRows<MetalDelivery>(s,'metal_delivery').filter(d=>!status||d.status===status).flatMap(d=>d.lines.map(l=>({...l,delivery:d})));}
export function metalJobReleased(s:State,jobLineId:string){return sum(metalRows(s,'metal_job_release').filter(r=>r.jobLineId===jobLineId),r=>r.quantity);}
function qcGood(q:MetalQc){return roundQuantity(q.billableGood+q.freeGood);}
function badUsed(s:State,qcId:string){return sum(deliveryLines(s).filter(l=>l.reworkQcId===qcId&&l.delivery.status!=='cancelled'),l=>l.quantity)+sum(metalRows(s,'metal_disposition').filter(d=>d.qcId===qcId),d=>d.quantity);}
function qcTotalCost(s:State,q:MetalQc){const adjustments=metalRows(s,'metal_adjustment').filter(a=>a.qcId===q.id&&a.status==='approved');return {gross:money(q.amountIncTax+sum(adjustments,a=>a.amountIncTax)),net:money(q.amountExTax+sum(adjustments,a=>a.amountExTax))};}
/** Allocation follows actual issues. Unissued goods retain the exact remaining shared cost. */
export function metalIssueCosts(s:State,q:MetalQc){
 const issues=metalRows<MetalIssue>(s,'metal_issue').filter(i=>i.qcId===q.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const total=qcTotalCost(s,q),good=qcGood(q);let qty=0,gross=0,net=0;
 return issues.map(i=>{qty=roundQuantity(qty+i.quantity);const nextGross=eq(qty,good)?total.gross:money(total.gross*qty/good),nextNet=eq(qty,good)?total.net:money(total.net*qty/good);const row={...i,amountIncTax:money(nextGross-gross),amountExTax:money(nextNet-net)};gross=nextGross;net=nextNet;return row;});
}
export function metalDemandBalance(s:State,d:MetalDemand):MetalDemandBalance{
 const jobs=metalRows<MetalJob>(s,'metal_job').filter(j=>j.status==='confirmed').flatMap(j=>j.lines).filter(l=>l.demandId===d.id),sent=deliveryLines(s,'dispatched').filter(l=>l.demandId===d.id),receipts=metalRows<MetalReceipt>(s,'metal_receipt').filter(r=>r.demandId===d.id),quality=metalRows<MetalQc>(s,'metal_qc').filter(q=>q.demandId===d.id),issues=quality.flatMap(q=>metalIssueCosts(s,q));
 const dispatched=sum(sent.filter(l=>!l.reworkQcId),l=>l.quantity),received=sum(receipts,r=>r.quantity),billableGood=sum(quality,q=>q.billableGood),freeGood=sum(quality,q=>q.freeGood),issued=sum(issues,i=>i.quantity);
 const unallocatedCostsByCurrency=unique(quality.map(q=>q.currency)).map(currency=>({currency,amountIncTax:money(sum(quality.filter(q=>q.currency===currency),q=>qcTotalCost(s,q).gross)-sum(issues.filter(i=>i.currency===currency),i=>i.amountIncTax))}));
 return {demandId:d.id,reserved:sum(jobs,l=>l.quantity-metalJobReleased(s,l.id)),dispatched,received,pendingQc:roundQuantity(received-sum(quality,q=>q.billableGood+q.freeGood+q.bad)),billableGood,freeGood,bad:sum(quality,q=>q.bad-badUsed(s,q.id)),issued,availableGood:roundQuantity(billableGood+freeGood-issued),stockAvailable:roundQuantity(sum(metalRows<MetalStock>(s,'metal_stock').filter(t=>t.demandId===d.id&&t.status==='confirmed'),t=>t.quantity)-dispatched),inTransit:roundQuantity(sum(sent,l=>l.quantity)-received),unallocatedCost:unallocatedCostsByCurrency.length>1?null:unallocatedCostsByCurrency[0]?.amountIncTax||0,unallocatedCostsByCurrency};
}
function sourceIds(sources:MetalPlan[]){return unique(sources.flatMap(p=>p.sourceLineIds));}
function demandLiveSources(s:State,m:Member,teamId:string,d:MetalDemand){
 for(const c of d.sources){const p=get<MetalPlan>(s,m,teamId,c.planId,'metal_plan');ensure(p.status==='approved','来源计划已取消。',409);const g=sourceGroup(s,m,teamId,p.groupKey);ensure(g.lines.length===p.sourceLines.length&&g.lines.every(x=>p.sourceLines.some(y=>y.lineId===x.lineId&&y.quantity===x.quantity)),'源订单身份、数量或SKU范围已变化，请重新核对未执行需求；一般备注和生产进度变化不影响已采用计划。',409);}
 assertProduction(s,m,d.sourceLineIds);
}
function matchQuote(s:State,m:Member,teamId:string,d:MetalDemand,id:string,expected:number,quantity:number,day:string){
 const q=get<MetalQuote>(s,m,teamId,id,'metal_quote');version(q,expected);ensure(q.status==='approved','报价尚未确认或已停用。',409);
 ensure(q.partId===d.part.id&&q.partVersion===d.part.version&&q.processId===d.process.id&&q.processVersion===d.process.version&&q.quantityUnit===d.unit&&q.requirements===d.requirements,'报价配件、版本、工序、单位或质量要求与需求不一致。');
 supplier(s,q.supplierId);part(s,m,teamId,d.part.id);process(s,d.process.id);ensure(day>=q.validFrom&&day<=q.validTo,'报价不在本次发出日期有效期内。');ensure(fits(q.qtyFrom,quantity)&&(q.qtyTo===null||fits(quantity,q.qtyTo)),'采用数量不符合报价数量范围。');return q;
}
function quoteVisible(s:State,m:Member,teamId:string,q:Entity){return !q.teamId||(!teamId||q.teamId===teamId)&&businessTeamData(s,m).teams.some(t=>t.id===q.teamId);}

export function metalData(s:State,m:Member,teamId=''):MetalData{
 requirePermission(m,s,'read');const ids=metalVisibleOrderIds(s,m,teamId),visible=<T extends Entity>(kind:string)=>all(s,kind).filter(r=>metalVisible(r,ids)) as T[];
 const permissions=metalPermissions(s,m),demands=visible<MetalDemand>('metal_demand');
 const result:MetalData={protocol:'doon-metal-outsourcing-v1',revision:s.revision,teamId,permissions,sourceGroups:metalSourceGroups(s,m,teamId),parts:all(s,'metal_part') as MetalPart[],processes:all(s,'outsourcing_catalog_entry').filter(p=>p.category==='process').map(p=>({id:p.id,version:p.version,name:p.name,code:p.code||'',actions:p.actions||[],active:p.active===true&&!all(s,'outsourcing_catalog_setting').some(x=>x.entryId===p.id&&x.department==='titanium'&&x.enabled===false),statProcess:p.statProcess||'',includeCost:p.includeCost||''})),suppliers:all(s,'supplier').filter(p=>p.active===true).map(p=>({id:p.id,name:p.name})),boms:visible('metal_bom'),plans:visible('metal_plan'),demands,quotes:permissions.price?all(s,'metal_quote').filter(q=>quoteVisible(s,m,teamId,q)) as MetalQuote[]:[],jobs:visible('metal_job'),releases:visible('metal_job_release'),stock:visible('metal_stock'),deliveries:visible('metal_delivery'),receipts:visible('metal_receipt'),quality:visible('metal_qc'),issues:visible<MetalIssue>('metal_issue').map(i=>i.voided?i:metalIssueCosts(s,metalRows<MetalQc>(s,'metal_qc').find(q=>q.id===i.qcId)!).find(x=>x.id===i.id)||i),settlements:permissions.price?visible('metal_settlement'):[],payments:permissions.price?visible('metal_payment'):[],adjustments:permissions.price?visible('metal_adjustment'):[],dispositions:visible('metal_disposition'),corrections:visible('metal_correction'),evidenceFiles:all(s,'attachment').filter(a=>ids.has(a.lineId)&&a.fileKey).map(a=>({id:a.id,lineId:a.lineId,filename:a.filename})),balances:demands.filter(live).map(d=>metalDemandBalance(s,d)),limitations:['本入口办理新增金属配件业务；历史原表尚未按确认范围导入。','按批收费、最低收费及供应商直转须另行办理，当前接口不接受其替代数据。','关闭加工单余量后低于原报价数量下限的情况须先确认价格调整，当前不允许直接释放或重算已发金额。','原表及既有订单台账保持只读；配件领用不自动写成成品报工。']};
 if(!permissions.price){const sensitive=new Set(['priceIncTax','taxRate','pricingFactor','pricingUnit','currency','amountIncTax','amountExTax','originalAmountIncTax','reworkAmountIncTax','unallocatedCost','unallocatedCostsByCurrency','freeReason','reference']);
  const redact=(v:any,inQuote=false):any=>Array.isArray(v)?v.map(x=>redact(x,inQuote)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!(sensitive.has(k)&&(inQuote||k!=='reference'))).map(([k,x])=>[k,redact(x,inQuote||k==='quote'||k==='reworkQuote')])):v;
  return redact(result) as MetalData;
 }
 return result;
}

export type MetalChange={records:Entity[];item:Entity};
/** Every mutation is returned as an atomic delta. Only metal_* entities may be changed. */
export function metalApply<A extends MetalAction>(action:A,input:MetalPostInputs[A],s:State,m:Member,teamId=''):MetalChange {
 requirePermission(m,s,'read');const p=input as any,records:Entity[]=[];let item:Entity;
 const obtain=<T extends Entity>(id:string,kind:string,expected?:number)=>{const r=get<T>(s,m,teamId,id,kind);if(expected!==undefined)version(r,expected);return r;};
 const demand=(id:string,expected?:number)=>{const d=obtain<MetalDemand>(id,'metal_demand',expected);ensure(d.status==='active','需求已取消。',409);return d;};
 const qc=(id:string,expected?:number)=>obtain<MetalQc>(id,'metal_qc',expected);
 const state=()=>({...s,records:[...s.records.filter(r=>!records.some(n=>n.id===r.id)),...records]});
 if(action==='metal-part-save'){
  requirePermission(m,s,'master');const before=p.id?obtain<MetalPart>(p.id,'metal_part',p.version):undefined;
  ensure(before||p.version===0,'新配件版本应为0。',409);
  ensure(!all(s,'metal_part').some(x=>x.id!==before?.id&&key(x.code)===key(p.part.code)&&key(x.revision)===key(p.part.revision)),'此配件编码和版本已经存在。',409);
  if(before){const used=all(s,'metal_bom').some(b=>b.lines.some((l:any)=>l.partId===before.id));if(used)for(const f of ['code','specification','material','side','unit','revision'])ensure(before[f as keyof MetalPart]===p.part[f],'已采用配件的身份、规格和单位不可覆盖，请另建配件版本。');}
  item=before?changed(before,m,p.part):{...base('metal_part',m),...p.part};
 }else if(action==='metal-bom-create'){
  requirePermission(m,s,'master');const g=sourceGroup(s,m,teamId,p.groupKey);
  ensure(!all(s,'metal_bom').some(b=>b.groupKey===g.key&&key(b.revision)===key(p.revision)),'此款BOM采用版本已存在。',409);
  const lines=p.lines.map((l:any)=>{part(s,m,teamId,l.partId,l.partVersion);process(s,l.processId,l.processVersion);return {...l,id:newId('metal_bom_line')};});
  assertUnique(lines.map((l:any)=>JSON.stringify([l.partId,l.processId,l.requirements])),'同BOM的配件工序');
  item={...base('metal_bom',m),groupKey:g.key,customer:g.customer,orderNo:g.orderNo,style:g.style,revision:p.revision,reference:p.reference,lines,status:'draft',sourceLineIds:g.lines.map(l=>l.lineId)};
 }else if(action==='metal-bom-approve'||action==='metal-bom-retire'){
  requirePermission(m,s,'master');const b=obtain<MetalBom>(p.id,'metal_bom',p.version);
  if(action==='metal-bom-approve'){ensure(b.status==='draft','只有草稿BOM可以确认。');sourceGroup(s,m,teamId,b.groupKey);for(const l of b.lines){part(s,m,teamId,l.partId,l.partVersion);process(s,l.processId,l.processVersion);}item=changed(b,m,{status:'approved',approvedBy:m.id,approvedAt:now()});}
  else{ensure(b.status!=='retired','BOM已经停用。');item=changed(b,m,{status:'retired',retireReason:p.reason} as any);}
 }else if(action==='metal-plan-create'){
  requirePermission(m,s,'plan');const b=obtain<MetalBom>(p.bomId,'metal_bom',p.bomVersion);ensure(b.status==='approved','须先确认采用BOM。');
  const g=sourceGroup(s,m,teamId,b.groupKey);assertUnique(p.sourceVersions.map((x:any)=>x.lineId),'来源SKU');
  ensure(p.sourceVersions.length===g.lines.length&&g.lines.every(l=>p.sourceVersions.some((v:any)=>v.lineId===l.lineId&&v.version===l.version)),'须包含同款全部有效SKU及当前版本，不能按颜色筛漏。',409);
  assertProduction(s,m,g.lines.map(l=>l.lineId));ensure(fits(p.quantity,g.availableQuantity),'本批数量超过尚未被PMC计划采用的订单数量。');
  for(const l of b.lines){part(s,m,teamId,l.partId,l.partVersion);process(s,l.processId,l.processVersion);}
  item={...base('metal_plan',m),groupKey:g.key,customer:g.customer,orderNo:g.orderNo,style:g.style,bomId:b.id,bomVersion:b.version,quantity:p.quantity,dueDate:date(p.dueDate),sourceLines:g.lines,sourceLineIds:g.lines.map(l=>l.lineId),status:'approved',note:p.note};
 }else if(action==='metal-plan-cancel'){
  requirePermission(m,s,'plan');const x=obtain<MetalPlan>(p.id,'metal_plan',p.version);ensure(x.status==='approved','计划已取消。');
  ensure(!metalRows<MetalDemand>(s,'metal_demand').some(d=>d.status==='active'&&d.sources.some(c=>c.planId===x.id)),'已有有效需求占用此计划，先取消尚未执行的需求。',409);item=changed(x,m,{status:'cancelled',cancelReason:p.reason} as any);
 }else if(action==='metal-demand-create'){
  requirePermission(m,s,'operate');assertUnique(p.sources.map((c:any)=>c.planId+'\u001f'+c.bomLineId),'计划配件来源');
  const plans:MetalPlan[]=[],contributions:MetalContribution[]=[];let prototype:{part:MetalPart;process:MetalProcess;requirements:string}|undefined;
  for(const c of p.sources){const plan=obtain<MetalPlan>(c.planId,'metal_plan',c.planVersion);ensure(plan.status==='approved','只能采用有效PMC计划。');const b=obtain<MetalBom>(plan.bomId,'metal_bom');
   const line=b.lines.find(l=>l.id===c.bomLineId);ensure(line,'配件行不属于此计划采用的BOM。');const component=part(s,m,teamId,line.partId,line.partVersion),step=process(s,line.processId,line.processVersion);
   if(plans.length)ensure(key(plans[0].customer)===key(plan.customer)&&key(plans[0].orderNo)===key(plan.orderNo),'共用配件明细只能合并同一客户的同一销售订单。');
   if(prototype)ensure(prototype.part.id===component.id&&prototype.part.version===component.version&&prototype.process.id===step.id&&prototype.process.version===step.version&&prototype.requirements===line.requirements,'配件、版本、工序或加工要求不同，须分开建立需求。');else prototype={part:component,process:step,requirements:line.requirements};
   const used=sum(metalRows<MetalDemand>(s,'metal_demand').filter(d=>d.status==='active').flatMap(d=>d.sources).filter(x=>x.planId===plan.id&&x.bomLineId===line.id),x=>x.quantity);
   ensure(fits(c.quantity,roundQuantity(plan.quantity*line.unitsPerProduct-used)),'来源配件需求已被占用，本次不能重复安排。',409);
   plans.push(plan);contributions.push({planId:plan.id,bomLineId:line.id,quantity:c.quantity,style:plan.style});
  }
  ensure(prototype&&plans.length,'请选择配件来源。');const quantity=sum(contributions,c=>c.quantity);ensure(quantity<=100000000,'单条汇总需求超过数量上限，请按实际批次拆分。');item={...base('metal_demand',m),customer:plans[0].customer,orderNo:plans[0].orderNo,...prototype,quantity,unit:prototype.part.unit,sources:contributions,sourceLineIds:sourceIds(plans),status:'active',dueDate:date(p.dueDate),note:p.note};
  demandLiveSources(s,m,teamId,item as MetalDemand);
 }else if(action==='metal-demand-cancel'){
  requirePermission(m,s,'operate');const d=demand(p.id,p.version);
  ensure(!metalRows<MetalJob>(s,'metal_job').some(j=>j.status==='confirmed'&&j.lines.some(l=>l.demandId===d.id))&&!metalRows<MetalStock>(s,'metal_stock').some(t=>t.demandId===d.id),'已有加工单或备货凭证，请先按顺序取消或冲销。',409);item=changed(d,m,{status:'cancelled',cancelReason:p.reason} as any);
 }else if(action==='metal-quote-create'){
  requirePermission(m,s,'operate');requirePermission(m,s,'price');const component=part(s,m,teamId,p.partId,p.partVersion),step=process(s,p.processId,p.processVersion),vendor=supplier(s,p.supplierId);
  ensure(p.priceIncTax>0||clean(p.freeReason),'零价必须有明确免费依据。');ensure(p.pricingUnit!==component.unit||eq(p.pricingFactor,1),'计价单位与数量单位相同时，换算系数必须为1。');
  ensure(date(p.validTo)>=date(p.validFrom),'报价止日不能早于起日。');ensure(p.qtyTo===null||fits(p.qtyFrom,p.qtyTo),'报价数量上限不能小于下限。');
  item={...base('metal_quote',m),...p,supplierName:vendor.name,quantityUnit:component.unit,processVersion:step.version,status:'draft',teamId};
 }else if(action==='metal-quote-approve'||action==='metal-quote-retire'){
  requirePermission(m,s,'approvePrice');const q=obtain<MetalQuote>(p.id,'metal_quote',p.version);
  if(action==='metal-quote-approve'){ensure(q.status==='draft','只有草稿报价可以确认。');supplier(s,q.supplierId);part(s,m,teamId,q.partId,q.partVersion);process(s,q.processId,q.processVersion);item=changed(q,m,{status:'approved',approvedBy:m.id,approvedAt:now()});}
  else{ensure(q.status!=='retired','报价已经停用。');item=changed(q,m,{status:'retired',retireReason:p.reason} as any);}
 }else if(action==='metal-job-create'){
  requirePermission(m,s,'operate');requirePermission(m,s,'price');date(p.date);const lines:MetalJobLine[]=[],demands:MetalDemand[]=[];let supplierId='';
  for(const l of p.lines){const d=demand(l.demandId,l.demandVersion);demandLiveSources(s,m,teamId,d);const q=matchQuote(s,m,teamId,d,l.quoteId,l.quoteVersion,l.quantity,p.date);
   ensure(!supplierId||supplierId===q.supplierId,'一张加工单只能选同一供应商。');ensure(!lines.length||lines[0].quote.currency===q.currency,'不同币种须分开建立加工单，不能汇成一个单据金额。');supplierId=q.supplierId;
   const pending=sum(lines.filter(x=>x.demandId===d.id),x=>x.quantity);ensure(fits(pending+l.quantity,d.quantity-metalDemandBalance(s,d).reserved),'加工单数量超过该需求未安排余量。',409);
   lines.push({id:newId('metal_job_line'),demandId:d.id,quantity:l.quantity,quote:{...q}});demands.push(d);
  }
  const b=base('metal_job',m);item={...b,number:newNumber('MW',b.id,p.date),supplierId,supplierName:supplier(s,supplierId).name,date:p.date,lines,sourceLineIds:unique(demands.flatMap(d=>d.sourceLineIds)),status:'confirmed',note:p.note};
 }else if(action==='metal-job-cancel'){
  requirePermission(m,s,'operate');const j=obtain<MetalJob>(p.id,'metal_job',p.version);ensure(j.status==='confirmed','加工单已取消。');ensure(!deliveryLines(s).some(l=>l.jobId===j.id&&l.delivery.status!=='cancelled'),'已有送货行占用，请先取消或冲销送货。',409);item=changed(j,m,{status:'cancelled',cancelReason:p.reason} as any);
 }else if(action==='metal-job-release'){
  requirePermission(m,s,'operate');const j=obtain<MetalJob>(p.jobId,'metal_job',p.jobVersion);ensure(j.status==='confirmed','加工单已取消。');const l=j.lines.find(l=>l.id===p.jobLineId);ensure(l,'加工单行不存在。');
  const used=sum(deliveryLines(s).filter(x=>x.jobLineId===l.id&&!x.reworkQcId&&x.delivery.status!=='cancelled'),x=>x.quantity),released=metalJobReleased(s,l.id);
  ensure(fits(p.quantity,l.quantity-used-released),'只能关闭未发且未被有效送货草稿占用的余量，请刷新核对。',409);
  ensure(fits(l.quote.qtyFrom,roundQuantity(l.quantity-released-p.quantity)),'关闭后保留量低于原报价数量下限；须先确认价格调整，不能默认继续采用原批量价或重算已发金额。',409);
  ensure(!metalRows(s,'metal_job_release').some(r=>r.jobLineId===l.id&&key(r.reference)===key(p.reference)),'此加工单行的余量关闭凭证已登记。',409);
  item={...base('metal_job_release',m),jobId:j.id,jobLineId:l.id,demandId:l.demandId,quantity:p.quantity,reason:p.reason,reference:p.reference,sourceLineIds:j.sourceLineIds};
 }else if(action==='metal-stock-add'){
  requirePermission(m,s,'stock');const d=demand(p.demandId,p.demandVersion);demandLiveSources(s,m,teamId,d);date(p.date);
  const evidence=all(s,'attachment').find(a=>a.id===p.evidenceAttachmentId&&d.sourceLineIds.includes(a.lineId)&&a.fileKey);ensure(evidence,'须选择属于该订单的已上传出库/生产转出凭证。');
  ensure(!metalRows(s,'metal_stock').some(t=>key(t.reference)===key(p.reference)),'此出库或转出单行编号已登记，不可重复增加可发量。',409);
  const stocked=sum(metalRows<MetalStock>(s,'metal_stock').filter(t=>t.demandId===d.id),t=>t.quantity);ensure(fits(stocked+p.quantity,d.quantity),'备货数量超过核定需求；追加数量须另有需求依据。');
  item={...base('metal_stock',m),...p,sourceLineIds:d.sourceLineIds,status:'draft'};
 }else if(action==='metal-stock-confirm'){
  requirePermission(m,s,'stock');const t=obtain<MetalStock>(p.id,'metal_stock',p.version);ensure(t.status==='draft','备货凭证已确认。');const d=demand(t.demandId);demandLiveSources(s,m,teamId,d);
  ensure(all(s,'attachment').some(a=>a.id===t.evidenceAttachmentId&&d.sourceLineIds.includes(a.lineId)&&a.fileKey),'原出库凭证缺失，不能确认可发量。');item=changed(t,m,{status:'confirmed',confirmedBy:m.id,confirmedAt:now()});
 }else if(action==='metal-delivery-create'){
  requirePermission(m,s,'operate');dateOrder(p.dueDate,p.date,'应回日期');const lines:MetalDeliveryLine[]=[],orders:MetalJob[]=[];let supplierId='';
  assertUnique(p.lines.map((l:any)=>l.jobId+'\u001f'+l.jobLineId),'加工单明细');
  for(const l of p.lines){const j=obtain<MetalJob>(l.jobId,'metal_job',l.jobVersion);ensure(j.status==='confirmed','加工单已取消。');const jl=j.lines.find(x=>x.id===l.jobLineId);ensure(jl,'加工单行不存在。');dateOrder(p.date,j.date,'送货日期');ensure(!supplierId||supplierId===j.supplierId,'一张送货单只能包含同一供应商。');supplierId=j.supplierId;
   ensure(!lines.length||lines[0].quote.currency===jl.quote.currency,'不同币种的加工单须分开建立送货单。');const used=sum(deliveryLines(s).filter(x=>x.jobLineId===jl.id&&!x.reworkQcId&&x.delivery.status!=='cancelled'),x=>x.quantity);ensure(fits(l.quantity,jl.quantity-metalJobReleased(s,jl.id)-used),'送货数量超过此加工行尚未安排量（已关闭余量不能再发）。',409);
   lines.push({id:newId('metal_delivery_line'),jobId:j.id,jobLineId:jl.id,demandId:jl.demandId,quantity:l.quantity,reworkQcId:'',quote:jl.quote});orders.push(j);
  }
  const b=base('metal_delivery',m);item={...b,number:newNumber('MS',b.id,p.date),supplierId,supplierName:supplier(s,supplierId).name,date:p.date,dueDate:p.dueDate,lines,sourceLineIds:unique(orders.flatMap(j=>j.sourceLineIds)),status:'draft',reference:p.reference,note:p.note};
 }else if(action==='metal-delivery-dispatch'){
  requirePermission(m,s,'stock');const delivery=obtain<MetalDelivery>(p.id,'metal_delivery',p.version);ensure(delivery.status==='draft','只有草稿可以确认实际发出，重打单据不产生新实发。',409);supplier(s,delivery.supplierId);
  for(const l of delivery.lines){const d=demand(l.demandId);demandLiveSources(s,m,teamId,d);
   if(l.reworkQcId){const q=qc(l.reworkQcId);ensure(fits(badUsed(s,q.id),q.bad),'返工与处置数量超过不良可处理量。',409);dateOrder(delivery.date,q.date,'返工发出日期');
    if(l.reworkQuote)matchQuote(s,m,teamId,d,l.reworkQuote.id,l.reworkQuote.version,l.quantity,delivery.date);else ensure(clean(l.freeReworkReason),'免费返工缺少依据。');
   }else{const j=obtain<MetalJob>(l.jobId,'metal_job'),jl=j.lines.find(x=>x.id===l.jobLineId);ensure(j.status==='confirmed'&&jl,'加工单已取消或原行不存在。',409);
    // A tier is the approved job-line quantity, not the size of a subsequent shipment.
    const assigned=sum(deliveryLines(s).filter(x=>x.jobLineId===jl.id&&!x.reworkQcId&&x.delivery.status!=='cancelled'),x=>x.quantity);ensure(fits(assigned,jl.quantity-metalJobReleased(s,jl.id)),'加工单可发余量已变化，请刷新核对。',409);matchQuote(s,m,teamId,d,l.quote.id,l.quote.version,jl.quantity,delivery.date);
    const total=sum(delivery.lines.filter(x=>x.demandId===d.id&&!x.reworkQcId),x=>x.quantity),available=metalDemandBalance(s,d).stockAvailable;ensure(fits(total,available),'实际发出超过已确认出库/转出凭证的可发数量。',409);
    const stock=metalRows<MetalStock>(s,'metal_stock').filter(t=>t.demandId===d.id&&t.status==='confirmed');ensure(fits(total+metalDemandBalance(s,d).dispatched,sum(stock.filter(t=>t.date<=delivery.date),t=>t.quantity)),'发出日期早于可用出库凭证日期。');
   }
  }
  item=changed(delivery,m,{status:'dispatched',dispatchedAt:now()});
 }else if(action==='metal-delivery-cancel'){
  requirePermission(m,s,'operate');const d=obtain<MetalDelivery>(p.id,'metal_delivery',p.version);ensure(d.status==='draft','已实际发出须使用有凭据的更正，不能直接取消。');item=changed(d,m,{status:'cancelled',cancelReason:p.reason} as any);
 }else if(action==='metal-delivery-sign'){
  requirePermission(m,s,'operate');const d=obtain<MetalDelivery>(p.id,'metal_delivery',p.version);ensure(d.status==='dispatched','尚未实际发出。');ensure(!d.signedAt,'已签收凭据不可覆盖。',409);dateOrder(p.signedAt,d.date,'签收日期');item=changed(d,m,{signedAt:p.signedAt,signedBy:p.signedBy,signatureReference:p.reference});
 }else if(action==='metal-receipt-create'){
  requirePermission(m,s,'stock');const delivery=obtain<MetalDelivery>(p.deliveryId,'metal_delivery',p.deliveryVersion);ensure(delivery.status==='dispatched','送货尚未实际发出。');const l=delivery.lines.find(x=>x.id===p.deliveryLineId);ensure(l,'送货行不存在。');dateOrder(p.date,delivery.date,'实际收回日期');
  const existing=metalRows<MetalReceipt>(s,'metal_receipt').filter(r=>r.deliveryLineId===l.id);ensure(!existing.some(r=>key(r.reference)===key(p.reference)),'此送货行的收货凭证编号已经登记。',409);ensure(fits(p.quantity,l.quantity-sum(existing,r=>r.quantity)),'收回量超过此发货行尚在外的数量。',409);
  item={...base('metal_receipt',m),...p,demandId:l.demandId,sourceLineIds:delivery.sourceLineIds};
 }else if(action==='metal-quality-create'){
  requirePermission(m,s,'quality');const r=obtain<MetalReceipt>(p.receiptId,'metal_receipt',p.receiptVersion);ensure(!metalRows<MetalQc>(s,'metal_qc').some(q=>q.receiptId===r.id),'本次实收已有质检结论，不可重复检入数量。',409);dateOrder(p.date,r.date,'质检日期');
  ensure(eq(p.billableGood+p.freeGood+p.bad,r.quantity),'计费良品、免费良品和不良合计须等于本次实收数量。');
  const delivery=obtain<MetalDelivery>(r.deliveryId,'metal_delivery'),l=delivery.lines.find(x=>x.id===r.deliveryLineId)!;ensure(l,'原送货明细不存在。');
  const originalAmountIncTax=metalAmount(p.billableGood,l.quote.priceIncTax,l.quote.pricingFactor),reworkAmountIncTax=l.reworkQuote?metalAmount(p.billableGood,l.reworkQuote.priceIncTax,l.reworkQuote.pricingFactor):0;
  const amountIncTax=money(originalAmountIncTax+reworkAmountIncTax),amountExTax=money(metalNet(originalAmountIncTax,l.quote.taxRate)+(l.reworkQuote?metalNet(reworkAmountIncTax,l.reworkQuote.taxRate):0));
  item={...base('metal_qc',m),...p,demandId:r.demandId,sourceLineIds:r.sourceLineIds,supplierId:delivery.supplierId,quote:l.quote,...(l.reworkQuote?{reworkQuote:l.reworkQuote}:{}),originalAmountIncTax,reworkAmountIncTax,amountIncTax,amountExTax,currency:l.quote.currency};
 }else if(action==='metal-rework-create'){
  requirePermission(m,s,'operate');const q=qc(p.qcId,p.qcVersion),d=demand(q.demandId);dateOrder(p.date,q.date,'返工日期');dateOrder(p.dueDate,p.date,'返工应回日期');ensure(fits(p.quantity,q.bad-badUsed(s,q.id)),'返工量超过尚未处置的不良量。',409);
  const receipt=obtain<MetalReceipt>(q.receiptId,'metal_receipt'),original=obtain<MetalDelivery>(receipt.deliveryId,'metal_delivery'),line=original.lines.find(x=>x.id===receipt.deliveryLineId)!;
  ensure(line,'原送货行缺失。');let reworkQuote:MetalQuote|undefined;
  if(p.quoteId){requirePermission(m,s,'price');ensure(p.quoteVersion!==undefined,'请选择报价版本。');reworkQuote=matchQuote(s,m,teamId,d,p.quoteId,p.quoteVersion,p.quantity,p.date);ensure(reworkQuote.supplierId===original.supplierId&&reworkQuote.currency===line.quote.currency,'返工供应商或币种与原加工单不符；不得作为普通返工转给其他供应商。');}
  else ensure(clean(p.freeReason),'免费返工必须记录免额外加工费依据。');
  const b=base('metal_delivery',m);item={...b,number:newNumber('MR',b.id,p.date),supplierId:original.supplierId,supplierName:original.supplierName,date:p.date,dueDate:p.dueDate,lines:[{id:newId('metal_delivery_line'),jobId:line.jobId,jobLineId:line.jobLineId,demandId:d.id,quantity:p.quantity,reworkQcId:q.id,quote:line.quote,...(reworkQuote?{reworkQuote}:{}),freeReworkReason:p.freeReason}],sourceLineIds:d.sourceLineIds,status:'draft',reference:p.reference,note:p.note};
 }else if(action==='metal-issue-create'){
  requirePermission(m,s,'issue');const q=qc(p.qcId,p.qcVersion),d=demand(q.demandId),plan=obtain<MetalPlan>(p.planId,'metal_plan',p.planVersion);dateOrder(p.date,q.date,'领用日期');
  ensure(plan.status==='approved'&&d.sources.some(c=>c.planId===plan.id),'此款式不是共用料的核定来源，不能领用。');
  const previous=metalRows<MetalIssue>(s,'metal_issue').filter(i=>i.qcId===q.id);ensure(!previous.some(i=>key(i.reference)===key(p.reference)),'此合格批次领用凭证已登记。',409);ensure(fits(p.quantity,qcGood(q)-sum(previous,i=>i.quantity)),'领用超过此批合格待分配量。',409);
  const required=sum(d.sources.filter(c=>c.planId===plan.id),c=>c.quantity),issued=sum(metalRows<MetalIssue>(s,'metal_issue').filter(i=>i.demandId===d.id&&i.planId===plan.id),i=>i.quantity);ensure(fits(issued+p.quantity,required),'此款领用超过它对该共用配件的核定需求。');
  const b=base('metal_issue',m);item={...b,...p,demandId:d.id,style:plan.style,amountIncTax:0,amountExTax:0,currency:q.currency,sourceLineIds:d.sourceLineIds};
  const allocated=metalIssueCosts({...s,records:[...s.records,item]},q).find(i=>i.id===b.id)!;item={...item,amountIncTax:allocated.amountIncTax,amountExTax:allocated.amountExTax};
 }else if(action==='metal-adjustment-create'){
  requirePermission(m,s,'settle');const q=qc(p.qcId,p.qcVersion);ensure(p.amountIncTax!==0,'扣补金额不可为零。');
  ensure(!metalRows(s,'metal_adjustment').some(a=>a.qcId===q.id&&key(a.reference)===key(p.reference)),'此计费记录的扣补凭据已登记。',409);
  // A QC may contain two tax rates. A single adjustment cannot silently invent a blended rate.
  ensure(!q.reworkQuote||q.reworkQuote.taxRate===q.quote.taxRate,'此质检包含不同税率费用，须分项处理，不能用一个扣补金额混算税额。');
  item={...base('metal_adjustment',m),...p,supplierId:q.supplierId,currency:q.currency,amountExTax:metalNet(p.amountIncTax,q.quote.taxRate),status:'draft',sourceLineIds:q.sourceLineIds};
 }else if(action==='metal-adjustment-approve'){
  requirePermission(m,s,'settle');const a=obtain(p.id,'metal_adjustment',p.version);ensure(a.status==='draft','扣补已经确认。');const q=qc(a.qcId);ensure(qcTotalCost(s,q).gross+a.amountIncTax>=0,'扣款超过该笔加工费，不可使加工应付成为负数。');item=changed(a,m,{status:'approved',approvedBy:m.id,approvedAt:now()});
 }else if(action==='metal-disposition-create'){
  requirePermission(m,s,'quality');const q=qc(p.qcId,p.qcVersion);dateOrder(p.date,q.date,'不良处置日期');ensure(fits(p.quantity,q.bad-badUsed(s,q.id)),'处置量超过未安排返工或其他处置的不良余量。',409);item={...base('metal_disposition',m),...p,sourceLineIds:q.sourceLineIds};
 }else if(action==='metal-settlement-create'){
  requirePermission(m,s,'settle');assertUnique(p.qcIds,'计费明细');assertUnique(p.adjustmentIds||[],'扣补明细');const quality=p.qcIds.map((id:string)=>qc(id)),adjustments=(p.adjustmentIds||[]).map((id:string)=>obtain(id,'metal_adjustment'));
  ensure(quality.length||adjustments.length,'请选择至少一笔计费或扣补明细。');const facts=[...quality,...adjustments],first=facts[0];
  ensure(facts.every(f=>f.supplierId===first.supplierId&&f.currency===first.currency),'一张对账单只能使用同供应商和同币种。');
  for(const q of quality)ensure(q.amountIncTax>0,'零应付质检保留凭证，无需进入加工费对账。');
  for(const a of adjustments)ensure(a.status==='approved','扣补须先由财务确认。');
  for(const bill of metalRows<MetalSettlement>(s,'metal_settlement').filter(b=>b.status!=='cancelled')){ensure(!bill.qcIds.some(id=>p.qcIds.includes(id))&&!(bill.adjustmentIds||[]).some(id=>(p.adjustmentIds||[]).includes(id)),'计费或扣补明细已被另一有效对账单占用。',409);}
  // An adjustment may accompany its original charge or follow an already confirmed charge.
  for(const a of adjustments)ensure(p.qcIds.includes(a.qcId)||metalRows<MetalSettlement>(s,'metal_settlement').some(b=>b.status==='confirmed'&&b.qcIds.includes(a.qcId)),'扣补须与原计费一起对账，或引用已确认原对账。');
  const amountIncTax=money(sum(facts,f=>f.amountIncTax)),amountExTax=money(sum(facts,f=>f.amountExTax));ensure(amountIncTax>=0,'负数净对账需要贷项抵扣流程，当前不能当成正数应付入账。');
  const b=base('metal_settlement',m);item={...b,number:newNumber('MC',b.id,p.period+'-01'),supplierId:first.supplierId,supplierName:supplier(s,first.supplierId).name,period:p.period,qcIds:p.qcIds,adjustmentIds:p.adjustmentIds||[],currency:first.currency,amountIncTax,amountExTax,status:'draft',reference:p.reference,sourceLineIds:unique(facts.flatMap(f=>f.sourceLineIds)),note:p.note};
 }else if(action==='metal-settlement-confirm'){
  requirePermission(m,s,'settle');const bill=obtain<MetalSettlement>(p.id,'metal_settlement',p.version);ensure(bill.status==='draft','只有草稿对账单可以确认。');
  const facts=[...bill.qcIds.map(id=>qc(id)),...(bill.adjustmentIds||[]).map(id=>obtain(id,'metal_adjustment'))];ensure(eq(money(sum(facts,f=>f.amountIncTax)),bill.amountIncTax),'计费依据发生变化，请重新核对。',409);
  for(const other of metalRows<MetalSettlement>(s,'metal_settlement').filter(b=>b.id!==bill.id&&b.status!=='cancelled'))ensure(!other.qcIds.some(id=>bill.qcIds.includes(id))&&!(other.adjustmentIds||[]).some(id=>bill.adjustmentIds.includes(id)),'同一计费事实已被另一对账单占用。',409);
  item=changed(bill,m,{status:'confirmed',confirmedBy:m.id,confirmedAt:now()});
 }else if(action==='metal-settlement-cancel'){
  requirePermission(m,s,'settle');const b=obtain<MetalSettlement>(p.id,'metal_settlement',p.version);ensure(b.status==='draft','已确认对账须通过有凭据的更正处理。');item=changed(b,m,{status:'cancelled',cancelReason:p.reason} as any);
 }else if(action==='metal-payment-create'){
  requirePermission(m,s,'pay');const b=obtain<MetalSettlement>(p.settlementId,'metal_settlement',p.settlementVersion);ensure(b.status==='confirmed','仅已确认对账可以登记真实付款凭证。');date(p.date);
  ensure(!metalRows(s,'metal_payment').some(x=>key(x.reference)===key(p.reference)),'付款凭证编号已登记，不能重复计款。',409);const paid=sum(metalRows(s,'metal_payment').filter(x=>x.settlementId===b.id),x=>x.amount);ensure(fits(p.amount,b.amountIncTax-paid),'付款超过该对账未付金额。');
  item={...base('metal_payment',m),...p,sourceLineIds:b.sourceLineIds};
 }else if(action==='metal-correction'){
  const target=s.records.find(x=>x.id===p.targetId&&live(x));ensure(target&&target.kind.startsWith('metal_'),'待更正记录不存在。',404);const financial=['metal_settlement','metal_payment','metal_adjustment'].includes(target.kind);ensure(m.role==='admin'||financial&&metalPermissions(s,m).settle,'业务事实冲销由管理员办理，财务凭证由财务或管理员办理。',403);
  const t=obtain(p.targetId,target.kind,p.targetVersion);assertCorrectable(s,t);
  const corrected=changed(t,m,{voided:true,voidReason:p.reason});records.push(corrected);item={...base('metal_correction',m),targetId:t.id,targetKind:t.kind,reason:p.reason,reference:p.reference,sourceLineIds:t.sourceLineIds||[]};
 }else throw new AppError('未支持的金属外发操作。',404);
 // Do not persist request-only optimistic guards as business content.
 for(const name of ['token','demandVersion','deliveryVersion','receiptVersion','qcVersion','planVersion','settlementVersion','targetVersion'])delete item[name];
 records.push(item);void state;return {records,item};
}

/** Reverse downstream facts first. No cascading edit and no deletion of original evidence. */
function assertCorrectable(s:State,t:Entity){
 const rows=s.records.filter(live),has=(kind:string,fn:(r:Entity)=>boolean)=>rows.some(r=>r.kind===kind&&fn(r));let blocked=false;
 if(t.kind==='metal_stock'){
  const demand=metalRows<MetalDemand>(s,'metal_demand').find(d=>d.id===t.demandId)!;blocked=!!demand&&t.status==='confirmed'&&!fits(t.quantity,metalDemandBalance(s,demand).stockAvailable);
  if(t.status==='confirmed')for(const line of deliveryLines(s,'dispatched').filter(l=>l.demandId===t.demandId&&!l.reworkQcId)){
   const sent=sum(deliveryLines(s,'dispatched').filter(l=>l.demandId===t.demandId&&!l.reworkQcId&&l.delivery.date<=line.delivery.date),l=>l.quantity),stocked=sum(metalRows<MetalStock>(s,'metal_stock').filter(x=>x.id!==t.id&&x.demandId===t.demandId&&x.status==='confirmed'&&x.date<=line.delivery.date),x=>x.quantity);if(!fits(sent,stocked))blocked=true;
  }
 }else if(t.kind==='metal_delivery')blocked=has('metal_receipt',r=>r.deliveryId===t.id);
 else if(t.kind==='metal_job_release'){
  const job=metalRows<MetalJob>(s,'metal_job').find(j=>j.id===t.jobId),d=metalRows<MetalDemand>(s,'metal_demand').find(d=>d.id===t.demandId);blocked=!job||job.status!=='confirmed'||!d||!fits(metalDemandBalance(s,d).reserved+t.quantity,d.quantity);
 }
 else if(t.kind==='metal_receipt')blocked=has('metal_qc',r=>r.receiptId===t.id);
 else if(t.kind==='metal_qc')blocked=has('metal_issue',r=>r.qcId===t.id)||has('metal_disposition',r=>r.qcId===t.id)||has('metal_adjustment',r=>r.qcId===t.id)||has('metal_delivery',r=>r.status!=='cancelled'&&r.lines.some((l:any)=>l.reworkQcId===t.id))||has('metal_settlement',r=>r.status!=='cancelled'&&r.qcIds.includes(t.id));
 else if(t.kind==='metal_settlement')blocked=has('metal_payment',r=>r.settlementId===t.id)||has('metal_settlement',r=>r.id!==t.id&&r.status!=='cancelled'&&(r.adjustmentIds||[]).some((id:string)=>rows.some(a=>a.id===id&&t.qcIds.includes(a.qcId))));
 else if(t.kind==='metal_adjustment')blocked=has('metal_settlement',r=>r.status!=='cancelled'&&(r.adjustmentIds||[]).includes(t.id));
 else if(t.kind==='metal_issue'||t.kind==='metal_payment'||t.kind==='metal_disposition'){/* Append-only reversal reopens the corresponding available balance. */}
 else throw new AppError('此记录不可作为业务事实冲销；请使用相应草稿取消/资料停用。');
 ensure(!blocked,'已有下游领用、检验、返工、对账或付款事实，须先逐项核对并更正下游，禁止级联改账。',409);
}
