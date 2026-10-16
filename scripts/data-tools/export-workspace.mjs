// Offline operator export. OS access controls apply; this is not an employee-facing API.
// Explicit scope is mandatory. Authentication/session tables are never queried.
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

function check(condition, message) { if (!condition) throw new Error(message); }
function list(value) {
  const values = typeof value === 'string' ? value.split(',').map(item => item.trim()) : value;
  check(Array.isArray(values) && values.length > 0 && values.every(item => typeof item === 'string' && item.length > 0) && new Set(values).size === values.length, 'Identifiers must be a nonempty unique list');
  return values;
}
function ids(value) {
  check(value === undefined || Array.isArray(value) && value.every(item => typeof item === 'string' && item) && new Set(value).size === value.length, 'Stored responsibility ids are invalid');
  return value ?? [];
}
function storedIds(value) {
  if (value === null) return [];
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('Stored responsibility ids are invalid'); }
  return ids(parsed);
}
function inside(parent, child) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
const quoteFields = new Set('id kind status version createdAt createdBy createdById updatedAt updatedBy updatedById confirmedAt confirmedBy confirmedById companyEn companyZh collectionEn collectionZh customerCode customerName customerAccountId contactName brand businessType quoteMode pricingBasis currencyReviewed quoteNo quoteDate validUntil currency internalNotesZh exchangeRateCnyPerUsd internalCosts customerCharges lines terms reviewNotes sourceFilename sourceHash sourceFileKey sourceContentType templateBinding templateMapping templateFileKey mediaIds'.split(' '));
function options(argv) {
  const result = {};
  while (argv.length) {
    const key = argv.shift();
    check(['--data', '--output', '--scope', '--customer-ids', '--member-ids', '--quote-id', '--customer-id'].includes(key) && !Object.hasOwn(result, key), 'Invalid or duplicate option');
    check(argv.length && !argv[0].startsWith('--'), 'Option value is required'); result[key] = argv.shift();
  }
  check(result['--data'] && result['--output'] && result['--scope'], '--data, --output and --scope are required');
  return result;
}

