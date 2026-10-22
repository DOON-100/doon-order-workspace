import * as XLSX from 'xlsx';
import {parseSalesOrderSource,type SalesOrderSource} from './sales-order-sources';
import {KINGDEE_SALES_CATEGORIES} from './kingdee-sales-types';

export class KingdeeSalesSourceImportError extends Error{}
export const KINGDEE_SALES_SOURCE_SHEET='中英订单上传';
export const KINGDEE_SALES_SOURCE_IMPORT_VERSION='bilingual-sales-source-v1';
export const kingdeeSalesSourceImportLimits={bytes:8*1024*1024,expandedBytes:32*1024*1024,entries:1000,rows:1000,columns:100} as const;
const fields=[
 ['orderNo','订单号','Order No.',true],['customer','客户号','Customer No.',true],['customerPO','客户订单号','Customer PO',false],
 ['category','成品类别码','Finished Category',true],['drawing','图纸编号','Drawing No.',true],['model','客款号','Customer Model',true],
 ['sku','原单SKU','Source SKU',false],['color','色号','Color No.',true],['quantity','数量','Quantity',true],['unit','单位','Unit',true],
 ['sampleQuantity','样办数量','Sample Quantity',false],['unitPrice','单价','Unit Price',false],['delivery','交货日期','Delivery Date',false],
 ['finish','板料编码或电镀颜色','Material Code or Plating Color',false],['billDate','单据日期','Bill Date',false],
 ['employee','业务员名称','Salesperson Name',false],['currency','币别名称','Currency Name',false],['exchangeRate','汇率','Exchange Rate',false],
 ['businessType','业务类型','Business Type',false],['taxMode','计价方式','Price Basis',false],['taxRate','税率（%）','VAT Rate (%)',false],
 ['isFree','是否赠品','Free Item',false],['english','客户英文原文','Customer English',false],['chinese','工厂中文工艺','Factory Chinese',false],['notes','备注','Notes',false],
] as const;
type FieldKey=typeof fields[number][0];
export const kingdeeSalesSourceImportHeaders=fields.map(([,zh,en])=>`${zh}\n${en}`);
export type KingdeeSalesSourceImportPreview={source:SalesOrderSource;warnings:string[];unmappedColumns:string[]};
const fail=(message:string):never=>{throw new KingdeeSalesSourceImportError(message);};
const headerKey=(value:string)=>value.replace(/\r\n/g,'\n').trim();
const present=(cell:XLSX.CellObject|undefined)=>!!cell&&(cell.f!==undefined||cell.v!==undefined&&cell.v!==null&&String(cell.v).trim()!=='');
function value(cell:XLSX.CellObject|undefined):string{return cell?.v===undefined||cell.v===null?'':String(cell.v);}
function display(cell:XLSX.CellObject|undefined,date1904=false):string{
 if(!cell)return '';
 if(cell.t==='n'&&cell.z&&XLSX.SSF.is_date(cell.z))return XLSX.SSF.format('yyyy-mm-dd',cell.v as number,{date1904});
 return value(cell);
}
function checkZip(bytes:Uint8Array){
 if(!bytes.byteLength||bytes.byteLength>kingdeeSalesSourceImportLimits.bytes)fail('订单文件须在 8 MiB 以内。');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<4||view.getUint32(0,true)!==0x04034b50)fail('请上传标准 XLSX 工作簿。');
 let count=0,size=0;
 for(let i=0;i+46<=bytes.length;i++){
  if(view.getUint32(i,true)!==0x02014b50)continue;
  const length=view.getUint16(i+28,true),extra=view.getUint16(i+30,true),comment=view.getUint16(i+32,true);
  if(i+46+length+extra+comment>bytes.length)fail('工作簿结构不完整。');
  const name=new TextDecoder().decode(bytes.subarray(i+46,i+46+length));
  if(/vbaProject|externalLinks\//i.test(name))fail('上传模板不支持宏或外部工作簿链接，请另存为仅含数据的 XLSX。');
  size+=view.getUint32(i+24,true);count++;
  if(size>kingdeeSalesSourceImportLimits.expandedBytes||count>kingdeeSalesSourceImportLimits.entries)fail('工作簿展开后过大，请使用下载的模板。');
  i+=45+length+extra+comment;
 }
 if(!count)fail('工作簿结构无法识别。');
}
/** Generates an empty application template. No business example rows are seeded. */
export function kingdeeSalesSourceImportTemplate():ArrayBuffer{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([kingdeeSalesSourceImportHeaders]);
 sheet['!cols']=fields.map(([,zh])=>({wch:Math.max(17,Math.min(36,zh.length*2+4))}));
 sheet['!rows']=[{hpt:36}];
 // Excel must retain identifiers such as 001 when the empty template is filled.
 // Styled empty strings are never treated as source detail by present().
 const identifierFields=new Set<FieldKey>(['orderNo','customer','customerPO','category','drawing','model','sku','color','finish']);
 for(let r=1;r<=kingdeeSalesSourceImportLimits.rows;r++)for(let c=0;c<fields.length;c++)if(identifierFields.has(fields[c][0]))sheet[XLSX.utils.encode_cell({r,c})]={t:'s',v:'',z:'@'};
 sheet['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:kingdeeSalesSourceImportLimits.rows,c:fields.length-1}});
 XLSX.utils.book_append_sheet(book,sheet,KINGDEE_SALES_SOURCE_SHEET);
 const guide=XLSX.utils.aoa_to_sheet([
  ['中英文销售订单上传说明'],
  ['在“中英订单上传”第 2 行开始填写，每行一条款色明细，不合并单元格。'],
  ['一次上传同一客户、同一订单、同一成品类别。订单号、客户号、客户订单号和成品类别码须逐行重复填写。'],
  ['必填：订单号、客户号、成品类别码、图纸编号、客款号、色号、数量、单位。标识与编码使用文本格式。'],
  ['成品类别码：AC、TI、SS、AC+TI、GJ-AC+TI、GJ-AC、GJ-TI、TI+AC、NJ/SUN、NJ+CP、NJ、MU+SS、CP。'],
  ['样办数量独立保存，留空表示未提供，不自动与数量相加。单价、日期和币别等缺项可在生成金蝶草稿后核对。'],
  ['板料编码或电镀颜色按对应成品规则填写。原单 SKU 另存，不作为金蝶商品编码。'],
  ['计价方式可填“不含税”或“含税”；是否赠品可填“是”或“否”；业务类型按实际填写，不设默认。'],
  ['日期使用 YYYY-MM-DD。未知原文可在右侧增加带明确标题的列，上传预览会保留原值及来源位置。'],
  ['请将已计算的业务字段粘贴为值。上传只形成待核对的销售原单，客服另行确认金蝶销售订单。'],
 ]);guide['!cols']=[{wch:115}];XLSX.utils.book_append_sheet(book,guide,'填写说明');
 return XLSX.write(book,{type:'array',bookType:'xlsx',compression:true}) as ArrayBuffer;
}
/** Pure preview: never stores files, creates orders, approves or calls ERP. */
export async function parseKingdeeSalesSourceWorkbook(bytes:Uint8Array,filename:string):Promise<KingdeeSalesSourceImportPreview>{
 if(!filename||filename.length>300||!filename.toLowerCase().endsWith('.xlsx'))fail('请上传名称有效的 .xlsx 文件。');
 checkZip(bytes);
 let book:XLSX.WorkBook;
 try{book=XLSX.read(bytes,{type:'array',cellDates:false,cellFormula:true,cellNF:true,cellStyles:true,nodim:true});}catch{fail('无法读取工作簿，请上传未加密的标准 XLSX 模板。');}
 if(!book!.SheetNames.includes(KINGDEE_SALES_SOURCE_SHEET))fail(`未找到“${KINGDEE_SALES_SOURCE_SHEET}”工作表，请使用下载的中英文上传模板。`);
 if(book!.SheetNames.some(name=>![KINGDEE_SALES_SOURCE_SHEET,'填写说明'].includes(name)))fail('此入口使用固定上传模板，请将所需一张订单放入“中英订单上传”，其他工作表另行保留。');
 const sheet=book!.Sheets[KINGDEE_SALES_SOURCE_SHEET],range=XLSX.utils.decode_range(sheet['!ref']||'A1'),date1904=book!.Workbook?.WBProps?.date1904===true;
 if(range.e.c>=kingdeeSalesSourceImportLimits.columns||range.e.r>kingdeeSalesSourceImportLimits.rows)fail('一次最多上传 1,000 条明细、100 列，请按订单分批。');
 if(sheet['!merges']?.length)fail('上传明细不能含合并单元格，请逐行填写完整订单资料。');
 const aliases=new Map<string,FieldKey>();for(const [key,zh,en] of fields)for(const name of [zh,en,`${zh}\n${en}`])aliases.set(headerKey(name),key);
 const headers:string[]=[],mapped=new Map<FieldKey,number>(),unmappedColumns:string[]=[];
 for(let c=0;c<=range.e.c;c++){
  const cell=sheet[XLSX.utils.encode_cell({r:0,c})];if(cell?.f)fail('第 1 行表头不能含公式。');
  const raw=value(cell),header=headerKey(raw);headers.push(raw);
  if(!header){if(Array.from({length:range.e.r},(_,i)=>present(sheet[XLSX.utils.encode_cell({r:i+1,c})])).some(Boolean))fail(`第 ${XLSX.utils.encode_col(c)} 列有数据但没有表头。`);continue;}
  if(raw.length>1000)fail('表头文字超过 1,000 字符。');
  const key=aliases.get(header);if(key){if(mapped.has(key))fail(`“${fields.find(item=>item[0]===key)![1]}”对应多个来源列，请只保留一列。`);mapped.set(key,c);}else unmappedColumns.push(`${XLSX.utils.encode_col(c)}：${raw}`);
 }
 for(const [key,zh,,required] of fields)if(required&&!mapped.has(key))fail(`缺少必填列“${zh}”，请使用下载的模板。`);
 const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer),sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 const lines:SalesOrderSource['lines']=[],warnings:string[]=[],head=new Map<string,string>();
 for(let r=1;r<=range.e.r;r++){
  if(!headers.some((_,c)=>present(sheet[XLSX.utils.encode_cell({r,c})])))continue;
  const get=(key:FieldKey)=>{const c=mapped.get(key);return c===undefined?'':display(sheet[XLSX.utils.encode_cell({r,c})],date1904);};
  for(const [key,c] of mapped){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell?.f)fail(`第 ${r+1} 行“${fields.find(item=>item[0]===key)![1]}”含公式，请粘贴为值后上传。`);if(cell?.t==='e')fail(`第 ${r+1} 行含 Excel 错误值。`);}
  for(const [key,zh,,required] of fields)if(required&&!get(key).trim())fail(`第 ${r+1} 行“${zh}”不能为空。`);
  for(const key of ['orderNo','customer','customerPO','category','billDate','employee','currency','exchangeRate','businessType','taxMode'] as const){const current=get(key);if(head.has(key)&&head.get(key)!==current)fail(`第 ${r+1} 行“${fields.find(item=>item[0]===key)![1]}”与前行不一致，请核对订单头并逐行填写一致。`);head.set(key,current);}
  if(!(KINGDEE_SALES_CATEGORIES as readonly string[]).includes(get('category')))fail(`第 ${r+1} 行成品类别码不在已核定的成品编码规则中。`);
  for(const key of ['orderNo','customer','customerPO','drawing','model','sku','color'] as const){const c=mapped.get(key),cell=c===undefined?undefined:sheet[XLSX.utils.encode_cell({r,c})];if(present(cell)&&cell?.t==='n')fail(`第 ${r+1} 行“${fields.find(item=>item[0]===key)![1]}”须使用文本格式，避免丢失前导零。`);}
  const number=(key:'quantity'|'sampleQuantity')=>{const raw=get(key).trim();if(!raw&&key==='sampleQuantity')return null;if(!/^\d+(?:\.\d{1,6})?$/.test(raw))fail(`第 ${r+1} 行数量须为最多 6 位小数的非负数字。`);const n=Number(raw);if(!Number.isFinite(n)||n>1e9)fail(`第 ${r+1} 行数量超过支持范围。`);return n;};
  const rawFields:SalesOrderSource['lines'][number]['rawFields']=headers.flatMap((label,c)=>{
   if(!label)return [];const address=XLSX.utils.encode_cell({r,c}),cell=sheet[address],key=Array.from(mapped).find(([,index])=>index===c)?.[0];
   const canonical=key?fields.find(item=>item[0]===key)![1]:label;
   return [{column:XLSX.utils.encode_col(c),label:canonical,cell:address,value:cell?.f?'='+cell.f:cell?.v===undefined||cell.v===null?null:value(cell),sourceAnchor:address,formula:cell?.f?'='+cell.f:null,cachedValue:cell?.f?value(cell):null,hidden:!!sheet['!cols']?.[c]?.hidden}];
  });
  if(rawFields.some(field=>field.formula))warnings.push(`第 ${r+1} 行附加栏目含公式，仅保留公式及原缓存，不执行计算。`);
  if(sheet['!rows']?.[r]?.hidden)warnings.push(`第 ${r+1} 行在原表中隐藏，仍完整保留，请核对是否属于本订单。`);
  lines.push({id:`xlsx_${sha256.slice(0,24)}_${r+1}`,sourceRow:r+1,drawing:get('drawing'),model:get('model'),color:get('color'),sku:get('sku'),quantity:number('quantity')!,unit:get('unit'),sampleQuantity:number('sampleQuantity'),unitPrice:get('unitPrice'),deliveryText:get('delivery'),colorFields:[],rawFields,notes:[get('english'),get('chinese'),get('notes')].filter(Boolean)});
 }
 if(!lines.length)fail('没有可导入的订单明细，请从第 2 行开始填写。');
 if(unmappedColumns.length)warnings.push(`${unmappedColumns.length} 个附加栏目已保留原值及来源位置，未自动映射为金蝶字段。`);
 let source:SalesOrderSource;
 try{source=parseSalesOrderSource({schemaVersion:1,orderNo:head.get('orderNo'),customer:head.get('customer'),productType:head.get('category'),customerPO:head.get('customerPO')||'',documentType:'Sales Order Confirmation',source:{filename,sha256,sheet:KINGDEE_SALES_SOURCE_SHEET,detailRange:`A2:${XLSX.utils.encode_col(range.e.c)}${range.e.r+1}`},warnings,lines});}catch(error){fail(`原单资料校验未通过：${error instanceof Error?error.message:'请核对字段长度与内容。'}`);}
 return {source:source!,warnings,unmappedColumns};
}
