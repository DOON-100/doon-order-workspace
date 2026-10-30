// Isolated synthetic archive tests; never imports a production runtime or data directory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';
import {zipSync,unzipSync,strFromU8,strToU8} from 'fflate';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(root,'test-output'),{recursive:true});
const output=await fs.mkdtemp(path.join(root,'test-output','outsourcing-workbook-'));
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join(root,'drizzle',name),'utf8'));
db.prepare("INSERT INTO workspace_revision(id,revision) VALUES('main',0)").run();
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const files=new Map();
globalThis.__outsourcingWorkbookEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key)}:null}};
const outfile=path.join(output,'api.mjs');
await build({entryPoints:[path.join(root,'lib/outsourcing-workbook-api.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'test-only-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='env'?'export const env=globalThis.__outsourcingWorkbookEnv':'export async function getChatGPTUser(){return null}'}));}}]});
const api=await import(pathToFileURL(outfile));
const member=(id,role='clerk',extra={})=>({id,kind:'member',email:id+'@test.invalid',name:id,userId:id,role,active:true,customers:[],createdAt:'2026-01-01T00:00:00Z',...extra});
const admin=member('archive-admin','admin'),reader=member('archive-reader'),outsider=member('unlisted','clerk',{departments:['titanium','outsourcing']}),supplier=member('external','supplier'),disabled=member('disabled','clerk',{active:false});
const externalClerk=member('external-clerk','clerk',{personnelType:'external'}),externalAdmin=member('external-admin','admin',{personnelType:'external'});
const protectedRow={id:'synthetic-production',kind:'order',quantity:777,notes:'must remain unchanged'};
for(const r of [admin,reader,outsider,supplier,disabled,externalClerk,externalAdmin,protectedRow])db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r));
const records=()=>db.prepare('SELECT data FROM records ORDER BY id').all().map(r=>JSON.parse(r.data));
const state=()=>({revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,records:records()});
const sha=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
async function call(action,body,who=admin,oldState){const method=body===undefined?'GET':'POST',req=new Request('https://synthetic.test/api/workspace/'+action,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});try{return await api[method==='GET'?'outsourcingWorkbookGet':'outsourcingWorkbookPost'](action.split('?')[0],req,oldState||state(),who);}catch(error){return Response.json({error:error.message},{status:error.status||500});}}
async function ok(action,body,who=admin){const response=await call(action,body,who),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
function workbook(){const book=XLSX.utils.book_new();for(let n=0;n<12;n++){const sheet=XLSX.utils.aoa_to_sheet([['编码','保存结果','备注'],['001',3,'synthetic'],...Array.from({length:220},(_,i)=>['ROW-'+i,i,i===219?'last-record':''])]);sheet.B2={t:'n',f:'1+2',v:3};sheet.C3={t:'n',f:'7+8'};sheet['!cols']=[{}, {hidden:true},{}];sheet['!rows']=[{},{},{hidden:true}];XLSX.utils.book_append_sheet(book,sheet,'Sheet'+(n+1));}book.Workbook={Sheets:Array.from({length:12},(_,i)=>({Hidden:i>=7?1:0}))};return XLSX.write(book,{type:'array',bookType:'xlsx',cellStyles:true});}
const bytes=workbook();
function upload(value=bytes,viewMemberIds=[],name='synthetic.xlsx'){const form=new FormData();form.set('file',new File([value],name));form.set('title','Synthetic archive');form.set('viewMemberIds',JSON.stringify(viewMemberIds));return form;}

assert.equal((await call('outsourcing-workbook-upload',upload(),reader)).status,403);
assert.equal((await call('outsourcing-workbooks',undefined,supplier)).status,403);
for(const external of [externalClerk,externalAdmin]){assert.equal((await call('outsourcing-workbooks',undefined,external)).status,403);assert.equal((await call('outsourcing-workbook-upload',upload(),external)).status,403);}
const created=await ok('outsourcing-workbook-upload',upload()),id=created.archive.id;
assert.equal(created.archive.sheets.length,12);assert.equal(created.archive.sheets.filter(s=>s.state==='hidden').length,5);assert.equal(created.archive.sha256,sha(bytes));assert.deepEqual(created.archive.viewMemberIds,[]);assert(!('fileKey' in created.archive));
assert.deepEqual(records().find(r=>r.id===protectedRow.id),protectedRow);
assert.equal(records().filter(r=>!['member','order','outsourcing_workbook_archive','outsourcing_workbook_audit'].includes(r.kind)).length,0);
pass('admin archives original bytes and generic 12-sheet metadata without creating business facts');

for(const who of [reader,outsider,supplier,disabled,externalClerk,externalAdmin]){assert.equal((await call('outsourcing-workbook-file?id='+id,undefined,who)).status,403);assert.equal((await call('outsourcing-workbook-sheet?id='+id+'&sheet=Sheet1',undefined,who)).status,403);}
assert.equal((await ok('outsourcing-workbooks',undefined,outsider)).archives.length,0);
const beforeDuplicate=JSON.stringify(records()),duplicate=await ok('outsourcing-workbook-upload',upload(bytes,[reader.id]));
assert.equal(duplicate.alreadyPresent,true);assert.equal(duplicate.accessUnchanged,true);assert.deepEqual(duplicate.archive.viewMemberIds,[]);assert.equal(JSON.stringify(records()),beforeDuplicate);
pass('same bytes deduplicate without widening grants; outsourcing department membership alone grants no source access');

const granted=await ok('outsourcing-workbook-access',{id,version:1,viewMemberIds:[reader.id]});
assert.equal(granted.archive.version,2);assert.equal((await call('outsourcing-workbook-access',{id,version:1,viewMemberIds:[]})).status,409);
assert.equal((await call('outsourcing-workbook-access',{id,version:2,viewMemberIds:[supplier.id]})).status,400);
for(const external of [externalClerk,externalAdmin])assert.equal((await call('outsourcing-workbook-access',{id,version:2,viewMemberIds:[external.id]})).status,400);
assert((await ok('outsourcing-workbooks')).members.every(member=>![externalClerk.id,externalAdmin.id].includes(member.id)));
const downloaded=await call('outsourcing-workbook-file?id='+id,undefined,reader);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('x-content-sha256'),sha(bytes));assert.equal(sha(await downloaded.arrayBuffer()),sha(bytes));
const sheet=await ok('outsourcing-workbook-sheet?id='+id+'&sheet=Sheet1&headerRow=1',undefined,reader);
assert.equal(sheet.formulaCachesRecalculated,false);assert.equal(sheet.rows.length,222);assert.equal(sheet.columns[0].label,'编码');assert.equal(sheet.columns[1].hidden,true);assert.equal(sheet.rows.find(r=>r.row===3).hidden,true);
assert.equal(sheet.rows.find(r=>r.row===2).cells[0].value,'001');assert.equal(sheet.rows.find(r=>r.row===2).cells[1].formula,'1+2');assert.equal(sheet.rows.find(r=>r.row===2).cells[1].cachedValue,3);assert.equal(sheet.rows.at(-1).cells[2].display,'last-record');
assert.equal(sheet.rows.find(r=>r.row===3).cells[2].cacheStatus,'missing');assert.equal(sheet.rows.find(r=>r.row===3).cells[2].display,'〔公式缓存缺失〕');
assert.equal((await ok('outsourcing-workbook-sheet?id='+id+'&sheet=Sheet12',undefined,reader)).sheet.state,'hidden');
pass('explicit viewer can query every row and hidden sheet/column while preserving formulas, caches and leading-zero text');

