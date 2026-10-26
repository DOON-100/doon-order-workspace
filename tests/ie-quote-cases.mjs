import assert from 'node:assert/strict';

// All identities, customers, references and prices below are synthetic.
export async function testIeQuotes({ok,call,pass,rawRecords,rawInsert}){
 const at='2026-10-01T00:00:00.000Z';
 const actor=(name,role='production',displayName=name)=>{const key='ie_test_'+name;const m={id:key,kind:'member',userId:key,email:key+'@test.invalid',name:displayName,role,customers:[],active:true,createdAt:at};rawInsert(m);return {m,user:{userId:m.userId,email:m.email,displayName:m.name,fullName:m.name}};};
 const engineer=actor('synthetic-engineer'),reviewer=actor('synthetic-reviewer'),manager=actor('synthetic-manager'),intruder=actor('synthetic-other'),sameName=actor('synthetic-same-name','production','synthetic-engineer');
 const a={id:'ie_test_account',kind:'customer_account',customer:'IE 合成客户',customerCode:'IE-TEST',salesName:'',serviceName:'',pmcName:'',quoteMemberIds:[],active:true,notes:'',version:1,createdAt:at,updatedAt:at,updatedBy:'synthetic'};rawInsert(a);
 const accountB={...a,id:'ie_test_account_b',customer:'IE 合成客户乙',customerCode:'IE-TEST-B'};rawInsert(accountB);
 assert.equal((await call('ie-quotes',undefined,engineer.user)).status,403);
 let p=(await ok('ie-quotes')).policy;assert.equal(p.configured,false);assert(p.members.every(m=>!('email'in m)&&!('userId'in m)));
 const binding={version:p.version,engineerMemberId:engineer.m.id,reviewerMemberId:reviewer.m.id,finalApproverMemberId:manager.m.id};
 assert.equal((await call('ie-quote-policy',binding,intruder.user)).status,403);
 assert.equal((await call('ie-quote-policy',{...binding,reviewerMemberId:engineer.m.id})).status,400);
 p=(await ok('ie-quote-policy',binding)).policy;
 assert.equal((await call('ie-quotes',undefined,sameName.user)).status,403);
 const list=await ok('ie-quotes',undefined,engineer.user);assert.equal(list.capabilities.canCreate,true);assert.deepEqual(list.policy.members,[]);
 assert.equal((await ok('ie-quotes')).capabilities.canCreate,false);
 pass('IE 角色由管理员绑定不同稳定成员 ID；缺省、其他生产角色与同名成员均不扩权，候选列表不含凭据');

 const draft={customerAccountId:a.id,quoteNo:'IE-SYNTHETIC-01',quoteDate:'2026-10-01',validUntil:'2026-11-01',batchId:'IE-BATCH-A',exchangeRateCnyPerUsd:7,exchangeRateDate:'2026-10-01',exchangeRateSource:'合成汇率依据',notes:'合成测试',
  lines:[{id:'style-a',model:'TEST-A',customerModel:'CUSTOMER-A',color:'C1',drawingNo:'TEST-DRAWING',drawingRevision:'R1',quantityMin:100,quantityMax:500,structureNotes:'合成结构分析',scopeNotes:'每副成品，含包装',materials:[{id:'m1',name:'合成材料',specification:'合成规格',unit:'件',basePrice:2.5,usage:2,coefficient:1.2,lossRate:0.1,lossAdjustmentReason:'',notApplicable:false,notes:'',priceSource:'合成供应商未税基价'}],processes:[{id:'p1',name:'合成加工',parentId:'',sequence:1,standardSeconds:60,basePrice:3,difficulty:1.5,notApplicable:false,notes:'',priceSource:'合成工序基价'}],outsourcing:[{id:'o1',category:'plating',name:'合成电镀',unitPrice:1.5,notApplicable:false,notes:'',priceSource:'合成电镀依据'},{id:'o2',category:'general',name:'无一般外发',unitPrice:null,notApplicable:true,notes:'本款无一般外发',priceSource:''}]}],
  tooling:[{id:'t-na',toolingId:'',name:'无一次性费用',lineIds:['style-a'],amount:null,chargeMode:'not_applicable',evidence:'',notes:'复用既有生产条件，无新模具'}]};
 const fields=q=>Object.fromEntries([...Object.keys(draft),'id','version'].map(k=>[k,structuredClone(q[k])]));
 const snapshotCount=()=>rawRecords().filter(r=>r.kind==='ie_quote_revision').length;
 assert.equal((await call('ie-quote-save',draft)).status,403);
 assert.equal((await call('ie-quote-save',{...draft,costs:{productionCost:0}},engineer.user)).status,400);
 let q=(await ok('ie-quote-save',draft,engineer.user)).quote;
 assert.equal(q.costs.lines[0].material,6);assert.equal(q.costs.lines[0].materialLoss,0.6);assert.equal(q.costs.lines[0].process,4.5);assert.equal(q.costs.lines[0].productionCost,26.3);assert.equal(q.costs.lines[0].factoryPriceCny,34.19);assert.equal(q.costs.lines[0].factoryPriceUsd,4.884286);assert.equal(q.costs.toolingChargeCny,0);assert.deepEqual(q.issues,[]);
 const changed=fields(q);changed.lines[0].materials[0].lossRate=0.25;
 q=(await ok('ie-quote-save',changed,engineer.user)).quote;assert.equal(q.costs.lines[0].materialLoss,1.5);assert.equal(q.costs.lines[0].productionCost,27.2);assert(q.issues.some(v=>v.includes('损耗须说明')));
 assert.equal((await call('ie-quote-submit',{id:q.id,version:q.version},engineer.user)).status,400);
 const corrected=fields(q);corrected.lines[0].materials[0].lossAdjustmentReason='结构导致额外损耗 15 个百分点';corrected.lines[0].processes[0].standardSeconds=999;
 q=(await ok('ie-quote-save',corrected,engineer.user)).quote;assert.equal(q.costs.lines[0].process,4.5);assert.equal(q.costs.lines[0].productionCost,27.2);
 assert.equal((await call('ie-quote-save',{...fields(q),version:q.version-1},engineer.user)).status,409);
 assert.equal((await call('ie-quote-save',{...fields(q),customerAccountId:accountB.id},engineer.user)).status,400);
 assert.equal((await call('ie-quote?id='+q.id,undefined,intruder.user)).status,403);
 pass('IE 成本由服务端精确计算；逐项 10%+15 个百分点=25%，调整原因必填，秒工时不计价，篡改成本和过期写入被拒绝');

 const missing=fields(q);missing.lines[0].materials[0].basePrice=null;
 let blank=(await ok('ie-quote-save',{...missing,id:undefined,version:undefined,quoteNo:'IE-NULL',batchId:'NULL'},engineer.user)).quote;
 assert.equal(blank.costs.lines[0].material,null);assert.equal(blank.costs.lines[0].factoryPriceCny,null);assert.equal((await call('ie-quote-submit',{id:blank.id,version:blank.version},engineer.user)).status,400);
 const fixed=fields(blank);fixed.lines[0].materials[0].basePrice=0;blank=(await ok('ie-quote-save',fixed,engineer.user)).quote;assert.equal(blank.costs.lines[0].material,0);assert(!blank.issues.some(i=>i.includes('基价 / 用量')));
 const emptyArrays=structuredClone(draft);emptyArrays.quoteNo='IE-EMPTY';emptyArrays.lines[0].materials=[];emptyArrays.lines[0].processes=[];emptyArrays.lines[0].outsourcing=[];
 const empty=(await ok('ie-quote-save',emptyArrays,engineer.user)).quote;assert.equal(empty.costs.lines[0].productionCost,null);assert.equal(empty.costs.lines[0].factoryPriceCny,null);
 const overPrecision=structuredClone(draft);overPrecision.lines[0].materials[0].basePrice=0.1234567;assert.equal((await call('ie-quote-save',overPrecision,engineer.user)).status,400);
 const perMaterial=structuredClone(draft);perMaterial.quoteNo='IE-LOSS-PER-MATERIAL';perMaterial.lines[0].materials[0].lossRate=0.25;perMaterial.lines[0].materials[0].lossAdjustmentReason='仅此材料追加 15 个百分点';perMaterial.lines[0].materials.push({...draft.lines[0].materials[0],id:'m2',name:'保持正常损耗的材料',basePrice:10,usage:1,coefficient:1});
 const separate=(await ok('ie-quote-save',perMaterial,engineer.user)).quote;assert.equal(separate.lines[0].materials[0].lossRate,0.25);assert.equal(separate.lines[0].materials[1].lossRate,0.1);assert.equal(separate.costs.lines[0].material,16);assert.equal(separate.costs.lines[0].materialLoss,2.5);assert.equal(separate.costs.lines[0].productionCost,38.2);
 const belowBase=structuredClone(draft);belowBase.lines[0].materials[0].lossRate=0.05;belowBase.lines[0].materials[0].lossAdjustmentReason='不允许降低正常损耗';assert.equal((await call('ie-quote-save',belowBase,engineer.user)).status,400);
 for(const rate of [null,0]){const d={...draft,quoteNo:'IE-FX-'+rate,exchangeRateCnyPerUsd:rate};const fx=(await ok('ie-quote-save',d,engineer.user)).quote;assert(fx.issues.some(i=>i.includes('汇率')));assert.equal((await call('ie-quote-submit',{id:fx.id,version:fx.version},engineer.user)).status,400);}
 pass('材料空价保留未知并禁止发布，显式零价可核对；汇率空白和零值均不能提交');

 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer.user)).quote;assert.equal(q.requiredReviewMemberId,reviewer.m.id);assert.equal(q.status,'submitted');
 const submittedVersion=q.version,submittedSnapshot=JSON.stringify(rawRecords().find(r=>r.kind==='ie_quote_revision'&&r.quoteId===q.id&&r.version===submittedVersion));
 assert.equal((await call('ie-quote-save',fields(q),engineer.user)).status,409);
 assert.equal((await call('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:''},engineer.user)).status,403);
 assert.equal((await call('ie-quote-policy',{...binding,version:p.version})).status,409);
 assert.equal((await call('ie-quote-review',{id:q.id,version:q.version,decision:'return',reason:''},reviewer.user)).status,400);
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'return',reason:'请核对结构说明'},reviewer.user)).quote;assert.equal(q.status,'returned');
 q=(await ok('ie-quote-save',{...fields(q),notes:'根据退回补充'},engineer.user)).quote;
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer.user)).quote;
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'已核对'},reviewer.user)).quote;
 assert.equal(q.status,'released');const releasedVersion=q.version,releasedProduction=q.costs.lines[0].productionCost;
 assert.equal(JSON.stringify(rawRecords().find(r=>r.kind==='ie_quote_revision'&&r.quoteId===q.id&&r.version===submittedVersion)),submittedSnapshot);
 q=(await ok('ie-quote-revise',{id:q.id,version:q.version},reviewer.user)).quote;assert.equal(q.revision,2);assert.equal(q.status,'draft');
 const history=(await ok('ie-quote?id='+q.id+'&version='+releasedVersion,undefined,reviewer.user)).quote;assert.equal(history.status,'released');assert.equal(history.costs.lines[0].productionCost,releasedProduction);assert.equal(history.canEdit,false);
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},reviewer.user)).quote;assert.equal(q.requiredReviewMemberId,manager.m.id);
 assert.equal((await call('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:''},reviewer.user)).status,403);
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'替补填报转总经理审核'},manager.user)).quote;
 assert.equal(q.status,'released');assert.equal(q.reviewedById,manager.m.id);
 pass('提交、退回、重新提交、复核发布与修订形成不可变快照；生产副总代填由总经理复核，不能自审');

 const registration={customerAccountId:a.id,name:'合成共用模具',reference:'MOLD-TEST-001',chargeStatus:'uncollected',evidence:''};
 const t=(await ok('ie-quote-tooling-register',registration,engineer.user)).tooling;
 assert.equal((await call('ie-quote-tooling-register',registration,engineer.user)).status,409);
 assert.equal((await call('ie-quote-tooling-register',{...registration,id:t.id,version:t.version,chargeStatus:'collected',evidence:'尝试未经复核登记'},engineer.user)).status,403);
 const shared={...draft,quoteNo:'IE-TOOL-A',batchId:'TOOL-BATCH',lines:[draft.lines[0],{...draft.lines[0],id:'style-b',model:'TEST-B'}],tooling:[{id:'t-charge',toolingId:t.id,name:t.name,lineIds:['style-a','style-b'],amount:500,chargeMode:'charge',evidence:'合成模具报价依据',notes:''}]};
 let mold=(await ok('ie-quote-save',shared,engineer.user)).quote;assert.equal(mold.costs.toolingChargeCny,500);assert.equal(mold.costs.lines[0].productionCost,26.3);
 mold=(await ok('ie-quote-submit',{id:mold.id,version:mold.version},engineer.user)).quote;
 mold=(await ok('ie-quote-review',{id:mold.id,version:mold.version,decision:'approve',reason:''},reviewer.user)).quote;
 assert.equal((await ok('ie-quotes',undefined,engineer.user)).toolingRegistry.find(r=>r.id===t.id).chargeStatus,'uncollected');
 let duplicate=(await ok('ie-quote-save',{...shared,quoteNo:'IE-TOOL-B',batchId:'TOOL-OTHER-BATCH'},engineer.user)).quote;
 assert.equal((await call('ie-quote-submit',{id:duplicate.id,version:duplicate.version},engineer.user)).status,400);
 // A new draft does not erase the live released charging source.
 const moldDraft=(await ok('ie-quote-revise',{id:mold.id,version:mold.version},engineer.user)).quote;
 assert.equal((await call('ie-quote-submit',{id:duplicate.id,version:duplicate.version},engineer.user)).status,400);
 const reuse=fields(duplicate);reuse.tooling[0].chargeMode='included_in_batch';reuse.tooling[0].chargeQuoteId=mold.id;reuse.tooling[0].chargeVersion=mold.version;reuse.tooling[0].amount=null;
 duplicate=(await ok('ie-quote-save',reuse,engineer.user)).quote;assert.equal(duplicate.costs.toolingChargeCny,0);assert.deepEqual(duplicate.issues,[]);
 const falsePaid=fields(duplicate);falsePaid.tooling[0].chargeMode='already_charged';duplicate=(await ok('ie-quote-save',falsePaid,engineer.user)).quote;
 assert.equal((await call('ie-quote-submit',{id:duplicate.id,version:duplicate.version},engineer.user)).status,400);
 await ok('ie-quote-tooling-register',{...registration,id:t.id,version:t.version,chargeStatus:'collected',evidence:'合成收费凭证 RECEIPT-001'},reviewer.user);
 duplicate=(await ok('ie-quote-submit',{id:duplicate.id,version:duplicate.version},engineer.user)).quote;
 duplicate=(await ok('ie-quote-review',{id:duplicate.id,version:duplicate.version,decision:'approve',reason:''},reviewer.user)).quote;
 assert.equal((await call('ie-quote-submit',{id:moldDraft.id,version:moldDraft.version},engineer.user)).status,400);
 pass('模具使用稳定编号，多款共用单独只列一次；更换批次不能重复列费且可引用关联已发布来源，实际收费须凭证');

 const c=(await ok('ie-quote-catalog-save',{category:'material',name:'合成目录材料',specification:'TEST-SPEC',unit:'件',basePrice:3,standardSeconds:null,priceSource:'合成目录依据 V1',effectiveDate:'2026-10-01',active:true},engineer.user)).catalog;
 const cd=structuredClone(draft);cd.quoteNo='IE-CATALOG';Object.assign(cd.lines[0].materials[0],{catalogId:c.id,catalogVersion:c.version,name:c.name,specification:c.specification,unit:c.unit,basePrice:c.basePrice,priceSource:c.priceSource});
 let cq=(await ok('ie-quote-save',cd,engineer.user)).quote;
 await ok('ie-quote-catalog-save',{id:c.id,version:c.version,category:c.category,name:c.name,specification:c.specification,unit:c.unit,basePrice:9,standardSeconds:null,priceSource:'合成目录依据 V2',effectiveDate:'2026-10-02',active:true},reviewer.user);
 const badCatalog=fields(cq);badCatalog.lines[0].materials[0].basePrice=9;assert.equal((await call('ie-quote-save',badCatalog,engineer.user)).status,400);
 cq=(await ok('ie-quote-submit',{id:cq.id,version:cq.version},engineer.user)).quote;assert.equal(cq.lines[0].materials[0].basePrice,3);
 cq=(await ok('ie-quote-review',{id:cq.id,version:cq.version,decision:'approve',reason:''},reviewer.user)).quote;
 assert.equal(cq.lines[0].materials[0].catalogVersion,1);assert.equal(cq.costs.lines[0].material,7.2);
 pass('基价和标准工艺目录独立维护版本；报价冻结引用的旧基价依据，目录新版本不暗改旧报价');

 const processList=[...draft.lines[0].processes,{...draft.lines[0].processes[0],id:'p2',parentId:'p1',sequence:2,name:'合成子工序'}],presetInput={name:'合成整套流程',description:'用于复用主子工序',processes:processList,active:true};
 assert.equal((await call('ie-quote-process-preset-save',presetInput,manager.user)).status,403);
 let preset=(await ok('ie-quote-process-preset-save',presetInput,engineer.user)).preset;assert.equal(preset.version,1);
 const cycle={...presetInput,processes:[{...processList[0],parentId:'p2'},processList[1]]};assert.equal((await call('ie-quote-process-preset-save',cycle,engineer.user)).status,400);
 preset=(await ok('ie-quote-process-preset-save',{...presetInput,id:preset.id,version:preset.version,name:'合成整套流程修订'},reviewer.user)).preset;
 assert.equal(preset.version,2);assert.equal(rawRecords().filter(r=>r.kind==='ie_quote_process_preset_revision'&&r.presetId===preset.id).length,2);assert((await ok('ie-quotes',undefined,engineer.user)).processPresets.some(p=>p.id===preset.id));
 pass('可复用主子工序预设按稳定 ID 保留顺序与版本，循环父级和非工程成员维护被阻止');

 // Business readers use existing stable customer responsibility and its quote grant.
 const access=rawRecords().find(r=>r.kind==='customer_quote_access');
 if(access){const member=rawRecords().find(r=>r.kind==='member'&&r.active&&r.userId&&access.memberIds.includes(r.id)&&r.role!=='admin');if(member){
  const owned={...a,id:'ie_test_sales_customer',customer:'IE 业务范围合成客户',customerCode:'IE-SALES-TEST',quoteMemberIds:[member.id],salesMemberIds:[member.id],serviceMemberIds:[]};rawInsert(owned);
  const mine=(await ok('ie-quote-save',{...draft,customerAccountId:owned.id,quoteNo:'IE-SALES-READ'},engineer.user)).quote;
  const user={userId:member.userId,email:member.email,displayName:member.name,fullName:member.name},view=await ok('ie-quotes',undefined,user);
  assert(view.quotes.some(row=>row.id===mine.id&&row.lines[0].materials[0].basePrice===2.5));assert(!view.quotes.some(row=>row.id===q.id));assert.equal((await call('ie-quote?id='+q.id,undefined,user)).status,403);assert.equal((await call('ie-quote-save',draft,user)).status,403);
  pass('业务按稳定客户责任只读工程完整成本和明细，不能越权看其他客户或改工程核价');
 }}
 assert(snapshotCount()>15);return {engineer,reviewer,manager,account:a,releasedQuote:q};
}

