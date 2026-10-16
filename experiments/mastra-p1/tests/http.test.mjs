import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createSandbox,openSuggestionStore,removeSandbox,sandboxDigest,validateSandbox} from '../sandbox.mjs';
import {startReadonlyServer,syntheticSession,readOrdersFromApi} from '../server.mjs';
import {generateSyntheticSuggestions} from '../generate.mjs';
import {recordSuggestion} from '../suggestions.mjs';
import {createSyntheticIdentity} from '../auth.mjs';

async function setup(t,identityOptions={}) {
  const state=createSyntheticState(),before=structuredClone(state),directory=await createSandbox();
  const adapter=await createReadAdapter(state),reader=await openSuggestionStore(directory),writer=await openSuggestionStore(directory,{readOnly:false});
  const {identity,credentials}=await createSyntheticIdentity({adapter,...identityOptions});
  const server=await startReadonlyServer({adapter,store:reader,identity});
  t.after(async()=>{await server.close();reader.close();writer.close();await removeSandbox(directory);});
  const login=async actorId=>{const {username,password}=credentials.find(item=>item.actorId===actorId);return syntheticSession(server.origin,{username,password});};
  const a=await login('syn-employee-a'),b=await login('syn-employee-b');
  async function request(route,cookie=a,options={}){return fetch(server.origin+route,{...options,headers:{origin:server.origin,...(cookie?{cookie}:{}),...options.headers},redirect:'error'});}
  const generate=(sessionCookie=a)=>generateSyntheticSuggestions({origin:server.origin,adapter,store:writer,sessionCookie,resolveSession:server.resolveSession});
  return {state,before,directory,adapter,reader,writer,server,a,b,request,generate,login};
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
  for(const cookie of [c.a,c.b])results.push(await c.generate(cookie));
  assert(results.every(result=>result.created===2&&result.modelCalls===3&&result.readCalls===1));
  assert.equal(c.reader.count(),4);
  const a=await (await c.request('/api/suggestions')).json(),b=await (await c.request('/api/suggestions',c.b)).json();
  assert.equal(a.items.length,2);assert.equal(b.items.length,2);
  assert(a.items.every(item=>item.source.id.startsWith('syn-order-a-')&&item.source.version===1&&item.runId));
  assert.doesNotMatch(JSON.stringify(a),/syn-order-b|PRIVATE|sourceDigest|actorId/);
  const repeat=await c.generate();
  assert.equal(repeat.created,0);assert.equal(c.reader.count(),4);assert.deepEqual(c.state,c.before);
});

test('source edits suppress stale contents and permission revocation removes persisted suggestions',async t=>{
  const c=await setup(t);
  await c.generate();
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
  await c.generate();
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
  await assert.rejects(()=>syntheticSession('https://example.invalid',{username:'synthetic',password:'synthetic'}),/隔离/);
  const redirect=http.createServer((_req,res)=>{res.writeHead(307,{location:'http://127.0.0.1:8787/api/session'});res.end();});
  await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));
  try {await assert.rejects(()=>syntheticSession(`http://127.0.0.1:${redirect.address().port}`,{username:'synthetic',password:'synthetic'}),/fetch failed/);}
  finally {await new Promise(resolve=>{redirect.close(resolve);redirect.closeAllConnections();});}
});

test('credential login exposes a bounded expiry; logout and expiration revoke reads without data changes',async t=>{
  let now=Date.now();
  const c=await setup(t,{now:()=>now,sessionTtlMs:1000});
  await c.generate();
  const before=await sandboxDigest(c.directory);
  const me=await (await c.request('/api/me')).json();
  assert.equal(me.id,'syn-employee-a');assert.equal(me.sessionExpiresAt,now+1000);
  const logout=await c.request('/api/logout',c.a,{method:'POST'});
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await c.request('/api/orders',c.a)).status,401);
  assert.equal((await c.request('/api/orders',c.b)).status,200);
  now+=1001;
  assert.equal((await c.request('/api/me',c.b)).status,401);
  assert.equal((await c.request('/api/suggestions',c.b)).status,401);
  assert.equal(await sandboxDigest(c.directory),before);assert.deepEqual(c.state,c.before);
});

