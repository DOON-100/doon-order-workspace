import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FoundationService} from '../dist/service.js';
import {main} from '../dist/program.js';
import {store,session} from './helpers.mjs';

// 测试环境，不含正式业务数据。 No network or production paths are used.
async function fixture(transport){
 const state=await store();await state.setup('https://synthetic.example.test',false);await state.saveSession(session('https://synthetic.example.test'));
 return {state,foundation:new FoundationService(state,transport),async input(value){const file=path.join(state.directory,'input.json');await fs.writeFile(file,JSON.stringify(value));return file;}};
}
async function command(foundation,args){let output='';const original=process.stdout.write;process.stdout.write=chunk=>{output+=String(chunk);return true;};try{const code=await main(['system','workspace',...args,'--json'],foundation);return {code,output,result:JSON.parse(output)};}finally{process.stdout.write=original;}}
const rows=count=>Array.from({length:count},(_,i)=>({index:i+2,status:'new',expectedVersion:0,before:null,after:{id:'synthetic-order-'+i,version:0,customer:'合成客户',notes:'合成说明'.repeat(15),quantity:1}}));

test('large import previews retain their receipt and support paged or complete new-file reads',async()=>{
 const bytes=Buffer.from('Synthetic workbook bytes'),hash=createHash('sha256').update(bytes).digest('hex');let posts=0;
 const job={id:'synthetic-import',importType:'orders',hash,status:'待确认',offset:0,rows:rows(1000)};
 const f=await fixture(async(url,init)=>{const route=new URL(url).pathname;if(route.endsWith('/preview')){posts++;return Response.json({id:job.id});}assert(route.endsWith('/job'));assert.equal(init.method,'GET');return Response.json(job);});
 const file=path.join(f.state.directory,'workbook.xlsx');await fs.writeFile(file,bytes);
 const preview=await command(f.foundation,['preview','--type','orders','--input',await f.input({}),'--file',file]);
 assert.equal(preview.code,0,preview.output);assert.equal(posts,1);assert.equal(preview.result.data.record.id,job.id);assert.equal(preview.result.data.record.hash,hash);assert.equal(preview.result.data.record.rowPage.total,1000);assert.equal(preview.result.data.record.rows.length,20);assert.equal(preview.result.data.record.rowPage.nextOffset,20);assert(preview.output.length<512*1024);
 const page=await command(f.foundation,['form',job.id,'--type','orders-job','--offset','980','--limit','20']);assert.equal(page.code,0,page.output);assert.equal(page.result.data.record.rows[0].index,982);assert.equal(page.result.data.record.rowPage.nextOffset,null);
 const output=path.join(f.state.directory,'complete.json');const exported=await command(f.foundation,['form',job.id,'--type','orders-job','--output',output]);assert.equal(exported.code,0,exported.output);const saved=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(saved.record.rows.length,1000);assert.equal(saved.record.rows[999].after.notes,job.rows[999].after.notes);
 const before=await fs.readFile(output);const repeated=await command(f.foundation,['form',job.id,'--type','orders-job','--output',output]);assert.equal(repeated.result.error.code,'OUTPUT_EXISTS');assert.deepEqual(await fs.readFile(output),before);assert.equal(posts,1);
});

test('an individually large import row is explicitly omitted from terminal pages and preserved in JSON',async()=>{
 const job={id:'synthetic-large-row',importType:'orders',hash:'a'.repeat(64),status:'待确认',rows:rows(2)};job.rows[0].after.notes='合'.repeat(100000);
 const f=await fixture(async()=>Response.json(job)),output=path.join(f.state.directory,'large.json');
 const shown=await command(f.foundation,['form',job.id,'--type','orders-job']);assert.equal(shown.code,0,shown.output);assert.deepEqual(shown.result.data.record.rowPage.oversizedRows,[{offset:0,index:2}]);assert.equal(shown.result.data.record.rows.length,1);assert.equal(shown.result.data.record.rows[0].index,3);assert(shown.output.length<512*1024);
 const exported=await command(f.foundation,['form',job.id,'--type','orders-job','--output',output]);assert.equal(exported.code,0,exported.output);assert.equal(JSON.parse(await fs.readFile(output,'utf8')).record.rows[0].after.notes.length,100000);
});

test('commit verifies every committed row beyond the displayed page and retains all progress metadata',async()=>{
 const job={id:'synthetic-commit',importType:'orders',hash:'b'.repeat(64),status:'待确认',offset:0,rows:rows(200)};let committed=false,missingRow=false,posts=0;
 const f=await fixture(async(url,init)=>{const route=new URL(url).pathname;if(route.endsWith('/workspace-tools-data'))return Response.json({contract:'workspace-tools-v1',comments:[],orders:committed?job.rows.filter((_,i)=>!missingRow||i!==150).map(r=>({...r.after,version:1})):[]});if(route.endsWith('/job'))return Response.json(job);assert(route.endsWith('/commit-import'));posts++;const input=JSON.parse(init.body);committed=true;Object.assign(job,{status:'已提交',offset:200,applied:200,selected:input.selected,reviewReason:input.reason});return Response.json({ok:true,count:200,offset:200,status:'已提交'});});
 const file=await f.input({id:job.id,sourceHash:job.hash,offset:0,reason:'合成核对',selected:job.rows.map(r=>r.index)});
 const success=await command(f.foundation,['commit','--type','orders','--input',file]);assert.equal(success.code,0,success.output);assert.equal(success.result.data.record.rows.length,20);assert.equal(success.result.data.record.selected.length,200);assert.equal(success.result.data.record.offset,200);assert.equal(success.result.data.record.applied,200);assert.equal(success.result.data.record.hash,job.hash);
 missingRow=true;await assert.rejects(f.foundation.workspaceTools().commit('orders',file),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true&&e.details.retryable===false);assert.equal(posts,2);
});

test('fixed-tool post-write readback failures preserve job context and never advertise a retryable write',async()=>{
 for(const kind of ['decision','fees','ownership']){
  let posts=0;const id='fixed_tool_job_synthetic_'+kind;
  const f=await fixture(async(url,init)=>{if(init.method==='POST'){posts++;return Response.json({job:{id,status:kind==='fees'?'pending':'completed'}});}assert(new URL(url).pathname.endsWith('/fixed-tool-job'));throw Error('Synthetic lost readback');});
  const body=kind==='decision'?{id,previewHash:'c'.repeat(64),decision:'approve'}:kind==='fees'?{requestKey:'synthetic-fees',quoteId:'synthetic-quote',version:1,lines:[{id:'line',toolingFee:1}],customerCharges:[]}:{requestKey:'synthetic-ownership',customerIds:['synthetic-customer']};
  const file=await f.input(body),api=f.foundation.workspaceTools();await assert.rejects(kind==='decision'?api.action('fixed-decision',file):kind==='fees'?api.preview('fixed-fees',file):api.ownership(file),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true&&e.details.retryable===false&&e.message.includes(id));assert.equal(posts,1);
 }
});
