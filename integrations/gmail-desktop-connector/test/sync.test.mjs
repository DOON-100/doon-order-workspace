import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../store.mjs';
import {SyncEngine} from '../sync.mjs';
const error=code=>Object.assign(Error('synthetic failure'),{response:{status:code}});
async function fixture(fn){const directory=await mkdtemp(path.join(os.tmpdir(),'doon-gmail-synthetic-'));const store=await new Store(directory,async v=>v).open();try{store.set('initialAfter',1000);await fn(store);}finally{store.close();await rm(directory,{recursive:true,force:true});}}
test('initial scan checkpoints only after acknowledged imports, never changes Gmail labels',()=>fixture(async store=>{
 const imported=[],modified=[];let rejected=true;
 const gmail={profile:async()=>({historyId:'10'}),list:async()=>({messages:[{id:'a'},{id:'b'}]}),get:async id=>({id,threadId:'c',raw:'synthetic',labelIds:['INBOX','UNREAD']}),modify:async(...a)=>modified.push(a),history:async()=>({historyId:'11'})};
 const bridge={request:async(k,data)=>{if(k==='ingest'){if(data.id==='b'&&rejected)throw Error('offline');imported.push(data.id);}return {};}};
 const engine=new SyncEngine({store,gmail,bridge});await assert.rejects(engine.receive());assert.equal(store.get('historyId'),null);assert.ok(store.get('scan'));
 rejected=false;await engine.receive();assert.deepEqual(imported,['a','a','b']);assert.equal(store.get('historyId'),'11');assert.equal(store.get('scan'),null);assert.deepEqual(modified,[]);
}));
test('expired history rescans the fixed original range and preserves originals',()=>fixture(async store=>{
 store.set('historyId','1');store.remember('a',['UNREAD']);let first=true,query;const calls=[];
 const gmail={profile:async()=>({historyId:'20'}),history:async()=>{if(first){first=false;throw error(404);}return {historyId:'21'};},list:async q=>{query=q;return {messages:[]};},get:async()=>{throw error(404);}};
 const engine=new SyncEngine({store,gmail,bridge:{request:async(k,d)=>{calls.push([k,d]);return {};}}});await engine.receive();assert.match(query,/after:1000/);assert.equal(store.get('historyId'),'21');assert.equal(calls.filter(([k])=>k==='missing').length,1);assert.ok(store.message('a'));
}));
test('history pagination failure replays safely without advancing cursor',()=>fixture(async store=>{
 store.set('historyId','10');let fail=true;const imported=[];
 const gmail={history:async(_,page)=>{if(page&&fail)throw Error('offline');return page?{historyId:'20'}:{history:[{messagesAdded:[{message:{id:'a'}}]}],historyId:'20',nextPageToken:'p2'};},get:async id=>({id,threadId:'a',raw:'synthetic',labelIds:[]})};
 const engine=new SyncEngine({store,gmail,bridge:{request:async(k,d)=>{if(k==='ingest')imported.push(d.id);return {};}}});await assert.rejects(engine.receive());assert.equal(store.get('historyId'),'10');fail=false;await engine.receive();assert.equal(store.get('historyId'),'20');assert.deepEqual(imported,['a','a']);
}));
test('Gmail timeout is reconciled from Sent, never blindly resent',()=>fixture(async store=>{
 let sends=0;const completed=[];const job={id:'synthetic-job',lease:'l',raw:'synthetic',rfc_message_id:'<synthetic@test.invalid>'};
 const gmail={send:async()=>{sends++;throw Error('timeout');},searchSent:async()=>({messages:[{id:'a'}]}),get:async()=>({id:'a',threadId:'b'})};
 const engine=new SyncEngine({store,gmail,bridge:{request:async(k,d)=>{completed.push([k,d]);return {};}}});await assert.rejects(engine.send(job));assert.equal(store.attempt(job.id).state,'uncertain');await engine.send(job);assert.equal(sends,1);assert.equal(store.attempt(job.id).state,'sent');assert.equal(completed.at(-1)[0],'complete');
}));
test('loss of Chatwoot send acknowledgement cannot duplicate email',()=>fixture(async store=>{
 let sends=0,fail=true;const job={id:'job',lease:'l',raw:'synthetic',rfc_message_id:'<synthetic@test.invalid>'};
 const engine=new SyncEngine({store,gmail:{send:async()=>{sends++;return {id:'a',threadId:'b'};}},bridge:{request:async()=>{if(fail)throw Error('lost ack');return {};}}});await assert.rejects(engine.send(job));assert.equal(store.attempt('job').state,'sent');fail=false;await engine.send(job);assert.equal(sends,1);
}));
test('unknown send outcome stays uncertain when Sent is not yet indexed',()=>fixture(async store=>{
 store.recordAttempt('job','sending');let sends=0;const calls=[];
 const engine=new SyncEngine({store,gmail:{send:async()=>sends++,searchSent:async()=>({messages:[]})},bridge:{request:async(k)=>{calls.push(k);return {};}}});await engine.send({id:'job',lease:'l',rfc_message_id:'<synthetic@test.invalid>'});assert.equal(sends,0);assert.equal(store.attempt('job').state,'uncertain');assert.deepEqual(calls,['uncertain']);
}));
test('offline read/archive actions keep the exact snapshot, including safe replay',()=>fixture(async store=>{
 const operations=[],acks=[];let fail=true;
 const job={id:'j',lease:'l',kind:'labels',message_ids:['a','b'],add:[],remove:['INBOX','UNREAD']};
 const engine=new SyncEngine({store,gmail:{modify:async(...args)=>{operations.push(args);if(args[0]==='b'&&fail)throw Error('offline');}},bridge:{request:async(k,d)=>{if(k==='claim')return {jobs:[job]};acks.push([k,d]);return {};}}});await assert.rejects(engine.work());assert.equal(acks[0][0],'defer');fail=false;await engine.work();assert.equal(acks.at(-1)[0],'complete');assert.deepEqual(operations.map(a=>a[0]),['a','b','a','b']);assert.ok(operations.every(a=>a[2].includes('INBOX')&&a[2].includes('UNREAD')));
}));
test('server requests raw MIME again after local metadata-only cache',()=>fixture(async store=>{
 store.remember('a',[]);const formats=[];let calls=0;
 const engine=new SyncEngine({store,gmail:{get:async(id,raw)=>{formats.push(raw);return {id,threadId:'a',...(raw?{raw:'synthetic'}:{})};}},bridge:{request:async()=>({need_raw:++calls===1})}});await engine.syncOne('a');assert.deepEqual(formats,[false,true]);
}));
