// Private business input is supplied by path; never bundled or printed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),opt=n=>{const i=args.indexOf(n);return i<0?'':args[i+1]||'';},apply=args.includes('--apply');
if(!opt('--build-dir')||!opt('--input')||!opt('--source')||!process.env.DOON_DATA_DIR)throw Error('Explicit --build-dir, --input, --source, DOON_DATA_DIR required; default is read-only preview.');
const dir=path.resolve(process.env.DOON_DATA_DIR),build=path.resolve(opt('--build-dir')),input=JSON.parse(await fs.readFile(opt('--input'),'utf8')),source=await fs.readFile(opt('--source')),hash=createHash('sha256').update(source).digest('hex');
if(hash!==input.sourceSha256||input.sourceFilename!==path.basename(opt('--source'))||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>100000||new Set(input.rows.map(r=>r.id)).size!==input.rows.length)throw Error('Source digest, filename, entry identifiers or row count do not match.');
let db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});const read=()=>db.prepare('SELECT id,data FROM records ORDER BY id').all(),before=read(),parsed=before.map(r=>JSON.parse(r.data));
const existing=parsed.find(r=>r.kind==='acetate_material_catalog'&&r.sourceSha256===hash),report={apply,sourceSha256:hash,count:input.rows.length,alreadyPresent:!!existing,preserved:false};
try{
 if(apply&&!existing){
  const owners=parsed.filter(r=>r.kind==='member'&&r.active&&r.role==='admin'&&r.owner);if(owners.length!==1)throw Error('Exactly one active owner administrator is required.');const actor=owners[0];db.close();
  const runtime=await import(pathToFileURL(path.join(build,'runtime.mjs'))),api=await import(pathToFileURL(path.join(build,'workspace-api.mjs')));db=runtime.db;if(path.resolve(runtime.dataDir)!==dir)throw Error('Runtime data path mismatch.');
  const call=async(action,body)=>{const request=new Request('http://localhost:8787/api/workspace/'+action,{method:'POST',...(body instanceof FormData?{}:{headers:{'Content-Type':'application/json'}}),body:body instanceof FormData?body:JSON.stringify(body)});const r=await runtime.context.run({identity:{userId:actor.userId,email:actor.email,displayName:actor.name}},()=>api.POST(request,{params:Promise.resolve({action})}));const value=await r.json();if(!r.ok)throw Error(`Import API refused (${r.status}): ${value.error||'unknown'}`);return value;};
  const form=new FormData();form.set('sourceSha256',hash);form.set('file',new File([source],input.sourceFilename));await call('acetate-material-original-upload',form);
  const totalBatches=Math.ceil(input.rows.length/500),base={sourceSha256:hash,sourceFilename:input.sourceFilename,totalBatches};
  for(let batch=0;batch<totalBatches;batch++){await call('acetate-material-import',{...base,batch,rows:input.rows.slice(batch*500,batch*500+500),finalize:false});if(batch%20===0)console.error('Validated batch '+(batch+1)+'/'+totalBatches);}
  const result=await call('acetate-material-import',{...base,batch:0,rows:[],finalize:true});report.catalogId=result.id;
 }
 const after=new Map(read().map(r=>[r.id,r.data]));for(const r of before)if(after.get(r.id)!==r.data)throw Error('An existing record changed during import. Investigate concurrent writes; no automatic data restore.');
 report.preserved=true;report.added=after.size-before.length;console.log(JSON.stringify(report));
}finally{db.close();}
