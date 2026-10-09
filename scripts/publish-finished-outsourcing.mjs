// Trusted local owner operation. The ignored plan contains the specific lines
// and human confirmation; source never contains production IDs or quantities.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
const mode=process.argv[2],planPath=process.argv[3];
if(!['preview','apply'].includes(mode)||!planPath)throw new Error('Usage: publish-finished-outsourcing.mjs preview|apply <private-plan.json>');
const businessDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;},'Invalid calendar date.');
const plan=z.object({format:z.literal('finished-outsourcing-pending-plan-v1'),supplier:z.string().trim().min(1),lines:z.array(z.object({lineId:z.string().min(1),orderVersion:z.number().int().positive(),quantity:z.number().int().positive(),productType:z.literal('成品'),businessType:z.literal('finished_full_outsource'),unit:z.enum(['付','副']),note:z.string().trim().min(3).max(2000),confirmToken:z.string().uuid(),taskToken:z.string().uuid(),cutoffDate:businessDate,dueDate:z.union([z.literal(''),businessDate]),steps:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),label:z.string().trim().min(1).max(40)}).strict()).min(1).max(20).refine(rows=>new Set(rows.map(x=>x.id)).size===rows.length&&rows.some(x=>x.id==='packing'),'Steps must be unique and include packing.')}).strict()).min(1).max(20)}).strict().parse(JSON.parse(await fs.readFile(planPath,'utf8')));
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
if(plan.lines.some(p=>p.cutoffDate>today))throw new Error('Baseline cutoff cannot be in the future.');
const tokens=plan.lines.flatMap(p=>[p.confirmToken,p.taskToken]);if(new Set(tokens).size!==tokens.length)throw new Error('Every operation requires a distinct stable token.');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'lan-dist'),runtime=await import(pathToFileURL(path.join(dist,'runtime.mjs')).href),{db,records,context}=runtime;
const all=records(),masters=all.filter(r=>r.kind==='supplier'&&r.name===plan.supplier);
if(masters.length!==1||masters[0].active!==true)throw new Error('An exact active supplier master is required.');
const supplierId=masters[0].id,owner=all.find(r=>r.kind==='member'&&r.owner&&r.active&&r.role==='admin');
if(!owner||!db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(owner.id))throw new Error('An active local owner is required.');
const lineIds=new Set(plan.lines.map(p=>p.lineId));if(lineIds.size!==plan.lines.length)throw new Error('Duplicate source lines in plan.');
const selected=plan.lines.map(p=>{const order=all.find(r=>r.kind==='order'&&r.id===p.lineId);if(!order||order.lifecycle==='archived'||order.sourceStatus==='已取消'||order.quantity!==p.quantity||String(order.ledger?.columns.A||'').normalize('NFKC').trim()!==plan.supplier)throw new Error('Source identity, factory, quantity or lifecycle changed.');return {p,order};});
console.log(JSON.stringify({mode,supplier:plan.supplier,lines:selected.map(({p,order})=>({lineId:order.id,quantity:order.quantity,unit:p.unit,businessType:p.businessType,baseline:'pending'}))}));
if(mode==='preview'){db.close();process.exit(0);}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),before=new Map(all.map(r=>[r.id,digest(r)]));
const protectedOrder=o=>{const {productType,unit,businessType,version,updatedAt,updatedBy,...rest}=o;const extra={...rest.extra};for(const k of ['W · 产品类型','产品类型','业务类型','计量单位'])delete extra[k];const columns={...rest.ledger?.columns};delete columns.W;return {...rest,extra,ledger:rest.ledger?{...rest.ledger,columns}:undefined};};
const protectedOrders=new Map(selected.map(({order})=>[order.id,digest(protectedOrder(order))]));
const backup=await runtime.makeBackup(),api=await import(pathToFileURL(path.join(dist,'workspace-api.mjs')).href);
const identity={userId:owner.userId,email:owner.email,displayName:owner.name,fullName:owner.name};
const call=async(action,body)=>{const req=new Request('http://localhost:8787/api/workspace/finished-supplier-'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const response=await context.run({identity},()=>api.POST(req,{params:Promise.resolve({action:'finished-supplier-'+action})}));const result=await response.json();if(!response.ok)throw new Error(result.error||'Publishing failed.');return result;};
const published=[];
for(const {p,order} of selected){
 const confirmation=await call('order-confirm',{lineId:order.id,orderVersion:p.orderVersion,productType:p.productType,businessType:p.businessType,unit:p.unit,note:p.note,token:p.confirmToken});
 const task=await call('task-create',{lineId:order.id,supplierId,orderVersion:confirmation.order.version,template:'custom',steps:p.steps,dueDate:p.dueDate||'',baseline:{confirmed:false,cutoffDate:p.cutoffDate,note:p.note},token:p.taskToken});
 published.push({lineId:order.id,taskId:task.task.id,quantity:task.task.quantity,unit:task.task.unit,baselineStatus:task.task.baselineStatus,reused:!!task.reused});
}
const after=records(),map=new Map(after.map(r=>[r.id,r]));
for(const [id,hash] of before){const current=map.get(id);if(!current)throw new Error('A prior record disappeared; database was not rolled back.');if(!lineIds.has(id)&&digest(current)!==hash)throw new Error('An unrelated record changed during publication; inspect concurrent changes.');}
for(const [id,hash] of protectedOrders)if(digest(protectedOrder(map.get(id)))!==hash)throw new Error('An order field outside the confirmed classification changed; inspect records.');
const result={ok:true,supplier:plan.supplier,published,unrelatedRecordsPreserved:true,quantityAndInventoryPreserved:true,backup:backup.folder,at:new Date().toISOString()};
const output=path.join(path.dirname(path.resolve(planPath)),path.basename(planPath,'.json')+'-result.json');await fs.writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));db.close();
