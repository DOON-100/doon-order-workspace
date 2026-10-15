import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const domainPath = path.resolve(projectRoot, 'lib/domain.ts');
const cursorKey = randomBytes(32);
const sourceFields = ['id', 'version', 'orderNo', 'customer', 'quantity', 'requestedDate', 'plannedDate', 'promisedDate', 'promiseConfirmed', 'stage', 'lifecycle'];
let policyPromise;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

/** Compile the checked-out project's actual permission function, with one allowed input. */
async function loadPolicy() {
  policyPromise ??= (async () => {
    const output = await build({
      stdin: {contents: 'export {canRead} from "./lib/domain.ts";', resolveDir: projectRoot, loader: 'ts'},
      absWorkingDir: projectRoot, write: false, bundle: true, metafile: true,
      platform: 'node', format: 'esm', logLevel: 'silent',
      plugins: [{name: 'only-pure-order-policy', setup(builder) {
        builder.onResolve({filter: /.*/}, args => {
          if (args.path === './lib/domain.ts' && args.importer === '<stdin>') return {path: domainPath};
          return {errors: [{text: `Policy import is not allowed: ${args.path}`} ]};
        });
      }}],
    });
    const inputPaths = Object.keys(output.metafile.inputs).filter(name => name !== '<stdin>').map(name => path.resolve(projectRoot, name));
    if (inputPaths.length !== 1 || inputPaths[0] !== domainPath || Object.values(output.metafile.outputs).some(item => item.imports.length)) {
      throw new Error('Policy dependency boundary changed; inspect the source before proceeding.');
    }
    const compiled = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    if (typeof compiled.canRead !== 'function') throw new Error('Project permission export is unavailable.');
    return {canRead: compiled.canRead, inputs: Object.freeze(inputPaths)};
  })();
  return policyPromise;
}

/** A source fingerprint, deliberately independent of when a DTO was observed. */
export function sourceDigest(dto) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(sourceFields.map(key => [key, dto[key]])))).digest('hex');
}

function signature(body) {
  return createHmac('sha256', cursorKey).update(body).digest('base64url');
}
function encodeCursor(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + signature(body);
}
function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) fail('分页游标无效。');
  const [body, supplied] = value.split('.');
  if (!timingSafeEqual(Buffer.from(signature(body)), Buffer.from(supplied))) fail('分页游标无效。');
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.v !== 1 || typeof payload.actor !== 'string' || typeof payload.after !== 'string' || typeof payload.digest !== 'string' || !Number.isInteger(payload.limit)) fail('分页游标无效。');
    return payload;
  } catch { fail('分页游标无效。'); }
}

export async function createReadAdapter(state, {observedAt = '2026-10-15T01:00:00.000Z'} = {}) {
  if (!state || !Array.isArray(state.records) || !Number.isInteger(state.revision)) fail('合成状态格式无效。');
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) fail('观察时间无效。');
  const policy = await loadPolicy();
  function member(actorId) {
    if (typeof actorId !== 'string' || !actorId) fail('请先登录合成实验。', 401);
    const found = state.records.filter(record => record.kind === 'member' && record.id === actorId);
    if (found.length !== 1) fail('合成身份不存在。', 401);
    const current = found[0];
    if (current.active !== true || current.role === 'supplier') fail('当前合成身份没有内部读取权限。', 403);
    return current;
  }
  function dto(order) {
    return {
      id: order.id, version: order.version, orderNo: order.orderNo, customer: order.customer,
      quantity: order.quantity, requestedDate: order.requestedDate, plannedDate: order.plannedDate,
      promisedDate: order.promisedDate, promiseConfirmed: order.promiseConfirmed,
      stage: order.stage, lifecycle: order.lifecycle || 'active', observedAt,
    };
  }
  function visible(current) {
    return state.records.filter(record => record.kind === 'order' && policy.canRead(current, record))
      .slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  return Object.freeze({
    policyInputs: policy.inputs,
    actor(actorId) {
      const {id, name, role} = member(actorId);
      return {id, name, role};
    },
    listOrders(actorId, {limit = 20, cursor = ''} = {}) {
      const current = member(actorId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('每页数量须为 1 至 50 的整数。');
      if (typeof cursor !== 'string') fail('分页游标无效。');
      const orders = visible(current), dtos = orders.map(dto);
      const digest = createHash('sha256').update(JSON.stringify(dtos.map(sourceDigest))).digest('hex');
      let start = 0;
      if (cursor) {
        const saved = decodeCursor(cursor);
        const index = orders.findIndex(order => order.id === saved.after);
        if (saved.actor !== actorId || saved.limit !== limit || saved.digest !== digest || index < 0) fail('分页范围已变化，请重新读取第一页。');
        start = index + 1;
      }
      const items = dtos.slice(start, start + limit);
      const nextCursor = start + limit < orders.length
        ? encodeCursor({v: 1, actor: actorId, after: items.at(-1).id, limit, digest}) : '';
      return {items, nextCursor, observedAt};
    },
    getOrder(actorId, id) {
      const current = member(actorId);
      const matches = state.records.filter(record => record.kind === 'order' && record.id === id);
      if (matches.length !== 1 || !policy.canRead(current, matches[0])) fail('订单不存在或不在读取范围内。', 404);
      return dto(matches[0]);
    },
  });
}
