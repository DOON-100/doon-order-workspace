// Local, explicitly requested maintenance import. Never loads passwords or sessions.
// Business data remains outside source control; all existing records stay byte-identical.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
for(const name of ['--build-dir','--draft','--source'])if(!option(name))throw new Error('Required: --build-dir <validated build> --draft <private JSON> --source <original workbook, PDF or reference image>');
const buildDir=path.resolve(option('--build-dir'));
const draft=JSON.parse(await fs.readFile(option('--draft'),'utf8'));
const source=await fs.readFile(option('--source'));
const hash=createHash('sha256').update(source).digest('hex');
if(draft.sourceSha256&&hash!==draft.sourceSha256)throw new Error('Original source checksum does not match reviewed draft.');
// Check before creating a draft, so an invalid attachment cannot leave a partial import.
const ext=path.extname(option('--source')).toLowerCase().slice(1);
const signatures={xlsx:[0x50,0x4b],xls:[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],pdf:[0x25,0x50,0x44,0x46,0x2d],png:[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],jpg:[0xff,0xd8,0xff],jpeg:[0xff,0xd8,0xff]};
const contentTypes={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
if(!source.length||source.length>10*1024*1024||!signatures[ext]?.every((byte,i)=>source[i]===byte))throw new Error('Source must be an original XLSX, XLS, PDF, PNG or JPEG file within 10 MB, with matching signature. No records were written.');
const fields=['companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','contactName','quoteNo','quoteDate','validUntil','currency','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges','lines','terms','reviewNotes'];
const pick=value=>Object.fromEntries(fields.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
const payload=pick(draft);
// Customer matching is a separate, explicit business decision. Do not infer it from file paths.
payload.customerName=draft.customerName||draft.customerCode;
payload.customerAccountId=null;
// Mirror only the API's non-destructive string normalization/defaults. Numbers,
// nulls and missing optional review fields remain distinct; never coerce prices.
const normalize=value=>{
 const result=structuredClone(pick(value));
 for(const key of ['companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','contactName','quoteNo','currency','internalNotesZh'])if(typeof result[key]==='string')result[key]=result[key].trim();
 result.collectionEn??='';result.collectionZh??='';result.customerAccountId??=null;
 for(const [key,trimKeys] of [['lines',['id','model','quantityBasisZh','quantityBasisEn']],['terms',['id','labelZh','labelEn']],['internalCosts',['id','label','notes']],['customerCharges',['id','labelZh','labelEn','basisZh','basisEn']]]){
  if(Array.isArray(result[key]))result[key]=result[key].map(row=>{const out={...row};for(const field of trimKeys)if(typeof out[field]==='string')out[field]=out[field].trim();if(key==='internalCosts')out.notes??='';return out;});
 }
 return result;
};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(canonical(normalize(value)))).digest('hex');
const expected=normalize(payload),payloadHash=fingerprint(payload);
const {db,context,records,memberFor}=await import(pathToFileURL(path.join(buildDir,'runtime.mjs')));
const api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')));
const before=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const oldIds=new Set(before.map(r=>r.id));
const report={sourceVerified:true,payloadVerified:false,existingRecords:before.length,added:0,preserved:false};
try{
 const existing=records().filter(r=>r.kind==='customer_quote'&&r.quoteNo===expected.quoteNo&&r.customerCode===expected.customerCode);
 if(existing.length){
  const quote=existing[0],samePayload=existing.length===1&&fingerprint(quote)===payloadHash;
  if(samePayload&&quote.status==='draft'&&quote.sourceHash===hash&&quote.sourceFileKey){report.alreadyPresent=true;report.quoteId=quote.id;report.version=quote.version;report.payloadVerified=true;}
  else if(samePayload&&quote.status==='draft'&&!quote.sourceFileKey&&!quote.sourceHash)throw new Error('A matching draft already exists without its source attachment, possibly from an interrupted import. No duplicate was created. Open the existing draft in the app and upload the reviewed source attachment; no existing records were changed.');
  else throw new Error('Quotation already exists with different content/source or a non-draft status. No existing quotation was changed; review it through the app.');
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
  const stored=records().find(r=>r.id===saved.quote.id);
  if(!stored||fingerprint(stored)!==payloadHash)throw new Error('Saved draft fields differ from the reviewed import payload. The draft was retained for manual review; no source attachment was added.');
  report.payloadVerified=true;
  const form=new FormData();form.set('quoteId',saved.quote.id);form.set('version',String(saved.quote.version));form.set('file',new File([source],path.basename(option('--source')),{type:contentTypes[ext]}));
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
