import {createHash} from 'node:crypto';
import {z} from 'zod';
import {departmentCatalog,departmentAction,readArguments,inspectArguments,draftArguments,describeSchema,validateProcessPayload,processPayloadSchema,contractRevision} from './department-contracts.mjs';

export const departmentInputSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('list')}).strict(),
 z.object({operation:z.literal('inspect'),action:z.string().min(1).max(100),arguments:z.record(z.unknown()).default({})}).strict(),
 z.object({operation:z.literal('query'),action:z.string().min(1).max(100),arguments:z.record(z.unknown())}).strict(),
 z.object({operation:z.literal('prepare'),action:z.string().min(1).max(100),arguments:z.record(z.unknown())}).strict(),
]);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function parse(schema,input){
 const result=schema.safeParse(input);
 if(!result.success)throw fail('参数不符合动作契约：'+result.error.issues.slice(0,4).map(issue=>issue.path.join('.')||'arguments').join('、'));
 return result.data;
}
const fixedScope=(action,scope)=>action.type?{type:action.type}:scope;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// One dispatcher for all ten groups. No network destination, HTTP verb, identity,
// SQL, shell command, credential, confirmation or write callback is model input.
export async function executeDepartment(group,input,access){
 const request=parse(departmentInputSchema,input);
 if(request.operation==='list'){
  await access.assertCurrent();
  return departmentCatalog(group);
 }
 const action=departmentAction(group,request.action);
 if(request.operation==='inspect'){
  const args=parse(inspectArguments(action),request.arguments);
  const metadata=await access.catalog(action.source,fixedScope(action,args.scope));
  return{action:action.id,status:action.status,writeEnabled:false,contractRevision,
   arguments:describeSchema(action.kind==='read'?readArguments(action):draftArguments(action.type)),
   metadata,rules:action.kind==='draft'?['必须先核对关联与来源；不猜客户、订单、负责人或证据。','更新需当前 ID 和版本，仅合并显式修改字段，其余字段保留。','完成条件、数量平衡、日期、金额等复用中台固定校验。','只返回草稿；关联授权仍需提交服务校验，尚无业务保存或确认入口。']:[]};
 }
 if(request.operation==='query'){
  if(action.kind!=='read')throw fail('此动作不能用于查询。');
  const args=parse(readArguments(action),request.arguments);
  return access.query({...args,source:action.source,scope:fixedScope(action,args.scope)});
 }
 if(action.kind!=='draft')throw fail('此动作尚未接入新增／修改草稿。');
 if(typeof access.processDraftContext!=='function')throw fail('当前任务仅可读取，不能生成业务修改草稿。',403);
 const args=parse(draftArguments(action.type),request.arguments);
 const context=await access.processDraftContext(action.type,args.mode==='update'?args.id:undefined);
 let before=null,proposed;
 if(args.mode==='create'){
  if(!context.canCreate)throw fail('当前账号没有该流程类型的新增权限。',403);
  proposed=validateProcessPayload(action.type,{...args.fields,type:action.type});
 }else{
  const record=context.record;
  if(!record||record.type!==action.type||record.canEdit!==true)throw fail('记录不存在或当前不可修改。',403);
  if(record.version!==args.expectedVersion)throw fail('记录版本已变化，请重新查询并核对。',409);
  const keys=Object.keys(processPayloadSchema(action.type).shape);
  before=parse(processPayloadSchema(action.type),Object.fromEntries(keys.filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]])));
  for(const key of ['customerId','orderId','teamId'])if(Object.hasOwn(args.changes,key)&&args.changes[key]!==before[key])throw fail('已有记录的客户、订单和业务小组不能改换。');
  proposed=validateProcessPayload(action.type,{...before,...args.changes,details:{...before.details,...args.changes.details}});
 }
 const changes=Object.keys(proposed).filter(key=>JSON.stringify(before?.[key])!==JSON.stringify(proposed[key])).map(field=>({field,...(before?{before:before[field]}:{}),after:proposed[field]}));
 const binding={action:action.id,actorId:context.actorId,recordId:args.mode==='update'?args.id:null,recordVersion:args.mode==='update'?args.expectedVersion:null,contractRevision,sourceHash:digest(before),payloadHash:digest(proposed),basisHash:digest(args.basis)};
 const result={status:'draft-only',saved:false,executed:false,approvalRequired:true,writeEnabled:false,readAt:context.readAt,binding,changes,proposed,basis:args.basis,basisVerified:false,
  message:'仅生成字段校验草稿。尚未保存或批准；正式执行仍须人工核对，并由中台重新校验关联、权限、版本与幂等。此草稿哈希不是批准令牌。'};
 if(Buffer.byteLength(JSON.stringify(result))>48*1024)throw fail('草稿过大，请缩小本次修改范围。',413);
 return result;
}
