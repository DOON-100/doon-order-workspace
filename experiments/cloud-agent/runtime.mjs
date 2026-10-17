import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Mastra} from '@mastra/core';
import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {createStep,createWorkflow} from '@mastra/core/workflows';
import {PostgresStoreVNext} from '@mastra/pg';
import {Memory} from '@mastra/memory';
import {Observability,MastraStorageExporter} from '@mastra/observability';
import {z} from 'zod';
import {localModel} from '../mastra-studio/offline-model.mjs';

export async function createRuntime(){
 if(process.env.SYNTHETIC_ONLY!=='1')throw new Error('Synthetic validation only');
 const connection={host:'postgres',port:5432,user:'doon_agent',password:readFileSync('/run/secrets/pg_agent_password','utf8').trim(),max:3,idleTimeoutMillis:10000};
 const storage=new PostgresStoreVNext({id:'cloud-validation',...connection,database:'doon_agent_validation',observability:{...connection,database:'doon_agent_observability',schemaName:'agent_signals'}});
 const inspect=createTool({id:'inspect-synthetic',description:'Read one fixed synthetic overdue order only',inputSchema:z.object({}).strict(),execute:async()=>({syntheticOnly:true,orderId:'SYN-CLOUD-001',missing:30,overdue:true})});
 const draft=createTool({id:'draft-synthetic',description:'Prepare a synthetic reminder without sending',inputSchema:z.object({}).strict(),execute:async()=>({syntheticOnly:true,orderId:'SYN-CLOUD-001',sent:false,draft:'Synthetic supplier reminder: missing 30. Please confirm delivery date.'})});
 const model=delegating=>localModel(async({prompt})=>{
  const recent=prompt.slice(prompt.findLastIndex(m=>m.role==='user')+1).filter(m=>m.role==='tool').flatMap(m=>m.content||[]);
  const tool=recent.length===0?'inspect':!recent.some(r=>r.toolName===(delegating?'delegate':'draft'))?(delegating?'delegate':'draft'):null;
  return tool?[{type:'tool-call',toolCallId:randomUUID(),toolName:tool,input:'{}'}]:[{type:'text',text:'SYN-CLOUD-001: missing 30; synthetic draft prepared. No message sent. Scripted model; no real LLM reasoning verified.'}];
 });
 const memory=()=>new Memory({storage,options:{lastMessages:12,generateTitle:false,semanticRecall:false,workingMemory:{enabled:false}}});
 const procurement=new Agent({id:'procurement',name:'Synthetic procurement',instructions:'Synthetic only. Never send messages.',model:model(false),tools:{inspect,draft},memory:memory()});
 const delegate=createTool({id:'delegate-synthetic',description:'Delegate synthetic procurement check',inputSchema:z.object({}).strict(),execute:async()=>({syntheticOnly:true,result:(await procurement.generate('Check synthetic overdue order',{maxSteps:4})).text})});
 const supervisor=new Agent({id:'supervisor',name:'Synthetic supervisor',instructions:'Synthetic only. Delegate procurement and return a draft.',model:model(true),tools:{inspect,delegate},memory:memory()});
 const approval=createStep({id:'approval',inputSchema:z.object({caseId:z.string()}),outputSchema:z.object({caseId:z.string(),decision:z.enum(['approve','reject']),sent:z.literal(false)}),resumeSchema:z.object({decision:z.enum(['approve','reject','standby'])}),suspendSchema:z.object({caseId:z.string(),awaitingHuman:z.literal(true)}),execute:async({inputData,resumeData,suspend})=>{
  if(!resumeData||resumeData.decision==='standby')return suspend({caseId:inputData.caseId,awaitingHuman:true});
  return{caseId:inputData.caseId,decision:resumeData.decision,sent:false};
 }});
 const humanReview=createWorkflow({id:'cloud-synthetic-human-review',inputSchema:approval.inputSchema,outputSchema:approval.outputSchema}).then(approval).commit();
 const observability=new Observability({configs:{cloud:{serviceName:'doon-cloud-validation',exporters:[new MastraStorageExporter({maxBatchWaitMs:200})]}}});
 const mastra=new Mastra({agents:{supervisor,procurement},workflows:{humanReview},storage,observability,logger:false});
 await storage.init();
 const signals=await storage.getStore('observability'),mem=await storage.getStore('memory');
 return {storage,mastra,observability,supervisor,humanReview,signals,mem,async close(){await observability.shutdown();await mastra.shutdown();await storage.close();}};
}
