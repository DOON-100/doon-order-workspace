import {mkdtemp, writeFile, readFile, realpath, rm, lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const markerName = 'synthetic-sandbox.json';
const marker = {application:'doon-mastra-p1', format:1, syntheticOnly:true};
const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
export function assertIsolatedEnvironment() {
  for (const name of ['DOON_DATA_DIR','DOON_SERVER_MODE','DOON_EMPLOYEE_PUBLIC_ORIGIN','DOON_TLS_KEY']) {
    if (process.env[name]) throw new Error(`实验拒绝业务运行配置：${name}`);
  }
}
export async function createSandbox() {
  assertIsolatedEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(),'doon-mastra-p1-'));
  await writeFile(path.join(directory,markerName),JSON.stringify(marker),'utf8');
  const db = new DatabaseSync(path.join(directory,'suggestions.sqlite'));
  try { db.exec('CREATE TABLE suggestions (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, payload TEXT NOT NULL);'); }
  finally { db.close(); }
  return directory;
}
export async function validateSandbox(directory) {
  assertIsolatedEnvironment();
  const absolute = path.resolve(directory), temp = await realpath(os.tmpdir());
  if (!samePath(path.dirname(absolute),temp) || !/^doon-mastra-p1-[a-zA-Z0-9]+$/.test(path.basename(absolute))) {
    throw new Error('只接受本实验新建的系统临时目录');
  }
  const directoryStat=await lstat(absolute);
  if (!samePath(await realpath(absolute),absolute) || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('拒绝重定向的实验目录');
  for(const name of [markerName,'suggestions.sqlite','suggestions.sqlite-journal','suggestions.sqlite-wal','suggestions.sqlite-shm']) {
    const file=path.join(absolute,name);let stat;
    try {stat=await lstat(file);}catch(error){if(error.code==='ENOENT'&&name!==markerName&&name!=='suggestions.sqlite')continue;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!samePath(await realpath(file),file))throw new Error('拒绝链接或非普通的实验文件');
  }
  const saved = JSON.parse(await readFile(path.join(absolute,markerName),'utf8'));
  if (JSON.stringify(saved)!==JSON.stringify(marker)) throw new Error('实验目录标识不匹配');
  return absolute;
}
export async function openSuggestionStore(directory,{readOnly=true}={}) {
  const root = await validateSandbox(directory);
  const db = new DatabaseSync(path.join(root,'suggestions.sqlite'),{readOnly});
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  if (tables.length!==1 || tables[0].name!=='suggestions') {db.close();throw new Error('只允许独立合成建议数据库');}
  function add(item) {
      if (readOnly) throw new Error('当前建议库为只读');
      const payload=JSON.stringify(item), previous=db.prepare('SELECT payload FROM suggestions WHERE id=?').get(item.id);
      if (previous) {
        // Run metadata may differ during a retry; the reviewed business content must not.
        const {runId:_a,createdAt:_b,...before}=JSON.parse(previous.payload),{runId:_c,createdAt:_d,...after}=item;
        if (JSON.stringify(before)!==JSON.stringify(after)) throw new Error('建议标识冲突');
        return false;
      }
      db.prepare('INSERT INTO suggestions (id,actor_id,payload) VALUES (?,?,?)').run(item.id,item.actorId,payload);
      return true;
  }
  return {
    list(actorId) {return db.prepare('SELECT payload FROM suggestions WHERE actor_id=? ORDER BY id').all(actorId).map(row=>JSON.parse(row.payload));},
    count() {return db.prepare('SELECT count(*) AS count FROM suggestions').get().count;},
    add,
    addBatch(items) {
      if(readOnly)throw new Error('当前建议库为只读');
      if(!Array.isArray(items)||items.length>50)throw new Error('建议批次无效');
      db.exec('BEGIN IMMEDIATE');
      try {const results=items.map(add);db.exec('COMMIT');return results;}
      catch(error){db.exec('ROLLBACK');throw error;}
    },
    close() {db.close();},
  };
}
export async function sandboxDigest(directory) {
  const root=await validateSandbox(directory);
  return createHash('sha256').update(await readFile(path.join(root,'suggestions.sqlite'))).digest('hex');
}
export async function removeSandbox(directory) {
  const root=await validateSandbox(directory);
  await rm(root,{recursive:true,force:true});
}
