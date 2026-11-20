import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const base=path.resolve('test-output'),dir=await fs.mkdtemp(path.join(base,'owner-migration-')),file=path.join(dir,'workspace.sqlite'),db=new DatabaseSync(file);
try{
 db.exec("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT);CREATE TABLE local_accounts(member_id TEXT,username TEXT);CREATE TABLE workspace_revision(id TEXT,revision INTEGER);INSERT INTO workspace_revision VALUES('main',7)");
 const member={id:'m',kind:'member',email:'different@example.invalid'};db.prepare('INSERT INTO records VALUES(?,?,?)').run('m','member',JSON.stringify(member));db.prepare('INSERT INTO local_accounts VALUES(?,?)').run('m','sample_login');
 const orders=[{id:'a',kind:'order',version:4,ownerEmail:member.email,quantity:9,notes:'preserve',ledger:{ownerName:'Original',columns:{BF:'3'}}},{id:'b',kind:'order',version:6,ownerEmail:'',source:'synthetic-restore.xlsx',quantity:3}];
 for(const o of orders)db.prepare('INSERT INTO records VALUES(?,?,?)').run(o.id,o.kind,JSON.stringify(o));
 const audit=JSON.stringify({id:'audit',kind:'audit',before:orders[0]});db.prepare('INSERT INTO records VALUES(?,?,?)').run('audit','audit',audit);
 const args=['standalone/migrate-order-owner-usernames.mjs','--database',file,'--restore-source','synthetic-restore.xlsx','--restore-username','sample_login'];
 const run=extra=>execFileSync(process.execPath,[...args,...extra],{encoding:'utf8',windowsHide:true,stdio:'pipe'}),preview=JSON.parse(run([]).trim());assert.equal(preview.orders,2);assert.equal(preview.restored,1);
 assert.throws(()=>run(['--apply','--plan-hash','stale','--backup-dir',path.join(dir,'backups')]));assert.equal(JSON.parse(db.prepare("SELECT data FROM records WHERE id='a'").get().data).ownerEmail,member.email);
 run(['--apply','--plan-hash',preview.planHash,'--backup-dir',path.join(dir,'backups')]);
 for(const before of orders){const after=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(before.id).data);assert.equal(after.ownerUsername,'sample_login');delete after.ownerUsername;const expected={...before};delete expected.ownerEmail;assert.deepEqual(after,expected);}
 assert.equal(db.prepare("SELECT data FROM records WHERE id='audit'").get().data,audit);assert.equal(db.prepare("SELECT data FROM records WHERE id='m'").get().data,JSON.stringify(member));assert.equal(db.prepare('SELECT revision FROM workspace_revision').get().revision,8);
 assert.equal((await fs.readdir(path.join(dir,'backups'))).length,1);console.log('PASS owner migration: account directory, empty-source restore, stale-plan refusal, online backup, original orders and audits preserved');
}finally{db.close();assert.equal(path.dirname(dir),base);assert(path.basename(dir).startsWith('owner-migration-'));await fs.rm(dir,{recursive:true,force:true});}
