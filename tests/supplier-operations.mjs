import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';

await fs.mkdir('test-output',{recursive:true});
await build({entryPoints:['lib/supplier-operations.ts'],outfile:'test-output/supplier-operations.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const {pendingMaterials,pendingRisks,quantityByUnit,materialsForOrder,kitState,sampleEvidence}=await import('../test-output/supplier-operations.mjs');
const headers=['单据编号','供应商','商品编码','商品名称','单位','数量','预计交货日期','客户订单编号','商品行备注'];
const source={id:'test-only',headers,metadata:{},rows:[
 {sourceRow:4,values:['PO-TEST','测试甲','MAT-1','测试板料','千克',12.375,46310,'ORDER-TEST','新品样办'],displayValues:['PO-TEST','测试甲','MAT-1','测试板料','千克','12.38','26年10月15日','ORDER-TEST','新品样办'],rowType:'data'},
 {sourceRow:5,values:['PO-TEST','测试甲','MAT-2','测试镜片','片',20,'2026-10-14','ORDER-TEST',''],displayValues:[],rowType:'data'},
 {sourceRow:6,values:['PO-OTHER','测试乙','MAT-3','测试镜腿','支','','','',''],displayValues:[],rowType:'data'},
 {sourceRow:7,values:['','','','合计','',32.375,'','',''],displayValues:[],rowType:'summary'},
 {sourceRow:8,values:[],displayValues:[],rowType:'blank'},
]};
const before=JSON.stringify(source),rows=pendingMaterials(source);
assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.sourceRow),[4,5,6]);
assert.equal(rows[0].quantity,12.375,'calculations retain the exact raw quantity instead of rounded display text');
assert.equal(rows[0].raw['数量'],'12.38','source display text stays unchanged');
assert.equal(rows[0].dueDate,'2026-10-15','Excel numeric dates work even when display text is localized');
assert.deepEqual(rows.map(row=>row.category),['板料 / 胶料','镜片','镜腿 / 脾']);
const units=quantityByUnit(rows);assert.equal(units.length,3);assert.equal(units.find(unit=>unit.unit==='支').unknown,1);assert.equal(units.find(unit=>unit.unit==='千克').quantity,12.375);
assert.equal(rows[2].quantity,null,'missing receipt/source amounts are never converted to zero');
const risks=pendingRisks(rows,'2026-10-15');assert.equal(risks.find(row=>row.sourceRow===5).reasons[0],'原表交期已过');assert(!risks.some(row=>row.sourceRow===4));assert(risks.find(row=>row.sourceRow===6).reasons.includes('交期待核对'));
const order={orderNo:'ORDER-TEST',ledger:{columns:{AC:'',AD:'',AE:'',AF:''}}};
assert.equal(materialsForOrder(order,rows).length,2);assert.equal(materialsForOrder({...order,orderNo:'ORDER'},rows).length,0);assert.equal(materialsForOrder({...order,orderNo:''},rows).length,0);
assert.equal(kitState(order).status,'齐料日期待核对');assert.equal(kitState({...order,ledger:{columns:{AE:'-'}}}).status,'原表标记不适用');assert.equal(kitState({...order,ledger:{columns:{AE:'2026-10-10'}}}).status,'齐料日期已登记');
assert(sampleEvidence('测试新品板料'));assert.equal(sampleEvidence('常规大货板料'),'');
assert.equal(JSON.stringify(source),before,'analysis does not mutate snapshot records');
console.log('PASS supplier operations: source precision, row preservation, unit separation, missing values, date risks, exact order links and unchanged source data');
