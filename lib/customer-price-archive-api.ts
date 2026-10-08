import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha,makeWorkbook} from './workbooks';
import {canUseCustomerQuotes,canSeeCustomerQuoteInternal,eligibleCustomerQuoteAccounts,isCustomerQuoteAdministrator} from './customer-quote-access';
import {canonicalPriceJson,canReadPriceArchive,customerPriceArchiveRows,customerPriceDatasetSchema,type PriceArchive} from './customer-price-archive';

const hashText=(value:string)=>sha(new TextEncoder().encode(value).buffer);
function allowed(s:State,m:Member){if(!canUseCustomerQuotes(s,m))throw new AppError('当前账号没有客户报价档案权限。',403);}
function admin(s:State,m:Member){if(!isCustomerQuoteAdministrator(m,s))throw new AppError('仅报价管理员可导入历史档案和归档原件。',403);}
function archiveFor(s:State,id:string){const value=all(s,'customer_price_archive').find(v=>v.id===id) as PriceArchive|undefined;if(!value)throw new AppError('报价档案不存在。',404);return value;}
function filtered(s:State,m:Member,url:URL){
 const customerId=url.searchParams.get('customerId')||'',customers=eligibleCustomerQuoteAccounts(s,m);
 if(customerId&&!customers.some(a=>a.id===customerId))throw new AppError('无权查询该客户报价档案。',403);
 const q=(url.searchParams.get('q')||'').trim().toLowerCase(),state=url.searchParams.get('state')||'all',currency=url.searchParams.get('currency')||'';
 const rows=customerPriceArchiveRows(s,m).filter(row=>(!customerId||row.customerAccountId===customerId)&&(!q||[row.customer,row.customerCode,...Object.values(row.product).filter(v=>typeof v==='string')].join(' ').toLowerCase().includes(q))&&(state==='all'||row.status===state)&&(!currency||row.history.some(p=>p.currency===currency)));
 return {customers:customers.map(({id,customer,customerCode})=>({id,customer,customerCode})),rows,summary:{products:rows.length,skus:rows.filter(r=>r.product.sku).length,verified:rows.filter(r=>r.status==='verified').length,needsReview:rows.filter(r=>r.status==='needs_review').length,missingPrice:rows.filter(r=>r.status==='missing_price').length},canSeeInternal:canSeeCustomerQuoteInternal(s,m)};
}
export async function customerPriceArchiveGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-price-archive','customer-price-archive-export','customer-price-archive-file'].includes(action))return null;allowed(s,m);const url=new URL(req.url);
 if(action==='customer-price-archive-file'){
  const archive=archiveFor(s,url.searchParams.get('archiveId')||'');if(!canReadPriceArchive(s,m,archive)||!isCustomerQuoteAdministrator(m,s))throw new AppError('原件可能包含内部核价或其他客户资料，仅报价管理员可下载；请查询已核对的销售价摘录。',403);
  const file=archive.files?.[url.searchParams.get('fileId')||''];if(!file)throw new AppError('该来源目前仅有位置记录，尚未归档原件。',404);const object=await bucket().get(file.fileKey);if(!object)throw new AppError('归档原件缺失。',404);
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 const result=filtered(s,m,url);if(action==='customer-price-archive')return json(result);
 const rows=result.rows.flatMap(row=>{const history=row.history.length?row.history:[null];return history.map(p=>({'客户代码':row.customerCode,'客户':row.customer,'工厂款号':row.product.factoryModel||'','客款号':row.product.customerModel||'','SKU':row.product.sku||'','产品类别':row.product.productType||'','产品名称':row.product.productName||'','框色':row.product.frameColor||'','镜片':row.product.lens||'','材质':row.product.material||'','尺寸':row.product.size||'','规格版本':row.product.specVersion||'','主档状态':row.status,'价格依据':p&&row.bases.some(b=>b.id===p.id)?row.bases.find(b=>b.id===p.id)!.priceBasis:'历史保留','资料性质':p?.documentType||'','单据号':p?.documentNo||'','源版本':p?.version||'','单据日期':p?.documentDate||'','币种':p?.currency||'','单位':p?.unit||'','配置':p?.configuration||'','本条价格镜片':p?.lensVariant||'','INVOICE子类型':p?.invoiceKind||'','原币单价':p?.unitPrice??'','数量':p?.quantity??'','数量下限':p?.quantityMin??'','数量上限':p?.quantityMax??'','数量条件':p?.quantityBasis||'','模具费':p?.toolingFee??'','其他费用':p?.otherCharges==null?'':typeof p.otherCharges==='object'?JSON.stringify(p.otherCharges):p.otherCharges,'条款':p?.terms||'','核对状态':p?.reviewStatus||'','发送事实':p?.sentStatus||'unknown','来源':(p?.sourceRefs||row.product.sourceRefs||[]).map((ref:any)=>[ref.filename,ref.sheet,ref.cell,ref.page?'页'+ref.page:''].filter(Boolean).join('!')).join('；')}));});
 return new Response(makeWorkbook(rows,'客户历史报价'),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('客户历史报价总表.xlsx'),'Cache-Control':'no-store'}});
}
export async function customerPriceArchivePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-price-archive-import','customer-price-archive-file-upload'].includes(action))return null;admin(s,m);
 if(action==='customer-price-archive-import'){
  const input=z.object({customerAccountId:z.string().min(1),dataset:z.unknown(),datasetSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await req.json());
  const actual=await hashText(canonicalPriceJson(input.dataset));if(actual!==input.datasetSha256)throw new AppError('导入内容与核对摘要不一致。');const parsed=customerPriceDatasetSchema.safeParse(input.dataset);if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(i=>i.path.join('.')+':'+i.message).join('；'));
  const account=all(s,'customer_account').find(a=>a.id===input.customerAccountId);if(!account?.active)throw new AppError('须明确关联有效客户档案。');if(account.customerCode&&account.customerCode!==parsed.data.customer.code)throw new AppError('客户编码与明确关联的客户档案不一致。');
  const id='customer_price_archive_'+await hashText(input.customerAccountId+'|'+actual),existing=all(s,'customer_price_archive').find(a=>a.id===id) as PriceArchive|undefined;
  if(existing){if(existing.datasetSha256!==actual||existing.customerAccountId!==input.customerAccountId)throw new AppError('已有档案摘要不一致。',409);return json({ok:true,id,alreadyPresent:true,products:existing.dataset.products.length,prices:existing.dataset.prices.length});}
  // Keep private filesystem paths outside the database. Source locations are relative metadata only.
  const dataset=parsed.data;dataset.files=dataset.files.map(({path,...file})=>file as typeof dataset.files[number]);
  const archive:PriceArchive={id,kind:'customer_price_archive',customerAccountId:input.customerAccountId,datasetSha256:actual,dataset,createdAt:now(),createdById:m.id,files:{}};
  const summary={id,kind:'customer_price_archive',customerAccountId:archive.customerAccountId,datasetSha256:actual,products:dataset.products.length,prices:dataset.prices.length,files:dataset.files.length};
  await commit(s.revision,[archive,audit(m,summary,null,'导入客户历史价格档案','历史价格受控导入',summary)]);return json({ok:true,id,alreadyPresent:false,products:dataset.products.length,prices:dataset.prices.length});
 }
 const form=await req.formData(),archive=archiveFor(s,String(form.get('archiveId')||'')),fileId=String(form.get('fileId')||''),metadata=archive.dataset.files.find(f=>f.id===fileId),file=form.get('file');
 if(!metadata||metadata.status==='excluded')throw new AppError('来源文件不存在或已排除。');if(!(file instanceof File)||!file.size||file.size>64*1024*1024)throw new AppError('原件须为不超过 64 MB 的文件。');
 const bytes=await file.arrayBuffer(),hash=await sha(bytes);if(!metadata.sha256||metadata.sha256.toLowerCase()!==hash)throw new AppError('原件没有核对摘要，或文件内容已改变。');
 const previous=archive.files?.[fileId];if(previous){if(previous.sha256!==hash)throw new AppError('已归档原件不能被覆盖。',409);return json({ok:true,id:archive.id,alreadyPresent:true});}
 const same=(all(s,'customer_price_archive') as PriceArchive[]).filter(a=>a.customerAccountId===archive.customerAccountId).flatMap(a=>Object.values(a.files||{})).find(f=>f.sha256===hash);
 const fileKey=same?.fileKey||newId('customer_price_source'),filename=file.name.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,180);
 if(!same)await bucket().put(fileKey,bytes);const updated={...archive,files:{...archive.files,[fileId]:{fileKey,filename,sha256:hash}}};
 await commit(s.revision,[updated,audit(m,{id:archive.id,kind:archive.kind,customerAccountId:archive.customerAccountId},null,'归档客户价格原件','历史价格受控导入',{filename,sha256:hash})]);return json({ok:true,id:archive.id,alreadyPresent:false});
}