export async function testIeToolingChargeSources({ok,rawRecords,pass}){
 const member=rawRecords().find(r=>r.id==='ie_test_synthetic-engineer'),user={userId:member.userId,email:member.email,displayName:member.name,fullName:member.name};
 const list=await ok('ie-quotes',undefined,user),draft=list.quotes.find(q=>q.quoteNo==='IE-TOOL-A'),source=list.toolingChargeSources.find(q=>q.id===draft.id);
 assert.equal(draft.status,'draft');assert.equal(source.status,'released');assert(source.version<draft.version);
 pass('关联收费来源独立保留最后已发布版本，来源新建草稿后仍可明确选择，不把草稿当作收费依据');
}

// Fast independent API run, using the same exported handlers and optimistic
// transaction contract. The main suite also exercises these cases with SQLite.
if(process.argv[1]&&new URL(import.meta.url).pathname.toLowerCase().endsWith(process.argv[1].replaceAll('\\','/').toLowerCase().replace(/^.*\/tests\//,'/tests/'))){
 const {build}=await import('esbuild');const {mkdir}=await import('node:fs/promises');await mkdir('test-output',{recursive:true});
 const store=`export class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}} export const bucket=()=>globalThis.__ieTestBucket;export const snapshot=async()=>structuredClone(globalThis.__ieTestState);export const json=(v,status=200)=>Response.json(v,{status});export const audit=(m,target,before,action,source,after)=>({id:'audit_'+crypto.randomUUID(),kind:'audit',actorId:m.id,targetId:target.id,before,after,action,source});export async function commit(revision,records){const s=globalThis.__ieTestState;if(s.revision!==revision)throw new AppError('revision conflict',409);const ids=new Set(records.map(r=>r.id));s.records=[...s.records.filter(r=>!ids.has(r.id)),...structuredClone(records)];s.revision++;}`;
 await build({entryPoints:['lib/ie-quote-api.ts'],outfile:'test-output/ie-quote-api-test.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated-ie-store',setup(b){b.onResolve({filter:/^\.\/store$/},()=>({path:'store',namespace:'ie-test'}));b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'ie-test'}));b.onLoad({filter:/.*/,namespace:'ie-test'},args=>({contents:args.path==='env'?'export const env={};':store}));}}]});
 const api=await import('../test-output/ie-quote-api-test.mjs?run='+Date.now()),admin={id:'ie_unit_admin',kind:'member',userId:'ie_unit_admin',name:'合成管理员',email:'admin@test.invalid',role:'admin',customers:[],active:true,createdAt:'2026-10-01'};
 globalThis.__ieTestState={revision:0,records:[admin]};const rawRecords=()=>structuredClone(globalThis.__ieTestState.records),rawInsert=record=>globalThis.__ieTestState.records.push(structuredClone(record));
 const call=async(action,body,user={userId:admin.userId})=>{const s=structuredClone(globalThis.__ieTestState),m=s.records.find(r=>r.kind==='member'&&r.userId===user.userId),url=new URL('https://test.invalid/api/workspace/'+action);try{return body===undefined?await api.ieQuoteGet(action.split('?')[0],url,s,m):await api.ieQuotePost(action,new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),s,m);}catch(e){return Response.json({error:e.message},{status:e.status||500});}};
 const ok=async(...args)=>{const r=await call(...args),b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};
 await testIeQuotes({ok,call,pass:console.log,rawRecords,rawInsert});console.log('IE synthetic API checks passed.');
}
