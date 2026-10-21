// Generic code-only release checks. Never import the application runtime or read credentials.
import {DatabaseSync, backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from './customer-price-build-evidence.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function plainDirectory(directory){
 const resolved=path.resolve(directory),stat=await fs.lstat(resolved);
 if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await fs.realpath(resolved)).toLowerCase()!==resolved.toLowerCase())throw Error('Directory must be a real directory, without a link or junction.');
 return resolved;
}
async function hashes(directory){
 const result={};
 async function walk(folder){for(const name of (await fs.readdir(folder)).sort()){
  const absolute=path.join(folder,name),stat=await fs.lstat(absolute);
  if(stat.isSymbolicLink())throw Error('Links are not allowed in release artifacts or object storage.');
  if(stat.isDirectory())await walk(absolute);
  else if(stat.isFile())result[path.relative(directory,absolute).replaceAll('\\','/')]=sha(await fs.readFile(absolute));
  else throw Error('Unexpected file type.');
 }}
 await walk(directory);return result;
}
export async function verifyStage(stage,expectedHash){
 stage=await plainDirectory(stage);
 const staging=await plainDirectory(path.join(projectRoot,'test-output'));
 const relative=path.relative(staging,stage);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Stage must be an existing directory below this project test-output.');
 await hashes(stage); // Reject junctions before the existing build verifier walks the tree.
 const original=process.cwd();let result;
 try{process.chdir(projectRoot);result=await verifyCustomerPriceBuildEvidence(stage);}finally{process.chdir(original);}
 if(expectedHash&&result.manifestSha256!==expectedHash)throw Error('Stage does not match the explicitly selected build manifest.');
 for(const file of ['workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','client/index.html'])if(!(await fs.stat(path.join(stage,file))).isFile())throw Error('Required build artifact missing.');
 return {stage,...result};
}
export async function verifyValidation(filename,manifestSha256){
 const bytes=await fs.readFile(filename),value=JSON.parse(bytes);
 if(value.format!=='doon-code-update-validation-v1'||value.manifestSha256!==manifestSha256)throw Error('Validation receipt must bind the selected build.');
 for(const name of ['business-tests','typescript','standalone','feature']){
  const checks=(value.checks||[]).filter(row=>row.name===name);
  if(checks.length!==1||checks[0].exitCode!==0||!checks[0].command||!Number.isFinite(Date.parse(checks[0].completedAt)))throw Error('Missing successful, dated release check: '+name);
 }
 return {validationSha256:sha(bytes),checks:value.checks.map(({name,exitCode})=>({name,exitCode}))};
}
export async function capturePreservation(dataDirectory){
 const data=await plainDirectory(dataDirectory),filename=path.join(data,'workspace.sqlite');
 if(!(await fs.lstat(filename)).isFile())throw Error('Existing SQLite database required.');
 const database=new DatabaseSync(filename,{readOnly:true});
 let rows,accountMeta,revision,integrity;
 try{
  database.exec('BEGIN');
  integrity=Object.values(database.prepare('PRAGMA integrity_check').get())[0];
  rows=database.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
  // Deliberately exclude passwords, tokens and sessions, even from hash-only output.
  accountMeta=database.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();
  revision=database.prepare('SELECT id,revision FROM workspace_revision ORDER BY id').all();
  database.exec('COMMIT');
 }finally{database.close();}
 if(integrity!=='ok')throw Error('Database integrity check failed.');
 const files=await hashes(await plainDirectory(path.join(data,'files')));
 // No record IDs, account names or attachment names are written to the checkpoint.
 const recordEntries=rows.map(row=>[sha(row.id),{kind:row.kind,hash:sha(row.data)}]).sort(([a],[b])=>a.localeCompare(b));
 const fileEntries=Object.entries(files).map(([name,hash])=>[sha(name),hash]).sort(([a],[b])=>a.localeCompare(b));
 return {format:'doon-code-preservation-v1',dataDirectory:data,integrity,records:Object.fromEntries(recordEntries),files:Object.fromEntries(fileEntries),accountsHash:sha(JSON.stringify(accountMeta)),accountCount:accountMeta.length,revisionHash:sha(JSON.stringify(revision))};
}
export function comparePreservation(before,after){
 if(before.format!=='doon-code-preservation-v1'||after.format!==before.format||before.dataDirectory!==after.dataDirectory)throw Error('Preservation checkpoint belongs to another data directory.');
 if(!same(before.records,after.records))throw Error('Business records changed, were added or disappeared; never restore an old database automatically.');
 if(!same(before.files,after.files))throw Error('Attachments changed, were added or disappeared.');
 if(before.accountsHash!==after.accountsHash||before.accountCount!==after.accountCount)throw Error('Account metadata changed.');
 if(before.revisionHash!==after.revisionHash)throw Error('Workspace revision changed.');
 return {preserved:true,integrity:after.integrity,recordCount:Object.keys(after.records).length,fileCount:Object.keys(after.files).length,accountCount:after.accountCount};
}
export async function snapshot(dataDirectory,destination){
 const data=await plainDirectory(dataDirectory),target=path.resolve(destination);
 if(target===data||path.relative(data,target).startsWith('..')||path.relative(data,target).split(path.sep)[0]!=='backups')throw Error('Backup destination must be a new directory below the selected data/backups.');
 await plainDirectory(path.dirname(target));
 await fs.mkdir(target,{recursive:false});
 const database=new DatabaseSync(path.join(data,'workspace.sqlite'),{readOnly:true});
 try{await backup(database,path.join(target,'workspace.sqlite'));}finally{database.close();}
 const files=await hashes(await plainDirectory(path.join(data,'files')));
 await fs.cp(path.join(data,'files'),path.join(target,'files'),{recursive:true,errorOnExist:true,force:false});
 const copied=await hashes(path.join(target,'files'));
 for(const [name,hash] of Object.entries(files))if(copied[name]!==hash)throw Error('Backup attachment verification failed.');
 const check=new DatabaseSync(path.join(target,'workspace.sqlite'),{readOnly:true});let integrity,records;
 try{integrity=Object.values(check.prepare('PRAGMA integrity_check').get())[0];records=check.prepare('SELECT COUNT(*) AS n FROM records').get().n;}finally{check.close();}
 if(integrity!=='ok')throw Error('Snapshot integrity failed.');
 const result={format:'doon-code-backup-v1',at:new Date().toISOString(),folder:target,integrity,records,files:Object.keys(copied).length,databaseSha256:sha(await fs.readFile(path.join(target,'workspace.sqlite'))),filesHash:sha(JSON.stringify(copied))};
 await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
}
async function main(){
 const [mode,...args]=process.argv.slice(2);let result;
 if(mode==='stage'&&args.length===2)result=await verifyStage(...args);
 else if(mode==='validation'&&args.length===2)result=await verifyValidation(...args);
 else if(mode==='backup'&&args.length===2)result=await snapshot(...args);
 else if(mode==='before'&&args.length===2){const current=await capturePreservation(args[0]);await fs.writeFile(args[1],JSON.stringify(current),{flag:'wx'});result={checkpoint:args[1],integrity:current.integrity,recordCount:Object.keys(current.records).length,fileCount:Object.keys(current.files).length,accountCount:current.accountCount};}
 else if(mode==='after'&&args.length===2)result=comparePreservation(JSON.parse(await fs.readFile(args[1],'utf8')),await capturePreservation(args[0]));
 else if(mode==='tree'&&args.length===1)result={hash:sha(JSON.stringify(await hashes(await plainDirectory(args[0]))))};
 else throw Error('Usage: stage <stage> <manifest-sha> | validation <receipt> <manifest-sha> | backup <data-dir> <new-backup-dir> | before|after <data-dir> <checkpoint> | tree <code-dir>');
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
