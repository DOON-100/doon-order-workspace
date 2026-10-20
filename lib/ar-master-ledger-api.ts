import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {arAccess,arCurrencies,arDay} from './ar-workspace';
import {arMasterActiveLinks,arMasterBases,arMasterBoundary,arMasterData,arMasterDto,arMasterFormalTarget,arMasterMoneyLimit,arMasterRegistrationPlan,arMasterRequire,arMasterSourceCurrent,arMasterSourceHash,arMasterTarget,arMasterTargetKinds,type ArMasterQuery} from './ar-master-ledger';

const id=z.string().trim().min(1).max(160),token=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),version=z.number().int().positive(),reason=z.string().trim().min(2).max(3000);
const nullableCents=z.number().int().min(-arMasterMoneyLimit).max(arMasterMoneyLimit).nullable();
const base={id,version,sourceHash:hash,token};
const registerSchema=z.object({sourceIds:z.array(id).max(500),invoiceCustomerIds:z.array(id).max(100).default([]),previewHash:hash,token}).strict();
const saveSchema=z.object({...base,customerId:z.string().trim().max(160),teamId:z.string().trim().max(160),currency:z.union([z.enum(arCurrencies),z.literal('')]),amountBasis:z.enum(arMasterBases),asOf:z.string().max(10).nullable(),amountCents:nullableCents,receivedCents:nullableCents,balanceCents:nullableCents,reviewStatus:z.enum(['pending','confirmed']),note:z.string().trim().max(10000).default(''),reason}).strict();
const linkSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('link'),relation:z.enum(['origin','same_receivable']),targetKind:z.enum(arMasterTargetKinds),targetId:id,targetVersion:version,reason}).strict(),
 z.object({...base,action:z.literal('cancel'),linkId:id,reason}).strict(),
]);
function parse<T extends z.ZodTypeAny>(schema:T,raw:unknown):z.infer<T>{const r=schema.safeParse(raw);if(!r.success)throw new AppError(r.error.issues.slice(0,5).map(e=>e.path.join('.')+'：'+e.message).join('；'));return r.data;}
function writer(s:State,m:Member){if(!arAccess(s,m).canConfigure)throw new AppError('仅现有有权管理员可登记及核对应收总表；只读账号不可写入。',403);}
function current(row:Entity,v:number){if(row.version!==v)throw new AppError('总表版本已变化，请刷新重新核对。',409);}
async function sourceCurrent(s:State,row:Entity,hash:string){if(row.sourceHash!==hash||!await arMasterSourceCurrent(s,row))throw new AppError('原暂存记录或来源哈希已变化，不能沿用旧预览。请核对来源差异。',409);}
function replay(s:State,m:Member,action:string,inputToken:string,fingerprint:string){
 const prior=all(s,'ar_master_request').find(r=>r.id==='ar_master_request_'+inputToken);if(!prior)return null;
 if(prior.actorId!==m.id||prior.action!==action||prior.fingerprint!==fingerprint)throw new AppError('请求标识已用于不同内容。',409);
 return json({...prior.result,idempotent:true});
}
async function write(s:State,m:Member,action:string,inputToken:string,fingerprint:string,items:Entity[],result:Record<string,unknown>,before:Entity|null=null){
 const response={ok:true,...result},at=now(),records:Entity[]=[];
 for(const item of items){const prior=before?.id===item.id?before:null;records.push(item,{id:newId('ar_master_history'),kind:'ar_master_history',entryId:item.kind==='ar_master_entry'?item.id:item.entryId||'',targetId:item.id,actorId:m.id,action,before:prior?structuredClone(prior):null,after:structuredClone(item),createdAt:at},audit(m,item,prior,action,'应收账款总表'));}
 records.push({id:'ar_master_request_'+inputToken,kind:'ar_master_request',actorId:m.id,action,fingerprint,result:response,createdAt:at});
 await commit(s.revision,records);return json(response);
}
function futureState(s:State,items:Entity[]):State{const ids=new Set(items.map(r=>r.id));return {...s,records:[...s.records.filter(r=>!ids.has(r.id)),...items]};}
export async function arMasterLedgerGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-master-data','ar-master-export'].includes(action))return null;
 const p=new URL(req.url).searchParams,query:ArMasterQuery={customerId:p.get('customerId')||'',teamId:p.has('teamId')?p.get('teamId')!:req.headers.get('X-Workspace-Team')||'',id:p.get('id')||''};
 if(Object.values(query).some(v=>typeof v==='string'&&v.length>160))throw new AppError('筛选条件过长。');
 if(p.has('invoiceCustomerIds'))query.invoiceCustomerIds=parse(z.array(id).max(100),(p.get('invoiceCustomerIds')||'').split(',').filter(Boolean));
 const data=await arMasterData(s,m,query);if(action==='ar-master-data')return json(data);
 if(!data.scope.canExport)throw new AppError('没有总表导出权限。',403);
 const quoted=(v:unknown)=>'"'+String(v??'').replace(/^(\s*)([=+@\-\t\r])/,'$1\t$2').replaceAll('"','""')+'"';
 const amount=(v:number|null)=>v===null?'待核对':(v/100).toFixed(2);
 const sourceText=(source:Entity)=>[source.customerLabel,source.title,'原金额='+String(source.originalAmountDecimal??'未填写'),'币种='+String(source.currency||'待核对'),'原PO/PL='+String(source.poPlRaw||'未填写'),'付款条件='+String(source.paymentTermsRaw||'未填写'),'工作表='+String(source.sourceSheet||source.source?.sheet||''),'行='+String(source.sourceRow??source.source?.rowNumber??''),'原发票日期='+String(source.invoiceDateRaw||'未填写'),'原到期日='+String(source.dueDateRaw||'未填写'),'原备注='+String(source.remarkRaw||'')].join(' | ');
 const versionText=(source:Entity)=>[source.invoiceNo,source.sourceSheet,'版本='+String(source.sourceVersion||source.version||''),'原发票日期='+String(source.invoiceDate||'未填写'),'历史净应收='+amount(source.amountCents??null),'历史累计实收='+amount(source.status==='confirmed'?source.receivedCents??null:null),'状态='+String(source.status),'单元格='+(source.sourceCells||[]).join(','),'原备注='+String(source.remarks||''),'原异常='+(Array.isArray(source.issues)?source.issues.join('；'):'')].join(' | ');
 const lines=[['总表ID','客户','原客户代码','所属组','票号/事项','币种','原表金额(精确文本)','金额口径','截至日','确认净应收','确认历史实收','确认未收','核对状态','来源工作表','来源行','来源哈希','核对事项','历史已核对净应收(非当前余额)','历史已核对实收','历史已核对未收','历史金额截至日','历史收款状态','原发票版本数','全部原发票版本依据','附加原表来源依据','来源异常','主历史表原始依据(PO/付款条件/日期/备注)'],
  ...data.rows.map(r=>[r.id,r.customer,r.sourceSnapshot?.customerLabel,r.teamName,r.title,r.currency,r.sourceSnapshot?.originalAmountDecimal===null||r.sourceSnapshot?.originalAmountDecimal===undefined?'未填写':'\t'+String(r.sourceSnapshot.originalAmountDecimal),r.amountBasis,r.asOf||'待核对',amount(r.amountCents),amount(r.receivedCents),amount(r.balanceCents),r.reviewStatus,r.sourceSnapshot?.sourceSheet||r.sourceSnapshot?.source?.sheet,r.sourceSnapshot?.sourceRow??r.sourceSnapshot?.source?.rowNumber,r.sourceHash,r.issues.join('；'),amount(r.historicalAmounts?.amountCents??null),amount(r.historicalAmounts?.receivedCents??null),amount(r.historicalAmounts?.balanceCents??null),r.historicalAmounts?.sourceAsOf||'未知，不代表本日余额',r.historicalAmounts?.paymentRemark||'未核对',(r.sourceSnapshots||[]).length,(r.sourceSnapshots||[]).map(versionText).join('\n'),(r.additionalSources||[]).map(sourceText).join('\n'),r.sourceIssues.join('；'),r.sourceKind==='ar_legacy_pending'?sourceText(r.sourceSnapshot):''])];
 return new Response('\uFEFF'+lines.map(line=>line.map(quoted).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ar-master-ledger.csv"','Cache-Control':'no-store'}});
}
export async function arMasterLedgerPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-master-register-legacy','ar-master-entry-save','ar-master-source-link'].includes(action))return null;
 writer(s,m);const raw=await req.json();
 if(action==='ar-master-register-legacy'){
  const input=parse(registerSchema,raw);
  if(!input.sourceIds.length&&!input.invoiceCustomerIds.length)throw new AppError('请选择至少一个历史来源或发票客户。');
  const plan=await arMasterRegistrationPlan(s,m,input.sourceIds,input.invoiceCustomerIds);
  if(plan.previewHash!==input.previewHash)throw new AppError('来源范围、版本或归并结果已变化，请刷新登记预览。',409);
  const fp=await arMasterSourceHash({...input,sourceIds:[...input.sourceIds].sort(),invoiceCustomerIds:[...input.invoiceCustomerIds].sort()}),prior=replay(s,m,action,input.token,fp);if(prior)return prior;
  const created:Entity[]=[],existing:Entity[]=[],warnings:{entryId:string;sourceId:string;message:string}[]=[];
  const batchId=newId('ar_master_batch'),at=now();
  for(const planned of plan.entries){
   const found=all(s,'ar_master_entry').filter(r=>r.sourceId===planned.sourceId&&r.sourceKind===planned.sourceKind);
   if(found.length>1)throw new AppError('该来源已有多个总表记录，请先核对异常。',409);
   if(found[0]){
    if(found[0].sourceHash!==planned.sourceHash||!await arMasterSourceCurrent(s,found[0]))warnings.push({entryId:found[0].id,sourceId:planned.sourceId,message:'已登记来源有新版本或内容变化；保留原总表冻结依据，变化项请回原档案核对。'});
    existing.push(found[0]);continue;
   }
   const legacyIds=planned.sourceKind==='ar_legacy_pending'?[planned.sourceId]:(planned.additionalSources||[]).map(r=>r.id);
   if(all(s,'ar_master_entry').some(e=>legacyIds.some(sourceId=>e.sourceKind==='ar_legacy_pending'&&e.sourceId===sourceId||(e.additionalSources||[]).some((a:Entity)=>a.id===sourceId))))throw new AppError('归并来源已由其他总表条目登记，请先处理已有条目的关联，不能再登记重复应收。',409);
   created.push({...planned,id:newId('ar_master_entry'),kind:'ar_master_entry',version:1,batchId,
    teamId:'',amountBasis:'unknown',asOf:null,amountCents:null,receivedCents:null,balanceCents:null,reviewStatus:'pending',note:'',
    contributesToCash:false,contributesToProductionBalance:false,createdAt:at,createdById:m.id,updatedAt:at,updatedById:m.id});
  }
  const batch:Entity={id:batchId,kind:'ar_master_batch',version:1,sourceIds:plan.sourceIds,invoiceCustomerIds:plan.invoiceCustomerIds,previewHash:plan.previewHash,entryCount:plan.entryCount,overlapCount:plan.overlapCount,createdEntryIds:created.map(r=>r.id),existingEntryIds:existing.map(r=>r.id),warnings,createdAt:at,createdById:m.id};
  const next=futureState(s,created),rows=await Promise.all([...created,...existing].map(r=>arMasterDto(next,m,r)));
  return write(s,m,action,input.token,fp,[...created,batch],{batch,rows,warnings,idempotent:!created.length,boundary:arMasterBoundary});
 }
 if(action==='ar-master-entry-save'){
  const input=parse(saveSchema,raw),row=arMasterRequire(s,m,input.id);await sourceCurrent(s,row,input.sourceHash);
  const fp=await arMasterSourceHash(input),prior=replay(s,m,action,input.token,fp);if(prior)return prior;current(row,input.version);
  if(input.asOf!==null&&!arDay(input.asOf))throw new AppError('金额截至日须为有效 YYYY-MM-DD，未知时填空。');
  if(input.customerId&&!all(s,'customer_account').some(c=>c.id===input.customerId))throw new AppError('请手工选择真实客户，不接受来源文本作为客户ID。');
  if(row.sourceKind==='ar_invoice_group'&&input.customerId!==row.invoiceSourceCustomerId)throw new AppError('历史发票已有明确客户归属，不能在总表重映射为其他客户。');
  if(input.teamId&&!all(s,'customer_project_team').some(t=>t.id===input.teamId))throw new AppError('请选择真实历史所属组。');
  const active=arMasterActiveLinks(s,row.id);if(active.length&&input.customerId!==row.customerId)throw new AppError('已有来源关联，须先取消关联再更正客户归属。',409);
  if(active.some(l=>l.relation==='same_receivable')&&input.currency!==row.currency)throw new AppError('已有同一应收关联，须先取消关联再更正币种。',409);
  if(input.amountCents!==null&&input.receivedCents!==null&&input.balanceCents!==null&&input.amountCents-input.receivedCents!==input.balanceCents)throw new AppError('三项金额齐全时，净应收减历史实收必须等于未收；不能自动补差。');
  if(input.reviewStatus==='confirmed'){
   if(!input.customerId||!input.currency||!input.asOf||input.amountBasis==='unknown')throw new AppError('确认账务前须明确客户、币种、原金额口径及截至日。');
   if(input.amountBasis==='gross_receivable'&&[input.amountCents,input.receivedCents,input.balanceCents].some(v=>v===null))throw new AppError('应收总额口径须明确净应收、历史实收和未收，未知不可按零确认。');
   if(input.amountBasis==='opening_balance'&&input.balanceCents===null)throw new AppError('期初未收口径须明确截至日未收余额；原应收或历史实收仍可未知。');
  }
  const {id:_,version:__,sourceHash:___,token:____,reason:_____,...fields}=input;
  const item:Entity={...row,...fields,version:row.version+1,updatedAt:now(),updatedById:m.id,lastReason:input.reason};
  return write(s,m,action,input.token,fp,[item],{item:await arMasterDto(futureState(s,[item]),m,item)},row);
 }
 const input=parse(linkSchema,raw),row=arMasterRequire(s,m,input.id);await sourceCurrent(s,row,input.sourceHash);
 const fp=await arMasterSourceHash(input),prior=replay(s,m,action,input.token,fp);if(prior)return prior;current(row,input.version);
 const at=now(),item:Entity={...row,version:row.version+1,updatedAt:at,updatedById:m.id,lastReason:input.reason};let link:Entity;
 if(input.action==='cancel'){
  const original=arMasterActiveLinks(s,row.id).find(l=>l.id===input.linkId);if(!original)throw new AppError('关联不存在或已取消，不能覆盖关联历史。',409);
  link={id:newId('ar_master_source_link_cancel'),kind:'ar_master_source_link_cancel',version:1,entryId:row.id,entryVersion:row.version,linkId:original.id,reason:input.reason,createdAt:at,createdById:m.id};
 }else{
  const target=arMasterTarget(s,m,row.customerId,input.targetKind,input.targetId);if(!target)throw new AppError('请选择同一已确认客户下真实存在且可读取的原来源。',403);
  if(target.version!==input.targetVersion)throw new AppError('原来源版本已变化，请刷新后重新核对。',409);
  if(arMasterActiveLinks(s,row.id).some(l=>l.relation===input.relation&&l.targetKind===input.targetKind&&l.targetId===input.targetId))throw new AppError('本行已有相同关联。',409);
  const formal=input.relation==='same_receivable'?arMasterFormalTarget(s,m,row.customerId,input.targetKind,input.targetId):null;
  if(input.relation==='same_receivable'){
   if(!formal)throw new AppError('同一应收只能引用已存在且有效的正式项目收费或订单应收；订单、PI、历史发票仅可作来源证据。');
   if(row.currency&&row.currency!==formal.currency)throw new AppError('本行与正式应收币种不一致，须先核对。');
   if(arMasterActiveLinks(s,row.id).some(l=>l.relation==='same_receivable'))throw new AppError('本行已有正式应收关联，须先取消旧关联。',409);
   if(all(s,'ar_master_source_link').some(l=>l.relation==='same_receivable'&&l.entryId!==row.id&&arMasterActiveLinks(s,l.entryId).some(active=>active.id===l.id)&&
    (l.targetKind===input.targetKind&&l.targetId===input.targetId||l.formalSnapshot?.canonicalKey===formal.canonicalKey||arMasterFormalTarget(s,m,l.customerId,l.targetKind,l.targetId)?.canonicalKey===formal.canonicalKey)))throw new AppError('该正式应收已被另一总表行引用，请先核对重复来源。',409);
  }
  link={id:newId('ar_master_source_link'),kind:'ar_master_source_link',version:1,entryId:row.id,entryVersion:row.version,customerId:row.customerId,relation:input.relation,targetKind:input.targetKind,targetId:input.targetId,targetVersion:target.version,targetSnapshot:structuredClone(target),formalSnapshot:formal?structuredClone(formal):null,reason:input.reason,createdAt:at,createdById:m.id};
 }
 const next=futureState(s,[item,link]);return write(s,m,action,input.token,fp,[item,link],{item:await arMasterDto(next,m,item),link},row);
}
