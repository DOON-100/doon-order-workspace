import {fork} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const application = 'doon-mastra-auth', markerName = 'auth-sandbox.json';
const sourceRoot = fileURLToPath(new URL('../../standalone/', import.meta.url));
const workerPath = fileURLToPath(new URL('./project-auth-worker.mjs', import.meta.url));
const roles = new Set(['admin', 'pmc', 'production', 'clerk', 'sales', 'finance', 'programmer', 'viewer', 'supplier']);
const syntheticId = /^syn-[a-z0-9-]{1,80}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
function fail(code, status = 400) {throw Object.assign(new Error(code), {code, status});}

/** Only explicitly marked synthetic member/customer records cross this private IPC boundary. */
export function projectAuthSnapshot(state) {
  if (!state || !Array.isArray(state.records)) fail('SYNTHETIC_STATE_REQUIRED');
  const rows = state.records.filter(row => row?.kind === 'member' || row?.kind === 'customer_account');
  if (!rows.some(row => row.kind === 'member') || rows.filter(row => row.kind === 'member').length > 32 || rows.length > 1_032) fail('SYNTHETIC_STATE_LIMIT');
  const ids = new Set();
  for (const row of rows) {
    if (!syntheticId.test(row.id) || ids.has(row.id)) fail('SYNTHETIC_ID_REQUIRED');
    ids.add(row.id);
    if (row.kind === 'member') {
      if (row.privateMarker !== 'SYNTHETIC_MEMBER_PRIVATE' || !roles.has(row.role) || typeof row.name !== 'string' || !row.name || row.name.length > 100 || typeof row.active !== 'boolean' || !Array.isArray(row.customers) || row.customers.some(value => typeof value !== 'string' || value.length > 100) || !['assigned', 'all'].includes(row.orderScope)) fail('SYNTHETIC_MEMBER_REQUIRED');
      if (row.role === 'supplier' && !syntheticId.test(row.supplierId)) fail('SYNTHETIC_SUPPLIER_REQUIRED');
    } else if (row.notes !== 'SYNTHETIC_CUSTOMER_PRIVATE') fail('SYNTHETIC_CUSTOMER_REQUIRED');
  }
  const serialized = JSON.stringify(rows);
  if (Buffer.byteLength(serialized) > 512_000) fail('SYNTHETIC_STATE_LIMIT');
  return JSON.parse(serialized);
}

async function sourceCopies() {
  const sources = {};
  const imports = {
    'auth.mjs': new Set(['node:crypto', 'node:util', 'node:net', './runtime.mjs']),
    'runtime.mjs': new Set(['node:sqlite', 'node:async_hooks', 'node:crypto', 'node:fs/promises', 'node:fs', 'node:path']),
  };
  for (const name of Object.keys(imports)) {
    const bytes = await readFile(path.join(sourceRoot, name)), source = bytes.toString('utf8');
    const matches = [...source.matchAll(/^import\s+[^;]+?\s+from\s+['"]([^'"]+)['"];?/gm)];
    const remainder = matches.reduce((text, match) => text.replace(match[0], ''), source);
    // Deliberately conservative: anything beyond the reviewed import-from form
    // needs review, including side-effect/dynamic imports and re-exports.
    if (!matches.length || matches.some(match => !imports[name].has(match[1])) || /\b(?:import|require)\b|\bexport\s*(?:\*|\{)/.test(remainder)) fail('AUTH_SOURCE_DEPENDENCY_CHANGED', 500);
    sources[name] = {bytes, hash: digest(bytes)};
  }
  return sources;
}

async function checkTree(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name), info = await lstat(target);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1) || !samePath(path.resolve(await realpath(target)), path.resolve(target))) fail('AUTH_SANDBOX_REDIRECT', 500);
    if (info.isDirectory()) await checkTree(target);
  }
}

