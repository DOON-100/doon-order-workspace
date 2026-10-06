import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const db=new DatabaseSync('lan-data/workspace.sqlite',{readOnly:true});
const orders=db.prepare("SELECT data FROM records WHERE kind='order'").all().map(r=>JSON.parse(r.data)),members=db.prepare("SELECT data FROM records WHERE kind='member'").all().map(r=>JSON.parse(r.data));
db.close();
const active=orders.filter(o=>o.lifecycle!=='archived'&&o.sourceStatus!=='已取消');
const byFactory={};for(const o of active){const factory=o.ledger?.columns.A||o.extra?.['A · 生产厂']||'未知';byFactory[factory]??={lines:0,quantity:0};byFactory[factory].lines++;byFactory[factory].quantity+=o.quantity;}
const expected=process.env.DOON_VERIFY_EXPECTATIONS?JSON.parse(await fs.readFile(process.env.DOON_VERIFY_EXPECTATIONS,'utf8')):null;
if(expected){for(const [orderNo,factory] of Object.entries(expected.orderFactories||{})){const matched=orders.filter(o=>o.orderNo===orderNo);assert(matched.length);assert(matched.every(o=>o.ledger?.columns.A===factory));}if(expected.clerkName){const member=members.find(m=>m.name===expected.clerkName);assert(member?.active&&member.role==='clerk'&&member.departments.includes('plastic'));}}
const result={checkedAt:new Date().toISOString(),total:orders.length,quantity:orders.reduce((n,o)=>n+o.quantity,0),byFactory,colorCodeEqualsRawL:orders.filter(o=>String(o.color??'').trim()===String(o.ledger?.columns.L??'').trim()).length,meaningfulCircleDescriptions:orders.filter(o=>o.ledger?.columns.X&&o.ledger.columns.X!=='-').length};
await fs.writeFile('test-output/collaboration-live-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
