// Snapshot cache (plan C) correctness. Synthetic database only; no running
// service, production files or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

await fs.mkdir('test-output',{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/snapshot-cache-'));
process.env.DOON_DATA_DIR=path.join(dir,'data');
const runtime=await import(pathToFileURL(path.resolve('standalone/runtime.mjs')).href);
const {db}=runtime,env=runtime.env;
globalThis.__snapshotTestEnv=env;
await build({entryPoints:['lib/store.ts'],outdir:path.join(dir,'build'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-cache-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},args=>({path:args.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__snapshotTestEnv;':'export async function getChatGPTUser(){return {userId:"synthetic-user"}}'}));
}}]});
const store=await import(pathToFileURL(path.join(dir,'build/store.js')).href);
const put=(id,kind,data,rowid)=>db.prepare('INSERT INTO records(rowid,id,kind,data) VALUES(?,?,?,?)').run(rowid,id,kind,JSON.stringify({id,kind,...data}));
const rows=()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data));
// Count how many times the underlying native readSnapshot is actually invoked.
let readCalls=0;const nativeRead=env.DB.readSnapshot;
env.DB.readSnapshot=async kinds=>{readCalls++;return nativeRead(kinds);};
try{
 put('member','member',{userId:'synthetic-user',active:true,role:'admin',nested:{items:[{value:'original'}]}},1n);
 for(let i=1;i<=200;i++)put('order-'+i,'order',{n:i},BigInt(i+1));

 // 1. Cold read populates the cache; a second full read hits it with no native read.
 store.invalidateSnapshotCache();
 assert.equal(store.snapshotCacheStats(),null);
 const first=await store.snapshot();
 assert.deepEqual(first.records,rows());
 const stats=store.snapshotCacheStats();
 assert.equal(stats.revision,first.revision);assert.equal(stats.records,201);
 const callsAfterCold=readCalls;
 const second=await store.snapshot();
 assert.equal(readCalls,callsAfterCold,'cache hit must skip the native read');
 assert.deepEqual(second.records,first.records);
 console.log('PASS Cold read fills the cache; a warm full read returns identical rows with zero native reads.');

 // 2. Scoped (kinds) reads filter from the cache without a native read.
 const orders=await store.snapshot(['order']);
 assert.equal(orders.records.length,200);
 assert.equal(readCalls,callsAfterCold,'scoped cache hit must skip the native read');
 assert.deepEqual(await store.snapshot([]),{revision:first.revision,records:[]});
 console.log('PASS Scoped reads filter the warm cache by kind with zero native reads, including the empty set.');

 // 3. commit() folds the write into the cache and advances revision in place.
 const rev=first.revision;
 await store.commit(rev,[{id:'order-201',kind:'order',n:201}]);
 const after=await store.snapshot();
 assert.equal(after.revision,rev+1);
 assert.equal(after.records.length,202);
 assert.equal(readCalls,callsAfterCold,'commit must keep the cache warm without a native re-read');
 assert.equal(after.records.find(r=>r.id==='order-201').n,201);
 // Updating an existing row also stays consistent.
 await store.commit(after.revision,[{id:'order-1',kind:'order',n:999}]);
 const updated=await store.snapshot();
 assert.equal(updated.records.find(r=>r.id==='order-1').n,999);
 assert.equal(updated.records.length,202,'upsert must not duplicate');
 assert.equal(readCalls,callsAfterCold);
 console.log('PASS commit() updates the cache in place for inserts and upserts with no native re-read.');

 // 4. External writers (saveRecords / direct SQL) invalidate via the revision guard.
 const revBefore=updated.revision;
 runtime.saveRecords([{id:'order-external',kind:'order',n:777}]);
 const external=await store.snapshot();
 assert.equal(external.revision,revBefore+1);
 assert.equal(external.records.find(r=>r.id==='order-external').n,777);
 assert(readCalls>callsAfterCold,'external write must force a native re-read');
 console.log('PASS A write outside commit() bumps the revision and invalidates the cache on the next read.');

 // 5. Stale writes are still refused through the CAS guard (cache does not mask it).
 await assert.rejects(()=>store.commit(external.revision-1,[{id:'forbidden',kind:'order'}]),e=>e.status===409);
 assert.equal(db.prepare("SELECT id FROM records WHERE id='forbidden'").get(),undefined);
 console.log('PASS Stale-write CAS refusal is preserved with the cache.');

 // 6. Frozen entities cannot be mutated through the returned snapshot; the caller
 // receives a fresh array so it cannot corrupt the shared cache either.
 const frozen=await store.snapshot();
 assert.throws(()=>{frozen.records[0].n=12345;},TypeError,'cached entity must be frozen');
 assert.throws(()=>{frozen.records[0].nested.items[0].value='changed';},TypeError,'nested cached values must be frozen');
 assert.throws(()=>{frozen.records[0].nested.items.push('changed');},TypeError,'nested cached arrays must be frozen');
 assert.equal((await store.snapshot()).records[0].nested.items[0].value,'original');
 const beforeLen=store.snapshotCacheStats().records;
 frozen.records.push({id:'x',kind:'order'});
 assert.equal(store.snapshotCacheStats().records,beforeLen,'caller push must not leak into the cache');
 const afterPush=await store.snapshot();
 assert.equal(afterPush.records.length,beforeLen);
 console.log('PASS Cached entities are frozen; per-request arrays are fresh copies that cannot leak into the cache.');

 // 7. commit() reproduces persistence semantics: explicit undefined keys are
 // dropped, matching what a re-read from SQLite would return.
 store.invalidateSnapshotCache();
 await store.snapshot();
 await store.commit((await store.snapshot()).revision,[{id:'order-1',kind:'order',n:1,extra:undefined}]);
 const persisted=await store.snapshot();
 const saved=persisted.records.find(r=>r.id==='order-1');
 assert.equal(Object.prototype.hasOwnProperty.call(saved,'extra'),false,'undefined keys must be dropped in the cache like the DB');
 console.log('PASS commit() drops explicit undefined keys so the cache matches a SQLite re-read.');

 console.log('\nAll snapshot cache checks passed.');
}finally{db.close();delete globalThis.__snapshotTestEnv;}
