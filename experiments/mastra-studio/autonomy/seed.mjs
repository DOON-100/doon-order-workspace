import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const directory=path.resolve(process.env.DOON_DATA_DIR||''),dist=path.resolve(process.env.DOON_BUILD_DIR||'');
const marker=JSON.parse(await fs.readFile(path.join(directory,'autonomy-sandbox.json'),'utf8'));
if(marker.kind!=='doon-autonomy-synthetic-v1'||process.env.DOON_SYNTHETIC_ONLY!=='1')throw Error('拒绝非合成初始化');
const {db}=await import(pathToFileURL(path.join(dist,'runtime.mjs')).href);
try{
 if(db.prepare('SELECT COUNT(*) n FROM local_accounts').get().n||db.prepare('SELECT COUNT(*) n FROM records').get().n)throw Error('已有记录，不初始化或重置');
 const {createAccount}=await import(pathToFileURL(path.join(dist,'auth.mjs')).href),accounts=[];
 for(const [username,name,role,owner]of [['validation_admin','验证管理员','admin',true],['validation_buyer','合成采购审核员','pmc',false],['validation_other','合成其他员工','clerk',false]]){
  const password='Autonomy-'+randomBytes(24).toString('base64url');const result=await createAccount({username,name,role,password,customers:[],departments:[],orderScope:'assigned'},null,{owner});
  db.prepare('UPDATE local_accounts SET must_change=0 WHERE username=? AND member_id=?').run(username,result.memberId);
  const member=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(result.memberId).data);accounts.push({username,password,memberId:member.id,userId:member.userId,role});
 }
 await fs.writeFile(path.join(directory,'synthetic-accounts.json'),JSON.stringify(accounts,null,2),{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(directory,'本地验证账号.txt'),accounts.map(row=>`账号：${row.username}\n密码：${row.password}\n职责：${row.role}`).join('\n\n')+'\n',{flag:'wx',mode:0o600});
}finally{db.close();}
