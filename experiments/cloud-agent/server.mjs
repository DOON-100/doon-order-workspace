import http from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {createRuntime} from './runtime.mjs';

const token=readFileSync('/run/secrets/api_token','utf8').trim();
if(token.length<32)throw new Error('Validation token required');
const runtime=await createRuntime();
let busy=false;
const server=http.createServer(async(req,res)=>{
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,syntheticOnly:true});
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return send(401,{error:'unauthorized'});
 if(req.headers.origin)return send(403,{error:'server-to-server API only'});
 if(busy)return send(429,{error:'validation busy'});
 busy=true;
 try{
  let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4096)return send(413,{error:'body too large'});}
  const input=text?JSON.parse(text):{};
  if(req.method==='POST'&&req.url==='/agent/run'){
   const threadId='SYN-CLOUD-'+randomUUID();
   const result=await runtime.supervisor.generate('Check synthetic overdue order and delegate procurement',{memory:{thread:threadId,resource:'cloud-validation'},maxSteps:4});
   await runtime.observability.flush();
   return send(200,{syntheticOnly:true,threadId,text:result.text,sent:false});
  }
  if(req.method==='POST'&&req.url==='/workflow/start'){
   const run=await runtime.humanReview.createRun();const result=await run.start({inputData:{caseId:'SYN-CLOUD-001'}});
   await runtime.observability.flush();return send(200,{runId:run.runId,status:result.status});
  }
  if(req.method==='POST'&&req.url==='/workflow/resume'){
   if(!/^[a-f0-9-]{36}$/.test(input.runId)||!['approve','reject','standby'].includes(input.decision))return send(400,{error:'invalid synthetic decision'});
   const run=await runtime.humanReview.createRun({runId:input.runId});
   const result=await run.resume({step:'approval',resumeData:{decision:input.decision}});
   await runtime.observability.flush();return send(200,{runId:run.runId,status:result.status,result:result.result});
  }
  if(req.method==='POST'&&req.url==='/verify/persistence'){
   if(!/^SYN-CLOUD-[a-f0-9-]{36}$/.test(input.threadId))return send(400,{error:'invalid thread'});
   const messages=await runtime.mem.listMessages({threadId:input.threadId,perPage:100,page:0});
   const run=await runtime.humanReview.getWorkflowRunById(input.runId);
   return send(200,{messageCount:messages.messages.length,workflowStatus:run?.status});
  }
  if(req.method==='GET'&&req.url==='/observability'){
   await runtime.observability.flush();
   const metrics=await runtime.signals.listMetrics({pagination:{page:0,perPage:100}});
   const traces=await runtime.signals.listTraces({pagination:{page:0,perPage:100}});
   const names=[...new Set(metrics.metrics.map(m=>m.name))];
   const aggregate=names.length?await runtime.signals.getMetricAggregate({name:[names[0]],aggregation:'count'}):null;
   return send(200,{metricsSupported:runtime.signals.getFeatures().includes('metrics'),metricCount:metrics.pagination?.total??metrics.metrics.length,metricNames:names,aggregate,traceCount:traces.pagination?.total??traces.spans?.length??traces.traces?.length??0});
  }
  send(404,{error:'not found'});
 }catch(error){console.error(JSON.stringify({event:'request-failed',name:error.name,code:error.code||'request_failed'}));send(500,{error:'validation request failed'});}finally{busy=false;}
});
server.requestTimeout=30000;server.headersTimeout=10000;
server.listen(8798,'0.0.0.0',()=>console.log(JSON.stringify({event:'ready',syntheticOnly:true,port:8798})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await runtime.close();process.exit(0);}));
