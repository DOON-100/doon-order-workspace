import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProcessChangeHarness} from './helpers/process-change-harness.mjs';
const h=await createProcessChangeHarness();
const basis={sources:[{field:'title',reference:'SYN user request',location:'SYN conversation 1'}],unknowns:[],conflicts:[]};
async function ok(action,body,who){const response=await h.request(action,body,who),result=await response.json();assert(response.ok,JSON.stringify(result));return result;}
async function reject(action,body,status,who,origin){const before=h.rows(),response=await h.request(action,body,who,origin);assert.equal(response.status,status,await response.text());assert.deepEqual(h.rows(),before);}
try{
 const capabilities=await ok('process-change-contract'),rulesVersion=capabilities.rulesVersion;
 const preview=async(payload={type:'iqc',orderId:'SYN-O',title:'SYN inspection'},extra={})=>ok('process-change-preview',{requestId:randomUUID(),rulesVersion,payload,basis,...extra});
 const get=id=>ok('process-change?id='+id),confirm=row=>({id:row.id,digest:row.digest,approved:true});
 const initial=h.rows(),initialIds=new Set(initial.map(row=>row.id));
 for(const type of capabilities.types){
  const row=await get((await preview({type,orderId:'SYN-O',title:'SYN '+type})).id);
  assert.equal(row.payload.type,type);assert.equal(row.status,'pending');
 }
 assert.equal(h.rows().filter(row=>row.kind==='process_record').length,0);
 assert.deepEqual(h.rows().filter(row=>initialIds.has(row.id)),initial);
 const first=await get((await preview()).id);
 await reject('process-change-preview',{requestId:randomUUID(),rulesVersion:'0'.repeat(64),payload:first.payload,basis},409);
 await reject('process-change-confirm',{...confirm(first),approved:false},400);
 await reject('process-change-confirm',{...confirm(first),digest:'0'.repeat(64)},409);
 await reject('process-change-confirm',confirm(first),403,h.other);
 await reject('process-change?id='+first.id,undefined,403,h.other);
 await reject('process-change-confirm',confirm(first),403,h.admin,'https://cross-site.invalid');
 await reject('process-change-confirm',confirm(first),403,h.admin,'');
 await reject('process-change-confirm',confirm(first),401,null);
 await reject('process-change-preview',{requestId:randomUUID(),rulesVersion,payload:first.payload,basis,actorId:h.admin.id},400);
 const result=await ok('process-change-confirm',confirm(first));
 assert.equal(result.executed,true);assert.equal(result.receipt.version,1);
 const saved=h.rows(),replay=await ok('process-change-confirm',confirm(first));assert(replay.idempotent);assert.deepEqual(h.rows(),saved);
 const readback=await get(first.id);assert.equal(readback.currentRecord.id,result.receipt.recordId);assert.equal(readback.currentRecord.version,1);
 const original=readback.currentRecord,payload={...first.payload,id:original.id,version:original.version,notes:'SYN updated'};
 const update=await get((await preview(payload)).id),source=h.rows().find(row=>row.id==='SYN-O');
 h.put({...source,version:2});
 await reject('process-change-confirm',confirm(update),409);h.put(source);
 h.put({...h.admin,active:false});await reject('process-change-confirm',confirm(update),403);h.put(h.admin);
 h.put({...h.admin,role:'viewer'});await reject('process-change-confirm',confirm(update),403);h.put(h.admin);
 await reject('process-change-preview',{requestId:randomUUID(),rulesVersion,payload:{...payload,orderId:'SYN-MISSING'},basis},403);
 const beforeFault=h.rows();h.failTransaction();await reject('process-change-confirm',confirm(update),500);assert.deepEqual(h.rows(),beforeFault);
 const changed=await ok('process-change-confirm',confirm(update));assert.equal(changed.receipt.version,2);assert.equal(changed.currentRecord.notes,'SYN updated');
 await reject('process-change-preview',{requestId:randomUUID(),rulesVersion,payload,basis},409);
 const cancelled=await get((await preview()).id);await ok('process-change-cancel',{id:cancelled.id,digest:cancelled.digest});
 await reject('process-change-confirm',confirm(cancelled),409);
 const unresolved=await get((await preview(undefined,{basis:{...basis,unknowns:['SYN unresolved']}})).id);
 await reject('process-change-confirm',confirm(unresolved),409);
 const conflicted=await get((await preview(undefined,{basis:{...basis,conflicts:['SYN conflicting quantities']}})).id);
 await reject('process-change-confirm',confirm(conflicted),409);
 const expired=await get((await preview()).id),realNow=Date.now;
 try{Date.now=()=>realNow()+1800001;await reject('process-change-confirm',confirm(expired),409);}finally{Date.now=realNow;}
 const requestId=randomUUID(),input={requestId,rulesVersion,payload:{type:'warehouse',orderId:'SYN-O',title:'SYN recover'},basis};
 const created=await ok('process-change-preview',input),beforeRetry=h.rows();await ok('process-change-preview',input);assert.deepEqual(h.rows(),beforeRetry);
 await reject('process-change-preview',{...input,payload:{...input.payload,title:'SYN forged change'}},409);
 const race=await get(created.id),results=await Promise.all([h.request('process-change-confirm',confirm(race)),h.request('process-change-confirm',confirm(race))]);
 assert(results.every(res=>[200,409].includes(res.status)));assert(results.some(res=>res.status===200));
 const recovered=await get(race.id);assert.equal(recovered.status,'confirmed');assert.equal(h.rows().filter(row=>row.kind==='process_record'&&row.title==='SYN recover').length,1);
 const corrupt=await get((await preview()).id),stored=h.rows().find(row=>row.requestId===corrupt.id);h.put({...stored,payload:{...stored.payload,title:'SYN corrupted'}});
 await reject('process-change-confirm',confirm(corrupt),409);
 const completed=h.rows().find(row=>row.requestId===first.id);
 h.put({...completed,receipt:{...completed.receipt,version:999}});
 await reject('process-change?id='+first.id,undefined,409);
 await reject('process-change-confirm',confirm(first),409);
 h.put(completed);
 assert.deepEqual(h.rows().filter(row=>initialIds.has(row.id)),initial);assert.deepEqual(h.files.get('SYN-ORIGINAL'),new Uint8Array([1,2,3]));
 assert.equal(h.rows().filter(row=>row.kind==='process_change_audit').length,3);
 console.log('PASS process change: 14 types, real API authorization, same-origin, binding, expiry, source changes, transaction rollback, concurrency, readback, replay and original preservation');
}finally{await h.close();}
