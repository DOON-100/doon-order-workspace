import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createSandbox, openSuggestionStore, removeSandbox, sandboxDigest} from '../sandbox.mjs';
import {startReadonlyServer} from '../server.mjs';
import {generateSyntheticSuggestions} from '../generate.mjs';

// These names label HTTP protocol simulations only. No installed WorkBuddy/Codex
// configuration, accounts, sessions, models, or external services are accessed.
const callers = ['workbuddy-http-simulator', 'codex-http-simulator'];
const attachmentKey = 'SYNTHETIC_ATTACHMENT_KEY_PRIVATE';
const attachmentContent = 'SYNTHETIC_ATTACHMENT_CONTENT_NOT_FOR_HTTP';
const sourceA = 'syn-order-a-overdue', sourceB = 'syn-order-b-overdue';

async function setup(t) {
  const state = createSyntheticState(), sourceBefore = structuredClone(state);
  const directory = await createSandbox();
  let reader, writer, server, digestBefore, recordsBefore;
  t.after(async () => {
    try {
      if (digestBefore) {
        assert.deepEqual(state, sourceBefore, 'the adversarial HTTP clients must not mutate source fixtures');
        assert.equal(reader.count(), 4, 'no request may create or delete a suggestion');
        assert.deepEqual([...reader.list('syn-employee-a'), ...reader.list('syn-employee-b')], recordsBefore);
        assert.equal(await sandboxDigest(directory), digestBefore, 'suggestion database bytes must remain unchanged');
        assert.equal(await readFile(path.join(directory, attachmentKey), 'utf8'), attachmentContent);
      }
    } finally {
      try {if (server) await server.close();}
      finally {
        try {reader?.close(); writer?.close();}
        finally {await removeSandbox(directory);}
      }
    }
  });
  const adapter = await createReadAdapter(state);
  reader = await openSuggestionStore(directory);
  writer = await openSuggestionStore(directory, {readOnly: false});
  server = await startReadonlyServer({adapter, store: reader});
  const endpoint = new URL(server.origin);
  assert.equal(endpoint.hostname, '127.0.0.1');
  assert.notEqual(endpoint.port, '8787');
  assert.equal(endpoint.protocol, 'http:');
  for (const actorId of ['syn-employee-a', 'syn-employee-b']) {
    await generateSyntheticSuggestions({origin: server.origin, adapter, store: writer, actorId});
  }
  await writeFile(path.join(directory, attachmentKey), attachmentContent, {encoding: 'utf8', flag: 'wx'});
  assert.deepEqual(state, sourceBefore);
  assert.equal(reader.count(), 4);
  recordsBefore = [...reader.list('syn-employee-a'), ...reader.list('syn-employee-b')];
  digestBefore = await sandboxDigest(directory);

  // Attack clients receive only HTTP methods and cookies, never the adapter/store.
  async function request(caller, route, {cookie, method = 'GET', json, headers = {}} = {}) {
    assert(callers.includes(caller));
    assert(route.startsWith('/') && !route.startsWith('//'));
    return fetch(server.origin + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: {'x-http-protocol-simulator': caller, ...(cookie ? {cookie} : {}), ...(json === undefined ? {} : {'content-type': 'application/json'}), ...headers},
      ...(json === undefined ? {} : {body: JSON.stringify(json)}),
    });
  }
  async function session(caller, employeeId) {
    const response = await request(caller, '/api/demo-session', {method: 'POST', json: {employeeId}});
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert(cookie);
    assert.deepEqual(await response.json(), {synthetic: true});
    return cookie;
  }
  const cookies = new Map();
  for (const caller of callers) cookies.set(caller, {a: await session(caller, 'syn-employee-a'), b: await session(caller, 'syn-employee-b')});
  return {request, session, cookies, directory};
}

async function denied(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_.*PRIVATE|SYNTHETIC_ATTACHMENT_CONTENT|SQLite format|createReadAdapter/);
}

