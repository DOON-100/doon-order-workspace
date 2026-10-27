import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readWriteInput, validateWriteInput} from '../dist/write-input.js';

const schema = {title: {type: 'string', required: true}, quantity: {type: 'number'}, details: {type: 'object', properties:{a:{type:'number'}}}};
test('write input is bounded, validated, and does not echo the payload', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doon-cli-write-test-'));
 try {
  const file = path.join(dir, 'input.json');
  await fs.writeFile(file, JSON.stringify({title: 'synthetic', quantity: 0, details: {a: 1}}));
  assert.deepEqual(await readWriteInput(file, schema), {title:'synthetic', quantity:0, details:{a:1}});
  for (const payload of ['{"title":"secret-value","unknown":1}', '{"title":123}', '{"quantity":1}', '[1]', '{']) {
   await fs.writeFile(file, payload);
   await assert.rejects(readWriteInput(file, schema), e => e.code === 'INVALID_INPUT' && !e.message.includes('secret-value'));
  }
  await fs.writeFile(file, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(readWriteInput(file, schema), e => e.code === 'INVALID_INPUT');
  await assert.rejects(readWriteInput(dir, schema), e => e.code === 'INVALID_INPUT');
  await fs.writeFile(file, Buffer.from([0xff]));
  await assert.rejects(readWriteInput(file, schema), e => e.code === 'INVALID_INPUT');
  assert.throws(() => validateWriteInput({title:'x', quantity:Infinity}, schema), e => e.code === 'INVALID_INPUT');
  assert.throws(() => validateWriteInput({details:{}}, {details:{type:'object'}}), {code:'INVALID_SCHEMA'});
  assert.throws(() => validateWriteInput({items:[]}, {items:{type:'array'}}), {code:'INVALID_SCHEMA'});
  assert.throws(() => validateWriteInput(JSON.parse('{"title":"x","__proto__":{}}'), schema), e => e.code === 'INVALID_INPUT');
 } finally { await fs.rm(dir, {recursive:true, force:true}); }
});


test('write transport requires a specifically registered route and reports uncertain results without retry', async () => {
 const {ApiClient} = await import('../dist/client.js');
 const {routes} = await import('../dist/routes.js');
 const config = {format:'doon-cli-config-v1', origin:'https://employee.test', localHttp:false};
 const session = {origin:config.origin, cookie:'doon_employee_session='+'X'.repeat(43), expiresAt:Date.now()+60000};
 const name = '/api/workspace/synthetic-test-write';
 let calls = 0;
 const api = new ApiClient(config, async (_url, init) => {
  calls++;
  assert.equal(init.method, 'POST'); assert.equal(init.headers.Origin, config.origin);
  return Response.json({ok:true});
 });
 await assert.rejects(api.request(name, session, {title:'synthetic'}), {code:'UNSUPPORTED_OPERATION'});
 routes[name] = {method:'POST', business:true};
 try {
  await assert.rejects(api.request(name, session), {code:'UNSUPPORTED_OPERATION'});
  assert.equal(calls, 0);
  routes[name] = {method:'POST', business:true, write:true};
  await assert.rejects(api.request(name, null, {}), {code:'AUTH_REQUIRED'});
  await assert.rejects(api.request(name, session, []), {code:'INVALID_INPUT'});
  await assert.rejects(api.request(name, session, {title:'x'.repeat(1024*1024)}), {code:'INVALID_INPUT'});
  assert.equal(calls, 0);
  assert.deepEqual((await api.request(name, session, {title:'synthetic'})).data, {ok:true});
  assert.equal(calls, 1);
  const failing = new ApiClient(config, async () => {calls++; throw Error('network');});
  await assert.rejects(failing.request(name, session, {title:'synthetic'}), e => e.code === 'CONNECTION_FAILED' && e.details.outcomeUnknown === true && e.details.retryable !== true);
  assert.equal(calls, 2);
  const limited = new ApiClient(config, async () => Response.json({}, {status:429}));
  await assert.rejects(limited.request(name, session, {}), e => e.code === 'RATE_LIMITED' && e.details.retryable === false);
  const conflict = new ApiClient(config, async () => Response.json({}, {status:409}));
  await assert.rejects(conflict.request(name, session, {}), {code:'CONFLICT'});
  const redirected = new ApiClient(config, async () => new Response(null, {status:302}));
  await assert.rejects(redirected.request(name, session, {}), e => e.code === 'REDIRECT_REFUSED' && e.details.outcomeUnknown === true);
 } finally { delete routes[name]; }
});


test('nested fields reject unexpected data and preserve exact numbers and booleans', () => {
 const spec = {details:{type:'object',required:true,properties:{qty:{type:'number',required:true,integer:true,min:0,max:100},kind:{type:'string',enum:['a','b']}}}, rows:{type:'array',max:2,items:{type:'object',properties:{label:{type:'string',required:true,min:1}}}}};
 assert.deepEqual(validateWriteInput({details:{qty:0,kind:'a'},rows:[{label:'x'}]}, spec), {details:{qty:0,kind:'a'},rows:[{label:'x'}]});
 for (const value of [{details:{qty:-1}}, {details:{qty:1.5}}, {details:{qty:1,extra:'secret'}}, {details:{qty:1,kind:'c'}}, {details:{qty:1},rows:[{label:''}]}, {details:{qty:1},rows:[{}, {}, {}]}])
  assert.throws(() => validateWriteInput(value, spec), {code:'INVALID_INPUT'});
});

