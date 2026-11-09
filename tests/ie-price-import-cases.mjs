import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

// Synthetic supplier offers only; never import company source files in regression runs.
export async function testIePriceImports({ok,call,pass,rawRecords,rawInsert}){
 const at='2026-10-01T00:00:00.000Z',stranger={id:'price_import_stranger',kind:'member',userId:'price_import_stranger',email:'price_import_stranger@test.invalid',name:'合成无权限成员',role:'production',active:true,customers:[],createdAt:at};rawInsert(stranger);
 const strangerUser={userId:stranger.userId,email:stranger.email,displayName:stranger.name};
 const workbook=(rows,name='5、电镀基础报价表')=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),name);return XLSX.write(w,{type:'buffer',bookType:'xlsx'});};
 const headers=['供应商简称','架型','物品名称','单位','电镀类别','供应商颜色描述','单价\n（未税）','加收税点','备注'];
 const bytes=workbook([headers,['合成供应商甲','普通架','合成全架','副','单色','银色',4,'13%','合成来源'],['合成供应商乙','普通架','合成全架','副','单色','银色',5,0.13,'合成来源'],['合成供应商甲','普通架','合成全架','副','单色','银色',4,'13%','重复行'],['合成供应商甲','普通架','待补价格','副','单色','银色',null,null,'空价不是0'],['合成供应商甲','普通架','零价','副','单色','银色',0,null,'明确零价'],['合成供应商甲','普通架','下一批导入件','副','单色','银色',7,null,'允许部分导入后补齐']]);
 const form=(b=bytes,category='plating')=>{const f=new FormData();f.set('file',new File([b],'synthetic-supplier.xlsx'));f.set('category',category);f.set('supplier','');f.set('effectiveDate','2026-11-09');return f;};
 assert.equal((await call('ie-quote-catalog-import-preview',form(),strangerUser)).status,403);
 const before=rawRecords().filter(r=>r.kind==='ie_quote_catalog').length;
 const preview=await ok('ie-quote-catalog-import-preview',form());assert.equal(rawRecords().filter(r=>r.kind==='ie_quote_catalog').length,before);assert.equal(preview.rows.length,6);
 assert.deepEqual(preview.rows.map(r=>r.status),['new','new','duplicate','error','new','new']);assert.equal(preview.rows[0].entry.taxRate,0.13);assert.equal(preview.rows[4].entry.basePrice,0);
 const same=await ok('ie-quote-catalog-import-preview',form());assert.equal(same.id,preview.id);
 const original=await call('ie-quote-catalog-source?id='+preview.id);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),new Uint8Array(bytes));assert.equal((await call('ie-quote-catalog-source?id='+preview.id,undefined,strangerUser)).status,403);
 assert.equal((await call('ie-quote-catalog-import-commit',{id:preview.id,selected:[4]})).status,400);assert.equal(rawRecords().filter(r=>r.kind==='ie_quote_catalog').length,before);
 const committed=await ok('ie-quote-catalog-import-commit',{id:preview.id,selected:[1,2,5]});assert.equal(committed.inserted,3);
 const repeated=await ok('ie-quote-catalog-import-commit',{id:preview.id,selected:[5,2,1]});assert.deepEqual(repeated.ids,committed.ids);assert.equal((await call('ie-quote-catalog-import-commit',{id:preview.id,selected:[1]})).status,409);
 const entries=(await ok('ie-quotes')).catalog.filter(c=>committed.ids.includes(c.id));assert.equal(entries.length,3);assert(entries.every(e=>e.sourceImportId===preview.id&&e.sourceRow>1));
 assert.equal(entries.find(e=>e.basePrice===4).supplier,'合成供应商甲');assert.equal(entries.find(e=>e.basePrice===5).supplier,'合成供应商乙');
 pass('供应商价格上传只预览，原件完整保存且鉴权；空价与零区别，重复选行与重复确认不会重建报价');

 const concurrent=await ok('ie-quote-catalog-import-preview',form(bytes));assert.notEqual(concurrent.id,preview.id);assert.equal(concurrent.rows.filter(r=>r.status==='new').length,1);assert.equal(concurrent.rows.filter(r=>r.status==='duplicate').length,4);const remainder=await ok('ie-quote-catalog-import-commit',{id:concurrent.id,selected:[6]});assert.equal(remainder.inserted,1);
 const formulaBook=XLSX.utils.book_new(),formulaSheet=XLSX.utils.aoa_to_sheet([headers,['合成供应商','普通架','公式价','副','单色','金色',2,null,'缓存不能当核价']]);formulaSheet.G2={t:'n',f:'1+1',v:2};XLSX.utils.book_append_sheet(formulaBook,formulaSheet,'电镀');
 const formulas=await ok('ie-quote-catalog-import-preview',form(XLSX.write(formulaBook,{type:'buffer',bookType:'xlsx'})));assert.equal(formulas.rows[0].status,'error');assert(formulas.rows[0].issues.some(i=>i.includes('公式')));
 const inclusive=workbook([['物品名称','单位','电镀类别','单价','税价口径'],['合成含税件','副','单色',10,'含税'],['合成口径缺失','副','单色',10,'']],'电镀供应商');
 const inclusiveForm=form(inclusive);inclusiveForm.set('supplier','表单供应商');const taxPreview=await ok('ie-quote-catalog-import-preview',inclusiveForm);assert.equal(taxPreview.rows.length,2);assert.equal(taxPreview.rows[0].entry.supplier,'表单供应商');assert.equal(taxPreview.rows[0].entry.taxBasis,'inclusive');assert.equal(taxPreview.rows[0].status,'new');assert.equal(taxPreview.rows[1].status,'error');assert(taxPreview.rows[1].issues.some(v=>v.includes('税价口径')));await ok('ie-quote-catalog-import-commit',{id:taxPreview.id,selected:[1]});
 const explicitTax=workbook([['物品名称','单位','电镀类别','含税单价'],['合成含税件二','副','双色',12]],'电镀供应商');const explicitForm=form(explicitTax);explicitForm.set('supplier','表单供应商');const explicit=await ok('ie-quote-catalog-import-preview',explicitForm);assert.equal(explicit.rows[0].entry.taxBasis,'inclusive');assert.equal(explicit.rows[0].status,'new');
 const processBytes=workbook([['序号','工序/工艺路线列表','标准单位\n人工成本\n(参考绩效单位产值）','工艺描述'],[1,'合成CNC',3.5,'结构依图核对']],'4、标准单位 人工成本');
 const processes=await ok('ie-quote-catalog-import-preview',form(processBytes,'process'));assert.equal(processes.rows.length,1);assert.equal(processes.rows[0].entry.basePrice,3.5);assert.equal(processes.rows[0].entry.standardSeconds,null);assert.equal(processes.rows[0].status,'new');await ok('ie-quote-catalog-import-commit',{id:processes.id,selected:[1]});
 const matrix=workbook([['序号','工序名称','货物名称','描述','工序合并描述','计数单位','胶架',null,'不锈钢',null,'钛架',null],['','','','','','','最低价','最高价','最低价','最高价','最低价','最高价'],[1,'合成外发','成品','','合成外发','副',3,5,null,null,4,4]],'外发工序 一般报价统计');
 const outside=await ok('ie-quote-catalog-import-preview',form(matrix,'general'));assert.equal(outside.rows.length,3);assert.equal(outside.rows[0].entry.frameType,'胶架');assert.equal(outside.rows[0].entry.processType,'最低价');assert.equal(outside.rows[1].entry.processType,'最高价');assert.equal(outside.rows[2].entry.frameType,'钛架');
 pass('公式缓存价和含糊税价阻止导入，含税价明确保留口径，表单供应商可替代供应商列；标准人工工时选填，外发区间明确上下限');

 const manual={category:'process',name:'合成维护人工',specification:'合成规格',unit:'副',basePrice:3,standardSeconds:null,priceSource:'合成维护依据',effectiveDate:'2026-11-09',active:true,supplier:'合成供应商',currency:'CNY',taxBasis:'exclusive',taxRate:0,frameType:'AC',processType:'CNC',color:'',notes:'合成版本'};
 const saved=(await ok('ie-quote-catalog-save',manual)).catalog;const {id,version}=saved;
 const changed=(await ok('ie-quote-catalog-save',{...manual,id,version,basePrice:4})).catalog;assert.equal(changed.version,2);assert.equal((await call('ie-quote-catalog-save',{...manual,id,version,basePrice:5})).status,409);
 assert.equal(rawRecords().find(r=>r.kind==='ie_quote_catalog_revision'&&r.catalogId===id&&r.version===1).snapshot.basePrice,3);
 assert.equal((await call('ie-quote-catalog-save',{...manual,evidenceId:'missing-evidence'})).status,403);
 const oldClient={category:manual.category,name:manual.name,specification:manual.specification,unit:manual.unit,basePrice:changed.basePrice,standardSeconds:null,priceSource:manual.priceSource,effectiveDate:manual.effectiveDate,active:true};
 const retained=(await ok('ie-quote-catalog-save',{...oldClient,id,version:changed.version})).catalog;assert.equal(retained.supplier,manual.supplier);assert.equal(retained.frameType,manual.frameType);
 const off=(await ok('ie-quote-catalog-save',{...oldClient,id,version:retained.version,active:false})).catalog;assert.equal((await ok('ie-quotes')).catalog.some(c=>c.id===id),false);assert.equal((await ok('ie-quotes?includeInactive=1')).catalog.some(c=>c.id===off.id),true);assert.equal((await call('ie-quotes?includeInactive=1',undefined,strangerUser)).status,403);
 const preset=await ok('ie-quote-process-preset-save',{name:'合成秒工时选填预设',description:'标准秒用于分析不参与单价计算',active:true,processes:[{id:'synthetic-null-seconds',name:'合成工序',parentId:'',sequence:1,standardSeconds:null,basePrice:2,difficulty:1,usage:1,notApplicable:false,notes:'',catalogId:'',catalogVersion:null,priceSource:'合成基础价'}]});assert.equal(preset.preset.processes[0].standardSeconds,null);
 pass('价格维护版本冲突阻止覆盖，原版本冻结；旧客户端保存保留供应商信息，不允许关联不存在的原件');
}
