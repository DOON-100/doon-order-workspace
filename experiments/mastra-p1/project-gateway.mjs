import http from 'node:http';
import net from 'node:net';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSyntheticState} from './fixtures.mjs';
import {projectAuthSnapshot} from './project-auth.mjs';

const files = ['auth.mjs', 'runtime.mjs', 'server.mjs', 'employee-gateway.mjs', 'supplier-gateway.mjs'];
const sourceRoot = fileURLToPath(new URL('../../standalone/', import.meta.url));
const worker = fileURLToPath(new URL('./project-gateway-worker.mjs', import.meta.url));
const markerName = 'gateway-sandbox.json';
export const gatewayOrigins = Object.freeze({employee: 'https://employee.synthetic.invalid', supplier: 'https://supplier.synthetic.invalid'});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function fail(code, status = 500) {throw Object.assign(new Error(code), {code, status});}
const probe = `// SYNTHETIC IDENTITY CONTEXT PROBE ONLY: this is not the production workspace API.
import {context} from './runtime.mjs';
export async function GET(){const current=context.getStore();if(!current?.member||current.identity?.userId!==current.member.userId)return Response.json({error:'No trusted synthetic session'},{status:500});return Response.json({syntheticOnly:true,identityProbe:true,actor:{id:current.member.id,name:current.member.name,role:current.member.role},trustedIdentity:true});}
export async function POST(){return Response.json({error:'Synthetic identity probe is read-only'},{status:405});}
`;
const client = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic gateway protocol test</title><p>Synthetic identity probe; no production workspace.</p></html>';

const staticImports = {
  'auth.mjs': ['node:crypto','node:util','node:net','./runtime.mjs'],
  'runtime.mjs': ['node:sqlite','node:async_hooks','node:crypto','node:fs/promises','node:fs','node:path'],
  'server.mjs': ['node:http','node:https','node:os','node:path','node:fs/promises','node:url','node:sqlite','./supplier-gateway.mjs','./employee-gateway.mjs'],
  'employee-gateway.mjs': ['node:net','./supplier-gateway.mjs'],
  'supplier-gateway.mjs': ['node:net','node:path','node:url'],
};
const supplierDirectEntry = `if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.env.DOON_SERVER_MODE='supplier';process.env.DOON_HOST='127.0.0.1';process.env.DOON_PORT||='8788';process.env.DOON_NO_AUTO_BACKUP='1';
 supplierGatewayConfig();
 await import(pathToFileURL(path.resolve(process.argv[2]||'lan-dist/server.mjs')).href);
}`;
function maskQuotedAndComments(source) {
  let result = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'") {
      const quote = char; let ended = false;
      for (index++; index < source.length; index++) {if (source[index] === '\\') index++; else if (source[index] === quote) {ended = true; break;}}
      if (!ended) fail('GATEWAY_SOURCE_DEPENDENCY_CHANGED');
      result += ' ';
    } else if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      result += '\n';
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2); if (end < 0) fail('GATEWAY_SOURCE_DEPENDENCY_CHANGED');
      index = end + 1; result += ' ';
    } else result += char;
  }
  return result;
}
function assertSourceDependencies(name, bytes) {
  let source = bytes.toString('utf8').replaceAll('\r\n', '\n');
  if (name === 'supplier-gateway.mjs') {
    if (source.split(supplierDirectEntry).length !== 2) fail('GATEWAY_SOURCE_DEPENDENCY_CHANGED');
    // This exact guarded optional entry point cannot execute when imported by
    // our differently named worker. Any change to the guard needs review.
    source = source.replace(supplierDirectEntry, '');
  }
  const imports = [...source.matchAll(/^import\s+[^;]+?\s+from\s+['"]([^'"]+)['"];?/gm)];
  if (!imports.length || imports.some(match => !staticImports[name].includes(match[1]))) fail('GATEWAY_SOURCE_DEPENDENCY_CHANGED');
  for (const match of imports) source = source.replace(match[0], '');
  if (name === 'server.mjs') {
    for (const match of [...source.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)]) {
      if (!['./runtime.mjs','./auth.mjs','./workspace-api.mjs'].includes(match[2])) fail('GATEWAY_SOURCE_DEPENDENCY_CHANGED');
      source = source.replace(match[0], '');
    }
  }
  const code = maskQuotedAndComments(source).replaceAll('import.meta', '');
  if (/\b(?:import|require)\b|\bexport\s*(?:\*|\{)/.test(code)) fail('GATEWAY_SOURCE_DEPENDENCY_CHANGED');
}

export function createGatewaySyntheticState() {
  const state = createSyntheticState(), template = state.records.find(row => row.id === 'syn-employee-a');
  state.records.push({...structuredClone(template), id: 'syn-gateway-admin', userId: 'syn-gateway-admin-user', name: '合成网关管理员', email: 'syn-gateway-admin@example.invalid', role: 'admin'});
  return state;
}

async function checkTree(directory) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const target = path.join(directory, item.name), info = await lstat(target);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1) || !samePath(await realpath(target), target)) fail('GATEWAY_SANDBOX_REDIRECT');
    if (info.isDirectory()) await checkTree(target);
  }
}

