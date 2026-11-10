import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Load the independent fixed-fee entry, not the main workspace route. An import
// cycle here once reached IE schema initialization before its numeric schema.
const dir=path.resolve('test-output','ie-offline-imports-'+process.pid);await fs.mkdir(dir,{recursive:true});
const outfile=path.join(dir,'entry.mjs');
const result=await build({stdin:{contents:"export {fixedToolFeesGet,fixedToolFeesPost} from './lib/fixed-tool-fees';export {businessFollowupScopeIdentity} from './lib/business-followup-scope';",resolveDir:process.cwd(),sourcefile:'synthetic-offline-import-entry.ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,alias:{'@':process.cwd()},plugins:[{name:'synthetic-no-environment',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'synthetic'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return null}':'export const env={};'}));}}]});
const api=await import(pathToFileURL(outfile).href);assert.equal(typeof api.fixedToolFeesGet,'function');assert.equal(typeof api.fixedToolFeesPost,'function');
assert.deepEqual(result.metafile.inputs['lib/business-followup-scope.ts'].imports.map(item=>item.path),['lib/domain.ts']);
const quote={id:'synthetic_quote',kind:'ie_quote',customerAccountId:'synthetic_customer'};
assert.equal(api.businessFollowupScopeIdentity({records:[quote]},quote),' {"id":"synthetic_quote","kind":"ie_quote","customerId":"synthetic_customer","customerOrder":"","teamId":"","type":"","channel":"","links":{}}'.trim());
const legacy={id:'synthetic_followup',kind:'customer_project_followup',customer:' Ｃustomer ',customerName:' NAME ',customerCode:' ABC ',ownerId:' owner ',customerOrder:' PO ',teamId:' team ',type:' TYPE ',channel:' CHANNEL '};
assert.equal(api.businessFollowupScopeIdentity({records:[legacy]},legacy),'{"id":"synthetic_followup","kind":"customer_project_followup","customerId":"","customer":"customer","customerName":"name","customerCode":"abc","ownerId":"owner","customerOrder":"PO","teamId":"team","type":"TYPE","channel":"CHANNEL","links":{}}');
const orders=[{id:'order_b',kind:'order',customerId:'customer_b',orderNo:'PO'},{id:'order_a',kind:'order',customerId:'customer_a',orderNo:'PO'}],purchase={id:'synthetic_purchase',kind:'purchase',customerOrder:'PO'},state={records:[purchase,...orders]},before=JSON.stringify(state);
assert.equal(api.businessFollowupScopeIdentity(state,purchase),'{"id":"synthetic_purchase","kind":"purchase","customerId":"","customer":"","customerName":"","customerCode":"","customerOrder":"PO","teamId":"","type":"","channel":"","links":{"customerOrders":[{"id":"order_a","kind":"order","customerId":"customer_a","customerOrder":"","teamId":"","type":"","channel":"","links":{}},{"id":"order_b","kind":"order","customerId":"customer_b","customerOrder":"","teamId":"","type":"","channel":"","links":{}}]}}');
assert.equal(JSON.stringify(state),before);
console.log('PASS independent fixed-fee entry initializes; pure followup scope retains legacy identity bytes, normalization and multi-order ownership ordering');
