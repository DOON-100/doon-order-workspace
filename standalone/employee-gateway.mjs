import {isIP} from 'node:net';
import {loopbackIP} from './supplier-gateway.mjs';

function fail(message,status=403){throw Object.assign(new Error(message),{status});}
export function employeeGatewayConfig(env=process.env){
 const raw=String(env.DOON_EMPLOYEE_PUBLIC_ORIGIN||'').trim();if(!raw)return null;
 let url;try{url=new URL(raw);}catch{fail('员工入口需要有效的 HTTPS DOON_EMPLOYEE_PUBLIC_ORIGIN。',500);}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||![url.origin,url.origin+'/'].includes(raw))fail('员工公开地址必须是独立 HTTPS Origin，不得包含路径或凭据。',500);
 if(env.DOON_SERVER_MODE==='supplier'||env.DOON_TLS_CERT||env.DOON_TLS_KEY)fail('员工代理入口不能与供应商模式或后台 TLS 混用。',500);
 const host=env.DOON_HOST||'127.0.0.1',port=Number(env.DOON_PORT||8787);
 if(!['127.0.0.1','::1','localhost'].includes(host))fail('员工代理入口只允许监听 loopback。',500);
 if(!Number.isInteger(port)||port<1||port>65535)fail('员工入口端口无效。',500);
 return {origin:url.origin,publicHost:url.host.toLowerCase(),host,port};
}
export function employeeEndpoint(config,remoteAddress,headers){
 if(!loopbackIP(remoteAddress))fail('员工入口只接受本机反向代理。');
 if(String(headers.host||'').toLowerCase()!==config.publicHost||String(headers['x-forwarded-host']||'').toLowerCase()!==config.publicHost)fail('员工入口访问地址未获授权。');
 if(headers['x-forwarded-proto']!=='https'||headers.forwarded!==undefined)fail('员工入口需要受信任的 HTTPS 反向代理。');
 const ip=String(headers['x-forwarded-for']||'').trim();if(!isIP(ip))fail('反向代理客户端地址无效。');
 return {origin:config.origin,ip};
}
