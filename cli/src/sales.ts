import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import type {Route} from './routes.js';

export type Resource = 'teams' | 'customers' | 'projects' | 'inquiries' | 'quotes';
export type Action = 'list' | 'show' | 'history' | 'version' | 'export-completed';
export type SalesOptions = {team?: string; customer?: string; search?: string; limit?: string; offset?: string; output?: string};
type Row = Record<string, any>;
function failResponse(): never { throw new CliError('INVALID_RESPONSE', '服务器业务响应与已接入协议不一致。', 5); }
function object(value: any): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) return failResponse(); return value; }
function collection(value: any, key: string): Row[] {
  const list = object(value)[key]; if (!Array.isArray(list) || list.some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string')) return failResponse(); return list;
}
function pick(row: any, keys: string[]): Row {
  row = object(row); return Object.fromEntries(keys.filter(key => Object.hasOwn(row, key) && (row[key] === null || ['string','number','boolean'].includes(typeof row[key]) || Array.isArray(row[key]) && row[key].every((v: unknown) => typeof v === 'string'))).map(key => [key, row[key]]));
}
const fields = (text: string) => text.split(' ');
const customerFields = fields('legalName shortName website brandIntroduction backgroundResearch contactPerson contactTitle phone email whatsapp wechat contacts companyAddress billingAddress shippingAddress defaultPaymentMethod defaultTradeTerms ndaStatus packagingRequirements documentRequirements longTermNotes type source stage orderHistory firstListedOn lastOrderOn');
const projectFields = fields('id version customerId teamId code title description salesMemberId serviceMemberId serviceMemberIds dueDate status updatedAt updatedBy canWrite canManageTasks canManageAssignments');
const inquiryFields = fields('id version type customerId orderId teamId title batch ownerId responsibleId plannedDate actualDate status inputBasis inputVersion outputEvidence gateStatus blocker nextAction nextOwnerId nextDueDate notes createdAt updatedAt updatedBy canEdit');
const quoteFields = fields('id version customerAccountId customerName customerCode quoteNo quoteDate validUntil currency status companyEn companyZh collectionEn collectionZh contactName brand businessType quoteMode pricingBasis currencyReviewed reviewNotes createdAt createdBy updatedAt updatedBy confirmedAt confirmedBy canEdit canConfirm canRevise canSeeInternal canSeeReviewDetails');
const quoteLineFields = fields('id model factoryModel customerModel materialNumber component side supplyStage productType descriptionZh descriptionEn quantity unit unitPrice toolingFee quantityBasisZh quantityBasisEn scopeNotesZh scopeNotesEn scopeReviewed');
function identifier(value: unknown, label: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new CliError('INVALID_ARGUMENT', `${label}须为明确编号。`, 2);
  return value.trim();
}
function pagination(options: SalesOptions) {
  const parse = (value: string | undefined, fallback: number, min: number, max: number) => {
    if (value !== undefined && !/^\d+$/.test(value)) throw new CliError('INVALID_ARGUMENT', 'limit/offset 须为整数。', 2);
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new CliError('INVALID_ARGUMENT', 'limit 范围为 1–100，offset 范围为 0–1000000。', 2); return n;
  };
  return {limit: parse(options.limit, 20, 1, 100), offset: parse(options.offset, 0, 0, 1000000)};
}
function page(rows: Row[], window: {limit: number; offset: number}) {
  return {...window, total: rows.length, nextOffset: window.offset + window.limit < rows.length ? window.offset + window.limit : null, rows: rows.slice(window.offset, window.offset + window.limit)};
}
function find(rows: Row[], id: string) { const found = rows.find(row => row.id === id); if (!found) throw new CliError('NOT_IN_SCOPE', '编号不在当前授权列表或所选范围内。', 7); return found; }
function workflow(row: any) { return row === null || row === undefined ? null : pick(row, fields('version next nextDate followState latestFollowupOn updatedAt updatedBy')); }
function profile(row: any) { return {version: object(row).version, fields: pick(object(row).fields, customerFields)}; }
function inquiry(row: Row) { return {...pick(row, inquiryFields), details: pick(row.details || {}, fields('gateReason documentRef requirement targetDelivery quantity currency quoteRef'))}; }

export class SalesService {
  constructor(private store: StateStore, private transport: typeof fetch = fetch) {}

  async execute(resource: Resource, action: Action, options: SalesOptions = {}, rawId?: string, rawVersion?: string) {
    if (!['teams','customers','projects','inquiries','quotes'].includes(resource) || !['list','show','history','version','export-completed'].includes(action) ||
      (['version','export-completed'].includes(action) && resource !== 'quotes') || resource === 'teams' && action !== 'list') throw new CliError('UNSUPPORTED_OPERATION', '该业务命令尚未开放。', 2);
    const team = identifier(options.team, '业务组'), customer = identifier(options.customer, '客户'), id = identifier(rawId, '记录', !['list','export-completed'].includes(action));
    const window = pagination(options), search = options.search?.trim() || '';
    if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) throw new CliError('INVALID_ARGUMENT', '搜索文字最多 200 个字符。', 2);
    if (action !== 'list' && search) throw new CliError('INVALID_ARGUMENT', 'search 仅用于列表。', 2);
    if (action === 'export-completed' && (customer || options.limit || options.offset || search || !options.output)) throw new CliError('INVALID_ARGUMENT', '总表导出仅支持业务组和必填 output，不支持客户或分页筛选。', 2);
    if (action === 'version' && (!rawVersion || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)))) throw new CliError('INVALID_ARGUMENT', '报价版本须为正整数。', 2);
    const scope = {teamId: team || null, customerId: customer || null, search: search || null, pagination: 'client', authorization: 'current-server-permissions', teamFilter: team ? 'server-list-guard' : 'all-authorized'};
    const config = await this.store.config(), saved = await this.store.session(config);
    if (!saved) throw new CliError('AUTH_REQUIRED', '请先运行 doon login。', 4);
    const api = new ApiClient(config, this.transport, 30000);
    const read = async (route: Route, query?: Record<string,string>) => {
      try {
        const data = (await api.request(route, saved, undefined, {team, query})).data;
        if (team && ['/api/workspace/customer-workflow-data','/api/workspace/customer-project-data','/api/workspace/customer-quotes','/api/workspace/process-data'].includes(route) && !query?.customerId && data?.businessTeamScope?.teamId !== team) throw new CliError('SCOPE_NOT_CONFIRMED', '服务器未确认所选业务组范围，请核对服务器版本。', 5);
        return data;
      }
      catch (error) { if (error instanceof CliError && error.code === 'AUTH_REQUIRED') await this.store.clearSession(); throw error; }
    };
    const matches = (row: Row, keys: string[], customerKey = 'customerId') => (!customer || row[customerKey] === customer) && (!search || keys.some(key => typeof row[key] === 'string' && row[key].toLocaleLowerCase().includes(search.toLocaleLowerCase())));
    if (resource === 'teams') {
      const rows = collection(await read('/api/workspace/business-team-data'), 'teams');
      if (team && team !== '__ungrouped') find(rows, team);
      return {scope: {...scope, teamFilter: 'directory-filter'}, page: page(rows.filter(row => (!team || row.id === team) && (!customer || Array.isArray(row.customerIds) && row.customerIds.includes(customer)) && (!search || String(row.name || '').toLocaleLowerCase().includes(search.toLocaleLowerCase()))).map(row => pick(row, fields('id name active customerIds'))), window)};
    }
    if (resource === 'customers') {
      const data = await read('/api/workspace/customer-workflow-data'), rows = collection(data, 'customers');
      const directory = await read('/api/workspace/business-team-data'), names = new Map(collection(directory, 'customers').map(row => [row.id, row]));
      const summaries = rows.map(row => ({id: row.id, ...pick(names.get(row.id) || {}, fields('customer customerCode active')), stage: pick(object(row.profile).fields, ['stage']).stage ?? null, ...pick(row, ['reminder']), workflow: workflow(row.workflow)}));
      if (action === 'list') return {scope, page: page(summaries.filter(row => matches(row, ['id','customer','customerCode'], 'id')), window)};
      find(summaries.filter(row => !customer || row.id === customer), id!);
      if (action === 'history') return {scope, customerId: id, page: page(collection(await read('/api/workspace/customer-workflow-history', {customerId: id!}), 'events').map(row => pick(row, fields('id action reason actor createdAt'))), window)};
      const detail = await read('/api/workspace/customer-workflow-data', {customerId: id!});
      if (object(detail.customer).id !== id) return failResponse();
      return {scope, projection: 'customer-profile-without-bank-or-courier-account', record: {customer: pick(detail.customer, fields('id customer customerCode country')), profile: profile(detail.profile), workflow: workflow(detail.workflow), capabilities: pick(detail.capabilities, fields('read writeProfile writeWorkflow readBank writeBank canAssign canUsePool'))},
        followups: page(collection(detail, 'followups').map(row => pick(row, fields('id at author channel content result disposition next nextDate evidence createdAt'))), window)};
    }
    if (resource === 'projects') {
      const data = await read('/api/workspace/customer-project-data'), rows = collection(data, 'projects').filter(row => matches(row, ['id','code','title','description']));
      if (action === 'list') return {scope, page: page(rows.map(row => pick(row, fields('id version customerId teamId code title dueDate status updatedAt canWrite'))), window)};
      const record = find(rows, id!);
      if (action === 'history') return {scope, projectId: id, page: page(collection(await read('/api/workspace/customer-project-history', {projectId: id!}), 'history').map(row => pick(row, fields('id action actor createdAt targetId'))), window)};
      const related = (key: string, keys: string[]) => page(collection(data, key).filter(row => row.projectId === id && row.customerId === record.customerId).map(row => pick(row, keys)), window);
      return {scope, record: pick(record, projectFields), items: related('items', fields('id version model customerModel drawing color lens material requirements quantity')),
        rounds: related('rounds', fields('id version title type stage status dueDate reason')), tasks: related('tasks', fields('id version title description ownerId dueDate status result canSubmit canReviewService canReviewSales')),
        communications: related('communications', fields('id version channel contact occurredAt content nextAction ownerId dueDate visibility'))};
    }
    if (resource === 'inquiries') {
      const data = await read('/api/workspace/process-data', {type: 'rfq'}), rows = collection(data, 'records');
      if (rows.some(row => row.type !== 'rfq')) return failResponse();
      const selected = rows.filter(row => matches(row, ['id','title','notes']));
      if (action === 'list') return {scope, page: page(selected.map(row => pick(row, fields('id version customerId orderId teamId title ownerId status gateStatus nextDueDate updatedAt canEdit'))), window)};
      const record = find(selected, id!);
      if (action === 'history') {
        const rows = collection(await read('/api/workspace/process-history', {id: id!}), 'history');
        if (rows.some(row => row.recordId !== id || row.snapshot?.id !== id || row.snapshot?.type !== 'rfq')) return failResponse();
        return {scope, inquiryId: id, page: page(rows.map(row => ({...pick(row, fields('id version action actor createdAt')), snapshot: inquiry(row.snapshot)})), window)};
      }
      return {scope, record: inquiry(record)};
    }
    if (action === 'export-completed') {
      if (team) {
        const directory = await read('/api/workspace/business-team-data');
        if (team !== '__ungrouped' && !collection(directory, 'teams').some(row => row.id === team)) throw new CliError('NOT_IN_SCOPE', '业务组不在当前可见范围。', 7);
      }
      const filename = path.resolve(options.output!);
      if (!filename.toLowerCase().endsWith('.xlsx')) throw new CliError('INVALID_ARGUMENT', '导出文件须使用 .xlsx 扩展名。', 2);
      // Refuse an existing destination before downloading, then use exclusive create.
      if (await fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new CliError('OUTPUT_EXISTS', '输出文件已存在，请提供新文件名。', 3);
      const bytes = await read('/api/workspace/customer-quote-completed-export');
      let file;
      try { file = await fs.open(filename, 'wx', 0o600); await file.writeFile(bytes); }
      catch (error) { throw new CliError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_WRITE_FAILED', '未能写入新导出文件，请检查目录和文件名；已有文件不会被覆盖。', 3); }
      finally { await file?.close(); }
      return {scope: {...scope, pagination: 'not-applicable', exportScope: 'all-authorized-completed-rows-in-team'}, file: {filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}};
    }
    const data = await read('/api/workspace/customer-quotes'), rows = collection(data, 'quotes').filter(row => matches(row, ['id','quoteNo','customerName','customerCode'], 'customerAccountId'));
    if (action === 'list') return {scope, page: page(rows.map(row => pick(row, fields('id version customerAccountId customerName customerCode quoteNo quoteDate validUntil currency status updatedAt canEdit canConfirm canRevise'))), window)};
    let record = find(rows, id!);
    if (action === 'history') return {scope, quoteId: id, page: page(collection(record, 'history').map(row => pick(row, fields('id version status action updatedAt updatedBy'))), window)};
    if (action === 'version') {
      const archived = object((await read('/api/workspace/customer-quote-version', {quoteId: id!, quoteVersion: rawVersion!})).quote);
      if (archived.id !== id || archived.version !== Number(rawVersion)) return failResponse();
      if (archived.customerAccountId !== record.customerAccountId) throw new CliError('NOT_IN_SCOPE', '跨客户改绑的历史版本暂不通过 CLI 展示，请使用网页核查。', 7);
      record = archived;
    }
    return {scope, projection: 'commercial-fields-without-internal-costs-or-source-formulas', record: pick(record, quoteFields), lines: page(collection(record, 'lines').map(row => pick(row, quoteLineFields)), window),
      terms: page(collection(record, 'terms').map(row => pick(row, fields('id labelZh labelEn zh en needsReview'))), window),
      charges: page(collection(record, 'customerCharges').map(row => pick(row, fields('id labelZh labelEn amount basisZh basisEn conditional needsReview'))), window)};
  }
}
