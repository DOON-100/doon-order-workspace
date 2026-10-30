import {env} from 'cloudflare:workers';
import {AppError} from './store';

type Json=Record<string,unknown>;
export type KingdeeConfig={clientId:string;clientSecret:string;instanceId:string;accountId:string};
const gateway='https://api.kingdee.com';
const paths={authorize:'/jdyconnector/app_management/push_app_authorize',token:'/jdyconnector/app_management/kingdee_auth_token',list:'/jdy/v2/scm/pur_order',detail:'/jdy/v2/scm/pur_order_detail',supplierList:'/jdy/v2/bd/supplier'} as const;
const salesPaths={customer:'/jdy/v2/bd/customer_detail',material:'/jdy/v2/bd/material_detail',unit:'/jdy/v2/bd/measure_unit',currency:'/jdy/v2/bd/currency',employee:'/jdy/v2/bd/emp',salesList:'/jdy/v2/scm/sal_order',salesSave:'/jdy/v2/scm/sal_order',salesDetail:'/jdy/v2/scm/sal_order_detail'} as const;
const encoder=new TextEncoder();
export function kingdeeConfig():KingdeeConfig|null{
 const settings=env as unknown as Record<string,unknown>;
 if(settings.DOON_KINGDEE_READONLY_ENABLED!=='1')return null;
 return kingdeeSalesConfig();
}
/** Sales writes have their own opt-in. Procurement read access never enables it. */
export function kingdeeSalesWriteEnabled(){return (env as unknown as Record<string,unknown>).DOON_KINGDEE_SALES_WRITE_ENABLED==='1';}
export function kingdeeSalesConfig():KingdeeConfig|null{
 const settings=env as unknown as Record<string,unknown>;
 const values=['CLIENT_ID','CLIENT_SECRET','INSTANCE_ID','ACCOUNT_ID'].map(key=>settings['DOON_KINGDEE_'+key]);
 if(values.some(value=>typeof value!=='string'||!value.trim()))return null;
 const [clientId,clientSecret,instanceId,accountId]=values as string[];
 if(![clientId,instanceId,accountId].every(value=>/^[A-Za-z0-9_-]{1,100}$/.test(value)))return null;
 return {clientId,clientSecret,instanceId,accountId};
}
export async function hmacBase64Hex(key:string,message:string){
 const imported=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',imported,encoder.encode(message));
 return btoa(Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''));
}
export async function kingdeeSignature(config:KingdeeConfig,method:string,path:string,query:Record<string,string>,timestamp=String(Date.now()),nonce=String(crypto.getRandomValues(new Uint32Array(1))[0]%2147483646+1)){
 const names=Object.keys(query).sort(),actualQuery=names.map(key=>key+'='+encodeURIComponent(query[key])).join('&');
 const signedQuery=names.map(key=>key+'='+encodeURIComponent(encodeURIComponent(query[key]))).join('&');
 const canonical=[method,encodeURIComponent(path),signedQuery,'x-api-nonce:'+nonce,'x-api-timestamp:'+timestamp,''].join('\n');
 return {actualQuery,headers:{'Content-Type':'application/json','X-Api-ClientID':config.clientId,'X-Api-Auth-Version':'2.0','X-Api-TimeStamp':timestamp,'X-Api-Nonce':nonce,'X-Api-SignHeaders':'X-Api-TimeStamp,X-Api-Nonce','X-Api-Signature':await hmacBase64Hex(config.clientSecret,canonical)}};
}
export function object(value:unknown):Json{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('金蝶返回格式不完整，本次查询未完成。',502);
 return value as Json;
}
export function sourceText(value:unknown){
 if(value===undefined||value===null)return '';
 if(typeof value==='string')return value;
 if(typeof value==='number'&&Number.isFinite(value))return String(value);
 throw new AppError('金蝶返回字段格式异常，本次查询未完成。',502);
}
export function sourceId(value:unknown){
 if(typeof value!=='string'||!value||value.length>100)throw new AppError('金蝶返回标识缺失或不精确，本次查询未完成。',502);
 return value;
}
// Only these four fixed operations exist. POST is used solely for obtaining authorization;
// both business endpoints are GET. No save/audit/delete API or arbitrary destination.
async function gatewayRequest(config:KingdeeConfig,operation:keyof typeof paths,query:Record<string,string>,signal:AbortSignal,auth?:{token:string;domain:string}){
 const method=operation==='authorize'?'POST':'GET',path=paths[operation];
 const signed=await kingdeeSignature(config,method,path,query);
 try{
  const response=await fetch(gateway+path+'?'+signed.actualQuery,{method,headers:{...signed.headers,...(auth?{'app-token':auth.token,'X-GW-Router-Addr':auth.domain}:{})},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  if(!response.ok)throw new AppError(response.status===429?'金蝶请求限流，请稍后重新查询。':`金蝶连接失败（HTTP ${response.status}），本次查询未完成。`,response.status===429?429:502);
  // Bound untrusted response bodies before parsing. Never log upstream URLs, headers or bodies.
  const reader=response.body?.getReader();if(!reader)throw new AppError('金蝶未返回数据。',502);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new AppError('金蝶单次响应过大，请缩小查询日期范围。',502);}chunks.push(chunk.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const result=object(JSON.parse(new TextDecoder().decode(bytes)));
  if(operation==='authorize'?result.code!==200:result.errcode!==0){
   const code=operation==='authorize'?result.code:result.errcode;
   throw new AppError(`金蝶${operation==='authorize'?'授权':operation==='token'?'令牌':operation==='supplierList'?'供应商查询':'采购查询'}失败（代码 ${typeof code==='number'&&Number.isSafeInteger(code)?code:'未知'}），请核对接口权限和授权有效期。`,502);
  }
  return result.data;
 }catch(error){
  if(error instanceof AppError)throw error;
  throw new AppError(signal.aborted?'金蝶查询已取消或超时，请重新查询。':'金蝶网络连接超时或响应无效，请稍后重试。',502);
 }
}
type Authorization={token:string;domain:string;expiresAt:number};
type AuthorizationCache={cached?:{key:string;value:Authorization};inFlight?:{key:string;promise:Promise<Authorization>};lastAttempt?:{key:string;at:number}};
// Standalone bundles the HTTP route and fixed background worker separately.
// Share only this in-memory cache between those bundles in the same process;
// its key is a hash of configuration and the token is never persisted.
const cacheKey=Symbol.for('doon.kingdee.authorization.v1'),globalCache=globalThis as unknown as Record<symbol,AuthorizationCache|undefined>;
const authCache=globalCache[cacheKey]||(globalCache[cacheKey]={});
async function authorization(config:KingdeeConfig){
 // Include credential rotation in the fingerprint without retaining plaintext in cache keys.
 const hash=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(config)));
 const key=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
 if(authCache.cached?.key===key&&authCache.cached.value.expiresAt>Date.now())return authCache.cached.value;
 if(authCache.inFlight?.key===key)return authCache.inFlight.promise;
 if(authCache.lastAttempt?.key===key&&Date.now()-authCache.lastAttempt.at<31000)throw new AppError('金蝶授权刚刚请求过，请稍后重试，避免令牌接口限流。',429);
 authCache.lastAttempt={key,at:Date.now()};
 const promise=(async()=>{
  const signal=AbortSignal.timeout(30000),data=await gatewayRequest(config,'authorize',{outerInstanceId:config.instanceId},signal);
  if(!Array.isArray(data))throw new AppError('金蝶企业授权返回格式异常。',502);
  const matches=data.map(object).filter(item=>sourceText(item.clientId)===config.clientId&&sourceText(item.outerInstanceId)===config.instanceId&&sourceText(item.accountId)===config.accountId&&String(item.status)==='1');
  if(matches.length!==1)throw new AppError('金蝶授权与指定应用、实例或账套不一致，请管理员核对私有配置。',502);
  const selected=matches[0],appKey=sourceText(selected.appKey),appSecret=sourceText(selected.appSecret),domain=sourceText(selected.domain);
  let route:URL;try{route=new URL(domain);}catch{throw new AppError('金蝶授权路由无效。',502);}
  if(!appKey||!appSecret||route.protocol!=='https:'||!route.hostname.endsWith('.jdy.com')||route.port||route.username||route.password||route.pathname!=='/'||route.search||route.hash)throw new AppError('金蝶授权材料或路由无效。',502);
  const tokenData=object(await gatewayRequest(config,'token',{app_key:appKey,app_signature:await hmacBase64Hex(appSecret,appKey)},signal));
  const token=sourceText(tokenData['app-token']);if(!token)throw new AppError('金蝶没有返回有效令牌。',502);
  const value={token,domain,expiresAt:Date.now()+23*60*60*1000};authCache.cached={key,value};return value;
 })();authCache.inFlight={key,promise};
 try{return await promise;}finally{if(authCache.inFlight?.promise===promise)authCache.inFlight=undefined;}
}
/** Prepare only the cached connection; never fetch or write business records. */
export async function prepareKingdeeConnection(config:KingdeeConfig){await authorization(config);}
export async function kingdeeSalesRequest(config:KingdeeConfig,operation:keyof typeof salesPaths,query:Record<string,string>,signal:AbortSignal,body?:Record<string,unknown>){
 if(operation==='salesSave'&&!kingdeeSalesWriteEnabled())throw new AppError('金蝶销售订单写入开关尚未启用。',503);
 const auth=await authorization(config),method=operation==='salesSave'?'POST':'GET',path=salesPaths[operation],signed=await kingdeeSignature(config,method,path,query);
 try{
  const response=await fetch(gateway+path+(signed.actualQuery?'?'+signed.actualQuery:''),{method,headers:{...signed.headers,'app-token':auth.token,'X-GW-Router-Addr':auth.domain},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  if(!response.ok)throw new AppError(`金蝶销售接口未完成（HTTP ${response.status}），请核查原操作。`,502);
  const reader=response.body?.getReader();if(!reader)throw new AppError('金蝶销售接口未返回结果。',502);
  const chunks:Uint8Array[]=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>4*1024*1024){await reader.cancel();throw new AppError('金蝶销售接口响应超过上限。',502);}chunks.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const result=object(JSON.parse(new TextDecoder().decode(bytes)));if(result.errcode!==0)throw new AppError(`金蝶销售接口返回错误（代码 ${typeof result.errcode==='number'&&Number.isSafeInteger(result.errcode)?result.errcode:'未知'}），请核查原操作。`,502);
  return object(result.data);
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('金蝶销售接口连接中断或响应无效；上传结果须核查，不能重复提交。',502);}
}
export async function kingdeeRead(config:KingdeeConfig,operation:'list'|'detail',query:Record<string,string>,signal:AbortSignal){
 const auth=await authorization(config);
 try{return object(await gatewayRequest(config,operation,query,signal,auth));}
 catch(error){if(error instanceof AppError&&error.status===502)authCache.cached=undefined;throw error;}
}

/** Fixed first page only, no caller-controlled filters or sensitive contacts. */
export async function kingdeeSupplierDiagnostic(config:KingdeeConfig,signal:AbortSignal){
 const auth=await authorization(config);
 try{return object(await gatewayRequest(config,'supplierList',{page:'1',page_size:'10',show_contact_detail:'false'},signal,auth));}
 catch(error){if(error instanceof AppError&&error.status===502)authCache.cached=undefined;throw error;}
}

/** Fixed supplier list projection. Page and size are server controlled. */
export async function kingdeeSupplierCatalogPage(config:KingdeeConfig,page:number,signal:AbortSignal){
 if(!Number.isInteger(page)||page<1||page>100)throw new AppError('金蝶供应商页码无效。');
 const auth=await authorization(config);
 try{return object(await gatewayRequest(config,'supplierList',{page:String(page),page_size:'100',enable:'-1',show_contact_detail:'false'},signal,auth));}
 catch(error){if(error instanceof AppError&&error.status===502)authCache.cached=undefined;throw error;}
}

/** Independent detail GETs, at most three in flight; drain a wave before failing. */
export async function kingdeeDetails(config:KingdeeConfig,ids:string[],signal:AbortSignal){
 const details:Json[]=[];
 for(let offset=0;offset<ids.length;offset+=3){
  const wave=await Promise.allSettled(ids.slice(offset,offset+3).map(id=>kingdeeRead(config,'detail',{id},signal)));
  const failure=wave.find((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failure)throw failure.reason;
  for(const result of wave)if(result.status==='fulfilled')details.push(result.value);
 }
 return details;
}
