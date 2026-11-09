import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Only synthetic bytes and members; private originals never enter test fixtures.
const at='2026-11-09T00:00:00.000Z';
const member=(id,role='production')=>({id,kind:'member',userId:id,email:id+'@test.invalid',name:id,role,active:true,customers:[],createdAt:at});
const admin=member('evidence-admin','admin'),engineer=member('evidence-engineer'),reviewer=member('evidence-reviewer'),manager=member('evidence-manager'),sales=member('evidence-sales','sales'),other=member('evidence-other');
const s={revision:1,records:[admin,engineer,reviewer,manager,sales,other,{id:'policy',kind:'ie_quote_policy',version:1,engineerMemberId:engineer.id,reviewerMemberId:reviewer.id,finalApproverMemberId:manager.id},{id:'customer',kind:'customer_account',active:true,quoteMemberIds:[sales.id],salesMemberIds:[sales.id],serviceMemberIds:[],customer:'SYNTHETIC',customerCode:'SYN'}]};
const files=new Map();let failCommit=false;
globalThis.__ieEvidenceTest={files,commit:async(revision,rows)=>{if(failCommit||revision!==s.revision)throw Object.assign(new Error('Synthetic conflict'),{status:409});s.records.push(...structuredClone(rows));s.revision++;}};
await fs.mkdir('test-output',{recursive:true});
await build({entryPoints:['lib/ie-supplier-evidence.ts'],outfile:'test-output/ie-supplier-evidence.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'synthetic-evidence-store',setup(b){
 b.onResolve({filter:/^\.\/store$/},()=>({path:'store',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:`export class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}};export const json=v=>Response.json(v);export const commit=(...args)=>globalThis.__ieEvidenceTest.commit(...args);export const audit=(m,t,before,action,source)=>({id:crypto.randomUUID(),kind:'audit',targetId:t.id,before,after:t,action,source,actorId:m.id});export const bucket=()=>({put:async(k,v)=>globalThis.__ieEvidenceTest.files.set(k,v),get:async(k)=>globalThis.__ieEvidenceTest.files.has(k)?{body:globalThis.__ieEvidenceTest.files.get(k)}:null});`}));
}}]});
const api=await import('../test-output/ie-supplier-evidence.mjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstartxref\n9\n%%EOF\n');
const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
const form=(bytes=png,name='synthetic-quotation.png',type='image/png',extra={})=>{const f=new FormData();f.set('file',new File([bytes],name,{type}));for(const [k,v]of Object.entries(extra))f.set(k,v);return f;};
const post=(f=form(),m=engineer)=>api.ieSupplierEvidencePost('ie-supplier-evidence-upload',new Request('https://test.invalid',{method:'POST',body:f}),s,m);
const get=(action='ie-supplier-evidence-list',id='',m=engineer,download=false)=>api.ieSupplierEvidenceGet(action,new URL('https://test.invalid?id='+id+(download?'&download=1':'')),s,m);
const rejected=(fn,status)=>assert.rejects(fn,e=>e.status===status);
assert.equal(await api.ieSupplierEvidenceGet('other',new URL('https://test.invalid'),s,sales),null);
assert.equal(await api.ieSupplierEvidencePost('other',new Request('https://test.invalid'),s,sales),null);
for(const m of [sales,other,{...engineer,active:false}]){await rejected(()=>get('ie-supplier-evidence-list','',m),403);await rejected(()=>post(form(),m),403);}
for(const m of [admin,engineer,reviewer,manager])assert.deepEqual((await(await get('ie-supplier-evidence-list','',m)).json()).evidence,[]);
let first=(await(await post()).json()).evidence;
assert.equal(first.supplier,'');assert.equal(first.quoteDate,'');assert.equal(first.category,'material');assert.equal(first.version,1);assert.equal(first.fileKey,undefined);assert.equal(first.price,undefined);assert.match(first.sha256,/^[a-f0-9]{64}$/);
assert.deepEqual(Buffer.from(await(await get('ie-supplier-evidence',first.id)).arrayBuffer()),png);
const headers=(await get('ie-supplier-evidence',first.id,reviewer,true)).headers;
assert.match(headers.get('Content-Disposition'),/^attachment;/);assert.equal(headers.get('Cache-Control'),'no-store');assert.equal(headers.get('X-Content-Type-Options'),'nosniff');assert.match(headers.get('Content-Security-Policy'),/sandbox/);
const before=s.records.length;assert.equal((await(await post()).json()).duplicate,true);assert.equal(s.records.length,before);
const dated=(await(await post(form(png,'synthetic-quotation.png','image/png',{supplier:'Synthetic Supplier',drawingNo:'SYN-DRAWING',quoteDate:'2026-11-09',notes:'Unread handwritten price remains a note',category:'plating'}))).json()).evidence;
assert.notEqual(dated.id,first.id);assert.equal(dated.supplier,'Synthetic Supplier');assert.equal(dated.drawingNo,'SYN-DRAWING');assert.equal(dated.quoteDate,'2026-11-09');assert.equal(dated.category,'plating');assert.equal(dated.notes,'Unread handwritten price remains a note');
assert.equal(api.requireIeSupplierEvidence(s,engineer,first.id).sha256,first.sha256);
assert.throws(()=>api.requireIeSupplierEvidence(s,sales,first.id),e=>e.status===403);
assert.throws(()=>api.requireIeSupplierEvidence(s,admin,'fake-evidence'),e=>e.status===403);
await rejected(()=>get('ie-supplier-evidence','fake-evidence'),403);
for(const [bytes,name,type] of [[pdf,'synthetic.pdf','application/pdf'],[webp,'synthetic.webp','image/webp'],[jpeg,'synthetic.jpg','image/jpeg']]){
 const item=(await(await post(form(bytes,name,type),admin)).json()).evidence;assert.equal(item.contentType,type);assert.deepEqual(Buffer.from(await(await get('ie-supplier-evidence',item.id)).arrayBuffer()),bytes);
}
for(const f of [form(Buffer.from('<svg onload="alert(1)"/>'),'fake.png'),form(png,'fake.pdf','application/pdf'),form(png,'fake.svg','image/svg+xml'),form(new Uint8Array(),'empty.png'),form(png,'normal.png','text/html'),form(png,'normal.png','image/png',{quoteDate:'2026-02-30'}),form(png,'normal.png','image/png',{category:'forged'}),form(png,'normal.png','image/png',{fileKey:'forged'}),form(png,'normal.png','image/png',{supplier:'x'.repeat(241)})])await rejected(()=>post(f),400);
const duplicate=form();duplicate.append('supplier','A');duplicate.append('supplier','B');await rejected(()=>post(duplicate),400);
const pdfActive=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction 2 0 R >>\nendobj\nstartxref\n9\n%%EOF\n');await rejected(()=>post(form(pdfActive,'active.pdf','application/pdf')),400);
const streamed=new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=test'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(12*1024*1024+65537));c.close();}}),duplex:'half'});
await rejected(()=>api.ieSupplierEvidencePost('ie-supplier-evidence-upload',streamed,s,admin),413);
const raw=s.records.find(r=>r.id===first.id),original=files.get(raw.fileKey);files.set(raw.fileKey,new Uint8Array([1,2,3]).buffer);await rejected(()=>get('ie-supplier-evidence',first.id),409);files.set(raw.fileKey,original);
files.delete(raw.fileKey);await rejected(()=>get('ie-supplier-evidence',first.id),404);files.set(raw.fileKey,original);
const policy=s.records.find(r=>r.kind==='ie_quote_policy');policy.engineerMemberId=other.id;await rejected(()=>get('ie-supplier-evidence',first.id,engineer),403);assert.equal((await get('ie-supplier-evidence',first.id,other)).status,200);policy.engineerMemberId=engineer.id;
const count=s.records.filter(r=>r.kind==='ie_quote_supplier_evidence').length;failCommit=true;await rejected(()=>post(form(png,'synthetic-conflict.png')),409);failCommit=false;assert.equal(s.records.filter(r=>r.kind==='ie_quote_supplier_evidence').length,count);
assert.equal(s.records.filter(r=>r.kind==='ie_quote_supplier_evidence').length,5);assert.equal(s.records.filter(r=>r.kind==='audit').length,5);
// Camera metadata after EOI stays in the immutable original, including its hash.
for(const length of [1,24,256]){
 const original=Buffer.concat([jpeg,Buffer.alloc(length,0x42)]);
 const archived=(await(await post(form(original,`synthetic-camera-${length}.jpg`,'image/jpeg'))).json()).evidence;
 assert.equal(archived.size,original.length);
 const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',original)).toString('hex');assert.equal(archived.sha256,sha256);
 assert.deepEqual(Buffer.from(await(await get('ie-supplier-evidence',archived.id)).arrayBuffer()),original);
}
await rejected(()=>post(form(Buffer.concat([jpeg,Buffer.alloc(257,0x42)]),'synthetic-too-much-trailer.jpg','image/jpeg')),400);
await rejected(()=>post(form(Buffer.concat([png,Buffer.alloc(24,0x42)]),'synthetic-fake.jpg','image/jpeg')),400);
await rejected(()=>post(form(Buffer.concat([jpeg,Buffer.alloc(24,0x42)]),'synthetic-fake.png','image/png')),400);
await rejected(()=>post(form(Buffer.concat([jpeg,Buffer.alloc(24,0x42)]),'synthetic-fake.jpg','text/html')),400);
assert.throws(()=>api.validateIeSupplierEvidence(Buffer.from([255,216,255,217,1,2,3]),'synthetic-broken.jpg','image/jpeg'));
console.log('PASS IE supplier evidence: scoped immutable originals, exact bytes/hash, metadata and evidence lookup, duplicate handling, true file types, active PDF rejection, bounded upload, corruption/missing file and role revocation.');
console.log('PASS supplier JPEG 1/24/256-byte trailers retain exact original bytes/hash on upload and download; 257-byte trailer, fake format/type and broken JPEG rejected.');
