import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {sha} from './workbooks';
import {eligiblePaymentTermAuthorizer,paymentTermAuthority,paymentTermAuthorityId,paymentTermById,paymentTermContentSchema,paymentTermKind,paymentTermsCapabilities,type PaymentTerm,type PaymentTermAuthority,type PaymentTermsFeed} from './payment-terms';

const id=z.string().trim().min(1).max(160),token=z.string().uuid(),version=z.number().int().nonnegative(),reason=z.string().trim().min(1,'请填写依据或原因').max(3000);
const schemas={
 save:paymentTermContentSchema.extend({token,id:id.optional(),version,sourceId:id.optional(),sourceVersion:version.optional()}).strict(),
 authorize:z.object({token,id,version,reason}).strict(),
 disable:z.object({token,id,version,reason}).strict(),
 'authorizers-save':z.object({token,version,authorizerMemberIds:z.array(id).max(100).refine(ids=>new Set(ids).size===ids.length,'指定负责人不能重复'),reason}).strict(),
};
type Action=keyof typeof schemas;
const requestKind='payment_term_request';
function requireRead(m:Member){if(!m.active||m.role==='supplier')throw new AppError('没有公司付款条件读取权限。',403);}
function requireWrite(s:State,m:Member,name:Action,before?:PaymentTerm){
 requireRead(m);const can=paymentTermsCapabilities(s,m);
 if(can.readOnly)throw new AppError('当前账号仅有取数与总览权限，不能修改付款条件或授权。',403);
 if(name==='authorizers-save'){if(!can.configure)throw new AppError('仅管理员可指定付款条件授权负责人。',403);}
 else if(name==='save'){if(!can.create||before&&before.createdById!==m.id&&!can.authorize)throw new AppError('仅草稿创建人或指定授权负责人可维护草稿。',403);}
 else if(!can.authorize)throw new AppError('仅管理员明确指定的业务负责人可授权或停用付款条件。',403);
}
export function paymentTermsGet(action:string,_req:Request,s:State,m:Member):Response|null{
 if(!['payment-terms-data','payment-terms-history'].includes(action))return null;requireRead(m);
 const capabilities=paymentTermsCapabilities(s,m),authority=paymentTermAuthority(s);
 const visible=(term:any)=>term?.kind===paymentTermKind&&(term.status!=='draft'||term.createdById===m.id||capabilities.authorize||capabilities.configure);
 if(action==='payment-terms-history'){const id=new URL(_req.url).searchParams.get('id')||'',term=paymentTermById(s,id);if(!term||!visible(term))throw new AppError('付款条件不在当前可见范围。',403);return json({item:term,history:all(s,'audit').filter(row=>row.targetId===id&&visible(row.after)).map(row=>({id:row.id,action:row.action,actor:row.actor,createdAt:row.createdAt,before:visible(row.before)?row.before:null,after:row.after}))});}
 const result:PaymentTermsFeed={terms:(all(s,paymentTermKind) as PaymentTerm[]).filter(t=>t.status!=='draft'||t.createdById===m.id||capabilities.authorize||capabilities.configure).sort((a,b)=>a.name.localeCompare(b.name)||b.termVersion-a.termVersion),capabilities,authorizerMemberIds:authority?.authorizerMemberIds||[],authorityVersion:authority?.version||0,members:capabilities.configure?(all(s,'member') as Member[]).filter(v=>eligiblePaymentTermAuthorizer(s,v)).map(v=>({id:v.id,name:v.name,role:v.role})):[]};
 return json({...result,writeContract:'payment-terms-version-token-v1'});
}
export async function paymentTermsPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!action.startsWith('payment-terms-'))return null;const name=action.slice('payment-terms-'.length) as Action;if(!Object.prototype.hasOwnProperty.call(schemas,name))return null;
 const parsed=schemas[name].safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(i=>`${i.path.join('.')}: ${i.message}`).join('；'));
 const input=parsed.data as any,before=input.id?paymentTermById(s,input.id):undefined;
 if(input.id&&!before)throw new AppError('付款条件不存在。',404);requireWrite(s,m,name,before);
 const fingerprint=await sha(JSON.stringify({action,input})),requestId=requestKind+'_'+input.token,previous=s.records.find(r=>r.id===requestId);
 if(previous){if(previous.kind!==requestKind||previous.actorId!==m.id||previous.action!==action||previous.fingerprint!==fingerprint)throw new AppError('请求编号已用于不同内容。',409);return json({ok:true,idempotent:true,item:s.records.find(r=>r.id===previous.targetId)});}
 const at=now();let item:PaymentTerm|PaymentTermAuthority;
 if(name==='authorizers-save'){
  const old=paymentTermAuthority(s);if((old?.version||0)!==input.version)throw new AppError('授权名单已变化，请刷新后核对。',409);
  for(const memberId of input.authorizerMemberIds){const owner=all(s,'member').find(r=>r.id===memberId) as Member|undefined;if(!owner||!eligiblePaymentTermAuthorizer(s,owner))throw new AppError('请选择在职业务或管理员账号；取数只读账号不能被指定。',403);}
  item={id:paymentTermAuthorityId,kind:'payment_term_authority',version:(old?.version||0)+1,authorizerMemberIds:input.authorizerMemberIds,reason:input.reason,updatedAt:at,updatedById:m.id};
 }else{
  if((before?.version||0)!==input.version)throw new AppError('付款条件已变化，请刷新后核对；未覆盖其他人的更改。',409);
  if(name==='save'){
   if(before&&before.status!=='draft')throw new AppError('已授权版本不能改写，请新建版本后重新授权。',409);
   if(before&&input.sourceId)throw new AppError('现有草稿不能改绑版本来源。',409);
   const source=input.sourceId?paymentTermById(s,input.sourceId):undefined;
   if(input.sourceId&&(!source||source.status==='draft'||source.version!==input.sourceVersion))throw new AppError('版本来源已变化，请重新选择已授权或停用版本。',409);
   if(source&&all(s,paymentTermKind).some(t=>t.familyId===source.familyId&&t.status==='draft'))throw new AppError('该条件已有待授权草稿，请先处理现有草稿。',409);
   const content=paymentTermContentSchema.parse({name:input.name,bulk:input.bulk,sample:input.sample,mold:input.mold,note:input.note}),recordId=before?.id||newId(paymentTermKind);
   item={...before,...content,id:recordId,kind:'payment_term',familyId:before?.familyId||source?.familyId||recordId,termVersion:before?.termVersion||(source?Math.max(...all(s,paymentTermKind).filter(t=>t.familyId===source.familyId).map(t=>t.termVersion))+1:1),version:(before?.version||0)+1,status:'draft',createdAt:before?.createdAt||at,createdById:before?.createdById||m.id,updatedAt:at,updatedById:m.id};
  }else{
   if(!before)throw new AppError('付款条件不存在。',404);
   if(name==='authorize'&&before.status!=='draft'||name==='disable'&&before.status!=='active')throw new AppError('当前状态不能执行此操作，请刷新后核对。',409);
   if(name==='authorize')paymentTermContentSchema.parse({name:before.name,bulk:before.bulk,sample:before.sample,mold:before.mold,note:before.note});
   item={...before,version:before.version+1,updatedAt:at,updatedById:m.id,...(name==='authorize'?{status:'active' as const,authorizedAt:at,authorizedById:m.id,authorizationReason:input.reason}:{status:'disabled' as const,disabledAt:at,disabledById:m.id,disableReason:input.reason})};
  }
 }
 const old=name==='authorizers-save'?paymentTermAuthority(s):before;
 const request:Entity={id:requestId,kind:requestKind,actorId:m.id,action,fingerprint,targetId:item.id,createdAt:at};
 await commit(s.revision,[item,audit(m,item,old||null,{'save':'保存付款条件草稿','authorize':'授权付款条件','disable':'停用付款条件','authorizers-save':'指定付款条件授权负责人'}[name]),request]);
 return json({ok:true,item});
}
