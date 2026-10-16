// Offline file transformation. Private configuration and inputs never become source code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const key = value => String(value ?? '').trim().toUpperCase();
const integer = (value, fallback, label) => {
  const n = value ?? fallback;
  assert(Number.isSafeInteger(n) && n > 0, `Invalid ${label}`);
  return n;
};
function sheetName(value) {
  assert(typeof value === 'string' && value.trim() && value.length <= 31 && !/[\\/?:*\[\]]/.test(value) && !value.startsWith("'") && !value.endsWith("'"), 'Invalid output sheet name');
  return value;
}
async function readInput(root, item, label) {
  assert(item && typeof item.path === 'string' && item.path, `${label} path required`);
  assert(/^[a-f0-9]{64}$/i.test(item.sha256 ?? ''), `${label} SHA-256 required`);
  const filename = await fs.realpath(path.resolve(root, item.path));
  assert((await fs.stat(filename)).isFile(), `${label} must be a file`);
  const bytes = await fs.readFile(filename);
  assert.equal(digest(bytes), item.sha256.toLowerCase(), `${label} checksum mismatch`);
  return {filename, bytes};
}
function copiedCell(cell, sourceSheet, coordinate) {
  if (!cell) return undefined;
  const copy = {t: cell.t};
  for (const field of ['v', 'z']) if (Object.hasOwn(cell, field)) copy[field] = cell[field];
  if (cell.f) copy.f = `'${sourceSheet.replaceAll("'", "''")}'!${coordinate}`;
  return copy;
}
function makeSheet(rows, widths) {
  const result = XLSX.utils.aoa_to_sheet(rows);
  result['!cols'] = widths;
  if (rows.length) result['!autofilter'] = {ref: XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:rows[0].length-1}})};
  return result;
}

