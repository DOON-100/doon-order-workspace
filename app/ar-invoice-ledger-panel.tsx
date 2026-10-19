'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {ArrowUpRight, CheckCircle2, Download, FileText, Paperclip, RefreshCw, Upload, X} from 'lucide-react';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import {request, dateTime} from './ui';
import {downloadBusinessTeamFile} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import './ar-invoice-ledger.css';

type Customer = {id: string; customer: string; customerCode: string};
type Invoice = {
  id: string; version: number; sourceVersion: number; customerId: string; batchId: string;
  invoiceNo: string; documentType: string; invoiceDate: string; currency: string;
  amountCents: number | null; receivedCents: number | null; balanceCents: number | null;
  sourceSheet: string; sourceCells: unknown; remarks: string; note: string; issues: string[];
  status: 'pending' | 'confirmed'; paymentStatus: 'pending' | 'unpaid' | 'partial' | 'paid';
  paymentRemark: string; proofCount: number;
};
type Attachment = {id: string; invoiceId?: string; batchId?: string; category: string; filename: string; size: number; hash?: string; note?: string};
type Statement = {
  id: string; customerId: string; currency: string; asOf: string; status: string;
  createdAt?: string; customerProfileSnapshot?: {version?: number};
  totals: {knownAmountCents: number; confirmedAmountCents: number; confirmedReceivedCents: number; confirmedBalanceCents: number; pendingCount: number; duplicateCount: number};
  issues: string[];
};
type Batch = {id: string; filename: string; sourceAsOf?: string; sourceCutoff?: number | string; issues?: string[]; statementRows?: unknown[]};
type Feed = {customers: Customer[]; invoices: Invoice[]; attachments: Attachment[]; batches: Batch[]; statements: Statement[]; canWrite: boolean};
type ImportManifest = {customerId?: string; sourceCutoff?: number | string; sourceAsOf?: string; invoices: Partial<Invoice>[]; statementRows: unknown[]; issues?: string[]; [key: string]: unknown};
type Editor = {invoice: Invoice; mode: 'details' | 'note' | 'proof' | 'reconcile'};

