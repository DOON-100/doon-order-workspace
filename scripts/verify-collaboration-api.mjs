// Production GET-only checks using public member metadata. No passwords, session reads, or business writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {db,records,context} from '../lan-dist/runtime.mjs';
import {GET} from '../lan-dist/workspace-api.mjs';
const results=[];
try{
 const rows=records();
 const names=process.argv.slice(2);assert(names.length,'请提供要验证的本地账号名');for(const name of names){
  const account=db.prepare('SELECT username,member_id FROM local_accounts WHERE username=?').get(name),member=rows.find(r=>r.id===account?.member_id);assert(member?.active);
  const get=async route=>context.run({identity:{userId:member.userId,email:member.email,displayName:member.name,fullName:member.name}},()=>GET(new Request('http://localhost:8787/api/workspace/'+route),{params:Promise.resolve({action:route.split('?')[0]})}));
  const dataResponse=await get('data');assert.equal(dataResponse.status,200);const data=await dataResponse.json();assert(Array.isArray(data.orders));let details={};
  if(['admin','pmc'].includes(member.role)){
   for(const production of ['external','internal']){const response=await get('ledger-export?mode=active&production='+production);assert.equal(response.status,200);const workbook=XLSX.read(await response.arrayBuffer()),exported=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);details[production+'Lines']=exported.length;}
   assert.equal(details.externalLines+details.internalLines,data.orders.filter(o=>o.lifecycle!=='archived'&&o.sourceStatus!=='已取消').length);
  }
  results.push({username:name,role:data.me.role,visibleOrders:data.orders.length,...details});
 }
 const report={at:new Date().toISOString(),results};await fs.writeFile('test-output/collaboration-api-verified.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{db.close();}
