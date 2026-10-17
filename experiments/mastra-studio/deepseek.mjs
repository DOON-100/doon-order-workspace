import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDeepSeek} from '@ai-sdk/deepseek';

export const docsUrl='https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/';
const types={
 400:['格式错误','请求体格式不符合要求。','检查 JSON 格式与接口请求结构。'],
 401:['认证失败','API Key 无效或认证失败。','检查服务端 API Key 是否正确、有效。'],
 402:['余额不足','账户可用余额不足。','核对余额并前往 DeepSeek 平台充值。'],
 422:['参数错误','请求参数不符合接口要求。','检查模型号、参数名称与取值。'],
 429:['请求速率达到上限','请求速率或并发达到上限。','降低请求频率或并发，稍后重试。'],
 500:['服务器故障','DeepSeek 服务内部故障。','稍后重试；持续失败时联系 DeepSeek。'],
 503:['服务器繁忙','DeepSeek 当前负载过高。','稍后重试。'],
};
export function explainError(status,body={},secret=''){
 const [title,cause,action]=types[status]||['未归类的 API 错误','接口返回了当前通用错误文档未列出的 HTTP 状态。','查看官方文档并核对接口配置；不要直接重复提交。'];
 const safe=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,64}$/.test(value)&&!value.startsWith('sk-')&&(!secret||!value.includes(secret))?value:null;
 return {httpStatus:status,title,cause,action,providerCode:safe(body?.error?.code),providerType:safe(body?.error?.type),documented:!!types[status],docsUrl};
}
const localError=(title,cause,action)=>({httpStatus:null,title,cause,action,providerCode:null,providerType:null,documented:false,docsUrl});
export async function readDeepSeekKey(env=process.env){
 const value=env.DEEPSEEK_API_KEY_FILE?await fs.readFile(env.DEEPSEEK_API_KEY_FILE,'utf8'):env.DEEPSEEK_API_KEY||'';
 const key=value.trim();
 if(key&&(/[\r\n\x00-\x20\x7f]/.test(key)||key.length>512))throw new Error('invalid key configuration');
 return key;
}
export function createDeepSeekStatus({env=process.env,fetchImpl=fetch,now=Date.now,timeoutMs=8000}={}){
 let cached=null,cachedKey=null,expires=0,inflight=null,inflightKey=null,lastModelCall=null;
 const requested=env.DOON_STUDIO_MODEL||'offline';
 if(!['offline','deepseek-flash','deepseek-v4-pro'].includes(requested))throw new Error('DOON_STUDIO_MODEL must be offline, deepseek-flash or deepseek-v4-pro');
 const modelInfo=requested==='offline'?{provider:'合成脚本',id:'scripted-studio-v1',live:false}:{provider:'DeepSeek',id:requested,live:true};
 async function apiFetch(input,init={}){
  try{
   const timeout=AbortSignal.timeout(String(input).includes('/chat/completions')?60000:timeoutMs);
   const response=await fetchImpl(input,{...init,redirect:'error',signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
   if(String(input).includes('/chat/completions')){
    let body={};if(!response.ok)body=await response.clone().json().catch(()=>({}));
    lastModelCall={checkedAt:new Date(now()).toISOString(),ok:response.ok,error:response.ok?null:explainError(response.status,body,await readDeepSeekKey(env))};
    if(!response.ok){
     const error=lastModelCall.error;await response.body?.cancel();
     return Response.json({error:{message:`DeepSeek HTTP ${response.status}：${error.title}。${error.action}`,code:error.providerCode||String(response.status),type:error.providerType||'api_error'}},{status:response.status});
    }
   }
   return response;
  }catch(error){
   if(String(input).includes('/chat/completions')){
    lastModelCall={checkedAt:new Date(now()).toISOString(),ok:false,error:localError('模型连接失败','网络连接失败或请求超时。','检查服务端网络，稍后重试。')};
    throw new Error('DeepSeek 模型连接失败；请查看侧栏状态。');
   }
   throw error;
  }
 }
 return{
  modelInfo,
  async model(){
   if(!modelInfo.live)return undefined;
   const apiKey=await readDeepSeekKey(env);if(!apiKey)throw new Error('DeepSeek model requires a server-side API key');
   return createDeepSeek({apiKey,baseURL:'https://api.deepseek.com',fetch:apiFetch})(requested);
  },
  async get({refresh=false}={}){
   let key;
   try{key=await readDeepSeekKey(env);}catch{return{status:'error',configured:false,model:modelInfo,checkedAt:new Date(now()).toISOString(),error:localError('密钥配置错误','服务端密钥文件无法读取或格式无效。','检查服务端环境变量或密钥文件权限。'),lastModelCall};}
   if(!key)return{status:'unconfigured',configured:false,model:modelInfo,balance:null,checkedAt:null,error:null,lastModelCall};
   const fingerprint=createHash('sha256').update(key).digest('hex');
   if(cached&&cachedKey===fingerprint&&((!refresh&&now()<expires)||now()-Date.parse(cached.checkedAt)<10000))return{...cached,cached:true,lastModelCall};
   // A concurrent page refresh reuses the same in-flight request.
   if(inflight){
    if(inflightKey!==fingerprint)return{status:'error',configured:true,model:modelInfo,balance:null,checkedAt:null,error:localError('密钥配置已切换','旧查询仍在结束，不显示另一密钥的余额。','稍后刷新。'),lastModelCall};
    return{...await inflight,lastModelCall};
   }
   inflightKey=fingerprint;
   inflight=(async()=>{
    const checkedAt=new Date(now()).toISOString();let result;
    try{
     const response=await apiFetch('https://api.deepseek.com/user/balance',{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'}});
     const text=await response.text();if(text.length>32768)throw new Error('invalid response');
     let body;try{body=JSON.parse(text);}catch{if(response.ok)throw new Error('invalid response');body={};}
     if(!response.ok)result={status:'error',error:explainError(response.status,body,key),balance:null};
     else{
      const valid=typeof body.is_available==='boolean'&&Array.isArray(body.balance_infos)&&(!body.is_available||body.balance_infos.length>0)&&body.balance_infos.length<=10&&body.balance_infos.every(row=>['CNY','USD'].includes(row.currency)&&['total_balance','granted_balance','topped_up_balance'].every(k=>typeof row[k]==='string'&&/^-?\d{1,15}(\.\d{1,10})?$/.test(row[k])));
      if(!valid)throw new Error('invalid response');
      result={status:'ok',error:null,balance:{available:body.is_available,infos:body.balance_infos.map(({currency,total_balance,granted_balance,topped_up_balance})=>({currency,total:total_balance,granted:granted_balance,toppedUp:topped_up_balance}))}};
     }
    }catch(error){result={status:'error',balance:null,error:error.message==='invalid response'?localError('响应格式异常','接口响应不符合官方余额结构。','稍后重试；持续出现时检查接口版本。'):localError(error.name==='TimeoutError'?'查询超时':'网络连接失败','未获得有效的 DeepSeek HTTP 响应，不能据此判断余额。','检查服务端网络与连接，稍后重试。')};}
    cached={...result,configured:true,model:modelInfo,checkedAt,cached:false};cachedKey=fingerprint;expires=now()+(result.status==='ok'?60000:30000);return cached;
   })();
   try{return{...await inflight,lastModelCall};}finally{inflight=null;inflightKey=null;}
  },
 };
}