const paymentLabels = {pending: '未核对', unpaid: '未收款', partial: '部分收款', paid: '历史净应收已收'};
const pageSize = 20;
const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const money = (value: unknown, currency = '') => typeof value === 'number' && Number.isFinite(value)
  ? `${currency ? currency + ' ' : ''}${(value / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '待核对';
const textValue = (value: unknown): string => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const sourceCells = (value: unknown) => Array.isArray(value) ? value.map(textValue).join('、') : value && typeof value === 'object' ? Object.entries(value).map(([key, cell]) => `${key}: ${textValue(cell)}`).join('；') : textValue(value);
function decimalCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [integer, decimal = ''] = value.trim().split('.');
  const cents = Number(integer) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
function Status({invoice}: {invoice: Invoice}) {
  const state = invoice.status === 'pending' ? 'pending' : invoice.paymentStatus;
  return <span className={`ail-status ${state}`}>{paymentLabels[state] || '未核对'}</span>;
}

export function ArInvoiceLedgerPanel({data, onNavigate}: {data: {me?: {id?: string}; revision?: unknown}; onNavigate?: WorkspaceNavigate}) {
  const client = useQueryClient(), scope = useBusinessTeamScope(), teamId = scope?.teamId || '';
  const [customerId, setCustomerId] = useState(''), [currency, setCurrency] = useState(''), [status, setStatus] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [downloading, setDownloading] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null), [note, setNote] = useState(''), [proof, setProof] = useState<File | null>(null), [received, setReceived] = useState(''), [reason, setReason] = useState(''), [verified, setVerified] = useState(false);
  const [importOpen, setImportOpen] = useState(false), [manifest, setManifest] = useState<ImportManifest | null>(null), [manifestName, setManifestName] = useState(''), [workbook, setWorkbook] = useState<File | null>(null), [importVerified, setImportVerified] = useState(false);
  const [asOf, setAsOf] = useState(today), [statementCurrency, setStatementCurrency] = useState('USD');
  const inflight = useRef(false), retry = useRef<{key: string; token: string} | null>(null), importRead = useRef(0);
  const params = new URLSearchParams({customerId, teamId});
  const query = useQuery<Feed>({queryKey: ['ar-invoice-ledger', data.me?.id, teamId, customerId], queryFn: ({signal}) => request('ar-invoice-data?' + params, undefined, {signal})});
  const feed = query.data, canWrite = !!feed?.canWrite, invoices = feed?.invoices || [];
  const selectedCustomer = feed?.customers.find(customer => customer.id === customerId);
  const filtered = useMemo(() => invoices.filter(invoice => (!currency || invoice.currency === currency) && (!status || (invoice.status === 'pending' ? 'pending' : invoice.paymentStatus) === status) && (!search || [invoice.invoiceNo, invoice.sourceSheet, invoice.remarks, invoice.note, invoice.paymentRemark].join(' ').toLowerCase().includes(search.toLowerCase()))), [invoices, currency, status, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages - 1);
  const currencies = Array.from(new Set(invoices.map(invoice => invoice.currency).filter(Boolean))).sort();
  const customerLabel = (id: string) => {const customer = feed?.customers.find(item => item.id === id); return customer ? [customer.customerCode, customer.customer].filter(Boolean).join(' · ') : '客户待核对';};
  const currentInvoice = editor && invoices.find(invoice => invoice.id === editor.invoice.id);
  const editorStale = !!editor && (!currentInvoice || currentInvoice.version !== editor.invoice.version);
  useEffect(() => setPage(0), [customerId, currency, status, search, teamId]);

  async function mutate(action: string, body: Record<string, unknown> | FormData, key: string, success: string) {
    if (inflight.current || !canWrite) return false;
    inflight.current = true; setBusy(true); setError(''); setMessage('');
    if (retry.current?.key !== key) retry.current = {key, token: crypto.randomUUID()};
    try {
      if (body instanceof FormData) body.set('token', retry.current.token);
      await request(action, body instanceof FormData ? body : {...body, token: retry.current.token});
      retry.current = null;
      await Promise.all([client.invalidateQueries({queryKey: ['ar-invoice-ledger']}), client.invalidateQueries({queryKey: ['ar-workspace']})]);
      setMessage(success); return true;
    } catch (cause) {setError((cause as Error).message); return false;}
    finally {inflight.current = false; setBusy(false);}
  }
  function openInvoice(invoice: Invoice, mode: Editor['mode'] = 'details') {
    setEditor({invoice, mode}); setNote(mode === 'note' ? invoice.note || '' : ''); setProof(null); setReceived(''); setReason(''); setVerified(false); setError('');
  }
  async function download(action: string, id: string, filename: string) {
    if (downloading) return;
    setDownloading(true); setError('');
    try {await downloadBusinessTeamFile(`/api/workspace/${action}?id=${encodeURIComponent(id)}`, filename);}
    catch (cause) {setError((cause as Error).message);}
    finally {setDownloading(false);}
  }
  async function readManifest(file?: File) {
    const sequence = ++importRead.current;
    setManifest(null); setManifestName(''); setImportVerified(false); setError('');
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('导入清单不能超过 4 MB。');
      const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, '')) as ImportManifest;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.invoices) || !parsed.invoices.length || parsed.invoices.length > 200 || !Array.isArray(parsed.statementRows)) throw new Error('导入清单须包含 1–200 条发票记录及对账明细。请使用已核对的导入清单。');
      if (parsed.invoices.some(invoice => !invoice || typeof invoice !== 'object' || !invoice.invoiceNo || !invoice.sourceSheet)) throw new Error('导入清单中每张发票都须有发票号和来源工作表，不能缺少追溯依据。');
      if (sequence === importRead.current) {setManifest(parsed); setManifestName(file.name);}
    } catch (cause) {if (sequence === importRead.current) setError(cause instanceof SyntaxError ? '导入清单格式无法识别，请重新选择由历史总表整理的已核对导入清单。' : (cause as Error).message);}
  }
  async function importHistory() {
    if (!manifest || !workbook || !customerId || !importVerified) return;
    const body = new FormData(), submitted = {...manifest, customerId};
    body.set('file', workbook); body.set('manifest', JSON.stringify(submitted));
    const key = JSON.stringify({action: 'import', manifest: submitted, file: [workbook.name, workbook.size, workbook.lastModified]});
    if (await mutate('ar-invoice-import', body, key, '历史发票及原件已入档。请逐张核对金额、版本和历史实收，再生成对账单。')) {setImportOpen(false); setManifest(null); setManifestName(''); setWorkbook(null); setImportVerified(false);}
  }
  async function saveEditor() {
    if (!editor || editorStale) return;
    const invoice = editor.invoice;
    if (editor.mode === 'note') {
      const body = {id: invoice.id, version: invoice.version, note};
      if (await mutate('ar-invoice-note', body, JSON.stringify(body), '发票备注已保存。')) setEditor(null);
    } else if (editor.mode === 'proof' && proof) {
      const body = new FormData();
      body.set('invoiceId', invoice.id); body.set('version', String(invoice.version)); body.set('file', proof); body.set('note', note);
      const key = JSON.stringify({action: 'proof', id: invoice.id, version: invoice.version, note, file: [proof.name, proof.size, proof.lastModified]});
      if (await mutate('ar-invoice-proof', body, key, '付款凭证已归档；实收与核销金额保持原值。')) setEditor(null);
    } else if (editor.mode === 'reconcile') {
      const cents = decimalCents(received);
      if (cents === null || !verified || !reason.trim()) {setError('请填写最多两位小数的累计实收、核对依据，并确认金额与发票归属。'); return;}
      if (invoice.status === 'confirmed') {setError('当前版本已有历史核对记录。更正须保留原核对记录，请先核查差异。'); return;}
      if (invoice.amountCents == null || !invoice.currency || cents > invoice.amountCents) {setError('累计实收不能超过已明确的历史净应收；超收、金额或币种不明请先核对。'); return;}
      const body = {id: invoice.id, version: invoice.version, receivedCents: cents, reason: reason.trim()};
      if (await mutate('ar-invoice-reconcile', body, JSON.stringify(body), '历史实收已核对，发票收款备注及余额已刷新；未新增现金收款。')) setEditor(null);
    }
  }
  async function createStatement() {
    if (!customerId || !statementCurrency || !asOf) return;
    const body = {customerId, currency: statementCurrency, asOf};
    await mutate('ar-invoice-statement', body, JSON.stringify({action: 'statement', ...body}), 'STATEMENT 核对草稿已生成，可从下方快照下载。');
  }
  const attachmentButton = (attachment: Attachment) => <button type="button" className="ail-link" key={attachment.id} disabled={downloading} onClick={() => void download('ar-invoice-file', attachment.id, attachment.filename)}><Download size={13}/>{attachment.filename}</button>;

  return <section className="ail" aria-label="历史发票与客户对账单">
    <div className="ail-intro"><div><span className="ail-eyebrow">INVOICES / STATEMENT</span><h3>历史发票与客户对账</h3><p>保留每个发票版本、原表依据和付款凭证。核对完成后，已收款备注随历史实收自动更新。</p></div><FileText size={30}/></div>
    <ol className="ail-flow" aria-label="应收处理流程">{['历史导入', '核对金额与版本', '历史实收核销', '补付款凭证', '生成对账单'].map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
    <div className="ail-toolbar"><label>客户<select aria-label="历史发票客户" value={customerId} disabled={busy || !!editor || importOpen} onChange={event => {setCustomerId(event.target.value); setMessage('');}}><option value="">全部授权客户</option>{feed?.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.customerCode} · {customer.customer}</option>)}</select></label><button type="button" disabled={query.isFetching || busy} onClick={() => void query.refetch()}><RefreshCw size={15}/>刷新</button>{canWrite && <button type="button" className="ail-primary" disabled={!customerId || busy} onClick={() => {setImportOpen(true); setImportVerified(false); setError('');}}><Upload size={15}/>导入历史发票</button>}<span className="ail-access">{canWrite ? '管理员可维护' : '授权范围内查看'}</span></div>
    {error && <p className="ail-alert" role="alert">{error}</p>}{message && <p className="ail-success" role="status"><CheckCircle2 size={16}/>{message}</p>}
    {query.isPending ? <div className="ail-empty" role="status">正在读取发票档案和权限…</div> : query.isError ? <div className="ail-alert" role="alert">{(query.error as Error).message}<button onClick={() => void query.refetch()}>重新读取</button></div> : feed && <>
      <div className="ail-summary"><div><strong>{invoices.length}</strong><span>发票版本</span></div><div><strong>{invoices.filter(invoice => invoice.status === 'pending').length}</strong><span>尚未核对</span></div><div><strong>{invoices.filter(invoice => invoice.status === 'confirmed' && invoice.paymentStatus === 'paid').length}</strong><span>已收款版本</span></div><div><strong>{feed.statements.length}</strong><span>对账单快照</span></div></div>
      <div className="ail-note">历史净应收按本次对账范围列示；已收款仅表示该范围的应收已收，整张 PI / 订单的其余款项仍须核查。同号版本分别保留，未核对的实收与余额显示“待核对”，原表逐行余额不能直接作本票未收。</div>
      <div className="ail-filters"><label>币种<select aria-label="历史发票币种" value={currency} onChange={event => setCurrency(event.target.value)}><option value="">全部币种</option>{currencies.map(item => <option key={item}>{item}</option>)}</select></label><label>收款状态<select aria-label="历史发票收款状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="ail-search">查找发票<input aria-label="查找历史发票" placeholder="发票号、工作表或备注" value={search} onChange={event => setSearch(event.target.value)}/></label></div>
      <div className="ail-table-wrap"><table><thead><tr><th>发票 / 来源</th><th>历史净应收</th><th>已核对历史实收</th><th>历史未收</th><th>收款状态与备注</th><th>凭证 / 操作</th></tr></thead><tbody>{filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(invoice => <tr key={invoice.id}><td><b>{invoice.invoiceNo}</b><small>{!customerId && customerLabel(invoice.customerId) + ' · '}{invoice.documentType || '类型待核对'} · 源版本 {invoice.sourceVersion || 1}</small><small>{invoice.invoiceDate || '日期待核对'} · {invoice.sourceSheet}</small></td><td className="ail-money">{money(invoice.amountCents, invoice.currency)}</td><td className="ail-money">{money(invoice.status === 'pending' ? null : invoice.receivedCents, invoice.currency)}</td><td className="ail-money"><b>{money(invoice.status === 'pending' ? null : invoice.balanceCents, invoice.currency)}</b></td><td><Status invoice={invoice}/><small>{invoice.paymentRemark || '等待历史实收核对'}</small>{invoice.note && <small className="ail-user-note">{invoice.note}</small>}{invoice.issues?.length > 0 && <small className="ail-issue">{invoice.issues.length} 项待核查</small>}</td><td><div className="ail-row-actions"><button type="button" onClick={() => openInvoice(invoice)}>详情与来源</button>{canWrite && <button type="button" onClick={() => openInvoice(invoice, 'proof')}><Paperclip size={13}/>上传付款凭证</button>}</div><small>{invoice.proofCount || 0} 份付款凭证</small></td></tr>)}{!filtered.length && <tr><td colSpan={6}><div className="ail-empty">当前范围暂无发票。选择客户后，可上传已核对导入清单及原始工作簿。</div></td></tr>}</tbody></table></div>
      <div className="ail-pagination"><span>第 {currentPage + 1} / {pages} 页 · {filtered.length} 个版本</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
      {!!feed.batches?.length && <details className="ail-card"><summary>历史导入批次与原表依据 · {feed.batches.length} 批</summary><div className="ail-batches">{feed.batches.map(batch => <article key={batch.id}><b>{batch.filename}</b><p>发票截止号：{textValue(batch.sourceCutoff)} · 原表截止日：{batch.sourceAsOf || '未注明'} · 对账原始行：{batch.statementRows?.length || 0}</p>{batch.issues?.map((issue, index) => <p className="ail-issue" key={index}>{issue}</p>)}{feed.attachments.filter(attachment => attachment.category === 'source-workbook' && attachment.batchId === batch.id).map(attachmentButton)}</article>)}</div></details>}
      <section className="ail-card"><div className="ail-section-head"><div><h3>STATEMENT 客户对账单</h3><p>按客户、币种及截止日留存快照。含未核对或同号冲突的快照保留草稿提示，供核查后使用。</p></div></div><div className="ail-toolbar"><label>币种<select aria-label="对账单币种" value={statementCurrency} disabled={busy} onChange={event => setStatementCurrency(event.target.value)}>{Array.from(new Set(['USD', 'EUR', 'CNY', 'GBP', 'HKD', ...currencies])).map(item => <option key={item}>{item}</option>)}</select></label><label>对账截止日<input aria-label="对账截止日" type="date" value={asOf} disabled={busy} onChange={event => setAsOf(event.target.value)}/></label>{canWrite && <button type="button" className="ail-primary" disabled={busy || !customerId || !asOf} onClick={() => void createStatement()}><FileText size={15}/>生成 STATEMENT 草稿</button>}{!customerId && <span className="ail-muted">请先选择一个客户</span>}</div><div className="ail-statement-list">{feed.statements.length ? [...feed.statements].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(statement => <article key={statement.id}><div><b>{customerLabel(statement.customerId)}</b><p>{statement.currency} · 截至 {statement.asOf} · 核对草稿</p><p>生成时间：{statement.createdAt ? dateTime(statement.createdAt) : '未记录'} · {statement.customerProfileSnapshot?.version ? `客户模板第 ${statement.customerProfileSnapshot.version} 版` : '历史默认模板'}</p>{statement.totals?.confirmedAmountCents === 0 && statement.totals.pendingCount > 0 ? <p className="ail-issue">暂无可按截至日汇总的已核对金额，请查看快照核对事项。</p> : <p><b>已核对部分：</b>历史净应收 {money(statement.totals?.confirmedAmountCents, statement.currency)} · 历史实收 {money(statement.totals?.confirmedReceivedCents, statement.currency)} · 历史未收 {money(statement.totals?.confirmedBalanceCents, statement.currency)}</p>}<p className="ail-issue">{statement.totals?.pendingCount || 0} 个版本待核对 · {statement.totals?.duplicateCount || 0} 项同号冲突</p>{statement.issues?.length > 0 && <details><summary>查看快照核对事项</summary>{statement.issues.map((issue, index) => <p className="ail-issue" key={index}>{issue}</p>)}</details>}</div><button disabled={downloading} onClick={() => void download('ar-invoice-statement-file', statement.id, `STATEMENT_${statement.currency}_${statement.asOf}.html`)}><Download size={14}/>下载对账单 HTML</button></article>) : <p className="ail-muted">尚未生成对账单快照。</p>}</div></section>
      <div className="ail-next"><div><b>日后新增</b><p>新订单沿客户项目、订单 / PI、出货、应收和财务收款流程登记。历史核销只补录已发生事实；新增到账继续由现有财务入口记录。</p></div>{onNavigate && <button onClick={() => onNavigate('project-finance', customerId ? {customerId} : {})}>客户项目财务 <ArrowUpRight size={14}/></button>}</div>
    </>}

    {importOpen && <div className="ail-dialog-backdrop"><section className="ail-dialog" role="dialog" aria-modal="true" aria-labelledby="ail-import-title"><div className="ail-dialog-head"><div><h3 id="ail-import-title">导入历史发票</h3><p>{selectedCustomer ? customerLabel(selectedCustomer.id) : '请先选择客户'}</p></div><button aria-label="关闭历史导入" disabled={busy} onClick={() => setImportOpen(false)}><X size={18}/></button></div><p className="ail-note">请使用由历史总表整理的已核对导入清单，先核对预览，再与原始工作簿一同归档。清单归属当前选择的客户；原件、异常与全部版本完整保留。</p><label>1. 已核对导入清单<input type="file" accept=".json,application/json" disabled={busy} onChange={event => void readManifest(event.target.files?.[0])}/></label><label>2. 对应原始 Excel 工作簿<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event => {setWorkbook(event.target.files?.[0] || null); setImportVerified(false);}}/></label>{manifest && <div className="ail-import-preview"><b>预览：{manifestName}</b><p>{manifest.invoices.length} 个发票版本 · {manifest.statementRows.length} 条对账原始行 · 截止 {textValue(manifest.sourceCutoff)} 号 · {manifest.sourceAsOf || '原表日期未注明'}</p><div className="ail-preview-rows">{manifest.invoices.map((invoice, index) => <div key={index}><b>{invoice.invoiceNo}</b><span>{invoice.sourceSheet}</span><span>{money(invoice.amountCents, invoice.currency)}</span><span>{invoice.issues?.length || 0} 项异常</span></div>)}</div>{manifest.issues?.map((issue, index) => <p key={index} className="ail-issue">{issue}</p>)}<label className="ail-checkbox"><input type="checkbox" checked={importVerified} disabled={busy} onChange={event => setImportVerified(event.target.checked)}/>已核对客户、截止号、原件对应关系和全部发票版本；未确认的实收继续待核对。</label></div>}{error && <p className="ail-alert" role="alert">{error}</p>}<div className="ail-dialog-actions"><button disabled={busy} onClick={() => setImportOpen(false)}>取消</button><button className="ail-primary" disabled={busy || !canWrite || !manifest || !workbook || !customerId || !importVerified} onClick={() => void importHistory()}>{busy ? '正在导入…' : '确认导入历史发票'}</button></div></section></div>}

    {editor && <div className="ail-dialog-backdrop"><section className="ail-dialog" role="dialog" aria-modal="true" aria-labelledby="ail-invoice-title"><div className="ail-dialog-head"><div><h3 id="ail-invoice-title">{editor.invoice.invoiceNo}</h3><p>{customerLabel(editor.invoice.customerId)} · {editor.invoice.sourceSheet} · 源版本 {editor.invoice.sourceVersion || 1}</p></div><button aria-label="关闭发票详情" disabled={busy} onClick={() => setEditor(null)}><X size={18}/></button></div><div className="ail-detail-summary"><Status invoice={editor.invoice}/><span>历史净应收 {money(editor.invoice.amountCents, editor.invoice.currency)}</span><span>实收 {money(editor.invoice.status === 'pending' ? null : editor.invoice.receivedCents, editor.invoice.currency)}</span><span>未收 {money(editor.invoice.status === 'pending' ? null : editor.invoice.balanceCents, editor.invoice.currency)}</span></div><div className="ail-detail-source"><p><b>来源单元格：</b>{sourceCells(editor.invoice.sourceCells)}</p><p><b>原表备注：</b>{editor.invoice.remarks || '—'}</p><p><b>收款备注：</b>{editor.invoice.paymentRemark || '待核对'}</p><p><b>补充备注：</b>{editor.invoice.note || '—'}</p>{feed?.attachments.filter(attachment => attachment.category === 'source-workbook' && attachment.batchId === editor.invoice.batchId).map(attachmentButton)}</div>{editor.invoice.issues?.length > 0 && <div className="ail-note ail-warning"><b>需核查的原表事项</b>{editor.invoice.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}
      <div className="ail-proofs"><b>付款凭证</b>{feed?.attachments.filter(attachment => attachment.category === 'payment-proof' && attachment.invoiceId === editor.invoice.id).map(attachment => <div key={attachment.id}>{attachmentButton(attachment)}{attachment.note && <small>{attachment.note}</small>}</div>)}{!feed?.attachments.some(attachment => attachment.category === 'payment-proof' && attachment.invoiceId === editor.invoice.id) && <p className="ail-muted">尚未上传付款凭证。</p>}</div>
      {canWrite && <div className="ail-editor-tabs" aria-label="发票维护操作">{([['details', '查看详情'], ['note', '修改备注'], ['proof', '上传付款凭证'], ['reconcile', '核对历史实收']] as const).map(([mode, label]) => <button key={mode} disabled={busy || (mode === 'reconcile' && editor.invoice.status === 'confirmed')} aria-pressed={editor.mode === mode} className={editor.mode === mode ? 'active' : ''} onClick={() => openInvoice(editor.invoice, mode)}>{label}</button>)}</div>}
      {editor.mode === 'note' && <label>发票补充备注<textarea value={note} maxLength={4000} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="补充客户对账、差异处理或凭证情况；收款状态由核销金额生成。"/></label>}
      {editor.mode === 'proof' && <><p className="ail-note">附件仅作为付款依据补证，上传不会新增实收或修改余额。请核对该凭证确实对应当前发票。</p><label>付款凭证文件（PDF、图片或 XLSX，最大 20 MB）<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx" disabled={busy} onChange={event => setProof(event.target.files?.[0] || null)}/></label><label>凭证说明<textarea value={note} maxLength={2000} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="例如银行回单日期、付款批次、该发票分配依据"/></label></>}
      {editor.mode === 'reconcile' && <><p className="ail-note ail-warning">仅核对历史对账单已发生的累计实收，不新增现金收款。合并付款、跨票分配及原表公式异常须先明确归属。这里填写该发票累计实收，每个版本仅确认一次；后续更正须保留原核对记录。</p>{(editor.invoice.amountCents == null || !editor.invoice.currency) && <p className="ail-alert">历史净应收或币种尚不明确，暂不能核销。请先核对原表。</p>}<label>本发票累计实收（{editor.invoice.currency || '币种待核对'}）<input inputMode="decimal" value={received} disabled={busy || editor.invoice.amountCents == null || !editor.invoice.currency || editor.invoice.status === 'confirmed'} onChange={event => {setReceived(event.target.value); setVerified(false);}} placeholder="手工填写，例如 1234.50；未收填 0"/></label><label>核对依据与分配说明<textarea value={reason} maxLength={4000} disabled={busy} onChange={event => {setReason(event.target.value); setVerified(false);}} placeholder="请写明对账单工作表 / 单元格、实收日期、归属该发票的依据及差异处理。"/></label><label className="ail-checkbox"><input type="checkbox" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)}/>已核对当前发票金额、有效版本与付款归属，不将客户累计余额直接记为本票实收。</label></>}
      {editorStale && <p className="ail-alert" role="alert">记录已更新或离开当前授权范围。请关闭并重新打开详情后维护。</p>}{error && <p className="ail-alert" role="alert">{error}</p>}<div className="ail-dialog-actions"><button disabled={busy} onClick={() => setEditor(null)}>关闭</button>{canWrite && editor.mode !== 'details' && <button className="ail-primary" disabled={busy || editorStale || (editor.mode === 'proof' && !proof) || (editor.mode === 'reconcile' && (!verified || !reason.trim() || decimalCents(received) === null || editor.invoice.amountCents == null || !editor.invoice.currency || editor.invoice.status === 'confirmed'))} onClick={() => void saveEditor()}>{busy ? '正在保存…' : editor.mode === 'proof' ? '保存付款凭证' : editor.mode === 'reconcile' ? '确认历史实收核对' : '保存备注'}</button>}</div>
    </section></div>}
  </section>;
}
