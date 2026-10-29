// Synthetic database only; no running service, production files or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

await fs.mkdir('test-output',{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/native-snapshot-'));
process.env.DOON_DATA_DIR=path.join(dir,'data');
const runtime=await import(pathToFileURL(path.resolve('standalone/runtime.mjs')).href);
const {db}=runtime,env=runtime.env,read=env.DB.readSnapshot;
globalThis.__snapshotTestEnv=env;
await build({entryPoints:['lib/store.ts','lib/domain.ts'],outdir:path.join(dir,'build'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-snapshot-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},args=>({path:args.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__snapshotTestEnv;':'export async function getChatGPTUser(){return {userId:"synthetic-user"}}'}));
}}]});
const store=await import(pathToFileURL(path.join(dir,'build/store.js')).href);
const domain=await import(pathToFileURL(path.join(dir,'build/domain.js')).href);
const put=(id,kind,data,rowid)=>db.prepare('INSERT INTO records(rowid,id,kind,data) VALUES(?,?,?,?)').run(rowid,id,kind,JSON.stringify({id,kind,...data}));
const bump=()=>db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
const rows=()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data));
try{
 put('member','member',{userId:'synthetic-user',active:true,role:'admin'},-10n);
 put('zero','synthetic',{value:0},0n);
 for(let i=1;i<=140;i++)put('row-'+i,'synthetic',{original:'unchanged-'+i},BigInt(i));
 put('largest-rowid','synthetic',{original:'preserve 64 bit rowid'},9223372036854775807n);
 const before=db.prepare('SELECT CAST(rowid AS TEXT) rowid,id,kind,data FROM records ORDER BY rowid').all();
 assert.deepEqual((await store.snapshot()).records,rows());
 assert.deepEqual((await store.snapshot(['member'])).records,[rows()[0]]);
 assert.deepEqual((await store.snapshot([])).records,[]);
 assert.deepEqual(db.prepare('SELECT CAST(rowid AS TEXT) rowid,id,kind,data FROM records ORDER BY rowid').all(),before);
 console.log('PASS Complete snapshots preserve ordering, bytes, negative/zero/full 64-bit rowids and explicit member-only reads.');
 const prepare=db.prepare;let bulkStarts=0;
 db.prepare=function(sql){if(sql.startsWith('SELECT CAST(rowid AS TEXT) AS cursor,data FROM records ORDER BY rowid'))bulkStarts++;return prepare.call(this,sql);};
 try{
  let completed=0;
  const pending=Array.from({length:20},()=>read().then(value=>{completed++;assert.deepEqual(value,rows());}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(bulkStarts,2,'Only two bulk snapshots may start while others wait');
  const members=await read(['member']);assert.equal(members.length,1);assert.equal(completed,0,'Member-only reads must bypass the bulk queue');
  await Promise.all(pending);assert.equal(bulkStarts,20);
 }finally{db.prepare=prepare;}
 db.prepare("INSERT INTO records(id,kind,data) VALUES('malformed-synthetic','synthetic','{')").run();
 const rejected=await Promise.allSettled(Array.from({length:5},()=>read()));assert(rejected.every(value=>value.status==='rejected'));
 db.prepare("DELETE FROM records WHERE id='malformed-synthetic'").run();assert.deepEqual(await read(),rows());
 console.log('PASS Twenty bulk readers are limited to two, members bypass their queue, and failed reads release all permits.');
 let attempts=0;
 env.DB.readSnapshot=async kinds=>{
  attempts++;const pending=read(kinds);
  if(attempts===1)setImmediate(()=>{
   db.prepare("UPDATE records SET data=json_set(data,'$.original','changed between batches') WHERE id='row-1'").run();
   db.prepare("DELETE FROM records WHERE id='row-120'").run();
   put('inserted-behind-cursor','synthetic',{original:'new negative rowid'},-5n);bump();
  });
  return pending;
 };
 const changed=await store.snapshot();assert.equal(attempts,2);assert.deepEqual(changed.records,rows());
 assert.equal(changed.revision,1);
 await assert.rejects(()=>store.commit(0,[{id:'forbidden-stale-write',kind:'synthetic'}]),error=>error.status===409);
 assert.equal(db.prepare("SELECT id FROM records WHERE id='forbidden-stale-write'").get(),undefined);
 env.DB.readSnapshot=async kinds=>{attempts++;const pending=read(kinds);setImmediate(bump);return pending;};
 attempts=0;await assert.rejects(()=>store.snapshot(),error=>error.status===409);assert.equal(attempts,3);
 console.log('PASS Cross-batch revision changes retry the read only, exhaust after three attempts and retain stale-write CAS refusal.');
 attempts=0;
 env.DB.readSnapshot=async kinds=>{attempts++;const pending=read(kinds);if(attempts===1)setImmediate(()=>{db.prepare("UPDATE records SET data=json_set(data,'$.active',json('false')) WHERE id='member'").run();bump();});return pending;};
 await assert.rejects(async()=>store.actor(await store.snapshot()),error=>error.status===403);assert.equal(attempts,2);
 env.DB.readSnapshot=read;
 const native=await store.snapshot();delete env.DB.readSnapshot;
 assert.deepEqual(await store.snapshot(),native);
 assert.deepEqual((await store.snapshot(['member'])).records,native.records.filter(row=>row.kind==='member'));
 env.DB.readSnapshot=read;
 console.log('PASS Mid-read revocation is enforced; the unchanged D1-style fallback returns the same full snapshot.');
 const occupied=[read(),read()];let queuedAttempts=0;
 env.DB.readSnapshot=kinds=>{queuedAttempts++;return read(kinds);};
 const queued=store.snapshot();
 setImmediate(()=>{db.prepare("UPDATE records SET data=json_set(data,'$.original','changed while queued') WHERE id='row-1'").run();bump();});
 const queuedSnapshot=await queued;await Promise.all(occupied);env.DB.readSnapshot=read;
 assert.equal(queuedAttempts,2);assert.deepEqual(queuedSnapshot.records,rows());
 await assert.rejects(()=>store.commit(queuedSnapshot.revision-1,[{id:'forbidden-queued-write',kind:'synthetic'}]),error=>error.status===409);
 assert.equal(db.prepare("SELECT id FROM records WHERE id='forbidden-queued-write'").get(),undefined);
 console.log('PASS A queued snapshot revalidates concurrent changes after admission and still rejects stale writes.');
 const state=domain.indexReadState({revision:1,records:rows()}),record=domain.recordById(state,'row-1');
 assert.equal(record.id,'row-1');assert.equal(domain.recordById(state,'row-1','member'),undefined);
 const derived={...state,records:[{id:'row-1',kind:'replacement'}]};assert.equal(domain.recordById(derived,'row-1').kind,'replacement');
 const mutable={revision:0,records:[{id:'row-1',kind:'old'}]};mutable.records[0]={id:'row-1',kind:'new'};assert.equal(domain.recordById(mutable,'row-1').kind,'new');
 const audits=Array.from({length:2000},(_,i)=>({id:'a'+i,kind:'audit',allowed:i<1400&&i%3!==0}));
 assert.deepEqual(domain.latestVisibleRecords(audits,row=>row.allowed,250),audits.filter(row=>row.allowed).slice(-250).reverse());
 assert.deepEqual(domain.latestVisibleRecords(audits,()=>false,250),[]);
 console.log('PASS Request-local ID indexing and reverse visible-history selection preserve mutable/derived states, permissions and ordering.');
}finally{db.close();delete globalThis.__snapshotTestEnv;}
