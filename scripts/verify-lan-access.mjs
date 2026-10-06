import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const result=await build({entryPoints:['lib/domain.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {canRead}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const db=new DatabaseSync(path.join(process.env.DOON_DATA_DIR||'lan-data','workspace.sqlite'),{readOnly:true});
const records=db.prepare('SELECT data FROM records ORDER BY id').all().map(r=>JSON.parse(r.data));
const orders=records.filter(r=>r.kind==='order'),members=records.filter(r=>r.kind==='member'&&r.active);
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const preserved={orders:digest(orders),accounts:digest(db.prepare('SELECT * FROM local_accounts ORDER BY id').all()),assignments:digest(members.map(m=>({id:m.id,role:m.role,customers:m.customers,departments:m.departments,active:m.active})))};
const checkpoint=path.join('lan-data','access-fix-checkpoint.json');
if(process.argv[2]==='before')await fs.writeFile(checkpoint,JSON.stringify(preserved));
if(process.argv[2]==='after'){const before=JSON.parse(await fs.readFile(checkpoint,'utf8'));for(const k of Object.keys(preserved))if(before[k]!==preserved[k])throw new Error(k+' changed during access update; review before claiming preservation');}
console.log(JSON.stringify({rows:orders.length,quantity:orders.reduce((n,o)=>n+o.quantity,0),preserved:process.argv[2]==='after',members:members.map(m=>({email:m.email,role:m.role,scope:m.orderScope||'legacy',visible:orders.filter(o=>canRead(m,o)).length}))},null,2));db.close();
