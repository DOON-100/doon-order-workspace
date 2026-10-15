import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {z} from 'zod';
import {makeScriptedModel} from './mock-model.mjs';
import {syntheticSession,readOrdersFromApi} from './server.mjs';
import {recordSuggestion} from './suggestions.mjs';
import {draftForOrder} from './rules.mjs';

export async function generateSyntheticSuggestions({origin,adapter,store,actorId}) {
  const cookie=await syntheticSession(origin,actorId);
  const actor=adapter.actor(actorId), runId=`syn-run-${actorId}-20261015`;
  let observedOrders,readCount=0,createdCount=0;
  const readOrders=createTool({id:'read-authorized-synthetic-orders',description:'Read only the current synthetic employee\'s authorized order fields.',
    inputSchema:z.object({}).strict(),
    execute:async()=>{const response=await readOrdersFromApi(origin,cookie);observedOrders=response.items;readCount++;return response;},
  });
  const suggest=createTool({id:'record-synthetic-suggestion',description:'Record a review suggestion in the separate synthetic sandbox only.',
    inputSchema:z.object({sourceId:z.string().startsWith('syn-order-'),sourceVersion:z.number().int().positive(),rule:z.enum(['confirm-date','review-plan','review-past-date'])}).strict(),
    execute:async input=>{
      const result=recordSuggestion({adapter,store,actorId,...input,runId});
      if(result.created)createdCount++;
      return result;
    },
  });
  // Deliberately scripted; proves actual SDK/tool/HTTP plumbing, not LLM judgement.
  const model=makeScriptedModel(({callIndex})=>{
    if(callIndex===0)return {toolCalls:[{name:'readOrders',args:{}}]};
    if(callIndex===1 && observedOrders) {
      const drafts=observedOrders.flatMap(order=>{const draft=draftForOrder(order);return draft?[{name:'suggest',args:{sourceId:order.id,sourceVersion:order.version,rule:draft.rule}}]:[];});
      if(drafts.length)return {toolCalls:drafts};
    }
    return '合成检查完成，建议仅供员工查看。';
  });
  const agent=new Agent({id:`synthetic-${actor.id}`,name:'合成交期跟进助手',instructions:'读取授权订单，生成有来源的合成建议。不得修改订单。',model,tools:{readOrders,suggest}});
  const output=await agent.generate('运行一次合成交期检查。',{maxSteps:4});
  if(output.error || output.finishReason!=='stop' || readCount!==1)throw new Error('合成 Agent 工具链未正常完成');
  return {actorId,runId,created:createdCount,modelCalls:model.calls.length,readCalls:readCount,model:'scripted-offline-v1',synthetic:true};
}
