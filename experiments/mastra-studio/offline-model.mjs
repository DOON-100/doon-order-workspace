// Same deterministic AI SDK v2 protocol used in P0; no provider / network calls.
export function localModel(reply){
 const generate=async options=>{
  const content=await reply(options);
  return{content,finishReason:content.some(part=>part.type==='tool-call')?'tool-calls':'stop',usage:{inputTokens:1,outputTokens:1,totalTokens:2},warnings:[]};
 };
 return{specificationVersion:'v2',provider:'doon-offline-synthetic',modelId:'scripted-studio-v1',supportedUrls:{},doGenerate:generate,
  doStream:async options=>{
   const result=await generate(options);
   return{stream:new ReadableStream({start(controller){
    controller.enqueue({type:'stream-start',warnings:[]});
    for(const [index,part] of result.content.entries()){
     if(part.type==='text'){
      const id=`synthetic-${index}`;
      controller.enqueue({type:'text-start',id});controller.enqueue({type:'text-delta',id,delta:part.text});controller.enqueue({type:'text-end',id});
     }else controller.enqueue(part);
    }
    controller.enqueue({type:'finish',finishReason:result.finishReason,usage:result.usage});controller.close();
   }})};
  }};
}