/** Used before import, restart and deletion; never accepts an arbitrary data path. */
export async function validateProjectAuthSandbox(directory, expectedMarker) {
  const absolute = path.resolve(directory), temp = await realpath(os.tmpdir());
  if (!samePath(path.dirname(absolute), temp) || !/^doon-mastra-auth-[A-Za-z0-9]+$/.test(path.basename(absolute))) fail('AUTH_SANDBOX_PATH', 500);
  if ((await lstat(absolute)).isSymbolicLink() || !samePath(await realpath(absolute), absolute)) fail('AUTH_SANDBOX_REDIRECT', 500);
  await checkTree(absolute);
  const marker = JSON.parse(await readFile(path.join(absolute, markerName), 'utf8'));
  if (marker.application !== application || marker.syntheticOnly !== true || marker.format !== 1 || !/^doon_mastra_auth_[a-f0-9]{24}$/.test(marker.cookieName) || typeof marker.testOnly !== 'boolean') fail('AUTH_SANDBOX_MARKER', 500);
  if (expectedMarker && JSON.stringify(marker) !== JSON.stringify(expectedMarker)) fail('AUTH_SANDBOX_MARKER', 500);
  const sources = await sourceCopies();
  for (const [name, source] of Object.entries(sources)) {
    if (marker.sourceHashes?.[name] !== source.hash || digest(await readFile(path.join(absolute, name))) !== source.hash) fail('AUTH_SOURCE_HASH_MISMATCH', 500);
  }
  return {directory: absolute, marker};
}

export async function removeProjectAuthSandbox(directory, expectedMarker) {
  const checked = await validateProjectAuthSandbox(directory, expectedMarker);
  await rm(checked.directory, {recursive: true, force: false});
}

