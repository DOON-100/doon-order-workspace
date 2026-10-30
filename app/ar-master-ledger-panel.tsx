'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {AlertTriangle, ArrowUpRight, Check, ClipboardList, Download, Link2, RefreshCw, Save, Search, Unlink, X} from 'lucide-react';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import {request} from './ui';
import {clientId} from '@/lib/client-id';
import {downloadBusinessTeamFile} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import './ar-master-ledger.css';

type Customer = {id: string; customer: string; customerCode: string};
type Team = {id: string; name: string; active?: boolean};
type Relation = 'origin' | 'same_receivable';
type Candidate = {kind: string; id: string; version: number; label: string; view: string; orderId?: string; projectId?: string; orderNo?: string; projectNo?: string; relations: Relation[]};
type TraceLink = {id: string; relation: Relation; targetKind: string; targetId: string; targetVersion: number; targetSnapshot: Candidate | null; status: 'active' | 'cancelled'; targetChanged?: boolean; targetUnavailable?: boolean; reason?: string; cancelEvents?: {reason?: string}[]};
type Source = {
  id?: string; kind?: string; currency?: string; title?: string; customerLabel?: string; originalAmountDecimal?: string | null; paymentTermsRaw?: string; invoiceDateRaw?: string;
  dueDateRaw?: string; remarkRaw?: string; poPlRaw?: string; sourceSheet?: string; sourceRow?: number | null;
  source?: {fileName?: string; filePath?: string; fileSha256?: string; sheet?: string; rowNumber?: number; range?: string};
  sourceCells?: Record<string, unknown>;
};
type InvoiceSource = {id: string; invoiceNo?: string; sourceVersion?: number; version?: number; sourceSheet?: string; invoiceDate?: string; currency?: string; amountCents?: number | null; receivedCents?: number | null; balanceCents?: number | null; status?: string; paymentRemark?: string; remarks?: string; issues?: string[]};
type Entry = {
  id: string; version: number; sourceId: string; sourceHash: string; sourceSnapshot: Source; customerId: string; customer: string; customerCode: string;
  teamId: string; teamName: string; currency: string; amountBasis: 'unknown' | 'gross_receivable' | 'opening_balance'; asOf: string | null;
  amountCents: number | null; receivedCents: number | null; balanceCents: number | null; reviewStatus: 'pending' | 'confirmed'; note?: string;
  links: TraceLink[]; issues: string[]; sourceIssues?: string[]; sourceChanged: boolean; sourceAmountExactCents?: number | null;
  sourceAmountIssue?: string; includedInTotals: boolean; linkedAmounts?: {currency: string; amountCents: number | null; receivedCents: number | null; balanceCents: number | null; status: string; dueDate: string; sourceKind: string; sourceId: string; canonicalKey: string} | null;
  sourceKind?: string; sourceSnapshots?: InvoiceSource[]; additionalSources?: Source[];
  historicalAmounts?: {invoiceId: string; amountCents: number | null; receivedCents: number | null; balanceCents: number | null; sourceAsOf: string | null; currency?: string; paymentStatus: string; paymentRemark: string} | null;
};
type Totals = {knownReceivableCents: number; knownReceivedCents: number; knownBalanceCents: number; unknownReceivableCount: number; unknownReceivedCount: number; unknownBalanceCount: number; includedCount: number; excludedLinkedCount: number; asOfDates: string[]; mixedAsOf: boolean};
type Feed = {
  rows: Entry[]; customers: Customer[]; teams: Team[]; candidates: Candidate[]; legacySources: Source[];
  registration: {sourceIds: string[]; previewHash: string; invoiceCustomerIds: string[]; entryCount: number; legacyEntryCount: number; invoiceGroupCount: number; overlapCount: number; existingEntryCount: number; newEntryCount: number}; totalsByCurrency: Record<string, Totals>;
  counts: {registeredCount: number; pendingCount: number; confirmedCount: number; linkedCount: number; sourceChangedCount: number; unregisteredCount: number; negativeSourceCount: number; precisionIssueCount: number; unknownAsOfCount: number};
  canWrite: boolean; scope?: {canExport?: boolean}; boundary?: string;
};
type Draft = {customerId: string; teamId: string; currency: string; amountBasis: Entry['amountBasis']; asOf: string; amount: string; received: string; balance: string; reviewStatus: Entry['reviewStatus']; note: string; reason: string};
const kinds: Record<string, string> = {order: '原订单', handoff_business_document: '订单 / PI', service_record: '客服应收', project_charge: '项目应收', project_billing_document: '项目单据', customer_project: '客户项目', ar_invoice: '历史发票'};
const relationLabels: Record<Relation, string> = {origin: '原业务追踪', same_receivable: '同一笔应收（避免重复计账）'};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plain = (value: unknown) => value == null || value === '' ? '待补' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const centsText = (value: number | null) => value == null ? '' : `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
const displayDecimal = (value: string | null | undefined) => {
  if (value == null || !value.trim()) return '待补';
  const match = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] == null ? '' : '.' + match[3]}` : value;
};
const money = (value: number | null | undefined) => value == null ? '待补' : displayDecimal(centsText(value));
const draftOf = (row: Entry): Draft => ({customerId: row.customerId || '', teamId: row.teamId || '', currency: row.currency || '', amountBasis: row.amountBasis || 'unknown', asOf: row.asOf || '', amount: centsText(row.amountCents), received: centsText(row.receivedCents), balance: centsText(row.balanceCents), reviewStatus: row.reviewStatus, note: row.note || '', reason: ''});
const rowIssues = (row: Entry) => [...new Set([...(row.issues || []), ...(row.sourceIssues || []), ...(row.sourceAmountIssue ? [row.sourceAmountIssue] : []), ...(row.sourceChanged ? ['原来源已变更，请重新核对依据。'] : [])])];
const activeLinks = (row: Entry) => (row.links || []).filter(link => link.status === 'active');
const sourcePosition = (source: Source) => `${source.sourceSheet || source.source?.sheet || '工作表待补'} · 第 ${source.sourceRow ?? source.source?.rowNumber ?? '待补'} 行`;
const originalCustomerCode = (row: Entry) => row.sourceSnapshot.customerLabel?.trim().normalize('NFKC').toUpperCase() || '';
const sourceKnown = (row: Entry) => row.sourceKind === 'ar_invoice_group' ? row.historicalAmounts?.amountCents != null || row.sourceSnapshots?.some(source => source.amountCents != null) : row.sourceSnapshot.originalAmountDecimal != null && row.sourceSnapshot.originalAmountDecimal.trim() !== '';

