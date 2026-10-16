import {open, readFile, rename, unlink, realpath, lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';

export const limits = Object.freeze({budgetCny:10, requests:32, outputTokens:4096, bodyBytes:65536});
export const p1AttemptRequestLimit = 8;
/** Share one guard across both synthetic actors; reject before transport reservation. */
export function createP1AttemptRequestGuard() {
  let requests=0;
  return ()=>{
    if(requests>=p1AttemptRequestLimit)throw new Error('P1_ATTEMPT_REQUEST_LIMIT');
    requests++;
  };
}
// Official CNY peak rates; count every input token as an uncached token.
export const rates = Object.freeze({inputPerMillion:9, outputPerMillion:27});
const sha = value => createHash('sha256').update(value).digest('hex');
const roundUp = value => Math.ceil(value*1e6)/1e6;
const cost = (input, output) => roundUp((input*rates.inputPerMillion+output*rates.outputPerMillion)/1e6);
const samePath = (left,right) => process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;

async function regularRunFile(root,name) {
  const file=path.resolve(root,name);
  if(typeof name!=='string' || path.basename(name)!==name || !samePath(path.dirname(file),root))throw new Error('P2_RUN_PATH_REJECTED');
  let stat;
  try {stat=await lstat(file);}catch(error){if(error.code==='ENOENT')return file;throw error;}
  if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || !samePath(await realpath(file),file))throw new Error('P2_RUN_LINK_REJECTED');
  return file;
}

async function readRunMarker(root) {
  const marker=JSON.parse(await readFile(path.join(root,'run.json'),'utf8'));
  if(marker.application!=='doon-mastra-p2' || marker.syntheticOnly!==true || ![5,10].includes(marker.budgetCny) || marker.budgetCny>limits.budgetCny || Object.keys(marker).length!==3)throw new Error('P2_RUN_MARKER_REJECTED');
  return marker;
}

export async function validateRun(directory, expectedBudgetCny) {
  const root=path.resolve(directory), temp=await realpath(os.tmpdir());
  if(!samePath(path.dirname(root),temp) || !/^doon-mastra-p2-[a-zA-Z0-9]+$/.test(path.basename(root))) throw new Error('P2_RUN_PATH_REJECTED');
  const stat=await lstat(root);
  if(!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(root),root)) throw new Error('P2_RUN_LINK_REJECTED');
  for(const name of ['run.json','budget.json','budget.pending','budget.lock']) {
    await regularRunFile(root,name);
  }
  const marker=await readRunMarker(root);
  if(expectedBudgetCny!==undefined && marker.budgetCny!==expectedBudgetCny)throw new Error('P2_RESUME_BUDGET_MISMATCH');
  return root;
}

