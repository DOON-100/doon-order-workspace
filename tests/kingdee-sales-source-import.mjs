// Synthetic workbooks only. Never reads a production database, file bucket or server.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {build} from 'esbuild';

const output=path.resolve('test-output/kingdee-sales-source-import');await mkdir(output,{recursive:true});
const outfile=path.join(output,'parser.mjs');
await build({entryPoints:['lib/kingdee-sales-source-import.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external'});
const parser=await import(pathToFileURL(outfile).href);
const {KINGDEE_SALES_SOURCE_SHEET:sheetName,kingdeeSalesSourceImportTemplate:template,parseKingdeeSalesSourceWorkbook:parse,kingdeeSalesSourceImportHeaders:headers}=parser;
const row=['SYN-ORDER-001','C999','SYN-PO-(unchanged)','TI','SYN-DRAW-A','SYN-MODEL-A','SYN-SKU-A','C03A',12,'PCS',null,'3.50','2026-12-01','光金','2026-10-22','Synthetic employee','Synthetic currency','1','赊销','不含税','0','否',' Original / text ','工艺原文',''];
function workbook(rows=[row],extraHeaders=[],patch=()=>{}){
 const book=XLSX.read(template());const sheet=XLSX.utils.aoa_to_sheet([[...headers,...extraHeaders],...rows]);book.Sheets[sheetName]=sheet;patch(book,sheet);return new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx',compression:true}));
}
let checks=0;const pass=message=>{checks++;console.log('PASS '+message);};
const firstBytes=workbook(),first=await parse(firstBytes,'synthetic-order.xlsx');
assert.equal(first.source.lines.length,1);assert.equal(first.source.lines[0].sampleQuantity,null);assert.equal(first.source.lines[0].unitPrice,'3.50');assert.equal(first.source.lines[0].color,'C03A');assert.equal(first.source.lines[0].sku,'SYN-SKU-A');assert.equal(first.source.customerPO,'SYN-PO-(unchanged)');assert.equal(first.source.lines[0].rawFields.find(f=>f.label==='客户英文原文').value,' Original / text ');assert.equal(first.source.lines[0].rawFields.find(f=>f.label==='板料编码或电镀颜色').value,'光金');
assert.match(first.source.source.sha256,/^[a-f0-9]{64}$/);assert.equal((await parse(firstBytes,'synthetic-order.xlsx')).source.lines[0].id,first.source.lines[0].id);pass('Fixed bilingual upload preserves identifiers, source values, blanks and stable hash identity');
const zero=[...row];zero[10]=0;zero[11]='0';const zeroResult=await parse(workbook([zero]),'synthetic-zero.xlsx');assert.equal(zeroResult.source.lines[0].sampleQuantity,0);assert.equal(zeroResult.source.lines[0].unitPrice,'0');pass('Explicit zero stays distinct from missing sample quantity and price');
const unknown=await parse(workbook([[...row,'=HYPERLINK("https://synthetic.invalid")','raw color']],['Original custom','Extra color'],(_book,sheet)=>{sheet.Z2={t:'n',f:'1+2',v:3};sheet['!cols']=Array.from({length:27},(_,i)=>({hidden:i===26}));}),'synthetic-extra.xlsx');
assert.equal(unknown.unmappedColumns.length,2);assert.equal(unknown.source.lines[0].rawFields.find(f=>f.column==='Z').formula,'=1+2');assert.equal(unknown.source.lines[0].rawFields.find(f=>f.column==='Z').cachedValue,'3');assert.equal(unknown.source.lines[0].rawFields.find(f=>f.column==='AA').value,'raw color');assert.equal(unknown.source.lines[0].rawFields.find(f=>f.column==='AA').hidden,true);assert(unknown.warnings.length);pass('Unknown columns and formulas stay inspectable without executing or mapping them');
const dateResult=await parse(workbook([row],[],(book,sheet)=>{book.Workbook={WBProps:{date1904:true}};sheet.M2={t:'n',v:1,z:'yyyy-mm-dd'};sheet['!rows']=[{}, {hidden:true}];}),'synthetic-date.xlsx');assert.equal(dateResult.source.lines[0].deliveryText,'1904-01-02');assert.equal(dateResult.source.lines[0].rawFields.find(f=>f.column==='M').value,'1');assert(dateResult.warnings.some(v=>v.includes('隐藏')));pass('Excel 1904 dates and hidden source rows preserve their actual interpretation and original values');
const rejects=async(bytes,message)=>assert.rejects(()=>parse(bytes,'synthetic-rejected.xlsx'),message);
await rejects(workbook([row],[],(_book,sheet)=>{sheet.I2={t:'n',f:'6*2',v:12};}),/公式/);
await rejects(workbook([row],[],(_book,sheet)=>{sheet.A2={t:'n',v:123};}),/文本格式/);
await rejects(workbook([row],[],(_book,sheet)=>{sheet['!merges']=[{s:{r:1,c:0},e:{r:1,c:1}}];}),/合并/);
const other=[...row];other[1]='C998';await rejects(workbook([row,other]),/不一致/);
const otherCurrency=[...row];otherCurrency[16]='Another currency';await rejects(workbook([row,otherCurrency]),/币别名称/);
const missing=[...row];missing[8]='';await rejects(workbook([missing]),/数量/);
await rejects(workbook([row],['Quantity']),/多个来源列/);
await rejects(workbook([row],[],(_book,sheet)=>{sheet.A5000={t:'s',v:'SYN-HIDDEN-TAIL'};sheet['!ref']='A1:Y5000';}),/1,000/);
await rejects(new Uint8Array(2),/XLSX/);await rejects(new Uint8Array(9*1024*1024),/8 MiB/);
pass('Rejects formula-driven business values, coerced identifiers, merges, conflicting heads, duplicate mapping and truncated tails');
await rejects(new Uint8Array(template()),/没有可导入/);
const changed=new Uint8Array(firstBytes);changed[0]=0;await rejects(changed,/XLSX/);pass('Empty template and malformed file cannot create a source');
const formattedBook=XLSX.read(template(),{cellNF:true}),formattedSheet=formattedBook.Sheets[sheetName];
for(const col of ['A','B','C','D','E','F','G','H','N'])for(const r of [2,501,1001])assert.equal(formattedSheet[col+r]?.z,'@');
const textCodeRow=[...row];textCodeRow[7]='001';
for(let c=0;c<textCodeRow.length;c++){const address=XLSX.utils.encode_cell({r:1,c}),value=textCodeRow[c];if(value!==null)formattedSheet[address]={...formattedSheet[address],t:typeof value==='number'?'n':'s',v:value};}
const formattedResult=await parse(new Uint8Array(XLSX.write(formattedBook,{type:'array',bookType:'xlsx',compression:true})),'synthetic-formatted-template.xlsx');
assert.equal(formattedResult.source.lines.length,1);assert.equal(formattedResult.source.lines[0].color,'001');pass('Downloaded template protects text identifiers across 1,000 rows and ignores styled empty detail rows');
console.log(`PASS ${checks} source import test groups`);
