import {isIP} from 'node:net';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

function fail(message,status=403){throw Object.assign(new Error(message),{status});}
export function loopbackIP(value){const ip=String(value||'').replace(/^::ffff:/,'');return ip==='::1'||/^127\.\d+\.\d+\.\d+$/.test(ip);}
export function supplierGatewayConfig(env=process.env){
 const raw=String(env.DOON_SUPPLIER_PUBLIC_ORIGIN||'').trim();let url;try{url=new URL(raw);}catch{fail('供应商入口需要配置 HTTPS DOON_SUPPLIER_PUBLIC_ORIGIN。',500);}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||![url.origin,url.origin+'/'].includes(raw))fail('供应商公开地址必须是独立 HTTPS Origin，不得包含路径或凭据。',500);
 const host=env.DOON_HOST||'127.0.0.1';if(!['127.0.0.1','::1','localhost'].includes(host))fail('供应商网关只允许监听 loopback。',500);
 const port=Number(env.DOON_PORT||8788);if(!Number.isInteger(port)||port<1||port>65535)fail('供应商入口端口无效。',500);
 return {origin:url.origin,publicHost:url.host.toLowerCase(),host,port};
}
// Only an explicitly configured local HTTPS reverse proxy can reach this listener.
// The proxy must preserve Host and overwrite X-Forwarded-Proto/Host/For.
export function supplierEndpoint(config,remoteAddress,headers){
 if(!loopbackIP(remoteAddress))fail('供应商网关只接受本机反向代理。');
 const host=String(headers.host||'').toLowerCase(),forwardedHost=headers['x-forwarded-host'];
 if(host!==config.publicHost||(forwardedHost!==undefined&&String(forwardedHost).toLowerCase()!==config.publicHost))fail('供应商入口访问地址未获授权。');
 if(headers['x-forwarded-proto']!=='https'||headers.forwarded!==undefined)fail('供应商入口需要受信任的 HTTPS 反向代理。');
 const forwardedIP=String(headers['x-forwarded-for']||'').trim();if(forwardedIP&&!isIP(forwardedIP))fail('反向代理客户端地址无效。');
 return {origin:config.origin,ip:forwardedIP||String(remoteAddress)};
}

// Optional entry point. The deployed server imports the helpers without starting a listener.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.env.DOON_SERVER_MODE='supplier';process.env.DOON_HOST='127.0.0.1';process.env.DOON_PORT||='8788';process.env.DOON_NO_AUTO_BACKUP='1';
 supplierGatewayConfig();
 await import(pathToFileURL(path.resolve(process.argv[2]||'lan-dist/server.mjs')).href);
}
