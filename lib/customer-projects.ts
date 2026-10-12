import {all,clean,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {assignedServiceCustomer} from './service-workspace';
import {AppError} from './store';

export type ProjectMeta={version:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string};
export type ProjectScope={itemId:string;quantity:number};
export type CustomerProject=Entity&ProjectMeta&{kind:'customer_project';customerId:string;code:string;title:string;description:string;teamId:string;salesMemberId:string;serviceMemberId:string;serviceMemberIds?:string[];dueDate:string;status:'active'|'paused'|'cancelled'|'archived'};
export type CustomerProjectItem=Entity&ProjectMeta&{kind:'customer_project_item';projectId:string;customerId:string;model:string;customerModel:string;drawing:string;color:string;lens:string;material:string;requirements:string;quantity:number};
export type CustomerProjectRound=Entity&ProjectMeta&{kind:'customer_project_round';projectId:string;customerId:string;title:string;type:'development'|'revision'|'sales_sample'|'preproduction'|'bulk';parentRoundId:string;scope:ProjectScope[];stage:string;requiredDrawingTypes:('2d'|'3d')[];requireQuote:boolean;requiredSampleIds?:string[];sampleGateStage?:'order'|'before_production'|'not_required';sampleGateNote?:string;dueDate:string;status:'open'|'partial'|'transferred'|'cancelled';reason:string};
export type CustomerProjectTeam=Entity&ProjectMeta&{kind:'customer_project_team';name:string;leaderIds:string[];salesMemberIds:string[];serviceMemberIds:string[];customerIds:string[];active:boolean};
export type CustomerProjectCommunication=Entity&ProjectMeta&{kind:'customer_project_communication';projectId:string;customerId:string;roundId:string;channel:string;contact:string;occurredAt:string;content:string;nextAction:string;ownerId:string;dueDate:string;visibility:'internal'|'customer';attachmentIds:string[]};
export type CustomerProjectTask=Entity&ProjectMeta&{kind:'customer_project_task';projectId:string;customerId:string;roundId:string;title:string;description:string;ownerId:string;waitingFor:string;dueDate:string;status:'open'|'done'|'cancelled';result:string};
export type CustomerProjectDrawing=Entity&ProjectMeta&{kind:'customer_project_drawing';projectId:string;customerId:string;roundId:string;itemIds:string[];type:'customer'|'2d'|'3d'|'artwork'|'packing';drawingNo:string;revision:string;previousId:string;pairedDrawingId:string;attachmentIds:string[];changeNote:string;status:'submitted'|'withdrawn'};
export type CustomerProjectConfirmation=Entity&ProjectMeta&{kind:'customer_project_confirmation';projectId:string;customerId:string;roundId:string;drawingId:string;itemIds:string[];decision:'approved'|'conditional'|'rejected';contact:string;date:string;evidence:string;conditions:string;attachmentIds:string[]};
export type CustomerProjectQuoteLink=Entity&ProjectMeta&{kind:'customer_project_quote_link';projectId:string;customerId:string;roundId:string;itemIds:string[];quoteId:string;quoteVersion:number;lineIds:string[];quoteNo:string;acceptedBy:string;acceptedDate:string;evidence:string};
export type CustomerProjectSample=Entity&ProjectMeta&{kind:'customer_project_sample';projectId:string;customerId:string;roundId:string;sampleNo:string;purpose:'development'|'revision'|'color'|'sales_sample'|'preproduction';scope:ProjectScope[];drawingIds:string[];quoteLinkId:string;ownerId:string;requiredDate:string;plannedDate:string;promisedDate:string;promiseNote:string;status:'pending'|'accepted'|'making'|'qc'|'ready'|'closed'|'cancelled';note:string;paymentSnapshot:unknown;itemSnapshot:unknown[]};
export type CustomerProjectDispatch=Entity&ProjectMeta&{kind:'customer_project_dispatch';projectId:string;customerId:string;roundId:string;sampleId:string;lines:ProjectScope[];carrier:string;trackingNo:string;recipient:string;address:string;shipDate:string;receivedDate:string;note:string;attachmentIds:string[]};
export type CustomerProjectFeedback=Entity&ProjectMeta&{kind:'customer_project_feedback';projectId:string;customerId:string;roundId:string;sampleId:string;itemId:string;decision:'approved'|'conditional'|'revise'|'rejected';contact:string;date:string;evidence:string;note:string;attachmentIds:string[]};
export type CustomerProjectHandover=Entity&ProjectMeta&{kind:'customer_project_handover';projectId:string;customerId:string;roundId:string;type:'sample'|'bulk';scope:ProjectScope[];sampleId:string;orderLinks:{itemId:string;orderId:string;quantity:number;orderVersion:number}[];drawingIds:string[];quoteLinkId:string;paymentSnapshot:unknown};
export type CustomerProjectAttachment=Entity&ProjectMeta&{kind:'customer_project_attachment';projectId:string;customerId:string;roundId:string;filename:string;contentType:string;size:number;hash:string;fileKey:string;note:string};

export function projectAccess(s:State,m:Member,customerId:string){
 const customer=all(s,'customer_account').find(a=>a.id===customerId) as CustomerAccount|undefined;
 const read=!!m.active&&!!customer&&assignedServiceCustomer(s,m,customer);
 return {read,write:read&&!!customer?.active&&['admin','sales','clerk','pmc'].includes(m.role),internal:!!m.active&&['admin','pmc','production'].includes(m.role),customer};
}
/** Old projects retain their single service owner until explicitly edited. An empty array clears it. */
export function projectServiceMemberIds(project:Pick<CustomerProject,'serviceMemberId'|'serviceMemberIds'>):string[]{
 return Array.isArray(project.serviceMemberIds)?project.serviceMemberIds:project.serviceMemberId?[project.serviceMemberId]:[];
}
export function canReadProject(s:State,m:Member,record:Entity){
 const project=record.kind==='customer_project'?record:all(s,'customer_project').find(p=>p.id===record.projectId);
 return !!project&&(!record.customerId||record.customerId===project.customerId)&&projectAccess(s,m,project.customerId).read;
}
export function requireProject(s:State,m:Member,id:string,options:{write?:boolean}={}):CustomerProject{
 const project=all(s,'customer_project').find(p=>p.id===id) as CustomerProject|undefined;
 if(!project||!(options.write?projectAccess(s,m,project.customerId).write:canReadProject(s,m,project)))throw new AppError('项目不存在或不在你负责的客户范围内。',403);
 if(options.write&&project.status==='archived')throw new AppError('项目已归档，请先由管理员重新开启。',409);
 return project;
}
export function projectRound(s:State,project:CustomerProject,id:string):CustomerProjectRound{
 const round=all(s,'customer_project_round').find(r=>r.id===id&&r.projectId===project.id&&r.customerId===project.customerId) as CustomerProjectRound|undefined;
 if(!round)throw new AppError('开发轮次不存在或不属于当前项目。');return round;
}
export function internalSampleAccess(s:State,m:Member,sample:Entity){return !!m.active&&['admin','pmc','production'].includes(m.role)&&(m.role==='admin'||sample.ownerId===m.id);}
export function projectKey(value:unknown){return clean(value).toLocaleLowerCase();}
export function transferredScope(s:State,roundId:string){const quantities=new Map<string,number>();for(const h of all(s,'customer_project_handover').filter(h=>h.roundId===roundId))for(const line of h.scope||[])quantities.set(line.itemId,(quantities.get(line.itemId)||0)+line.quantity);return quantities;}
export function remainingRoundScope(s:State,round:CustomerProjectRound){const transferred=transferredScope(s,round.id);return round.scope.map(line=>({...line,quantity:line.quantity-(transferred.get(line.itemId)||0)})).filter(line=>line.quantity>0);}
export const projectRecordKinds=['customer_project','customer_project_item','customer_project_round','customer_project_team','customer_project_communication','customer_project_task','customer_project_drawing','customer_project_confirmation','customer_project_quote_link','customer_project_sample','customer_project_dispatch','customer_project_feedback','customer_project_handover','customer_project_attachment'] as const;
/** New project history is served by the dedicated scoped API, never broad order audit feeds. */
export function canReadCustomerProjectAudit(_s:State,_m:Member,entry:Entity):boolean|null{const kind=entry.after?.kind||entry.before?.kind;return typeof kind==='string'&&(kind.startsWith('customer_project')||kind==='project_charge')?false:null;}
