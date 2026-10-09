import {z} from 'zod';
import * as XLSX from 'xlsx';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';
import {assignedCustomerQuoteAccount,isCustomerQuoteAdministrator} from './customer-quote-access';
import {canReadCustomerQuote,customerQuoteInput,quoteAccount,type CustomerQuote,type CustomerQuoteRevision} from './customer-quotes';
import {visibleCompletedCustomerQuotes,assertCustomerQuoteConfirmable} from './customer-quote-review';
import {parseCustomerQuoteTemplate,exportCustomerQuoteTemplate,validateCustomerQuoteTemplateOutput,assertCustomerQuoteTemplateExportable,type CustomerQuoteTemplate} from './customer-quote-template';

export type QuoteTemplateBinding={id:string;title:string;brand:string;businessType:string;rowCount:number;sourceHash:string;version:number};
export type TemplateQuote=CustomerQuote & {templateBinding?:QuoteTemplateBinding;templateMapping?:CustomerQuoteTemplate;templateFileKey?:string};
type TemplateRecord=Entity & {kind:'customer_quote_template';customerAccountId:string;title:string;brand:string;businessType:string;version:number;filename:string;fileKey:string;sourceHash:string;mapping:CustomerQuoteTemplate;createdAt:string;createdBy:string};
type OutputRecord=Entity & {kind:'customer_quote_template_output';quoteId:string;quoteVersion:number;customerAccountId:string;templateId:string;fileKey:string;filename:string;sourceHash:string;uploaded:boolean;createdAt:string;createdBy:string};
type Persist=(s:State,m:Member,q:CustomerQuote,before:CustomerQuote|null,action:string,additionalRecords?:Entity[])=>Promise<Response>;
const id=z.string().trim().min(1).max(120),short=z.string().trim().min(1).max(240);
const version=z.number().int().positive().refine(Number.isSafeInteger);
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{const result=schema.safeParse(input);if(!result.success)throw new AppError(result.error.issues.map(v=>`${v.path.join('.')}: ${v.message}`).slice(0,4).join('；'));return result.data;}
async function engine<T>(action:()=>Promise<T>):Promise<T>{try{return await action();}catch(error){if(error instanceof AppError)throw error;throw new AppError(error instanceof Error?error.message:'客户工作簿内容无效，请核对模板。');}}
function compatibleTemplate(template:CustomerQuoteTemplate){if(template.items.length>200||template.items.some(item=>item.id.length>100||(item.modelNames[0]||item.materialNumber).length>200||item.modelNames.join(' / ').length>200))throw new AppError('模板超出本期报价限制：最多 200 个物料，行编号不超过 100 字符、父款名称不超过 200 字符。请先核对客户模板。');}
function accountFor(s:State,m:Member,accountId:string){const account=quoteAccount(s,accountId);if(!account||!assignedCustomerQuoteAccount(s,m,account))throw new AppError('没有此客户模板的权限或客户已停用。',403);return account;}
function quoteFor(s:State,m:Member,quoteId:string){const quote=all(s,'customer_quote').find(item=>item.id===quoteId) as TemplateQuote|undefined;if(!quote||!canReadCustomerQuote(s,m,quote))throw new AppError('报价不存在或没有此客户权限。',403);return quote;}
function confirmedVersion(s:State,m:Member,quoteId:string,v:number){
 const current=quoteFor(s,m,quoteId),revisions=(all(s,'customer_quote_revision') as CustomerQuoteRevision[]).filter(item=>item.quoteId===quoteId&&item.version===v),snapshot=revisions.length===1?revisions[0].snapshot as TemplateQuote:undefined;
 if(!snapshot||snapshot.id!==quoteId||snapshot.version!==v||snapshot.status!=='confirmed'||!canReadCustomerQuote(s,m,snapshot)||(!isCustomerQuoteAdministrator(m,s)&&current.customerAccountId!==snapshot.customerAccountId))throw new AppError('只能使用有权限的已确认客户报价版本。',403);
 if(!snapshot.templateBinding||!snapshot.templateMapping||!snapshot.templateFileKey||!snapshot.customerAccountId)throw new AppError('此版本没有绑定客户模板。',409);
 return snapshot;
}
const publicTemplate=(t:TemplateRecord)=>({id:t.id,title:t.title,customerAccountId:t.customerAccountId,brand:t.brand,businessType:t.businessType,version:t.version,rowCount:t.mapping.rowMappings.length,itemCount:t.mapping.items.length,sourceFilename:t.filename,sourceHash:t.sourceHash,createdAt:t.createdAt,issues:t.mapping.issues});
async function readObject(key:string){const object=await bucket().get(key);if(!object)throw new AppError('归档原件暂不可用。',404);return new Response(object.body).arrayBuffer();}
function filename(value:string){return value.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,180);}
function download(bytes:ArrayBuffer|Uint8Array,name:string){return new Response(bytes as BodyInit,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename(name))}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function exportInput(q:TemplateQuote){
 assertCustomerQuoteConfirmable(q);
 if(q.pricingBasis!=='row_item')throw new AppError('此模板包含独立部件，请先确认按每行物料计价；整款计价须另行核对模板。');
 const template=q.templateMapping!,mapped=new Set(template.items.map(item=>item.id));
 if(q.lines.length!==mapped.size||q.lines.some(line=>!mapped.has(line.id)))throw new AppError('报价行与模板映射不一致，请重新核对模板及修订版本。');
 const prices=q.lines.map(line=>({itemId:line.id,materialNumber:line.materialNumber||'',description:line.descriptionEn,unit:line.unit||'unknown',unitPrice:line.unitPrice!,status:'confirmed' as const,quantity:line.quantity,quantityBasisEn:line.quantityBasisEn||'',scopeNotesEn:line.scopeNotesEn||'',factoryModel:line.factoryModel||'',customerModel:line.customerModel||'',component:line.component||'',side:line.side||'none',supplyStage:line.supplyStage||'unknown'}));
 return {template,prices,metadata:{quoteNo:q.quoteNo,quoteDate:q.quoteDate,validUntil:q.validUntil,currency:q.currency,brand:q.brand||'',businessType:q.businessType||'',quantityMode:q.quoteMode||'order',terms:['Pricing basis: each material-number item separately; prices on component rows are item prices.',...q.terms.map(term=>`${term.labelEn}: ${term.en}`)].concat((q.customerCharges||[]).map(charge=>`${charge.conditional?'Conditional charge - ':''}${charge.labelEn}: ${charge.amount} ${q.currency}; ${charge.basisEn}`),q.lines.map(line=>`${line.materialNumber}: ${line.component||'item'}; side: ${line.side||'none'}; supply stage: ${line.supplyStage||'unknown'}; quantity basis: ${line.quantityBasisEn||'not specified'}; supply scope: ${line.scopeNotesEn||line.descriptionEn}; tooling fee: ${line.toolingFee===null?'not separately specified; see listed charges':`${line.toolingFee} ${q.currency} per quoted item`}.`))}};
}
export function assertQuoteTemplateMapping(q:TemplateQuote){if(q.templateBinding){try{assertCustomerQuoteTemplateExportable(exportInput(q));}catch(error){if(error instanceof AppError)throw error;throw new AppError(error instanceof Error?error.message:'模板报价映射无效。');}}}
async function outputRecord(s:State,m:Member,q:TemplateQuote,bytes:ArrayBuffer,uploaded:boolean,originalName?:string){
 const sourceHash=await sha(bytes),existing=(all(s,'customer_quote_template_output') as OutputRecord[]).find(record=>record.quoteId===q.id&&record.quoteVersion===q.version&&record.sourceHash===sourceHash&&record.uploaded===uploaded);
 if(existing)return existing;
 const record:OutputRecord={id:newId('customer_quote_template_output'),kind:'customer_quote_template_output',quoteId:q.id,quoteVersion:q.version,customerAccountId:q.customerAccountId!,templateId:q.templateBinding!.id,fileKey:newId('customer_quote_template_output_file'),filename:filename(originalName||`${q.quoteNo}_R${q.version}_customer.xlsx`),sourceHash,uploaded,createdAt:now(),createdBy:m.name};
 await bucket().put(record.fileKey,bytes);
 const {fileKey,...safe}=record;
 await commit(s.revision,[record,audit(m,record,null,uploaded?'归档实际对客 Excel':'生成客户模板 Excel','客户报价工作台',safe)]);
 return record;
}

