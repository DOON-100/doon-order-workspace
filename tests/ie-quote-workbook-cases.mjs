// All fixture content is synthetic. Never add customer workbooks to this test.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';

const cell = (address, value) => typeof value === 'number' ? `<c r="${address}" s="1"><v>${value}</v></c>` : `<c r="${address}" s="1" t="inlineStr"><is><t>${value}</t></is></c>`;
function styleSheet(index) {
  const values = { E1:'产品物料清单及报价明细', C3:'SYNTHETIC-CUSTOMER', E3:`SYNTHETIC-MODEL-${index}`, C6:'物料编码', D6:'物料名称', B37:'材料小计', B62:'成本合计（元/副）', D7:'OLD-MATERIAL-DO-NOT-RETAIN', G7:90001, I7:'OLD-TOOLING-NOTE', C72:'OLD-CUSTOMER-PRICE' };
  let rows = '';
  for (let row=1;row<=74;row++) {
    const cells = [];
    for (const col of 'BCDEFGHI') { const a=col+row; cells.push(a in values ? cell(a,values[a]) : `<c r="${a}" s="1"/>`); }
    rows += `<row r="${row}" ht="18.75" customHeight="1">${cells.join('')}</row>`;
  }
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="B1:I74"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="E7" state="frozen"/></sheetView></sheetViews><cols><col min="2" max="9" width="13.4" customWidth="1"/></cols><sheetData>${rows}</sheetData><mergeCells count="1"><mergeCell ref="B64:I64"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.2" right="0.3" top="0.4" bottom="0.5" header="0.1" footer="0.2"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>Internal</oddFooter></headerFooter><drawing r:id="drawing"/></worksheet>`;
}
export function syntheticIeTemplate({ count=4, history=true }={}) {
  const relation=(id,type,target)=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels=items=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
  const entries = {
    '[Content_Types].xml':strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from({length:count},(_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels':strToU8(rels(relation('office','officeDocument','xl/workbook.xml')+relation('metadata','extended-properties','docProps/app.xml'))),
    'docProps/app.xml':strToU8('<Properties>OLD-PRIVATE-METADATA</Properties>'),
    'xl/workbook.xml':strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${Array.from({length:count},(_,i)=>`<sheet name="STYLE${i+1}" sheetId="${i+1}" r:id="r${i+1}"/>`).join('')}${history?'<sheet name="历史资料" sheetId="90" state="hidden" r:id="history"/>':''}</sheets><definedNames>${Array.from({length:count},(_,i)=>`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'STYLE${i+1}'!$B$1:$I$69</definedName>`).join('')}</definedNames><calcPr calcMode="auto"/></workbook>`),
    'xl/_rels/workbook.xml.rels':strToU8(rels(Array.from({length:count},(_,i)=>relation('r'+(i+1),'worksheet',`worksheets/sheet${i+1}.xml`)).join('')+relation('styles','styles','styles.xml')+(history?relation('history','worksheet','worksheets/history.xml'):''))),
    'xl/styles.xml':strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>'),
  };
  if (history) entries['xl/worksheets/history.xml']=strToU8('<worksheet><sheetData><row r="1">'+cell('A1','OTHER-CUSTOMER-SECRET')+'</row></sheetData></worksheet>');
  for (let index=1;index<=count;index++) {
    entries[`xl/worksheets/sheet${index}.xml`]=strToU8(styleSheet(index));
    entries[`xl/worksheets/_rels/sheet${index}.xml.rels`]=strToU8(rels(relation('drawing','drawing',`../drawings/drawing${index}.xml`)));
    entries[`xl/drawings/drawing${index}.xml`]=strToU8(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="100" cy="100"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Synthetic drawing ${index}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
    entries[`xl/drawings/_rels/drawing${index}.xml.rels`]=strToU8(rels(relation('image','image',`../media/image${index}.png`)));
    entries[`xl/media/image${index}.png`]=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB5kAAAAASUVORK5CYII=','base64'));
  }
  return zipSync(entries);
}
const binding = index => ({sheetName:`STYLE${index}`,customerCode:'SYNTHETIC-CUSTOMER',model:`SYNTHETIC-MODEL-${index}`,quantity:300,exchangeRateCnyPerUsd:7,materials:[{name:'Synthetic material',quantity:2,unitCostCny:10,lossRate:0.25,lossAdjustmentReason:'合成单项调整依据',notes:'额外15%'}],processes:[{name:'Synthetic plating',quantity:1,unitCostCny:3}],directLaborCny:5,toolingCharges:[{key:'SYNTHETIC-SHARED-MOULD',name:'Shared synthetic mould',amountCny:800}]});
export async function testIeQuoteWorkbook({pass=console.log}={}) {
  await fs.mkdir('test-output',{recursive:true});
  await build({entryPoints:['lib/ie-quote-workbook.ts'],outfile:'test-output/ie-quote-workbook-test.mjs',bundle:true,format:'esm',platform:'node',packages:'external'});
  const m=await import(pathToFileURL(process.cwd()+'/test-output/ie-quote-workbook-test.mjs').href+'?t='+Date.now());
  const source=syntheticIeTemplate(), original=unzipSync(source), inspection=await m.inspectIeQuoteTemplate(source);
  assert.equal(inspection.canExport,false); assert(inspection.blockers.some(x=>x.includes('历史资料')));
  const ready=await m.prepareIeQuoteTemplate(source,{sheetNames:['STYLE1','STYLE2','STYLE3','STYLE4']});
  assert.equal(ready.sourceSha256,inspection.sha256); assert.equal(ready.inspection.canExport,true); assert.deepEqual(ready.removedSheetNames,['历史资料']);
  const prepared=unzipSync(ready.bytes), text=Object.entries(prepared).filter(([name])=>/xml$/.test(name)).map(([,v])=>strFromU8(v)).join('');
  assert(!text.includes('OTHER-CUSTOMER-SECRET'));assert(!text.includes('OLD-'));assert(!prepared['docProps/app.xml']);assert(!prepared['xl/worksheets/history.xml']);
  for(const sheet of ready.inspection.sheets)assert.equal(sheet.layoutSha256,inspection.sheets.find(s=>s.name===sheet.name).layoutSha256);
  const bindings=[1,2,3,4].map(binding), output=await m.exportIeQuoteWorkbook(ready.bytes,{expectedTemplateSha256:ready.inspection.sha256,bindings}), entries=unzipSync(output.bytes);
  for(const [name,bytes]of Object.entries(prepared))if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)&&!['xl/sharedStrings.xml','xl/styles.xml','xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml'].includes(name))assert.deepEqual(entries[name],bytes,name+' must be byte-preserved');
  for(const name of ['xl/media/image1.png','xl/drawings/drawing1.xml'])assert.deepEqual(entries[name],original[name]);
  for(const section of ['fonts','fills','borders','cellXfs']) {const before=strFromU8(original['xl/styles.xml']).match(new RegExp('<'+section+'[^>]*>([\\s\\S]*?)</'+section+'>'))?.[1];assert(strFromU8(entries['xl/styles.xml']).includes(before));}
  for(const sheet of (await m.inspectIeQuoteTemplate(output.bytes)).sheets.filter(s=>/^STYLE/.test(s.name)))assert.equal(sheet.layoutSha256,inspection.sheets.find(s=>s.name===sheet.name).layoutSha256);
  const first=strFromU8(entries['xl/worksheets/sheet1.xml']);
  assert(first.includes('<f>SUM(ROUND(F7*G7*0.25,6))</f><v>5</v>'));assert(first.includes('<f>H39+H50+H61</f><v>46.7</v>'));assert(first.includes('<f>ROUND(H62*1.3,6)</f><v>60.71</v>'));assert(first.includes('未发布'));assert(first.includes('R1 V1'));assert(first.includes('<f>ROUND(I66/$L$4,6)</f>'));
  assert(first.includes('25%附页'));assert(first.includes('分项'));assert(first.includes('<c r="G8" s="1"/>'));assert(!first.includes('OLD-'));
  assert.equal(output.toolingCharges.length,1);assert.equal(output.toolingCharges[0].chargedAmountCny,800);assert.equal(output.toolingCharges[0].models.length,4);
  const supplement=strFromU8(entries['xl/worksheets/ie-cost-supplement.xml']);assert(supplement.includes('SYNTHETIC-SHARED-MOULD'));assert(supplement.includes('本次单列费用合计'));assert(supplement.includes('材料分项损耗'));assert(supplement.includes('额外15%'));assert.equal(supplement.match(/SYNTHETIC-SHARED-MOULD/g).length,1);
  const repeated=await m.exportIeQuoteWorkbook(ready.bytes,{expectedTemplateSha256:ready.inspection.sha256,bindings});assert.deepEqual(repeated.bytes,output.bytes);const timestamp=new DataView(output.bytes.buffer,output.bytes.byteOffset);assert.equal(timestamp.getUint16(10,true),0);assert.equal(timestamp.getUint16(12,true),33);
  assert(supplement.includes('调整原因：合成单项调整依据'));assert(supplement.includes('额外（百分点）'));assert(supplement.includes('正常 10% + 本项额外百分点 = 本项合计%'));
  const perItem=await m.exportIeQuoteWorkbook(ready.bytes,{expectedTemplateSha256:ready.inspection.sha256,bindings:bindings.map((b,i)=>({...b,materials:[{...b.materials[0],lossRate:i===0?0.25:undefined,lossAdjustmentReason:i===0?'只调整此项':''}]}))});
  const perItemEntries=unzipSync(perItem.bytes);assert(strFromU8(perItemEntries['xl/worksheets/sheet1.xml']).includes('<f>SUM(ROUND(F7*G7*0.25,6))</f><v>5</v>'));for(const i of [2,3,4])assert(strFromU8(perItemEntries[`xl/worksheets/sheet${i}.xml`]).includes('<f>SUM(ROUND(F7*G7*0.1,6))</f><v>2</v>'));
  pass('IE 模板保全：四款原打印区域、行高列宽、合并、页设置、页眉页脚、样式及图片保全；历史和旧输入清除；逐项25%损耗、统一汇率与共用模具单列正确');
  const exportWith=async(changes)=>m.exportIeQuoteWorkbook(ready.bytes,{expectedTemplateSha256:ready.inspection.sha256,bindings,...changes});
  await assert.rejects(()=>exportWith({bindings:[binding(1)]}),/全部款式/);
  await assert.rejects(()=>exportWith({expectedTemplateSha256:'bad'}),/已变化/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,model:'OTHER-MODEL'})}),/不匹配/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,materials:Array(30).fill(b.materials[0])})}),/29 行/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,processes:Array(9).fill(b.processes[0])})}),/8 行/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,exchangeRateCnyPerUsd:0})}),/汇率/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,materials:[{...b.materials[0],unitCostCny:null}]})}),/有效数字/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,toolingCharges:[{...b.toolingCharges[0],amountCny:700}]})}),/不一致/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,expectedAmounts:{material:20,materialLoss:999,productionCost:46.7,factoryPriceCny:60.71,factoryPriceUsd:8.672857}})}),/计算.*不一致/);
  await assert.rejects(()=>exportWith({bindings:bindings.map((b,i)=>i?b:{...b,model:'SYNTHETIC-MODEL-1',quoteNo:'LONG-QUOTE-NUMBER-'.repeat(8)})}),/超出.*固定格宽/);
  const longNotes=await exportWith({bindings:bindings.map(b=>({...b,materials:[{...b.materials[0],notes:'完整损耗依据'.repeat(100)}]}))});assert(strFromU8(unzipSync(longNotes.bytes)['xl/worksheets/sheet1.xml']).includes('25%附页'));assert(strFromU8(unzipSync(longNotes.bytes)['xl/worksheets/ie-cost-supplement.xml']).includes('完整损耗依据'));
  const one=await m.prepareIeQuoteTemplate(source,{sheetNames:['STYLE2']});
  assert.deepEqual(one.inspection.sheets.map(s=>s.name),['STYLE2']);assert(one.inspection.sheets[0].printArea.includes('STYLE2'));
  const oneEntries=unzipSync(one.bytes);assert(oneEntries['xl/media/image2.png']);assert(!oneEntries['xl/media/image1.png']);assert(!strFromU8(oneEntries['xl/workbook.xml']).includes('STYLE1'));
  await m.exportIeQuoteWorkbook(one.bytes,{expectedTemplateSha256:one.inspection.sha256,bindings:[binding(2)]});
  const malicious={...original,'../escape.xml':strToU8('<a/>')};await assert.rejects(()=>m.inspectIeQuoteTemplate(zipSync(malicious)),/文件名不安全/);
  const entity={...original,'xl/styles.xml':strToU8('<!DOCTYPE x [<!ENTITY external SYSTEM "file:///private">]><styleSheet/>')};await assert.rejects(()=>m.inspectIeQuoteTemplate(zipSync(entity)),/XML 实体/);
  const bomb=source.slice(), view=new DataView(bomb.buffer);let offset=0;while(offset<bomb.length-46&&view.getUint32(offset,true)!==0x02014b50)offset++;view.setUint32(offset+24,25*1024*1024,true);await assert.rejects(()=>m.inspectIeQuoteTemplate(bomb),/过大/);
  pass('IE 模板边界：缺款/错图/并发模板变更/超行数/缺价格/汇率为零/共用模具冲突均阻断；单款不夹带其他图片；ZIP路径、实体和解压尺寸校验通过');
  const roundingBindings=bindings.map(b=>({...b,formulaVersion:'ie-cost-v3-excel',materials:[{name:'Synthetic cents A',quantity:1,unitCostCny:.05,lossRate:.1},{name:'Synthetic cents B',quantity:1,unitCostCny:.05,lossRate:.1}],expectedAmounts:{material:.1,materialLoss:.01,productionCost:21.81,factoryPriceCny:28.353,factoryPriceUsd:4.050429}}));
  const rounded=unzipSync((await exportWith({bindings:roundingBindings})).bytes),roundedFirst=strFromU8(rounded['xl/worksheets/sheet1.xml']);
  assert(roundedFirst.includes('<f>ROUND(F7*G7,2)</f><v>0.05</v>'));assert(roundedFirst.includes('<f>ROUND(SUM(ROUND(H7*0.1,6),ROUND(H8*0.1,6)),2)</f><v>0.01</v>'));
  const material=(name,price,lossRate=.1)=>({id:name,name,specification:'Synthetic specification',unit:'',basePrice:price,usage:1,coefficient:1,lossRate,notApplicable:false,notes:'',lossAdjustmentReason:lossRate===.1?'':'Synthetic extra 15 points',priceSource:'Synthetic reference'});
  const quote={id:'synthetic-quote',customerAccountId:'synthetic-customer',customerCode:'SYNTHETIC-CUSTOMER',quoteNo:'SYNTHETIC-LONG-QUOTE-NUMBER-FOR-DRAFT-ONLY',version:1,revision:1,status:'draft',exchangeRateCnyPerUsd:7,exchangeRateDate:'2026-01-01',exchangeRateSource:'Synthetic source',notes:'Internal only',tooling:[],costs:{formulaVersion:'ie-cost-v3-excel'},lines:[1,2,3,4].map(i=>({id:`line-${i}`,model:`SYNTHETIC-MODEL-${i}`,customerModel:'',color:'SYNTHETIC',drawingNo:`SYNTHETIC-MODEL-${i}`,drawingRevision:'A',quantityMin:300,quantityMax:300,structureNotes:'Synthetic structure',scopeNotes:'Synthetic scope',materials:[material('M-A',.335,.25),material('M-B',.335)],processes:[{id:'P',name:'Synthetic direct labor',parentId:'',sequence:1,basePrice:5,difficulty:1,standardSeconds:null,notApplicable:false,notes:'',priceSource:'Synthetic'}],outsourcing:[{id:'O1',category:'plating',name:'Synthetic plating',unitPrice:3,notApplicable:false,notes:'',priceSource:'Synthetic'},{id:'O2',category:'general',name:'Explicitly not applicable',unitPrice:null,notApplicable:true,notes:'Not used',priceSource:''}]})),attachmentRefs:[{attachmentId:'synthetic-attachment',lineId:'line-1',drawingNo:'SYNTHETIC-MODEL-1',drawingRevision:'A',filename:'synthetic-drawing.pdf',sha256:'a'.repeat(64)}]};
  const template={bytes:ready.bytes,expectedSha256:ready.inspection.sha256,sheetBindings:quote.lines.map((l,i)=>({sheetName:`STYLE${i+1}`,lineId:l.id}))};
  const draft=await m.exportIeQuoteDraftWorkbook(quote,{issues:['Synthetic review pending'],template}),draftEntries=unzipSync(draft.bytes),draftFirst=strFromU8(draftEntries['xl/worksheets/sheet1.xml']);
  const allDraftXml=Object.entries(draftEntries).filter(([n])=>n.endsWith('.xml')).map(([,v])=>strFromU8(v)).join('\n');
  assert.equal(draft.templateMode,'original');assert(draftFirst.includes('未审填报草稿'));assert(!draftFirst.includes('已复核'));
  assert(draftFirst.match(/<c r="I66"[^>]*><f>[^<]*<\/f><v>29.25<\/v>/));assert(draftFirst.match(/<c r="H38"[^>]*><f>[^<]*<\/f><v>0.12<\/v>/));
  assert(allDraftXml.includes('ROUND(F2*G2*H2,2)'));assert(allDraftXml.includes('Synthetic extra 15 points'));assert(allDraftXml.includes('额外百分点'));assert(allDraftXml.includes('synthetic-drawing.pdf'));assert(allDraftXml.includes('a'.repeat(64)));assert(allDraftXml.includes(quote.quoteNo));assert(!allDraftXml.includes('OLD-'));assert(!allDraftXml.includes('OTHER-CUSTOMER'));
  assert.deepEqual(draftEntries['xl/media/image1.png'],prepared['xl/media/image1.png']);
  for(const sheet of (await m.inspectIeQuoteTemplate(draft.bytes)).sheets.filter(s=>/^STYLE/.test(s.name)))assert.equal(sheet.layoutSha256,ready.inspection.sheets.find(s=>s.name===sheet.name).layoutSha256);
  assert.deepEqual((await m.exportIeQuoteDraftWorkbook(quote,{issues:['Synthetic review pending'],template})).bytes,draft.bytes);
  const incomplete=structuredClone(quote);incomplete.exchangeRateCnyPerUsd=null;incomplete.lines[0].materials[0].basePrice=null;
  const missing=await m.exportIeQuoteDraftWorkbook(incomplete,{issues:['Missing synthetic price and FX'],template}),missingEntries=unzipSync(missing.bytes),missingFirst=strFromU8(missingEntries['xl/worksheets/sheet1.xml']);
  assert(missingFirst.match(/<c r="I66"[^>]* t="str"><f>[^<]*<\/f><v><\/v>/));assert(missingFirst.match(/<c r="H7"[^>]* t="str"><f>[^<]*<\/f><v><\/v>/));assert(missingFirst.includes('汇率待填'));
  const materialSheet=Object.values(missingEntries).map(v=>strFromU8(v)).find(v=>v.includes('材料金额（公式）'));assert(materialSheet.includes('<c r="F2"'));assert(materialSheet.match(/<c r="F2"[^>]*\/>/));assert(materialSheet.includes('COUNT(F2:H2)=3'));
  const overflow=structuredClone(incomplete);overflow.lines=[overflow.lines[0]];overflow.lines[0].materials=Array.from({length:35},(_,i)=>material(`SYNTHETIC-OVERFLOW-${i+1}`,1));overflow.lines[0].outsourcing=Array.from({length:10},(_,i)=>({id:`O-${i}`,category:i===0?'plating':'general',name:`SYNTHETIC-OUTSOURCE-${i+1}`,unitPrice:1,notApplicable:false,notes:'',priceSource:'Synthetic'}));
  const generic=await m.exportIeQuoteDraftWorkbook(overflow,{issues:['FX pending']}),genericEntries=unzipSync(generic.bytes),genericXml=Object.values(genericEntries).map(v=>strFromU8(v)).join('\n'),genericFirst=strFromU8(genericEntries['xl/worksheets/sheet1.xml']);
  assert.equal(generic.templateMode,'generic');assert(!Object.keys(genericEntries).some(n=>n.includes('/media/')||n.includes('/drawings/')));assert(genericXml.includes('SYNTHETIC-OVERFLOW-35'));assert(genericXml.includes('SYNTHETIC-OUTSOURCE-10'));assert(genericFirst.includes('其余 7 项见材料填报'));assert(genericFirst.includes('其余 3 项见外发填报'));assert(genericFirst.match(/<c r="I66"[^>]*><f>[^<]*<\/f><v>87.36<\/v>/));assert(genericFirst.match(/<c r="I67"[^>]* t="str"><f>[^<]*<\/f><v><\/v>/));
  const legacy=structuredClone(quote);legacy.costs.formulaVersion='ie-cost-v2-line-loss';const legacyEntries=unzipSync((await m.exportIeQuoteDraftWorkbook(legacy,{issues:[],template})).bytes);assert(strFromU8(legacyEntries['xl/worksheets/sheet1.xml']).match(/<c r="I66"[^>]*><f>[^<]*<\/f><v>29.233425<\/v>/));
  await assert.rejects(()=>m.exportIeQuoteDraftWorkbook(quote,{issues:[],template:{...template,expectedSha256:'changed'}}),/已变化/);
  await assert.rejects(()=>m.exportIeQuoteDraftWorkbook({...quote,customerCode:'OTHER-CUSTOMER'},{issues:[],template}),/绑定不一致/);
  await assert.rejects(()=>m.exportIeQuoteDraftWorkbook(quote,{issues:[],template:{...template,sheetBindings:template.sheetBindings.slice(1)}}),/逐款绑定全部/);
  await build({entryPoints:['lib/ie-quote-calculation.ts'],outfile:'test-output/ie-workbook-calculation-test.mjs',bundle:true,format:'esm',platform:'node'});
  const {calculateIeQuote}=await import(pathToFileURL(process.cwd()+'/test-output/ie-workbook-calculation-test.mjs').href+'?t='+Date.now());
  for(const version of ['ie-cost-v2-line-loss','ie-cost-v3-excel']){
    const check=structuredClone(quote);check.quoteNo='IE-CALC-EXPORT';check.costs.formulaVersion=version;check.lines[0].materials[0].basePrice=1.005;check.lines[0].materials[1].basePrice=.123456;check.lines[0].materials[1].coefficient=1.234567;check.lines[0].materials[1].usage=2.234567;check.costs=calculateIeQuote(check);
    const expected=check.costs.lines[0],strictOut=unzipSync((await m.exportIeQuoteWorkbook(ready.bytes,{expectedTemplateSha256:ready.inspection.sha256,bindings:m.makeIeWorkbookBindings(check,template.sheetBindings)})).bytes),draftOut=unzipSync((await m.exportIeQuoteDraftWorkbook(check,{issues:[],template})).bytes);
    for(const out of [strictOut,draftOut])for(const [cell,key]of [['H37','material'],['H38','materialLoss'],['H53','process'],['H62','productionCost'],['I66','factoryPriceCny'],['I67','factoryPriceUsd']]){const found=strFromU8(out['xl/worksheets/sheet1.xml']).match(new RegExp('<c r="'+cell+'"[^>]*><f>[^<]*</f><v>([^<]*)</v>'));assert(found,`${version} ${cell}`);assert.equal(Number(found[1]),expected[key],`${version} ${cell} must reconcile with shared calculator`);}
  }
  pass('IE 未审填报Excel：原模板图片与打印布局保全，缺价/缺汇率保持空白，单位/标准秒数可空，公式按v2/v3匹配，材料单项25%其余10%，超行数全量附页计算，干净通用版与图纸清单可用');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await testIeQuoteWorkbook();
