import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, realpath, lstat, link, mkdir, readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createGuardedFetch, limits, rates, validateRun, writeRunJson} from '../transport.mjs';

// Every fetch below is injected. This suite never reads environment credentials or calls a provider.
const endpoint = 'https://api.deepseek.com/chat/completions';
const marker = {application:'doon-mastra-p2', syntheticOnly:true, budgetCny:5};
const hash = text => createHash('sha256').update(text).digest('hex');
const charge = (input, output) => Math.ceil((input*rates.inputPerMillion+output*rates.outputPerMillion)*1e6/1e6)/1e6;
const body = overrides => ({model:'deepseek-v4-pro', thinking:{type:'enabled'}, reasoning_effort:'high', messages:[{role:'user',content:'SYNTHETIC order check'}], tool_choice:'auto', max_tokens:128, stream:false, ...overrides});
const request = overrides => ({method:'POST', headers:{authorization:'Bearer SYNTHETIC-TEST-KEY-NOT-A-CREDENTIAL'}, body:JSON.stringify(body(overrides))});
const reply = (usage={prompt_tokens:10,completion_tokens:5}, message={content:'Synthetic reply'}) => new Response(JSON.stringify({choices:[{message}],...(usage===null?{}:{usage})}), {headers:{'content-type':'application/json'}});
const ledger = async directory => JSON.parse(await readFile(path.join(directory,'budget.json'),'utf8'));
const guard = (directory, fetchImpl, options={}) => createGuardedFetch({directory,thinking:'enabled',caseId:'synthetic-test',phase:'initial',fetchImpl,...options});

async function temporaryRun(t, budgetCny=5) {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot,'doon-mastra-p2-'));
  await writeFile(path.join(directory,'run.json'),JSON.stringify({...marker,budgetCny}));
  t.after(async () => {
    // Only remove this test's newly-created, direct child of the resolved temporary directory.
    assert.equal(path.dirname(directory).toLowerCase(),temporaryRoot.toLowerCase());
    assert.match(path.basename(directory),/^doon-mastra-p2-[a-zA-Z0-9]+$/);
    assert.equal((await lstat(directory)).isSymbolicLink(),false);
    assert.equal((await realpath(directory)).toLowerCase(),directory.toLowerCase());
    await rm(directory,{recursive:true,force:false});
  });
  assert.equal(await validateRun(directory),directory);
  return directory;
}

function sseResponse(objects, {malformed=false}={}) {
  const text = objects.map(value=>`data: ${JSON.stringify(value)}\r\n\r\n`).join('')+(malformed?'data: {broken}\n\n':'')+'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller) {
    // Deliberately divide JSON, line separators, and multibyte characters across chunks.
    for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7));
    controller.close();
  }}),{headers:{'content-type':'text/event-stream'}});
}

test('run marker accepts exactly the three synthetic-run fields', async t => {
  const directory=await temporaryRun(t);
  await writeFile(path.join(directory,'run.json'),JSON.stringify({...marker,extra:true}));
  await assert.rejects(validateRun(directory),/P2_RUN_MARKER_REJECTED/);
});

test('run markers allow only explicit five or ten yuan within the hard ceiling', async t => {
  const directory=await temporaryRun(t,10);
  assert.equal(limits.budgetCny,10);
  assert.equal(limits.requests,24);
  assert.equal(await validateRun(directory,10),directory);
  for(const budgetCny of [0,4,6,11,'5','10',null]) {
    await writeFile(path.join(directory,'run.json'),JSON.stringify({...marker,budgetCny}));
    await assert.rejects(validateRun(directory),/P2_RUN_MARKER_REJECTED/);
  }
});

test('resuming a five-yuan run rejects a ten-yuan CLI budget before writes or worker start', async t => {
  const directory=await temporaryRun(t);
  const fake=guard(directory,async()=>reply());
  await fake(endpoint,request());
  const beforeMarker=await readFile(path.join(directory,'run.json'),'utf8');
  const beforeLedger=await readFile(path.join(directory,'budget.json'),'utf8');
  assert.equal(await validateRun(directory,5),directory);
  await assert.rejects(validateRun(directory,10),/P2_RESUME_BUDGET_MISMATCH/);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../run.mjs',import.meta.url)),
    '--live','--synthetic','--budget-cny=10','--resume-budget',directory,
  ],{encoding:'utf8',env:{},windowsHide:true,timeout:5000});
  assert.equal(result.error,undefined);
  assert.equal(result.status,1);
  const report=JSON.parse(result.stdout.trim().slice('P2_RESULT '.length));
  assert.equal(report.errorCode,'P2_RESUME_BUDGET_MISMATCH');
  assert.equal(report.passedPhases,0);
  assert.equal(await readFile(path.join(directory,'run.json'),'utf8'),beforeMarker);
  assert.equal(await readFile(path.join(directory,'budget.json'),'utf8'),beforeLedger);
  await assert.rejects(readFile(path.join(directory,'summary.json')),{code:'ENOENT'});
});

