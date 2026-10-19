'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {ArrowUpRight, Download, FileText, Link2, LockKeyhole, Plus, RefreshCw, Save, Settings2, Unlink, X} from 'lucide-react';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import {request} from './ui';
import {downloadBusinessTeamFile} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import './ar-customer-profile-panel.css';

type Customer = {id: string; customer: string; customerCode: string};
type Field = {key: string; labelZh: string; labelEn: string; type: 'text' | 'number' | 'date'; required: boolean};
type Profile = {id: string; customerId: string; version: number; documentTitle: string; language: 'zh' | 'en' | 'bilingual'; statementColumns: string[]; customFields: Field[]; note: string};
type Column = {key: string; labelZh: string; labelEn: string};
type Candidate = {kind: string; id: string; version: number; label: string; view: string; orderId?: string; projectId?: string};
type TraceLink = {id: string; invoiceId: string; status: 'active' | 'cancelled'; targetKind: string; targetId: string; targetSnapshot: Candidate | null; targetUnavailable?: boolean; targetChanged?: boolean; note?: string; createdAt?: string; cancelEvents?: {note?: string; createdAt?: string}[]};
type Extra = {invoiceId: string; version: number; invoiceVersion: number; profileId: string; profileVersion: number; values: Record<string, string | number | null>; schemaSnapshot: Field[]};
type ProfileFeed = {customers: Customer[]; profile: Profile | null; profiles: Profile[]; coreColumns: Column[]; optionalColumns: Column[]; candidates: Candidate[]; traceLinks: TraceLink[]; extraValues: Extra | null; canWrite: boolean; boundary?: string};
type Invoice = {id: string; customerId: string; version: number; invoiceNo: string; sourceSheet: string; sourceVersion: number; batchId: string; documentType: string; currency: string; amountCents: number | null; note?: string; remarks?: string};
type LedgerFeed = {invoices: Invoice[]; attachments: {id: string; batchId: string; filename: string; category: string}[]};
const kindLabels: Record<string, string> = {order: '原订单', handoff_business_document: '业务单据', project_billing_document: '项目单据', project_charge: '项目收费', service_record: '客服原单', customer_project: '客户项目', ar_invoice: '历史发票'};
const fieldLabels = {text: '文本', number: '数字', date: '日期'};
const money = (cents: number | null, currency: string) => cents == null ? '待核对' : `${currency} ${(cents / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const copyProfile = (profile: Profile): Profile => ({...profile, statementColumns: [...profile.statementColumns], customFields: profile.customFields.map(field => ({...field})), note: profile.note || ''});
const extraDraft = (fields: Field[], extra: Extra | null | undefined) => Object.fromEntries(fields.map(field => [field.key, extra?.values[field.key] == null ? '' : String(extra.values[field.key])]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function ArCustomerProfilePanel({data, onNavigate, onDirtyChange}: {data: {me?: {id?: string}}; onNavigate: WorkspaceNavigate; onDirtyChange?: (dirty: boolean) => void}) {
  const client = useQueryClient(), scope = useBusinessTeamScope(), teamId = scope?.teamId || '';
  const [customerId, setCustomerId] = useState(''), [invoiceId, setInvoiceId] = useState(''), [invoiceSearch, setInvoiceSearch] = useState('');
  const [draft, setDraft] = useState<Profile | null>(null), [baseline, setBaseline] = useState<Profile | null>(null);
  const [values, setValues] = useState<Record<string, string>>({}), [valuesBaseline, setValuesBaseline] = useState<Record<string, string>>({}), [extraVersion, setExtraVersion] = useState(0), [extraProfileVersion, setExtraProfileVersion] = useState(0), [extraInvoiceVersion, setExtraInvoiceVersion] = useState(0);
  const [mappingVerified, setMappingVerified] = useState(false);
  const [target, setTarget] = useState(''), [linkNote, setLinkNote] = useState(''), [cancelLink, setCancelLink] = useState<TraceLink | null>(null), [cancelNote, setCancelNote] = useState('');
  const [busy, setBusy] = useState(false), [downloading, setDownloading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const inflight = useRef(false), retry = useRef<{key: string; token: string} | null>(null), profileDirtyRef = useRef(false), extrasDirtyRef = useRef(false);
  const params = new URLSearchParams({customerId, invoiceId, teamId});
  const query = useQuery<ProfileFeed>({queryKey: ['ar-customer-profiles', data.me?.id, teamId, customerId, invoiceId], queryFn: ({signal}) => request('ar-customer-profiles-data?' + params, undefined, {signal})});
  const ledger = useQuery<LedgerFeed>({queryKey: ['ar-invoice-ledger', data.me?.id, teamId, customerId], queryFn: ({signal}) => request('ar-invoice-data?' + new URLSearchParams({customerId, teamId}), undefined, {signal}), enabled: !!customerId});
  const feed = query.data, profile = feed?.profile, invoices = ledger.data?.invoices || [], invoice = invoices.find(item => item.id === invoiceId), canWrite = !!feed?.canWrite;
  const candidates = (feed?.candidates || []).filter(item => !!item.label && item.label !== item.id);
  const mappingNeedsReview = !!invoice && !!profile && !!feed?.extraValues && (feed.extraValues.profileVersion !== profile.version || feed.extraValues.invoiceVersion !== invoice.version);
  const profileDirty = !!draft && !!baseline && !same(draft, baseline), extrasDirty = !same(values, valuesBaseline), dirty = profileDirty || extrasDirty || mappingVerified || !!linkNote.trim() || !!cancelNote.trim();
  profileDirtyRef.current = profileDirty; extrasDirtyRef.current = extrasDirty;
  const profileStale = !!baseline && !!profile && (baseline.customerId !== profile.customerId || baseline.version !== profile.version);
  const extraStale = !!invoice && (extraInvoiceVersion !== invoice.version || extraProfileVersion !== (profile?.version || 0) || extraVersion !== (feed?.extraValues?.version || 0));
  const filteredInvoices = useMemo(() => invoices.filter(item => !invoiceSearch || [item.invoiceNo, item.sourceSheet, item.remarks].join(' ').toLowerCase().includes(invoiceSearch.toLowerCase())), [invoices, invoiceSearch]);
  const selectedCustomer = feed?.customers.find(item => item.id === customerId);

  useEffect(() => {if (!profile || !customerId || profileDirtyRef.current || inflight.current) return; setBaseline(copyProfile(profile)); setDraft(copyProfile(profile));}, [profile, customerId, busy]);
  useEffect(() => {if (!profile || !invoice || extrasDirtyRef.current || inflight.current) return; const next = extraDraft(profile.customFields, feed?.extraValues); setValues(next); setValuesBaseline(next); setExtraVersion(feed?.extraValues?.version || 0); setExtraProfileVersion(profile.version); setExtraInvoiceVersion(invoice.version);}, [profile, invoice, feed?.extraValues, busy]);
  useEffect(() => setMappingVerified(false), [customerId, invoiceId, profile?.version, invoice?.version, feed?.extraValues?.version]);
  useEffect(() => {onDirtyChange?.(dirty || busy);}, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {if (!dirty && !busy) return; const protect = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';}; addEventListener('beforeunload', protect); return () => removeEventListener('beforeunload', protect);}, [dirty, busy]);

  function changeCustomer(id: string) {
    if (dirty || busy) {setError('请先保存或放弃当前修改，再切换客户。'); return;}
    setCustomerId(id); setInvoiceId(''); setInvoiceSearch(''); setDraft(null); setBaseline(null); setValues({}); setValuesBaseline({}); setTarget(''); setError(''); setMessage('');
  }
  function changeInvoice(id: string) {
    if (extrasDirty || mappingVerified || linkNote.trim() || cancelNote.trim() || busy) {setError('请先保存或放弃当前发票的修改，再切换发票。'); return;}
    setInvoiceId(id); setValues({}); setValuesBaseline({}); setTarget(''); setCancelLink(null); setError(''); setMessage('');
  }
  function discardProfile() {if (!profile || busy) return; setBaseline(copyProfile(profile)); setDraft(copyProfile(profile)); setError('');}
  function discardExtras() {if (!profile || !invoice || busy) return; const next = extraDraft(profile.customFields, feed?.extraValues); setValues(next); setValuesBaseline(next); setExtraVersion(feed?.extraValues?.version || 0); setExtraProfileVersion(profile.version); setExtraInvoiceVersion(invoice.version); setMappingVerified(false); setError('');}
  async function mutate(action: string, body: Record<string, unknown>, success: string) {
    if (!canWrite || inflight.current) return null;
    const key = JSON.stringify({action, body}); if (retry.current?.key !== key) retry.current = {key, token: crypto.randomUUID()};
    inflight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(action, {...body, token: retry.current.token}); retry.current = null;
      await Promise.all([client.invalidateQueries({queryKey: ['ar-customer-profiles']}), client.invalidateQueries({queryKey: ['ar-invoice-ledger']})]);
      setMessage(success); return result;
    } catch (cause) {setError((cause as Error).message); return null;}
    finally {inflight.current = false; setBusy(false);}
  }
  async function saveProfile() {
    if (!draft || !baseline || profileStale || extrasDirty) return;
    if (!draft.documentTitle.trim() || draft.customFields.some(field => !field.labelZh.trim() || !field.labelEn.trim())) {setError('请填写对账单标题及每个扩展字段的中英文名称。'); return;}
    const allowed = new Set([...(feed?.coreColumns.map(column => column.key) || []), ...(feed?.optionalColumns.map(column => column.key) || []), ...draft.customFields.map(field => field.key)]);
    const body = {customerId, version: baseline.version, documentTitle: draft.documentTitle, language: draft.language, statementColumns: [...new Set([...(feed?.coreColumns.map(column => column.key) || []), ...draft.statementColumns.filter(key => allowed.has(key)), ...draft.customFields.map(field => field.key)])], customFields: draft.customFields, note: draft.note};
    const result = await mutate('ar-customer-profile-save', body, '客户模板已保存；新生成的对账单采用此配置，旧快照保持原样。');
    if (result?.profile) {profileDirtyRef.current = false; setBaseline(copyProfile(result.profile)); setDraft(copyProfile(result.profile));}
  }
  async function saveExtras() {
    if (!invoice || !profile || extraStale) return;
    if (mappingNeedsReview && !mappingVerified) {setError('请先核对当前模板字段与原填写内容，并勾选确认。'); return;}
    const submitted: Record<string, string | number | null> = {};
    for (const field of profile.customFields) {
      const value = (values[field.key] || '').trim();
      if (!value) {if (field.required) {setError(`请填写“${field.labelZh}”。`); return;} submitted[field.key] = null; continue;}
      if (field.type === 'number') {const numeric = Number(value); if (!Number.isFinite(numeric)) {setError(`“${field.labelZh}”须填写有效数字。`); return;} submitted[field.key] = numeric;}
      else submitted[field.key] = value;
    }
    const result = await mutate('ar-invoice-extra-save', {invoiceId, invoiceVersion: invoice.version, version: extraVersion, profileVersion: profile.version, values: submitted}, '发票扩展信息已保存，新对账快照将使用已保存内容。');
    if (result?.extraValues) {extrasDirtyRef.current = false; setValuesBaseline({...values}); setExtraVersion(result.extraValues.version); setExtraInvoiceVersion(invoice.version); setExtraProfileVersion(profile.version); setMappingVerified(false);}
  }
  async function saveLink() {
    if (!invoice) return;
    const selected = candidates.find(item => `${item.kind}:${item.id}` === target);
    if (!selected || !linkNote.trim()) {setError('请选择精确原单并填写关联依据。'); return;}
    if (await mutate('ar-invoice-source-link', {action: 'link', invoiceId, version: invoice.version, targetKind: selected.kind, targetId: selected.id, targetVersion: selected.version, note: linkNote.trim()}, '原单追踪关联已保存；原订单及账务金额保持原值。')) {setTarget(''); setLinkNote('');}
  }
  async function removeLink() {
    if (!invoice || !cancelLink || !cancelNote.trim()) return;
    if (await mutate('ar-invoice-source-link', {action: 'cancel', invoiceId, version: invoice.version, linkId: cancelLink.id, note: cancelNote.trim()}, '关联已取消，原关联与取消依据继续保留。')) {setCancelLink(null); setCancelNote('');}
  }
  async function download(id: string, filename: string) {if (downloading) return; setDownloading(true); setError(''); try {await downloadBusinessTeamFile('/api/workspace/ar-invoice-file?id=' + encodeURIComponent(id), filename);} catch (cause) {setError((cause as Error).message);} finally {setDownloading(false);}}
  function openSource(source: Candidate) {if (dirty || busy) {setError('请先保存或放弃当前修改，再查看原业务。'); return;} if (source.kind === 'ar_invoice') {changeInvoice(source.id); return;} onNavigate(source.view, {recordId: source.id, customerId, ...(source.orderId ? {orderId: source.orderId} : {}), ...(source.projectId ? {projectId: source.projectId} : {})});}
  function updateField(index: number, patch: Partial<Field>) {setDraft(current => current && {...current, customFields: current.customFields.map((field, position) => position === index ? {...field, ...patch} : field)});}

  return <section className="acp" aria-label="客户模板与发票追踪">
    <header className="acp-intro"><div><span>CUSTOMER PROFILE / TRACEABILITY</span><h3>客户模板与追踪</h3><p>统一核心账务，按客户保留对账习惯与眼镜类别信息；用精确原单关联串起订单、发票和对账依据。</p></div><Settings2 size={30}/></header>
    <div className="acp-toolbar"><label>客户<select aria-label="模板与追踪客户" value={customerId} disabled={busy} onChange={event => changeCustomer(event.target.value)}><option value="">请选择客户</option>{feed?.customers.map(item => <option key={item.id} value={item.id}>{item.customerCode} · {item.customer}</option>)}</select></label><button disabled={busy || query.isFetching} onClick={() => void Promise.all([query.refetch(), customerId ? ledger.refetch() : Promise.resolve()])}><RefreshCw size={14}/>刷新</button><span className="acp-access">{canWrite ? '有权管理员可维护' : '授权范围内查看'}</span></div>
    {error && <p className="acp-alert" role="alert">{error}</p>}{message && <p className="acp-success" role="status">{message}</p>}
    {query.isPending ? <p className="acp-empty">正在读取客户模板与权限…</p> : query.isError ? <p className="acp-alert" role="alert">{(query.error as Error).message}</p> : !customerId ? <div className="acp-empty"><LayersPlaceholder/><b>先选择一个客户</b><p>设置客户对账展示，填写逐票扩展信息，并关联同客户原订单。</p></div> : feed && <>
      <div className="acp-note"><LockKeyhole size={15}/><p>客户、币种、发票号、历史净应收、实收和未收属于统一账务字段。模板仅调整展示及补充业务信息，原单关联仅用于追踪，不新增应收或现金。</p></div>
      <section className="acp-card"><div className="acp-card-head"><div><span className="acp-step">01 · 客户对账模板</span><h3>{selectedCustomer?.customerCode} {selectedCustomer?.customer || '客户'} · STATEMENT</h3><p>{profile?.version ? `已保存第 ${profile.version} 版` : '当前使用默认配置'} · 保存后仅作用于新生成的快照</p></div>{profileDirty && <span className="acp-badge">有未保存修改</span>}</div>
        {draft && <><div className="acp-form-grid"><label>对账单标题<input aria-label="客户对账单标题" value={draft.documentTitle} maxLength={160} disabled={!canWrite || busy} onChange={event => setDraft({...draft, documentTitle: event.target.value})}/></label><label>显示语言<select aria-label="客户对账单语言" value={draft.language} disabled={!canWrite || busy} onChange={event => setDraft({...draft, language: event.target.value as Profile['language']})}><option value="bilingual">中英双语</option><option value="zh">中文</option><option value="en">English</option></select></label></div>
        <div className="acp-column-section"><h4><LockKeyhole size={13}/>固定账务列</h4><div className="acp-chips">{feed.coreColumns.map(column => <span key={column.key}>{column.labelZh}</span>)}</div><h4>可选展示列</h4><div className="acp-checks">{feed.optionalColumns.map(column => <label key={column.key}><input type="checkbox" checked={draft.statementColumns.includes(column.key)} disabled={!canWrite || busy} onChange={event => setDraft({...draft, statementColumns: event.target.checked ? [...draft.statementColumns, column.key] : draft.statementColumns.filter(key => key !== column.key)})}/>{column.labelZh}</label>)}</div></div>
        <div className="acp-fields-head"><div><h4>客户扩展字段</h4><p>例如眼镜类别、客款号、镜片类型、框色、尺寸或客户 PO。只保存文本、数字、日期，不设置计算公式；保存的扩展字段将显示在新对账快照中。</p></div>{canWrite && <button disabled={busy || draft.customFields.length >= 20} onClick={() => setDraft({...draft, customFields: [...draft.customFields, {key: 'custom_field_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12), labelZh: '', labelEn: '', type: 'text', required: false}]})}><Plus size={14}/>增加字段</button>}</div>
        <div className="acp-fields">{draft.customFields.map((field, index) => <article key={field.key}><label>中文名称<input aria-label={`扩展字段 ${index + 1} 中文名称`} value={field.labelZh} maxLength={80} disabled={!canWrite || busy} onChange={event => updateField(index, {labelZh: event.target.value})}/></label><label>英文名称<input aria-label={`扩展字段 ${index + 1} 英文名称`} value={field.labelEn} maxLength={100} disabled={!canWrite || busy} onChange={event => updateField(index, {labelEn: event.target.value})}/></label><label>信息类型<select aria-label={`扩展字段 ${index + 1} 类型`} value={field.type} disabled={!canWrite || busy || !!baseline?.customFields.some(item => item.key === field.key)} onChange={event => updateField(index, {type: event.target.value as Field['type']})}>{Object.entries(fieldLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="acp-checkbox"><input type="checkbox" checked={field.required} disabled={!canWrite || busy} onChange={event => updateField(index, {required: event.target.checked})}/>必填</label>{canWrite && <button className="acp-remove" aria-label={`移除扩展字段 ${index + 1}`} disabled={busy} onClick={() => setDraft({...draft, customFields: draft.customFields.filter((_, position) => position !== index)})}><X size={15}/></button>}</article>)}{!draft.customFields.length && <p className="acp-muted">暂无扩展字段。核心账务字段已固定，无需重复添加。</p>}</div><p className="acp-footnote">已有字段类型保持固定；需要新类型时新增字段。移除字段影响以后填写的内容，已生成快照保留原内容。</p><label>模板使用说明<textarea aria-label="客户模板使用说明" value={draft.note} maxLength={4000} disabled={!canWrite || busy} onChange={event => setDraft({...draft, note: event.target.value})} placeholder="记录客户偏好的字段、格式和适用类别，金额规则仍以正式业务依据为准。"/></label>
        {profileStale && <p className="acp-alert" role="alert">客户模板已被更新。当前草稿保留，请放弃草稿并重新核对最新版本。</p>}{canWrite && <div className="acp-actions"><button disabled={busy || !profileDirty} onClick={discardProfile}>放弃模板修改</button><button className="acp-primary" disabled={busy || !profileDirty || profileStale || extrasDirty || !draft.documentTitle.trim()} onClick={() => void saveProfile()}><Save size={14}/>{busy ? '保存中…' : '保存客户模板'}</button></div>}</>}
      </section>
      <section className="acp-card"><div className="acp-card-head"><div><span className="acp-step">02 · 逐票业务信息与原单追踪</span><h3>选择历史发票</h3><p>同号不同版本分别保留，先核对工作表与版本再关联。</p></div></div><div className="acp-invoice-picker"><label>查找发票<input aria-label="追踪发票搜索" value={invoiceSearch} disabled={busy} placeholder="发票号、工作表或原备注" onChange={event => setInvoiceSearch(event.target.value)}/></label><label>当前发票<select aria-label="追踪当前发票" value={invoiceId} disabled={busy || ledger.isPending} onChange={event => changeInvoice(event.target.value)}><option value="">请选择发票与版本</option>{filteredInvoices.map(item => <option key={item.id} value={item.id}>{item.invoiceNo} · {item.sourceSheet} · 源版本 {item.sourceVersion || 1}</option>)}{invoice && !filteredInvoices.some(item => item.id === invoice.id) && <option value={invoice.id}>{invoice.invoiceNo} · {invoice.sourceSheet} · 源版本 {invoice.sourceVersion || 1}</option>}</select></label></div>
      {ledger.isError && <p className="acp-alert">{(ledger.error as Error).message}</p>}{!invoiceId ? <p className="acp-empty">{invoices.length ? '选择发票后可查看原件、关联原业务并填写扩展信息。' : '当前客户暂无历史发票，请先在“发票与对账单”归档。'}</p> : query.isFetching || ledger.isFetching ? <p className="acp-muted">正在读取当前发票…</p> : invoice && <>
        <div className="acp-invoice-summary"><div><b>{invoice.invoiceNo}</b><span>{invoice.documentType} · {invoice.sourceSheet}</span><span>历史净应收 {money(invoice.amountCents, invoice.currency)}</span></div><div className="acp-originals">{ledger.data?.attachments.filter(item => item.category === 'source-workbook' && item.batchId === invoice.batchId).map(item => <button key={item.id} disabled={downloading} onClick={() => void download(item.id, item.filename)}><Download size={13}/>下载原发票工作簿</button>)}</div></div>{invoice.remarks && <p className="acp-source-note"><b>原票说明：</b>{invoice.remarks}</p>}
        <section className="acp-subsection"><div className="acp-subhead"><h4>逐票扩展信息</h4><span>采用已保存的客户模板</span></div>{profileDirty && <p className="acp-note">请先保存或放弃上方模板修改，再编辑逐票信息。</p>}{profile?.customFields.length ? <div className="acp-extra-grid">{profile.customFields.map(field => <label key={field.key}>{field.labelZh}{field.required && <span className="acp-required">必填</span>}<input aria-label={`发票扩展信息 ${field.labelZh}`} type={field.type === 'date' ? 'date' : 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined} value={values[field.key] || ''} maxLength={field.type === 'text' ? 2000 : undefined} disabled={!canWrite || busy || profileDirty} onChange={event => {setValues(current => ({...current, [field.key]: event.target.value})); setMappingVerified(false);}}/>{field.labelEn && <small>{field.labelEn}</small>}</label>)}</div> : <p className="acp-muted">该客户未设置扩展字段，可在上方模板中增加。</p>}{mappingNeedsReview && feed.extraValues && <div className="acp-mapping-review"><p className="acp-note">原填写内容对应较早的模板或发票版本。请比对原字段与当前字段；确认后保存新的扩展版本，原填写版本和旧快照继续保留。</p><details><summary>查看原填写字段与内容 · 模板第 {feed.extraValues.profileVersion} 版</summary><div className="acp-mapping-rows">{feed.extraValues.schemaSnapshot.map(field => <div key={field.key}><span>{field.labelZh}{field.labelEn && <small>{field.labelEn}</small>}</span><span>{fieldLabels[field.type]}</span><b>{feed.extraValues?.values[field.key] == null || feed.extraValues.values[field.key] === '' ? '未填写' : String(feed.extraValues.values[field.key])}</b></div>)}</div></details>{canWrite && <label className="acp-checkbox"><input type="checkbox" checked={mappingVerified} disabled={busy || profileDirty || extraStale} onChange={event => setMappingVerified(event.target.checked)}/>已核对当前模板字段与原填写内容</label>}</div>}{extraStale && extrasDirty && <p className="acp-alert">发票或客户模板已更新。当前输入保留，请放弃本次修改后重新核对。</p>}{canWrite && (!!profile?.customFields.length || mappingNeedsReview) && <div className="acp-actions"><button disabled={busy || (!extrasDirty && !mappingVerified)} onClick={discardExtras}>放弃本票修改</button><button className="acp-primary" disabled={busy || profileDirty || (!extrasDirty && !(mappingNeedsReview && mappingVerified)) || extraStale || (mappingNeedsReview && !mappingVerified)} onClick={() => void saveExtras()}><Save size={14}/>保存本票扩展信息</button></div>}</section>
        <section className="acp-subsection"><div className="acp-subhead"><h4>原订单与业务单据</h4><span>{feed.traceLinks.filter(link => link.status === 'active').length ? '已建立追踪关联' : '待关联'}</span></div><div className="acp-links">{feed.traceLinks.map(link => <article key={link.id} className={link.status === 'cancelled' ? 'cancelled' : ''}><div><span className="acp-badge">{link.status === 'active' ? '有效关联' : '已取消'}</span><b>{link.targetSnapshot?.label && link.targetSnapshot.label !== link.targetId ? link.targetSnapshot.label : '原业务编号待核对'}</b><p>{kindLabels[link.targetKind] || '业务单据'} · {link.note || '未填写说明'}</p>{link.targetUnavailable ? <p className="acp-alert">原来源不可访问，原关联历史仍保留。</p> : link.targetChanged ? <p className="acp-alert">原单版本已变更，请核对；此处保留关联时的原版本依据。</p> : null}{link.cancelEvents?.map((event, index) => <p key={index} className="acp-muted">取消依据：{event.note || '已留存取消记录'}</p>)}</div><div className="acp-link-actions">{link.targetSnapshot?.view && <button disabled={busy || !!link.targetUnavailable} onClick={() => link.targetSnapshot && openSource({...link.targetSnapshot, id: link.targetId, kind: link.targetKind})}>查看原业务 <ArrowUpRight size={13}/></button>}{canWrite && link.status === 'active' && <button disabled={busy} onClick={() => {setCancelLink(link); setCancelNote('');}}><Unlink size={13}/>取消关联</button>}</div></article>)}{!feed.traceLinks.length && <p className="acp-muted">尚未关联原订单。找不到唯一且同客户的原业务记录时，保持待关联。</p>}</div>
        {canWrite && <div className="acp-link-form"><label>选择同客户原业务记录<select aria-label="同客户原业务候选" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}><option value="">请选择精确原单</option>{candidates.map(item => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{kindLabels[item.kind] || '业务单据'} · {item.label}</option>)}</select></label>{!candidates.length && <p className="acp-footnote">当前没有可关联的精确业务候选，请先在原业务入口核对客户与订单。</p>}<label>关联依据<textarea aria-label="原单关联依据" value={linkNote} maxLength={3000} disabled={busy} onChange={event => setLinkNote(event.target.value)} placeholder="说明客户 PO、原订单 / PI 编号及本票对应范围；仅关联能明确核对的原单。"/></label><div className="acp-actions"><button disabled={busy || !linkNote && !target} onClick={() => {setLinkNote(''); setTarget('');}}>清空关联草稿</button><button className="acp-primary" disabled={busy || !target || !linkNote.trim() || extrasDirty} onClick={() => void saveLink()}><Link2 size={14}/>保存追踪关联</button></div><p className="acp-footnote">只建立追踪关系，不改原订单、不登记新应收、不进行核销。原账务仍由对应财务入口办理。</p></div>}</section>
      </>}</section>
    </>}
    {cancelLink && <div className="acp-dialog-backdrop"><section className="acp-dialog" role="dialog" aria-modal="true" aria-labelledby="acp-cancel-title"><h3 id="acp-cancel-title">取消原单关联</h3><p>{cancelLink.targetSnapshot?.label && cancelLink.targetSnapshot.label !== cancelLink.targetId ? cancelLink.targetSnapshot.label : '所选原业务记录'}</p><p>取消后保留原关联与取消原因，不删除原订单或发票。</p><label>取消依据<textarea value={cancelNote} disabled={busy} maxLength={3000} onChange={event => setCancelNote(event.target.value)} placeholder="说明关联错误或需要更换的依据"/></label>{error && <p className="acp-alert">{error}</p>}<div className="acp-actions"><button disabled={busy} onClick={() => {setCancelLink(null); setCancelNote('');}}>返回</button><button className="acp-primary" disabled={busy || !cancelNote.trim()} onClick={() => void removeLink()}>确认取消关联</button></div></section></div>}
  </section>;
}
function LayersPlaceholder() {return <FileText size={30} aria-hidden="true"/>;}
