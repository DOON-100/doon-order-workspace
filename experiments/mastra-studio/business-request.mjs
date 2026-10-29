import {profiles} from './profiles.mjs';
const deny=(error,status=400)=>Response.json({error},{status});
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=160&&/^[\w-]+$/.test(value);
function textOnly(value){
 if(typeof value==='string')return value.length>0&&value.length<=16000?value:null;
 if(Array.isArray(value)&&value.length>0&&value.length<=32&&value.every(p=>p?.type==='text'&&typeof p.text==='string'))return textOnly(value.map(p=>p.text).join('\n'));
 if(value&&typeof value==='object'&&Object.hasOwn(value,'contents'))return textOnly(value.contents);
 return null;
}
// SDK 1.78 uses send-message + threads/subscribe. Keep only local chat operations;
// discard its browser-supplied streamOptions so server role contracts stay fixed.
export async function guardBusinessRequest(request,{agents=profiles,documents}={}){
 if(['GET','HEAD'].includes(request.method))return request;
 const match=new URL(request.url).pathname.match(/^\/studio\/api\/agents\/([^/]+)\/(generate|stream|send-message|threads\/subscribe|threads\/abort)$/);
 if(request.method!=='POST'||!match||!Object.hasOwn(agents,match[1]))return deny('真实数据对话仅开放只读 Agent 查询；配置和工作流请使用各自管理入口。',403);
 let body;try{body=await request.clone().json();}catch{return deny('请求格式无效');}
 if(!body||typeof body!=='object'||Array.isArray(body))return deny('请求格式无效');
 const action=match[2];let sanitized;
 if(['send-message','threads/subscribe','threads/abort'].includes(action)){
  if(!identifier(body.resourceId)||!identifier(body.threadId))return deny('会话标识无效');
  sanitized={resourceId:body.resourceId,threadId:body.threadId};
  if(action==='send-message'){
   if(Object.keys(body).some(k=>!['message','resourceId','threadId','ifIdle'].includes(k)))return deny('不支持的消息参数');
   let message;try{message=documents?await documents.message(body.message,{threadId:body.threadId}):textOnly(body.message);}catch(error){return deny(error.message,error.status||400);}if(!message)return deny('只接受文字问题和已上传的附件，不接受工具结果。');
   // Mastra 1.78 send-message uses UI file parts; generate/stream use Core images.
   sanitized.message=Array.isArray(message)?message.map(part=>part.type==='image'?{type:'file',data:part.image,mediaType:part.mimeType}:part):message;sanitized.ifIdle={streamOptions:{}};
  }else if(action==='threads/subscribe'){
   if(Object.keys(body).some(k=>!['resourceId','threadId','withInitialHistory'].includes(k)))return deny('不支持的订阅参数');
   sanitized.withInitialHistory=body.withInitialHistory===true;
  }else{
   if(Object.keys(body).some(k=>!['resourceId','threadId','clearPendingSignals','expectedRunId'].includes(k)))return deny('不支持的停止参数');
   sanitized.clearPendingSignals=body.clearPendingSignals===true;
   if(body.expectedRunId!==undefined){if(!identifier(body.expectedRunId))return deny('运行标识无效');sanitized.expectedRunId=body.expectedRunId;}
  }
 }else{
  const allowed=new Set(['messages','memory','threadId','resourceId']);
  if(Object.keys(body).some(key=>!allowed.has(key)))return deny('真实快照模式不接受模型、prompt、工具、身份或运行参数覆盖。');
  if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>4||body.messages.some(m=>m.role!=='user'||!textOnly(m.content)))return deny('直接查询只接受用户文字消息和已上传附件；历史由服务器记忆读取');
  sanitized={messages:[]};
  try{for(const m of body.messages)sanitized.messages.push({role:'user',content:documents?await documents.message(m.content,{threadId:body.memory?.thread}):textOnly(m.content)});}catch(error){return deny(error.message,error.status||400);}
  if(body.memory){if(!identifier(body.memory.thread)||!identifier(body.memory.resource)||Object.keys(body.memory).some(k=>!['thread','resource'].includes(k)))return deny('会话标识无效');sanitized.memory={thread:body.memory.thread,resource:body.memory.resource};}
 }
 return new Request(request,{body:JSON.stringify(sanitized)});
}
