import {z} from 'zod';
import {all,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {arAccess,arCurrencies,arDay,arWorkspaceData,type ArQuery} from './ar-workspace';
import {arDocumentCandidates,arDocumentPost} from './ar-document-issue';

const id=z.string().trim().min(1).max(160),text=z.string().trim().max(500).default('');
const base={token:z.string().uuid(),id:id.optional(),version:z.number().int().positive().optional()};
const grantSchema=z.object({...base,memberId:id,scopeType:z.enum(['company','team']),teamIds:z.array(id).max(100).default([]),capabilities:z.array(z.enum(['read','export'])).min(1).max(2),readOnly:z.boolean().default(true),active:z.boolean(),reason:z.string().trim().min(2).max(1000)}).strict();
const sourceKinds=['project_charge','project_receipt','project_refund','project_allocation','service_record','service_receipt','handoff_business_source'] as const;
const bindingSchema=z.object({...base,sourceKind:z.enum(sourceKinds),sourceId:id,customerId:id,teamId:z.string().trim().max(160).default(''),canonicalKey:text,reason:z.string().trim().min(2).max(1000),shipmentVerified:z.boolean().default(false),shipmentAmountCents:z.number().int().nonnegative().max(100_000_000_000).optional(),currency:z.enum(arCurrencies).optional()}).strict();
function parse<T extends z.ZodTypeAny>(schema:T,raw:unknown):z.infer<T>{const result=schema.safeParse(raw);if(!result.success)throw new AppError(result.error.issues.slice(0,4).map(x=>`${x.path.join('.')}：${x.message}`).join('；'));return result.data;}
function current(before:Entity|undefined,version:number|undefined){if(before?(version!==before.version):version!==undefined)throw new AppError('配置已更新或缺少当前版本，请刷新后重试。',409);}
function admin(s:State,m:Member){if(!arAccess(s,m).canConfigure)throw new AppError('仅有权管理员可配置应收读取范围与已核实来源归属；只读取数账号不能修改。',403);}
export async function arWorkspaceGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-workspace-data','ar-dashboard-data','ar-access-data','ar-export'].includes(action))return null;
 if(action==='ar-access-data'){
  admin(s,m);return json({grants:all(s,'ar_access_grant'),bindings:all(s,'ar_source_binding'),members:all(s,'member').filter(x=>x.active&&x.role!=='supplier').map(x=>({id:x.id,name:x.name,role:x.role})),teams:all(s,'customer_project_team').map(t=>({id:t.id,name:t.name,active:t.active}))});
 }
 const p=new URL(req.url).searchParams,periodType=p.get('periodType')||'month';if(!['month','quarter','year'].includes(periodType))throw new AppError('期间类型须为 month、quarter 或 year。');
 const query:ArQuery={teamId:p.has('teamId')?p.get('teamId')!:req.headers.get('X-Workspace-Team')||'',customerId:p.get('customerId')||'',currency:p.get('currency')||'',periodType:periodType as ArQuery['periodType'],period:p.get('period')||''};
 for(const value of Object.values(query))if(typeof value==='string'&&value.length>160)throw new AppError('筛选条件过长。');
 let data:ReturnType<typeof arWorkspaceData>;try{data=arWorkspaceData(s,m,query);}catch(e){throw new AppError((e as Error).message,(e as {status?:number}).status||400);}
 const documents=arDocumentCandidates(s,m,query.teamId||'').filter(d=>!query.customerId||d.customerId===query.customerId);
 if(action==='ar-export'){
  if(!data.scope.canExport)throw new AppError('没有导出权限。',403);
  const quote=(v:unknown)=>'"'+String(v??'').replace(/^([=+@\-])/,'\t$1').replace(/"/g,'""')+'"';
  const rows=[['来源类型','来源ID','客户','所属组','费用','币种','净应收','已核销','未结','到期日','状态'],...data.receivables.map(r=>[r.sourceKind,r.sourceId,r.customer,r.teamName,r.title,r.currency,r.amountCents===null?'待核实':(r.amountCents/100).toFixed(2),r.receivedCents===null?'待核实':(r.receivedCents/100).toFixed(2),r.balanceCents===null?'待核实':(r.balanceCents/100).toFixed(2),r.dueDate,r.status])];
  return new Response('\uFEFF'+rows.map(r=>r.map(quote).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ar-workspace.csv"','Cache-Control':'no-store'}});
 }
 return json({...data,documents});
}
export async function arWorkspacePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const document=await arDocumentPost(action,req,s,m);if(document)return document;
 if(!['ar-access-grant-save','ar-source-binding-save'].includes(action))return null;
 admin(s,m);const raw=await req.json(),input=action==='ar-access-grant-save'?parse(grantSchema,raw):parse(bindingSchema,raw);
 const fingerprint=JSON.stringify({action,input}),requestId='ar_request_'+input.token,repeated=all(s,'ar_request').find(r=>r.id===requestId);
 if(repeated){if(repeated.actorId!==m.id||repeated.fingerprint!==fingerprint)throw new AppError('操作标识已用于其他请求。',409);return json({ok:true,item:repeated.result,idempotent:true});}
 let before:Entity|undefined,item:Entity;
 if(action==='ar-access-grant-save'){
  const v=input as z.infer<typeof grantSchema>,target=all(s,'member').find(x=>x.id===v.memberId&&x.active&&x.role!=='supplier');if(!target)throw new AppError('请选择唯一有效内部成员账号。');
  if(new Set(v.teamIds).size!==v.teamIds.length||v.teamIds.some(teamId=>!all(s,'customer_project_team').some(t=>t.id===teamId&&t.active)))throw new AppError('授权组包含重复、不存在或已停用组。');
  if(v.scopeType==='team'&&!v.teamIds.length||v.scopeType==='company'&&v.teamIds.length)throw new AppError('组范围须选择组，公司范围不填写组清单。');if(!v.capabilities.includes('read')||new Set(v.capabilities).size!==v.capabilities.length)throw new AppError('读取能力必选，能力不能重复。');
  before=all(s,'ar_access_grant').find(r=>r.memberId===v.memberId);if(v.id&&before?.id!==v.id)throw new AppError('授权不存在或成员归属不一致。',409);current(before,v.version);
  item={id:before?.id||newId('ar_grant'),kind:'ar_access_grant',memberId:v.memberId,scopeType:v.scopeType,teamIds:v.teamIds,capabilities:v.capabilities,readOnly:v.readOnly,active:v.active,version:(before?.version||0)+1,reason:v.reason,createdAt:before?.createdAt||now(),updatedAt:now(),updatedById:m.id};
 }else{
  const v=input as z.infer<typeof bindingSchema>,source=s.records.find(r=>r.id===v.sourceId&&r.kind===v.sourceKind);
  if(!source||source.customerId!==v.customerId||!all(s,'customer_account').some(c=>c.id===v.customerId))throw new AppError('来源与客户必须明确对应。');
  if(v.teamId&&!all(s,'customer_project_team').some(t=>t.id===v.teamId))throw new AppError('原归属组不存在。');
  if(v.shipmentVerified){if(!(source.kind==='service_record'&&source.type==='shipment'||source.kind==='handoff_business_source'&&source.type==='production_shipment')||v.shipmentAmountCents===undefined||!v.currency||!arDay(source.actualShipDate||source.fields?.date||source.details?.shipDate))throw new AppError('出货核实须有实际出货来源、日期、原币种及明确金额。');}
  before=all(s,'ar_source_binding').find(r=>r.sourceKind===v.sourceKind&&r.sourceId===v.sourceId);if(v.id&&before?.id!==v.id)throw new AppError('来源归属配置不存在。',409);current(before,v.version);
  item={id:before?.id||newId('ar_binding'),kind:'ar_source_binding',sourceKind:v.sourceKind,sourceId:v.sourceId,customerId:v.customerId,teamId:v.teamId,canonicalKey:clean(v.canonicalKey),reason:v.reason,shipmentVerified:v.shipmentVerified,...(v.shipmentVerified?{shipmentAmountCents:v.shipmentAmountCents,currency:v.currency}:{}),active:true,version:(before?.version||0)+1,createdAt:before?.createdAt||now(),updatedAt:now(),updatedById:m.id};
 }
 await commit(s.revision,[item,audit(m,item,before||null,action,'应收工作空间'),{id:requestId,kind:'ar_request',actorId:m.id,fingerprint,result:item,createdAt:now()}]);return json({ok:true,item});
}
