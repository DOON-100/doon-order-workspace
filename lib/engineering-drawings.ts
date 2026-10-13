import {z} from 'zod';
import {all,clean,newId,now,strictDate,type CustomerAccount,type Entity,type Member,type State} from './domain';

export const drawingStatuses=['待分配','画图中','待审核','已完成','已交接','已取消','历史待核对'] as const;
export const drawingApprovals=['待审核','通过','退回'] as const;
export const drawingOriginalColumns=['状态','客户编号','画图类型','需求发出时间','新款数量','改图数量','需求者','款号','画图备注','画图人员','截止日期','完成日期','老郑审批确认'] as const;
export const drawingRequestFields=['customerId','customerCode','drawingType','requestedDate','newCount','revisionCount','requester','upstreamDepartment','priority','requirement'] as const;
export const drawingExecutionFields=['status','modelNo','drawingNotes','assigneeId','assignee','deadline','completedDate','downstream','deliveredDate','deliveryNote'] as const;
export type DrawingStatus=typeof drawingStatuses[number];
export type DrawingApproval=typeof drawingApprovals[number];
export type DrawingSource={type:'manual'|'excel'|'email';filename?:string;sheet?:string;hash?:string;row?:number;rawColumns?:Record<string,string|number>;messageId?:string;itemKey?:string;threadId?:string};
export type EngineeringDrawing=Entity & {
 kind:'engineering_drawing';version:number;customerId:string;customerCode:string;drawingType:string;requestedDate:string;
 newCount:number|null;revisionCount:number|null;requester:string;modelNo:string;drawingNotes:string;assigneeId:string;assignee:string;
 deadline:string;completedDate:string;approval:DrawingApproval;status:DrawingStatus;upstreamDepartment:string;priority:'普通'|'紧急';
 requirement:string;downstream:string;deliveredDate:string;deliveryNote:string;source:DrawingSource;legacyNeedsReview:boolean;
 approvalNote:string;approvalBy:string;approvalAt:string;createdAt:string;updatedAt:string;updatedBy:string;createdBy:string;
};
export type DrawingRevision=Entity & {kind:'engineering_drawing_revision';recordId:string;customerId:string;version:number;action:string;actorId:string;actor:string;createdAt:string;snapshot:EngineeringDrawing};
export type DrawingEvent=Entity & {kind:'engineering_drawing_event';recordId:string;customerId:string;messageId:string;itemKey:string;threadId:string;sender:string;subject:string;receivedAt:string;request:Record<string,unknown>;fingerprint:string;status:'created'|'pending'|'accepted'|'rejected';reviewNote:string;actorId:string;createdAt:string};

const txt=(max=3000)=>z.string().trim().max(max).default('');
const day=z.string().trim().default('').superRefine((value,ctx)=>{if(!value)return;try{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||strictDate(value)!==value)throw new Error();}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'请使用有效日期 YYYY-MM-DD'});}});
const count=z.number().int().min(0).max(100000).nullable().default(null);
export const drawingFieldsSchema=z.object({
 customerId:txt(160),customerCode:txt(160),drawingType:txt(120),requestedDate:day,newCount:count,revisionCount:count,requester:txt(160),
 modelNo:txt(3000),drawingNotes:txt(12000),assigneeId:txt(160),assignee:txt(500),deadline:day,completedDate:day,
 approval:z.enum(drawingApprovals).default('待审核'),status:z.enum(drawingStatuses).default('待分配'),upstreamDepartment:txt(120),
 priority:z.enum(['普通','紧急']).default('普通'),requirement:txt(16000),downstream:txt(160),deliveredDate:day,deliveryNote:txt(6000),
}).strict();
export const drawingSaveSchema=drawingFieldsSchema.partial().extend({id:z.string().trim().min(1).max(800).optional(),version:z.number().int().positive().optional(),token:z.string().trim().min(8).max(160).optional()}).strict();
export type DrawingFields=z.output<typeof drawingFieldsSchema>;
export const drawingDefaultFields=():DrawingFields=>drawingFieldsSchema.parse({});

export function canManageDrawings(m:Member){return m.active&&(m.role==='admin'||m.role==='clerk'&&!!m.departments?.includes('engineering'));}
export function canApproveDrawings(m:Member){return m.active&&(m.role==='admin'||m.role==='clerk'&&!!m.departments?.includes('engineering_review'));}
/** A shared order scope, role title, or a matching display name never grants engineering access. */
export function assignedDrawingCustomer(m:Member,c:CustomerAccount){return m.active&&c.active&&['sales','clerk','pmc'].includes(m.role)&&
 (Array.isArray(c.salesMemberIds)&&c.salesMemberIds.includes(m.id)||Array.isArray(c.serviceMemberIds)&&c.serviceMemberIds.includes(m.id));}
