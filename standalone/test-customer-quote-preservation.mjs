// Synthetic, isolated coverage of the read-only deployment preservation gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const repo=process.cwd(),root=await fs.mkdtemp(path.resolve('test-output/quote-preservation-'));
const data=path.join(root,'lan-data'),files=path.join(data,'files'),checkpoint=path.join(root,'checkpoint.json');
await fs.mkdir(files,{recursive:true});
const db=new DatabaseSync(path.join(data,'workspace.sqlite'));
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT);CREATE TABLE local_accounts(id TEXT,username TEXT,member_id TEXT,must_change INTEGER,created_at TEXT)');
const original=JSON.stringify({id:'synthetic-order',kind:'order',quantity:25});
db.prepare('INSERT INTO records VALUES(?,?,?)').run('synthetic-order','order',original);
db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?)').run('synthetic-account','synthetic-login','synthetic-member',0,'2026-01-01');
await fs.writeFile(path.join(files,'synthetic-source'),'Synthetic immutable bytes');
const run=(mode,strict=false,success=true)=>{
 const result=spawnSync(process.execPath,[path.join(repo,'scripts/verify-customer-quote-deployment.mjs'),mode,checkpoint,...(strict?['--unchanged']:[])],{cwd:root,encoding:'utf8',windowsHide:true});
 assert.equal(result.status===0,success,result.stderr||result.stdout);
 return success?JSON.parse(result.stdout.trim()):null;
};
try {
 run('before');assert.equal(run('after',true).unchanged,true);
 db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({id:'synthetic-order',kind:'order',quantity:26}),'synthetic-order');
 run('after',true,false);db.prepare('UPDATE records SET data=? WHERE id=?').run(original,'synthetic-order');
 console.log('PASS Code-only gate allows unchanged records and rejects any historical record mutation.');
 await fs.writeFile(path.join(files,'synthetic-source'),'Changed synthetic bytes');run('after',true,false);
 await fs.writeFile(path.join(files,'synthetic-source'),'Synthetic immutable bytes');
 db.prepare('UPDATE local_accounts SET must_change=1').run();run('after',true,false);db.prepare('UPDATE local_accounts SET must_change=0').run();
 console.log('PASS Attachment and account metadata mutations are rejected.');
 const draft={id:'synthetic-draft',kind:'customer_quote',status:'draft',customerAccountId:null};
 db.prepare('INSERT INTO records VALUES(?,?,?)').run(draft.id,draft.kind,JSON.stringify(draft));
 assert.equal(run('after').preserved,true);run('after',true,false);
 db.prepare('DELETE FROM records WHERE id=?').run(draft.id);
 console.log('PASS Normal seed verification permits an unbound draft but code-only verification rejects it.');
 await fs.writeFile(path.join(files,'synthetic-added'),'New synthetic attachment');run('after',true,false);
 console.log('PASS Code-only verification rejects new attachments as well.');
 console.log(JSON.stringify({passed:4,root}));
} finally {db.close();}
