import * as XLSX from 'xlsx';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {AppError} from './store';
import {openWorkbook} from './workbooks';
import {finishedSalesCode} from './kingdee-sales-core';
import type {KingdeeSalesDraft} from './kingdee-sales-types';

export const KINGDEE_SALES_TEMPLATE_FIELDS=['billno','billdate','customerid.number','empid.name','currencyid.name','exchangerate','transtype','materialid.number','unit.name','qty','price','cess','is_free','deliverydate','custbillno'];
export const KINGDEE_SALES_TEMPLATE_HEADERS=['*单据编号 # billno','*单据日期 # billdate','*客户.编码 # customerid.number','*业务员.名称 # empid.name','*币别.名称 # currencyid.name','*汇率 # exchangerate','*业务类型 # transtype','*商品.编码 # materialid.number','*单位.名称 # unit.name','*数量 # qty','*单价 # price','*增值税税率（%） # cess','是否赠品 # is_free','*预计交货日期 # deliverydate','*客户订单号 # custbillno'];
const escape=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function xmlText(value:unknown){const text=String(value??'');if(text.length>32767||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))throw new AppError('订单含有 Excel 无法无损保存的字符或超长文本，请核对后导出。',422);return escape(text.replace(/_x[0-9a-fA-F]{4}_/g,match=>'_x005F_'+match.slice(1))).replace(/\r/g,'&#13;');}
function cell(address:string,value:unknown,style=''){return typeof value==='number'?`<c r="${address}"${style}><v>${value}</v></c>`:`<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;}
export function inspectSalesTemplate(bytes:ArrayBuffer){
 const book=openWorkbook(bytes),name='sheet1（名称勿改）',sheet=book.Sheets[name];
 if(!sheet)throw new AppError('金蝶模板须包含“sheet1（名称勿改）”工作表，请上传原始销售订单模板。');
 const headers=KINGDEE_SALES_TEMPLATE_FIELDS.map((_,i)=>String(sheet[XLSX.utils.encode_cell({r:2,c:i})]?.v||''));
 if(headers.some((h,i)=>h.split('#').at(-1)?.trim()!==KINGDEE_SALES_TEMPLATE_FIELDS[i]))throw new AppError('金蝶销售订单模板第 3 行的 15 个字段与当前规则不符，请管理员核对模板版本。');
 if(XLSX.utils.decode_range(sheet['!ref']||'A1').e.c!==14)throw new AppError('金蝶销售订单模板须恰好包含 15 列，扩展模板须先核定映射。');
 const entries=unzipSync(new Uint8Array(bytes));if(!entries['xl/workbook.xml']||Object.keys(entries).some(k=>/vbaProject|externalLinks|comments|threadedComments|drawings|embeddings/i.test(k)))throw new AppError('模板须为不含宏、外部链接、批注、图片或嵌入附件的标准销售订单 XLSX 文件。');
 for(const extra of book.SheetNames.filter(v=>v!==name)){
  if(extra==='模板说明'){const note=book.Sheets[extra],cells=Object.keys(note).filter(k=>!k.startsWith('!')&&note[k]?.v!==undefined);if(cells.length===1&&cells[0]==='A1'&&note.A1.v==='用户自定义模板'&&!note.A1.f)continue;throw new AppError('模板说明页已修改，请重新使用原始金蝶模板。');}
  const meta=book.Workbook?.Sheets?.find(v=>v.name===extra),names=book.Workbook?.Names||[];
  if(!meta?.Hidden||!names.some(v=>v.Ref.startsWith(extra+'!')||v.Ref.startsWith("'"+extra.replace(/'/g,"''")+"'!")))throw new AppError('金蝶模板含未核定的附页；仅允许主表和由命名范围引用的隐藏字典。');
 }
 return {book,name,sheet,headers,entries};
}
/** Patch only the main XML data region; hidden dictionaries, validation rules,
 * named ranges and styles remain in their original OOXML package. */
export function salesTemplateWorkbook(bytes:ArrayBuffer,draft:KingdeeSalesDraft):ArrayBuffer{
 const {book,name,sheet,entries}=inspectSalesTemplate(bytes),input=draft.inputs;
 if(input.taxMode!=='exclusive')throw new AppError('当前模板仅有不含税单价 price 列；含税价格草稿须先核对并转为不含税单价后导出，系统不会猜测转换精度。');
 let workbook=strFromU8(entries['xl/workbook.xml']),relations=strFromU8(entries['xl/_rels/workbook.xml.rels']);
 const tags=workbook.match(/<sheet\b[^>]*>/g)||[],main=tags.find(t=>t.includes(`name="${escape(name)}"`)),rid=main?.match(/r:id="([^"]+)"/)?.[1];
 const target=(relations.match(/<Relationship\b[^>]*>/g)||[]).find(t=>t.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
 if(!target)throw new AppError('金蝶模板工作表关系缺失。');
 const key=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');let xml=strFromU8(entries[key]);
 const oldRows=xml.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)||[],sample=oldRows.find(r=>/^<row\b[^>]*\br="4"/.test(r))||'',styles=new Map<string,string>();
 for(const tag of sample.match(/<c\b[^>]*>/g)||[]){const column=tag.match(/r="([A-Z]+)4"/)?.[1],style=tag.match(/\bs="[^"]*"/)?.[0];if(column&&style)styles.set(column,' '+style);}
 const rows=input.lines.map((line,index)=>{
  const values=[draft.orderNo,input.billDate,input.customerNumber,input.employeeName,input.currencyName,Number(input.exchangeRate),input.businessType,finishedSalesCode(input,line),line.unitName,Number(line.quantity),Number(line.unitPrice),Number(line.taxRate),line.isFree?'是':'否',line.deliveryDate,input.customerPO];
  return `<row r="${index+4}">${values.map((value,column)=>column<7&&index>0?'':cell(XLSX.utils.encode_col(column)+(index+4),value,styles.get(XLSX.utils.encode_col(column))||'')).join('')}</row>`;
 });
 const retained=oldRows.filter(row=>Number(row.match(/\br="(\d+)"/)?.[1])<4).join('');
 xml=xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,`<sheetData>${retained}${rows.join('')}</sheetData>`);
 const last=3+rows.length,merges=rows.length>1?Array.from({length:7},(_,i)=>`<mergeCell ref="${XLSX.utils.encode_col(i)}4:${XLSX.utils.encode_col(i)}${last}"/>`).join(''):'';
 const headerMerges=(xml.match(/<mergeCell\b[^>]*\/>/g)||[]).filter(tag=>{const ref=tag.match(/ref="([^"]+)"/)?.[1];return ref&&XLSX.utils.decode_range(ref).e.r<3;});
 xml=xml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,'');const allMerges=headerMerges.join('')+merges;if(allMerges)xml=xml.replace('</sheetData>',`</sheetData><mergeCells count="${headerMerges.length+(merges?7:0)}">${allMerges}</mergeCells>`);
 xml=xml.replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:O${last}"/>`).replace(/<autoFilter\b[^>]*(?:\/>|>[\s\S]*?<\/autoFilter>)/g,'');
 xml=xml.replace(/sqref="([A-Z]+)4:[A-Z]+\d+"/g,(_,column)=>`sqref="${column}4:${column}${last}"`);
 entries[key]=strToU8(xml);
 // The input may be an export containing prior orders. Resolve shared strings
 // in every worksheet before removing the old pool, so deleted data cannot leak.
 for(const tag of tags){
  const sheetName=tag.match(/name="([^"]+)"/)?.[1],sheetRid=tag.match(/r:id="([^"]+)"/)?.[1],sheetTarget=(relations.match(/<Relationship\b[^>]*>/g)||[]).find(t=>t.includes(`Id="${sheetRid}"`))?.match(/Target="([^"]+)"/)?.[1];
  if(!sheetName||!sheetTarget)continue;const path=sheetTarget.startsWith('/')?sheetTarget.slice(1):'xl/'+sheetTarget.replace(/^\.\//,'');if(!entries[path])continue;
  const sourceSheet=sheetName===escape(name)?sheet:book.Sheets[Object.keys(book.Sheets).find(n=>escape(n)===sheetName)||''];
  entries[path]=strToU8(strFromU8(entries[path]).replace(/<c\b[^>]*?\bt="s"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,full=>{const address=full.match(/r="([^"]+)"/)?.[1],style=full.match(/\bs="[^"]*"/)?.[0];return address?cell(address,sourceSheet?.[address]?.v??'',style?' '+style:''):full;}));
 }
 delete entries['xl/sharedStrings.xml'];delete entries['xl/calcChain.xml'];
 relations=relations.replace(/<Relationship\b[^>]*Type="[^"]*\/(?:sharedStrings|calcChain)"[^>]*\/>/g,'');entries['xl/_rels/workbook.xml.rels']=strToU8(relations);
 entries['[Content_Types].xml']=strToU8(strFromU8(entries['[Content_Types].xml']).replace(/<Override\b[^>]*PartName="\/xl\/(?:sharedStrings|calcChain)\.xml"[^>]*\/>/g,''));
 const output=zipSync(entries);return output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer;
}
