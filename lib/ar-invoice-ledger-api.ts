import {z} from 'zod';
import * as XLSX from 'xlsx';
import {all,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {arAccess,arCurrencies,arDay} from './ar-workspace';
import {arInvoiceAttachmentDto,arInvoiceData,arInvoiceDto,arInvoiceDuplicateReason,arInvoiceKey,arInvoiceRequire,arInvoiceStatementSnapshot} from './ar-invoice-ledger';
import {arProfileCoreColumns,arProfileOptionalColumns,type ArProfileField} from './ar-customer-profiles';

const id=z.string().trim().min(1).max(160),text=(n=3000)=>z.string().trim().max(n).default('');
const amount=z.number().int().nonnegative().max(100_000_000_000),signedAmount=z.number().int().min(-100_000_000_000).max(100_000_000_000),day=z.string().trim().refine(v=>!v||!!arDay(v),'日期须为空或有效 YYYY-MM-DD');
const currency=z.enum(arCurrencies),token=z.string().uuid(),edit={id,version:z.number().int().positive(),token};
const manifestSchema=z.object({customerId:id,sourceCutoff:z.string().trim().regex(/^\d{1,6}$/),sourceAsOf:day.nullable(),invoices:z.array(z.object({invoiceNo:id,documentType:z.enum(['PI','INVOICE','UNKNOWN']),invoiceDate:day,currency:z.union([currency,z.literal('')]),amountCents:amount.nullable(),sourceSheet:z.string().min(1).max(100),sourceCells:z.array(z.string().max(100)).max(200),remarks:text(10000),issues:z.array(z.string().max(2000)).max(200)}).strict()).min(1).max(200),statementRows:z.array(z.object({sourceRow:z.number().int().positive(),invoiceNo:text(160),date:text(120),chargeCents:amount.nullable(),receiptCents:amount.nullable(),balanceCents:signedAmount.nullable(),remark:text(10000)}).strict()).max(10000),issues:z.array(z.string().max(2000)).max(1000)}).strict();
const noteSchema=z.object({...edit,note:text(10000)}).strict(),reconcileSchema=z.object({...edit,receivedCents:amount,reason:z.string().trim().min(2).max(10000)}).strict();
const statementSchema=z.object({customerId:id,currency,asOf:day.refine(Boolean,'请填写对账截止日'),token}).strict();
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.infer<T>{const r=schema.safeParse(value);if(!r.success)throw new AppError(r.error.issues.slice(0,5).map(e=>e.path.join('.')+'：'+e.message).join('；'));return r.data;}
async function hash(value:string|ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(n=>n.toString(16).padStart(2,'0')).join('');}
function requireWriter(s:State,m:Member){if(!arAccess(s,m).canConfigure)throw new AppError('当前仅可由有权管理员维护历史档案；只读取数权限不能导入、补证或核对。',403);}
function current(row:Entity,version:number){if(row.version!==version)throw new AppError('资料已更新，请刷新后核对当前版本。',409);}
function customer(s:State,id:string){const c=all(s,'customer_account').find(c=>c.id===id);if(!c?.active)throw new AppError('请选择现有有效客户。');return c;}
function replay(s:State,m:Member,action:string,value:string,fp:string){const r=all(s,'ar_invoice_request').find(r=>r.id==='ar_invoice_request_'+value);if(!r)return null;if(r.actorId!==m.id||r.action!==action||r.fingerprint!==fp)throw new AppError('操作标识已用于其他请求。',409);return json({...r.result,idempotent:true});}
async function save(s:State,m:Member,action:string,value:string,fp:string,updates:Entity[],result:Record<string,unknown>,before:Entity|null=null){
 const at=now(),item=updates[0],history={id:newId('ar_invoice_history'),kind:'ar_invoice_history',customerId:item.customerId,teamId:clean(item.teamId),targetId:item.id,action,actorId:m.id,createdAt:at,before:before?structuredClone(before):null,after:structuredClone(item)};
 const response={ok:true,...result};await commit(s.revision,[...updates,history,audit(m,item,before,action,'历史发票工作空间'),{id:'ar_invoice_request_'+value,kind:'ar_invoice_request',actorId:m.id,customerId:item.customerId,action,fingerprint:fp,result:response,createdAt:at}]);return json(response);
}
function filename(name:string){return name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,240);}
async function uploadFile(form:FormData,workbook=false){
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>20*1024*1024)throw new AppError('请选择非空且不超过 20 MB 的文件。');
 const name=filename(file.name),ext=name.split('.').at(-1)?.toLowerCase()||'';
 const types:Record<string,string>={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
 if(!types[ext]||workbook&&ext!=='xlsx')throw new AppError(workbook?'历史导入须上传 XLSX 原文件。':'付款凭证支持 PDF、PNG、JPG、WebP 或 XLSX。');
 const bytes=await file.arrayBuffer(),data=new Uint8Array(bytes);if(ext==='xlsx'&&(data[0]!==0x50||data[1]!==0x4b))throw new AppError('XLSX 文件内容无效。');
 if(ext==='pdf'&&new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw new AppError('PDF 文件内容无效。');
 if(ext==='png'&&![137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v)||['jpg','jpeg'].includes(ext)&&!(data[0]===255&&data[1]===216&&data[2]===255)||ext==='webp'&&!(new TextDecoder().decode(data.slice(0,4))==='RIFF'&&new TextDecoder().decode(data.slice(8,12))==='WEBP'))throw new AppError('图片内容与文件类型不一致。');
 return {name,bytes,size:file.size,contentType:types[ext],hash:await hash(bytes)};
}
function sheets(bytes:ArrayBuffer){
 const data=new Uint8Array(bytes),dv=new DataView(bytes);let inflated=0,entries=0;
 for(let i=0;i<data.length-46;i++)if(dv.getUint32(i,true)===0x02014b50){inflated+=dv.getUint32(i+24,true);entries++;i+=45+dv.getUint16(i+28,true)+dv.getUint16(i+30,true)+dv.getUint16(i+32,true);}
 if(inflated>100*1024*1024||entries>3000)throw new AppError('工作簿展开后过大，请拆分来源文件。');
 try{return XLSX.read(bytes,{type:'array',bookSheets:true}).SheetNames;}catch{throw new AppError('不能读取 XLSX 原工作簿。');}
}
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(v:unknown)=>typeof v==='number'?(v/100).toFixed(2):'待核对 / Unknown';
function legacyStatementHtml(d:Entity){
 const historicalBasis=(r:Entity)=>typeof r.historicalReceivedCents==='number'?`已核对历史实收 ${money(r.historicalReceivedCents)}；历史净应收未收 ${money(r.historicalBalanceCents)}；${r.sourceAsOf?'原表截至 '+r.sourceAsOf:'原表截至日不明'}${r.confirmedForStatement?'':'；不代表本对账截至日余额，不计入截至日合计'}`:'';
 const table=(rows:Entity[])=>`<table><thead><tr><th>Invoice</th><th>Date</th><th>Historical STATEMENT net receivable / 历史净应收</th><th>As-of applied receipts / 截至日实收</th><th>As-of outstanding / 截至日未收</th><th>Basis / Notes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.invoiceNo)}</td><td>${escape(r.invoiceDate||'Unknown')}</td><td>${money(r.amountCents)}</td><td>${money(r.receivedCents)}</td><td>${money(r.balanceCents)}</td><td>${escape([r.sourceSheet,historicalBasis(r),r.statementIssue,r.note,...(r.issues||[])].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table>`;
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Draft statement ${escape(d.customerCode)}</title><style>body{font:13px/1.6 Arial,sans-serif;max-width:1120px;margin:30px auto;padding:20px;color:#20352f}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}h1{font-size:24px}.draft{color:#a33;font-weight:bold}@media print{body{margin:0;padding:0}}</style><h1>DOON · STATEMENT</h1><p class="draft">DRAFT · 历史资料核对草稿，含未知项，不是完整正式对账单；净应收不等于 PI 票面金额</p><p>${escape(d.customerCode)} · ${escape(d.customer)} · ${escape(d.currency)} · 截止 ${escape(d.asOf)}</p><p>快照 ${escape(d.id)} · 生成 ${escape(d.createdAt)}</p><h2>已核对部分</h2>${table(d.lines.filter((r:Entity)=>r.confirmedForStatement))}<p>已核对历史净应收 ${money(d.totals.confirmedAmountCents)} · 已核对累计实收 ${money(d.totals.confirmedReceivedCents)} · 已核对历史未收 ${money(d.totals.confirmedBalanceCents)}</p><h2>待核对与版本差异</h2>${table(d.lines.filter((r:Entity)=>!r.confirmedForStatement))}<p>唯一版本且日期已知的历史净应收部分 ${money(d.totals.knownAmountCents)} · 待核对 ${d.totals.pendingCount} 项 · 同号版本冲突 ${d.totals.duplicateCount} 项</p><p>本档案完整实收 ${money(d.totals.receivedCents)} · 本档案完整未收 ${money(d.totals.balanceCents)}</p><ul>${d.issues.map((v:string)=>`<li>${escape(v)}</li>`).join('')}</ul><p>${escape(d.basis)}</p></html>`;
}
function statementHtml(d:Entity,requestOrigin:string){
 // Existing documents retain their previous presentation and never read a live customer profile.
 if(d.presentationVersion!==1||!d.customerProfileSnapshot)return legacyStatementHtml(d);
 const profile=d.customerProfileSnapshot,language=['zh','en','bilingual'].includes(profile.language)?profile.language:'bilingual';
 const t=(zh:string,en:string)=>language==='zh'?zh:language==='en'?en:`${zh} / ${en}`;
 let origin='';try{const url=new URL(requestOrigin);if(['http:','https:'].includes(url.protocol))origin=url.origin;}catch{}
 const fields:ArProfileField[]=(Array.isArray(profile.customFields)?profile.customFields:[]).filter((f:Entity)=>f&&/^custom_[a-z][a-z0-9_]{0,39}$/.test(f.key)&&['text','number','date'].includes(f.type));
 const definitions=new Map<string,{key:string;labelZh:string;labelEn:string}>([...arProfileCoreColumns,...arProfileOptionalColumns,...fields].map(c=>[c.key,c]));
 const requested=(Array.isArray(profile.statementColumns)?profile.statementColumns:[]).filter((key:unknown):key is string=>typeof key==='string'&&definitions.has(key));
 // Financial columns are mandatory even if a stored presentation configuration is malformed.
 const columns=[...new Set([...requested,...arProfileCoreColumns.map(c=>c.key)])];
 const amounts=new Set(['amountCents','receivedCents','balanceCents']);
 const formattedMoney=(value:unknown)=>typeof value==='number'?money(value):t('待核对','Unknown');
 const typedValue=(field:ArProfileField,value:unknown)=>{
  if(value===null||value===undefined||value==='')return field.required?t('待填写','Required value missing'):'—';
  if(field.type==='text'&&typeof value==='string')return value;
  if(field.type==='number'&&typeof value==='number'&&Number.isFinite(value))return String(value);
  if(field.type==='date'&&typeof value==='string'&&arDay(value)===value)return value;
  return t('字段类型待核对','Field type requires review');
 };
 const links=(r:Entity):Entity[]=>(Array.isArray(r.sourceLinksSnapshot)?r.sourceLinksSnapshot:[]).filter((link:Entity)=>link?.status==='active'&&!link.targetUnavailable&&link.targetSnapshot);
 const cell=(r:Entity,key:string)=>{
  if(amounts.has(key))return formattedMoney(r[key]);
  if(key==='currency')return clean(r.currency||d.currency);
  if(key==='orderNo'||key==='projectNo')return [...new Set(links(r).map(link=>clean(link.targetSnapshot[key])).filter(Boolean))].join(' · ')||t('待关联','Not linked');
  const field=fields.find(f=>f.key===key);
  if(field){
   if(r.extraValuesState==='stale')return t('待重新映射','Remapping required');
   return typedValue(field,r.extraValuesState==='current'?r.extraValuesSnapshot?.values?.[key]:null);
  }
  return clean(r[key])||(key==='invoiceDate'?t('待核对','Unknown'):'—');
 };
 const table=(rows:Entity[])=>`<div class="table-scroll"><table><thead><tr>${columns.map(key=>{const c=definitions.get(key)!;return `<th>${escape(t(c.labelZh,c.labelEn))}</th>`;}).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(key=>`<td>${escape(cell(r,key))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 const historicalBasis=(r:Entity)=>typeof r.historicalReceivedCents==='number'?`已核对历史实收 ${money(r.historicalReceivedCents)}；历史净应收未收 ${money(r.historicalBalanceCents)}；${r.sourceAsOf?'原表截至 '+r.sourceAsOf:'原表截至日不明'}${r.confirmedForStatement?'':'；不代表本对账截至日余额，不计入截至日合计'}`:'';
 const oldFieldEvidence=(r:Entity)=>{
  if(r.extraValuesState!=='stale'||!r.extraValuesSnapshot)return '';
  const extra=r.extraValuesSnapshot,oldFields:ArProfileField[]=(Array.isArray(extra.schemaSnapshot)?extra.schemaSnapshot:[]).filter((f:Entity)=>f&&/^custom_[a-z][a-z0-9_]{0,39}$/.test(f.key)&&['text','number','date'].includes(f.type));
  return `<p>${escape(t('历史字段原值，仅作依据，不用于当前列','Historical field values are evidence only and are not used in current columns'))}：${oldFields.map(f=>escape(t(f.labelZh,f.labelEn)+': '+typedValue(f,extra.values?.[f.key]))).join(' · ')}</p>`;
 };
 const provenance=(r:Entity)=>{
  const sourceCells=Array.isArray(r.sourceCells)?r.sourceCells.map((v:unknown)=>clean(v)).filter(Boolean).join(', '):'';
  const sourceBatch=(Array.isArray(d.sourceBatches)?d.sourceBatches:[]).find((batch:Entity)=>batch.id===r.batchId),sourceFilename=clean(sourceBatch?.filename)||t('原工作簿','Original workbook');
  const original=r.sourceAttachmentId&&origin?`<a href="${escape(origin+'/api/workspace/ar-invoice-file?id='+encodeURIComponent(r.sourceAttachmentId))}">${escape(sourceFilename)}</a>`:escape(r.sourceAttachmentId?sourceFilename:t('原件附件待核对','Original attachment requires review'));
  const extra=r.extraValuesSnapshot,extraBasis=extra?`${t('扩展值版本','Extra value version')} ${extra.version} · ${t('绑定发票版本','Bound invoice version')} ${extra.invoiceVersion} · ${t('字段配置版本','Field profile version')} ${extra.profileVersion}`:'';
  const sourceTypes:Record<string,string>={order:t('订单','Order'),customer_project:t('客户项目','Customer project'),project_billing_document:t('项目业务单据','Project billing document'),handoff_business_document:t('交接业务单据','Handoff business document'),service_record:t('订单应收','Order receivable'),ar_invoice:t('历史发票','Historical invoice')};
  const sourceLinks=links(r).map(link=>{
   const target=link.targetSnapshot,kind=clean(target.kind),label=clean(target.label),businessNo=clean(kind==='order'?target.orderNo:kind==='customer_project'?target.projectNo:target.documentNo)||(label&&label!==link.targetId&&label!==target.id?label:t('业务编号待补','Business number unavailable'));
   return `${sourceTypes[kind]||t('业务来源','Business source')} · ${businessNo} · ${t('来源版本','Source version')} ${link.targetVersion}${link.targetChanged?' · '+t('原单版本已变更，此处保留关联时依据','Target changed; original linked version retained'):''}`;
  });
  return `<article><h3>${escape(r.invoiceNo)}</h3><p>${escape([r.sourceSheet,sourceCells].filter(Boolean).join(' · '))} · ${original}</p><p>${escape([historicalBasis(r),r.statementIssue,r.note,...(r.issues||[]),...(r.fieldIssues||[])].filter(Boolean).join(' · '))}</p>${extraBasis?`<p>${escape(extraBasis)}</p>`:''}${sourceLinks.length?`<p>${escape(t('原单关联快照','Source link snapshot'))}：${escape(sourceLinks.join(' · '))}</p>`:''}${oldFieldEvidence(r)}</article>`;
 };
 const title=clean(profile.documentTitle)||'STATEMENT',htmlLanguage=language==='en'?'en':'zh-CN';
 return `<!doctype html><html lang="${htmlLanguage}"><meta charset="utf-8"><title>${escape(title)} · ${escape(d.customerCode)}</title><style>body{font:13px/1.6 Arial,sans-serif;max-width:1280px;margin:30px auto;padding:20px;color:#20352f}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}h1{font-size:24px}.draft{color:#a33;font-weight:bold}article{border-top:1px solid #ddd;margin-top:16px;overflow-wrap:anywhere}@media print{body{margin:0;padding:0}.table-scroll{overflow:visible}tr{break-inside:avoid}}</style><h1>${escape(title)}</h1><p class="draft">DRAFT · ${escape(t('历史资料核对草稿，含未知项，不是完整正式对账单；净应收不等于PI票面金额','Historical review draft with unknown items, not a complete final statement; net receivables are not PI face amounts'))}</p><p>${escape(d.customerCode)} · ${escape(d.customer)} · ${escape(d.currency)} · ${escape(t('截止','As of'))} ${escape(d.asOf)}</p><p data-statement-id="${escape(d.id)}">${escape(t('生成','Created'))} ${escape(d.createdAt)} · ${escape(t('客户模板版本','Customer profile version'))} ${escape(profile.version)}</p>${profile.note?`<p>${escape(profile.note)}</p>`:''}<h2>${escape(t('已核对部分','Confirmed portion'))}</h2>${table(d.lines.filter((r:Entity)=>r.confirmedForStatement))}<p>${escape(t('已核对历史净应收','Confirmed historical net receivables'))} ${formattedMoney(d.totals.confirmedAmountCents)} · ${escape(t('已核对累计实收','Confirmed cumulative receipts'))} ${formattedMoney(d.totals.confirmedReceivedCents)} · ${escape(t('已核对历史未收','Confirmed historical outstanding'))} ${formattedMoney(d.totals.confirmedBalanceCents)}</p><h2>${escape(t('待核对与版本差异','Pending review and version differences'))}</h2>${table(d.lines.filter((r:Entity)=>!r.confirmedForStatement))}<p>${escape(t('唯一版本且日期已知的历史净应收部分','Known historical net receivables with unique versions and dates'))} ${formattedMoney(d.totals.knownAmountCents)} · ${escape(t('待核对项目','Pending items'))} ${escape(d.totals.pendingCount)} · ${escape(t('同号版本冲突','Invoice version conflicts'))} ${escape(d.totals.duplicateCount)}</p><p>${escape(t('本档案完整实收','Complete archived receipts'))} ${formattedMoney(d.totals.receivedCents)} · ${escape(t('本档案完整未收','Complete archived outstanding'))} ${formattedMoney(d.totals.balanceCents)}</p><ul>${d.issues.map((v:string)=>`<li>${escape(v)}</li>`).join('')}</ul><h2>${escape(t('逐票来源与核对依据','Invoice provenance and review basis'))}</h2><p>${escape(t('来源依据始终保留，不随可选列隐藏。原件链接返回生成下载文件时的中台，需要登录及原件访问权限。','Provenance remains visible when optional columns are hidden. Original file links return to the workspace used for this download and require login and source permissions.'))}</p>${d.lines.map(provenance).join('')}<p>${escape(d.basis)}</p></html>`;
}
export async function arInvoiceLedgerGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-invoice-data','ar-invoice-file','ar-invoice-statement-file'].includes(action))return null;
 const p=new URL(req.url).searchParams;if(action==='ar-invoice-data')return json(arInvoiceData(s,m,parse(text(160),p.get('customerId')||'')));
 if(action==='ar-invoice-statement-file'){const d=arInvoiceRequire(s,m,'ar_invoice_statement',p.get('id')||'');return new Response(statementHtml(d,new URL(req.url).origin),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox allow-modals",'X-Content-Type-Options':'nosniff'}});}
 const a=arInvoiceRequire(s,m,'ar_invoice_attachment',p.get('id')||''),object=await bucket().get(a.fileKey);if(!object)throw new AppError('附件原件暂不可用，原附件记录保留。',404);
 return new Response(object.body,{headers:{'Content-Type':a.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}});
}
export async function arInvoiceLedgerPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ar-invoice-import','ar-invoice-note','ar-invoice-proof','ar-invoice-reconcile','ar-invoice-statement'].includes(action))return null;
 requireWriter(s,m);
 if(action==='ar-invoice-import'){
  const form=await req.formData(),value=parse(token,form.get('token')),raw=String(form.get('manifest')||'');if(raw.length>4*1024*1024)throw new AppError('导入清单过大。');let manifest:unknown;try{manifest=JSON.parse(raw);}catch{throw new AppError('导入清单 JSON 无效。');}
  const input=parse(manifestSchema,manifest);customer(s,input.customerId);const file=await uploadFile(form,true),fp=await hash(JSON.stringify({input,hash:file.hash}));const repeated=replay(s,m,action,value,fp);if(repeated)return repeated;
  const old=all(s,'ar_invoice_import').find(b=>b.customerId===input.customerId&&b.hash===file.hash);if(old){if(old.manifestHash!==await hash(JSON.stringify(input)))throw new AppError('同一客户原文件已导入，但当前解析清单不同，请保留原批次并核对差异。',409);return json({ok:true,idempotent:true,batch:old,invoices:all(s,'ar_invoice').filter(r=>r.batchId===old.id).map(r=>arInvoiceDto(s,r))});}
  const names=sheets(file.bytes),keys=new Set<string>();for(const r of input.invoices){if(!names.includes(r.sourceSheet))throw new AppError('导入工作表不存在于原工作簿：'+r.sourceSheet);const sequence=r.invoiceNo.match(/(\d+)\s*$/);if(!sequence||Number(sequence[1])>Number(input.sourceCutoff))throw new AppError('发票号超出本批截止范围或无法明确序号：'+r.invoiceNo);const key=arInvoiceKey(r.invoiceNo)+'|'+r.sourceSheet;if(keys.has(key))throw new AppError('同一工作表重复登记发票。');keys.add(key);}
  const at=now(),batch:Entity={...input,id:newId('ar_invoice_import'),kind:'ar_invoice_import',filename:file.name,hash:file.hash,manifestHash:await hash(JSON.stringify(input)),teamId:'',status:'archived',version:1,invoiceCount:input.invoices.length,createdAt:at,createdById:m.id};delete batch.invoices;
  const original:Entity={id:newId('ar_invoice_attachment'),kind:'ar_invoice_attachment',customerId:input.customerId,teamId:'',batchId:batch.id,invoiceId:'',category:'source-workbook',filename:file.name,hash:file.hash,size:file.size,contentType:file.contentType,fileKey:newId('ar_invoice_file'),note:'历史原工作簿；保留原文件',createdAt:at,createdById:m.id,version:1};batch.attachmentId=original.id;
  const invoices:Entity[]=input.invoices.map(r=>({...r,id:newId('ar_invoice'),kind:'ar_invoice',customerId:input.customerId,batchId:batch.id,teamId:'',sourceVersion:all(s,'ar_invoice').filter(x=>x.customerId===input.customerId&&arInvoiceKey(x.invoiceNo)===arInvoiceKey(r.invoiceNo)).length+input.invoices.slice(0,input.invoices.indexOf(r)).filter(x=>arInvoiceKey(x.invoiceNo)===arInvoiceKey(r.invoiceNo)).length+1,status:'pending',version:1,note:'',receivedCents:null,createdAt:at,updatedAt:at,createdById:m.id,sourceAttachmentId:original.id,amountBasis:'historical-statement-net',contributesToCash:false}));
  await bucket().put(original.fileKey,file.bytes);return save(s,m,action,value,fp,[batch,original,...invoices],{batch,invoices:invoices.map(r=>arInvoiceDto(s,r)),attachment:arInvoiceAttachmentDto(original)});
 }
 if(action==='ar-invoice-proof'){
  const form=await req.formData(),invoiceId=parse(id,form.get('invoiceId')),version=parse(z.coerce.number().int().positive(),form.get('version')),value=parse(token,form.get('token')),note=parse(text(10000),form.get('note')||''),before=arInvoiceRequire(s,m,'ar_invoice',invoiceId),file=await uploadFile(form),fp=await hash(JSON.stringify({invoiceId,version,note,hash:file.hash,filename:file.name}));const repeated=replay(s,m,action,value,fp);if(repeated)return repeated;current(before,version);
  const prior=all(s,'ar_invoice_attachment').find(a=>a.invoiceId===invoiceId&&a.category==='payment-proof'&&a.hash===file.hash&&a.note===note);if(prior)return json({ok:true,idempotent:true,item:arInvoiceDto(s,before),attachment:arInvoiceAttachmentDto(prior)});
  const at=now(),item={...before,version:before.version+1,updatedAt:at,updatedById:m.id},a:Entity={id:newId('ar_invoice_attachment'),kind:'ar_invoice_attachment',customerId:before.customerId,teamId:before.teamId,batchId:before.batchId,invoiceId,category:'payment-proof',filename:file.name,hash:file.hash,size:file.size,contentType:file.contentType,fileKey:newId('ar_invoice_file'),note,createdAt:at,createdById:m.id,version:1,evidenceOnly:true};await bucket().put(a.fileKey,file.bytes);const next={...s,records:[...s.records,a]};return save(s,m,action,value,fp,[item,a],{item:arInvoiceDto(next,item),attachment:arInvoiceAttachmentDto(a)},before);
 }
 const raw=await req.json();
 if(action==='ar-invoice-statement'){
  const input=parse(statementSchema,raw);customer(s,input.customerId);const fp=await hash(JSON.stringify(input)),repeated=replay(s,m,action,input.token,fp);if(repeated)return repeated;
  const snapshot=arInvoiceStatementSnapshot(s,m,input.customerId,input.currency,input.asOf);if(!snapshot.lines.length)throw new AppError('当前客户、币种和截止范围没有可生成对账草稿的历史发票。');const statement:Entity={...snapshot,id:newId('ar_invoice_statement'),kind:'ar_invoice_statement',version:1,createdAt:now(),createdById:m.id};return save(s,m,action,input.token,fp,[statement],{statement});
 }
 if(action==='ar-invoice-note'){
  const input=parse(noteSchema,raw),before=arInvoiceRequire(s,m,'ar_invoice',input.id),fp=await hash(JSON.stringify(input)),repeated=replay(s,m,action,input.token,fp);if(repeated)return repeated;current(before,input.version);
  const item={...before,note:input.note,version:before.version+1,updatedAt:now(),updatedById:m.id};return save(s,m,action,input.token,fp,[item],{item:arInvoiceDto(s,item)},before);
 }
 const input=parse(reconcileSchema,raw),before=arInvoiceRequire(s,m,'ar_invoice',input.id),fp=await hash(JSON.stringify(input)),repeated=replay(s,m,action,input.token,fp);if(repeated)return repeated;current(before,input.version);
 if(before.status==='confirmed')throw new AppError('该版本已有历史累计核对，请保留原核对记录，不重复确认。',409);
 if(!Number.isSafeInteger(before.amountCents)||!arCurrencies.includes(before.currency))throw new AppError('应收金额或币种尚不明确，不能核对累计实收。');if(input.receivedCents>before.amountCents)throw new AppError('历史累计实收不能超过该版应收金额。');const duplicate=arInvoiceDuplicateReason(s,before);if(duplicate)throw new AppError(duplicate,409);
 const at=now(),receipt:Entity={id:newId('ar_invoice_reconciliation'),kind:'ar_invoice_reconciliation',customerId:before.customerId,teamId:before.teamId,invoiceId:before.id,batchId:before.batchId,invoiceNo:before.invoiceNo,invoiceVersion:before.version,currency:before.currency,amountCents:input.receivedCents,reason:input.reason,sourceAsOf:all(s,'ar_invoice_import').find(b=>b.id===before.batchId)?.sourceAsOf||null,createdAt:at,createdById:m.id,version:1,entryType:'historical-cumulative',contributesToCash:false};
 const item={...before,status:'confirmed',receivedCents:input.receivedCents,reconciliationId:receipt.id,reconciliationReason:input.reason,confirmedAt:at,confirmedById:m.id,version:before.version+1,updatedAt:at,updatedById:m.id};return save(s,m,action,input.token,fp,[item,receipt],{item:arInvoiceDto(s,item),receipt},before);
}
