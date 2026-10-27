// Synthetic in-memory API cases. Never opens lan-data or reaches a real ERP.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const at='2026-10-22T00:00:00.000Z',prefix='synthetic_kingdee_sales_',id=name=>prefix+name;
const templateHeaders=['*单据编号 # billno','*单据日期 # billdate','*客户.编码 # customerid.number','*业务员.名称 # empid.name','*币别.名称 # currencyid.name','*汇率 # exchangerate','*业务类型 # transtype','*商品.编码 # materialid.number','*单位.名称 # unit.name','*数量 # qty','*单价 # price','*增值税税率（%） # cess','是否赠品 # is_free','*预计交货日期 # deliverydate','*客户订单号 # custbillno'];
export function syntheticKingdeeSalesTemplate(){
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['SYNTHETIC KINGDEE SALES TEMPLATE'],['Synthetic instructions'],templateHeaders,['SYNTHETIC OLD ORDER DO NOT EXPORT','2026-10-01','OLD','OLD','OLD',1,'赊销','OLD','PCS',999,999,13,'否','2026-11-01','OLD']]);
 sheet['!merges']=[XLSX.utils.decode_range('A1:O1'),XLSX.utils.decode_range('A2:O2')];sheet.K4.z='0.00';
 XLSX.utils.book_append_sheet(book,sheet,'sheet1（名称勿改）');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic dictionary'],['USD'],['PCS']]),'基础资料（名称勿改）');
 book.Workbook={Sheets:[{Hidden:0},{Hidden:1}],Names:[{Name:'SyntheticCurrencies',Ref:"'基础资料（名称勿改）'!$A$2:$A$2"}]};
 const archive=unzipSync(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));
 archive['xl/worksheets/sheet1.xml']=strToU8(strFromU8(archive['xl/worksheets/sheet1.xml']).replace('</worksheet>','<dataValidations count="1"><dataValidation type="list" allowBlank="0" sqref="E4:E100"><formula1>SyntheticCurrencies</formula1></dataValidation></dataValidations></worksheet>'));
 return zipSync(archive);
}

