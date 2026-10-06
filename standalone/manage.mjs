import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {db,dataDir,records,context,makeBackup,memberFor} from './runtime.mjs';
import {createAccount} from './auth.mjs';
import * as api from './workspace-api.mjs';
const command=process.argv[2];
if(command==='init'){
 if(db.prepare('SELECT COUNT(*) AS n FROM local_accounts').get().n)throw new Error('已初始化，不重复创建管理员。');
 const password=randomBytes(18).toString('base64url');
 await createAccount({username:'admin',name:'度昂管理员',role:'admin',password},null,{owner:true});
 await fs.writeFile(path.join(dataDir,'管理员首次登录.txt'),`度昂订单协作中台 · 内网版\n\n本机入口：http://127.0.0.1:8787\n账号：admin\n初始密码：${password}\n\n首次登录必须修改密码。此文件不要发给文员。\n员工账号由管理员在“成员与权限”中创建。\n`,{mode:0o600});
 console.log('管理员已创建。初始凭据保存在 lan-data/管理员首次登录.txt；首次登录必须修改。');
}else if(command==='import'){
 const source=process.argv[3];if(!source)throw new Error('需要原始工作簿路径。');
 const account=db.prepare('SELECT * FROM local_accounts ORDER BY created_at LIMIT 1').get(),member=memberFor(account);if(!member?.owner)throw new Error('先初始化管理员。');
 const current={identity:{userId:member.userId,email:member.email,displayName:member.name,fullName:member.name}};
 const call=async(action,body)=>{const req=new Request('http://localhost:8787/api/workspace/'+action,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});const response=await context.run(current,()=>api.POST(req,{params:Promise.resolve({action})}));const result=await response.json();if(!response.ok)throw new Error(result.error);return result;};
 const form=new FormData();form.set('file',new File([await fs.readFile(source)],path.basename(source)));form.set('mode','active');
 let job=await call('ledger-preview',form);while(job.status!=='已完成'){job=await call('ledger-commit',{id:job.id,offset:job.offset});console.log(`已导入 ${job.offset}/${job.total}`);}
 const all=records().filter(r=>r.kind==='order'&&r.ledger?.sourceHash===job.hash);console.log(JSON.stringify({rows:all.length,orders:new Set(all.map(o=>o.orderNo)).size,quantity:all.reduce((n,o)=>n+o.quantity,0),hash:job.hash,source:job.filename,backup:await makeBackup()}));
}else if(command==='set-scope'){
 const usernames=(process.argv[3]||'').split(',').filter(Boolean),scope=process.argv[4];
 if(!usernames.length||!['all','assigned'].includes(scope))throw new Error('用法：set-scope <账号,账号> <all|assigned>');
 const owner=db.prepare("SELECT a.* FROM local_accounts a JOIN records r ON r.id=a.member_id WHERE json_extract(r.data,'$.owner')=1").get(),admin=memberFor(owner);
 if(!admin?.active||admin.role!=='admin')throw new Error('需要有效的初始管理员。');
 const targets=usernames.map(username=>{const a=db.prepare('SELECT * FROM local_accounts WHERE username=?').get(username),m=a&&memberFor(a);if(!m?.active)throw new Error('找不到有效账号：'+username);return {username,member:m};});
 const current={identity:{userId:admin.userId,email:admin.email,displayName:admin.name,fullName:admin.name}};
 for(const {username,member} of targets){
  if(member.orderScope===scope){console.log(username+'：查看范围已是 '+scope);continue;}
  const req=new Request('http://localhost:8787/api/workspace/member',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...member,orderScope:scope})});
  const response=await context.run(current,()=>api.POST(req,{params:Promise.resolve({action:'member'})}));
  if(!response.ok)throw new Error((await response.json()).error);console.log(username+'：已设置查看范围 '+scope+'，保留负责客户和部门权限');
 }
}else if(command==='backup')console.log(JSON.stringify(await makeBackup()));
else if(command==='status'){
 const all=records(),orders=all.filter(r=>r.kind==='order'&&r.lifecycle!=='archived');console.log(JSON.stringify({dataDir,rows:orders.length,orders:new Set(orders.map(o=>o.orderNo)).size,quantity:orders.reduce((n,o)=>n+o.quantity,0),accounts:db.prepare('SELECT username,must_change FROM local_accounts').all(),revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision}));
}else throw new Error('支持 init / import <原表路径> / backup / status / set-scope <账号,账号> <all|assigned>');
db.close();
