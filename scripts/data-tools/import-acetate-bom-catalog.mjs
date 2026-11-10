// Explicit, additive maintenance import. Business input stays outside the public repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
if(!option('--build-dir')||!option('--input')||!option('--source')||!process.env.DOON_DATA_DIR)throw Error('Required: --build-dir, --input, --source, explicit DOON_DATA_DIR; use --apply after reviewing the dry-run.');
const build=path.resolve(option('--build-dir')),data=path.resolve(process.env.DOON_DATA_DIR),input=JSON.parse(await fs.readFile(option('--input'),'utf8')),source=await fs.readFile(option('--source')),sourceSha256=createHash('sha256').update(source).digest('hex');
if(input.sourceSha256!==sourceSha256||input.sourceFilename!==path.basename(option('--source')))throw Error('Reviewed source does not match input.');
let db=new DatabaseSync(path.join(data,'workspace.sqlite'),{readOnly:true});
const entries=()=>db.prepare('SELECT id,data FROM records ORDER BY id').all(),before=entries(),catalogs=before.map(r=>JSON.parse(r.data)).filter(r=>r.kind==='acetate_bom_catalog').sort((a,b)=>b.version-a.version),same=catalogs.find(r=>r.sourceSha256===sourceSha256&&JSON.stringify(r.stocks)===JSON.stringify(input.stocks));
if(catalogs.length&&!same)throw Error('An existing different catalog requires review in the application; maintenance import will not replace it.');
const report={apply:args.includes('--apply'),alreadyPresent:!!same,count:input.stocks?.length||0,sourceSha256,preserved:false};
try{
 if(report.apply&&!same){
  const members=before.map(r=>JSON.parse(r.data)).filter(r=>r.kind==='member'&&r.active&&r.role==='admin'&&r.owner);if(members.length!==1)throw Error('Exactly one active owner administrator is required.');
  const m=members[0];db.close();const runtime=await import(pathToFileURL(path.join(build,'runtime.mjs'))),api=await import(pathToFileURL(path.join(build,'workspace-api.mjs')));db=runtime.db;if(path.resolve(runtime.dataDir)!==data)throw Error('Runtime data path mismatch.');
  const payload={...input,version:0,token:randomUUID()},req=new Request('http://localhost:8787/api/workspace/acetate-bom-catalog-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const response=await runtime.context.run({identity:{userId:m.userId,email:m.email,displayName:m.name}},()=>api.POST(req,{params:Promise.resolve({action:'acetate-bom-catalog-import'})}));const result=await response.json();if(!response.ok)throw Error('Catalog API refused import: '+(result.error||response.status));report.catalogId=result.id;
 }
 const after=new Map(entries().map(r=>[r.id,r.data]));for(const old of before)if(after.get(old.id)!==old.data)throw Error('Existing record preservation failed; no automatic rollback performed.');
 report.preserved=true;report.added=after.size-before.length;console.log(JSON.stringify(report));
}finally{db.close();}