test('ten-yuan resume also requires matching CLI budget and npm live defaults to ten', async t => {
  const directory=await temporaryRun(t,10);
  await assert.rejects(validateRun(directory,5),/P2_RESUME_BUDGET_MISMATCH/);
  assert.equal(await validateRun(directory,10),directory);
  const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(packageJson.scripts.live,/--budget-cny=10(?:\s|$)/);
});

test('safe JSON writer creates and replaces ordinary files without leaving a staging file', async t => {
  const directory=await temporaryRun(t);
  await writeRunJson(directory,'summary.json',{status:'initial'});
  await writeRunJson(directory,'summary.json',{status:'complete',synthetic:true});
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'summary.json'),'utf8')),{status:'complete',synthetic:true});
  assert.equal((await lstat(path.join(directory,'summary.json'))).nlink,1);
  assert.deepEqual((await readdir(directory)).sort(),['run.json','summary.json']);
});

test('summary, attempt and verification hard links are rejected without changing external sentinels', async t => {
  for(const name of ['summary.json','attempt-123.json','verification.json']) {
    const directory=await temporaryRun(t), outside=await temporaryRun(t);
    const sentinel=path.join(outside,'sentinel.json'), destination=path.join(directory,name);
    const content=JSON.stringify({synthetic:'EXTERNAL-SENTINEL-MUST-NOT-CHANGE',name});
    await writeFile(sentinel,content,{flag:'wx'});
    await link(sentinel,destination);
    assert.equal((await lstat(destination)).nlink,2);
    await assert.rejects(writeRunJson(directory,name,{overwrite:true}),/P2_RUN_LINK_REJECTED/);
    assert.equal(await readFile(sentinel,'utf8'),content);
    assert.equal(await readFile(destination,'utf8'),content);
    assert.deepEqual((await readdir(directory)).sort(),[name,'run.json'].sort());
  }
});

test('safe JSON writer rejects traversal and non-file destinations', async t => {
  const directory=await temporaryRun(t), outside=await temporaryRun(t);
  const sentinel=path.join(outside,'sentinel.json');
  await writeFile(sentinel,'SYNTHETIC-EXTERNAL-SENTINEL',{flag:'wx'});
  for(const name of ['../sentinel.json','nested/summary.json','nested\\summary.json',sentinel]) {
    await assert.rejects(writeRunJson(directory,name,{overwrite:true}),/P2_RUN_PATH_REJECTED/);
  }
  await mkdir(path.join(directory,'summary.json'));
  await assert.rejects(writeRunJson(directory,'summary.json',{}),/P2_RUN_LINK_REJECTED/);
  assert.equal(await readFile(sentinel,'utf8'),'SYNTHETIC-EXTERNAL-SENTINEL');
});

test('legacy budget.pending hard link is rejected before any fetch and leaves external sentinel unchanged', async t => {
  const directory=await temporaryRun(t), outside=await temporaryRun(t);
  const sentinel=path.join(outside,'sentinel.json');
  const content='SYNTHETIC-PENDING-EXTERNAL-SENTINEL';
  await writeFile(sentinel,content,{flag:'wx'});
  await link(sentinel,path.join(directory,'budget.pending'));
  let calls=0;
  const fetch=guard(directory,async()=>{calls++;return reply();});
  await assert.rejects(fetch(endpoint,request()),/P2_RUN_LINK_REJECTED/);
  assert.equal(calls,0);
  assert.equal(await readFile(sentinel,'utf8'),content);
  await assert.rejects(readFile(path.join(directory,'budget.json')),{code:'ENOENT'});
  await assert.rejects(readFile(path.join(directory,'budget.lock')),{code:'ENOENT'});
});

