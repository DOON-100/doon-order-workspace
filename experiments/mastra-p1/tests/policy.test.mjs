import assert from 'node:assert/strict';
import test from 'node:test';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter, sourceDigest} from '../policy.mjs';

const employeeA = 'syn-employee-a', employeeB = 'syn-employee-b';
const hasStatus = expected => error => error.status === expected;

test('fixture is independent, synthetic, and covers both customers and lifecycle/date cases', () => {
  const first = createSyntheticState(), second = createSyntheticState();
  assert.deepEqual(first, second);
  const orders = first.records.filter(record => record.kind === 'order');
  assert.equal(orders.length, 8);
  assert(orders.every(order => order.source === 'synthetic-only'));
  for (const customer of ['合成客户甲', '合成客户乙']) {
    const rows = orders.filter(order => order.customer === customer);
    assert(rows.some(order => !order.requestedDate));
    assert(rows.some(order => order.requestedDate > '2026-10-15'));
    assert(rows.some(order => order.requestedDate && order.requestedDate < '2026-10-15' && order.lifecycle === 'active'));
    assert(rows.some(order => order.lifecycle === 'archived'));
  }
  first.records[0].name = 'changed';
  assert.notEqual(first.records[0].name, second.records[0].name);
});

test('real canRead source is the sole policy bundle dependency and customer access is isolated', async () => {
  const adapter = await createReadAdapter(createSyntheticState());
  assert.equal(adapter.policyInputs.length, 1);
  assert.match(adapter.policyInputs[0].replaceAll('\\', '/'), /\/lib\/domain\.ts$/);
  assert.equal(adapter.listOrders(employeeA).items.length, 4);
  assert(adapter.listOrders(employeeA).items.every(row => row.customer === '合成客户甲'));
  assert(adapter.listOrders(employeeB).items.every(row => row.customer === '合成客户乙'));
  assert.throws(() => adapter.getOrder(employeeA, 'syn-order-b-normal'), hasStatus(404));
  assert.throws(() => adapter.getOrder(employeeA, 'syn-order-missing'), hasStatus(404));
});

test('authentication rejects absent, disabled, and supplier identities before order policy', async () => {
  const adapter = await createReadAdapter(createSyntheticState());
  for (const id of ['', null, 'syn-unknown']) assert.throws(() => adapter.actor(id), hasStatus(401));
  for (const id of ['syn-disabled', 'syn-supplier']) {
    assert.throws(() => adapter.actor(id), hasStatus(403));
    assert.throws(() => adapter.listOrders(id), hasStatus(403));
    assert.throws(() => adapter.getOrder(id, 'syn-order-a-normal'), hasStatus(403));
  }
});

test('DTO and actor are explicit projections and all reads preserve original fixture', async () => {
  const state = createSyntheticState(), before = structuredClone(state), adapter = await createReadAdapter(state);
  assert.deepEqual(Object.keys(adapter.actor(employeeA)).sort(), ['id', 'name', 'role']);
  const result = adapter.listOrders(employeeA);
  const expected = ['id', 'version', 'orderNo', 'customer', 'quantity', 'requestedDate', 'plannedDate', 'promisedDate', 'promiseConfirmed', 'stage', 'lifecycle', 'observedAt'].sort();
  for (const item of result.items) assert.deepEqual(Object.keys(item).sort(), expected);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert(!JSON.stringify(result).includes('@example.invalid'));
  const direct = adapter.getOrder(employeeA, 'syn-order-a-normal');
  direct.stage = 'mutated returned projection';
  result.items[0].customer = 'mutated returned projection';
  assert.deepEqual(state, before);
  assert.equal(adapter.getOrder(employeeA, 'syn-order-a-normal').stage, '生产中');
});

test('pagination is stable, complete, bounded, and rejects malformed or cross-actor cursors', async () => {
  const adapter = await createReadAdapter(createSyntheticState());
  const first = adapter.listOrders(employeeA, {limit: 2});
  assert(first.nextCursor);
  const second = adapter.listOrders(employeeA, {limit: 2, cursor: first.nextCursor});
  assert.equal(second.nextCursor, '');
  assert.deepEqual([...first.items, ...second.items], adapter.listOrders(employeeA).items);
  assert.deepEqual(adapter.listOrders(employeeA, {limit: 2}), first);
  assert.throws(() => adapter.listOrders(employeeB, {limit: 2, cursor: first.nextCursor}), hasStatus(400));
  assert.throws(() => adapter.listOrders(employeeA, {limit: 3, cursor: first.nextCursor}), hasStatus(400));
  for (const cursor of ['invalid', 'e30.bad', first.nextCursor + 'x', 12, {}]) {
    assert.throws(() => adapter.listOrders(employeeA, {limit: 2, cursor}), hasStatus(400));
  }
  for (const limit of [0, -1, 51, 1.5, '2', NaN]) assert.throws(() => adapter.listOrders(employeeA, {limit}), hasStatus(400));
  assert.equal(adapter.listOrders(employeeA, {limit: 50}).items.length, 4);
});

test('source changes invalidate pagination while observations alone do not change source digest', async () => {
  const state = createSyntheticState(), adapter = await createReadAdapter(state);
  const first = adapter.listOrders(employeeA, {limit: 2});
  const original = adapter.getOrder(employeeA, 'syn-order-a-normal');
  assert.equal(sourceDigest(original), sourceDigest({...original, observedAt: '2026-10-16T01:00:00.000Z'}));
  assert.notEqual(sourceDigest(original), sourceDigest({...original, version: 2}));
  assert.notEqual(sourceDigest(original), sourceDigest({...original, requestedDate: '2026-10-31'}));
  state.records.find(record => record.id === original.id).version++;
  assert.throws(() => adapter.listOrders(employeeA, {limit: 2, cursor: first.nextCursor}), hasStatus(400));
});

test('revoked scope is denied on reconstructed adapters and options cannot replace the actor', async () => {
  const state = createSyntheticState(), adapter = await createReadAdapter(state);
  assert(adapter.listOrders(employeeA, {memberId: employeeB, actorId: employeeB}).items.every(row => row.customer === '合成客户甲'));
  const a = state.records.find(record => record.id === employeeA);
  a.customers = [];
  a.email = 'syn-revoked@example.invalid';
  const revoked = await createReadAdapter(state);
  assert.deepEqual(revoked.listOrders(employeeA).items, []);
  assert.throws(() => revoked.getOrder(employeeA, 'syn-order-a-normal'), hasStatus(404));
});
