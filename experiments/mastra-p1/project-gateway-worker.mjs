import http from 'node:http';
import {randomBytes, createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gatewayOrigins, validateGatewaySandbox, removeGatewaySandbox} from './project-gateway.mjs';
import {projectAuthSnapshot} from './project-auth.mjs';

const [directory, mode, rawPort] = process.argv.slice(2), port = Number(rawPort);
let marker, runtime, auth, server, stopping = false, preserve = false;
function fail(code, status = 500) {throw Object.assign(new Error(code), {code, status});}
const hash = value => createHash('sha256').update(value).digest('hex');

async function initialize() {
  if (!process.send || process.argv.length !== 5 || !Object.hasOwn(gatewayOrigins, mode) || !Number.isInteger(port) || port < 1 || port > 65535 || port === 8787) fail('GATEWAY_WORKER_ARGUMENTS');
  const checked = await validateGatewaySandbox(directory); marker = checked.marker;
  const expected = {DOON_DATA_DIR: path.join(checked.directory, 'data'), DOON_HOST: '127.0.0.1', DOON_PORT: String(port), DOON_NO_AUTO_BACKUP: '1', DOON_REVIEW_MODE: '0', DOON_SYNTHETIC_ONLY: '1', DOON_SERVER_MODE: mode === 'supplier' ? 'supplier' : 'internal'};
  expected[mode === 'supplier' ? 'DOON_SUPPLIER_PUBLIC_ORIGIN' : 'DOON_EMPLOYEE_PUBLIC_ORIGIN'] = gatewayOrigins[mode];
  if (Object.entries(expected).some(([key, value]) => process.env[key] !== value) || Object.keys(process.env).some(key => /KEY|TOKEN|PASSWORD|SECRET|NODE_OPTIONS/i.test(key))) fail('GATEWAY_WORKER_ENVIRONMENT');
  runtime = await import(pathToFileURL(path.join(directory, 'runtime.mjs')).href);
  auth = await import(pathToFileURL(path.join(directory, 'auth.mjs')).href);
}

function synchronize(snapshot) {
  const rows = projectAuthSnapshot({records: snapshot}), ids = new Set(rows.map(row => row.id));
  runtime.transaction(() => {
    for (const previous of runtime.db.prepare("SELECT id FROM records WHERE kind IN ('member','customer_account')").all()) if (!ids.has(previous.id)) runtime.db.prepare('DELETE FROM records WHERE id=?').run(previous.id);
    const changed = [];
    for (const row of rows) {
      const account = row.kind === 'member' ? runtime.db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(row.id) : null;
      const next = {...row, ...(account ? {userId: account.id} : {})}, previous = runtime.db.prepare('SELECT data FROM records WHERE id=?').get(row.id);
      if (previous?.data !== JSON.stringify(next)) changed.push(next);
    }
    if (changed.length) runtime.saveRecords(changed);
  });
  auth.revokeInactiveSessions();
  return rows;
}

async function seed(snapshot) {
  const rows = synchronize(snapshot);
  if (runtime.db.prepare('SELECT count(*) n FROM local_accounts').get().n) return [];
  runtime.saveRecords([{id: 'syn-gateway-source', kind: 'order', source: 'synthetic-only', quantity: 17, privateMarker: 'SYNTHETIC_GATEWAY_SOURCE_UNCHANGED'}]);
  const credentials = [];
  for (const member of rows.filter(row => row.kind === 'member')) {
    if (member.role === 'supplier') runtime.saveRecords([{id: member.supplierId, kind: 'supplier', name: 'Synthetic gateway supplier', active: true, source: 'synthetic-only'}]);
    const username = 'gw-' + randomBytes(12).toString('hex'), password = randomBytes(24).toString('base64url');
    await auth.createAccount({username, name: member.name, role: member.role, password, orderScope: member.orderScope, customers: member.customers, departments: member.departments || [], supplierId: member.supplierId}, null, {existingMember: member});
    const account = runtime.db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(member.id);
    credentials.push({actorId: member.id, userId: account.id, username, password});
  }
  synchronize(snapshot);
  return credentials;
}

