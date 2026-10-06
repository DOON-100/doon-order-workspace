// Deployment safety gate: every pre-deployment record and local account must survive unchanged.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const [beforePath,afterPath='lan-data/workspace.sqlite']=process.argv.slice(2);
if(!beforePath||!fs.existsSync(beforePath)||!fs.existsSync(afterPath))throw new Error('请提供部署前备份数据库和部署后数据库。');
const load=file=>{const db=new DatabaseSync(file,{readOnly:true}),records=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),accounts=db.prepare('SELECT id,username,member_id,password_hash,must_change,created_at FROM local_accounts ORDER BY id').all(),integrity=db.prepare('PRAGMA quick_check').get();db.close();return {records,accounts,integrity:Object.values(integrity)[0]};};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),before=load(beforePath),after=load(afterPath),afterMap=new Map(after.records.map(r=>[r.id,r])),missing=before.records.filter(r=>!afterMap.has(r.id)),changed=before.records.filter(r=>afterMap.has(r.id)&&digest(r)!==digest(afterMap.get(r.id)));
if(before.integrity!=='ok'||after.integrity!=='ok')throw new Error('数据库完整性检查失败。');
if(missing.length||changed.length)throw new Error(`历史数据保护失败：缺失 ${missing.length} 条，被改写 ${changed.length} 条。`);
if(digest(before.accounts)!==digest(after.accounts))throw new Error('历史账号数据被改写。');
console.log(JSON.stringify({ok:true,preserved:before.records.length,added:after.records.length-before.records.length,accounts:after.accounts.length,integrity:'ok'}));
