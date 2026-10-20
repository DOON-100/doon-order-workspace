import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import {randomUUID} from 'node:crypto';
import {parsePublicOrigin,sessionCookie,canEnterStudio} from './session.mjs';

const protocol='doon-process-change-v1',uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(message,status=503,uncertain=false)=>Object.assign(new Error(message),{status,uncertain});
// Fixed transport only. This client is not a model tool; confirmations stay in
// the HTTP handler closure, separate from AsyncLocalStorage business tools.
export function createProcessChangeClient({publicOrigin,connectHost='host.docker.internal',transport=https.request}){
 const origin=parsePublicOrigin(publicOrigin);
 if(!['host.docker.internal','127.0.0.1','localhost'].includes(connectHost))throw Error('Invalid platform host');
 return async(cookie,operation,input)=>{
  if(!['contract','get','preview','confirm','cancel'].includes(operation))throw fail('不支持的流程变更动作。',400);
  const filtered=sessionCookie(cookie);if(!filtered)throw fail('登录已失效。',401);
  const writing=['preview','confirm','cancel'].includes(operation);
  if(operation==='get'&&!uuid.test(input?.id||''))throw fail('预览编号无效。',400);
  const endpoint=operation==='get'?'process-change?id='+encodeURIComponent(input.id):'process-change-'+operation;
  const bytes=writing?Buffer.from(JSON.stringify(input)):null;if(bytes?.length>64*1024)throw fail('预览内容过大。',413);
  return new Promise((resolve,reject)=>{
   const request=transport({hostname:connectHost,port:Number(origin.port||443),path:'/api/workspace/'+endpoint,method:writing?'POST':'GET',servername:isIP(origin.hostname)?'':origin.hostname,rejectUnauthorized:true,checkServerIdentity:(_,cert)=>tls.checkServerIdentity(origin.hostname,cert),headers:{Host:origin.host,Origin:origin.origin,Cookie:filtered,Accept:'application/json',...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})},timeout:15000},response=>{
    let size=0;const chunks=[];
    response.on('data',chunk=>{size+=chunk.length;if(size>256*1024){response.destroy();reject(fail('流程变更响应过大，请核查原请求。',503,writing));return;}chunks.push(chunk);});
    response.on('error',()=>reject(fail('未取得完整响应，请核查原请求。',503,writing)));
    response.on('end',()=>{
     let body;try{if(!String(response.headers['content-type']).includes('application/json'))throw Error();body=JSON.parse(Buffer.concat(chunks));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return reject(fail('未取得完整响应，请核查原请求。',503,writing));}
     if(response.statusCode<200||response.statusCode>=300)return reject(fail([400,401,403,404,409,413].includes(response.statusCode)?String(body.error||'本次操作被拒绝。').slice(0,500):'请求结果不明，请核查原请求。',[400,401,403,404,409,413].includes(response.statusCode)?response.statusCode:503,writing&&response.statusCode>=500));
     resolve(body);
    });
   });request.on('timeout',()=>request.destroy());request.on('error',()=>reject(fail('请求通道不可用，请核查原请求。',503,writing)));request.end(bytes);
  });
 };
}
export function createProcessChangeSession({cookie,user,authenticate,client}){
 const actorId=String(user.identity?.id||user.username);
 async function verify(){
  const current=await authenticate(cookie);
  if(!canEnterStudio(current)||String(current.identity?.id||current.username)!==actorId)throw fail('当前登录或权限已变化。',403);
 }
 async function get(id){
  await verify();const result=await client(cookie,'get',{id});
  if(result.protocol!==protocol||result.ownerId!==actorId||result.id!==id)throw fail('预览身份或协议不匹配。',403);
  return result;
 }
 return{
  // Only this method is exposed to the department executor.
  async stage(draft){
   await verify();const contract=await client(cookie,'contract');
   if(contract.protocol!==protocol||!/^[a-f0-9]{64}$/.test(contract.rulesVersion||''))throw fail('中台尚未接通兼容的流程确认协议。',409);
   if(draft.binding.actorId!==actorId)throw fail('草稿身份不匹配。',403);
   const id=randomUUID(),previewUrl='/studio/process-change/?id='+id;
   const payload={...draft.proposed,...(draft.binding.recordId?{id:draft.binding.recordId,version:draft.binding.recordVersion}:{})};
   try{
    const result=await client(cookie,'preview',{requestId:id,rulesVersion:contract.rulesVersion,payload,basis:draft.basis});
    if(result.id!==id||result.status!=='pending'||result.executed!==false)throw fail('尚未取得有效预览回执，请查询原请求。',503,true);
    return{...draft,status:'pending-confirmation',previewSaved:true,previewUrl,proposalId:id,writeEnabled:false,message:'已登记待确认预览，业务尚未修改。请打开预览核对完整内容，再由当前登录人明确确认。'};
   }catch(error){
    if(!error.uncertain)throw error;
    return{...draft,status:'preview-uncertain',previewSaved:null,previewUrl,proposalId:id,message:'预览请求结果尚未确认，未自动重试。请打开链接核查原请求；不能声称已保存业务。'};
   }
  },
  async handle(request,{actor}={}){
   const url=new URL(request.url),json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
   try{
    if(!actor||actor.id!==actorId)throw fail('需要当前真实登录身份。',403);
    if(url.pathname!=='/studio/process-change/api')return json({error:'Not found'},404);
    if(request.method==='GET'){
     if([...url.searchParams.keys()].some(key=>key!=='id')||url.searchParams.getAll('id').length!==1)throw fail('查询参数无效。',400);
     return json(await get(url.searchParams.get('id')));
    }
    if(request.method!=='POST')return json({error:'不支持的请求方法。'},405);
    if(request.headers.get('origin')!==url.origin)throw fail('不允许跨站确认。',403);
    const text=await request.text();if(Buffer.byteLength(text)>2048)throw fail('确认请求过大。',413);
    let input;try{input=JSON.parse(text);}catch{throw fail('请求格式错误。',400);}
    if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['operation','id','digest','approved'].includes(key))||!['confirm','cancel'].includes(input.operation)||!uuid.test(input.id||'')||!/^[a-f0-9]{64}$/.test(input.digest||'')||(input.operation==='confirm'?input.approved!==true:Object.hasOwn(input,'approved')))throw fail('确认参数无效。',400);
    await verify();
    const {operation,...body}=input;
    try{await client(cookie,operation,body);}catch(error){
     if(!error.uncertain)throw error;
     return json({id:input.id,status:'uncertain',executed:null,message:'未取得执行回执，请查询原结果。未自动重试。'},202);
    }
    // Independent authenticated readback. Never infer success from a POST alone.
    try{
     const result=await get(input.id);
     if(operation==='confirm'&&(result.status!=='confirmed'||!result.receipt||result.currentRecord?.id!==result.receipt.recordId||result.currentRecord.version<result.receipt.version))throw fail('保存后的结果尚未核对。',503,true);
     if(operation==='cancel'&&result.status!=='cancelled')throw fail('取消结果尚未核对。',503,true);
     return json({...result,readbackVerified:true});
    }catch{return json({id:input.id,status:'uncertain',executed:null,message:'请求已处理，但结果回读尚未完成。请查询原结果，勿重复提交。'},202);}
   }catch(error){return json({error:error.message||'流程确认暂不可用。'},[400,401,403,404,409,413].includes(error.status)?error.status:503);}
  },
 };
}
