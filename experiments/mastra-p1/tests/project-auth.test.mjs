import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash, randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {access, link, mkdtemp, readFile, realpath, rm, unlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createProjectIdentity, validateProjectAuthSandbox, removeProjectAuthSandbox} from '../project-auth.mjs';

const a = 'syn-employee-a', b = 'syn-employee-b';
const hasStatus = expected => error => error.status === expected;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const loginInput = credential => ({username: credential.username, password: credential.password});

test('project auth validates synthetic provenance before starting any worker', async () => {
  const state = createSyntheticState(), adapter = await createReadAdapter(state);
  for (const mutate of [
    value => {value.records.find(row => row.id === a).privateMarker = 'unmarked';},
    value => {value.records.find(row => row.id === a).id = 'business-member';},
    value => {value.records.find(row => row.kind === 'customer_account').notes = 'not-synthetic';},
    value => {value.records.push(structuredClone(value.records.find(row => row.id === a)));},
  ]) {
    const changed = structuredClone(state); mutate(changed);
    await assert.rejects(createProjectIdentity({state: changed, adapter}), /SYNTHETIC_/);
  }
  await assert.rejects(validateProjectAuthSandbox(path.join(os.tmpdir(), 'not-an-auth-sandbox')), /AUTH_SANDBOX_PATH/);
});

test('failed worker spawn emitting error and close without exit rejects promptly and removes its sandbox', async t => {
  const state = createSyntheticState(), adapter = await createReadAdapter(state);
  const childProcess = createRequire(import.meta.url)('node:child_process'), originalFork = childProcess.fork;
  let directory, timer, calls = 0;
  t.after(async () => {
    clearTimeout(timer);
    if (directory) {
      try {await access(directory);} catch (error) {if (error.code === 'ENOENT') return; throw error;}
      await removeProjectAuthSandbox(directory);
    }
  });
  // Test-local builtin binding replacement only. No arbitrary execPath or fork
  // option is added to the application constructor, and no process is started.
  childProcess.fork = (worker, args, options) => {
    calls++;
    assert.match(worker, /project-auth-worker\.mjs$/);
    assert.equal(options.execPath, process.execPath);
    directory = args[0];
    const failed = new EventEmitter();
    failed.connected = false;
    failed.kill = () => false;
    queueMicrotask(() => {
      failed.emit('error', Object.assign(new Error('Synthetic spawn failure'), {code: 'ENOENT'}));
      failed.emit('close', -1, null);
    });
    return failed;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(Promise.race([
      createProjectIdentity({state, adapter}),
      new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('AUTH_SPAWN_CLEANUP_TIMEOUT')), 3_000);}),
    ]), hasStatus(503));
    assert.equal(calls, 1);
    await assert.rejects(access(directory), error => error.code === 'ENOENT');
  } finally {
    clearTimeout(timer);
    childProcess.fork = originalFork;
    syncBuiltinESMExports();
  }
});

test('loss of the private parent IPC closes the worker database and removes its synthetic sandbox', async t => {
  const state = createSyntheticState();
  state.records = state.records.filter(row => row.kind !== 'member' || row.id === a);
  const adapter = await createReadAdapter(state);
  const auth = await createProjectIdentity({state, adapter, testOnly: true});
  t.after(() => auth.identity.close());
  // Disconnect is the same worker event emitted when its parent process exits.
  await auth.testControl.disconnectWorker();
  await assert.rejects(access(auth.evidence.directory), error => error.code === 'ENOENT');
  await assert.rejects(auth.identity.resolveSession('A'.repeat(43)), hasStatus(503));
  await auth.identity.close();
});

