// Explicit local maintenance. Supply a private, reviewed configuration file.
// Defaults to read-only dry-run. Never reads passwords, tokens or sessions.
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const args=process.argv.slice(2),usage='Usage: --build-dir <validated build> --config <private JSON> [--dry-run | --apply]';
const flags=new Set(['--build-dir','--config','--dry-run','--apply']),options={};
for(let i=0;i<args.length;i++){
 const key=args[i];if(!flags.has(key)||Object.hasOwn(options,key))throw new Error(usage);
 if(['--build-dir','--config'].includes(key)){const value=args[++i];if(!value||value.startsWith('--'))throw new Error(usage);options[key]=value;}
 else options[key]=true;
}
if(!options['--build-dir']||!options['--config']||(options['--dry-run']&&options['--apply']))throw new Error(usage);
const apply=!!options['--apply'],buildDir=path.resolve(options['--build-dir']),dataDir=path.resolve(process.env.DOON_DATA_DIR||'lan-data');
for(const filename of ['runtime.mjs','workspace-api.mjs'])await fs.access(path.join(buildDir,filename));
const config=JSON.parse((await fs.readFile(options['--config'],'utf8')).replace(/^\uFEFF/,''));
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=value=>typeof value==='string'&&value.length>0&&value===value.trim()&&value.length<=240;
const unique=values=>new Set(values).size===values.length;
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
assert(exactKeys(config,['memberIds','aliasesByMember','expectedMembers','confirmedBindings']),'Invalid configuration properties.');
assert(Array.isArray(config.memberIds)&&config.memberIds.length<=1000&&config.memberIds.every(string)&&unique(config.memberIds),'memberIds must be unique, nonempty member IDs.');
assert(object(config.aliasesByMember),'aliasesByMember must be an object.');
for(const [id,aliases] of Object.entries(config.aliasesByMember))assert(config.memberIds.includes(id)&&Array.isArray(aliases)&&aliases.length<=30&&aliases.every(string)&&unique(aliases),'Every alias entry must belong to a configured member and contain unique nonempty names.');
const expected=config.expectedMembers??[],bindings=config.confirmedBindings??[];
assert(Array.isArray(expected)&&expected.every(value=>exactKeys(value,['id','name','username'])&&['id','name','username'].every(key=>string(value[key])))&&unique(expected.map(value=>value.id)),'Invalid expectedMembers identity checks.');
assert(expected.every(value=>config.memberIds.includes(value.id)),'Expected member checks must refer to configured member IDs.');
assert(Array.isArray(bindings)&&bindings.every(value=>exactKeys(value,['quoteId','customerAccountId','expectedVersion'])&&string(value.quoteId)&&string(value.customerAccountId)&&Number.isSafeInteger(value.expectedVersion)&&value.expectedVersion>0)&&unique(bindings.map(value=>value.quoteId)),'Invalid or repeated confirmedBindings.');

