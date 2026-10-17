import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';

export function parsePublicOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||![url.origin,url.origin+'/'].includes(value))throw new Error('A canonical HTTPS public origin is required');
 return url;
}
export function sessionCookie(value=''){
 if(value.length>8192)return '';
 return value.split(';').map(item=>item.trim()).filter(item=>/^(doon_employee_session|doon_session)=[\w-]{43}$/.test(item)).join('; ');
}
// The platform remains authoritative for active membership, role and session expiry.
export function createSessionChecker({publicOrigin,connectHost='host.docker.internal'}={}){
 const origin=parsePublicOrigin(publicOrigin);
 if(!['host.docker.internal','127.0.0.1','localhost'].includes(connectHost))throw new Error('Invalid platform connection host');
 return cookie=>new Promise((resolve,reject)=>{
  const filtered=sessionCookie(cookie);if(!filtered)return resolve(null);
  const request=https.request({hostname:connectHost,port:Number(origin.port||443),path:'/api/auth/session',method:'GET',servername:isIP(origin.hostname)?'':origin.hostname,
   // Connect to the Docker host while validating the certificate for the public origin.
   rejectUnauthorized:true,checkServerIdentity:(_,cert)=>tls.checkServerIdentity(origin.hostname,cert),
   headers:{Host:origin.host,Cookie:filtered,Accept:'application/json'},timeout:4000},response=>{
    let size=0,text='';response.on('data',chunk=>{size+=chunk.length;if(size>32768){response.destroy();return reject(new Error('Invalid authentication response'));}text+=chunk;});
    response.on('end',()=>{try{if(response.statusCode!==200)throw new Error('Authentication unavailable');const data=JSON.parse(text);resolve(data.user||null);}catch{reject(new Error('Authentication unavailable'));}});
    response.on('error',()=>reject(new Error('Authentication unavailable')));
   });
  request.on('timeout',()=>request.destroy());request.on('error',()=>reject(new Error('Authentication unavailable')));request.end();
 });
}
export const canEnterStudio=user=>!!user&&typeof user.username==='string'&&user.active!==false&&user.mustChange===false&&['admin','programmer'].includes(user.role);
