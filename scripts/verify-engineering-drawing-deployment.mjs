// Read-only deployment preservation gate; no password hashes or sessions are selected.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const [mode,checkpoint,flag,...extra]=process.argv.slice(2),unchanged=flag==='--unchanged';
if(!['before','after'].includes(mode)||!checkpoint||flag&&!unchanged||extra.length)throw new Error('Usage: before|after <private checkpoint> [--unchanged]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),root=path.resolve(process.env.DOON_DATA_DIR||'lan-data');
const db=new DatabaseSync(path.join(root,'workspace.sqlite'),{readOnly:true});
let rows,accountMeta,integrity;
try{
 db.exec('BEGIN');rows=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
 accountMeta=db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();
 integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];db.exec('COMMIT');
}finally{db.close();}
if(integrity!=='ok')throw new Error('Database integrity check failed.');
const records=Object.fromEntries(rows.map(row=>[row.id,{kind:row.kind,hash:sha(row.data)}])),files={};
async function visit(folder,prefix=''){
 for(const entry of await fs.readdir(folder,{withFileTypes:true})){
  const name=prefix+entry.name,target=path.join(folder,entry.name);
  if(entry.isSymbolicLink())throw new Error('Symbolic links are not supported in attachment storage.');
  if(entry.isDirectory())await visit(target,name+'/');else if(entry.isFile())files[name]=sha(await fs.readFile(target));else throw new Error('Unexpected attachment storage entry.');
 }
}
await visit(path.join(root,'files'));
const current={at:new Date().toISOString(),records,accountsHash:sha(JSON.stringify(accountMeta)),files};
if(mode==='before')await fs.writeFile(checkpoint,JSON.stringify(current),{flag:'wx'});
else{
 const prior=JSON.parse(await fs.readFile(checkpoint,'utf8'));
 for(const [id,value] of Object.entries(prior.records))if(records[id]?.kind!==value.kind||records[id]?.hash!==value.hash)throw new Error('An existing record changed or disappeared.');
 if(prior.accountsHash!==current.accountsHash)throw new Error('Account identity metadata changed.');
 for(const [name,hash] of Object.entries(prior.files))if(files[name]!==hash)throw new Error('An existing attachment changed or disappeared.');
 const additions=rows.filter(row=>!prior.records[row.id]);
 if(unchanged&&(additions.length||Object.keys(files).length!==Object.keys(prior.files).length))throw new Error('Code-only deployment added records or attachments.');
 const ids=new Set(additions.filter(row=>row.kind==='engineering_drawing').map(row=>row.id));
 for(const row of additions){
  const value=JSON.parse(row.data);
  if(row.kind==='engineering_drawing'){if(value.customerId||value.source?.type!=='excel'||!value.legacyNeedsReview)throw new Error('Only unbound, evidenced legacy drawing rows may be seeded.');}
  else if(row.kind==='engineering_drawing_revision'){if(!ids.has(value.recordId))throw new Error('Unexpected drawing revision target.');}
  else if(row.kind==='audit'){if(!ids.has(value.targetId)||value.after?.kind!=='engineering_drawing')throw new Error('Unexpected audit target.');}
  else throw new Error('Unexpected new record kind.');
 }
}
console.log(JSON.stringify({mode,integrity,preserved:mode==='after',unchanged:mode==='after'&&unchanged,recordCount:rows.length,fileCount:Object.keys(files).length,accountCount:accountMeta.length}));
