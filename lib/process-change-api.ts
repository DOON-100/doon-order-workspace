import {strictDate,type State,type Member} from './domain';
import {AppError} from './store';
import {buildProcessSave} from './process-workspace-api';
import {processSaveSchema,processDetailsSchema,processKinds,processKindLabels,processDetailFields,assertProcessCompletion,canEditProcessRecord,type ProcessFields,type ProcessKind} from './process-workspace';
import {createConfirmedChangeApi,changeHash,schemaSignature} from './confirmed-change';
const api=createConfirmedChangeApi({
 prefix:'process-change',kind:'process_change',protocol:'doon-process-change-v1',payloadSchema:processSaveSchema.omit({token:true}).strict(),types:processKinds,
 rules:()=>changeHash({schema:schemaSignature(processSaveSchema),details:processKinds.map(type=>schemaSignature(processDetailsSchema(type))),code:[String(strictDate),String(processDetailsSchema),String(assertProcessCompletion),String(buildProcessSave),String(canEditProcessRecord)]}),
 authorize(s,m,payload){if(!m.active||!canEditProcessRecord(s,m,payload as ProcessFields))throw new AppError('当前身份没有这条流程记录的维护权限。',403);},
 sources(s,m,payload){const ids=new Set([payload.id,payload.customerId,payload.orderId,payload.teamId,payload.ownerId,payload.responsibleId,payload.nextOwnerId,m.id].filter(Boolean));return s.records.filter(row=>ids.has(row.id)).sort((a,b)=>a.id.localeCompare(b.id));},
 async build(req,s,m,payload,requestId){const plan=await buildProcessSave(req,s,m,{...payload,...(requestId?{token:'process-change:'+requestId}:{})},'人工确认流程变更');return {...plan,payload:{...plan.fields,...(plan.before?{id:plan.before.id,version:plan.before.version}:{})}};},
 describe(payload){return {label:processKindLabels[payload.type as ProcessKind],detailFields:processDetailFields[payload.type as ProcessKind]};},
});
export const processChangeRules=api.rules;
export async function processChangeGet(action:string,req:Request,s:State,m:Member){if(!['process-change-contract','process-change'].includes(action))return null;return api.get(action,req,s,m);}
export async function processChangePost(action:string,req:Request,s:State,m:Member){if(!['process-change-preview','process-change-confirm','process-change-cancel'].includes(action))return null;return api.post(action,req,s,m);}
