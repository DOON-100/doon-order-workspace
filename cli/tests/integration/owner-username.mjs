// Real, unchanged server handlers; isolated synthetic accounts and orders only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {FoundationService} from '../../dist/service.js';
import {StateStore} from '../../dist/state.js';
import {temporary,root,testCodec} from '../helpers.mjs';

const dir=await temporary(),runtime=path.join(dir,'runtime');await fs.mkdir(path.join(runtime,'client'),{recursive:true});
for(const name of ['runtime.mjs','ie-mail.mjs','auth.mjs','personnel.mjs','server.mjs','supplier-gateway.mjs','employee-gateway.mjs','agent-schedules.mjs','supplier-catalog-job.mjs','fixed-scheduler.mjs','fixed-schedule.mjs'])await fs.copyFile(path.join(root,'standalone',name),path.join(runtime,name));
await fs.cp(path.join(root,'standalone/schedule-engine'),path.join(runtime,'schedule-engine'),{recursive:true});
await fs.writeFile(path.join(runtime,'client/index.html'),'Synthetic CLI owner account integration');
await build({absWorkingDir:root,entryPoints:['app/api/workspace/[action]/route.ts'],outfile:path.join(runtime,'workspace-api.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':root},plugins:[{name:'native-cli-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'./runtime.mjs',external:true}));}}]});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^DOON_/i.test(key)));Object.assign(env,{DOON_DATA_DIR:path.join(dir,'data'),DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0'});
const seed=path.join(runtime,'seed.mjs');await fs.writeFile(seed,`
import {db,saveRecords} from './runtime.mjs';import {createAccount} from './auth.mjs';
if(process.env.DOON_SYNTHETIC_ONLY!=='1')throw Error('Synthetic only');
for(const [username,role]of [['owner_admin','admin'],['owner_pmc','pmc'],['test_owner','clerk'],['owner_viewer','viewer']])await createAccount({username,name:'Synthetic '+username,role,orderScope:'all',password:'Synthetic-Only-2026!'},null);
db.prepare('UPDATE local_accounts SET must_change=0').run();
const base={kind:'order',version:1,customer:'SYN',orderNo:'SYN-OWNER',drawing:'SYN-DRAW',color:'Black',lens:'Clear',batch:'',quantity:10,ownerEmail:'',stage:'待下达',sourceStatus:'正式订单',notes:'Preserve original',extra:{original:'untouched'}};
saveRecords([{...base,id:'synthetic-ordinary'},{...base,id:'synthetic-ledger',stage:'生产中',lifecycle:'active',ledger:{columns:{I:'SYN-OWNER',M:'10',BF:'0',AG:'3'},ownerName:'Original sheet owner',sourceRow:4}}]);db.close();
`);execFileSync(process.execPath,[seed],{env,windowsHide:true,stdio:'pipe'});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});assert(![8787,8797].includes(port));
const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,[path.join(runtime,'server.mjs')],{env:{...env,DOON_PORT:String(port)},windowsHide:true,stdio:['ignore','ignore','pipe']});let logs='',exited=false;child.stderr.on('data',b=>logs+=b);const done=new Promise(resolve=>child.on('exit',()=>{exited=true;resolve();}));let db;
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,logs.slice(-1000));
 const clients={};for(const username of ['owner_admin','owner_pmc','owner_viewer']){const state=new StateStore(path.join(dir,username),testCodec());await state.setup(origin,true);const api=new FoundationService(state);await api.login(async()=>({username,password:'Synthetic-Only-2026!'}));clients[username]=api;}
 db=new DatabaseSync(path.join(env.DOON_DATA_DIR,'workspace.sqlite'),{readOnly:true});
 const row=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data),revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
 const input=async body=>{const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify(body));return file;};
 const admin=clients.owner_admin,pmc=clients.owner_pmc,viewer=clients.owner_viewer;
 for(const [index,username]of ['Test_Owner','OWNER_ADMIN','test_owner'].entries()){
  const current=await pmc.orderWrite().update(await input({id:'synthetic-ordinary',patch:{ownerUsername:username}}),String(index+1));assert.equal(current.record.ownerEmail,username.toLowerCase()+'@doon.local');
 }
 assert.equal(row('synthetic-ordinary').stage,'待下达');assert.deepEqual(row('synthetic-ordinary').extra,{original:'untouched'});
 let rev=revision();for(const patch of [{ownerEmail:'test_owner@doon.local'},{ownerUsername:'test_owner@doon.local'},{ownerUsername:'missing_owner'}])await assert.rejects(pmc.orderWrite().update(await input({id:'synthetic-ordinary',patch}),'4'),{code:'INVALID_INPUT'});assert.equal(revision(),rev);
 await assert.rejects(viewer.orderWrite().update(await input({id:'synthetic-ordinary',patch:{ownerUsername:'owner_admin'}}),'4'),{code:'FORBIDDEN'});assert.equal(revision(),rev);
 const tools=pmc.workspaceTools(),selection={orders:[{id:'synthetic-ledger',version:1}],username:'TEST_OWNER'};
 assert.equal((await tools.references('owner')).members.find(m=>m.username==='test_owner').name,'Synthetic test_owner');
 const before=row('synthetic-ledger'),plan=await tools.preview('owner',await input(selection));assert.equal(revision(),rev);
 const payload={...selection,previewHash:plan.previewHash},token=randomUUID();
 const assigned=await tools.save('owner-assign',await input(payload),token);assert.equal(assigned.rows[0].ownerEmail,'test_owner@doon.local');assert.equal(assigned.rows[0].version,2);
 const after=row('synthetic-ledger');assert.deepEqual(after.ledger,before.ledger);assert.equal(after.stage,before.stage);assert.deepEqual(after.extra,before.extra);
 rev=revision();assert.equal((await tools.save('owner-assign',await input(payload),token)).idempotent,true);assert.equal(revision(),rev);
 await assert.rejects(tools.preview('owner',await input(selection)),{code:'CONFLICT'});
 const ordinary=row('synthetic-ordinary'),audits=db.prepare("SELECT data FROM records WHERE kind='audit' AND json_extract(data,'$.targetId')=?").all(ordinary.id).map(r=>JSON.parse(r.data));assert.equal(audits.length,3);assert(audits.every(a=>a.actor==='Synthetic owner_pmc'));assert.equal(audits.at(-1).after.ownerEmail,'test_owner@doon.local');
 console.log('PASS native CLI owner usernames: case-insensitive login, email rejection, PMC permission, readback, batch preview/version/idempotency, audit and original data preservation');
}finally{db?.close();if(!exited){child.kill();await done;}}
