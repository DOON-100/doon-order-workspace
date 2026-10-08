// Default is a read-only preview. No passwords, sessions, or account tables are read.
import {DatabaseSync,backup} from 'node:sqlite';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options=new Map(),supported=new Set(['--backup','--mapping','--actor-id','--apply','--plan-hash']);
for(let index=0;index<args.length;index++){
 const flag=args[index];if(!supported.has(flag)||options.has(flag))throw new Error('存在未知或重复的迁入参数。');
 if(flag==='--apply'){options.set(flag,true);continue;}
 const argument=args[++index];if(!argument||argument.startsWith('--'))throw new Error(`${flag} 缺少参数值。`);options.set(flag,argument);
}
const value=flag=>options.get(flag);
if(!value('--backup')||!value('--mapping')||!value('--actor-id'))throw new Error('需要 --backup、--mapping、--actor-id；默认只预览。实际增量写入还需 --apply --plan-hash。');
const dataDir=path.resolve(process.env.DOON_DATA_DIR||path.join(root,'lan-data'));
const backupBytes=await fs.readFile(path.resolve(value('--backup')));
if(backupBytes.length>10*1024*1024)throw new Error('备份超过 10 MB，需另行核对。');
const source=JSON.parse(backupBytes.toString('utf8').replace(/^\uFEFF/,''));
const mappingBytes=await fs.readFile(path.resolve(value('--mapping')));
if(mappingBytes.length>1024*1024)throw new Error('客户映射超过 1 MB，需另行核对。');
const mapping=JSON.parse(mappingBytes.toString('utf8').replace(/^\uFEFF/,''));
await fs.mkdir(path.join(root,'test-output'),{recursive:true});
const tmp=await fs.mkdtemp(path.join(root,'test-output','ivy-import-check-'));
const bundle=path.join(tmp,'adapter.mjs');
await build({entryPoints:[path.join(root,'lib/service-ivy-import.ts')],outfile:bundle,bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':root},logLevel:'silent'});
const {prepareIvyMigration}=await import(pathToFileURL(bundle).href);
const apply=options.has('--apply');
if(apply&&!/^[a-f0-9]{64}$/.test(value('--plan-hash')||''))throw new Error('实际写入必须提供已核对的 --plan-hash。');
const databasePath=path.join(dataDir,'workspace.sqlite');
if(!(await fs.stat(databasePath)).isFile())throw new Error('指定数据库不存在或不是文件；不会创建新的业务数据库。');
const db=new DatabaseSync(databasePath,{readOnly:!apply});
db.exec('PRAGMA busy_timeout=5000');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function storageInventory(directory){
 const result=new Map();
 async function visit(folder,prefix=''){
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
   const relative=prefix+entry.name,target=path.join(folder,entry.name);
   if(entry.isSymbolicLink())throw new Error('附件目录含符号链接，停止备份以免遗漏真实文件。');
   if(entry.isDirectory())await visit(target,relative+'/');
   else if(entry.isFile())result.set(relative,sha(await fs.readFile(target)));
   else throw new Error('附件目录存在无法验证的文件类型。');
  }
 }
 await visit(directory);return result;
}
function storedKeys(records){
 const result=new Set();
 function visit(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
   if(['fileKey','sourceFileKey','rowsKey'].includes(key)&&typeof item==='string'&&item)result.add(item);
   else if(item&&typeof item==='object')visit(item);
  }
 }
 records.forEach(visit);return result;
}
try{
 let rawRows,revision;
 db.exec('BEGIN');
 try{
  rawRows=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
  revision=db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision;
  if(!Number.isSafeInteger(revision))throw new Error('工作空间版本信息缺失，停止迁入。');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const state={revision,records:rawRows.map(row=>JSON.parse(row.data))};
 const actor=state.records.find(row=>row.id===value('--actor-id')&&row.kind==='member');
 if(!actor)throw new Error('未找到指定管理员成员。');
 const plan=await prepareIvyMigration(state,source,mapping,actor);
 if(!apply){console.log(JSON.stringify({mode:'preview',expectedRevision:plan.expectedRevision,planHash:plan.planHash,counts:plan.counts},null,2));}
 else{
  if(plan.planHash!==value('--plan-hash'))throw new Error('迁入预览已经变化；本次未写入，请重新核对预览。');
  if(!plan.additions.length){console.log(JSON.stringify({mode:'no-op',counts:plan.counts}));}
  else{
   await fs.mkdir(path.join(dataDir,'backups'),{recursive:true});
   const saved=await fs.mkdtemp(path.join(dataDir,'backups','before-ivy-service-'));
   await backup(db,path.join(saved,'workspace.sqlite'));
   const check=new DatabaseSync(path.join(saved,'workspace.sqlite'),{readOnly:true});
   try{
    if(Object.values(check.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw new Error('迁入前备份完整性检查失败。');
    if(check.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision!==plan.expectedRevision||JSON.stringify(check.prepare('SELECT id,kind,data FROM records ORDER BY id').all())!==JSON.stringify(rawRows))throw new Error('备份时数据已经变化，请重新预览；未写入业务数据。');
   }finally{check.close();}
   const sourceFiles=path.join(dataDir,'files'),inventory=await storageInventory(sourceFiles);
   for(const key of storedKeys(state.records))if(!inventory.has(sha(String(key))))throw new Error('历史记录引用的附件缺失，停止迁入；请先核对存储。');
   await fs.cp(sourceFiles,path.join(saved,'files'),{recursive:true,errorOnExist:true,force:false});
   const copied=await storageInventory(path.join(saved,'files'));
   for(const [filename,hash] of inventory)if(copied.get(filename)!==hash)throw new Error('迁入前附件备份校验失败。');
   // Save the bytes actually reviewed, not a second read of files that might
   // have changed after preview. Configuration is private and stays in backups.
   await fs.writeFile(path.join(saved,'ivy-source-original.json'),backupBytes,{flag:'wx'});
   await fs.writeFile(path.join(saved,'ivy-mapping-original.json'),mappingBytes,{flag:'wx'});
   const prepared={mode:'prepared',planHash:plan.planHash,expectedRevision:plan.expectedRevision,sourceSha256:sha(backupBytes),mappingSha256:sha(mappingBytes),preservedRecords:rawRows.length,verifiedFiles:inventory.size,at:new Date().toISOString()};
   await fs.writeFile(path.join(saved,'import-prepared.json'),JSON.stringify(prepared,null,2),{flag:'wx'});
   db.exec('BEGIN IMMEDIATE');
   try{
    if(db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision!==plan.expectedRevision)throw new Error('其他同事刚更新了数据；迁入取消，请重新预览。');
    if(db.prepare('SELECT COUNT(*) AS n FROM records').get().n!==rawRows.length)throw new Error('历史记录数量发生变化，迁入取消，请重新预览。');
    const insert=db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?)');
    for(const item of plan.additions)insert.run(item.id,item.kind,JSON.stringify(item));
    for(const before of rawRows){const after=db.prepare('SELECT kind,data FROM records WHERE id=?').get(before.id);if(!after||after.kind!==before.kind||after.data!==before.data)throw new Error('历史数据保留校验失败，回滚本次新增。');}
    db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const result={...prepared,mode:'applied',counts:plan.counts,backupFolder:saved,at:new Date().toISOString()};
   try{await fs.writeFile(path.join(saved,'import-manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});}
   catch{result.warning='业务迁入已提交，但完成清单未能写入；迁入前备份和准备清单仍保留，请核对，不要重复强行迁入。';}
   console.log(JSON.stringify(result,null,2));
  }
 }
}finally{db.close();}