test('01 protocol simulators: cross-customer reads return 404 and all cross-customer writes return 405', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a, b} = c.cookies.get(caller);
    const own = await (await c.request(caller, '/api/orders', {cookie: a})).json();
    assert.equal(own.items.length, 4);
    assert(own.items.every(item => item.id.startsWith('syn-order-a-')));
    await denied(await c.request(caller, '/api/orders/' + sourceB, {cookie: a}), 404);
    await denied(await c.request(caller, '/api/orders/' + sourceA, {cookie: b}), 404);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await denied(await c.request(caller, '/api/orders/' + sourceB, {cookie: a, method, json: {caller, id: sourceB, version: 1, stage: 'synthetic-overwrite'}}), 405);
    }
    const suggestions = await (await c.request(caller, '/api/suggestions', {cookie: a})).json();
    assert.equal(suggestions.items.length, 2);
    assert(suggestions.items.every(item => item.source.id.startsWith('syn-order-a-')));
    assert.doesNotMatch(JSON.stringify(suggestions), /syn-order-b-|SYNTHETIC_.*PRIVATE/);
  }
});

test('02 forged cookie/header/query/body identity is rejected; this is not a production login-authentication test', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller), name = a.slice(0, a.indexOf('='));
    for (const cookie of [`${name}=${'0'.repeat(64)}`, `${name}=syn-employee-b`, 'doon_session=synthetic-admin']) {
      await denied(await c.request(caller, '/api/orders', {cookie}), 401);
    }
    const forged = {authorization: 'Bearer synthetic-admin', 'x-actor-id': 'syn-employee-b', 'x-user-role': 'admin', 'oai-authenticated-user-id': 'syn-employee-b'};
    await denied(await c.request(caller, '/api/orders', {headers: forged}), 401);
    const withA = await (await c.request(caller, '/api/me', {cookie: a, headers: forged})).json();
    assert.equal(withA.id, 'syn-employee-a');
    for (const query of ['memberId=syn-employee-b', 'employeeId=syn-employee-b', 'role=admin', 'actorId=syn-employee-b']) {
      await denied(await c.request(caller, '/api/orders?' + query, {cookie: a}), 400);
    }
    for (const json of [{employeeId: 'syn-admin'}, {employeeId: 'syn-disabled'}, {employeeId: 'syn-supplier'}, {employeeId: 'syn-employee-a', role: 'admin'}, {employeeId: 'syn-employee-a', memberId: 'syn-employee-b'}]) {
      await denied(await c.request(caller, '/api/demo-session', {cookie: a, method: 'POST', json}), 400);
    }
  }
});

test('03 extra fields and duplicate queries fail closed; internal tool functions are not HTTP endpoints', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller);
    for (const route of ['/api/orders?limit=1&limit=50', '/api/orders?include=ownerEmail,extra,attachments', '/api/suggestions?status=approved', '/api/me?admin=true', '/api/orders/' + sourceA + '?fields=*']) {
      await denied(await c.request(caller, route, {cookie: a}), 400);
    }
    await denied(await c.request(caller, '/api/demo-session', {method: 'POST', json: {employeeId: 'syn-employee-a', input: {memberId: 'syn-employee-b'}, caller}}), 400);
    for (const route of ['/api/tools/readOrder', '/api/tools/record-synthetic-suggestion', '/api/recordSuggestion']) {
      await denied(await c.request(caller, route, {cookie: a}), 404);
      await denied(await c.request(caller, route, {cookie: a, method: 'POST', json: {caller, actorId: 'syn-employee-b', sourceId: sourceB}}), 405);
    }
  }
});

test('04 stale-version overwrite attempts are 405 because P1 writes are closed, not because production optimistic locking was tested', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller), before = await (await c.request(caller, '/api/orders/' + sourceA, {cookie: a})).json();
    assert.equal(before.version, 1);
    for (const version of [0, -1, 999]) {
      for (const method of ['POST', 'PUT', 'PATCH']) {
        await denied(await c.request(caller, '/api/orders/' + sourceA, {cookie: a, method, json: {caller, id: sourceA, version, expectedVersion: version, promisedDate: '2099-01-01'}}), 405);
      }
    }
    assert.deepEqual(await (await c.request(caller, '/api/orders/' + sourceA, {cookie: a})).json(), before);
  }
});

