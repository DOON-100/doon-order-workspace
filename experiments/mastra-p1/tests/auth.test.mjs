import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createSyntheticIdentity} from '../auth.mjs';
import {createSandbox, openSuggestionStore, removeSandbox, sandboxDigest} from '../sandbox.mjs';
import {startReadonlyServer, syntheticSession} from '../server.mjs';

const a = 'syn-employee-a', b = 'syn-employee-b';
const status = expected => error => error.status === expected;

async function setup(t, options = {}) {
  const state = createSyntheticState(), adapter = await createReadAdapter(state);
  const directory = await createSandbox(), store = await openSuggestionStore(directory);
  const auth = await createSyntheticIdentity({adapter, ...options});
  const server = await startReadonlyServer({adapter, store, identity: auth.identity});
  t.after(async () => {await server.close(); store.close(); await removeSandbox(directory);});
  const credential = actorId => auth.credentials.find(item => item.actorId === actorId);
  const login = actorId => syntheticSession(server.origin, credential(actorId));
  const request = (route, {cookie, method = 'GET', headers = {}, body, origin = server.origin} = {}) => fetch(server.origin + route, {
    method, headers: {...(cookie ? {cookie} : {}), ...(origin === null ? {} : {origin}), ...headers},
    ...(body === undefined ? {} : {body}), redirect: 'error',
  });
  const post = (route, body, options = {}) => request(route, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), ...options});
  return {state, adapter, directory, store, server, ...auth, credential, login, request, post};
}

test('synthetic provisioning is private and random; trusted identity is required and public demo selection is closed', async t => {
  const c = await setup(t), before = structuredClone(c.state), digest = await sandboxDigest(c.directory);
  const second = await createSyntheticIdentity({adapter: c.adapter});
  t.after(() => second.identity.close());
  assert.equal(c.credentials.length, 4);
  assert.equal(new Set(c.credentials.map(item => item.username)).size, 4);
  assert.equal(new Set(c.credentials.map(item => item.password)).size, 4);
  assert(c.credentials.every(item => item.username !== second.credentials.find(other => other.actorId === item.actorId).username));
  await assert.rejects(startReadonlyServer({adapter: c.adapter, store: c.store}), /必须显式/);
  for (const route of ['/api/me', '/api/orders', '/api/suggestions']) assert.equal((await c.request(route)).status, 401);
  assert.equal((await c.post('/api/demo-session', {employeeId: b})).status, 404);
  assert.equal((await c.post('/api/session', {username: a, password: a})).status, 401);
  for (const route of ['/', '/app.js', '/health']) {
    const body = await (await c.request(route)).text();
    for (const item of c.credentials) {assert(!body.includes(item.username)); assert(!body.includes(item.password));}
  }
  assert.deepEqual(c.state, before);
  assert.equal(await sandboxDigest(c.directory), digest);
});

test('correct A/B credentials issue HttpOnly strict cookies and separate customer DTOs without leaking credentials', async t => {
  const c = await setup(t), {username, password} = c.credential(a);
  const response = await c.post('/api/session', {username, password});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {synthetic: true});
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /; HttpOnly; SameSite=Strict; Path=\/; Max-Age=900$/);
  const cookieA = setCookie.split(';')[0], cookieB = await c.login(b);
  assert.notEqual(cookieA, cookieB);
  const me = await (await c.request('/api/me', {cookie: cookieA})).json();
  assert.deepEqual(Object.keys(me).sort(), ['id', 'name', 'role', 'sessionExpiresAt', 'synthetic'].sort());
  assert.equal(me.id, a); assert.equal(me.role, 'sales'); assert(Number.isInteger(me.sessionExpiresAt));
  assert.equal(c.server.resolveSession(cookieA).id, a);
  for (const [cookie, own, foreign] of [[cookieA, 'a', 'b'], [cookieB, 'b', 'a']]) {
    const list = await (await c.request('/api/orders', {cookie})).json();
    assert.equal(list.items.length, 4);
    assert(list.items.every(item => item.id.startsWith(`syn-order-${own}-`)));
    assert.doesNotMatch(JSON.stringify(list), /PRIVATE|ownerEmail|attachmentKey|password|username/);
    assert.equal((await c.request(`/api/orders/syn-order-${foreign}-normal`, {cookie})).status, 404);
  }
  for (const actorId of ['syn-disabled', 'syn-supplier']) {
    const {username, password} = c.credential(actorId);
    assert.equal((await c.post('/api/session', {username, password})).status, 403);
  }
});

