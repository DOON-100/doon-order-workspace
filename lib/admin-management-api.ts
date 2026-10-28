import {z} from 'zod';
import {all,email,newId,now,personnelTypeOf,roles,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {canonicalPriceJson} from './customer-price-archive';
import {assertFrameworkMemberDisableAllowed} from './framework-offboarding';
import {handoffCatalog} from './handoff-framework-catalog';
export const adminManagementProtocol='doon-admin-management-write-v1';
const fields:Record<string,string>={
 member:'id name email role personnelType supplierId orderScope customers departments active owner createdAt',
 team:'id name leaderIds salesMemberIds serviceMemberIds customerIds active version',
 'project-roster':'id serviceFollowerIds salesReviewerIds version',
 'ar-grant':'id memberId scopeType teamIds capabilities readOnly active reason version',
 'project-finance-grant':'id memberId customerIds active version',
 'payment-authorizers':'id authorizerMemberIds reason version',
 'ie-policy':'id engineerMemberId reviewerMemberId finalApproverMemberId version',
 'quote-policy':'id memberIds aliasesByMember administratorMemberIds internalMemberIds writableMemberIds customerMemberIds',
 'drawing-policy':'id drawingLeadMemberId engineeringSupervisorMemberId version',
 'framework-config':'id type key ownerId modelMode modelName extraRules templateLocation integrationNotes executionEnabled version',
 'service-location':'id drawingRoot quoteRoot leadDays version',
};
const kinds:Record<string,string>={member:'member',team:'customer_project_team','project-roster':'customer_project_assignment_roster','ar-grant':'ar_access_grant','project-finance-grant':'project_finance_grant','payment-authorizers':'payment_term_authority','ie-policy':'ie_quote_policy','quote-policy':'customer_quote_access','drawing-policy':'handoff_business_policy','framework-config':'framework_configuration','service-location':'handoff_business_settings'};
export async function adminManagementHash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalPriceJson(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');}
const dto=(type:string,row:Entity)=>Object.fromEntries((fields[type]+' updatedAt updatedBy updatedById').split(' ').filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
function permitted(m:Member,type:string){if(!m.active||!(type==='framework-config'?['admin','programmer'].includes(m.role):m.role==='admin'))throw new AppError('没有此管理资料的维护权限。',403);}
function sourceRows(s:State,type:string){let rows=all(s,kinds[type]);if(type==='drawing-policy')rows=rows.filter(r=>r.id==='handoff_business_production_review_policy');if(type==='service-location')rows=rows.filter(r=>r.id==='handoff_business_service_config');return rows;}
export async function adminManagementGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='admin-management-data')return null;const url=new URL(req.url),type=url.searchParams.get('type')||'';if(!Object.hasOwn(kinds,type))throw new AppError('管理资料类型未接入。');permitted(m,type);
 const id=url.searchParams.get('id')||'',rows=sourceRows(s,type).filter(row=>!id||row.id===id),items=await Promise.all(rows.map(async row=>({...dto(type,row),...(type==='member'?{boundIdentity:!!row.userId}:{}),...(type==='member'||type==='quote-policy'?{sourceSha256:await adminManagementHash(row)}:{})})));
 const selected=new Set(rows.map(row=>row.id));const history=all(s,'audit').filter(h=>selected.has(h.targetId)&&[h.before,h.after].filter(Boolean).every(r=>r.kind===kinds[type])).map(h=>({id:h.id,targetId:h.targetId,action:h.action,actor:h.actor,createdAt:h.createdAt,before:h.before?dto(type,h.before):null,after:h.after?dto(type,h.after):null}));if(type==='project-finance-grant')history.push(...all(s,'project_finance_grant_history').filter(h=>selected.has(h.after?.id)).map(h=>({id:h.id,targetId:h.after.id,action:'project-finance-grant-save',actor:h.createdBy||h.updatedBy||'',createdAt:h.createdAt||h.updatedAt,before:h.before?dto(type,h.before):null,after:dto(type,h.after)})));
 return json({protocol:adminManagementProtocol,type,items,history,semantics:'仅业务资料及权限配置；资料位置不读取、不执行；不创建或重置认证账号。',candidates:{members:all(s,'member').filter(r=>r.active).map(r=>({id:r.id,name:r.name,role:r.role,personnelType:personnelTypeOf(r),boundIdentity:!!r.userId})),...(m.role==='admin'?{customers:all(s,'customer_account').map(r=>({id:r.id,customer:r.customer,customerCode:r.customerCode,active:r.active})),teams:all(s,'customer_project_team').map(r=>({id:r.id,name:r.name,active:r.active})),suppliers:all(s,'supplier').map(r=>({id:r.id,name:r.name,active:r.active}))}:{}),...(type==='framework-config'?{configurationKeys:{agent:Object.keys(handoffCatalog.agents),method:Object.keys(handoffCatalog.methods),flow:Object.keys(handoffCatalog.flows),template:['quotation','pi','invoice','packing','waybill','paymentrequest','production','receipt-check','reconciliation']}}:{})}});
}
const memberSchema=z.object({token:z.string().uuid(),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),id:z.string().min(1).max(160).optional(),name:z.string().trim().min(1).max(100),email:z.string().email(),role:z.enum(roles),personnelType:z.enum(['internal','external']).optional(),supplierId:z.string().optional(),orderScope:z.enum(['all','assigned']).optional(),customers:z.array(z.string().trim().min(1).max(100)).max(1000),departments:z.array(z.enum(['pmc','titanium','outsourcing','plating','semifinished','plastic','finished','engineering','engineering_review'])).default([]),active:z.boolean()}).strict();
export async function adminManagementPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='admin-member-save')return null;permitted(m,'member');const parsed=memberSchema.safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues[0].message);const input=parsed.data,requestId='admin_management_request_'+input.token,fingerprint=await adminManagementHash({action,input}),prior=s.records.find(r=>r.id===requestId);
 if(prior){if(prior.kind!=='admin_management_request'||prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('请求编号已用于其他资料。',409);return json({ok:true,id:prior.targetId,idempotent:true});}
 const existing=input.id?all(s,'member').find(r=>r.id===input.id):undefined;if(input.id&&!existing)throw new AppError('原成员不存在。',404);if((existing?await adminManagementHash(existing):null)!==input.expectedSha256)throw new AppError('成员资料已变化，本次未覆盖。',409);
 const {token:_,expectedSha256:__,...fields}=input;
 if(existing?.active&&!fields.active)await assertFrameworkMemberDisableAllowed(s,existing as Member);
 if(existing&&(existing.role==='supplier')!==(fields.role==='supplier'))throw new AppError('供应商和员工账号不能互换角色。',403);
 fields.personnelType??=personnelTypeOf(existing||fields);
 if(fields.role==='supplier'){
  if(!existing)throw new AppError('供应商认证身份须由原账号管理入口建立。',403);if(fields.personnelType!=='external')throw new AppError('供应商账号必须为外部人员。');fields.supplierId=fields.supplierId||existing.supplierId;
  if(fields.supplierId!==existing.supplierId)throw new AppError('供应商账号不能更换所属供应商。',403);
  if(fields.active&&!all(s,'supplier').some(r=>r.id===fields.supplierId&&r.active!==false))throw new AppError('所属供应商不存在或停用。');fields.orderScope='assigned';fields.customers=[];fields.departments=[];
 }else if(fields.supplierId)throw new AppError('员工账号不能绑定供应商。');
 if(existing?.owner&&(!fields.active||fields.role!=='admin'||email(fields.email)!==existing.email))throw new AppError('初始管理员角色、邮箱和启用状态不可修改。');
 if(existing&&email(fields.email)!==existing.email)throw new AppError('已有成员不能修改邮箱。');if(all(s,'member').some(r=>r.email===email(fields.email)&&r.id!==existing?.id))throw new AppError('此邮箱已存在。');
 const id=existing?.id||newId('member');if(!existing&&s.records.some(r=>r.id===id))throw new AppError('新成员编号冲突。',409);const item={...existing,...fields,id,kind:'member',email:email(fields.email),userId:existing?.userId||'',createdAt:existing?.createdAt||now()},request={id:requestId,kind:'admin_management_request',actorId:m.id,fingerprint,targetId:item.id,createdAt:now()};await commit(s.revision,[item,audit(m,item,existing||null,'维护成员业务资料及权限'),request]);return json({ok:true,id:item.id});
}
