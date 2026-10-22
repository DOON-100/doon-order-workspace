// Synthetic fixtures only. This module never opens lan-data or calls a running server.
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {testSalesOrderSourceExports} from './sales-order-source-export-cases.mjs';

export async function testSalesOrderSources({api,identity,admin,rawRecords,rawInsert,pass}){
 const at='2026-01-02T03:04:05.000Z',prefix='synthetic_source_cases_',id=name=>prefix+name;
 const user=name=>({userId:id(name),email:name+'@source-tests.invalid',displayName:'Synthetic '+name,fullName:'Synthetic '+name});
 const users=Object.fromEntries(['sales','assigned','owner','outside','supplier','inactive','pmc','production','finance','external','other-admin'].map(name=>[name,user(name)]));
 const member=(name,role,extra={})=>({id:id('member_'+name),kind:'member',userId:users[name].userId,email:users[name].email,name:'Synthetic '+name,role,active:true,customers:[],createdAt:at,...extra});
 const members=[member('sales','sales'),member('assigned','viewer',{customers:['SOURCE-SYN-A']}),member('owner','viewer'),member('outside','viewer'),member('supplier','supplier'),member('inactive','admin',{active:false}),member('pmc','pmc',{orderScope:'all'}),member('production','production',{orderScope:'all'}),member('finance','finance',{orderScope:'all'}),member('external','sales',{personnelType:'external'}),member('other-admin','admin')];
 const accounts=['A','B','U'].map(name=>({id:id('customer_'+name),kind:'customer_account',customer:'Synthetic source customer '+name,customerCode:'SOURCE-SYN-'+name,active:true,version:1,salesName:'',serviceName:'',pmcName:'',salesMemberIds:name==='A'?[id('member_sales'),id('member_external')]:[],serviceMemberIds:[],notes:'',createdAt:at,updatedAt:at,updatedBy:'Synthetic'}));
 const legacy={id:id('legacy_order'),kind:'order',version:7,createdAt:at,updatedAt:at,updatedBy:'Synthetic',source:'Synthetic original order',orderNo:'SOURCE-LEGACY-ORDER',customer:accounts[0].customer,customerPO:'SOURCE-LEGACY-PO',drawing:'SOURCE-LEGACY-DRAW',color:'SOURCE-COLOR-OLD',lens:'Synthetic lens',batch:'',quantity:23,requestedDate:'2026-12-01',ownerEmail:users.owner.email,stage:'生产中',plannedDate:'2026-11-20',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'Keep original / untouched',sourceStatus:'正式订单',workflowStatus:'生产中',extra:{'Synthetic original field':'  Keep spaces /  '},lifecycle:'active'};
 for(const record of [...members,...accounts,legacy,{id:id('legacy_report'),kind:'report',version:2,lineId:legacy.id,quantity:3,approval:'已审批',orderNo:legacy.orderNo,drawing:legacy.drawing,color:legacy.color,lens:legacy.lens,workOrder:'SOURCE-LEGACY-WO',reportedAt:at,source:'Synthetic',updatedAt:at,updatedBy:'Synthetic'},{id:id('team_A'),kind:'customer_project_team',name:'Synthetic source team A',active:true,customerIds:[accounts[0].id],salesMemberIds:[id('member_sales')],serviceMemberIds:[],leaderIds:[]},{id:id('team_B'),kind:'customer_project_team',name:'Synthetic source team B',active:true,customerIds:[accounts[1].id],salesMemberIds:[],serviceMemberIds:[],leaderIds:[]},{id:id('kingdee_template'),kind:'collaboration_template',templateType:'kingdee',headers:['客户编码','订单号'],sheet:'Synthetic source template'}])rawInsert(record);
 const request=async(action,{body,rawBody,user=admin,team='',method=body===undefined&&rawBody===undefined?'GET':'POST'}={})=>identity.run(user,()=>api[method](new Request('https://orders.test/api/workspace/'+action,{method,headers:{...(method==='POST'?{'Content-Type':'application/json'}:{}),...(team?{'X-Workspace-Team':team}:{})},...(method==='POST'?{body:rawBody??JSON.stringify(body)}:{})}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const json=async(action,options={})=>{const response=await request(action,options),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
 const get=(user=admin,team='')=>json('sales-order-sources-data',{user,team});
 const post=(body,user=admin)=>json('sales-order-sources-import',{body,user});
 const snapshot=()=>JSON.stringify(rawRecords());
 const rejected=async(body,status=400,user=admin,rawBody)=>{const before=snapshot(),response=await request('sales-order-sources-import',{body,user,rawBody});assert.equal(response.status,status,await response.text());assert.equal(snapshot(),before,'A rejected source import must not partially write records.');};
 const exportRows=async action=>{const response=await request(action);assert.equal(response.status,200);const book=XLSX.read(await response.arrayBuffer());return book.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(book.Sheets[name],{defval:null})}));};
 const color=(column,value,status='adopted')=>({sourceColumn:column,sourceLabel:'  Synthetic source label  ',sourceCell:column+'15',value,status,standardZh:status==='adopted'?'合成标准色':'',standardEn:status==='adopted'?'Synthetic Standard Color':'',qualifier:column==='J'?'inner':'outer',candidates:status==='adopted'?[]:['Synthetic candidate one','Synthetic candidate two']});
 const line=(number=15)=>({id:'synthetic-line-'+number,sourceRow:number,drawing:'SYN-DRAW-A',model:'SYN-MODEL-A',color:'SYN-COLOR-A',sku:'SYN-SKU-'+number,quantity:number===15?12:0,unit:'PCS',sampleQuantity:number===15?3:null,unitPrice:'  3.50  ',deliveryText:'Synthetic season / not a confirmed date',colorFields:[color('J',' / '),color('K',''),color('L',null,'pending'),color('M','pin-X / screw-Y','composite')],rawFields:[{column:'B',label:'Synthetic drawing',cell:'B'+number,value:'SYN-DRAW-A',sourceAnchor:'B15',sourceRange:'B15:B16',formula:null,cachedValue:null,hidden:false},{column:'N',label:'Synthetic amount',cell:'N'+number,value:'=12*3.5',formula:'=12*3.5',cachedValue:'42',hidden:true}],notes:['Preserve synthetic original text / do not execute']});
 const source=(customer='A')=>({schemaVersion:1,orderNo:'SOURCE-TEST-'+customer,customer:'SOURCE-SYN-'+customer,productType:'Synthetic frame type',customerPO:'SYN-PO-(keep-whole)',documentType:'Sales Order Confirmation',source:{filename:'synthetic-order.xlsx',sha256:(customer==='A'?'a':customer==='B'?'b':'c').repeat(64),sheet:'Synthetic source',detailRange:'A15:N16'},dictionaryVersion:'synthetic-dictionary-v1',dictionarySha256:'d'.repeat(64),warnings:['Synthetic source evidence; not a production release'],lines:[line(),line(16)]});
 const payload=(value=source())=>({token:crypto.randomUUID(),source:value});
 const initialRecords=rawRecords(),initialById=new Map(initialRecords.map(row=>[row.id,JSON.stringify(row)]));
 const beforeOrders=(await json('data')).orders,beforePmc=await json('pmc-data'),beforeLedger=await exportRows('ledger-export?mode=active'),beforeKingdee=await exportRows('kingdee-export');
 const initialSources=rawRecords().filter(row=>row.kind==='sales_order_source').length;
 const first=payload(),saved=await post(first),savedRecord=rawRecords().find(row=>row.id===saved.id);
 assert.equal(saved.status,'待核对');assert.equal(saved.version,1);assert.equal(saved.lineCount,2);assert.equal(savedRecord.kind,'sales_order_source');assert.deepEqual(savedRecord.source,first.source);
 assert.equal(rawRecords().filter(row=>row.kind==='sales_order_source').length,initialSources+1);
 assert.equal(savedRecord.source.lines[1].quantity,0);assert.equal(savedRecord.source.lines[0].sampleQuantity,3);assert.equal(savedRecord.source.lines[1].sampleQuantity,null);
 assert.equal(savedRecord.source.lines[0].colorFields[0].value,' / ');assert.equal(savedRecord.source.lines[0].colorFields[1].value,'');assert.equal(savedRecord.source.lines[0].colorFields[2].value,null);assert.equal(savedRecord.source.lines[0].colorFields[3].value,'pin-X / screw-Y');assert.equal(savedRecord.source.lines[0].unitPrice,'  3.50  ');
 assert.equal(savedRecord.source.lines[0].colorFields[0].standardZh,savedRecord.source.lines[0].colorFields[1].standardZh);assert.notEqual(savedRecord.source.lines[0].colorFields[0].sourceColumn,savedRecord.source.lines[0].colorFields[1].sourceColumn);
 const afterFirst=snapshot();const replay=await post(first);assert.equal(replay.id,saved.id);assert.equal(replay.idempotent,true);assert.equal(snapshot(),afterFirst);
 const beforeFreshToken=rawRecords(),freshToken=payload(first.source),freshReplay=await post(freshToken);
 assert.equal(freshReplay.id,saved.id);assert.equal(freshReplay.idempotent,true);assert.equal(rawRecords().filter(row=>row.kind==='sales_order_source').length,initialSources+1);
 const newRequestRows=rawRecords().filter(row=>!beforeFreshToken.some(old=>old.id===row.id));assert.equal(newRequestRows.length,1);assert.equal(newRequestRows[0].kind,'sales_order_source_request');
 const afterNewToken=snapshot();assert.equal((await post(freshToken)).id,saved.id);assert.equal(snapshot(),afterNewToken);
 pass('销售原单资料独立保存原文、0与空白，原请求和新请求标识重复导入均不产生重复明细');

 const changed=structuredClone(first);changed.source.lines[0].quantity++;
 await rejected(changed,409);await rejected(first,409,users['other-admin']);
 const changedSameSource=structuredClone(first.source);changedSameSource.lines[0].notes.push('Different synthetic content');await rejected(payload(changedSameSource),409);
 const changedHash=structuredClone(first.source);changedHash.source.sha256='e'.repeat(64);await rejected(payload(changedHash),409);
 const changedSheet=structuredClone(first.source);changedSheet.source.sheet='Another synthetic source';await rejected(payload(changedSheet),409);
 pass('请求标识绑定人员与完整内容，同一客户订单的变更来源或内容不会覆盖既有资料');

 for(const person of ['sales','assigned','owner','outside','supplier','inactive','pmc','production','finance','external'])await rejected(payload(source('B')),403,users[person]);
 for(const person of ['supplier','inactive','external']){const response=await request('sales-order-sources-data',{user:users[person]});assert.equal(response.status,403);}
 assert.equal((await request('sales-order-sources-data',{user:null})).status,401);
 assert.equal((await request('sales-order-sources-import',{body:payload(source('B')),user:null})).status,401);
 const savedB=await post(payload(source('B'))),savedU=await post(payload(source('U'))),ours=new Set([saved.id,savedB.id,savedU.id]);
 const sourceIds=data=>data.items.filter(row=>ours.has(row.id)).map(row=>row.id).sort();
 assert.deepEqual(sourceIds(await get()),[...ours].sort());assert.equal((await get()).canImport,true);
 for(const person of ['pmc','production','finance','assigned','owner','outside']){const result=await get(users[person]);assert.deepEqual(sourceIds(result),[]);assert.equal(result.canImport,false);}
 assert.deepEqual(sourceIds(await get(users.sales)),[saved.id]);assert.equal((await get(users.sales)).canImport,false);
 const attemptedCrossRead=await json('sales-order-sources-data?id='+savedB.id,{user:users.sales});assert(!sourceIds(attemptedCrossRead).includes(savedB.id));
 pass('导入仅限有效管理员，商业原单仅客户明确责任人可读，PMC总表权限、旧客户列表及订单归属不扩权，外部和停用成员被拒绝');

 const scopedResponse=await request('sales-order-sources-data',{team:id('team_A')});assert.match(scopedResponse.headers.get('Vary')||'',/X-Workspace-Team/i);assert.deepEqual(sourceIds(await scopedResponse.json()),[saved.id]);
 assert.deepEqual(sourceIds(await get(admin,id('team_B'))),[savedB.id]);assert.deepEqual(sourceIds(await get(admin,'__ungrouped')),[savedU.id]);assert.deepEqual(sourceIds(await get(users.sales,id('team_A'))),[saved.id]);
 assert.equal((await request('sales-order-sources-data',{user:users.sales,team:id('team_B')})).status,403);
 assert.equal((await request('sales-order-sources-data',{team:id('missing_team')})).status,403);
 const beforeWrongTeam=snapshot(),wrongTeam=await request('sales-order-sources-import',{body:payload(source('B')),team:id('team_A')});assert.equal(wrongTeam.status,403);assert.equal(snapshot(),beforeWrongTeam);
 pass('业务组筛选只缩小已授权客户范围，跨组读取及不匹配当前组的导入不会扩大权限');

 const mutations=[
  value=>{value.lines=[];},value=>{value.lines=[...value.lines,{...value.lines[0]}];},value=>{value.lines[1].sourceRow=value.lines[0].sourceRow;},
  value=>{value.lines[0].id=' bad-id ';},value=>{value.lines[0].sourceRow=0;},value=>{value.lines[0].sourceRow=1048577;},
  value=>{value.lines[0].quantity=-1;},value=>{value.lines[0].quantity=1000000001;},value=>{value.lines[0].quantity='12';},value=>{value.lines[0].quantity=NaN;},value=>{value.lines[0].quantity=Infinity;},
  value=>{value.lines[0].sampleQuantity=-1;},value=>{value.lines[0].sampleQuantity='3';},
  value=>{value.lines[0].unit='';},value=>{value.lines[0].unit='   ';},value=>{value.lines[0].unit=7;},value=>{value.lines[0].unit='X'.repeat(81);},
  value=>{value.lines[0].colorFields.push({...value.lines[0].colorFields[0]});},value=>{value.lines[0].rawFields.push({...value.lines[0].rawFields[0]});},
  value=>{value.lines[0].colorFields[0].sourceColumn='j';},value=>{value.lines[0].colorFields[0].status='approved';},value=>{value.lines[0].colorFields[0].unexpected=true;},value=>{value.lines[0].rawFields[0].unexpected=true;},value=>{value.lines[0].unexpected=true;},
  value=>{value.source.sha256='not-a-hash';},value=>{value.source.unexpected=true;},value=>{value.documentType='Proforma Invoice';},value=>{value.unexpected=true;},value=>{delete value.dictionarySha256;},
  value=>{value.lines=Array.from({length:1001},(_,index)=>({...line(index+1),id:'too-many-'+index}));}
 ];
 for(const mutate of mutations){const value=source('B');value.orderNo='SOURCE-INVALID-ONLY';mutate(value);await rejected(payload(value));}
 await rejected({...payload(),unexpected:true});await rejected({...payload(),token:'not-a-uuid'});await rejected(undefined,400,admin,'{malformed');
 pass('严格嵌套校验拒绝重复行列、非法数量单位、额外字段、订金单类型及超限明细，失败无部分写入');

 for(const rawBody of [' '.repeat(8*1024*1024+1),'\u5408'.repeat(Math.ceil((8*1024*1024+1)/3))]){
  const before=snapshot(),response=await request('sales-order-sources-import',{rawBody});assert.equal(response.status,400);assert.match((await response.json()).error,/8 MiB/);assert.equal(snapshot(),before);
 }
 pass('请求上限按UTF-8字节执行，ASCII和多字节超限均在解析前拒绝');

 await testSalesOrderSourceExports({request,source,payload,post,users,admin,id,snapshot,saved,savedB,savedU,pass});
 const finalRecords=rawRecords(),finalById=new Map(finalRecords.map(row=>[row.id,JSON.stringify(row)]));
 for(const [recordId,bytes] of initialById)assert.equal(finalById.get(recordId),bytes,'Existing record changed: '+recordId);
 const appended=finalRecords.filter(row=>!initialById.has(row.id));assert(appended.every(row=>['sales_order_source','sales_order_source_request','audit'].includes(row.kind)));
 assert.deepEqual((await json('data')).orders,beforeOrders);assert.deepEqual(await json('pmc-data'),beforePmc);assert.deepEqual(await exportRows('ledger-export?mode=active'),beforeLedger);assert.deepEqual(await exportRows('kingdee-export'),beforeKingdee);
 const generic=await json('data',{user:users.outside});assert(!JSON.stringify(generic).includes('SOURCE-TEST-A'));assert(!JSON.stringify(generic).includes('pin-X / screw-Y'));
 pass('原Order和所有旧记录逐字不变，PMC台账及金蝶导出输入不增加，通用审计读取不泄露原单资料');
}

async function standalone(){
 const {build}=await import('esbuild'),{DatabaseSync}=await import('node:sqlite'),{AsyncLocalStorage}=await import('node:async_hooks'),fs=await import('node:fs/promises');
 await fs.mkdir('test-output',{recursive:true});const output=await fs.mkdtemp(path.resolve('test-output','sales-order-source-cases-'));
 const db=new DatabaseSync(':memory:');
 for(const name of (await fs.readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',name),'utf8'));
 class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
 const files=new Map(),identity=new AsyncLocalStorage();globalThis.__sourceCaseIdentity=identity;
 globalThis.__sourceCaseEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key),json:async()=>JSON.parse(files.get(key))}:null}};
 const outfile=path.join(output,'api.mjs');
 await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'source-cases-only-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'source-case'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'identity',namespace:'source-case'}));b.onLoad({filter:/.*/,namespace:'source-case'},args=>({contents:args.path==='identity'?'export async function getChatGPTUser(){return globalThis.__sourceCaseIdentity.getStore()||null}':'export const env=globalThis.__sourceCaseEnv;'}));}}]});
 const api=await import(pathToFileURL(outfile).href),admin={userId:'source_case_admin',email:'source_case_admin@test.invalid',displayName:'Synthetic source admin',fullName:'Synthetic source admin'};
 try{
  const enrolled=await identity.run(admin,()=>api.POST(new Request('https://orders.test/api/workspace/enroll',{method:'POST',body:'{}'}),{params:Promise.resolve({action:'enroll'})}));assert.equal(enrolled.status,200);
  let checks=0;
  await testSalesOrderSources({api,identity,admin,rawRecords:()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(row=>JSON.parse(row.data)),rawInsert:record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record)),pass:message=>{checks++;console.log('PASS '+message);}});
  console.log(JSON.stringify({ok:true,checks,synthetic:true,productionTouched:false}));
 }finally{db.close();delete globalThis.__sourceCaseIdentity;delete globalThis.__sourceCaseEnv;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await standalone();
