// Converts the documented four-sheet template. Never evaluates Excel formulas.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';

export const templateFields={
 '产品SKU':['customerCode','productId','factoryModel','customerModel','productName','productType','sku','frameColor','lens','material','size','specVersion','activity','sourceFileId','sourceSheet','sourceCell','notes'],
 '历史价格':['customerCode','priceId','productId','scope','documentType','documentNo','version','documentDate','currency','unit','quantity','quantityMin','quantityMax','quantityBasis','unitPrice','toolingFee','otherCharges','terms','reviewStatus','sentStatus','sourceFileId','sourceSheet','sourceCell','sourcePage','notes','configuration','invoiceKind','lensVariant'],
 '来源文件':['customerCode','fileId','relativePath','category','status','sha256','notes'],
};
const text=value=>value===null||value===undefined?'':String(value).trim();
const number=(value,label)=>{
 if(value===null||value===undefined||value==='')return null;
 if(typeof value==='boolean'||(typeof value==='string'&&!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())))throw new Error(label+' 必须是非负数或空白');
 const result=Number(value);if(!Number.isFinite(result)||result<0)throw new Error(label+' 必须是非负数或空白');return result;
};
const date=(value,label)=>{
 if(value===null||value===undefined||value==='')return null;
 if(value instanceof Date){if(Number.isNaN(value.valueOf()))throw new Error(label+' 日期无效');return value.toISOString().slice(0,10);}
 if(typeof value==='number'){
  const parsed=XLSX.SSF.parse_date_code(value);if(!parsed||value<1)throw new Error(label+' Excel日期无效');
  value=`${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
 }
 const s=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error(label+' 采用 YYYY-MM-DD 日期');return s;
};
const enumValue=(value,allowed,label,fallback)=>{const s=text(value)||fallback;if(!allowed.includes(s))throw new Error(label+' 不在允许范围：'+s);return s;};
const required=(value,label)=>{const s=text(value);if(!s)throw new Error(label+' 不能为空');return s;};
const unique=(values,label)=>{if(new Set(values).size!==values.length)throw new Error(label+' 有重复ID');};

export function convertTemplateRows(sheets,{customerCode,customerName=customerCode,allowDemo=false}={}){
 customerCode=required(customerCode,'客户代码');
 if(customerCode==='DEMO'&&!allowDemo)throw new Error('DEMO 是合成示例，请删除示例并填写实际客户；测试可使用 --allow-demo');
 const excluded=[];
 const read=name=>{
  const grid=sheets[name];if(!Array.isArray(grid)||grid.length<6)throw new Error('缺少模板工作表或第6行字段：'+name);
  const header=(grid[5]||[]).map(text);const expected=templateFields[name];
  if(expected.some((key,index)=>header[index]!==key)||header.slice(expected.length).some(Boolean))throw new Error(name+' 第6行字段与模板不一致');
  const rows=grid.slice(6).map((row,index)=>({row:index+7,data:Object.fromEntries(expected.map((key,i)=>[key,row[i]??null]))})).filter(({data})=>Object.values(data).some(v=>v!==null&&v!==undefined&&v!==''));
  for(const r of rows){required(r.data.customerCode,`${name}第${r.row}行customerCode`);if(text(r.data.customerCode)==='DEMO'&&!allowDemo)throw new Error(`${name}第${r.row}行仍有DEMO合成示例，请先删除`);}
  return rows.filter(({data,row})=>{if(text(data.customerCode)===customerCode)return true;excluded.push({sheet:name,row,customerCode:text(data.customerCode),reason:'其他客户行，未进入所选客户'});return false;});
 };
 const fileRows=read('来源文件'),productRows=read('产品SKU'),priceRows=read('历史价格');
 const files=fileRows.map(({data:r,row})=>{
  const label=`来源文件第${row}行`,status=enumValue(text(r.status)==='excluded_wrong_customer'?'excluded':r.status,['included','excluded'],label+'status','included'),sha256=text(r.sha256).toLowerCase()||null;
  if(sha256&&!/^[a-f0-9]{64}$/.test(sha256))throw new Error(label+'sha256 必须是64位文件指纹或空白');
  return {id:required(r.fileId,label+'fileId'),relativePath:required(r.relativePath,label+'relativePath'),category:text(r.category)||'unknown',status,sha256,reason:text(r.notes)||null};
 });
 unique(files.map(r=>r.id),'来源文件');const fileIds=new Set(files.map(r=>r.id));
 const excludedFileIds=new Set(files.filter(f=>f.status==='excluded').map(f=>f.id));
 const eligibleProductRows=productRows.filter(({data:r,row})=>{if(!excludedFileIds.has(text(r.sourceFileId)))return true;excluded.push({sheet:'产品SKU',row,productId:text(r.productId),fileId:text(r.sourceFileId),reason:'来源文件已排除'});return false;});
 const excludedProductIds=new Set(productRows.filter(r=>excludedFileIds.has(text(r.data.sourceFileId))).map(r=>text(r.data.productId)));
 const eligiblePriceRows=priceRows.filter(({data:r,row})=>{if(!excludedFileIds.has(text(r.sourceFileId))&&!excludedProductIds.has(text(r.productId)))return true;excluded.push({sheet:'历史价格',row,priceId:text(r.priceId),fileId:text(r.sourceFileId),reason:'产品或来源文件已排除'});return false;});
 const refs=(r,row,sheet)=>{
  const fileId=required(r.sourceFileId,`${sheet}第${row}行sourceFileId`);if(!fileIds.has(fileId))throw new Error(`${sheet}第${row}行来源文件不存在`);
  const page=number(r.sourcePage,`${sheet}第${row}行sourcePage`);if(page!==null&&(!Number.isSafeInteger(page)||page<1))throw new Error('sourcePage 必须为正整数');
  return [{fileId,sheet:text(r.sourceSheet)||null,cell:text(r.sourceCell)||null,page}];
 };
 const products=eligibleProductRows.map(({data:r,row})=>({id:required(r.productId,`产品SKU第${row}行productId`),factoryModel:text(r.factoryModel)||null,customerModel:text(r.customerModel)||null,productName:text(r.productName)||null,productType:text(r.productType)||'unknown',sku:text(r.sku)||null,frameColor:text(r.frameColor)||null,lens:text(r.lens)||null,material:text(r.material)||null,size:text(r.size)||null,specVersion:text(r.specVersion)||null,activity:enumValue(r.activity,['quoted','prototype','ordered','produced','delivered','unknown'],`产品SKU第${row}行activity`,'unknown'),sourceRefs:refs(r,row,'产品SKU'),notes:text(r.notes)||null}));
 unique(products.map(r=>r.id),'产品SKU');const byProduct=new Map(products.map(r=>[r.id,r]));
 if(!products.length)throw new Error('所选客户没有产品SKU记录');
 const prices=eligiblePriceRows.map(({data:r,row})=>{
  const label=`历史价格第${row}行`,productId=required(r.productId,label+'productId');const product=byProduct.get(productId);if(!product)throw new Error(label+' 产品记录不存在');
  const scope=enumValue(r.scope,['sku','model'],label+'scope',product.sku?'sku':'model');if(scope==='sku'&&!product.sku)throw new Error(label+' sku范围没有SKU编码');
  const quantityMin=number(r.quantityMin,label+'quantityMin'),quantityMax=number(r.quantityMax,label+'quantityMax');
  if(quantityMin!==null&&quantityMax!==null&&quantityMin>quantityMax)throw new Error(label+' 数量下限超过上限');
  return {id:required(r.priceId,label+'priceId'),productId,scope,documentType:enumValue(r.documentType,['invoice','quote','order','internal','charge'],label+'documentType','quote'),documentNo:text(r.documentNo)||null,version:text(r.version)||null,documentDate:date(r.documentDate,label+'documentDate'),currency:text(r.currency).toUpperCase()||null,unit:enumValue(r.unit,['pair','piece','set','charge','unknown'],label+'unit','unknown'),quantity:number(r.quantity,label+'quantity'),quantityMin,quantityMax,quantityBasis:enumValue(r.quantityBasis,['exact','minimum','maximum','range','order_quantity','unknown'],label+'quantityBasis','unknown'),unitPrice:number(r.unitPrice,label+'unitPrice'),toolingFee:number(r.toolingFee,label+'toolingFee'),otherCharges:number(r.otherCharges,label+'otherCharges'),terms:text(r.terms)||null,reviewStatus:enumValue(r.reviewStatus,['verified','needs_review'],label+'reviewStatus','needs_review'),sentStatus:enumValue(r.sentStatus,['sent','unknown'],label+'sentStatus','unknown'),sourceRefs:refs(r,row,'历史价格'),notes:text(r.notes)||null,configuration:text(r.configuration)||null,invoiceKind:text(r.invoiceKind)?enumValue(r.invoiceKind,['proforma','commercial','unknown'],label+'invoiceKind','unknown'):null,lensVariant:text(r.lensVariant)||null};
 });
 unique(prices.map(r=>r.id),'历史价格');
 const issues=[];
 for(const p of products)if(!prices.some(r=>r.productId===p.id&&r.unitPrice!==null&&['invoice','quote','order'].includes(r.documentType)))issues.push({id:'missing_price_'+p.id,type:'missing_price',productId:p.id,detail:'已有产品或SKU记录，尚无直接销售价格；不以款级价格推填SKU'});
 for(const r of prices)if(r.reviewStatus==='needs_review'||!r.currency||!/^[A-Z]{3}$/.test(r.currency)||!r.documentDate||r.unit==='unknown'||r.quantityBasis==='unknown'){
  r.reviewStatus='needs_review';issues.push({id:'review_'+r.id,type:'needs_review',productId:r.productId,priceId:r.id,detail:'核对状态、币种、日期或计价条件待补；不自动认定为已发送报价'});
 }
 return {schemaVersion:1,customer:{code:customerCode,name:customerName},files,products,prices,issues,excluded};
}

async function main(){
 const args=process.argv.slice(2),options={};const flags=['--input','--output','--customer-code','--customer-name','--source-root','--allow-demo'];
 for(let i=0;i<args.length;i++){const key=args[i];if(!flags.includes(key)||Object.hasOwn(options,key))throw new Error('未知或重复参数：'+key);options[key]=key==='--allow-demo'?true:required(args[++i],key);}
 if(!options['--input']||!options['--output']||!options['--customer-code'])throw new Error('用法：--input <模板.xlsx> --output <私有JSON> --customer-code <客户代码> [--customer-name <名称>] [--source-root <原件目录>]');
 const workbook=XLSX.read(await fs.readFile(options['--input']),{type:'buffer',cellDates:false});const grids={};
 for(const name of Object.keys(templateFields)){
  const sheet=workbook.Sheets[name];if(!sheet)throw new Error('缺少工作表：'+name);
  for(const [address,cell] of Object.entries(sheet))if(!address.startsWith('!')&&cell.f)throw new Error(name+'!'+address+' 含公式，请填已核对原始值');
  grids[name]=XLSX.utils.sheet_to_json(sheet,{header:1,range:0,raw:true,defval:null,blankrows:true});
 }
 const data=convertTemplateRows(grids,{customerCode:options['--customer-code'],customerName:options['--customer-name']||options['--customer-code'],allowDemo:!!options['--allow-demo']});
 if(options['--source-root']){
  const sourceRoot=await fs.realpath(options['--source-root']);
  for(const file of data.files){
   if(file.status==='excluded')continue;
   if(path.isAbsolute(file.relativePath)||/^[A-Za-z]:/.test(file.relativePath))throw new Error('来源必须为相对路径：'+file.id);
   const requested=path.resolve(sourceRoot,file.relativePath);if(!requested.startsWith(sourceRoot+path.sep))throw new Error('来源文件越出指定目录：'+file.id);
   const actual=await fs.realpath(requested);if(!actual.startsWith(sourceRoot+path.sep))throw new Error('来源文件链接越出指定目录：'+file.id);
   const hash=createHash('sha256').update(await fs.readFile(actual)).digest('hex');if(file.sha256&&file.sha256!==hash)throw new Error('来源文件指纹不符：'+file.id);
   file.path=actual;file.sha256=hash;
  }
 }
 await fs.writeFile(options['--output'],JSON.stringify(data,null,2));
 console.log(JSON.stringify({ok:true,customerCode:data.customer.code,products:data.products.length,prices:data.prices.length,files:data.files.length,issues:data.issues.length,excluded:data.excluded.length,sourceFilesAttached:!!options['--source-root']}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
