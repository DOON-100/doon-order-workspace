import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import type {Entity,State,Member} from './domain';
import {newId,now,email,all} from './domain';
export class AppError extends Error{constructor(message:string,public status=400){super(message);}}
export function database(){if(!env.DB)throw new AppError('共享数据库暂不可用，请稍后重试。',503);return env.DB;}
export function bucket(){if(!env.BUCKET)throw new AppError('文件存储暂不可用，请稍后重试。',503);return env.BUCKET;}
export async function snapshot():Promise<State>{
 const db=database();await db.prepare("INSERT OR IGNORE INTO workspace_revision (id,revision) VALUES ('main',0)").run();
 for(let retry=0;retry<3;retry++){
  const start=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  const result=await db.prepare('SELECT data FROM records ORDER BY rowid').all<{data:string}>();
  const end=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  if(start!.revision===end!.revision)return {revision:start!.revision,records:result.results.map(r=>JSON.parse(r.data))};
 }
 throw new AppError('其他成员正在更新，请刷新后重试。',409);
}
export async function commit(revision:number,records:Entity[]){
 const db=database(),guard=newId('txn');
 const statements=[db.prepare("INSERT INTO transaction_guards (id,valid) VALUES (?,CASE WHEN (SELECT revision FROM workspace_revision WHERE id='main')=? THEN 1 ELSE 0 END)").bind(guard,revision),
 ...records.map(r=>db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').bind(r.id,r.kind,JSON.stringify(r))),
 db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'"),db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard)];
 try{await db.batch(statements);}catch(e){if(String(e).includes('revision_must_match'))throw new AppError('数据刚被其他成员更新，本次未写入。请刷新并重新核对。',409);throw e;}
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
