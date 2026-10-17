// Called only for a brand-new, marked sandbox by start.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const directory=path.resolve(process.env.DOON_DATA_DIR||'');
const marker=JSON.parse(await fs.readFile(path.join(directory,'studio-sandbox.json'),'utf8'));
if(marker.kind!=='doon-synthetic-studio-v1'||process.env.DOON_SYNTHETIC_ONLY!=='1')throw new Error('Refusing non-synthetic seed');
const dist=path.resolve(process.env.DOON_BUILD_DIR);
const {db}=await import(pathToFileURL(path.join(dist,'runtime.mjs')).href);
try{
 if(db.prepare('SELECT COUNT(*) n FROM local_accounts').get().n)throw new Error('已有账号，不执行初始化或重置。');
 if(db.prepare('SELECT COUNT(*) n FROM records').get().n)throw new Error('已有记录，不执行初始化。');
 const {createAccount}=await import(pathToFileURL(path.join(dist,'auth.mjs')).href);
 const password='Studio-'+randomBytes(24).toString('base64url');
 const result=await createAccount({username:'studio_admin',name:'Studio 本地测试管理员',role:'admin',password},null,{owner:true});
 // This account is newly-created synthetic data, never an existing employee account.
 db.prepare('UPDATE local_accounts SET must_change=0 WHERE username=? AND member_id=?').run('studio_admin',result.memberId);
 await fs.writeFile(path.join(directory,'本地测试登录.txt'),`仅供本机合成测试\n地址：http://127.0.0.1:${process.env.DOON_PORT}\n账号：studio_admin\n密码：${password}\n\n登录后点击左上角公司图标，在新标签页打开 Mastra Studio。\n`,{mode:0o600,flag:'wx'});
}finally{db.close();}
