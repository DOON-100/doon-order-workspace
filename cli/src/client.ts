import {CliError} from './errors.js';
import {version} from './catalog.js';
import type {Config, SavedSession} from './state.js';
import {routes, type Route, type RequestOptions} from './routes.js';

export class ApiClient {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private config: Config, private transport: typeof fetch = fetch, private timeout = 15000) {}

  request(route: Route, session?: SavedSession | null, body?: unknown, options: RequestOptions = {}): Promise<{data: any; headers: Headers}> {
    // Bound requests from one invocation; no background polling or automatic POST retry.
    const result = this.tail.then(() => this.perform(route, session, body, options));
    this.tail = result.catch(() => {});
    return result;
  }

  private async perform(route: Route, session: SavedSession | null | undefined, body: unknown, options: RequestOptions) {
    if (!Object.hasOwn(routes, route)) throw new CliError('UNSUPPORTED_OPERATION', '该操作尚未接入客户端。', 2);
    const spec = routes[route] as {method: string; business?: boolean; write?: boolean; query?: readonly string[]; binary?: boolean};
    const method = spec.method, headers: Record<string, string> = {'Accept': spec.binary ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json', 'User-Agent': 'doon-cli/' + version};
    if (spec.business && !session) throw new CliError('AUTH_REQUIRED', '请先运行 doon login。', 4);
    if (spec.business && ((method !== 'GET' && !spec.write) || (body !== undefined && (!spec.write || method !== 'POST')))) throw new CliError('UNSUPPORTED_OPERATION', '该业务写入尚未接入客户端。', 2);
    if (spec.business && spec.write && (method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body))) throw new CliError('INVALID_INPUT', '业务写入必须使用结构化对象。', 2);
    if (options.team) {
      if (!spec.business || options.team.length > 160 || /[\u0000-\u001f\u007f]/.test(options.team)) throw new CliError('INVALID_SCOPE', '业务组编号无效。', 2);
      headers['X-Workspace-Team'] = options.team;
    }
    const url = new URL(this.config.origin + route);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (!spec.query?.includes(key) || typeof value !== 'string' || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new CliError('INVALID_QUERY', '该接口不接受此查询参数。', 2);
      if (route === '/api/workspace/process-data' && (key !== 'type' || !['rfq','iqc','first-article','process-quality','outsourcing-quality','oqc','packaging','shipment-release','supplier-reconciliation','complaint'].includes(value))) throw new CliError('UNSUPPORTED_OPERATION', '该流程类型尚未开放查询。', 2);
      url.searchParams.set(key, value);
    }
    if (route === '/api/workspace/process-data' && !url.searchParams.has('type')) throw new CliError('INVALID_QUERY', '流程查询必须限定类型。', 2);
    if (session) {
      const name = this.config.localHttp ? 'doon_session' : 'doon_employee_session';
      if (session.origin !== this.config.origin || !new RegExp('^' + name + '=[\\w-]{43}$').test(session.cookie)) throw new CliError('INVALID_SESSION', '会话地址不匹配。', 4);
      headers.Cookie = session.cookie;
    }
    if (method === 'POST') { headers.Origin = this.config.origin; headers['Content-Type'] = 'application/json'; }
    let encoded: string | undefined;
    if (method === 'POST') {
      try { encoded = JSON.stringify(body ?? {}); } catch { throw new CliError('INVALID_INPUT', '输入不能转换为 JSON。', 2); }
      if (spec.write && (!encoded || Buffer.byteLength(encoded, 'utf8') > 1024 * 1024)) throw new CliError('INVALID_INPUT', '业务输入超过 1 MiB 或格式无效。', 2);
    }
    const signal = AbortSignal.timeout(this.timeout);
    try {
      const response = await this.transport(url.href, {method, headers, body: encoded, redirect: 'manual', signal});
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new CliError('REDIRECT_REFUSED', '服务器返回跳转，请核对公司 HTTPS 地址；客户端未跟随跳转。', 5, method === 'POST' && spec.write ? {outcomeUnknown: true} : {}); }
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status, retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Math.min(300, Number(retry)) : undefined;
        if (status === 401) throw new CliError('AUTH_REQUIRED', '登录已失效或账号密码不正确，请重新登录。', 4, {status});
        if (status === 403) throw new CliError('FORBIDDEN', '服务器拒绝此操作，请核对员工权限或先在网页修改初始密码。', 4, {status});
        if (status === 404) throw new CliError('NOT_FOUND', '记录或接口不存在，请核对编号和服务器版本。', 7, {status});
        if (status === 409 && spec.write) throw new CliError('CONFLICT', '记录状态或版本发生冲突，请重新读取并核对。', 2, {status});
        if (status === 429) throw new CliError('RATE_LIMITED', '服务器当前繁忙或请求过于频繁，请稍后再试。', 6, {status, retryable: !spec.write, ...(seconds !== undefined ? {retryAfterSeconds: seconds} : {})});
        throw new CliError(status >= 500 ? 'SERVER_UNAVAILABLE' : 'REQUEST_REJECTED', status >= 500 ? '服务器暂时无法完成操作。' : '服务器未接受请求，请核对配置与客户端版本。', status >= 500 ? 5 : 2, {status, retryable: method === 'GET' && status >= 500, ...(method === 'POST' && status >= 500 ? {outcomeUnknown: true} : {})});
      }
      const expectedType = spec.binary ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json';
      if (!response.headers.get('content-type')?.toLowerCase().includes(expectedType)) { await response.body?.cancel(); throw new CliError('INVALID_RESPONSE', '服务地址未返回预期接口，请检查配置。', 5); }
      const reader = response.body?.getReader();
      if (!reader) throw new CliError('INVALID_RESPONSE', '服务器响应为空。', 5);
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const {value, done} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > (spec.business ? 32 * 1024 * 1024 : 65536)) { await reader.cancel(); throw new CliError('RESPONSE_TOO_LARGE', spec.business ? '业务响应超过 32 MiB，需后续接入服务端分页；本次未输出部分结果。' : '基础接口响应超过限制，请核对服务地址。', 5); }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      if (spec.binary) {
        if (bytes.length < 4 || bytes.subarray(0, 4).toString('hex') !== '504b0304') throw new CliError('INVALID_RESPONSE', '导出文件不符合 XLSX 格式。', 5);
        return {data: bytes, headers: response.headers};
      }
      let data: any;
      try { data = JSON.parse(bytes.toString('utf8')); }
      catch { throw new CliError('INVALID_RESPONSE', '服务器返回格式无效。', 5); }
      return {data, headers: response.headers};
    } catch (error) {
      if (error instanceof CliError) {
        if (method === 'POST' && ['INVALID_RESPONSE', 'RESPONSE_TOO_LARGE'].includes(error.code)) error.details.outcomeUnknown = true;
        throw error;
      }
      throw new CliError(signal.aborted ? 'REQUEST_TIMEOUT' : 'CONNECTION_FAILED', signal.aborted ? '请求超时，请检查连接；客户端没有自动重试。' : '无法连接公司服务器，请检查网络、地址和 HTTPS 证书。', 5, {retryable: method === 'GET', ...(method === 'POST' ? {outcomeUnknown: true} : {})});
    }
  }
}

export function cookieSession(headers: Headers, config: Config): SavedSession {
  const name = config.localHttp ? 'doon_session' : 'doon_employee_session';
  const matches = headers.getSetCookie().filter(cookie => cookie.startsWith(name + '='));
  if (matches.length !== 1) throw new CliError('INVALID_RESPONSE', '登录响应缺少有效员工会话，请核对员工入口。', 5);
  const cookie = matches[0], value = cookie.split(';')[0], age = cookie.match(/;\s*Max-Age=(\d+)(?:;|$)/i);
  if (!new RegExp('^' + name + '=[\\w-]{43}$').test(value) || !/;\s*HttpOnly(?:;|$)/i.test(cookie) ||
    (!config.localHttp && !/;\s*Secure(?:;|$)/i.test(cookie)) || !age || Number(age[1]) < 1 || Number(age[1]) > 43200) throw new CliError('INVALID_RESPONSE', '服务器会话格式不符合当前员工入口协议。', 5);
  return {origin: config.origin, cookie: value, expiresAt: Date.now() + Number(age[1]) * 1000};
}