test('resume refuses a linked summary before worker launch and preserves the external file', async t => {
  const directory=await temporaryRun(t), outside=await temporaryRun(t);
  const sentinel=path.join(outside,'sentinel.json'), content='SYNTHETIC-RESUME-EXTERNAL-SENTINEL';
  await writeFile(sentinel,content,{flag:'wx'});
  await link(sentinel,path.join(directory,'summary.json'));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../run.mjs',import.meta.url)),
    '--live','--synthetic','--budget-cny=5','--resume-budget',directory,
  ],{encoding:'utf8',env:{},windowsHide:true,timeout:5000});
  assert.equal(result.error,undefined);
  assert.equal(result.status,1);
  const report=JSON.parse(result.stdout.trim().slice('P2_RESULT '.length));
  assert.equal(report.status,'failed');
  assert.equal(report.passedPhases,0);
  assert.equal(await readFile(sentinel,'utf8'),content);
  assert.deepEqual((await readdir(directory)).sort(),['run.json','summary.json']);
});

test('rejects non-official endpoints, port 8787, redirects in URL, and non-POST before any fetch', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fetch=guard(directory,async()=>{calls++;return reply();});
  for(const url of [
    'https://example.com/chat/completions', 'http://127.0.0.1:8787/chat/completions',
    'https://api.deepseek.com:8787/chat/completions', 'http://api.deepseek.com/chat/completions',
    'https://api.deepseek.com/chat/completions?redirect=https://example.com',
    'https://api.deepseek.com/chat/completions#fragment', 'https://user:pass@api.deepseek.com/chat/completions',
    'https://api.deepseek.com/other',
  ])await assert.rejects(fetch(url,request()),/P2_ENDPOINT_REJECTED/);
  await assert.rejects(fetch(endpoint,{...request(),method:'GET'}),/P2_ENDPOINT_REJECTED/);
  assert.equal(calls,0);
  await assert.rejects(readFile(path.join(directory,'budget.json')),{code:'ENOENT'});
});

test('forces redirect:error and retains reservation on sanitized fetch failure', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fetch=guard(directory,async(_input,init)=>{
    calls++;
    assert.equal(init.redirect,'error');
    assert.ok(init.signal instanceof AbortSignal);
    throw new Error('SYNTHETIC-SECRET-REDIRECT-DETAIL');
  });
  await assert.rejects(fetch(endpoint,{...request(),redirect:'follow'}),{message:'P2_PROVIDER_NETWORK_ERROR'});
  const entry=(await ledger(directory)).entries[0];
  assert.equal(calls,1);
  assert.equal(entry.state,'network-error');
  assert.equal(entry.chargedCny,entry.reservedCny);
  assert.ok(!(await readFile(path.join(directory,'budget.json'),'utf8')).includes('SYNTHETIC-SECRET'));
});

test('rejects wrong model, thinking, tool choice, stream mode, effort, output cap and body size', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fetch=guard(directory,async()=>{calls++;return reply();});
  for(const invalid of [
    {model:'deepseek-flash'}, {thinking:{type:'disabled'}}, {thinking:undefined},
    {messages:[]}, {messages:'bad'}, {tool_choice:'required'}, {tool_choice:{type:'function',function:{name:'forced'}}},
    {stream:'false'}, {stream:1}, {reasoning_effort:'max'},
  ])await assert.rejects(fetch(endpoint,request(invalid)),/P2_PROTOCOL_CONFIG_REJECTED/);
  for(const max_tokens of [0,-1,1.5,limits.outputTokens+1,'128'])await assert.rejects(fetch(endpoint,request({max_tokens})),/P2_OUTPUT_LIMIT_REJECTED/);
  await assert.rejects(fetch(endpoint,{...request(),body:{}}),/P2_REQUEST_SIZE_REJECTED/);
  await assert.rejects(fetch(endpoint,request({messages:[{role:'user',content:'x'.repeat(limits.bodyBytes)}]})),/P2_REQUEST_SIZE_REJECTED/);
  assert.equal(calls,0);
});

test('non-thinking mode rejects reasoning effort and accepts absent stream mode', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fetch=guard(directory,async()=>{calls++;return reply();},{thinking:'disabled'});
  await assert.rejects(fetch(endpoint,request({thinking:{type:'disabled'},reasoning_effort:'high'})),/P2_PROTOCOL_CONFIG_REJECTED/);
  await fetch(endpoint,request({thinking:{type:'disabled'},reasoning_effort:undefined,stream:undefined}));
  assert.equal(calls,1);
});

