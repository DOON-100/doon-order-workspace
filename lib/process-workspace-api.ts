import {z} from 'zod';
import {all,canRead,newId,now,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {businessTeamData,businessTeamHeader,filterBusinessTeamRows,ungroupedBusinessTeam} from './business-team-scope';
import {serviceOrderCustomerKeys} from './service-workspace';
import {assertProcessCompletion,canEditProcessRecord,canReadProcessRecord,canWriteProcessKind,processCustomerAccounts,processDetailsSchema,processKinds,processSaveSchema,type ProcessFields,type ProcessRecord,type ProcessRevision} from './process-workspace';

function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{
 const result=schema.safeParse(value);if(!result.success)throw new AppError(result.error.issues.slice(0,4).map(issue=>`${issue.path.join('.')||'内容'}：${issue.message}`).join('；'));return result.data;
}
function requestTeam(req:Request,s:State,m:Member){
 if(!m.active||m.role==='supplier')throw new AppError('没有流程工作台访问权限。',403);
 const teamId=(req.headers.get(businessTeamHeader)||'').trim();
 if(teamId.length>160)throw new AppError('业务小组编号无效。');
 if(teamId&&teamId!==ungroupedBusinessTeam&&!businessTeamData(s,m).teams.some(team=>team.id===teamId))throw new AppError('业务小组不存在或不在可见客户范围内。',403);
 return teamId;
}
function readable(s:State,m:Member,id:string,teamId:string){
 const record=all(s,'process_record').find(row=>row.id===id) as ProcessRecord|undefined;
 if(!record||!canReadProcessRecord(s,m,record)||!filterBusinessTeamRows(s,[record],teamId).length)throw new AppError('流程记录不存在或不在当前授权客户、订单及业务小组范围内。',403);
 return record;
}
function publicRecord(s:State,m:Member,record:ProcessRecord){return {...record,canEdit:canEditProcessRecord(s,m,record)};}
function validateAssociation(s:State,m:Member,fields:ProcessFields,teamId:string){
 if(!fields.customerId&&!fields.orderId)throw new AppError('请关联一个获授权客户或订单。');
 if(!canReadProcessRecord(s,m,fields))throw new AppError('客户或订单不在授权范围内，或关联客户与订单不一致。',403);
 if(fields.teamId){
  const team=businessTeamData(s,m).teams.find(row=>row.id===fields.teamId&&row.active);
  if(!team||!filterBusinessTeamRows(s,[fields],fields.teamId).length)throw new AppError('记录业务小组与关联客户、订单不一致。',403);
 }
 if(!filterBusinessTeamRows(s,[fields],teamId).length)throw new AppError('不能在当前业务小组维护其他组的流程记录。',403);
}
function validateOwners(s:State,fields:ProcessFields){
 for(const [key,label] of [['ownerId','执行负责人'],['responsibleId','最终负责人'],['nextOwnerId','下一步负责人']] as const){
  const id=fields[key];if(!id)continue;
  const member=all(s,'member').find(row=>row.id===id) as Member|undefined;
  if(!member||!canReadProcessRecord(s,member,fields))throw new AppError(`${label}必须是已有客户或订单访问权限的有效内部成员；选择负责人不会授予权限。`);
 }
}
async function fingerprint(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}

export async function processWorkspaceGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['process-data','process-history'].includes(action))return null;
 const teamId=requestTeam(req,s,m);
 if(action==='process-history'){
  const record=readable(s,m,new URL(req.url).searchParams.get('id')||'',teamId);
  const history=(all(s,'process_record_revision') as ProcessRevision[]).filter(row=>row.recordId===record.id&&row.customerId===record.customerId&&row.orderId===record.orderId&&row.teamId===record.teamId&&canReadProcessRecord(s,m,row.snapshot))
   .sort((a,b)=>b.version-a.version).map(({requestToken,requestFingerprint,...row})=>row);
  return json({history});
 }
 const type=new URL(req.url).searchParams.get('type')||'';
 if(type&&!processKinds.includes(type as typeof processKinds[number]))throw new AppError('流程类型无效。');
 const records=filterBusinessTeamRows(s,(all(s,'process_record') as ProcessRecord[]).filter(row=>(!type||row.type===type)&&canReadProcessRecord(s,m,row)),teamId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const customers=filterBusinessTeamRows(s,processCustomerAccounts(s,m),teamId);
 const orders=filterBusinessTeamRows(s,(all(s,'order') as Order[]).filter(row=>canRead(m,row)),teamId);
 const allowedKinds=processKinds.filter(kind=>canWriteProcessKind(s,m,kind));
 return json({records:records.map(row=>publicRecord(s,m,row)),allowedKinds,canCreate:allowedKinds.length>0,
  customers:customers.map(row=>({id:row.id,customer:row.customer,customerCode:row.customerCode,active:row.active,orderKeys:serviceOrderCustomerKeys(s,row)})),
  orders:orders.map(row=>({id:row.id,orderNo:row.orderNo,customer:row.customer,drawing:row.drawing,color:row.color,batch:row.batch})),
  members:all(s,'member').filter(row=>row.active&&row.role!=='supplier').map(row=>({id:row.id,name:row.name})),
  teams:businessTeamData(s,m).teams.map(({id,name,active,customerIds})=>({id,name,active,customerIds})),
  businessTeamScope:{teamId},notice:'流程作业记录仅用于跟进与证据登记，不替代 ERP 库存、财务记账或品质系统的实际放行。'});
}