const canonicalPolicy=value=>JSON.stringify({memberIds:[...value.memberIds].sort(),aliasesByMember:Object.fromEntries([...value.memberIds].sort().map(id=>[id,[...(value.aliasesByMember[id]||[])].sort()]))});
const desiredPolicy=canonicalPolicy(config),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readRows=db=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
// Deliberately avoid SELECT * or credential columns in local_accounts.
const readAccounts=db=>db.prepare('SELECT id,username,member_id FROM local_accounts ORDER BY id').all();
const readRevision=db=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision;
const fileHashes=async()=>{
 const result={};
 for(const file of await fs.readdir(path.join(dataDir,'files'),{withFileTypes:true})){
  assert(file.isFile(),'Unexpected directory in immutable file storage.');
  result[file.name]=sha(await fs.readFile(path.join(dataDir,'files',file.name)));
 }
 return result;
};
const quoteFields=['companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','quoteNo','quoteDate','validUntil','currency','lines','terms','reviewNotes'];
const sourceFields=['sourceFileKey','sourceFilename','sourceHash','sourceContentType'];
function plannedBinding(entities,binding){
 const q=entities.find(value=>value.kind==='customer_quote'&&value.id===binding.quoteId);
 const customer=entities.find(value=>value.kind==='customer_account'&&value.id===binding.customerAccountId);
 assert(q&&q.status==='draft','Binding quotation is missing or is not a draft.');
 assert(customer?.active,'Binding customer is missing or inactive.');
 if(q.customerAccountId===binding.customerAccountId){
  const old=entities.find(value=>value.kind==='customer_quote_revision'&&value.quoteId===q.id&&value.version===binding.expectedVersion)?.snapshot;
  const latest=entities.find(value=>value.kind==='customer_quote_revision'&&value.quoteId===q.id&&value.version===q.version)?.snapshot;
  assert(q.version===binding.expectedVersion+1&&old?.customerAccountId===null&&latest&&JSON.stringify(latest)===JSON.stringify(q),'Already bound quotation has drifted from the requested first binding.');
  assert(sourceFields.every(key=>old[key]===q[key]),'The first binding did not preserve the original source pointer.');
  assert(quoteFields.filter(key=>!['customerAccountId','customerName','customerCode'].includes(key)).every(key=>JSON.stringify(old[key])===JSON.stringify(q[key])),'Already bound quotation content differs from the reviewed version.');
  assert(q.customerName===customer.customer&&q.customerCode===(customer.customerCode||old.customerCode),'Already bound customer identity has drifted.');
  return {binding,q,customer,skip:true};
 }
 assert(q.customerAccountId===null,'Only a first, explicitly confirmed unbound-to-customer association is supported.');
 assert(q.version===binding.expectedVersion,'Binding quote version has changed. No maintenance write was attempted.');
 return {binding,q,customer,skip:false};
}
function preflight(db){
 const initialRevision=readRevision(db),rows=readRows(db),entities=rows.map(row=>JSON.parse(row.data)),accounts=readAccounts(db);
 const policies=entities.filter(value=>value.kind==='customer_quote_access');
 assert(policies.length<=1,'Multiple quotation policies exist; resolve manually.');
 if(policies.length){
  const policy=policies[0];
  assert(Array.isArray(policy.memberIds)&&policy.memberIds.every(string)&&unique(policy.memberIds)&&object(policy.aliasesByMember),'Existing quotation policy is malformed.');
  assert(Object.entries(policy.aliasesByMember).every(([id,aliases])=>policy.memberIds.includes(id)&&Array.isArray(aliases)&&aliases.every(string)&&unique(aliases)),'Existing aliases are malformed.');
  assert(canonicalPolicy(policy)===desiredPolicy,'Existing quotation policy differs; refusing to overwrite it.');
 }
 for(const id of config.memberIds){
  const member=entities.find(value=>value.kind==='member'&&value.id===id),account=accounts.find(value=>value.member_id===id);
  assert(member?.active&&account&&member.userId===account.id,'A configured member is missing, inactive, or has no matching local account.');
 }
 for(const check of expected){
  const member=entities.find(value=>value.kind==='member'&&value.id===check.id),account=accounts.find(value=>value.member_id===check.id);
  assert(member?.name===check.name&&account?.username===check.username,'Expected member name or login differs; stop for manual confirmation.');
 }
 const owners=entities.filter(value=>value.kind==='member'&&value.active&&value.owner&&value.role==='admin'&&accounts.some(account=>account.member_id===value.id&&account.id===value.userId));
 assert(owners.length===1,'Exactly one active local owner administrator is required.');
 const plans=bindings.map(binding=>plannedBinding(entities,binding)),revision=readRevision(db);
 assert(Number.isSafeInteger(revision)&&initialRevision===revision,'Concurrent changes occurred while inspecting records; retry after review.');
 return {rows,entities,accounts,policy:policies[0]||null,owner:owners[0],plans,revision};
}

