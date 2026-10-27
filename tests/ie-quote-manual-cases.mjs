import assert from 'node:assert/strict';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import {syntheticIeTemplate} from './ie-quote-workbook-cases.mjs';

// Run after testIeQuotes. Identities, records and amounts are synthetic.
export async function testIeManualAdjustments({ok,call,rawRecords,rawInsert,pass}){
 const member=name=>{const m=rawRecords().find(r=>r.id==='ie_test_synthetic-'+name);assert(m);return {userId:m.userId,email:m.email,displayName:m.name,fullName:m.name};};
 const engineer=member('engineer'),reviewer=member('reviewer'),other=member('other');
 const source=rawRecords().find(r=>r.kind==='ie_quote'&&r.quoteNo==='IE-SYNTHETIC-01');assert(source);
 const keys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'];
 const fields=q=>Object.fromEntries([...keys,'id','version',...(q.manualAdjustments===undefined?[]:['manualAdjustments'])].map(k=>[k,structuredClone(q[k])]));
 const input=Object.fromEntries(keys.map(k=>[k,structuredClone(source[k])]));input.quoteNo='IE-SYNTH-MANUAL';input.manualAdjustments=[];
 let q=(await ok('ie-quote-save',input,engineer)).quote;
 const cell=target=>q.costs.adjustmentCells.find(c=>c.target===target),t='line:style-a:material:m1:amount',factory='line:style-a:factoryPriceCny';
 const adjustment=(target,value,reason='合成逐行人工核价')=>({target,value,reason,sourceSignature:cell(target).sourceSignature});
 assert.equal(q.costs.formulaVersion,'ie-cost-v4-manual');
 assert.equal((await call('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,8,'')]},engineer)).status,400);
 assert.equal((await call('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,-1)]},engineer)).status,400);
 assert.equal((await call('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,8),adjustment(t,9)]},engineer)).status,400);
 assert.equal((await call('ie-quote-save',{...fields(q),manualAdjustments:[{...adjustment(t,8),target:'line:missing:material:m1:amount'}]},engineer)).status,400);
 assert.equal((await call('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,8)]},other)).status,403);
 q=(await ok('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,8)]},engineer)).quote;
 assert.equal(cell(t).automaticValue,6);assert.equal(cell(t).effectiveValue,8);assert.equal(q.costs.lines[0].material,8);assert.equal(q.costs.lines[0].materialLoss,2);assert.equal(q.costs.lines[0].productionCost,29.7);assert.equal(q.costs.lines[0].factoryPriceCny,38.61);assert.deepEqual(q.issues,[]);
 const stored=rawRecords().find(r=>r.kind==='ie_quote'&&r.id===q.id);assert.equal(stored.costs.adjustmentCells.find(c=>c.target===t).adjustment.reason,'合成逐行人工核价');
 const oldVersion=q.version,oldSnapshot=JSON.stringify(rawRecords().find(r=>r.kind==='ie_quote_revision'&&r.quoteId===q.id&&r.version===oldVersion));
 const legacyClient=fields(q);delete legacyClient.manualAdjustments;assert.equal((await call('ie-quote-save',legacyClient,engineer)).status,409,'Old clients cannot silently discard manual pricing');
 const altered=fields(q);altered.lines[0].materials[0].basePrice=3;q=(await ok('ie-quote-save',altered,engineer)).quote;
 assert(cell(t).stale);assert.equal(cell(t).effectiveValue,7.2);assert(q.issues.some(i=>i.includes('重新确认人工调整')));assert.equal((await call('ie-quote-submit',{id:q.id,version:q.version},engineer)).status,400);
 q=(await ok('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,0,'合成免材料成本依据')]},engineer)).quote;assert.equal(q.costs.lines[0].material,0);assert(!cell(t).stale);assert.deepEqual(q.issues,[]);
 q=(await ok('ie-quote-save',{...fields(q),manualAdjustments:[]},engineer)).quote;assert.equal(q.costs.lines[0].material,7.2);
 assert.equal(JSON.stringify(rawRecords().find(r=>r.kind==='ie_quote_revision'&&r.quoteId===q.id&&r.version===oldVersion)),oldSnapshot);
 pass('IE人工格位服务端验证原因、数值、唯一目标、现有格位和编辑权限；上游变化阻断提交、显式零价与恢复自动、旧客户端及历史快照受到保护');

 const missing=fields(q);missing.lines[0].materials[0].basePrice=null;missing.lines[0].materials[0].priceSource='';q=(await ok('ie-quote-save',missing,engineer)).quote;
 q=(await ok('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(factory,50,'只调整最终价不能掩盖未知明细')]},engineer)).quote;assert.equal(q.costs.lines[0].factoryPriceCny,50);assert(q.issues.some(i=>i.includes('材料 1 未税基价')));assert.equal((await call('ie-quote-submit',{id:q.id,version:q.version},engineer)).status,400);
 q=(await ok('ie-quote-save',{...fields(q),manualAdjustments:[adjustment(t,8,'合成按样品逐行人工核定，未采用基价乘用量')]},engineer)).quote;
 assert.equal(q.lines[0].materials[0].basePrice,null);assert.deepEqual(q.issues,[],'A reasoned row amount can explicitly replace unknown factors without inventing them');assert.equal(q.costs.lines[0].material,8);
 const noCharge=fields(q);noCharge.manualAdjustments.push(adjustment('toolingChargeCny',100,'合成尝试重新收费'));let invalid=(await ok('ie-quote-save',noCharge,engineer)).quote;assert.equal(invalid.costs.toolingChargeCny,0);assert(invalid.issues.some(i=>i.includes('一次性费用合计')));assert.equal((await call('ie-quote-submit',{id:invalid.id,version:invalid.version},engineer)).status,400);
 q=(await ok('ie-quote-save',{...fields(invalid),manualAdjustments:invalid.manualAdjustments.filter(a=>a.target!=='toolingChargeCny')},engineer)).quote;
 const removed=fields(q);removed.lines[0].materials=[];assert.equal((await call('ie-quote-save',removed,engineer)).status,400,'Deleted rows cannot keep an unbound override');
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer)).quote;assert.equal((await call('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:''},engineer)).status,403);
 const view=(await ok('ie-quote?id='+q.id,undefined,reviewer)).quote;assert.equal(view.costs.adjustmentCells.find(c=>c.target===t).automaticValue,null);assert.equal(view.costs.adjustmentCells.find(c=>c.target===t).effectiveValue,8);assert(view.costs.adjustmentCells.find(c=>c.target===t).adjustment.reason.includes('逐行人工核定'));
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'合成审核人工核价依据'},reviewer)).quote;assert.equal(q.status,'released');assert.equal(q.costs.lines[0].material,8);
 const history=(await ok('ie-quote?id='+q.id+'&version='+oldVersion,undefined,reviewer)).quote;assert.equal(history.costs.lines[0].material,8);assert.equal(history.lines[0].materials[0].basePrice,2.5);
 pass('IE行金额可据理由人工核定并保留未知基价；仅改总价不能绕过明细，人工合计不能制造重复模具收费，复核人看到自动/人工金额及依据且禁止自审');

 const account={...rawRecords().find(r=>r.id===source.customerAccountId),id:'ie_manual_tooling_account',customer:'合成费用核价客户',customerCode:'SYNTH-MAN-FEE'};rawInsert(account);
 const register=(name,chargeStatus,evidence,user)=>ok('ie-quote-tooling-register',{customerAccountId:account.id,name,reference:name,chargeStatus,evidence},user);
 const newTool=(await register('SYNTH-MANUAL-NEW','uncollected','',engineer)).tooling,paidTool=(await register('SYNTH-MANUAL-PAID','collected','SYNTHETIC-PAID-RECEIPT',reviewer)).tooling;
 const fees=structuredClone(input);fees.customerAccountId=account.id;fees.quoteNo='IE-SYNTHETIC-MANUAL-FEES';fees.lines[0].model='SYNTHETIC-MODEL-1';fees.tooling=[{id:'new-fee',toolingId:newTool.id,name:newTool.name,lineIds:['style-a'],amount:100,chargeMode:'charge',chargeQuoteId:'',chargeVersion:null,evidence:'',notes:''},{id:'paid-fee',toolingId:paidTool.id,name:paidTool.name,lineIds:['style-a'],amount:null,chargeMode:'already_charged',chargeQuoteId:'',chargeVersion:null,evidence:'',notes:''}];
 q=(await ok('ie-quote-save',fees,engineer)).quote;q=(await ok('ie-quote-save',{...fields(q),manualAdjustments:[adjustment('toolingChargeCny',80,'合成当前收费总额核定')]},engineer)).quote;assert.deepEqual(q.issues,[]);
 const templateEntries=unzipSync(syntheticIeTemplate());for(const key of Object.keys(templateEntries))if(/^xl\/worksheets\/sheet\d+\.xml$/.test(key))templateEntries[key]=strToU8(strFromU8(templateEntries[key]).replaceAll('SYNTHETIC-CUSTOMER',account.customerCode));
 const form=new FormData();form.set('quoteId',q.id);form.set('version',String(q.version));form.set('sheetBindings',JSON.stringify([{sheetName:'STYLE1',lineId:'style-a'}]));form.set('acknowledgeRemoveUnmapped','true');form.set('file',new File([zipSync(templateEntries)],'synthetic-fees-template.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));await ok('ie-quote-template-register',form);
 const exportResponse=await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer);assert.equal(exportResponse.status,200,await exportResponse.clone().text());const exported=unzipSync(new Uint8Array(await exportResponse.arrayBuffer())),xml=Object.values(exported).map(v=>strFromU8(v)).join('\n');assert(xml.includes('SYNTHETIC-PAID-RECEIPT'));assert(xml.includes('合成当前收费总额核定'));
 const feeSheet=Object.values(exported).map(v=>strFromU8(v)).find(v=>v.includes('本次费用合计（不摊单价）'));assert(feeSheet.match(/<c r="F4"[^>]*><f>[^<]*<\/f><v>80<\/v>/),'Evidence decoration must not invalidate exported tooling price');
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer)).quote;assert.equal(q.tooling[1].evidence,'SYNTHETIC-PAID-RECEIPT');assert.equal(q.costs.toolingChargeCny,80);assert.deepEqual(q.issues,[]);assert(!cell('toolingChargeCny').stale);
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'合成费用总额复核'},reviewer)).quote;assert.equal(q.status,'released');assert.equal(q.costs.toolingChargeCny,80);
 pass('人工一次性费用合计仅绑定收费字段：提交补齐实际收据、正式导出显示凭证不会使已确认金额失效，原金额可复核发布');
}
