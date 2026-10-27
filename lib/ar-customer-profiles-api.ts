import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {arAccess,arDay} from './ar-workspace';
import {arInvoiceRequire} from './ar-invoice-ledger';
import {arCustomerProfile,arInvoiceExtra,arInvoiceTraceLinks,arProfileBoundary,arProfileCoreColumns,arProfileCustomerReadable,arProfileOptionalColumns,arProfileTarget,arProfileTargetKinds,type ArProfileField} from './ar-customer-profiles';

const id=z.string().trim().min(1).max(160),text=(n=3000)=>z.string().trim().max(n).default(''),token=z.string().uuid(),version=z.number().int().nonnegative();
const fieldSchema=z.object({key:z.string().regex(/^custom_[a-z][a-z0-9_]{0,39}$/),labelZh:z.string().trim().min(1).max(80),labelEn:z.string().trim().min(1).max(100),type:z.enum(['text','number','date']),required:z.boolean().default(false)}).strict();
const profileSchema=z.object({customerId:id,version,token,documentTitle:z.string().trim().min(1).max(160),language:z.enum(['zh','en','bilingual']),statementColumns:z.array(id).min(arProfileCoreColumns.length).max(40),customFields:z.array(fieldSchema).max(20),note:text(10000)}).strict();
const linkSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('link'),invoiceId:id,version:version.refine(v=>v>0),token,targetKind:z.enum(arProfileTargetKinds),targetId:id,targetVersion:z.number().int().positive().optional(),note:z.string().trim().min(2).max(3000)}).strict(),
 z.object({action:z.literal('cancel'),invoiceId:id,version:version.refine(v=>v>0),token,linkId:id,note:z.string().trim().min(2).max(3000)}).strict(),
]);
const extraSchema=z.object({invoiceId:id,invoiceVersion:z.number().int().positive(),version,profileVersion:z.number().int().positive(),token,values:z.record(z.union([z.string().max(3000),z.number().finite().min(-1e12).max(1e12),z.null()]))}).strict();
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.infer<T>{const r=schema.safeParse(value);if(!r.success)throw new AppError(r.error.issues.slice(0,5).map(e=>e.path.join('.')+'：'+e.message).join('；'));return r.data;}
function writer(s:State,m:Member){if(!arAccess(s,m).canConfigure)throw new AppError('仅现有有权管理员可维护客户模板、发票扩展资料及来源关联；只读授权不可写入。',403);}
function customer(s:State,m:Member,customerId:string){const c=all(s,'customer_account').find(c=>c.id===customerId);if(!c||!arProfileCustomerReadable(s,m,customerId))throw new AppError('客户不存在或没有该客户的应收访问权限。',403);return c;}
function current(row:Entity|null,expected:number){if((row?.version||0)!==expected)throw new AppError('资料版本已变化，请刷新后重试。',409);}
function validateProfile(input:z.infer<typeof profileSchema>){
 const keys=input.customFields.map(f=>f.key),labels=input.customFields.flatMap(f=>[f.labelZh.toLowerCase(),f.labelEn.toLowerCase()]),core=arProfileCoreColumns.map(c=>c.key),allowed=[...core,...arProfileOptionalColumns.map(c=>c.key),...keys];
 if(new Set(keys).size!==keys.length)throw new AppError('扩展字段编号不能重复。');
 if(new Set(input.statementColumns).size!==input.statementColumns.length||core.some(k=>!input.statementColumns.includes(k))||input.statementColumns.some(k=>!allowed.includes(k)))throw new AppError('核心编号、币种、历史净应收、实收、未收列须全部保留；不能重复列或引用未定义字段。');
 const reserved=new Set([...arProfileCoreColumns.flatMap(c=>[c.key.toLowerCase(),c.labelZh,c.labelEn.toLowerCase()]),'amount','amountcents','currency','received','receivedcents','balance','balancecents','payment','金额','币种','应收','实收','未收','收款','付款','现金']);
 if(labels.some(l=>reserved.has(l))||keys.some(k=>reserved.has(k.slice(7).replaceAll('_',''))))throw new AppError('扩展字段不能使用或重定义核心账务字段名称。');
}
function validateValues(fields:ArProfileField[],values:Record<string,string|number|null>){
 const defined=new Map(fields.map(f=>[f.key,f]));for(const key of Object.keys(values))if(!defined.has(key))throw new AppError('只能保存当前客户模板中已定义的扩展字段：'+key);
 for(const field of fields){const value=values[field.key];if(value===undefined||value===null||value===''){if(field.required)throw new AppError('请填写必填扩展字段：'+field.labelZh);continue;}
  if(field.type==='text'&&typeof value!=='string'||field.type==='number'&&typeof value!=='number'||field.type==='date'&&(typeof value!=='string'||!arDay(value)))throw new AppError('扩展字段类型或日期不符：'+field.labelZh);
 }
}
async function fingerprint(input:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))).map(n=>n.toString(16).padStart(2,'0')).join('');}
function repeated(s:State,m:Member,action:string,value:string,fp:string){const r=s.records.find(r=>r.id==='ar_customer_profile_request_'+value);if(!r)return null;if(r.kind!=='ar_customer_profile_request'||r.actorId!==m.id||r.action!==action||r.fingerprint!==fp)throw new AppError('请求标识已用于不同内容。',409);const item=r.result?.item;if(item?.kind==='ar_invoice_source_link'&&!arProfileTarget(s,m,item.customerId,item.targetKind,item.targetId))throw new AppError('原关联来源目前不可读取，请刷新查看关联历史。',403);return json({...r.result,idempotent:true});}
async function save(s:State,m:Member,action:string,value:string,fp:string,item:Entity,result:Record<string,unknown>,before:Entity|null=null){
 const response={ok:true,...result},history:Entity={id:newId('ar_customer_profile_history'),kind:'ar_customer_profile_history',customerId:item.customerId,targetId:item.id,action,actorId:m.id,createdAt:now(),before:before?structuredClone(before):null,after:structuredClone(item)};
 await commit(s.revision,[item,history,audit(m,item,before,action,'客户应收模板与来源追踪'),{id:'ar_customer_profile_request_'+value,kind:'ar_customer_profile_request',customerId:item.customerId,actorId:m.id,action,fingerprint:fp,result:response,createdAt:now()}]);return json(response);
}
export async function arCustomerProfilesGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='ar-customer-profiles-data')return null;
 const scope=arAccess(s,m);if(!scope.allowed)throw new AppError('没有应收客户模板与来源追踪访问权限。',403);
 const p=new URL(req.url).searchParams,invoiceId=parse(text(160),p.get('invoiceId')||'');let customerId=parse(text(160),p.get('customerId')||'');
 const invoice=invoiceId?arInvoiceRequire(s,m,'ar_invoice',invoiceId):null;if(invoice){if(customerId&&customerId!==invoice.customerId)throw new AppError('发票与所选客户不一致。',403);customerId=invoice.customerId;}
 if(customerId)customer(s,m,customerId);
 const customers=all(s,'customer_account').filter(c=>arProfileCustomerReadable(s,m,c.id)).map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,active:c.active}));
 const candidates=customerId?s.records.filter(r=>arProfileTargetKinds.includes(r.kind as never)&&r.id!==invoiceId).flatMap(r=>{const target=arProfileTarget(s,m,customerId,r.kind,r.id);return target?[target]:[];}):[];
 return json({customers,profile:customerId?arCustomerProfile(s,customerId):null,profiles:all(s,'ar_customer_profile').filter(r=>(!customerId||r.customerId===customerId)&&arProfileCustomerReadable(s,m,r.customerId)),coreColumns:arProfileCoreColumns,optionalColumns:arProfileOptionalColumns,candidates,traceLinks:invoice?arInvoiceTraceLinks(s,m,invoice.id):[],extraValues:invoice?arInvoiceExtra(s,invoice.id):null,invoice:invoice?{id:invoice.id,invoiceNo:invoice.invoiceNo,customerId:invoice.customerId,version:invoice.version}:null,canWrite:scope.canConfigure,boundary:arProfileBoundary});
}
export async function arCustomerProfilesPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-customer-profile-save','ar-invoice-source-link','ar-invoice-extra-save'].includes(action))return null;writer(s,m);const raw=await req.json();
 if(action==='ar-customer-profile-save'){
  const input=parse(profileSchema,raw),c=customer(s,m,input.customerId);if(!c.active)throw new AppError('停用客户不能新增或修改模板。');validateProfile(input);const fp=await fingerprint(input),repeat=repeated(s,m,action,input.token,fp);if(repeat)return repeat;
  const before=all(s,'ar_customer_profile').find(p=>p.customerId===input.customerId)||null;current(before,input.version);const at=now(),{token:_,...fields}=input,item:Entity={...fields,id:before?.id||newId('ar_customer_profile'),kind:'ar_customer_profile',version:input.version+1,createdAt:before?.createdAt||at,createdById:before?.createdById||m.id,updatedAt:at,updatedById:m.id};
  return save(s,m,action,input.token,fp,item,{profile:item,boundary:arProfileBoundary},before);
 }
 if(action==='ar-invoice-source-link'){
  const body=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  const input=parse(linkSchema,{...body,action:body.action||'link'}),invoice=arInvoiceRequire(s,m,'ar_invoice',input.invoiceId);customer(s,m,invoice.customerId);const fp=await fingerprint(input),repeat=repeated(s,m,action,input.token,fp);if(repeat)return repeat;current(invoice,input.version);
  if(input.action==='cancel'){
   const link=all(s,'ar_invoice_source_link').find(l=>l.id===input.linkId&&l.invoiceId===invoice.id&&l.customerId===invoice.customerId);if(!link)throw new AppError('原关联不存在或不属于本发票。',403);if(all(s,'ar_invoice_source_link_cancel').some(c=>c.linkId===link.id))throw new AppError('关联已取消，请保留原历史。',409);
   const event:Entity={id:newId('ar_invoice_source_link_cancel'),kind:'ar_invoice_source_link_cancel',customerId:invoice.customerId,teamId:invoice.teamId||'',invoiceId:invoice.id,invoiceVersion:invoice.version,linkId:link.id,note:input.note,version:1,createdAt:now(),createdById:m.id};return save(s,m,action,input.token,fp,event,{item:event});
  }
  if(input.targetKind==='ar_invoice'&&input.targetId===invoice.id)throw new AppError('发票不能关联自身。');const target=arProfileTarget(s,m,invoice.customerId,input.targetKind,input.targetId);if(!target)throw new AppError('原来源不存在、不属于同一客户或没有原来源读取权限。',403);if(input.targetVersion!==undefined&&input.targetVersion!==target.version)throw new AppError('原来源已更新，请重新选择当前版本。',409);
  const prior=arInvoiceTraceLinks(s,m,invoice.id).find(l=>l.status==='active'&&l.targetKind===target.kind&&l.targetId===target.id);if(prior)throw new AppError('本发票已有关联的同一来源，请查看原关联。',409);
  const item:Entity={id:newId('ar_invoice_source_link'),kind:'ar_invoice_source_link',customerId:invoice.customerId,teamId:invoice.teamId||'',invoiceId:invoice.id,invoiceVersion:invoice.version,targetKind:target.kind,targetId:target.id,targetVersion:target.version,targetSnapshot:structuredClone(target),note:input.note,version:1,createdAt:now(),createdById:m.id};return save(s,m,action,input.token,fp,item,{item:{...item,status:'active',cancelEvents:[]}});
 }
 const input=parse(extraSchema,raw),invoice=arInvoiceRequire(s,m,'ar_invoice',input.invoiceId);customer(s,m,invoice.customerId);const fp=await fingerprint(input),repeat=repeated(s,m,action,input.token,fp);if(repeat)return repeat;current(invoice,input.invoiceVersion);
 const profile=arCustomerProfile(s,invoice.customerId);if(!profile.id||profile.version!==input.profileVersion)throw new AppError('客户模板已更新或尚未保存，请读取当前模板后重新核对扩展字段。',409);validateValues(profile.customFields,input.values);const before=arInvoiceExtra(s,invoice.id);current(before,input.version);
 const item:Entity={id:newId('ar_invoice_extra_values'),kind:'ar_invoice_extra_values',customerId:invoice.customerId,teamId:invoice.teamId||'',invoiceId:invoice.id,invoiceVersion:invoice.version,version:input.version+1,previousId:before?.id||'',profileId:profile.id,profileVersion:profile.version,values:input.values,schemaSnapshot:structuredClone(profile.customFields),createdAt:now(),createdById:m.id};return save(s,m,action,input.token,fp,item,{extraValues:item},before);
}
