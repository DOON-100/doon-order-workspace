import * as XLSX from 'xlsx';
import {Inflate} from 'fflate';
import {AppError} from './store';

export const fixedWorkbookLimits = Object.freeze({
 inputBytes: 10 * 1024 * 1024, zipEntries: 256, entryBytes: 8 * 1024 * 1024,
 expandedBytes: 32 * 1024 * 1024, sheets: 64, storedCells: 100000,
 rows: 1000, columns: 100, cells: 10000, resultText: 2 * 1024 * 1024, parseBudgetMs: 10000,
});
export type FixedWorkbookInput = {
 operation: 'inspect' | 'rows'; sheet?: string; range?: string; headerRow?: number; includeEmpty?: boolean;
};
type Scalar = string | number | boolean | null;
export type FixedWorkbookCell = {
 address: string; row: number; column: number; type: string; value: Scalar;
 formula: string | null; rawFormula: string | null; cachedValue: Scalar;
 cacheStatus: 'not-formula' | 'present' | 'missing'; unknown: boolean;
 unknownReason: 'blank' | 'formula-cache-missing' | 'error' | 'unsupported-value' | null;
 sourceValue: string | null; numberFormat: string | null; arrayFormulaRange: string | null;
};
type Box = {s: {r: number; c: number}; e: {r: number; c: number}};
type RawCell = {type: string; formula: string | null; hasFormula: boolean; cache: string | null; hasCache: boolean};
type SheetSource = {name: string; state: 'visible' | 'hidden' | 'veryHidden'; declaredDimension: string | null; cells: Map<string, RawCell>; dimension: string | null; box: Box | null};
function fail(message: string): never { throw new AppError(message); }
function invalid(): never { return fail('XLSX 压缩包已损坏或使用不支持的格式。'); }

// Bound actual inflation, not only attacker-controlled ZIP directory sizes.
const crcTable = Uint32Array.from({length: 256}, (_, n) => {
 let crc = n; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
 let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function utf8(bytes: Uint8Array) {
 try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return invalid(); }
}
function archive(bytes: Uint8Array, checkTime: () => void) {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) invalid();
 let end = -1;
 for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
  if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
 }
 if (end < 0) invalid();
 const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), length = view.getUint32(end + 12, true);
 if (!count || count > fixedWorkbookLimits.zipEntries) fail('XLSX 压缩条目数超过 256 或没有内容。');
 if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || start + length !== end) invalid();
 type Entry = {name: string; offset: number; dataStart: number; dataEnd: number; size: number; method: number; crc: number};
 const entries: Entry[] = [], names = new Set<string>(); let p = start, declaredTotal = 0;
 for (let i = 0; i < count; i++) {
  checkTime();
  if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50) invalid();
  const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true), crc = view.getUint32(p + 16, true);
  const compressed = view.getUint32(p + 20, true), size = view.getUint32(p + 24, true), n = view.getUint16(p + 28, true);
  const extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true), offset = view.getUint32(p + 42, true);
  if (p + 46 + n + extra + comment > end || flags & ~0x080e || ![0, 8].includes(method) || view.getUint16(p + 34, true)) invalid();
  const name = utf8(bytes.subarray(p + 46, p + 46 + n));
  if (!name || name.length > 240 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.includes('//') || name.split('/').some(s => ['.', '..', '__proto__', 'constructor', 'prototype'].includes(s)) || names.has(name)) invalid();
  names.add(name);
  if (size > fixedWorkbookLimits.entryBytes || (declaredTotal += size) > fixedWorkbookLimits.expandedBytes) fail('XLSX 解压内容超过单条 8 MiB 或合计 32 MiB 限制。');
  if (offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) invalid();
  const localName = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true), dataStart = offset + 30 + localName + localExtra;
  if (dataStart + compressed > start || utf8(bytes.subarray(offset + 30, offset + 30 + localName)) !== name) invalid();
  if (!(flags & 8) && (view.getUint32(offset + 14, true) !== crc || view.getUint32(offset + 18, true) !== compressed || view.getUint32(offset + 22, true) !== size)) invalid();
  if (method === 0 && compressed !== size || name.endsWith('/') && size !== 0) invalid();
  entries.push({name, offset, dataStart, dataEnd: dataStart + compressed, size, method, crc}); p += 46 + n + extra + comment;
 }
 if (p !== end) invalid();
 const ordered = [...entries].sort((a, b) => a.offset - b.offset);
 for (let i = 1; i < ordered.length; i++) if (ordered[i].offset < ordered[i - 1].dataEnd) invalid();
 const files = new Map<string, Uint8Array>(); let actualTotal = 0;
 for (const entry of entries) {
  checkTime();
  let size = 0; const parts: Uint8Array[] = [];
  const receive = (part: Uint8Array) => {
   checkTime();
   size += part.length; actualTotal += part.length;
   if (size > entry.size || size > fixedWorkbookLimits.entryBytes || actualTotal > fixedWorkbookLimits.expandedBytes) fail('XLSX 实际解压大小超过限制或与声明不符。');
   parts.push(part);
  };
  if (entry.method === 0) receive(bytes.slice(entry.dataStart, entry.dataEnd));
  else {
   const inflater = new Inflate(receive);
   // A small compressed chunk bounds work before each actual-size check.
   for (let pos = entry.dataStart; pos < entry.dataEnd; pos += 512) {
    checkTime();
    inflater.push(bytes.subarray(pos, Math.min(pos + 512, entry.dataEnd)), pos + 512 >= entry.dataEnd);
   }
   if (entry.dataStart === entry.dataEnd) invalid();
  }
  if (size !== entry.size) invalid();
  const output = new Uint8Array(size); let at = 0; for (const part of parts) { output.set(part, at); at += part.length; }
  if (crc32(output) !== entry.crc) invalid();
  checkTime();
  files.set(entry.name, output);
 }
 return files;
}