test('reservation is durably present before network; completion includes reasoning exactly once', async t => {
  const directory=await temporaryRun(t);
  const fetch=guard(directory,async()=>{
    const before=await ledger(directory);
    assert.equal(before.entries.length,1);
    assert.equal(before.entries[0].state,'reserved');
    assert.equal(before.entries[0].chargedCny,before.entries[0].reservedCny);
    assert.equal(before.chargedUpperCny,before.entries[0].reservedCny);
    return reply({prompt_tokens:100,completion_tokens:80,prompt_cache_hit_tokens:90,completion_tokens_details:{reasoning_tokens:70}});
  });
  await fetch(endpoint,request());
  const entry=(await ledger(directory)).entries[0];
  assert.deepEqual(entry.usage,{inputTokens:100,outputTokens:80,cacheHitTokens:90});
  assert.equal(entry.chargedCny,charge(100,80));
  assert.equal(entry.usageKnown,true);
  assert.ok(entry.chargedCny<charge(100,150));
});

test('request count survives fresh guard instances and blocks before the 25th fetch', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fake=async()=>{calls++;return reply({prompt_tokens:0,completion_tokens:0});};
  for(let i=0;i<limits.requests;i++)await guard(directory,fake)(endpoint,request());
  await assert.rejects(guard(directory,fake,{phase:'resume'})(endpoint,request()),/P2_REQUEST_LIMIT/);
  assert.equal(calls,limits.requests);
  assert.equal((await ledger(directory)).entries.length,limits.requests);
});

test('unknown usage reservation survives a fresh guard and enforces the five-yuan budget', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fake=async()=>{calls++;return reply(null);};
  const large=request({messages:[{role:'user',content:'x'.repeat(60000)}]});
  await guard(directory,fake)(endpoint,large);
  const first=(await ledger(directory)).entries[0];
  assert.equal((await ledger(directory)).budgetCny,5);
  assert.ok(first.reservedCny>marker.budgetCny/2);
  assert.equal(first.chargedCny,first.reservedCny);
  await assert.rejects(guard(directory,fake,{phase:'resume'})(endpoint,large),/P2_BUDGET_LIMIT/);
  assert.equal(calls,1);
});

test('new ten-yuan runs persist their selected budget and stop before exceeding it', async t => {
  const directory=await temporaryRun(t,10);
  let calls=0;
  const fake=async()=>{calls++;return reply(null);};
  const large=request({messages:[{role:'user',content:'x'.repeat(60000)}]});
  for(let i=0;i<3;i++)await guard(directory,fake)(endpoint,large);
  const before=await ledger(directory);
  assert.equal(before.budgetCny,10);
  assert.ok(before.chargedUpperCny>5 && before.chargedUpperCny<10);
  await assert.rejects(guard(directory,fake,{phase:'resume'})(endpoint,large),/P2_BUDGET_LIMIT/);
  assert.equal(calls,3);
  assert.deepEqual(await ledger(directory),before);
});

test('changing a legacy five-yuan marker cannot promote its persisted ledger budget', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fake=async()=>{calls++;return reply(null);};
  await guard(directory,fake)(endpoint,request());
  const before=await readFile(path.join(directory,'budget.json'),'utf8');
  await writeFile(path.join(directory,'run.json'),JSON.stringify({...marker,budgetCny:10}));
  await assert.rejects(guard(directory,fake,{phase:'resume'})(endpoint,request()),/P2_LEDGER_INVALID/);
  assert.equal(calls,1);
  assert.equal(await readFile(path.join(directory,'budget.json'),'utf8'),before);
});

test('an elevated ledger cannot raise the budget of an unchanged five-yuan marker', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fake=async()=>{calls++;return reply(null);};
  await guard(directory,fake)(endpoint,request());
  const changed={...await ledger(directory),budgetCny:10};
  await writeFile(path.join(directory,'budget.json'),JSON.stringify(changed));
  await assert.rejects(guard(directory,fake,{phase:'resume'})(endpoint,request()),/P2_LEDGER_INVALID/);
  assert.equal(calls,1);
  assert.deepEqual(await ledger(directory),changed);
});

