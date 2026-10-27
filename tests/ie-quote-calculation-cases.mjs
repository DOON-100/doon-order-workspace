import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
export async function testIeQuoteExcelCalculation({pass}){
 await fs.mkdir('test-output',{recursive:true});await build({entryPoints:['lib/ie-quote-calculation.ts'],outfile:'test-output/ie-quote-calculation-test.mjs',bundle:true,platform:'node',format:'esm'});
 const {calculateIeQuote,ieCostMultiply}=await import('../test-output/ie-quote-calculation-test.mjs');
 const material=(price,rate=.1)=>({basePrice:price,usage:1,coefficient:1,lossRate:rate,notApplicable:false});
 const fields={exchangeRateCnyPerUsd:7,lines:[{id:'line',materials:[material(1.005),material(2.004)],processes:[{basePrice:.123456,difficulty:1.5,notApplicable:false}],outsourcing:[{category:'plating',unitPrice:.5,notApplicable:false},{category:'general',unitPrice:0,notApplicable:false}]}],tooling:[]};
 const result=calculateIeQuote(fields),line=result.lines[0];
 assert.equal(result.formulaVersion,'ie-cost-v3-excel');assert.equal(line.material,3.01);assert.equal(line.materialLoss,.3);assert.equal(line.process,.185184);assert.equal(line.productionCost,17.695184);assert.equal(line.factoryPriceCny,23.003739);assert.equal(line.factoryPriceUsd,3.286248);
 assert.equal(ieCostMultiply([1.005,1,1],2),1.01,'Excel positive .5 cent boundary');
 const extra=structuredClone(fields);extra.lines[0].materials[0].lossRate=.25;assert.equal(calculateIeQuote(extra).lines[0].materialLoss,.45);assert.equal(extra.lines[0].materials[1].lossRate,.1);
 const aggregate=structuredClone(fields);aggregate.lines[0].materials=[material(.05),material(.05),material(.05)];assert.equal(calculateIeQuote(aggregate).lines[0].materialLoss,.02,'Round total loss once, not each row');
 const saved={...structuredClone(fields),costs:{formulaVersion:'ie-cost-v2-line-loss'}};
 const legacy=calculateIeQuote(saved);assert.equal(legacy.formulaVersion,'ie-cost-v2-line-loss');assert.equal(legacy.lines[0].material,3.009);assert.equal(legacy.lines[0].materialLoss,.3009);assert.equal(legacy.lines[0].productionCost,17.695084);assert.equal(legacy.lines[0].factoryPriceCny,23.003609);
 const old=JSON.stringify(saved);calculateIeQuote(saved);assert.equal(JSON.stringify(saved),old,'Historical input never mutated');
 const missing=structuredClone(fields);missing.lines[0].materials[0].basePrice=null;assert.equal(calculateIeQuote(missing).lines[0].factoryPriceCny,null);
 missing.lines[0].materials[0].basePrice=0;assert.equal(calculateIeQuote(missing).lines[0].material,2);missing.exchangeRateCnyPerUsd=null;assert.notEqual(calculateIeQuote(missing).lines[0].factoryPriceCny,null);assert.equal(calculateIeQuote(missing).lines[0].factoryPriceUsd,null);
 const standaloneFees=structuredClone(fields);standaloneFees.tooling=[{chargeMode:'charge',amount:5000},{chargeMode:'already_charged',amount:999}];const fees=calculateIeQuote(standaloneFees);assert.equal(fees.toolingChargeCny,5000);assert.deepEqual(fees.lines,result.lines);
 pass('IE Excel公式：材料逐行分位、损耗加权汇总后分位、单项额外损耗、未填与零价、统一汇率、模具单列正确；历史v2保持原六位金额');
}