test('05 repeated writes and approvals: each protocol simulator receives 100 write refusals plus 100 approval refusals', {timeout: 30_000}, async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller), before = await (await c.request(caller, '/api/suggestions', {cookie: a})).json();
    const payload = {caller, token: 'syn-repeat-' + caller, sourceId: sourceA, sourceVersion: 1, approved: true};
    let refusals = 0;
    for (let index = 0; index < 100; index++) {
      for (const route of ['/api/suggestions', '/api/approve']) {
        await denied(await c.request(caller, route, {cookie: a, method: 'POST', json: payload}), 405);
        refusals++;
      }
    }
    assert.equal(refusals, 200);
    assert.deepEqual(await (await c.request(caller, '/api/suggestions', {cookie: a})).json(), before);
  }
});

test('06 forged approval/resume decisions cannot reach a P1 write endpoint; no production approval bypass guarantee is claimed', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller);
    for (const route of ['/api/approve', '/api/decline', '/api/workflows/resume', '/api/agent/approveToolCallGenerate', '/api/tools/createSyntheticTask']) {
      await denied(await c.request(caller, route, {cookie: a, method: 'POST', headers: {'x-approved': 'true', 'x-reviewer-role': 'admin'}, json: {caller, actorId: 'syn-employee-b', reviewerId: 'syn-admin', decision: 'approve', approved: true, requireApproval: false, runId: 'syn-forged-run', toolCallId: 'syn-forged-call', sourceId: sourceB}}), 405);
      await denied(await c.request(caller, route + '?approved=true', {cookie: a}), 404);
    }
  }
});

test('07 synthetic attachment and traversal downloads stay closed; this does not certify production attachment permissions', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller);
    const routes = [
      '/files/' + attachmentKey,
      '/api/attachments/' + attachmentKey,
      '/api/file?id=' + attachmentKey + '&orderId=' + sourceB,
      '/api/files?path=' + encodeURIComponent(path.join(c.directory, attachmentKey)),
      '/public/%2e%2e%2f' + attachmentKey,
      '/public/%2e%2e%2fpolicy.mjs',
      '/..%5c..%5c' + attachmentKey,
      '/api/orders/%2e%2e%2ffiles%2f' + attachmentKey,
    ];
    for (const route of routes) await denied(await c.request(caller, route, {cookie: a}), 404);
    const own = await (await c.request(caller, '/api/orders', {cookie: a})).json();
    assert.doesNotMatch(JSON.stringify(own), /attachmentKey|SYNTHETIC_ATTACHMENT_KEY_PRIVATE|SYNTHETIC_ATTACHMENT_CONTENT/);
  }
});

test('08 oversized/invalid paging and bulk-write payloads are refused without mutating records', async t => {
  // Page-size validation is not HTTP rate limiting, concurrency, or load testing.
  const c = await setup(t);
  for (const caller of callers) {
    const {a} = c.cookies.get(caller);
    for (const limit of ['51', '1000000', '1.5', '-1', '0', '', 'malformed', 'Infinity', 'NaN']) {
      await denied(await c.request(caller, '/api/orders?limit=' + limit, {cookie: a}), 400);
    }
    for (const cursor of ['malformed', 'e30.invalid-signature', 'x'.repeat(8192)]) {
      await denied(await c.request(caller, '/api/orders?cursor=' + encodeURIComponent(cursor), {cookie: a}), 400);
    }
    const valid = await c.request(caller, '/api/orders?limit=50', {cookie: a});
    assert.equal(valid.status, 200);assert.equal((await valid.json()).items.length, 4);
    const batch = Array.from({length: 51}, (_, index) => ({id: sourceB, version: 1, quantity: index + 1}));
    for (const route of ['/api/orders', '/api/orders/bulk', '/api/suggestions/bulk']) {
      await denied(await c.request(caller, route, {cookie: a, method: 'POST', json: {caller, items: batch}}), 405);
    }
  }
});

test('09 known demo limitation: either simulated client can openly choose employee B (200); real identity anti-forgery is NOT implemented', async t => {
  const c = await setup(t);
  for (const caller of callers) {
    // Intentionally public fixture selector: knowing a real employee's ID would
    // not be authentication. P1 must never be presented as production identity.
    const cookie = await c.session(caller, 'syn-employee-b');
    const me = await (await c.request(caller, '/api/me', {cookie})).json();
    assert.equal(me.id, 'syn-employee-b');assert.equal(me.synthetic, true);
    const orders = await (await c.request(caller, '/api/orders', {cookie})).json();
    assert.equal(orders.items.length, 4);
    assert(orders.items.every(order => order.id.startsWith('syn-order-b-')));
  }
});
