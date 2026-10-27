import {z} from 'zod';
import {all,newId,now,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {canConfigureIeQuotes,canReadIeQuote} from './ie-quote-access';
import {calculateIeQuote,currentIeQuote,ieQuoteIssues,ieQuoteVersion,releasedIeSnapshot,type IeQuote} from './ie-quotes';
import {ieQuoteTemplate,ieTemplateFingerprint,ieTemplateStatus,type IeQuoteTemplate} from './ie-quote-template';
import {IE_TEMPLATE_MAX_BYTES,IeWorkbookError,exportIeQuoteInternalWorkbook,exportIeQuoteDraftWorkbook,inspectIeQuoteTemplate,prepareIeQuoteTemplate} from './ie-quote-workbook';
const mapping=z.array(z.object({sheetName:z.string().trim().min(1).max(120),lineId:z.string().trim().min(1).max(120)}).strict()).min(1).max(100);
const safeFilename=(name:string)=>name.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,160);
function quoted(s:State,m:Member,id:string,version:number){if(!Number.isSafeInteger(version)||version<1)throw new AppError('请选择明确的工程报价版本。');const q=ieQuoteVersion(s,id,version),current=currentIeQuote(s,id);if(!q||!current||current.customerAccountId!==q.customerAccountId||!canReadIeQuote(s,m,current)||!canReadIeQuote(s,m,q))throw new AppError('无权访问该工程报价版本。',403);return q;}
export async function buildIeQuoteWorkbookAttachment(s:State,m:Member,q:IeQuote){
 if(!canReadIeQuote(s,m,q))throw new AppError('无权读取此工程报价附件。',403);
 const template=ieQuoteTemplate(s,q);if(!template)throw new AppError('此客户、款色和图纸版本尚未登记原 Excel 打印模板；请管理员先上传并逐款映射。',409);
 const issues=ieQuoteIssues(s,q,q.id);if(issues.length)throw new AppError('内部报价导出前请补全并核对：'+issues.slice(0,6).join('；'));
 const object=await bucket().get(template.preparedFileKey);if(!object)throw new AppError('原版打印模板副本暂不可用。',404);
 try{
  const tooling=q.tooling.map(t=>{if(t.chargeMode==='already_charged'){const registry=all(s,'ie_quote_tooling').find(r=>r.id===t.toolingId&&r.customerAccountId===q.customerAccountId);return {...t,evidence:t.evidence||String(registry?.evidence||'')};}if(t.chargeMode==='included_in_batch'){const source=t.chargeVersion?releasedIeSnapshot(s,t.chargeQuoteId,t.chargeVersion):null;return {...t,evidence:source?`共用来源 ${source.quoteNo} / R${source.revision} / V${source.version}`:t.evidence};}return t;});
  const bytes=new Uint8Array(await new Response(object.body).arrayBuffer()),result=await exportIeQuoteInternalWorkbook({...q,tooling,costs:calculateIeQuote(q)},{issues:[],template:{bytes,expectedSha256:template.preparedSha256,sheetBindings:template.sheetBindings}});
  const prefix=q.status==='released'?'已复核内部报价':'未发布内部核价',filename=safeFilename(`${prefix}_${q.quoteNo}_R${q.revision}_V${q.version}.xlsx`),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(result.bytes).buffer)),sha256=[...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
  return {filename,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:new Uint8Array(result.bytes),sha256,size:result.bytes.length,templateId:template.id,templateSha256:template.preparedSha256};
 }catch(e){if(e instanceof IeWorkbookError)throw new AppError(e.message,409);throw e;}
}
export async function ieWorkbookGet(action:string,url:URL,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-template-status','ie-quote-export','ie-quote-draft-export'].includes(action))return null;
 const q=quoted(s,m,url.searchParams.get('id')||'',Number(url.searchParams.get('version')));
 if(action==='ie-quote-template-status')return json({templateStatus:ieTemplateStatus(s,m,q)});
 if(action==='ie-quote-draft-export'){
  const template=ieQuoteTemplate(s,q);let source:Parameters<typeof exportIeQuoteDraftWorkbook>[1]['template'];
  if(template){const object=await bucket().get(template.preparedFileKey);if(!object)throw new AppError('已登记的原版打印模板副本暂不可用，请恢复后再导出。',404);source={bytes:new Uint8Array(await new Response(object.body).arrayBuffer()),expectedSha256:template.preparedSha256,sheetBindings:template.sheetBindings};}
  try{const result=await exportIeQuoteDraftWorkbook(q,{issues:ieQuoteIssues(s,q,q.id),template:source}),filename=safeFilename(`未审填报草稿_${q.quoteNo}_R${q.revision}_V${q.version}.xlsx`);return new Response(new Uint8Array(result.bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-IE-Workbook-Mode':result.templateMode}});}catch(e){if(e instanceof IeWorkbookError)throw new AppError(e.message,409);throw e;}
 }
 const attachment=await buildIeQuoteWorkbookAttachment(s,m,q);
 return new Response(new Uint8Array(attachment.bytes).buffer,{headers:{'Content-Type':attachment.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function ieWorkbookPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='ie-quote-template-register')return null;if(!canConfigureIeQuotes(m))throw new AppError('原 Excel 可能含历史客户资料，仅管理员可上传并登记打印模板。',403);
 const form=await req.formData(),quoteId=String(form.get('quoteId')||''),version=Number(form.get('version')),q=quoted(s,m,quoteId,version);
 if(currentIeQuote(s,q.id)?.version!==version)throw new AppError('工程报价已更新，请刷新后绑定当前版本模板。',409);
 if(form.get('acknowledgeRemoveUnmapped')!=='true')throw new AppError('请明确确认：原件私有保留；打印副本仅保留映射款式，去除其他历史和辅助表。');
 let raw:unknown;try{raw=JSON.parse(String(form.get('sheetBindings')||''));}catch{throw new AppError('款式与 STYLE 表映射格式无效。');}const parsed=mapping.safeParse(raw);if(!parsed.success)throw new AppError('请逐款指定原表 STYLE 名称。');const sheetBindings=parsed.data;
 if(sheetBindings.length!==q.lines.length||new Set(sheetBindings.map(b=>b.lineId)).size!==q.lines.length||new Set(sheetBindings.map(b=>b.sheetName)).size!==sheetBindings.length||sheetBindings.some(b=>!q.lines.some(l=>l.id===b.lineId)))throw new AppError('工程报价每个款式必须唯一对应一个原 Excel STYLE 表。');
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>IE_TEMPLATE_MAX_BYTES||!file.name.toLowerCase().endsWith('.xlsx'))throw new AppError('请上传不超过 12 MB 的原版 XLSX 模板。');
 const bytes=new Uint8Array(await file.arrayBuffer());
 try{
  const inspected=await inspectIeQuoteTemplate(bytes),key=(v:string)=>v.normalize('NFKC').trim().toUpperCase();
  for(const b of sheetBindings){const sheet=inspected.sheets.find(v=>v.name===b.sheetName),line=q.lines.find(l=>l.id===b.lineId)!;if(!sheet||key(sheet.customerCode)!==key(q.customerCode)||key(sheet.model)!==key(line.model))throw new AppError(`原表 ${b.sheetName} 的客户编号或厂款与当前报价不符，不能沿用其他客户或款式图片。`);}
  const prepared=await prepareIeQuoteTemplate(bytes,{sheetNames:sheetBindings.map(b=>b.sheetName)}),templates=all(s,'ie_quote_template').filter(t=>t.quoteId===q.id),t:IeQuoteTemplate={id:newId('ie_quote_template'),kind:'ie_quote_template',quoteId:q.id,quoteRevision:q.revision,quoteVersion:q.version,version:Math.max(0,...templates.map(t=>t.version))+1,customerAccountId:q.customerAccountId,fingerprint:ieTemplateFingerprint(q),sheetBindings,sourceFileKey:newId('ie_quote_original'),preparedFileKey:newId('ie_quote_print_template'),sourceSha256:prepared.sourceSha256,preparedSha256:prepared.inspection.sha256,filename:safeFilename(file.name),registeredAt:now(),registeredBy:m.name,removedSheetCount:prepared.removedSheetNames.length};
  // Fresh immutable keys prevent failed optimistic registration from replacing
  // any prior template or original attachment. Storage references stay private.
  await bucket().put(t.sourceFileKey,new Uint8Array(bytes).buffer);await bucket().put(t.preparedFileKey,new Uint8Array(prepared.bytes).buffer);
  const {sourceFileKey:_source,preparedFileKey:_prepared,...safe}=t;await commit(s.revision,[t,audit(m,{id:t.id,kind:t.kind,quoteId:q.id},null,'登记原 Excel 打印模板并保留私有原件','IE 工程报价',safe)]);
  return json({ok:true,templateStatus:ieTemplateStatus({...s,records:[...s.records,t]},m,q),removedSheetCount:t.removedSheetCount});
 }catch(e){if(e instanceof IeWorkbookError)throw new AppError(e.message,409);throw e;}
}