test('HTTP logout and account switching never report success after a backend revocation failure',async t=>{
  const state=createSyntheticState(),before=structuredClone(state),adapter=await createReadAdapter(state);
  let broken=false,issued=0;const revoked=[];
  const identity={sessionTtlMs:60_000,
    async login(){issued++;return {token:(issued===1?'a':'b').repeat(43)};},
    async resolveSession(){return {...adapter.actor('syn-employee-a'),sessionExpiresAt:Date.now()+60_000};},
    async logout(token){revoked.push(token);if(broken)throw new Error('synthetic revocation unavailable');},
    async close(){},
  };
  const server=await startReadonlyServer({adapter,identity,store:{list:()=>[]}});
  t.after(()=>server.close());
  const cookie=await syntheticSession(server.origin,{username:'synthetic',password:'synthetic'});
  const request=(route,options={})=>fetch(server.origin+route,{...options,headers:{origin:server.origin,cookie,...options.headers},redirect:'error'});
  broken=true;
  const logout=await request('/api/logout',{method:'POST'});
  assert.equal(logout.status,500);assert.equal(logout.headers.get('set-cookie'),null);
  assert.equal((await request('/api/me')).status,200,'simulated backend still accepts the old token; logout must not claim success');
  const change=await request('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'synthetic',password:'synthetic'})});
  assert.equal(change.status,500);assert.equal(change.headers.get('set-cookie'),null);
  assert.deepEqual(revoked,['a'.repeat(43),'a'.repeat(43),'b'.repeat(43)]);
  assert.deepEqual(state,before);
});

async function syntheticPage(fetchImpl) {
  // A minimal DOM harness executes the actual browser script, using fake fetch only.
  class Node {
    constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.hidden=false;this.open=false;this.events=new Map();this.classList={add(){},remove(){}};}
    set textContent(value){this.content=String(value);this.children=[];}
    get textContent(){return (this.content||'')+this.children.map(child=>child.textContent).join('');}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.content='';this.children=[...children];}
    setAttribute(){}
    addEventListener(name,callback){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(callback);}
    emit(name){return Promise.all((this.events.get(name)||[]).map(callback=>callback({preventDefault(){}})));}
    close(){this.open=false;this.emit('close');}
    showModal(){this.open=true;}
  }
  const nodes=new Map(),timers=new Map();let nextTimer=0;
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const document={getElementById:get,createElement:tag=>new Node(tag),addEventListener(){}};
  const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  runInNewContext(code,{document,window:{addEventListener(){}},AbortController,Date,Intl,Map,Number,String,Boolean,Error,JSON,Promise,encodeURIComponent,fetch:fetchImpl,setTimeout:callback=>{const id=++nextTimer;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)});
  const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
  async function login(){get('username-input').value='synthetic-ui-user';get('password-input').value='synthetic-ui-password';await get('session-form').emit('submit');await flush();}
  const button=node=>node.tag==='button'?node:node.children.map(button).find(Boolean);
  return {get,timers,flush,login,button};
}

function pageResponse(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}
const pageOrder={id:'syn-order-a-ui',version:1,orderNo:'SYNTHETIC-UI-ORDER',customer:'SYNTHETIC-UI-CUSTOMER',quantity:1};
const pageSuggestion={id:'syn-ui-suggestion',title:'SYNTHETIC-UI-SUGGESTION',reason:'synthetic only',suggestedAction:'review',assigneeName:'Synthetic A',status:'suggested',source:pageOrder};
function pageApi(route,options) {
  if(route==='/api/session') {assert.deepEqual(JSON.parse(options.body),{username:'synthetic-ui-user',password:'synthetic-ui-password'});return pageResponse({synthetic:true});}
  if(route==='/api/me')return pageResponse({id:'syn-employee-a',name:'Synthetic A',role:'sales',synthetic:true,sessionExpiresAt:Date.now()+60_000});
  if(route==='/api/suggestions')return pageResponse({items:[pageSuggestion],synthetic:true});
  if(route.startsWith('/api/orders?'))return pageResponse({items:[pageOrder],nextCursor:null});
  if(route==='/api/logout')return pageResponse({synthetic:true});
  throw new Error('unexpected fake page route');
}

test('browser script uses credential login and immediately clears cached records before logout completes',async()=>{
  let completeLogout;
  const page=await syntheticPage((route,options)=>route==='/api/logout'?new Promise(resolve=>{completeLogout=resolve;}):Promise.resolve(pageApi(route,options)));
  await page.login();
  assert.match(page.get('suggestions-list').textContent,/SYNTHETIC-UI-SUGGESTION/);
  assert.match(page.get('orders-body').textContent,/SYNTHETIC-UI-ORDER/);
  const logout=page.get('logout-button').emit('click');
  assert.doesNotMatch(page.get('suggestions-list').textContent,/SYNTHETIC-UI/);
  assert.equal(page.get('orders-body').textContent,'');
  assert.equal(page.get('username-input').value,'');assert.equal(page.get('password-input').value,'');
  assert.equal(page.get('session-form').hidden,false);
  completeLogout(pageResponse({synthetic:true}));await logout;
});

test('browser script removes every cached view on 401 or 403 from an order detail request',async()=>{
  for(const status of [401,403]) {
    const page=await syntheticPage((route,options)=>Promise.resolve(route.startsWith('/api/orders/')?pageResponse({error:'synthetic denial'},status):pageApi(route,options)));
    await page.login();
    await page.button(page.get('suggestions-list')).emit('click');await page.flush();
    assert.equal(page.get('order-dialog').open,false);
    assert.equal(page.get('order-detail').textContent,'');assert.equal(page.get('orders-body').textContent,'');
    assert.doesNotMatch(page.get('suggestions-list').textContent,/SYNTHETIC-UI/);
    assert.equal(page.get('session-form').hidden,false);
  }
});

