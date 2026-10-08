import {z} from 'zod';
import {all,clean,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {assignedCustomerQuoteAccount,canSeeCustomerQuoteInternal,isCustomerQuoteAdministrator} from './customer-quote-access';

const nullableText=z.string().max(8000).nullable().optional().default(null);
const amount=z.number().finite().min(0).max(1e12).nullable().optional().default(null);
const id=z.string().trim().min(1).max(240);
const sourceRef=z.object({fileId:id,sheet:nullableText,cell:nullableText,page:z.number().int().positive().nullable().optional().default(null)}).strict();
const sourceRefs=z.array(sourceRef).max(1000).default([]);
const fileSchema=z.object({id,relativePath:nullableText,path:nullableText,sha256:z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional().default(null),category:nullableText,status:nullableText}).passthrough();
const productSchema=z.object({id,factoryModel:nullableText,customerModel:nullableText,productName:nullableText,productType:nullableText,sku:nullableText,frameColor:nullableText,lens:nullableText,material:nullableText,size:nullableText,specVersion:nullableText,activity:nullableText,sourceRefs}).passthrough();
const priceSchema=z.object({id,productId:id,scope:z.enum(['sku','model']),documentType:z.enum(['invoice','quote','order','internal','charge']),documentNo:nullableText,version:nullableText,documentDate:nullableText,currency:nullableText,unit:nullableText,configuration:nullableText,lensVariant:nullableText,invoiceKind:nullableText,quantity:amount,quantityMin:amount,quantityMax:amount,quantityBasis:nullableText,unitPrice:amount,toolingFee:amount,otherCharges:z.union([amount,z.string().max(8000),z.array(z.unknown()).max(100)]).optional().default(null),terms:nullableText,reviewStatus:z.enum(['verified','needs_review']),sentStatus:z.enum(['unknown','sent']),sourceRefs,notes:nullableText}).passthrough();
export const customerPriceDatasetSchema=z.object({schemaVersion:z.literal(1),customer:z.object({code:id,name:id}).passthrough(),files:z.array(fileSchema).max(20000),products:z.array(productSchema).max(100000),prices:z.array(priceSchema).max(100000),issues:z.array(z.unknown()).max(100000).default([]),excluded:z.array(z.unknown()).max(20000).optional().default([])}).strict().superRefine((data,ctx)=>{
 for(const field of ['files','products','prices'] as const)if(new Set(data[field].map(v=>v.id)).size!==data[field].length)ctx.addIssue({code:z.ZodIssueCode.custom,path:[field],message:'同批次 ID 不能重复'});
 const products=new Map(data.products.map(v=>[v.id,v])),files=new Map(data.files.map(v=>[v.id,v]));
 for(const item of [...data.products,...data.prices])for(const ref of item.sourceRefs){const file=files.get(ref.fileId);if(!file||file.status==='excluded')ctx.addIssue({code:z.ZodIssueCode.custom,path:['sourceRefs'],message:'引用文件不存在或已排除'});}
 for(const price of data.prices){const product=products.get(price.productId);if(!product)ctx.addIssue({code:z.ZodIssueCode.custom,path:['prices'],message:'价格产品 ID 不存在'});if(price.scope==='sku'&&!clean(product?.sku))ctx.addIssue({code:z.ZodIssueCode.custom,path:['prices'],message:'SKU 价格须明确 SKU'});if(price.quantityMin!==null&&price.quantityMax!==null&&price.quantityMin>price.quantityMax)ctx.addIssue({code:z.ZodIssueCode.custom,path:['prices'],message:'数量下限大于上限'});}
});
export type PriceDataset=z.infer<typeof customerPriceDatasetSchema>;
export type ArchivePrice=PriceDataset['prices'][number];
export type ArchiveProduct=PriceDataset['products'][number];
export type PriceArchive=Entity&{kind:'customer_price_archive';customerAccountId:string;datasetSha256:string;dataset:PriceDataset;createdAt:string;createdById:string;files?:Record<string,{fileKey:string;filename:string;sha256:string}>};
export type InvoicePreference='rx'|'solar'|'highest'|'both';
export type ConfigurationNotes={rx:string;solar:string};
export type CustomerPriceSelection=Entity&{kind:'customer_price_selection';customerAccountId:string;invoicePreference:InvoicePreference|null;configurationNotes?:ConfigurationNotes;version:number;updatedAt:string;updatedById:string};
export function customerPriceSelection(s:State,customerId:string){const records=all(s,'customer_price_selection').filter(r=>r.customerAccountId===customerId);return records.length===1?records[0] as CustomerPriceSelection:null;}
export const canReadPriceArchive=(s:State,m:Member,archive:PriceArchive)=>{
 const account=all(s,'customer_account').find(a=>a.id===archive.customerAccountId) as CustomerAccount|undefined;
 return !!account&&(isCustomerQuoteAdministrator(m,s)||assignedCustomerQuoteAccount(s,m,account));
};
export function canonicalPriceJson(value:unknown):string{return JSON.stringify(canonical(value));}
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;}
const key=(v:unknown)=>clean(v).toLowerCase();
// An unidentified row must never be merged solely because its descriptive text matches.
export const archiveProductKey=(p:ArchiveProduct)=>clean(p.sku)?canonicalPriceJson([key(p.productType),key(p.sku),key(p.factoryModel),key(p.customerModel),key(p.frameColor),key(p.lens),key(p.material),key(p.size),key(p.specVersion)]):canonicalPriceJson(['model',key(p.productType),key(p.factoryModel),key(p.customerModel),key(p.frameColor),key(p.lens),key(p.material),key(p.size),key(p.specVersion),!p.factoryModel&&!p.customerModel?p.id:'']);
const validDate=(v:string|null)=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const verifiedArchivePrice=(p:ArchivePrice)=>p.reviewStatus==='verified'&&p.unitPrice!==null&&!!p.sourceRefs.length&&!!p.currency&&/^[A-Z]{3}$/.test(p.currency)&&!!p.unit&&!['unknown','待核对'].includes(key(p.unit))&&validDate(p.documentDate);
const salesType=(type:string)=>['invoice','quote','order'].includes(type);
const docRank=(type:string)=>type==='invoice'?0:type==='quote'?1:type==='order'?2:3;
export function customerPriceArchiveRows(s:State,m:Member){
 const internal=canSeeCustomerQuoteInternal(s,m),archives=(all(s,'customer_price_archive') as PriceArchive[]).filter(a=>canReadPriceArchive(s,m,a));
 const grouped=new Map<string,{id:string;customerAccountId:string;customer:string;customerCode:string;product:Record<string,unknown>;history:Record<string,any>[];issues:string[]}>();
 for(const archive of archives){const account=all(s,'customer_account').find(a=>a.id===archive.customerAccountId)!;const pricesByProduct=new Map<string,ArchivePrice[]>();for(const price of archive.dataset.prices){const list=pricesByProduct.get(price.productId)||[];list.push(price);pricesByProduct.set(price.productId,list);}
  const source=(refs:ArchiveProduct['sourceRefs'])=>refs.map(ref=>{const file=archive.dataset.files.find(f=>f.id===ref.fileId);return {fileId:ref.fileId,archiveId:archive.id,filename:clean(file?.relativePath).split(/[\\/]/).pop()||ref.fileId,sheet:ref.sheet,cell:ref.cell,page:ref.page,sha256:file?.sha256||null,hasFile:!!archive.files?.[ref.fileId],canDownload:isCustomerQuoteAdministrator(m,s)&&!!archive.files?.[ref.fileId]};});
  for(const p of archive.dataset.products){const groupKey=archive.customerAccountId+'|'+archiveProductKey(p);let row=grouped.get(groupKey);if(!row){const {id,factoryModel,customerModel,productName,productType,sku,frameColor,lens,material,size,specVersion,activity}=p;row={id:groupKey,customerAccountId:archive.customerAccountId,customer:account.customer,customerCode:account.customerCode||archive.dataset.customer.code,product:{id,factoryModel,customerModel,productName,productType,sku,frameColor,lens,material,size,specVersion,activity,sourceRefs:source(p.sourceRefs)},history:[],issues:[]};grouped.set(groupKey,row);}
   for(const p0 of (pricesByProduct.get(p.id)||[]).filter(price=>internal||salesType(price.documentType))){const verified=verifiedArchivePrice(p0),{id,scope,documentType,documentNo,version,documentDate,currency,unit,configuration,lensVariant,invoiceKind,quantity,quantityMin,quantityMax,quantityBasis,terms,sentStatus}=p0;
    row.history.push({id:archive.id+':'+id,scope,documentType,documentNo,version,documentDate,currency,unit,configuration,lensVariant,invoiceKind,quantity,quantityMin,quantityMax,quantityBasis,unitPrice:internal||verified?p0.unitPrice:null,toolingFee:internal||verified?p0.toolingFee:null,otherCharges:internal||verified?p0.otherCharges:null,terms,reviewStatus:verified?'verified':'needs_review',sentStatus,sourceRefs:source(p0.sourceRefs),...(internal?{notes:p0.notes}: {}),_rawPrice:p0.unitPrice});
   }
  }
 }
 return [...grouped.values()].map(row=>{
  row.history.sort((a,b)=>docRank(a.documentType)-docRank(b.documentType)||(b.documentDate||'').localeCompare(a.documentDate||'')||(b.version||'').localeCompare(a.version||''));
  // Keep quantity tiers and contractual terms alongside each other. Never substitute
  // a verified old invoice for the latest invoice which still needs review.
  const groups=new Map<string,typeof row.history>();for(const p of row.history.filter(p=>salesType(p.documentType))){const condition=canonicalPriceJson([p.currency||'unknown',p.unit||'unknown',p.scope,p.configuration,p.lensVariant,p.quantity,p.quantityMin,p.quantityMax,p.quantityBasis,p.terms]);const list=groups.get(condition)||[];list.push(p);groups.set(condition,list);}
  const bases=[...groups.values()].map<Record<string,any>>(history=>{const invoice=history.filter(p=>p.documentType==='invoice');const candidates=invoice.length?invoice:history;const chosen=candidates[0];const relevant=history.filter(p=>p.documentType===chosen.documentType&&(p.documentDate||'')===(chosen.documentDate||''));const conflict=new Set(relevant.filter(p=>p._rawPrice!==null).map(p=>p._rawPrice)).size>1;return {...chosen,conflict,priceBasis:invoice.length?'INVOICE':'历史'+(chosen.documentType==='quote'?'报价':'订单'),applicabilityUnknown:!chosen.quantityBasis||chosen.quantityBasis==='unknown'||(chosen.quantity===null&&chosen.quantityMin===null)};}).sort((a,b)=>docRank(a.documentType)-docRank(b.documentType)||(b.documentDate||'').localeCompare(a.documentDate||''));
  const status=!row.history.length?'missing_price':bases.some(p=>p.reviewStatus==='needs_review'||p.conflict||p.applicabilityUnknown)?'needs_review':bases.length?'verified':'missing_price';
  if(!row.history.length)row.issues.push('没有销售价证据，不按款级价格推填 SKU');if(row.product.sku==null||row.product.sku==='')row.issues.push('款级记录，不能视为全部 SKU 已有价格');if(bases.some(p=>p.conflict))row.issues.push('同日期和数量条件存在不同价格，请核对来源版本');if(bases.some(p=>p.applicabilityUnknown))row.issues.push('数量计价适用条件待核对');
  const safe=(p:Record<string,any>)=>{const {_rawPrice,...publicPrice}=p;return publicPrice;};
  return {...row,history:row.history.map(safe),basis:bases[0]?safe(bases[0]):null,bases:bases.map(safe),status};
 }).sort((a,b)=>clean(a.product.factoryModel||a.product.customerModel).localeCompare(clean(b.product.factoryModel||b.product.customerModel))||clean(a.product.sku).localeCompare(clean(b.product.sku)));
}

