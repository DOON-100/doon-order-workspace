import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {CliError} from './errors.js';

export type Config = {format: 'doon-cli-config-v1'; origin: string; localHttp: boolean};
export type SavedSession = {origin: string; cookie: string; expiresAt: number};
export type Codec = {protect: (text: string) => Promise<string>; unprotect: (text: string) => Promise<string>};

export function serverConfig(raw: string, localHttp = false): Config {
  let url: URL;
  try { url = new URL(raw); } catch { throw new CliError('INVALID_SERVER', '请提供完整的公司 HTTPS 地址。', 2); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(localHttp && loopback && url.protocol === 'http:'))) {
    throw new CliError('INVALID_SERVER', '地址须为独立 HTTPS Origin；HTTP 只允许显式启用的本机测试地址。', 2);
  }
  return {format: 'doon-cli-config-v1', origin: url.origin, localHttp: url.protocol === 'http:'};
}

export function stateDirectory() {
  const override = process.env.DOON_CLI_HOME;
  if (override && !path.isAbsolute(override)) throw new CliError('INVALID_CONFIG_HOME', 'DOON_CLI_HOME 必须是绝对路径。', 2);
  return override || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Doon', 'CLI')
    : path.join(os.homedir(), '.config', 'doon-cli'));
}

// Secrets travel through stdin, never process arguments. Windows DPAPI binds the
// ciphertext to this Windows user. It is not isolation from that user's agents.
async function dpapi(text: string, decrypt: boolean): Promise<string> {
  if (process.platform !== 'win32') throw new CliError('CREDENTIAL_STORE_UNSUPPORTED', '首版仅支持 Windows 加密会话保存；当前系统可使用帮助与连接检查。', 3);
  const binary = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $e=[Text.Encoding]::UTF8.GetBytes('doon-cli-session-v1'); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const input = decrypt ? text : Buffer.from(text, 'utf8').toString('base64');
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
    let output = '';
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 65536) child.kill(); });
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new CliError('CREDENTIAL_STORE_FAILED', '无法使用 Windows 加密凭据存储。', 3)));
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(output)) reject(new CliError('CREDENTIAL_STORE_FAILED', '无法使用 Windows 加密凭据存储；请使用原 Windows 用户，或清除旧会话后重新登录。', 3));
      else resolve(output);
    });
    child.stdin.end(input);
  });
  return decrypt ? Buffer.from(result, 'base64').toString('utf8') : result;
}
export const windowsCodec: Codec = {protect: text => dpapi(text, false), unprotect: text => dpapi(text, true)};

export class StateStore {
  constructor(public directory = stateDirectory(), private codec: Codec = windowsCodec) {}

  private async file(name: string) {
    await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
    if (!(await fs.lstat(this.directory)).isDirectory() || (await fs.lstat(this.directory)).isSymbolicLink()) throw new CliError('UNSAFE_CONFIG', '客户端配置目录不能是符号链接。', 3);
    const filename = path.join(this.directory, name);
    try { const stat = await fs.lstat(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new CliError('UNSAFE_CONFIG', '客户端配置文件无效。', 3); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return filename;
  }

  private async read(name: string) {
    const file = await this.file(name);
    try { return await fs.readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  private async write(name: string, text: string) {
    const file = await this.file(name), temporary = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, text, {flag: 'wx', mode: 0o600}); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, {force: true}); }
  }

  async config(): Promise<Config> {
    const text = await this.read('config.json');
    if (!text) throw new CliError('NOT_CONFIGURED', '请先运行 doon setup --server <公司HTTPS地址>。', 3);
    try {
      const value = JSON.parse(text);
      if (value.format !== 'doon-cli-config-v1' || typeof value.origin !== 'string' || typeof value.localHttp !== 'boolean') throw Error();
      return serverConfig(value.origin, value.localHttp);
    } catch { throw new CliError('INVALID_CONFIG', '连接配置损坏，请重新运行 doon setup。', 3); }
  }

  async setup(raw: string, localHttp: boolean) {
    const next = serverConfig(raw, localHttp);
    let previous: Config | undefined;
    try { previous = await this.config(); } catch (error) { if (!(error instanceof CliError) || !['NOT_CONFIGURED', 'INVALID_CONFIG'].includes(error.code)) throw error; }
    if (await this.hasSession() && previous?.origin !== next.origin) throw new CliError('LOGOUT_REQUIRED', '切换服务器前请先注销；连接不可用时可用 doon logout --local-only。', 3);
    await this.write('config.json', JSON.stringify(next, null, 2) + '\n');
    return {origin: next.origin, localTest: next.localHttp};
  }

  async hasSession() { return (await this.read('session.dpapi')) !== null; }
  async session(config: Config): Promise<SavedSession | null> {
    const text = await this.read('session.dpapi');
    if (!text) return null;
    let saved: SavedSession;
    try { saved = JSON.parse(await this.codec.unprotect(text)); }
    catch (error) { if (error instanceof CliError) throw error; throw new CliError('INVALID_SESSION', '本机会话损坏，请清除后重新登录。', 3); }
    const name = config.localHttp ? 'doon_session' : 'doon_employee_session';
    if (!saved || typeof saved !== 'object' || saved.origin !== config.origin || typeof saved.cookie !== 'string' ||
      !new RegExp('^' + name + '=[\\w-]{43}$').test(saved.cookie) || !Number.isFinite(saved.expiresAt)) throw new CliError('INVALID_SESSION', '本机会话与服务器不匹配，请清除后重新登录。', 3);
    if (saved.expiresAt <= Date.now()) { await this.clearSession(); return null; }
    return saved;
  }
  async saveSession(value: SavedSession) { await this.write('session.dpapi', await this.codec.protect(JSON.stringify(value))); }
  async clearSession() { await fs.rm(await this.file('session.dpapi'), {force: true}); }
  async checkCredentialStore() { const sample = 'doon-cli-credential-check'; if (await this.codec.unprotect(await this.codec.protect(sample)) !== sample) throw new CliError('CREDENTIAL_STORE_FAILED', '凭据存储检查失败。', 3); }
}