export async function testKingdeeSales({api,identity,admin,env=globalThis.__testEnv,files,rawRecords,rawPut,pass}){
 let activeApi=api;
 const previousFetch=globalThis.fetch,environment=new Map();
 const config={DOON_KINGDEE_READONLY_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'synthetic-sales-client',DOON_KINGDEE_CLIENT_SECRET:'synthetic-sales-secret',DOON_KINGDEE_INSTANCE_ID:'synthetic-sales-instance',DOON_KINGDEE_ACCOUNT_ID:'synthetic-sales-account'};
 for(const key of [...Object.keys(config),'DOON_KINGDEE_SALES_WRITE_ENABLED']){environment.set(key,env[key]);delete env[key];}
 const calls=[];
 globalThis.fetch=async(url,options={})=>{calls.push({url:String(url),method:options.method||'GET'});throw Error('No external HTTP is allowed without an explicit synthetic fixture');};
 const request=(action,{body,user=admin,team='',headers={},method=body===undefined?'GET':'POST'}={})=>identity.run(user,()=>activeApi[method](new Request('https://orders.test/api/workspace/'+action,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(team?{'X-Workspace-Team':team}:{}),...headers},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const json=async(action,options={})=>{const response=await request(action,options),body=await response.json();assert.equal(response.status,200,action+': '+JSON.stringify(body));return body;};
 const mutate=(action,body,user=admin,team='')=>json(action,{body,user,team});
 const latest=draft=>rawRecords().find(row=>row.id===(typeof draft==='string'?draft:draft.id));
 const recordSnapshot=()=>new Map(rawRecords().map(row=>[row.id,JSON.stringify(row)]));
 const user=name=>({userId:id('user_'+name),email:name+'@kingdee-sales-tests.invalid',displayName:'Synthetic '+name,fullName:'Synthetic '+name});
 const users=Object.fromEntries(['sales','service','other-service','outside','production','finance','external','inactive'].map(name=>[name,user(name)]));
 const member=(name,role,extra={})=>({id:id('member_'+name),kind:'member',...users[name],name:users[name].displayName,role,active:true,customers:['KDSYNA'],orderScope:'all',createdAt:at,...extra});
 const account=name=>({id:id('customer_'+name),kind:'customer_account',customer:'Synthetic ERP customer '+name,customerCode:'KDSYN'+name,active:true,version:1,salesName:'',serviceName:'',pmcName:'',salesMemberIds:name==='A'?[id('member_sales'),id('member_external')]:[],serviceMemberIds:[id('member_'+(name==='A'?'service':'other-service'))],notes:'',createdAt:at,updatedAt:at,updatedBy:'Synthetic'});
 const accounts=['A','B'].map(account);
 const members=[member('sales','sales'),member('service','clerk'),member('other-service','clerk'),member('outside','viewer'),member('production','production'),member('finance','finance'),member('external','sales',{personnelType:'external'}),member('inactive','admin',{active:false})];
 for(const record of [...members,...accounts,...accounts.map((customer,index)=>({id:id('team_'+(index?'B':'A')),kind:'customer_project_team',name:'Synthetic ERP group '+(index?'B':'A'),active:true,customerIds:[customer.id],leaderIds:[],salesMemberIds:index?[]:[id('member_sales')],serviceMemberIds:[id('member_'+(index?'other-service':'service'))]}))])rawPut(record);
 const source=(name,overrides={})=>({schemaVersion:1,orderNo:'KD-SYN-ORDER-'+name,customer:'KDSYN'+(name==='B'?'B':'A'),productType:'Titanium frame / synthetic evidence',customerPO:'KD-SYN-PO-'+name,documentType:'Sales Order Confirmation',source:{filename:'synthetic-'+name+'.xlsx',sha256:digest(name),sheet:'Synthetic bilingual order',detailRange:'A15:N15'},warnings:[],lines:[{id:'synthetic-line-15',sourceRow:15,drawing:'DN1001',model:'MODEL1001',color:'C01',sku:'UNTRUSTED-SOURCE-SKU',quantity:12,unit:'PCS',sampleQuantity:3,unitPrice:'3.50',deliveryText:'Not a confirmed date',colorFields:[],rawFields:[],notes:['Original customer evidence / keep unchanged']}],...overrides});
 const importSource=async(name,overrides={})=>{const result=await mutate('sales-order-sources-import',{token:randomUUID(),source:source(name,overrides)});return latest(result.id);};
 try{
  const originalRecords=recordSnapshot(),sourceA=await importSource('A',{lines:[...source('A').lines,{...source('A').lines[0],id:'synthetic-line-16',sourceRow:16,color:'C02',quantity:5,unitPrice:'4.25'}]}),sourceB=await importSource('B');
  const initial=await json('kingdee-sales-data');assert.equal(initial.connection.writeEnabled,false);assert.equal(initial.connection.configured,false);
  assert.equal((await request('kingdee-sales-data',{user:null})).status,401);
  for(const person of ['external','inactive'])assert.equal((await request('kingdee-sales-data',{user:users[person]})).status,403);
  for(const person of ['outside','production','finance']){
   const response=await request('kingdee-sales-data',{user:users[person]});
   if(response.status===200){const body=await response.json();assert(!JSON.stringify(body).includes(sourceA.orderNo));assert(!JSON.stringify(body).includes(sourceB.orderNo));}
   else assert.equal(response.status,403);
   assert([403,404].includes((await request('kingdee-sales-prepare',{user:users[person],body:{sourceId:sourceA.id}})).status));
  }
  const scoped=await json('kingdee-sales-data',{user:users.service,team:id('team_A')});assert(scoped.sources.some(row=>row.id===sourceA.id));assert(!scoped.sources.some(row=>row.id===sourceB.id));
  assert.equal((await request('kingdee-sales-data',{user:users.service,team:id('team_B')})).status,403);
  assert([403,404].includes((await request('kingdee-sales-prepare',{user:users.service,body:{sourceId:sourceB.id}})).status));
  assert([403,404].includes((await request('kingdee-sales-prepare',{team:id('team_A'),body:{sourceId:sourceB.id}})).status));
  assert.equal((await request('kingdee-sales-prepare',{body:{sourceId:sourceA.id},headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal(calls.length,0);
  pass('金蝶销售草稿沿用客户明确责任和当前组范围，外部、停用、跨组及通用生产权限不能越权');

  let draft=(await mutate('kingdee-sales-prepare',{sourceId:sourceA.id},users.service)).item;
  assert.equal(draft.kind,'kingdee_sales_draft');assert.equal(draft.status,'draft');assert.equal(draft.validation.valid,false);
  assert.equal(draft.inputs.lines[0].categoryCode,'');assert.equal(draft.inputs.lines[0].finishCode,'');
  assert.equal(draft.inputs.lines[0].quantity,'12');assert.equal(draft.inputs.lines[0].unitPrice,'3.50');
  assert(!draft.validation.codes.some(row=>row.productCode===sourceA.source.lines[0].sku));
  assert([400,409].includes((await request('kingdee-sales-confirm',{body:{id:draft.id,version:draft.version,acknowledged:true},user:users.service})).status));
  assert.notEqual((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,200);
  assert.equal(calls.length,0);assert.equal(latest(sourceA).contentFingerprint,sourceA.contentFingerprint);
  pass('缺少模板和成品编码分段时草稿阻断确认，原单SKU和销售办数量不会被猜作成品编码或大货数量');

  const inputVersion=draft.version;
  draft=(await mutate('kingdee-sales-save',{id:draft.id,version:draft.version,inputs:{...draft.inputs,remark:'SYNTHETIC COMMERCIAL PRIVATE NOTE'}},users.service)).item;
  assert.equal(draft.status,'draft');assert(draft.version>inputVersion);
  assert.equal((await request('kingdee-sales-save',{body:{id:draft.id,version:inputVersion,inputs:draft.inputs},user:users.service})).status,409);
  assert.equal((await request('kingdee-sales-confirm',{body:{id:draft.id,version:draft.version,acknowledged:false},user:users.service})).status,400);
  for(const person of ['other-service','outside','production','finance'])assert([403,404].includes((await request('kingdee-sales-save',{body:{id:draft.id,version:draft.version,inputs:draft.inputs},user:users[person]})).status));
  const beforeInvalid=JSON.stringify(latest(draft));
  for(const lines of [draft.inputs.lines.slice(0,1),[draft.inputs.lines[0],draft.inputs.lines[0]],[...draft.inputs.lines,{...draft.inputs.lines[0],sourceLineId:'not-in-source'}]]){
   assert.equal((await request('kingdee-sales-save',{body:{id:draft.id,version:draft.version,inputs:{...draft.inputs,lines}},user:users.service})).status,400);assert.equal(JSON.stringify(latest(draft)),beforeInvalid);
  }
  assert.equal((await request('kingdee-sales-save',{body:{id:draft.id,version:draft.version,inputs:draft.inputs,status:'confirmed'},user:users.service})).status,400);assert.equal(JSON.stringify(latest(draft)),beforeInvalid);
  assert.equal(calls.length,0);
  pass('服务端拒绝草稿旧版本、未勾选确认和非本客户人员编辑，预览及本地编辑不调用金蝶写接口');

  const templateBytes=syntheticKingdeeSalesTemplate(),template={id:id('template'),kind:'collaboration_template',templateType:'kingdee',filename:'synthetic-official-sales-template.xlsx',fileKey:id('template_file'),sheet:'sheet1（名称勿改）',header:3,headers:templateHeaders,actorId:id('admin'),actor:'Synthetic ERP admin',createdAt:at};
  files.set(template.fileKey,templateBytes);rawPut(template);
  const validInputs=record=>({...record.inputs,billDate:'2026-10-22',employeeName:'Synthetic Employee',currencyName:'USD',exchangeRate:'1',businessType:'赊销',taxMode:'exclusive',lines:record.inputs.lines.map(line=>({...line,categoryCode:'TI',finishCode:'IPBLACK',taxRate:'13',deliveryDate:'2026-11-22'}))});
  draft=(await mutate('kingdee-sales-save',{id:draft.id,version:draft.version,inputs:validInputs(draft)},users.service)).item;
  assert.equal(draft.templateId,template.id);assert(draft.templateHash);assert(draft.sourceHash);assert(draft.ruleVersion);
  assert.equal(draft.validation.totalQuantity,'17.000000');assert.equal(draft.validation.netAmount,'63.25');assert.equal(draft.validation.taxAmount,'8.22');assert.equal(draft.validation.grossAmount,'71.47');
  assert.deepEqual(draft.validation.codes.map(row=>row.productCode),['TI-KDSYNA-DN1001-MODEL1001-IPBLACK-C01','TI-KDSYNA-DN1001-MODEL1001-IPBLACK-C02']);
  const authorizedInputs=structuredClone(draft.inputs),customerSwap=await request('kingdee-sales-save',{body:{id:draft.id,version:draft.version,inputs:{...draft.inputs,customerNumber:'KDSYNB'}},user:users.service});
  if(customerSwap.status===200){draft=(await customerSwap.json()).item;assert.equal(draft.validation.valid,false);assert(draft.validation.issues.some(issue=>issue.field==='customerNumber'));assert.notEqual((await request('kingdee-sales-confirm',{body:{id:draft.id,version:draft.version,acknowledged:true},user:users.service})).status,200);draft=(await mutate('kingdee-sales-save',{id:draft.id,version:draft.version,inputs:authorizedInputs},users.service)).item;}
  else assert([400,403].includes(customerSwap.status));
  const beforeRemote=calls.length;
  assert.notEqual((await request('kingdee-sales-confirm',{body:{id:draft.id,version:draft.version,acknowledged:true},user:users.service})).status,200);
  assert.equal(calls.length,beforeRemote);
  pass('六段成品编码和逐行税额使用明确输入计算，样板补齐后仍须执行全单校验再由客服确认');
  draft=(await mutate('kingdee-sales-validate',{id:draft.id,version:draft.version},users.service)).item;assert.equal(draft.status,'validated');assert.equal(draft.validation.remoteVerified,false);
  draft=(await mutate('kingdee-sales-confirm',{id:draft.id,version:draft.version,acknowledged:true},users.service)).item;
  const offlineExport=await request('kingdee-sales-export?id='+draft.id+'&version='+draft.version,{user:users.service});assert.equal(offlineExport.status,200);await offlineExport.arrayBuffer();assert.equal(calls.length,beforeRemote);
  pass('未配置金蝶连接时仍能完成本地全单校验、客服确认和标准模板导出，明确保留远端未核实状态');

  let remoteMode='success';const savedRemote=new Map();
  const salesPosts=()=>calls.filter(call=>call.path==='/jdy/v2/scm/sal_order'&&call.method==='POST');
  globalThis.fetch=async(url,options={})=>{
   const parsed=new URL(url),entry={path:parsed.pathname,method:options.method||'GET',query:Object.fromEntries(parsed.searchParams),body:options.body?JSON.parse(options.body):undefined};calls.push(entry);
   assert.equal(parsed.origin,'https://api.kingdee.com');assert.equal(options.redirect,'error');
   if(parsed.pathname.endsWith('/push_app_authorize'))return Response.json({code:200,data:[{clientId:config.DOON_KINGDEE_CLIENT_ID,outerInstanceId:config.DOON_KINGDEE_INSTANCE_ID,accountId:config.DOON_KINGDEE_ACCOUNT_ID,status:1,appKey:'synthetic-sales-app',appSecret:'synthetic-sales-app-secret',domain:'https://tf.jdy.com'}]});
   if(parsed.pathname.endsWith('/kingdee_auth_token'))return Response.json({errcode:0,data:{'app-token':'SYNTHETIC-SALES-TOKEN'}});
   assert.equal(options.headers['app-token'],'SYNTHETIC-SALES-TOKEN');
   if(parsed.pathname==='/jdy/v2/scm/sal_order'&&options.method==='GET'){
    assert.equal(parsed.searchParams.get('page_size'),'100');assert.equal(parsed.searchParams.get('page'),'1');
    for(const field of ['bill_status','bill_close_state','io_status','real_io_status'])assert.equal(parsed.searchParams.get(field),'');
    const billNo=parsed.searchParams.get('bill_no'),rows=remoteMode==='no-remote-match'?[]:[...new Map([...savedRemote.values()].map(detail=>[detail.id,detail])).values()].filter(detail=>detail.bill_no.toLowerCase()===billNo.toLowerCase()).map(detail=>({id:detail.id,bill_no:detail.bill_no}));
    return Response.json({errcode:0,data:{rows,page:1,total_page:remoteMode==='inconsistent-list'?1:rows.length?1:0,count:remoteMode==='inconsistent-list'?1:rows.length}});
   }
   if(parsed.pathname==='/jdy/v2/scm/sal_order'){
    assert.equal(options.method,'POST');assert.equal(env.DOON_KINGDEE_SALES_WRITE_ENABLED,'1');
    const stored=rawRecords().find(row=>row.kind==='kingdee_sales_draft'&&row.orderNo===entry.body.bill_no);assert(stored?.confirmation,'A remote write must have a persisted customer-service confirmation');
    assert(['uploading','unknown'].includes(stored.status),'A persistent submission claim must precede HTTP POST');
    const detail={...structuredClone(entry.body),id:'remote-'+entry.body.bill_no};detail.material_entity=detail.material_entity.map((line,index)=>({...line,id:detail.id+'-line-'+(index+1)}));savedRemote.set(detail.id,detail);savedRemote.set(detail.bill_no,detail);
    if(remoteMode==='timeout')throw new DOMException('Synthetic timeout after remote acceptance','TimeoutError');
    await new Promise(resolve=>setTimeout(resolve,10));
    return Response.json({errcode:0,data:{ids:[detail.id]}});
   }
   assert.equal(options.method,'GET','Every non-save business request must stay read-only');
   if(parsed.pathname==='/jdy/v2/bd/customer_detail')return Response.json({errcode:0,data:{id:'synthetic-customer-id',number:parsed.searchParams.get('number'),enable:1}});
   if(['/jdy/v2/bd/currency','/jdy/v2/bd/emp','/jdy/v2/bd/measure_unit'].includes(parsed.pathname)){
    const kind=parsed.pathname.split('/').at(-1),name=parsed.searchParams.get('search'),row={id:'synthetic-'+kind,number:'SYN-'+kind,name,enable:1};
    return Response.json({errcode:0,data:{total_page:1,rows:remoteMode==='ambiguous-unit'&&kind==='measure_unit'?[row,{...row,id:'synthetic-second-unit'}]:[row]}});
   }
   if(parsed.pathname==='/jdy/v2/bd/material_detail')return Response.json({errcode:0,data:{id:'synthetic-material-'+parsed.searchParams.get('number'),number:remoteMode==='missing-material'?'DIFFERENT-NUMBER':parsed.searchParams.get('number'),enable:1,is_sale:1,base_unit_id:'synthetic-measure_unit',is_asst_attr:false,is_multi_unit:false,is_batch:false,is_kf_period:false,is_serial:false}});
   if(parsed.pathname==='/jdy/v2/scm/sal_order_detail'){
    const lookup=parsed.searchParams.get('id')||parsed.searchParams.get('number')||parsed.searchParams.get('bill_no'),detail=structuredClone(savedRemote.get(lookup));
    if(!detail)return Response.json({errcode:404,data:{}});
    if(remoteMode==='bad-readback')detail.material_entity[0].qty='999';
    return Response.json({errcode:0,data:detail});
   }
   assert.fail('Unexpected synthetic HTTP path: '+parsed.pathname);
  };
  Object.assign(env,config);
  for(const mode of ['missing-material','ambiguous-unit']){
   remoteMode=mode;const response=await request('kingdee-sales-validate',{body:{id:draft.id,version:draft.version},user:users.service});
   if(response.status===200){draft=(await response.json()).item;assert.equal(draft.validation.remoteVerified,false);assert(draft.validation.warnings.length>0);}
   else assert([400,409,502].includes(response.status));
   draft=latest(draft);
  }
  assert.equal(salesPosts().length,0);
  remoteMode='success';draft=(await mutate('kingdee-sales-validate',{id:draft.id,version:draft.version},users.service)).item;
  assert.equal(draft.status,'validated');assert.equal(draft.validation.valid,true);assert.equal(draft.validation.remoteVerified,true);
  pass('远端客户、单位、币别、业务员及完整成品编码只做精确唯一匹配，缺商品或重名单位保留明确未核实警告且无销售写入');

  assert.equal((await request('kingdee-sales-export?id='+draft.id+'&version='+draft.version,{user:users.service})).status,409);
  assert.equal((await request('kingdee-sales-confirm',{body:{id:draft.id,version:draft.version,acknowledged:true},user:users.sales})).status,403);
  draft=(await mutate('kingdee-sales-confirm',{id:draft.id,version:draft.version,acknowledged:true},users.service)).item;
  const exported=await request('kingdee-sales-export?id='+draft.id+'&version='+draft.version,{user:users.service});assert.equal(exported.status,200,await exported.clone().text());
  assert.equal((await request('kingdee-sales-export?id='+draft.id+'&version='+(draft.version-1),{user:users.service})).status,409);
  const exportBytes=new Uint8Array(await exported.arrayBuffer()),book=XLSX.read(exportBytes),sheet=book.Sheets['sheet1（名称勿改）'],archive=unzipSync(exportBytes),templateArchive=unzipSync(templateBytes);
  assert.deepEqual(book.SheetNames,['sheet1（名称勿改）','基础资料（名称勿改）']);assert.equal(book.Workbook.Sheets[1].Hidden,1);
  assert.equal(XLSX.utils.decode_range(sheet['!ref']).e.c,14);assert.equal(XLSX.utils.decode_range(sheet['!ref']).e.r,4);
  assert.deepEqual(templateHeaders.map((_,index)=>sheet[XLSX.utils.encode_cell({r:2,c:index})].v),templateHeaders);
  assert.equal(sheet.A4.v,sourceA.orderNo);assert.equal(sheet.H4.v,draft.validation.codes[0].productCode);assert.equal(sheet.J4.v,12);assert.equal(sheet.J5.v,5);assert.equal(sheet.K4.v,3.5);assert.equal(sheet.N4.v,'2026-11-22');assert.equal(sheet.O4.v,sourceA.source.customerPO);
  const merges=sheet['!merges'].map(range=>XLSX.utils.encode_range(range));assert(merges.includes('A1:O1'));assert(merges.includes('A2:O2'));assert(merges.includes('A4:A5'));
  assert.deepEqual(archive['xl/worksheets/sheet2.xml'],templateArchive['xl/worksheets/sheet2.xml']);assert.deepEqual(archive['xl/styles.xml'],templateArchive['xl/styles.xml']);
  assert.match(strFromU8(archive['xl/worksheets/sheet1.xml']),/<dataValidation\b/);assert.match(strFromU8(archive['xl/workbook.xml']),/SyntheticCurrencies/);
  assert(!Object.values(archive).some(bytes=>strFromU8(bytes).includes('SYNTHETIC OLD ORDER DO NOT EXPORT')));
  assert([403,404].includes((await request('kingdee-sales-export?id='+draft.id,{user:users['other-service']})).status));
  assert([403,404].includes((await request('kingdee-sales-export?id='+draft.id,{team:id('team_B')})).status));
  pass('金蝶导出严格保持原模板15列和工作表名称、标题合并、隐藏字典及校验样式，去除旧样例且下载范围重检');

  assert.equal(draft.status,'confirmed');assert.equal(draft.confirmation.actorId,id('member_service'));assert(draft.confirmation.binding);assert(Date.parse(draft.confirmation.expiresAt)>Date.now());
  const confirmed=structuredClone(draft),postsBefore=salesPosts().length;
  assert.equal((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,503);
  assert.equal(salesPosts().length,postsBefore);assert.equal(latest(draft).status,'confirmed');
  for(const value of ['true','yes','0']){env.DOON_KINGDEE_SALES_WRITE_ENABLED=value;assert.notEqual((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,200);assert.equal(salesPosts().length,postsBefore);}
  env.DOON_KINGDEE_SALES_WRITE_ENABLED='1';
  const protocolBlock=await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service});assert.equal(protocolBlock.status,409);assert.match((await protocolBlock.json()).error,/现销|赊销/);assert.equal(salesPosts().length,postsBefore);
  const closedConnection=await json('kingdee-sales-data');assert(closedConnection.connection.readinessIssues.length>0);assert.equal(closedConnection.drafts.find(row=>row.id===draft.id).canUpload,false);
  pass('业务员不能代替客户专责客服确认；确认绑定人员与期限，独立金蝶写开关默认关闭且只接受明确的1');
  pass('尚未核定现销／赊销API映射时，即使开关为1也明确阻断直接写入，不能静默丢弃模板业务类型');

  // Exercise the dormant executor only in a separate temporary bundle. The
  // production API above remains closed; all outbound HTTP is still this mock.
  activeApi=await protocolTestApi(env,identity);

  const sourceChanged=structuredClone(sourceA);sourceChanged.source.lines[0].quantity=13;sourceChanged.contentFingerprint=digest(sourceChanged.source);rawPut(sourceChanged);
  assert.equal((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,409);assert.equal(salesPosts().length,postsBefore);rawPut(sourceA);
  const changedTemplate=syntheticKingdeeSalesTemplate();const templateZip=unzipSync(changedTemplate);templateZip['xl/worksheets/sheet1.xml']=strToU8(strFromU8(templateZip['xl/worksheets/sheet1.xml']).replace('SYNTHETIC KINGDEE SALES TEMPLATE','CHANGED SYNTHETIC TEMPLATE'));files.set(template.fileKey,zipSync(templateZip));
  assert.equal((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,409);assert.equal(salesPosts().length,postsBefore);files.set(template.fileKey,templateBytes);
  const badTemplateBook=XLSX.read(templateBytes);badTemplateBook.Sheets['sheet1（名称勿改）'].P3={t:'s',v:'UNSUPPORTED EXTRA COLUMN'};badTemplateBook.Sheets['sheet1（名称勿改）']['!ref']='A1:P4';files.set(template.fileKey,XLSX.write(badTemplateBook,{type:'buffer',bookType:'xlsx'}));
  assert.equal((await request('kingdee-sales-export?id='+draft.id+'&version='+draft.version,{user:users.service})).status,400);files.set(template.fileKey,templateBytes);
  rawPut({...confirmed,inputs:{...confirmed.inputs,remark:'UNCONFIRMED TAMPERED VALUE'}});
  assert.equal((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,409);assert.equal(salesPosts().length,postsBefore);rawPut(confirmed);
  rawPut({...confirmed,confirmation:{...confirmed.confirmation,expiresAt:'2000-01-01T00:00:00.000Z'}});
  assert.equal((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,409);assert.equal(salesPosts().length,postsBefore);rawPut(confirmed);
  env.DOON_KINGDEE_ACCOUNT_ID='synthetic-different-account';assert.equal((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,409);assert.equal(salesPosts().length,postsBefore);env.DOON_KINGDEE_ACCOUNT_ID=config.DOON_KINGDEE_ACCOUNT_ID;
  const serviceAccount=structuredClone(accounts[0]);rawPut({...serviceAccount,serviceMemberIds:[]});
  assert([403,404].includes((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status));assert.equal(salesPosts().length,postsBefore);rawPut(serviceAccount);
  draft=(await mutate('kingdee-sales-save',{id:draft.id,version:draft.version,inputs:{...draft.inputs,remark:'SYNTHETIC COMMERCIAL PRIVATE NOTE / reviewed revision'}},users.service)).item;
  assert.equal(draft.status,'draft');assert(!draft.confirmation);assert.equal(draft.validation.remoteVerified,false);
  assert.notEqual((await request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})).status,200);assert.equal(salesPosts().length,postsBefore);
  pass('源单、模板、完整草稿、目标账套或确认期限变化及权限收回均阻断旧确认；正常修改后必须重新核验并由客服确认');

  draft=(await mutate('kingdee-sales-validate',{id:draft.id,version:draft.version},users.service)).item;
  draft=(await mutate('kingdee-sales-confirm',{id:draft.id,version:draft.version,acknowledged:true},users.service)).item;
  const beforeUploadVersion=draft.version,attempts=await Promise.all([request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service}),request('kingdee-sales-upload',{body:{id:draft.id,version:draft.version},user:users.service})]);
  assert(attempts.some(response=>response.status===200));assert(attempts.every(response=>[200,409,429].includes(response.status)));
  draft=latest(draft);assert.equal(salesPosts().length,postsBefore+1);assert.equal(draft.status,'uploaded');assert.equal(draft.remoteNumber,sourceA.orderNo);assert(draft.remoteId);
  const firstPayload=salesPosts().at(-1).body;assert.equal(firstPayload.material_entity.length,2);assert.equal(firstPayload.material_entity[0].qty,12);assert.equal(firstPayload.material_entity[0].price,3.5);assert.equal(firstPayload.material_entity[0].cess,'13');assert.equal(firstPayload.material_entity[0].cus_bill_no,sourceA.source.customerPO);
  assert.equal(firstPayload.exchange_rate,1);assert.equal(firstPayload.material_entity[0].regain_price,false);assert.equal(firstPayload.material_entity[0].amount,42);assert.equal(firstPayload.material_entity[0].tax_amount,5.46);assert.equal(firstPayload.material_entity[0].all_amount,47.46);assert.equal(firstPayload.material_entity[0].comment,'');const successfulAttempt=latest(draft.attemptId);assert.equal(successfulAttempt.remoteLineIds.length,2);assert.equal(new Set(successfulAttempt.remoteLineIds).size,2);
  for(const version of [beforeUploadVersion,draft.version]){const response=await request('kingdee-sales-upload',{body:{id:draft.id,version},user:users.service});assert([200,409].includes(response.status));assert.equal(salesPosts().length,postsBefore+1);}
  const again=await request('kingdee-sales-prepare',{body:{sourceId:sourceA.id},user:users.service});assert([200,409].includes(again.status));assert.equal(rawRecords().filter(row=>row.kind==='kingdee_sales_draft'&&row.sourceId===sourceA.id).length,1);
  assert.equal(salesPosts().length,postsBefore+1);
  pass('并发点击及旧请求重放仅发出一次销售订单POST，服务器先持久化执行记录并在逐行回读一致后标记上传成功');

  const makeConfirmed=async(name,overrides={},user=users.service)=>{
   const record=await importSource(name,overrides);let item=(await mutate('kingdee-sales-prepare',{sourceId:record.id},user)).item;
   item=(await mutate('kingdee-sales-save',{id:item.id,version:item.version,inputs:validInputs(item)},user)).item;
   item=(await mutate('kingdee-sales-validate',{id:item.id,version:item.version},user)).item;
   return (await mutate('kingdee-sales-confirm',{id:item.id,version:item.version,acknowledged:true},user)).item;
  };
  const sameBillOtherSource=await makeConfirmed('DUPLICATE-BILL',{customer:'KDSYNB',orderNo:sourceA.orderNo.toLowerCase()},admin),beforeDuplicateAttempt=salesPosts().length;
  remoteMode='no-remote-match';assert.equal((await request('kingdee-sales-upload',{body:{id:sameBillOtherSource.id,version:sameBillOtherSource.version}})).status,409);assert.equal(salesPosts().length,beforeDuplicateAttempt);remoteMode='success';
  pass('账套内同一销售单号即使由不同客户和不同原单再次生成，也不能绕过持久化幂等再写一次');
  const remoteExisting=await makeConfirmed('REMOTEEXISTS');savedRemote.set(remoteExisting.orderNo,{id:'remote-existing-before-app',bill_no:remoteExisting.orderNo});
  assert.equal((await request('kingdee-sales-upload',{body:{id:remoteExisting.id,version:remoteExisting.version},user:users.service})).status,409);assert.equal(salesPosts().length,beforeDuplicateAttempt);assert(!latest(remoteExisting).attemptId);
  const incompleteList=await makeConfirmed('BADCHECK');remoteMode='inconsistent-list';assert([409,502].includes((await request('kingdee-sales-upload',{body:{id:incompleteList.id,version:incompleteList.version},user:users.service})).status));assert.equal(salesPosts().length,beforeDuplicateAttempt);assert(!latest(incompleteList).attemptId);remoteMode='success';
  pass('发送前按单号只读核查金蝶已有订单并复核分页，已有远端单号或无法证明完整的结果都禁止新建');
  let timeoutDraft=await makeConfirmed('TIMEOUT');remoteMode='timeout';const timeoutCount=salesPosts().length;
  const timeoutResponse=await request('kingdee-sales-upload',{body:{id:timeoutDraft.id,version:timeoutDraft.version},user:users.service});assert([200,502].includes(timeoutResponse.status));
  timeoutDraft=latest(timeoutDraft);assert.equal(timeoutDraft.status,'unknown');assert.equal(salesPosts().length,timeoutCount+1);
  for(let repeat=0;repeat<2;repeat++){const response=await request('kingdee-sales-upload',{body:{id:timeoutDraft.id,version:timeoutDraft.version},user:users.service});assert([200,409].includes(response.status));assert.equal(latest(timeoutDraft).status,'unknown');assert.equal(salesPosts().length,timeoutCount+1);}
  remoteMode='success';const reconciled=await mutate('kingdee-sales-reconcile',{id:timeoutDraft.id,version:timeoutDraft.version},users.service);assert.equal(reconciled.item.status,'uploaded');assert.equal(salesPosts().length,timeoutCount+1);
  pass('金蝶接收后网络超时保存待核查状态，重复上传不盲重试；核查原单仅用GET并可确认既有成功结果');

  let mismatchDraft=await makeConfirmed('BADREADBACK');remoteMode='bad-readback';const mismatchCount=salesPosts().length;
  const mismatched=await request('kingdee-sales-upload',{body:{id:mismatchDraft.id,version:mismatchDraft.version},user:users.service});assert([200,409,502].includes(mismatched.status));
  mismatchDraft=latest(mismatchDraft);assert.equal(mismatchDraft.status,'unknown');assert.equal(salesPosts().length,mismatchCount+1);
  const mismatchRetry=await request('kingdee-sales-upload',{body:{id:mismatchDraft.id,version:mismatchDraft.version},user:users.service});assert([200,409].includes(mismatchRetry.status));assert.equal(salesPosts().length,mismatchCount+1);
  const mismatchRecheck=await request('kingdee-sales-reconcile',{body:{id:mismatchDraft.id,version:mismatchDraft.version},user:users.service});assert([200,409,502].includes(mismatchRecheck.status));assert.equal(latest(mismatchDraft).status,'unknown');assert.equal(salesPosts().length,mismatchCount+1);
  pass('HTTP保存成功但金蝶回读数量不一致时保持待核查，重复点击和复核均不能宣称上传成功或再次写单');

  const sourceTemplateResponse=await request('kingdee-sales-source-template',{user:users.sales});assert.equal(sourceTemplateResponse.status,200);
  const sourceTemplateBytes=await sourceTemplateResponse.arrayBuffer(),sourceBook=XLSX.read(sourceTemplateBytes),sourceSheet=sourceBook.Sheets['中英订单上传'];
  assert(sourceSheet);assert(XLSX.utils.sheet_to_json(sourceSheet).every(row=>Object.values(row).every(value=>value===''||value===null)),'The download must contain only empty formatted input rows');
  const sourceHeaders=XLSX.utils.sheet_to_json(sourceSheet,{header:1})[0],sourceValues={'订单号':'KD-SYN-XLSX-UPLOAD','客户号':'KDSYNA','客户订单号':'KD-SYN-XLSX-PO','成品类别码':'TI','图纸编号':'DN002','客款号':'MODEL002','原单SKU':'UNTRUSTED-UPLOAD-SKU','色号':'C001','数量':7,'单位':'PCS','样办数量':2,'单价':'8.25','交货日期':'2026-11-25','板料编码或电镀颜色':'IPGREY','单据日期':'2026-10-22','业务员名称':'Synthetic Employee','币别名称':'USD','汇率':'1','业务类型':'赊销','计价方式':'不含税','税率（%）':'13','是否赠品':'否','客户英文原文':'SYNTHETIC UPLOAD COMMERCIAL ORIGINAL','工厂中文工艺':'合成中文工艺原文','备注':'保留原附件'};
  XLSX.utils.sheet_add_aoa(sourceSheet,[sourceHeaders.map(header=>sourceValues[header.split('\n')[0]]??'')],{origin:'A2'});
  XLSX.utils.sheet_add_aoa(sourceSheet,[['客户自定义栏目'],['  Preserve original / spacing  ']],{origin:{r:0,c:sourceHeaders.length}});
  const workbookBytes=XLSX.write(sourceBook,{type:'buffer',bookType:'xlsx'}),form=bytes=>{const formData=new FormData();formData.set('file',new File([bytes],'synthetic-bilingual-source.xlsx'));return formData;};
  const sourcesBeforeUpload=rawRecords().filter(record=>record.kind==='sales_order_source').length,httpBeforeUpload=calls.length;
  const preview=(await mutate('kingdee-sales-source-preview',form(workbookBytes),users.sales,id('team_A'))).preview;
  assert.equal(preview.source.orderNo,sourceValues['订单号']);assert.equal(preview.source.lines[0].quantity,7);assert.equal(preview.source.lines[0].sampleQuantity,2);assert(preview.unmappedColumns.some(column=>column.includes('客户自定义栏目')));assert.equal(rawRecords().filter(record=>record.kind==='sales_order_source').length,sourcesBeforeUpload);assert.equal(calls.length,httpBeforeUpload);
  assert.equal((await request('kingdee-sales-source-commit',{body:{id:preview.id,acknowledged:false},user:users.sales})).status,400);
  assert.equal((await request('kingdee-sales-source-commit',{body:{id:preview.id,acknowledged:true},user:users.service})).status,403);
  const uploadCommit=await mutate('kingdee-sales-source-commit',{id:preview.id,acknowledged:true},users.sales,id('team_A')),uploadedSource=latest(uploadCommit.sourceId);
  assert.equal(uploadCommit.item.status,'draft');assert.equal(uploadCommit.item.inputs.lines[0].categoryCode,'TI');assert.equal(uploadCommit.item.inputs.lines[0].finishCode,'IPGREY');assert.equal(uploadCommit.item.inputs.taxMode,'exclusive');assert.equal(uploadCommit.item.inputs.lines[0].quantity,'7');
  assert.equal(uploadedSource.source.lines[0].rawFields.find(field=>field.label==='客户自定义栏目').value,'  Preserve original / spacing  ');
  assert(uploadedSource.source.lines[0].notes.includes(sourceValues['客户英文原文']));assert(uploadedSource.source.lines[0].notes.includes(sourceValues['工厂中文工艺']));
  assert.equal((await mutate('kingdee-sales-source-commit',{id:preview.id,acknowledged:true},users.sales)).item.id,uploadCommit.item.id);assert.equal(rawRecords().filter(record=>record.kind==='sales_order_source').length,sourcesBeforeUpload+1);
  const originalFile=await request('kingdee-sales-source-file?id='+uploadedSource.id,{user:users.sales});assert.equal(originalFile.status,200);assert.deepEqual(Buffer.from(await originalFile.arrayBuffer()),workbookBytes);
  assert.equal((await request('kingdee-sales-source-file?id='+uploadedSource.id,{user:users['other-service']})).status,403);
  const duplicatePreview=(await mutate('kingdee-sales-source-preview',form(workbookBytes),users.sales)).preview;assert.equal((await request('kingdee-sales-source-commit',{body:{id:duplicatePreview.id,acknowledged:true},user:users.sales})).status,409);
  const invalidBook=XLSX.read(workbookBytes),quantityColumn=sourceHeaders.findIndex(header=>header.startsWith('数量\n'));invalidBook.Sheets['中英订单上传'][XLSX.utils.encode_cell({r:1,c:quantityColumn})]={t:'n',v:7,f:'3+4'};
  assert.equal((await request('kingdee-sales-source-preview',{body:form(XLSX.write(invalidBook,{type:'buffer',bookType:'xlsx'})),user:users.sales})).status,400);
  const crossBook=XLSX.read(workbookBytes),customerColumn=sourceHeaders.findIndex(header=>header.startsWith('客户号\n'));crossBook.Sheets['中英订单上传'][XLSX.utils.encode_cell({r:1,c:customerColumn})]={t:'s',v:'KDSYNB'};
  assert.equal((await request('kingdee-sales-source-preview',{body:form(XLSX.write(crossBook,{type:'buffer',bookType:'xlsx'})),user:users.sales,team:id('team_A')})).status,403);
  const tamperedBook=XLSX.read(workbookBytes),orderColumn=sourceHeaders.findIndex(header=>header.startsWith('订单号\n'));tamperedBook.Sheets['中英订单上传'][XLSX.utils.encode_cell({r:1,c:orderColumn})]={t:'s',v:'KD-SYN-XLSX-BADHASH'};
  const tamperedPreview=(await mutate('kingdee-sales-source-preview',form(XLSX.write(tamperedBook,{type:'buffer',bookType:'xlsx'})),users.sales)).preview,tamperedStored=latest(tamperedPreview.id);files.set(tamperedStored.fileKey,new Uint8Array([1,2,3]));
  assert.equal((await request('kingdee-sales-source-commit',{body:{id:tamperedPreview.id,acknowledged:true},user:users.sales})).status,409);
  assert.equal(calls.length,httpBeforeUpload);assert.equal(rawRecords().filter(record=>record.kind==='sales_order_source').length,sourcesBeforeUpload+1);
  pass('真实中英XLSX上传经预览与本人确认才生成独立草稿，原文/附加列/样办及原附件逐值保留，重传、公式和跨组不会重复或越权入单');

  for(const member of [admin,users.service,users.sales,users.production,users.finance,users.outside]){
   const data=await json('data',{user:member});assert(!JSON.stringify(data).includes('SYNTHETIC COMMERCIAL PRIVATE NOTE'));assert(!JSON.stringify(data).includes('UNCONFIRMED TAMPERED VALUE'));assert(!JSON.stringify(data).includes('SYNTHETIC UPLOAD COMMERCIAL ORIGINAL'));
   assert(!data.audits.some(row=>['kingdee_sales_draft','kingdee_sales_attempt'].includes(row.before?.kind)||['kingdee_sales_draft','kingdee_sales_attempt'].includes(row.after?.kind)));
  }
  for(const record of [sourceA,sourceB])assert.deepEqual(latest(record),record);
  assert.equal(rawRecords().filter(row=>row.kind==='order').length,[...originalRecords.values()].map(value=>JSON.parse(value)).filter(row=>row.kind==='order').length);
  assert.equal(rawRecords().filter(row=>row.kind==='report').length,[...originalRecords.values()].map(value=>JSON.parse(value)).filter(row=>row.kind==='report').length);
  pass('销售草稿、确认和上传单独留痕，通用订单审计不泄露商业载荷；原单、生产订单、报工和全部旧记录保持不变');

  const finalRecords=recordSnapshot();for(const [recordId,value] of originalRecords)assert.equal(finalRecords.get(recordId),value,'Unrelated original record changed: '+recordId);
 }finally{
  globalThis.fetch=previousFetch;
  for(const [key,value] of environment){if(value===undefined)delete env[key];else env[key]=value;}
  delete globalThis.__kingdeeSalesProtocolEnv;delete globalThis.__kingdeeSalesProtocolIdentity;
 }
}

async function protocolTestApi(env,identity){
 const {build}=await import('esbuild'),fs=await import('node:fs/promises');
 const directory=await fs.mkdtemp(path.resolve('test-output','kingdee-sales-protocol-only-')),outfile=path.join(directory,'api.mjs');
 globalThis.__kingdeeSalesProtocolEnv=env;globalThis.__kingdeeSalesProtocolIdentity=identity;
 await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-verified-protocol-only',setup(builder){
  builder.onLoad({filter:/[\\/]kingdee-sales-api\.ts$/},async args=>{const source=await fs.readFile(args.path,'utf8'),pattern=/export function salesApiReadinessIssues\(\)\{return \[[^\n]*?\];\}/;assert(pattern.test(source),'Test-only protocol substitution must target exactly the documented readiness function');return {contents:source.replace(pattern,'export function salesApiReadinessIssues(){return [];}'),loader:'ts'};});
  builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'sales-protocol-only'}));builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'sales-protocol-only'}));builder.onLoad({filter:/.*/,namespace:'sales-protocol-only'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__kingdeeSalesProtocolIdentity.getStore()||null}':'export const env=globalThis.__kingdeeSalesProtocolEnv;'}));
 }}]});
 return import(pathToFileURL(outfile).href);
}

