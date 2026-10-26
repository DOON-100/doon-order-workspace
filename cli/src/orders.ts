import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {collection, object, pick, fields, identifier, pagination, page, find, failResponse, newXlsxPath, writeNewXlsx, type Row} from './business.js';
import type {Route} from './routes.js';

export type OrderResource = 'orders' | 'sources' | 'pi' | 'documents' | 'production-orders';
export type OrderAction = 'list' | 'show' | 'history' | 'version' | 'export';
export type OrderOptions = {team?: string; customerCode?: string; customer?: string; order?: string; type?: string; search?: string; limit?: string; offset?: string; output?: string};
const documentTypes = ['pi','invoice','packing','waybill','paymentrequest'];
const orderSummaryFields = fields('id version orderNo customer customerPO drawing color lens batch quantity requestedDate promisedDate promiseConfirmed stage workflowStatus lifecycle archivedAt closedDate archiveReason updatedAt');
const businessFields = fields('id kind type version number customerId projectId orderId status createdAt updatedAt updatedBy sourceChanged changedSourceIds canWrite canConfirm');
const commercialFields = fields('date currency buyer seller billingAddress shippingAddress shippingContact shippingPhone paymentTerms depositPercent tradeTerms paymentDueDate delivery reference notes templateLabel manualBasis');
const productionFields = fields('style dueDate pmcId requirements materials depositPercent receivableId depositEvidence engineeringTaskId materialState purchaseState materialDue plannedStart progressNote confirmedBy notes');

// Fixed queries only. A sales source is evidence, and production handoff material is not a released production order.
export class OrderService {
  constructor(private store: StateStore, private transport: typeof fetch = fetch) {}

