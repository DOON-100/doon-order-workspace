import {commands,foundationCommands} from '../dist/catalog.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {serverConfig, StateStore, windowsCodec} from '../dist/state.js';
import {ApiClient, cookieSession} from '../dist/client.js';
import {FoundationService} from '../dist/service.js';
import {temporary, store, user, token, signed, cliSigned, session} from './helpers.mjs';

test('an export GET that archives output is not marked retryable after a lost response',async()=>{
 const config=serverConfig('https://employee.test',false);let calls=0;
 const client=new ApiClient(config,async(url,init)=>{calls++;assert.equal(new URL(url).pathname,'/api/workspace/customer-quote-template-export');assert.equal(init.method,'GET');assert.equal(init.headers.Origin,config.origin);throw Error('Synthetic lost response');});
 await assert.rejects(client.request('/api/workspace/customer-quote-template-export',session(config.origin),undefined,{query:{quoteId:'synthetic',quoteVersion:'1'}}),error=>error.code==='CONNECTION_FAILED'&&error.details.outcomeUnknown===true&&error.details.retryable===false);assert.equal(calls,1);
});

test('fixed logical handoff reads use GET on the existing dual-method URL',async()=>{
 const config=serverConfig('https://employee.test',false),client=new ApiClient(config,async(url,init)=>{assert.equal(new URL(url).pathname,'/api/workspace/ie-quote-handoff');assert.equal(init.method,'GET');return Response.json({handoff:{id:'synthetic'}});});
 assert.equal((await client.request('/api/workspace/ie-quote-handoff-read',session(config.origin),undefined,{query:{id:'synthetic'}})).data.handoff.id,'synthetic');
});

test('HTTPS origins, loopback-only opt-in, switching and credential origin binding', async () => {
  for (const url of ['http://employee.test', 'https://a:b@employee.test', 'https://employee.test/path', 'https://employee.test?q=1', 'https://employee.test#fragment']) assert.throws(() => serverConfig(url), {code: 'INVALID_SERVER'});
  assert.throws(() => serverConfig('http://192.168.1.10', true), {code: 'INVALID_SERVER'});
  assert.equal(serverConfig('http://127.0.0.1:12345', true).localHttp, true);
  const state = await store();
  await state.setup('https://employee.test/', false);
  await state.saveSession(session('https://employee.test'));
  assert.equal((await state.session(await state.config())).origin, 'https://employee.test');
  await assert.rejects(state.setup('https://other.test', false), {code: 'LOGOUT_REQUIRED'});
  await assert.rejects(state.session(serverConfig('https://other.test')), {code: 'INVALID_SESSION'});
  assert(!(await fs.readFile(path.join(state.directory, 'session.dpapi'), 'utf8')).includes(token));
  await state.clearSession(); await state.setup('https://other.test', false);
});

test('login reuses verified session, respects Origin, never returns or stores plaintext credentials', async () => {
  const state = await store(); await state.setup('https://employee.test', false);
  const calls = [];
  const client = new FoundationService(state, async (url, init) => {
    calls.push({url, init});
    if (url.endsWith('/session') && !init.headers.Cookie) return Response.json({user: null, cliSessionSupported: true});
    if (url.endsWith('/cli-login')) { assert.equal(init.headers.Origin, 'https://employee.test'); assert.equal(init.redirect, 'manual'); return cliSigned(); }
    assert.equal(init.headers.Cookie, 'doon_employee_cli_session=' + token); return Response.json({user});
  });
  const input = {username: 'synthetic', password: 'Synthetic-Only-Password!'};
  const result = await client.login(async origin => { assert.equal(origin, 'https://employee.test'); return input; });
  assert.equal(result.user.username, user.username); assert.equal(result.reused, false); assert.equal(input.password, '');
  assert.equal(result.loginPersistence, 'cli-90-days');
  assert(Date.parse(result.sessionExpiresAt) > Date.now() + 89 * 86400000);
  assert(!JSON.stringify(result).includes(token)); assert(!JSON.stringify(result).includes('Password'));
  assert.equal((await client.login(async () => { throw Error('Must not reprompt'); })).reused, true);
  assert.equal(calls.length, 3);
  assert(!String(await fs.readFile(path.join(state.directory, 'session.dpapi'))).includes(token));
});

test('legacy server capability probe avoids unsupported credential POST and reports the short session', async () => {
  const state = await store(); await state.setup('https://employee.test', false);
  const paths = [];
  const service = new FoundationService(state, async (url, init) => {
    paths.push(new URL(url).pathname);
    assert(!url.endsWith('/cli-login'), 'Old native servers return 401 for unknown auth routes');
    if (url.endsWith('/session') && !init.headers.Cookie) return Response.json({user: null});
    if (url.endsWith('/login')) return signed();
    return Response.json(url.endsWith('/health') ? {ok: true, service: 'Synthetic'} : url.endsWith('/review-mode') ? {readOnly: false} : {user});
  });
  const result = await service.login(async () => ({username: 'synthetic', password: 'Synthetic-Only!'}));
  assert.deepEqual(paths, ['/api/auth/session', '/api/auth/login']);
  assert.equal(result.loginPersistence, 'legacy-web-session');
  assert.match(result.loginNotice, /2.*12|12.*2/);
  const reused = await service.login(async () => { throw Error('Must preserve existing valid login'); });
  assert(reused.reused); assert.equal(reused.loginPersistence, 'legacy-web-session');
  assert.equal((await service.doctor()).loginPersistence, 'legacy-web-session');
});

