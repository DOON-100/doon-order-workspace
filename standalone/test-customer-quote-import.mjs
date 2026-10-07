// Synthetic fixtures only. This command never reads production data or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

await fs.mkdir('test-output',{recursive:true});
const root=await fs.mkdtemp(path.resolve('test-output/quote-import-')),buildDir=path.join(root,'build'),dataDir=path.join(root,'data');
await fs.mkdir(buildDir);await fs.mkdir(path.join(dataDir,'files'),{recursive:true});
await fs.copyFile('standalone/runtime.mjs',path.join(buildDir,'runtime.mjs'));
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:path.join(buildDir,'workspace-api.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'standalone-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'./runtime.mjs',external:true}));}}]});
const dbPath=path.join(dataDir,'workspace.sqlite'),seedDb=new DatabaseSync(dbPath);
seedDb.exec("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);INSERT INTO workspace_revision VALUES('main',1);CREATE TABLE local_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,member_id TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL)");
const at='2026-01-01T00:00:00.000Z',owner={id:'member_test_owner',kind:'member',name:'Synthetic Owner',email:'owner@test.invalid',userId:'local_test_owner',role:'admin',active:true,owner:true,customers:[],createdAt:at};
const untouched={id:'order_test_preserved',kind:'order',value:'Immutable unrelated synthetic order'};
for(const record of [owner,untouched])seedDb.prepare('INSERT INTO records VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
seedDb.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,1,?)').run(owner.userId,'synthetic-owner',owner.id,'unused-synthetic-placeholder',at);seedDb.close();
const rows=()=>{const db=new DatabaseSync(dbPath,{readOnly:true});try{return db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();}finally{db.close();}};
const records=()=>rows().map(row=>JSON.parse(row.data));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64');
const draft={companyEn:'Synthetic Eyewear Ltd',companyZh:'合成测试公司',collectionEn:'Test collection',collectionZh:'测试系列',customerCode:'',customerName:'Synthetic new customer',customerAccountId:'must-not-bind-implicitly',contactName:'Synthetic Contact',quoteNo:'TEST-IMPORT-001',quoteDate:'2026-01-01',validUntil:'',currency:'USD',internalNotesZh:'仅供内部测试的供应商说明',exchangeRateCnyPerUsd:7,internalCosts:[{id:'cost-test',label:'Synthetic internal cost',rmb:70,notes:'Synthetic cost note'}],customerCharges:[{id:'charge-test',labelZh:'测试附加费',labelEn:'Synthetic additional fee',amount:15,basisZh:'范围待确认',basisEn:'Scope pending',conditional:false,needsReview:true}],lines:[{id:'line-test',model:'MODEL-TEST',descriptionZh:'测试材质',descriptionEn:'Synthetic material',quantity:300,quantityBasisZh:'每色／尺寸，非总量',quantityBasisEn:'per colour / size, not total',unitPrice:10,toolingFee:null}],terms:[{id:'term-test',labelZh:'测试条件',labelEn:'Synthetic condition',zh:'满足条件时才收费',en:'Conditional charge only',needsReview:false}],reviewNotes:['Synthetic review pending']};
const draftPath=path.join(root,'draft.json');
async function run(value=draft,bytes=png,filename='synthetic.png',success=true){
 const sourcePath=path.join(root,filename);await fs.writeFile(draftPath,JSON.stringify(value));await fs.writeFile(sourcePath,bytes);
 const result=spawnSync(process.execPath,['standalone/import-customer-quote.mjs','--build-dir',buildDir,'--draft',draftPath,'--source',sourcePath],{env:{...process.env,DOON_DATA_DIR:dataDir},encoding:'utf8',windowsHide:true});
 assert.equal(result.status===0,success,result.stderr||result.stdout);
 return {report:result.stdout.trim()?JSON.parse(result.stdout.trim()):null,error:result.stderr};
}
let passed=0;const pass=message=>{passed++;console.log('PASS '+message);};
const original=rows();
const first=(await run()).report,saved=records().find(r=>r.id===first.quoteId);
assert.equal(first.preserved,true);assert.equal(first.payloadVerified,true);assert.equal(saved.status,'draft');assert.equal(saved.version,2);assert.equal(saved.customerCode,'');assert.equal(saved.customerAccountId,null);
for(const field of ['contactName','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges','lines','terms','reviewNotes'])assert.deepEqual(saved[field],draft[field]);
assert.equal(saved.sourceContentType,'image/png');assert.equal(saved.sourceHash,hash(png));
assert.equal(records().filter(r=>r.kind==='customer_quote_completed').length,0);
for(const row of original)assert.deepEqual(rows().find(r=>r.id===row.id),row);
assert.deepEqual(await fs.readFile(path.join(dataDir,'files',hash(saved.sourceFileKey))),png);
pass('full review payload and PNG source preserved, unbound new customer remains draft, unrelated records unchanged');
let snapshot=rows();const again=(await run()).report;assert.equal(again.alreadyPresent,true);assert.equal(again.added,0);assert.deepEqual(rows(),snapshot);
pass('exact payload plus source hash is fully idempotent');
await run({...draft,internalCosts:[{...draft.internalCosts[0],rmb:71}]},png,'synthetic.png',false);assert.deepEqual(rows(),snapshot);
await run({...draft,contactName:'Changed synthetic contact'},png,'synthetic.png',false);assert.deepEqual(rows(),snapshot);
await run({...draft,customerCharges:[{...draft.customerCharges[0],amount:16}]},png,'synthetic.png',false);assert.deepEqual(rows(),snapshot);
await run(draft,Buffer.concat([png,Buffer.from('different-source')]),'synthetic.png',false);assert.deepEqual(rows(),snapshot);
pass('different draft fields or source bytes cannot match or overwrite a prior import');
await run({...draft,quoteNo:'TEST-INVALID-SOURCE'},Buffer.from('not a PNG'),'invalid.png',false);assert.deepEqual(rows(),snapshot);
await run({...draft,quoteNo:'TEST-CHECKSUM',sourceSha256:'0'.repeat(64)},png,'checksum.png',false);assert.deepEqual(rows(),snapshot);
pass('source signature and reviewed checksum failures stop before any draft creation');
const formats=[['jpg',Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0xff,0xd9]),'image/jpeg'],['jpeg',Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0xff,0xd9]),'image/jpeg'],['pdf',Buffer.from('%PDF-1.4\nSynthetic fixture\n%%EOF'),'application/pdf'],['xlsx',Buffer.from([0x50,0x4b,0x03,0x04,0x00,0x00]),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['xls',Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),'application/vnd.ms-excel']];
for(const [ext,bytes,mime] of formats){const result=(await run({...draft,quoteNo:'TEST-FORMAT-'+ext},bytes,'synthetic.'+ext)).report;assert.equal(records().find(r=>r.id===result.quoteId).sourceContentType,mime);}
pass('JPEG support and existing XLSX/XLS/PDF formats use accurate server-controlled MIME');
const padded={...draft,quoteNo:'  TEST-NORMALIZED  ',companyEn:'  Synthetic Eyewear Ltd  ',contactName:'  Synthetic Contact  ',lines:[{...draft.lines[0],quantityBasisEn:'  per colour / size, not total  '}],internalCosts:[{id:'cost-test',label:'  Synthetic internal cost  ',rmb:70}]};
await run(padded);snapshot=rows();assert.equal((await run(padded)).report.alreadyPresent,true);assert.deepEqual(rows(),snapshot);
pass('API normalization and missing internal cost notes do not defeat safe idempotency');
const partial={...saved,id:'quote_test_partial',quoteNo:'TEST-PARTIAL',version:1};
delete partial.sourceFileKey;delete partial.sourceHash;delete partial.sourceFilename;delete partial.sourceContentType;
const writeFixture=value=>{const db=new DatabaseSync(dbPath);try{db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(value.id,value.kind,JSON.stringify(value));}finally{db.close();}};
writeFixture(partial);snapshot=rows();const interrupted=await run({...draft,quoteNo:partial.quoteNo},png,'synthetic.png',false);assert.match(interrupted.error,/matching draft already exists without its source attachment/);assert.deepEqual(rows(),snapshot);
pass('interrupted source-less draft is identified with explicit recovery guidance and no duplicate');
writeFixture({...saved,lines:[{...saved.lines[0],unitPrice:11}]});snapshot=rows();await run(draft,png,'synthetic.png',false);assert.deepEqual(rows(),snapshot);
pass('manually changed existing draft is never overwritten or reported as the reviewed payload');

