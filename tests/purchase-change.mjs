import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProcessChangeHarness} from './helpers/process-change-harness.mjs';
import {seedPurchase} from './helpers/purchase-change-fixture.mjs';
const h=await createProcessChangeHarness(),original=seedPurchase(h),initial=h.rows().filter(row=>row.id!==original.id);
const basis={sources:[{field:'quantity',reference:'SYN delivery evidence',location:'SYN document row 4'}],unknowns:[],conflicts:[]};
const read=()=>h.rows().find(row=>row.id===original.id);
async function ok(action,body,who){const response=await h.request(action,body,who);const result=await response.json();assert(response.ok,JSON.stringify(result));return result;}
async function reject(action,body,status,who,origin){const before=h.rows(),response=await h.request(action,body,who,origin);assert.equal(response.status,status,await response.text());assert.deepEqual(h.rows(),before);}
try{
 const {rulesVersion,types}=await ok('purchase-change-contract');assert.equal(types.length,5);
 const payload=(operation,extra={})=>({operation,id:original.id,version:read().version,...(operation==='followup'?{fields:{followupNote:'SYN followup',expectedDate:'2026-10-28'}}:operation==='archive'?{date:'2026-10-20',note:'SYN complete'}:{quantity:10,date:'2026-10-20',reference:'SYN-'+randomUUID(),note:'SYN actual document'}),...extra});
 const preview=async(p,extra={})=>{const before=read();const row=await ok('purchase-change-preview',{requestId:randomUUID(),rulesVersion,payload:p,basis,...extra});assert.deepEqual(read(),before);return ok('purchase-change?id='+row.id);};
 const confirm=row=>({id:row.id,digest:row.digest,approved:true});
 const first=await preview(payload('followup'));assert.equal(first.effects.after.expectedDate,'2026-10-28');assert.equal(first.effects.before.expectedDate,'');
 await reject('purchase-change-confirm',confirm(first),403,h.other);
 await reject('purchase-change?id='+first.id,undefined,403,h.other);
 await reject('purchase-change-confirm',confirm(first),401,null);
 await reject('purchase-change-confirm',confirm(first),403,h.admin,'https://cross.invalid');
 await reject('purchase-change-confirm',{...confirm(first),approved:false},400);
 await reject('purchase-change-confirm',{...confirm(first),digest:'0'.repeat(64)},409);
 await reject('process-change-confirm',confirm(first),403);
 const saved=await ok('purchase-change-confirm',confirm(first));assert.equal(saved.receipt.version,2);
 const beforeReplay=h.rows();assert((await ok('purchase-change-confirm',confirm(first))).idempotent);assert.deepEqual(h.rows(),beforeReplay);
 const eventRowsBefore=h.rows().filter(row=>row.kind==='purchase_event').length;
 const receipt=await preview(payload('receipt',{quantity:30}));assert.equal(receipt.effects.after.received,50);
 const faultBefore=h.rows();h.failTransaction();await reject('purchase-change-confirm',confirm(receipt),500);assert.deepEqual(h.rows(),faultBefore);
 await ok('purchase-change-confirm',confirm(receipt));assert.equal(read().received,50);
 const returned=await preview(payload('return'));await ok('purchase-change-confirm',confirm(returned));assert.equal(read().received,40);assert.equal(read().returnPending,10);
 const invalid=async(p,status=400,extra={})=>reject('purchase-change-preview',{requestId:randomUUID(),rulesVersion,payload:p,basis,...extra},status);
 await invalid(payload('replacement',{quantity:11}));
 await invalid(payload('receipt',{quantity:51}));
 await invalid(payload('archive'));
 await invalid(payload('receipt',{quantity:0}));
 await invalid(payload('receipt',{quantity:0.00001}));
 await invalid(payload('receipt',{date:'2026-02-30'}));
 await invalid(payload('followup',{fields:{supplier:'SYN forged'}}));
 await invalid({...payload('receipt'),token:randomUUID()});
 await invalid({...payload('receipt'),actorId:h.other.id});
 await invalid({...payload('receipt'),operation:'opening'});
 await invalid(payload('receipt'),409,{rulesVersion:'0'.repeat(64)});
 const replacement=await preview(payload('replacement'));await ok('purchase-change-confirm',confirm(replacement));assert.equal(read().received,50);assert.equal(read().returnPending,0);
 const rest=await preview(payload('receipt',{quantity:50}));await ok('purchase-change-confirm',confirm(rest));
 const archive=await preview(payload('archive'));assert.equal(archive.effects.after.lifecycle,'archived');await ok('purchase-change-confirm',confirm(archive));
 await invalid(payload('followup'),409);await invalid(payload('receipt'));await invalid(payload('archive'));
 const archivedReturn=await preview(payload('return',{quantity:5}));assert.equal(archivedReturn.effects.after.lifecycle,'active');await ok('purchase-change-confirm',confirm(archivedReturn));assert.equal(read().returnPending,5);
 const stale=await preview(payload('followup')),old=read();h.put({...old,sourceVersion:2,sourceHash:'SYN newer import'});await reject('purchase-change-confirm',confirm(stale),409);h.put(old);
 h.put({...h.admin,role:'viewer'});await reject('purchase-change-confirm',confirm(stale),403);h.put(h.admin);
 h.put({...h.admin,active:false});await reject('purchase-change-confirm',confirm(stale),403);h.put(h.admin);
 await invalid(payload('followup',{version:1}),409);
 const canceled=await preview(payload('followup'));await ok('purchase-change-cancel',{id:canceled.id,digest:canceled.digest});await reject('purchase-change-confirm',confirm(canceled),409);
 const unknown=await preview(payload('followup'),{basis:{...basis,unknowns:['SYN unknown']}});await reject('purchase-change-confirm',confirm(unknown),409);
 const conflict=await preview(payload('followup'),{basis:{...basis,conflicts:['SYN conflict']}});await reject('purchase-change-confirm',confirm(conflict),409);
 const expired=await preview(payload('followup')),realNow=Date.now;try{Date.now=()=>realNow()+1800001;await reject('purchase-change-confirm',confirm(expired),409);}finally{Date.now=realNow;}
 for(const patch of [{balanceKnown:false},{auditStatus:'未审核'},{closeStatus:'手动关闭'}]){h.put({...old,...patch});await invalid(payload('receipt'));h.put(old);}
 const duplicate=await preview(payload('replacement',{quantity:5}));
 const results=await Promise.all([h.request('purchase-change-confirm',confirm(duplicate)),h.request('purchase-change-confirm',confirm(duplicate))]);assert(results.some(row=>row.status===200));assert(results.every(row=>[200,409].includes(row.status)));
 assert.equal(read().received,100);assert.equal(read().returnPending,0);
 const native=h.rows().find(row=>row.kind==='purchase_event'&&row.token===receipt.id);
 const nativeInput={id:native.purchaseId,version:native.version,type:native.type,quantity:native.quantity,date:native.date,reference:native.reference,note:native.note,token:native.token};
 await ok('purchase-receipt',nativeInput);
 await reject('purchase-receipt',{...nativeInput,quantity:1},409);
 await reject('purchase-receipt',nativeInput,409,h.other);
 // Original columns, imports and unrelated records/files remain byte-equivalent.
 for(const key of ['id','po','supplier','buyer','itemCode','itemName','unit','quantity','customerOrder','raw','sourceRow','sourceFile','sourceHash','sourceVersion','sourceNote'])assert.deepEqual(read()[key],original[key]);
 assert.deepEqual(h.rows().filter(row=>initial.some(before=>before.id===row.id)),initial);
 assert.deepEqual(h.files.get('SYN-ORIGINAL'),new Uint8Array([1,2,3]));
 assert.equal(h.rows().filter(row=>row.kind==='purchase_event').length-eventRowsBefore,6);
 const legacy=seedPurchase(h,'SYN-LEGACY',{balanceKnown:false,received:0});
 const opening={id:legacy.id,version:1,type:'opening',quantity:20,returnPending:5,date:'2026/10/20',reference:'SYN legacy base',note:'SYN opening evidence',token:randomUUID()};
 await ok('purchase-receipt',opening);const beforeLegacyReplay=h.rows();await ok('purchase-receipt',opening);assert.deepEqual(h.rows(),beforeLegacyReplay);
 const {returnPending,...omitted}=opening;await reject('purchase-receipt',omitted,409);
 console.log('PASS purchase confirmation: five actions, native quantities/history, immutable source, roles, preview/confirm binding, concurrency, rollback, replay and lost-response recovery');
}finally{await h.close();}
