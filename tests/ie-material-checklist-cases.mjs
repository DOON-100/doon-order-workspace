import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';

export async function testIeMaterialChecklist({ok,call,pass,rawRecords,rawInsert}){
 await fs.mkdir('test-output',{recursive:true});
 await build({entryPoints:['lib/ie-quote-calculation.ts'],outfile:'test-output/ie-material-checklist-calculation-test.mjs',bundle:true,platform:'node',format:'esm'});
 const {calculateIeQuote,ieAdjustmentTargets:T}=await import('../test-output/ie-material-checklist-calculation-test.mjs');
 const row=(id,price,extra={})=>({id,name:'合成材料 '+id,specification:'',unit:'',basePrice:price,usage:null,coefficient:null,lossRate:.1,lossAdjustmentReason:'',notApplicable:false,notes:'',priceSource:'',catalogId:'',catalogVersion:null,...extra});
 const plain={materialPricingMode:'checklist',exchangeRateCnyPerUsd:7,manualAdjustments:[],lines:[{id:'checklist-line',materials:[row('priced',10),row('blank',null,{name:'',usage:5,coefficient:2,lossRate:.25}),row('rounded',2.005,{usage:2,coefficient:1})],processes:[{id:'p',basePrice:3,difficulty:1,usage:1,notApplicable:false}],outsourcing:[{id:'plate',category:'plating',unitPrice:1,usage:1,notApplicable:false},{id:'general',category:'general',unitPrice:0,usage:1,notApplicable:false}]}],tooling:[]};
 const before=JSON.stringify(plain),calc=calculateIeQuote(plain);
 assert.equal(calc.formulaVersion,'ie-cost-v5-material-checklist');assert.equal(calc.lines[0].material,14.01);assert.equal(calc.lines[0].materialLoss,1.4);assert.equal(calc.lines[0].productionCost,33.11);assert.equal(JSON.stringify(plain),before);
 const zero=structuredClone(plain);zero.lines[0].materials=[row('zero-usage',9,{usage:0}),row('zero-coef',9,{coefficient:0}),row('explicit-zero',0),row('na',20,{notApplicable:true})];
 assert.equal(calculateIeQuote(zero).lines[0].material,0);
 const empty=structuredClone(plain);empty.lines[0].materials=[];assert.equal(calculateIeQuote(empty).lines[0].material,0);assert.equal(calculateIeQuote(empty).lines[0].materialLoss,0);assert.equal(calculateIeQuote(empty).lines[0].productionCost,17.7);
 for(const version of ['ie-cost-v2-line-loss','ie-cost-v3-excel','ie-cost-v4-manual']){const legacy={...structuredClone(plain),costs:{formulaVersion:version}};assert.equal(calculateIeQuote(legacy).formulaVersion,version);assert.equal(calculateIeQuote(legacy).lines[0].material,null,'saved '+version+' preserves blank-as-unknown');}
 const savedNew={...structuredClone(plain),materialPricingMode:undefined,costs:{formulaVersion:'ie-cost-v5-material-checklist'}};assert.equal(calculateIeQuote(savedNew).lines[0].material,14.01);
 const legacyBlank={...structuredClone(plain),materialPricingMode:undefined};assert.equal(calculateIeQuote(legacyBlank).lines[0].material,null);
 pass('材料清单v5：空价/空清单计0、空单耗系数默认1、明确0保持0、逐行分位及损耗汇总正确；历史v2/v3/v4不重算');

 const engineer=rawRecords().find(r=>r.id==='ie_test_synthetic-engineer'),reviewer=rawRecords().find(r=>r.id==='ie_test_synthetic-reviewer');
 const user=m=>({userId:m.userId,email:m.email,displayName:m.name,fullName:m.name}),e=user(engineer),r=user(reviewer);
 const source=rawRecords().find(q=>q.kind==='ie_quote'&&q.quoteNo==='IE-CATALOG');
 const keys=['materialPricingMode','customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling','manualAdjustments'];
 const fields=q=>Object.fromEntries([...keys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const fresh=name=>{const input=fields(source);delete input.id;delete input.version;input.quoteNo=name;input.materialPricingMode='checklist';input.manualAdjustments=[];input.lines[0].materials=[row('priced',10),row('unused',null,{name:'',lossRate:.25}),row('unused-na',null,{name:'',notApplicable:true})];return input;};
 const sourceSnapshot=JSON.stringify(rawRecords().filter(q=>q.id===source.id||q.kind==='ie_quote_revision'&&q.quoteId===source.id));
 let q=(await ok('ie-quote-save',fresh('IE-CHECKLIST-PRICE-ONLY'),e)).quote;
 assert.equal(q.materialPricingMode,'checklist');assert.equal(q.costs.formulaVersion,'ie-cost-v5-material-checklist');assert.equal(q.costs.lines[0].material,10);assert.equal(q.costs.lines[0].materialLoss,1);assert.deepEqual(q.issues,[]);
 assert.equal(q.lines[0].materials[0].usage,null);assert.equal(q.lines[0].materials[0].coefficient,null);assert.equal(q.lines[0].materials[1].basePrice,null,'stored blanks are not silently overwritten');
 const downgraded=fields(q);delete downgraded.materialPricingMode;assert.equal((await call('ie-quote-save',downgraded,e)).status,409);
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},e)).quote;
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'合成清单核价'},r)).quote;
 assert.equal(q.status,'released');assert(!('checklistIssues'in q));
 assert.equal(JSON.stringify(rawRecords().filter(q=>q.id===source.id||q.kind==='ie_quote_revision'&&q.quoteId===source.id)),sourceSnapshot);
 const none=fresh('IE-CHECKLIST-NO-MATERIALS');none.lines[0].materials=[];const noMaterials=(await ok('ie-quote-save',none,e)).quote;assert.equal(noMaterials.costs.lines[0].material,0);assert(!noMaterials.issues.some(v=>v.includes('列出材料')));
 const old=fresh('IE-CHECKLIST-LEGACY-PREVIEW');delete old.materialPricingMode;old.lines[0].materials=[row('blank',null)];const oldDraft=(await ok('ie-quote-save',old,e)).quote;
 assert.equal(oldDraft.costs.lines[0].material,null);assert(oldDraft.issues.some(v=>v.includes('基价')));assert(!oldDraft.checklistIssues.some(v=>v.includes('材料')));assert.equal(rawRecords().find(v=>v.id===oldDraft.id).materialPricingMode,undefined);
 const updated=(await ok('ie-quote-save',{...fields(oldDraft),materialPricingMode:'checklist'},e)).quote;assert.equal(updated.costs.lines[0].material,0);
 const history=(await ok('ie-quote?id='+oldDraft.id+'&version='+oldDraft.version,undefined,e)).quote;assert.equal(history.costs.lines[0].material,null);assert(!('checklistIssues'in history));
 pass('材料只填价格可保存并独立审核，来源可空、未用行无需说明；原记录/历史计算不变，升级预览不写入，旧客户端不得降级');

 const adjustment=fresh('IE-CHECKLIST-MANUAL');adjustment.lines[0].materials=[row('manual',null,{lossRate:.25})];
 const target=T.material(adjustment.lines[0].id,'manual'),manualCell=calculateIeQuote(adjustment).adjustmentCells.find(c=>c.target===target);
 adjustment.manualAdjustments=[{target,value:20,reason:'合成整件议价',sourceSignature:manualCell.sourceSignature}];
 const missingReason=structuredClone(adjustment);missingReason.manualAdjustments[0].reason='';assert.equal((await call('ie-quote-save',missingReason,e)).status,400);
 let manual=(await ok('ie-quote-save',adjustment,e)).quote;assert.equal(manual.costs.lines[0].material,20);assert.equal(manual.costs.lines[0].materialLoss,5);assert(manual.issues.some(v=>v.includes('损耗须说明')));
 const named=fields(manual);named.lines[0].materials[0].lossAdjustmentReason='额外损耗 15 个百分点';manual=(await ok('ie-quote-save',named,e)).quote;assert.deepEqual(manual.issues,[]);
 const stale=fields(manual);stale.lines[0].materials[0].usage=2;manual=(await ok('ie-quote-save',stale,e)).quote;assert.equal(manual.costs.lines[0].material,0);assert(manual.issues.some(v=>v.includes('重新确认人工调整')));assert.equal((await call('ie-quote-submit',{id:manual.id,version:manual.version},e)).status,400);
 const unnamed=fresh('IE-CHECKLIST-NAME-REQUIRED');unnamed.lines[0].materials=[row('unknown',3,{name:''})];const badName=(await ok('ie-quote-save',unnamed,e)).quote;assert(badName.issues.some(v=>v.includes('名称为空')));
 const manualUnnamed=structuredClone(adjustment);manualUnnamed.quoteNo='IE-CHECKLIST-MANUAL-NAME';manualUnnamed.lines[0].materials[0].name='';manualUnnamed.lines[0].materials[0].lossAdjustmentReason='合成额外损耗';manualUnnamed.manualAdjustments[0].sourceSignature=calculateIeQuote({...manualUnnamed,manualAdjustments:[]}).adjustmentCells.find(c=>c.target===target).sourceSignature;const badManualName=(await ok('ie-quote-save',manualUnnamed,e)).quote;assert(badManualName.issues.some(v=>v.includes('名称为空')));
 const unchanged=fresh('IE-CHECKLIST-OTHER-GUARDS');unchanged.exchangeRateCnyPerUsd=null;unchanged.lines[0].processes[0].basePrice=null;unchanged.lines[0].outsourcing[0].unitPrice=null;const guarded=(await ok('ie-quote-save',unchanged,e)).quote;assert.equal(guarded.costs.lines[0].productionCost,null);for(const text of ['汇率','工序','外发'])assert(guarded.issues.some(v=>v.includes(text)),text+' remains required');
 for(const value of [-1,.1234567]){const invalid=fresh('IE-CHECKLIST-INVALID');invalid.lines[0].materials[0].basePrice=value;assert.equal((await call('ie-quote-save',invalid,e)).status,400);}
 assert.equal((await call('ie-quote-save',{...fresh('IE-CHECKLIST-MODE'),materialPricingMode:'anything'},e)).status,400);
 pass('材料人工金额覆盖空价后参与损耗并须名称/原因；上游变化仍失效，工序/外发/汇率/金额精度校验不放宽');

 const names={id:'ie_checklist_reference_catalog',kind:'ie_material_name_catalog',version:1,previousId:'',createdAt:'2026-10-01',createdById:engineer.id,catalog:{sourceFilename:'synthetic-checklist-names.xlsx',sourceSha256:'b'.repeat(64),entries:[{id:'part',code:'T-PART',name:'合成前框颜色',nameEn:'Synthetic Front Color',sourceSheet:'Synthetic',sourceRow:2},{id:'same-name',code:'T-SAME',name:'合成螺丝',nameEn:'',sourceSheet:'Synthetic',sourceRow:3}]}};
 rawInsert(names);const namesBefore=JSON.stringify(rawRecords().find(v=>v.id===names.id));
 const ref={catalogId:names.id,catalogVersion:1,entryId:'part',nameUsage:'part-v1'},referenced=fresh('IE-CHECKLIST-PART-REFERENCE');referenced.lines[0].materials=[row('part-price',3,{name:'合成前框',nameReference:ref})];
 let part=(await ok('ie-quote-save',referenced,e)).quote;assert.equal(part.lines[0].materials[0].nameReference.nameUsage,'part-v1');assert.deepEqual(part.issues,[]);
 const forged=fields(part);forged.lines[0].materials[0].name='合成前框颜色';assert.equal((await call('ie-quote-save',forged,e)).status,400);
 const omitted=fields(part);delete omitted.lines[0].materials[0].nameReference.nameUsage;assert.equal((await call('ie-quote-save',omitted,e)).status,400);
 const invalid=fields(part);invalid.lines[0].materials[0].nameReference.nameUsage='part-v2';assert.equal((await call('ie-quote-save',invalid,e)).status,400);
 const original=fresh('IE-CHECKLIST-ORIGINAL-NAME');delete original.materialPricingMode;original.lines[0].materials=[row('original',null,{name:'合成前框颜色',nameReference:{catalogId:names.id,catalogVersion:1,entryId:'part'}})];
 const originalQuote=(await ok('ie-quote-save',original,e)).quote;assert(Array.isArray(originalQuote.checklistIssues));assert(!originalQuote.checklistIssues.some(v=>v.includes('名称与所选资料')));assert.equal(originalQuote.lines[0].materials[0].name,'合成前框颜色');assert.equal(originalQuote.lines[0].materials[0].nameReference.nameUsage,undefined);
 const same=fresh('IE-CHECKLIST-REFERENCE-DEPENDENCY');same.lines[0].materials=[row('same',3,{name:'合成螺丝',nameReference:{catalogId:names.id,catalogVersion:1,entryId:'same-name'}})];
 const sameTarget=T.material(same.lines[0].id,'same');same.manualAdjustments=[{target:sameTarget,value:4,reason:'合成单件定价',sourceSignature:calculateIeQuote(same).adjustmentCells.find(v=>v.target===sameTarget).sourceSignature}];
 let sameQuote=(await ok('ie-quote-save',same,e)).quote;assert.equal(sameQuote.costs.lines[0].material,4);
 const usageChanged=fields(sameQuote);usageChanged.lines[0].materials[0].nameReference.nameUsage='part-v1';sameQuote=(await ok('ie-quote-save',usageChanged,e)).quote;assert.equal(sameQuote.costs.lines[0].material,3);assert(sameQuote.issues.some(v=>v.includes('重新确认人工调整')));
 assert.equal(JSON.stringify(rawRecords().find(v=>v.id===names.id)),namesBefore);
 const policy=(await ok('ie-quotes',undefined,e)).policy;assert.equal(policy.constants.materialPricingMode,'checklist');assert.equal(policy.constants.formulaVersion,'ie-cost-v5-material-checklist');
 pass('材料引用part-v1通过真实保存校验，伪造/省略用途被拒；旧原名升级预览只读保留，名称用途变更使人工价重新确认');
}
