import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readWriteInput, validateWriteInput} from '../dist/write-input.js';

const schema = {title: {type: 'string', required: true}, quantity: {type: 'number'}, details: {type: 'object'}};
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
