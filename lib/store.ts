import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import type {Entity,State,Member} from './domain';
import {newId,now,email,all} from './domain';
export class AppError extends Error{constructor(message:string,public status=400){super(message);}}
export function database(){if(!env.DB)throw new AppError('共享数据库暂不可用，请稍后重试。',503);return env.DB;}
export function bucket(){if(!env.BUCKET)throw new AppError('文件存储暂不可用，请稍后重试。',503);return env.BUCKET;}
// Snapshot cache (plan C). Every write path bumps the single 'main' revision, so a
// cached read stays valid only while its revision matches the database. commit()
// updates the cache in place to avoid a full re-read after a local write; any
// external writer (saveRecords, D1 peers) simply invalidates it via the revision
// guard. Frozen records keep callers from mutating the shared copy.
let cache:{revision:number;records:readonly Entity[]}|null=null;
// Records are shared between requests, including nested arrays and objects.
// Skip already frozen subtrees when a commit reuses unchanged cache entries.
const freezeEntities=(rows:Entity[]):readonly Entity[]=>{
 const freeze=(value:unknown):void=>{
  if(!value||typeof value!=='object'||Object.isFrozen(value))return;
  for(const child of Object.values(value))freeze(child);
  Object.freeze(value);
 };
 for(const row of rows)freeze(row);
 return Object.freeze(rows);
};
export function invalidateSnapshotCache(){cache=null;}
export function snapshotCacheStats(){return cache?{revision:cache.revision,records:cache.records.length}:null;}
// Validate speculative browser reads against the current membership and revision
// without reading orders, archives, attachments or historical snapshots.
export async function readVersion(){
 const db=database();
 for(let retry=0;retry<3;retry++){
  const start=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  const members=await db.prepare("SELECT data FROM records WHERE kind='member'").all<{data:string}>();
  await actor({revision:start?.revision||0,records:members.results.map(row=>JSON.parse(row.data))});
  const end=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  if(start?.revision===end?.revision)return {revision:end?.revision||0};
 }
 throw new AppError('其他成员正在更新，请刷新后重试。',409);
}
export async function snapshot(kinds?:readonly string[]):Promise<State>{
 const db=database();await db.prepare("INSERT OR IGNORE INTO workspace_revision (id,revision) VALUES ('main',0)").run();
 // The cache only serves the native standalone reader, whose whole-database read
 // is the dominant cost (the audit trail alone is most of the DB). The D1 path and
 // test harnesses have no readSnapshot and keep their original always-fresh reads.
 const native=db as typeof db&{readSnapshot?:(kinds?:readonly string[])=>Promise<Entity[]>};
 for(let retry=0;retry<3;retry++){
  const start=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  // Cache hit: the single revision read above is the only database round-trip.
  // Frozen cached rows are filtered by kind without copying.
  if(native.readSnapshot&&cache&&cache.revision===start!.revision){
   const records=kinds?(kinds.length?cache.records.filter(r=>kinds.includes(r.kind)):[]):cache.records.slice();
   return {revision:start!.revision,records};
  }
  // Native SQLite yields between bounded batches, including JSON parsing. D1
  // keeps its existing read path. Revision guards cover the complete read in both.
  let records:Entity[];
  if(native.readSnapshot)records=await native.readSnapshot(kinds);
  else{
   const sql='SELECT data FROM records'+(kinds?(kinds.length?' WHERE kind IN ('+kinds.map(()=>'?').join(',')+')':' WHERE 0'):'')+' ORDER BY rowid';
   const statement=db.prepare(sql),result=await (kinds?.length?statement.bind(...kinds):statement).all<{data:string}>();
   records=result.results.map(r=>JSON.parse(r.data));
  }
  const end=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  if(start!.revision===end!.revision){
   if(native.readSnapshot&&!kinds)cache={revision:start!.revision,records:freezeEntities(records)};
   return {revision:start!.revision,records};
  }
 }
 throw new AppError('其他成员正在更新，请刷新后重试。',409);
}
export async function commit(revision:number,records:Entity[]){
 const db=database(),guard=newId('txn');
 const statements=[db.prepare("INSERT INTO transaction_guards (id,valid) VALUES (?,CASE WHEN (SELECT revision FROM workspace_revision WHERE id='main')=? THEN 1 ELSE 0 END)").bind(guard,revision),
 ...records.map(r=>db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').bind(r.id,r.kind,JSON.stringify(r))),
 db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'"),db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard)];
 try{await db.batch(statements);}catch(e){if(String(e).includes('revision_must_match'))throw new AppError('数据刚被其他成员更新，本次未写入。请刷新并重新核对。',409);throw e;}
 // Keep the cache warm on the writer's own process: fold the committed rows into
 // the frozen snapshot at the next revision. On a mismatch we just drop the cache.
 if(cache&&cache.revision===revision){
  const byId=new Map(cache.records.map(r=>[r.id,r]));
  // A JSON round-trip reproduces the exact persistence semantics of the SQLite
  // write (undefined keys are dropped), so the cache mirrors what a re-read would
  // return. Otherwise in-memory entities with explicit `undefined` fields would
  // diverge from the stored record and change `hasOwnProperty`-based logic.
  for(const r of records)byId.set(r.id,JSON.parse(JSON.stringify(r)));
  cache={revision:revision+1,records:freezeEntities([...byId.values()])};
 }
}
export async function actor(s:State):Promise<Member>{
 const user=await getChatGPTUser();if(!user)throw new AppError('请先登录工作空间。',401);
 const member=all(s,'member').find(m=>m.userId===user.userId) as Member|undefined;
 if(member){if(!member.active)throw new AppError('账号已停用，请联系管理员。',403);return member;}
 throw new AppError('尚未加入工作空间，请由管理员添加成员。',403);
}
export async function enroll(s:State){
 const user=await getChatGPTUser();if(!user)throw new AppError('请先登录。',401);
 const members=all(s,'member') as Member[];
 const existing=members.find(m=>m.userId===user.userId);
 if(existing?.role==='supplier')throw new AppError('供应商请使用专用填报工作台。',403);
 if(existing)return;
 const invited=members.find(m=>m.email===email(user.email)&&!m.userId&&m.active&&m.role!=='supplier');
 // The site is provisioned owner-private. Only that owner can perform initial enrollment.
 if(members.length&&!invited)throw new AppError('你的账号尚未获授权，请联系工作空间管理员。',403);
 const m:Member=invited?{...invited,userId:user.userId}:{id:newId('member'),kind:'member',email:email(user.email),name:user.displayName,role:'admin',customers:[],active:true,owner:true,userId:user.userId,createdAt:now()};
 await commit(s.revision,[m]);
}
export function audit(m:Member,target:Entity,before:unknown,action:string,source='网页',after:unknown=target):Entity{return {id:newId('audit'),kind:'audit',lineId:target.kind==='order'?target.id:target.lineId||'',targetId:target.id,action,actorId:m.id,actor:m.name,source,before,after,createdAt:now()};}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});}
export function failure(e:unknown){if(e instanceof AppError)return json({error:e.message},e.status);console.error('Workspace operation failed',e instanceof Error?e.message:String(e));return json({error:'操作未完成，请稍后重试；你的输入仍保留在页面。'},500);}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new AppError('不允许跨站提交。',403);}
