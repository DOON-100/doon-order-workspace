import {open} from 'node:fs/promises';
import {TextDecoder} from 'node:util';
import {CliError} from './errors.js';

// Infrastructure only: no routes, commands or server-side permissions are registered here.
export type WriteField = {type: 'string' | 'number' | 'boolean' | 'object' | 'array'; required?: boolean; nullable?: boolean; properties?: WriteSchema; items?: WriteField; enum?: readonly (string | number | boolean)[]; integer?: boolean; min?: number; max?: number};
export type WriteSchema = Readonly<Record<string, WriteField>>;
export type WriteObject = Record<string, unknown>;
const maxInputBytes = 1024 * 1024;

function validateField(item: unknown, field: WriteField): void {
  if (item === null && field.nullable) return;
  const valid = field.type === 'array' ? Array.isArray(item) : field.type === 'object'
    ? !!item && typeof item === 'object' && !Array.isArray(item) && Object.getPrototypeOf(item) === Object.prototype
    : typeof item === field.type;
  if (!valid || (typeof item === 'number' && (!Number.isFinite(item) || (field.integer && !Number.isInteger(item)))))
    throw new CliError('INVALID_INPUT', '输入字段类型无效。', 2);
  if (field.enum && !field.enum.some(value => value === item)) throw new CliError('INVALID_INPUT', '输入字段不在允许范围。', 2);
  const measure = typeof item === 'string' || Array.isArray(item) ? item.length : typeof item === 'number' ? item : undefined;
  if (measure !== undefined && ((field.min !== undefined && measure < field.min) || (field.max !== undefined && measure > field.max)))
    throw new CliError('INVALID_INPUT', '输入字段超出允许范围。', 2);
  if (field.type === 'object') {
    if (!field.properties) throw new CliError('INVALID_SCHEMA', '该表单缺少嵌套字段定义，操作未执行。', 2);
    validateWriteInput(item, field.properties);
  }
  if (field.type === 'array') {
    if (!field.items) throw new CliError('INVALID_SCHEMA', '该表单缺少数组元素定义，操作未执行。', 2);
    for (const child of item as unknown[]) validateField(child, field.items);
  }
}

export function validateWriteInput(value: unknown, schema: WriteSchema): WriteObject {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new CliError('INVALID_INPUT', '输入必须是 JSON 对象。', 2);
  const data = value as WriteObject;
  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(schema, key)) throw new CliError('INVALID_INPUT', '输入包含未允许的字段。', 2);
    validateField(data[key], schema[key]);
  }
  for (const [key, field] of Object.entries(schema))
    if (field.required && !Object.hasOwn(data, key)) throw new CliError('INVALID_INPUT', '输入缺少必填字段。', 2);
  return data;
}

export async function readWriteInput(file: string, schema: WriteSchema): Promise<WriteObject> {
  if (!file || file.includes('\0')) throw new CliError('INVALID_INPUT', '请提供有效的输入文件。', 2);
  let handle;
  try {
    handle = await open(file, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxInputBytes) throw new CliError('INVALID_INPUT', '输入文件须为不超过 1 MiB 的普通文件。', 2);
    // A bounded read also handles files that grow after stat.
    const buffer = Buffer.alloc(maxInputBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxInputBytes) throw new CliError('INVALID_INPUT', '输入文件超过 1 MiB。', 2);
    let data: unknown;
    try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, size))); }
    catch { throw new CliError('INVALID_INPUT', '输入文件必须为 UTF-8 编码的 JSON。', 2); }
    return validateWriteInput(data, schema);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('INVALID_INPUT', '无法读取输入文件。', 2);
  } finally { await handle?.close(); }
}
