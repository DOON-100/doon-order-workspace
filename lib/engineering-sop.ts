import {z} from 'zod';
import {all,clean,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {assignedDrawingCustomer,canManageDrawings,canApproveDrawings,canReadDrawing,type EngineeringDrawing} from './engineering-drawings';

export const sopStatuses=['待更新SOP','待上传MES','待确认','已确认','已取消'] as const;
export type EngineeringSop=Entity & {
 kind:'engineering_sop';version:number;drawingRecordId:string;customerId:string;modelNo:string;targetVersion:string;currentVersion:string;
 status:typeof sopStatuses[number];mode:'change_instruction'|'mes_upload';requirement:string;isCurrent:boolean;predecessorId:string;sourceEventId:string;
 sopFileId:string;preparedVersion:string;latestUploadId:string;targetNote:string;confirmationNote:string;confirmedBy:string;confirmedAt:string;
 createdBy:string;createdAt:string;updatedAt:string;updatedBy:string;
};
export type SopAttachment=Entity & {kind:'engineering_sop_attachment';sopId:string;customerId:string;purpose:'sop'|'mes_evidence';filename:string;fileKey:string;contentType:string;size:number;hash:string;actorId:string;createdAt:string};
export type SopUpload=Entity & {kind:'engineering_sop_upload';sopId:string;customerId:string;targetVersion:string;uploadedVersion:string;uploadedAt:string;mesReference:string;mesUrl:string;actualUploader:string;proofFileId:string;proofHash:string;sopFileId:string;sopHash:string;note:string;actorId:string;actor:string;createdAt:string;method:'manual_evidence'};
export const sopId=z.string().trim().min(1).max(800);
export const sopText=(max=3000)=>z.string().trim().max(max).default('');
export const sopDay=z.string().trim().superRefine((value,ctx)=>{try{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||strictDate(value)!==value)throw new Error();}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'请使用有效日期 YYYY-MM-DD'});}});
export const sopCreateSchema=z.object({drawingRecordId:sopId,modelNo:z.string().trim().min(1).max(3000),targetVersion:sopText(120),requirement:z.string().trim().min(1).max(12000),token:z.string().trim().min(8).max(160)}).strict();
export const sopActionSchema=z.object({id:sopId,version:z.number().int().positive()});
export function canCreateSopChange(s:State,m:Member){return m.active&&(m.role==='admin'||all(s,'customer_account').some(c=>assignedDrawingCustomer(m,c as any)));}
export function canInstructDrawing(s:State,m:Member,r:EngineeringDrawing){const c=all(s,'customer_account').find(c=>c.id===r.customerId);return !!c&&c.active&&(m.role==='admin'||assignedDrawingCustomer(m,c as any));}
export function canReadSop(s:State,m:Member,r:EngineeringSop){const drawing=all(s,'engineering_drawing').find(d=>d.id===r.drawingRecordId) as EngineeringDrawing|undefined;return !!drawing&&drawing.customerId===r.customerId&&canReadDrawing(s,m,drawing);}
export function publicSop(s:State,m:Member,r:EngineeringSop){const d=all(s,'engineering_drawing').find(d=>d.id===r.drawingRecordId) as EngineeringDrawing|undefined;return {...r,canManage:canManageDrawings(m),canApprove:canApproveDrawings(m),canInstruct:!!d&&canInstructDrawing(s,m,d)};}
export function publicSopAttachment(a:SopAttachment){const {fileKey,...value}=a;return value;}
export function sopRevision(r:EngineeringSop,m:{id:string;name:string},action:string):Entity{return {id:newId('sop_revision'),kind:'engineering_sop_revision',sopId:r.id,customerId:r.customerId,version:r.version,action,actorId:m.id,actor:m.name,createdAt:r.updatedAt,snapshot:structuredClone(r)};}
export function advanceSop(r:EngineeringSop,m:{id:string;name:string}):EngineeringSop{return {...r,version:r.version+1,updatedAt:now(),updatedBy:m.name};}

/** Each instruction creates a separate obligation. Existing files, confirmations and versions stay attached to the old obligation. */
export function planSopObligation(s:State,m:{id:string;name:string},drawing:EngineeringDrawing,input:{modelNo:string;targetVersion:string;requirement:string},mode:'change_instruction'|'mes_upload',sourceEventId=''){
 const matches=(all(s,'engineering_sop') as EngineeringSop[]).filter(r=>r.drawingRecordId===drawing.id&&clean(r.modelNo)===clean(input.modelNo));
 const prior=matches.find(r=>r.isCurrent),confirmed=matches.filter(r=>r.status==='已确认').sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt))[0];
 if(input.targetVersion&&matches.some(r=>r.status==='已确认'&&r.targetVersion===input.targetVersion))throw new Error('目标版本已确认上传MES；新的改图指令须使用新版本。');
 const at=now(),r:EngineeringSop={id:newId('sop'),kind:'engineering_sop',version:1,drawingRecordId:drawing.id,customerId:drawing.customerId,modelNo:input.modelNo,targetVersion:input.targetVersion,currentVersion:confirmed?.targetVersion||prior?.currentVersion||'',status:'待更新SOP',mode,requirement:input.requirement,isCurrent:true,predecessorId:prior?.id||'',sourceEventId,sopFileId:'',preparedVersion:'',latestUploadId:'',targetNote:'',confirmationNote:'',confirmedBy:'',confirmedAt:'',createdBy:m.id,createdAt:at,updatedAt:at,updatedBy:m.name};
 const updates:Entity[]=[r,sopRevision(r,m,mode==='change_instruction'?'发出改图指令，建立SOP及MES上传义务':'建立SOP上传MES任务')];
 if(prior){const old={...advanceSop(prior,m),isCurrent:false,supersededBy:r.id};updates.push(old,sopRevision(old,m,'新指令替代当前义务（原版本与证据保留）'));}
 return {record:r,updates};
}
export function isDrawingChangeType(value:unknown){return /改图|修改图|修订/i.test(clean(value));}
