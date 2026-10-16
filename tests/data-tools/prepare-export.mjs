import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {prepareQuote} from '../../scripts/data-tools/prepare-quote.mjs';
import {exportWorkspace} from '../../scripts/data-tools/export-workspace.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testOutput = path.join(project, 'test-output');
await fs.mkdir(testOutput, {recursive: true});
const root = await fs.mkdtemp(path.join(testOutput, 'data-tools-prepare-export-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let checks = 0;
async function test(name, run) { await run(); checks++; }
const privateDir = path.join(root, 'private');
await fs.mkdir(privateDir);
// Synthetic file signatures only: preparation checks type signatures and integrity,
// while the installed import API performs its own document validation.
const source = Buffer.from('%PDF-1.4\nSynthetic source document\n%%EOF\n');
const picture = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
await fs.writeFile(path.join(privateDir, 'source.pdf'), source);
await fs.writeFile(path.join(privateDir, 'image.png'), picture);
const config = {
  schemaVersion: 1, operation: 'create', customer: {id: 'customer-synthetic', customerCode: 'SYN-ONLY', customer: 'Synthetic customer'},
  actor: {username: 'synthetic-owner'}, readers: [{username: 'synthetic-reader'}],
  quotes: [{payload: {customerAccountId: 'customer-synthetic', quoteNo: 'SYN-PORTABLE', currency: 'USD', lines: [{id: 'line-synthetic', model: 'SYNTHETIC', unitPrice: 12.34, quantity: 1, toolingFee: null}]}, source: {path: 'source.pdf', sha256: hash(source)}, media: [{path: 'image.png', lineId: 'line-synthetic', category: 'image'}]}],
};
const configPath = path.join(privateDir, 'task.json');
await fs.writeFile(configPath, JSON.stringify(config));
const configHash = hash(await fs.readFile(configPath));
async function alternateConfig(mutate, name) { const next = structuredClone(config); mutate(next); const target = path.join(privateDir, `${name}.json`); await fs.writeFile(target, JSON.stringify(next)); return target; }
await test('prepare validates and preserves all configured business fields', async () => {
  const result = await prepareQuote({config: configPath, output: path.join(root, 'bundle')});
  assert.deepEqual(result, {success: true, quoteCount: 1, attachmentCount: 2, uniqueFileCount: 2});
  const prepared = JSON.parse(await fs.readFile(path.join(root, 'bundle/config.json')));
  assert.deepEqual(prepared.quotes[0].payload, config.quotes[0].payload);
  assert.equal(prepared.quotes[0].source.filename, 'source.pdf');
  assert.equal(prepared.quotes[0].media[0].sha256, hash(picture));
  assert.equal(hash(await fs.readFile(configPath)), configHash);
});
await test('bundle works after relocation without the original source directory', async () => {
  await fs.rename(path.join(root, 'bundle'), path.join(root, 'moved-bundle'));
  await fs.rename(privateDir, path.join(root, 'parked-private'));
  try {
    const moved = path.join(root, 'moved-bundle');
    const prepared = JSON.parse(await fs.readFile(path.join(moved, 'config.json')));
    for (const entry of [prepared.quotes[0].source, ...prepared.quotes[0].media]) {
      assert(!path.isAbsolute(entry.path)); assert(!entry.path.includes('\\'));
      assert.equal(hash(await fs.readFile(path.join(moved, entry.path))), entry.sha256);
    }
    await prepareQuote({config: path.join(moved, 'config.json'), output: path.join(root, 'rebundled')});
  } finally { await fs.rename(path.join(root, 'parked-private'), privateDir); }
});
await test('existing destination and source directory cannot be overwritten', async () => {
  await assert.rejects(prepareQuote({config: configPath, output: privateDir}), {code: 'EEXIST'});
  await assert.rejects(prepareQuote({config: configPath, output: configPath}), {code: 'EEXIST'});
  assert.equal(hash(await fs.readFile(configPath)), configHash);
});
await test('hash mismatch fails before output creation', async () => {
  const invalid = await alternateConfig(c => { c.quotes[0].source.sha256 = '0'.repeat(64); }, 'bad-hash');
  await assert.rejects(prepareQuote({config: invalid, output: path.join(root, 'bad-hash')}), /SHA-256/);
  await assert.rejects(fs.stat(path.join(root, 'bad-hash')), {code: 'ENOENT'});
});
await test('path traversal and Windows absolute paths are rejected', async () => {
  for (const input of ['../outside.pdf', 'C:/private/source.pdf', '\\\\server\\share\\file.pdf']) {
    const invalid = await alternateConfig(c => { c.quotes[0].source.path = input; }, 'bad-path');
    await assert.rejects(prepareQuote({config: invalid, output: path.join(root, 'bad-path')}), /relative|escapes/);
  }
});
await test('missing file and unexpected signature fail', async () => {
  const missing = await alternateConfig(c => { c.quotes[0].source.path = 'missing.pdf'; }, 'missing');
  await assert.rejects(prepareQuote({config: missing, output: path.join(root, 'missing')}), {code: 'ENOENT'});
  await fs.writeFile(path.join(privateDir, 'fake.png'), 'not a PNG');
  const invalid = await alternateConfig(c => { c.quotes[0].media[0].path = 'fake.png'; }, 'bad-magic');
  await assert.rejects(prepareQuote({config: invalid, output: path.join(root, 'bad-magic')}), /signature/);
});
await test('symlinked source directories cannot escape the private input package', async () => {
  const outside = path.join(root, 'outside-package'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'source.pdf'), source);
  await fs.symlink(outside, path.join(privateDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const invalid = await alternateConfig(c => { c.quotes[0].source.path = 'linked/source.pdf'; }, 'symlink-source');
  await assert.rejects(prepareQuote({config: invalid, output: path.join(root, 'symlink-source')}), /symlink escapes/);
});
await test('oversized files, inappropriate media types and filename mismatches fail', async () => {
  await fs.writeFile(path.join(privateDir, 'large.pdf'), Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]));
  const large = await alternateConfig(c => { c.quotes[0].source.path = 'large.pdf'; }, 'large');
  await assert.rejects(prepareQuote({config: large, output: path.join(root, 'large')}), /10 MB/);
  const wrongType = await alternateConfig(c => { c.quotes[0].media[0].path = 'source.pdf'; }, 'wrong-type');
  await assert.rejects(prepareQuote({config: wrongType, output: path.join(root, 'wrong-type')}), /not allowed/);
  const wrongFilename = await alternateConfig(c => { c.quotes[0].source.filename = 'renamed.png'; }, 'wrong-filename');
  await assert.rejects(prepareQuote({config: wrongFilename, output: path.join(root, 'wrong-filename')}), /extension/);
});
await test('foreign line, duplicate media and mismatched customer are rejected', async () => {
  for (const mutate of [c => { c.quotes[0].media[0].lineId = 'other'; }, c => { c.quotes[0].media.push(structuredClone(c.quotes[0].media[0])); }, c => { c.quotes[0].payload.customerAccountId = 'other'; }]) {
    const invalid = await alternateConfig(mutate, 'bad-business-link');
    await assert.rejects(prepareQuote({config: invalid, output: path.join(root, 'bad-business-link')}));
  }
});
await test('no existing quote id or version can enter create bundle', async () => {
  const invalid = await alternateConfig(c => { c.quotes[0].payload.id = 'already-exists'; c.quotes[0].payload.version = 7; }, 'existing');
  await assert.rejects(prepareQuote({config: invalid, output: path.join(root, 'existing')}), /id or version/);
});
await test('explicit source code and evidence mapping survive without changing the customer master', async () => {
  const configured = await alternateConfig(c => {
    c.customer.customerCode = '';
    c.quoteCustomerCode = 'SYN-SOURCE-CODE';
    c.quotes[0].payload.customerCode = 'SYN-SOURCE-CODE';
    c.preconditions = [{id: 'synthetic-binding-evidence', kind: 'customer_project_task', sha256: 'b'.repeat(64)}];
  }, 'explicit-mapping');
  const output = path.join(root, 'mapped-bundle');
  await prepareQuote({config: configured, output});
  const prepared = JSON.parse(await fs.readFile(path.join(output, 'config.json')));
  assert.equal(prepared.customer.customerCode, '');
  assert.equal(prepared.quoteCustomerCode, 'SYN-SOURCE-CODE');
  assert.equal(prepared.quotes[0].payload.customerCode, 'SYN-SOURCE-CODE');
  assert.deepEqual(prepared.preconditions, [{id: 'synthetic-binding-evidence', kind: 'customer_project_task', sha256: 'b'.repeat(64)}]);
});
await test('preparation CLI logs only summary, not private fields', async () => {
  const child = spawnSync(process.execPath, [path.join(project, 'scripts/data-tools/prepare-quote.mjs'), '--config', configPath, '--output', path.join(root, 'cli-bundle')], {encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).quoteCount, 1);
  for (const secret of ['SYN-PORTABLE', 'synthetic-owner', '12.34', 'customer-synthetic', configPath]) assert(!child.stdout.includes(secret));
});

const data = path.join(root, 'data'); await fs.mkdir(data);
const dbPath = path.join(data, 'workspace.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE local_accounts(password_hash TEXT); CREATE TABLE local_sessions(token TEXT);');
db.prepare('INSERT INTO local_accounts VALUES (?)').run('SYNTHETIC_PASSWORD_NOT_EXPORTED');
db.prepare('INSERT INTO local_sessions VALUES (?)').run('SYNTHETIC_SESSION_NOT_EXPORTED');
const insert = value => db.prepare('INSERT INTO records VALUES (?,?,?)').run(value.id, value.kind, JSON.stringify(value));
insert({id: 'm-one', kind: 'member', name: 'Synthetic sales', email: 'private@test.invalid', userId: 'private-user-id', role: 'admin'});
insert({id: 'm-two', kind: 'member', name: 'Synthetic service', email: 'other@test.invalid'});
insert({id: 'c-one', kind: 'customer_account', customerCode: 'SYN-ONE', customer: 'Synthetic customer one', salesMemberIds: ['m-one'], serviceMemberIds: ['m-two'], quoteMemberIds: ['m-two'], notes: 'PRIVATE_NOTES', directory: {private: true}});
insert({id: 'c-two', kind: 'customer_account', customerCode: 'SYN-TWO', customer: 'Synthetic customer two', salesMemberIds: [], serviceMemberIds: [], salesName: 'Synthetic sales'});
insert({id: 'c-legacy', kind: 'customer_account', customerCode: 'SYN-LEGACY', customer: 'Synthetic legacy', salesName: 'Synthetic sales', serviceName: 'Synthetic service'});
const quote = {id: 'q-one', kind: 'customer_quote', customerAccountId: 'c-one', quoteNo: 'SYN-QUOTE', status: 'draft', version: 3, internalCosts: [{id: 'cost', label: 'Synthetic fee', rmb: 3}], lines: [{id: 'line', model: 'Synthetic model', quantity: 1, unitPrice: 9}], sourceFileKey: 'synthetic-key', sourceHash: 'a'.repeat(64), mediaIds: ['media-one']};
insert(quote);
insert({...quote, id: 'q-other', customerAccountId: 'c-two', quoteNo: 'OTHER_PRIVATE_QUOTE'});
insert({...quote, id: 'q-unknown', unexpectedSecret: 'SYNTHETIC_SECRET'});
insert({id: 'revision-one', kind: 'customer_quote_revision', snapshot: {...quote, version: 1, quoteNo: 'PRIVATE_HISTORY'}});
db.close();
const beforeHash = hash(await fs.readFile(dbPath));
await test('ownership output uses ids and a minimal field allowlist', async () => {
  const out = path.join(root, 'ownership.json');
  assert.deepEqual(await exportWorkspace({data, output: out, scope: 'ownership', customerIds: ['c-one', 'c-two', 'c-legacy']}), {success: true, scope: 'ownership', customerCount: 3, memberCount: 2, customersWithoutExplicitOwnership: 1});
  const text = await fs.readFile(out, 'utf8'), result = JSON.parse(text);
  assert.deepEqual(result.customers.find(customer => customer.id === 'c-one'), {id: 'c-one', customerCode: 'SYN-ONE', customer: 'Synthetic customer one', acceptedIdentities: ['SYN-ONE'], salesMembers: [{id: 'm-one', name: 'Synthetic sales'}], serviceMembers: [{id: 'm-two', name: 'Synthetic service'}]});
  assert.deepEqual(result.customers.find(customer => customer.id === 'c-legacy').salesMembers, []);
  assert.deepEqual(result.customers.find(customer => customer.id === 'c-two').salesMembers, []);
  for (const secret of ['PASSWORD', 'SESSION', 'PRIVATE_NOTES', 'private@test.invalid', 'private-user-id', 'quoteMemberIds', 'directory', 'PRIVATE_HISTORY']) assert(!text.includes(secret));
});
await test('member selector matches stored ids only, never legacy names', async () => {
  const out = path.join(root, 'by-member.json');
  await exportWorkspace({data, output: out, scope: 'ownership', memberIds: ['m-one']});
  assert.deepEqual(JSON.parse(await fs.readFile(out)).customers.map(customer => customer.id), ['c-one']);
});
await test('customer and member selectors intersect without broadening scope', async () => {
  const out = path.join(root, 'intersection.json');
  await exportWorkspace({data, output: out, scope: 'ownership', memberIds: ['m-one'], customerIds: ['c-two']});
  assert.equal(JSON.parse(await fs.readFile(out)).customers.length, 0);
});
await test('quote export preserves exact current snapshot for maintenance', async () => {
  const out = path.join(root, 'quote.json');
  await exportWorkspace({data, output: out, scope: 'quote', quoteId: 'q-one', customerId: 'c-one'});
  const text = await fs.readFile(out, 'utf8');
  assert.deepEqual(JSON.parse(text).quote, quote);
  assert(!text.includes('OTHER_PRIVATE_QUOTE')); assert(!text.includes('PRIVATE_HISTORY')); assert(!text.includes('SYNTHETIC_PASSWORD')); assert(!text.includes('SYNTHETIC_SESSION'));
});
await test('scope mismatch and unknown customer ids fail closed', async () => {
  await assert.rejects(exportWorkspace({data, output: path.join(root, 'mismatch.json'), scope: 'quote', quoteId: 'q-one', customerId: 'c-two'}), /scope/);
  await assert.rejects(exportWorkspace({data, output: path.join(root, 'unknown-customer.json'), scope: 'ownership', customerIds: ['missing']}), /do not exist/);
  await assert.rejects(exportWorkspace({data, output: path.join(root, 'unknown-member.json'), scope: 'ownership', memberIds: ['missing']}), /missing or invalid/);
  await assert.rejects(exportWorkspace({data, output: path.join(root, 'unscoped.json'), scope: 'ownership'}), /requires/);
});
await test('unsupported quote fields do not leak into snapshots', async () => {
  const output = path.join(root, 'unknown-fields.json');
  await assert.rejects(exportWorkspace({data, output, scope: 'quote', quoteId: 'q-unknown', customerId: 'c-one'}), /unsupported fields/);
  await assert.rejects(fs.stat(output), {code: 'ENOENT'});
});
await test('missing data directories/databases never create a new database', async () => {
  const absent = path.join(root, 'absent');
  await assert.rejects(exportWorkspace({data: absent, output: path.join(root, 'absent.json'), scope: 'ownership', customerIds: ['c-one']}), {code: 'ENOENT'});
  await assert.rejects(fs.stat(absent), {code: 'ENOENT'});
  const empty = path.join(root, 'empty-data'); await fs.mkdir(empty);
  await assert.rejects(exportWorkspace({data: empty, output: path.join(root, 'empty.json'), scope: 'ownership', customerIds: ['c-one']}), {code: 'ENOENT'});
  assert.deepEqual(await fs.readdir(empty), []);
});
await test('exports cannot overwrite data or existing user output', async () => {
  await assert.rejects(exportWorkspace({data, output: dbPath, scope: 'ownership', customerIds: ['c-one']}), /source data/);
  await assert.rejects(exportWorkspace({data, output: path.join(data, 'report.json'), scope: 'ownership', customerIds: ['c-one']}), /source data/);
  const existing = path.join(root, 'existing-output.json'); await fs.writeFile(existing, 'ORIGINAL');
  await assert.rejects(exportWorkspace({data, output: existing, scope: 'ownership', customerIds: ['c-one']}), {code: 'EEXIST'});
  assert.equal(await fs.readFile(existing, 'utf8'), 'ORIGINAL');
});
await test('output directory aliases cannot redirect private exports into source data', async () => {
  const alias = path.join(root, 'data-alias');
  await fs.symlink(data, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(exportWorkspace({data, output: path.join(alias, 'subdirectory/export.json'), scope: 'ownership', customerIds: ['c-one']}), /source data/);
  await assert.rejects(fs.stat(path.join(data, 'subdirectory')), {code: 'ENOENT'});
});
await test('export CLI emits counts without identifiers or private values', async () => {
  const child = spawnSync(process.execPath, [path.join(project, 'scripts/data-tools/export-workspace.mjs'), '--data', data, '--output', path.join(root, 'cli-export.json'), '--scope', 'quote', '--quote-id', 'q-one', '--customer-id', 'c-one'], {encoding: 'utf8'});
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).quoteCount, 1);
  for (const privateValue of ['q-one', 'c-one', 'SYN-QUOTE', 'Synthetic fee', data]) assert(!child.stdout.includes(privateValue));
});
await test('all export success and failure paths preserve source database bytes', async () => {
  assert.equal(hash(await fs.readFile(dbPath)), beforeHash);
});
console.log(JSON.stringify({success: true, checks, syntheticFixturesOnly: true}));
