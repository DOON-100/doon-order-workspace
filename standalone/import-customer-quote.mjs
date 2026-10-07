// Local, explicitly requested maintenance import. Never loads passwords or sessions.
// Business data remains outside source control; all existing records stay byte-identical.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
for(const name of ['--build-dir','--draft','--source'])if(!option(name))throw new Error('Required: --build-dir <validated build> --draft <private JSON> --source <original workbook>');
const buildDir=path.resolve(option('--build-dir'));
const draft=JSON.parse(await fs.readFile(option('--draft'),'utf8'));
const source=await fs.readFile(option('--source'));
const hash=createHash('sha256').update(source).digest('hex');
if(draft.sourceSha256&&hash!==draft.sourceSha256)throw new Error('Original source checksum does not match reviewed draft.');
const payload=Object.fromEntries(['companyEn','companyZh','collectionEn','collectionZh','customerCode','quoteNo','quoteDate','validUntil','currency','lines','terms','reviewNotes'].map(k=>[k,draft[k]]));
// Customer matching is a separate, explicit business decision. Do not infer it from file paths.
payload.customerName=draft.customerName||draft.customerCode;
payload.customerAccountId=null;
const {db,context,records,memberFor}=await import(pathToFileURL(path.join(buildDir,'runtime.mjs')));
const api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')));
const before=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const oldIds=new Set(before.map(r=>r.id));
const report={sourceVerified:true,existingRecords:before.length,added:0,preserved:false};
try{
 const existing=records().filter(r=>r.kind==='customer_quote'&&r.quoteNo===payload.quoteNo&&r.customerCode===payload.customerCode);
 if(existing.length){
  if(existing.length===1&&existing[0].sourceHash===hash){report.alreadyPresent=true;report.quoteId=existing[0].id;}
  else throw new Error('Quotation already exists. No existing quotation was changed; review it through the app.');
 }else{
  // Select only account/member identity columns, never SELECT * from local_accounts.
  const account=db.prepare("SELECT a.id,a.member_id FROM local_accounts a JOIN records r ON r.id=a.member_id WHERE json_extract(r.data,'$.owner')=1 AND json_extract(r.data,'$.active')=1 AND json_extract(r.data,'$.role')='admin'").get();
  const member=memberFor(account);if(!member)throw new Error('An active owner administrator is required for maintenance import.');
  const current={identity:{userId:member.userId,email:member.email,displayName:member.name,fullName:member.name}};
  const call=async(action,body)=>{
   const request=new Request('http://localhost:8787/api/workspace/'+action,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});
   const response=await context.run(current,()=>api.POST(request,{params:Promise.resolve({action})}));
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Quotation import failed.');return result;
  };
  const saved=await call('customer-quote-save',payload);
  report.quoteId=saved.quote.id;
  const form=new FormData();form.set('quoteId',saved.quote.id);form.set('version',String(saved.quote.version));form.set('file',new File([source],path.basename(option('--source')),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const uploaded=await call('customer-quote-upload',form);
  if(uploaded.quote.sourceHash!==hash)throw new Error('Uploaded source checksum differs from source.');
  report.version=uploaded.quote.version;
 }
}finally{
 const after=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),byId=new Map(after.map(r=>[r.id,r]));
 const changed=before.filter(r=>byId.get(r.id)?.data!==r.data||byId.get(r.id)?.kind!==r.kind);
 const additions=after.filter(r=>!oldIds.has(r.id));
 if(changed.length||additions.some(r=>!['customer_quote','customer_quote_revision','audit'].includes(r.kind))){db.close();throw new Error('Preservation check failed; no automatic database rollback was attempted.');}
 report.added=additions.length;report.preserved=true;
 db.close();console.log(JSON.stringify(report));
}