test('provider usage exceeding the declared output limit blocks every later fetch', async t => {
  const directory=await temporaryRun(t);
  let calls=0;
  const fake=async()=>{calls++;return reply({prompt_tokens:1,completion_tokens:129});};
  await guard(directory,fake)(endpoint,request());
  const after=await ledger(directory);
  assert.equal(after.budgetViolation,true);
  assert.equal(after.entries[0].state,'usage-limit-exceeded');
  await assert.rejects(guard(directory,fake,{phase:'resume'})(endpoint,request()),/P2_LEDGER_INVALID/);
  assert.equal(calls,1);
});

test('SSE usage settles only after consumption and preserves a hash across split UTF-8 chunks', async t => {
  const directory=await temporaryRun(t);
  const reasoning='合成 reasoning only';
  const fetch=guard(directory,async()=>sseResponse([
    {choices:[{delta:{reasoning_content:'合成 '}}]},
    {choices:[{delta:{reasoning_content:'reasoning only'}}]},
    {choices:[{delta:{tool_calls:[{id:'synthetic-call',function:{name:'lookup',arguments:'{}'}}]}}]},
    {choices:[],usage:{prompt_tokens:100,completion_tokens:50,completion_tokens_details:{reasoning_tokens:40}}},
  ]));
  const response=await fetch(endpoint,request({stream:true}));
  await response.text();
  const entry=(await ledger(directory)).entries[0];
  assert.equal(entry.state,'complete');
  assert.equal(entry.usageKnown,true);
  assert.equal(entry.chargedCny,charge(100,50));
  assert.deepEqual(entry.responseReasoning,{characters:reasoning.length,sha256:hash(reasoning)});
  assert.equal(entry.responseToolCalls,1);
});

test('missing or malformed SSE usage keeps the entire reservation', async t => {
  const directory=await temporaryRun(t);
  for(const malformed of [false,true]){
    const fetch=guard(directory,async()=>sseResponse([{choices:[{delta:{content:'Synthetic response'}}]}],{malformed}));
    await (await fetch(endpoint,request({stream:true}))).text();
  }
  for(const entry of (await ledger(directory)).entries){
    assert.equal(entry.chargedCny,entry.reservedCny);
    assert.equal(entry.usageKnown,undefined);
  }
});

test('HTTP errors expose a fixed safe error and keep the request reservation', async t => {
  const directory=await temporaryRun(t);
  const fetch=guard(directory,async()=>new Response('SYNTHETIC-PRIVATE-PROVIDER-DETAIL',{status:400}));
  const response=await fetch(endpoint,request());
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:{message:'P2_HTTP_400',type:'provider_error'}});
  const entry=(await ledger(directory)).entries[0];
  assert.equal(entry.state,'http-error');
  assert.equal(entry.chargedCny,entry.reservedCny);
});

test('ledger excludes key and request/response text while phase hashes prove reasoning continuity', async t => {
  const directory=await temporaryRun(t);
  const reasoning='SYNTHETIC-PRIVATE-REASONING-标记';
  const prompt='SYNTHETIC-PRIVATE-PROMPT';
  const answer='SYNTHETIC-PRIVATE-ANSWER';
  const fake=async()=>reply({prompt_tokens:10,completion_tokens:10},{content:answer,reasoning_content:reasoning});
  await guard(directory,fake,{phase:'suspend'})(endpoint,request({messages:[{role:'user',content:prompt}]}));
  await guard(directory,fake,{phase:'resume'})(endpoint,request({messages:[
    {role:'user',content:prompt},
    {role:'assistant',content:'',reasoning_content:reasoning,tool_calls:[{id:'synthetic-call',type:'function',function:{name:'synthetic_lookup',arguments:'{"synthetic":true}'}}]},
    {role:'tool',tool_call_id:'synthetic-call',content:'SYNTHETIC-PRIVATE-TOOL-RESULT'},
  ]}));
  const raw=await readFile(path.join(directory,'budget.json'),'utf8');
  for(const secret of [reasoning,prompt,answer,'SYNTHETIC-TEST-KEY-NOT-A-CREDENTIAL','SYNTHETIC-PRIVATE-TOOL-RESULT','authorization','reasoning_content'])assert.equal(raw.includes(secret),false,secret);
  const [paused,resumed]=JSON.parse(raw).entries;
  assert.equal(paused.phase,'suspend');
  assert.equal(resumed.phase,'resume');
  assert.equal(paused.responseReasoning.sha256,resumed.requestReasoning[0].sha256);
  assert.equal(paused.responseReasoning.sha256,hash(reasoning));
  assert.deepEqual(resumed.requestReasoning[0].toolCallIds,['synthetic-call']);
});
