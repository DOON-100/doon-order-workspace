import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Synthetic projects, identities and file bytes only. No production documents or accounts.
export async function testCustomerProjectOriginalDocuments({ok,call,state,pass,rawRecords,rawInsert}){
 const original=structuredClone(rawRecords()),users={},token=()=>crypto.randomUUID(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const [key,role] of [['writer','sales'],['reader','finance'],['other','sales'],['internal','production'],['unassigned','production']]){
  const user={userId:'synthetic_original_document_'+key,email:'original-document-'+key+'@test.invalid',displayName:'合成原文-'+key,fullName:'合成原文-'+key};
  await ok('member',{name:user.displayName,email:user.email,role,customers:[],active:true});await ok('enroll',{},user);users[key]=user;
 }
 const members=(await state()).members,mid=key=>members.find(member=>member.email===users[key].email).id;
 const customerBody={customer:'合成原始沟通文档客户',customerCode:'SYN-ORIGINAL-DOC',salesName:'',serviceName:'',salesMemberIds:[mid('writer')],serviceMemberIds:[mid('reader')],active:true};
 const customer=(await ok('customer-save',customerBody)).item;
 const otherCustomer=(await ok('customer-save',{...customerBody,customer:'合成其他文档客户',customerCode:'SYN-OTHER-DOC',salesMemberIds:[mid('other')],serviceMemberIds:[]})).item;
 const projectBody={customerId:customer.id,code:'SYN-ORIGINAL-DOC-P',title:'合成项目级原始文档',teamId:'',salesMemberId:mid('writer'),serviceMemberIds:[],status:'paused'};
 const project=(await ok('customer-project-save',{...projectBody,token:token()})).item;
 const otherProject=(await ok('customer-project-save',{...projectBody,token:token(),customerId:otherCustomer.id,code:'SYN-OTHER-DOC-P',salesMemberId:mid('other')})).item;
 const bytes=Uint8Array.from([0,255,1,13,10,60,115,99,114,105,112,116,62]);
 const form=(filename='原始邮件.msg',overrides={})=>{
  const values={projectId:project.id,roundId:'',category:'original-communication',note:'合成原始往来',...overrides},body=new FormData();
  for(const key of ['projectId','roundId','category','note'])if(values[key]!==undefined)body.set(key,values[key]);
  body.set('file',new File([values.bytes||bytes],filename,{type:'text/html'}));return body;
 };
 const denied=async(action,body,user=users.writer,status=400)=>{const before=structuredClone(rawRecords()),response=await call(action,body,user);assert.equal(response.status,status,await response.text());assert.deepEqual(rawRecords(),before,'Rejected document operation must not write records');};
 const documents=[];
 for(const filename of ['邮件.msg','归档.zip','说明.txt','网页.html','图形.svg','程序.exe','没有扩展名']){
  const result=await ok('customer-project-attachment',form(filename),users.writer),item=result.item;documents.push(item);
  assert.equal(item.category,'original-communication');assert.equal(item.roundId,'');assert.equal(item.projectId,project.id);assert.equal(item.customerId,customer.id);assert.equal(item.hash,hash(bytes));assert.equal(item.size,bytes.length);assert(!('fileKey' in item));
  const response=await call('customer-project-file?id='+item.id,undefined,users.reader);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/sandbox/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 }
 assert(!rawRecords().some(row=>row.projectId===project.id&&['customer_project_item','customer_project_round','customer_project_task','customer_project_confirmation','customer_project_handover','project_charge'].includes(row.kind)));
 pass('项目级原始沟通文档支持任意格式及无扩展名，暂停项目无款色轮次亦可上传，下载原始字节并强制安全附件响应');

 const beforeRetry=structuredClone(rawRecords()),repeat=await ok('customer-project-attachment',form('邮件.msg'),users.writer);assert.equal(repeat.idempotent,true);assert.equal(repeat.item.id,documents[0].id);assert.deepEqual(rawRecords(),beforeRetry);
 const general=(await ok('customer-project-attachment',form('同名.pdf',{category:undefined}),users.writer)).item;
 const distinct=(await ok('customer-project-attachment',form('同名.pdf'),users.writer)).item;assert.notEqual(general.id,distinct.id);assert.equal(general.category,'general');assert.equal(distinct.category,'original-communication');
 const storedGeneral=rawRecords().find(row=>row.id===general.id),legacy={...storedGeneral,id:'synthetic-original-document-legacy',filename:'旧格式.pdf'};delete legacy.category;rawInsert(legacy);
 const beforeLegacy=structuredClone(rawRecords()),legacyRetry=await ok('customer-project-attachment',form('旧格式.pdf',{category:undefined}),users.writer);assert.equal(legacyRetry.item.id,legacy.id);assert.equal(legacyRetry.idempotent,true);assert.deepEqual(rawRecords(),beforeLegacy);
 for(const filename of ['旧附件.html','旧附件.zip','旧附件.constructor','旧附件.__proto__'])await denied('customer-project-attachment',form(filename,{category:undefined}));
 for(const category of ['other','','Original-Communication'])await denied('customer-project-attachment',form('分类.txt',{category}));
 pass('重复上传不改写记录，分类参与幂等且旧附件仍视为general，普通工程格式白名单和非法分类拒绝保持有效');

 const doc=documents[0],current=()=>rawRecords().find(row=>row.id===doc.id),stored=structuredClone(current());
 const round=(await ok('customer-project-entry-save',{token:token(),entryType:'round',projectId:project.id,title:'合成独立轮次'},users.writer)).item;
 await denied('customer-project-attachment',form('错误关联.txt',{roundId:round.id}));
 const updated=(await ok('customer-project-entry-save',{token:token(),entryType:'attachment',projectId:project.id,id:doc.id,version:doc.version,roundId:'',note:'仅修改说明'},users.writer)).item;
 assert.equal(updated.category,'original-communication');for(const key of ['fileKey','hash','size','contentType','filename'])assert.equal(current()[key],stored[key]);
 await denied('customer-project-entry-save',{token:token(),entryType:'attachment',projectId:project.id,id:doc.id,version:updated.version,roundId:round.id});
 for(const protectedField of [{category:'general'},{fileKey:'fake-key'},{hash:'fake-hash'}])await denied('customer-project-entry-save',{token:token(),entryType:'attachment',projectId:project.id,id:doc.id,version:updated.version,...protectedField});
 await denied('customer-project-entry-save',{token:token(),entryType:'attachment',projectId:project.id,category:'original-communication',filename:'伪造原始文件.txt'});
 const originalAgain=await call('customer-project-file?id='+doc.id,undefined,users.reader);assert.deepEqual(new Uint8Array(await originalAgain.arrayBuffer()),bytes);
 pass('说明编辑保留分类与存储原件，独立登记不能伪造或改写分类、存储字段，也不能将原始文档移动至轮次');

 await denied('customer-project-attachment',form(),users.other,403);
 await denied('customer-project-attachment',form('跨客户.txt',{projectId:otherProject.id}),users.writer,403);
 await denied('customer-project-attachment',form(),users.reader,403);
 await denied('customer-project-file?id='+doc.id,undefined,users.other,403);
 const drawing={id:'synthetic-original-document-drawing',kind:'customer_project_drawing',projectId:project.id,customerId:customer.id,roundId:'',attachmentIds:[doc.id,general.id],status:'submitted'};rawInsert(drawing);
 rawInsert({id:'synthetic-original-document-sample',kind:'customer_project_sample',projectId:project.id,customerId:customer.id,roundId:'',ownerId:mid('internal'),drawingIds:[drawing.id],scope:[],itemSnapshot:[],status:'pending'});
 const internalData=await ok('customer-project-data',undefined,users.internal);assert(!internalData.projects.some(row=>row.id===project.id));assert.deepEqual(internalData.attachments.filter(row=>row.category==='original-communication').map(row=>row.id),[doc.id]);assert(internalData.attachments.some(row=>row.id===general.id));
 const handedOff=await call('customer-project-file?id='+doc.id,undefined,users.internal);assert.equal(handedOff.status,200);assert.equal(handedOff.headers.get('content-type'),'application/octet-stream');assert.deepEqual(new Uint8Array(await handedOff.arrayBuffer()),bytes);
 await denied('customer-project-file?id='+documents[1].id,undefined,users.internal,403);assert.equal((await call('customer-project-file?id='+general.id,undefined,users.internal)).status,200);
 const unassignedData=await ok('customer-project-data',undefined,users.unassigned);assert(!unassignedData.attachments.some(row=>row.projectId===project.id));await denied('customer-project-file?id='+doc.id,undefined,users.unassigned,403);
 await ok('customer-save',{...customerBody,id:customer.id,active:false});await denied('customer-project-attachment',form(),users.writer,403);await denied('customer-project-file?id='+doc.id,undefined,users.writer,403);await ok('customer-save',{...customerBody,id:customer.id});
 const writer=members.find(member=>member.id===mid('writer'));await ok('member',{...writer,active:false});await denied('customer-project-attachment',form(),users.writer,403);await denied('customer-project-file?id='+doc.id,undefined,users.writer,403);await ok('member',{...writer,active:true});
 pass('跨客户、只读人员和停用身份不能上传；内部制作只读取其样办指定图纸明确选定的附件，其余原始文档和未指定人员仍隔离');

 const emojiName='a'.repeat(239)+'😀.html',emoji=(await ok('customer-project-attachment',form(emojiName),users.writer)).item;
 assert.equal(Array.from(emoji.filename).length,240);assert(emoji.filename.endsWith('😀'));assert.equal((await call('customer-project-file?id='+emoji.id,undefined,users.writer)).status,200);
 const special=(await ok('customer-project-attachment',form('CON.txt'),users.writer)).item;assert.equal(special.filename,'_CON.txt');
 const unsafe=(await ok('customer-project-attachment',form('safe\r\nname:<x>.txt'),users.writer)).item;assert(!/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(unsafe.filename));
 await denied('customer-project-attachment',form('空文档',{bytes:new Uint8Array()}));
 const limit=50*1024*1024,boundary=new Uint8Array(limit);boundary[0]=255;boundary[limit-1]=127;
 const atLimit=(await ok('customer-project-attachment',form('精确上限',{bytes:boundary}),users.writer)).item;assert.equal(atLimit.size,limit);assert.equal(atLimit.hash,hash(boundary));
 await denied('customer-project-attachment',form('超限',{bytes:new Uint8Array(limit+1)}));
 const final=new Map(rawRecords().map(row=>[row.id,row]));for(const row of original)assert.deepEqual(final.get(row.id),row);
 pass('文件名按Unicode码点安全截断并清理路径控制字符，50MiB边界可用、空文件和超限拒绝，既有业务记录完整保留');
}
