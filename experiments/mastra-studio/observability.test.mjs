import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {traceQueryResponseSchema} from '@mastra/core/storage';
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
