import registry from './department-registry.json' with {type:'json'};
import {z} from 'zod';
import {processKinds,processSaveSchema,processDetailsSchema,assertProcessCompletion} from './process-contract.generated.mjs';

export const departmentGroups=registry.groups;
export const contractRevision=registry.middlewareCommit;
export const businessReadSources=[...registry.reads,{id:'process-data',scopeParams:['type'],requiredScope:['type']}];
const identifier=z.string().trim().min(1).max(160);
export function readScopeSchema(source){
 const definition=businessReadSources.find(row=>row.id===source);
 if(!definition)throw new Error('业务读取接口尚未适配。');
 return z.object(Object.fromEntries(definition.scopeParams.map(key=>[key,source==='process-data'?z.enum(processKinds):(definition.requiredScope||[]).includes(key)?identifier:identifier.optional()]))).strict();
}
const pageFields={
 dataset:z.string().min(1).max(1200),id:identifier.optional(),query:z.string().max(160).optional(),
 offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(20).default(10),
 fields:z.array(z.string().min(1).max(1200)).min(1).max(40).optional(),
};
export const recordQuerySchema=z.object({source:z.string().min(1).max(100),scope:z.record(z.string()).default({}),...pageFields}).strict();
const scopeFor=action=>action.type?z.object({}).strict():readScopeSchema(action.source);
export const readArguments=action=>z.object({scope:scopeFor(action).default({}),...pageFields}).strict();
export const inspectArguments=action=>z.object({scope:scopeFor(action).default({})}).strict();
export function processPayloadSchema(type){
 return processSaveSchema.omit({id:true,version:true,token:true}).extend({type:z.literal(type),details:processDetailsSchema(type).default({})}).strict();
}
export function draftArguments(type){
 const basis=z.object({
  sources:z.array(z.object({field:z.string().min(1).max(160),reference:z.string().min(1).max(500),location:z.string().min(1).max(500)}).strict()).min(1).max(40),
  unknowns:z.array(z.string().min(1).max(500)).max(40).default([]),
  conflicts:z.array(z.string().min(1).max(500)).max(40).default([]),
 }).strict();
 const fields=processPayloadSchema(type).omit({type:true});
 const changes=fields.partial().extend({details:processDetailsSchema(type).partial().optional()}).strict()
  .refine(value=>Object.keys(value).some(key=>key!=='details'||Object.keys(value.details).length),'至少填写一个需要修改的字段。');
 return z.discriminatedUnion('mode',[
  z.object({mode:z.literal('create'),fields,basis}).strict(),
  z.object({mode:z.literal('update'),id:identifier,expectedVersion:z.number().int().positive(),changes,basis}).strict(),
 ]);
}
export function validateProcessPayload(type,value){
 const parsed=processPayloadSchema(type).parse(value);
 if(!parsed.customerId&&!parsed.orderId)throw new Error('请关联已核对的授权客户或订单，不能猜测关联。');
 assertProcessCompletion(parsed);return parsed;
}
const readActions=registry.reads.map(row=>({...row,kind:'read',status:'read-adapter'}));
const processActions=registry.processes.flatMap(row=>[
 {id:'process-'+row.type,label:row.label,groups:[row.group],source:'process-data',type:row.type,kind:'read',status:'read-adapter'},
 {id:'prepare-process-'+row.type,label:row.label+'新增／修改草稿',groups:[row.group],source:'process-data',type:row.type,kind:'draft',status:'draft-only'},
]);
export const departmentActions=[...readActions,...processActions];
export function departmentAction(group,id){
 const action=departmentActions.find(row=>row.id===id&&row.groups.includes(group));
 if(!action)throw new Error('该动作尚未接入当前部门工具，请先查看动作目录。');
 return action;
}
export function departmentCatalog(group){
 const department=departmentGroups.find(row=>row.id===group);
 if(!department)throw new Error('部门不存在。');
 return{department,contractRevision,authorization:'checked-by-original-api-on-every-read',writeEnabled:false,
  actions:departmentActions.filter(row=>row.groups.includes(group)).map(({id,label,kind,status,requiredScope})=>({id,label,kind,status,...(requiredScope?{requiredScope}:{})})),
  pendingEndpoints:registry.endpoints.filter(row=>row.groups.includes(group)&&!readActions.some(action=>row.method==='GET'&&action.source===row.action)&&row.action!=='process-data').map(({method,path,object,boundary})=>({method,path,object,boundary,status:'not-executable'})),
  message:'目录是接口能力清单，不代表当前账号权限或数据存在。inspect/query 每次通过原业务接口校验。prepare 仅形成待核对草稿，不保存、不审批、不执行。'};
}

// Small schema description for discovery; Zod remains the validator. Refinements
// are explicitly listed as program rules rather than misrepresented as JSON Schema.
export function describeSchema(schema){
 const d=schema._def,name=d.typeName;
 if(name==='ZodOptional')return{...describeSchema(d.innerType),optional:true};
 if(name==='ZodDefault')return{...describeSchema(d.innerType),default:d.defaultValue()};
 if(name==='ZodEffects')return{...describeSchema(d.schema),programValidation:true};
 if(name==='ZodObject')return{type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(schema.shape).map(([key,value])=>[key,describeSchema(value)]))};
 if(name==='ZodDiscriminatedUnion')return{oneOf:d.options.map(describeSchema)};
 if(name==='ZodLiteral')return{const:d.value};
 if(name==='ZodEnum')return{type:'string',enum:d.values};
 if(name==='ZodArray')return{type:'array',items:describeSchema(d.type),minItems:d.minLength?.value,maxItems:d.maxLength?.value};
 if(name==='ZodString')return{type:'string',checks:d.checks};
 if(name==='ZodNumber')return{type:'number',checks:d.checks};
 throw new Error('Unsupported contract schema: '+name);
}