export async function customerQuoteTemplateGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-quote-templates','customer-quote-template-export','customer-quote-template-output-file','customer-quote-completed-export'].includes(action))return null;
 const url=new URL(req.url);
 if(action==='customer-quote-templates'){
  const accountId=parse(id,url.searchParams.get('customerAccountId'));accountFor(s,m,accountId);
  return json({templates:(all(s,'customer_quote_template') as TemplateRecord[]).filter(t=>t.customerAccountId===accountId).map(publicTemplate),canRegister:isCustomerQuoteAdministrator(m,s)});
 }
 if(action==='customer-quote-completed-export'){
  const rows=visibleCompletedCustomerQuotes(s,m),book=XLSX.utils.book_new();
  const data=rows.map(row=>({'客户编号':row.customerCode,'客户名称':row.customerName,'品牌':row.brand||'','业务类型':row.businessType||'','报价单号':row.quoteNo,'确认版本':row.quoteVersion,'报价日期':row.quoteDate,'有效期':row.validUntil,'厂款':row.factoryModel||row.model,'客款':row.customerModel||'','客户物料号':row.materialNumber||'','部件':row.component||'','左右':row.side||'none','供货状态':row.supplyStage||'finished','产品类型':row.productType||'frame','报价模式':row.quoteMode||'order','数量':row.quantity,'数量基准':row.quantityBasisEn||'','币种':row.currency,'单位':row.unit||'pair','对客单价':row.unitPrice??row.unitPriceUsd,'产品说明':row.descriptionEn,'确认时间':row.confirmedAt,'客户模板':row.templateBinding?.title||'','客户文件下载':row.templateBinding?`/api/workspace/customer-quote-template-export?quoteId=${encodeURIComponent(row.quoteId)}&quoteVersion=${row.quoteVersion}`:''}));
  XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(data),'已完成报价总表');
  return download(XLSX.write(book,{type:'array',bookType:'xlsx'}),'已完成报价总表.xlsx');
 }
 if(action==='customer-quote-template-output-file'){
  const output=all(s,'customer_quote_template_output').find(record=>record.id===url.searchParams.get('id')) as OutputRecord|undefined;
  if(!output)throw new AppError('客户成品文件不存在。',404);
  const q=confirmedVersion(s,m,output.quoteId,output.quoteVersion);if(q.customerAccountId!==output.customerAccountId||q.templateBinding!.id!==output.templateId)throw new AppError('成品文件客户或模板绑定不一致。',403);
  return download(await readObject(output.fileKey),output.filename);
 }
 const input=parse(z.object({quoteId:id,quoteVersion:version}),{quoteId:url.searchParams.get('quoteId'),quoteVersion:Number(url.searchParams.get('quoteVersion'))}),q=confirmedVersion(s,m,input.quoteId,input.quoteVersion),params=exportInput(q);
 const original=await readObject(q.templateFileKey!),bytes=await engine(()=>exportCustomerQuoteTemplate(original,params)),buffer=bytes.slice().buffer as ArrayBuffer;
 const output=await outputRecord(s,m,q,buffer,false);
 return download(buffer,output.filename);
}

