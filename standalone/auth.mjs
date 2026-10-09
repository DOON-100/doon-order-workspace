import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {db,memberFor,transaction,saveRecords,auditLocal} from './runtime.mjs';
const scrypt=promisify(scryptCallback);
const hashToken=token=>createHash('sha256').update(token).digest('hex');
export const sessionName='doon_session';
export const supplierSessionName='doon_supplier_session';
const departments=new Set(['pmc','titanium','outsourcing','plating','semifinished','plastic','finished']);
let hashing=0;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export function validatePassword(value){if(typeof value!=='string'||value.length<12||value.length>128)fail('密码请使用 12 至 128 个字符。');return value;}
async function derive(value,salt){if(hashing>=3)fail('登录繁忙，请稍后重试。',429);hashing++;try{return await scrypt(value,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});}finally{hashing--;}}
export async function passwordHash(password){validatePassword(password);const salt=randomBytes(16).toString('hex');return `scrypt-v1$${salt}$${(await derive(password,salt)).toString('hex')}`;}
async function verify(password,encoded){const [version,salt,hex]=String(encoded).split('$');if(version!=='scrypt-v1')return false;const hash=await derive(password,salt),expected=Buffer.from(hex,'hex');return hash.length===expected.length&&timingSafeEqual(hash,expected);}
function cookieName(options={}){const name=options.cookieName||sessionName;if(!/^[a-z][a-z0-9_]{1,63}$/.test(name))fail('会话配置无效。',500);return name;}
function sessionDigest(token,options){const name=cookieName(options);return hashToken(name===sessionName?token:name+'|'+token);}
function activeSupplier(member){if(member?.role!=='supplier')return true;if(!member.supplierId)return false;const row=db.prepare("SELECT data FROM records WHERE id=? AND kind='supplier'").get(member.supplierId);if(!row)return false;try{return JSON.parse(row.data).active===true;}catch{return false;}}
export function revokeInactiveSessions(){
 const rows=db.prepare("SELECT a.id,r.data FROM local_accounts a LEFT JOIN records r ON r.id=a.member_id AND r.kind='member'").all();
 for(const row of rows){let member;try{member=row.data?JSON.parse(row.data):null;}catch{member=null;}if(!member?.active||!activeSupplier(member))db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(row.id);}
}
export function session(request,options={}){
 const name=cookieName(options),match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));if(!match)return null;
 const token=match.slice(name.length+1);if(!/^[\w-]{43}$/.test(token))return null;const digest=sessionDigest(token,options),now=Date.now(),row=db.prepare('SELECT * FROM local_sessions WHERE token_hash=?').get(digest);if(!row)return null;
 if(row.expires_at<now||row.last_seen<now-2*3600000){db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(digest);return null;}
 const account=db.prepare('SELECT * FROM local_accounts WHERE id=?').get(row.account_id),member=memberFor(account);
 if(!member?.active||!activeSupplier(member)){db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(row.account_id);return null;}
 if(options.supplierOnly&&member.role!=='supplier')return null;
 db.prepare('UPDATE local_sessions SET last_seen=? WHERE token_hash=?').run(now,digest);return {account,member,digest,identity:{userId:member.userId,email:member.email,displayName:member.name,fullName:member.name}};
}
export function publicSession(s){return s?{username:s.account.username,mustChange:!!s.account.must_change,role:s.member.role,...(s.member.role==='supplier'?{supplierId:s.member.supplierId}:{}),identity:{id:s.member.userId,name:s.member.name,email:s.member.email}}:null;}
function cookie(token,secure,clear=false,options={}){return `${cookieName(options)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:43200}${secure?'; Secure':''}`;}
function issue(account,secure,options={}){const token=randomBytes(32).toString('base64url'),now=Date.now();db.prepare('DELETE FROM local_sessions WHERE expires_at<?').run(now);db.prepare('INSERT INTO local_sessions VALUES(?,?,?,?)').run(sessionDigest(token,options),account.id,now+12*3600000,now);return cookie(token,secure,false,options);}
export async function login(body,ip,secure,options={}){const username=String(body.username||'').trim().toLowerCase(),password=String(body.password||'');if(username.length>64||password.length>128)fail('账号或密码不正确。',401);const key=hashToken(ip+'|'+username),globalKey=hashToken('ip|'+ip),now=Date.now();db.prepare('DELETE FROM login_attempts WHERE until_at<?').run(now);for(const k of [key,globalKey]){const a=db.prepare('SELECT * FROM login_attempts WHERE key=?').get(k);if(a&&a.failures>=(k===key?8:40))fail('尝试次数过多，请 15 分钟后再试。',429);}
 const account=db.prepare('SELECT * FROM local_accounts WHERE username=?').get(username),member=memberFor(account);
 const dummy='scrypt-v1$00000000000000000000000000000000$'+'0'.repeat(128);
 const valid=await verify(password,account?.password_hash||dummy);
 if(!valid||!member?.active||!activeSupplier(member)||(options.supplierOnly&&member.role!=='supplier')){for(const k of [key,globalKey])db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1').run(k,now+15*60000);fail('账号或密码不正确，或账号已停用。',401);}
 db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);return {cookie:issue(account,secure,options),user:publicSession({account,member})};
}
export function logout(s,secure,options={}){if(s)db.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(s.digest);return cookie('',secure,true,options);}
export async function changePassword(s,body,secure,options={}){validatePassword(body.password);if(body.password===body.currentPassword)fail('新密码不能与原密码相同。');if(typeof body.currentPassword!=='string'||body.currentPassword.length>128||!await verify(body.currentPassword,s.account.password_hash))fail('原密码不正确。',401);const hash=await passwordHash(body.password);transaction(()=>{const current=db.prepare('SELECT password_hash FROM local_accounts WHERE id=?').get(s.account.id);if(current.password_hash!==s.account.password_hash)fail('密码刚被重置，请重新登录。',409);db.prepare('UPDATE local_accounts SET password_hash=?,must_change=0 WHERE id=?').run(hash,s.account.id);db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(s.account.id);saveRecords([auditLocal(s.member,'修改本人密码',s.member.id)]);});return issue(s.account,secure,options);}
export async function createAccount(input,actor,{owner=false,existingMember}={}){
 const username=String(input.username||'').trim().toLowerCase(),name=String(input.name||'').trim();if(!/^[a-z][a-z0-9._-]{2,31}$/.test(username))fail('账号需为 3 至 32 位字母、数字、点、短横线或下划线，以字母开头。');if(!name||name.length>100)fail('请填写姓名。');
 const role=existingMember?.role||input.role||'clerk';if(!['admin','pmc','production','clerk','sales','finance','programmer','viewer','supplier'].includes(role))fail('角色无效。');const supplierId=role==='supplier'?String(existingMember?.supplierId||input.supplierId||'').trim():undefined;
 if(role==='supplier'&&(owner||!activeSupplier({role,supplierId})))fail('请先选择有效的供应商主档。');
 const depts=role==='supplier'?[]:(input.departments||[]),customers=role==='supplier'?[]:(input.customers||[]);if(!Array.isArray(depts)||depts.some(d=>!departments.has(d)))fail('部门无效。');if(!Array.isArray(customers)||customers.length>200||customers.some(c=>typeof c!=='string'||!c.trim()||c.length>100))fail('客户范围无效。');
 const orderScope=role==='supplier'?'assigned':input.orderScope??(['clerk','sales'].includes(role)?'all':'assigned');if(!['all','assigned'].includes(orderScope))fail('查看范围无效。');
 const hash=await passwordHash(input.password),id='local_'+randomUUID(),at=new Date().toISOString();let member=existingMember?{...existingMember,userId:id}:{id:'member_'+randomUUID(),kind:'member',userId:id,email:username+'@doon.local',name,role,orderScope,customers,departments:depts,active:true,owner,createdAt:at};
 if(role==='supplier')member={...member,supplierId,orderScope:'assigned',customers:[],departments:[]};
 transaction(()=>{if(role==='supplier'&&!activeSupplier(member))fail('供应商状态已变化，请重新选择。',409);if(db.prepare('SELECT id FROM local_accounts WHERE username=?').get(username))fail('该登录账号已存在。',409);db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,1,?)').run(id,username,member.id,hash,at);saveRecords([member,auditLocal(actor||member,role==='supplier'?'创建供应商账号':'创建内网账号',member.id)]);});return {username,memberId:member.id};
}
export async function resetPassword(s,input){const account=db.prepare('SELECT * FROM local_accounts WHERE id=?').get(input.id);if(!account)fail('账号不存在。',404);if(account.id===s.account.id)fail('请通过“修改密码”修改本人密码。');const member=memberFor(account);if(member?.owner)fail('初始管理员密码只能由本人修改或在主机上恢复。',403);
 const hash=await passwordHash(input.password);transaction(()=>{db.prepare('UPDATE local_accounts SET password_hash=?,must_change=1 WHERE id=?').run(hash,account.id);db.prepare('DELETE FROM local_sessions WHERE account_id=?').run(account.id);saveRecords([auditLocal(s.member,'重置员工密码',account.member_id)]);});}