function unxml(text: string) {
 return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key: string) => {
  if (key[0] === '#') { const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)); if (code < 1 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) invalid(); return String.fromCodePoint(code); }
  return ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"} as Record<string, string>)[key.toLowerCase()];
 });
}
function attributes(tag: string) {
 const values: Record<string, string> = Object.create(null);
 for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
  if (Object.hasOwn(values, match[1])) invalid(); values[match[1]] = unxml(match[3]);
 }
 return values;
}
function cellPosition(address: string) {
 if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address)) fail('单元格地址须为有效的 Excel A1 坐标。');
 const position = XLSX.utils.decode_cell(address);
 if (position.c >= 16384 || position.r >= 1048576) fail('单元格坐标超过 Excel 边界。');
 return position;
}
function rangeBox(value: string): Box {
 if (typeof value !== 'string' || value.length > 32 || !/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(value)) fail('范围须为明确的 A1 或 A1:D20 矩形，不含工作表名。');
 const [first, last = first] = value.split(':'), s = cellPosition(first), e = cellPosition(last);
 if (s.r > e.r || s.c > e.c) fail('范围的结束位置不能早于开始位置。');
 return {s, e};
}
function limitedRange(value: string) {
 const box = rangeBox(value), rows = box.e.r - box.s.r + 1, columns = box.e.c - box.s.c + 1;
 if (rows > fixedWorkbookLimits.rows || columns > fixedWorkbookLimits.columns || rows * columns > fixedWorkbookLimits.cells) fail('每次范围最多 1000 行、100 列、10000 格，请明确缩小范围。');
 return box;
}
function xmlFiles(files: Map<string, Uint8Array>, checkTime: () => void) {
 const texts = new Map<string, string>();
 for (const [name, bytes] of files) if (/\.(?:xml|rels)$/.test(name)) {
  checkTime();
  const text = utf8(bytes);
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text)) fail('XLSX 含不支持的 XML 内容，请另存为普通 XLSX。');
  texts.set(name, text.replace(/<!--[\s\S]*?-->/g, ''));
  checkTime();
 }
 const types = texts.get('[Content_Types].xml') || '';
 const overrides = [...types.matchAll(/<(?:\w+:)?Override\b[^>]*>/g)].map(tag => attributes(tag[0]));
 const workbookType = overrides.find(type => type.PartName === '/xl/workbook.xml')?.ContentType;
 // SheetJS declares a default .bin MIME type even in ordinary XLSX files.
 if (workbookType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' || overrides.some(type => /macroEnabled|vbaProject|sheet\.binary/i.test(type.ContentType || '')) || [...files.keys()].some(name => /(?:vbaProject\.bin|workbook\.bin)$/i.test(name))) fail('只支持未加密、无宏的 XLSX 工作簿。');
 if (!texts.has('xl/workbook.xml') || !texts.has('xl/_rels/workbook.xml.rels')) fail('XLSX 工作簿结构不受支持。');
 return texts;
}
function sheetSources(texts: Map<string, string>, checkTime: () => void) {
 const rels = new Map<string, string>();
 for (const tag of texts.get('xl/_rels/workbook.xml.rels')!.matchAll(/<(?:\w+:)?Relationship\b[^>]*\/?\s*>/g)) {
  checkTime();
  const a = attributes(tag[0]); if (!a.Id || rels.has(a.Id)) invalid();
  if (!a.Type?.endsWith('/worksheet')) continue;
  if (a.TargetMode === 'External' || !a.Target || /[\\:\x00-\x1f]/.test(a.Target)) invalid();
  const parts = (a.Target.startsWith('/') ? a.Target.slice(1) : 'xl/' + a.Target).split('/'), result: string[] = [];
  for (const part of parts) { if (part === '..') { if (!result.length) invalid(); result.pop(); } else if (part && part !== '.') result.push(part); }
  const target = result.join('/'); if (!target.startsWith('xl/') || !texts.has(target)) invalid(); rels.set(a.Id, target);
 }
 const sources: SheetSource[] = [], names = new Set<string>(); let stored = 0;
 for (const tag of texts.get('xl/workbook.xml')!.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?\s*>/g)) {
  checkTime();
  const a = attributes(tag[0]), target = rels.get(a['r:id']);
  if (!a.name || a.name.length > 31 || names.has(a.name.toLowerCase()) || !target) fail('工作表名称、类型或引用无效；只支持普通工作表。');
  names.add(a.name.toLowerCase()); if (names.size > fixedWorkbookLimits.sheets) fail('工作簿最多允许 64 张工作表。');
  const state = a.state || 'visible'; if (!['visible', 'hidden', 'veryHidden'].includes(state)) invalid();
  const xml = texts.get(target)!, dimensionTag = xml.match(/<(?:\w+:)?dimension\b[^>]*>/)?.[0];
  const declaredDimension = dimensionTag ? attributes(dimensionTag).ref || null : null;
  if (declaredDimension) rangeBox(declaredDimension);
  const cells = new Map<string, RawCell>(); let box: Box | null = null;
  const starts = [...xml.matchAll(/<(?:\w+:)?c(?=\s|\/?>)/g)].length;
  checkTime();
  for (const match of xml.matchAll(/<(?:\w+:)?c(?=\s|\/?>)([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c\s*>)/g)) {
   checkTime();
   const attrs = attributes(match[1]), address = attrs.r;
   if (!address || cells.has(address)) fail('工作表含缺失或重复单元格坐标，不能可靠提取。');
   const pos = cellPosition(address); if (++stored > fixedWorkbookLimits.storedCells) fail('工作簿存储单元格超过 100000 格，请拆分文件。');
   if (!box) box = {s: {...pos}, e: {...pos}};
   else { box.s.r = Math.min(box.s.r, pos.r); box.s.c = Math.min(box.s.c, pos.c); box.e.r = Math.max(box.e.r, pos.r); box.e.c = Math.max(box.e.c, pos.c); }
   const body = match[2] || '', formula = body.match(/<(?:\w+:)?f(?=\s|\/?>)[^>]*(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f\s*>)/);
   const cache = body.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v\s*>/);
   const type = attrs.t || 'n', rawCache = cache ? unxml(cache[1]) : null;
   if (!['n', 's', 'str', 'inlineStr', 'b', 'e', 'd', 'z'].includes(type)) fail('工作表含不支持的单元格类型。');
   if (rawCache !== null && rawCache !== '' && (type === 'n' && (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawCache) || !Number.isFinite(Number(rawCache))) || type === 'b' && !['0', '1', 'true', 'false'].includes(rawCache) || type === 's' && !/^\d+$/.test(rawCache))) fail('单元格原值与声明类型不符，不能可靠转换。');
   cells.set(address, {type, formula: formula ? unxml(formula[1] || '') : null, hasFormula: !!formula,
    cache: rawCache, hasCache: !!cache && (rawCache !== '' || type === 'str')});
  }
  if (cells.size !== starts) fail('工作表 XML 不完整，不能可靠提取。');
  sources.push({name: a.name, state: state as SheetSource['state'], declaredDimension, cells, box, dimension: box ? XLSX.utils.encode_range(box) : null});
 }
 if (!sources.length) fail('工作簿没有可检查的工作表。');
 return sources;
}
function scalar(value: unknown): Scalar {
 return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function reportCell(sheet: XLSX.WorkSheet, source: SheetSource, row: number, column: number): FixedWorkbookCell {
 const address = XLSX.utils.encode_cell({r: row - 1, c: column - 1}), cell = sheet[address] as XLSX.CellObject | undefined, raw = source.cells.get(address);
 const isFormula = !!raw?.hasFormula || !!cell?.F, hasCache = !!raw?.hasCache;
 const rawValue = raw && !raw.hasCache && raw.type !== 'inlineStr' ? null : raw?.type === 'e' || raw?.type === 'd' ? raw.cache : cell?.v;
 const value = isFormula ? null : scalar(rawValue), cachedValue = isFormula && hasCache ? scalar(rawValue) : null;
 const unknownReason = isFormula && !hasCache ? 'formula-cache-missing' : cell?.t === 'e' ? 'error' : !isFormula && value === null ? (!cell || cell.t === 'z' || raw && !raw.hasCache && raw.type !== 'inlineStr' ? 'blank' : 'unsupported-value') : isFormula && hasCache && cachedValue === null ? 'unsupported-value' : null;
 return {address, row, column, type: raw?.type || cell?.t || 'blank', value,
  formula: isFormula ? raw?.formula || cell?.f || null : null, rawFormula: raw?.formula ?? null, cachedValue,
  cacheStatus: isFormula ? hasCache ? 'present' : 'missing' : 'not-formula', unknown: unknownReason !== null, unknownReason,
  sourceValue: raw?.cache ?? null, numberFormat: typeof cell?.z === 'string' ? cell.z : null, arrayFormulaRange: cell?.F || null};
}

/** Pure in-memory read: no paths, filesystem, business records or formula evaluation. */
export function inspectFixedWorkbook(bytes: ArrayBuffer, input: FixedWorkbookInput) {
 const deadline = Date.now() + fixedWorkbookLimits.parseBudgetMs;
 // Cooperative only: a synchronous library call cannot be interrupted mid-call.
 const checkTime = () => { if (Date.now() > deadline) fail('工作簿处理超过 10 秒预算，未返回结果；请拆分文件或缩小范围。'); };
 if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > fixedWorkbookLimits.inputBytes) fail('请提供非空、最多 10 MiB 的 XLSX 文件内容。');
 if (!input || !['inspect', 'rows'].includes(input.operation)) fail('操作仅支持 inspect 或 rows。');
 if (Object.keys(input).some(key => !['operation', 'sheet', 'range', 'headerRow', 'includeEmpty'].includes(key))) fail('文件检查参数包含不支持的字段。');
 if (input.sheet !== undefined && (typeof input.sheet !== 'string' || !input.sheet || input.sheet.length > 31)) fail('请选择一张有效工作表。');
 if (input.includeEmpty !== undefined && typeof input.includeEmpty !== 'boolean') fail('includeEmpty 须为布尔值。');
 const headerRow = input.headerRow ?? 1;
 if (!Number.isSafeInteger(headerRow) || headerRow < 0 || headerRow > 1048576) fail('表头行须为 0（无表头）或有效正整数行号。');
 if (input.operation === 'rows' && (!input.sheet || !input.range)) fail('行提取必须明确选择一张工作表和范围。');
 if (input.range !== undefined && !input.sheet) fail('指定范围时必须同时选择一张工作表。');
 const requested = input.range !== undefined ? limitedRange(input.range) : null;
 try {
  checkTime();
  const sourceBytes = new Uint8Array(bytes), texts = xmlFiles(archive(sourceBytes, checkTime), checkTime), sources = sheetSources(texts, checkTime);
  // No sheetRows cap: limits reject the request rather than silently truncating it.
  checkTime();
  const book = XLSX.read(sourceBytes, {type: 'array', cellFormula: true, cellNF: true, cellDates: false, cellText: false, cellHTML: false, sheetStubs: true, dense: false, nodim: true, xlfn: true, WTF: true});
  checkTime();
  if (book.SheetNames.length !== sources.length || sources.some(source => !book.Sheets[source.name])) fail('工作表解析结果与原件不一致。');
  const warnings = ['公式未重新计算；缓存可能过期，空白和缺失缓存不视为零。', '本结果仅检查单元格；图片、批注、图表及附件不在本次提取范围。'];
  const sheets = sources.map(source => {
   checkTime();
   let formulaCells = 0, missingFormulaCaches = 0, errorCells = 0;
   const sheet = book.Sheets[source.name];
   for (const [address, raw] of source.cells) {
    checkTime();
    if (!sheet[address]) fail('解析器遗漏原件单元格，未返回不完整结果。');
    if (raw.hasFormula || sheet[address]?.F) { formulaCells++; if (!raw.hasCache) missingFormulaCaches++; }
    if (raw.type === 'e') errorCells++;
   }
   if (source.declaredDimension && source.declaredDimension !== source.dimension) warnings.push(`工作表“${source.name}”声明范围与实际存储坐标不同，摘要采用实际坐标。`);
   return {name: source.name, state: source.state, dimension: source.dimension, declaredDimension: source.declaredDimension,
    rows: source.box ? source.box.e.r + 1 : 0, columns: source.box ? source.box.e.c + 1 : 0,
    storedCellCount: source.cells.size, formulaCells, missingFormulaCaches, errorCells, mergedRangeCount: sheet['!merges']?.length || 0};
  });
  if (sheets.some(sheet => sheet.state !== 'visible')) warnings.push('工作簿含隐藏工作表；隐藏状态不代表访问权限。');
  const common = {schemaVersion: 1 as const, operation: input.operation, format: 'xlsx' as const, formulaCachesRecalculated: false as const,
   source: {byteLength: bytes.byteLength}, limits: fixedWorkbookLimits, date1904: !!book.Workbook?.WBProps?.date1904, sheets, warnings};
  checkTime();
  if (!input.sheet) return {...common, selection: null, rows: [] as {row: number; cells: FixedWorkbookCell[]}[], returnedRows: 0, omittedEmptyRows: 0};
  const source = sources.find(sheet => sheet.name === input.sheet); if (!source) fail('所选工作表不存在。');
  const sheet = book.Sheets[source.name];
  if (!source.box) {
   if (requested || input.operation === 'rows' || headerRow !== 0) fail('所选工作表没有存储单元格；请选择其他表或使用无表头检查。');
   return {...common, selection: {sheet: source.name, range: null, headerRow: 0, headers: [] as FixedWorkbookCell[]}, rows: [] as {row: number; cells: FixedWorkbookCell[]}[], returnedRows: 0, omittedEmptyRows: 0};
  }
  const box = requested || limitedRange(source.dimension!);
  if (box.e.r > source.box.e.r || box.e.c > source.box.e.c) fail('所选范围超出工作表实际存储边界。');
  if (headerRow > source.box.e.r + 1) fail('表头行超出工作表实际存储边界。');
  if (input.operation === 'rows' && headerRow > box.e.r + 1) fail('表头之后没有所选数据行，请核对表头与范围。');
  const dataRowCount = Math.max(0, box.e.r + 2 - Math.max(box.s.r + 1, headerRow + 1));
  if (input.operation === 'rows' && (dataRowCount + (headerRow ? 1 : 0)) * (box.e.c - box.s.c + 1) > fixedWorkbookLimits.cells) fail('包含表头的提取总量超过 10000 格，请缩小范围。');
  let textSize = 0;
  const cellAt = (row: number, column: number) => {
   checkTime();
   const cell = reportCell(sheet, source, row, column);
   for (const value of Object.values(cell)) if (typeof value === 'string') textSize += value.length;
   if (textSize > fixedWorkbookLimits.resultText) fail('所选单元格文本总量超过 2 MiB 字符限额，请缩小范围。');
   return cell;
  };
  const headers = headerRow ? Array.from({length: box.e.c - box.s.c + 1}, (_, i) => cellAt(headerRow, box.s.c + i + 1)) : [];
  const selection = {sheet: source.name, range: XLSX.utils.encode_range(box), headerRow, headers};
  const rows: {row: number; cells: FixedWorkbookCell[]}[] = []; let omittedEmptyRows = 0;
  if (input.operation === 'rows') for (let r = Math.max(box.s.r + 1, headerRow + 1); r <= box.e.r + 1; r++) {
   checkTime();
   const cells = Array.from({length: box.e.c - box.s.c + 1}, (_, i) => cellAt(r, box.s.c + i + 1));
   if (!input.includeEmpty && cells.every(cell => cell.value === null && cell.cacheStatus === 'not-formula')) { omittedEmptyRows++; continue; }
   rows.push({row: r, cells});
  }
  checkTime();
  return {...common, selection, rows, returnedRows: rows.length, omittedEmptyRows};
 } catch (error) {
  if (error instanceof AppError) throw error;
  throw new AppError('无法可靠解析此 XLSX；请核对文件格式和完整性，未返回截断结果。');
 }
}
