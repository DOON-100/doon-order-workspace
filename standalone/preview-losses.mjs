// Isolated HTTP test workspace for browser acceptance; never uses the live database.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';
const root=await fs.mkdtemp(path.resolve('test-output/loss-preview-')),dist=path.resolve('test-output/loss-build'),port=18790,origin='http://127.0.0.1:'+port,env={...process.env,DOON_DATA_DIR:root,DOON_HOST:'0.0.0.0',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe'});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe'});server.stderr.on('data',b=>process.stderr.write(b));server.stdout.on('data',()=>{});
let cookie='';async function api(route,body){const r=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),Cookie:cookie},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Loss-Preview-Admin-2026!'});
 await api('auth/accounts',{username:'lossqa',name:'胶架损耗验收',role:'clerk',departments:['plastic'],password:'Loss-Preview-User-2026!',customers:[]});
 const sheet={I3:{t:'s',v:'订单号'},M3:{t:'s',v:'订单数量'},BF3:{t:'s',v:'包装入仓数量'}};
 for(let r=4;r<7;r++)for(const [c,v] of Object.entries({I:'LOSS-DEMO-'+(r-3),J:'DN-LOSS-'+r,C:'测试客户',H:'白片',L:'C1',M:200,N:220,AV:220,AX:210,BD:204,BF:0}))sheet[c+r]={t:typeof v==='number'?'n':'s',v};sheet['!ref']='A1:BF6';
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'动态表');const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'损耗验收测试.xlsx'));form.set('mode','active');const job=await api('workspace/ledger-preview',form);await api('workspace/ledger-commit',{id:job.id,offset:0});
 const data=await api('workspace/data'),o=data.orders[1],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
 await api('workspace/loss-record',{lineId:o.id,version:o.version,process:'assembly',department:'plastic',input:210,wip:0,reportDate:today,reason:'验收测试：钉装破损六副',token:crypto.randomUUID()});
 const ex=await fetch(origin+'/api/workspace/loss-export?month='+today.slice(0,7),{headers:{Cookie:cookie}});assert.equal(ex.status,200);await fs.writeFile(path.join(root,'部门损耗验收月报.xlsx'),new Uint8Array(await ex.arrayBuffer()));
 cookie='';await api('auth/login',{username:'lossqa',password:'Loss-Preview-User-2026!'});await api('auth/password',{currentPassword:'Loss-Preview-User-2026!',password:'Loss-Preview-Personal-2026!'});
 await fs.writeFile(path.resolve('test-output/loss-preview-status.json'),JSON.stringify({root,port,origin,pid:server.pid}));console.log(JSON.stringify({root,origin,pid:server.pid,ready:true}));
 await new Promise(resolve=>server.on('exit',resolve));
}catch(e){server.kill();throw e;}
