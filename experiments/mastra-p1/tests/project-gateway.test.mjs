import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes, createHash} from 'node:crypto';
import {access, readFile, realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {createGatewaySyntheticState, createProjectGatewayLab, gatewayOrigins, validateGatewaySandbox} from '../project-gateway.mjs';

const json = response => JSON.parse(response.body);
const cookieOf = response => response.headers['set-cookie']?.[0]?.split(';')[0];
const sha = value => createHash('sha256').update(value).digest('hex');

test('real employee and supplier HTTP auth routes run only against a new synthetic gateway sandbox', async t => {
  const state = createGatewaySyntheticState(), before = structuredClone(state);
  const lab = await createProjectGatewayLab({state}); t.after(() => lab.close());
  const credential = actorId => lab.credentials.find(item => item.actorId === actorId);
  const login = (actorId, extra = {}) => lab.request('/api/auth/login', {method: 'POST', body: {username: credential(actorId).username, password: credential(actorId).password, ...extra}});
  const initial = await lab.inspect();
  let employeeCookie, adminCookie, supplierCookie, employeePassword, adminPassword;

  await t.test('five source modules are byte-identical; transport and workspace probe explicitly remain synthetic', async () => {
    assert.equal(path.dirname(lab.evidence.directory), await realpath(os.tmpdir()));
    assert.match(path.basename(lab.evidence.directory), /^doon-mastra-gateway-[A-Za-z0-9]+$/);
    assert.notEqual(lab.endpoint.loopbackPort, 8787);
    assert.equal(lab.evidence.tlsTested, false);
    assert.equal(lab.evidence.workspaceApi, 'readonly-identity-context-probe');
    assert.equal(initial.credentialEnvironmentAbsent, true);
    for (const [file, digest] of Object.entries(lab.evidence.sourceHashes)) {
      assert.equal(sha(await readFile(new URL('../../../standalone/' + file, import.meta.url))), digest);
      assert.equal(sha(await readFile(path.join(lab.evidence.directory, file))), digest);
    }
    assert.equal((await lab.request('/health')).status, 200);
    assert.equal(json(await lab.request('/api/review-mode')).syntheticOnly, true);
    await assert.rejects(lab.request('http://127.0.0.1:8787/health'), /GATEWAY_RELATIVE_ROUTE_REQUIRED/);
    assert.deepEqual(state, before);
  });

  await t.test('native anonymous session contract, CSRF and forwarded-header validation reject untrusted requests', async () => {
    const anonymous = await lab.request('/api/auth/session'); assert.equal(anonymous.status, 200); assert.equal(json(anonymous).user, null);
    assert.equal((await lab.request('/api/workspace/probe')).status, 401);
    for (const headers of [{origin: 'https://attacker.invalid'}, {origin: null}, {origin: 'null'}]) {
      const response = await lab.request('/api/auth/login', {method: 'POST', body: {username: credential('syn-employee-a').username, password: credential('syn-employee-a').password}, headers});
      assert.equal(response.status, 403); assert.equal(response.headers['set-cookie'], undefined);
    }
    for (const headers of [{host: 'attacker.invalid'}, {'x-forwarded-host': 'attacker.invalid'}, {'x-forwarded-host': null}, {'x-forwarded-proto': 'http'}, {'x-forwarded-for': '198.51.100.1, 127.0.0.1'}, {'x-forwarded-for': null}, {forwarded: 'for=198.51.100.1'}]) assert.equal((await lab.request('/health', {headers})).status, 403);
    assert.equal((await login('syn-disabled')).status, 401);
    assert.equal((await login('syn-supplier')).status, 401);
    assert.equal((await lab.request('/api/workspace/probe', {headers: {'x-user-id': credential('syn-gateway-admin').userId, 'x-member-id': 'syn-gateway-admin', authorization: 'Bearer syn-gateway-admin'}})).status, 401);
  });

  await t.test('real mustChange blocks workspace/history until native password route rotates the cookie', async () => {
    for (const actorId of ['syn-employee-a', 'syn-gateway-admin']) {
      const signed = await login(actorId); assert.equal(signed.status, 200); assert.equal(json(signed).user.mustChange, true);
      const initialCookie = cookieOf(signed), header = signed.headers['set-cookie'][0];
      assert.match(header, /^doon_employee_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure$/);
      assert.doesNotMatch(header, /Domain=/i);
      assert.equal((await lab.request('/api/workspace/probe', {headers: {cookie: initialCookie}})).status, 403);
      assert.equal((await lab.request('/api/auth/history', {headers: {cookie: initialCookie}})).status, 403);
      const password = randomBytes(24).toString('base64url');
      const changed = await lab.request('/api/auth/password', {method: 'POST', headers: {cookie: initialCookie}, body: {currentPassword: credential(actorId).password, password}});
      assert.equal(changed.status, 200);
      assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: initialCookie}})).user, null);
      const activeCookie = cookieOf(changed), current = json(await lab.request('/api/auth/session', {headers: {cookie: activeCookie}})).user;
      assert.equal(current.mustChange, false); assert.equal(current.identity.id, credential(actorId).userId);
      if (actorId === 'syn-employee-a') {employeeCookie = activeCookie; employeePassword = password;} else {adminCookie = activeCookie; adminPassword = password;}
    }
  });

  await t.test('verified credentials and AsyncLocalStorage determine the actor; extra identity fields do not override it', async () => {
    // Native login does not reject extra fields. Its security contract is that
    // these fields cannot replace the identity established by the password.
    const signed = await lab.request('/api/auth/login', {method: 'POST', body: {username: credential('syn-employee-a').username, password: employeePassword, actorId: 'syn-gateway-admin', employeeId: 'syn-gateway-admin', role: 'admin', admin: true}});
    assert.equal(signed.status, 200); assert.equal(json(signed).user.role, 'sales');
    const probe = await lab.request('/api/workspace/probe?actorId=syn-gateway-admin', {headers: {cookie: employeeCookie, 'x-user-id': credential('syn-gateway-admin').userId, 'x-actor-id': 'syn-gateway-admin'}});
    assert.equal(probe.status, 200);
    assert.deepEqual(json(probe), {syntheticOnly: true, identityProbe: true, actor: {id: 'syn-employee-a', name: '合成员工甲', role: 'sales'}, trustedIdentity: true});
    assert.equal((await lab.request('/api/workspace/probe', {method: 'POST', headers: {cookie: employeeCookie}, body: {approved: true}})).status, 405);
    for (const renamed of ['doon_session', 'doon_supplier_session']) assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: employeeCookie.replace('doon_employee_session', renamed)}})).user, null);
  });

  await t.test('native history route enforces administrator permission and records only safe authentication metadata', async () => {
    assert.equal((await lab.request('/api/auth/history', {headers: {cookie: employeeCookie, 'x-role': 'admin'}})).status, 403);
    const history = await lab.request('/api/auth/history', {headers: {cookie: adminCookie}}); assert.equal(history.status, 200);
    assert(json(history).events.some(item => item.event === 'login_success' && item.source === '员工 HTTPS 入口' && item.ip === '198.51.100.15'));
    assert(json(history).events.filter(item => item.event === 'login_failure').every(item => item.actor === '未认证访问者'));
    assert.doesNotMatch(history.body, /password_hash|token_hash|session_token/);
    for (const secret of [...lab.credentials.map(item => item.password), employeePassword, adminPassword, employeeCookie.split('=')[1]]) assert(!history.body.includes(secret));
    assert.equal((await lab.request('/api/auth/history?limit=201', {headers: {cookie: adminCookie}})).status, 400);
  });

  await t.test('same synthetic database preserves sessions while employee/supplier gateway namespaces remain isolated', async () => {
    await lab.switchGateway('supplier'); assert.notEqual(lab.endpoint.loopbackPort, 8787);
    assert.equal(lab.endpoint.publicOrigin, gatewayOrigins.supplier);
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: employeeCookie}})).user, null);
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: employeeCookie.replace('doon_employee_session', 'doon_supplier_session')}})).user, null);
    const employeeLogin = await lab.request('/api/auth/login', {method: 'POST', body: {username: credential('syn-employee-a').username, password: employeePassword}}); assert.equal(employeeLogin.status, 401);
    const supplier = await login('syn-supplier'); assert.equal(supplier.status, 200);
    assert.match(supplier.headers['set-cookie'][0], /^doon_supplier_session=.*; Secure$/);
    supplierCookie = cookieOf(supplier);
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: supplierCookie}})).user.role, 'supplier');
    assert.equal((await lab.request('/api/auth/history', {headers: {cookie: supplierCookie}})).status, 403);
    await lab.switchGateway('employee');
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: supplierCookie.replace('doon_supplier_session', 'doon_employee_session')}})).user, null);
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: employeeCookie}})).user.identity.id, credential('syn-employee-a').userId);
  });

  await t.test('current synthetic active status and native logout remove sessions; rejected CSRF cannot log a user out', async () => {
    assert.equal((await lab.request('/api/auth/logout', {method: 'POST', body: {}, headers: {cookie: employeeCookie, origin: 'https://attacker.invalid'}})).status, 403);
    assert(json(await lab.request('/api/auth/session', {headers: {cookie: employeeCookie}})).user);
    const signed = await lab.request('/api/auth/login', {method: 'POST', body: {username: credential('syn-employee-a').username, password: employeePassword}}), copied = cookieOf(signed);
    const member = state.records.find(row => row.id === 'syn-employee-a'); member.active = false;
    await lab.syncState();
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: copied}})).user, null);
    member.active = true; await lab.syncState();
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: employeeCookie}})).user, null);
    const logout = await lab.request('/api/auth/logout', {method: 'POST', body: {}, headers: {cookie: adminCookie}});
    assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Max-Age=0; Secure$/);
    assert.equal(json(await lab.request('/api/auth/session', {headers: {cookie: adminCookie}})).user, null);
    const again = await lab.request('/api/auth/login', {method: 'POST', body: {username: credential('syn-gateway-admin').username, password: adminPassword}});
    const history = json(await lab.request('/api/auth/history', {headers: {cookie: cookieOf(again)}}));
    assert(history.events.some(item => item.event === 'logout' && item.source === '员工 HTTPS 入口'));
    assert.equal((await lab.inspect()).sourceDigest, initial.sourceDigest);
    assert.deepEqual(state, before);
  });

  await t.test('cleanup waits for the owned listener and worker and removes the verified temporary tree', async () => {
    await validateGatewaySandbox(lab.evidence.directory);
    await lab.close();
    await assert.rejects(access(lab.evidence.directory), error => error.code === 'ENOENT');
    await assert.rejects(lab.request('/health'), /GATEWAY_UNAVAILABLE/);
  });
});