test('browser expiry clears data and a late in-flight read cannot repopulate it',async()=>{
  let completeOrders;
  const page=await syntheticPage((route,options)=>route.startsWith('/api/orders?')?new Promise(resolve=>{completeOrders=resolve;}):Promise.resolve(pageApi(route,options)));
  await page.login();
  assert.match(page.get('suggestions-list').textContent,/SYNTHETIC-UI-SUGGESTION/);
  assert.equal(page.timers.size,1);
  [...page.timers.values()][0]();
  completeOrders(pageResponse({items:[pageOrder],nextCursor:null}));await page.flush();
  assert.equal(page.get('orders-body').textContent,'');
  assert.doesNotMatch(page.get('suggestions-list').textContent,/SYNTHETIC-UI/);
  assert.match(page.get('session-status').textContent,/过期/);
  assert.equal(page.get('session-form').hidden,false);
});

function runPreview(...args) {
  const preview=fileURLToPath(new URL('../preview.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[preview,'--synthetic','--prepare-only',...args],{encoding:'utf8',timeout:15_000});
  assert.equal(child.status,0,child.stdout+'\n'+child.stderr);
  assert.doesNotMatch(child.stdout,/"(?:username|password)"/);
  const line=child.stdout.split(/\r?\n/).find(line=>line.startsWith('PREVIEW_READY '));assert(line);
  const result=JSON.parse(line.slice('PREVIEW_READY '.length));
  assert.equal(result.credentialsFile,null);
  return result;
}

async function storedSuggestions(directory) {
  const reader=await openSuggestionStore(directory);
  try {return [...reader.list('syn-employee-a'),...reader.list('syn-employee-b')];}
  finally {reader.close();}
}

test('interactive preview stores random credentials in an exclusive sandbox file and never serves or prints them',{timeout:20_000},async()=>{
  const preview=fileURLToPath(new URL('../preview.mjs',import.meta.url));
  const child=spawn(process.execPath,[preview,'--synthetic'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',directory,closed=false;
  const completion=new Promise(resolve=>child.once('close',()=>{closed=true;resolve();}));
  try {
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('synthetic preview readiness timed out')),12_000);
      child.once('error',()=>{clearTimeout(timer);reject(new Error('synthetic preview did not start'));});
      child.once('close',()=>{clearTimeout(timer);reject(new Error('synthetic preview closed before readiness'));});
      child.stderr.on('data',()=>{});
      child.stdout.on('data',chunk=>{
        output+=chunk.toString('utf8');
        if(output.length>100_000){clearTimeout(timer);reject(new Error('synthetic preview output overflow'));return;}
        const line=output.split(/\r?\n/).find(value=>value.startsWith('PREVIEW_READY '));
        if(!line)return;
        try {const result=JSON.parse(line.slice('PREVIEW_READY '.length));clearTimeout(timer);resolve(result);}catch{}
      });
    });
    directory=ready.directory;
    await validateSandbox(directory);
    assert.equal(path.dirname(ready.credentialsFile),path.resolve(directory));
    assert.match(path.basename(ready.credentialsFile),/^credentials-[0-9a-f-]+\.json$/);
    const file=await stat(ready.credentialsFile);
    if(process.platform!=='win32')assert.equal(file.mode&0o777,0o600);
    const saved=JSON.parse(await readFile(ready.credentialsFile,'utf8'));
    assert.equal(saved.syntheticOnly,true);assert.equal(saved.credentials.length,2);
    for(const item of saved.credentials) {
      assert(['syn-employee-a','syn-employee-b'].includes(item.actorId));
      assert.notEqual(item.username,item.actorId);assert.ok(item.password.length>=24);
      assert.equal(output.includes(item.username),false);assert.equal(output.includes(item.password),false);
    }
    const {username,password}=saved.credentials[0];
    const cookie=await syntheticSession(ready.url,{username,password});
    const response=await fetch(ready.url+'/'+path.basename(ready.credentialsFile),{headers:{cookie},redirect:'error'});
    assert.equal(response.status,404);
    const body=await response.text();
    assert.equal(body.includes(username),false);assert.equal(body.includes(password),false);
  } finally {
    if(!closed)child.kill('SIGTERM');
    await completion;
    if(directory)await removeSandbox(directory);
  }
});

test('preview resume: complete snapshot rechecks both employees without changing stored rows or database bytes',{timeout:30_000},async()=>{
  const first=runPreview();
  try {
    const before=await sandboxDigest(first.directory),items=await storedSuggestions(first.directory);
    assert.equal((await readdir(first.directory)).some(file=>file.startsWith('credentials-')),false);
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
