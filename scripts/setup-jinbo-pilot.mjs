// Local owner operation. Never imports orders into tasks or assumes historical quantities.
// Credentials are generated once and written only to the ignored private data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const dist=path.resolve(process.env.DOON_BUILD_DIR||'lan-dist');
const lanUrl=process.env.DOON_SUPPLIER_LAN_URL||'http://localhost:8787/supplier-portal';
if(!/^https?:\/\/[^\s]+\/supplier-portal$/.test(lanUrl))throw new Error('供应商内网入口配置无效。');
const runtime=await import(pathToFileURL(path.join(dist,'runtime.mjs')).href);
const {db,dataDir,records,context}=runtime;
const all=records(),masters=all.filter(r=>r.kind==='supplier'&&String(r.name).trim()==='金博');
if(masters.length>1)throw new Error('存在多个金博主档，请管理员先核对，未更改数据。');
if(masters[0]&&masters[0].active!==true)throw new Error('金博主档已停用或状态待核，未自动启用。');
const orders=all.filter(r=>r.kind==='order'&&String(r.ledger?.columns.A||r.extra?.['生产厂']||'').trim()==='金博'&&r.lifecycle!=='archived'&&r.sourceStatus!=='已取消');
const baselineKnown=orders.filter(o=>String(o.ledger?.columns.BF??'').trim()!==''&&Number.isSafeInteger(Number(o.ledger.columns.BF))&&Number(o.ledger.columns.BF)>=0&&Number(o.ledger.columns.BF)<=o.quantity).length;
const summary={supplier:'金博',masterExists:!!masters[0],activeOrderLines:orders.length,knownWarehouseBaselines:baselineKnown,productTypes:[...new Set(orders.map(o=>o.productType||o.ledger?.columns.W||'待核'))],publishedTasks:all.filter(r=>r.kind==='finished_supplier_task'&&r.supplierId===masters[0]?.id).length};
if(process.argv[2]!=='apply'){console.log(JSON.stringify({mode:'read-only',...summary},null,2));db.close();process.exit(0);}
const owner=all.find(r=>r.kind==='member'&&r.owner&&r.active&&r.role==='admin');
if(!owner||!db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(owner.id))throw new Error('未找到有效本机管理员，未创建账号。');
const planned=[{username:'jinbo_report',name:'金博主填报人（待实名）'},{username:'jinbo_backup',name:'金博备用填报人（待实名）'}];
for(const p of planned){const a=db.prepare('SELECT id,member_id FROM local_accounts WHERE username=?').get(p.username);if(!a)continue;const m=all.find(r=>r.id===a.member_id);if(m?.role!=='supplier'||!masters[0]||m.supplierId!==masters[0].id||!m.active)throw new Error('预定账号已存在且归属不符或已停用：'+p.username+'，未改动账号。');}
const hashRows=()=>new Map(db.prepare("SELECT id,data FROM records WHERE kind='order'").all().map(r=>[r.id,createHash('sha256').update(r.data).digest('hex')]));
const before=hashRows(),backup=await runtime.makeBackup();
const api=await import(pathToFileURL(path.join(dist,'workspace-api.mjs')).href);
const auth=await import(pathToFileURL(path.join(dist,'auth.mjs')).href);
const identity={userId:owner.userId,email:owner.email,displayName:owner.name,fullName:owner.name};
let master=masters[0];
if(!master){const req=new Request('http://localhost:8787/api/workspace/supplier-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'金博',active:true,notes:'成品外发协作试点。联系人、品类、订单及期初数量由公司核定。'})});const response=await context.run({identity},()=>api.POST(req,{params:Promise.resolve({action:'supplier-save'})}));const result=await response.json();if(!response.ok)throw new Error(result.error||'金博主档创建失败');master=result;}
const folder=path.join(dataDir,'supplier-onboarding');await fs.mkdir(folder,{recursive:true});
const pending=planned.filter(p=>!db.prepare('SELECT id FROM local_accounts WHERE username=?').get(p.username)).map(p=>({...p,password:randomBytes(24).toString('base64url')}));
const credentialFile=pending.length?path.join(folder,'金博试点首次登录-'+randomUUID().slice(0,8)+'.txt'):null,newCredentials=[];
if(credentialFile){
 const content='金博成品外发协作试点 · 私密首次登录资料\n\n内网入口：'+lanUrl+'\n此地址仅公司内网可达。金博厂外访问需开通专用 HTTPS 入口后替换。\n\n'+pending.map(p=>`账号：${p.username}\n姓名：${p.name}\n初始密码：${p.password}\n`).join('\n')+'\n以setup-result.json中的createdAccounts确认已开通账号；初始化失败时其中账号可能尚未开通。\n请分别交给实际填报人，首次登录必须修改密码。不要把主账号和备用账号交给同一人共用。姓名请在中台成员与权限中改为实际姓名。\nPMC须先核定实际品类、期初BF及在途/待检/返工，再发布10～20条订单任务。此脚本未创建任务、修改进度或入仓数。\n';
 // Persist generated credentials before the irreversible hash is saved; reruns use
 // a fresh filename and never overwrite credentials from an earlier partial run.
 await fs.writeFile(credentialFile,content,{mode:0o600,flag:'wx'});
}
for(const p of pending){await auth.createAccount({...p,role:'supplier',supplierId:master.id},owner);newCredentials.push(p);}
const after=hashRows();if(before.size!==after.size||[...before].some(([id,hash])=>after.get(id)!==hash))throw new Error('订单保全校验失败，请检查；未自动恢复数据库。');
const result={ok:true,...summary,supplierId:master.id,createdAccounts:newCredentials.map(p=>p.username),existingAccounts:planned.filter(p=>!newCredentials.some(n=>n.username===p.username)).map(p=>p.username),credentialFile:newCredentials.length?credentialFile:null,ordersUnchanged:true,backup:backup.folder,at:new Date().toISOString()};
await fs.writeFile(path.join(folder,'setup-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));db.close();