export async function exportWorkspace({data, output, scope, customerIds, memberIds, quoteId, customerId}) {
  check(typeof data === 'string' && typeof output === 'string', 'Explicit data and output paths are required');
  check(['ownership', 'quote'].includes(scope), 'Scope must be ownership or quote');
  if (scope === 'ownership') {
    check(customerIds !== undefined || memberIds !== undefined, 'Ownership export requires customer ids or member ids');
    check(quoteId === undefined && customerId === undefined, 'Quote selectors cannot be used for ownership');
    if (customerIds !== undefined) customerIds = list(customerIds);
    if (memberIds !== undefined) memberIds = list(memberIds);
  } else {
    check(typeof quoteId === 'string' && quoteId.length > 0 && typeof customerId === 'string' && customerId.length > 0, 'Quote export requires quote id and customer id');
    check(customerIds === undefined && memberIds === undefined, 'Ownership selectors cannot be used for quote export');
  }
  const directory = await fs.realpath(path.resolve(data));
  check((await fs.stat(directory)).isDirectory(), 'Data must be a directory');
  const candidate = path.join(directory, 'workspace.sqlite');
  const database = await fs.realpath(candidate);
  check(inside(directory, database) && (await fs.stat(database)).isFile(), 'Existing workspace.sqlite must be a regular file in data directory');
  const destination = path.resolve(output);
  check(!inside(directory, destination), 'Output must be outside the source data directory');
  // Check any existing ancestor as well, so an output symlink cannot redirect into source data.
  let ancestor = path.dirname(destination);
  while (true) {
    try { check(!inside(directory, await fs.realpath(ancestor)), 'Output ancestor must be outside source data'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const next = path.dirname(ancestor); check(next !== ancestor, 'Output parent is invalid'); ancestor = next; }
  }
  let result;
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    db.exec('PRAGMA query_only = ON');
    check(db.prepare('PRAGMA query_only').get().query_only === 1, 'Read-only query guard was not enabled');
    db.exec('BEGIN');
    if (scope === 'quote') {
      const row = db.prepare("SELECT data FROM records WHERE kind='customer_quote' AND id=?").get(quoteId);
      check(row, 'Requested current quotation does not exist');
      let quote; try { quote = JSON.parse(row.data); } catch { throw new Error('Stored quotation JSON is invalid'); }
      check(quote.id === quoteId && quote.kind === 'customer_quote' && quote.customerAccountId === customerId, 'Quotation is outside the requested customer scope');
      check(Object.keys(quote).every(key => quoteFields.has(key)), 'Quotation contains unsupported fields; review export schema before proceeding');
      check(Number.isInteger(quote.version) && quote.version > 0 && ['draft', 'confirmed'].includes(quote.status), 'Quotation version or status is invalid');
      result = {schemaVersion: 1, scope, quote, summary: {quoteCount: 1}};
    } else {
      const columns = "id, json_extract(data,'$.id') AS recordId, json_extract(data,'$.kind') AS recordKind, json_extract(data,'$.customerCode') AS customerCode, json_extract(data,'$.customer') AS customer, json_extract(data,'$.salesMemberIds') AS salesIds, json_extract(data,'$.serviceMemberIds') AS serviceIds";
      const selected = customerIds ? db.prepare(`SELECT ${columns} FROM records WHERE kind='customer_account' AND id IN (${customerIds.map(() => '?').join(',')}) ORDER BY id`).all(...customerIds) : db.prepare(`SELECT ${columns} FROM records WHERE kind='customer_account' AND (EXISTS (SELECT 1 FROM json_each(records.data,'$.salesMemberIds') WHERE value IN (${memberIds.map(() => '?').join(',')})) OR EXISTS (SELECT 1 FROM json_each(records.data,'$.serviceMemberIds') WHERE value IN (${memberIds.map(() => '?').join(',')}))) ORDER BY id`).all(...memberIds, ...memberIds);
      if (customerIds) check(selected.length === customerIds.length, 'One or more requested customers do not exist');
      const memberCache = new Map();
      function member(id) {
        if (!memberCache.has(id)) {
          const row = db.prepare("SELECT id,json_extract(data,'$.id') AS recordId,json_extract(data,'$.kind') AS recordKind,json_extract(data,'$.name') AS name FROM records WHERE kind='member' AND id=?").get(id);
          check(row && row.recordId === id && row.recordKind === 'member' && typeof row.name === 'string', 'A responsibility member is missing or invalid');
          memberCache.set(id, {id, name: row.name});
        }
        return memberCache.get(id);
      }
      if (memberIds) for (const id of memberIds) member(id);
      let customersWithoutExplicitOwnership = 0;
      const customers = [];
      for (const row of selected) {
        check(row.recordId === row.id && row.recordKind === 'customer_account' && typeof row.customerCode === 'string' && typeof row.customer === 'string', 'Stored customer identity is invalid');
        const sales = storedIds(row.salesIds);
        const service = storedIds(row.serviceIds);
        if (memberIds && ![...sales, ...service].some(id => memberIds.includes(id))) continue;
        if (row.salesIds === null && row.serviceIds === null) customersWithoutExplicitOwnership++;
        customers.push({id: row.id, customerCode: row.customerCode, customer: row.customer, acceptedIdentities: row.customerCode.trim() ? [row.customerCode] : [], salesMembers: sales.map(member), serviceMembers: service.map(member)});
      }
      result = {schemaVersion: 1, scope, customers, summary: {customerCount: customers.length, memberCount: new Set(customers.flatMap(customer => [...customer.salesMembers, ...customer.serviceMembers].map(member => member.id))).size, customersWithoutExplicitOwnership}};
    }
    db.exec('ROLLBACK');
  } finally { db.close(); }
  await fs.mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
  // Exclusive creation prevents overwriting any source, prior export or user file.
  await fs.writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, {flag: 'wx', mode: 0o600});
  return {success: true, scope, ...result.summary};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = options(process.argv.slice(2));
    console.log(JSON.stringify(await exportWorkspace({data: args['--data'], output: args['--output'], scope: args['--scope'], customerIds: args['--customer-ids'], memberIds: args['--member-ids'], quoteId: args['--quote-id'], customerId: args['--customer-id']})));
  } catch (error) { console.error(JSON.stringify({success: false, error: error.code ? `Operation failed (${error.code})` : error.message})); process.exitCode = 1; }
}
