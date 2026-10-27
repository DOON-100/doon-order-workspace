import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {strFromU8,unzipSync} from 'fflate';
import {syntheticIeTemplate} from './ie-quote-workbook-cases.mjs';

export async function testIeManualWorkbook({pass=console.log}={}){
 await fs.mkdir('test-output',{recursive:true});
 await build({entryPoints:['lib/ie-quote-workbook.ts'],outfile:'test-output/ie-manual-workbook-module.mjs',bundle:true,platform:'node',format:'esm'});
 await build({entryPoints:['lib/ie-quote-calculation.ts'],outfile:'test-output/ie-manual-workbook-calculation.mjs',bundle:true,platform:'node',format:'esm'});
 const m=await import(pathToFileURL(process.cwd()+'/test-output/ie-manual-workbook-module.mjs').href+'?t='+Date.now());
 const {calculateIeQuote,ieAdjustmentTargets:t}=await import(pathToFileURL(process.cwd()+'/test-output/ie-manual-workbook-calculation.mjs').href+'?t='+Date.now());
 const source=syntheticIeTemplate(),prepared=await m.prepareIeQuoteTemplate(source,{sheetNames:['STYLE1']});
 const q={id:'synthetic-manual-quote',customerAccountId:'synthetic-customer',customerCode:'SYNTHETIC-CUSTOMER',quoteNo:'IE-SYNTHETIC-MANUAL',version:3,revision:1,status:'released',exchangeRateCnyPerUsd:7,exchangeRateDate:'2026-01-01',exchangeRateSource:'Synthetic reference',notes:'',manualAdjustments:[],tooling:[{id:'fee',toolingId:'synthetic-common-tool',name:'Synthetic shared tool',lineIds:['line'],amount:100,chargeMode:'charge',chargeQuoteId:'',chargeVersion:null,evidence:'',notes:''}],lines:[{id:'line',model:'SYNTHETIC-MODEL-1',customerModel:'',color:'SYNTHETIC',drawingNo:'SYNTHETIC-MODEL-1',drawingRevision:'A',quantityMin:300,quantityMax:300,structureNotes:'Synthetic structure',scopeNotes:'Synthetic scope',materials:[{id:'m',name:'Synthetic material',specification:'Synthetic spec',unit:'',basePrice:2,usage:3,coefficient:1,lossRate:.1,notApplicable:false,notes:'',lossAdjustmentReason:'',priceSource:'Synthetic'}],processes:[{id:'p',name:'Synthetic labour',parentId:'',sequence:1,basePrice:4,difficulty:1,usage:2,standardSeconds:null,notApplicable:false,notes:'',priceSource:'Synthetic'}],outsourcing:[{id:'plate',category:'plating',name:'Synthetic finish',part:'Synthetic hinge',unitPrice:2,usage:2,notApplicable:false,notes:'',priceSource:'Synthetic'},{id:'out',category:'general',name:'Synthetic process',part:'Synthetic temple',unitPrice:1,usage:3,notApplicable:false,notes:'',priceSource:'Synthetic'}]}],attachmentRefs:[]};
 const template={bytes:prepared.bytes,expectedSha256:prepared.inspection.sha256,sheetBindings:[{sheetName:'STYLE1',lineId:'line'}]};
 const set=(quote,target,value,reason='Synthetic manual reason')=>{const cell=calculateIeQuote(quote).adjustmentCells.find(c=>c.target===target);assert(cell);quote.manualAdjustments=quote.manualAdjustments.filter(a=>a.target!==target);quote.manualAdjustments.push({target,value,reason,sourceSignature:cell.sourceSignature});};
 assert.equal(calculateIeQuote(q).lines[0].productionCost,35.3);
 for(const [target,value]of [[t.material('line','m'),12],[t.process('line','p'),3],[t.outsourcing('line','plate'),5],[t.line('line','material'),15],[t.line('line','materialWithLoss'),20],[t.line('line','indirectLabor'),7],[t.line('line','indirect'),20],[t.line('line','laborTotal'),30],[t.line('line','outsourcingTotal'),10],[t.line('line','productionCost'),62],[t.line('line','productionCostUsd'),9],[t.line('line','factoryPriceCny'),90],[t.line('line','factoryPriceUsd'),12],[t.tooling,80]])set(q,target,value);
 const parse=bytes=>{
  const entries=unzipSync(bytes),workbook=strFromU8(entries['xl/workbook.xml']),rels=strFromU8(entries['xl/_rels/workbook.xml.rels']);
  const map=new Map([...rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)].map(v=>[v[1],v[2].startsWith('/')?v[2].slice(1):'xl/'+v[2]]));
  const sheets=new Map([...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)].map(v=>[v[1],strFromU8(entries[map.get(v[2])])]));
  const decode=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const cell=(sheet,address)=>{const raw=sheets.get(sheet)?.match(new RegExp('<c\\b[^>]*r="'+address+'"[^>]*?(?:/>|>[\\s\\S]*?</c>)'))?.[0]||'';const v=raw.match(/<v>([^<]*)<\/v>/)?.[1];return {raw,formula:decode(raw.match(/<f>([\s\S]*?)<\/f>/)?.[1]||''),value:v===undefined||v===''?null:Number(v),text:decode(raw.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]||'')};};
  return {entries,sheets,cell,decode};
 };
 const expected=calculateIeQuote(q),draft=await m.exportIeQuoteDraftWorkbook(q,{issues:[],template}),official=await m.exportIeQuoteInternalWorkbook(q,{issues:[],template});
 for(const output of [draft,official]){
  const {sheets,cell,entries}=parse(output.bytes);assert.equal(output.formulaVersion,'ie-cost-v4-manual');
  for(const name of ['STYLE1','材料填报','电镀填报','外发填报','工序填报','间接费用','人工调整','单列费用'])assert(sheets.has(name),name);
  for(const [address,key]of [['H37','material'],['H38','materialLoss'],['H39','materialWithLoss'],['H50','outsourcingTotal'],['H53','process'],['H54','indirectLabor'],['H61','laborTotal'],['H62','productionCost'],['H63','productionCostUsd'],['I66','factoryPriceCny'],['I67','factoryPriceUsd']]){assert.equal(cell('STYLE1',address).value,expected.lines[0][key],address);assert(cell('STYLE1',address).formula,address+' remains a formula');}
  assert.equal(cell('材料填报','J2').value,12);assert.equal(cell('材料填报','K2').value,1.2);assert.equal(cell('电镀填报','G2').value,5);assert.equal(cell('电镀填报','J2').text,'Synthetic hinge');assert.equal(cell('电镀填报','K2').value,2);assert.equal(cell('外发填报','G2').value,3);assert.equal(cell('工序填报','H2').value,3);assert.equal(cell('工序填报','M2').value,2);
  assert(!sheets.get('电镀填报').includes('Synthetic process'));assert(!sheets.get('外发填报').includes('Synthetic finish'));
  for(const c of expected.adjustmentCells.filter(c=>c.applied)){
   const match=[...sheets.get('人工调整').matchAll(/<row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].find(v=>v[0].includes('>'+c.target+'</t>'));assert(match,c.target);const row=Number(match[1]);assert.equal(cell('人工调整',`C${row}`).value,c.automaticValue);assert.equal(cell('人工调整',`D${row}`).value,c.effectiveValue);assert.equal(cell('人工调整',`E${row}`).text,c.adjustment.reason);assert.equal(cell('人工调整',`F${row}`).value,c.effectiveValue);assert.equal(cell('人工调整',`H${row}`).text,c.sourceSignature);assert(cell('人工调整',`F${row}`).formula.includes(`LEN(TRIM(E${row}))>0`));
  }
  assert.equal(cell('单列费用','F3').value,80);assert.deepEqual(entries['xl/media/image1.png'],unzipSync(prepared.bytes)['xl/media/image1.png']);
  assert.equal((await m.inspectIeQuoteTemplate(output.bytes)).sheets.find(s=>s.name==='STYLE1').layoutSha256,prepared.inspection.sheets[0].layoutSha256);
 }
 assert(parse(official.bytes).sheets.get('STYLE1').includes('已复核'));assert(parse(draft.bytes).sheets.get('STYLE1').includes('未审填报草稿'));
 const withEvidence=await m.exportIeQuoteInternalWorkbook({...q,tooling:q.tooling.map(t=>({...t,evidence:'Synthetic later resolved evidence'}))},{issues:[],template});assert.equal(parse(withEvidence.bytes).cell('单列费用','F3').value,80);assert(parse(withEvidence.bytes).sheets.get('单列费用').includes('Synthetic later resolved evidence'));
 await fs.writeFile('test-output/ie-manual-workbook-synthetic.xlsx',official.bytes);
 await fs.writeFile('test-output/ie-manual-workbook-engine.xlsx',(await m.exportIeQuoteDraftWorkbook(q,{issues:[]})).bytes);
 const stale=structuredClone(q);stale.lines[0].materials[0].basePrice=3;const staleCost=calculateIeQuote(stale),staleOutput=parse((await m.exportIeQuoteDraftWorkbook(stale,{issues:['Synthetic stale override'],template})).bytes);assert.equal(staleOutput.cell('材料填报','J2').value,staleCost.adjustmentCells.find(c=>c.target===t.material('line','m')).effectiveValue);assert(staleOutput.sheets.get('人工调整').includes('来源已变更，人工值未采用'));await assert.rejects(()=>m.exportIeQuoteInternalWorkbook(stale,{issues:[],template}),/核对所有明细和人工调整/);
 const zero=structuredClone(q);zero.manualAdjustments=[];set(zero,t.process('line','p'),0);set(zero,t.line('line','factoryPriceCny'),0);const zeroOutput=parse((await m.exportIeQuoteInternalWorkbook(zero,{issues:[],template})).bytes);assert.equal(zeroOutput.cell('STYLE1','H53').value,0);assert.equal(zeroOutput.cell('STYLE1','I66').value,0);assert.equal(zeroOutput.cell('STYLE1','I67').value,0);
 const manualMissing=structuredClone(zero);manualMissing.manualAdjustments=[];manualMissing.lines[0].materials[0].basePrice=null;set(manualMissing,t.material('line','m'),8);const manualOutput=parse((await m.exportIeQuoteInternalWorkbook(manualMissing,{issues:[],template})).bytes);assert.equal(manualOutput.cell('材料填报','F2').value,null);assert.equal(manualOutput.cell('STYLE1','H7').value,8);assert.equal(manualOutput.cell('STYLE1','H62').value,calculateIeQuote(manualMissing).lines[0].productionCost);
 pass('IE Excel 人工价格与子表：电镀部位/次数、外发工序、直接人工、间接费用分别明细汇总；v4全部金额与服务端一致，自动/人工/原因/签名留存，0与缺基础价人工金额正确，失效调整不采用且正式导出阻断，原STYLE版式图片保全');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await testIeManualWorkbook();