function SourceAmount({row}: {row: Entry}) {
  if (row.sourceKind !== 'ar_invoice_group') return <><b title={row.sourceSnapshot.originalAmountDecimal || '原表未填写'}>{displayDecimal(row.sourceSnapshot.originalAmountDecimal)}</b>{/^-/u.test(row.sourceSnapshot.originalAmountDecimal || '') && <small>贷项 / 扣项</small>}{row.sourceAmountIssue && <small className="aml-issue">{row.sourceAmountIssue}</small>}</>;
  const versions = row.sourceSnapshots || [], known = row.historicalAmounts?.amountCents ?? (versions.length === 1 ? versions[0].amountCents : null);
  return <><b>{known == null && versions.length > 1 ? '多个来源版本' : money(known)}</b><small>发票历史净应收 · {versions.length} 个原始版本</small>{(row.additionalSources || []).map((source, index) => <small key={source.id || index}>另保留总表来源：{source.currency || row.currency} {displayDecimal(source.originalAmountDecimal)} · {sourcePosition(source)}</small>)}</>;
}

function AmountEvidence({row, field}: {row: Entry; field: 'receivedCents' | 'balanceCents'}) {
  const historical = row.historicalAmounts, value = row[field], label = field === 'receivedCents' ? '实收' : '未收';
  if (value != null) return <><b>{money(value)}</b><small>总表{row.reviewStatus === 'confirmed' ? '已核实' : '待核实'} · {row.asOf ? `截至 ${row.asOf}` : '截至日待补'}</small>{historical && <small>历史已核对{label}：{money(historical[field])}{historical.sourceAsOf ? `（截至 ${historical.sourceAsOf}）` : '（截至日未明）'}</small>}</>;
  if (historical && historical[field] != null) return <><b>{money(historical[field])}</b><small>历史已核对{label}{historical.sourceAsOf ? `（截至 ${historical.sourceAsOf}）` : '（截至日未明）'}</small><small>总表核定金额：待补</small></>;
  return <><b>待补</b><small>{row.sourceKind === 'ar_invoice_group' ? '来源尚无唯一已核对版本' : '总表金额待核实'}</small></>;
}

function InvoiceVersions({row, disabled, onOpenSource}: {row: Entry; disabled: boolean; onOpenSource: (source: Candidate) => void}) {
  const history = row.historicalAmounts;
  return <section className="aml-source"><h4>发票原始版本与历史核对依据</h4>
    {history ? <div className="aml-history-fact"><b>唯一已核对历史版本</b><p>{history.currency || row.currency} · 历史净应收 {money(history.amountCents)} · 历史已核对实收 {money(history.receivedCents)} · 历史未收 {money(history.balanceCents)}</p><p>{history.sourceAsOf ? `原依据截至 ${history.sourceAsOf}` : '原依据截至日未明，不计作当前余额。'} {history.paymentRemark}</p></div> : <p className="aml-muted">尚无唯一已核对历史版本。以下版本逐一保留，不代替财务选择有效金额。</p>}
    <div className="ar-table-wrap"><ExcelTable><thead><tr><th>发票 / 源版本</th><th>来源 / 日期</th><th>历史净应收</th><th>历史核对状态</th><th>原备注与异常</th><th>原发票</th></tr></thead><tbody>{(row.sourceSnapshots || []).map((source, index) => <tr key={source.id || index}><td><b>{source.invoiceNo || '票号待补'}</b><small>源版本 {source.sourceVersion || index + 1}</small></td><td>{source.sourceSheet || '工作表待补'}<small>{source.invoiceDate || '日期待补'}</small></td><td>{source.currency || row.currency} {money(source.amountCents)}</td><td>{source.status === 'confirmed' ? '历史已核对' : '待核对'}{source.status === 'confirmed' && <><small>实收 {money(source.id === history?.invoiceId ? history.receivedCents : source.receivedCents)}</small><small>未收 {money(source.id === history?.invoiceId ? history.balanceCents : source.balanceCents)}</small></>}</td><td><span className="aml-raw-text">{source.remarks || source.paymentRemark || '—'}</span>{source.issues?.map((issue, issueIndex) => <small className="aml-issue" key={issueIndex}>{issue}</small>)}</td><td><button disabled={disabled || !source.id} onClick={() => onOpenSource({kind: 'ar_invoice', id: source.id, label: source.invoiceNo || '历史发票', version: source.version || 1, view: 'ar-workspace', relations: ['origin']})}>查看原发票 <ArrowUpRight size={13}/></button></td></tr>)}</tbody></ExcelTable></div>
    <p>历史净应收可能仅对应 PI 订金或分期，不代表整张订单货值或全订单结清。原件与付款凭证可在“发票与对账单”页查看。</p>
  </section>;
}

function LegacySource({source, currency, additional = false}: {source: Source; currency: string; additional?: boolean}) {
  return <section className="aml-source"><h4>{additional ? '合并保留的历史总表来源' : '原表依据'} · 只读保留</h4>
    <div className="aml-source-grid"><div><span>原表金额</span><b className="aml-exact">{source.currency || currency || '币种待补'} {displayDecimal(source.originalAmountDecimal)}</b></div><div><span>原付款条件</span><b>{source.paymentTermsRaw || '待补'}</b></div><div><span>原发票日期 / 到期日</span><b>{source.invoiceDateRaw || '待补'} / {source.dueDateRaw || '待补'}</b></div><div><span>原 PO / PL</span><b>{source.poPlRaw || '未结构化登记；备注只作线索'}</b></div></div>
    <p><b>原备注：</b>{source.remarkRaw || '未填写'}</p><p>{sourcePosition(source)}</p>
    <details><summary>查看文件与单元格依据</summary><p>文件：{source.source?.fileName || '原文件名未提供'}</p><p>{sourcePosition(source)}{source.source?.range ? ` · ${source.source.range}` : ''}</p>{source.source?.filePath && <p className="aml-wrap">原存放位置：{source.source.filePath}</p>}<p className="aml-wrap">原文件校验值：{source.source?.fileSha256 || '未提供'}</p><p>当前保留原表摘录；原文件尚无在线下载入口。</p>{source.sourceCells && <div className="aml-source-cells">{Object.entries(source.sourceCells).map(([key, value]) => <p key={key}><b>{key}</b> {plain(value)}</p>)}</div>}</details>
  </section>;
}

