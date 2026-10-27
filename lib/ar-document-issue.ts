import {z} from 'zod';
import {all,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {activePaymentTerm,paymentTermSnapshot,paymentTermTriggerLabels,type PaymentTerm} from './payment-terms';
import {arAccess,arAttribution,arCurrencies,arDay,arReadOnly,arToday,arUngrouped} from './ar-workspace';

const id=z.string().trim().min(1).max(160);
const inputSchema=z.object({token:z.string().uuid(),sourceKind:z.literal('project_billing_document'),sourceId:id,expectedVersion:z.number().int().positive(),teamId:id,paymentTermId:id,category:z.enum(['sample','mold','bulk']),reviewId:id.optional()}).strict();
type Input=z.infer<typeof inputSchema>;
function projectFor(s:State,d:Entity){const projectIds=[...new Set([d.projectId,...(Array.isArray(d.lines)?d.lines.map((l:any)=>l.projectId):[])].filter(Boolean))];return projectIds.length===1?all(s,'customer_project').find(p=>p.id===projectIds[0]&&p.customerId===d.customerId):undefined;}
/** Existing explicit responsibility IDs define the commercial review capability; administrator and finance roles alone do not. */
export function arCanReviewDocument(s:State,m:Member,d:Entity){
 if(!m.active||arReadOnly(s,m)||!['sales','clerk','pmc','admin'].includes(m.role))return false;
 const p=projectFor(s,d);if(p)return p.salesMemberId===m.id&&p.status==='active'&&!p.trashedAt;
 const primary=all(s,'customer_workflow_state').find(w=>w.customerId===d.customerId)?.primarySalesMemberId;
 if(primary)return primary===m.id;
 const c=all(s,'customer_account').find(c=>c.id===d.customerId&&c.active);return !!c&&Array.isArray(c.salesMemberIds)&&c.salesMemberIds.includes(m.id);
}
function canWrite(s:State,m:Member,d:Entity){
 if(!m.active||arReadOnly(s,m)||!['sales','clerk','pmc','admin'].includes(m.role))return false;
 if(m.role==='admin')return true;const c=all(s,'customer_account').find(c=>c.id===d.customerId&&c.active),p=projectFor(s,d);
 return !!c&&[...(c.salesMemberIds||[]),...(c.serviceMemberIds||[]),...(p?.serviceMemberIds||[]),p?.salesMemberId,p?.serviceMemberId].includes(m.id);
}
function digest(d:Entity,teamId:string,term:PaymentTerm,category:string){return JSON.stringify({source:d,teamId,term:paymentTermSnapshot(term),category});}
function sourceReasons(s:State,d:Entity,teamId:string,term:PaymentTerm|undefined,category:string){
 const reasons:string[]=[],p=projectFor(s,d),c=all(s,'customer_account').find(c=>c.id===d.customerId);
 if(d.kind!=='project_billing_document')return ['订单 PI 签发归集尚待接入，不能把已核对资料自动当应收'];
 if(d.status==='confirmed'||all(s,'project_document_send').some(send=>send.documentId===d.id))reasons.push('历史已确认或发送 PI 请关联原应收，不重新签发生效或重写原付款计划');
 if(d.documentType!=='PI')reasons.push('仅 PI 可在此签发');if(!clean(d.documentNo))reasons.push('PI 编号待填写');if(!c?.active)reasons.push('客户未匹配或已停用');if(!p||p.status!=='active'||p.trashedAt)reasons.push('须关联唯一有效开发项目');
 const team=all(s,'customer_project_team').find(t=>t.id===teamId&&t.active&&Array.isArray(t.customerIds)&&t.customerIds.includes(d.customerId));if(!team||p&&p.teamId!==teamId)reasons.push('须明确该项目及客户的有效所属组');
 if(!term)reasons.push('须选择公司已授权的付款条件');if(!arCurrencies.includes(d.currency))reasons.push('PI 币种待确认');
 const lines=Array.isArray(d.lines)?d.lines:[];if(!lines.length||lines.some((l:any)=>!Number.isSafeInteger(l.amountCents)||l.amountCents<=0))reasons.push('PI 明细金额必须明确且大于零');
 const total=lines.reduce((n:number,l:any)=>n+(Number.isSafeInteger(l.amountCents)?l.amountCents:0),0);if(!Number.isSafeInteger(total)||total>100_000_000_000)reasons.push('PI 金额超出有效范围');
 const ids=lines.map((l:any)=>l.chargeId).filter(Boolean);if(new Set(ids).size!==ids.length)reasons.push('PI 重复引用同一收费');
 for(const line of lines){if(!line.chargeId)continue;const charge=all(s,'project_charge').find(x=>x.id===line.chargeId);if(!charge||charge.customerId!==d.customerId||charge.projectId!==p?.id||charge.currency!==d.currency||charge.amountCents!==line.amountCents)reasons.push('原收费与当前 PI 金额、币种或项目不一致');else if(charge.status==='confirmed'||charge.sourceDocumentId||all(s,'ar_document_issue').some(issue=>Array.isArray(issue.chargeIds)&&issue.chargeIds.includes(charge.id)))reasons.push('已有正式或已签发收费保留原账，不重复归集或改写原分期');else if(all(s,'project_adjustment').some(a=>a.chargeId===charge.id)||all(s,'project_allocation').some(a=>a.chargeId===charge.id)||all(s,'project_credit_application').some(a=>a.sourceChargeId===charge.id||a.targetChargeId===charge.id))reasons.push('已有核销或调整的收费保留原账，请核对原应收，不再次签发生成');}
 if(term&&!Array.isArray(term[category as 'sample'|'mold'|'bulk']))reasons.push('收费类别付款阶段缺失');return [...new Set(reasons)];
}
export function arDocumentCandidates(s:State,m:Member,teamFilter=''){
 const scope=arAccess(s,m);if(!scope.allowed)return [];
 return s.records.filter(d=>d.kind==='project_billing_document'&&d.documentType==='PI'||d.kind==='handoff_business_document'&&d.type==='pi').flatMap(d=>{
  const p=projectFor(s,d),customer=all(s,'customer_account').find(c=>c.id===d.customerId),issue=all(s,'ar_document_issue').find(i=>i.sourceKind===d.kind&&i.sourceId===d.id),review=all(s,'ar_document_review').filter(i=>i.sourceKind===d.kind&&i.sourceId===d.id).at(-1);
  const teamId=clean(issue?.teamId||review?.teamId||d.attributionTeamId||d.teamId||p?.teamId||arAttribution(s,d).teamId),termId=clean(review?.paymentTermId||customer?.directory?.defaultPaymentTermId),term=activePaymentTerm(s,termId),category=(review?.category||'bulk') as 'sample'|'mold'|'bulk';
  if(!scope.company&&(!teamId||!scope.teamIds.includes(teamId))||teamFilter&&(teamFilter===arUngrouped?!!teamId:teamId!==teamFilter))return [];
  const reasons=sourceReasons(s,d,teamId,term,category),current=!!review&&!!term&&review.sourceVersion===d.version&&review.fingerprint===digest(d,teamId,term,category),reviewer=review&&all(s,'member').find(x=>x.id===review.reviewerId) as Member|undefined;
  const validReview=current&&!!reviewer&&arCanReviewDocument(s,reviewer,d);if(review&&!validReview)reasons.push('单据、条件或审核责任已变化，须重新审核');
  const milestone=all(s,'ar_document_milestone').find(x=>x.sourceKind===d.kind&&x.sourceId===d.id),issuedReasons=issue&&issue.sourceVersion!==d.version?['已签发原 PI 版本发生变化，原应收保持签发快照，请核对差异']:[];
  const amount=Array.isArray(d.lines)&&d.lines.length&&d.lines.every((l:any)=>Number.isSafeInteger(l.amountCents)&&l.amountCents>0)?d.lines.reduce((n:number,l:any)=>n+l.amountCents,0):null;
  return [{id:d.id,sourceKind:d.kind,documentNo:clean(d.documentNo||d.number),customerId:clean(d.customerId),customer:clean(customer?.customer)||'待匹配客户',projectId:p?.id||'',teamId,teamName:clean(all(s,'customer_project_team').find(t=>t.id===teamId)?.name)||'未分组 / 待确认',currency:clean(d.currency||d.fields?.currency),amountCents:d.kind==='project_billing_document'&&Number.isSafeInteger(amount)?amount:null,status:issue?'issued':d.kind!=='project_billing_document'?'unsupported':validReview?'reviewed':'pending',version:d.version||1,paymentTermId:issue?.paymentTermId||termId,paymentTermName:issue?.paymentTermSnapshot?.name||term?.name||'',category,canReview:d.kind==='project_billing_document'&&!issue&&arCanReviewDocument(s,m,d),canIssue:!issue&&validReview&&!reasons.length&&canWrite(s,m,d),reasons:issue?issuedReasons:reasons,reviewId:review?.id,issueId:issue?.id,milestoneVersion:milestone?.version,plannedShipDate:milestone?.plannedShipDate||'',actualShipDate:milestone?.actualShipDate||'',canSetMilestone:!!issue&&canWrite(s,m,d)}];
 });
}
function plan(term:PaymentTerm,category:Input['category'],amount:number,issuedDate:string){
 let allocated=0;return term[category].map((stage,index,stages)=>{const amountCents=index===stages.length-1?amount-allocated:Math.round(amount*stage.percent/100);allocated+=amountCents;
  let dueDate='';if(stage.trigger==='issue'){const date=new Date(issuedDate+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+stage.days);dueDate=date.toISOString().slice(0,10);}
  return {id:stage.id,title:stage.label,amountCents,dueDate,beforeOrder:stage.trigger==='issue',trigger:stage.trigger,offsetDays:stage.days};
 }).filter(p=>p.amountCents>0);
}
export async function arDocumentPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-document-review','ar-document-issue','ar-document-milestone'].includes(action))return null;
 if(arReadOnly(s,m))throw new AppError('只读取数账号不能审核或签发单据。',403);
 if(action==='ar-document-milestone')return saveMilestone(req,s,m);
 const parsed=inputSchema.safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(e=>e.path.join('.')+'：'+e.message).join('；'));
 const input=parsed.data,d=s.records.find(r=>r.kind===input.sourceKind&&r.id===input.sourceId);if(!d)throw new AppError('PI 不存在或不可访问。',403);
 if(!(action==='ar-document-review'?arCanReviewDocument(s,m,d):canWrite(s,m,d)))throw new AppError(action==='ar-document-review'?'仅本客户或项目明确指定的业务审核人可审核。':'没有此 PI 的签发权限。',403);
 const scope=arAccess(s,m);if(!scope.company&&!scope.teamIds.includes(input.teamId))throw new AppError('没有此组单据操作权限。',403);
 const requestId='ar_document_request_'+input.token,fp=JSON.stringify({action,input}),repeated=s.records.find(r=>r.id===requestId);
 if(repeated){if(repeated.kind!=='ar_document_request'||repeated.actorId!==m.id||repeated.fingerprint!==fp)throw new AppError('请求标识已用于其他操作。',409);return json({...repeated.result,idempotent:true});}
 if(d.version!==input.expectedVersion)throw new AppError('PI 版本已变化，请重新核对。',409);
 const already=all(s,'ar_document_issue').find(i=>i.sourceKind===d.kind&&i.sourceId===d.id);if(already)throw new AppError('此 PI 已签发归集，请在原应收核对；不能再新增一份。',409);
 const term=activePaymentTerm(s,input.paymentTermId),reasons=sourceReasons(s,d,input.teamId,term,input.category);if(reasons.length)throw new AppError(reasons.join('；'));
 const fingerprint=digest(d,input.teamId,term!,input.category),at=now(),updates:Entity[]=[];let item:Entity;
 if(action==='ar-document-review'){
  item={id:newId('ar_review'),kind:'ar_document_review',sourceKind:d.kind,sourceId:d.id,sourceVersion:d.version,customerId:d.customerId,projectId:projectFor(s,d)!.id,teamId:input.teamId,paymentTermId:term!.id,paymentTermSnapshot:paymentTermSnapshot(term!),category:input.category,reviewerId:m.id,reviewedAt:at,fingerprint};updates.push(item);
 }else{
  const review=all(s,'ar_document_review').find(r=>r.id===input.reviewId&&r.sourceKind===d.kind&&r.sourceId===d.id),reviewer=review&&all(s,'member').find(r=>r.id===review.reviewerId) as Member|undefined;
  if(!review||review.fingerprint!==fingerprint||!reviewer||!arCanReviewDocument(s,reviewer,d))throw new AppError('缺少当前版本有效的指定业务审核，请重新审核。',409);
  const p=projectFor(s,d)!,chargeIds:string[]=[],date=arToday(),lines=d.lines as Entity[],issuedLines:Entity[]=[];
  for(const [index,line] of lines.entries()){
   const before=line.chargeId?all(s,'project_charge').find(c=>c.id===line.chargeId):undefined,plans=plan(term!,input.category,line.amountCents,date),chargeId=before?.id||newId('project_charge');
   const record:Entity={...before,id:chargeId,kind:'project_charge',customerId:d.customerId,projectId:p.id,roundId:line.roundId||d.roundId||'',title:clean(line.title)||clean(d.documentNo),category:input.category==='mold'?'tooling':input.category,currency:d.currency,amountCents:line.amountCents,prepayCents:plans.filter(p=>p.beforeOrder).reduce((n,p)=>n+p.amountCents,0),dueDate:plans.length===1?plans[0].dueDate:'',plan:plans,status:'confirmed',version:(before?.version||0)+1,note:before?.note||'',arCanonicalKey:`pi:${d.kind}:${d.id}:line:${index}`,sourceDocumentId:d.id,sourceDocumentVersion:d.version,attributionTeamId:input.teamId,paymentTermSnapshot:paymentTermSnapshot(term!),createdAt:before?.createdAt||at,createdBy:before?.createdBy||m.name,createdById:before?.createdById||m.id,updatedAt:at,updatedBy:m.name,confirmedAt:at,confirmedBy:reviewer.name,confirmedById:reviewer.id};
   updates.push(record,audit(m,record,before||null,'审核后 PI 签发归集收费','应收工作空间'));chargeIds.push(record.id);issuedLines.push({...line,chargeId:record.id,projectId:p.id,roundId:record.roundId,plan:plans,amountCents:record.amountCents,prepayCents:record.prepayCents,receivedCents:0,balanceCents:record.amountCents});
  }
  const termsText=[`${term!.name} · V${term!.termVersion}`,...term![input.category].map(stage=>`${stage.label}：${stage.percent}% · ${paymentTermTriggerLabels[stage.trigger]} ${stage.days} 天`),term!.note].join('\n');
  const issuedDocument:Entity={...d,chargeIds,lines:issuedLines,terms:termsText,paymentTermSnapshot:paymentTermSnapshot(term!),attributionTeamId:input.teamId,status:'confirmed',version:d.version+1,issuedAt:at,issuedById:m.id,confirmedAt:at,confirmedBy:reviewer.name,confirmedById:reviewer.id,updatedAt:at,updatedBy:m.name};
  item={id:newId('ar_issue'),kind:'ar_document_issue',sourceKind:d.kind,sourceId:d.id,sourceVersion:issuedDocument.version,reviewedSourceVersion:d.version,customerId:d.customerId,projectId:p.id,teamId:input.teamId,paymentTermId:term!.id,paymentTermSnapshot:paymentTermSnapshot(term!),category:input.category,reviewId:review.id,issuedById:m.id,issuedAt:at,chargeIds,sourceSnapshot:structuredClone(d)};updates.push(issuedDocument,audit(m,issuedDocument,d,'PI 签发条款与分期快照','应收工作空间'),item);
 }
 const result={ok:true,item:{id:item.id,sourceKind:item.sourceKind,sourceId:item.sourceId,chargeIds:item.chargeIds||[],status:action==='ar-document-review'?'reviewed':'issued'}};
 await commit(s.revision,[...updates,audit(m,item,null,action,'应收工作空间'),{id:requestId,kind:'ar_document_request',actorId:m.id,fingerprint:fp,result,createdAt:at}]);return json(result);
}
const day=z.string().trim().refine(v=>!v||!!arDay(v),'日期须为有效 YYYY-MM-DD').default('');
const milestoneSchema=z.object({token:z.string().uuid(),sourceKind:z.literal('project_billing_document'),sourceId:id,sourceVersion:z.number().int().positive().optional(),version:z.number().int().positive().optional(),plannedShipDate:day,actualShipDate:day}).strict();
async function saveMilestone(req:Request,s:State,m:Member){
 const parsed=milestoneSchema.safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues.map(x=>x.message).join('；'));const v=parsed.data;
 const issue=all(s,'ar_document_issue').find(r=>r.sourceKind===v.sourceKind&&r.sourceId===v.sourceId),source=s.records.find(r=>r.id===v.sourceId&&r.kind===v.sourceKind),scope=arAccess(s,m);
 if(!issue||!source||!canWrite(s,m,source)||!scope.company&&!scope.teamIds.includes(issue.teamId))throw new AppError('没有该已签发 PI 的出货日期维护权限。',403);
 if(v.sourceVersion!==undefined&&v.sourceVersion!==source.version)throw new AppError('PI 来源版本已变化，请重新核对出货日期依据。',409);
 if(v.actualShipDate&&v.actualShipDate>arToday())throw new AppError('实际出货日期不能晚于今天。');
 const requestId='ar_document_request_'+v.token,fingerprint=JSON.stringify({action:'ar-document-milestone',input:v}),repeated=s.records.find(r=>r.id===requestId);
 if(repeated){if(repeated.kind!=='ar_document_request'||repeated.actorId!==m.id||repeated.fingerprint!==fingerprint)throw new AppError('操作标识已被用于其他请求。',409);return json({...repeated.result,idempotent:true});}
 const before=all(s,'ar_document_milestone').find(r=>r.sourceKind===v.sourceKind&&r.sourceId===v.sourceId);if(before?before.version!==v.version:v.version!==undefined)throw new AppError('出货日期已更新，请刷新后重试。',409);
 const item={id:before?.id||newId('ar_milestone'),kind:'ar_document_milestone',sourceKind:v.sourceKind,sourceId:v.sourceId,customerId:issue.customerId,teamId:issue.teamId,plannedShipDate:v.plannedShipDate,actualShipDate:v.actualShipDate,version:(before?.version||0)+1,createdAt:before?.createdAt||now(),updatedAt:now(),updatedById:m.id};
 const result={ok:true,item};await commit(s.revision,[item,audit(m,item,before||null,'更新 PI 出货日期并触发账期','应收工作空间'),{id:requestId,kind:'ar_document_request',actorId:m.id,fingerprint,result,createdAt:now()}]);return json(result);
}
