// Synthetic local review fixture. Never initialize or read a production database.
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const target=path.resolve('test-output/upgrade-preview-synthetic');
await fs.mkdir(target,{recursive:true});
process.env.DOON_DATA_DIR=target;process.env.DOON_NO_AUTO_BACKUP='1';
const runtime=await import('../lan-dist/runtime.mjs');
const auth=await import('../lan-dist/auth.mjs'),api=await import('../lan-dist/workspace-api.mjs');
assert.equal(runtime.dataDir,target);assert.equal(runtime.records().length,0);
const password='Review-Only-2026!';
await auth.createAccount({username:'review',name:'演示管理员（仅测试）',password,role:'admin'},null,{owner:true});
// Synthetic-only account can be used immediately for UI review.
runtime.db.prepare("UPDATE local_accounts SET must_change=0 WHERE username='review'").run();
const member=runtime.records().find(r=>r.kind==='member'),identity={userId:member.userId,email:member.email,displayName:member.name,fullName:member.name};
async function call(action,body){const response=await runtime.context.run({identity},()=>api.POST(new Request('http://127.0.0.1:18789/api/workspace/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({action})}));const result=await response.json();assert(response.ok,JSON.stringify(result));return result;}
const customer=(await call('customer-save',{customer:'演示眼镜品牌 · 测试',customerCode:'DEMO-001',salesName:member.name,serviceName:member.name,pmcName:'',salesMemberIds:[member.id],serviceMemberIds:[member.id],quoteMemberIds:[],notes:'仅供新版验收，不是真实客户。',active:true,createOnly:true})).item;
await call('customer-save',{customer:'演示待核查客户 · 测试',customerCode:'',salesName:'',serviceName:'',pmcName:'',notes:'待核查；仅演示缺资料客户，不是真实业务记录。',active:true,createOnly:true});
await call('unified-communication-save',{token:randomUUID(),customerId:customer.id,projectId:'',orderId:'',channel:'email',title:'样品颜色与下一步核对（演示）',sourceText:'请核对样品颜色和最新工程图版本。',sourceReference:'人工录入的演示邮件',occurredAt:'2026-10-13',draftText:'已收到，我们会核对颜色与工程图版本后回复。',internalNote:'演示记录；没有发送，也没有真实邮件接入。'});
runtime.db.close();console.log(JSON.stringify({dataDir:target,username:'review',password,syntheticOnly:true}));
