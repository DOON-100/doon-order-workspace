import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function testIeQuoteGrid({pass}){
 const output=path.resolve('test-output','ie-quote-grid-'+process.pid);await fs.mkdir(output,{recursive:true});
 const outfile=path.join(output,'grid.mjs');await build({stdin:{contents:"export * from './app/ie-quote-grid';export * from './app/ie-quote-defaults';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {parseIeGridClipboard,applyIeGridPaste,newIeMaterial,newIeLine,prepareIeQuoteDraft}=await import(pathToFileURL(outfile).href);
 const material=id=>({id,name:'合成材料',nameReference:{catalogId:'name-ref',catalogVersion:1,entryId:'name'},specification:'合成规格',unit:'件',basePrice:2,usage:1,coefficient:1,lossRate:0.1,lossAdjustmentReason:'',notApplicable:false,priceSource:'合成来源',notes:'保留备注',catalogId:'old-price',catalogVersion:3});
 const outsource=(id,category)=>({id,category,name:'合成外发',part:'合成部位',usage:1,unitPrice:2,notApplicable:false,priceSource:'合成来源',notes:''});
 const processRow=(id,sequence)=>({id,name:'合成工序',parentId:'',sequence,usage:1,standardSeconds:null,basePrice:2,difficulty:1,notApplicable:false,priceSource:'合成来源',notes:''});
 const line={id:'synthetic-line',model:'SYNTHETIC',customerModel:'',color:'',drawingNo:'',drawingRevision:'',quantityMin:1,quantityMax:1,structureNotes:'',scopeNotes:'',materials:[material('m1'),material('m2')],processes:[processRow('p1',1)],outsourcing:[outsource('o1','plating'),outsource('o2','general'),outsource('o3','plating')]};
 let generated=0;const run=(text,kind='material',column=1,rowId='m1',data=line)=>applyIeGridPaste({line:data,kind,rowId,column,text,idFactory:()=>`synthetic-new-${++generated}`});
 assert.deepEqual(parseIeGridClipboard('甲\t1\r\n乙\t2\r\n'),[['甲','1'],['乙','2']]);
 assert.deepEqual(parseIeGridClipboard('"含\t分隔符"\t"含""引号"\n"两\n行"\t'),[['含\t分隔符','含"引号'],['两\n行','']]);
 for(const text of ['一\t二\n三','"未闭合','"值"后缀'])assert.throws(()=>parseIeGridClipboard(text));
 pass('IE 表格粘贴：Excel 制表符、换行、引号与空格位解析，拒绝不完整矩形');
 const candidates=Array.from({length:61},(_,i)=>({catalogId:'synthetic-parts',version:2,id:'part-'+i,name:'合成部位'+i,sourceName:'合成部位'+i+'色',nameUsage:'part-v1',code:'P'+i,nameEn:'Synthetic part',sourceSheet:'Synthetic',sourceRow:i+2,basePrice:999,usage:9}));
 let nextId=0;const firstLine=newIeLine(candidates,()=>String(++nextId)),secondLine=newIeLine(candidates,()=>String(++nextId));
 assert.equal(firstLine.materials.length,61);assert.deepEqual(firstLine.materials.map(v=>v.name),candidates.map(v=>v.name));
 assert(firstLine.materials.every(v=>v.basePrice===null&&v.usage===1&&v.coefficient===1&&v.lossRate===.1&&v.priceSource===''&&v.nameReference.nameUsage==='part-v1'));
 assert.equal(new Set([...firstLine.materials,...secondLine.materials].map(v=>v.id)).size,122);firstLine.materials[0].basePrice=8;assert.equal(secondLine.materials[0].basePrice,null);assert.equal(candidates[0].basePrice,999);
 assert.equal(newIeMaterial(undefined,()=>String(++nextId)).usage,1);assert.equal(newIeLine().materials.length,0);assert.equal(newIeLine(Array.from({length:201},(_,i)=>({...candidates[0],id:'large-'+i})),()=>String(++nextId)).materials.length,200);
 const legacy={...line,status:'draft',canEdit:true,costs:{formulaVersion:'ie-cost-v4-manual'},lines:[line]},legacyBefore=JSON.stringify(legacy);
 assert.equal(prepareIeQuoteDraft(legacy).materialPricingMode,'checklist');assert.equal(JSON.stringify(legacy),legacyBefore);
 assert.equal(prepareIeQuoteDraft(legacy,true).materialPricingMode,undefined);assert.equal(prepareIeQuoteDraft({...legacy,status:'released'}).materialPricingMode,undefined);assert.equal(prepareIeQuoteDraft({...legacy,canEdit:false}).materialPricingMode,undefined);
 pass('新款标准清单：61个名称及来源自动带出，价格不复制，单耗系数默认1，每款行号独立；旧草稿仅本地升级预览，历史/只读不变');
 const before=JSON.stringify(line),result=run('合成甲\t2\t12.5\t1\t15\n合成乙\t0\t0\t2\t0\n合成丙\t3\t4\t1\t0');
 assert.equal(JSON.stringify(line),before);assert.equal(result.added,1);assert.equal(result.rowCount,3);assert.equal(result.columnCount,5);
 assert.equal(result.patch.materials.length,3);assert.deepEqual(result.patch.materials.map(row=>[row.name,row.usage,row.basePrice,row.coefficient,row.lossRate]),[['合成甲',2,12.5,1,0.25],['合成乙',0,0,2,0.1],['合成丙',3,4,1,0.1]]);
 assert.equal(result.patch.materials[0].catalogId,'');assert.equal(result.patch.materials[0].nameReference,null);assert.equal(result.patch.materials[0].notes,'保留备注');assert.equal(result.patch.materials[2].notApplicable,false);assert.equal(result.patch.materials[2].lossAdjustmentReason,'');
 const priceAppend=run('10\n20\n30','material',3);assert.equal(priceAppend.patch.materials[2].usage,1);assert.equal(priceAppend.patch.materials[2].coefficient,1);
 const usageOnly=run('4\n5','material',2);assert.equal(usageOnly.patch.materials[0].catalogId,'old-price');assert.deepEqual(usageOnly.patch.materials[0].nameReference,line.materials[0].nameReference);
 pass('IE 表格粘贴：单次不可变补丁、增行、明确零值、逐项损耗与目录引用正确保留或解除');
 for(const text of ['甲\t2\t3\t1\t0\t6','甲\t2\t3\t1\t0\n乙\t错误\t3\t1\t0','甲\t2\t=3+1','甲\t-1','甲\tInfinity','甲\t1.1234567','甲\t1\t2\t1\t991']){
  assert.throws(()=>run(text));assert.equal(JSON.stringify(line),before);
 }
 assert.throws(()=>run('1\t名称','material',0));assert.throws(()=>run('10\t20','material',7));assert.throws(()=>run('甲','material',1,'missing'));
 assert.equal(run('1,200.25','material',3).patch.materials[0].basePrice,1200.25);assert.throws(()=>run('1,2','material',3));
 assert.equal(run('','material',3).patch.materials[0].basePrice,null);assert.equal(run('','material',5).patch.materials[0].lossRate,0.1);
 const maxMaterials={...line,materials:Array.from({length:200},(_,i)=>material('max-'+i))};assert.throws(()=>run('甲\n乙','material',1,'max-199',maxMaterials),/最多 200/);
 pass('IE 表格粘贴：人工金额列整块拒绝、无部分修改，非数字、公式、精度、范围、行数均校验');
 const outside=run('电镀甲\t圈\t10\t2\n电镀乙\t腿\t8\t3\n电镀丙\t桥\t0\t1','plating',1,'o1');
 assert.equal(outside.patch.outsourcing.length,4);assert.deepEqual(outside.patch.outsourcing[1],line.outsourcing[1]);assert.equal(outside.patch.outsourcing[2].name,'电镀乙');assert.equal(outside.patch.outsourcing[3].category,'plating');assert.equal(outside.patch.outsourcing[3].unitPrice,0);
 const labor=run('磨边\t20\t5\t2\t3\n抛光\t\t7\t1\t2','process',1,'p1');
 assert.deepEqual(labor.patch.processes.map(row=>[row.sequence,row.name,row.standardSeconds,row.basePrice,row.difficulty,row.usage]),[[1,'磨边',20,5,2,3],[2,'抛光',null,7,1,2]]);
 const priceSource=run('合成供应商 A\n合成供应商 B','material',7);assert.equal(priceSource.patch.materials[1].priceSource,'合成供应商 B');assert.equal(priceSource.patch.materials[1].catalogId,'');
 const maxOutside={...line,outsourcing:Array.from({length:100},(_,i)=>outsource('out-'+i,i%2?'general':'plating'))};assert.throws(()=>run('甲\n乙','plating',1,'out-98',maxOutside),/最多 100/);
 pass('IE 表格粘贴：电镀只修改本子表、外发总行数限额、工序追加顺序、来源直接填写');
}