/** Atomically write JSON inside a marked run; never truncate an existing link target. */
export async function writeRunJson(directory,filename,value) {
  if(typeof filename!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename))throw new Error('P2_RUN_PATH_REJECTED');
  const root=await validateRun(directory), target=await regularRunFile(root,filename);
  const json=JSON.stringify(value,null,2);
  if(typeof json!=='string')throw new Error('P2_JSON_VALUE_REJECTED');
  const temporaryName='.p2-write-'+randomUUID()+'.tmp', temporary=path.join(root,temporaryName);
  let handle,created=false;
  try {
    handle=await open(temporary,'wx',0o600);
    created=true;
    await handle.writeFile(json+'\n','utf8');
    await handle.sync();
    await handle.close();handle=undefined;
    await validateRun(root);
    await regularRunFile(root,filename);
    await regularRunFile(root,temporaryName);
    await rename(temporary,target);
    created=false;
  } finally {
    if(handle)await handle.close();
    if(created)try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

async function updateLedger(directory, change) {
  const root=await validateRun(directory), file=path.join(root,'budget.json'), lockPath=path.join(root,'budget.lock');
  const lock=await open(lockPath,'wx'); // A crashed writer leaves a lock: fail closed, never reset the budget.
  try {
    const marker=await readRunMarker(root);
    let ledger;
    try {ledger=JSON.parse(await readFile(file,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;ledger={format:1,budgetCny:marker.budgetCny,rates,entries:[]};}
    if(ledger.format!==1 || ledger.budgetCny!==marker.budgetCny || ledger.budgetCny>limits.budgetCny || JSON.stringify(ledger.rates)!==JSON.stringify(rates) || !Array.isArray(ledger.entries))throw new Error('P2_LEDGER_INVALID');
    const result=change(ledger);
    ledger.chargedUpperCny=roundUp(ledger.entries.reduce((sum,item)=>sum+item.chargedCny,0));
    await writeRunJson(root,'budget.json',ledger);
    return result;
  } finally {await lock.close();await unlink(lockPath);}
}

function requestMetadata(body) {
  return (body.messages||[]).filter(message=>message.role==='assistant' && typeof message.reasoning_content==='string' && message.reasoning_content.length)
    .map(message=>({characters:message.reasoning_content.length,sha256:sha(message.reasoning_content),toolCallIds:(message.tool_calls||[]).map(call=>call.id)}));
}

function responseMetadata(text, stream) {
  const objects=stream?text.split(/\r?\n/).filter(line=>line.startsWith('data:')&&line.slice(5).trim()!=='[DONE]').map(line=>JSON.parse(line.slice(5))):[JSON.parse(text)];
  let usage,reasoning='',toolCalls=0;
  for(const object of objects) {
    if(object.usage)usage=object.usage;
    for(const choice of object.choices||[]) {
      const message=choice.message||choice.delta||{};
      reasoning+=message.reasoning_content||'';
      toolCalls+=(message.tool_calls||[]).filter(call=>call.id).length;
    }
  }
  return {usage,reasoning:reasoning?{characters:reasoning.length,sha256:sha(reasoning)}:null,toolCalls};
}

/** No request/response text, headers, key, or reasoning is written to the ledger. */
export function createGuardedFetch({directory,thinking,caseId,phase,fetchImpl=globalThis.fetch}) {
  if(!['enabled','disabled'].includes(thinking) || !/^[a-z0-9-]+$/.test(caseId) || !/^[a-z]+$/.test(phase))throw new Error('P2_CASE_INVALID');
  return async (input,init={})=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin!=='https://api.deepseek.com' || url.pathname!=='/chat/completions' || url.search || url.hash || url.username || url.password || init.method!=='POST')throw new Error('P2_ENDPOINT_REJECTED');
    if(typeof init.body!=='string' || Buffer.byteLength(init.body)>limits.bodyBytes)throw new Error('P2_REQUEST_SIZE_REJECTED');
    const body=JSON.parse(init.body);
    if((body.stream!==undefined && typeof body.stream!=='boolean') || (body.reasoning_effort!==undefined && (thinking==='disabled' || body.reasoning_effort!=='high')))throw new Error('P2_PROTOCOL_CONFIG_REJECTED');
    if(body.model!=='deepseek-v4-pro' || body.thinking?.type!==thinking || !Array.isArray(body.messages) || !body.messages.length || body.tool_choice!=='auto')throw new Error('P2_PROTOCOL_CONFIG_REJECTED');
    if(!Number.isInteger(body.max_tokens) || body.max_tokens<1 || body.max_tokens>limits.outputTokens)throw new Error('P2_OUTPUT_LIMIT_REJECTED');
    const inputUpper=Buffer.byteLength(init.body)*4+4096;
    const reservedCny=roundUp(cost(inputUpper,body.max_tokens)*1.25);
    const id=await updateLedger(directory,ledger=>{
      if(ledger.budgetViolation || ledger.entries.some(item=>!Number.isFinite(item.chargedCny)||item.chargedCny<0))throw new Error('P2_LEDGER_INVALID');
      if(ledger.entries.length>=limits.requests)throw new Error('P2_REQUEST_LIMIT');
      const used=ledger.entries.reduce((sum,item)=>sum+item.chargedCny,0);
      if(used+reservedCny>ledger.budgetCny)throw new Error('P2_BUDGET_LIMIT');
      const id=ledger.entries.length+1;
      ledger.entries.push({id,caseId,phase,thinking,stream:Boolean(body.stream),startedAt:new Date().toISOString(),state:'reserved',inputUpper,outputUpper:body.max_tokens,reservedCny,chargedCny:reservedCny,requestReasoning:requestMetadata(body)});
      return id;
    });
    const started=Date.now();
    async function finish({status,state,text,stream}) {
      let metadata;
      if(text!==undefined)try{metadata=responseMetadata(text,stream);}catch{/* Keep the full reservation on unknown usage. */}
      await updateLedger(directory,ledger=>{
        const entry=ledger.entries.find(item=>item.id===id);
        entry.state=state;entry.httpStatus=status||null;entry.durationMs=Date.now()-started;
        if(metadata){entry.responseReasoning=metadata.reasoning;entry.responseToolCalls=metadata.toolCalls;}
        const usage=metadata?.usage;
        if(usage && Number.isInteger(usage.prompt_tokens) && usage.prompt_tokens>=0 && Number.isInteger(usage.completion_tokens) && usage.completion_tokens>=0) {
          entry.usage={inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens,cacheHitTokens:usage.prompt_cache_hit_tokens||0};
          const observed=cost(usage.prompt_tokens,usage.completion_tokens);
          if(observed>entry.reservedCny || usage.prompt_tokens>entry.inputUpper || usage.completion_tokens>entry.outputUpper) {
            entry.state='usage-limit-exceeded'; // Keep a conservative charge and stop subsequent work.
            entry.chargedCny=Math.max(observed,entry.reservedCny);ledger.budgetViolation=true;
          } else {entry.chargedCny=observed;entry.usageKnown=true;}
        }
      });
    }
    let response;
    try {
      const signal=init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(180_000)]):AbortSignal.timeout(180_000);
      response=await fetchImpl(input,{...init,signal,redirect:'error'});
    } catch {await finish({state:'network-error'});throw new Error('P2_PROVIDER_NETWORK_ERROR');}
    if(!response.ok){await finish({status:response.status,state:'http-error'});return new Response(JSON.stringify({error:{message:`P2_HTTP_${response.status}`,type:'provider_error'}}),{status:response.status,headers:{'content-type':'application/json'}});}
    if(!body.stream) {
      await finish({status:response.status,state:'complete',text:await response.clone().text(),stream:false});
      return response;
    }
    if(!response.body){await finish({status:response.status,state:'missing-body'});throw new Error('P2_STREAM_BODY_MISSING');}
    let text='',decoder=new TextDecoder();
    const tap=new TransformStream({
      transform(chunk,controller){text+=decoder.decode(chunk,{stream:true});if(text.length>2_000_000)throw new Error('P2_RESPONSE_SIZE_LIMIT');controller.enqueue(chunk);},
      async flush(){text+=decoder.decode();await finish({status:response.status,state:'complete',text,stream:true});},
    });
    return new Response(response.body.pipeThrough(tap),{status:response.status,headers:response.headers});
  };
}
