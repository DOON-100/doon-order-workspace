import {DatabaseSync, backup} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';

export const dataDir=path.resolve(process.env.DOON_DATA_DIR||'lan-data');
mkdirSync(dataDir,{recursive:true});
export const db=new DatabaseSync(path.join(dataDir,'workspace.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind);
CREATE TABLE IF NOT EXISTS workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS transaction_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL,CONSTRAINT revision_must_match CHECK(valid=1));
INSERT OR IGNORE INTO workspace_revision VALUES('main',0);
CREATE TABLE IF NOT EXISTS local_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,member_id TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,until_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS local_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);

export const context=new AsyncLocalStorage();
// Identity is established by the local password/session handler, never by request headers.
export async function getChatGPTUser(){return context.getStore()?.identity||null;}
class Statement {
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
 async run(){return db.prepare(this.sql).run(...this.args);}
}
export function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
export function records(){return db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data));}
export function saveRecords(items){for(const item of items)db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(item.id,item.kind,JSON.stringify(item));db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();}
export function memberFor(account){const row=account&&db.prepare("SELECT data FROM records WHERE id=? AND kind='member'").get(account.member_id);return row?JSON.parse(row.data):null;}
export function auditLocal(member,action,target){return {id:'audit_'+randomUUID(),kind:'audit',actorId:member.id,actor:member.name,action,targetId:target,source:'内网账号管理',createdAt:new Date().toISOString()};}
const objectDir=path.join(dataDir,'files');mkdirSync(objectDir,{recursive:true});
function objectPath(key){return path.join(objectDir,createHash('sha256').update(String(key)).digest('hex'));}
export const env={DB:{prepare:sql=>new Statement(sql),batch:async statements=>transaction(()=>statements.map(s=>db.prepare(s.sql).run(...s.args)))},BUCKET:{
 async put(key,value){const target=objectPath(key),temp=target+'.'+randomUUID()+'.tmp';const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);await fs.writeFile(temp,bytes);await fs.rename(temp,target);},
 async get(key){try{const body=await fs.readFile(objectPath(key));return {body,json:async()=>JSON.parse(body.toString())};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
}};
export async function makeBackup(){
 const target=path.join(dataDir,'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,6));await fs.mkdir(target,{recursive:true});
 await backup(db,path.join(target,'workspace.sqlite'));
 // Objects are immutable after insertion. Copy after the DB snapshot to include referenced files.
 await fs.cp(objectDir,path.join(target,'files'),{recursive:true});
 const check=new DatabaseSync(path.join(target,'workspace.sqlite'),{readOnly:true});
 const ok=check.prepare('PRAGMA integrity_check').get();check.close();
 if(Object.values(ok)[0]!=='ok')throw new Error('备份完整性检查失败');
 const metadata={at:new Date().toISOString(),folder:target,integrity:'ok',records:records().length};
 await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(metadata,null,2));
 db.prepare("INSERT INTO local_meta VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(metadata));
 return metadata;
}