export async function customerQuoteTemplatePost(action:string,req:Request,s:State,m:Member,persist:Persist):Promise<Response|null>{
 if(!['customer-quote-template-register','customer-quote-template-apply','customer-quote-template-archive'].includes(action))return null;
 if(action==='customer-quote-template-register'){
  if(!isCustomerQuoteAdministrator(m,s))throw new AppError('客户模板须由报价管理员核对后登记。',403);
  const form=await req.formData(),input=parse(z.object({customerAccountId:id,brand:short,businessType:short,title:short}),Object.fromEntries(['customerAccountId','brand','businessType','title'].map(key=>[key,form.get(key)])));
  accountFor(s,m,input.customerAccountId);
  const file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx')||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的客户 XLSX 原模板。');
  const bytes=await file.arrayBuffer(),mapping=await engine(()=>parseCustomerQuoteTemplate(bytes)),sourceHash=await sha(bytes);compatibleTemplate(mapping);
  const templates=all(s,'customer_quote_template') as TemplateRecord[],prior=templates.filter(t=>t.customerAccountId===input.customerAccountId&&t.brand===input.brand&&t.businessType===input.businessType&&t.title===input.title);
  const duplicate=prior.find(t=>t.sourceHash===sourceHash);if(duplicate)return json({ok:true,alreadyPresent:true,template:publicTemplate(duplicate)});
  const record:TemplateRecord={...input,id:newId('customer_quote_template'),kind:'customer_quote_template',version:Math.max(0,...prior.map(t=>t.version))+1,filename:filename(file.name),fileKey:newId('customer_quote_template_file'),sourceHash,mapping,createdAt:now(),createdBy:m.name};
  await bucket().put(record.fileKey,bytes);
  await commit(s.revision,[record,audit(m,record,null,'登记客户格式报价模板','客户报价工作台',publicTemplate(record))]);
  return json({ok:true,template:publicTemplate(record)});
 }
 if(action==='customer-quote-template-archive'){
  const form=await req.formData(),input=parse(z.object({quoteId:id,quoteVersion:version}),{quoteId:form.get('quoteId'),quoteVersion:Number(form.get('quoteVersion'))}),q=confirmedVersion(s,m,input.quoteId,input.quoteVersion);
  const file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx')||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的实际对客 XLSX。');
  const bytes=await file.arrayBuffer();await engine(()=>validateCustomerQuoteTemplateOutput(bytes,exportInput(q)));
  const record=await outputRecord(s,m,q,bytes,true,file.name),{fileKey,...safe}=record;
  return json({ok:true,output:safe});
 }
 const input=parse(z.object({quoteId:id,version,templateId:id}).strict(),await req.json()),before=quoteFor(s,m,input.quoteId);
 if(before.status!=='draft')throw new AppError('已确认报价不可覆盖，请先创建修订草稿。',409);
 if(before.version!==input.version)throw new AppError('报价版本已更新，请读取服务器版本后再应用模板。',409);
 const template=all(s,'customer_quote_template').find(item=>item.id===input.templateId) as TemplateRecord|undefined;
 if(!template||before.customerAccountId!==template.customerAccountId)throw new AppError('客户模板必须与报价关联到同一客户档案。',403);
 accountFor(s,m,template.customerAccountId);
 if(before.brand!==template.brand||before.businessType!==template.businessType)throw new AppError('请先保存与模板一致的品牌和业务类型，避免跨品牌误用。');
 const original=await readObject(template.fileKey),mapping=await engine(()=>parseCustomerQuoteTemplate(original));compatibleTemplate(mapping);if(mapping.sourceHash!==template.sourceHash)throw new AppError('客户模板原件摘要不一致，请联系管理员。',409);
 const at=now(),quote:TemplateQuote={...before,version:before.version+1,quoteMode:'price_list',pricingBasis:'pending',currencyReviewed:false,templateBinding:{id:template.id,title:template.title,brand:template.brand,businessType:template.businessType,rowCount:mapping.rowMappings.length,sourceHash:template.sourceHash,version:template.version},templateMapping:mapping,templateFileKey:template.fileKey,
  lines:mapping.items.map(item=>({id:item.id,model:item.modelNames[0]||item.materialNumber,factoryModel:'',customerModel:item.modelNames.join(' / '),materialNumber:item.materialNumber,productType:item.partType==='frame'?'frame':'spare_part',component:item.partType,side:item.side,supplyStage:item.supplyStage,unit:'unknown',scopeReviewed:false,scopeNotesZh:'',scopeNotesEn:'',descriptionZh:item.description,descriptionEn:item.description,quantity:null,quantityBasisZh:'',quantityBasisEn:'',unitPrice:null,toolingFee:null})),
  reviewNotes:[...new Set([...before.reviewNotes,'客户模板：逐项确认币种、单位、部件计价及供货范围；整架定义不能套用于零件。',...mapping.issues])].slice(0,50),updatedAt:at,updatedBy:m.name,updatedById:m.id};
 const names=['id','version','companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','contactName','brand','businessType','quoteMode','pricingBasis','currencyReviewed','quoteNo','quoteDate','validUntil','currency','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges','lines','terms','reviewNotes'];
 parse(customerQuoteInput,Object.fromEntries(names.filter(name=>quote[name]!==undefined).map(name=>[name,quote[name]])));
 return persist(s,m,quote,before,'应用客户报价模板');
}

export function detachChangedQuoteTemplate(before:TemplateQuote|null,after:TemplateQuote){
 if(before?.templateBinding&&['customerAccountId','customerName','customerCode','brand','businessType'].some(key=>before[key]!==after[key])){delete after.templateBinding;delete after.templateMapping;delete after.templateFileKey;}
}