test('server rollback between probe and login falls back on 404 only', async () => {
  const state = await store(); await state.setup('https://employee.test', false); const paths = [];
  const service = new FoundationService(state, async url => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/session')) return Response.json({user: null, cliSessionSupported: true});
    if (url.endsWith('/cli-login')) return new Response(null, {status: 404});
    return signed();
  });
  const result = await service.login(async () => ({username: 'synthetic', password: 'Synthetic-Only!'}));
  assert.deepEqual(paths, ['/api/auth/session', '/api/auth/cli-login', '/api/auth/login']);
  assert.equal(result.loginPersistence, 'legacy-web-session');
});

test('denied or ambiguous CLI login is never retried against the web login', async () => {
  for (const status of [401, 403, 429, 500]) {
    const state = await store(); await state.setup('https://employee.test', false); let calls = 0;
    const service = new FoundationService(state, async url => { if (url.endsWith('/session')) return Response.json({user: null, cliSessionSupported: true}); calls++; assert(url.endsWith('/cli-login')); return new Response(null, {status}); });
    await assert.rejects(service.login(async () => ({username: 'synthetic', password: 'Synthetic-Only!'})));
    assert.equal(calls, 1); assert.equal(await state.hasSession(), false);
  }
});

test('CLI credential validation enforces origin, cookie family, transport and absolute expiry', async () => {
  for (const origin of ['https://employee.test', 'http://127.0.0.1:12345']) {
    const secure = origin.startsWith('https:'), config = serverConfig(origin, !secure);
    const saved = cookieSession(cliSigned(user, secure).headers, config, 'cli');
    assert(saved.expiresAt > Date.now() + 89 * 86400000);
    const state = await store(); await state.setup(origin, !secure); await state.saveSession(saved);
    assert.equal((await state.session(config)).cookie, saved.cookie);
    let sent;
    await new ApiClient(config, async (_url, init) => { sent = init.headers.Cookie; return Response.json({user}); }).request('/api/auth/session', saved);
    assert.equal(sent, saved.cookie);
    await state.saveSession({...saved, expiresAt: Date.now() - 1});
    assert.equal(await state.session(config), null); assert.equal(await state.hasSession(), false);
    assert.throws(() => cookieSession(cliSigned(user, !secure).headers, config, 'cli'), {code: 'INVALID_RESPONSE'});
    assert.throws(() => cookieSession(signed(user, secure).headers, config, 'cli'), {code: 'INVALID_RESPONSE'});
  }
  const config = serverConfig('https://employee.test');
  for (const age of ['0', '-1', '7776001', 'Infinity']) {
    const headers = new Headers({'Set-Cookie': `doon_employee_cli_session=${token}; HttpOnly; Secure; Max-Age=${age}`});
    assert.throws(() => cookieSession(headers, config, 'cli'), {code: 'INVALID_RESPONSE'});
  }
  assert.throws(() => cookieSession(cliSigned().headers, config), {code: 'INVALID_RESPONSE'});
});

test('server revocation clears local session; forbidden does not silently destroy it; initial password state remains visible', async () => {
  const state = await store(); await state.setup('https://employee.test', false); await state.saveSession(session('https://employee.test'));
  await assert.rejects(new FoundationService(state, async () => Response.json({error: 'private remote data'}, {status: 403})).whoami(), {code: 'FORBIDDEN'});
  assert(await state.hasSession());
  const u = await new FoundationService(state, async () => Response.json({user: {...user, mustChange: true}})).whoami(); assert(u.mustChange);
  await assert.rejects(new FoundationService(state, async () => Response.json({user: null})).whoami(), {code: 'AUTH_REQUIRED'});
  assert.equal(await state.hasSession(), false);
});

test('locally expired session is removed before network access', async () => {
  const state = await store(); await state.setup('https://employee.test', false);
  await state.saveSession({...session('https://employee.test'), expiresAt: Date.now() - 1000});
  let called = false;
  await assert.rejects(new FoundationService(state, async () => { called = true; throw Error('Must not send expired token'); }).whoami(), {code: 'AUTH_REQUIRED'});
  assert.equal(called, false); assert.equal(await state.hasSession(), false);
});

test('logout failure keeps retryable local session; explicit local-only never claims server revocation', async () => {
  const state = await store(); await state.setup('https://employee.test', false); await state.saveSession(session('https://employee.test'));
  const client = new FoundationService(state, async () => { throw Error('Network failed'); });
  await assert.rejects(client.logout(), {code: 'CONNECTION_FAILED', details: {retryable: false, outcomeUnknown: true}});
  assert(await state.hasSession());
  assert.deepEqual(await client.logout(true), {localCleared: true, serverRevoked: false});
});

