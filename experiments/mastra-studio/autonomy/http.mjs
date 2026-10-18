import http from 'node:http';
import fs from 'node:fs/promises';
import {createStudio} from '../server.mjs';
import {createAutonomyRuntime} from './runtime.mjs';
import {problem} from './store.mjs';
import {PlatformClient} from './platform-client.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const syntheticSource={id:'SYN-PURCHASE-001',version:1,quantity:160,received:100,balanceKnown:true,unit:'件',promisedDate:'2026-10-16',sourceAsOf:'2026-10-17',po:'SYN-PO-001'};
export async function createValidationServer({origin,backendOrigin,dataDir,recipient,deepseekOptions,intervalMs=500,serviceToken}){
 const front=new URL(origin),back=new URL(backendOrigin);
 if(front.hostname!=='127.0.0.1'||back.hostname!=='127.0.0.1'||[front.port,back.port].some(port=>!port||port==='8787')||front.origin===back.origin)throw problem('验证服务必须使用两个独立本机测试端口',400);
 let offset=0;const now=()=>Date.now()+offset;
 await fs.mkdir(dataDir,{recursive:true});const remote=serviceToken?new PlatformClient(path.join(dataDir,'platform-cache.sqlite'),{origin:back.origin,token:serviceToken,now}):null;
 if(remote)await remote.refresh();
 const studio=await createStudio({dataDir,deepseekOptions,createRuntime:options=>createAutonomyRuntime({...options,now,...(remote?{platform:remote,engineOptions:{followupMs:300000}}:{})})});const {engine,platform}=studio;
 offset=platform.store.get('clock','offset')?.value||0;if(!remote)platform.seedSource(syntheticSource);
 const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'};
 const json=(res,status,body)=>{res.writeHead(status,{...security,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 async function user(cookie){const response=await fetch(back.origin+(remote?'/api/agent-platform/identity':'/api/auth/session'),{headers:{Cookie:cookie||''},redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw problem(response.status===401?'请先登录工作台':'身份服务暂不可用',[401,403].includes(response.status)?response.status:503);const value=(await response.json()).user;if(!value)throw problem('请先登录工作台',401);if(value.mustChange||value.role==='supplier')throw problem('当前身份不能进入内部待办',403);return value;}
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!==front.host)throw problem('访问地址未授权',403);const url=new URL(req.url,front.origin);if(url.origin!==front.origin)throw problem('访问地址未授权',403);
   if(!['GET','HEAD','POST'].includes(req.method))throw problem('方法不支持',405);if(req.method==='POST'&&req.headers.origin!==front.origin)throw problem('不允许跨站提交',403);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw problem('验证入口请求过大',413);chunks.push(chunk);}const bytes=Buffer.concat(chunks);
   const body=()=>{try{return JSON.parse(bytes.toString());}catch{throw problem('JSON格式无效',400);}};
   if(url.pathname==='/health')return json(res,200,{ok:true,service:'agent-autonomy-validation',syntheticOnly:true,modelLive:studio.modelLive});
   if(['/agent-inbox.js','/agent-inbox.css'].includes(url.pathname)){
    res.writeHead(200,{...security,'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(await fs.readFile(new URL('.'+url.pathname,import.meta.url)));
   }
   if(url.pathname.startsWith('/api/agent-')){
    const current=await user(req.headers.cookie),admin=current.role==='admin';
    if(remote&&url.pathname.startsWith('/api/agent-platform/')&&!url.pathname.includes('/service/')){const response=await fetch(back.origin+url.pathname+url.search,{method:req.method,headers:{Cookie:req.headers.cookie||'',Origin:back.origin,'Content-Type':'application/json'},body:req.method==='POST'?bytes:undefined,signal:AbortSignal.timeout(8000)});return json(res,response.status,await response.json());}
    if(remote&&['/api/agent-inbox','/api/agent-inbox/decide'].includes(url.pathname)){
     const response=await fetch(back.origin+'/api/agent-platform/'+(url.pathname.endsWith('/decide')?'decide':'inbox'),{method:req.method,headers:{Cookie:req.headers.cookie||'',Origin:back.origin,'Content-Type':'application/json'},body:req.method==='POST'?bytes:undefined,signal:AbortSignal.timeout(8000)});return json(res,response.status,await response.json());
    }
    if(url.pathname==='/api/agent-inbox'&&req.method==='GET')return json(res,200,{identity:current.identity.id,role:current.role,items:platform.inbox(current)});
    if(url.pathname==='/api/agent-inbox/decide'&&req.method==='POST')return json(res,200,platform.decide(current,body()));
    if(!admin)throw problem('运行管理仅管理员可用',403);
    if(url.pathname==='/api/agent-validation/status'&&req.method==='GET')return json(res,200,{...engine.overview(),source:platform.source(syntheticSource.id),modelLive:studio.modelLive,automaticBusinessEvents:!!remote});
    if(url.pathname==='/api/agent-validation/start'&&req.method==='POST'){
     if(remote)throw problem('中台已自动观察业务变化，无需手动启动',400);
     const input=body();if(Object.keys(input).some(key=>key!=='requestId')||typeof input.requestId!=='string'||input.requestId.length>160)throw problem('启动参数无效',400);
     return json(res,200,engine.startCase({sourceId:syntheticSource.id,recipient,requestId:input.requestId}));
    }
    if(url.pathname==='/api/agent-validation/receipt'&&req.method==='POST'){
     const input=body();if(Object.keys(input).some(key=>!['received','expectedVersion'].includes(key)))throw problem('收货参数无效',400);
     if(remote){
      await remote.refresh();const source=platform.source(syntheticSource.id);if(input.expectedVersion!==source.version||!Number.isFinite(input.received)||input.received<=source.received||input.received>source.quantity)throw problem('收货来源或数量已变化');
      const response=await fetch(back.origin+'/api/workspace/purchase-receipt',{method:'POST',headers:{Cookie:req.headers.cookie||'',Origin:back.origin,'Content-Type':'application/json'},body:JSON.stringify({id:source.id,version:source.version,type:'receipt',quantity:input.received-source.received,date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),reference:'SYN-RECEIPT-'+randomUUID().slice(0,8),note:'隔离链路验证合成收货，不连接正式业务',token:randomUUID()}),signal:AbortSignal.timeout(10000)});if(!response.ok)return json(res,response.status,await response.json());await remote.refresh();return json(res,200,{ok:true,syntheticOnly:true,source:platform.source(source.id)});
     }
     const source=platform.recordReceipt(syntheticSource.id,input);engine.changedSource(source.id);return json(res,200,{ok:true,syntheticOnly:true,source});
    }
    if(url.pathname==='/api/agent-validation/advance-clock'&&req.method==='POST'){
     const input=body();if(Object.keys(input).some(key=>key!=='seconds')||!Number.isInteger(input.seconds)||input.seconds<0||input.seconds>3600)throw problem('验证时钟参数无效',400);
     offset+=input.seconds*1000;platform.store.put('clock',{id:'offset',value:offset});return json(res,200,{ok:true,syntheticClock:true});
    }
    throw problem('接口不存在',404);
   }
   if(url.pathname==='/studio'||url.pathname.startsWith('/studio/')){
    const current=await user(req.headers.cookie);if(current.role!=='admin')throw problem('Agent Studio仅对管理员开放',403);
    if(!['GET','HEAD'].includes(req.method))throw problem('此入口观察后台任务，不能通过聊天或资源接口修改任务',403);
    const response=await studio.handle(new Request(url,{method:req.method,headers:{}}));res.writeHead(response.status,{...security,...Object.fromEntries(response.headers)});return res.end(Buffer.from(await response.arrayBuffer()));
   }
   const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined&&!['host','connection','content-length','accept-encoding'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
   if(req.method==='POST')headers.set('origin',back.origin);
   const upstream=await fetch(back.origin+url.pathname+url.search,{method:req.method,headers,body:req.method==='POST'?bytes:undefined,redirect:'manual'});
   const outgoing={...security,...Object.fromEntries(upstream.headers)};delete outgoing['content-length'];delete outgoing['content-encoding'];let responseBytes=Buffer.from(await upstream.arrayBuffer());
   if(upstream.headers.get('content-type')?.includes('text/html')&&!responseBytes.toString().includes('/agent-workbench-inbox.js?platform=native'))responseBytes=Buffer.from(responseBytes.toString().replace('</body>','<script type="module" src="/agent-inbox.js"></script></body>'));
   res.writeHead(upstream.status,outgoing);res.end(req.method==='HEAD'?undefined:responseBytes);
  }catch(error){if(res.headersSent||res.destroyed)return;json(res,error.status||503,{error:error.status?error.message:'验证服务暂不可用，请稍后重试'});}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 return{server,studio,engine,platform,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(front.port),'127.0.0.1',resolve);});engine.start(intervalMs);},async close(){engine.stop();await new Promise(resolve=>server.close(resolve));await studio.close();remote?.close();}};
}
