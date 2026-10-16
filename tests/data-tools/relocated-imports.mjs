// Real relocated CLI entry points, synthetic inputs and isolated SQLite only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
await fs.mkdir(path.join(repo,'test-output'),{recursive:true});
const root=await fs.mkdtemp(path.join(repo,'test-output','data-tools-relocated-'));
const buildDir=path.join(root,'build');
await fs.mkdir(buildDir);
await fs.copyFile(path.join(repo,'standalone/runtime.mjs'),path.join(buildDir,'runtime.mjs'));
await build({entryPoints:[path.join(repo,'app/api/workspace/[action]/route.ts')],outfile:path.join(buildDir,'workspace-api.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':repo},plugins:[{name:'relocated-test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'./runtime.mjs',external:true}));}}]});

const at='2026-01-01T00:00:00.000Z';
const owner={id:'member_TEST_owner',kind:'member',name:'TEST Owner',email:'owner@test.invalid',userId:'local_TEST_owner',role:'admin',active:true,owner:true,customers:[],createdAt:at};
const sales={id:'member_TEST_sales',kind:'member',name:'TEST Sales',email:'sales@test.invalid',userId:'local_TEST_sales',role:'sales',active:true,owner:false,customers:[],createdAt:at};
const preserved={id:'TEST_existing_history',kind:'audit',actorId:owner.id,action:'TEST history',createdAt:at};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let passed=0;
const pass=message=>{passed++;console.log('PASS '+message);};

async function fixture(name,extra=[]){
 const cwd=path.join(root,name),data=path.join(cwd,'data');
 await fs.mkdir(path.join(cwd,'test-output'),{recursive:true});
 await fs.mkdir(path.join(data,'files'),{recursive:true});
 const dbPath=path.join(data,'workspace.sqlite'),db=new DatabaseSync(dbPath);
 db.exec("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO workspace_revision VALUES('main',1); CREATE TABLE local_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,member_id TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL,created_at TEXT NOT NULL)");
 for(const row of [owner,sales,preserved,...extra])db.prepare('INSERT INTO records VALUES(?,?,?)').run(row.id,row.kind,JSON.stringify(row));
 for(const member of [owner,sales])db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(member.userId,member.id,member.id,'TEST-unused-placeholder',0,at);
 db.close();
 await fs.writeFile(path.join(data,'files',sha('TEST_original_object')),'TEST original attachment bytes');
 return {cwd,data,dbPath};
}
function snapshot(f){
 const db=new DatabaseSync(f.dbPath,{readOnly:true});
 try{return {rows:db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),accounts:db.prepare('SELECT * FROM local_accounts ORDER BY id').all()};}finally{db.close();}
}
const entities=f=>snapshot(f).rows.map(row=>JSON.parse(row.data));
async function inventory(f){return Object.fromEntries(await Promise.all((await fs.readdir(path.join(f.data,'files'))).sort().map(async name=>[name,sha(await fs.readFile(path.join(f.data,'files',name)))])));}
async function protect(f){return {...snapshot(f),files:await inventory(f)};}
async function assertPreserved(f,before,{exact=false,changed=[]}={}){
 const after=snapshot(f),map=new Map(after.rows.map(row=>[row.id,row]));
 for(const row of before.rows)if(!changed.includes(row.id))assert.deepEqual(map.get(row.id),row);
 assert.deepEqual(after.accounts,before.accounts);
 const files=await inventory(f);for(const [name,hash] of Object.entries(before.files))assert.equal(files[name],hash);
 if(exact){assert.deepEqual(after.rows,before.rows);assert.deepEqual(files,before.files);}
}
function run(f,name,args,{success=true,env={}}={}){
 const result=spawnSync(process.execPath,[path.join(repo,'scripts/data-tools',name),...args],{cwd:f.cwd,env:{...process.env,DOON_DATA_DIR:f.data,DOON_BUILD_DIR:buildDir,DOON_IMPORT_BUILD:buildDir,...env},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
 assert.ifError(result.error);
 assert.equal(result.status===0,success,result.stdout+'\n'+result.stderr);
 return result;
}
async function writeJson(f,name,value){const target=path.join(f.cwd,name);await fs.writeFile(target,JSON.stringify(value));return target;}

const followup=await fixture('followup');
const followupPayload={token:randomUUID(),format:'doon-customer-followup-v1',sourceKey:'TEST_cli_source',ownerId:sales.id,followups:[{sourceId:'TEST_source_row',source:{original:'TEST raw followup'},sourceTitle:'TEST original title',customerId:'',projectId:'',title:'TEST followup',category:'other',stars:0,status:'pending',followUpDate:'',notes:'TEST original notes',nextAction:'TEST review',checklist:[{id:'TEST_check',text:'TEST original checklist',checked:false}]}],mails:[{sourceId:'TEST_mail',followupSourceIds:['TEST_source_row'],subject:'TEST original mail',draftStatus:'draft',source:{original:'TEST raw draft'}}],sourceFiles:[{sourceId:'TEST_archive',filename:'TEST-original.html',base64:Buffer.from('<p>TEST original evidence</p>').toString('base64')}]};
const followupPath=await writeJson(followup,'followup.json',followupPayload),followupHash=sha(await fs.readFile(followupPath));
const followupBefore=await protect(followup),followupReport=path.join(followup.cwd,'rehearsal.json');
const followupArgs=[followupPath,'--build',buildDir,'--data',followup.data,'--report',followupReport];
run(followup,'import-customer-followup.mjs',followupArgs);
const rehearsal=JSON.parse(await fs.readFile(followupReport,'utf8'));
assert.equal(rehearsal.success,true);assert.equal(rehearsal.mode,'rehearsal');assert.equal(rehearsal.ownerVisibilityVerified,true);
assert.equal(rehearsal.counts.followups,1);assert.equal(rehearsal.counts.mails,1);assert.equal(rehearsal.counts.drafts,1);
assert.equal(path.relative(followup.cwd,rehearsal.checkpointDir).startsWith('..'),false);
await assertPreserved(followup,followupBefore,{exact:true});assert.equal(sha(await fs.readFile(followupPath)),followupHash);
const checkpoint={dbPath:path.join(rehearsal.checkpointDir,'workspace.sqlite')};
assert.deepEqual(entities(checkpoint).find(row=>row.kind==='customer_project_followup').source,followupPayload.followups[0].source);
assert.equal(entities(checkpoint).find(row=>row.kind==='customer_project_followup_mail').draftStatus,'draft');
pass('relocated followup CLI rehearses in a snapshot and preserves input, records, accounts, attachments and draft status');

const missingPreflight=run(followup,'import-customer-followup.mjs',[...followupArgs,'--apply'],{success:false});
assert.match(missingPreflight.stderr,/successful rehearsal report/);await assertPreserved(followup,followupBefore,{exact:true});
const invalidPayload=structuredClone(followupPayload);invalidPayload.ownerId='member_TEST_missing';
const invalidPath=await writeJson(followup,'invalid-followup.json',invalidPayload),invalidReport=path.join(followup.cwd,'failed-rehearsal.json');
run(followup,'import-customer-followup.mjs',[invalidPath,'--build',buildDir,'--data',followup.data,'--report',invalidReport],{success:false});
assert.equal(JSON.parse(await fs.readFile(invalidReport,'utf8')).success,false);await assertPreserved(followup,followupBefore,{exact:true});
pass('followup apply without preflight and invalid rehearsal cannot change the source workspace');

const purchase=await fixture('purchase'),purchaseBefore=await protect(purchase);
const headers=['单据编号','单据日期','供应商','业务员','单据状态','关闭状态','预计交货日期','商品编码','商品名称','单位','数量','商品行备注','剩余备货天数','客户订单编号'];
const details=[['TEST-PO-1','2026-01-01','TEST Supplier','TEST Buyer','已审核','未关闭','2026-01-10','TEST-ITEM-1','TEST material','副',12,'TEST original note',9,'TEST-ORDER-1'],['TEST-PO-1','2026-01-01','TEST Supplier','TEST Buyer','已审核','未关闭','2026-01-10','TEST-ITEM-2','TEST material','副',8,'TEST second note',9,'TEST-ORDER-2']];
const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['TEST synthetic purchase workbook'],[],headers,...details]),'TEST purchases');
const workbookPath=path.join(purchase.cwd,'TEST-purchase.xlsx');await fs.writeFile(workbookPath,XLSX.write(workbook,{bookType:'xlsx',type:'buffer'}));
const workbookHash=sha(await fs.readFile(workbookPath)),expectationsPath=await writeJson(purchase,'expectations.json',{rows:3,orders:1,suppliers:1});
const mismatch=run(purchase,'import-purchase-live.mjs',[workbookPath,'2026-01-02'],{success:false,env:{DOON_IMPORT_EXPECTATIONS:expectationsPath}});
assert.match(mismatch.stderr,/源文件数量与本次验收不一致/);assert.equal(entities(purchase).filter(row=>row.kind==='purchase').length,0);
await assertPreserved(purchase,purchaseBefore);assert.equal(sha(await fs.readFile(workbookPath)),workbookHash);
// A preview persists its source and job for review, but does not commit purchase rows.
assert(entities(purchase).some(row=>row.kind==='purchase_import'));
pass('purchase count mismatch retains review evidence but commits no purchase rows and preserves originals');
await writeJson(purchase,'expectations.json',{rows:2,orders:1,suppliers:1});
run(purchase,'import-purchase-live.mjs',[workbookPath,'2026-01-02'],{env:{DOON_IMPORT_EXPECTATIONS:expectationsPath}});
const purchaseReport=JSON.parse(await fs.readFile(path.join(purchase.cwd,'test-output','purchase-live-import.json'),'utf8'));
assert.equal(purchaseReport.rows,2);assert.equal(purchaseReport.accountsPreserved,true);assert.equal(purchaseReport.protectedRecordsPreserved,true);
const importedPurchases=entities(purchase).filter(row=>row.kind==='purchase');assert.equal(importedPurchases.length,2);assert(importedPurchases.every(row=>!row.balanceKnown));
assert.equal(importedPurchases.reduce((sum,row)=>sum+row.quantity,0),20);
await assertPreserved(purchase,purchaseBefore);assert.equal(sha(await fs.readFile(workbookPath)),workbookHash);
assert.equal(path.relative(purchase.data,purchaseReport.backup.folder).startsWith('..'),false);
pass('relocated purchase CLI imports verified counts through the isolated API with unknown receipts and accounts preserved');

const inspection=spawnSync(process.env.DOON_PYTHON||'python',[path.join(repo,'scripts/data-tools/inspect-purchase.py'),workbookPath],{cwd:purchase.cwd,env:process.env,encoding:'utf8',windowsHide:true,timeout:30000});
assert.ifError(inspection.error);assert.equal(inspection.status,0,inspection.stdout+'\n'+inspection.stderr);
const inspected=JSON.parse(await fs.readFile(path.join(purchase.cwd,'test-output','purchase-workbook-structure.json'),'utf8'));
assert.equal(inspected[0].summary.detailRows,2);assert.equal(inspected[0].summary.purchaseOrders,1);assert.equal(inspected[0].summary.suppliers,1);assert.equal(inspected[0].summary.units['副'],20);assert.equal(sha(await fs.readFile(workbookPath)),workbookHash);
pass('relocated Python purchase inspection reports synthetic workbook totals without changing the workbook');

const supplier={id:'supplier_TEST',kind:'supplier',name:'TEST Factory',active:true,version:1};
const order={id:'order_TEST_outsource',kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'TEST',source:'synthetic',orderNo:'TEST-ORDER-OUTSOURCE',customer:'TEST Customer',customerPO:'TEST-PO',drawing:'TEST-DRAWING',color:'TEST',lens:'白片',productType:'待确认',batch:'',quantity:100,requestedDate:'',plannedDate:'',promisedDate:'',promiseConfirmed:false,shipDate:'',ownerEmail:'',stage:'生产中',customerNote:'TEST original note',arrangement:'',notes:'TEST original order',sourceStatus:'正式订单',extra:{'TEST field':'TEST original'},lifecycle:'active',ledger:{columns:{A:supplier.name,W:'待确认',BF:'',BG:'',BH:''},sourceRow:1,sheet:'TEST',filename:'TEST-original.xlsx',sourceHash:'TEST source',issues:[],ownerName:'TEST',originalOutstanding:''}};
const outsourcing=await fixture('outsourcing',[supplier,order]),outsourceBefore=await protect(outsourcing);
const plan={format:'finished-outsourcing-pending-plan-v1',supplier:supplier.name,lines:[{lineId:order.id,orderVersion:1,quantity:100,productType:'成品',businessType:'finished_full_outsource',unit:'付',note:'TEST explicitly reviewed classification; preserve unknown opening quantities',confirmToken:randomUUID(),taskToken:randomUUID(),cutoffDate:'2026-01-01',dueDate:'',steps:[{id:'packing',label:'TEST packing'}]}]};
const planPath=await writeJson(outsourcing,'plan.json',plan),planHash=sha(await fs.readFile(planPath));
const preview=run(outsourcing,'publish-finished-outsourcing.mjs',['preview',planPath]);
assert.equal(JSON.parse(preview.stdout.trim()).mode,'preview');await assertPreserved(outsourcing,outsourceBefore,{exact:true});assert.equal(sha(await fs.readFile(planPath)),planHash);
const wrongPlan=structuredClone(plan);wrongPlan.lines[0].quantity=101;
const wrongPath=await writeJson(outsourcing,'wrong-plan.json',wrongPlan);
const rejected=run(outsourcing,'publish-finished-outsourcing.mjs',['apply',wrongPath],{success:false});assert.match(rejected.stderr,/Source identity, factory, quantity or lifecycle changed/);
await assertPreserved(outsourcing,outsourceBefore,{exact:true});
pass('relocated outsourcing preview is read-only and source-quantity mismatch blocks publication');
run(outsourcing,'publish-finished-outsourcing.mjs',['apply',planPath]);
const published=JSON.parse(await fs.readFile(path.join(outsourcing.cwd,'plan-result.json'),'utf8'));
assert.equal(published.ok,true);assert.equal(published.quantityAndInventoryPreserved,true);assert.equal(published.published.length,1);assert.equal(published.published[0].baselineStatus,'pending');
const task=entities(outsourcing).find(row=>row.id===published.published[0].taskId),changedOrder=entities(outsourcing).find(row=>row.id===order.id);
assert.equal(task.baselineStatus,'pending');assert.equal(task.quantity,100);assert.equal(task.baselineStock,null);assert.equal(changedOrder.ledger.columns.BF,'');assert.equal(changedOrder.quantity,order.quantity);
await assertPreserved(outsourcing,outsourceBefore,{changed:[order.id]});assert.equal(sha(await fs.readFile(planPath)),planHash);
assert.equal(path.relative(outsourcing.data,published.backup).startsWith('..'),false);
pass('relocated outsourcing apply creates a pending task, preserves unknown stock and keeps unrelated history and accounts');

console.log(JSON.stringify({passed,syntheticOnly:true,root}));
