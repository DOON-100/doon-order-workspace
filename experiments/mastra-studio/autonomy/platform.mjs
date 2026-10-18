import {randomUUID} from 'node:crypto';
import {Store,fingerprint,problem} from './store.mjs';

// This is a validation adapter for the middle-platform API, with its own database.
// Synthetic source rows and human records never enter the original workspace DB.
export class HumanPlatform{
 constructor(file,{now=Date.now}={}){this.store=new Store(file);this.now=now;}
 source(id){const row=this.store.get('source',id);if(!row)throw problem('业务对象不存在',404);return {...row,fingerprint:fingerprint(row),remaining:row.balanceKnown?Math.max(0,row.quantity-row.received):null};}
 seedSource(row){if(!this.store.get('source',row.id))this.store.put('source',row);}
 recordReceipt(id,{received,expectedVersion}){
  return this.store.transaction(()=>{const row=this.store.get('source',id);if(!row||row.version!==expectedVersion)throw problem('来源版本已变化');if(!Number.isFinite(received)||received<0||received>row.quantity)throw problem('收货数量无效',400);return this.store.put('source',{...row,received,balanceKnown:true,version:row.version+1,updatedAt:new Date(this.now()).toISOString()});});
 }
 requestReview({taskId,caseId,recipient,sourceId,reason,proposal,deadline,taskRevision=0,category='purchase-followup',targetTaskId,targetRole,targetRevision,goal}){
  return this.store.transaction(()=>{
   const source=this.source(sourceId),evidence=Object.fromEntries(['quantity','received','balanceKnown','remaining','unit','promisedDate','sourceAsOf'].map(key=>[key,source[key]??null]));
   const payload={action:category==='coordination'?'resume-role-task':'internal-followup-plan',sourceId,sourceVersion:source.version,sourceFingerprint:source.fingerprint,evidence,reason,proposal,taskRevision,...(category==='coordination'?{targetTaskId,targetRole,targetRevision,goal}:{})};
   if(category==='coordination'&&targetRevision>=3){payload.manualOnly=true;payload.action='manual-handoff';}
   const payloadHash=fingerprint(payload),existing=this.store.list('human').find(row=>row.taskId===taskId&&row.status==='pending');
   if(existing?.payloadHash===payloadHash)return existing;
   const record={id:existing?.id||randomUUID(),taskId,caseId,recipient,sourceId,category,originRole:category==='coordination'?'supervisor':'procurement',payload,payloadHash,version:(existing?.version||0)+1,status:'pending',createdAt:existing?.createdAt||this.now(),deadline,validUntil:this.now()+1800000,escalatedAt:existing?.escalatedAt||null,decision:null,history:[...(existing?.history||[]),{action:existing?'revised':'created',at:this.now(),payloadHash}]};
   this.store.put('human',record);return record;
  });
 }
 inbox(user){return this.store.list('human').filter(row=>row.recipient===user.identity.id).map(row=>({...row,canDecide:row.status==='pending'}));}
 decide(user,input){
  const keys=['id','version','payloadHash','action','comment','requestId'];if(Object.keys(input).some(key=>!keys.includes(key)))throw problem('审核参数包含未授权字段',400);
  if(!['approve','return','reject'].includes(input.action)||typeof input.comment!=='string'||!input.comment.trim()||input.comment.length>2000||typeof input.requestId!=='string'||!input.requestId.trim()||input.requestId.length>160)throw problem('请明确选择处理结果并填写说明',400);
  return this.store.transaction(()=>{
   const row=this.store.get('human',input.id);if(!row||row.recipient!==user.identity.id)throw problem('不在本人处理范围',403);
   const key=user.identity.id+':'+input.requestId,requestHash=fingerprint(input),saved=this.store.get('decision-request',key);
   if(saved){if(saved.hash!==requestHash)throw problem('同一请求标识不能更改审核内容');return saved.result;}
   if(row.status!=='pending'||row.version!==input.version||row.payloadHash!==input.payloadHash)throw problem('审核内容已经变化，请重新读取');
   const source=this.source(row.sourceId);if(source.version!==row.payload.sourceVersion||source.fingerprint!==row.payload.sourceFingerprint)throw problem('业务来源已变化，原审核不能执行；待办仍保留');
   const decision={id:randomUUID(),actorId:user.identity.id,action:input.action,comment:input.comment.trim(),at:this.now(),payloadHash:row.payloadHash,sourceVersion:source.version};
   row.status=input.action==='approve'?'approved':input.action==='return'?'returned':'rejected';row.decision=decision;row.history.push({...decision,action:'decision:'+input.action});this.store.put('human',row);
   this.store.put('outbox',{id:decision.id,type:'human_decision',humanId:row.id,taskId:row.taskId,caseId:row.caseId,decision,delivered:false});
   const result={ok:true,id:row.id,status:row.status,decisionId:decision.id,executedBusinessWrite:false};this.store.put('decision-request',{id:key,hash:requestHash,result});return result;
  });
 }
 pendingEvents(){return this.store.list('outbox').filter(row=>!row.delivered);}
 delivered(id){const row=this.store.get('outbox',id);if(row)this.store.put('outbox',{...row,delivered:true});}
 markEscalated(id){const row=this.store.get('human',id);if(row&&row.status==='pending'&&!row.escalatedAt)this.store.put('human',{...row,escalatedAt:this.now()});}
 close(){this.store.close();}
}