// Exercise the actual upload handler, independently of the importer preflight.
process.env.DOON_DATA_DIR=dataDir;
const runtime=await import(pathToFileURL(path.join(buildDir,'runtime.mjs'))),api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')));
const current={identity:{userId:owner.userId,email:owner.email,displayName:owner.name,fullName:owner.name}};
async function upload(bytes,filename,mime){
 const quote=records().find(r=>r.id===saved.id),form=new FormData();form.set('quoteId',quote.id);form.set('version',String(quote.version));form.set('file',new File([bytes],filename,{type:mime}));
 return runtime.context.run(current,()=>api.POST(new Request('http://localhost/api/workspace/customer-quote-upload',{method:'POST',body:form}),{params:Promise.resolve({action:'customer-quote-upload'})}));
}
try{
 snapshot=rows();const invalid=await upload(Buffer.from('%PDF-1.4'),'spoofed.png','image/png');assert.equal(invalid.status,400);assert.deepEqual(rows(),snapshot);
 const valid=await upload(png,'reference.PNG','text/html');assert.equal(valid.status,200);assert.equal(records().find(r=>r.id===saved.id).sourceContentType,'image/png');
 pass('API rejects image extension spoofing and ignores client-provided MIME in favour of signature-derived PNG');
}finally{runtime.db.close();}
console.log(JSON.stringify({passed,root}));