export async function validateGatewaySandbox(directory, expected) {
  const root = path.resolve(directory), temp = await realpath(os.tmpdir());
  if (!samePath(path.dirname(root), temp) || !/^doon-mastra-gateway-[A-Za-z0-9]+$/.test(path.basename(root))) fail('GATEWAY_SANDBOX_PATH');
  if ((await lstat(root)).isSymbolicLink() || !samePath(await realpath(root), root)) fail('GATEWAY_SANDBOX_REDIRECT');
  await checkTree(root);
  const marker = JSON.parse(await readFile(path.join(root, markerName), 'utf8'));
  if (marker.application !== 'doon-mastra-gateway' || marker.syntheticOnly !== true || marker.format !== 1 || marker.probeHash !== sha(probe) || (expected && JSON.stringify(marker) !== JSON.stringify(expected))) fail('GATEWAY_SANDBOX_MARKER');
  for (const file of files) {
    const original = await readFile(path.join(sourceRoot, file));
    assertSourceDependencies(file, original);
    if (marker.sourceHashes?.[file] !== sha(original) || sha(await readFile(path.join(root, file))) !== sha(original)) fail('GATEWAY_SOURCE_HASH');
  }
  if (sha(await readFile(path.join(root, 'workspace-api.mjs'))) !== marker.probeHash || sha(await readFile(path.join(root, 'client', 'index.html'))) !== sha(client)) fail('GATEWAY_PROBE_HASH');
  return {directory: root, marker};
}

export async function removeGatewaySandbox(directory, expected) {
  const checked = await validateGatewaySandbox(directory, expected);
  await rm(checked.directory, {recursive: true, force: false});
}

async function allocatePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);});
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8787) fail('GATEWAY_PORT_FORBIDDEN');
  return port;
}

function environment(directory, mode, port) {
  const env = {TEMP: os.tmpdir(), TMP: os.tmpdir(), DOON_DATA_DIR: path.join(directory, 'data'), DOON_HOST: '127.0.0.1', DOON_PORT: String(port), DOON_NO_AUTO_BACKUP: '1', DOON_REVIEW_MODE: '0', DOON_SYNTHETIC_ONLY: '1', DOON_SERVER_MODE: mode === 'supplier' ? 'supplier' : 'internal'};
  for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
  env[mode === 'supplier' ? 'DOON_SUPPLIER_PUBLIC_ORIGIN' : 'DOON_EMPLOYEE_PUBLIC_ORIGIN'] = gatewayOrigins[mode];
  return env;
}

/**
 * Real project HTTP auth routes in a newly-created synthetic database. The
 * returned request transport only targets its owned loopback listener. HTTPS
 * forwarding headers are a protocol simulation, not an actual TLS connection.
 * credentials and responses containing cookies are trusted-caller private data.
 */