  async execute(resource: OrderResource, action: OrderAction, options: OrderOptions = {}, rawId?: string, rawVersion?: string) {
    const allowed = {orders: ['list','show'], sources: ['list','show','export'], pi: ['list','show','history','version'], documents: ['list','show','history','version'], 'production-orders': ['list','show','history']};
    if (!Object.hasOwn(allowed, resource) || !allowed[resource].includes(action)) throw new CliError('UNSUPPORTED_OPERATION', '该业务命令尚未开放。', 2);
    const team = identifier(options.team, '业务组'), customer = identifier(options.customer, '客户'), customerCode = identifier(options.customerCode, '原单客户原值'), order = identifier(options.order, '订单');
    const id = identifier(rawId, '记录', action !== 'list'), window = pagination(options), search = options.search?.trim() || '';
    if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search) || action !== 'list' && search) throw new CliError('INVALID_ARGUMENT', '搜索仅用于列表，最多 200 个字符。', 2);
    if (['orders','sources'].includes(resource) ? customer || order || options.type : customerCode) throw new CliError('INVALID_ARGUMENT', '筛选参数与此资源不匹配。', 2);
    if (options.type && (resource !== 'documents' || !documentTypes.includes(options.type))) throw new CliError('INVALID_ARGUMENT', '单据类型须为 pi/invoice/packing/waybill/paymentrequest。', 2);
    if (action === 'export' && (!options.output || options.limit || options.offset || search)) throw new CliError('INVALID_ARGUMENT', '导出须指定新 output，不支持分页或搜索。', 2);
    if (action === 'version' && (!rawVersion || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)))) throw new CliError('INVALID_ARGUMENT', '单据版本须为正整数。', 2);
    const scope = {teamId: team || null, customerId: customer || null, customerCode: customerCode || null, orderId: order || null, type: resource === 'pi' ? 'pi' : resource === 'production-orders' ? 'production_order' : options.type || null, search: search || null, pagination: 'client', authorization: 'current-server-permissions', teamFilter: team ? resource === 'sources' ? 'server-vary-contract' : 'server-list-guard' : 'all-authorized'};
    const config = await this.store.config(), saved = await this.store.session(config);
    if (!saved) throw new CliError('AUTH_REQUIRED', '请先运行 doon login。', 4);
    const api = new ApiClient(config, this.transport, 30000);
    const read = async (route: Route, query?: Record<string, string>) => {
      try {
        const {data, headers} = await api.request(route, saved, undefined, {team, query});
        if (team && ['/api/workspace/data','/api/workspace/handoff-business-data'].includes(route) && data?.businessTeamScope?.teamId !== team) throw new CliError('SCOPE_NOT_CONFIRMED', '服务器未确认所选业务组范围，请核对服务器版本。', 5);
        // Source API uses a different existing contract: authorization + team filtering and a Vary header, no JSON scope echo.
        if (team && route === '/api/workspace/sales-order-sources-data' && !headers.get('vary')?.toLowerCase().split(',').map(v => v.trim()).includes('x-workspace-team')) throw new CliError('SCOPE_NOT_CONFIRMED', '服务器未声明销售原单业务组筛选协议，请核对版本。', 5);
        return data;
      } catch (error) { if (error instanceof CliError && error.code === 'AUTH_REQUIRED') await this.store.clearSession(); throw error; }
    };
    const textMatches = (row: Row, keys: string[]) => !search || keys.some(key => typeof row[key] === 'string' && row[key].toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    if (resource === 'orders') {
      const data = await read('/api/workspace/data');
      const rows = collection(data, 'orders').filter(row => (!customerCode || row.customer === customerCode) && textMatches(row, ['id','orderNo','customerPO','customer','drawing','color']));
      if (action === 'list') return {scope, page: page(rows.map(row => pick(row, orderSummaryFields)), window)};
      const record = find(rows, id!);
      // Generic audits are truncated by the server; do not label them a complete order history.
      return {scope, projection: 'order-fields-without-ledger-raw-columns-or-credentials', historyAvailability: 'not-implemented-server-audit-feed-is-truncated',
        record: pick(record, [...orderSummaryFields, ...fields('createdAt updatedBy plannedDate shipDate customerNote arrangement notes productCode productType specialRequirements sourceStatus materialStatus scheduleStatus productionStartDate productionFinishDate exceptionReason')]),
        comments: page(collection(data, 'comments').filter(row => row.lineId === id).map(row => pick(row, fields('id text dueDate done actor createdAt completedBy completedAt'))), window),
        attachments: page(collection(data, 'attachments').filter(row => row.lineId === id).map(row => pick(row, fields('id filename contentType size createdAt actor note'))), window)};
    }
    if (resource === 'sources') {
      const filename = action === 'export' ? await newXlsxPath(options.output) : undefined;
      const data = await read('/api/workspace/sales-order-sources-data');
      const rows = collection(data, 'items').filter(row => (!customerCode || row.customer === customerCode) && textMatches(row, ['id','orderNo','customer']));
      if (action === 'list') return {scope, page: page(rows.map(row => pick(row, fields('id version status customer orderNo createdAt'))), window)};
      const record = find(rows, id!);
      if (action === 'export') return {scope: {...scope, pagination: 'not-applicable'}, sourceId: id, file: await writeNewXlsx(filename!, await read('/api/workspace/sales-order-sources-export', {id: id!}))};
      const source = object(record.source);
      return {scope, projection: 'source-evidence-without-raw-formulas', record: pick(record, fields('id version status customer orderNo createdAt contentFingerprint')),
        source: {...pick(source, fields('schemaVersion orderNo customer productType customerPO documentType dictionaryVersion dictionarySha256 warnings')), evidence: pick(source.source, fields('filename sha256 sheet detailRange'))},
        lines: page(collection(source, 'lines').map(row => ({...pick(row, fields('id sourceRow drawing model color sku quantity unit sampleQuantity unitPrice deliveryText notes')),
          colorFields: this.slots(row.colorFields, fields('sourceColumn sourceLabel sourceCell value status standardZh standardEn qualifier candidates')),
          rawFields: this.slots(row.rawFields, fields('column label cell value sourceAnchor sourceRange hidden'))})), window)};
    }
    const data = await read('/api/workspace/handoff-business-data');
    const accepts = (row: Row) => resource === 'production-orders' ? row.kind === 'handoff_business_source' && row.type === 'production_order' : row.kind === 'handoff_business_document' && (resource === 'pi' ? row.type === 'pi' : documentTypes.includes(row.type) && (!options.type || row.type === options.type));
    const rows = collection(data, 'items').filter(row => accepts(row) && (!customer || row.customerId === customer) && (!order || row.orderId === order) && textMatches(row, ['id','number','status']));
    if (action === 'list') return {scope, page: page(rows.map(row => pick(row, businessFields)), window)};
    const current = find(rows, id!);
    const projection = 'business-fields-without-paths-courier-accounts-or-raw-source-snapshots';
    if (action === 'show') return {scope, projection, ...this.document(current, window)};
    const history = collection(await read('/api/workspace/handoff-business-history', {id: id!}), 'history');
    const valid = (row: Row) => {
      const snapshot = object(row.snapshot);
      // Prevent a direct history response from escaping the currently selected resource/customer/order context.
      if (row.recordId !== id || row.customerId !== current.customerId || snapshot.id !== id || snapshot.customerId !== current.customerId || snapshot.orderId !== current.orderId || snapshot.projectId !== current.projectId || snapshot.kind !== current.kind || snapshot.type !== current.type || row.version !== snapshot.version || !accepts(snapshot)) return failResponse();
      return snapshot;
    };
    history.forEach(valid);
    if (action === 'history') return {scope, projection: 'history-summary-without-raw-snapshots', recordId: id,
      page: page(history.map(row => ({...pick(row, fields('id version action actor createdAt')), status: valid(row).status})), window)};
    // The server authorizes historical snapshots. No local cached copy or print/download endpoint is used.
    const archived = history.find(row => row.version === Number(rawVersion));
    if (!archived && current.version !== Number(rawVersion)) throw new CliError('NOT_FOUND', '此单据版本不存在或当前无权读取。', 7);
    return {scope, projection, historical: Number(rawVersion) !== current.version, ...this.document(archived ? valid(archived) : current, window)};
  }

  private slots(value: any, keys: string[]) {
    if (!Array.isArray(value)) return failResponse();
    return value.map(row => pick(row, keys));
  }
  private document(row: Row, window: {limit: number; offset: number}) {
    if (!Array.isArray(row.lines)) return failResponse();
    return {record: {...pick(row, businessFields), fields: pick(row.fields, row.type === 'production_order' ? productionFields : commercialFields)},
      lines: page(row.lines.map((line: Row) => pick(line, fields('orderLineId description quantity unitPrice'))), window),
      sourceReferences: page(collection(row,'sourceRefs').map(ref => pick(ref,fields('id version'))),window),
      originReferences: page(collection({refs:row.originRefs || []},'refs').map(ref => pick(ref,fields('id kind version'))),window)};
  }
}
