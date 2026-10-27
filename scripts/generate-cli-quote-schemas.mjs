// Development-only generation. Employees receive static fields, never server modules.
import {build} from 'esbuild';
import {field} from './cli-field-schema.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd();await fs.mkdir(path.join(root,'test-output'),{recursive:true});const folder=await fs.mkdtemp(path.join(root,'test-output/cli-contract-'));
try{
 const entry=path.join(folder,'schemas.mjs');
 await build({stdin:{contents:"export {ieQuoteInput} from './lib/ie-quotes';export {customerQuoteInput} from './lib/customer-quotes';export {customerPriceDatasetSchema} from './lib/customer-price-archive';",resolveDir:root},outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'no-server-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'bindings',namespace:'cli-schema'}));b.onLoad({filter:/.*/,namespace:'cli-schema'},()=>({contents:"export const env={};export async function getChatGPTUser(){throw Error('No identity in schema generator');}"}));}}]});
 const source=await import(pathToFileURL(entry).href);
 const schemas={ie:field(source.ieQuoteInput).properties,customer:field(source.customerQuoteInput).properties,prices:field(source.customerPriceDatasetSchema).properties};
 const text="// Generated from the server's Zod inputs. Run scripts/generate-cli-quote-schemas.mjs.\nimport type {WriteSchema} from './write-input.js';\nexport const quoteSchemas="+JSON.stringify(schemas,null,2)+" satisfies Record<string,WriteSchema>;\n";
 const output=path.join(root,process.argv.includes('--draft')?'test-output/quote-schemas.ts':'cli/src/quote-schemas.ts');
 if(process.argv.includes('--check')){if(await fs.readFile(output,'utf8')!==text)throw Error('CLI quote schema has drifted');}else await fs.writeFile(output,text);
 console.log('PASS static quote input contracts');
}finally{
 const target=path.resolve(folder),base=path.resolve(root,'test-output');if(path.dirname(target)!==base||!path.basename(target).startsWith('cli-contract-'))throw Error('Unsafe contract cleanup');
 await fs.rm(target,{recursive:true,force:true});
}