async function start(snapshot) {
  if (server) fail('GATEWAY_ALREADY_STARTED', 409);
  const credentials = await seed(snapshot), nativeCreate = http.createServer;
  let listening;
  // Capture only this worker's owned listener for cleanup. Parameters are checked
  // and delegated unchanged; original gateway/server source bytes stay intact.
  http.createServer = (...args) => {
    if (server) fail('GATEWAY_MULTIPLE_LISTENERS');
    server = nativeCreate(...args);
    listening = new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', () => reject(Object.assign(new Error('GATEWAY_PORT_UNAVAILABLE'), {code: 'GATEWAY_PORT_UNAVAILABLE', status: 503})));});
    listening.catch(() => {});
    const nativeListen = server.listen;
    server.listen = function (...listenArgs) {
      if (listenArgs[0] !== port || listenArgs[1] !== '127.0.0.1' || port === 8787) fail('GATEWAY_LISTENER_FORBIDDEN');
      return nativeListen.apply(this, listenArgs);
    };
    return server;
  };
  try {await import(pathToFileURL(path.join(directory, 'server.mjs')).href);} finally {http.createServer = nativeCreate;}
  if (!server) fail('GATEWAY_LISTENER_MISSING');
  await listening;
  const address = server.address();
  if (address?.address !== '127.0.0.1' || address.port !== port) fail('GATEWAY_LISTENER_FORBIDDEN');
  return {port, address: address.address, mode, credentials};
}

async function shutdown(keep) {
  if (stopping) return;
  stopping = true; preserve = keep;
  if (server) await new Promise(resolve => {server.close(() => resolve()); server.closeAllConnections();});
  try {runtime?.db.close();} catch {}
}

const ready = initialize(); ready.catch(() => {});
let requests = Promise.resolve();
process.on('message', message => {
  if (!message || !Number.isSafeInteger(message.id) || typeof message.operation !== 'string') return;
  requests = requests.then(async () => {
    try {
      await ready;
      let result;
      if (message.operation === 'shutdown') {await shutdown(message.preserve === true); result = true;}
      else if (stopping) fail('GATEWAY_CLOSED', 503);
      else if (message.operation === 'start') result = await start(message.snapshot);
      else if (message.operation === 'sync') {synchronize(message.snapshot); result = true;}
      else if (message.operation === 'inspect') {
        const source = runtime.db.prepare("SELECT data FROM records WHERE id='syn-gateway-source'").get();
        result = {syntheticOnly: true, sourceDigest: hash(source?.data || ''), sessionCount: runtime.db.prepare('SELECT count(*) n FROM local_sessions').get().n, eventCount: runtime.db.prepare("SELECT count(*) n FROM records WHERE kind='auth_event'").get().n, files: ['auth.mjs','runtime.mjs','server.mjs','employee-gateway.mjs','supplier-gateway.mjs'], credentialEnvironmentAbsent: !Object.keys(process.env).some(key => /KEY|TOKEN|PASSWORD|SECRET|NODE_OPTIONS/i.test(key))};
      } else fail('GATEWAY_OPERATION_UNAVAILABLE', 404);
      if (process.connected) process.send({id: message.id, ok: true, result}, () => {if (stopping) process.disconnect();});
    } catch (error) {
      if (process.connected) process.send({id: message.id, ok: false, status: [400,401,403,404,409,429,500,503].includes(error.status) ? error.status : 500, code: typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'GATEWAY_WORKER_FAILED'});
    }
  });
});
async function disconnected() {
  await shutdown(false);
  if (!preserve && marker) {try {process.chdir(path.dirname(directory)); await removeGatewaySandbox(directory, marker);} catch {}}
  process.exit(0);
}
process.on('disconnect', disconnected);
// The imported original server already handles OS signals. Normal orchestration
// uses shutdown IPC so DB closure and temporary directory cleanup are awaited.
