// Explicit, append-only historical import. Defaults to dry-run; never reads passwords or sessions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const args=process.argv.slice(2),options={},flags=new Set(['--build-dir','--dataset','--customer-id','--source-root','--actor-member-id','--dry-run','--apply']);
for(let i=0;i<args.length;i++){const key=args[i];if(!flags.has(key)||Object.hasOwn(options,key))throw new Error('Unknown or repeated option');if(['--dry-run','--apply'].includes(key))options[key]=true;else{const value=args[++i];if(!value||value.startsWith('--'))throw new Error('Missing option value');options[key]=value;}}
if(!options['--build-dir']||!options['--dataset']||!options['--customer-id']||(options['--apply']&&options['--dry-run']))throw new Error('Usage: --build-dir <validated build> --dataset <private JSON> --customer-id <confirmed customer ID> [--source-root <immutable source snapshot>] [--actor-member-id <confirmed administrator>] [--dry-run|--apply]');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),apply=!!options['--apply'],dataDir=path.resolve(process.env.DOON_DATA_DIR||'lan-data'),buildDir=path.resolve(options['--build-dir']);
for(const filename of ['runtime.mjs','workspace-api.mjs'])await fs.access(path.join(buildDir,filename));
const compiled=await build({entryPoints:['lib/customer-price-archive.ts'],bundle:true,platform:'node',format:'esm',write:false});
const model=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const dataset=JSON.parse((await fs.readFile(options['--dataset'],'utf8')).replace(/^\uFEFF/,''));model.customerPriceDatasetSchema.parse(dataset);
const datasetSha256=hash(model.canonicalPriceJson(dataset)),archiveId='customer_price_archive_'+hash(options['--customer-id']+'|'+datasetSha256);
const dbPath=path.join(dataDir,'workspace.sqlite'),rows=db=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
let db=new DatabaseSync(dbPath,{readOnly:true});const baseline=rows(db),entities=baseline.map(r=>JSON.parse(r.data)),accounts=db.prepare('SELECT id,username,member_id FROM local_accounts ORDER BY id').all();
const account=entities.find(r=>r.kind==='customer_account'&&r.id===options['--customer-id']);if(!account?.active||(account.customerCode&&account.customerCode!==dataset.customer.code))throw new Error('Explicit customer binding is missing, inactive or conflicts with dataset code');
const ownerCandidates=entities.filter(r=>r.kind==='member'&&r.active&&r.owner&&r.role==='admin'),actor=options['--actor-member-id']?entities.find(r=>r.kind==='member'&&r.id===options['--actor-member-id']):ownerCandidates.length===1?ownerCandidates[0]:null;
const policies=entities.filter(r=>r.kind==='customer_quote_access'),policy=policies.length===1?policies[0]:null;
if(!actor?.active||!(actor.role==='admin'||policy?.administratorMemberIds?.includes(actor.id))||!accounts.some(a=>a.member_id===actor.id&&a.id===actor.userId))throw new Error('A confirmed active administrator with its own matching local account is required');
const beforeRevision=db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const originals=[];
if(options['--source-root']){
 const sourceRoot=await fs.realpath(options['--source-root']);
 for(const file of dataset.files.filter(f=>f.status!=='excluded')){
  if(!file.relativePath||path.isAbsolute(file.relativePath)||file.relativePath.split(/[\\/]/).includes('..'))throw new Error('Original relativePath must stay inside confirmed source root');
  const actual=await fs.realpath(path.join(sourceRoot,file.relativePath));if(!actual.startsWith(sourceRoot+path.sep))throw new Error('Original resolved outside confirmed source root');
  const stat=await fs.stat(actual);if(!stat.isFile()||!stat.size||stat.size>64*1024*1024)throw new Error('Original must be a regular file of at most 64 MB');
  const bytes=await fs.readFile(actual);if(!file.sha256||hash(bytes)!==file.sha256.toLowerCase())throw new Error('Original checksum missing or changed; no archive was written');
  originals.push({id:file.id,filename:path.basename(file.relativePath),bytes});
 }
}
const report={mode:apply?'apply':'dry-run',customerId:account.id,datasetSha256,archiveId,products:dataset.products.length,prices:dataset.prices.length,files:dataset.files.length,sourceFilesVerified:originals.length,sourceFilesArchived:0,metadataOnly:!options['--source-root'],alreadyPresent:entities.some(r=>r.id===archiveId),preserved:false};
let failure;
try{
 if(apply){
  db.close();const runtime=await import(pathToFileURL(path.join(buildDir,'runtime.mjs'))),api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')));db=runtime.db;
  if(path.resolve(runtime.dataDir)!==dataDir||db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision!==beforeRevision)throw new Error('Data directory or revision changed since dry preflight');
  const identity={identity:{userId:actor.userId,email:actor.email,displayName:actor.name,fullName:actor.name}};
  const call=async(action,body)=>{const request=new Request('http://localhost:8787/api/workspace/'+action,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});const response=await runtime.context.run(identity,()=>api.POST(request,{params:Promise.resolve({action})}));const result=await response.json();if(!response.ok)throw new Error('Validated archive API rejected import ('+response.status+'): '+(result.error||'unknown'));return result;};
  const result=await call('customer-price-archive-import',{customerAccountId:account.id,dataset,datasetSha256});if(result.id!==archiveId)throw new Error('Archive identity differs from reviewed dataset');report.alreadyPresent=result.alreadyPresent;
  for(const file of originals){const form=new FormData();form.set('archiveId',archiveId);form.set('fileId',file.id);form.set('file',new File([file.bytes],file.filename));await call('customer-price-archive-file-upload',form);report.sourceFilesArchived++;}
 }
}catch(error){failure=error;}
try{
 const verificationDb=new DatabaseSync(dbPath,{readOnly:true});let after;try{after=rows(verificationDb);}finally{verificationDb.close();}const byId=new Map(after.map(r=>[r.id,r])),oldIds=new Set(baseline.map(r=>r.id));
 for(const previous of baseline){const current=byId.get(previous.id);if(!current||current.kind!==previous.kind)throw new Error('An existing unrelated record was removed');if(previous.data===current.data)continue;
  if(!apply||previous.id!==archiveId||previous.kind!=='customer_price_archive')throw new Error('An existing unrelated record changed');const old=JSON.parse(previous.data),next=JSON.parse(current.data),{files:oldFiles,...oldOther}=old,{files:newFiles,...newOther}=next;if(model.canonicalPriceJson(oldOther)!==model.canonicalPriceJson(newOther))throw new Error('An existing historical archive changed');for(const [id,file] of Object.entries(oldFiles||{}))if(model.canonicalPriceJson(file)!==model.canonicalPriceJson(newFiles?.[id]))throw new Error('An existing source pointer was replaced');
 }
 for(const row of after.filter(r=>!oldIds.has(r.id))){const item=JSON.parse(row.data);if(!apply||!(row.id===archiveId&&row.kind==='customer_price_archive'||row.kind==='audit'&&item.targetId===archiveId))throw new Error('Unexpected record addition');}
 report.preserved=true;if(failure)report.incomplete=true;console.log(JSON.stringify(report));if(failure)throw failure;
}finally{db.close();}
