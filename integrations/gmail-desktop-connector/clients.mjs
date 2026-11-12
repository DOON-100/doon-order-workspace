import https from 'node:https';
import {timingSafeEqual} from 'node:crypto';

export class Gmail{
 constructor(auth){this.auth=auth;}
 async request(endpoint,method='GET',data){
  const r=await this.auth.request({url:'https://gmail.googleapis.com/gmail/v1/users/me/'+endpoint,method,data,timeout:30000,retry:false});return r.data;
 }
 profile(){return this.request('profile');}
 list(query,pageToken){return this.request('messages?'+new URLSearchParams({q:query,maxResults:'100',...(pageToken?{pageToken}:{})}));}
 get(id,raw=true){return this.request(`messages/${encodeURIComponent(id)}?format=${raw?'raw':'minimal'}`);}
 history(startHistoryId,pageToken){return this.request('history?'+new URLSearchParams({startHistoryId,maxResults:'100',...(pageToken?{pageToken}:{})}));}
 modify(id,addLabelIds,removeLabelIds){return this.request('messages/'+encodeURIComponent(id)+'/modify','POST',{addLabelIds,removeLabelIds});}
 send(raw,threadId){return this.request('messages/send','POST',{raw,...(threadId?{threadId}:{})});}
 searchSent(messageId){return this.request('messages?'+new URLSearchParams({q:'in:sent rfc822msgid:'+messageId.replace(/[<>]/g,''),maxResults:'10'}));}
}
export class Bridge{
 constructor(config){
  this.config=config;const url=new URL(config.origin);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(config.fingerprint||''))throw Error('服务器 HTTPS 配置或证书指纹无效。');
 }
 async request(endpoint,body){
  if(!/^[a-z-]+$/.test(endpoint))throw Error('Invalid connector endpoint');
  const url=new URL('/chatwoot/gmail-bridge/v1/'+endpoint,this.config.origin),payload=body===undefined?null:JSON.stringify(body);
  return new Promise((resolve,reject)=>{
   const req=https.request(url,{agent:false,method:payload?'POST':'GET',rejectUnauthorized:false,headers:{Authorization:'Bearer '+this.config.token,...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})},timeout:60000},res=>{
    let size=0,chunks=[];res.on('data',b=>{size+=b.length;if(size>60*1024*1024){req.destroy();return;}chunks.push(b);});
    res.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks));if(res.statusCode<200||res.statusCode>=300){const e=Error('Chatwoot 接口暂时不可用（'+res.statusCode+'）。');e.status=res.statusCode;return reject(e);}resolve(data);}catch{reject(Error('Chatwoot 响应无效。'));}});res.on('error',reject);
   });
   // Pin the exact certificate before writing ANY credentials or content.
   req.on('socket',socket=>socket.once('secureConnect',()=>{
    const expected=Buffer.from(this.config.fingerprint.toUpperCase()),actual=Buffer.from(socket.getPeerCertificate().fingerprint256||'');
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){req.destroy(Error('服务器证书发生变化，请重新核对证书指纹。'));return;}
    req.end(payload);
   }));
   req.on('timeout',()=>req.destroy(Error('Chatwoot 连接超时。')));req.on('error',reject);
  });
 }
}
