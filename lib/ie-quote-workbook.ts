import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { IeQuote } from './ie-quotes';
import { calculateIeQuote, ieCalculationVersion, ieCostMultiply, ieCostSum, ieCostRoundCents, type IeFormulaVersion } from './ie-quote-calculation';

/** This is an INTERNAL cost workbook. Customer quotations use a separate exporter.
 * Never use a historical multi-customer workbook as a reusable blank template.
 * The original upload is immutable; store its bytes and SHA-256 in private storage.
 */
export const IE_TEMPLATE_MAX_BYTES = 12 * 1024 * 1024;
const MAX_INFLATED_BYTES = 80 * 1024 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_ENTRIES = 512;
const ZIP_OPTIONS = { level: 6 as const, mtime: new Date(1980, 0, 1, 0, 0, 0) };
const MATERIAL_FIRST = 7, MATERIAL_LAST = 35, PROCESS_FIRST = 42, PROCESS_LAST = 49;
type CellValue = string | number | null | { formula: string; value: number | string };
type Cells = Record<string, CellValue>;
export type IeWorkbookLine = { code?: string; name: string; specification?: string; color?: string; description?: string; quantity: number; unitCostCny: number; basePrice?: number; coefficient?: number; lossRate?: number; lossAdjustmentReason?: string; notes?: string };
export type IeWorkbookToolingCharge = { key: string; name: string; amountCny: number | null; alreadyCharged?: boolean; chargeMode?: 'charge' | 'already_charged' | 'included_in_batch' | 'not_applicable'; sourceReference?: string; evidence?: string; notes?: string };
export type IeWorkbookBinding = {
  sheetName: string; customerCode: string; model: string; quantity: number;
  exchangeRateCnyPerUsd: number; materials: IeWorkbookLine[]; processes: IeWorkbookLine[];
  directLaborCny: number; toolingCharges: IeWorkbookToolingCharge[];
  factory?: string; quoteNo?: string; revision?: number; version?: number; status?: string;
  color?: string; drawingNo?: string; drawingRevision?: string; quantityMax?: number;
  formulaVersion?: IeFormulaVersion;
  expectedAmounts?: { material: number; materialLoss: number; productionCost: number; factoryPriceCny: number; factoryPriceUsd: number };
};
export type IeTemplateSheet = { name: string; state: string; path: string; printArea: string; layoutSha256: string; customerCode: string; model: string };
export type IeTemplateInspection = { sha256: string; byteLength: number; sheets: IeTemplateSheet[]; blockers: string[]; canExport: boolean };
export class IeWorkbookError extends Error {
  constructor(message: string, public code = 'IE_TEMPLATE_INVALID') { super(message); this.name = 'IeWorkbookError'; }
}
function fail(message: string, code?: string): never { throw new IeWorkbookError(message, code); }
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unxml = (value: string) => value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (_, hex: string, decimal: string, named: string) => hex ? String.fromCodePoint(parseInt(hex, 16)) : decimal ? String.fromCodePoint(Number(decimal)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()] || ''));
const attrs = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], unxml(m[2] ?? m[3])]));
const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
const textEntry = (entries: Record<string, Uint8Array>, path: string) => entries[path] ? strFromU8(entries[path]) : fail(`Excel 缺少必要文件：${path}`);
const excelCell = /<c\b[^>]*\br=(?:"([A-Z]+[1-9]\d*)"|'([A-Z]+[1-9]\d*)')[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
function textContent(value: string) { return [...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join(''); }
function cellsOf(sheetXml: string, strings: string[]) {
  const cells = new Map<string, string>();
  for (const match of sheetXml.matchAll(excelCell)) {
    const tag = match[0], type = attrs(tag.slice(0, tag.indexOf('>') + 1)).t;
    const value = tag.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || '';
    cells.set(match[1] || match[2], type === 's' ? strings[Number(value)] || '' : type === 'inlineStr' ? textContent(tag) : unxml(value));
  }
  return cells;
}

/** Validate ZIP metadata before inflation; reject encrypted/ZIP64/duplicate/path traversal entries. */
function readArchive(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > IE_TEMPLATE_MAX_BYTES) fail('原版模板须为不超过 12 MB 的 .xlsx 文件');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('模板不是有效的单卷 XLSX ZIP 文件');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directory = view.getUint32(end + 16, true);
  if (!count || count > MAX_ENTRIES || directory + directorySize !== end || view.getUint16(end + 8, true) !== count) fail('模板 ZIP 目录不受支持或超过限制');
  let cursor = directory, inflated = 0;
  const names = new Set<string>(), sizes = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail('模板 ZIP 目录损坏');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), packed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), offset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || offset + 30 > directory || flags & 1 || ![0, 8].includes(method) || size > MAX_ENTRY_BYTES || packed === 0xffffffff || offset === 0xffffffff) fail('模板含加密、过大或不支持的 ZIP 项');
    const name = strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || /[\\\u0000]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || names.has(name.toLowerCase())) fail('模板 ZIP 文件名不安全或重复');
    if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 8, true) !== method || view.getUint16(offset + 6, true) !== flags) fail('模板 ZIP 文件头与目录不一致');
    const localNameLength = view.getUint16(offset + 26, true), localExtraLength = view.getUint16(offset + 28, true);
    if (offset + 30 + localNameLength + localExtraLength + packed > directory || strFromU8(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name) fail('模板 ZIP 项边界或名称无效');
    inflated += size;
    if (inflated > MAX_INFLATED_BYTES) fail('模板解压后超过 80 MB 限制');
    names.add(name.toLowerCase()); sizes.set(name, size); cursor = next;
  }
  if (cursor !== end) fail('模板 ZIP 目录长度不一致');
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { return fail('模板 ZIP 无法解压'); }
  for (const [name, content] of Object.entries(entries)) {
    if (content.length !== sizes.get(name)) fail('模板 ZIP 实际大小与目录不一致');
    if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(strFromU8(content))) fail('模板含不受支持的 XML 实体');
  }
  return entries;
}

const layoutXml = (sheet: string) => sheet.replace(/<hyperlinks\b[^>]*>[\s\S]*?<\/hyperlinks>/g, '').replace(/<legacyDrawing\b[^>]*\/>/g, '').replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, data => data.replace(excelCell, match => { const a = attrs(match.slice(0, match.indexOf('>') + 1)); return a.s ? `<c r="${a.r}" s="${a.s}"/>` : ''; }));

