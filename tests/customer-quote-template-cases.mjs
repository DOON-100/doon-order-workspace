import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';

// All fixtures are synthetic; no customer workbook, material number or price is embedded.
function fixture({conflict=false,formula=false}={}){
 const sheet=XLSX.utils.aoa_to_sheet([
  ['Synthetic spare part quotation'],[],[],[],
  ['English Model Name','Material Number','Material Description','Unit Price Whole Model','Standardized EN'],
  ['SYN-A','MAT-A','FRAME RAW SIZE 50-20'],
  ['', 'MAT-B','BRIDGE IP SILVER'],
  ['', 'MAT-C','TEMPLE TIP LEFT'],
  ['SYN-B','MAT-A',conflict?'FRAME RAW SIZE 51-20':'FRAME RAW SIZE 50-20'],
  ['', 'MAT-B','BRIDGE IP SILVER'],
  ['PADS'],
  ['', 'MAT-D','NOSE PAD TRANSPARENT'],
 ]);
 sheet['!merges']=[XLSX.utils.decode_range('A1:D1'),XLSX.utils.decode_range('A6:A8'),XLSX.utils.decode_range('A9:A10')];
 if(formula)sheet.D6={t:'n',v:2,f:'1+1'};
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Customer Sheet');
 return new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx',compression:true}));
}
function edit(bytes,path,fn){const files=unzipSync(bytes);files[path]=strToU8(fn(strFromU8(files[path])));return zipSync(files,{level:6});}
function withFile(bytes,path,value){const files=unzipSync(bytes);files[path]=typeof value==='string'?strToU8(value):value;return zipSync(files,{level:6});}
async function moduleUnderTest(){
 const result=await build({entryPoints:['lib/customer-quote-template.ts'],bundle:true,platform:'node',format:'cjs',write:false});
 const loaded={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);return loaded.exports;
}
export async function testCustomerQuoteTemplate({pass=()=>{}}={}){
 const {parseCustomerQuoteTemplate,exportCustomerQuoteTemplate,validateCustomerQuoteTemplateOutput,assertCustomerQuoteTemplateExportable}=await moduleUnderTest();
 const source=fixture(),template=await parseCustomerQuoteTemplate(source);
 assert.equal(template.items.length,4);assert.equal(template.rowMappings.length,6);
 assert.deepEqual(template.items[0].sourceRows,[6,9]);assert.deepEqual(template.items[0].modelNames,['SYN-A','SYN-B']);
 assert.equal(template.rowMappings[1].modelName,'SYN-A');assert.equal(template.rowMappings[5].modelName,'PADS');
 assert.equal(template.items[2].supplyStage,'unknown');assert.equal(template.items[2].side,'left');assert.equal(template.items[0].unit,null);
 assert.equal(template.rowMappings[0].description,'FRAME RAW SIZE 50-20');
 pass('客户模板保留原文、父款合并与所有重复物料位置，单位不自动推断');
 const prices=template.items.map((item,i)=>({itemId:item.id,materialNumber:item.materialNumber,description:item.description,unit:i===3?'pair':'piece',unitPrice:[5.25,1.2,0,0.5][i],status:'confirmed',quantity:null,scopeNotesEn:'Includes listed part only; excludes assembly.',quantityBasisEn:'Synthetic applicability basis',factoryModel:'SYN-F-'+i,customerModel:item.modelNames.join(' / '),component:item.partType,side:item.side,supplyStage:item.supplyStage}));
 const metadata={quoteNo:'SYN-Q-01',quoteDate:'2026-01-01',validUntil:'2026-02-01',currency:'USD',quantityMode:'price_list',brand:'SYN',businessType:'spare parts',terms:['Payment: synthetic term only','Scope: each listed material']};
 const input={template,prices,metadata},output=await exportCustomerQuoteTemplate(source,input),book=XLSX.read(output,{type:'array'});
 assert.deepEqual(book.SheetNames,['Customer Sheet','Terms']);assert.equal(book.Sheets['Customer Sheet'].D6.v,5.25);assert.equal(book.Sheets['Customer Sheet'].D9.v,5.25);assert.equal(book.Sheets['Customer Sheet'].D8.v,0);
 assert.equal(book.Sheets.Terms.D11.v,'piece');assert.equal(book.Sheets.Terms.F11.v,'USD');assert.equal(book.Sheets.Terms.E11,undefined);
 assert.equal(book.Sheets.Terms.G11.v,5.25);assert.equal(book.Sheets.Terms.H11.v,prices[0].scopeNotesEn);assert.equal(book.Sheets.Terms.I11.v,prices[0].quantityBasisEn);assert.equal(book.Sheets.Terms.N11.v,'raw');
 assertCustomerQuoteTemplateExportable(input);
 assert.deepEqual(await validateCustomerQuoteTemplateOutput(output,input),{valid:true,rowCount:6,itemCount:4});
 pass('已确认价格写入每个重复位置，生成币种单位条款并可验证成品');
 const before=unzipSync(source),after=unzipSync(output),changed=new Set(['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels',template.worksheetPath]);
 for(const name of Object.keys(before))if(!changed.has(name))assert.deepEqual(after[name],before[name],name);
 assert.equal(Object.keys(after).length,Object.keys(before).length+1);
 const originalXml=strFromU8(before[template.worksheetPath]),changedXml=strFromU8(after[template.worksheetPath]);
 const withoutPrices=value=>value.replace(/<c\b[^>]*\br="D(?:6|7|8|9|10|12)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,'');
 assert.equal(withoutPrices(changedXml),withoutPrices(originalXml));
 pass('原 ZIP 非价格内容逐字节保留，仅改价格格和添加 Terms 所需封装');
 const priceChanged=edit(output,template.worksheetPath,x=>x.replace('<v>5.25</v>','<v>6.25</v>'));
 await assert.rejects(()=>validateCustomerQuoteTemplateOutput(priceChanged,input),/请先修订并确认/);
 const materialChanged=edit(output,template.worksheetPath,x=>x.replace('MAT-A','MAT-X'));
 await assert.rejects(()=>validateCustomerQuoteTemplateOutput(materialChanged,input),/已变化/);
 const descriptionChanged=edit(output,template.worksheetPath,x=>x.replace('FRAME RAW SIZE 50-20','FRAME RAW SIZE 60-20'));
 await assert.rejects(()=>validateCustomerQuoteTemplateOutput(descriptionChanged,input),/已变化/);
 pass('实际对客文件的价格、物料号或原文说明变更必须先修订确认');
 const unitChanged=edit(output,'xl/worksheets/customerQuoteTerms.xml',x=>x.replace('>piece<','>set<'));
 const currencyChanged=edit(output,'xl/worksheets/customerQuoteTerms.xml',x=>x.replace('>USD<','>EUR<'));
 await assert.rejects(()=>validateCustomerQuoteTemplateOutput(unitChanged,input),/Terms/);await assert.rejects(()=>validateCustomerQuoteTemplateOutput(currencyChanged,input),/Terms/);
 const scopeChanged=edit(output,'xl/worksheets/customerQuoteTerms.xml',x=>x.replace('Includes listed part only; excludes assembly.','Includes assembly.'));
 await assert.rejects(()=>validateCustomerQuoteTemplateOutput(scopeChanged,input),/Terms/);
 const extra=edit(output,template.worksheetPath,x=>x.replace('<sheetData>','<sheetData><row r="2"><c r="E2" t="inlineStr"><is><t>Unexpected extra data</t></is></c></row>'));
 await assert.rejects(()=>validateCustomerQuoteTemplateOutput(extra,input),/已变化/);
 pass('成品币种单位条款和额外添加的原表内容均受确认版本约束');
 const bad=(patch)=>({...input,prices:prices.map((p,i)=>i===0?{...p,...patch}:p)});
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,bad({unit:'unknown'})),/单位/);
 assert.throws(()=>assertCustomerQuoteTemplateExportable(bad({unit:'unknown'})),/单位/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,bad({status:'pending'})),/单位/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,bad({unitPrice:NaN})),/单价/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,bad({unitPrice:-1})),/单价/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,{...input,prices:prices.slice(1)}),/唯一/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,{...input,prices:[...prices.slice(0,3),prices[0]]}),/唯一/);
 pass('导出拒绝未确认单位、未确认价格、非法价格及缺漏或重复规范报价行');
 const conflictSource=fixture({conflict:true}),conflict=await parseCustomerQuoteTemplate(conflictSource);assert.equal(conflict.items[0].conflicts.length,1);assert.equal(conflict.rowMappings.length,6);
 await assert.rejects(()=>exportCustomerQuoteTemplate(conflictSource,{...input,template:conflict}),/冲突/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,bad({description:'A revised description'})),/原文/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,{...input,template:{...template,rowMappings:template.rowMappings.slice(1)}}),/映射/);
 pass('共享物料说明冲突保留待处理，禁止不一致规格或被修改的行映射导出');
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,{...input,metadata:{...metadata,quantityMode:'order'}}),/正整数/);
 const orderPrices=prices.map(p=>({...p,quantity:20}));
 const orderOutput=await exportCustomerQuoteTemplate(source,{...input,prices:orderPrices,metadata:{...metadata,quantityMode:'order'}});assert.equal(XLSX.read(orderOutput).Sheets.Terms.E11.v,20);
 const basisOutput=await exportCustomerQuoteTemplate(source,{...input,prices:orderPrices});assert.equal(XLSX.read(basisOutput).Sheets.Terms.E10.v,'Quantity basis (price list only)');
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,bad({quantity:0})),/正整数/);
 pass('订单数量必须确认，价目数量只记录适用基准且不生成订单金额');
 await assert.rejects(()=>parseCustomerQuoteTemplate(fixture({formula:true})),/公式/);
 const macro=withFile(source,'xl/vbaProject.bin',new Uint8Array([1,2,3]));await assert.rejects(()=>parseCustomerQuoteTemplate(macro),/额外内容/);
 const external=edit(source,'_rels/.rels',x=>x.replace('</Relationships>','<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>'));
 await assert.rejects(()=>parseCustomerQuoteTemplate(external),/外部链接/);
 const hidden=edit(source,'xl/workbook.xml',x=>x.replace('<sheet name=','<sheet state="hidden" name='));await assert.rejects(()=>parseCustomerQuoteTemplate(hidden),/隐藏/);
 const extraSheet=withFile(source,'xl/worksheets/sheet2.xml','<worksheet/>');await assert.rejects(()=>parseCustomerQuoteTemplate(extraSheet),/未登记/);
 const customData=withFile(source,'docProps/custom.xml','<Properties><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="PrivateNote"><vt:lpwstr>unexpected extra data</vt:lpwstr></property></Properties>');await assert.rejects(()=>parseCustomerQuoteTemplate(customData),/属性内容/);
 const extraExtension=edit(source,'xl/workbook.xml',x=>x.replace('</workbook>','<extLst><ext uri="test"><privateNote>unexpected extra data</privateNote></ext></extLst></workbook>'));await assert.rejects(()=>parseCustomerQuoteTemplate(extraExtension),/附加内容/);
 pass('模板公式、宏外链、隐藏表及未登记附加表明确阻止导出');
 const inflated=withFile(source,'xl/sharedStrings.xml',new Uint8Array(9*1024*1024));await assert.rejects(()=>parseCustomerQuoteTemplate(inflated),/压缩内容超过/);
 const traversal=withFile(source,'../outside.xml','test');await assert.rejects(()=>parseCustomerQuoteTemplate(traversal),/不安全/);
 await assert.rejects(()=>parseCustomerQuoteTemplate(source.subarray(0,source.length-10)),/ZIP/);
 pass('ZIP 在解压前限制膨胀大小并拒绝路径穿越和损坏结构');
 const changedSource=edit(source,template.worksheetPath,x=>x.replace('SYN-A','SYN-C'));await assert.rejects(()=>exportCustomerQuoteTemplate(changedSource,input),/摘要/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,{...input,metadata:{...metadata,currency:'usd'}}),/币种/);
 await assert.rejects(()=>exportCustomerQuoteTemplate(source,{...input,metadata:{...metadata,validUntil:'2026-02-30'}}),/日期/);
 pass('模板原件摘要、日期及币种必须与可确认版本一致');
 return {passed:11};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await testCustomerQuoteTemplate({pass:name=>console.log('PASS '+name)});}