export async function splitWorkbook(configPath, outputPath) {
  const configFile = await fs.realpath(path.resolve(configPath));
  const rawConfig = await fs.readFile(configFile);
  const config = JSON.parse(rawConfig.toString('utf8'));
  assert.equal(config.schemaVersion, 1, 'Unsupported configuration version');
  const output = path.resolve(outputPath), root = path.dirname(configFile);
  try { await fs.lstat(output); throw new Error('Output directory already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await readInput(root, config.source, 'Workbook');
  const ownershipInput = await readInput(root, config.ownership, 'Ownership');
  assert.equal(path.extname(source.filename).toLowerCase(), '.xlsx', 'Only XLSX input is supported');
  const ownership = JSON.parse(ownershipInput.bytes.toString('utf8'));
  assert(Array.isArray(ownership.customers), 'Ownership customers required');
  assert(Array.isArray(config.groups) && config.groups.length > 0, 'At least one group required');
  const groupIds = new Set(), names = new Set();
  const groups = config.groups.map(group => {
    const name = sheetName(group.name);
    assert(!names.has(name.toLowerCase()), 'Duplicate group name'); names.add(name.toLowerCase());
    assert(Array.isArray(group.memberIds) && group.memberIds.length > 0, 'Group member IDs required');
    for (const id of group.memberIds) {
      assert(typeof id === 'string' && id && !groupIds.has(id), 'Member belongs to multiple groups'); groupIds.add(id);
    }
    return {name, memberIds: new Set(group.memberIds), rows: []};
  });
  const unknownName = sheetName(config.unknownSheet ?? 'Unassigned');
  const mappingName = sheetName(config.mappingSheet ?? 'Customer mapping');
  for (const name of [unknownName, mappingName]) {
    assert(!names.has(name.toLowerCase()), 'Output sheet name collision'); names.add(name.toLowerCase());
  }
  const book = XLSX.read(source.bytes, {type:'buffer', cellFormula:true, cellNF:true, cellDates:false, sheetStubs:true});
  assert(typeof config.sheet === 'string' && book.SheetNames.includes(config.sheet), 'Requested source sheet missing');
  // All original sheets remain in the final package; collision checks include unselected sheets.
  assert(book.SheetNames.every(name => !names.has(name.toLowerCase())), 'Output name conflicts with an original sheet');
  const worksheet = book.Sheets[config.sheet];
  assert(worksheet['!ref'], 'Source sheet is empty');
  const bounds = XLSX.utils.decode_range(worksheet['!ref']);
  const headerRow = integer(config.headerRow, 1, 'header row');
  const firstRow = integer(config.firstRow, headerRow + 1, 'first row');
  const lastRow = integer(config.lastRow, bounds.e.r + 1, 'last row');
  const columns = integer(config.columnCount, bounds.e.c + 1, 'column count');
  const customerColumn = integer(config.customerColumn, undefined, 'customer column');
  assert(firstRow > headerRow && lastRow >= firstRow && lastRow <= bounds.e.r + 1 && columns <= 16380 && customerColumn <= columns, 'Invalid source range');
  const requiredColumns = config.requiredColumns ?? [];
  assert(Array.isArray(requiredColumns) && requiredColumns.every(n => Number.isSafeInteger(n) && n > 0 && n <= columns), 'Invalid required columns');
  const customerIndex = new Map(), customerIds = new Set();
  for (const customer of ownership.customers) {
    assert(typeof customer.id === 'string' && customer.id && !customerIds.has(customer.id), 'Duplicate or missing customer ID'); customerIds.add(customer.id);
    assert(Array.isArray(customer.salesMembers) && Array.isArray(customer.serviceMembers), 'Ownership member arrays required');
    const identities = new Set([customer.customerCode, ...(customer.acceptedIdentities ?? [])].map(key).filter(Boolean));
    for (const identity of identities) {
      assert(!customerIndex.has(identity) || customerIndex.get(identity).id === customer.id, 'Ambiguous customer identity');
      customerIndex.set(identity, customer);
    }
  }
  const unknown = {name:unknownName, rows:[]};
  const sourceRows = [], omittedRows = [];
  const valueAt = (row, column) => worksheet[XLSX.utils.encode_cell({r:row-1,c:column-1})]?.v;
  for (let row = firstRow; row <= lastRow; row++) {
    for (let c=0;c<columns;c++) {
      const cell=worksheet[XLSX.utils.encode_cell({r:row-1,c})];
      assert(!cell?.f || cell.t !== 'z' && cell.v !== undefined && cell.v !== null,
        'Source formula has no saved value; recalculate a reviewed copy before splitting');
    }
    const nonempty = Array.from({length:columns}, (_, col) => worksheet[XLSX.utils.encode_cell({r:row-1,c:col})]).some(cell => cell && (cell.f || cell.v !== undefined && cell.v !== null && cell.v !== ''));
    if (!nonempty || requiredColumns.some(column => valueAt(row, column) === undefined || valueAt(row, column) === null || valueAt(row, column) === '')) { omittedRows.push(row); continue; }
    const cell = worksheet[XLSX.utils.encode_cell({r:row-1,c:customerColumn-1})];
    assert(!cell?.f && cell?.t !== 'e', 'Customer identity cannot be a formula or error');
    const identity = key(cell?.v), customer = customerIndex.get(identity);
    const memberIds = new Set([...(customer?.salesMembers ?? []), ...(customer?.serviceMembers ?? [])].map(member => member.id));
    const matches = groups.filter(group => [...group.memberIds].some(id => memberIds.has(id)));
    assert(matches.length <= 1, 'Customer matches multiple selected groups');
    (matches[0] ?? unknown).rows.push({sourceRow:row, identity, customer}); sourceRows.push(row);
  }
  const extra = XLSX.utils.book_new();
  // Placeholder is omitted by merge_workbooks.py; references then resolve to the untouched original.
  XLSX.utils.book_append_sheet(extra, XLSX.utils.aoa_to_sheet([['Source placeholder']]), config.sheet);
  extra.Workbook = {WBProps:{date1904: !!book.Workbook?.WBProps?.date1904}};
  const headers = Array.from({length:columns}, (_, c) => worksheet[XLSX.utils.encode_cell({r:headerRow-1,c})]?.v ?? '');
  const widths = [...Array.from({length:columns}, () => ({wch:18})),{wch:14},{wch:32}];
  const summary = [];
  for (const group of [...groups, unknown]) {
    const sheet = makeSheet([[...headers,'Source row','Customer'], ...group.rows.map(row => [...Array(columns).fill(null), row.sourceRow, row.customer?.customer ?? ''])], widths);
    group.rows.forEach((row, r) => {
      for (let c=0;c<columns;c++) {
        const address = XLSX.utils.encode_cell({r:row.sourceRow-1,c});
        const copy = copiedCell(worksheet[address], config.sheet, address);
        if (copy) sheet[XLSX.utils.encode_cell({r:r+1,c})] = copy;
      }
    });
    XLSX.utils.book_append_sheet(extra, sheet, group.name);
    summary.push({name:group.name, rows:group.rows.length, sourceRows:group.rows.map(row=>row.sourceRow)});
  }
  const mappingRows = [['Source row','Customer identity','Customer ID','Group']];
  for (const group of [...groups, unknown]) for (const row of group.rows) mappingRows.push([row.sourceRow, row.identity, row.customer?.id ?? '', group.name]);
  XLSX.utils.book_append_sheet(extra, makeSheet(mappingRows,[{wch:14},{wch:24},{wch:32},{wch:24}]), mappingName);
  const bytes = XLSX.write(extra, {type:'buffer',bookType:'xlsx',compression:true});
  const parsed = XLSX.read(bytes,{type:'buffer',cellNF:true,cellFormula:true});
  for (const group of [...groups,unknown]) group.rows.forEach((row,r)=>{
    for(let c=0;c<columns;c++) {
      const address=XLSX.utils.encode_cell({r:row.sourceRow-1,c}), original=worksheet[address];
      if(!original || original.v === undefined && !original.f) continue;
      const stored=parsed.Sheets[group.name][XLSX.utils.encode_cell({r:r+1,c})];
      assert(stored, 'Output cell missing');
      if(original.f) assert.equal(stored.f,`'${config.sheet.replaceAll("'","''")}'!${address}`,'Formula reference changed');
      if(Object.hasOwn(original,'v')) assert.deepEqual(stored.v,original.v,'Cell cache/value changed');
      if(original.z) assert.equal(stored.z,original.z,'Number format changed');
    }
  });
  assert.equal(digest(await fs.readFile(source.filename)), digest(source.bytes), 'Workbook changed during processing');
  assert.equal(digest(await fs.readFile(ownershipInput.filename)), digest(ownershipInput.bytes), 'Ownership changed during processing');
  const report={schemaVersion:1,sourceSha256:digest(source.bytes),ownershipSha256:digest(ownershipInput.bytes),configSha256:digest(rawConfig),sheet:config.sheet,sourceRows,omittedRows,totalRows:sourceRows.length,columnCount:columns,summary,unknownRows:unknown.rows.length,extraSha256:digest(bytes),omitSheet:config.sheet,formulas:'Reference unchanged original cells; preserve existing cached values. No calculation engine is used.'};
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.mkdir(output); // Exclusive directory creation protects concurrent jobs and existing results.
  await fs.writeFile(path.join(output,'extra.xlsx'),bytes,{flag:'wx'});
  await fs.writeFile(path.join(output,'classification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return {output,rows:sourceRows.length,groups:groups.length,unassigned:unknown.rows.length,sourceSha256:report.sourceSha256};
}

async function main() {
  const args=process.argv.slice(2), options={};
  if(args.length===1&&args[0]==='--help') { console.log('node split-workbook.mjs --config PRIVATE.json --output NEW_DIRECTORY'); return; }
  while(args.length) {
    const name=args.shift(); assert(['--config','--output'].includes(name)&&!Object.hasOwn(options,name),'Unknown or duplicate option');
    const value=args.shift(); assert(value&&!value.startsWith('--'),'Missing option value'); options[name]=value;
  }
  assert(options['--config']&&options['--output'],'Required: --config and --output');
  console.log(JSON.stringify(await splitWorkbook(options['--config'],options['--output'])));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{
  const message=error instanceof SyntaxError?'Invalid JSON input':error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:error.code?`File operation failed (${error.code})`:'Split failed; check the private input files and output directory';
  console.error(message);process.exitCode=1;
});
