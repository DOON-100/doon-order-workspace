import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CliError} from './errors.js';

export type Row = Record<string, any>;
export function failResponse(): never { throw new CliError('INVALID_RESPONSE', '服务器业务响应与已接入协议不一致。', 5); }
export function object(value: any): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) return failResponse(); return value; }
export function collection(value: any, key: string): Row[] {
  const list = object(value)[key];
  if (!Array.isArray(list) || list.some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string')) return failResponse();
  return list;
}
export const fields = (text: string) => text.split(' ');
export function pick(row: any, keys: string[]): Row {
  row = object(row);
  return Object.fromEntries(keys.filter(key => Object.hasOwn(row, key) && (row[key] === null || ['string','number','boolean'].includes(typeof row[key]) || Array.isArray(row[key]) && row[key].every((v: unknown) => typeof v === 'string'))).map(key => [key, row[key]]));
}
export function identifier(value: unknown, label: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new CliError('INVALID_ARGUMENT', `${label}须为明确编号。`, 2);
  return value.trim();
}
export function pagination(options: {limit?: string; offset?: string}) {
  const parse = (value: string | undefined, fallback: number, min: number, max: number) => {
    if (value !== undefined && !/^\d+$/.test(value)) throw new CliError('INVALID_ARGUMENT', 'limit/offset 须为整数。', 2);
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new CliError('INVALID_ARGUMENT', 'limit 范围为 1–100，offset 范围为 0–1000000。', 2);
    return n;
  };
  return {limit: parse(options.limit, 20, 1, 100), offset: parse(options.offset, 0, 0, 1000000)};
}
export function page(rows: Row[], window: {limit: number; offset: number}) {
  return {...window, total: rows.length, nextOffset: window.offset + window.limit < rows.length ? window.offset + window.limit : null, rows: rows.slice(window.offset, window.offset + window.limit)};
}
export function find(rows: Row[], id: string) {
  const found = rows.find(row => row.id === id);
  if (!found) throw new CliError('NOT_IN_SCOPE', '编号不在当前授权列表或所选范围内。', 7);
  return found;
}
export async function newXlsxPath(output: string | undefined) {
  if (!output) throw new CliError('INVALID_ARGUMENT', '请提供新输出文件。', 2);
  const filename = path.resolve(output);
  if (!filename.toLowerCase().endsWith('.xlsx')) throw new CliError('INVALID_ARGUMENT', '导出文件须使用 .xlsx 扩展名。', 2);
  if (await fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new CliError('OUTPUT_EXISTS', '输出文件已存在，请提供新文件名。', 3);
  return filename;
}
export async function writeNewXlsx(filename: string, bytes: Buffer) {
  let file;
  try { file = await fs.open(filename, 'wx', 0o600); await file.writeFile(bytes); }
  catch (error) { throw new CliError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_WRITE_FAILED', '未能写入新导出文件，请检查目录和文件名；已有文件不会被覆盖。', 3); }
  finally { await file?.close(); }
  return {filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}
