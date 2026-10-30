// Benchmark: full-snapshot read latency before vs after the snapshot cache.
// Synthetic data that mimics production proportions (audit dominates by size).
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const N_AUDIT=Number(process.env.BENCH_AUDIT||20000);
const AUDIT_BYTES=Number(process.env.BENCH_AUDIT_BYTES||3200); // ~3.2 KB per audit record

await fs.mkdir('test-output',{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/snapshot-bench-'));
process.env.DOON_DATA_DIR=path.join(dir,'data');
const runtime=await import(pathToFileURL(path.resolve('standalone/runtime.mjs')).href);
const {db}=runtime,env=runtime.env;
globalThis.__snapshotTestEnv=env;
await build({entryPoints:['lib/store.ts'],outdir:path.join(dir,'build'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-bench-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},args=>({path:args.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__snapshotTestEnv;':'export async function getChatGPTUser(){return {userId:"synthetic-user"}}'}));
}}]});
const store=await import(pathToFileURL(path.join(dir,'build/store.js')).href);
const payload='x'.repeat(AUDIT_BYTES);
// Seed: a few members, some orders, and a large audit tail that mirrors production.
const insert=db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)');
insert.run('member','member',JSON.stringify({id:'member',kind:'member',userId:'synthetic-user',active:true,role:'admin'}));
for(let i=0;i<100;i++)insert.run('order-'+i,'order',JSON.stringify({id:'order-'+i,kind:'order',n:i}));
for(let i=0;i<N_AUDIT;i++)insert.run('audit-'+i,'audit',JSON.stringify({id:'audit-'+i,kind:'audit',action:'跟进',before:{note:payload},after:{note:payload},createdAt:new Date().toISOString()}));
const dbBytes=db.prepare('SELECT SUM(length(data)) s FROM records').get().s;
console.log(`Seeded ${N_AUDIT} audit records (~${(dbBytes/1048576).toFixed(1)} MiB of data).`);

const time=async(fn)=>{const t=process.hrtime.bigint();await fn();return Number(process.hrtime.bigint()-t)/1e6;};

// Baseline: cold full snapshot.
const cold=await time(()=>store.snapshot());
// Warm full snapshot (cache hit).
const warm=await time(()=>store.snapshot());
// Warm scoped read (the progress-view path).
const scoped=await time(()=>store.snapshot(['member','service_record','service_revision','customer_account','customer_quote_access']));

// Compare against the pre-cache path by bypassing the cache for one full read.
store.invalidateSnapshotCache();
const cold2=await time(()=>store.snapshot());

console.log(JSON.stringify({N_AUDIT,dbMiB:+(dbBytes/1048576).toFixed(1),coldMs:+cold.toFixed(2),cold2Ms:+cold2.toFixed(2),warmMs:+warm.toFixed(3),scopedMs:+scoped.toFixed(3),speedupColdToWarm:+(cold2/warm).toFixed(0)+'x',speedupColdToScoped:+(cold2/scoped).toFixed(0)+'x'},null,2));
db.close();delete globalThis.__snapshotTestEnv;
