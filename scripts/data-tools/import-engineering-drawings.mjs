// Additive maintenance import. Defaults to preview; never reads passwords or sessions.
import {DatabaseSync,backup} from 'node:sqlite';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),options=new Map();
for(let i=0;i<args.length;i++){
 const flag=args[i];if(!['--input','--source','--actor-id','--apply','--plan-hash'].includes(flag)||options.has(flag))throw new Error('Unknown or duplicate import option.');
 if(flag==='--apply'){options.set(flag,true);continue;}
 const argument=args[++i];if(!argument||argument.startsWith('--'))throw new Error(`${flag} requires a value.`);options.set(flag,argument);
}
for(const flag of ['--input','--source','--actor-id'])if(!options.get(flag))throw new Error('Required: --input <private JSON> --source <original XLSX> --actor-id <administrator member id>. Default is preview.');
const apply=options.has('--apply'),sha=value=>createHash('sha256').update(value).digest('hex');
if(apply&&!/^[a-f0-9]{64}$/.test(options.get('--plan-hash')||''))throw new Error('Apply requires the reviewed --plan-hash.');
const inputBytes=await fs.readFile(path.resolve(options.get('--input'))),sourceBytes=await fs.readFile(path.resolve(options.get('--source')));
if(!inputBytes.length||inputBytes.length>20*1024*1024||!sourceBytes.length||sourceBytes.length>20*1024*1024)throw new Error('Import JSON and workbook must each be nonempty and at most 20 MB.');
if(path.extname(options.get('--source')).toLowerCase()!=='.xlsx'||sourceBytes[0]!==0x50||sourceBytes[1]!==0x4b)throw new Error('Original source must be an XLSX workbook.');
const original=JSON.parse(inputBytes.toString('utf8').replace(/^\uFEFF/,'')),sourceHash=sha(sourceBytes);
if(!/^[a-f0-9]{64}$/.test(original.sourceSha256||'')||original.sourceSha256!==sourceHash)throw new Error('Original workbook checksum is missing or does not match the reviewed JSON.');
const book=XLSX.read(sourceBytes,{type:'buffer',cellDates:false,cellFormula:true});
const sourceRows=original.records;
if(!Array.isArray(sourceRows)||!sourceRows.length||sourceRows.length>5000)throw new Error('Reviewed JSON must contain 1–5000 records.');
const sheets=[...new Set(sourceRows.map(row=>row.sourceSheet))];
if(sheets.length!==1||!book.Sheets[sheets[0]])throw new Error('Import must identify one existing source sheet.');
const sourceSheet=sheets[0],seen=new Set();
for(const row of sourceRows){
 if(!Number.isInteger(row.sourceRow)||row.sourceRow<2||seen.has(row.sourceRow))throw new Error('Every source row must be a distinct positive data row.');
 seen.add(row.sourceRow);
 const cells=row.sourceValues;if(!cells||Object.keys(cells).length!==13)throw new Error('All 13 original columns must be preserved for every row.');
 for(let col=0;col<13;col++){
  const address=XLSX.utils.encode_cell({r:row.sourceRow-1,c:col}),cell=book.Sheets[sourceSheet][address];
  if(cell?.f)throw new Error('Formula cells require explicit review; import stopped.');
  if(!Object.prototype.hasOwnProperty.call(cells,address)||JSON.stringify(cells[address])!==JSON.stringify(cell?.v??''))throw new Error(`Source content mismatch at ${address}; no data written.`);
 }
}
// Preserve each original row, including identical rows. No fuzzy name/customer linking.
const originalColumns=['状态','客户编号','画图类型','需求发出时间','新款数量','改图数量','需求者','款号','画图备注','画图人员','截止日期','完成日期','老郑审批确认'];
const originalCell=(row,col)=>row.sourceValues[XLSX.utils.encode_cell({r:row.sourceRow-1,c:col})];
const sourceText=(row,col)=>String(originalCell(row,col)).trim();
function sourceDate(row,col){const text=sourceText(row,col);if(!text)return '';const match=text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);if(!match)throw new Error('A source date needs manual normalization; no data written.');return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;}
function sourceCount(row,col){const value=originalCell(row,col);if(value==='')return null;if(typeof value!=='number'||!Number.isInteger(value)||value<0)throw new Error('A source quantity needs manual review.');return value;}
const payload={format:'doon-engineering-drawing-import-v1',source:{filename:path.basename(options.get('--source')),sheet:sourceSheet,sha256:sourceHash},rows:sourceRows.map(row=>({
 sourceRow:row.sourceRow,rawColumns:Object.fromEntries(originalColumns.map((name,col)=>[name,originalCell(row,col)])),qualityIssues:row.qualityIssues||[],customerId:'',customerCode:sourceText(row,1),drawingType:sourceText(row,2),
 requestedDate:sourceDate(row,3),newCount:sourceCount(row,4),revisionCount:sourceCount(row,5),requester:sourceText(row,6),
 modelNo:sourceText(row,7),drawingNotes:sourceText(row,8),assigneeId:'',assignee:sourceText(row,9),deadline:sourceDate(row,10),
 completedDate:sourceDate(row,11),approval:'待审核',status:'待分配',upstreamDepartment:'',priority:'普通',requirement:'',downstream:'',deliveredDate:'',deliveryNote:'',
}))};
await fs.mkdir(path.join(root,'test-output'),{recursive:true});
const temporary=await fs.mkdtemp(path.join(root,'test-output','engineering-import-model-')),bundle=path.join(temporary,'model.mjs');
await build({entryPoints:[path.join(root,'lib/engineering-drawings.ts')],outfile:bundle,bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':root},logLevel:'silent'});
const {validateDrawingImport,buildImportedDrawings}=await import(pathToFileURL(bundle).href);
const validated=validateDrawingImport(payload);
const dataDir=path.resolve(process.env.DOON_DATA_DIR||path.join(root,'lan-data')),databasePath=path.join(dataDir,'workspace.sqlite');
if(!(await fs.stat(databasePath)).isFile())throw new Error('Existing workspace database is required; no database is created.');
const db=new DatabaseSync(databasePath,{readOnly:!apply});db.exec('PRAGMA busy_timeout=5000');
async function inventory(directory){
 const result={};
 async function visit(folder,prefix=''){
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
   const relative=prefix+entry.name,target=path.join(folder,entry.name);
   if(entry.isSymbolicLink())throw new Error('Attachment storage contains a symbolic link.');
   if(entry.isDirectory())await visit(target,relative+'/');
   else if(entry.isFile())result[relative]=sha(await fs.readFile(target));
   else throw new Error('Attachment storage contains an unsupported entry.');
  }
 }
 await visit(directory);return result;
}
try{
 let rawRows,revision;
 db.exec('BEGIN');try{rawRows=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();revision=db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision;db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 if(!Number.isSafeInteger(revision))throw new Error('Workspace revision is missing.');
 const existing=new Map(rawRows.map(row=>[row.id,row])),actor=rawRows.map(row=>JSON.parse(row.data)).find(row=>row.kind==='member'&&row.id===options.get('--actor-id'));
 if(!actor?.active||actor.role!=='admin')throw new Error('An explicitly selected active administrator member is required.');
 const built=await buildImportedDrawings(validated,{id:actor.id,name:actor.name});
 const records=built.records,allRevisions=built.revisions;
 if(!Array.isArray(records)||!Array.isArray(allRevisions)||records.length!==sourceRows.length)throw new Error('Shared model did not produce one drawing per source row.');
 const additions=[],newIds=new Set();let skipped=0;
 for(const record of records){
  if(record.kind!=='engineering_drawing')throw new Error('Unexpected imported record kind.');
  const prior=existing.get(record.id);
  if(prior){
   const value=JSON.parse(prior.data);
   if(prior.kind!==record.kind||JSON.stringify(value.source)!==JSON.stringify(record.source))throw new Error('An import identity already exists with different source evidence.');
   skipped++;continue;
  }
  if(newIds.has(record.id))throw new Error('Shared model returned duplicate identities.');
  newIds.add(record.id);additions.push(record);
 }
 for(const item of allRevisions){
  if(item.kind!=='engineering_drawing_revision')throw new Error('Unexpected drawing revision kind.');
  if(newIds.has(item.recordId))additions.push(item);
 }
 for(const record of additions.filter(row=>row.kind==='engineering_drawing'))additions.push({id:'audit_'+randomUUID(),kind:'audit',targetId:record.id,lineId:'',action:'导入工程画图原表',actorId:actor.id,actor:actor.name,source:'工程画图原表增量导入',before:null,after:record,createdAt:record.createdAt});
 const planHash=sha(JSON.stringify({sourceHash,inputHash:sha(inputBytes),actorId:actor.id,revision,newIds:[...newIds].sort(),skipped}));
 const counts={sourceRows:sourceRows.length,newDrawings:newIds.size,existingDrawings:skipped,newRecords:additions.length};
 if(!apply){console.log(JSON.stringify({mode:'preview',planHash,expectedRevision:revision,sourceHash,counts}));}
 else{
  if(options.get('--plan-hash')!==planHash)throw new Error('Preview has changed; refresh the plan before applying.');
  if(!additions.length){console.log(JSON.stringify({mode:'no-op',planHash,counts,preserved:true}));}
  else{
   await fs.mkdir(path.join(dataDir,'backups'),{recursive:true});
   const saved=await fs.mkdtemp(path.join(dataDir,'backups','before-engineering-drawing-'));
   await backup(db,path.join(saved,'workspace.sqlite'));
   const check=new DatabaseSync(path.join(saved,'workspace.sqlite'),{readOnly:true});
   try{
    if(Object.values(check.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw new Error('Online backup integrity check failed.');
    if(check.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision!==revision||JSON.stringify(check.prepare('SELECT id,kind,data FROM records ORDER BY id').all())!==JSON.stringify(rawRows))throw new Error('Workspace changed during backup; refresh preview.');
   }finally{check.close();}
   const files=path.join(dataDir,'files'),beforeFiles=await inventory(files);
   await fs.cp(files,path.join(saved,'files'),{recursive:true,errorOnExist:true,force:false});
   const backupFiles=await inventory(path.join(saved,'files'));
   for(const [name,hash] of Object.entries(beforeFiles))if(backupFiles[name]!==hash)throw new Error('Attachment backup verification failed.');
   await fs.writeFile(path.join(saved,'drawing-source-original.xlsx'),sourceBytes,{flag:'wx'});
   await fs.writeFile(path.join(saved,'drawing-reviewed-original.json'),inputBytes,{flag:'wx'});
   const prepared={at:new Date().toISOString(),mode:'prepared',planHash,sourceHash,counts,preservedRecords:rawRows.length,verifiedFiles:Object.keys(beforeFiles).length};
   await fs.writeFile(path.join(saved,'import-prepared.json'),JSON.stringify(prepared,null,2),{flag:'wx'});
   db.exec('BEGIN IMMEDIATE');
   try{
    if(db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision!==revision||JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY id').all())!==JSON.stringify(rawRows))throw new Error('Workspace changed before commit; import cancelled.');
    const insert=db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?)');
    for(const item of additions)insert.run(item.id,item.kind,JSON.stringify(item));
    for(const before of rawRows){const after=db.prepare('SELECT kind,data FROM records WHERE id=?').get(before.id);if(!after||after.kind!==before.kind||after.data!==before.data)throw new Error('Existing-record preservation failed; additions rolled back.');}
    db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const result={...prepared,mode:'applied',preserved:true,backupFolder:saved};
   try{await fs.writeFile(path.join(saved,'import-manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});}catch{result.warning='Import committed; completion manifest could not be saved. The prepared manifest and backup remain.';}
   console.log(JSON.stringify(result));
  }
 }
}finally{db.close();}
