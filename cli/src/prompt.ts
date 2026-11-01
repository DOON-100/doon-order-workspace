import readline from 'node:readline';
import {Writable} from 'node:stream';
import {CliError} from './errors.js';

export async function ask(label: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new CliError('INTERACTIVE_LOGIN_REQUIRED', '请由员工在自己的交互终端运行 doon login；密码不接受命令参数、环境变量或管道。', 2);
  const output = hidden ? new Writable({write(_chunk, _encoding, callback) { callback(); }}) : process.stderr;
  const rl = readline.createInterface({input: process.stdin, output, terminal: true});
  if (hidden) process.stderr.write(label);
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.once('SIGINT', () => reject(new CliError('CANCELLED', '已取消登录。', 130)));
      rl.once('close', () => reject(new CliError('CANCELLED', '已取消登录。', 130)));
      rl.question(hidden ? '' : label, resolve);
    });
  } finally { rl.close(); if (hidden) process.stderr.write('\n'); }
}