async function standalone(){
 const {build}=await import('esbuild'),{DatabaseSync}=await import('node:sqlite'),{AsyncLocalStorage}=await import('node:async_hooks'),fs=await import('node:fs/promises');
 await fs.mkdir('test-output',{recursive:true});const output=await fs.mkdtemp(path.resolve('test-output','kingdee-sales-cases-'));
 const db=new DatabaseSync(':memory:');
 for(const filename of (await fs.readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',filename),'utf8'));
 class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
 const files=new Map(),identity=new AsyncLocalStorage(),env={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const rows=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return rows;}catch(error){db.exec('ROLLBACK');throw error;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key),arrayBuffer:async()=>new Uint8Array(files.get(key)).buffer,json:async()=>JSON.parse(files.get(key))}:null}};
 globalThis.__kingdeeSalesIdentity=identity;globalThis.__kingdeeSalesEnv=env;
 const outfile=path.join(output,'api.mjs');
 await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-kingdee-sales-bindings',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'kingdee-sales-test'}));builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'kingdee-sales-test'}));builder.onLoad({filter:/.*/,namespace:'kingdee-sales-test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__kingdeeSalesIdentity.getStore()||null}':'export const env=globalThis.__kingdeeSalesEnv;'}));}}]});
 const api=await import(pathToFileURL(outfile).href),admin={userId:id('admin'),email:'admin@kingdee-sales-tests.invalid',displayName:'Synthetic ERP admin',fullName:'Synthetic ERP admin'};
 try{
  const enrolled=await identity.run(admin,()=>api.POST(new Request('https://orders.test/api/workspace/enroll',{method:'POST',body:'{}'}),{params:Promise.resolve({action:'enroll'})}));assert.equal(enrolled.status,200);
  let checks=0;
  await testKingdeeSales({api,identity,admin,env,files,rawRecords:()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(row=>JSON.parse(row.data)),rawPut:record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(record.id,record.kind,JSON.stringify(record)),pass:message=>{checks++;console.log('PASS '+message);}});
  console.log(JSON.stringify({ok:true,checks,synthetic:true,productionTouched:false}));
 }finally{db.close();delete globalThis.__kingdeeSalesIdentity;delete globalThis.__kingdeeSalesEnv;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await standalone();
