export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 1,
    public details: {status?: number; retryable?: boolean; retryAfterSeconds?: number; outcomeUnknown?: boolean} = {}) {
    super(message);
  }
}

export function publicError(error: unknown) {
  const value = error instanceof CliError ? error : new CliError('INTERNAL_ERROR', '客户端未能完成操作，请运行 doon doctor 检查连接。');
  return {code: value.code, message: value.message, ...value.details};
}
