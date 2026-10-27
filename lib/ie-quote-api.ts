import {z} from 'zod';
import {all,newId,now,strictDate,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {ieWorkbookGet,ieWorkbookPost} from './ie-quote-workbook-api';
import {ieQuoteNotificationGet,ieQuoteNotificationPost} from './ie-quote-notification-api';
import {memberNotificationMailboxGet,memberNotificationMailboxPost} from './member-notification-mailboxes';
import {ieAttachmentGet,ieAttachmentPost} from './ie-quote-attachment-api';
import {ieHandoffGet,ieHandoffPost} from './ie-quote-handoff-api';
import {validateIeMaterialNameReferences,latestIeMaterialNameCatalog,materialPartChecklist} from './ie-material-names';
import {canConfigureIeQuotes,canFillIeQuote,canReadIeAccount,canReadIeQuote,canUseIeQuotes,ieCapabilities,iePolicyInput,iePolicyMember,ieQuotePolicy,isIeApprover,isIeEngineeringMember,publicIePolicy,type IeQuotePolicy} from './ie-quote-access';
import {calculateIeQuote,canReviewIeQuote,currentIeQuote,ieQuoteInput,ieQuoteIssues,ieQuotePreparedByIds,ieQuoteReviewRouting,ieQuoteVersion,ieProcessSchema,ieNumericValue,latestReleasedIeVersion,publicIeQuote,type IeCatalog,type IeQuote,type IeQuoteFields,type IeQuoteRevision,type IeTooling} from './ie-quotes';

const id=z.string().trim().min(1).max(120),version=z.number().int().positive(),change=z.object({id,version}).strict();
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{const result=schema.safeParse(input);if(!result.success)throw new AppError(result.error.issues.slice(0,6).map(i=>`${i.path.join('.')}: ${i.message}`).join('；'));return result.data;}
function allowed(s:State,m:Member){if(!canUseIeQuotes(s,m))throw new AppError('没有 IE 工程报价权限，请联系管理员核对角色绑定和客户责任。',403);}
function engineering(s:State,m:Member){if(!canFillIeQuote(s,m))throw new AppError('仅管理员及绑定的工程主管、生产副总、总经理可以填写工程报价。',403);}
function current(q:{version:number},expected:number){if(q.version!==expected)throw new AppError('该记录已更新，你的输入未覆盖新版本；请刷新核对。',409);}
function quote(s:State,m:Member,id:string){const q=currentIeQuote(s,id);if(!q||!canReadIeQuote(s,m,q))throw new AppError('工程报价不存在或没有此客户的访问权限。',403);return q;}
function editable(s:State,m:Member,q:IeQuote){engineering(s,m);if(!['draft','returned'].includes(q.status))throw new AppError('提交后的工程报价不能直接修改；已发布版本请先创建修订。',409);}
function configured(s:State){if(!ieQuotePolicy(s)||!iePolicyMember(s,'engineer')||!iePolicyMember(s,'reviewer')||!iePolicyMember(s,'finalApprover'))throw new AppError('请管理员先绑定三位不同的有效成员：工程主管、生产副总、总经理。',409);}
function mergeState(s:State,records:Entity[]):State{const ids=new Set(records.map(r=>r.id));return {...s,records:[...s.records.filter(r=>!ids.has(r.id)),...records]};}
export function buildIeQuotePersistenceRecords(m:Member,q:IeQuote,before:IeQuote|null,action:string):Entity[]{
 const revision:IeQuoteRevision={id:newId('ie_quote_revision'),kind:'ie_quote_revision',quoteId:q.id,version:q.version,revision:q.revision,action,updatedAt:q.updatedAt,updatedBy:m.name,snapshot:structuredClone(q)};
 return [q,revision,audit(m,q,before,action,'IE 工程报价',q)];
}
async function persist(s:State,m:Member,q:IeQuote,before:IeQuote|null,action:string){const records=buildIeQuotePersistenceRecords(m,q,before,action);await commit(s.revision,records);return json({ok:true,quote:publicIeQuote(mergeState(s,records),m,q)});}
function validateCatalog(s:State,fields:IeQuoteFields){
 for(const l of fields.lines){for(const [category,rows] of [['material',l.materials],['process',l.processes],['outsourcing',l.outsourcing]] as const){for(const row of rows){
  if(!row.catalogId&&!row.catalogVersion)continue;
  const entries=all(s,'ie_quote_catalog_revision').filter(r=>r.catalogId===row.catalogId&&r.version===row.catalogVersion),c=entries.length===1?entries[0].snapshot as IeCatalog:null;
  if(!c||c.category!==(category==='outsourcing'?(row as IeQuoteFields['lines'][number]['outsourcing'][number]).category:category))throw new AppError('引用的工艺 / 基价版本无效，请重新选择价格依据。');
  const exact=row.name===c.name&&row.priceSource===c.priceSource&&(category==='outsourcing'?(row as IeQuoteFields['lines'][number]['outsourcing'][number]).unitPrice===c.basePrice:(row as IeQuoteFields['lines'][number]['materials'][number]).basePrice===c.basePrice);
  if(!exact)throw new AppError('所选目录版本的名称、基价和依据不能被静默改写；要手动价请清除目录引用并写明依据。');
  if(category==='material'){const r=row as IeQuoteFields['lines'][number]['materials'][number];if(r.specification!==c.specification||r.unit!==c.unit)throw new AppError('材料规格或单位不符合所选目录快照。');}
  if(category==='process'&&(row as IeQuoteFields['lines'][number]['processes'][number]).standardSeconds!==c.standardSeconds)throw new AppError('标准秒工时不符合所选工艺目录版本。');
 }}}
}
function publicTooling(t:IeTooling){const {id,version,customerAccountId,name,reference,chargeStatus,evidence,updatedAt,updatedBy}=t;return {id,version,customerAccountId,name,reference,chargeStatus,evidence,updatedAt,updatedBy};}

export async function ieQuoteGet(action:string,url:URL,s:State,m:Member):Promise<Response|null>{
 const handoff=ieHandoffGet(action,url,s,m);if(handoff)return handoff;
 const attachment=await ieAttachmentGet(action,url,s,m);if(attachment)return attachment;
 const memberMailbox=memberNotificationMailboxGet(action,s,m);if(memberMailbox)return memberMailbox;
 const notification=await ieQuoteNotificationGet(action,url,s,m);if(notification)return notification;
 const workbook=await ieWorkbookGet(action,url,s,m);if(workbook)return workbook;
 if(!['ie-quotes','ie-quote','ie-quote-policy'].includes(action))return null;allowed(s,m);
 if(action==='ie-quote-policy'){if(!canConfigureIeQuotes(m))throw new AppError('仅管理员可查看角色绑定候选成员。',403);return json({policy:publicIePolicy(s,m)});}
 if(action==='ie-quote'){
  const quoteId=url.searchParams.get('id')||'',raw=url.searchParams.get('version'),v=raw===null?undefined:Number(raw);if(v!==undefined&&(!Number.isSafeInteger(v)||v<1))throw new AppError('工程报价版本无效。');
  const q=ieQuoteVersion(s,quoteId,v),current=currentIeQuote(s,quoteId);if(!q||!current||current.customerAccountId!==q.customerAccountId||!canReadIeQuote(s,m,current)||!canReadIeQuote(s,m,q))throw new AppError('工程报价版本不存在或无权查看。',403);return json({quote:publicIeQuote(s,m,q)});
 }
 const customers=(all(s,'customer_account') as CustomerAccount[]).filter(a=>a.active&&canReadIeAccount(s,m,a)).map(({id,customer,customerCode})=>({id,customer,customerCode}));
 const includeInactive=url.searchParams.get('includeInactive')==='1';if(includeInactive&&!isIeEngineeringMember(s,m))throw new AppError('只有工程维护人员可查询已停用的基价和工艺预设。',403);
 const visibleCustomers=new Set(customers.map(a=>a.id));
 const toolingChargeSources=(all(s,'ie_quote') as IeQuote[]).filter(q=>canReadIeQuote(s,m,q)).flatMap(q=>{const released=latestReleasedIeVersion(s,q.id);return released&&released.customerAccountId===q.customerAccountId&&canReadIeQuote(s,m,released)&&released.tooling.some(t=>t.chargeMode==='charge')?[publicIeQuote(s,m,released)]:[];});
 return json({materialChecklist:materialPartChecklist(latestIeMaterialNameCatalog(s)),canUse:true,quotes:(all(s,'ie_quote') as IeQuote[]).filter(q=>canReadIeQuote(s,m,q)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(q=>publicIeQuote(s,m,q)),customers,capabilities:ieCapabilities(s,m),policy:publicIePolicy(s,m),
 toolingChargeSources,
 toolingRegistry:(all(s,'ie_quote_tooling') as IeTooling[]).filter(t=>visibleCustomers.has(t.customerAccountId)).map(publicTooling),
 catalog:(all(s,'ie_quote_catalog') as IeCatalog[]).filter(c=>c.active||includeInactive).map(({id,version,category,name,specification,unit,basePrice,standardSeconds,priceSource,effectiveDate,active})=>({id,version,category,name,specification,unit,basePrice,standardSeconds,priceSource,effectiveDate,active})),
 processPresets:all(s,'ie_quote_process_preset').filter(p=>p.active||includeInactive).map(({id,version,name,description,processes,active,updatedAt,updatedBy})=>({id,version,name,description,processes,active,updatedAt,updatedBy})),
 });
}
export async function ieQuotePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const handoff=await ieHandoffPost(action,req,s,m);if(handoff)return handoff;
 const attachment=await ieAttachmentPost(action,req,s,m);if(attachment)return attachment;
 const memberMailbox=await memberNotificationMailboxPost(action,req,s,m);if(memberMailbox)return memberMailbox;
 const notification=await ieQuoteNotificationPost(action,req,s,m);if(notification)return notification;
 const workbook=await ieWorkbookPost(action,req,s,m);if(workbook)return workbook;
 if(!['ie-quote-save','ie-quote-submit','ie-quote-review','ie-quote-revise','ie-quote-policy','ie-quote-tooling-register','ie-quote-catalog-save','ie-quote-process-preset-save'].includes(action))return null;allowed(s,m);
 if(action==='ie-quote-policy')return savePolicy(req,s,m);
 if(action==='ie-quote-tooling-register')return saveTooling(req,s,m);
 if(action==='ie-quote-catalog-save')return saveCatalog(req,s,m);
 if(action==='ie-quote-process-preset-save')return saveProcessPreset(req,s,m);
 configured(s);
 if(action==='ie-quote-save'){
  engineering(s,m);const {id,version,...fields}=parse(ieQuoteInput,await req.json()),before=id?quote(s,m,id):null;
  if(before){editable(s,m,before);current(before,version!);if(before.customerAccountId!==fields.customerAccountId)throw new AppError('已保存工程报价不能改为其他客户；请为其他客户新建报价。');if(before.materialPricingMode==='checklist'&&fields.materialPricingMode!=='checklist')throw new AppError('此报价已使用材料清单规则，请刷新页面后保存，避免退回旧计价口径。',409);if(before.manualAdjustments?.length&&fields.manualAdjustments===undefined)throw new AppError('此报价包含人工调整，请刷新到支持人工调整的表格后保存，避免覆盖已确认的人工金额。',409);}
  const a=all(s,'customer_account').find(a=>a.id===fields.customerAccountId) as CustomerAccount|undefined;if(!a?.active)throw new AppError('请选择有效的客户档案。');
  const nameReferenceIssue=validateIeMaterialNameReferences(s,fields);if(nameReferenceIssue)throw new AppError(nameReferenceIssue);validateCatalog(s,fields);const at=now(),q:IeQuote={...before,...fields,id:before?.id||newId('ie_quote'),kind:'ie_quote',version:(before?.version||0)+1,revision:before?.revision||1,status:before?.status==='returned'?'returned':'draft',customerName:a.customer,customerCode:a.customerCode,preparedByIds:before?ieQuotePreparedByIds(s,before,m.id):[m.id],policyVersion:ieQuotePolicy(s)!.version,requiredReviewMemberId:'',costs:calculateIeQuote(fields),createdAt:before?.createdAt||at,createdBy:before?.createdBy||m.name,createdById:before?.createdById||m.id,updatedAt:at,updatedBy:m.name,updatedById:m.id};
  q.attachmentRefs=(before?.attachmentRefs||[]).filter(ref=>fields.lines.some(line=>line.id===ref.lineId));
  return persist(s,m,q,before,before?'保存工程报价草稿':'创建工程报价草稿');
 }
 if(action==='ie-quote-review'){
  const input=parse(change.extend({decision:z.enum(['approve','return']),reason:z.string().trim().max(4000)}).strict(),await req.json()),before=quote(s,m,input.id);current(before,input.version);
  if(!canReviewIeQuote(s,m,before))throw new AppError('该提交版本只能由指定复核人审核，填报人与复核人不能相同。',403);
  if(input.decision==='return'&&!input.reason)throw new AppError('退回必须说明原因。');
  if(input.decision==='approve'){const issues=ieQuoteIssues(s,before,before.id);if(issues.length)throw new AppError('报价仍需补充：'+issues.slice(0,8).join('；'));}
  const at=now(),q:IeQuote={...before,status:input.decision==='approve'?'released':'returned',version:before.version+1,reviewedAt:at,reviewedBy:m.name,reviewedById:m.id,reviewReason:input.reason,updatedAt:at,updatedBy:m.name,updatedById:m.id};
  return persist(s,m,q,before,input.decision==='approve'?'复核发布工程报价':'退回工程报价补充');
 }
 const input=parse(change,await req.json()),before=quote(s,m,input.id);current(before,input.version);engineering(s,m);const at=now();
 if(action==='ie-quote-submit'){
  editable(s,m,before);const issues=ieQuoteIssues(s,before,before.id);if(issues.length)throw new AppError('报价仍需补充：'+issues.slice(0,8).join('；'));validateCatalog(s,before);
  const {preparedByIds,reviewer,reason}=ieQuoteReviewRouting(s,before,m.id);
  if(!reviewer)throw new AppError(reason,409);
  const tooling=before.tooling.map(t=>t.chargeMode==='already_charged'?{...t,evidence:String(all(s,'ie_quote_tooling').find(r=>r.id===t.toolingId&&r.customerAccountId===before.customerAccountId)?.evidence||'')}:t);
  const q:IeQuote={...before,tooling,status:'submitted',version:before.version+1,preparedByIds,requiredReviewMemberId:reviewer.id,policyVersion:ieQuotePolicy(s)!.version,submittedAt:at,submittedBy:m.name,submittedById:m.id,updatedAt:at,updatedBy:m.name,updatedById:m.id};delete q.reviewedAt;delete q.reviewedBy;delete q.reviewedById;delete q.reviewReason;
  return persist(s,m,q,before,'提交工程报价复核');
 }
 if(before.status!=='released')throw new AppError('只有已发布工程报价可以创建修订。',409);
 const q:IeQuote={...before,status:'draft',version:before.version+1,revision:before.revision+1,preparedByIds:ieQuotePreparedByIds(s,before,m.id),requiredReviewMemberId:'',updatedAt:at,updatedBy:m.name,updatedById:m.id};
 for(const key of ['submittedAt','submittedBy','submittedById','reviewedAt','reviewedBy','reviewedById','reviewReason'] as const)delete q[key];
 return persist(s,m,q,before,'创建工程报价修订草稿');
}
async function savePolicy(req:Request,s:State,m:Member){
 if(!canConfigureIeQuotes(m))throw new AppError('只有管理员可绑定工程报价角色。',403);
 const input=parse(iePolicyInput,await req.json()),before=ieQuotePolicy(s);if(all(s,'ie_quote_policy').length>1||(!before&&all(s,'ie_quote_policy').length))throw new AppError('角色配置重复或损坏，请核查配置记录。',409);if((before?.version||0)!==input.version)throw new AppError('角色绑定已更新，请刷新。',409);
 const ids=[input.engineerMemberId,input.reviewerMemberId,input.finalApproverMemberId];if(new Set(ids).size!==3)throw new AppError('工程主管、生产副总、总经理必须绑定三位不同成员。');
 if(ids.some(id=>!all(s,'member').some(v=>v.id===id&&v.active&&v.role!=='supplier')))throw new AppError('只能绑定有效的内部成员。');
 if(all(s,'ie_quote').some(q=>q.status==='submitted'))throw new AppError('存在待复核工程报价，请先完成或退回后再调整绑定，避免改变审批责任。',409);
 const p:IeQuotePolicy={...input,id:before?.id||newId('ie_quote_policy'),kind:'ie_quote_policy',version:input.version+1,updatedAt:now(),updatedBy:m.name};
 const records=[p,audit(m,p,before,'绑定工程报价角色','IE 工程报价',p)];await commit(s.revision,records);return json({ok:true,policy:publicIePolicy(mergeState(s,records),m)});
}
async function saveTooling(req:Request,s:State,m:Member){
 if(!canFillIeQuote(s,m))throw new AppError('只有管理员及绑定的工程主管、生产副总、总经理可以登记共用模具。',403);
 const input=parse(z.object({id:id.optional(),version:version.optional(),customerAccountId:id,name:z.string().trim().min(1).max(240),reference:z.string().trim().min(1).max(500),chargeStatus:z.enum(['uncollected','collected']),evidence:z.string().trim().max(4000)}).strict(),await req.json());
 const before=input.id?all(s,'ie_quote_tooling').find(r=>r.id===input.id) as IeTooling|undefined:undefined;if(input.id&&!before)throw new AppError('模具登记不存在。',404);if(before){current(before,input.version||0);if(before.customerAccountId!==input.customerAccountId||before.reference!==input.reference)throw new AppError('稳定模具登记不能变更客户或识别编号。');}else if(input.version)throw new AppError('新登记不能提供版本。');
 if(!all(s,'customer_account').some(a=>a.id===input.customerAccountId&&a.active))throw new AppError('请选择有效客户。');
 if(all(s,'ie_quote_tooling').some(r=>r.id!==before?.id&&r.customerAccountId===input.customerAccountId&&String(r.reference).trim().toUpperCase()===input.reference.toUpperCase()))throw new AppError('该客户此模具识别编号已登记，请复用原编号。',409);
 if(input.chargeStatus==='collected'&&(!isIeApprover(s,m)||!input.evidence))throw new AppError('实际收费须由生产副总或总经理凭收费记录确认。',403);
 if(before?.chargeStatus==='collected'&&input.chargeStatus!=='collected')throw new AppError('已有收费记录不能直接撤销；请保留历史并核对差异。',409);
 const t:IeTooling={...input,id:before?.id||newId('ie_quote_tooling'),kind:'ie_quote_tooling',version:(before?.version||0)+1,updatedAt:now(),updatedBy:m.name,updatedById:m.id};
 await commit(s.revision,[t,{id:newId('ie_quote_tooling_revision'),kind:'ie_quote_tooling_revision',toolingId:t.id,version:t.version,snapshot:structuredClone(t)},audit(m,t,before||null,input.chargeStatus==='collected'?'登记模具实际收费凭证':'登记共用模具识别编号','IE 工程报价',t)]);return json({ok:true,tooling:publicTooling(t)});
}
async function saveCatalog(req:Request,s:State,m:Member){
 engineering(s,m);const input=parse(z.object({id:id.optional(),version:version.optional(),category:z.enum(['material','process','plating','general']),name:z.string().trim().min(1).max(240),specification:z.string().trim().max(1000),unit:z.string().trim().max(40),basePrice:ieNumericValue,standardSeconds:ieNumericValue.nullable(),priceSource:z.string().trim().min(1).max(1000),effectiveDate:z.string().refine(v=>{try{return !!v&&strictDate(v)===v;}catch{return false;}},'生效日期无效'),active:z.boolean()}).strict(),await req.json());
 const before=input.id?all(s,'ie_quote_catalog').find(c=>c.id===input.id) as IeCatalog|undefined:undefined;if(input.id&&!before)throw new AppError('目录项目不存在。',404);if(before)current(before,input.version||0);else if(input.version)throw new AppError('新目录不能提供版本。');
 if(before&&before.category!==input.category)throw new AppError('已登记目录不能变更类别，请新建。');if(input.category==='process'&&input.standardSeconds===null)throw new AppError('标准工艺须填写秒工时，工时仅作工艺分析，不参与计价。');
 const c:IeCatalog={...input,id:before?.id||newId('ie_quote_catalog'),kind:'ie_quote_catalog',version:(before?.version||0)+1,updatedAt:now(),updatedBy:m.name};
 await commit(s.revision,[c,{id:newId('ie_quote_catalog_revision'),kind:'ie_quote_catalog_revision',catalogId:c.id,version:c.version,snapshot:structuredClone(c)},audit(m,c,before||null,'维护工程报价基价及工艺目录','IE 工程报价',c)]);return json({ok:true,catalog:c});
}
async function saveProcessPreset(req:Request,s:State,m:Member){
 engineering(s,m);const input=parse(z.object({id:id.optional(),version:version.optional(),name:z.string().trim().min(1).max(240),description:z.string().trim().max(4000),processes:z.array(ieProcessSchema).min(1).max(300),active:z.boolean()}).strict(),await req.json());
 const before=input.id?all(s,'ie_quote_process_preset').find(p=>p.id===input.id):undefined;if(input.id&&!before)throw new AppError('工艺预设不存在。',404);if(before)current({version:before.version},input.version||0);else if(input.version)throw new AppError('新预设不能提供版本。');
 const ids=new Set(input.processes.map(p=>p.id));if(ids.size!==input.processes.length)throw new AppError('预设工序编号重复。');
 for(const p of input.processes){if(!p.name||(!p.notApplicable&&(p.basePrice===null||p.difficulty===null||p.standardSeconds===null||!p.priceSource))||(p.notApplicable&&!p.notes))throw new AppError('预设须包含工序名称、标准秒工时、基价、难度和依据；不适用须说明。');let next=p.parentId,seen=new Set([p.id]);while(next){if(!ids.has(next)||seen.has(next))throw new AppError('预设工序上级无效或形成循环。');seen.add(next);next=input.processes.find(v=>v.id===next)?.parentId||'';}}
 validateCatalog(s,{lines:[{materials:[],outsourcing:[],processes:input.processes}]} as unknown as IeQuoteFields);
 const preset={...input,id:before?.id||newId('ie_quote_process_preset'),kind:'ie_quote_process_preset',version:(before?.version||0)+1,updatedAt:now(),updatedBy:m.name};
 await commit(s.revision,[preset,{id:newId('ie_quote_process_preset_revision'),kind:'ie_quote_process_preset_revision',presetId:preset.id,version:preset.version,snapshot:structuredClone(preset)},audit(m,preset,before||null,'维护工艺流程预设','IE 工程报价',preset)]);return json({ok:true,preset});
}
