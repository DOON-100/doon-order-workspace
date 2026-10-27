import {CliError} from './errors.js';
import {readWriteInput, type WriteObject, type WriteSchema} from './write-input.js';

// An adapter is defined by the resource implementation, never by CLI input.
export type WriteAdapter<T> = {
  schema: WriteSchema;
  versionField?: string;
  versionMin?: 0 | 1;
  tokenField?: string;
  send: (payload: WriteObject) => Promise<T>;
  validate?: (payload: WriteObject) => void;
  readBack: (response: T, payload: WriteObject) => Promise<unknown>;
};
export type WriteOptions = {file: string; version?: number; token?: string};

export async function executeWrite<T>(adapter: WriteAdapter<T>, options: WriteOptions): Promise<unknown> {
  const payload = await readWriteInput(options.file, adapter.schema);
  adapter.validate?.(payload);
  if (adapter.versionField) {
    if (!Number.isSafeInteger(options.version) || (options.version as number) < (adapter.versionMin ?? 1) || Object.hasOwn(payload, adapter.versionField))
      throw new CliError('INVALID_INPUT', '需要符合该业务规则的整数版本，且不能在输入文件中重复提供。', 2);
    payload[adapter.versionField] = options.version;
  } else if (options.version !== undefined) throw new CliError('INVALID_INPUT', '该操作不接受版本参数。', 2);
  if (adapter.tokenField) {
    if (!options.token || !/^[a-zA-Z0-9_-]{8,160}$/.test(options.token) || Object.hasOwn(payload, adapter.tokenField))
      throw new CliError('INVALID_INPUT', '需要有效操作标识，且不能在输入文件中重复提供。', 2);
    payload[adapter.tokenField] = options.token;
  } else if (options.token !== undefined) throw new CliError('INVALID_INPUT', '该操作不接受操作标识。', 2);
  // No retry: adapters must implement the server's exact contract and scope.
  const response = await adapter.send(payload);
  try { return await adapter.readBack(response, payload); }
  catch { throw new CliError('READBACK_FAILED', '服务器已响应，但回读未完成；请查询原操作结果，不要重复提交。', 5, {outcomeUnknown:true}); }
}
