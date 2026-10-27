import {z} from 'zod';
import {all,allowedFields,broad,canRead,clean,newId,now,validApproval,type Entity,type Member,type Order,type Report,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {departmentColumns} from './departments';
import {lossProcesses,mayRecordLoss} from './losses';
import {colLabels} from './ledger';

export const productionContract='production-workspace-v1';
const REQUEST='production_write_request',keys=(text:string)=>text.split(' '),pick=(row:any,fields:string[])=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
const reportKeys=keys('id version lineId orderNo drawing color lens workOrder task process batch startedAt reportedAt quantity approval nativeId identityType source updatedAt updatedBy');
const correctionKeys=keys('id version lineId reportId reportVersion before proposed reason status actorId actor createdAt reviewer reviewedAt reviewNote');
const lossKeys=keys('id lineId process department sequence previousId reportDate month input good wip loss delta reason correction source sourceRef actor actorId createdAt orderVersion orderNo customer drawing color lens orderQuantity sourceRow');
const orderKeys=keys('id version orderNo customer drawing color lens quantity unit stage lifecycle sourceStatus plannedDate notes');
const columns=keys('N Q U AB AC AD AE AF AG AH AI AJ AK AL AM AN AO AP AQ AR AS AT AU AV AW AX AY AZ BA BB BC BD BE BF BG BH BI');
const order=(s:State,m:Member,id:string)=>{const rows=s.records.filter(r=>r.id===id);if(rows.length!==1||rows[0].kind!=='order'||!canRead(m,rows[0] as Order))throw new AppError('无权访问原订单。',403);return rows[0] as Order;};
const report=(s:State,m:Member,id:string)=>{const rows=s.records.filter(r=>r.id===id);if(rows.length!==1||rows[0].kind!=='report')throw new AppError('报工记录不存在。',403);const r=rows[0] as Report;if(r.lineId)order(s,m,r.lineId);else if(!broad(m))throw new AppError('仅 PMC 或管理员可处理未关联报工。',403);return r;};
const correction=(s:State,m:Member,id:string)=>{const rows=s.records.filter(r=>r.id===id);if(rows.length!==1||rows[0].kind!=='correction')throw new AppError('更正申请不存在。',403);const row=rows[0];order(s,m,row.lineId);return row;};
export function productionReportDto(row:Entity){return pick(row,reportKeys);}
export function productionCorrectionDto(row:Entity){return {...pick(row,correctionKeys),version:row.version??0};}
function dto(s:State,m:Member,row:Entity):any{
 if(row.kind==='order'){const o=row as Order;return {...pick(o,orderKeys),columns:pick(o.ledger?.columns||{},columns),hasLedger:!!o.ledger,editableColumns:departmentColumns(m,o),lossProcesses:lossProcesses.filter(p=>p.departments.some(d=>mayRecordLoss(m,o,d))).map(p=>({...p,departments:p.departments.filter(d=>mayRecordLoss(m,o,d))}))};}
 if(row.kind==='report')return productionReportDto(row);
 if(row.kind==='correction')return productionCorrectionDto(row);
 if(row.kind==='loss')return pick(row,lossKeys);
 throw new AppError('生产记录类型无效。');
}
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function version(row:Entity,value:number){if((row.version??0)!==value)throw new AppError('生产记录版本已变化，请重新读取。',409);}
const id=z.string().trim().min(1).max(160),token=z.string().uuid(),expectedVersion=z.number().int().min(0),reason=z.string().trim().min(3).max(3000);
const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('match'),token,reportId:id,lineId:id,expectedVersion,orderVersion:z.number().int().positive(),reason}).strict(),
 z.object({type:z.literal('correction'),token,reportId:id,expectedVersion,quantity:z.number().int().min(0).max(10000000),reason}).strict(),
 z.object({type:z.literal('review'),token,id,expectedVersion,reportVersion:z.number().int().positive(),decision:z.enum(['approve','reject','verify']),reason}).strict(),
]);
export async function productionWorkspaceGet(action:string,req:Request,s:State,m:Member){
 if(!['production-workspace-data','production-workspace-history'].includes(action))return null;
 if(!m.active||m.role==='supplier')throw new AppError('仅当前有效员工可访问生产资料。',403);
 const readable=(row:Entity)=>{try{if(row.kind==='order')return canRead(m,row as Order);if(row.kind==='report'){report(s,m,row.id);return true;}if(row.kind==='correction'){correction(s,m,row.id);return true;}if(row.kind==='loss'){order(s,m,row.lineId);return true;}}catch{}return false;};
 if(action==='production-workspace-data')return json({contract:productionContract,receiptContract:'production-receipt-v1',mesContract:'production-mes-v1',orders:all(s,'order').filter(readable).map(r=>dto(s,m,r)),reports:all(s,'report').filter(readable).map(r=>dto(s,m,r)),corrections:all(s,'correction').filter(readable).map(r=>dto(s,m,r)),losses:all(s,'loss').filter(readable).map(r=>dto(s,m,r)),columnLabels:pick(colLabels,columns),receiptPhotos:all(s,'receipt_photo').filter(r=>broad(m)||r.actorId===m.id||all(s,'receipt').some(receipt=>receipt.photoId===r.id&&receipt.lines?.every((line:any)=>{try{order(s,m,line.lineId);return true;}catch{return false;}}))).map(r=>pick(r,keys('id filename hash contentType actorId actor createdAt')))});
 const query=new URL(req.url).searchParams,type=query.get('type'),targetId=query.get('id')||'',kind=type==='ledger'?'order':type==='report'?'report':type==='correction'?'correction':type==='loss'?'loss':'';
 const target=s.records.find(r=>r.id===targetId&&r.kind===kind);if(!target||!readable(target))throw new AppError('无权读取此生产记录历史。',403);
 const history=all(s,'audit').filter(a=>a.targetId===targetId&&a.after?.kind===kind&&a.after?.id===targetId&&readable(a.after)&&(!a.before||a.before.id===targetId&&a.before.kind===kind&&readable(a.before))).map(a=>({...pick(a,keys('id action actor createdAt source')),before:a.before?dto(s,m,a.before):null,after:dto(s,m,a.after)}));
 return json({contract:productionContract,id:targetId,type,history});
}
export async function productionWorkspacePost(action:string,req:Request,s:State,m:Member){
 if(action!=='production-report-action')return null;
 if(!m.active||m.role==='supplier')throw new AppError('无权修改生产资料。',403);
 const parsed=actionSchema.safeParse(await req.json());if(!parsed.success)throw new AppError('生产操作字段不完整或无效。');const input=parsed.data;
 let before:Entity,r:Report;
 if(input.type==='review'){if(!broad(m))throw new AppError('仅 PMC 或管理员可审核和核验更正。',403);before=correction(s,m,input.id);r=report(s,m,before.reportId);if(r.lineId!==before.lineId)throw new AppError('原报工关联已变化，请重新核对更正依据。',409);}
 else {r=report(s,m,input.reportId);before=r;if(input.type==='match'){if(!broad(m))throw new AppError('仅 PMC 或管理员可关联报工。',403);order(s,m,input.lineId);}else {if(!r.lineId||!allowedFields(m,order(s,m,r.lineId)).length)throw new AppError('没有更正申请权限。',403);}}
 const requestId=REQUEST+'_'+input.token,fingerprint=await hash(input),prior=s.records.find(row=>row.id===requestId);
 if(prior){if(prior.kind!==REQUEST||prior.actorId!==m.id||prior.action!==input.type||prior.hash!==fingerprint)throw new AppError('请求标识已用于其他身份或内容。',409);const target=s.records.find(row=>row.id===prior.recordId);if(!target||target.kind!==prior.recordKind)throw new AppError('原请求记录无法核实。',409);if(target.kind==='report')report(s,m,target.id);else correction(s,m,target.id);return json({ok:true,idempotent:true,record:dto(s,m,target),appliedVersion:prior.recordVersion});}
 version(before,input.expectedVersion);let next:Entity,event:string;
 if(input.type==='match'){const target=order(s,m,input.lineId);version(target,input.orderVersion);if([r.orderNo,r.drawing,r.color].map(clean).join('|').toUpperCase()!==[target.orderNo,target.drawing,target.color].map(clean).join('|').toUpperCase())throw new AppError('订单号、图号或圈色不符，不能强行关联。');next={...r,lineId:target.id,lens:target.lens,version:r.version+1,updatedAt:now(),updatedBy:m.name};event='人工关联报工';}
 else if(input.type==='correction'){if(r.quantity===input.quantity)throw new AppError('建议数量与当前数量相同。');if(all(s,'correction').some(c=>c.reportId===r.id&&c.reportVersion===r.version&&c.proposed===input.quantity&&['待审核','待 MES 人工处理'].includes(c.status)))throw new AppError('同一报工版本及建议数量已有处理中申请，请查询原申请。',409);next={id:newId('correction'),kind:'correction',version:1,lineId:r.lineId,reportId:r.id,reportVersion:r.version,before:r.quantity,proposed:input.quantity,reason:input.reason,status:'待审核',actorId:m.id,actor:m.name,createdAt:now()};event='提交 MES 更正申请';}
 else {version(r,input.reportVersion);if(input.decision==='verify'){if(before.status!=='待 MES 人工处理')throw new AppError('此申请尚未进入 MES 处理阶段。',409);if(r.version<=before.reportVersion||r.quantity!==before.proposed||!validApproval(r))throw new AppError('新导入报工尚未与建议值一致且通过审批。');}else{if(before.status!=='待审核')throw new AppError('此申请已审核，请刷新。',409);if(input.decision==='approve'&&r.version!==before.reportVersion)throw new AppError('报工来源已变化，请重新提交更正申请。',409);}next={...before,version:(before.version??0)+1,status:input.decision==='approve'?'待 MES 人工处理':input.decision==='reject'?'已驳回':'导出回读已核验',reviewer:m.name,reviewedAt:now(),reviewNote:input.reason};event='审核 / 核验 MES 更正';}
 const request={id:requestId,kind:REQUEST,actorId:m.id,action:input.type,hash:fingerprint,recordId:next.id,recordKind:next.kind,recordVersion:next.version,createdAt:now()};
 if(s.records.some(row=>row.id===request.id)||next.id!==before.id&&s.records.some(row=>row.id===next.id))throw new AppError('请求或业务记录标识冲突。',409);
 await commit(s.revision,[next,request,audit(m,next,input.type==='correction'?null:before,event,input.reason)]);
 return json({ok:true,record:dto(s,m,next),appliedVersion:next.version});
}
