import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
export async function testIeQuoteChangeLog({pass}){
 await fs.mkdir('test-output',{recursive:true});await build({entryPoints:['lib/ie-quote-change-log.ts'],outfile:'test-output/ie-quote-change-log.mjs',bundle:true,platform:'node',format:'esm'});
 const {compareIeQuoteVersions}=await import('../test-output/ie-quote-change-log.mjs');
 const material=(id,name)=>({id,name,specification:'合成规格',unit:'副',basePrice:100,usage:1,coefficient:1,lossRate:.1,lossAdjustmentReason:'',notes:'',notApplicable:false,priceSource:'合成依据'});
 const before={quoteNo:'SYNTH-LOG',customerName:'合成日志客户',status:'draft',lines:[{id:'line',model:'TEST',materials:[material('m1','材料甲'),material('m2','材料乙')],processes:[],outsourcing:[]}],tooling:[],costs:{lines:[{lineId:'line',material:200,materialLoss:20,productionCost:233.7,factoryPriceCny:303.81}]}},after=structuredClone(before);
 after.lines[0].materials.reverse();assert.deepEqual(compareIeQuoteVersions(before,after),[],'稳定行ID应避免因数组换序错误匹配材料');
 const changed=after.lines[0].materials.find(m=>m.id==='m1');changed.lossRate=.25;changed.lossAdjustmentReason='合成额外15%';after.costs.lines[0].materialLoss=35;after.privateBucketKey='must-not-leak';
 const log=compareIeQuoteVersions(before,after);assert(log.some(v=>v.label.includes('材料甲')&&v.label.includes('总损耗率')&&v.before==='10%'&&v.after==='25%'));assert(log.some(v=>v.label.includes('额外损耗百分点')&&v.before==='0%'&&v.after==='15%'));assert(log.some(v=>v.label.includes('材料损耗额')&&v.before==='20'&&v.after==='35'));assert(!JSON.stringify(log).includes('must-not-leak'));
 after.lines[0].materials=after.lines[0].materials.filter(m=>m.id!=='m2');assert(compareIeQuoteVersions(before,after).some(v=>v.label.includes('材料乙')&&v.after==='已删除'));
 pass('IE版本日志按稳定行编号展示具体前后值、损耗百分点、删除项和计算结果，排除未知存储字段');
}
