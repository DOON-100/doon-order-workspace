import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Deliberately shared display names and purchase numbers prove that routing is
// based on source/member IDs, rather than names or PO text.
export const assignments=[
 {id:'SYN-MULTI-P01',order:1,owner:'a',line:1},
 {id:'SYN-MULTI-P02',order:1,owner:'a',line:2},
 {id:'SYN-MULTI-P03',order:2,owner:'b',line:1},
 {id:'SYN-MULTI-P04',order:3,owner:'a',line:1},
 {id:'SYN-MULTI-P05',order:4,owner:'c',line:1},
 {id:'SYN-MULTI-P06',order:4,owner:'c',line:2},
 {id:'SYN-MULTI-P07',order:5,owner:'b',line:1},
 {id:'SYN-MULTI-P08',order:6,owner:'a',line:1},
];
export const orderNo=n=>'SYN-ORDER-'+String(n).padStart(2,'0');
export async function seedMultiUser(){
 const directory=path.resolve(process.env.DOON_DATA_DIR||'');
 if(!directory.toLowerCase().split(path.sep).includes('test-output')||process.env.DOON_SYNTHETIC_ONLY!=='1')throw Error('仅允许专用合成测试目录');
 const marker=JSON.parse(await fs.readFile(path.join(directory,'multi-user-sandbox.json'),'utf8'));
 if(marker.kind!=='doon-multi-user-synthetic-v1')throw Error('合成目录标识不匹配');
 const {db}=await import(pathToFileURL(path.join(process.env.DOON_BUILD_DIR,'runtime.mjs')).href);
 try{
  if(db.prepare('SELECT COUNT(*) n FROM records').get().n||db.prepare('SELECT COUNT(*) n FROM local_accounts').get().n)throw Error('已有记录，拒绝覆盖或重置');
  const {createAccount}=await import(pathToFileURL(path.join(process.env.DOON_BUILD_DIR,'auth.mjs')).href),accounts=[];
  for(const alias of ['admin','a','b','c','peer','idle']){
   const role=alias==='admin'?'admin':alias==='peer'?'pmc':'clerk',username='multi_'+alias,password='Multi-Test-'+randomBytes(24).toString('base64url');
   const result=await createAccount({username,password,name:['a','b'].includes(alias)?'合成同名员工':'合成员工 '+alias,role,orderScope:'assigned',customers:[],departments:[]},null,{owner:alias==='admin'});
   db.prepare('UPDATE local_accounts SET must_change=0 WHERE member_id=?').run(result.memberId);
   const member=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(result.memberId).data);accounts.push({alias,username,password,memberId:member.id,userId:member.userId,email:member.email,role});
  }
  const insert=row=>db.prepare('INSERT INTO records VALUES(?,?,?)').run(row.id,row.kind,JSON.stringify(row)),at=new Date().toISOString();
  for(let n=1;n<=6;n++){
   const owner=accounts.find(row=>row.alias===assignments.find(row=>row.order===n).owner);
   insert({id:'SYN-MULTI-ORDER-'+n,kind:'order',version:1,orderNo:orderNo(n),ownerEmail:owner.email,customer:'SYN-CUSTOMER-'+n,customerPO:'SYN-CPO-'+n,drawing:'SYN-DRAWING-'+n,color:'SYN',lens:'SYN',batch:'SYN',quantity:160,requestedDate:'2026-10-20',stage:'备料中',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'仅用于多员工隔离验证',sourceStatus:'有效',source:'synthetic-multi-user-v1',extra:{},createdAt:at,updatedAt:at,updatedBy:'synthetic-fixture',lifecycle:'active'});
  }
  for(const row of assignments)insert({id:row.id,kind:'purchase',syntheticFixture:'multi-user-v1',version:1,sourceVersion:1,po:'SYN-SHARED-PO',customerOrder:orderNo(row.order),itemCode:'SYN-MAT-'+row.order+'-'+row.line,itemName:'合成眼镜配件',supplier:'合成供应商',buyer:'合成同名员工',quantity:160,received:100,returnPending:0,balanceKnown:true,unit:'件',orderDate:'2026-10-01',dueDate:'2026-10-16',promisedDate:'2026-10-16',expectedDate:'',nextFollowupDate:'',followupNote:'',sourceAsOf:'2026-10-17',sourceHash:'synthetic-multi-user-v1',sourceRow:row.order*10+row.line,sourceFile:'',sourceSheet:'合成夹具',sourceFilter:'',raw:{},sourceNote:'',auditStatus:'已审核',closeStatus:'未关闭',lifecycle:'active'});
  await fs.writeFile(path.join(directory,'synthetic-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});
 }finally{db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await seedMultiUser();
