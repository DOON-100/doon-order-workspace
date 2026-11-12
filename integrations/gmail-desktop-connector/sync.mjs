import {randomUUID} from 'node:crypto';
const status=e=>Number(e?.response?.status||e?.status||0);
export class SyncEngine{
 constructor({store,gmail,bridge,now=()=>Date.now(),notify=()=>{}}){Object.assign(this,{store,gmail,bridge,now,notify});}
 async syncOne(id,{scan=null}={}){
  const prior=this.store.message(id);let item;
  try{item=await this.gmail.get(id,!prior);}catch(e){if(status(e)!==404)throw e;await this.bridge.request('missing',{id});return;}
  const result=await this.bridge.request('ingest',item);
  if(result.need_raw)await this.bridge.request('ingest',await this.gmail.get(id,true));
  this.store.remember(id,item.labelIds||[],scan);
 }
 async fullScan(){
  let scan=this.store.get('scan');
  if(!scan){scan={id:randomUUID(),baseline:(await this.gmail.profile()).historyId,pageToken:null};this.store.set('scan',scan);}
  const after=this.store.get('initialAfter');if(!Number.isInteger(after))throw Error('历史同步起点尚未配置。');
  do{
   let page;try{page=await this.gmail.list('after:'+after+' -in:drafts',scan.pageToken);}catch(e){if(status(e)===400&&scan.pageToken){scan.pageToken=null;this.store.set('scan',scan);}throw e;}
   for(const message of page.messages||[]){await this.syncOne(message.id,{scan:scan.id});await this.pulse();}
   scan.pageToken=page.nextPageToken||null;this.store.set('scan',scan);
  }while(scan.pageToken);
  // Preserve Chatwoot originals when Gmail mail disappears; never delete them.
  for(const id of this.store.missing(scan.id)){
   try{await this.syncOne(id,{scan:scan.id});}catch(e){if(status(e)!==404)throw e;}
  }
  this.store.set('historyId',scan.baseline);this.store.set('scan',null);
 }
 async incremental(){
  const start=this.store.get('historyId');let pageToken,latest=start;
  do{
   const page=await this.gmail.history(start,pageToken),ids=new Set();
   for(const event of page.history||[]){for(const key of ['messagesAdded','messagesDeleted','labelsAdded','labelsRemoved'])for(const change of event[key]||[])ids.add(change.message.id);}
   for(const id of ids){
    await this.syncOne(id);
    await this.pulse();
   }
   latest=page.historyId||latest;pageToken=page.nextPageToken;
  }while(pageToken);
  // Crash/reconnect replays the whole range until every server write is acked.
  this.store.set('historyId',latest);
 }
 async receive(){
  if(!this.store.get('historyId')||this.store.get('scan'))await this.fullScan();
  try{await this.incremental();}catch(e){if(status(e)!==404)throw e;this.store.set('historyId',null);await this.fullScan();await this.incremental();}
 }
 async work(){
  const {jobs=[]}=await this.bridge.request('claim',{});
  for(const job of jobs){
   if(job.kind==='send')await this.send(job);
   else if(job.kind==='labels'){
    try{
     for(const id of job.message_ids){try{await this.gmail.modify(id,job.add||[],job.remove||[]);}catch(e){if(status(e)!==404)throw e;}}
     await this.bridge.request('complete',{id:job.id,lease:job.lease,result:{ok:true}});
    }catch(e){await this.bridge.request('defer',{id:job.id,lease:job.lease,reason:status(e)===401?'reauthorize':'offline'});throw e;}
   }else throw Error('服务器返回未知作业类型。');
  }
 }
 async send(job){
  let attempt=this.store.attempt(job.id);
  if(attempt?.state==='sent'){await this.bridge.request('complete',{id:job.id,lease:job.lease,result:attempt.result});return;}
  // Sending is non-idempotent. Persist intent BEFORE calling Gmail. A crash,
  // timeout or server error cannot trigger a second blind send.
  if(attempt?.state==='sending'||attempt?.state==='uncertain'){
   const found=await this.gmail.searchSent(job.rfc_message_id);
   if(found.messages?.length===1){const result=await this.gmail.get(found.messages[0].id,false);this.store.recordAttempt(job.id,'sent',result);await this.bridge.request('complete',{id:job.id,lease:job.lease,result});return;}
   this.store.recordAttempt(job.id,'uncertain');
   await this.bridge.request('uncertain',{id:job.id,lease:job.lease,reason:'sent-result-unknown'});return;
  }
  this.store.recordAttempt(job.id,'sending');
  let result;
  try{result=await this.gmail.send(job.raw,job.thread_id);}
  catch(e){
   const code=status(e);
   if([400,401,403,404,429].includes(code)){
    this.store.recordAttempt(job.id,'rejected');
    await this.bridge.request('defer',{id:job.id,lease:job.lease,reason:code===401?'reauthorize':'gmail-rejected',permanent:[400,403,404].includes(code)});
   }else{
    this.store.recordAttempt(job.id,'uncertain');
    await this.bridge.request('uncertain',{id:job.id,lease:job.lease,reason:'sent-result-unknown'});
   }
   throw e;
  }
  this.store.recordAttempt(job.id,'sent',result);
  await this.bridge.request('complete',{id:job.id,lease:job.lease,result});
 }
 async pulse(){if(!this.lastPulse||this.now()-this.lastPulse>20000){this.lastPulse=this.now();await this.bridge.request('heartbeat',{time:this.now()});await this.work();}}
 async tick(){await this.pulse();await this.work();await this.receive();await this.bridge.request('heartbeat',{time:this.now(),synced:true});}
}
