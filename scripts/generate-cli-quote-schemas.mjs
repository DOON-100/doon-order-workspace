// Development-only generation. Employees receive static fields, never server modules.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),folder=await fs.mkdtemp(path.join(root,'test-output/cli-contract-'));
try{
 const entry=path.join(folder,'schemas.mjs');
 await build({stdin:{contents:"export {ieQuoteInput} from './lib/ie-quotes';export {customerQuoteInput} from './lib/customer-quotes';export {customerPriceDatasetSchema} from './lib/customer-price-archive';",resolveDir:root},outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'no-server-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'bindings',namespace:'cli-schema'}));b.onLoad({filter:/.*/,namespace:'cli-schema'},()=>({contents:"export const env={};export async function getChatGPTUser(){throw Error('No identity in schema generator');}"}));}}]});
 const source=await import(pathToFileURL(entry).href);
 const field=schema=>{
  const required=!schema.isOptional(),nullable=schema.isNullable();let current=schema;
  while(['ZodEffects','ZodOptional','ZodNullable','ZodDefault','ZodBranded'].includes(current._def.typeName))current=current._def.schema||current._def.innerType||current._def.type;
  const def=current._def,name=def.typeName;let result;
  if(name==='ZodString')result={type:'string'};
  else if(name==='ZodNumber')result={type:'number'};
  else if(name==='ZodBoolean')result={type:'boolean'};
  else if(name==='ZodObject')result={type:'object',properties:Object.fromEntries(Object.entries(current.shape).map(([key,value])=>[key,field(value)]))};
  else if(name==='ZodArray')result={type:'array',items:field(def.type),...(def.minLength?{min:def.minLength.value}:{}),...(def.maxLength?{max:def.maxLength.value}:{})};
  else if(name==='ZodEnum')result={type:'string',enum:current.options};
  else if(name==='ZodLiteral')result={type:typeof def.value,enum:[def.value]};
  else if(name==='ZodUnknown'||name==='ZodAny')result={type:'json'};
  else if(name==='ZodUnion'){
   const options=def.options.map(field);if(!options.every(value=>value.type==='string'))return {type:'json',...(required?{required:true}:{})};
   // Date-or-empty input. Date validation remains authoritative on the server.
   result={type:'string'};
  }else throw Error('Unsupported schema type: '+name);
  for(const check of def.checks||[])if(check.kind==='min')result.min=check.value;else if(check.kind==='max')result.max=check.value;else if(check.kind==='int')result.integer=true;
  return {...result,...(required?{required:true}:{}),...(nullable?{nullable:true}:{})};
 };
 const schemas={ie:field(source.ieQuoteInput).properties,customer:field(source.customerQuoteInput).properties,prices:field(source.customerPriceDatasetSchema).properties};
 const text="// Generated from the server's Zod inputs. Run scripts/generate-cli-quote-schemas.mjs.\nimport type {WriteSchema} from './write-input.js';\nexport const quoteSchemas="+JSON.stringify(schemas,null,2)+" satisfies Record<string,WriteSchema>;\n";
 const output=path.join(root,process.argv.includes('--draft')?'test-output/quote-schemas.ts':'cli/src/quote-schemas.ts');
 if(process.argv.includes('--check')){if(await fs.readFile(output,'utf8')!==text)throw Error('CLI quote schema has drifted');}else await fs.writeFile(output,text);
 console.log('PASS static quote input contracts');
}finally{
 const target=path.resolve(folder),base=path.resolve(root,'test-output');if(path.dirname(target)!==base||!path.basename(target).startsWith('cli-contract-'))throw Error('Unsafe contract cleanup');
 await fs.rm(target,{recursive:true,force:true});
}