test('concurrent gateway switching and closing leaves no listener or temporary directory', async t => {
  const lab = await createProjectGatewayLab(); t.after(() => lab.close());
  const previousPort = lab.endpoint.loopbackPort;
  const [switched, closed] = await Promise.allSettled([lab.switchGateway('supplier'), lab.close()]);
  assert.equal(closed.status, 'fulfilled');
  assert.equal(switched.status, 'rejected');
  assert.match(switched.reason.message, /GATEWAY_UNAVAILABLE/);
  await assert.rejects(access(lab.evidence.directory), error => error.code === 'ENOENT');
  for (const port of new Set([previousPort, lab.endpoint.loopbackPort])) {
    const listening = await new Promise((resolve, reject) => {
      const socket = net.connect({host: '127.0.0.1', port});
      socket.once('connect', () => {socket.destroy(); resolve(true);});
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve(false) : reject(error));
      socket.setTimeout(2_000, () => {socket.destroy(); reject(new Error('OWNED_PORT_CHECK_TIMEOUT'));});
    });
    assert.equal(listening, false);
  }
});

test('a selected loopback port conflict fails without fallback and cleans the owned worker sandbox', async () => {
  // Test-only interception reserves exactly the freshly selected synthetic port.
  // The public controller never accepts a port, executable, database or origin.
  const builtin = createRequire(import.meta.url)('node:child_process');
  const originalFork = builtin.fork, blocker = net.createServer();
  let directory, selectedPort, forks = 0;
  let resolveListening, rejectListening;
  const listening = new Promise((resolve, reject) => {resolveListening = resolve; rejectListening = reject;});
  listening.catch(() => {});
  blocker.once('error', rejectListening);
  builtin.fork = (modulePath, args, options) => {
    forks++; directory = args[0]; selectedPort = Number(args[2]);
    assert.notEqual(selectedPort, 8787);
    blocker.listen(selectedPort, '127.0.0.1', resolveListening);
    return originalFork(modulePath, args, options);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(createProjectGatewayLab(), error => error.status === 503 && /GATEWAY_PORT_UNAVAILABLE/.test(error.message));
    await listening;
    assert.equal(forks, 1);
    assert.equal(blocker.address().port, selectedPort);
    await assert.rejects(access(directory), error => error.code === 'ENOENT');
  } finally {
    builtin.fork = originalFork; syncBuiltinESMExports();
    if (blocker.listening) await new Promise((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()));
  }
});

