import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Pure synthetic identity lookups; never imports the standalone database runtime.
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'test-output/service-order-customer-keys-bundle.mjs');
await fs.mkdir(path.dirname(out),{recursive:true});
await build({stdin:{contents:`export {serviceOrderCustomerKeys} from './lib/service-workspace';export {all,clean,indexReadState,readStateIndexToken} from './lib/domain';export {historicalCustomerIdentities} from './lib/customer-identities';`,resolveDir:root},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'identity-test-only-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'bindings',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env={};export async function getChatGPTUser(){return null}'}));
}}]});
const {serviceOrderCustomerKeys:keys,all,clean,indexReadState,readStateIndexToken,historicalCustomerIdentities}=await import(pathToFileURL(out).href);
const state=records=>({revision:1,records}),customer=(id,customer,customerCode,active=true)=>({id,kind:'customer_account',customer,customerCode,active});
const profile=(id,customerId,code)=>({id,kind:'service_record',type:'customer_profile',customerId,source:{confirmedCustomerCode:code}});
const history=(id,customerId,name,code,extra={})=>({id,kind:'customer_workflow_identity',origin:'customer-master-edit',customerVersion:1,customerId,name,code,...extra});

// Previous exhaustive ambiguity rule is an independent oracle for authorization
// equivalence, including malformed/duplicate historical profile claims.
function previousKeys(s,account){
 const nameKey=value=>clean(value).toLowerCase(),accounts=all(s,'customer_account'),profiles=all(s,'service_record').filter(row=>row.type==='customer_profile');
 const claims=id=>profiles.filter(row=>row.customerId===id).map(row=>row.source?.confirmedCustomerCode).filter(value=>typeof value==='string'&&clean(value).length>0&&clean(value).length<=160).map(clean);
 const confirmed=id=>{const rows=profiles.filter(row=>row.customerId===id);if(rows.length!==1)return '';const code=rows[0].source?.confirmedCustomerCode;return typeof code==='string'&&clean(code).length<=160?clean(code):'';};
 const candidates=[account.customer,account.customerCode,confirmed(account.id),...historicalCustomerIdentities(s,account.id)].map(clean).filter(Boolean);
 return [...new Set(candidates)].filter(candidate=>!accounts.some(other=>other.id!==account.id&&[other.customer,other.customerCode,...claims(other.id),...historicalCustomerIdentities(s,other.id)].some(value=>!!nameKey(value)&&nameKey(value)===nameKey(candidate))));
}
const records=[
 customer('a',' Ａｌｐｈａ ','A'),customer('b','Beta','B'),customer('c','Gamma','G'),customer('inactive','Inactive','X',false),
 profile('pa','a',' LEGACY-A '),profile('pb1','b','Shared'),profile('pb2','b','unrelated'),profile('pc','c','ＳＨＡＲＥＤ'),profile('orphan','missing','A'),
 history('ha','a','Old Alpha','OLD-A'),history('hb','b','old alpha','OLD-B'),history('hi','inactive','ARCHIVED','OLD-X'),
 history('legacy-valid','c','Customer old','Reviewed',{origin:'user-confirmed-legacy-code',confirmedCode:'Reviewed',actorId:'synthetic-operator',reason:'confirmed from synthetic source'}),
 history('legacy-invalid','c','Not authorized','Unverified',{origin:'user-confirmed-legacy-code',confirmedCode:'Unverified',actorId:'',reason:''}),
 history('invalid-version','c','Invalid version','INVALID',{customerVersion:0}),
];
for(const indexed of [false,true]){
 const s=indexed?indexReadState(state(structuredClone(records))):state(structuredClone(records));
 for(const c of all(s,'customer_account'))assert.deepEqual(keys(s,c),previousKeys(state(structuredClone(s.records)),c));
 const a=s.records.find(row=>row.id==='a'),b=s.records.find(row=>row.id==='b'),c=s.records.find(row=>row.id==='c');
 assert.deepEqual(keys(s,a),['Alpha','A','LEGACY-A','OLD-A']);
 assert(!keys(s,b).includes('Shared'),'multiple own profiles cannot supply a confirmed code');
 assert(!keys(s,c).some(value=>clean(value).toLowerCase()==='shared'),'all claims of another customer block an ambiguous confirmed code');
 assert(!keys(s,c).includes('Unverified'));assert(!keys(s,c).includes('INVALID'));
 assert(keys(s,c).includes('Reviewed'));
 assert(!keys(s,{...c,customerCode:'ARCHIVED'}).includes('ARCHIVED'),'inactive customers retain their collision claims');
 const result=keys(s,a);result.push('injected');result.splice(0,1);assert.deepEqual(keys(s,a),['Alpha','A','LEGACY-A','OLD-A']);
}
console.log('PASS identity ambiguity, duplicate profile claims, historical evidence, Unicode and result isolation preserve the original rules');

