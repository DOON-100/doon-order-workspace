import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {traceQueryResponseSchema} from '@mastra/core/storage';
import {LibSQLStore} from '@mastra/libsql';
import http from 'node:http';
import {createAgentServer} from '../agent-server/http-server.mjs';
import {createStudio} from './server.mjs';

const trace={traceId:'synthetic-trace',rootSpanId:'synthetic-root',name:'合成轨迹',entityId:'procurement',parentSpanId:null,createdAt:'2026-10-17T00:00:00.000Z',metadata:null,inputPreview:'合成输入',outputPreview:'合成输出',errorPreview:null,threadId:'synthetic-thread',resourceId:'synthetic-resource',startedAt:'2026-10-17T00:00:00.000Z',endedAt:'2026-10-17T00:00:01.000Z',entityName:'合成采购 Agent',entityType:'agent',environment:null,status:'success'};

test('轨迹响应保留 PostgreSQL 的输出/错误预览，并通过实际 Hono 响应校验',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-observability-contract-'));
 const studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
 try{
  const store=await studio.storage.getStore('observability');
  store.getFeatures=()=>['trace-query','delta-polling'];
  const variants=[
   {request:{page:{limit:10}},response:{traces:[trace],page:{next:null}}},
   {request:{pagination:{page:0,perPage:10}},response:{traces:[{...trace,status:'error',outputPreview:null,errorPreview:'合成错误'}],pagination:{total:1,page:0,perPage:10,hasMore:false}}},
  ];
  for(const {request,response:expected} of variants){
   assert(traceQueryResponseSchema.safeParse(expected).success,'锁定的 core 必须支持当前 PostgreSQL 返回结构');
   store.queryTraces=async()=>structuredClone(expected);
   const response=await studio.handle(new Request('http://127.0.0.1:19897/studio/api/observability/traces/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timeRange:{from:'2026-10-16T00:00:00.000Z',to:'2026-10-18T00:00:00.000Z'},...request})}));
   assert.equal(response.status,200);
   const actual=await response.json();
   assert.deepEqual(actual,expected);
  }
  assert.equal(traceQueryResponseSchema.safeParse({traces:[{...trace,unexpectedField:'invalid'}],page:{next:null}}).success,false,'不能通过关闭严格校验掩盖契约不兼容');
 }finally{await studio.close();await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});

test('真实只读 HTTP 入口允许轨迹和指标 POST 查询，保留身份隔离、撤权、Origin 和历史写保护',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-live-observability-'));
 const studios={};let revoked=false,server,reads=0;
 try{
  for(const id of ['A','B']){
   const storage=new LibSQLStore({id:'SYN-observability-'+id,url:'file:'+path.join(dir,id+'.sqlite').replaceAll('\\','/')});
   const studio=studios[id]=await createStudio({dataDir:path.join(dir,id),storage,cloud:true,liveReadOnly:true,scopeId:'SYN-'+id,deepseekOptions:{env:{}}});
   const store=await storage.getStore('observability');store.getFeatures=()=>['trace-query','metrics'];
   store.queryTraces=async()=>{reads++;return{traces:[{...trace,traceId:'SYN-'+id}],page:{next:null}};};
   store.getMetricBreakdown=async()=>{reads++;return{groups:[]};};
  }
  server=createAgentServer({publicOrigin:'https://synthetic.test',syntheticOnly:false,authenticate:async cookie=>!revoked&&studios[cookie]?{username:cookie,role:'programmer',mustChange:false}:null,acquireRuntime:async user=>({studio:studios[user.username],release(){}})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=(route,body={},cookie='A',method='POST',origin='https://synthetic.test')=>new Promise((resolve,reject)=>{
   const payload=JSON.stringify(body);
   const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/studio/api/observability/'+route,method,headers:{Host:'synthetic.test',Origin:origin,Cookie:cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(error){reject(error);}});res.on('error',reject);});req.on('error',reject);req.end(payload);
  });
  const query={timeRange:{from:'2026-10-16T00:00:00.000Z',to:'2026-10-18T00:00:00.000Z'},page:{limit:10}};
  for(const id of ['A','B']){const result=await call('traces/query',query,id);assert.equal(result.status,200);assert.deepEqual(result.body.traces.map(t=>t.traceId),['SYN-'+id]);}
  assert.equal((await call('metrics/breakdown',{name:['SYN.metric'],groupBy:['entityName'],aggregation:'sum'})).status,200);
  assert.equal((await call('traces/query',{timeRange:'invalid'})).status,422,'SDK 必须继续校验查询参数');
  const prior=reads;
  for(const [route,method] of [['traces/delete','POST'],['traces/score','POST'],['scores','POST'],['scores','DELETE'],['feedback','POST'],['feedback','DELETE'],['feedback/SYN/review-status','PATCH'],['traces/query/delete','POST'],['metrics/breakdown','DELETE'],['unknown/query','POST']])assert.equal((await call(route,{},'A',method)).status,403,route);
  assert.equal((await call('traces/query',query,'A','POST','https://foreign.test')).status,403);
  assert.equal((await call('traces/query',query,'anonymous')).status,401);
  revoked=true;assert.equal((await call('traces/query',query)).status,401);assert.equal(reads,prior,'被拒绝的请求不能触达存储');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await Promise.all(Object.values(studios).map(studio=>studio.close()));
  await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});
 }
});