test('failed gateway switching stops the new child and rejects requests instead of reusing the old port', async t => {
  const lab = await createProjectGatewayLab(); t.after(() => lab.close());
  const builtin = createRequire(import.meta.url)('node:child_process');
  const originalFork = builtin.fork, blocker = net.createServer();
  let forks = 0;
  let resolveListening, rejectListening;
  const listening = new Promise((resolve, reject) => {resolveListening = resolve; rejectListening = reject;});
  listening.catch(() => {}); blocker.once('error', rejectListening);
  builtin.fork = (modulePath, args, options) => {
    forks++;
    assert.notEqual(Number(args[2]), 8787);
    blocker.listen(Number(args[2]), '127.0.0.1', resolveListening);
    return originalFork(modulePath, args, options);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(lab.switchGateway('supplier'), error => error.status === 503 && /GATEWAY_PORT_UNAVAILABLE/.test(error.message));
    await listening;
    assert.equal(forks, 1);
    await assert.rejects(lab.request('/health'), /GATEWAY_UNAVAILABLE/);
    await lab.close();
    await assert.rejects(access(lab.evidence.directory), error => error.code === 'ENOENT');
  } finally {
    builtin.fork = originalFork; syncBuiltinESMExports();
    if (blocker.listening) await new Promise((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()));
  }
});
