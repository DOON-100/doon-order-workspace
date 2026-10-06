// Authorized local maintenance import through the same validated API. No staff credentials are read.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dist=path.resolve(process.env.DOON_IMPORT_BUILD||'lan-dist');
const {db,records,context,makeBackup}=await import(pathToFileURL(path.join(dist,'runtime.mjs')).href);
const api=await import(pathToFileURL(path.join(dist,'workspace-api.mjs')).href);
const source=process.argv[2],sourceAsOf=process.argv[3];if(!source||!sourceAsOf)throw new Error('需要提供已授权的采购 XLSX 和截至日期。');
const expectationsPath=process.env.DOON_IMPORT_EXPECTATIONS;if(!expectationsPath)throw new Error('需要 DOON_IMPORT_EXPECTATIONS 指向已核对的本地 JSON（rows/orders/suppliers）。');const expected=JSON.parse(await fs.readFile(expectationsPath,'utf8'));for(const k of ['rows','orders','suppliers'])assert(Number.isSafeInteger(expected[k])&&expected[k]>0,'预期数量必须为正整数');
const before=records(),owner=before.find(r=>r.kind==='member'&&r.owner&&r.active&&r.role==='admin');if(!owner)throw new Error('需要有效管理员。');
const protectedBefore=before.filter(r=>!['purchase','purchase_import'].includes(r.kind)),accountRows=()=>db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all(),digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),accountsHash=digest(accountRows());
const backup=await makeBackup();
const identity={identity:{userId:owner.userId,email:owner.email,displayName:owner.name,fullName:owner.name}};
async function call(action,body){const request=new Request('http://localhost:8787/api/workspace/'+action,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});const response=await context.run(identity,()=>api.POST(request,{params:Promise.resolve({action})}));const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
try{
 const form=new FormData();form.set('file',new File([await fs.readFile(source)],path.basename(source)));form.set('sourceAsOf',sourceAsOf);let job=await call('purchase-preview',form);if(job.summary.sourceRows!==expected.rows||job.summary.orders!==expected.orders||job.summary.suppliers!==expected.suppliers)throw new Error('源文件数量与本次验收不一致，暂停导入。');
 while(job.status!=='已完成'){job=await call('purchase-commit',{id:job.id,offset:job.offset});console.log(`采购明细 ${job.offset}/${job.total}`);}
 const after=records(),byId=new Map(after.map(r=>[r.id,r]));assert(protectedBefore.every(r=>JSON.stringify(r)===JSON.stringify(byId.get(r.id))),'既有订单、成员或业务记录发生变化');assert.equal(digest(accountRows()),accountsHash,'账号元信息不一致');
 const rows=after.filter(r=>r.kind==='purchase'&&r.sourceHash===job.hash);assert.equal(rows.length,expected.rows);assert(rows.every(p=>!p.balanceKnown),'本次导入不得虚构实收基数');assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 const result={at:new Date().toISOString(),source:path.basename(source),asOf:sourceAsOf,import:job.id,sourceHash:job.hash,rows:rows.length,orders:new Set(rows.map(p=>p.po)).size,suppliers:new Set(rows.map(p=>p.supplier)).size,unknownReceiptRows:rows.filter(p=>!p.balanceKnown).length,protectedRecords:protectedBefore.length,protectedRecordsPreserved:true,accountsPreserved:true,backup};
 await fs.writeFile('test-output/purchase-live-import.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{db.close();}