// Writes may update an existing State and its existing rows in place. Those
// callers have no GET token and must observe every update, even at equal length.
const mutable=state([customer('a','Alpha','A'),customer('b','Beta','B'),profile('p','a','Reviewed'),history('h','a','Old','OLD')]),a=mutable.records[0],b=mutable.records[1];
assert.equal(readStateIndexToken(mutable),undefined);assert(keys(mutable,a).includes('Reviewed'));assert(keys(mutable,a).includes('OLD'));
mutable.records[2].source.confirmedCustomerCode='Changed';mutable.records[3].code='NEW-OLD';
assert(keys(mutable,a).includes('Changed'));assert(!keys(mutable,a).includes('Reviewed'));assert(keys(mutable,a).includes('NEW-OLD'));assert(!keys(mutable,a).includes('OLD'));
b.customerCode='Changed';assert(!keys(mutable,a).includes('Changed'));
b.customerCode='B';assert(keys(mutable,a).includes('Changed'));
mutable.records[3]={...mutable.records[3],origin:'unconfirmed'};assert(!keys(mutable,a).includes('NEW-OLD'));
mutable.records.push(profile('duplicate','a','Other'));assert(!keys(mutable,a).includes('Changed'));mutable.records.pop();assert(keys(mutable,a).includes('Changed'));
console.log('PASS mutable/write states observe changed master, source, history and duplicate-profile records without stale caches');

// A new read snapshot or a rebuilt GET index cannot reuse the previous lookup.
const get=indexReadState(state([customer('a','Alpha','A'),customer('b','Beta','B'),history('get-history','a','Past','GET-OLD')])),getA=get.records[0];
const token=readStateIndexToken(get);assert(token);assert(keys(get,getA).includes('A'));assert(keys(get,getA).includes('GET-OLD'));
const next=indexReadState(state(structuredClone(get.records)));next.records[1].customerCode='A';next.records[2].code='NEXT-HISTORY';
assert(!keys(next,next.records[0]).includes('A'));assert(!keys(next,next.records[0]).includes('GET-OLD'));assert(keys(next,next.records[0]).includes('NEXT-HISTORY'));
get.records[1].customerCode='A';get.records[2].code='GET-NEW';indexReadState(get);
assert.notEqual(readStateIndexToken(get),token);assert(!keys(get,getA).includes('A'));assert(!keys(get,getA).includes('GET-OLD'));assert(keys(get,getA).includes('GET-NEW'));
get.records=[customer('a','Alpha','A'),customer('b','Beta','B')];assert.equal(readStateIndexToken(get),undefined);assert(keys(get,get.records[0]).includes('A'));
indexReadState(get);get.records.push(customer('c','Other','A'));assert.equal(readStateIndexToken(get),undefined);assert(!keys(get,get.records[0]).includes('A'));
console.log('PASS new/reindexed GET snapshots and changed record arrays cannot reuse an old identity cache');

// Deterministic varied collision fixtures compare against the exhaustive rule.
for(let seed=0;seed<20;seed++){
 const rows=[];
 for(let i=0;i<12;i++){
  rows.push(customer('c'+i,'Customer '+i,'CODE-'+((i+seed)%9),i%4!==0));
  if((i+seed)%3!==0)rows.push(profile('p'+i,'c'+i,(i+seed)%4===0?42:' REVIEW-'+((i+seed)%8)+' '));
  if(i%5===0)rows.push(profile('duplicate'+i,'c'+i,'CODE-'+((i+seed+1)%9)));
  if(i%2===0)rows.push(history('h'+i,'c'+i,'Old '+((i+seed)%5),'OLD-'+i));
 }
 const s=indexReadState(state(rows));
 for(const c of all(s,'customer_account'))assert.deepEqual(keys(s,c),previousKeys(state(structuredClone(rows)),c));
}
console.log('PASS varied synthetic customer/profile/history collisions match exhaustive authorization semantics');

// The real-size lookup pattern used by finance tasks is order × customer. Each
// source field should be read only while building one request-local index.
let masterReads=0,profileReads=0;
const customers=Array.from({length:209},(_,i)=>({id:'scale-c'+i,kind:'customer_account',active:true,get customer(){masterReads++;return 'Synthetic '+i;},get customerCode(){masterReads++;return 'SYN-'+i;}}));
const profiles=customers.map((c,i)=>({id:'scale-p'+i,kind:'service_record',type:'customer_profile',customerId:c.id,source:{get confirmedCustomerCode(){profileReads++;return 'LEGACY-'+i;}}}));
const scale=indexReadState(state([...customers,...profiles,...Array.from({length:15724},(_,i)=>({id:'synthetic-audit'+i,kind:'audit'}))]));
const started=performance.now();
for(let i=0;i<1780;i++)assert.equal(customers.find(c=>keys(scale,c).includes('SYN-'+(i%209)))?.id,'scale-c'+(i%209));
const elapsedMs=Math.round(performance.now()-started);
assert(masterReads<=209*4,`master fields repeatedly scanned: ${masterReads}`);assert(profileReads<=209*2,`profiles repeatedly scanned: ${profileReads}`);
console.log(`PASS 209-customer / 1780-order lookup shares one immutable GET index (${elapsedMs} ms; master reads ${masterReads}; profile reads ${profileReads})`);
