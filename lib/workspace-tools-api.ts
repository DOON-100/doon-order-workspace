import {z} from 'zod';
import {all,allowedFields,broad,canRead,now,strictDate,type Entity,type Member,type Order,type State} from './domain';
import {departmentColumns} from './departments';
import {active} from './ledger';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';

export const workspaceToolsContract='workspace-tools-v1';
const id=z.string().trim().min(1).max(160),token=z.string().uuid(),version=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const selection=z.array(z.object({id,version:z.number().int().positive()}).strict()).min(1).max(500).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'订单不能重复');
export const workspaceToolsSchemas={
 comment:z.object({token,lineId:id,orderVersion:z.number().int().positive(),text:z.string().trim().min(1).max(3000),dueDate:z.string().max(10).default('')}).strict(),
 task:z.object({token,id,expectedVersion:version,expectedHash:hash,done:z.boolean()}).strict(),
 'owner-preview':z.object({orders:selection,email:z.string().email().max(254)}).strict(),
 'owner-assign':z.object({token,orders:selection,email:z.string().email().max(254),previewHash:hash}).strict(),
};
const commentKeys=['id','kind','lineId','version','text','dueDate','done','actorId','actor','createdAt','completedBy','completedAt'];
const pick=(row:Entity,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
function internal(m:Member){if(!m.active||m.role==='supplier')throw new AppError('没有内部工作台权限。',403);}
function order(s:State,m:Member,id:string){const o=all(s,'order').find(r=>r.id===id) as Order|undefined;if(!o||!canRead(m,o))throw new AppError('订单不存在或无权访问。',403);return o;}
function follow(s:State,m:Member,id:string){const o=order(s,m,id);if(!allowedFields(m,o).length&&!departmentColumns(m,o).length)throw new AppError('没有原订单跟进权限。',403);return o;}
async function digest(value:unknown){return sha(JSON.stringify(value));}
async function commentDto(row:Entity){return {...pick(row,commentKeys),version:row.version??0,sourceHash:await digest(row)};}
async function replay(s:State,m:Member,action:string,input:{token:string}){const prior=s.records.find(r=>r.id==='workspace_tools_request_'+input.token);if(!prior)return null;if(prior.kind!=='workspace_tools_request'||prior.actorId!==m.id||prior.action!==action||prior.hash!==await digest(input))throw new AppError('请求编号已用于其他内容。',409);if(prior.lineId)follow(s,m,prior.lineId);else if(!broad(m))throw new AppError('需要 PMC 或管理员权限。',403);return json({...prior.result,idempotent:true});}
async function persist(s:State,m:Member,action:string,input:{token:string},rows:Entity[],result:Record<string,unknown>,lineId=''){await commit(s.revision,[...rows,{id:'workspace_tools_request_'+input.token,kind:'workspace_tools_request',actorId:m.id,action,hash:await digest(input),lineId,result,createdAt:now()}]);return json(result);}
async function ownerPlan(s:State,m:Member,input:z.infer<typeof workspaceToolsSchemas['owner-preview']>){
 if(!broad(m))throw new AppError('需要 PMC 或管理员权限。',403);const target=all(s,'member').find(r=>r.active&&r.email===input.email);if(!target)throw new AppError('请选择有效的原成员邮箱。');
 const rows=input.orders.map(value=>{const o=order(s,m,value.id);if(!o.ledger||!active(o))throw new AppError('仅可选择原表在制订单。',409);if(o.version!==value.version)throw new AppError('所选订单已有新版本，请重新预览。',409);return {id:o.id,version:o.version,ownerEmail:o.ownerEmail||'',ownerName:o.ledger.ownerName||'',nextOwnerEmail:target.email};});
 const normalized=[...rows].sort((a,b)=>a.id.localeCompare(b.id));return {rows,member:{id:target.id,email:target.email,name:target.name},previewHash:await digest({actorId:m.id,rows:normalized,target:{id:target.id,email:target.email,active:target.active}})};
}
export async function workspaceToolsGet(action:string,req:Request,s:State,m:Member){
 if(!['workspace-tools-data','workspace-tools-history','workspace-report-file-info'].includes(action))return null;internal(m);const query=new URL(req.url).searchParams,id=query.get('id')||'';
 if(action==='workspace-report-file-info'){const row=all(s,'export').find(r=>r.id===id);if(!row)throw new AppError('报表归档不存在。',404);if(!broad(m))for(const orderId of row.orderIds||[])order(s,m,orderId);const blob=await bucket().get(row.fileKey);if(!blob)throw new AppError('归档原件暂不可用。',404);const bytes=await blob.arrayBuffer(),hash=await sha(bytes);if(row.hash&&row.hash!==hash)throw new AppError('归档原件与保存摘要不符。',409);return json({id:row.id,filename:row.filename,hash,size:bytes.byteLength,storedHash:row.hash||null,basis:row.hash?'归档时保存的摘要':'原归档未保存摘要；本次只读计算当前原件摘要，不补写历史'});}if(action==='workspace-tools-history'){const row=all(s,'comment').find(r=>r.id===id);if(!row)throw new AppError('跟进事项不存在。',404);order(s,m,row.lineId);return json({contract:workspaceToolsContract,id,history:all(s,'audit').filter(r=>r.targetId===id).map(r=>({id:r.id,action:r.action,actor:r.actor,createdAt:r.createdAt,before:r.before?pick(r.before,commentKeys):null,after:r.after?pick(r.after,commentKeys):null}))});}
 const readable=(r:Entity)=>{try{order(s,m,r.lineId);return true;}catch{return false;}};
 const jobs=all(s,'import').filter(r=>r.importType==='orders'&&(broad(m)||r.actorId===m.id)).map(r=>pick(r,['id','kind','filename','hash','sheet','header','createdAt','status','offset','applied','selected','reviewReason']));
 return json({contract:workspaceToolsContract,orders:all(s,'order').filter(r=>canRead(m,r as Order)).map(r=>pick(r,['id','version','orderNo','customer','drawing','ownerEmail','lifecycle'])),comments:await Promise.all(all(s,'comment').filter(readable).map(commentDto)),imports:jobs,ledgerImports:broad(m)?all(s,'ledger_import').map(r=>pick(r,['id','mode','writeContract','filename','hash','rowsHash','summary','sample','heldSample','offset','total','status','actor','createdAt'])):[],exports:all(s,'export').filter(r=>r.actorId===m.id||broad(m)).map(r=>pick(r,['id','reportType','filename','hash','size','actor','createdAt','filters','count','revision'])),members:broad(m)?all(s,'member').filter(r=>r.active).map(r=>pick(r,['id','name','email'])):[]});
}
export async function workspaceToolsPost(action:string,req:Request,s:State,m:Member){
 const name=({'workspace-comment-save':'comment','workspace-task-action':'task','workspace-owner-preview':'owner-preview','workspace-owner-assign':'owner-assign'} as Record<string,keyof typeof workspaceToolsSchemas>)[action];if(!name)return null;internal(m);const parsed=workspaceToolsSchemas[name].safeParse(await req.json());if(!parsed.success)throw new AppError('输入字段、版本或UUID无效。');const input=parsed.data as any;
 if(name==='owner-preview')return json({contract:workspaceToolsContract,readOnly:true,...await ownerPlan(s,m,input)});
 if(name==='owner-assign'){if(!broad(m))throw new AppError('需要 PMC 或管理员权限。',403);const prior=await replay(s,m,action,input);if(prior)return prior;const plan=await ownerPlan(s,m,input);if(plan.previewHash!==input.previewHash)throw new AppError('选集、订单版本或目标成员已变化，请重新预览。',409);const updates:Entity[]=[],rows=plan.rows.map(selected=>{const before=order(s,m,selected.id);if(before.ownerEmail===input.email)return {id:before.id,version:before.version,ownerEmail:before.ownerEmail,unchanged:true};const row={...before,ownerEmail:input.email,version:before.version+1,updatedAt:now(),updatedBy:m.name};updates.push(row,audit(m,row,before,'精确选集绑定跟单账号'));return {id:row.id,version:row.version,ownerEmail:row.ownerEmail,unchanged:false};});return persist(s,m,action,input,updates,{ok:true,rows,previewHash:plan.previewHash});}
 if(name==='comment'){const o=follow(s,m,input.lineId),prior=await replay(s,m,action,input);if(prior)return prior;if(o.version!==input.orderVersion)throw new AppError('原订单版本已变化，请刷新后添加跟进。',409);let due='';try{due=strictDate(input.dueDate);}catch{throw new AppError('跟进日期须为空或有效 YYYY-MM-DD。');}const row={id:'comment_'+input.token,kind:'comment',lineId:o.id,version:1,text:input.text,dueDate:due,done:false,actorId:m.id,actor:m.name,createdAt:now()};if(s.records.some(r=>r.id===row.id))throw new AppError('跟进记录编号已存在，未覆盖原记录。',409);return persist(s,m,action,input,[row,audit(m,row,null,'添加跟进')],{ok:true,item:await commentDto(row)},o.id);}
 const before=all(s,'comment').find(r=>r.id===input.id);if(!before)throw new AppError('跟进事项不存在。',404);follow(s,m,before.lineId);const prior=await replay(s,m,action,input);if(prior)return prior;if((before.version??0)!==input.expectedVersion||await digest(before)!==input.expectedHash)throw new AppError('跟进事项已变化，请刷新后重核。',409);const row={...before,version:(before.version??0)+1,done:input.done,completedBy:m.name,completedAt:now()};return persist(s,m,action,input,[row,audit(m,row,before,'更新待办状态')],{ok:true,item:await commentDto(row)},before.lineId);
}