/** Keep the imported decimal precision; these totals are source facts, never confirmed balances. */
function sourceTotals(rows: Entry[]) {
  const buckets = new Map<string, {values: {units: bigint; scale: number}[]; missing: number; negative: number; precise: number}>();
  const sources = rows.flatMap(row => [...(row.sourceKind === 'ar_invoice_group' ? [] : [{source: row.sourceSnapshot, currency: row.sourceSnapshot.currency || row.currency}]), ...(row.additionalSources || []).map(source => ({source, currency: source.currency || row.currency}))]);
  for (const {source, currency: sourceCurrency} of sources) {
    const currency = sourceCurrency || '币种待补', bucket = buckets.get(currency) || {values: [], missing: 0, negative: 0, precise: 0};
    const raw = source.originalAmountDecimal?.trim() || '', match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) bucket.missing++;
    else {
      const fraction = match[3] || '', units = BigInt((match[1] === '-' ? '-' : '') + match[2] + fraction);
      bucket.values.push({units, scale: fraction.length});
      if (units < BigInt(0)) bucket.negative++;
      if (/[1-9]/u.test(fraction.slice(2))) bucket.precise++;
    }
    buckets.set(currency, bucket);
  }
  return [...buckets].map(([currency, bucket]) => {
    const scale = Math.max(2, ...bucket.values.map(value => value.scale));
    const sum = bucket.values.reduce((total, value) => total + value.units * BigInt(10) ** BigInt(scale - value.scale), BigInt(0));
    const digits = (sum < BigInt(0) ? -sum : sum).toString().padStart(scale + 1, '0');
    return {currency, known: bucket.values.length, missing: bucket.missing, negative: bucket.negative, precise: bucket.precise, decimal: `${sum < BigInt(0) ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`};
  });
}

function parseCents(value: string, label: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`${label}请填写最多两位小数；空白保留待补，贷项或扣项保留负号。`);
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const units = (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))) * BigInt(text.startsWith('-') ? -1 : 1);
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`${label}超出可登记范围。`);
  return Number(units);
}

