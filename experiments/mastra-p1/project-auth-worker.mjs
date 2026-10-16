import {randomBytes, createHash} from 'node:crypto';
import {isIP} from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectAuthSnapshot, validateProjectAuthSandbox, removeProjectAuthSandbox} from './project-auth.mjs';

const directory = process.argv[2];
let runtime, auth, marker, stopping = false, preserve = false;
let ready;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
function fail(code, status = 400) {throw Object.assign(new Error(code), {code, status});}
function options() {return {cookieName: marker.cookieName, employeeOnly: true, recordHistory: true};}
const hash = value => createHash('sha256').update(value).digest('hex');
const sessionDigest = token => hash(marker.cookieName + '|' + token);
const revokedKey = actorId => 'mastra_revoked_' + actorId;
function isRevoked(actorId) {return !!runtime.db.prepare('SELECT value FROM local_meta WHERE key=?').get(revokedKey(actorId));}
function request(token, name = marker.cookieName) {return new Request('http://127.0.0.1/', {headers: {cookie: name + '=' + token}});}
function currentSession(token) {return typeof token === 'string' && tokenPattern.test(token) ? auth.session(request(token), options()) : null;}
function tokenOf(cookie) {const token = cookie.slice(cookie.indexOf('=') + 1).split(';')[0]; if (!tokenPattern.test(token)) fail('AUTH_TOKEN_FORMAT', 500); return token;}

async function initialize() {
  if (!process.send || !directory || process.argv.length !== 3) fail('AUTH_PRIVATE_CHILD_REQUIRED', 500);
  const checked = await validateProjectAuthSandbox(directory);
  marker = checked.marker;
  if (path.resolve(process.env.DOON_DATA_DIR || '') !== path.join(checked.directory, 'data') || process.env.DOON_SYNTHETIC_ONLY !== '1') fail('AUTH_WORKER_ENVIRONMENT', 500);
  // These are the original checked-out bytes, verified before either import can open a database.
  runtime = await import(pathToFileURL(path.join(checked.directory, 'runtime.mjs')).href);
  auth = await import(pathToFileURL(path.join(checked.directory, 'auth.mjs')).href);
  return true;
}

function synchronize(snapshot) {
  const rows = projectAuthSnapshot({records: snapshot});
  const ids = new Set(rows.map(row => row.id));
  runtime.transaction(() => {
    for (const previous of runtime.db.prepare("SELECT id FROM records WHERE kind IN ('member','customer_account')").all()) {
      if (!ids.has(previous.id)) runtime.db.prepare('DELETE FROM records WHERE id=?').run(previous.id);
    }
    const changed = [];
    for (const row of rows) {
      let next = row;
      if (row.kind === 'member') {
        const account = runtime.db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(row.id);
        // The source member id stays stable; the project's generated userId is private account linkage.
        next = {...row, ...(account ? {userId: account.id} : {}), ...(isRevoked(row.id) ? {active: false} : {})};
      }
      const previous = runtime.db.prepare('SELECT data FROM records WHERE id=?').get(row.id);
      if (previous?.data !== JSON.stringify(next)) changed.push(next);
    }
    if (changed.length) runtime.saveRecords(changed);
  });
  auth.revokeInactiveSessions();
  return rows;
}

function actorOf(session, requireChanged = true) {
  if (!session) fail('AUTH_SESSION_INVALID', 401);
  if (session.member.role === 'supplier' || isRevoked(session.member.id)) fail('AUTH_ACCOUNT_UNAVAILABLE', 403);
  if (requireChanged && session.account.must_change) fail('AUTH_PASSWORD_CHANGE_REQUIRED', 403);
  const row = runtime.db.prepare('SELECT expires_at,last_seen FROM local_sessions WHERE token_hash=?').get(session.digest);
  if (!row) fail('AUTH_SESSION_INVALID', 401);
  return {id: session.member.id, name: session.member.name, role: session.member.role, sessionExpiresAt: Math.min(row.expires_at, row.last_seen + 2 * 3_600_000)};
}

async function provision(snapshot) {
  if (runtime.db.prepare('SELECT count(*) n FROM local_accounts').get().n) fail('AUTH_ALREADY_PROVISIONED', 409);
  const rows = synchronize(snapshot), credentials = [], firstChanges = [];
  for (const member of rows.filter(row => row.kind === 'member')) {
    if (member.role === 'supplier') runtime.saveRecords([{id: member.supplierId, kind: 'supplier', name: 'Synthetic auth supplier', active: true, source: 'synthetic-only'}]);
    const username = 'p1-' + randomBytes(12).toString('hex'), initialPassword = randomBytes(24).toString('base64url');
    let password = initialPassword;
    await auth.createAccount({username, name: member.name, password, role: member.role, customers: member.customers, orderScope: member.orderScope, departments: member.departments || [], supplierId: member.supplierId}, null, {existingMember: member});
    if (member.active && member.role !== 'supplier') {
      const first = await auth.login({username, password}, '127.0.0.1', false, options()), oldToken = tokenOf(first.cookie), oldSession = currentSession(oldToken);
      let required = false;
      try {actorOf(oldSession);} catch (error) {required = error.code === 'AUTH_PASSWORD_CHANGE_REQUIRED';}
      if (!required || !oldSession?.account.must_change) fail('AUTH_INITIAL_PASSWORD_INVARIANT', 500);
      password = randomBytes(24).toString('base64url');
      const changed = await auth.changePassword(oldSession, {currentPassword: initialPassword, password}, false, options());
      const changedToken = tokenOf(changed), changedSession = currentSession(changedToken);
      if (currentSession(oldToken) || changedSession?.account.must_change || actorOf(changedSession).id !== member.id) fail('AUTH_PASSWORD_REVOCATION_INVARIANT', 500);
      auth.logout(changedSession, false, {...options(), ip: '127.0.0.1'});
      firstChanges.push({actorId: member.id, initialChangeRequired: true, oldSessionRevoked: true, completed: true});
    }
    credentials.push({actorId: member.id, username, password});
  }
  runtime.db.prepare('INSERT INTO local_meta VALUES(?,?)').run('mastra_initial_password_checks', JSON.stringify(firstChanges));
  synchronize(snapshot);
  return credentials;
}

