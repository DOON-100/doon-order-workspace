// Explicit offline maintenance. No default database and no automatic startup write.
import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{database:{type:'string'},apply:{type:'boolean'},'plan-hash':{type:'string'},'backup-dir':{type:'string'},'restore-source':{type:'string',multiple:true},'restore-username':{type:'string'}}});
if(!values.database||!path.isAbsolute(values.database))throw Error('--database must be an explicit absolute path');
const db=new DatabaseSync(values.database,{readOnly:!values.apply});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function plan(){
 const accounts=db.prepare("SELECT a.username,a.member_id,r.data FROM local_accounts a JOIN records r ON r.id=a.member_id AND r.kind='member'").all();
 const byEmail=new Map();for(const a of accounts){const m=JSON.parse(a.data),key=m.email;if(byEmail.has(key))throw Error('Ambiguous member email');byEmail.set(key,a.username);}
 const sources=values['restore-source']||[],restore=values['restore-username'];
 if(sources.length&&(!restore||!accounts.some(a=>a.username===restore)))throw Error('Restore selection requires an existing login');
 const rows=db.prepare("SELECT id,data FROM records WHERE kind='order' ORDER BY id").all(),changes=[];let restored=0;
 for(const row of rows){const before=JSON.parse(row.data);if(!Object.hasOwn(before,'ownerEmail'))throw Error('Order already migrated or mixed schema: '+row.id);
  if(Object.hasOwn(before,'ownerUsername'))throw Error('Mixed owner fields');
  let username='';if(before.ownerEmail){username=byEmail.get(before.ownerEmail);if(!username)throw Error('Unmapped owner; migration stopped');}
  else if(sources.includes(before.source)){username=restore;restored++;}
  const after={...before,ownerUsername:username};delete after.ownerEmail;
  changes.push({id:row.id,before:row.data,after:JSON.stringify(after)});
 }
 return {changes,restored,hash:hash({accounts:accounts.map(a=>[a.username,a.member_id,JSON.parse(a.data).email]),changes})};
}
try{
 const preview=plan();console.log(JSON.stringify({orders:preview.changes.length,restored:preview.restored,planHash:preview.hash,apply:!!values.apply}));
 if(values.apply){
  if(values['plan-hash']!==preview.hash)throw Error('Plan hash differs; review a fresh preview');
  if(!values['backup-dir']||!path.isAbsolute(values['backup-dir']))throw Error('Explicit absolute --backup-dir required');
  await fs.mkdir(values['backup-dir'],{recursive:true});const target=path.join(values['backup-dir'],'owner-usernames-'+Date.now()+'.sqlite');await backup(db,target);
  db.exec('BEGIN IMMEDIATE');try{
   const current=plan();if(current.hash!==preview.hash)throw Error('Data changed since preview');
   const update=db.prepare("UPDATE records SET data=? WHERE id=? AND data=?");
   for(const row of current.changes)if(update.run(row.after,row.id,row.before).changes!==1)throw Error('Concurrent order update');
   const event={id:'maintenance_owner_usernames_'+Date.now(),kind:'maintenance_event',action:'订单负责人改用账号登录名',createdAt:new Date().toISOString(),orderCount:current.changes.length,restoredCount:current.restored,planHash:current.hash};
   db.prepare('INSERT INTO records VALUES(?,?,?)').run(event.id,event.kind,JSON.stringify(event));db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
   db.exec('COMMIT');console.log(JSON.stringify({migrated:current.changes.length,restored:current.restored,backup:target,eventId:event.id}));
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
}finally{db.close();}
