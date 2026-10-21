import http from 'node:http';
import fs from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parsePublicOrigin,canEnterStudio,SessionCheckError} from './session.mjs';
import {withModelAccess} from '../mastra-studio/model-scheduler.mjs';

export function createAgentServer({publicOrigin,studio,staticStudio,authenticate,acquireRuntime,businessAccess,processChanges,purchaseChanges,withAccess=(_,operation)=>operation(),syntheticOnly=true,health=async()=>true,schedulerStatus,maxActive=Infinity}){
 const origin=parsePublicOrigin(publicOrigin);let active=0;
 const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 const server=http.createServer(async(req,res)=>{
  let counted=false,lease;
  try{
   if(req.url==='/health'&&req.method==='GET'){const ok=await health();return json(res,ok?200:503,{ok,syntheticOnly,...(schedulerStatus?{scheduler:schedulerStatus()}: {})});}
   if(req.headers.host!==origin.host)return json(res,403,{error:'访问地址未获授权。'});
   const url=new URL(req.url,origin.origin);
   if(url.origin!==origin.origin)return json(res,403,{error:'访问地址未获授权。'});
   if(url.pathname==='/agent-studio-entry.js'&&['GET','HEAD'].includes(req.method)){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return res.end(req.method==='HEAD'?undefined:await fs.readFile(new URL('./entry.js',import.meta.url)));
   }
   if(url.pathname!=='/studio'&&!url.pathname.startsWith('/studio/'))return json(res,404,{error:'Not found'});
   if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(req.method))return json(res,405,{error:'不支持的请求方法。'});
   if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin.origin)return json(res,403,{error:'不允许跨站提交。'});
   const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});
   const user=await authenticate(req.headers.cookie||'',{signal:controller.signal});
   if(controller.signal.aborted)return;
   if(!user){
    if(req.method==='GET'&&['/studio','/studio/'].includes(url.pathname)){res.writeHead(302,{Location:'/login','Cache-Control':'no-store'});return res.end();}
    res.setHeader('X-Doon-Auth-Status','expired');return json(res,401,{error:'登录已失效，请先登录数据台。',code:'AUTH_EXPIRED'});
   }
   if(!canEnterStudio(user)){res.setHeader('X-Doon-Auth-Status','forbidden');return json(res,403,{error:'agent 工作台仅限已完成改密的内部账号。',code:'AUTH_FORBIDDEN'});}
   const generation=/\/agents\/[^/]+\/(stream|generate|send-message|stream-network|network)(\/|$)/.test(url.pathname);
   if(generation){if(active>=maxActive)return json(res,429,{error:'当前模型验证并发已满，请稍后重试。'});active++;counted=true;}
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined&&!['cookie','authorization','host','connection','content-length'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
   let body;
   if(!['GET','HEAD'].includes(req.method)){const chunks=[];let size=0,tooLarge=false;for await(const chunk of req){size+=chunk.length;if(size>512*1024){tooLarge=true;continue;}if(!tooLarge)chunks.push(chunk);}if(tooLarge)return json(res,413,{error:'工作台请求超过大小限制。'});body=Buffer.concat(chunks);}
   const actor={id:String(user.identity?.id||user.username),name:user.identity?.name||user.username,role:user.role};
   const changes=processChanges?.({cookie:req.headers.cookie||'',user}),purchases=purchaseChanges?.({cookie:req.headers.cookie||'',user});
   const access=businessAccess?.({cookie:req.headers.cookie||'',user,...(changes?{stageProcessDraft:draft=>changes.stage(draft)}:{}),...(purchases?{stagePurchaseDraft:draft=>purchases.stage(draft)}:{})});
   const modelOwner=actor.id,modelRole=user.role,modelCookie=req.headers.cookie||'';
   const modelAccess={owner:modelOwner,authorize:async()=>{
    const current=await authenticate(modelCookie);
    if(!canEnterStudio(current)||String(current.identity?.id||current.username)!==modelOwner||current.role!==modelRole)throw new Error('Model authorization changed');
   }};
   const request=new Request(url,{method:req.method,headers,body,signal:controller.signal});
   let response=await staticStudio?.handle(request);
   const isStatic=!!response;
   if(!response){
    lease=acquireRuntime?await acquireRuntime(user):null;
    response=await withModelAccess(modelAccess,()=>withAccess(access,()=>(lease?.studio||studio).handle(request,{actor,...(access?{workflowAccess:access}:{}),...(changes?{processChanges:changes}:{}),...(purchases?{purchaseChanges:purchases}:{})})));
   }
   const outgoing=Object.fromEntries(response.headers);outgoing['X-Doon-Auth-Status']='verified';if(!isStatic){delete outgoing['cache-control'];outgoing['Cache-Control']='no-store';}outgoing['X-Content-Type-Options']='nosniff';outgoing['X-Frame-Options']='DENY';outgoing['Referrer-Policy']='no-referrer';
   // Both the direct stream and Studio's long-lived thread subscription must
   // reach the client incrementally, including before the first model token.
   const streaming=/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type')||'')||/\/agents\/[^/]+\/stream\/?$/.test(url.pathname);
   if(streaming){
    outgoing['Cache-Control']='no-store, no-transform';
    outgoing['X-Accel-Buffering']='no';
    delete outgoing['content-length'];
   }
   delete outgoing['set-cookie'];res.writeHead(response.status,outgoing);
   if(streaming)res.flushHeaders();
   if(req.method==='HEAD'||!response.body)return res.end();
   await pipeline(Readable.fromWeb(response.body),res);
  }catch(error){
   if(res.destroyed||res.headersSent){res.destroy();return;}
   if(error instanceof SessionCheckError){
    const forbidden=error.code==='AUTH_FORBIDDEN';res.setHeader('X-Doon-Auth-Status',forbidden?'forbidden':'temporary');
    // Initial navigation offers recovery without cached protected UI or a login redirect.
    if(req.method==='GET'&&String(req.headers.accept||'').includes('text/html')){
     res.writeHead(forbidden?403:503,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"});
     return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>工作台登录状态</title><main style="max-width:36rem;margin:15vh auto;padding:24px;font:18px/1.8 system-ui"><h1>暂时无法打开工作台</h1><p>'+error.message+'</p><p>请勿重复提交业务操作。</p><a href="/studio/">重新检查并打开工作台</a></main></html>');
    }
    return json(res,forbidden?403:503,{error:error.message,code:error.code});
   }
   // Do not serialize upstream responses, cookies, user objects or error stacks.
   json(res,error.status===429?429:503,{error:error.status===429?'工作台当前使用人数已满，请稍后重试。':'agent 工作台暂时不可用，请稍后重试。'});
  }finally{lease?.release();if(counted)active--;}
 });
 server.requestTimeout=120000;server.headersTimeout=10000;server.keepAliveTimeout=5000;return server;
}