export function ArMasterLedgerPanel({data, onNavigate, onDirtyChange}: {data: {me?: {id?: string}}; onNavigate: WorkspaceNavigate; onDirtyChange?: (dirty: boolean) => void}) {
  const client = useQueryClient(), scope = useBusinessTeamScope(), teamId = scope?.teamId || '';
  const [customerId, setCustomerId] = useState(''), [search, setSearch] = useState(''), [completeness, setCompleteness] = useState(''), [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(''), [baseline, setBaseline] = useState<Entry | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [verified, setVerified] = useState(false), [target, setTarget] = useState(''), [relation, setRelation] = useState<Relation>('origin'), [linkReason, setLinkReason] = useState('');
  const [cancelLinkId, setCancelLinkId] = useState(''), [registerOpen, setRegisterOpen] = useState(false), [registration, setRegistration] = useState<Feed['registration'] | null>(null), [registerVerified, setRegisterVerified] = useState(false);
  const [busy, setBusy] = useState(false), [downloading, setDownloading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const inflight = useRef(false), retry = useRef<{key: string; token: string} | null>(null), dirtyRef = useRef(false);
  const params = new URLSearchParams({teamId});
  const query = useQuery<Feed>({queryKey: ['ar-master-ledger', data.me?.id, teamId], queryFn: ({signal}) => request('ar-master-data?' + params, undefined, {signal})});
  const detailQuery = useQuery<Feed>({queryKey: ['ar-master-entry', data.me?.id, teamId, selectedId], queryFn: ({signal}) => request('ar-master-data?' + new URLSearchParams({teamId, id: selectedId}), undefined, {signal}), enabled: !!selectedId});
  const feed = query.data, current = detailQuery.data?.rows.find(row => row.id === selectedId), canWrite = !!feed?.canWrite && (!selectedId || !!detailQuery.data?.canWrite);
  const dirty = (!!draft && !!baseline && !equal(draft, draftOf(baseline))) || verified || !!target || !!linkReason.trim() || !!cancelLinkId || registerVerified;
  dirtyRef.current = dirty;
  const stale = !!baseline && !detailQuery.isPending && (!current || current.sourceChanged || current.version !== baseline.version || current.sourceHash !== baseline.sourceHash);
  const choices = detailQuery.data?.candidates.filter(candidate => candidate.label && candidate.label !== candidate.id) || [];
  const chosen = choices.find(candidate => `${candidate.kind}:${candidate.id}` === target);
  const rows = feed?.rows || [];
  const customerRows = useMemo(() => rows.filter(row => {
    if (!customerId) return true;
    if (customerId.startsWith('raw:')) return originalCustomerCode(row) === customerId.slice(4);
    const selected = feed?.customers.find(customer => `id:${customer.id}` === customerId);
    return !!selected && (row.customerId === selected.id || (!!selected.customerCode && originalCustomerCode(row) === selected.customerCode.toUpperCase()));
  }), [rows, customerId, feed?.customers]);
  const totals = useMemo(() => sourceTotals(customerRows), [customerRows]);
  const originalCustomerCodes = [...new Set(rows.map(originalCustomerCode).filter(Boolean))].sort();
  const baseRows = useMemo(() => customerRows.filter(row => {
    const issues = rowIssues(row), raw = row.sourceSnapshot;
    if (completeness === 'pending' && row.reviewStatus !== 'pending') return false;
    if (completeness === 'confirmed' && row.reviewStatus !== 'confirmed') return false;
    if (completeness === 'missing-amount' && sourceKnown(row)) return false;
    if (completeness === 'invoice' && row.sourceKind !== 'ar_invoice_group') return false;
    if (completeness === 'legacy' && row.sourceKind === 'ar_invoice_group') return false;
    if (completeness === 'unlinked' && activeLinks(row).length) return false;
    if (completeness === 'issues' && !issues.length) return false;
    return !search || [row.customer, row.customerCode, raw.customerLabel, raw.title, raw.poPlRaw, raw.remarkRaw, raw.paymentTermsRaw, row.teamName, ...activeLinks(row).map(link => link.targetSnapshot?.label || '')].join(' ').toLowerCase().includes(search.trim().toLowerCase());
  }), [customerRows, search, completeness]);
  const columnModel=useExcelColumnFilters(baseRows,row=>{
    const source=row.sourceSnapshot,links=activeLinks(row),versions=row.sourceSnapshots||[],history=row.historicalAmounts,issues=rowIssues(row);
    const amount=row.sourceKind==='ar_invoice_group'?history?.amountCents??(versions.length===1?versions[0].amountCents:null):null;
    const evidence=(field:'receivedCents'|'balanceCents')=>{
      const label=field==='receivedCents'?'实收':'未收',historicalDate=history?.sourceAsOf?`（截至 ${history.sourceAsOf}）`:'（截至日未明）';
      const parts=row[field]!=null?[money(row[field]),`总表${row.reviewStatus==='confirmed'?'已核实':'待核实'} · ${row.asOf?'截至 '+row.asOf:'截至日待补'}`,...(history?[`历史已核对${label}：${money(history[field])}${historicalDate}`]:[])]:history&&history[field]!=null?[money(history[field]),`历史已核对${label}${historicalDate}`,'总表核定金额：待补']:['待补',row.sourceKind==='ar_invoice_group'?'来源尚无唯一已核对版本':'总表金额待核实'];
      if(field==='balanceCents'&&!row.includedInTotals)parts.push('不计独立核对汇总');
      return parts.join(' · ');
    };
    return [
      [row.customerCode||source.customerLabel||'客户待匹配',row.customerId?row.customer:'原表客户名称 · 尚未关联客户档案',source.title||'历史明细',row.sourceKind==='ar_invoice_group'?`发票来源 · ${versions.length} 个版本`:sourcePosition(source)].join(' · '),
      links.length?links.map(link=>[link.targetSnapshot?.label||'原单暂不可访问',relationLabels[link.relation],link.targetChanged?'原单已变更':'',link.targetUnavailable?'来源不可访问':''].filter(Boolean).join(' · ')).join('；'):'待关联',
      [row.currency||'币种待补',row.sourceKind==='ar_invoice_group'?(amount==null&&versions.length>1?'多个来源版本':money(amount)):displayDecimal(source.originalAmountDecimal)].join(' '),
      [money(row.amountCents),row.amountBasis==='opening_balance'?'期初口径，非总应收':row.reviewStatus==='confirmed'?'总表已核实':'总表待核实'].join(' · '),
      evidence('receivedCents'),evidence('balanceCents'),
      [source.paymentTermsRaw||row.additionalSources?.map(item=>item.paymentTermsRaw).filter(Boolean).join('；')||'付款条件待补',source.invoiceDateRaw||[...new Set(versions.map(item=>item.invoiceDate).filter(Boolean))].join('；')||'待补',source.dueDateRaw||'待补'].join(' · '),
      row.teamName||'待确认',[row.reviewStatus==='confirmed'?'金额已核实':'已登记 · 待核实',issues.length?`${issues.length} 项核查事项`:'',!row.customerId?'客户待匹配':'',row.sourceChanged?'原来源已变更':''].filter(Boolean).join(' · '),'查看与核对',
    ];
  });
  const filtered=columnModel.rows;
  const pageSize = 20, pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages - 1);
  const columnFilterKey=JSON.stringify(columnModel.filters);
  useEffect(()=>setPage(0),[columnFilterKey]);
  useEffect(()=>columnModel.clearFilters(),[customerId,teamId]);
  const registrationStale = !!registration && registration.previewHash !== feed?.registration.previewHash;
  const selectedCustomer = (detailQuery.data?.customers || feed?.customers || []).find(customer => customer.id === draft?.customerId);
  const sameReceivable = !!baseline && activeLinks(current || baseline).some(link => link.relation === 'same_receivable');

  useEffect(() => {if (current && !dirtyRef.current && !inflight.current) {setBaseline(current); setDraft(draftOf(current));}}, [current, busy]);
  useEffect(() => {setPage(0);}, [customerId, teamId, search, completeness]);
  useEffect(() => {onDirtyChange?.(dirty || busy);}, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const protect = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    addEventListener('beforeunload', protect); return () => removeEventListener('beforeunload', protect);
  }, [dirty, busy]);

  function resetEditor() {setVerified(false); setTarget(''); setLinkReason(''); setCancelLinkId(''); setRelation('origin');}
  function openEntry(row: Entry) {if (dirty || busy) {setError('请先保存或放弃当前修改。'); return;} setSelectedId(row.id); setBaseline(row); setDraft(draftOf(row)); resetEditor(); setError(''); setMessage('');}
  function closeEntry() {if (dirty || busy) {setError('还有未保存内容，请先保存或点击“放弃本次修改”。'); return;} setSelectedId(''); setBaseline(null); setDraft(null); resetEditor();}
  function discard() {if (busy) return; const row = current || baseline; if (row) {setBaseline(row); setDraft(draftOf(row));} resetEditor(); setError('');}
  function patchDraft(patch: Partial<Draft>) {setDraft(value => value && {...value, ...patch}); setVerified(false);}
  async function mutate(action: string, body: Record<string, unknown>, success: string) {
    if (!canWrite || inflight.current) return null;
    const key = JSON.stringify({action, body});
    if (retry.current?.key !== key) retry.current = {key, token: clientId()};
    inflight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(action, {...body, token: retry.current.token});
      retry.current = null;
      if (result.item) {setBaseline(result.item); setDraft(draftOf(result.item)); resetEditor();}
      await Promise.all([client.invalidateQueries({queryKey: ['ar-master-ledger']}), client.invalidateQueries({queryKey: ['ar-master-entry']}), client.invalidateQueries({queryKey: ['ar-workspace']})]);
      const warnings = Array.isArray(result.warnings) ? result.warnings.map((warning: {message?: string}) => warning.message).filter(Boolean) : [];
      setMessage(warnings.length ? `${success} ${warnings.length} 条旧来源变化仍待核对：${[...new Set(warnings)].join('；')}` : success); return result;
    } catch (cause) {setError((cause as Error).message); return null;}
    finally {inflight.current = false; setBusy(false);}
  }
  async function saveEntry() {
    if (!draft || !baseline || stale || baseline.sourceChanged || !verified) return;
    try {
      if (draft.reason.trim().length < 2) throw new Error('请填写至少两个字的核对依据或补充资料说明。');
      const amountCents = parseCents(draft.amount, '应收'), receivedCents = parseCents(draft.received, '实收'), balanceCents = parseCents(draft.balance, '未收 / 期初余额');
      if (amountCents != null && receivedCents != null && balanceCents != null && BigInt(amountCents) - BigInt(receivedCents) !== BigInt(balanceCents)) throw new Error('应收减实收须等于未收；请核对差额，系统不会自动补平。');
      if (draft.reviewStatus === 'confirmed') {
        if (!draft.customerId || !draft.currency || !draft.asOf || draft.amountBasis === 'unknown') throw new Error('确认金额前须明确客户、币种、截至日和金额口径。');
        if (draft.amountBasis === 'gross_receivable' && [amountCents, receivedCents, balanceCents].some(value => value == null)) throw new Error('确认总应收口径时，应收、实收、未收三项都须有依据；确为零请明确填写 0。');
        if (draft.amountBasis === 'opening_balance' && balanceCents == null) throw new Error('确认期初余额口径时，须填写有依据的期初余额。');
      }
      await mutate('ar-master-entry-save', {id: baseline.id, version: baseline.version, sourceHash: baseline.sourceHash, customerId: draft.customerId, teamId: draft.teamId, currency: draft.currency, amountBasis: draft.amountBasis, asOf: draft.asOf || null, amountCents, receivedCents, balanceCents, reviewStatus: draft.reviewStatus, note: draft.note, reason: draft.reason.trim()}, '总表资料已保存并留痕；核实金额按明确口径及截至日保留。');
    } catch (cause) {setError((cause as Error).message);}
  }
  async function saveLink() {
    if (!baseline || stale || baseline.sourceChanged || linkReason.trim().length < 2) return;
    if (draft && !equal(draft, draftOf(baseline))) {setError('请先保存或放弃资料核对中的修改，再关联原单。'); return;}
    if (cancelLinkId) {
      await mutate('ar-master-source-link', {id: baseline.id, version: baseline.version, sourceHash: baseline.sourceHash, action: 'cancel', linkId: cancelLinkId, reason: linkReason.trim()}, '关联已取消，原关联与取消依据继续保留。');
    } else if (chosen && chosen.relations.includes(relation)) {
      await mutate('ar-master-source-link', {id: baseline.id, version: baseline.version, sourceHash: baseline.sourceHash, action: 'link', relation, targetKind: chosen.kind, targetId: chosen.id, targetVersion: chosen.version, reason: linkReason.trim()}, '关联已保存；原业务、发票及现金记录保持原值。');
    }
  }
  async function registerAll() {
    if (!registration || registrationStale || !registerVerified) return;
    if (await mutate('ar-master-register-legacy', {sourceIds: registration.sourceIds, previewHash: registration.previewHash, invoiceCustomerIds: registration.invoiceCustomerIds}, '历史明细与发票已按来源去重正式登记；未知金额与待补资料继续保留，未自动确认余额。')) {setRegisterOpen(false); setRegistration(null); setRegisterVerified(false);}
  }
  async function exportRows() {
    if (downloading) return;
    setDownloading(true); setError('');
    try {await downloadBusinessTeamFile('/api/workspace/ar-master-export?' + params, '应收总表.csv');}
    catch (cause) {setError((cause as Error).message);}
    finally {setDownloading(false);}
  }
  function openSource(candidate: Candidate) {
    if (dirty || busy) {setError('请先保存或放弃本次修改，再打开原业务。'); return;}
    onNavigate(candidate.view, {recordId: candidate.id, customerId: baseline?.customerId || '', ...(candidate.orderId ? {orderId: candidate.orderId} : {}), ...(candidate.projectId ? {projectId: candidate.projectId} : {}), ...(candidate.kind === 'ar_invoice' ? {tab: 'invoices'} : {})});
  }

  return <section className="aml" aria-label="应收账款总表">
    <header className="aml-intro"><div><span>ACCOUNTS RECEIVABLE REGISTER</span><h3>应收总表</h3><p>历史总表与发票统一登记，重复来源合并追踪；全部原数、付款条件及版本保留，缺项逐笔核实。</p></div><ClipboardList size={30}/></header>
    <div className="aml-note"><AlertTriangle size={17}/><div><b>正式登记不等于确认余额</b><p>空额显示“待补”；负数保留贷项 / 扣项。历史总表已知金额按明细原数汇总，不采用可能重复包含小计的原表总计，也不与发票档案直接相加。</p></div></div>
    <div className="aml-toolbar"><label>客户<select aria-label="应收总表客户" value={customerId} disabled={busy || dirty} onChange={event => setCustomerId(event.target.value)}><option value="">全部客户（含待匹配）</option>{feed?.customers.map(customer => <option value={`id:${customer.id}`} key={customer.id}>{customer.customerCode} · {customer.customer}</option>)}{originalCustomerCodes.map(code => <option key={code} value={`raw:${code}`}>{code} · 按原表代码查看（未确认归属）</option>)}</select></label><label>资料状态<select aria-label="应收总表资料状态" value={completeness} onChange={event => setCompleteness(event.target.value)}><option value="">全部正式登记</option><option value="pending">金额待核实</option><option value="confirmed">金额已核实</option><option value="missing-amount">来源金额待补</option><option value="unlinked">原单待关联</option><option value="issues">有核对事项</option><option value="legacy">历史总表主来源</option><option value="invoice">历史发票主来源</option></select></label><label className="aml-search"><span><Search size={12}/>搜索</span><input aria-label="搜索应收总表" value={search} onChange={event => setSearch(event.target.value)} placeholder="客户、订单、发票、付款条件、备注"/></label><button disabled={busy || dirty || query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14}/>刷新</button><button disabled={downloading || !feed || feed.scope?.canExport === false} onClick={() => void exportRows()} title="导出当前授权工作组全部登记行，含原表值及核对状态"><Download size={14}/>导出授权组总表</button></div>
    {error && <p className="aml-alert" role="alert">{error}</p>}{message && <p className="aml-success" role="status">{message}</p>}
    {query.isPending ? <p className="aml-empty">正在读取应收总表…</p> : query.isError ? <p className="aml-alert" role="alert">{(query.error as Error).message}</p> : feed && <>
      <div className="aml-counts"><div><span>正式登记</span><b>{feed.counts.registeredCount}</b></div><div><span>金额待核实</span><b>{feed.counts.pendingCount}</b></div><div><span>截至日待补</span><b>{feed.counts.unknownAsOfCount}</b></div><div><span>引用已有应收</span><b>{feed.counts.linkedCount}</b></div><div><span>来源变更待核查</span><b>{feed.counts.sourceChangedCount}</b></div></div>
      <div className="aml-raw-totals">{totals.map(total => <article key={total.currency}><span>{total.currency} · 历史总表已知金额</span><strong title={total.known ? total.decimal : '原表金额均待补'}>{total.known ? displayDecimal(total.decimal) : '待补'}</strong><p>{total.known} 笔已知 · {total.missing} 笔原金额待补 · {total.negative} 笔贷 / 扣项</p><small>未核实金额口径 · 保留原始精度{total.precise ? ` · ${total.precise} 笔超过两位小数` : ''}</small></article>)}</div>
      {feed.registration.newEntryCount > 0 && <div className="aml-registration"><div><b>{feed.registration.newEntryCount} 条去重明细尚未登记总表</b><p>登记全部授权历史来源，合并重叠的总表与发票来源；不受本页客户或资料筛选限制。同票全部版本继续保留，金额与截至日不自动确认。</p></div>{feed.canWrite && <button className="aml-primary" disabled={busy || dirty || query.isFetching || !feed.registration.newEntryCount} onClick={() => {setRegistration({...feed.registration, sourceIds: [...feed.registration.sourceIds], invoiceCustomerIds: [...feed.registration.invoiceCustomerIds]}); setRegisterVerified(false); setRegisterOpen(true); setError('');}}>预览批量登记</button>}</div>}
      <div className="aml-list-heading"><p>显示 {filtered.length} / {rows.length} 条正式登记 · 每笔均保留原始来源</p><small>客户筛选按主档或原表代码查看，不确认归属；导出包含当前授权组全部行。</small></div>
      <div className="ar-table-wrap aml-table"><ExcelTable filterModel={columnModel} filterDisabled={busy||dirty}><thead><tr><th>客户 / 原始来源</th><th>订单 / 发票追踪</th><th>原表 / 发票来源金额</th><th>总表核对应收</th><th>实收 / 历史依据</th><th>未收 / 历史依据</th><th>原付款条件 / 日期</th><th>所属组</th><th>资料完整度</th><th>操作</th></tr></thead><tbody>{filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => {
        const source = row.sourceSnapshot, issues = rowIssues(row), links = activeLinks(row), negative = /^-/.test(source.originalAmountDecimal || '');
        return <tr key={row.id}>
          <td><b>{row.customerCode || source.customerLabel || '客户待匹配'}</b><small>{row.customerId ? row.customer : '原表客户名称 · 尚未关联客户档案'}</small><small>{source.title || '历史明细'}</small><small>{row.sourceKind === 'ar_invoice_group' ? `发票来源 · ${(row.sourceSnapshots || []).length} 个版本${row.additionalSources?.length ? ` · 另含 ${row.additionalSources.length} 条总表来源` : ''}` : sourcePosition(source)}</small></td>
          <td>{links.length ? links.map(link => <div className="aml-table-link" key={link.id}>{link.targetSnapshot?.label || '原单暂不可访问'}<small>{relationLabels[link.relation]}{link.targetChanged ? ' · 原单已变更' : ''}{link.targetUnavailable ? ' · 来源不可访问' : ''}</small></div>) : <span className="aml-muted">待关联</span>}</td>
          <td className={negative ? 'aml-money aml-credit' : 'aml-money'}><span>{row.currency || '币种待补'}</span><SourceAmount row={row}/></td>
          <td className="aml-money">{money(row.amountCents)}<small>{row.amountBasis === 'opening_balance' ? '期初口径，非总应收' : row.reviewStatus === 'confirmed' ? '总表已核实' : '总表待核实'}</small></td>
          <td className="aml-money"><AmountEvidence row={row} field="receivedCents"/></td>
          <td className="aml-money"><AmountEvidence row={row} field="balanceCents"/>{!row.includedInTotals && <small>不计独立核对汇总</small>}</td>
          <td><span className="aml-raw-text">{source.paymentTermsRaw || row.additionalSources?.map(item => item.paymentTermsRaw).filter(Boolean).join('；') || '付款条件待补'}</span><small>原发票日：{source.invoiceDateRaw || [...new Set((row.sourceSnapshots || []).map(item => item.invoiceDate).filter(Boolean))].join('；') || '待补'}</small><small>原到期日：{source.dueDateRaw || '待补'}</small></td>
          <td>{row.teamName || '待确认'}</td>
          <td><span className={'ar-badge ' + (row.reviewStatus === 'confirmed' ? 'green' : 'amber')}>{row.reviewStatus === 'confirmed' ? '金额已核实' : '已登记 · 待核实'}</span>{issues.length > 0 && <small className="aml-issue" title={issues.join('\n')}>{issues.length} 项核查事项</small>}{!row.customerId && <small className="aml-issue">客户待匹配</small>}{row.sourceChanged && <small className="aml-issue">原来源已变更</small>}</td>
          <td><button onClick={() => openEntry(row)}>查看与核对</button></td>
        </tr>;
      })}{!filtered.length && <tr><td colSpan={10}><p className="aml-empty">{rows.length ? '当前筛选没有匹配记录。' : '当前范围尚无正式总表记录；可先预览历史来源并批量登记。'}</p></td></tr>}</tbody></ExcelTable></div>
      <div className="aml-pagination"><span>第 {currentPage + 1} / {pages} 页 · {filtered.length} 条</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
      <details className="aml-confirmed-totals"><summary>当前授权工作组 · 已核实部分的汇总口径</summary><p>仅汇总已核实且未关联为同一笔现有应收的独立记录。不同截至日不能视为同日余额；原表已知金额、历史发票金额和这里的核实小计不可相加。</p>{Object.entries(feed.totalsByCurrency).map(([currency, total]) => <article key={currency}><b>{currency} · {total.includedCount} 条独立记录</b>{total.includedCount ? <p>应收 {money(total.knownReceivableCents)}（{total.unknownReceivableCount} 项待补） · 实收 {money(total.knownReceivedCents)}（{total.unknownReceivedCount} 项待补） · 未收 / 余额 {money(total.knownBalanceCents)}（{total.unknownBalanceCount} 项待补）</p> : <p>暂无可汇总的独立核实金额。</p>}<small>{total.mixedAsOf ? '包含多个截至日，不能作为当前余额' : `截至日：${total.asOfDates.join('、') || '待补'}`} · {total.excludedLinkedCount} 条关联现有应收，已排除重复计账</small></article>)}</details>
    </>}

    {registerOpen && registration && <div className="aml-backdrop"><section className="aml-dialog aml-register-dialog" role="dialog" aria-modal="true" aria-labelledby="aml-register-title">
      <div className="aml-dialog-head"><h3 id="aml-register-title">批量登记历史明细与发票</h3><button aria-label="关闭批量登记" disabled={busy} onClick={() => {setRegisterOpen(false); setRegisterVerified(false);}}><X size={18}/></button></div>
      <p>本次包含全部授权历史来源（不受本页客户或工作组筛选限制）：历史总表 <b>{registration.legacyEntryCount + registration.overlapCount} 条</b>（{registration.legacyEntryCount} 条独立保留）、发票 <b>{registration.invoiceGroupCount} 个票号组</b>，其中 <b>{registration.overlapCount} 项重叠</b>合并来源，去重后共 <b>{registration.entryCount} 条</b>总表记录。</p>
      <p>已登记 {registration.existingEntryCount} 条，本次新增 <b>{registration.newEntryCount} 条</b>。同一票号全部历史版本保留，重叠原表行作为补充来源追踪。</p>
      <div className="aml-note"><AlertTriangle size={16}/><p>本次只完成正式登记。空额不改为 0，不推断客户或订单，不新增现金实收。发票历史已核对实收继续保留；未知截至日不会变成当前余额。</p></div>
      <label className="aml-checkbox"><input type="checkbox" checked={registerVerified} disabled={busy} onChange={event => setRegisterVerified(event.target.checked)}/>已核对来源范围及去重数量；全部待补资料、原始版本与核查事项继续保留。</label>
      {registrationStale && <p className="aml-alert">来源范围已更新，请关闭后重新预览。</p>}{error && <p className="aml-alert" role="alert">{error}</p>}
      <div className="aml-actions"><button disabled={busy} onClick={() => {setRegisterOpen(false); setRegisterVerified(false);}}>取消</button><button className="aml-primary" disabled={busy || !canWrite || !registerVerified || registrationStale || !registration.newEntryCount} onClick={() => void registerAll()}>{busy ? '正在登记…' : `正式新增 ${registration.newEntryCount} 条总表记录`}</button></div>
    </section></div>}

    {selectedId && baseline && draft && <div className="aml-backdrop"><section className="aml-dialog" role="dialog" aria-modal="true" aria-labelledby="aml-detail-title">
      <div className="aml-dialog-head"><div><span className="aml-eyebrow">正式登记 · 第 {baseline.version} 版</span><h3 id="aml-detail-title">{baseline.sourceSnapshot.title || baseline.sourceSnapshot.customerLabel || '历史应收明细'}</h3><p>{baseline.sourceKind === 'ar_invoice_group' ? `发票来源 · ${(baseline.sourceSnapshots || []).length} 个版本` : sourcePosition(baseline.sourceSnapshot)} · {baseline.customerCode || baseline.sourceSnapshot.customerLabel || '客户待匹配'}</p></div><button aria-label="关闭总表详情" disabled={busy} onClick={closeEntry}><X size={19}/></button></div>
      {detailQuery.isPending && <p className="aml-muted">正在核对最新版本与原业务候选…</p>}{detailQuery.isError && <p className="aml-alert" role="alert">{(detailQuery.error as Error).message}</p>}
      {baseline.sourceKind === 'ar_invoice_group' ? <InvoiceVersions row={baseline} disabled={dirty || busy} onOpenSource={openSource}/> : <LegacySource source={baseline.sourceSnapshot} currency={baseline.currency}/>}
      {(baseline.additionalSources || []).map((source, index) => <LegacySource key={source.id || index} source={source} currency={baseline.currency} additional/>)}
      {(current?.linkedAmounts || baseline.linkedAmounts) && (() => {const linked = (current?.linkedAmounts || baseline.linkedAmounts)!; return <div className="aml-linked-current"><b>关联正式应收当前金额 · 只读引用</b><p>{linked.currency} · 应收 {money(linked.amountCents)} · 实收 {money(linked.receivedCents)} · 未收 {money(linked.balanceCents)}</p><small>此金额属于已关联的原应收，本总表行不再独立叠加。原来源变更或不可访问时须先复核。</small></div>;})()}
      {(current || baseline).sourceChanged && <p className="aml-alert" role="alert">原来源已变更，当前冻结依据与最新来源不一致，暂不能保存核对或建立关联。请先处理来源变更。</p>}
      {rowIssues(current || baseline).length > 0 && <section className="aml-issues"><h4><AlertTriangle size={15}/>核对事项必须保留</h4><ul>{rowIssues(current || baseline).map((issue, index) => <li key={index}>{issue}</li>)}</ul></section>}
      <section className="aml-edit-section"><div className="aml-section-head"><h4>资料与金额核对</h4><span>{canWrite ? '有权管理员维护 · 保存形成新版本' : '当前权限仅查看'}</span></div><p className="aml-muted">原表值与核对值分开保存。先匹配客户和历史所属组，再依据原单、实收及截至日填写；原表超过两位小数时须说明金额取舍，不能自动四舍五入。</p>
        {sameReceivable && <p className="aml-note">本行已关联同一笔正式应收，不再独立确认或修改金额。可补充备注；需要变更账务金额时，请回原应收入口留痕处理。</p>}
        <fieldset disabled={!canWrite || busy || detailQuery.isFetching || stale || baseline.sourceChanged}><div className="aml-form-grid">
          <label>确认客户<select aria-label="总表确认客户" value={draft.customerId} onChange={event => patchDraft({customerId: event.target.value})}><option value="">待匹配</option>{(detailQuery.data?.customers || feed?.customers || []).map(customer => <option key={customer.id} value={customer.id}>{customer.customerCode} · {customer.customer}</option>)}</select></label>
          <label>确认历史所属组<select aria-label="总表确认所属组" value={draft.teamId} onChange={event => patchDraft({teamId: event.target.value})}><option value="">待确认</option>{(detailQuery.data?.teams || feed?.teams || []).map(team => <option key={team.id} value={team.id}>{team.name}{team.active === false ? '（已停用）' : ''}</option>)}</select></label>
          <label>币种<select value={draft.currency} onChange={event => patchDraft({currency: event.target.value})}><option value="">待确认</option>{Array.from(new Set(['USD', 'EUR', 'CNY', 'GBP', 'HKD', ...(draft.currency ? [draft.currency] : [])])).map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <label>金额口径<select aria-label="总表金额口径" value={draft.amountBasis} disabled={sameReceivable} onChange={event => patchDraft({amountBasis: event.target.value as Entry['amountBasis']})}><option value="unknown">待确认口径</option><option value="gross_receivable">总应收（应收 − 实收 = 未收）</option><option value="opening_balance">指定截至日期初余额</option></select></label>
          <label>金额截至日<input type="date" value={draft.asOf} disabled={sameReceivable} onChange={event => patchDraft({asOf: event.target.value})}/></label>
          <label>核对状态<select value={draft.reviewStatus} disabled={sameReceivable} onChange={event => patchDraft({reviewStatus: event.target.value as Entry['reviewStatus']})}><option value="pending">资料已登记，金额继续待核实</option><option value="confirmed" disabled={sameReceivable}>有明确依据，确认本行金额</option></select></label>
          <label>应收（空白为待补）<input inputMode="decimal" value={draft.amount} disabled={sameReceivable} onChange={event => patchDraft({amount: event.target.value})} placeholder="不从原表自动填入"/></label>
          <label>实收（空白为待补）<input inputMode="decimal" value={draft.received} disabled={sameReceivable} onChange={event => patchDraft({received: event.target.value})} placeholder="仅记录有依据的历史实收"/></label>
          <label>{draft.amountBasis === 'opening_balance' ? '期初余额' : '未收'}（空白为待补）<input inputMode="decimal" value={draft.balance} disabled={sameReceivable} onChange={event => patchDraft({balance: event.target.value})} placeholder="贷项 / 扣项保留负号"/></label>
          <label className="aml-wide">补充备注<textarea value={draft.note} maxLength={4000} onChange={event => patchDraft({note: event.target.value})}/></label>
          <label className="aml-wide">核对依据 / 本次补充说明<textarea value={draft.reason} maxLength={3000} onChange={event => patchDraft({reason: event.target.value})} placeholder="写明原凭证、收款归属、金额口径、截至日及差异处理；若暂缺资料，请说明缺项。"/></label>
        </div><label className="aml-checkbox"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)}/>已核对本次填写与原表依据；未知项保留空白，历史实收登记不新增现金。</label></fieldset>
        <div className="aml-actions"><button disabled={busy} onClick={discard}>放弃本次修改</button>{canWrite && <button className="aml-primary" disabled={busy || stale || baseline.sourceChanged || detailQuery.isFetching || !verified || draft.reason.trim().length < 2 || !!target || !!cancelLinkId || !!linkReason.trim()} onClick={() => void saveEntry()}><Save size={14}/>保存核对资料</button>}</div>
      </section>
      <section className="aml-edit-section"><div className="aml-section-head"><h4><Link2 size={15}/>原订单与发票追踪</h4><span>{selectedCustomer ? `${selectedCustomer.customerCode} · ${selectedCustomer.customer}` : '先保存确认客户，再列出候选'}</span></div><p className="aml-muted">只关联已确认客户的真实业务单。“原业务追踪”保留来源；“同一笔应收”明确重复关系，防止与现有正式应收再计一笔。不能仅凭相近编号或备注自动关联。</p>
        <div className="aml-links">{(current?.links || baseline.links || []).map(link => <article className={link.status === 'cancelled' ? 'cancelled' : ''} key={link.id}><div><span className="ar-badge">{link.status === 'cancelled' ? '已取消 · 历史保留' : relationLabels[link.relation]}</span><b>{link.targetSnapshot?.label || '原来源暂不可访问'}</b><small>{kinds[link.targetKind] || '原业务'} · 关联时第 {link.targetVersion} 版</small>{link.targetChanged && <p className="aml-issue">原单版本已变更，请核对；此处保留关联时依据。</p>}{link.targetUnavailable && <p className="aml-issue">原来源不可访问，原关联历史仍保留。</p>}{link.reason && <p>{link.reason}</p>}{link.cancelEvents?.map((event, index) => <p key={index}>取消依据：{event.reason || '详见审计记录'}</p>)}</div><div className="aml-link-actions">{link.targetSnapshot?.view && <button disabled={dirty || busy || !!link.targetUnavailable} onClick={() => openSource(link.targetSnapshot!)}>查看原单 <ArrowUpRight size={13}/></button>}{canWrite && link.status === 'active' && <button disabled={busy || stale || baseline.sourceChanged || dirty} onClick={() => {setCancelLinkId(link.id); setTarget(''); setLinkReason('');}}><Unlink size={13}/>取消关联</button>}</div></article>)}{!(current?.links || baseline.links || []).length && <p className="aml-muted">尚未建立精确关联，保留“待关联”。</p>}</div>
        {canWrite && <div className="aml-link-form">{cancelLinkId ? <p className="aml-issue">将取消当前选中的关联，历史依据继续保留。请填写原因。</p> : <><label>同客户原业务候选<select aria-label="总表原单候选" value={target} disabled={busy || stale || baseline.sourceChanged || detailQuery.isFetching || draft.customerId !== baseline.customerId || !baseline.customerId || !equal(draft, draftOf(baseline))} onChange={event => {setTarget(event.target.value); setRelation('origin');}}><option value="">请选择精确原单（不自动匹配）</option>{choices.map(candidate => <option key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{kinds[candidate.kind] || '原业务'} · {candidate.label}</option>)}</select></label>{draft.customerId !== baseline.customerId && <p className="aml-muted">请先保存客户匹配，再加载该客户的业务候选。</p>}{baseline.customerId && !detailQuery.isFetching && !choices.length && <p className="aml-muted">当前客户暂无可访问的原单候选，保持待关联。</p>}<label>关联关系<select value={relation} disabled={busy || !chosen} onChange={event => setRelation(event.target.value as Relation)}>{(chosen?.relations || ['origin'] as Relation[]).map(value => <option key={value} value={value}>{relationLabels[value]}</option>)}</select></label></>}<label>关联 / 取消依据（至少两个字）<textarea value={linkReason} maxLength={3000} disabled={busy || stale || baseline.sourceChanged} onChange={event => setLinkReason(event.target.value)} placeholder="写明客户、原订单或发票的精确对应依据；同一笔应收须说明为何不会重复计账。"/></label><div className="aml-actions"><button disabled={busy} onClick={() => {setTarget(''); setCancelLinkId(''); setLinkReason('');}}>清除关联填写</button><button className="aml-primary" disabled={busy || stale || baseline.sourceChanged || detailQuery.isFetching || linkReason.trim().length < 2 || (!cancelLinkId && !chosen) || !equal(draft, draftOf(baseline))} onClick={() => void saveLink()}><Check size={14}/>{cancelLinkId ? '确认取消关联' : '确认关联原单'}</button></div></div>}
      </section>
      {stale && <p className="aml-alert" role="alert">本条记录已更新或已离开当前授权范围。请放弃本次修改并重新读取后再维护。</p>}{error && <p className="aml-alert" role="alert">{error}</p>}{message && <p className="aml-success" role="status">{message}</p>}
      <div className="aml-actions"><button disabled={busy} onClick={closeEntry}>关闭详情</button></div>
    </section></div>}
  </section>;
}