test('doctor checks only foundation routes, reports unknown build and unauthenticated state', async () => {
  const state = await store(); await state.setup('https://employee.test', false);
  const routes = [];
  const result = await new FoundationService(state, async url => {
    routes.push(new URL(url).pathname);
    return Response.json(url.endsWith('/health') ? {ok: true, service: 'Synthetic'} : {readOnly: false});
  }).doctor();
  assert.deepEqual(routes, ['/health', '/api/review-mode']);
  assert.equal(result.authenticated, false); assert.equal(result.serverBuild, null); assert.equal(result.businessCommandsAvailable, null); assert.equal(result.installedBusinessCommands, commands.length-foundationCommands.length);
});

test('limited errors, no automatic POST retries, timeout and bounded response', async () => {
  const cfg = serverConfig('https://employee.test'); let calls = 0;
  const api = new ApiClient(cfg, async () => { calls++; return new Response('do not echo this remote secret', {status: 429, headers: {'retry-after': '20'}}); });
  await assert.rejects(api.request('/api/auth/login', null, {password: 'never-print'}), error => error.code === 'RATE_LIMITED' && error.details.retryAfterSeconds === 20 && !error.message.includes('secret'));
  assert.equal(calls, 1);
  await assert.rejects(new ApiClient(cfg, async () => new Response('x'.repeat(65537), {headers: {'Content-Type': 'application/json'}})).request('/health'), {code: 'RESPONSE_TOO_LARGE'});
  await assert.rejects(new ApiClient(cfg, async () => new Response('<html>login</html>')).request('/health'), {code: 'INVALID_RESPONSE'});
  await assert.rejects(new ApiClient(cfg, async () => new Response('invalid json', {headers: {'Content-Type': 'application/json'}})).request('/api/auth/login'), error => error.code === 'INVALID_RESPONSE' && error.details.outcomeUnknown === true);
  const timeout = new ApiClient(cfg, async (_url, {signal}) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))), 10);
  await assert.rejects(timeout.request('/api/auth/login'), error => error.code === 'REQUEST_TIMEOUT' && error.details.outcomeUnknown === true);
});

test('requests from one invocation serialize and reject arbitrary routes', async () => {
  let active = 0, maximum = 0;
  const api = new ApiClient(serverConfig('https://employee.test'), async () => { active++; maximum = Math.max(maximum, active); await new Promise(r => setTimeout(r, 10)); active--; return Response.json({ok: true}); });
  await Promise.all(Array.from({length: 5}, () => api.request('/health')));
  assert.equal(maximum, 1);
  await assert.rejects(api.request('/api/workspace/backup'), {code: 'UNSUPPORTED_OPERATION'});
});

test('real redirect is not followed with password or cookie', async t => {
  let redirected = 0;
  const destination = http.createServer((_req, res) => { redirected++; res.end('unexpected'); });
  await new Promise(r => destination.listen(0, '127.0.0.1', r));
  const source = http.createServer((_req, res) => { res.writeHead(307, {Location: `http://127.0.0.1:${destination.address().port}/steal`}); res.end(); });
  await new Promise(r => source.listen(0, '127.0.0.1', r));
  t.after(() => { source.closeAllConnections(); source.close(); destination.close(); });
  const cfg = serverConfig(`http://127.0.0.1:${source.address().port}`, true);
  await assert.rejects(new ApiClient(cfg).request('/api/auth/login', null, {username: 'synthetic', password: 'Synthetic-Only!'}), {code: 'REDIRECT_REFUSED'});
  assert.equal(redirected, 0);
});

test('malformed/unsafe login cookie is not persisted', async () => {
  const state = await store(); await state.setup('https://employee.test', false);
  const wrong = new FoundationService(state, async () => Response.json({user}, {headers: {'Set-Cookie': `doon_employee_session=${token}; HttpOnly; Max-Age=43200`}}));
  await assert.rejects(wrong.login(async () => ({username: 'synthetic', password: 'Synthetic-Only!'})), {code: 'INVALID_RESPONSE'});
  assert.equal(await state.hasSession(), false);
});

test('actual Windows DPAPI roundtrip hides cookie on disk', {skip: process.platform !== 'win32'}, async () => {
  const state = new StateStore(await temporary(), windowsCodec); await state.setup('https://employee.test', false);
  await state.checkCredentialStore(); await state.saveSession(cookieSession(cliSigned().headers, await state.config(), 'cli'));
  const raw = await fs.readFile(path.join(state.directory, 'session.dpapi'), 'utf8'); assert(!raw.includes(token)); assert(!raw.includes('employee.test'));
  assert.equal((await state.session(await state.config())).cookie, 'doon_employee_cli_session=' + token);
  await state.clearSession();
});
