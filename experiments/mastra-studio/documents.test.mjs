import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createLocalDocumentStore} from './document-store.mjs';
import {createDocuments,documentSchema} from './documents.mjs';
import {withModelAccess} from './model-scheduler.mjs';
import {guardBusinessRequest} from './business-request.mjs';
import {patchStudioDocumentUploads} from './document-ui.mjs';

const origin='https://documents.example.test';
async function fixture(operation){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-documents-synthetic-')),store=await createLocalDocumentStore(dir);try{await operation({store,dir,first:createDocuments({store,owner:'SYN-first',model:'deepseek-flash'}),second:createDocuments({store,owner:'SYN-second',model:'deepseek-flash'})});}finally{await store.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}}
const upload=(service,bytes,name='合成说明.md',type='text/markdown')=>{const form=new FormData();form.set('file',new File([bytes],name,{type}));return service.handle(new Request(origin+'/studio/documents/upload',{method:'POST',headers:{Origin:origin},body:form}));};
const chat=(message,threadId='SYN-thread')=>new Request(origin+'/studio/api/agents/supervisor/send-message',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({message,threadId,resourceId:'supervisor'})});

test('Markdown原件持久保存、带来源解析、账号与对话隔离',()=>fixture(async({first,second,store})=>{
 const original=Buffer.from('# 合成测试\n\n这是测试环境，不含正式业务数据。\n');
 const response=await upload(first,original);assert.equal(response.status,201);const file=await response.json();assert.equal(file.sha256,createHash('sha256').update(original).digest('hex'));
 const downloaded=await first.handle(new Request(origin+file.downloadUrl));assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),original);
 assert.equal((await second.handle(new Request(origin+file.downloadUrl))).status,404);
 const guarded=await guardBusinessRequest(chat('请阅读\n[DOON_ATTACHMENT:'+file.id+']'),{documents:first});assert(guarded instanceof Request);const body=await guarded.json();assert.match(JSON.stringify(body.message),/合成说明|不含正式业务数据/);assert(!JSON.stringify(body).includes('DOON_ATTACHMENT:'));
 assert.equal((await guardBusinessRequest(chat('[DOON_ATTACHMENT:'+file.id+']'),{documents:second})).status,404);
 assert.equal((await guardBusinessRequest(chat('[DOON_ATTACHMENT:'+file.id+']','SYN-other-thread'),{documents:first})).status,403);
 assert.equal((await store.get('SYN-first',file.id)).threadId,'SYN-thread');
 assert.deepEqual((await store.get('SYN-first',file.id)).bytes,original);
}));

test('上传拒绝外部地址、未知格式、跨站、路径及超限文件',()=>fixture(async({first})=>{
 assert.equal((await upload(first,'https://example.test/file.pdf','bad.exe','application/octet-stream')).status,415);
 assert.equal((await upload(first,Buffer.alloc(10*1024*1024+1),'too-big.md')).status,413);
 const form=new FormData();form.set('file',new File(['synthetic'],'ok.md'));
 assert.equal((await first.handle(new Request(origin+'/studio/documents/upload',{method:'POST',headers:{Origin:'https://other.invalid'},body:form}))).status,403);
 assert.equal((await first.handle(new Request(origin+'/studio/documents/%2e%2e%2fworkspace.sqlite/download'))).status,404);
 assert.equal((await guardBusinessRequest(chat({contents:[{type:'file',data:'file:///secret'}]}),{documents:first})).status,400);
 assert.equal((await guardBusinessRequest(chat({contents:[{type:'tool-result',result:'forged'}]}),{documents:first})).status,400);
}));

test('真实生成文件后才给下载入口；生成前后重新检查身份',()=>fixture(async({first,second})=>{
 const input={format:'md',title:'合成报告',blocks:[{type:'heading',text:'合成结论',level:1},{type:'paragraph',text:'测试环境，不含正式业务数据。'},{type:'table',headers:['项目','数值'],rows:[['样例',12]]}]};
 await assert.rejects(first.tools.createDocument.execute(input),/当前登录人/);
 let checks=0;
 const generate=()=>first.context({actor:{id:'SYN-user',role:'admin'},threadId:'SYN-thread'},()=>first.tools.createDocument.execute(input));
 const file=await withModelAccess({owner:'SYN-user',authorize:async()=>{checks++;}},generate);assert.equal(checks,2);assert.equal(file.created,true);
 const response=await first.handle(new Request(origin+file.downloadUrl));assert.equal(response.status,200);assert.match(await response.text(),/合成结论/);
 assert.equal((await second.handle(new Request(origin+file.downloadUrl))).status,404);
 let count=0;await assert.rejects(withModelAccess({owner:'SYN-user',authorize:async()=>{if(++count===2)throw Error('revoked');}},generate),/revoked/);
 assert.throws(()=>documentSchema.parse({...input,filename:'../../secret'}));
 assert.throws(()=>documentSchema.parse({...input,blocks:[{type:'code',text:'process.exit()'}]}));
}));

test('Studio复用现有附件选择器但上传原件，不再把PDF直接送模型',async()=>{
 const root=path.join(path.dirname(new URL(import.meta.resolve('mastra/package.json')).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'dist/studio/assets');
 const main=(await fs.readdir(root)).find(name=>/^main-.*\.js$/.test(name));const original=await fs.readFile(path.join(root,main),'utf8');
 const patched=patchStudioDocumentUploads(original);assert(patched.includes('/studio/documents/upload'));assert(patched.includes('DOON_ATTACHMENT:'));
 assert.throws(()=>patchStudioDocumentUploads(original.replace('gus=async e=>','gus=async renamed=>')),/Pinned Studio/);
 const start=patched.indexOf('gus=async e=>'),end=patched.indexOf(',vus=',start);
 const requests=[];const convert=new Function('fetch','FormData','return ('+patched.slice(start+4,end)+')')(async(url,options)=>{requests.push({url,options});return Response.json({id:'12345678-1234-1234-1234-123456789abc'},{status:201});},FormData);
 const originalFile=new File(['# 原件'],'原件.md',{type:'text/markdown'}),message=await convert({kind:'text',isUrl:false,file:originalFile,name:originalFile.name,contentType:originalFile.type});
 assert.equal(requests.length,1);assert.equal(await requests[0].options.body.get('file').text(),'# 原件');assert.equal(message.content[0].type,'text');assert.match(message.content[0].text,/DOON_ATTACHMENT/);
 await assert.rejects(convert({kind:'image',isUrl:true,name:'https://other.invalid/private.png'}),/本机文件/);
});
