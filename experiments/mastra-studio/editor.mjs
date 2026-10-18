import {MastraEditor} from '@mastra/editor';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';

const idSchema=z.string().regex(/^[\w-]{1,160}$/);
const rule=z.object({field:z.string().max(160),operator:z.enum(['equals','not_equals','contains','not_contains','greater_than','less_than','greater_than_or_equal','less_than_or_equal','in','not_in','exists','not_exists']),value:z.unknown().optional()}).strict();
const group=child=>z.object({operator:z.enum(['AND','OR']),conditions:z.array(child).max(100)}).strict();
const rules=group(z.union([rule,group(z.union([rule,group(rule)]))]));
export const instructionSchema=z.union([z.string().trim().min(1).max(32000),z.array(z.union([
 z.object({type:z.literal('text'),content:z.string().max(32000)}).strict(),
 z.object({type:z.literal('prompt_block_ref'),id:idSchema,rules:rules.optional()}).strict(),
 z.object({type:z.literal('prompt_block'),content:z.string().max(32000),rules:rules.optional()}).strict(),
])).min(1).max(64)]);
export async function validInstructions(value,storage){
 if(!instructionSchema.safeParse(value).success)return false;
 if(typeof value==='string')return true;
 const store=await storage.getStore('promptBlocks');
 for(const id of new Set(value.filter(block=>block.type==='prompt_block_ref').map(block=>block.id))){
  const row=await store.getById(id);if(!row?.activeVersionId||row.status!=='published')return false;
 }
 return true;
}

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
 const prompts=await storage.getStore('promptBlocks');
 prompts.deleteVersion=async()=>{};
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

const denied=()=>Response.json({error:'当前入口仅允许岗位提示词、已有工具说明及公共 Prompt 的受控编辑；模型、权限及历史由服务端保留。'},{status:403});
const jsonRequest=(request,body)=>new Request(request,{body:JSON.stringify(body),headers:{...Object.fromEntries(request.headers),'Content-Type':'application/json'}});

export async function guardEditorRequest(request,agents,storage){
 if(['GET','HEAD'].includes(request.method))return request;
 let pathname;try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch{return denied();}
 const prefix='/studio/api';
 if(pathname.startsWith(prefix+'/stored/prompt-blocks'))return guardPromptRequest(request,pathname);
 // This POST only renders prompt blocks; it neither saves nor runs an agent.
 if(pathname===prefix+'/stored/agents/preview-instructions'&&request.method==='POST')return request;
 if(pathname.startsWith(prefix+'/stored/')||pathname.startsWith(prefix+'/editor/')){
  const match=pathname.match(/^\/studio\/api\/stored\/agents(?:\/([\w-]+))?(?:\/versions(?:\/([\w-]+)\/(activate|restore))?)?$/);
  if(!match)return denied();
  if(!match[1]||!Object.hasOwn(agents,match[1]))return denied();
  if(request.method==='PATCH'&&pathname===prefix+'/stored/agents/'+match[1]){
   let body;try{body=await request.clone().json();}catch{return denied();}
   if(Object.hasOwn(body||{},'instructions')&&!await validInstructions(body.instructions,storage))return denied();
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

async function guardPromptRequest(request,pathname){
 const match=pathname.match(/^\/studio\/api\/stored\/prompt-blocks(?:\/([\w-]+))?(?:\/versions(?:\/([\w-]+)\/(activate|restore))?)?$/);
 if(!match||request.headers.get('origin')!==new URL(request.url).origin)return denied();
 let body;try{const text=await request.clone().text();if(text.length>65536)return denied();body=text?JSON.parse(text):{};}catch{return denied();}
 if(!match[1]&&request.method==='POST'||match[1]&&!pathname.includes('/versions')&&request.method==='PATCH'){
  const snapshot={name:z.string().trim().min(1).max(160),description:z.string().max(1000).optional(),content:z.string().min(1).max(32000),rules:rules.optional(),requestContextSchema:z.record(z.unknown()).optional()};
  const schema=match[1]?z.object(snapshot).partial().strict():z.object({...snapshot,id:idSchema.optional()}).strict();
  const parsed=schema.safeParse(body);if(!parsed.success)return denied();
  if(!match[1])parsed.data.id??='prompt-'+randomUUID();
  return jsonRequest(request,parsed.data);
 }
 if(match[1]&&request.method==='POST'&&pathname.includes('/versions')){
  if(match[2]&&match[3])return jsonRequest(request,{});
  const parsed=z.object({changeMessage:z.string().max(1000).optional()}).strict().safeParse(body);if(parsed.success)return jsonRequest(request,parsed.data);
 }
 return denied();
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
