import {ApiClient, cookieSession} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';

function userFrom(data: any) {
  const u = data?.user;
  if (u === null) return null;
  if (!u || typeof u.username !== 'string' || typeof u.role !== 'string' || typeof u.mustChange !== 'boolean' ||
    !u.identity || typeof u.identity.id !== 'string' || typeof u.identity.name !== 'string' || typeof u.identity.email !== 'string') throw new CliError('INVALID_RESPONSE', '员工身份响应不符合当前接口协议。', 5);
  if (u.role === 'supplier') throw new CliError('EMPLOYEE_REQUIRED', '此 CLI 使用员工入口，请使用员工账号。', 4);
  return {username: u.username, role: u.role, mustChange: u.mustChange, personnelType: typeof u.personnelType === 'string' ? u.personnelType : null,
    identity: {id: u.identity.id, name: u.identity.name, email: u.identity.email}};
}

export class FoundationService {
  constructor(public store = new StateStore(), private transport: typeof fetch = fetch) {}

  async whoami() {
    const config = await this.store.config(), saved = await this.store.session(config);
    if (!saved) throw new CliError('AUTH_REQUIRED', '请先运行 doon login 登录员工账号。', 4);
    try {
      const user = userFrom((await new ApiClient(config, this.transport).request('/api/auth/session', saved)).data);
      if (!user) throw new CliError('AUTH_REQUIRED', '登录已过期或被撤销，请重新登录。', 4);
      return user;
    } catch (error) {
      if (error instanceof CliError && error.code === 'AUTH_REQUIRED') await this.store.clearSession();
      throw error;
    }
  }

  async login(credentials: (origin: string) => Promise<{username: string; password: string}>) {
    const config = await this.store.config();
    if (await this.store.session(config)) {
      try { return {user: await this.whoami(), reused: true}; }
      catch (error) { if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') throw error; }
    }
    await this.store.checkCredentialStore();
    const input = await credentials(config.origin);
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(input.username) || !input.password || input.password.length > 128) throw new CliError('INVALID_CREDENTIAL_INPUT', '请核对员工账号及密码格式。', 2);
    try {
      const response = await new ApiClient(config, this.transport).request('/api/auth/login', null, input);
      const user = userFrom(response.data);
      if (!user) throw new CliError('INVALID_RESPONSE', '登录后未返回员工身份。', 5);
      const saved = cookieSession(response.headers, config);
      try { await this.store.saveSession(saved); }
      catch {
        // Avoid orphaning a known session when local credential persistence fails.
        try { await new ApiClient(config, this.transport).request('/api/auth/logout', saved, {}); } catch {}
        throw new CliError('CREDENTIAL_STORE_FAILED', '登录后未能保存加密会话，请检查本机配置目录后重试。', 3);
      }
      return {user, reused: false};
    } finally { input.password = ''; }
  }

  async logout(localOnly = false) {
    if (localOnly) { await this.store.clearSession(); return {localCleared: true, serverRevoked: false}; }
    const config = await this.store.config(), saved = await this.store.session(config);
    if (!saved) { await this.store.clearSession(); return {localCleared: true, serverRevoked: false, alreadySignedOut: true}; }
    try { await new ApiClient(config, this.transport).request('/api/auth/logout', saved, {}); }
    catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') throw error;
    }
    await this.store.clearSession();
    return {localCleared: true, serverRevoked: true};
  }

  async doctor() {
    const config = await this.store.config(), api = new ApiClient(config, this.transport);
    const health = (await api.request('/health')).data;
    if (health?.ok !== true || typeof health.service !== 'string') throw new CliError('INVALID_RESPONSE', '服务存活检查未返回中台协议。', 5);
    const mode = (await api.request('/api/review-mode')).data;
    if (typeof mode?.readOnly !== 'boolean') throw new CliError('INVALID_RESPONSE', '无法核对服务器运行模式。', 5);
    let user = null;
    try { user = await this.whoami(); }
    catch (error) { if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') throw error; }
    return {origin: config.origin, reachable: true, localTest: config.localHttp, readOnly: mode.readOnly,
      syntheticOnly: mode.syntheticOnly === true, authenticated: !!user, mustChange: user?.mustChange ?? false,
      credentialStorage: process.platform === 'win32' ? 'windows-dpapi-current-user' : 'unsupported',
      serverBuild: null, compatibility: 'foundation-endpoints-probed',
      businessCommandsAvailable: false};
  }
}
