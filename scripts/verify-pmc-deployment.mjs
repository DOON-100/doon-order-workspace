import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
const db=new DatabaseSync('lan-data/workspace.sqlite',{readOnly:true});
const records=db.prepare('SELECT data FROM records ORDER BY id').all().map(r=>JSON.parse(r.data));
const orders=records.filter(r=>r.kind==='order'),members=records.filter(r=>r.kind==='member');
const accounts=db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const result={records:digest(records),accounts:digest(accounts),rows:orders.length,quantity:orders.reduce((n,o)=>n+o.quantity,0),accountCount:accounts.length,pmc:accounts.filter(a=>['candy','tina'].includes(a.username)).map(a=>({username:a.username,role:members.find(m=>m.id===a.member_id)?.role,active:members.find(m=>m.id===a.member_id)?.active}))};
db.close();
if(process.argv[2]==='before')await fs.writeFile('test-output/pmc-deploy-checkpoint.json',JSON.stringify(result,null,2));
if(process.argv[2]==='after'){const previous=JSON.parse(await fs.readFile('test-output/pmc-deploy-checkpoint.json','utf8'));if(previous.records!==result.records||previous.accounts!==result.accounts)throw new Error('部署前后数据或账号元信息不一致，请核查');}
console.log(JSON.stringify({...result,preserved:process.argv[2]==='after'}));
