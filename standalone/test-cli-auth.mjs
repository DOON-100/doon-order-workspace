// Synthetic authentication only: no live data, credentials, listeners or backups.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

await fs.mkdir('test-output',{recursive:true});
const data=await fs.mkdtemp(path.resolve('test-output/cli-auth-'));
for(const name of Object.keys(process.env))if(/^DOON_/i.test(name))delete process.env[name];
Object.assign(process.env,{DOON_DATA_DIR:data,DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0'});
const {db,saveRecords,env}=await import('./runtime.mjs');
const {createAccount,login,session,logout,changePassword,cliSessionOptions,cliSessionPolicy,revokeInactiveSessions}=await import('./auth.mjs');
const password='Synthetic-Cli-Auth-2026!',local={},employee={cookieName:'doon_employee_session',employeeOnly:true},supplier={cookieName:'doon_supplier_session',supplierOnly:true},review={cookieName:'doon_review_session',recordHistory:false};
const request=cookie=>new Request('http://synthetic.test/api/auth/session',{headers:{cookie:cookie.split(';')[0]}});
const signed=async(options=local,user='employee')=>login({username:user,password},'127.0.0.1',options===employee||options.cookieName==='doon_employee_cli_session',options);
const nativeNow=Date.now;let clock=nativeNow();Date.now=()=>clock;
try{
 saveRecords([{id:'synthetic-order',kind:'order',quantity:19},{id:'synthetic-supplier',kind:'supplier',name:'Synthetic Supplier',active:true}]);
 await env.BUCKET.put('synthetic-original',Buffer.from('Synthetic immutable attachment'));
 const original=()=>db.prepare("SELECT id,kind,data FROM records WHERE kind NOT IN ('auth_event','audit','member') ORDER BY id").all();
 const originals=original(),attachmentHash=createHash('sha256').update(await fs.readFile(path.join(data,'files',createHash('sha256').update('synthetic-original').digest('hex')))).digest('hex');
 const account=await createAccount({username:'employee',name:'Synthetic CLI Employee',role:'viewer',password},null);
 await createAccount({username:'supplier',name:'Synthetic Supplier',role:'supplier',supplierId:'synthetic-supplier',password},null);
 const initial=await signed(cliSessionOptions(local));assert.equal(initial.user.mustChange,true);
 db.prepare('UPDATE local_accounts SET must_change=0').run();
 assert.deepEqual(cliSessionPolicy,{kind:'cli',maxAgeSeconds:7776000,idleTimeoutSeconds:null});
 for(const options of [supplier,review,{cookieName:'custom_session'}])assert.throws(()=>cliSessionOptions(options),{status:403});
 await assert.rejects(signed(cliSessionOptions(local),'supplier'),{status:401});
 const localCli=await signed(cliSessionOptions(local)),employeeCli=await signed(cliSessionOptions(employee)),browser=await signed();
 assert.match(localCli.cookie,/^doon_cli_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=7776000$/);
 assert.match(employeeCli.cookie,/^doon_employee_cli_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=7776000; Secure$/);
 assert.match(browser.cookie,/Max-Age=43200$/);
 const sources=db.prepare("SELECT json_extract(data,'$.source') source FROM records WHERE kind='auth_event'").all().map(row=>row.source);
 assert(sources.includes('CLI 内网入口'));assert(sources.includes('CLI 员工 HTTPS 入口'));assert(sources.includes('内网入口'));
 assert(session(request(localCli.cookie),local));assert(session(request(employeeCli.cookie),employee));
 for(const options of [supplier,review,employee])assert.equal(session(request(localCli.cookie),options),null);
 assert.equal(session(request(employeeCli.cookie),local),null);
 assert.equal(session(request(localCli.cookie.replace('doon_cli_session','doon_session')),local),null);
 assert.equal(session(request(browser.cookie.replace('doon_session','doon_cli_session')),local),null);
 assert.equal(session(request(localCli.cookie.replace('doon_cli_session','doon_employee_cli_session')),employee),null);
 clock+=3*3600000;
 assert(session(request(localCli.cookie),local));assert.equal(session(request(browser.cookie),local),null);
 const activeBrowser=await signed();
 for(let i=0;i<11;i++){clock+=3600000;assert(session(request(activeBrowser.cookie),local));}
 clock+=3600000;assert.equal(session(request(activeBrowser.cookie),local),null);
 assert(session(request(localCli.cookie),local));
 console.log('PASS Dedicated CLI credentials survive idle and browser expiry; browser limits and cookie namespace isolation remain enforced.');

 const longLived=await signed(cliSessionOptions(local)),started=clock;
 clock=started+89*24*3600000;assert(session(request(longLived.cookie),local));
 clock=started+90*24*3600000;assert.equal(session(request(longLived.cookie),local),null);
 const forLogout=await signed(cliSessionOptions(employee));
 const cleared=logout(session(request(forLogout.cookie),employee),true,employee);
 assert.match(cleared,/^doon_employee_cli_session=;.*Max-Age=0; Secure$/);assert.equal(session(request(forLogout.cookie),employee),null);
 const beforeChange=await signed(cliSessionOptions(local)),otherDevice=await signed(cliSessionOptions(employee)),webDevice=await signed();
 const replaced=await changePassword(session(request(beforeChange.cookie),local),{currentPassword:password,password:'Synthetic-Cli-Replaced-2026!'},false,local);
 assert.match(replaced,/^doon_cli_session=.*Max-Age=7776000$/);assert(session(request(replaced),local));
 for(const [cookie,options] of [[beforeChange.cookie,local],[otherDevice.cookie,employee],[webDevice.cookie,local]])assert.equal(session(request(cookie),options),null);
 console.log('PASS CLI absolute expiry, explicit logout and password-change revocation apply to every device and browser session.');

 const memberRow=db.prepare('SELECT data FROM records WHERE id=?').get(account.memberId),member=JSON.parse(memberRow.data);
 saveRecords([{...member,role:'supplier',supplierId:'synthetic-supplier'}]);assert.equal(session(request(replaced),local),null);
 saveRecords([{...member,active:false}]);revokeInactiveSessions();
 assert.equal(db.prepare('SELECT count(*) n FROM local_sessions WHERE account_id=(SELECT id FROM local_accounts WHERE username=?)').get('employee').n,0);
 assert.deepEqual(original(),originals);
 assert.equal(createHash('sha256').update(await fs.readFile(path.join(data,'files',createHash('sha256').update('synthetic-original').digest('hex')))).digest('hex'),attachmentHash);
 console.log('PASS Supplier role changes and disabled accounts cannot retain CLI access; synthetic business records and original attachment hashes are unchanged.');
}finally{Date.now=nativeNow;db.close();}