// Shared deterministic validation and write plan. Building a plan never commits.
export async function buildProcessSave(req:Request,s:State,m:Member,body:unknown,source='流程作业工作台'){
 const teamId=requestTeam(req,s,m),input=parse(processSaveSchema,body);
 if(!canWriteProcessKind(s,m,input.type))throw new AppError('当前角色或部门没有该流程的维护权限。',403);
 const details=parse(processDetailsSchema(input.type),input.details) as Record<string,string|number>;
 const {id,version,token,...values}=input,fields:ProcessFields={...values,details};
 validateAssociation(s,m,fields,teamId);
 if(!canEditProcessRecord(s,m,fields))throw new AppError('该客户或订单不在你的流程维护范围内。',403);
 const hash=token?await fingerprint({...fields,id:id||'',version:version||0}):'';
 if(token){
  const prior=(all(s,'process_record_revision') as ProcessRevision[]).find(row=>row.actorId===m.id&&row.requestToken===token);
  if(prior){
   if(prior.requestFingerprint!==hash)throw new AppError('本次操作标识已用于不同内容，请核对后重新提交。',409);
   const record=readable(s,m,prior.recordId,teamId);return {before:record,fields,record,updates:[] as Entity[],idempotent:true};
  }
 }
 const before=id?readable(s,m,id,teamId):null;
 if(before){
  if(!canEditProcessRecord(s,m,before))throw new AppError('没有该流程记录的维护权限。',403);
  if(before.version!==version)throw new AppError('该记录已被更新，本次未覆盖；请刷新并核对最新版本。',409);
  if(['type','customerId','orderId','teamId'].some(key=>before[key]!==fields[key as keyof ProcessFields]))throw new AppError('已保存记录的类型、客户、订单和业务小组不能改换；请新建相应流程记录。');
 }else if(version!==undefined)throw new AppError('新记录不能指定已有版本。');
 validateOwners(s,fields);
 try{assertProcessCompletion(fields);}catch(error){throw new AppError(error instanceof Error?error.message:'流程完成条件不满足。');}
 const at=now(),record:ProcessRecord={...fields,id:before?.id||newId('process_record'),kind:'process_record',version:(before?.version||0)+1,createdAt:before?.createdAt||at,createdById:before?.createdById||m.id,updatedAt:at,updatedById:m.id,updatedBy:m.name};
 const actionLabel=before?'更新流程作业记录':'新增流程作业记录';
 const revision:ProcessRevision={id:newId('process_record_revision'),kind:'process_record_revision',recordId:record.id,customerId:record.customerId,orderId:record.orderId,teamId:record.teamId,version:record.version,action:actionLabel,actorId:m.id,actor:m.name,createdAt:at,snapshot:structuredClone(record),...(token?{requestToken:token,requestFingerprint:hash}:{})};
 const updates:Entity[]=[record,revision,audit(m,record,before,actionLabel,source)];
 return {before,fields,record,updates,idempotent:false};
}
export async function processWorkspacePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='process-save')return null;
 const plan=await buildProcessSave(req,s,m,await req.json());
 if(plan.updates.length)await commit(s.revision,plan.updates);
 const record=plan.record;
 return json({ok:true,...(plan.idempotent?{idempotent:true}:{}),record:publicRecord({...s,records:[...s.records.filter(row=>row.id!==record.id),record]},m,record)});
}