await ok('outsourcing-workbook-access',{id,version:2,viewMemberIds:[]});
assert.equal((await call('outsourcing-workbook-file?id='+id,undefined,reader)).status,403);assert.equal((await ok('outsourcing-workbooks',undefined,reader)).archives.length,0);
const record=records().find(r=>r.id===id),original=files.get(record.fileKey);files.set(record.fileKey,new Uint8Array([1,2,3]).buffer);
assert.equal((await call('outsourcing-workbook-file?id='+id)).status,409);assert.equal((await call('outsourcing-workbook-sheet?id='+id+'&sheet=Sheet1')).status,409);files.set(record.fileKey,original);
pass('revocation applies to subsequent reads and corrupt stored bytes never download or parse');

assert.equal((await call('outsourcing-workbook-upload',upload(bytes,[],'spoof.xlsm'))).status,400);
const archive=unzipSync(new Uint8Array(bytes)),macro=zipSync({...archive,'xl/vbaProject.bin':new Uint8Array([1,2,3])});
assert.equal((await call('outsourcing-workbook-upload',upload(macro))).status,400);
const bomb=zipSync({...archive,'xl/oversize.xml':strToU8('<x>'+('x'.repeat(8*1024*1024))+'</x>')});assert.equal((await call('outsourcing-workbook-upload',upload(bomb))).status,400);
assert.equal((await call('outsourcing-workbook-upload',upload(new Uint8Array(10*1024*1024+1)))).status,400);
const malicious=zipSync({...archive,'xl/worksheets/sheet1.xml':strToU8(strFromU8(archive['xl/worksheets/sheet1.xml']).replace('<worksheet','<!DOCTYPE x [<!ENTITY x SYSTEM "https://example.invalid/never-fetch">]><worksheet'))});assert.equal((await call('outsourcing-workbook-upload',upload(malicious))).status,400);
assert.equal((await call('outsourcing-workbook-sheet?id='+id+'&sheet=Sheet1&headerRow=-1')).status,400);
pass('macro, malformed XML, oversized uploads/inflation and invalid header selection fail closed');

const largeBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(largeBook,{A1:{t:'s',v:'header'},Z6000:{t:'s',v:'last'},'!ref':'A1:Z6000'},'Large');const largeBytes=XLSX.write(largeBook,{type:'array',bookType:'xlsx'});
const largeArchive=await ok('outsourcing-workbook-upload',upload(largeBytes));assert.equal((await call('outsourcing-workbook-sheet?id='+largeArchive.archive.id+'&sheet=Large')).status,413);assert.equal((await call('outsourcing-workbook-file?id='+largeArchive.archive.id)).status,200);
const collisionBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(collisionBook,XLSX.utils.aoa_to_sheet([['synthetic concurrent']]),'Concurrent');const collisionBytes=XLSX.write(collisionBook,{type:'array',bookType:'xlsx'}),oldState=state();
const concurrent=await Promise.all([call('outsourcing-workbook-upload',upload(collisionBytes),admin,oldState),call('outsourcing-workbook-upload',upload(collisionBytes),admin,oldState)]);assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);assert.equal(records().filter(r=>r.kind==='outsourcing_workbook_archive'&&r.sha256===sha(collisionBytes)).length,1);
pass('large sheet query refuses truncation while preserving download; concurrent same-file upload publishes once');

assert.deepEqual(records().find(r=>r.id===protectedRow.id),protectedRow);
db.close();console.log(JSON.stringify({ok:true,checks,syntheticOnly:true}));