async function inspectArchive(bytes: Uint8Array) {
  const entries = readArchive(bytes), workbook = textEntry(entries, 'xl/workbook.xml'), relationships = textEntry(entries, 'xl/_rels/workbook.xml.rels');
  const blockers: string[] = [];
  if (/macroEnabled|vbaProject|activeX|oleObject/i.test(textEntry(entries, '[Content_Types].xml'))) blockers.push('模板含宏或嵌入程序类型，不支持导出');
  const strings = entries['xl/sharedStrings.xml'] ? [...strFromU8(entries['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textContent(m[1])) : [];
  const relations = new Map([...relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(m => { const a = attrs(m[0]); return [a.Id, a]; }));
  const printAreas = new Map([...workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)].filter(m => attrs(m[1]).name === '_xlnm.Print_Area').map(m => [Number(attrs(m[1]).localSheetId), unxml(m[2])]));
  if ([...workbook.matchAll(/<definedName\b([^>]*)>/g)].some(m => !['_xlnm.Print_Area', '_xlnm.Print_Titles'].includes(attrs(m[1]).name))) blockers.push('模板含待清理的历史名称或命名公式');
  for (const [name, content] of Object.entries(entries)) {
    if (/vbaProject|activeX|embeddings|externalLinks|connections\.xml|queryTables|customXml|comments|threadedComments|calcChain/i.test(name)) blockers.push(`模板含待核验对象：${name}`);
    if (/\.rels$/i.test(name) && /TargetMode\s*=\s*["']External["']/i.test(strFromU8(content))) blockers.push('模板含外部链接，请先完成移除或专项核验');
  }
  const sheets: IeTemplateSheet[] = [];
  for (const [index, match] of [...workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)].entries()) {
    const a = attrs(match[0]), relationship = relations.get(a['r:id']);
    if (!a.name || !relationship || !/\/worksheet$/.test(relationship.Type || '')) fail('模板工作表关联无法确认');
    const target = relationship.Target || '';
    if (target.includes('..') || /[\\?#]/.test(target)) fail('模板工作表路径不受支持');
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const sheetXml = textEntry(entries, path), cells = cellsOf(sheetXml, strings), printArea = printAreas.get(index) || '';
    const sheet = { name: a.name, state: a.state || 'visible', path, printArea, layoutSha256: await sha256(strToU8(layoutXml(sheetXml))), customerCode: cells.get('C3') || '', model: cells.get('E3') || '' };
    sheets.push(sheet);
    if (!/^STYLE[1-9]\d*$/.test(a.name)) { blockers.push(`辅助表“${a.name}”尚未建立数据绑定，不能夹带历史资料导出`); continue; }
    if (printArea !== `'${a.name}'!$B$1:$I$69` && printArea !== `${a.name}!$B$1:$I$69`) blockers.push(`${a.name} 的原打印区域不是 B1:I69，需单独适配`);
    for (const [cell, value] of Object.entries({ E1: '产品物料清单及报价明细', C6: '物料编码', D6: '物料名称', B37: '材料小计', B62: '成本合计（元/副）' })) if (cells.get(cell) !== value) blockers.push(`${a.name} 的 ${cell} 与已核验模板布局不一致`);
    if (/<f\b[^>]*\bt=["'](?:shared|array)["']/.test(sheetXml)) blockers.push(`${a.name} 含共享或数组公式，需单独适配`);
  }
  if (!sheets.length || sheets.length > 32) fail('模板工作表数量无效');
  if (new Set(sheets.map(s => s.name)).size !== sheets.length) fail('模板工作表名称重复');
  const inspection = { sha256: await sha256(bytes), byteLength: bytes.length, sheets, blockers: [...new Set(blockers)], canExport: blockers.length === 0 };
  return { inspection, entries, strings };
}
export async function inspectIeQuoteTemplate(bytes: Uint8Array): Promise<IeTemplateInspection> { return (await inspectArchive(bytes)).inspection; }

const staticCells = new Set([
  'E1', 'H2', 'I2', 'B3', 'C3', 'D3', 'E3', 'F3', 'H3', 'B4', 'D4', 'F4', 'H4', 'B5',
  ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].flatMap(col => [6, 41, 52, 65].map(row => `${col}${row}`)),
  'B37', 'B38', 'B39', 'B40', 'B50', 'B51', 'B61', 'B62', 'B63', 'B64',
  'B66', 'B67', 'B68', 'E66', 'E67', 'E68', 'H66', 'H67', 'H68',
  ...Array.from({ length: 29 }, (_, i) => `B${i + 7}`), ...Array.from({ length: 8 }, (_, i) => `B${i + 42}`),
  ...Array.from({ length: 8 }, (_, i) => `B${i + 53}`), ...Array.from({ length: 7 }, (_, i) => `C${i + 53}`),
]);
function resolvePart(source: string, target: string) {
  const pieces = target.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const piece of target.split('/')) { if (!piece || piece === '.') continue; if (piece === '..') { if (!pieces.length) fail('模板关系路径越界'); pieces.pop(); } else pieces.push(piece); }
  return pieces.join('/');
}
function relsPath(part: string) { const pieces = part.split('/'), name = pieces.pop(); return [...pieces, '_rels', `${name}.rels`].join('/'); }
function filterRelationships(value: string, keep: (a: Record<string, string>) => boolean) { return value.replace(/<Relationship\b[^>]*\/?\s*>/g, tag => keep(attrs(tag)) ? tag : ''); }
function scrubSharedStrings(entries: Record<string, Uint8Array>, paths: string[]) {
  if (!entries['xl/sharedStrings.xml']) return;
  const used = new Set<number>();
  for (const path of paths) for (const match of textEntry(entries, path).matchAll(excelCell)) if (/\bt=["']s["']/.test(match[0])) used.add(Number(match[0].match(/<v>(\d+)<\/v>/)?.[1]));
  let index = 0;
  entries['xl/sharedStrings.xml'] = strToU8(strFromU8(entries['xl/sharedStrings.xml']).replace(/<si\b[^>]*>[\s\S]*?<\/si>/g, entry => used.has(index++) ? entry : '<si><t></t></si>'));
}

/** Explicit template preparation, NOT an in-place edit of the upload. The caller
 * must keep the immutable original separately. Auxiliary history is removed;
 * every selected STYLE retains its exact print settings, dimensions and pictures.
 * Selecting fewer sheets creates a template restricted to those original models.
 */
export async function prepareIeQuoteTemplate(bytes: Uint8Array, options: { sheetNames: string[] }) {
  const { entries, inspection } = await inspectArchive(bytes);
  if (!Array.isArray(options.sheetNames) || !options.sheetNames.length || new Set(options.sheetNames).size !== options.sheetNames.length) fail('须明确选择模板中要保留的款式表', 'IE_TEMPLATE_BINDING');
  const selected = inspection.sheets.filter(s => options.sheetNames.includes(s.name));
  if (selected.length !== options.sheetNames.length || selected.some(s => !/^STYLE[1-9]\d*$/.test(s.name))) fail('只能选择已核验的 STYLE 款式表', 'IE_TEMPLATE_BINDING');
  for (const name of Object.keys(entries)) if (/vbaProject|activeX|embeddings/i.test(name)) fail('模板含宏或嵌入程序，不支持自动准备');
  if (inspection.blockers.some(b => b.includes('宏或嵌入程序'))) fail('模板含宏或嵌入程序，不支持自动准备');
  for (const sheet of selected) {
    // All original calculation cells are cleared in this explicit preparation;
    // shared/array formulas therefore do not survive into the prepared template.
    const issues = inspection.blockers.filter(b => b.startsWith(`${sheet.name} `) && !b.includes('共享或数组公式'));
    if (issues.length) fail(issues.join('；'));
    const original = textEntry(entries, sheet.path);
    if (/<legacyDrawingHF\b/.test(original)) fail('模板含页眉页脚图形，须单独适配以保全打印内容');
    for (const match of original.matchAll(excelCell)) if (staticCells.has(match[1] || match[2]) && /<f\b/.test(match[0])) fail('模板固定标题或标签含公式，须先核验为静态文字');
    entries[sheet.path] = strToU8(original.replace(excelCell, (tag, a: string, b: string) => staticCells.has(a || b) ? tag : serializeCell(tag, a || b, null))
      .replace(/<hyperlinks\b[^>]*>[\s\S]*?<\/hyperlinks>/g, '').replace(/<legacyDrawing(?:HF)?\b[^>]*\/>/g, ''));
    const rel = relsPath(sheet.path);
    if (entries[rel]) entries[rel] = strToU8(filterRelationships(strFromU8(entries[rel]), a => /\/(drawing|printerSettings)$/.test(a.Type || '') && a.TargetMode !== 'External'));
  }
  const selectedPaths = new Set(selected.map(s => s.path));
  const workbookRels = 'xl/_rels/workbook.xml.rels';
  entries[workbookRels] = strToU8(filterRelationships(textEntry(entries, workbookRels), a => /\/(styles|sharedStrings|theme)$/.test(a.Type || '') || /\/worksheet$/.test(a.Type || '') && selectedPaths.has(resolvePart('xl/workbook.xml', a.Target))));
  let workbook = textEntry(entries, 'xl/workbook.xml');
  workbook = workbook.replace(/<sheet\b[^>]*\/?\s*>/g, tag => options.sheetNames.includes(attrs(tag).name) ? tag : '');
  workbook = workbook.replace(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g, (tag, attributeString: string) => {
    const a = attrs(attributeString), oldIndex = Number(a.localSheetId), originalSheet = inspection.sheets[oldIndex], newIndex = selected.findIndex(s => s.name === originalSheet?.name);
    if (!['_xlnm.Print_Area', '_xlnm.Print_Titles'].includes(a.name) || newIndex < 0) return '';
    return tag.replace(/localSheetId=(?:"\d+"|'\d+')/, `localSheetId="${newIndex}"`);
  }).replace(/<externalReferences\b[^>]*>[\s\S]*?<\/externalReferences>/g, '');
  // Selecting STYLE2 only must not leave activeTab pointing at the old index.
  workbook = workbook.replace(/activeTab="\d+"/g, 'activeTab="0"').replace(/firstSheet="\d+"/g, 'firstSheet="0"');
  entries['xl/workbook.xml'] = strToU8(workbook);
  entries['_rels/.rels'] = strToU8(filterRelationships(textEntry(entries, '_rels/.rels'), a => /\/officeDocument$/.test(a.Type || '') && a.TargetMode !== 'External'));
  scrubSharedStrings(entries, selected.map(s => s.path));
  const keep = new Set<string>(['[Content_Types].xml', '_rels/.rels']);
  const visit = (path: string) => {
    if (keep.has(path)) return; if (!entries[path]) fail('模板关系引用了缺失文件'); keep.add(path);
    if (/^xl\/drawings\/[^/]+\.xml$/.test(path)) {
      const drawing = textEntry(entries, path);
      if (/<(?:\w+:)?(?:txBody|graphicFrame|chart)\b/.test(drawing)) fail('模板图形含可编辑文本或图表，须人工核验后准备');
      const rel = relsPath(path);
      if (entries[rel]) entries[rel] = strToU8(filterRelationships(strFromU8(entries[rel]), a => /\/image$/.test(a.Type || '') && a.TargetMode !== 'External'));
    }
    const rel = relsPath(path);
    if (entries[rel]) {
      keep.add(rel);
      for (const match of strFromU8(entries[rel]).matchAll(/<Relationship\b[^>]*\/?\s*>/g)) { const a = attrs(match[0]); if (a.TargetMode === 'External') fail('保留的模板部件仍含外部引用'); visit(resolvePart(path, a.Target)); }
    }
  };
  visit('xl/workbook.xml');
  for (const path of Object.keys(entries)) if (!keep.has(path)) delete entries[path];
  entries['[Content_Types].xml'] = strToU8(textEntry(entries, '[Content_Types].xml').replace(/<Override\b[^>]*\/?\s*>/g, tag => keep.has((attrs(tag).PartName || '').replace(/^\//, '')) ? tag : ''));
  const prepared = zipSync(entries, ZIP_OPTIONS), preparedInspection = await inspectIeQuoteTemplate(prepared);
  if (!preparedInspection.canExport) fail(preparedInspection.blockers.join('；'));
  for (const sheet of preparedInspection.sheets) if (sheet.layoutSha256 !== inspection.sheets.find(s => s.name === sheet.name)?.layoutSha256) fail('模板准备意外改变了行列、样式或打印布局，已停止', 'IE_TEMPLATE_LAYOUT');
  return { bytes: prepared, sourceSha256: inspection.sha256, inspection: preparedInspection, removedSheetNames: inspection.sheets.filter(s => !options.sheetNames.includes(s.name)).map(s => s.name) };
}

export function makeIeWorkbookBindings(quote: IeQuote, sheetBindings: { sheetName: string; lineId: string }[]): IeWorkbookBinding[] {
  if (quote.exchangeRateCnyPerUsd === null || quote.exchangeRateCnyPerUsd <= 0) fail('请先手填有效汇率', 'IE_EXPORT_INPUT');
  if (sheetBindings.length !== quote.lines.length || new Set(sheetBindings.map(b => b.lineId)).size !== quote.lines.length) fail('每个报价款式须唯一绑定一个模板表', 'IE_TEMPLATE_BINDING');
  return sheetBindings.map(mapping => {
    const line = quote.lines.find(l => l.id === mapping.lineId), costs = quote.costs.lines.find(l => l.lineId === mapping.lineId);
    if (!line || !costs || costs.process === null || costs.material === null || costs.materialLoss === null || costs.productionCost === null || costs.factoryPriceCny === null || costs.factoryPriceUsd === null) fail('款式绑定或成本不完整', 'IE_EXPORT_INPUT');
    return {
      sheetName: mapping.sheetName, customerCode: quote.customerCode, model: line.model, quantity: line.quantityMin ?? 0, exchangeRateCnyPerUsd: quote.exchangeRateCnyPerUsd!,
      color: line.color, drawingNo: line.drawingNo, drawingRevision: line.drawingRevision, quantityMax: line.quantityMax ?? undefined,
      quoteNo: quote.quoteNo, revision: quote.revision, version: quote.version, status: quote.status, directLaborCny: costs.process, formulaVersion: ieCalculationVersion(quote),
      expectedAmounts: { material: costs.material, materialLoss: costs.materialLoss, productionCost: costs.productionCost, factoryPriceCny: costs.factoryPriceCny, factoryPriceUsd: costs.factoryPriceUsd },
      materials: line.materials.filter(m => !m.notApplicable).map(m => {
        if (m.basePrice === null || m.usage === null || m.coefficient === null) fail('材料基价、用量或系数尚未填写', 'IE_EXPORT_INPUT');
        return { name: m.name, specification: m.specification, quantity: m.usage, unitCostCny: m.basePrice * m.coefficient, basePrice: m.basePrice, coefficient: m.coefficient, lossRate: m.lossRate, lossAdjustmentReason: m.lossAdjustmentReason, notes: m.notes };
      }),
      processes: line.outsourcing.filter(p => !p.notApplicable).map(p => { if (p.unitPrice === null) fail('外发单价尚未填写', 'IE_EXPORT_INPUT'); return { name: p.name, quantity: 1, unitCostCny: p.unitPrice, notes: p.notes }; }),
      toolingCharges: quote.tooling.filter(t => t.lineIds.includes(line.id)).map(t => {
        if (t.chargeMode === 'charge' && t.amount === null) fail('单列费用金额尚未填写', 'IE_EXPORT_INPUT');
        return { key: t.toolingId || t.id, name: t.name, amountCny: t.amount, alreadyCharged: t.chargeMode !== 'charge', chargeMode: t.chargeMode, sourceReference: t.chargeQuoteId ? `${t.chargeQuoteId} V${t.chargeVersion ?? ''}` : '', evidence: t.evidence, notes: t.notes };
      }),
    };
  });
}

function number(value: number, label: string, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0) || value > 1e12) fail(`${label}须为${positive ? '大于零的' : '非负'}有效数字`, 'IE_EXPORT_INPUT');
  return value;
}
function string(value: string | undefined, label: string, required = false) {
  const s = value ?? '';
  if (typeof s !== 'string' || s.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) || (required && !s.trim())) fail(`${label}为空或过长`, 'IE_EXPORT_INPUT');
  return s;
}
function fits(value: string | undefined, units: number, label: string) {
  const s = string(value, label), width = [...s].reduce((n, character) => n + (character.codePointAt(0)! > 255 ? 2 : 1), 0);
  if (width > units || /[\r\n]/.test(s)) fail(`${label}超出原 Excel 固定格宽，请精简打印文字或登记扩展模板；不会截断内容`, 'IE_EXPORT_CAPACITY');
}
const textWidth = (value: string) => [...value].reduce((n, character) => n + (character.codePointAt(0)! > 255 ? 2 : 1), 0);
const round = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const f = (formula: string, value: number): CellValue => ({ formula, value });
function quoteCells(binding: IeWorkbookBinding) {
  const excel = binding.formulaVersion === 'ie-cost-v3-excel', digits = excel ? 2 : 6;
  number(binding.quantity, '报价数量', true); number(binding.exchangeRateCnyPerUsd, '手填汇率', true); number(binding.directLaborCny, '直接人工');
  string(binding.customerCode, '客户代码', true); string(binding.model, '款号', true);
  fits(binding.customerCode, 24, '客户代码'); fits(binding.model, 24, '款号'); fits(binding.drawingNo, 24, '图纸编号'); fits(binding.quoteNo, 24, '报价编号'); fits(String(binding.exchangeRateCnyPerUsd), 11, '汇率');
  if (binding.quantityMax !== undefined && number(binding.quantityMax, '数量档上限', true) < binding.quantity) fail('数量档上限不能小于下限', 'IE_EXPORT_INPUT');
  if (!Array.isArray(binding.materials) || binding.materials.length > 29) fail('原 Excel 仅容纳 29 行材料；请调整模板后再导出，不会截断材料', 'IE_EXPORT_CAPACITY');
  if (!Array.isArray(binding.processes) || binding.processes.length > 8) fail('原 Excel 仅容纳 8 行外发工序；请调整模板后再导出，不会截断工序', 'IE_EXPORT_CAPACITY');
  const out: Cells = { C3: binding.customerCode, E3: binding.model, G3: binding.drawingNo || binding.model, H3: '报价编号', I3: string(binding.quoteNo, '报价编号'), I2: '人民币', B4: '内部工程核价', C4: binding.status === 'released' ? '已复核' : '未发布', D4: `R${binding.revision ?? 1} V${binding.version ?? 1}`, E4: '美元兑人民币', F4: String(binding.exchangeRateCnyPerUsd), G4: null, H4: '成本加价30%', I4: null, G38: '分项', L4: binding.exchangeRateCnyPerUsd };
  // The numeric exchange rate is kept outside the original print area. Row 4
  // displays the same exact rate as a label, avoiding the template's integer-only
  // number format. Row 69 stays blank so native print scaling remains unchanged.
  const lossFormulas: string[] = [], losses: number[] = [];
  const fill = (lines: IeWorkbookLine[], first: number, last: number, material: boolean) => {
    let total = 0;
    for (let row = first; row <= last; row++) {
      for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) out[`${col}${row}`] = null;
      const line = lines[row - first]; if (!line) continue;
      string(line.name, '项目名称', true); number(line.quantity, '项目用量'); number(line.unitCostCny, '项目单价');
      fits(line.name, material ? 24 : 20, '项目名称'); fits(material ? line.specification : line.description, 28, '规格描述'); fits(line.color, 20, '颜色');
      const factors = line.basePrice !== undefined && line.coefficient !== undefined ? [line.basePrice, line.quantity, line.coefficient] : [line.quantity, line.unitCostCny];
      const amount = ieCostMultiply(factors, material ? digits : 6); total += amount;
      out[`C${row}`] = material ? string(line.code, '物料编码') : line.name;
      out[`D${row}`] = material ? line.name : string(line.color, '颜色');
      out[`E${row}`] = material ? string(line.specification, '物料规格') : string(line.description, '工序描述');
      out[`F${row}`] = line.quantity; out[`G${row}`] = line.unitCostCny; out[`H${row}`] = f(`ROUND(F${row}*G${row},${material ? digits : 6})`, amount); out[`I${row}`] = string(line.notes, '备注');
      if (material) {
        const lossRate = line.lossRate ?? 0.1; number(lossRate, '材料总损耗率');
        if (lossRate > 10) fail('材料损耗率超过允许范围', 'IE_EXPORT_INPUT');
        // The rate is stated in the same row; no hidden helper or new print column.
        const fullNote = `损耗 ${round(lossRate * 100)}%${line.notes ? `；${line.notes}` : ''}`;
        out[`I${row}`] = textWidth(fullNote) <= 14 && !/[\r\n]/.test(fullNote) ? fullNote : `${round(lossRate * 100)}%附页`;
        losses.push(ieCostMultiply(excel ? [amount, lossRate] : [...factors, lossRate])); lossFormulas.push(excel ? `ROUND(H${row}*${lossRate},6)` : `ROUND(F${row}*G${row}*${lossRate},6)`);
      }
      fits(out[`I${row}`] as string, 26, '行备注（含损耗率）');
    }
    return round(total);
  };
  const materials = fill(binding.materials, MATERIAL_FIRST, MATERIAL_LAST, true), processes = fill(binding.processes, PROCESS_FIRST, PROCESS_LAST, false);
  const rawLoss = ieCostSum(losses), loss = excel ? ieCostRoundCents(rawLoss) : rawLoss, materialTotal = ieCostSum([materials, loss]), labor = ieCostSum([binding.directLaborCny, 13.7]), cost = ieCostSum([materialTotal, processes, labor]), factory = ieCostMultiply([cost, 1.3]);
  if (binding.expectedAmounts) {
    const actual = { material: materials, materialLoss: loss, productionCost: cost, factoryPriceCny: factory, factoryPriceUsd: round(factory / binding.exchangeRateCnyPerUsd) };
    for (const key of Object.keys(actual) as (keyof typeof actual)[]) if (Math.abs(actual[key] - binding.expectedAmounts[key]) > 0.0000005) fail('打印计算与当前工程报价不一致，已停止导出以避免金额错误', 'IE_EXPORT_RECONCILIATION');
  }
  const lossFormula = lossFormulas.length ? `SUM(${lossFormulas.join(',')})` : '0';
  Object.assign(out, { H37: f('SUM(H7:H35)', materials), H38: f(excel ? `ROUND(${lossFormula},2)` : lossFormula, loss), H39: f('H37+H38', materialTotal), H50: f('SUM(H42:H49)', processes), F53: 1, G53: binding.directLaborCny, H53: f('ROUND(F53*G53,6)', round(binding.directLaborCny)), H61: f('SUM(H53:H60)', labor), H62: f('H39+H50+H61', cost), H63: f('ROUND(H62/$L$4,6)', round(cost / binding.exchangeRateCnyPerUsd)), H66: '生产成本×1.3出厂价', I66: f('ROUND(H62*1.3,6)', factory), H67: '出厂价（USD/副）', I67: f('ROUND(I66/$L$4,6)', round(factory / binding.exchangeRateCnyPerUsd)), H68: '销售毛利率', I68: f('(I66-H62)/I66', (factory - cost) / factory) });
  out.H67 = `${binding.quantity}${binding.quantityMax && binding.quantityMax !== binding.quantity ? `–${binding.quantityMax}` : ''}副出厂价USD`;
  for (let row = 53; row <= 60; row++) { out[`D${row}`] = null; out[`E${row}`] = null; out[`I${row}`] = null; }
  [5, 3, 0.2, 2, 2, 1.5].forEach((amount, i) => { const row = 54 + i; out[`F${row}`] = 1; out[`G${row}`] = amount; out[`H${row}`] = f(`ROUND(F${row}*G${row},6)`, amount); });
  for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) out[`${col}60`] = null;
  Object.assign(out, { C66: f('H39', materialTotal), C67: f('H50', processes), C68: f('H61', labor), D66: f('C66/$I$66', materialTotal / factory), D67: f('C67/$I$66', processes / factory), D68: f('C68/$I$66', labor / factory), F66: f('H38', loss), F67: f('H59', 1.5), F68: f('I66-H62', factory - cost), G66: f('F66/$I$66', loss / factory), G67: f('F67/$I$66', 1.5 / factory), G68: f('F68/$I$66', (factory - cost) / factory) });
  return out;
}

function serializeCell(original: string, address: string, value: CellValue) {
  const open = original.match(/^<c\b([^>]*?)(?:\/?>)/)?.[1] || ` r="${address}"`;
  const cellAttributes = open.replace(/\s+t=(?:"[^"]*"|'[^']*')/g, '').replace(/\/$/, '');
  if (value === null) return `<c${cellAttributes}/>`;
  if (typeof value === 'string') return `<c${cellAttributes} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  if (typeof value === 'number') return `<c${cellAttributes}><v>${value}</v></c>`;
  if (typeof value.value === 'string') return `<c${cellAttributes} t="str"><f>${xml(value.formula)}</f><v>${xml(value.value)}</v></c>`;
  if (!Number.isFinite(value.value)) fail('计算结果无效，请检查报价金额', 'IE_EXPORT_INPUT');
  return `<c${cellAttributes}><f>${xml(value.formula)}</f><v>${value.value}</v></c>`;
}
function patchSheet(sheet: string, cells: Cells) {
  const pending = new Map(Object.entries(cells));
  let patched = sheet.replace(excelCell, (match, a: string, b: string) => {
    const address = a || b;
    // Remove legacy customer prices and notes outside the approved print area.
    const row = Number(address.match(/\d+$/)?.[0]), col = address.match(/^[A-Z]+/)?.[0] || '';
    if (pending.has(address)) { const value = pending.get(address)!; pending.delete(address); return serializeCell(match, address, value); }
    if (row > 68 || col.length > 1 || col > 'I' || col < 'B') return serializeCell(match, address, null);
    return match;
  });
  for (const [address, value] of pending) {
    const row = Number(address.match(/\d+$/)?.[0]), re = new RegExp(`<row\\b[^>]*\\br=["']${row}["'][^>]*>[\\s\\S]*?<\\/row>`);
    if (!re.test(patched)) fail(`模板缺少第 ${row} 行；为保全版式已停止导出`, 'IE_TEMPLATE_LAYOUT');
    patched = patched.replace(re, rowXml => {
      const newCell = serializeCell('', address, value), targetColumn = address.match(/^[A-Z]+/)![0];
      const next = [...rowXml.matchAll(excelCell)].find(m => (m[1] || m[2]).match(/^[A-Z]+/)![0].localeCompare(targetColumn) > 0);
      return next ? rowXml.slice(0, next.index) + newCell + rowXml.slice(next.index) : rowXml.replace('</row>', newCell + '</row>');
    });
  }
  return patched;
}

function appendStyles(entries: Record<string, Uint8Array>) {
  let styles = textEntry(entries, 'xl/styles.xml');
  const add = (collection: string, contents: string[], child: string) => {
    let index = -1;
    styles = styles.replace(new RegExp(`<${collection}\\b([^>]*)>([\\s\\S]*?)<\\/${collection}>`), (_, attributes: string, existing: string) => {
      index = [...existing.matchAll(new RegExp(`<${child}\\b`, 'g'))].length;
      const next = /\bcount=/.test(attributes) ? attributes.replace(/count=(?:"\d+"|'\d+')/, `count="${index + contents.length}"`) : `${attributes} count="${index + contents.length}"`;
      return `<${collection}${next}>${existing}${contents.join('')}</${collection}>`;
    });
    if (index < 0) fail('模板缺少样式集合，无法安全添加单列费用附页'); return index;
  };
  const font = add('fonts', ['<font><sz val="10"/><name val="Microsoft YaHei"/></font>', '<font><b/><sz val="10"/><name val="Microsoft YaHei"/></font>'], 'font');
  const fill = add('fills', ['<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>'], 'fill');
  const xf = (numFmtId: number, heading = false, numeric = false) => `<xf numFmtId="${numFmtId}" fontId="${font + (heading ? 1 : 0)}" fillId="${heading ? fill : 0}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"${numFmtId || numeric ? ' horizontal="right" indent="1"' : ''}/></xf>`;
  const first = add('cellXfs', [xf(0), xf(0, true), xf(4), xf(10), xf(0, false, true)], 'xf');
  entries['xl/styles.xml'] = strToU8(styles);
  return { text: first, heading: first + 1, money: first + 2, percent: first + 3, number: first + 4 };
}

function appendCostSupplement(entries: Record<string, Uint8Array>, bindings: IeWorkbookBinding[], tooling: (IeWorkbookToolingCharge & { models: string[]; chargedAmountCny: number })[]) {
  const styles = appendStyles(entries), columns = 'ABCDEFGH', widths = [18, 22, 28, 17, 17, 17, 34, 30];
  const rows: string[] = [];
  const chunks = (value: CellValue) => {
    if (typeof value !== 'string') return [value];
    const parts: string[] = []; let current = '', used = 0;
    for (const character of value) { const width = character.codePointAt(0)! > 255 ? 2 : 1; if (used + width > 180 || character === '\n') { parts.push(current); current = ''; used = 0; if (character === '\n') continue; } current += character; used += width; }
    parts.push(current); return parts;
  };
  const add = (values: CellValue[], heading = false, moneyColumns: number[] = [], percentColumns: number[] = []) => {
    const pieces = values.map(chunks), count = Math.max(...pieces.map(p => p.length));
    for (let part = 0; part < count; part++) {
      const number = rows.length + 1, current = pieces.map(p => p[part] ?? null);
      const lines = Math.max(1, ...current.map((v, i) => typeof v === 'string' ? Math.ceil(textWidth(v) / Math.max(8, widths[i] - 2)) : 1));
      const height = Math.min(300, Math.max(22, lines * 15 + 6));
      rows.push(`<row r="${number}" ht="${height}" customHeight="1">${current.map((value, i) => serializeCell(`<c r="${columns[i]}${number}" s="${heading ? styles.heading : percentColumns.includes(i) ? styles.percent : moneyColumns.includes(i) ? styles.money : typeof value === 'number' ? styles.number : styles.text}"/>`, `${columns[i]}${number}`, value)).join('')}</row>`);
    }
  };
  const first = bindings[0];
  add(['内部工程报价附表', null, null, first.status === 'released' ? '已复核内部核价' : '未发布内部核价'], true);
  add(['报价编号', first.quoteNo || '', '工程版次', `R${first.revision ?? 1} V${first.version ?? 1}`, '客户', first.customerCode]);
  add(['汇率（1 USD = CNY）', first.exchangeRateCnyPerUsd, '适用范围', '仅供内部成本核对。业务客价另行审批。']);
  rows[2] = rows[2].replace(/ht="[^"]*"/, 'ht="22"');
  add(['款式', '颜色', '图纸编号', '图纸版本', '数量下限（副）', '数量上限（副）', '报价编号', '工程版次'], true);
  for (const binding of bindings) add([binding.model, binding.color || '', binding.drawingNo || binding.model, binding.drawingRevision || '', binding.quantity, binding.quantityMax ?? binding.quantity, binding.quoteNo || '', `R${binding.revision ?? 1} V${binding.version ?? 1}`]);
  const feeTitle = rows.length + 1;
  add(['模具等单列费用', null, null, '不计入产品生产成本或出厂单价'], true);
  rows[feeTitle - 1] = rows[feeTitle - 1].replace(/ht="[^"]*"/, 'ht="22"');
  add(['收费编号', '费用名称', '适用款式', '收费状态', '本次收费（CNY）', '登记金额（CNY）', '收费来源 / 已收凭证', '备注'], true);
  const chargeStart = rows.length + 1;
  for (const charge of tooling) add([charge.key, charge.name, charge.models.join('、'), ({ charge: '本次单独收费', already_charged: '已有实际收费凭证', included_in_batch: '关联报价已列费', not_applicable: '不适用' }[charge.chargeMode || (charge.alreadyCharged ? 'already_charged' : 'charge')]), charge.chargedAmountCny, charge.amountCny, [charge.sourceReference, charge.evidence].filter(Boolean).join('\n'), charge.notes || ''], false, [4, 5]);
  if (!tooling.length) add(['本报价无适用的单列费用', '', '', '已明确无收费项', 0, 0], false, [4, 5]);
  const chargeEnd = rows.length, total = round(tooling.reduce((sum, charge) => sum + charge.chargedAmountCny, 0));
  add(['本次单列费用合计', '', '', '', f(`SUM(E${chargeStart}:E${chargeEnd})`, total)], true);
  const lossTitle = rows.length + 1;
  add(['材料分项损耗', null, null, '正常 10% + 本项额外百分点 = 本项合计%；未调整项目仍为 10%'], true);
  rows[lossTitle - 1] = rows[lossTitle - 1].replace(/ht="[^"]*"/, 'ht="22"');
  add(['款式', '材料名称', '规格描述', '正常损耗', '额外（百分点）', '本项合计损耗', '损耗金额（CNY）', '完整备注 / 调整原因'], true);
  for (const binding of bindings) {
    for (const material of binding.materials) {
      const factors = material.basePrice !== undefined && material.coefficient !== undefined ? [material.basePrice,material.quantity,material.coefficient] : [material.quantity,material.unitCostCny];
      const loss = ieCostMultiply(binding.formulaVersion === 'ie-cost-v3-excel' ? [ieCostMultiply(factors,2),material.lossRate??.1] : [...factors,material.lossRate??.1]);
      add([binding.model, material.name, material.specification || '', 0.1, round(((material.lossRate ?? 0.1) - 0.1) * 100), material.lossRate ?? 0.1, loss, [`用量 ${material.quantity}；计价单价 ${material.unitCostCny} CNY`, material.notes, material.lossAdjustmentReason ? `调整原因：${material.lossAdjustmentReason}` : '',binding.formulaVersion === 'ie-cost-v3-excel'?'材料行按分位，损耗加权合计后再按分位。':''].filter(Boolean).join('\n')], false, [6], [3, 5]);
    }
    if (!binding.materials.length) add([binding.model, '材料已明确不适用', '', null, null, null, 0, ''], false, [6], [3, 5]);
  }
  add(['说明', '共用收费编号只列一次。已收费或关联报价已列费的项目，本次收费为 0；原登记金额仅供追溯。']);
  const path = 'xl/worksheets/ie-cost-supplement.xml', sheetName = '单列费用', relationshipId = 'ieCostSupplement';
  entries[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:H${rows.length}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="5"><mergeCell ref="A1:C1"/><mergeCell ref="D1:H1"/><mergeCell ref="D3:H3"/><mergeCell ref="D${feeTitle}:H${feeTitle}"/><mergeCell ref="D${lossTitle}:H${lossTitle}"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;R第 &amp;P 页</oddFooter></headerFooter><rowBreaks count="1" manualBreakCount="1"><brk id="${lossTitle - 1}" max="16383" man="1"/></rowBreaks></worksheet>`);
  let workbook = textEntry(entries, 'xl/workbook.xml');
  const currentSheets = [...workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)], sheetId = Math.max(...currentSheets.map(m => Number(attrs(m[0]).sheetId))) + 1;
  workbook = workbook.replace('</sheets>', `<sheet name="${sheetName}" sheetId="${sheetId}" r:id="${relationshipId}"/></sheets>`);
  const printName = `<definedName name="_xlnm.Print_Area" localSheetId="${currentSheets.length}">'${sheetName}'!$A$1:$H$${rows.length}</definedName>`;
  workbook = workbook.includes('</definedNames>') ? workbook.replace('</definedNames>', printName + '</definedNames>') : workbook.replace('</sheets>', `</sheets><definedNames>${printName}</definedNames>`);
  entries['xl/workbook.xml'] = strToU8(workbook);
  entries['xl/_rels/workbook.xml.rels'] = strToU8(textEntry(entries, 'xl/_rels/workbook.xml.rels').replace('</Relationships>', `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/ie-cost-supplement.xml"/></Relationships>`));
  entries['[Content_Types].xml'] = strToU8(textEntry(entries, '[Content_Types].xml').replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
}

/** No workbook reconstruction: only values/formulas in bound STYLE sheets and unused
 * shared strings change. Print setup, styles, drawings, dimensions and relationships
 * remain intact. Unsupported auxiliary worksheets deliberately block the operation.
 */
export async function exportIeQuoteWorkbook(bytes: Uint8Array, request: { expectedTemplateSha256: string; bindings: IeWorkbookBinding[]; attachmentRefs?: IeQuote['attachmentRefs'] }) {
  const { inspection, entries } = await inspectArchive(bytes);
  if (inspection.sha256 !== request.expectedTemplateSha256) fail('模板原件已变化，请重新核验后导出', 'IE_TEMPLATE_VERSION');
  if (!inspection.canExport) fail(inspection.blockers.join('；'), 'IE_TEMPLATE_UNMAPPED');
  if (!Array.isArray(request.bindings) || request.bindings.length !== inspection.sheets.length || new Set(request.bindings.map(b => b.sheetName)).size !== inspection.sheets.length) fail('必须明确绑定原模板的全部款式，不能仅更新一款后携带其他款报价', 'IE_TEMPLATE_BINDING');
  if (new Set(request.bindings.map(b => b.customerCode)).size !== 1) fail('一个导出文件只能绑定同一客户的报价', 'IE_TEMPLATE_BINDING');
  const tooling = new Map<string, IeWorkbookToolingCharge & { models: string[]; chargedAmountCny: number }>();
  for (const sheet of inspection.sheets) {
    const binding = request.bindings.find(b => b.sheetName === sheet.name);
    const identity = (value: string) => value.normalize('NFKC').trim().toUpperCase();
    if (!binding || (sheet.customerCode && identity(sheet.customerCode) !== identity(binding.customerCode)) || (sheet.model && identity(sheet.model) !== identity(binding.model))) fail(`${sheet.name} 的客户或款式与模板原图纸不匹配；请登记对应模板`, 'IE_TEMPLATE_BINDING');
    if (!Array.isArray(binding.toolingCharges)) fail('须明确填写单列模具费用，免收时提交空清单', 'IE_EXPORT_INPUT');
    const updated = patchSheet(textEntry(entries, sheet.path), quoteCells(binding));
    entries[sheet.path] = strToU8(updated);
    for (const charge of binding.toolingCharges) {
      string(charge.key, '共用模具编号', true); string(charge.name, '模具名称', true);
      const charging = charge.chargeMode ? charge.chargeMode === 'charge' : !charge.alreadyCharged;
      if (charge.amountCny !== null) number(charge.amountCny, '单列模具金额'); else if (charging) fail('本次单列收费金额尚未填写', 'IE_EXPORT_INPUT');
      const previous = tooling.get(charge.key);
      if (previous && (previous.amountCny !== charge.amountCny || previous.name !== charge.name || !!previous.alreadyCharged !== !!charge.alreadyCharged || previous.chargeMode !== charge.chargeMode || previous.evidence !== charge.evidence || previous.sourceReference !== charge.sourceReference)) fail('同一共用模具的名称、金额或已收费状态不一致', 'IE_EXPORT_INPUT');
      if (previous) { if (!previous.models.includes(binding.model)) previous.models.push(binding.model); }
      else tooling.set(charge.key, { ...charge, models: [binding.model], chargedAmountCny: charging ? charge.amountCny! : 0 });
    }
  }
  // Unreferenced shared strings can contain old customer names/notes. Clear them
  // without reindexing or changing any still-used label or rich-text formatting.
  if (entries['xl/sharedStrings.xml']) {
    const used = new Set<number>();
    for (const sheet of inspection.sheets) for (const match of textEntry(entries, sheet.path).matchAll(excelCell)) if (/\bt=["']s["']/.test(match[0])) used.add(Number(match[0].match(/<v>(\d+)<\/v>/)?.[1]));
    let index = 0;
    entries['xl/sharedStrings.xml'] = strToU8(strFromU8(entries['xl/sharedStrings.xml']).replace(/<si\b[^>]*>[\s\S]*?<\/si>/g, entry => used.has(index++) ? entry : '<si><t></t></si>'));
  }
  appendCostSupplement(entries, request.bindings, [...tooling.values()]);
  if (request.attachmentRefs?.length) appendAttachmentManifest(entries, request.attachmentRefs);
  return { bytes: zipSync(entries, ZIP_OPTIONS), inspection, toolingCharges: [...tooling.values()] };
}

type GridRow = CellValue[];
const colName = (index: number) => { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
const draftFormula = (formula: string, value: number | null): CellValue => ({ formula, value: value === null ? '' : value });
const ref = (sheet: string, cell: string) => `'${sheet.replace(/'/g, "''")}'!${cell}`;

/** Adds an independent sheet; the bound STYLE XML and its print setup are untouched. */
function appendGridSheet(entries: Record<string, Uint8Array>, name: string, rows: GridRow[], widths: number[]) {
  const styles = appendStyles(entries), workbook = textEntry(entries, 'xl/workbook.xml'), existing = [...workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)];
  if (existing.some(s => attrs(s[0]).name === name)) fail('导出辅助工作表名称冲突', 'IE_TEMPLATE_BINDING');
  const sheetId = Math.max(0, ...existing.map(s => Number(attrs(s[0]).sheetId))) + 1, id = `ieGrid${sheetId}`, path = `xl/worksheets/ie-grid-${sheetId}.xml`;
  const rowXml = rows.map((values, i) => {
    const height = Math.min(400, Math.max(24, ...values.map((v, c) => typeof v === 'string' ? (Math.ceil(textWidth(v) / Math.max(8, (widths[c] || 18) - 2)) + (v.match(/\n/g)?.length || 0)) * 14 + 6 : 24)));
    return `<row r="${i + 1}" ht="${height}" customHeight="1">${values.map((value, c) => serializeCell(`<c r="${colName(c)}${i + 1}" s="${i === 0 ? styles.heading : typeof value === 'number' || typeof value === 'object' && value !== null ? styles.number : styles.text}"/>`, `${colName(c)}${i + 1}`, value)).join('')}</row>`;
  }).join('');
  const last = `${colName(widths.length - 1)}${Math.max(1, rows.length)}`;
  entries[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView showGridLines="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths.map((w,i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rowXml}</sheetData><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>内部工程资料 &amp;R&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`);
  const names = `<definedName name="_xlnm.Print_Area" localSheetId="${existing.length}">${xml(`'${name}'!$A$1:$${colName(widths.length - 1)}$${Math.max(1, rows.length)}`)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${existing.length}">${xml(`'${name}'!$1:$1`)}</definedName>`;
  let next = workbook.replace('</sheets>', `<sheet name="${xml(name)}" sheetId="${sheetId}" r:id="${id}"/></sheets>`);
  next = next.includes('</definedNames>') ? next.replace('</definedNames>', names + '</definedNames>') : next.replace('</sheets>', '</sheets><definedNames>' + names + '</definedNames>');
  entries['xl/workbook.xml'] = strToU8(next);
  entries['xl/_rels/workbook.xml.rels'] = strToU8(textEntry(entries, 'xl/_rels/workbook.xml.rels').replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/ie-grid-${sheetId}.xml"/></Relationships>`));
  entries['[Content_Types].xml'] = strToU8(textEntry(entries, '[Content_Types].xml').replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
}

function appendAttachmentManifest(entries: Record<string, Uint8Array>, attachments: IeQuote['attachmentRefs'] = []) {
  appendGridSheet(entries, '图纸附件清单', [['款式行编号', '图纸编号', '图纸版本', '原文件名', 'SHA-256', '附件编号'], ...attachments.map(a => [a.lineId, a.drawingNo, a.drawingRevision, a.filename, a.sha256, a.attachmentId])], [24, 24, 18, 42, 68, 32]);
}

/** Clean general-purpose grid. It carries no uploaded customer pictures or old data.
 * The section/column positions follow STYLE, but this is not the client's exact print template. */
function genericDraftTemplate(quote: IeQuote) {
  const entries: Record<string, Uint8Array> = {}, mappings = quote.lines.map((l,i) => ({ lineId: l.id, sheetName: `STYLE${i + 1}`, path: `xl/worksheets/sheet${i + 1}.xml` }));
  const relationship = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (s: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${s}</Relationships>`;
  entries['[Content_Types].xml'] = strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${mappings.map(m => `<Override PartName="/${m.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  entries['_rels/.rels'] = strToU8(rels(relationship('office', 'officeDocument', 'xl/workbook.xml')));
  entries['xl/_rels/workbook.xml.rels'] = strToU8(rels(relationship('styles','styles','styles.xml') + mappings.map((m,i) => relationship(`r${i+1}`,'worksheet',m.path.slice(3))).join('')));
  entries['xl/workbook.xml'] = strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${mappings.map((m,i) => `<sheet name="${m.sheetName}" sheetId="${i+1}" r:id="r${i+1}"/>`).join('')}</sheets><definedNames>${mappings.map((m,i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${m.sheetName}'!$B$1:$I$69</definedName>`).join('')}</definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  entries['xl/styles.xml'] = strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="9"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>');
  const labels: Cells = { E1:'产品物料清单及报价明细', B3:'客户', D3:'工厂型号', F3:'图纸号', B5:'一、材料', B37:'材料小计', B38:'材料损耗', B39:'材料合计', B40:'二、电镀 / 外发费用', B50:'外发费用合计', B51:'三、人工及间接费用', B61:'人工间接合计', B62:'成本合计（元/副）', B63:'成本（美元/副）', B64:'内部成本分析 / 出厂核价', B66:'材料', B67:'外发', B68:'人工间接', E66:'损耗', E67:'辅料', E68:'加价金额' };
  ['序号','物料编码','物料名称','规格','用量','未税单价','金额','备注'].forEach((v,i) => labels[`${colName(i+1)}6`] = v);
  ['序号','项目','颜色','说明','数量','未税单价','金额','备注'].forEach((v,i) => { labels[`${colName(i+1)}41`] = v; labels[`${colName(i+1)}52`] = v; });
  ['直接人工','间接人工','房租','水费','电费','折旧','辅料'].forEach((v,i) => labels[`C${53+i}`] = v);
  for (const m of mappings) {
    let data = '';
    for (let row=1;row<=69;row++) data += `<row r="${row}" ht="${row===1?28:18}" customHeight="1">${[...'BCDEFGHI'].map(c => serializeCell(`<c r="${c}${row}" s="${[1,5,6,37,38,39,40,41,50,51,52,61,62,63,64].includes(row)?2:1}"/>`,`${c}${row}`,labels[`${c}${row}`]??null)).join('')}</row>`;
    const merges = ['E1:I1','B5:I5','B37:G37','B38:F38','B39:G39','B40:I40','B50:G50','B51:I51','B61:G61','B62:G62','B63:G63','B64:I64'];
    entries[m.path] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="B1:L69"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="B7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${[5,15,20,20,12,12,16,26].map((w,i)=>`<col min="${i+2}" max="${i+2}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/><headerFooter><oddFooter>未审填报草稿 · 通用版式</oddFooter></headerFooter></worksheet>`);
  }
  return { entries, mappings };
}

/** Incomplete, explicitly UNREVIEWED filling copy. It never authorizes approval,
 * release, customer pricing or mail. Blank inputs yield blank formula results. */
export async function exportIeQuoteDraftWorkbook(quote: IeQuote, options: { issues: string[]; template?: { bytes: Uint8Array; expectedSha256: string; sheetBindings: { sheetName: string; lineId: string }[] } }) {
  let entries: Record<string, Uint8Array>, mappings: { sheetName: string; lineId: string; path: string }[];
  if (options.template) {
    const inspected = await inspectArchive(options.template.bytes);
    if (inspected.inspection.sha256 !== options.template.expectedSha256) fail('模板原件已变化，请重新核验后导出', 'IE_TEMPLATE_VERSION');
    if (!inspected.inspection.canExport) fail(inspected.inspection.blockers.join('；'), 'IE_TEMPLATE_UNMAPPED');
    const binding = options.template.sheetBindings, normalize = (v: string) => v.normalize('NFKC').trim().toUpperCase();
    if (binding.length !== quote.lines.length || binding.length !== inspected.inspection.sheets.length || new Set(binding.map(b=>b.lineId)).size !== binding.length || new Set(binding.map(b=>b.sheetName)).size !== binding.length) fail('草稿必须逐款绑定全部模板，不得夹带其他款资料', 'IE_TEMPLATE_BINDING');
    mappings = binding.map(b => { const sheet = inspected.inspection.sheets.find(s=>s.name===b.sheetName), line = quote.lines.find(l=>l.id===b.lineId); if (!sheet || !line || normalize(sheet.customerCode)!==normalize(quote.customerCode) || normalize(sheet.model)!==normalize(line.model)) fail('草稿模板的客户、款式绑定不一致', 'IE_TEMPLATE_BINDING'); return {...b,path:sheet.path}; });
    entries = inspected.entries;
  } else ({ entries, mappings } = genericDraftTemplate(quote));
  const formulaVersion = ieCalculationVersion(quote), excel = formulaVersion === 'ie-cost-v3-excel', costs = calculateIeQuote(quote);
  const materialRows: GridRow[] = [['款式行编号','款式','材料名称','规格','单位（可选）','未税基价','用量','系数','本项总损耗率','材料金额（公式）','损耗金额（公式）','不适用=1 / 适用=0','备注','额外损耗原因','价格依据','正常损耗率','额外百分点']];
  const processRows: GridRow[] = [['款式行编号','款式','工序名称','上级工序编号','顺序','工价基价','难度系数','工价金额（公式）','标准秒数（可选）','不适用=1 / 适用=0','备注','价格依据']];
  const outsourceRows: GridRow[] = [['款式行编号','款式','类别','名称','未税单价','不适用=1 / 适用=0','金额（公式）','备注','价格依据']];
  const brief: GridRow[] = [['未审 Excel 填报草稿','仅供内部核对；不是已复核报价，也不是给客户的报价'],['工程报价编号',quote.quoteNo],['来源版本',`R${quote.revision} V${quote.version} / ${quote.status}`],['计算规则',formulaVersion],['1 USD = CNY（手填）',quote.exchangeRateCnyPerUsd],['汇率日期',quote.exchangeRateDate],['汇率来源',quote.exchangeRateSource],['打印模板',options.template?'保留本次绑定原模板的打印区域、版式与原模板照片；照片不代表新上传图纸':'通用同类格式；无原客户模板照片，未宣称与原模板打印完全一致'],['填写方法','在材料填报、工序填报、外发填报输入页填写；STYLE 按公式汇总。空白金额不当作 0。修改 Excel 不会自动回写或触发中台审核。'],['材料损耗','正常 10% + 指定单项额外百分点 = 本项总损耗率；其他材料仍为 10%。在材料填报 I 列录入总比例，Q 列显示额外百分点。'],['单价范围','全部未税；间接费用固定 13.70 元/副；生产成本 × 1.3 为出厂价；业务另行定客价，曲艳红批准。模具等费用全部单列。'],['完整性',options.issues.length?`${options.issues.length} 项待核验；数值完整只代表可计算，不代表已批准。`:'数值与必填检查完整；本文件仍是未审填报副本。'],['原格容量','超过原表材料 29 行或外发 8 行时，末行汇总其余项目；全量输入和金额保留在对应填报页。'],['内部备注',quote.notes]];
  const short = (s: string, length: number, fallback: string) => textWidth(s) <= length && !/[\r\n]/.test(s) ? s : fallback;
  const textRef = (sheet: string, cell: string, value: string, max: number, fallback: string):CellValue => ({formula:`IF(LEN(${ref(sheet,cell)})<=${Math.floor(max/2)},${ref(sheet,cell)}&"","${fallback}")`,value:value.length<=Math.floor(max/2)?value:fallback});
  const guardedSum = (sheet: string, column: string, first: number, last: number, value: number|null, digits=6) => draftFormula(`IF(COUNT(${ref(sheet,`${column}${first}:${column}${last}`)})=${last-first+1},ROUND(SUM(${ref(sheet,`${column}${first}:${column}${last}`)}),${digits}),"")`,value);
  for (const mapping of mappings) {
    const line = quote.lines.find(l=>l.id===mapping.lineId)!, cost = costs.lines.find(c=>c.lineId===line.id)!;
    const mStart=materialRows.length+1,pStart=processRows.length+1,oStart=outsourceRows.length+1;
    const materials = line.materials.length ? line.materials : [{id:'',name:'',specification:'',unit:'',basePrice:null,usage:null,coefficient:null,lossRate:.1,notApplicable:false,notes:'请列明材料或明确不适用',lossAdjustmentReason:'',priceSource:''}];
    for (const m of materials) {
      const r=materialRows.length+1, net=m.notApplicable?0:m.basePrice===null||m.usage===null||m.coefficient===null?null:ieCostMultiply([m.basePrice,m.usage,m.coefficient],excel?2:6), loss=net===null?null:m.notApplicable?0:ieCostMultiply(excel?[net,m.lossRate??.1]:[m.basePrice!,m.usage!,m.coefficient!,m.lossRate??.1]);
      materialRows.push([line.id,line.model,m.name,m.specification,m.unit,m.basePrice,m.usage,m.coefficient,m.lossRate??.1,draftFormula(`IF(L${r}=1,0,IF(COUNT(F${r}:H${r})=3,ROUND(F${r}*G${r}*H${r},${excel?2:6}),""))`,net),draftFormula(`IF(L${r}=1,0,IF(AND(ISNUMBER(J${r}),ISNUMBER(I${r})),ROUND(${excel?`J${r}`:`F${r}*G${r}*H${r}`}*I${r},6),""))`,loss),m.notApplicable?1:0,m.notes,m.lossAdjustmentReason,m.priceSource,.1,draftFormula(`IF(ISNUMBER(I${r}),ROUND((I${r}-P${r})*100,6),"")`,round(((m.lossRate??.1)-.1)*100))]);
    }
    const processes = line.processes.length?line.processes:[{name:'',parentId:'',sequence:0,basePrice:null,difficulty:null,standardSeconds:null,notApplicable:false,notes:'请列明工序或明确不适用',priceSource:''}];
    for (const p of processes) { const r=processRows.length+1, value=p.notApplicable?0:p.basePrice===null||p.difficulty===null?null:ieCostMultiply([p.basePrice,p.difficulty]);processRows.push([line.id,line.model,p.name,p.parentId,p.sequence,p.basePrice,p.difficulty,draftFormula(`IF(J${r}=1,0,IF(COUNT(F${r}:G${r})=2,ROUND(F${r}*G${r},6),""))`,value),p.standardSeconds,p.notApplicable?1:0,p.notes,p.priceSource]); }
    const outsourced = [...line.outsourcing];
    for (const category of ['plating','general'] as const) if (!outsourced.some(o=>o.category===category)) outsourced.push({id:'',category,name:'',unitPrice:null,notApplicable:false,notes:'请列明或明确不适用',priceSource:'',catalogId:'',catalogVersion:null});
    for (const o of outsourced) { const r=outsourceRows.length+1;outsourceRows.push([line.id,line.model,o.category==='plating'?'电镀':'一般外发',o.name,o.unitPrice,o.notApplicable?1:0,draftFormula(`IF(F${r}=1,0,IF(ISNUMBER(E${r}),E${r},""))`,o.notApplicable?0:o.unitPrice),o.notes,o.priceSource]); }
    const mEnd=materialRows.length,pEnd=processRows.length,oEnd=outsourceRows.length;
    const cells: Cells = {C3:short(quote.customerCode,24,'详见填报说明'),E3:short(line.model,24,'详见填报说明'),G3:short(line.drawingNo,24,'详见填报说明'),H3:'报价编号',I3:short(quote.quoteNo,24,'详见填报说明'),I2:'人民币',B4:'未审填报草稿',C4:'待核对',D4:`R${quote.revision} V${quote.version}`,E4:null,F4:quote.exchangeRateCnyPerUsd===null?'汇率待填':String(quote.exchangeRateCnyPerUsd),G4:null,H4:'成本加价30%',I4:null,G38:'分项',L4:draftFormula(`IF(ISNUMBER(${ref('填报说明','B5')}),${ref('填报说明','B5')},"")`,quote.exchangeRateCnyPerUsd)};
    cells.F4={formula:`IF(AND(ISNUMBER(${ref('填报说明','B5')}),${ref('填报说明','B5')}>0),TEXT(${ref('填报说明','B5')},"0.######"),"汇率待填")`,value:quote.exchangeRateCnyPerUsd&&quote.exchangeRateCnyPerUsd>0?String(quote.exchangeRateCnyPerUsd):'汇率待填'};
    const cache = (value: CellValue):number|null => typeof value==='number'?value:typeof value==='object'&&value!==null&&typeof value.value==='number'?value.value:null;
    for (let i=0;i<29;i++) {
      const row=7+i, m=materials[i], src=mStart+i;
      for (const c of 'CDEFGHI') cells[`${c}${row}`]=null;
      if (!m) continue;
      if (i===28 && materials.length>29) { cells[`D${row}`]=`其余 ${materials.length-28} 项见材料填报`;cells[`H${row}`]=guardedSum('材料填报','J',src,mEnd,materialRows.slice(src-1,mEnd).some(v=>cache(v[9])===null)?null:ieCostSum(materialRows.slice(src-1,mEnd).map(v=>cache(v[9])!)));continue; }
      cells[`D${row}`]=short(m.name,24,`材料填报第${src}行`);cells[`E${row}`]=short(m.specification,28,`见材料填报第${src}行`);cells[`F${row}`]=draftFormula(`IF(ISNUMBER(${ref('材料填报',`G${src}`)}),${ref('材料填报',`G${src}`)},"")`,m.usage);cells[`G${row}`]=draftFormula(`IF(COUNT(${ref('材料填报',`F${src}`)},${ref('材料填报',`H${src}`)})=2,${ref('材料填报',`F${src}`)}*${ref('材料填报',`H${src}`)},"")`,m.basePrice===null||m.coefficient===null?null:m.basePrice*m.coefficient);cells[`H${row}`]=draftFormula(`IF(ISNUMBER(${ref('材料填报',`J${src}`)}),${ref('材料填报',`J${src}`)},"")`,cache(materialRows[src-1][9]));cells[`I${row}`]=m.notApplicable?'不适用（见附页）':`${round((m.lossRate??.1)*100)}% 详见附页`;
      cells[`D${row}`]=textRef('材料填报',`C${src}`,m.name,24,`材料填报第${src}行`);cells[`E${row}`]=textRef('材料填报',`D${src}`,m.specification,28,`见材料填报第${src}行`);
      cells[`I${row}`]={formula:`IF(${ref('材料填报',`L${src}`)}=1,"不适用见附页",IF(ISNUMBER(${ref('材料填报',`I${src}`)}),TEXT(${ref('材料填报',`I${src}`)}*100,"0.######")&"%详见附页","损耗待填"))`,value:m.notApplicable?'不适用见附页':`${round((m.lossRate??.1)*100)}%详见附页`};
    }
    for (let i=0;i<8;i++) {
      const row=42+i,o=outsourced[i],src=oStart+i;for(const c of 'CDEFGHI')cells[`${c}${row}`]=null;if(!o)continue;
      if(i===7&&outsourced.length>8){cells[`C${row}`]=`其余 ${outsourced.length-7} 项见外发填报`;cells[`H${row}`]=guardedSum('外发填报','G',src,oEnd,outsourceRows.slice(src-1,oEnd).some(v=>cache(v[6])===null)?null:ieCostSum(outsourceRows.slice(src-1,oEnd).map(v=>cache(v[6])!)));continue;}
      cells[`C${row}`]=short(o.name,20,`外发填报第${src}行`);cells[`F${row}`]=1;cells[`G${row}`]=draftFormula(`IF(ISNUMBER(${ref('外发填报',`E${src}`)}),${ref('外发填报',`E${src}`)},"")`,o.unitPrice);cells[`H${row}`]=draftFormula(`IF(ISNUMBER(${ref('外发填报',`G${src}`)}),${ref('外发填报',`G${src}`)},"")`,cache(outsourceRows[src-1][6]));cells[`I${row}`]=o.notApplicable?'不适用（见附页）':short(o.notes,26,'详见外发填报');
      cells[`C${row}`]=textRef('外发填报',`D${src}`,o.name,20,`外发填报第${src}行`);cells[`I${row}`]={formula:`IF(${ref('外发填报',`F${src}`)}=1,"不适用见附页","详见外发填报")`,value:o.notApplicable?'不适用见附页':'详见外发填报'};
    }
    const outside=cost.plating===null||cost.outsourcing===null?null:ieCostSum([cost.plating,cost.outsourcing]), materialTotal=cost.material===null||cost.materialLoss===null?null:ieCostSum([cost.material,cost.materialLoss]),labor=cost.process===null?null:ieCostSum([cost.process,13.7]);
    Object.assign(cells,{H37:guardedSum('材料填报','J',mStart,mEnd,cost.material),H38:guardedSum('材料填报','K',mStart,mEnd,cost.materialLoss,excel?2:6),H39:draftFormula('IF(COUNT(H37:H38)=2,ROUND(SUM(H37:H38),6),"")',materialTotal),H50:guardedSum('外发填报','G',oStart,oEnd,outside),F53:1,G53:guardedSum('工序填报','H',pStart,pEnd,cost.process),H53:draftFormula('IF(ISNUMBER(G53),G53,"")',cost.process),H61:draftFormula('IF(COUNT(H53:H59)=7,ROUND(SUM(H53:H59),6),"")',labor),H62:draftFormula('IF(COUNT(H39,H50,H61)=3,ROUND(SUM(H39,H50,H61),6),"")',cost.productionCost),H63:draftFormula('IF(AND(ISNUMBER(H62),ISNUMBER($L$4),$L$4>0),ROUND(H62/$L$4,6),"")',cost.productionCost===null||!quote.exchangeRateCnyPerUsd?null:round(cost.productionCost/quote.exchangeRateCnyPerUsd)),H66:'成本×1.3出厂价',I66:draftFormula('IF(ISNUMBER(H62),ROUND(H62*1.3,6),"")',cost.factoryPriceCny),H67:'出厂价USD/副',I67:draftFormula('IF(AND(ISNUMBER(I66),ISNUMBER($L$4),$L$4>0),ROUND(I66/$L$4,6),"")',cost.factoryPriceUsd),H68:'销售毛利率',I68:draftFormula('IF(AND(ISNUMBER(I66),I66>0),(I66-H62)/I66,"")',cost.factoryPriceCny?round((cost.factoryPriceCny-cost.productionCost!)/cost.factoryPriceCny):null)});
    for(let row=53;row<=60;row++)for(const c of ['D','E','I'])cells[`${c}${row}`]=null;
    [5,3,.2,2,2,1.5].forEach((amount,i)=>{cells[`F${54+i}`]=1;cells[`G${54+i}`]=amount;cells[`H${54+i}`]=draftFormula(`F${54+i}*G${54+i}`,amount);});for(const c of 'CDEFGHI')cells[`${c}60`]=null;
    for(const [cell,source,value] of [['C66','H39',materialTotal],['C67','H50',outside],['C68','H61',labor],['F66','H38',cost.materialLoss],['F67','H59',1.5]] as const)cells[cell]=draftFormula(`IF(ISNUMBER(${source}),${source},"")`,value);
    cells.F68=draftFormula('IF(COUNT(I66,H62)=2,I66-H62,"")',cost.factoryPriceCny===null||cost.productionCost===null?null:round(cost.factoryPriceCny-cost.productionCost));for(const c of ['D','G'])for(let row=66;row<=68;row++){const source=`${c==='D'?'C':'F'}${row}`,value=cache(cells[source]);cells[`${c}${row}`]=draftFormula(`IF(AND(ISNUMBER(${source}),ISNUMBER($I$66),$I$66>0),${source}/$I$66,"")`,value===null||!cost.factoryPriceCny?null:value/cost.factoryPriceCny);}
    entries[mapping.path]=strToU8(patchSheet(textEntry(entries,mapping.path),cells));
    brief.push(['款式信息',`${mapping.sheetName} / ${line.model} / 客款 ${line.customerModel} / 色号 ${line.color} / 图号 ${line.drawingNo} / 图纸版次 ${line.drawingRevision} / 数量 ${line.quantityMin??'待填'}–${line.quantityMax??'待填'}`],['结构分析',line.structureNotes],['报价范围',line.scopeNotes]);
  }
  scrubSharedStrings(entries,mappings.map(m=>m.path));
  appendGridSheet(entries,'材料填报',materialRows,[20,20,26,34,14,16,14,14,18,18,18,20,36,36,36,16,16]);
  appendGridSheet(entries,'工序填报',processRows,[20,20,28,24,10,18,16,18,18,20,36,36]);
  appendGridSheet(entries,'外发填报',outsourceRows,[20,20,18,28,18,20,18,36,36]);
  const charges: GridRow[]=[['收费登记编号','费用名称','适用款式','收费状态','登记金额CNY','本次收费CNY（公式）','来源报价及版本','收费证据','备注']];
  for(const t of quote.tooling){const row=charges.length+1;charges.push([t.toolingId||t.id,t.name,t.lineIds.map(id=>quote.lines.find(l=>l.id===id)?.model||id).join('、'),({charge:'本次单独收费',already_charged:'已有收费记录待核对凭证',included_in_batch:'关联报价已列费',not_applicable:'不适用'}[t.chargeMode]),t.amount,draftFormula(`IF(D${row}="本次单独收费",IF(ISNUMBER(E${row}),E${row},""),0)`,t.chargeMode==='charge'?t.amount:0),`${t.chargeQuoteId}${t.chargeVersion?` V${t.chargeVersion}`:''}`,t.evidence,t.notes]);}
  if(!quote.tooling.length)charges.push(['待登记','尚未明确单列费用；不可理解为免收']);
  const end=charges.length,duplicate=new Set(quote.tooling.map(t=>t.toolingId||t.id)).size!==quote.tooling.length;
  charges.push(['本次费用合计（不摊单价）',null,null,null,null,draftFormula(quote.tooling.length?`IF(AND(COUNT(F2:F${end})=${quote.tooling.length},SUMPRODUCT(--(COUNTIF(A2:A${end},A2:A${end})>1))=0),SUM(F2:F${end}),"")`:'""',!quote.tooling.length||duplicate?null:costs.toolingChargeCny)]);
  if(duplicate)brief.push(['共用模具待核对','登记编号重复，费用合计保持空白；请合并适用款式，避免重复收费。']);
  options.issues.forEach((issue,i)=>brief.push([`待核验 ${i+1}`,issue]));
  appendGridSheet(entries,'单列费用',charges,[28,28,32,28,20,20,34,48,48]);
  appendGridSheet(entries,'填报说明',brief,[28,110]);
  appendAttachmentManifest(entries,quote.attachmentRefs);
  entries['xl/workbook.xml']=strToU8(textEntry(entries,'xl/workbook.xml').replace(/<calcPr\b[^>]*\/>/,'<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>'));
  return {bytes:zipSync(entries,ZIP_OPTIONS),templateMode:options.template?'original':'generic',formulaVersion};
}
