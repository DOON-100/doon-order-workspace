// Read-only post-deployment verification through production GET handlers; no passwords or session tokens.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {db,records,context} from '../lan-dist/runtime.mjs';
import {GET} from '../lan-dist/workspace-api.mjs';
const rows=records(),results=[];
try{
 const names=process.argv.slice(2);assert(names.length,'请提供要验证的本地账号名');for(const name of names){
  const publicAccount=db.prepare('SELECT username,member_id FROM local_accounts WHERE username=?').get(name),m=rows.find(r=>r.id===publicAccount?.member_id);assert(m?.active);
  const req=new Request('http://localhost:8787/api/workspace/purchase-data');
  const res=await context.run({identity:{userId:m.userId,email:m.email,displayName:m.name,fullName:m.name}},()=>GET(req,{params:Promise.resolve({action:'purchase-data'})}));
  const data=await res.json();assert.equal(res.status,200);assert.equal(data.rows.length,rows.filter(r=>r.kind==='purchase').length);assert.equal(data.canEdit,['admin','pmc'].includes(m.role));assert(data.rows.every(p=>!p.balanceKnown));
  results.push({username:name,rows:data.rows.length,canEdit:data.canEdit,orders:new Set(data.rows.map(p=>p.po)).size,suppliers:new Set(data.rows.map(p=>p.supplier)).size});
 }
 const report={at:new Date().toISOString(),checked:results,productionOrderRows:rows.filter(r=>r.kind==='order').length};
 await fs.writeFile('test-output/purchase-live-verified.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{db.close();}
