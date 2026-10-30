import assert from 'node:assert/strict';

// Uses only the in-memory SQLite API harness and synthetic identities/files.
export async function testQuoteRequests({api,identity,admin,rawRecords,rawInsert,rawUpdate,pass}){
 const at='2026-10-30T00:00:00.000Z',prefix='synthetic_rfq_',id=name=>prefix+name;
 const make=(name,role='sales',extra={})=>({id:id(name),kind:'member',userId:id(name),name:'Synthetic '+name,email:name+'@rfq.test.invalid',role,customers:[],active:true,createdAt:at,...extra});
 const sales=make('sales'),other=make('other'),engineer=make('engineer','production'),reviewer=make('reviewer','production'),manager=make('manager','production'),sameName=make('same_name','production',{name:engineer.name}),viewer=make('viewer','viewer'),programmer=make('programmer','programmer'),finance=make('finance','finance'),readonly=make('readonly','admin');
 const account={id:id('account'),kind:'customer_account',customer:'Synthetic RFQ customer',customerCode:'RFQ-TEST',active:true,version:1,quoteMemberIds:[sales.id,viewer.id,programmer.id,finance.id],salesMemberIds:[sales.id],serviceMemberIds:[],salesName:sales.name,serviceName:'',pmcName:'',notes:'',createdAt:at,updatedAt:at,updatedBy:'Synthetic'};
 const accountB={...account,id:id('account_b'),customerCode:'RFQ-B',quoteMemberIds:[other.id],salesMemberIds:[other.id],salesName:other.name};
 const team={id:id('team'),kind:'customer_project_team',name:'Synthetic RFQ team',active:true,customerIds:[account.id],leaderIds:[],salesMemberIds:[sales.id],serviceMemberIds:[]};
 for(const r of [sales,other,engineer,reviewer,manager,sameName,viewer,programmer,finance,readonly,account,accountB,team,{id:id('readonly_grant'),kind:'ar_access_grant',active:true,memberId:readonly.id,readOnly:true}])rawInsert(r);
 const oldPolicy=rawRecords().find(r=>r.kind==='ie_quote_policy'),oldAccess=rawRecords().find(r=>r.kind==='customer_quote_access');assert(oldPolicy&&oldAccess,'IE fixtures must run before quotation request cases');
 const policy={...oldPolicy,engineerMemberId:engineer.id,reviewerMemberId:reviewer.id,finalApproverMemberId:manager.id},access={...oldAccess,memberIds:[...new Set([...oldAccess.memberIds,sales.id,other.id,viewer.id,programmer.id,finance.id])]};
 rawUpdate(policy);rawUpdate(access);
 const asUser=m=>m?.kind==='member'?{userId:m.userId,email:m.email,displayName:m.name,fullName:m.name}:m;
 const request=(action,body,who=sales,teamId='')=>identity.run(asUser(who),()=>api[body===undefined?'GET':'POST'](new Request('https://orders.test/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(teamId?{'X-Workspace-Team':teamId}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const ok=async(...args)=>{const res=await request(...args),body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return body;};
 const deny=async(action,body,status,who=sales,scope='')=>{const before=structuredClone(rawRecords()),res=await request(action,body,who,scope);assert.equal(res.status,status,`${action}: ${await res.text()}`);assert.deepEqual(rawRecords(),before,'Denied requests must not change any record');};
 const token=()=>crypto.randomUUID(),change=r=>({id:r.id,version:r.version,token:token()}),line={id:id('line'),model:'SYNTHETIC-A',customerModel:'CLIENT-A',color:'C1',quantity:240,material:'Synthetic acetate',requirements:'Synthetic packing requirement',drawingNo:'SYNTHETIC-DRAWING',drawingRevision:'R1'};
 const draft={customerAccountId:account.id,title:'Synthetic quotation request',dueDate:'2026-11-10',requirementText:'Synthetic customer requirement\nsecond line',lines:[line],token:token()};
 const preserved=structuredClone(rawRecords()),preservedIds=new Set(preserved.map(r=>r.id));
 try{
  await deny('quote-request-data',undefined,401,null);await deny('quote-request-save',draft,403,other);
  for(const who of [viewer,programmer,finance,readonly])await deny('quote-request-save',{...draft,token:token()},403,who);
  await deny('quote-request-save',{...draft,token:token(),dueDate:'2026-02-30'},400);await deny('quote-request-save',{...draft,token:token(),lines:[line,line]},400);
  let r=(await ok('quote-request-save',draft)).request;assert.equal(r.status,'draft');assert(r.canEdit);assert.equal(r.assigneeId,'');
  rawUpdate({...engineer,role:'viewer'});assert.equal((await ok('quote-request-detail?id='+r.id)).request.canSubmit,false);await deny('quote-request-submit',change(r),409);rawUpdate(engineer);
  const afterSave=structuredClone(rawRecords());assert.equal((await ok('quote-request-save',draft)).request.id,r.id);assert.deepEqual(rawRecords(),afterSave);
  await deny('quote-request-save',{...draft,title:'Mismatched retry'},409);await deny('quote-request-detail?id='+r.id,undefined,403,other);await deny('quote-request-detail?id='+r.id,undefined,403,engineer);
  assert((await ok('quote-request-data',undefined,sales,team.id)).requests.some(x=>x.id===r.id));assert(!(await ok('quote-request-data',undefined,sales,'__ungrouped')).requests.some(x=>x.id===r.id));
  const upload=(record,contents='Synthetic requirement attachment',name='requirement.txt',mime='text/plain',key=token())=>{const form=new FormData();form.set('id',record.id);form.set('version',String(record.version));form.set('token',key);form.set('file',new File([contents],name,{type:mime}));return form;};
  await deny('quote-request-upload',upload(r,'<html>bad</html>','fake.pdf','application/pdf'),400);await deny('quote-request-upload',upload(r,'<svg/>','bad.svg','image/svg+xml'),400);
  await deny('quote-request-upload',upload(r,'binary\0','bad.txt'),400);await deny('quote-request-upload',upload(r,'fake','bad.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),400);
  const uploadForm=upload(r);r=(await ok('quote-request-upload',uploadForm)).request;assert.equal(r.attachments.length,1);const afterUpload=structuredClone(rawRecords());assert.equal((await ok('quote-request-upload',uploadForm)).request.version,r.version);assert.deepEqual(rawRecords(),afterUpload);
  const attachment=r.attachments[0],attachmentRow=rawRecords().find(a=>a.id===attachment.id);assert(!JSON.stringify(r).includes('fileKey'));const downloaded=await request('quote-request-file?id='+r.id+'&attachmentId='+attachment.id);assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('Content-Disposition'),/^attachment/);assert.equal(await downloaded.text(),'Synthetic requirement attachment');
  await deny('quote-request-file?id='+r.id+'&attachmentId='+attachment.id,undefined,403,other);
  await globalThis.__testEnv.BUCKET.put(attachmentRow.fileKey,new TextEncoder().encode('tampered'));assert.equal((await request('quote-request-file?id='+r.id+'&attachmentId='+attachment.id)).status,409);await globalThis.__testEnv.BUCKET.put(attachmentRow.fileKey,new TextEncoder().encode('Synthetic requirement attachment'));
  const stale=r;r=(await ok('quote-request-upload',upload(r,'Second synthetic attachment','second.txt'))).request;
  await deny('quote-request-submit',change(stale),409);r=(await ok('quote-request-remove-attachment',{...change(r),attachmentId:attachment.id})).request;assert.equal(r.attachments.length,1);assert(rawRecords().some(a=>a.id===attachment.id));assert(await globalThis.__testEnv.BUCKET.get(attachmentRow.fileKey));
  pass('报价需求采用独立记录、真实客户授权和幂等保存；附件校验内容、大小和权限，移除只解除引用并保留原件');

  const submitted=change(r);r=(await ok('quote-request-submit',submitted)).request;assert.equal(r.assigneeId,engineer.id);assert.equal(r.status,'submitted');assert(!r.canEdit);
  assert.equal((await ok('quote-request-submit',submitted)).request.id,r.id);await deny('quote-request-save',{...draft,id:r.id,version:r.version,token:token()},403);await deny('quote-request-upload',upload(r),403);
  const mine=(await ok('quote-request-data?mine=1',undefined,engineer,'invalid-other-team')).requests;assert(mine.some(x=>x.id===r.id&&x.canStart));assert.equal((await ok('quote-request-data?mine=1',undefined,sameName)).requests.length,0);
  await deny('quote-request-start',change(r),403,sameName);await deny('quote-request-start',change(r),403,sales);
  assert.equal((await request('quote-request-file?id='+r.id+'&attachmentId='+r.attachments[0].id,undefined,engineer)).status,200);
  const start=change(r),started=await ok('quote-request-start',start,engineer);r=started.request;assert.equal(r.status,'quoting');assert(r.ieQuoteId);assert.equal((await ok('quote-request-start',start,engineer)).ieQuoteId,r.ieQuoteId);
  assert.equal((await ok('quote-request-start',change(r),engineer)).ieQuoteId,r.ieQuoteId);assert.equal(rawRecords().filter(x=>x.kind==='ie_quote'&&x.id===r.ieQuoteId).length,1);
  let q=(await ok('ie-quote?id='+r.ieQuoteId,undefined,engineer)).quote;assert.equal(q.lines[0].model,line.model);assert.equal(q.lines[0].quantityMin,240);assert(q.lines[0].materials.every(x=>x.basePrice===null&&x.nameReference));assert(q.lines[0].materials.length<=200);assert.equal(q.exchangeRateCnyPerUsd,null);assert(q.notes.includes(draft.requirementText));
  assert.equal((await ok('quote-request-detail?quoteId='+q.id,undefined,engineer)).request.id,r.id);await deny('quote-request-detail?quoteId='+q.id,undefined,403,sameName);
  const history=(await ok('quote-request-detail?id='+r.id,undefined,engineer)).history;assert(history.some(v=>v.snapshot.status==='draft'));assert(!JSON.stringify(history).includes('fileKey'));assert(!JSON.stringify(history).includes('fingerprint'));
  pass('提交需求按配置的工程师 ID 投递跨组待办，同名账号无权接收；开始报价原子创建一笔草稿，重复点击不重复建单');

  // Exercise the existing costing/review workflow against this newly created draft.
  const seed=rawRecords().find(x=>x.kind==='ie_quote'&&x.quoteNo==='IE-SYNTHETIC-01');assert(seed);
  const fields=Object.fromEntries(['quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'].map(k=>[k,structuredClone(seed[k])]));
  fields.quoteNo='IE-SYNTHETIC-RFQ-COMPLETE';q=(await ok('ie-quote-save',{...fields,id:q.id,version:q.version,customerAccountId:account.id,materialPricingMode:'checklist'},engineer)).quote;
  q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer)).quote;await deny('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'Self review'},403,engineer);
  q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'Synthetic independent review'},reviewer)).quote;assert.equal(q.status,'released');
  assert.equal((await ok('quote-request-detail?id='+r.id)).request.status,'quoted');assert(!(await ok('quote-request-data?mine=1',undefined,engineer)).requests.some(x=>x.id===r.id));
  const mutable=rawRecords().find(x=>x.id===account.id);rawUpdate({...mutable,quoteMemberIds:[]});await deny('quote-request-detail?id='+r.id,undefined,403,sales);rawUpdate(mutable);
  const auditFeed=await ok('data',undefined,engineer);assert(!(auditFeed.audits||[]).some(a=>a.targetId===r.id));
  assert.deepEqual(rawRecords().filter(x=>preservedIds.has(x.id)),preserved,'All earlier records and attachments remain unchanged');
  pass('需求创建的工程报价沿用独立复核，发布后标记已报价并移出待办；收回客户权限立即阻止读取，原业务记录保持不变');
 }finally{rawUpdate(oldPolicy);rawUpdate(oldAccess);}
}