test('write adapters bind version and token, never retry, and distinguish failed readback', async () => {
 const {executeWrite} = await import('../dist/write-operation.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-cli-operation-test-'));
 try {
  const file=path.join(dir,'input.json'); await fs.writeFile(file, JSON.stringify({title:'synthetic'}));
  let sent=0, reads=0;
  const adapter={schema:{title:{type:'string',required:true}},versionField:'version',tokenField:'token',
    async send(payload){sent++;assert.deepEqual(payload,{title:'synthetic',version:3,token:'synthetic-token'});return {id:'synthetic'};},
    async readBack(response){reads++;return {id:response.id,version:4};}};
  await assert.rejects(executeWrite(adapter,{file,version:0,token:'synthetic-token'}),{code:'INVALID_INPUT'});
  await assert.rejects(executeWrite(adapter,{file,version:3,token:'bad'}),{code:'INVALID_INPUT'});
  assert.equal(sent,0);
  assert.deepEqual(await executeWrite(adapter,{file,version:3,token:'synthetic-token'}),{id:'synthetic',version:4});
  assert.equal(sent,1); assert.equal(reads,1);
  const failure={...adapter,async readBack(){throw Error('private response');}};
  await assert.rejects(executeWrite(failure,{file,version:3,token:'synthetic-token'}),e=>e.code==='READBACK_FAILED' && e.details.outcomeUnknown===true && !e.message.includes('private response'));
  assert.equal(sent,2);
  const unknown={...adapter,async send(){sent++;throw Object.assign(Error('connection'),{code:'CONNECTION_FAILED'});}};
  await assert.rejects(executeWrite(unknown,{file,version:3,token:'synthetic-token'}),{code:'CONNECTION_FAILED'});
  assert.equal(sent,3); assert.equal(reads,1);
  await fs.writeFile(file,JSON.stringify({title:'synthetic',version:3}));
  await assert.rejects(executeWrite(adapter,{file,version:3,token:'synthetic-token'}),{code:'INVALID_INPUT'});
  assert.equal(sent,3);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});


test('synthetic HTTP write and scoped readback keep unrelated data intact', async () => {
 const http = await import('node:http');
 const {ApiClient} = await import('../dist/client.js');
 const {routes} = await import('../dist/routes.js');
 const {executeWrite} = await import('../dist/write-operation.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-cli-http-test-'));
 const pathName='/api/workspace/synthetic-http-write';
 let sends=0, version=1; const unrelated={id:'other',value:'preserve'}, state={id:'synthetic',title:'before'};
 const server=http.createServer(async (req,res)=>{
  if(req.method==='POST' && req.url===pathName){
   sends++;let text='';for await(const chunk of req)text+=chunk;
   const input=JSON.parse(text);assert.equal(input.version,1);assert.equal(input.token,'synthetic-token');
   state.title=input.title;version++;res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:state.id}));
  } else if(req.method==='GET' && req.url==='/api/workspace/customer-quotes') {
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({record:state,version}));
  } else res.writeHead(404).end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const origin=`http://127.0.0.1:${server.address().port}`;
  const cfg={format:'doon-cli-config-v1',origin,localHttp:true};
  const session={origin,cookie:'doon_session='+'X'.repeat(43),expiresAt:Date.now()+60000};
  const client=new ApiClient(cfg);routes[pathName]={method:'POST',business:true,write:true};
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({title:'after'}));
  const result=await executeWrite({schema:{title:{type:'string',required:true}},versionField:'version',tokenField:'token',
   async send(payload){return (await client.request(pathName,session,payload)).data;},
   async readBack(receipt){const data=(await client.request('/api/workspace/customer-quotes',session)).data;if(data.record.id!==receipt.id||data.version!==2)throw Error('Mismatch');return data;}
  },{file,version:1,token:'synthetic-token'});
  assert.deepEqual(result,{record:{id:'synthetic',title:'after'},version:2});assert.equal(sends,1);assert.deepEqual(unrelated,{id:'other',value:'preserve'});
 } finally {delete routes[pathName];await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});


test('write coverage inventory tracks all declared department navigation entries', async () => {
 const {root}=await import('./helpers.mjs');
 const navigation=await fs.readFile(path.join(root,'lib/department-workspace-navigation.ts'),'utf8');
 const section=navigation.split('const departmentRouteOrder:')[1]?.split('};')[0];
 assert(section,'Navigation declaration missing');
 const coverage=await fs.readFile(path.join(root,'docs/cli-write-coverage.md'),'utf8');
 const groups=['overview','sales','service','engineering','planning','purchasing','warehouse','production','quality','finance','management'];
 for(const group of groups){
  const entry=section.match(new RegExp('\\b'+group+':\\[([^\\]]+)\\]'));
  assert(entry,`Missing navigation group ${group}`);
  for(const match of entry[1].matchAll(/'([^']+)'/g))assert(coverage.includes('`'+match[1]+'`'),`Missing coverage entry ${match[1]}`);
 }
});