async function handle(message) {
  await ready;
  const {operation} = message;
  if (operation === 'ready') return true;
  if (operation === 'shutdown') {stopping = true; preserve = message.preserve === true; runtime.db.close(); return true;}
  if (stopping) fail('AUTH_CLOSED', 401);
  if (operation === 'provision') return provision(message.snapshot);
  if (operation === 'login') {
    const {input} = message;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || typeof input.username !== 'string' || !input.username.length || input.username.length > 64 || typeof input.password !== 'string' || !input.password.length || input.password.length > 128) fail('AUTH_LOGIN_SCHEMA');
    synchronize(message.snapshot);
    const ip = typeof message.clientKey === 'string' ? message.clientKey.replace(/^::ffff:/, '') : '';
    if (!isIP(ip)) fail('AUTH_CLIENT_ADDRESS');
    const signed = await auth.login(input, ip, false, options()), token = tokenOf(signed.cookie);
    return {token, actor: actorOf(currentSession(token))};
  }
  if (operation === 'resolve') {synchronize(message.snapshot); return actorOf(currentSession(message.token));}
  if (operation === 'logout') {auth.logout(currentSession(message.token), false, {...options(), ip: '127.0.0.1'}); return true;}
  if (operation === 'revoke') {
    if (typeof message.actorId !== 'string' || !/^syn-[a-z0-9-]{1,80}$/.test(message.actorId)) fail('SYNTHETIC_ID_REQUIRED');
    const account = runtime.db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(message.actorId);
    if (!account) fail('AUTH_ACCOUNT_UNKNOWN', 404);
    runtime.transaction(() => {
      runtime.db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(account.id);
      runtime.db.prepare('INSERT INTO local_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(revokedKey(message.actorId), 'true');
    });
    return true;
  }
  if (!marker.testOnly) fail('AUTH_OPERATION_UNAVAILABLE', 404);
  if (operation === 'test-history') return auth.authHistory(new URLSearchParams({limit: '200'}));
  if (operation === 'test-inspect') return {
    accountCount: runtime.db.prepare('SELECT count(*) n FROM local_accounts').get().n,
    sessionCount: runtime.db.prepare('SELECT count(*) n FROM local_sessions').get().n,
    initialPasswordChecks: JSON.parse(runtime.db.prepare('SELECT value FROM local_meta WHERE key=?').get('mastra_initial_password_checks').value),
    importedSources: ['auth.mjs', 'runtime.mjs'],
    credentialEnvironmentAbsent: !Object.keys(process.env).some(key => /KEY|TOKEN|PASSWORD|SECRET|NODE_OPTIONS/i.test(key)),
  };
  if (operation === 'test-expire') {
    if (!tokenPattern.test(message.token) || !['absolute', 'idle'].includes(message.mode)) fail('AUTH_TEST_EXPIRY');
    runtime.db.prepare(message.mode === 'absolute' ? 'UPDATE local_sessions SET expires_at=? WHERE token_hash=?' : 'UPDATE local_sessions SET last_seen=? WHERE token_hash=?').run(Date.now() - (message.mode === 'idle' ? 2 * 3_600_000 : 0) - 1, sessionDigest(message.token));
    return true;
  }
  if (operation === 'test-cookie-binding') return {valid: !!currentSession(message.token), otherNamespaceAccepted: !!auth.session(request(message.token, 'doon_other_synthetic'), {...options(), cookieName: 'doon_other_synthetic'})};
  if (operation === 'test-password') {
    synchronize(message.snapshot);
    const session = currentSession(message.token); actorOf(session);
    const cookie = await auth.changePassword(session, {currentPassword: message.currentPassword, password: message.password}, false, options()), token = tokenOf(cookie);
    return {token, actor: actorOf(currentSession(token))};
  }
  fail('AUTH_OPERATION_UNAVAILABLE', 404);
}

async function disconnected() {
  if (!stopping) {stopping = true; try {runtime?.db.close();} catch {}}
  if (!preserve && marker) {
    // Windows keeps a process's working directory open; leave it before removing
    // this exact validated sandbox after an unexpected parent disconnect.
    try {process.chdir(path.dirname(directory)); await removeProjectAuthSandbox(directory, marker);} catch {}
  }
  process.exit(0);
}
ready = initialize();
// The rejection is consumed by the first private RPC; no raw errors or credentials are printed.
ready.catch(() => {});
let requests = Promise.resolve();
process.on('message', message => {
  if (!message || !Number.isSafeInteger(message.id) || typeof message.operation !== 'string') return;
  requests = requests.then(async () => {
    try {
      const result = await handle(message);
      if (process.connected) process.send({id: message.id, ok: true, result}, () => {if (stopping) process.disconnect();});
    } catch (error) {
      const status = [400,401,403,404,409,429,500,503].includes(error.status) ? error.status : 500;
      const code = typeof error.code === 'string' && /^[A-Z_]{3,80}$/.test(error.code) ? error.code : ({401: 'AUTH_CREDENTIALS_INVALID', 403: 'AUTH_ACCOUNT_UNAVAILABLE', 429: 'AUTH_RATE_LIMITED'}[status] || 'AUTH_REQUEST_FAILED');
      if (process.connected) process.send({id: message.id, ok: false, status, code});
    }
  });
});
process.on('disconnect', disconnected);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, disconnected);