export function drawingCustomers(s:State,m:Member){return (all(s,'customer_account') as CustomerAccount[]).filter(c=>canManageDrawings(m)||canApproveDrawings(m)||assignedDrawingCustomer(m,c));}
export function canReadDrawing(s:State,m:Member,r:EngineeringDrawing){if(!m.active||r.kind!=='engineering_drawing')return false;if(canManageDrawings(m))return true;const c=all(s,'customer_account').find(c=>c.id===r.customerId) as CustomerAccount|undefined;return !!c&&(canApproveDrawings(m)||assignedDrawingCustomer(m,c));}
export function canEditDrawingRequest(s:State,m:Member,r:EngineeringDrawing){if(canManageDrawings(m))return true;if(['已完成','已交接','已取消','历史待核对'].includes(r.status))return false;const c=all(s,'customer_account').find(c=>c.id===r.customerId) as CustomerAccount|undefined;return !!c&&assignedDrawingCustomer(m,c);}
export function canCreateDrawings(s:State,m:Member){return canManageDrawings(m)||drawingCustomers(s,m).some(c=>assignedDrawingCustomer(m,c));}
export function publicDrawing(s:State,m:Member,r:EngineeringDrawing){return {...r,canEdit:canEditDrawingRequest(s,m,r),canManage:canManageDrawings(m),canApprove:canApproveDrawings(m)};}
export function drawingRevision(record:EngineeringDrawing,actor:{id:string;name:string},action:string):DrawingRevision{return {id:newId('drawing_revision'),kind:'engineering_drawing_revision',recordId:record.id,customerId:record.customerId,version:record.version,action,actorId:actor.id,actor:actor.name,createdAt:record.updatedAt,snapshot:structuredClone(record)};}
export function createDrawing(fields:DrawingFields,actor:{id:string;name:string},source:DrawingSource={type:'manual'},at=now()):EngineeringDrawing{return {...fields,id:newId('drawing'),kind:'engineering_drawing',version:1,source,legacyNeedsReview:false,approvalNote:'',approvalBy:'',approvalAt:'',createdAt:at,updatedAt:at,updatedBy:actor.name,createdBy:actor.id};}

const importSourceSchema=z.object({filename:z.string().trim().min(1).max(240),sheet:z.string().trim().min(1).max(160),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const importRowSchema=drawingFieldsSchema.partial().extend({sourceRow:z.number().int().min(1).max(1000000),rawColumns:z.record(z.union([z.string().max(30000),z.number().finite()])),qualityIssues:z.array(z.string().max(500)).max(100).optional()}).strict();
export const drawingImportSchema=z.object({format:z.literal('doon-engineering-drawing-import-v1'),source:importSourceSchema,rows:z.array(importRowSchema).min(1).max(5000)}).strict().superRefine((v,ctx)=>{if(new Set(v.rows.map(r=>r.sourceRow)).size!==v.rows.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'同一工作表的来源行号不能重复'});});
export function validateDrawingImport(payload:unknown){return drawingImportSchema.parse(payload);}
/** Import identities use source hash, sheet and row; identical business rows remain distinct. */
export function buildImportedDrawings(payload:unknown,actor:{id:string;name:string},at=now()){
 const input=validateDrawingImport(payload),records:EngineeringDrawing[]=[],revisions:DrawingRevision[]=[];
 for(const row of input.rows){const {sourceRow,rawColumns,qualityIssues,...values}=row;
  const historicalComplete=clean(rawColumns['状态'])==='✅已完成'&&clean(rawColumns['老郑审批确认'])==='✅'&&!!values.completedDate;
  const fields=drawingFieldsSchema.parse({...values,status:historicalComplete?'已完成':'历史待核对',approval:historicalComplete?'通过':'待审核',assigneeId:''});
  const record=createDrawing(fields,actor,{type:'excel',filename:input.source.filename,sheet:input.source.sheet,hash:input.source.sha256,row:sourceRow,rawColumns},at);
  record.id=`drawing_import_${input.source.sha256}_${encodeURIComponent(input.source.sheet)}_${sourceRow}`;record.legacyNeedsReview=true;record.qualityIssues=qualityIssues||[];
  records.push(record);revisions.push(drawingRevision(record,actor,'导入工程历史原表（待核对）'));
 }
 return {records,revisions};
}

export function assertDrawingLifecycle(record:EngineeringDrawing){
 if(record.deadline&&record.requestedDate&&record.deadline<record.requestedDate)throw new Error('截止日期不能早于需求日期。');
 if(record.completedDate&&record.requestedDate&&record.completedDate<record.requestedDate)throw new Error('完成日期不能早于需求日期。');
 if(['待审核','已完成','已交接'].includes(record.status)&&(!record.completedDate||!record.modelNo||!record.assignee))throw new Error('送审或完成前须填写完成日期、款号和画图人员。');
 if(['已完成','已交接'].includes(record.status)&&record.approval!=='通过')throw new Error('完成前须由授权审图人员确认通过。');
 if(record.status==='已交接'&&(!record.deliveredDate||!record.downstream||!record.deliveryNote))throw new Error('交接前须填写交接日期、接收部门及交接说明。');
 if(record.deliveredDate&&record.completedDate&&record.deliveredDate<record.completedDate)throw new Error('交接日期不能早于完成日期。');
}
