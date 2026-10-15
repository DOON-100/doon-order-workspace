import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertIsolatedEnvironment} from './sandbox.mjs';
import {visibleSuggestions} from './suggestions.mjs';

const publicFiles=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
]);
const identities=new Set(['syn-employee-a','syn-employee-b']);
export async function startReadonlyServer({adapter,store}) {
  assertIsolatedEnvironment();
  const sessions=new Map();
  let origin,cookieName;
  function send(res,status,value,headers={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",...headers});
    res.end(typeof value==='string'?value:JSON.stringify(value));
  }
  function actorId(req) {
    const cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='));
    const session=sessions.get(cookie?.slice(cookieName.length+1));
    if(!session || session.expires<Date.now())throw Object.assign(new Error('请先选择合成员工并登录演示'),{status:401});
    adapter.actor(session.id);
    return session.id;
  }
  function queryKeys(url,allowed=[]) {
    for(const key of url.searchParams.keys())if(!allowed.includes(key) || url.searchParams.getAll(key).length!==1)throw Object.assign(new Error('查询参数不受支持'),{status:400});
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.headers.host!==new URL(origin).host) return send(res,403,{error:'实验只接受绑定的本机地址'});
      if(req.headers.origin && req.headers.origin!==origin)return send(res,403,{error:'实验拒绝跨站请求'});
      const url=new URL(req.url,origin);
      if(url.pathname==='/api/demo-session' && req.method==='POST') {
        queryKeys(url);
        if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'需要 JSON'});
        let bytes=0,raw='';
        for await(const chunk of req){bytes+=chunk.length;if(bytes>1024)return send(res,413,{error:'请求过大'});raw+=chunk.toString();}
        let data;try{data=JSON.parse(raw);}catch{return send(res,400,{error:'JSON 无效'});}
        if(!data || Object.keys(data).length!==1 || !identities.has(data.employeeId))return send(res,400,{error:'仅允许内置合成员工'});
        adapter.actor(data.employeeId);
        // This openly selectable identity mechanism is intentionally fixture-only, never production auth.
        if(sessions.size>=64)sessions.delete(sessions.keys().next().value);
        const token=randomBytes(32).toString('hex');sessions.set(token,{id:data.employeeId,expires:Date.now()+2*3600_000});
        return send(res,200,{synthetic:true},{'Set-Cookie':`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`});
      }
      if(req.method!=='GET')return send(res,405,{error:'仅支持只读查询；本阶段不提供批准、保存或写回'}, {'Allow':'GET'});
      if(publicFiles.has(url.pathname)) {
        queryKeys(url);const [file,type]=publicFiles.get(url.pathname);
        return send(res,200,await readFile(new URL('./public/'+file,import.meta.url),'utf8'),{'Content-Type':type});
      }
      if(url.pathname==='/health'){queryKeys(url);return send(res,200,{ok:true,service:'doon-mastra-p1-synthetic',synthetic:true});}
      if(!url.pathname.startsWith('/api/'))return send(res,404,{error:'页面不存在'});
      const id=actorId(req);
      if(url.pathname==='/api/me'){queryKeys(url);return send(res,200,{...adapter.actor(id),synthetic:true});}
      if(url.pathname==='/api/orders') {
        queryKeys(url,['limit','cursor']);
        return send(res,200,adapter.listOrders(id,{limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):20,cursor:url.searchParams.get('cursor')||''}));
      }
      if(url.pathname.startsWith('/api/orders/')) {
        queryKeys(url);let sourceId;try{sourceId=decodeURIComponent(url.pathname.slice('/api/orders/'.length));}catch{return send(res,400,{error:'来源编号无效'});}
        return send(res,200,adapter.getOrder(id,sourceId));
      }
      if(url.pathname==='/api/suggestions'){queryKeys(url);return send(res,200,{items:visibleSuggestions(adapter,store,id),observedAt:adapter.listOrders(id,{limit:1}).observedAt,synthetic:true});}
      return send(res,404,{error:'接口不存在'});
    } catch(error) {
      const status=[400,401,403,404,409].includes(error.status)?error.status:500;
      send(res,status,{error:status===500?'实验请求未完成':error.message});
    }
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  if(port===8787){server.close();throw new Error('实验禁止使用8787');}
  origin=`http://127.0.0.1:${port}`;cookieName=`doon_mastra_p1_${port}`;
  return {origin,port,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}

export async function syntheticSession(origin,employeeId) {
  const url=new URL(origin);
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || url.port==='8787' || url.username || url.password || url.pathname!=='/')throw new Error('仅允许本机隔离实验 API');
  const response=await fetch(origin+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employeeId}),redirect:'error'});
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
