import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import type {BusinessRow} from './handoff-business';
import {businessEvidenceCurrent} from './handoff-business-evidence';

export const productionReviewPolicyId='handoff_business_production_review_policy';
export const productionReviewPolicySchema=z.object({token:z.string().uuid(),expectedVersion:z.number().int().min(0),drawingLeadMemberId:z.string().trim().min(1).max(160),engineeringSupervisorMemberId:z.string().trim().min(1).max(160)}).strict();
const signSchema=z.object({token:z.string().uuid(),sourceId:z.string().trim().min(1).max(160),expectedVersion:z.number().int().positive(),expectedPolicyVersion:z.number().int().positive(),decision:z.enum(['confirm','return']),note:z.string().trim().min(1).max(6000)}).strict();
function policy(s:State){return all(s,'handoff_business_policy').find(r=>r.id===productionReviewPolicyId);}
function role(s:State,m:Member){const p=policy(s);if(!m.active||!p||p.drawingLeadMemberId===p.engineeringSupervisorMemberId)return '';return p.drawingLeadMemberId===m.id?'drawing_lead':p.engineeringSupervisorMemberId===m.id?'engineering_supervisor':'';}
const active=(s:State,id:string)=>all(s,'member').some(m=>m.id===id&&m.active&&!['supplier','viewer','programmer'].includes(m.role));
export function productionAdoption(s:State,r:BusinessRow){
 const p=policy(s),configured=!!p&&p.drawingLeadMemberId!==p.engineeringSupervisorMemberId&&active(s,p.drawingLeadMemberId)&&active(s,p.engineeringSupervisorMemberId);
 const signatures=all(s,'handoff_business_adoption_signature').filter(x=>x.sourceId===r.id&&x.sourceVersion===r.version&&x.policyVersion===p?.version);
 const latest=(roleName:string)=>signatures.slice().reverse().find(x=>x.reviewerRole===roleName);
 const lead=latest('drawing_lead'),supervisor=latest('engineering_supervisor');
 const sourceChanged=!businessEvidenceCurrent(s,r);
 return {configured,sourceChanged,effective:configured&&!sourceChanged&&lead?.decision==='confirm'&&supervisor?.decision==='confirm'&&lead.actorId!==supervisor.actorId,lead:lead?{decision:lead.decision,actor:lead.actor,note:lead.note,at:lead.createdAt}:null,supervisor:supervisor?{decision:supervisor.decision,actor:supervisor.actor,note:supervisor.note,at:supervisor.createdAt}:null};
}
export function productionReviewData(s:State,m:Member){
 const p=policy(s),reviewerRole=role(s,m),sources=reviewerRole?(all(s,'handoff_business_source') as BusinessRow[]).filter(r=>r.type==='engineering_drawing'):[];
 return {reviewerRole,policyVersion:p?.version||0,policy:m.role==='admin'?p||null:null,canConfigure:m.active&&m.role==='admin',members:m.role==='admin'?all(s,'member').filter(r=>active(s,r.id)).map(r=>({id:r.id,name:r.name,role:r.role})):[],
  // Assigned reviewers receive only drawing identity and evidence. No CRM, prices or finance scope is implied.
  drawings:sources.map(r=>({id:r.id,version:r.version,number:r.number,style:r.fields.style,versionLabel:r.fields.versionLabel,title:r.fields.title,drawingNumber:r.fields.drawingNumber,path:r.fields.path,date:r.fields.date,confirmedBy:r.fields.confirmedBy,customerConfirmation:r.fields.customerConfirmation,attachments:all(s,'handoff_business_attachment').filter(a=>a.recordId===r.id&&a.customerId===r.customerId).map(a=>({id:a.id,filename:a.filename,hash:a.hash,sourceVersion:a.sourceVersion})),...productionAdoption(s,r)}))};
}
export async function productionReviewPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['handoff-business-review-policy','handoff-business-adoption-sign'].includes(action))return null;if(!m.active)throw new AppError('账号已停用',403);
 const isPolicy=action.endsWith('review-policy'),parsed=(isPolicy?productionReviewPolicySchema:signSchema).safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues[0].message);const input=parsed.data as any;
 if(isPolicy&&m.role!=='admin')throw new AppError('仅管理员可按已核实人员配置双签岗位',403);
 const reviewerRole=role(s,m);if(!isPolicy&&!reviewerRole)throw new AppError('仅已配置画图组长或工程主管可签核，管理员不默认代签',403);
 const fingerprint=JSON.stringify({action,input}),prior=s.records.find(r=>r.id==='handoff_business_request_'+input.token);
 if(prior){if(prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('操作编号冲突',409);return json({ok:true,idempotent:true,...productionReviewData(s,m)});}
 const p=policy(s);let updates:Entity[]=[];
 if(isPolicy){
  if((p?.version||0)!==input.expectedVersion)throw new AppError('审核岗位配置已更新',409);
  if(input.drawingLeadMemberId===input.engineeringSupervisorMemberId||!active(s,input.drawingLeadMemberId)||!active(s,input.engineeringSupervisorMemberId))throw new AppError('两岗位须由不同有效内部成员担任');
  const next={id:productionReviewPolicyId,kind:'handoff_business_policy',version:(p?.version||0)+1,drawingLeadMemberId:input.drawingLeadMemberId,engineeringSupervisorMemberId:input.engineeringSupervisorMemberId,updatedBy:m.name,updatedAt:now()};updates=[next,audit(m,next,p||null,'配置生产采用双签岗位')];
 }else{
  const source=all(s,'handoff_business_source').find(r=>r.id===input.sourceId&&r.type==='engineering_drawing') as BusinessRow|undefined;if(!source)throw new AppError('图纸版本不存在',403);if(source.version!==input.expectedVersion)throw new AppError('图纸资料已换版，请重新核对',409);
  if(input.expectedPolicyVersion!==p?.version)throw new AppError('审核岗位配置已变化，请重新核对',409);
  if(!productionAdoption(s,source).configured)throw new AppError('两位审核人员未配置或已停用，不能生效',409);
  if(input.decision==='confirm'&&!businessEvidenceCurrent(s,source))throw new AppError('原工程资料或引用来源已变化，请更新来源版本后重新双签',409);
  if(!source.fields.versionLabel||!source.fields.path||!source.fields.drawingNumber)throw new AppError('请先补齐版本、工程图号及来源路径');
  const signature={id:newId('handoff_business_adoption_signature'),kind:'handoff_business_adoption_signature',sourceId:source.id,sourceVersion:source.version,policyVersion:p!.version,reviewerRole,decision:input.decision,note:input.note,actorId:m.id,actor:m.name,createdAt:now(),snapshot:{number:source.number,style:source.fields.style,versionLabel:source.fields.versionLabel,drawingNumber:source.fields.drawingNumber,path:source.fields.path}};updates=[signature,audit(m,signature,null,'生产采用图纸 · '+(input.decision==='confirm'?'岗位确认':'退回'))];
 }
 updates.push({id:'handoff_business_request_'+input.token,kind:'handoff_business_request',actorId:m.id,fingerprint,action,createdAt:now()});await commit(s.revision,updates);
 const next={revision:s.revision+1,records:[...s.records.filter(r=>!updates.some(u=>u.id===r.id)),...updates]};return json({ok:true,...productionReviewData(next,m)});
}