test('unmodified project authentication runs only in a private synthetic worker', async t => {
  const state = createSyntheticState(), template = state.records.find(row => row.id === a);
  const extraRoles = ['admin', 'clerk', 'viewer', 'finance', 'pmc', 'production', 'programmer'];
  for (const role of extraRoles) state.records.push({...structuredClone(template), id: 'syn-' + role, userId: 'syn-' + role + '-user', email: 'syn-' + role + '@example.invalid', role, name: '合成 ' + role});
  const before = structuredClone(state), adapter = await createReadAdapter(state);
  const {identity, credentials, evidence, testControl} = await createProjectIdentity({state, adapter, testOnly: true});
  t.after(() => identity.close());
  const credential = actorId => credentials.find(item => item.actorId === actorId);
  const login = actorId => identity.login(loginInput(credential(actorId)), '127.0.0.1');
  let primary;

  await t.test('source bytes match the checkout; only marked member/customer fixtures seed the temporary database', async () => {
    assert.equal(path.dirname(evidence.directory), await realpath(os.tmpdir()));
    assert.match(path.basename(evidence.directory), /^doon-mastra-auth-[A-Za-z0-9]+$/);
    for (const name of ['auth.mjs', 'runtime.mjs']) {
      const original = await readFile(new URL('../../../standalone/' + name, import.meta.url));
      assert.equal(sha(original), evidence.sourceHashes[name]);
      assert.deepEqual(await readFile(path.join(evidence.directory, name)), original);
    }
    const inspected = await testControl.inspect();
    assert.deepEqual(inspected.importedSources, ['auth.mjs', 'runtime.mjs']);
    assert.equal(inspected.credentialEnvironmentAbsent, true);
    assert.equal(inspected.accountCount, 11);
    assert.equal(inspected.sessionCount, 0);
    assert.deepEqual(state, before);
    assert.equal(credentials.length, 11);
    assert.equal(new Set(credentials.map(item => item.username)).size, 11);
    assert.equal(new Set(credentials.map(item => item.password)).size, 11);
  });

  await t.test('first-password flow uses project login/changePassword and revokes the initial session for every active internal account', async () => {
    const {initialPasswordChecks} = await testControl.inspect();
    assert.equal(initialPasswordChecks.length, 9);
    assert(initialPasswordChecks.every(item => item.initialChangeRequired && item.oldSessionRevoked && item.completed));
  });

  await t.test('real password verification permits all current internal roles and rejects disabled/supplier/forged input', async () => {
    primary = await login(a);
    assert.deepEqual(Object.keys(primary).sort(), ['actor', 'token']);
    assert.deepEqual(Object.keys(primary.actor).sort(), ['id', 'name', 'role', 'sessionExpiresAt'].sort());
    assert.equal(primary.actor.id, a);
    assert.equal(primary.actor.role, 'sales');
    assert(primary.actor.sessionExpiresAt <= Date.now() + 2 * 3_600_000);
    for (const role of extraRoles) assert.equal((await login('syn-' + role)).actor.role, role);
    assert.equal((await login(b)).actor.id, b);
    for (const actorId of ['syn-disabled', 'syn-supplier']) await assert.rejects(login(actorId), hasStatus(401));
    await assert.rejects(identity.login({username: a, password: a}), hasStatus(401));
    await assert.rejects(identity.login({...loginInput(credential(a)), actorId: b}), hasStatus(400));
    await assert.rejects(identity.resolveSession(a), hasStatus(401));
    await assert.rejects(identity.resolveSession('A'.repeat(43)), hasStatus(401));
    assert.doesNotMatch(JSON.stringify(primary.actor), /password|hash|username|userId|email/);
  });

  await t.test('project session digest is bound to its private cookie namespace', async () => {
    assert.deepEqual(await testControl.checkCookieBinding(primary.token), {valid: true, otherNamespaceAccepted: false});
  });

  await t.test('real SQLite sessions survive worker restart and then enforce absolute and idle expiration', async () => {
    await testControl.restartWorker();
    assert.equal((await identity.resolveSession(primary.token)).id, a);
    await testControl.expireSession(primary.token, 'absolute');
    await assert.rejects(identity.resolveSession(primary.token), hasStatus(401));
    const idle = await login(a);
    await testControl.expireSession(idle.token, 'idle');
    await assert.rejects(identity.resolveSession(idle.token), hasStatus(401));
    primary = await login(a);
  });

  await t.test('project password change invalidates every old session and old password', async () => {
    const other = await login(a), password = randomBytes(24).toString('base64url');
    const changed = await testControl.changePassword(primary.token, credential(a).password, password);
    for (const token of [primary.token, other.token]) await assert.rejects(identity.resolveSession(token), hasStatus(401));
    await assert.rejects(login(a), hasStatus(401));
    const signed = await identity.login({username: credential(a).username, password});
    assert.equal(signed.actor.id, a);
    assert.equal((await identity.resolveSession(changed.token)).id, a);
    primary = signed;
  });

  await t.test('every resolve synchronizes current synthetic permissions and disabled status without changing the source fixture', async () => {
    const member = state.records.find(row => row.id === a), saved = structuredClone(member);
    member.customers = []; member.email = 'syn-revoked@example.invalid';
    assert.equal((await identity.resolveSession(primary.token)).id, a);
    assert.deepEqual(adapter.listOrders(a).items, []);
    assert.throws(() => adapter.getOrder(a, 'syn-order-a-normal'), hasStatus(404));
    member.role = 'viewer';
    assert.equal((await identity.resolveSession(primary.token)).role, 'viewer');
    member.active = false;
    await assert.rejects(identity.resolveSession(primary.token), hasStatus(401));
    Object.assign(member, saved);
    await assert.rejects(identity.resolveSession(primary.token), hasStatus(401));
    assert.deepEqual(state, before);
  });

  await t.test('logout and persistent trusted revocation invalidate tokens while leaving unrelated accounts available', async () => {
    const first = await login(b), second = await login(b);
    await identity.logout(first.token);
    await assert.rejects(identity.resolveSession(first.token), hasStatus(401));
    assert.equal((await identity.resolveSession(second.token)).id, b);
    await identity.revokeActor(b);
    await assert.rejects(identity.resolveSession(second.token), hasStatus(401));
    await assert.rejects(login(b), hasStatus(401));
    await testControl.restartWorker();
    await assert.rejects(login(b), hasStatus(401));
    assert.equal((await login('syn-viewer')).actor.role, 'viewer');
  });

  await t.test('native login attempt table enforces the project limit and native history excludes credentials', async () => {
    const person = credential('syn-clerk');
    for (let index = 0; index < 8; index++) await assert.rejects(identity.login({username: person.username, password: 'Synthetic-Wrong-Password!'}), hasStatus(401));
    await assert.rejects(login('syn-clerk'), hasStatus(429));
    const history = await testControl.history();
    assert(history.events.some(item => item.event === 'login_success'));
    assert(history.events.some(item => item.event === 'logout'));
    assert(history.events.some(item => item.reason === 'rate_limited'));
    assert(history.events.filter(item => item.event === 'login_failure').every(item => item.actor === '未认证访问者'));
    const text = JSON.stringify(history);
    for (const item of credentials) assert(!text.includes(item.password));
    assert.doesNotMatch(text, /password_hash|token_hash|session_token/);
    assert(!text.includes('Synthetic-Wrong-Password!'));
    assert.deepEqual(state, before);
  });

  await t.test('sandbox refuses copied source tampering and hardlinked files before reopening or deleting', async () => {
    const copied = path.join(evidence.directory, 'auth.mjs'), original = await readFile(copied);
    await writeFile(copied, Buffer.concat([original, Buffer.from('\n// synthetic tamper check\n')]));
    await assert.rejects(validateProjectAuthSandbox(evidence.directory), /AUTH_SOURCE_HASH_MISMATCH/);
    await writeFile(copied, original);
    const unrelated = await mkdtemp(path.join(await realpath(os.tmpdir()), 'doon-auth-hardlink-check-'));
    const target = path.join(unrelated, 'synthetic.txt'), linked = path.join(evidence.directory, 'data', 'untrusted-sidecar');
    await writeFile(target, 'SYNTHETIC-HARDLINK-TARGET', {flag: 'wx'});
    try {
      await link(target, linked);
      await assert.rejects(validateProjectAuthSandbox(evidence.directory), /AUTH_SANDBOX_REDIRECT/);
      await unlink(linked);
      assert.equal(await readFile(target, 'utf8'), 'SYNTHETIC-HARDLINK-TARGET');
    } finally {
      await unlink(linked).catch(error => {if (error.code !== 'ENOENT') throw error;});
      // This exact test-owned direct temporary child contains only the synthetic file.
      assert.equal(path.dirname(unrelated), await realpath(os.tmpdir()));
      assert.match(path.basename(unrelated), /^doon-auth-hardlink-check-[A-Za-z0-9]+$/);
      await rm(unrelated, {recursive: true});
    }
    await validateProjectAuthSandbox(evidence.directory);
  });

  await t.test('closing awaits the child and removes only the validated auth sandbox', async () => {
    await identity.close();
    await assert.rejects(access(evidence.directory), error => error.code === 'ENOENT');
    await assert.rejects(identity.resolveSession('A'.repeat(43)), hasStatus(401));
  });
});