test('strict login schema and server-bound cookie reject fabricated identity, headers, query and body overrides', async t => {
  const c = await setup(t), cookie = await c.login(a), credential = c.credential(a);
  for (const extra of [{employeeId: b}, {actorId: b}, {admin: true}, {role: 'admin'}, {memberId: b}]) {
    assert.equal((await c.post('/api/session', {username: credential.username, password: credential.password, ...extra})).status, 400);
  }
  for (const payload of [null, [], {}, {username: credential.username}, {username: {}, password: 'x'}]) {
    assert.equal((await c.post('/api/session', payload)).status, 400);
  }
  assert.equal((await c.request('/api/session', {method: 'POST', headers: {'content-type': 'text/plain'}, body: '{}'})).status, 415);
  assert.equal((await c.request('/api/session', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{'})).status, 400);
  assert.equal((await c.post('/api/session', {username: credential.username, password: 'x'.repeat(2_048)})).status, 413);
  assert.equal((await c.post('/api/session?employeeId=' + b, {username: credential.username, password: credential.password})).status, 400);
  const name = cookie.split('=')[0];
  for (const fake of [name + '=' + b, name + '=' + 'A'.repeat(43), cookie + '; ' + cookie]) {
    assert.equal((await c.request('/api/me', {cookie: fake})).status, 401);
    assert.throws(() => c.server.resolveSession(fake), status(401));
  }
  assert.throws(() => c.server.resolveSession(a), status(401));
  const headers = {'x-actor-id': b, 'x-employee-id': b, 'x-user-id': b, authorization: 'Bearer ' + b};
  assert.equal((await c.request('/api/me', {headers})).status, 401);
  assert.equal((await (await c.request('/api/me', {cookie, headers})).json()).id, a);
  assert.equal((await c.request('/api/orders?memberId=' + b, {cookie})).status, 400);
  assert.equal((await c.post('/api/orders', {employeeId: b, admin: true}, {cookie})).status, 405);
});

test('expiry and logout invalidate copied tokens; expiry metadata is server-derived', async t => {
  let clock = Date.UTC(2026, 9, 16);
  const c = await setup(t, {now: () => clock, sessionTtlMs: 1_000}), cookie = await c.login(a);
  assert.equal(c.server.resolveSession(cookie).sessionExpiresAt, clock + 1_000);
  clock += 1_000;
  assert.equal((await c.request('/api/me', {cookie})).status, 401);
  assert.throws(() => c.server.resolveSession(cookie), status(401));
  const fresh = await c.login(a);
  const logout = await c.post('/api/logout', {}, {cookie: fresh});
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0$/);
  assert.equal((await c.request('/api/orders', {cookie: fresh})).status, 401);
  assert.throws(() => c.server.resolveSession(fresh), status(401));
  assert.equal((await c.post('/api/logout', {}, {cookie: fresh})).status, 200);
  assert.equal((await c.request('/api/me', {cookie: await c.login(a)})).status, 200);
});

test('trusted account revocation clears every token and prevents subsequent credential login', async t => {
  const c = await setup(t), first = await c.login(a), second = await c.login(a), other = await c.login(b);
  c.identity.revokeActor(a);
  for (const cookie of [first, second]) {
    assert.equal((await c.request('/api/me', {cookie})).status, 401);
    assert.throws(() => c.server.resolveSession(cookie), status(401));
  }
  const {username, password} = c.credential(a);
  assert.equal((await c.post('/api/session', {username, password})).status, 403);
  assert.equal((await c.request('/api/me', {cookie: other})).status, 200);
});

test('every request revalidates active state and fixed sales role; admin/finance/supplier cannot broaden a session', async t => {
  const c = await setup(t), actor = c.state.records.find(record => record.id === a);
  for (const role of ['admin', 'finance', 'supplier']) {
    const cookie = await c.login(a);
    actor.role = role;
    assert.equal((await c.request('/api/orders', {cookie})).status, 403);
    assert.equal((await c.request('/api/me', {cookie})).status, 401);
    const {username, password} = c.credential(a);
    assert.equal((await c.post('/api/session', {username, password})).status, 403);
    actor.role = 'sales';
    assert.equal((await c.request('/api/me', {cookie})).status, 401);
  }
  const cookie = await c.login(a);
  actor.active = false;
  assert.equal((await c.request('/api/me', {cookie})).status, 403);
  actor.active = true;
  assert.equal((await c.request('/api/me', {cookie})).status, 401);
});

test('current customer scope is evaluated on every read without reconstructing the authenticated session', async t => {
  const c = await setup(t), cookie = await c.login(a);
  assert.equal((await c.request('/api/orders/syn-order-a-normal', {cookie})).status, 200);
  const actor = c.state.records.find(record => record.id === a);
  actor.customers = []; actor.email = 'syn-revoked@example.invalid';
  assert.equal((await c.request('/api/me', {cookie})).status, 200);
  assert.deepEqual((await (await c.request('/api/orders', {cookie})).json()).items, []);
  assert.equal((await c.request('/api/orders/syn-order-a-normal', {cookie})).status, 404);
});

test('server restart rejects old token even when it is renamed to the new port cookie', async t => {
  const c = await setup(t), old = await c.login(a), oldToken = old.slice(old.indexOf('=') + 1);
  await c.server.close();
  const nextAuth = await createSyntheticIdentity({adapter: c.adapter});
  const next = await startReadonlyServer({adapter: c.adapter, store: c.store, identity: nextAuth.identity});
  t.after(() => next.close());
  const fresh = await syntheticSession(next.origin, nextAuth.credentials.find(item => item.actorId === a));
  const renamedOld = fresh.split('=')[0] + '=' + oldToken;
  const response = await fetch(next.origin + '/api/me', {headers: {cookie: renamedOld, origin: next.origin}, redirect: 'error'});
  assert.equal(response.status, 401);
  assert.throws(() => next.resolveSession(renamedOld), status(401));
  assert.equal(next.resolveSession(fresh).id, a);
});

test('failed logins are rate-limited by actual transport peer, including rotated usernames and forged forwarding headers', async t => {
  let clock = Date.UTC(2026, 9, 16);
  const c = await setup(t, {now: () => clock, maxFailures: 3, rateWindowMs: 1_000});
  for (let index = 0; index < 3; index++) {
    assert.equal((await c.post('/api/session', {username: 'guessed-' + index, password: 'wrong'})).status, 401);
  }
  const {username, password} = c.credential(a);
  const limited = await c.post('/api/session', {username, password}, {headers: {'content-type': 'application/json', 'x-forwarded-for': '192.0.2.55', 'x-real-ip': '192.0.2.56'}});
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '1');
  assert.equal((await c.post('/api/session', {username: 'another', password: 'wrong'})).status, 429);
  clock += 1_000;
  assert.equal((await c.post('/api/session', {username, password})).status, 200);
});

test('login/logout require exact Origin and rejected cross-site requests cannot replace or end a session', async t => {
  const c = await setup(t), cookie = await c.login(a), {username, password} = c.credential(b);
  for (const origin of [null, 'https://attacker.invalid', 'null']) {
    assert.equal((await c.post('/api/session', {username, password}, {cookie, origin})).status, 403);
    assert.equal((await c.post('/api/logout', {}, {cookie, origin})).status, 403);
  }
  assert.equal((await c.request('/api/me', {cookie, origin: 'https://attacker.invalid'})).status, 403);
  // fetch normalizes Host; raw HTTP is needed to actually send the forged value.
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(c.server.origin + '/api/me', {headers: {cookie, origin: c.server.origin, host: 'attacker.invalid'}}, res => {res.resume(); res.on('end', () => resolve(res.statusCode));});
    req.on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await (await c.request('/api/me', {cookie})).json()).id, a);
  assert.equal((await c.post('/api/logout', {employeeId: b}, {cookie})).status, 400);
  assert.equal((await c.request('/api/me', {cookie})).status, 200);
});
