import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createSandbox,openSuggestionStore,removeSandbox,sandboxDigest,validateSandbox} from '../sandbox.mjs';
import {startReadonlyServer,syntheticSession,readOrdersFromApi} from '../server.mjs';
import {generateSyntheticSuggestions} from '../generate.mjs';
import {recordSuggestion} from '../suggestions.mjs';

async function setup(t) {
  const state=createSyntheticState(),before=structuredClone(state),directory=await createSandbox();
  const adapter=await createReadAdapter(state),reader=await openSuggestionStore(directory),writer=await openSuggestionStore(directory,{readOnly:false});
  const server=await startReadonlyServer({adapter,store:reader});
  t.after(async()=>{await server.close();reader.close();writer.close();await removeSandbox(directory);});
  const a=await syntheticSession(server.origin,'syn-employee-a'),b=await syntheticSession(server.origin,'syn-employee-b');
  async function request(route,cookie=a,options={}){return fetch(server.origin+route,{...options,headers:{...(cookie?{cookie}:{}),...options.headers},redirect:'error'});}
  return {state,before,directory,adapter,reader,writer,server,a,b,request};
}

test('HTTP authentication, server-bound identities, cross-customer isolation and DTO whitelist',async t=>{
  const c=await setup(t);
  assert.notEqual(c.server.port,8787);
  assert.equal((await c.request('/api/orders',null)).status,401);
  const a=await (await c.request('/api/orders')).json(),b=await (await c.request('/api/orders',c.b)).json();
  assert.equal(a.items.length,4);assert.equal(b.items.length,4);
  assert(a.items.every(x=>x.id.startsWith('syn-order-a-')));assert(b.items.every(x=>x.id.startsWith('syn-order-b-')));
  assert.equal((await c.request('/api/orders/syn-order-b-overdue')).status,404);
  assert.equal((await c.request('/api/orders?memberId=syn-employee-b')).status,400);
  assert.equal((await c.request('/api/orders?limit=51')).status,400);
  assert.doesNotMatch(JSON.stringify(a),/PRIVATE|ownerEmail|attachmentKey|userId/);
  assert.deepEqual(c.state,c.before);
});

test('real Agent tool reads authenticated HTTP API and persists only attributed synthetic suggestions',async t=>{
  const c=await setup(t);
  const results=[];
  for(const actorId of ['syn-employee-a','syn-employee-b'])results.push(await generateSyntheticSuggestions({origin:c.server.origin,adapter:c.adapter,store:c.writer,actorId}));
  assert(results.every(result=>result.created===2&&result.modelCalls===3&&result.readCalls===1));
  assert.equal(c.reader.count(),4);
  const a=await (await c.request('/api/suggestions')).json(),b=await (await c.request('/api/suggestions',c.b)).json();
  assert.equal(a.items.length,2);assert.equal(b.items.length,2);
  assert(a.items.every(item=>item.source.id.startsWith('syn-order-a-')&&item.source.version===1&&item.runId));
  assert.doesNotMatch(JSON.stringify(a),/syn-order-b|PRIVATE|sourceDigest|actorId/);
  const repeat=await generateSyntheticSuggestions({origin:c.server.origin,adapter:c.adapter,store:c.writer,actorId:'syn-employee-a'});
  assert.equal(repeat.created,0);assert.equal(c.reader.count(),4);assert.deepEqual(c.state,c.before);
});

test('source edits suppress stale contents and permission revocation removes persisted suggestions',async t=>{
  const c=await setup(t);
  await generateSyntheticSuggestions({origin:c.server.origin,adapter:c.adapter,store:c.writer,actorId:'syn-employee-a'});
  const order=c.state.records.find(x=>x.id==='syn-order-a-overdue');order.version++;
  const changed=await (await c.request('/api/suggestions')).json();
  const stale=changed.items.find(x=>x.source.id===order.id);
  assert.equal(stale.status,'stale');assert.equal(stale.reason,'');assert.equal(stale.suggestedAction,'');assert.equal(stale.source.version,2);
  const member=c.state.records.find(x=>x.id==='syn-employee-a');member.customers=[];member.email='revoked@example.invalid';
  assert.equal((await (await c.request('/api/suggestions')).json()).items.length,0);
  member.active=false;assert.equal((await c.request('/api/suggestions')).status,403);
});

test('all business mutations are refused and read requests leave fixture and suggestion database bytes unchanged',async t=>{
  const c=await setup(t);
  await generateSyntheticSuggestions({origin:c.server.origin,adapter:c.adapter,store:c.writer,actorId:'syn-employee-a'});
  const digest=await sandboxDigest(c.directory);
  for(const method of ['POST','PUT','PATCH','DELETE']) {
    const response=await c.request('/api/suggestions',c.a,{method,headers:{'content-type':'application/json'},body:JSON.stringify({approved:true})});
    assert.equal(response.status,405);
  }
  assert.equal((await c.request('/api/approve',c.a,{method:'POST'})).status,405);
  for(const route of ['/api/me','/api/orders','/api/orders/syn-order-a-overdue','/api/suggestions'])assert.equal((await c.request(route)).status,200);
  assert.equal(await sandboxDigest(c.directory),digest);assert.deepEqual(c.state,c.before);
  assert.throws(()=>c.reader.add({id:'x'}),/只读/);
});

