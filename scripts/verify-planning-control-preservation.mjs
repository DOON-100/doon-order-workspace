// Private hash-only checkpoints. Never import application runtime or select credentials.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const fail=message=>{throw new Error(message);};
export async function regularDirectory(directory){
 const resolved=path.resolve(directory),stat=await fs.lstat(resolved);
 if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await fs.realpath(resolved)).toLowerCase()!==resolved.toLowerCase())fail('Directory must be a real local directory, without redirected ancestors.');
 return resolved;
}
export async function privateOutput(filename,prefix){
 const base=await regularDirectory(path.resolve('test-output')),target=path.resolve(filename||'');
 if(path.dirname(target)!==base||!path.basename(target).startsWith(prefix))fail('Private output must use the expected name directly inside test-output.');
 return target;
}
export async function attachmentEntries(directory,relative=''){
 await regularDirectory(directory);
 const result=[];
 for(const entry of (await fs.readdir(path.join(directory,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const name=path.join(relative,entry.name),absolute=path.join(directory,name);
  if(entry.isSymbolicLink())fail('Attachment links are not permitted.');
  if(entry.isDirectory())result.push(...await attachmentEntries(directory,name));
  else if(entry.isFile())result.push({name,hash:sha(await fs.readFile(absolute))});
  else fail('Unexpected attachment filesystem entry.');
 }
 return result;
}
export function openReadSnapshot(directory){
 const db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{readOnly:true});
 try{db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');return db;}catch(error){db.close();throw error;}
}
export function closeReadSnapshot(db){try{db.exec('ROLLBACK');}finally{db.close();}}
export async function fingerprint(directory,connection){
 await regularDirectory(directory);
 const db=connection||openReadSnapshot(directory);
 try{
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')fail('Database integrity check failed.');
  // CAST AS BLOB hashes the stored JSON bytes, without parsing or normalizing them.
  const rows=db.prepare('SELECT id,kind,CAST(data AS BLOB) raw FROM records ORDER BY id').all();
  const accounts=db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
  const revision=db.prepare('SELECT id,revision FROM workspace_revision ORDER BY id').all();
  if(!revision.some(row=>row.id==='main'))fail('Workspace revision is missing.');
  const entries=await attachmentEntries(path.join(directory,'files'));
  return {format:'planning-control-preservation-v1',
   records:Object.fromEntries(rows.map(row=>[sha(row.id),{kindHash:sha(row.kind),dataHash:sha(row.raw)}])),
   accountsHash:digest(accounts),accountCount:accounts.length,schemaHash:digest(schema),revisionHash:digest(revision),
   files:Object.fromEntries(entries.map(entry=>[sha(entry.name.replaceAll('\\','/')),entry.hash]))};
 }finally{if(!connection)closeReadSnapshot(db);}
}
export function sameFingerprint(before,after){
 if(before.format!=='planning-control-preservation-v1'||after.format!==before.format)fail('Unsupported preservation checkpoint.');
 for(const key of ['records','accountsHash','accountCount','schemaHash','revisionHash','files'])if(digest(before[key])!==digest(after[key]))fail('Protected '+key+' changed; preserve current data and investigate.');
}
export function summary(value){return {recordCount:Object.keys(value.records).length,accountCount:value.accountCount,fileCount:Object.keys(value.files).length,fingerprintSha256:digest(value),schemaHash:value.schemaHash,revisionHash:value.revisionHash};}

async function main(){
 const [mode,filename,...extra]=process.argv.slice(2);
 if(!['before','after'].includes(mode)||!filename||extra.length)fail('Usage: before|after <test-output/planning-control-preservation-*.json>');
 const target=await privateOutput(filename,'planning-control-preservation-');
 const current=await fingerprint(await regularDirectory(path.resolve('lan-data')));
 if(mode==='before')await fs.writeFile(target,JSON.stringify({at:new Date().toISOString(),fingerprint:current}),{flag:'wx',mode:0o600});
 else sameFingerprint(JSON.parse(await fs.readFile(target,'utf8')).fingerprint,current);
 console.log(JSON.stringify({mode,integrity:'ok',unchanged:mode==='after',...summary(current)}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Preservation verification failed. No production data was changed; inspect the private checkpoint and current state.');process.exitCode=1;});