// A compact view derived from the immutable evidence. Quantity, specifications and
// lens variants never create another SKU row; their original facts remain in history.
export function customerInvoiceSkuRows(s:State,m:Member){
 const historical=customerPriceArchiveRows(s,m),groups=new Map<string,typeof historical>();
 for(const row of historical){if(key(row.product.productType)!=='frame'||!clean(row.product.sku))continue;const id=row.customerAccountId+'|sku|'+key(row.product.sku);const list=groups.get(id)||[];list.push(row);groups.set(id,list);}
 const raw=new Map<string,ArchivePrice>();for(const archive of (all(s,'customer_price_archive') as PriceArchive[]).filter(a=>canReadPriceArchive(s,m,a)))for(const price of archive.dataset.prices)raw.set(archive.id+':'+price.id,price);
 return [...groups.entries()].map(([id,rows])=>{
  const first=rows[0],history=rows.flatMap(r=>r.history),invoices=history.filter(p=>p.scope==='sku'&&p.documentType==='invoice'),selection=customerPriceSelection(s,first.customerAccountId),preference=selection?.invoicePreference||null,issues:string[]=[];
  const latestDate=invoices.reduce((value,p)=>(p.documentDate||'')>value?p.documentDate:value,''),latest=invoices.filter(p=>(p.documentDate||'')===latestDate);
  const variant=(p:Record<string,any>)=>{const config=key(p.configuration);if(config==='rx'||config==='optical')return 'rx';if(config==='solar'||config==='sun'||config==='sunglasses')return 'solar';const lens=key(p.lensVariant);return /\bsolar\b|\bsun\b|太阳/.test(lens)?'solar':/\brx\b|\boptical\b|光学/.test(lens)?'rx':null;};
  const publicBasis=(chosen:Record<string,any>|null):Record<string,any>|null=>chosen?{...chosen,documentNo:/^(?:invoice\s*(?:no\.?|number)|发票号)\s*[:：]?$/i.test(clean(chosen.documentNo))?null:chosen.documentNo,priceBasis:'INVOICE',conflict:false,applicabilityUnknown:false}:null;
  if(preference==='both'){
   const pick=(configuration:'rx'|'solar')=>{const candidates=invoices.filter(p=>variant(p)===configuration),date=candidates.reduce((value,p)=>(p.documentDate||'')>value?p.documentDate:value,''),latest=candidates.filter(p=>(p.documentDate||'')===date),currencies=[...new Set(latest.map(p=>p.currency).filter(Boolean))],denominations=new Set(latest.map(p=>canonicalPriceJson([p.currency,p.unit]))),prices=new Set(latest.map(p=>raw.get(p.id)?.unitPrice??null)),label=configuration==='rx'?'RX':'SOLAR';
    if(!candidates.length){issues.push(label+' 缺少对应配置的 SKU 发票，未用另一配置或报价补填');return {basis:null,status:'missing_price',currencies,date:null,conflict:false};}
    if(denominations.size!==1||prices.size!==1||prices.has(null)){issues.push(label+' 最新对应发票单价或币种单位存在冲突 / 缺失，待核对');return {basis:null,status:'needs_review',currencies,date:date||null,conflict:true};}
    const basis=publicBasis(latest[0])!;if(basis.reviewStatus!=='verified')issues.push(label+' 最新对应发票价格待核对');return {basis,status:basis.reviewStatus==='verified'?'verified':'needs_review',currencies,date:date||null,conflict:false};
   };
   const rx=pick('rx'),solar=pick('solar'),bases=[rx.basis,solar.basis].filter((p):p is Record<string,any>=>!!p),newest=[...bases].sort((a,b)=>(b.documentDate||'').localeCompare(a.documentDate||''))[0],product=newest?rows.find(row=>row.history.some(p=>p.id===newest.id))?.product||first.product:first.product;
   const status=rx.status==='needs_review'||solar.status==='needs_review'||!bases.length&&invoices.length?'needs_review':bases.length?'verified':'missing_price';
   if(invoices.some(p=>!variant(p)))issues.push('部分 SKU 发票未标明 RX / SOLAR 配置，未归入任何价格列');
   return {...first,id,product,history,basis:null,bases,status,issues,dualMode:true,rxBasis:rx.basis,solarBasis:solar.basis,variantStatuses:{rx:rx.status,solar:solar.status},variantInvoiceCurrencies:{rx:rx.currencies,solar:solar.currencies},selectionPreference:preference,selectionConflict:rx.conflict||solar.conflict,latestInvoiceDate:latestDate||null,latestInvoiceCurrencies:[...new Set([...rx.currencies,...solar.currencies])],invoiceCount:invoices.length,mergedProductCount:rows.length};
  }
  const latestDenominations=new Set(latest.map(p=>canonicalPriceJson([p.currency,p.unit]))),latestPrices=new Set(latest.map(p=>raw.get(p.id)?.unitPrice??null));
  const singleLatestValue=latestDenominations.size===1&&latestPrices.size===1&&!latestPrices.has(null);
  let candidates=latest;if(!singleLatestValue&&(preference==='rx'||preference==='solar'))candidates=latest.filter(p=>variant(p)===preference);
  const denominations=new Set(candidates.map(p=>canonicalPriceJson([p.currency,p.unit]))),prices=new Set(candidates.map(p=>raw.get(p.id)?.unitPrice??null));
  let chosen:typeof history[number]|null=null,conflict=false;
  if(!invoices.length)issues.push('没有 SKU 发票价格依据，未用报价或款级价补填');
  else if(!candidates.length)issues.push('最新发票没有客户所选配置，未回退旧发票');
  else if(denominations.size!==1){conflict=true;issues.push('最新发票币种或单位不同，须核对后选择，不能直接比较高低');}
  else if(prices.has(null)){conflict=true;issues.push('最新发票缺少单价，须核对来源');}
  else if(preference==='highest'){const highest=candidates.reduce((value,p)=>Math.max(value,raw.get(p.id)!.unitPrice!),0);chosen=candidates.find(p=>raw.get(p.id)!.unitPrice===highest)!;}
  else if(prices.size===1)chosen=candidates[0];
  else{conflict=true;issues.push(preference?'最新发票所选配置仍存在不同单价，须进一步核对':'最新发票存在不同单价，请管理员选择客户价格规则');}
  const basis=publicBasis(chosen);
  const status=!invoices.length?'missing_price':!basis||basis.reviewStatus!=='verified'?'needs_review':'verified';
  if(basis?.reviewStatus==='needs_review')issues.push('已选择最新发票依据，价格仍待核对');
  const product=chosen?rows.find(row=>row.history.some(price=>price.id===chosen!.id))?.product||first.product:first.product;
  return {...first,id,product,history,basis,bases:basis?[basis]:[],status,issues,dualMode:false,rxBasis:null,solarBasis:null,variantStatuses:null,variantInvoiceCurrencies:null,selectionPreference:preference,selectionConflict:conflict,latestInvoiceDate:latestDate||null,latestInvoiceCurrencies:[...new Set(latest.map(p=>p.currency).filter(Boolean))],invoiceCount:invoices.length,mergedProductCount:rows.length};
 }).sort((a,b)=>a.customer.localeCompare(b.customer)||clean(a.product.sku).localeCompare(clean(b.product.sku)));
}