// A focused run keeps this workflow verifiable without depending on unrelated
// integration suites. It still uses the actual HTTP handlers and SQLite CAS.
if(process.argv[1]?.replaceAll('\\','/').endsWith('/quote-request-cases.mjs')){
 const {build}=await import('esbuild'),{DatabaseSync}=await import('node:sqlite'),{AsyncLocalStorage}=await import('node:async_hooks'),fs=await import('node:fs/promises');
 await fs.mkdir('test-output',{recursive:true});const db=new DatabaseSync(':memory:');for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
 class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
 const files=new Map(),identity=new AsyncLocalStorage();globalThis.__testIdentity=identity;globalThis.__testEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key),json:async()=>JSON.parse(files.get(key))}:null}};
 await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/quote-request-api-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'rfq-test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'rfq-test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'rfq-test'}));b.onLoad({filter:/.*/,namespace:'rfq-test'},a=>({contents:a.path==='auth'?'export async function getChatGPTUser(){return globalThis.__testIdentity.getStore()||null}':'export const env=globalThis.__testEnv;'}));}}]});
 const api=await import('../test-output/quote-request-api-test.mjs'),admin={userId:'rfq_test_admin',email:'admin@rfq.test.invalid',displayName:'Synthetic admin',fullName:'Synthetic admin'};
 await identity.run(admin,async()=>{const r=await api.POST(new Request('https://test.invalid/api/workspace/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),{params:Promise.resolve({action:'enroll'})});assert.equal(r.status,200,await r.text());});
 const rawRecords=()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data)),rawInsert=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r)),rawUpdate=r=>db.prepare('UPDATE records SET data=? WHERE id=? AND kind=?').run(JSON.stringify(r),r.id,r.kind);
 rawInsert({id:'rfq_fixture_access',kind:'customer_quote_access',memberIds:[],aliasesByMember:{}});rawInsert({id:'rfq_fixture_ie_policy',kind:'ie_quote_policy',version:1,engineerMemberId:'fixture-engineer',reviewerMemberId:'fixture-reviewer',finalApproverMemberId:'fixture-manager'});
 rawInsert({id:'rfq_fixture_source',kind:'ie_quote',quoteNo:'IE-SYNTHETIC-01',quoteDate:'2026-10-30',validUntil:'2026-11-30',batchId:'SYNTHETIC',exchangeRateCnyPerUsd:7,exchangeRateDate:'2026-10-30',exchangeRateSource:'Synthetic FX evidence',notes:'Synthetic only',lines:[{id:'synthetic_style',model:'SYN-A',customerModel:'CLIENT-A',color:'C1',drawingNo:'SYN-1',drawingRevision:'R1',quantityMin:100,quantityMax:200,structureNotes:'Synthetic structure',scopeNotes:'Synthetic scope',materials:[],processes:[{id:'synthetic_process',name:'Synthetic process',parentId:'',sequence:1,standardSeconds:null,basePrice:2,difficulty:1,usage:1,notApplicable:false,notes:'',priceSource:'Synthetic price source'}],outsourcing:['plating','general'].map(category=>({id:'synthetic_'+category,category,name:'Not applicable',part:'',unitPrice:null,usage:1,notApplicable:true,notes:'Synthetic not applicable',priceSource:''}))}],tooling:[{id:'synthetic_tool',toolingId:'',name:'No tooling',lineIds:['synthetic_style'],amount:null,chargeMode:'not_applicable',evidence:'',notes:'Synthetic no new tooling'}]});
 await testQuoteRequests({api,identity,admin,rawRecords,rawInsert,rawUpdate,pass:message=>console.log('PASS '+message)});db.close();console.log('Quotation request API checks passed (synthetic data only).');
}
