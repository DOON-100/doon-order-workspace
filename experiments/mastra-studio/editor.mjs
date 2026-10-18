import {MastraEditor} from '@mastra/editor';

// Free Editor only. The EE Agent/Workflow Builders are deliberately disabled.
export const createEditor=()=>new MastraEditor({source:'db',builder:{enabled:false},workflowBuilder:{enabled:false}});
export const editorPermissions={instructions:true,tools:{description:true}};

export async function prepareEditor(mastra,storage,codeAgents){
 await storage.init();
 const agents=await storage.getStore('agents');
 if(!agents)throw new Error('Editor requires agents storage');
 // The upstream REST handlers prune versions after 50 saves. Retain every
 // snapshot in this application; explicit delete endpoints are denied below.
 agents.deleteVersion=async()=>{};
 // Explicit instruction ownership requires a published baseline. Bootstrap
 // only missing editor records; never replace an existing draft or publication.
 for(const [id,agent] of Object.entries(codeAgents)){
  if(await agents.getById(id))continue;
  const tools=Object.fromEntries(Object.entries(await agent.listTools()).map(([key,tool])=>[key,{description:tool.description}]));
  const model=await agent.getModel();
  await mastra.getEditor().agent.create({id,name:agent.name,instructions:await agent.getInstructions(),tools,model:{provider:model.provider,name:model.modelId}});
  const {versions}=await agents.listVersions({agentId:id,perPage:1});
  if(!versions[0])throw new Error('Editor baseline version was not persisted');
  await agents.update({id,activeVersionId:versions[0].id,status:'published'});
  mastra.getEditor().agent.clearCache(id);
 }
}

const denied=()=>Response.json({error:'当前 Editor 仅编辑已有岗位的提示词和已有工具说明；模型、权限及历史由服务端保留。'},{status:403});
const jsonRequest=(request,body)=>new Request(request,{body:JSON.stringify(body),headers:{...Object.fromEntries(request.headers),'Content-Type':'application/json'}});

export async function guardEditorRequest(request,agents){
 if(['GET','HEAD'].includes(request.method))return request;
 let pathname;try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch{return denied();}
 const prefix='/studio/api';
 // This POST only renders prompt blocks; it neither saves nor runs an agent.
 if(pathname===prefix+'/stored/agents/preview-instructions'&&request.method==='POST')return request;
 if(pathname.startsWith(prefix+'/stored/')||pathname.startsWith(prefix+'/editor/')){
  const match=pathname.match(/^\/studio\/api\/stored\/agents(?:\/([\w-]+))?(?:\/versions(?:\/([\w-]+)\/(activate|restore))?)?$/);
  if(!match)return denied();
  if(!match[1]||!Object.hasOwn(agents,match[1]))return denied();
  if(request.method==='PATCH'&&pathname===prefix+'/stored/agents/'+match[1]){
   let body;try{body=await request.clone().json();}catch{return denied();}
   const editable=await editableFields(body,agents[match[1]]);if(!editable)return denied();
   return jsonRequest(request,editable);
  }
  // Version publication/restoration is explicit; a normal save remains a draft.
  if(request.method==='POST'&&match[2]&&match[3])return jsonRequest(request,{});
  return denied();
 }
 if(/^\/studio\/api\/agents\/[^/]+\/clone(?:\/|$)/.test(pathname))return denied();
 return request;
}

async function editableFields(body,agent){
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const result={};
 if(Object.hasOwn(body,'instructions'))result.instructions=body.instructions;
 if(Object.hasOwn(body,'changeMessage'))result.changeMessage=body.changeMessage;
 if(Object.hasOwn(body,'tools')){
  if(!body.tools||Array.isArray(body.tools)||typeof body.tools!=='object')return null;
  const allowed=await agent.listTools();
  result.tools={};
  for(const [key,value] of Object.entries(body.tools)){
   if(!Object.hasOwn(allowed,key)||!value||typeof value!=='object'||Array.isArray(value))return null;
   if(value.description!==undefined&&typeof value.description!=='string')return null;
   result.tools[key]=value.description===undefined?{}:{description:value.description};
  }
 }
 // The official UI has separate Save, Publish, and explicit Save & Publish
 // actions. Preserve that distinction rather than reporting a false publication.
 if(body.autoPublish!==undefined&&typeof body.autoPublish!=='boolean')return null;
 result.autoPublish=body.autoPublish===true;
 return result;
}
