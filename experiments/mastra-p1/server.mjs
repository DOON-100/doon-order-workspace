import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {assertIsolatedEnvironment} from './sandbox.mjs';
import {visibleSuggestions} from './suggestions.mjs';

const publicFiles=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
]);
export async function startReadonlyServer({adapter,store,identity,projectPolicy}) {
  assertIsolatedEnvironment();
  if(!identity || !['login','resolveSession','logout','close'].every(key=>typeof identity[key]==='function') || !Number.isInteger(identity.sessionTtlMs) || identity.sessionTtlMs<=0)throw new TypeError('必须显式提供可信合成认证');
  let origin,cookieName;
  function send(res,status,value,headers={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",...headers});
    res.end(typeof value==='string'?value:JSON.stringify(value));
  }
  function sessionToken(header) {
    const cookies=String(header||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieName+'='));
    if(cookies.length!==1)throw Object.assign(new Error('请先登录合成账号'),{status:401});
    const token=cookies[0].slice(cookieName.length+1);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Object.assign(new Error('合成会话无效，请重新登录'),{status:401});
    return token;
  }
  function resolveSession(cookieHeader) {
    return identity.resolveSession(sessionToken(cookieHeader));
  }
  async function revokeCookie(cookieHeader) {
    let token;
    try {token=sessionToken(cookieHeader);}catch(error){if(error.status===401)return;throw error;}
    // Missing cookies are harmless. A backend revocation failure must not be
    // reported as a successful logout while the old session may remain valid.
    await identity.logout(token);
  }
  function cookie(token,clear=false) {
    return `${cookieName}=${clear?'':token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:Math.ceil(identity.sessionTtlMs/1000)}`;
  }
  async function readJson(req,{allowEmpty=false}={}) {
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>1024)throw Object.assign(new Error('请求过大'),{status:413});chunks.push(chunk);}
    if(!bytes&&allowEmpty)return {};
    if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')throw Object.assign(new Error('需要 JSON'),{status:415});
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch{throw Object.assign(new Error('JSON 无效'),{status:400});}
  }
  function queryKeys(url,allowed=[]) {
    for(const key of url.searchParams.keys())if(!allowed.includes(key) || url.searchParams.getAll(key).length!==1)throw Object.assign(new Error('查询参数不受支持'),{status:400});
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.headers.host!==new URL(origin).host) return send(res,403,{error:'实验只接受绑定的本机地址'});
      if(req.headers.origin && req.headers.origin!==origin)return send(res,403,{error:'实验拒绝跨站请求'});
      const url=new URL(req.url,origin);
      if(url.pathname==='/api/demo-session')return send(res,404,{error:'公开演示身份入口已关闭'});
      if(url.pathname==='/api/session' && req.method==='POST') {
        queryKeys(url);
        if(req.headers.origin!==origin)return send(res,403,{error:'登录需要当前实验页面来源'});
        const data=await readJson(req), result=await identity.login(data,req.socket.remoteAddress||'unknown-peer');
        try {await revokeCookie(req.headers.cookie);}catch(error){
          // Do not return a fresh token when replacing the previous session fails.
          try {await identity.logout(result.token);}catch{}
          throw error;
        }
        return send(res,200,{synthetic:true},{'Set-Cookie':cookie(result.token)});
      }
      if(url.pathname==='/api/logout' && req.method==='POST') {
        queryKeys(url);
        if(req.headers.origin!==origin)return send(res,403,{error:'退出需要当前实验页面来源'});
        const data=await readJson(req,{allowEmpty:true});
        if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length)return send(res,400,{error:'退出请求不接受额外字段'});
        await revokeCookie(req.headers.cookie);
        return send(res,200,{synthetic:true},{'Set-Cookie':cookie('',true)});
      }
      if(req.method!=='GET')return send(res,405,{error:'仅支持只读查询；本阶段不提供批准、保存或写回'}, {'Allow':'GET'});
      if(publicFiles.has(url.pathname)) {
        queryKeys(url);const [file,type]=publicFiles.get(url.pathname);
        return send(res,200,await readFile(new URL('./public/'+file,import.meta.url),'utf8'),{'Content-Type':type});
      }
      if(url.pathname==='/health'){queryKeys(url);return send(res,200,{ok:true,service:'doon-mastra-p1-synthetic',synthetic:true});}
      if(!url.pathname.startsWith('/api/'))return send(res,404,{error:'页面不存在'});
      const session=await resolveSession(req.headers.cookie),id=session.id;
      if(url.pathname==='/api/me'){queryKeys(url);return send(res,200,{...session,synthetic:true});}
      if(url.pathname==='/api/orders') {
        queryKeys(url,['limit','cursor']);
        return send(res,200,adapter.listOrders(id,{limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):20,cursor:url.searchParams.get('cursor')||''}));
      }
      if(url.pathname.startsWith('/api/orders/')) {
        queryKeys(url);let sourceId;try{sourceId=decodeURIComponent(url.pathname.slice('/api/orders/'.length));}catch{return send(res,400,{error:'来源编号无效'});}
        return send(res,200,adapter.getOrder(id,sourceId));
      }
      if(url.pathname==='/api/suggestions'){queryKeys(url);return send(res,200,{items:visibleSuggestions(adapter,store,id),observedAt:adapter.listOrders(id,{limit:1}).observedAt,synthetic:true});}
      if(projectPolicy) {
        if(url.pathname==='/api/teams'){queryKeys(url);return send(res,200,projectPolicy.listTeams(id));}
        for(const [resource,list,get] of [['customers','listCustomers','getCustomer'],['tasks','listTasks','getTask']]) {
          const route='/api/'+resource;
          if(url.pathname===route) {
            queryKeys(url,['limit','teamId']);
            return send(res,200,projectPolicy[list](id,{limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):20,teamId:url.searchParams.get('teamId')||''}));
          }
          if(url.pathname.startsWith(route+'/')) {
            queryKeys(url);let resourceId;
            try{resourceId=decodeURIComponent(url.pathname.slice(route.length+1));}catch{return send(res,400,{error:'资源编号无效'});}
            return send(res,200,projectPolicy[get](id,resourceId));
          }
        }
      }
      return send(res,404,{error:'接口不存在'});
    } catch(error) {
      const status=[400,401,403,404,409,413,415,429].includes(error.status)?error.status:500;
      send(res,status,{error:status===500?'实验请求未完成':error.message},status===429&&Number.isInteger(error.retryAfterSeconds)?{'Retry-After':String(error.retryAfterSeconds)}:{});
    }
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  if(port===8787){server.close();throw new Error('实验禁止使用8787');}
  origin=`http://127.0.0.1:${port}`;cookieName=`doon_mastra_p1_${port}`;
  let closing;
  return {origin,port,resolveSession,close:()=>closing??=(async()=>{
    await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
    await identity.close();
  })()};
}

export async function syntheticSession(origin,credentials) {
  const url=new URL(origin);
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || url.port==='8787' || url.username || url.password || url.pathname!=='/')throw new Error('仅允许本机隔离实验 API');
  if(!credentials||typeof credentials.username!=='string'||typeof credentials.password!=='string')throw new Error('需要可信端提供的合成账号凭据');
  const response=await fetch(origin+'/api/session',{method:'POST',headers:{'content-type':'application/json',origin:url.origin},body:JSON.stringify({username:credentials.username,password:credentials.password}),redirect:'error'});
  if(!response.ok)throw new Error('合成身份初始化失败');
  const cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw new Error('未取得合成会话');
  return cookie;
}
export async function readOrdersFromApi(origin,cookie) {
  const url=new URL(origin);
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || url.port==='8787' || url.pathname!=='/' || url.username || url.password)throw new Error('工具禁止访问外部或正式服务');
  const response=await fetch(origin+'/api/orders?limit=50',{headers:{cookie},redirect:'error'});
  if(!response.ok)throw new Error(`只读订单接口返回 ${response.status}`);
  const data=await response.json();
  if(data.nextCursor)throw new Error('合成演示超出单页上限，不生成不完整建议');
  return data;
}
