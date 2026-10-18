import {Store,fingerprint,problem} from './store.mjs';

// The worker has only an API projection/cache. It never opens the workbench DB.
export class PlatformClient{
 constructor(file,{origin,token,now=Date.now,fetchImpl=fetch}){
  const url=new URL(origin);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw problem('中台地址须为HTTPS或本机回环Origin',400);
  this.store=new Store(file);Object.assign(this,{origin:url.origin,token,now,fetchImpl});this.remote=true;
 }
 async call(action,input){const response=await this.fetchImpl(this.origin+'/api/agent-platform/service/'+action,{method:'POST',headers:{Origin:this.origin,Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw problem('中台接口拒绝或暂不可用：'+response.status,response.status);return response.json();}
 isAuthorised(id){return this.store.get('binding',id)?.authorised===true;}
 source(id){if(!this.isAuthorised(id))throw problem('业务范围已撤回，任务等待重新配置',403);const row=this.store.get('source',id);if(!row)throw problem('尚未取得当前业务证据',503);return row;}
 async refresh(){if(this.inflight)return this.inflight;this.inflight=this.refreshOnce();try{return await this.inflight;}finally{this.inflight=null;}}
 async refreshOnce(){
  let data=await this.call('poll',{ack:[]});const allowedSourceIds=new Set(data.bindings.map(row=>row.sourceId));
  const acks=this.store.list('remote-ack').filter(row=>!row.sent&&allowedSourceIds.has(this.store.get('remote-event',row.id)?.sourceId)).slice(0,100);
  if(acks.length)data=await this.call('poll',{ack:acks.map(row=>row.id)});
  for(const row of acks)this.store.put('remote-ack',{...row,sent:true});
  const allowed=new Set(data.bindings.map(row=>row.sourceId));for(const row of this.store.list('binding'))if(!allowed.has(row.id))this.store.put('binding',{...row,authorised:false});
  for(const row of data.bindings)this.store.put('binding',{...row,bindingId:row.id,id:row.sourceId,authorised:true});
  for(const row of data.sources)this.store.put('source',row);
  for(const row of data.humans)this.store.put('human',row);
  for(const row of data.events)if(!this.store.get('remote-ack',row.id))this.store.put('remote-event',row);
  for(const action of this.store.list('pending-action').filter(row=>!row.sent&&allowedSourceIds.has(this.store.get('human',row.humanId)?.sourceId))){await this.call('escalated',{humanId:action.humanId});this.store.put('pending-action',{...action,sent:true});}
 }
 pendingEvents(){return this.store.list('remote-event').filter(row=>this.isAuthorised(row.sourceId)&&!this.store.get('remote-ack',row.id));}
 delivered(id){this.store.put('remote-ack',{id,sent:false});}
 markEscalated(id){const row=this.store.get('human',id);if(row?.status==='pending'&&!row.escalatedAt){this.store.put('human',{...row,escalatedAt:this.now()});this.store.put('pending-action',{id:'escalate:'+id,humanId:id,sent:false});}}
 async prepareReview(request){
  await this.refresh();const source=this.source(request.sourceId),route=this.store.get('binding',source.id),category=request.category||'purchase-followup',revision=request.taskRevision||0;
  if(request.expectedFingerprint&&request.expectedFingerprint!==source.fingerprint)throw problem('形成方案期间来源已变化，需要重新读取');
  const existing=this.store.list('human').find(row=>row.taskId===request.taskId&&row.category===category&&row.payload.taskRevision===revision&&row.payload.sourceFingerprint===source.fingerprint&&row.payload.bindingVersion===route.version&&row.validUntil>this.now()&&(category!=='coordination'||row.payload.targetRevision===request.targetRevision));
  if(existing)return existing;
  const previous=this.store.list('human').filter(row=>row.taskId===request.taskId).at(-1);
  const input={requestId:fingerprint([request.taskId,revision,source.fingerprint,route.version,previous?.version||0,previous?.status||'new',request.targetRevision??null]),sourceId:source.id,sourceVersion:source.version,sourceFingerprint:source.fingerprint,bindingVersion:route.version,taskId:request.taskId,caseId:request.caseId,taskRevision:revision,category,reason:request.reason,proposal:request.proposal,deadline:request.deadline,...(category==='coordination'?{targetTaskId:request.targetTaskId,targetRole:request.targetRole,targetRevision:request.targetRevision,goal:request.goal}:{})};
  const row=await this.call('review',input);this.store.put('human',row);return row;
 }
 requestReview(){throw problem('人工请求必须先通过中台审核接口',403);}
 async authorizeCompletion(task,context){
  const humanId=task.role==='procurement'?task.humanId:context.children.findLast(row=>row.result?.fulfilled)?.result?.humanId,approved=this.store.get('human',humanId);
  if(!approved?.decision)throw problem('尚未取得人工确认记录');
  const receipt=await this.call('verify',{humanId:approved.id,decisionId:approved.decision.id,payloadHash:approved.payloadHash,taskId:approved.taskId,purpose:'complete'});this.store.put('source',receipt.source);return receipt;
 }
 async authorizeResume(task){
  const approved=this.store.get('human',task.humanId);if(!approved?.decision)throw problem('尚未取得协调确认记录');
  const receipt=await this.call('verify',{humanId:approved.id,decisionId:approved.decision.id,payloadHash:approved.payloadHash,taskId:task.id,purpose:'resume'});this.store.put('source',receipt.source);return receipt;
 }
 close(){this.store.close();}
}