test('fabricated source, wrong version and unsupported business advice cannot create suggestions',async t=>{
  const c=await setup(t);
  const base={adapter:c.adapter,store:c.writer,actorId:'syn-employee-a',sourceId:'syn-order-a-overdue',sourceVersion:1,rule:'review-past-date',runId:'syn-test'};
  assert.throws(()=>recordSuggestion({...base,sourceId:'syn-order-b-overdue'}));
  assert.throws(()=>recordSuggestion({...base,sourceVersion:2}),/版本/);
  assert.throws(()=>recordSuggestion({...base,sourceId:'syn-order-a-normal'}),/依据/);
  assert.throws(()=>recordSuggestion({...base,rule:'invented'}),/依据/);
  assert.equal(c.reader.count(),0);
});

test('sandbox and API clients reject business locations, production port and redirects',async()=>{
  await assert.rejects(()=>validateSandbox(process.cwd()),/临时目录/);
  await assert.rejects(()=>readOrdersFromApi('http://127.0.0.1:8787',''),/正式/);
  await assert.rejects(()=>syntheticSession('https://example.invalid','syn-employee-a'),/隔离/);
  const redirect=http.createServer((_req,res)=>{res.writeHead(307,{location:'http://127.0.0.1:8787/api/demo-session'});res.end();});
  await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));
  try {await assert.rejects(()=>syntheticSession(`http://127.0.0.1:${redirect.address().port}`,'syn-employee-a'),/fetch failed/);}
  finally {await new Promise(resolve=>{redirect.close(resolve);redirect.closeAllConnections();});}
});

function runPreview(...args) {
  const preview=fileURLToPath(new URL('../preview.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[preview,'--synthetic','--prepare-only',...args],{encoding:'utf8',timeout:15_000});
  assert.equal(child.status,0,child.stdout+'\n'+child.stderr);
  const line=child.stdout.split(/\r?\n/).find(line=>line.startsWith('PREVIEW_READY '));assert(line);
  return JSON.parse(line.slice('PREVIEW_READY '.length));
}

async function storedSuggestions(directory) {
  const reader=await openSuggestionStore(directory);
  try {return [...reader.list('syn-employee-a'),...reader.list('syn-employee-b')];}
  finally {reader.close();}
}

test('preview resume: complete snapshot rechecks both employees without changing stored rows or database bytes',{timeout:30_000},async()=>{
  const first=runPreview();
  try {
    const before=await sandboxDigest(first.directory),items=await storedSuggestions(first.directory);
    const second=runPreview('--resume',first.directory);
    assert.equal(first.suggestions,4);assert.equal(second.suggestions,4);assert.equal(second.resumed,true);
    assert.deepEqual(second.runs.map(run=>({actorId:run.actorId,created:run.created})),[
      {actorId:'syn-employee-a',created:0},{actorId:'syn-employee-b',created:0},
    ]);
    assert(second.runs.every(run=>run.readCalls===1&&run.modelCalls===3));
    assert.deepEqual(await storedSuggestions(first.directory),items);
    assert.equal(await sandboxDigest(first.directory),before);
  } finally {await removeSandbox(first.directory);}
});

for(const seededCount of [1,2]) {
  test(`preview resume: fills a partial snapshot with ${seededCount} existing employee-A suggestion(s) without duplicates`,{timeout:30_000},async()=>{
    const directory=await createSandbox();
    try {
      const adapter=await createReadAdapter(createSyntheticState()),writer=await openSuggestionStore(directory,{readOnly:false});
      try {
        const sources=[['syn-order-a-missing-date','confirm-date'],['syn-order-a-overdue','review-past-date']];
        for(const [sourceId,rule] of sources.slice(0,seededCount)) {
          recordSuggestion({adapter,store:writer,actorId:'syn-employee-a',sourceId,sourceVersion:1,rule,runId:'syn-partial-original-run'});
        }
      } finally {writer.close();}
      const original=await storedSuggestions(directory);
      assert.equal(original.length,seededCount);
      const resumed=runPreview('--resume',directory),complete=await storedSuggestions(directory);
      assert.equal(resumed.resumed,true);assert.equal(resumed.suggestions,4);
      assert.deepEqual(resumed.runs.map(run=>({actorId:run.actorId,created:run.created})),[
        {actorId:'syn-employee-a',created:2-seededCount},{actorId:'syn-employee-b',created:2},
      ]);
      assert.equal(complete.length,4);assert.equal(new Set(complete.map(item=>item.id)).size,4);
      for(const actorId of ['syn-employee-a','syn-employee-b'])assert.equal(complete.filter(item=>item.actorId===actorId).length,2);
      for(const item of original)assert.deepEqual(complete.find(saved=>saved.id===item.id),item);
      const before=await sandboxDigest(directory),again=runPreview('--resume',directory);
      assert.equal(again.suggestions,4);assert(again.runs.every(run=>run.created===0));
      assert.deepEqual(await storedSuggestions(directory),complete);
      assert.equal(await sandboxDigest(directory),before);
    } finally {await removeSandbox(directory);}
  });
}