function cleanEnvironment(directory) {
  const env = {TEMP: os.tmpdir(), TMP: os.tmpdir(), DOON_DATA_DIR: path.join(directory, 'data'), DOON_SYNTHETIC_ONLY: '1', DOON_NO_AUTO_BACKUP: '1'};
  for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

/**
 * Runs the checked-out project's unmodified auth/runtime against a new synthetic
 * SQLite database. It is a synthetic source adapter, not production SSO.
 * Credentials are private return values only; no command/env/log contains them.
 */
export async function createProjectIdentity({state, adapter, testOnly = false} = {}) {
  projectAuthSnapshot(state);
  if (!adapter || typeof adapter.actor !== 'function' || typeof testOnly !== 'boolean') fail('AUTH_CONFIGURATION');
  const sources = await sourceCopies(), directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'doon-mastra-auth-'));
  const marker = {application, format: 1, syntheticOnly: true, cookieName: 'doon_mastra_auth_' + randomBytes(12).toString('hex'), testOnly, sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.hash]))};
  let child, exited, closed = false, closing, sequence = 0, queue = Promise.resolve();
  const pending = new Map();
  try {
    await mkdir(path.join(directory, 'data'), {mode: 0o700});
    for (const [name, source] of Object.entries(sources)) await writeFile(path.join(directory, name), source.bytes, {flag: 'wx', mode: 0o600});
    await writeFile(path.join(directory, markerName), JSON.stringify(marker), {flag: 'wx', mode: 0o600});
    await validateProjectAuthSandbox(directory, marker);
  } catch (error) {
    // Before a valid marker exists, remove only the exact newly-created directory.
    if (samePath(path.dirname(directory), await realpath(os.tmpdir())) && /^doon-mastra-auth-[A-Za-z0-9]+$/.test(path.basename(directory)) && !(await lstat(directory)).isSymbolicLink()) {await checkTree(directory); await rm(directory, {recursive: true, force: true});}
    throw error;
  }

  function rpc(operation, payload = {}) {
    if (!child?.connected) return Promise.reject(Object.assign(new Error('AUTH_WORKER_UNAVAILABLE'), {status: 503}));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {pending.delete(id); reject(Object.assign(new Error('AUTH_WORKER_TIMEOUT'), {status: 503})); child?.kill();}, 120_000);
      pending.set(id, {resolve, reject, timer});
      child.send({id, operation, ...payload}, error => {if (error && pending.has(id)) {clearTimeout(timer); pending.delete(id); reject(Object.assign(new Error('AUTH_WORKER_UNAVAILABLE'), {status: 503}));}});
    });
  }
  async function launch() {
    await validateProjectAuthSandbox(directory, marker);
    child = fork(workerPath, [directory], {cwd: directory, env: cleanEnvironment(directory), execArgv: [], execPath: process.execPath, windowsHide: true, serialization: 'json', stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
    // Failed spawns may have no exit event; fork IPC shutdown on some Windows
    // runtimes may not emit close. Either terminal event completes this wait.
    // A spawn error without a pid means no process ever acquired DB handles.
    exited = new Promise(resolve => {
      child.once('exit', resolve);
      child.once('close', resolve);
      child.once('error', () => {if (!child.pid) resolve();});
    });
    child.on('message', message => {
      const item = pending.get(message?.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.ok) item.resolve(message.result);
      else item.reject(Object.assign(new Error(typeof message.code === 'string' ? message.code : 'AUTH_REQUEST_FAILED'), {status: [400,401,403,404,409,429,500,503].includes(message.status) ? message.status : 500, ...(message.status === 429 ? {retryAfterSeconds: 900} : {})}));
    });
    const rejectPending = () => {for (const item of pending.values()) {clearTimeout(item.timer); item.reject(Object.assign(new Error('AUTH_WORKER_UNAVAILABLE'), {status: 503}));} pending.clear();};
    child.on('error', rejectPending); child.on('exit', rejectPending);
    await rpc('ready');
  }
  function serial(fn) {
    const result = queue.then(() => {if (closed) fail('AUTH_CLOSED', 401); return fn();});
    queue = result.catch(() => {}); return result;
  }
  async function sourceRequest(operation, payload = {}) {
    const snapshot = projectAuthSnapshot(state), before = JSON.stringify(snapshot);
    const result = await rpc(operation, {...payload, snapshot});
    if (JSON.stringify(projectAuthSnapshot(state)) !== before) {
      if (operation === 'login' && result?.token) await rpc('logout', {token: result.token});
      fail('AUTH_SOURCE_CHANGED', 409);
    }
    const actor = operation === 'login' ? result.actor : result;
    if (actor) {
      const current = adapter.actor(actor.id);
      if (current.id !== actor.id || current.role !== actor.role || current.name !== actor.name) fail('AUTH_SOURCE_CHANGED', 409);
    }
    return result;
  }
  async function stop(preserve) {
    if (child?.connected) {try {await rpc('shutdown', {preserve});} catch {child.kill();}}
    await exited;
  }
  async function removeStoppedSandbox() {
    try {await lstat(directory);} catch (error) {if (error.code === 'ENOENT') return; throw error;}
    await removeProjectAuthSandbox(directory, marker);
  }
  try {
    await launch();
    const credentials = await rpc('provision', {snapshot: projectAuthSnapshot(state)});
    const identity = Object.freeze({
      sessionTtlMs: 12 * 3_600_000,
      login: (input, clientKey = '127.0.0.1') => serial(() => sourceRequest('login', {input, clientKey})),
      resolveSession: token => serial(() => sourceRequest('resolve', {token})),
      logout: token => serial(() => rpc('logout', {token})),
      revokeActor: actorId => serial(() => rpc('revoke', {actorId})),
      close() {
        if (!closing) closing = (async () => {closed = true; await queue; await stop(true); await removeStoppedSandbox();})();
        return closing;
      },
    });
    const testControl = testOnly ? Object.freeze({
      history: () => serial(() => rpc('test-history')),
      inspect: () => serial(() => rpc('test-inspect')),
      expireSession: (token, mode = 'absolute') => serial(() => rpc('test-expire', {token, mode})),
      changePassword: (token, currentPassword, password) => serial(() => rpc('test-password', {token, currentPassword, password, snapshot: projectAuthSnapshot(state)})),
      checkCookieBinding: token => serial(() => rpc('test-cookie-binding', {token})),
      restartWorker: () => serial(async () => {await stop(true); await launch(); return true;}),
      disconnectWorker: () => serial(async () => {child.disconnect(); await exited; return true;}),
    }) : undefined;
    return {identity, credentials: Object.freeze(credentials.map(item => Object.freeze(item))), evidence: Object.freeze({directory, sourceHashes: Object.freeze({...marker.sourceHashes}), syntheticOnly: true, implementation: 'unmodified-project-auth-in-child'}), ...(testControl ? {testControl} : {})};
  } catch (error) {
    await stop(true);
    await removeStoppedSandbox();
    throw error;
  }
}
