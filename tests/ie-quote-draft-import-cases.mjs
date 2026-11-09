import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function testIeQuoteDraftImport({pass}){
 const output=path.resolve('test-output','ie-quote-draft-import-'+process.pid);await fs.mkdir(output,{recursive:true});
 const outfile=path.join(output,'draft-import.mjs'),built=await build({entryPoints:['app/ie-quote-draft-import.ts'],outfile,bundle:true,platform:'browser',format:'esm',metafile:true});
 assert(!Object.keys(built.metafile.inputs).some(file=>/(?:chatgpt-auth|\/store\.ts|cloudflare)/.test(file)));
 const {parseIeQuoteDraftImport,IE_DRAFT_IMPORT_MAX_BYTES}=await import(pathToFileURL(outfile).href);
 const customers=[{id:'customer-synthetic',customer:'合成客户',customerCode:'TEST'}];
 const draft={customerAccountId:customers[0].id,materialPricingMode:'checklist',quoteNo:'IE-SYNTHETIC',quoteDate:'2026-11-09',validUntil:'',batchId:'SYNTHETIC',exchangeRateCnyPerUsd:null,exchangeRateDate:'',exchangeRateSource:'',notes:'待 IE 核对\n供应商原件保留',lines:[{id:'line-a',model:'TEST-A',customerModel:'',color:'',drawingNo:'TEST-DRAWING',drawingRevision:'',quantityMin:null,quantityMax:null,structureNotes:'结构待核对',scopeNotes:'',materials:[{id:'material-a',name:'合成材料',basePrice:null,usage:1,coefficient:0,lossRate:0.1,notApplicable:false,notes:'手写报价待核对'}],processes:[{id:'process-a',name:'合成工艺',sequence:1,standardSeconds:null,basePrice:0,difficulty:null,usage:1,notApplicable:false,notes:'难度由 IE 决定'}],outsourcing:[{id:'outside-a',category:'plating',name:'合成电镀',unitPrice:null,usage:1,notApplicable:false,notes:'供应商待核对'}]}],tooling:[]};
 const source=JSON.stringify(draft),result=parseIeQuoteDraftImport('\uFEFF'+source,customers);
 assert.equal(JSON.stringify(draft),source);assert.deepEqual(result.customer,customers[0]);assert.equal(result.fields.lines[0].materials[0].basePrice,null);assert.equal(result.fields.lines[0].materials[0].coefficient,0);assert.equal(result.fields.lines[0].processes[0].basePrice,0);assert.equal(result.fields.lines[0].processes[0].difficulty,null);assert.equal(result.fields.lines[0].outsourcing[0].unitPrice,null);assert.equal(result.fields.lines[0].processes[0].notes,'难度由 IE 决定');assert(!Object.hasOwn(result.fields,'status'));assert(!Object.hasOwn(result.fields,'canEdit'));
 pass('IE 草稿文件：浏览器复用严格字段校验，待核空值、明确零值和备注原样保留，不携带身份状态');
 for(const fields of [{id:'saved-quote',version:1},{version:1},{status:'released'},{canEdit:true},{preparedByIds:['fake-actor']},{unknown:'unsupported'}])assert.throws(()=>parseIeQuoteDraftImport(JSON.stringify({...draft,...fields}),customers));
 assert.throws(()=>parseIeQuoteDraftImport(source,[]),/客户/);assert.throws(()=>parseIeQuoteDraftImport(source,[{...customers[0],id:'other-customer'}]),/客户/);
 assert.throws(()=>parseIeQuoteDraftImport(JSON.stringify({...draft,materialPricingMode:undefined}),customers),/计价规则/);
 pass('IE 草稿文件：只接受新草稿，拒绝已有版本、权限与审核状态字段，客户撤权或停用后不能载入');
 for(const transform of [value=>value.lines[0].materials[0].basePrice='=1+1',value=>value.lines[0].materials[0].basePrice=-1,value=>value.lines[0].processes[0].difficulty=1.1234567,value=>value.lines[0].outsourcing[0].unknown='x',value=>value.lines[0].materials.push({...value.lines[0].materials[0]}),value=>value.quoteDate='2026-02-30']){const invalid=structuredClone(draft);transform(invalid);assert.throws(()=>parseIeQuoteDraftImport(JSON.stringify(invalid),customers));}
 assert.throws(()=>parseIeQuoteDraftImport('not a quotation',customers),/无法读取/);assert.throws(()=>parseIeQuoteDraftImport(' '.repeat(IE_DRAFT_IMPORT_MAX_BYTES+1),customers),/8 MB/);assert.equal(JSON.stringify(draft),source);
 pass('IE 草稿文件：嵌套未知字段、公式文本、负数、超精度、重复行和无效日期整份拒绝，不部分写入');
}
