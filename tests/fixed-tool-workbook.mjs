import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';
import {zipSync, unzipSync, strToU8, strFromU8} from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'test-output');
await fs.mkdir(outputRoot, {recursive: true});
const output = await fs.mkdtemp(path.join(outputRoot, 'fixed-tool-workbook-'));
const outfile = path.join(output, 'workbook.mjs');
const built = await build({
 entryPoints: [path.join(root, 'lib/fixed-tool-workbook.ts')], outfile, bundle: true, platform: 'browser', format: 'esm', metafile: true,
 plugins: [{name: 'pure-app-error', setup(build) {
  build.onResolve({filter: /^\.\/store$/}, args => {
   assert.equal(path.basename(args.importer), 'fixed-tool-workbook.ts');
   return {path: 'app-error', namespace: 'pure-app-error'};
  });
  build.onLoad({filter: /.*/, namespace: 'pure-app-error'}, () => ({contents: 'export class AppError extends Error {constructor(message,status=400){super(message);this.status=status}}', loader: 'js'}));
 }}],
});
// This unit bundle has no runtime, database, filesystem or legacy-script imports.
assert(Object.values(built.metafile.outputs).every(value => value.imports.length === 0));
assert(!Object.keys(built.metafile.inputs).some(name => /(?:standalone|scripts\/data-tools|lib\/store\.ts)/.test(name)));
const {inspectFixedWorkbook: inspect, fixedWorkbookLimits: limits} = await import(pathToFileURL(outfile));
const ab = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['header'], ['synthetic']]), 'Data');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['hidden']]), 'Hidden');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['very hidden']]), 'VeryHidden');
XLSX.utils.book_append_sheet(book, {}, 'Empty');
book.Workbook = {Sheets: [{Hidden: 0}, {Hidden: 1}, {Hidden: 2}, {Hidden: 0}], WBProps: {date1904: false}};
const base = unzipSync(new Uint8Array(XLSX.write(book, {bookType: 'xlsx', type: 'array'})));
const worksheet = body => strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H4"/><sheetData>${body}</sheetData></worksheet>`);
const data = worksheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>原值</t></is></c><c r="B1" t="inlineStr"><is><t>缓存</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>合成&amp;文本</t></is></c><c r="B2"><f>1+2</f><v>3</v></c><c r="C2"><f>7+8</f></c><c r="D2" t="n"><f>9+1</f><v/></c><c r="E2" t="b"><v>0</v></c><c r="F2" t="e"><v>#DIV/0!</v></c><c r="G2" t="str"><f>""</f><v></v></c><c r="H2" t="b"/></row>
<row r="3"><c r="A3"/></row><row r="4"><c r="H4"><v>0</v></c></row>`);
function fixture(changes = {}) { return ab(zipSync({...base, 'xl/worksheets/sheet1.xml': data, ...changes}, {level: 6})); }
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }
function rejected(bytes, input = {operation: 'inspect'}, pattern) {
 assert.throws(() => inspect(bytes, input), error => error.status === 400 && (!pattern || pattern.test(error.message)));
}

test('inspect reports actual dimensions, hidden states and exact missing-cache counts', () => {
 const result = inspect(fixture(), {operation: 'inspect'});
 assert.equal(result.operation, 'inspect'); assert.equal(result.formulaCachesRecalculated, false);
 assert.equal(result.sheets[0].dimension, 'A1:H4');
 assert.equal(result.sheets[0].formulaCells, 4); assert.equal(result.sheets[0].missingFormulaCaches, 2);
 assert.equal(result.sheets[0].errorCells, 1);
 assert.deepEqual(result.sheets.map(sheet => sheet.state), ['visible', 'hidden', 'veryHidden', 'visible']);
 assert.equal(result.sheets[3].dimension, null); assert.equal(result.sheets[3].storedCellCount, 0);
 assert(result.warnings.some(warning => warning.includes('隐藏')));
 assert.doesNotThrow(() => JSON.stringify(result));
});
test('rows preserves scalar values, source positions, formulas, empty caches and unknowns', () => {
 const result = inspect(fixture(), {operation: 'rows', sheet: 'Data', range: 'A1:H4'});
 assert.deepEqual(result.rows.map(row => row.row), [2, 4]); assert.equal(result.omittedEmptyRows, 1);
 assert.equal(result.selection.headers[0].value, '原值');
 const cells = result.rows[0].cells;
 assert.equal(cells[0].value, '合成&文本'); assert.equal(cells[0].address, 'A2');
 assert.equal(cells[1].formula, '1+2'); assert.equal(cells[1].value, null); assert.equal(cells[1].cachedValue, 3); assert.equal(cells[1].sourceValue, '3');
 for (const cell of cells.slice(2, 4)) { assert.equal(cell.cacheStatus, 'missing'); assert.equal(cell.cachedValue, null); assert.equal(cell.unknownReason, 'formula-cache-missing'); }
 assert.equal(cells[4].value, false); assert.equal(cells[5].value, '#DIV/0!'); assert.equal(cells[5].unknownReason, 'error');
 assert.equal(cells[6].cacheStatus, 'present'); assert.equal(cells[6].cachedValue, '');
 assert.equal(cells[7].value, null); assert.equal(cells[7].unknownReason, 'blank');
 assert.equal(result.rows[1].cells[7].value, 0);
 assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});
test('explicit range, header outside range, no-header and empty-row choices are honored', () => {
 const result = inspect(fixture(), {operation: 'rows', sheet: 'Data', range: 'A2:H4', headerRow: 1, includeEmpty: true});
 assert.deepEqual(result.rows.map(row => row.row), [2, 3, 4]); assert.equal(result.selection.headers[0].row, 1);
 const noHeader = inspect(fixture(), {operation: 'rows', sheet: 'Data', range: 'A1:B2', headerRow: 0});
 assert.deepEqual(noHeader.selection.headers, []); assert.equal(noHeader.rows[0].row, 1);
 assert.equal(inspect(fixture(), {operation: 'inspect', sheet: 'Empty', headerRow: 0}).selection.range, null);
});
test('rows requires one explicit sheet/range and rejects invalid runtime options', () => {
 for (const input of [{operation: 'rows'}, {operation: 'rows', sheet: 'Data'}, {operation: 'inspect', range: 'A1'},
  {operation: 'images'}, {operation: 'inspect', sheet: ['Data']}, {operation: 'inspect', includeEmpty: 'false'},
  {operation: 'inspect', path: 'C:/private/file.xlsx'}, {operation: 'inspect', headerRow: -1}, {operation: 'inspect', headerRow: 0.5}]) rejected(fixture(), input);
 rejected(fixture(), {operation: 'rows', sheet: 'Missing', range: 'A1'});
 rejected(fixture(), {operation: 'rows', sheet: 'Data', range: 'A1:H4', headerRow: 5});
 rejected(fixture(), {operation: 'rows', sheet: 'Data', range: 'A1:H5'});
});
test('malicious and excessive ranges fail rather than truncate or scan huge rectangles', () => {
 for (const range of ['A:A', '1:9', 'Data!A1:B2', "'Data'!A1", 'A0', 'XFE1', 'A1048577', 'B2:A1', 'A1:B2:C3', 'A1:XFD1048576', 'A1:A1001', 'A1:CW1', 'A1:CV101', 'A1' + '9'.repeat(100)]) rejected(fixture(), {operation: 'rows', sheet: 'Data', range});
});
test('sparse sheets keep exact cells at row 1000 and row 10001 without parse-time truncation', () => {
 const sparse = worksheet('<row r="1"><c r="A1"><v>1</v></c></row><row r="1000"><c r="J1000"><v>1000</v></c></row><row r="10001"><c r="A10001"><v>10001</v></c></row>');
 const bytes = fixture({'xl/worksheets/sheet1.xml': sparse});
 assert.equal(inspect(bytes, {operation: 'inspect'}).sheets[0].rows, 10001);
 const result = inspect(bytes, {operation: 'rows', sheet: 'Data', range: 'A1:J1000'});
 assert.equal(result.rows.at(-1).row, 1000); assert.equal(result.rows.at(-1).cells[9].value, 1000);
 rejected(bytes, {operation: 'rows', sheet: 'Data', range: 'A2:J1001', headerRow: 1}, /包含表头/);
 const tail = inspect(bytes, {operation: 'rows', sheet: 'Data', range: 'A10001', headerRow: 0});
 assert.equal(tail.rows[0].cells[0].value, 10001);
});
test('shared and array formulas are retained with original formula and independent cache status', () => {
 const formulas = worksheet('<row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">B1+1</f><v>4</v></c><c r="B1"><f t="array" ref="B1:C1">SEQUENCE(1,2)</f><v>3</v></c><c r="C1"><v>4</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/></c></row>');
 const result = inspect(fixture({'xl/worksheets/sheet1.xml': formulas}), {operation: 'rows', sheet: 'Data', range: 'A1:C2', headerRow: 0});
 assert.equal(result.rows[1].cells[0].formula, 'B2+1'); assert.equal(result.rows[1].cells[0].rawFormula, ''); assert.equal(result.rows[1].cells[0].cacheStatus, 'missing');
 assert.equal(result.rows[0].cells[2].arrayFormulaRange, 'B1:C1'); assert.equal(result.rows[0].cells[2].cachedValue, 4);
});
test('non-XLSX, encrypted/macro formats and malformed values are rejected', () => {
 rejected(ab(strToU8('a,b\n1,2'))); rejected(ab(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)));
 rejected(ab(zipSync({'not-a-workbook.txt': strToU8('synthetic')})));
 rejected(fixture({'[Content_Types].xml': strToU8(strFromU8(base['[Content_Types].xml']).replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'))}));
 rejected(fixture({'xl/worksheets/sheet1.xml': worksheet('<row r="1"><c r="A1"><v>7invalid</v></c></row>')}));
 rejected(fixture({'xl/worksheets/sheet1.xml': worksheet('<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row>')}));
 rejected(fixture({'xl/worksheets/sheet1.xml': worksheet('<row r="1"><c r="XFE1"><v>1</v></c></row>')}));
 rejected(fixture({'xl/workbook.xml': strToU8('<!DOCTYPE xml [<!ENTITY bad "bad">]>' + strFromU8(base['xl/workbook.xml']))}));
});
test('compressed input, entry counts, per-entry and aggregate expansion have hard limits', () => {
 rejected(new ArrayBuffer(limits.inputBytes + 1), {operation: 'inspect'}, /10 MiB/);
 const entries = Object.fromEntries(Array.from({length: limits.zipEntries + 1}, (_, i) => [`part${i}`, new Uint8Array()]));
 rejected(ab(zipSync(entries)), {operation: 'inspect'}, /256/);
 rejected(ab(zipSync({'big.bin': new Uint8Array(limits.entryBytes + 1)}, {level: 9})), {operation: 'inspect'}, /8 MiB/);
 rejected(ab(zipSync(Object.fromEntries(Array.from({length: 5}, (_, i) => [`part${i}.bin`, new Uint8Array(7 * 1024 * 1024)])), {level: 9})), {operation: 'inspect'}, /32 MiB/);
});
test('forged small ZIP size cannot bypass actual streaming inflation checks', () => {
 const bytes = zipSync({'oversized.bin': new Uint8Array(2 * 1024 * 1024)}, {level: 9});
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22, directory = view.getUint32(end + 16, true);
 view.setUint32(directory + 24, 16, true); view.setUint32(22, 16, true);
 rejected(ab(bytes), {operation: 'inspect'}, /实际解压/);
});
test('CRC mismatch, duplicate package paths and directory corruption fail closed', () => {
 const bytes = new Uint8Array(fixture()), view = new DataView(bytes.buffer), end = bytes.length - 22, directory = view.getUint32(end + 16, true);
 const local = view.getUint32(directory + 42, true); view.setUint32(directory + 16, 0, true); view.setUint32(local + 14, 0, true);
 rejected(ab(bytes));
 const two = zipSync({'aa': strToU8('a'), 'bb': strToU8('b')}, {level: 0});
 for (let i = 0; i < two.length - 1; i++) if (two[i] === 98 && two[i + 1] === 98) { two[i] = 97; two[i + 1] = 97; }
 rejected(ab(two));
 const corrupted = new Uint8Array(fixture()); corrupted[corrupted.length - 6] = 255; rejected(ab(corrupted));
});
test('stored-cell and result-text limits reject whole requests without partial results', () => {
 const rows = Array.from({length: limits.storedCells + 1}, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>1</v></c></row>`).join('');
 rejected(fixture({'xl/worksheets/sheet1.xml': worksheet(rows)}), {operation: 'inspect'}, /100000/);
 const large = Array.from({length: 80}, (_, i) => `<c r="${XLSX.utils.encode_col(i)}2" t="inlineStr"><is><t>${'x'.repeat(32767)}</t></is></c>`).join('');
 rejected(fixture({'xl/worksheets/sheet1.xml': worksheet(`<row r="2">${large}</row>`)}), {operation: 'rows', sheet: 'Data', range: 'A2:CB2', headerRow: 0}, /文本总量/);
});
test('input bytes remain identical after success and failure; no filesystem path is accepted', () => {
 const bytes = fixture(), before = new Uint8Array(bytes).slice();
 inspect(bytes, {operation: 'inspect'}); inspect(bytes, {operation: 'rows', sheet: 'Data', range: 'A1:H4'});
 rejected(bytes, {operation: 'rows', sheet: 'Data', range: 'A1:XFD1048576'});
 assert.deepEqual(new Uint8Array(bytes), before);
 rejected('C:/nonexistent.xlsx');
 const oldCwd = process.cwd(); process.chdir(output);
 try { assert.equal(inspect(bytes, {operation: 'inspect'}).sheets[0].name, 'Data'); } finally { process.chdir(oldCwd); }
});
test('fixed cooperative time budget rejects an expired operation without a partial result', () => {
 const bytes = fixture(), before = new Uint8Array(bytes).slice(), originalNow = Date.now;
 let calls = 0;
 try {
  // Advance while traversing ZIP entries, without sleeping or changing the API budget.
  Date.now = () => 100000 + (calls++ < 12 ? 0 : limits.parseBudgetMs + 1);
  rejected(bytes, {operation: 'rows', sheet: 'Data', range: 'A1:H4'}, /超过 10 秒预算/);
  assert(calls > 12);
 } finally { Date.now = originalNow; }
 assert.deepEqual(new Uint8Array(bytes), before);
 assert.equal(inspect(bytes, {operation: 'inspect'}).sheets[0].name, 'Data');
});
console.log(`${checks} fixed workbook checks passed; synthetic fixtures only.`);
