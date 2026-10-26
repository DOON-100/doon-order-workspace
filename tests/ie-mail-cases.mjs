import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import net from 'node:net';
import {createRequire} from 'node:module';
import {createIeMailAdapter} from '../standalone/ie-mail.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function testIeMail({pass}){
 const env={DOON_IE_MAIL_ENABLED:'1',DOON_IE_MAIL_FROM:'synthetic@example.com',DOON_IE_MAIL_AUTH_CODE:'synthetic-never-real',DOON_IE_WORKSPACE_URL:'https://workspace.example.com'},bytes=new Uint8Array([80,75,3,4,1,2,3]);
 const payload={subject:'合成工程报价 V2',body:'合成内部通知，不发真实邮箱',to:['reviewer@example.com'],cc:['engineer@example.com'],idempotencyKey:'synthetic-request-0001',attachments:[{filename:'synthetic-V2.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes,sha256:sha(bytes)}]};
 let calls=0,options,mail;
 const dependency={createTransport:async o=>{options=o;return {sendMail:async m=>{calls++;mail=m;return {accepted:[...payload.to,...payload.cc],rejected:[]};},close(){}};}};
 for(const invalid of [{},{...env,DOON_IE_MAIL_ENABLED:'0'},{...env,DOON_IE_MAIL_AUTH_CODE:''},{...env,DOON_IE_WORKSPACE_URL:'http://127.0.0.1:8787'},{...env,DOON_IE_MAIL_FROM:'test@doon.local'}]){const adapter=createIeMailAdapter(invalid,dependency);assert.equal(adapter.configured,false);assert.equal((await adapter.send(payload)).status,'failed');}
 assert.equal(calls,0);
 const adapter=createIeMailAdapter(env,dependency);assert.equal((await adapter.send({...payload,attachments:[{...payload.attachments[0],sha256:'0'.repeat(64)}]})).status,'failed');assert.equal(calls,0);
 assert.equal((await adapter.send({...payload,subject:'inject\r\nBcc:x@example.com'})).status,'failed');assert.equal((await adapter.send({...payload,to:['wrong@doon.local']})).status,'failed');assert.equal(calls,0);
 assert.equal((await adapter.send(payload)).status,'sent');assert.equal(calls,1);assert.equal(options.host,'smtp.exmail.qq.com');assert.equal(options.port,465);assert.equal(options.secure,true);assert.equal(options.tls.rejectUnauthorized,true);assert(options.disableFileAccess&&options.disableUrlAccess&&!options.debug&&!options.logger);assert.equal(mail.from,env.DOON_IE_MAIL_FROM);assert.deepEqual(mail.attachments[0].content,Buffer.from(bytes));
 const outcome=async result=>createIeMailAdapter(env,{createTransport:async()=>({sendMail:async()=>result,close(){}})}).send(payload);
 assert.equal((await outcome({accepted:[payload.to[0]],rejected:payload.cc})).status,'unknown');assert.equal((await outcome({accepted:[],rejected:[...payload.to,...payload.cc]})).status,'failed');assert.equal((await outcome({accepted:[],rejected:[]})).status,'unknown');
 for(const [error,status] of [[{code:'EAUTH'},'failed'],[{code:'ECONNECTION',command:'DATA'},'unknown'],[{code:'ETIMEDOUT',command:'DATA'},'unknown']]){const result=await createIeMailAdapter(env,{createTransport:async()=>({sendMail:async()=>{throw {...error,message:'SENSITIVE smtp auth code'};},close(){}})}).send(payload);assert.equal(result.status,status);assert(!JSON.stringify(result).includes('SENSITIVE'));}
 pass('腾讯SMTP默认关闭，限定TLS发送端与本机配置；附表哈希、收件地址与头注入校验，失败/部分接受/结果不明不伪记成功');

 // Real Nodemailer MIME/SMTP path, only a loopback synthetic sink. The injected
 // test factory redirects the fixed production options; app code has no override.
 const nodemailer=createRequire(import.meta.url)('nodemailer'),messages=[],sockets=new Set();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.setEncoding('utf8');socket.write('220 localhost synthetic SMTP\r\n');let buffer='',dataMode=false,data='';socket.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\r\n')){const index=buffer.indexOf('\r\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+2);if(dataMode){if(line==='.'){messages.push(data);data='';dataMode=false;socket.write('250 2.0.0 synthetic accepted\r\n');}else data+=line+'\r\n';continue;}if(/^EHLO|^HELO/.test(line))socket.write('250-localhost\r\n250 SIZE 20000000\r\n');else if(/^MAIL FROM:|^RCPT TO:/.test(line))socket.write('250 2.1.0 OK\r\n');else if(line==='DATA'){dataMode=true;socket.write('354 End with dot\r\n');}else if(line==='QUIT'){socket.end('221 Bye\r\n');}else socket.write('250 OK\r\n');}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const local=createIeMailAdapter(env,{createTransport:async()=>nodemailer.createTransport({host:'127.0.0.1',port:server.address().port,secure:false,ignoreTLS:true,connectionTimeout:3000,socketTimeout:3000,disableFileAccess:true,disableUrlAccess:true})});assert.equal((await local.send(payload)).status,'sent');assert.equal(messages.length,1);assert(/Content-Type:\s*application\/vnd\.openxmlformats-officedocument/i.test(messages[0].replace(/\r\n[ \t]+/g,' ')));assert(messages[0].includes(Buffer.from(bytes).toString('base64')));assert(/Message-ID:\s*<ie-/i.test(messages[0].replace(/\r\n[ \t]+/g,' ')));pass('真实SMTP库对本机模拟收件箱完成MIME发送，携带对应xlsx字节与稳定Message-ID，未连接外部邮箱');}finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]?.endsWith('ie-mail-cases.mjs'))await testIeMail({pass:console.log});
