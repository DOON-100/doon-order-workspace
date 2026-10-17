import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekStatus,explainError} from './deepseek.mjs';

const key='synthetic-only-not-a-real-secret';
const balance={is_available:true,balance_infos:[{currency:'CNY',total_balance:'12.3400',granted_balance:'2.3400',topped_up_balance:'10.0000'},{currency:'USD',total_balance:'1.20',granted_balance:'0.00',topped_up_balance:'1.20'}]};
test('缺少密钥不发请求；真实模型配置必须有服务端密钥',async()=>{
 let calls=0;const service=createDeepSeekStatus({env:{},fetchImpl:async()=>{calls++;}});
 assert.equal((await service.get()).status,'unconfigured');assert.equal(calls,0);
 await assert.rejects(()=>createDeepSeekStatus({env:{DOON_STUDIO_MODEL:'deepseek-flash'}}).model(),/server-side API key/);
});
test('余额保留原币种和小数，单飞缓存与手动刷新不会形成请求风暴',async()=>{
 let calls=0,clock=100000;const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},now:()=>clock,fetchImpl:async(url,init)=>{assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(init.headers.Authorization,`Bearer ${key}`);calls++;return Response.json(balance);}});
 const [a,b]=await Promise.all([service.get(),service.get()]);assert.equal(calls,1);assert.equal(a.balance.infos[0].total,'12.3400');assert.equal(b.balance.infos[1].currency,'USD');assert(!JSON.stringify(a).includes(key));
 await service.get({refresh:true});assert.equal(calls,1);
 clock+=11000;await service.get();assert.equal(calls,1);await service.get({refresh:true});assert.equal(calls,2);
 const empty=await createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},fetchImpl:async()=>Response.json({is_available:false,balance_infos:[]})}).get();assert.equal(empty.status,'ok');assert.equal(empty.balance.available,false);
});
test('官方错误码映射、未知码、敏感响应和网络异常不会被误报为余额零',async()=>{
 for(const [status,title] of [[400,'格式错误'],[401,'认证失败'],[402,'余额不足'],[422,'参数错误'],[429,'请求速率达到上限'],[500,'服务器故障'],[503,'服务器繁忙']]){
  const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},fetchImpl:async()=>Response.json({error:{message:key+' private detail',code:'synthetic_error',type:'api_error'}},{status})});
  const result=await service.get();assert.equal(result.error.httpStatus,status);assert.equal(result.error.title,title);assert.equal(result.error.providerCode,'synthetic_error');assert.equal(result.balance,null);assert(!JSON.stringify(result).includes(key));assert(!JSON.stringify(result).includes('private detail'));
 }
 assert.equal(explainError(418).documented,false);assert.equal(explainError(401,{error:{code:key,type:'<script>'}},key).providerCode,null);
 for(const fetchImpl of [async()=>Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'bad'}]}),async()=>new Response('<html>upstream</html>'),async()=>{throw new DOMException('secret detail','TimeoutError');},async()=>{throw new Error(key);}]){
  const result=await createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},fetchImpl}).get();assert.equal(result.status,'error');assert.equal(result.balance,null);assert(!JSON.stringify(result).includes(key));
 }
});
test('模型 API 错误与余额查询状态分别保留，并不泄露原始错误消息',async()=>{
 const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key,DOON_STUDIO_MODEL:'deepseek-flash'},fetchImpl:async url=>url.includes('/chat/completions')?Response.json({error:{code:'invalid_api_key',message:key}},{status:401}):Response.json(balance)});
 const model=await service.model();await assert.rejects(()=>model.doGenerate({prompt:[{role:'user',content:[{type:'text',text:'synthetic'}]}]}),error=>!error.message.includes(key)&&error.message.includes('认证失败'));
 const result=await service.get();assert.equal(result.model.id,'deepseek-flash');assert.equal(result.lastModelCall.error.httpStatus,401);assert.equal(result.status,'ok');assert(!JSON.stringify(result).includes(key));
});
