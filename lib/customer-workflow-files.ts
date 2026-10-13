import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {actor,AppError,bucket,json,snapshot} from './store';
import {sha} from './workbooks';
import {assignedCustomerQuoteAccount,canSeeCustomerQuoteInternal,customerServiceQuoteReader,canMaintainCustomerQuoteAccount} from './customer-quote-access';
import {customerFileCategories,projectFolders,projectFileTypes,workflowId,workflowToken,workflowVersion} from './customer-workflow';
import {workflowCapabilities,workflowCommit,workflowCustomer,workflowReplay,workflowVersionCheck} from './customer-workflow-api';

const meta=z.object({token:workflowToken,customerId:workflowId,projectId:z.string().max(160).default(''),category:z.enum(customerFileCategories).optional(),folder:z.enum(projectFolders).optional(),documentType:z.string().trim().max(160).default(''),title:z.string().trim().min(1).max(240),fileVersion:z.string().trim().min(1).max(80),status:z.enum(['待确认','有效']).default('待确认'),note:z.string().max(3000).default('')}).strict();
const edit=meta.extend({id:workflowId,version:workflowVersion,status:z.enum(['待确认','有效','已归档']),reason:z.string().trim().min(1).max(3000)}).strict();
const markdown=z.object({token:workflowToken,customerId:workflowId,projectId:workflowId,version:workflowVersion,content:z.string().max(20000),reason:z.string().trim().min(1).max(3000)}).strict();
const projectSchema=z.object({token:workflowToken,customerId:workflowId,projectId:workflowId,version:workflowVersion,stage:z.enum(['待核实','需求了解','可行性','报价','打样','样品反馈','商务确认','暂缓','关闭']),next:z.string().trim().max(300),notes:z.string().max(12000),reason:z.string().trim().min(1).max(3000)}).strict();
const projectLogSchema=z.object({token:workflowToken,customerId:workflowId,projectId:workflowId,version:workflowVersion,stage:z.enum(['待核实','需求了解','可行性','报价','打样','样品反馈','商务确认','暂缓','关闭']),result:z.string().trim().min(1).max(12000),next:z.string().trim().min(1).max(300)}).strict();
const allowed:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',txt:'text/plain',md:'text/plain',json:'text/plain',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',dwg:'application/octet-stream',dxf:'application/octet-stream',step:'application/octet-stream',stp:'application/octet-stream',eml:'message/rfc822',mp4:'video/mp4',mov:'video/quicktime'};
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{const result=schema.safeParse(input);if(!result.success)throw new AppError(result.error.issues.slice(0,3).map(i=>i.message).join('；'));return result.data;}
export function workflowFileAccess(s:State,m:Member,value:{customerId:string;projectId?:string;folder?:string;category?:string},write=false){
 const customer=workflowCustomer(s,m,value.customerId),capabilities=workflowCapabilities(s,m,customer);
 if(write&&!capabilities.writeProfile&&!(value.category==='银行资料证明'&&capabilities.writeBank))throw new AppError('没有当前客户附件维护权限。',403);
 if(value.projectId){if(!all(s,'customer_project').some(p=>p.id===value.projectId&&p.customerId===customer.id))throw new AppError('附件项目不属于当前客户。',403);}
 if(value.category==='银行资料证明'&&!(write?capabilities.writeBank:capabilities.readBank))throw new AppError('当前银行资料权限未开放。',403);
 if(value.folder==='04_工程报价'&&!canSeeCustomerQuoteInternal(s,m,customer))throw new AppError('工程报价资料需当前客户内部报价权限。',403);
 if(value.folder==='05_销售报价'&&!(write?canMaintainCustomerQuoteAccount(s,m,customer):assignedCustomerQuoteAccount(s,m,customer)||customerServiceQuoteReader(s,m,customer)))throw new AppError('销售报价资料读取或维护权限不足；客服历史查看不包含修改权限。',403);
 if(value.folder==='07_付款'&&!['admin','finance','sales','clerk'].includes(m.role))throw new AppError('付款资料未对当前角色开放。',403);
 return customer;
}
function validDestination(input:any){
 if(input.projectId){if(!input.folder||input.folder==='00_项目资料.md'||input.folder==='99_旧版本')throw new AppError('上传时请选择项目资料目录，旧版本使用归档操作。');if(input.category)throw new AppError('项目附件不能指定客户通用分类。');const types=projectFileTypes[input.folder];if(types&&!types.includes(input.documentType))throw new AppError('请选择此目录对应的文件类型。');}
 else if(!input.category||input.folder)throw new AppError('请选择客户通用正式附件分类。');
}
function safe(item:Entity){const {fileKey,...result}=item;return result;}
function visible(s:State,m:Member,row:Entity){try{workflowFileAccess(s,m,row as any);return true;}catch{return false;}}
export async function customerWorkflowFileGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-workflow-files','customer-workflow-file','customer-workflow-project-document','customer-workflow-project'].includes(action))return null;
 const params=new URL(req.url).searchParams;
 if(action==='customer-workflow-project'){
  const customerId=params.get('customerId')||'',projectId=params.get('projectId')||'';workflowFileAccess(s,m,{customerId,projectId});if(!projectId)throw new AppError('请选择项目。');
  return json({project:all(s,'customer_workflow_project').find(row=>row.customerId===customerId&&row.projectId===projectId)||null,logs:all(s,'customer_workflow_project_log').filter(row=>row.customerId===customerId&&row.projectId===projectId),canWrite:workflowCapabilities(s,m,workflowCustomer(s,m,customerId)).writeProfile});
 }
 if(action==='customer-workflow-files'){
  const customerId=params.get('customerId')||'',projectId=params.get('projectId')||'';workflowFileAccess(s,m,{customerId,projectId});
  return json({files:all(s,'customer_workflow_attachment').filter(r=>r.customerId===customerId&&(r.projectId||'')===projectId&&visible(s,m,r)).map(safe),canWrite:workflowCapabilities(s,m,workflowCustomer(s,m,customerId)).writeProfile});
 }
 if(action==='customer-workflow-project-document'){
  const customerId=params.get('customerId')||'',projectId=params.get('projectId')||'';workflowFileAccess(s,m,{customerId,projectId});if(!projectId)throw new AppError('请选择项目。');
  return json({document:all(s,'customer_workflow_document').find(r=>r.customerId===customerId&&r.projectId===projectId)||null,revisions:all(s,'customer_workflow_document_revision').filter(r=>r.customerId===customerId&&r.projectId===projectId).map(r=>({id:r.id,version:r.version,content:r.content,reason:r.reason,createdAt:r.createdAt,createdBy:r.createdBy})),canWrite:workflowCapabilities(s,m,workflowCustomer(s,m,customerId)).writeProfile});
 }
 const file=all(s,'customer_workflow_attachment').find(r=>r.id===params.get('id'));if(!file)throw new AppError('附件不存在。',404);workflowFileAccess(s,m,file as any);
 const stored=await bucket().get(file.fileKey);if(!stored)throw new AppError('原附件暂不可用，请核对存储。',404);const bytes=await stored.arrayBuffer();if(bytes.byteLength!==file.size||await sha(bytes)!==file.hash)throw new AppError('附件完整性校验未通过，未提供下载。',409);
 const fresh=await snapshot(),current=await actor(fresh),latest=all(fresh,'customer_workflow_attachment').find(r=>r.id===file.id);if(!latest||current.id!==m.id||latest.fileKey!==file.fileKey||latest.hash!==file.hash)throw new AppError('附件或登录状态已变化，请重新读取。',409);workflowFileAccess(fresh,current,latest as any);
 // Preview has the same fresh authorization and immutable-byte checks as download.
 // Only raster images and small plain text are rendered; HTML/SVG/office/PDF
 // remain attachments and cannot become an executable same-origin document.
 const preview=params.get('preview')==='1',image=/^image\/(png|jpeg|webp|gif)$/.test(file.contentType),plain=['text/plain','text/csv'].includes(file.contentType);
 if(preview&&(!(image||plain)||bytes.byteLength>2*1024*1024))throw new AppError('此格式或大小请下载后查看；仅支持 2 MB 内的图片和纯文本预览。');
 return new Response(bytes,{headers:{'Content-Type':preview&&plain?'text/plain; charset=utf-8':file.contentType,'Content-Disposition':`${preview?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self' data:; sandbox"}});
}
export async function customerWorkflowFilePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-workflow-file-upload','customer-workflow-file-save','customer-workflow-project-document-save','customer-workflow-project-save','customer-workflow-project-log'].includes(action))return null;
 if(action==='customer-workflow-project-save'||action==='customer-workflow-project-log'){
  const input=parse(action==='customer-workflow-project-save'?projectSchema:projectLogSchema,await req.json()) as any;workflowFileAccess(s,m,input,true);const replay=await workflowReplay(s,m,action,input);if(replay)return replay;
  const before=all(s,'customer_workflow_project').find(row=>row.customerId===input.customerId&&row.projectId===input.projectId);workflowVersionCheck(before,input.version);
  const item={...before,id:before?.id||newId('customer_workflow_project'),kind:'customer_workflow_project',customerId:input.customerId,projectId:input.projectId,version:(before?.version||0)+1,stage:input.stage,next:input.next,notes:input.notes??before?.notes??'',updatedBy:m.name,updatedAt:now()},changes:{item:Entity;before?:Entity}[]=[{item,before}];
  if(action==='customer-workflow-project-log')changes.push({item:{id:newId('customer_workflow_project_log'),kind:'customer_workflow_project_log',customerId:input.customerId,projectId:input.projectId,stage:input.stage,result:input.result,next:input.next,createdBy:m.name,createdAt:now()}});
  return workflowCommit(s,m,action,input,changes,action==='customer-workflow-project-log'?'记录前期开发推进结果':'维护前期开发阶段：'+input.reason);
 }
 if(action==='customer-workflow-project-document-save'){
  const input=parse(markdown,await req.json());workflowFileAccess(s,m,input,true);const replay=await workflowReplay(s,m,action,input);if(replay)return replay;
  const before=all(s,'customer_workflow_document').find(r=>r.projectId===input.projectId&&r.customerId===input.customerId);workflowVersionCheck(before,input.version);
  const item={id:before?.id||newId('customer_workflow_document'),kind:'customer_workflow_document',customerId:input.customerId,projectId:input.projectId,version:(before?.version||0)+1,content:input.content,updatedAt:now(),updatedBy:m.name};
  const history={id:newId('customer_workflow_document_revision'),kind:'customer_workflow_document_revision',customerId:input.customerId,projectId:input.projectId,version:item.version,content:input.content,reason:input.reason,createdAt:now(),createdBy:m.name};
  return workflowCommit(s,m,action,input,[{item,before},{item:history}],'保存 00_项目资料.md：'+input.reason);
 }
 if(action==='customer-workflow-file-save'){
  const input=parse(edit,await req.json()),before=all(s,'customer_workflow_attachment').find(r=>r.id===input.id&&r.customerId===input.customerId);if(!before)throw new AppError('附件不存在。',404);workflowFileAccess(s,m,before as any,true);workflowFileAccess(s,m,input,true);
  if(input.projectId!==before.projectId)throw new AppError('附件不能转移至其他客户或项目。');validDestination(input);const replay=await workflowReplay(s,m,action,input);if(replay)return replay;workflowVersionCheck(before,input.version);
  if(all(s,'customer_workflow_attachment').some(r=>r.id!==before.id&&r.customerId===input.customerId&&r.projectId===input.projectId&&r.folder===input.folder&&r.category===input.category&&r.title===input.title&&r.fileVersion===input.fileVersion))throw new AppError('该分类下已有同名同版本附件（包括归档版本）。',409);
  if(before.status==='已归档'&&input.status==='有效')throw new AppError('恢复旧版本须先恢复为待确认，再单独核对有效状态。');
  const {token,reason,...fields}=input,item={...before,...fields,version:before.version+1,...(input.status==='已归档'?{archivedAt:now(),archivedBy:m.name,archiveReason:input.reason}:{}),confirmedBy:input.status==='有效'?m.name:before.confirmedBy||'',confirmedAt:input.status==='有效'?now():before.confirmedAt||'',updatedAt:now(),updatedBy:m.name};
  return workflowCommit(s,m,action,input,[{item,before}],(input.status==='已归档'?'归档':before.status==='已归档'?'恢复':'维护')+'客户附件：'+input.reason);
 }
 const form=await req.formData(),data:Record<string,unknown>={};for(const key of Object.keys(meta.shape)){const value=form.get(key);if(typeof value==='string')data[key]=value;}const input=parse(meta,data);validDestination(input);workflowFileAccess(s,m,input,true);
 const file=form.get('file');if(!(file instanceof File)||file.size<=0||file.size>20*1024*1024)throw new AppError('请选择不超过 20 MB 的正式附件。');const extension=file.name.split('.').at(-1)?.toLowerCase()||'';if(!allowed[extension])throw new AppError('不支持此附件格式，请使用文档、图片、邮件、视频或工程文件。');
 const bytes=await file.arrayBuffer(),hash=await sha(bytes),filename=file.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,240),request={...input,filename,size:file.size,hash};const replay=await workflowReplay(s,m,action,request);if(replay)return replay;
 if(all(s,'customer_workflow_attachment').some(r=>r.customerId===input.customerId&&r.projectId===input.projectId&&r.folder===input.folder&&r.category===input.category&&r.title===input.title&&r.fileVersion===input.fileVersion))throw new AppError('该分类下已有同名同版本附件（包括归档版本），请核对版本。',409);
 const {token,...fields}=input,item={...fields,id:newId('customer_workflow_attachment'),kind:'customer_workflow_attachment',version:1,filename,contentType:allowed[extension],size:file.size,hash,fileKey:newId('customer_workflow_file'),createdAt:now(),createdBy:m.name,updatedAt:now(),updatedBy:m.name,confirmedBy:input.status==='有效'?m.name:'',confirmedAt:input.status==='有效'?now():''};
 await bucket().put(item.fileKey,bytes);return workflowCommit(s,m,action,request,[{item}],'上传客户正式附件：'+input.title+' '+input.fileVersion);
}