let db=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});
let baseline,priorFiles,report={mode:apply?'apply':'dry-run',policyAdded:false,policyAlreadyPresent:false,bindingsApplied:0,bindingsAlreadyPresent:0,preserved:false};
let failure;
try{
 baseline=preflight(db);priorFiles=await fileHashes();
 assert(Object.values(db.prepare('PRAGMA integrity_check').get())[0]==='ok','Database integrity check failed.');
 report.policyAlreadyPresent=!!baseline.policy;
 report.bindingsAlreadyPresent=baseline.plans.filter(plan=>plan.skip).length;
 report.memberCount=config.memberIds.length;report.plannedBindings=baseline.plans.filter(plan=>!plan.skip).length;
 if(apply){
  db.close();
  const runtime=await import(pathToFileURL(path.join(buildDir,'runtime.mjs'))),api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')));
  db=runtime.db;
  assert(path.resolve(runtime.dataDir)===dataDir,'Runtime data directory differs from preflight.');
  // Recheck under the writable connection before the first write.
  const live=preflight(db);
  assert(live.revision===baseline.revision&&JSON.stringify(live.accounts)===JSON.stringify(baseline.accounts),'Concurrent changes occurred during preflight; retry after review.');
  const identity={identity:{userId:live.owner.userId,email:live.owner.email,displayName:live.owner.name,fullName:live.owner.name}};
  const call=async(action,body)=>{
   const method=body===undefined?'GET':'POST',request=new Request('http://localhost:8787/api/workspace/'+action,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const response=await runtime.context.run(identity,()=>api[method](request,{params:Promise.resolve({action})}));
   const result=await response.json();assert(response.ok,'Validated quotation API rejected maintenance ('+response.status+'); no database restore was attempted.');return result;
  };
  // Ensure the supplied build supports the new access contract before insertion.
  const access=await call('customer-quote-access');assert(Object.hasOwn(access,'policy'),'Build does not support customer quotation access configuration.');
  if(!live.policy){
   const at=new Date().toISOString(),policy={id:'customer_quote_access_'+randomUUID(),kind:'customer_quote_access',memberIds:config.memberIds,aliasesByMember:config.aliasesByMember,createdAt:at,createdById:live.owner.id};
   const audit={id:'audit_'+randomUUID(),kind:'audit',lineId:'',targetId:policy.id,action:'确认客户报价权限范围',actorId:live.owner.id,actor:live.owner.name,source:'本机客户报价授权维护',before:null,after:policy,createdAt:at};
   runtime.transaction(()=>{
    assert(readRevision(db)===live.revision,'Concurrent data change; policy was not inserted.');
    assert(db.prepare("SELECT count(*) AS count FROM records WHERE kind='customer_quote_access'").get().count===0,'Quotation policy appeared during maintenance.');
    const insert=db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?)');
    for(const value of [policy,audit])insert.run(value.id,value.kind,JSON.stringify(value));
    db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
   });
   report.policyAdded=true;
  }
  for(const plan of live.plans){
   if(plan.skip)continue;
   const payload=Object.fromEntries(quoteFields.map(key=>[key,plan.q[key]]));
   Object.assign(payload,{id:plan.q.id,version:plan.binding.expectedVersion,customerAccountId:plan.customer.id,customerName:plan.customer.customer,customerCode:plan.customer.customerCode||plan.q.customerCode});
   const result=await call('customer-quote-save',payload);
   assert(result.quote?.version===plan.binding.expectedVersion+1,'Unexpected quotation version after binding.');
   report.bindingsApplied++;
  }
 }
}catch(error){failure=error;}
finally{
 try{
  if(baseline){
   const after=readRows(db),byId=new Map(after.map(row=>[row.id,row])),oldIds=new Set(baseline.rows.map(row=>row.id));
   const bindingIds=new Set(baseline.plans.filter(plan=>!plan.skip).map(plan=>plan.q.id));
   for(const row of baseline.rows){
    const current=byId.get(row.id);assert(current&&current.kind===row.kind,'An existing record disappeared or changed kind.');
    if(current.data===row.data)continue;
    assert(apply&&row.kind==='customer_quote'&&bindingIds.has(row.id),'An unrelated historical record changed.');
    const plan=baseline.plans.find(value=>value.q.id===row.id),value=JSON.parse(current.data),before=JSON.parse(row.data);
    assert(value.customerAccountId===plan.customer.id&&value.customerName===plan.customer.customer&&value.customerCode===(plan.customer.customerCode||before.customerCode)&&value.version===before.version+1,'Unexpected quotation identity/version mutation.');
    const allowed=new Set(['customerAccountId','customerName','customerCode','version','updatedAt','updatedBy','updatedById']);
    assert([...new Set([...Object.keys(before),...Object.keys(value)])].filter(key=>!allowed.has(key)).every(key=>JSON.stringify(before[key])===JSON.stringify(value[key])),'Binding changed quotation contents or source metadata.');
   }
   const additions=after.filter(row=>!oldIds.has(row.id));
   const newPolicies=new Set(additions.filter(row=>row.kind==='customer_quote_access').map(row=>row.id));
   assert(newPolicies.size===(report.policyAdded?1:0),'Unexpected quotation policy additions.');
   for(const row of additions){
    const value=JSON.parse(row.data);
    assert(apply&&((row.kind==='customer_quote_access'&&canonicalPolicy(value)===desiredPolicy)||(row.kind==='customer_quote_revision'&&bindingIds.has(value.quoteId))||(row.kind==='audit'&&(newPolicies.has(value.targetId)||bindingIds.has(value.targetId)))),'Unexpected record addition.');
   }
   assert(JSON.stringify(readAccounts(db))===JSON.stringify(baseline.accounts),'Local account identity metadata changed.');
   const currentFiles=await fileHashes();assert(JSON.stringify(Object.entries(currentFiles).sort())===JSON.stringify(Object.entries(priorFiles).sort()),'Original attachment storage changed.');
   report.preserved=true;report.existingRecordCount=baseline.rows.length;report.recordsAdded=additions.length;
  }
 }catch(error){failure=new Error('Preservation verification failed. No automatic database rollback was attempted. '+error.message);}
 try{db.close();}catch{}
 console.log(JSON.stringify({...report,ok:!failure}));
}
if(failure)throw failure;