export async function createProjectGatewayLab({state = createGatewaySyntheticState()} = {}) {
  projectAuthSnapshot(state);
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'doon-mastra-gateway-'));
  const marker = {application: 'doon-mastra-gateway', format: 1, syntheticOnly: true, sourceHashes: {}, probeHash: sha(probe)};
  let child, exited, mode, port, credentials, sequence = 0, closed = false, changing = false, closing, lifecycle = Promise.resolve();
  const pending = new Map();
  try {
    await mkdir(path.join(directory, 'data'), {mode: 0o700});
    await mkdir(path.join(directory, 'client'), {mode: 0o700});
    for (const file of files) {
      const bytes = await readFile(path.join(sourceRoot, file)); assertSourceDependencies(file, bytes); marker.sourceHashes[file] = sha(bytes);
      await writeFile(path.join(directory, file), bytes, {mode: 0o600, flag: 'wx'});
    }
    await writeFile(path.join(directory, 'workspace-api.mjs'), probe, {mode: 0o600, flag: 'wx'});
    await writeFile(path.join(directory, 'client', 'index.html'), client, {mode: 0o600, flag: 'wx'});
    await writeFile(path.join(directory, markerName), JSON.stringify(marker), {mode: 0o600, flag: 'wx'});
  } catch (error) {
    if (samePath(path.dirname(directory), await realpath(os.tmpdir())) && /^doon-mastra-gateway-[A-Za-z0-9]+$/.test(path.basename(directory)) && !(await lstat(directory)).isSymbolicLink()) {await checkTree(directory); await rm(directory, {recursive: true, force: true});}
    throw error;
  }

  function rpc(operation, payload = {}) {
    if (!child?.connected) return Promise.reject(Object.assign(new Error('GATEWAY_WORKER_UNAVAILABLE'), {status: 503}));
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => {pending.delete(id); child.kill(); reject(Object.assign(new Error('GATEWAY_WORKER_TIMEOUT'), {status: 503}));}, 60_000);
      pending.set(id, {resolve, reject, timer});
      child.send({id, operation, ...payload}, error => {if (error && pending.has(id)) {clearTimeout(timer); pending.delete(id); reject(Object.assign(new Error('GATEWAY_WORKER_UNAVAILABLE'), {status: 503}));}});
    });
  }
  async function stop() {
    if (child?.connected) {try {await rpc('shutdown', {preserve: true});} catch {child.kill();}}
    await exited;
  }
  async function removeStopped() {
    try {await lstat(directory);} catch (error) {if (error.code === 'ENOENT') return; throw error;}
    await removeGatewaySandbox(directory, marker);
  }
  async function launch(nextMode) {
    if (closed) fail('GATEWAY_UNAVAILABLE', 503);
    if (!Object.hasOwn(gatewayOrigins, nextMode)) fail('GATEWAY_MODE', 400);
    await validateGatewaySandbox(directory, marker);
    if (closed) fail('GATEWAY_UNAVAILABLE', 503);
    const nextPort = await allocatePort();
    if (closed) fail('GATEWAY_UNAVAILABLE', 503);
    child = fork(worker, [directory, nextMode, String(nextPort)], {cwd: directory, env: environment(directory, nextMode, nextPort), execPath: process.execPath, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', windowsHide: true});
    exited = new Promise(resolve => {child.once('exit', resolve); child.once('close', resolve); child.once('error', () => {if (!child.pid) resolve();});});
    const rejectPending = () => {for (const item of pending.values()) {clearTimeout(item.timer); item.reject(Object.assign(new Error('GATEWAY_WORKER_UNAVAILABLE'), {status: 503}));} pending.clear();};
    child.on('error', rejectPending); child.on('exit', rejectPending);
    child.on('message', message => {
      const item = pending.get(message?.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.ok) item.resolve(message.result);
      else item.reject(Object.assign(new Error(/^[A-Z_]+$/.test(message.code) ? message.code : 'GATEWAY_WORKER_FAILED'), {status: Number.isInteger(message.status) ? message.status : 500}));
    });
    const ready = await rpc('start', {snapshot: projectAuthSnapshot(state)});
    if (ready.port !== nextPort || ready.mode !== nextMode || ready.address !== '127.0.0.1') fail('GATEWAY_LISTENER_MISMATCH');
    credentials ??= Object.freeze(ready.credentials.map(item => Object.freeze(item)));
    mode = nextMode; port = nextPort;
  }
  function lifecycleTask(operation) {
    const result = lifecycle.then(operation);
    lifecycle = result.catch(() => {});
    return result;
  }
  function request(route, {method = 'GET', body, headers = {}} = {}) {
    if (closed || changing || !child?.connected) return Promise.reject(Object.assign(new Error('GATEWAY_UNAVAILABLE'), {status: 503}));
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\r\n]/.test(route)) return Promise.reject(Object.assign(new Error('GATEWAY_RELATIVE_ROUTE_REQUIRED'), {status: 400}));
    const origin = gatewayOrigins[mode], host = new URL(origin).host;
    const outgoing = {host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.15', ...(method === 'POST' ? {origin, 'content-type': 'application/json'} : {})};
    for (const [key, value] of Object.entries(headers)) {if (value === null) delete outgoing[key.toLowerCase()]; else outgoing[key.toLowerCase()] = value;}
    return new Promise((resolve, reject) => {
      const req = http.request({hostname: '127.0.0.1', port, path: route, method, headers: outgoing, agent: false}, response => {
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {bytes += chunk.length; if (bytes > 2_000_000) req.destroy(); else chunks.push(chunk);});
        response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8')}));
        response.on('error', () => reject(Object.assign(new Error('GATEWAY_REQUEST_FAILED'), {status: 503})));
      });
      req.setTimeout(5_000, () => req.destroy());
      req.on('error', () => reject(Object.assign(new Error('GATEWAY_REQUEST_FAILED'), {status: 503})));
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }
  try {
    await launch('employee');
    return Object.freeze({
      credentials,
      evidence: Object.freeze({directory, sourceHashes: Object.freeze({...marker.sourceHashes}), syntheticOnly: true, workspaceApi: 'readonly-identity-context-probe', tlsTested: false}),
      get endpoint() {return Object.freeze({mode, publicOrigin: gatewayOrigins[mode], loopbackPort: port});},
      request,
      async syncState() {if (closed || changing) fail('GATEWAY_UNAVAILABLE', 503); return rpc('sync', {snapshot: projectAuthSnapshot(state)});},
      async inspect() {if (closed || changing) fail('GATEWAY_UNAVAILABLE', 503); return rpc('inspect');},
      async switchGateway(nextMode) {
        if (closed || changing) fail('GATEWAY_UNAVAILABLE', 503);
        if (!Object.hasOwn(gatewayOrigins, nextMode)) fail('GATEWAY_MODE', 400);
        changing = true;
        return lifecycleTask(async () => {
          try {
            if (closed) fail('GATEWAY_UNAVAILABLE', 503);
            await stop();
            await launch(nextMode);
            if (closed) {await stop(); fail('GATEWAY_UNAVAILABLE', 503);}
            return true;
          } catch (error) {
            await stop();
            throw error;
          } finally {changing = false;}
        });
      },
      close() {if (!closing) {closed = true; closing = lifecycleTask(async () => {await stop(); await removeStopped();});} return closing;},
    });
  } catch (error) {await stop(); await removeStopped(); throw error;}
}
