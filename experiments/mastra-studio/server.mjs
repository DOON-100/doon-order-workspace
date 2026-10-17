import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Hono} from 'hono';
import {MastraServer} from '@mastra/hono';
import {createAgents} from './agents.mjs';

const studioRoot=path.join(path.dirname(fileURLToPath(import.meta.resolve('mastra/package.json'))),'dist','studio');
const csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
export async function createStudio({dataDir}){
 await fs.mkdir(dataDir,{recursive:true});
 const lab=createAgents(dataDir),app=new Hono();
 const server=new MastraServer({app,mastra:lab.mastra,tools:lab.tools,prefix:'/studio/api'});
 await server.init();
 return{
  ...lab,
  async handle(request){
   const url=new URL(request.url);
   if(url.pathname==='/studio')return new Response(null,{status:302,headers:{Location:'/studio/'}});
   if(url.pathname==='/studio/api'||url.pathname.startsWith('/studio/api/'))return app.fetch(request);
   // Static, packaged upstream Studio. No dev hot-reload service is needed.
   if(url.pathname==='/studio/refresh-events')return new Response(null,{status:204});
   let relative;
   try{relative=decodeURIComponent(url.pathname.slice('/studio/'.length));}catch{return new Response('Not found',{status:404});}
   if(relative.includes('\\')||relative.split('/').some(part=>part.startsWith('.')))return new Response('Not found',{status:404});
   if(!relative||!path.extname(relative))relative='index.html';
   const target=path.resolve(studioRoot,relative);
   if(!target.startsWith(studioRoot+path.sep))return new Response('Not found',{status:404});
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'}[path.extname(relative)];
   if(!type)return new Response('Not found',{status:404});
   let bytes;
   try{bytes=await fs.readFile(target);}catch(error){if(error.code==='ENOENT')return new Response('Not found',{status:404});throw error;}
   if(relative==='index.html'){
    const values={MASTRA_STUDIO_BASE_PATH:'/studio',MASTRA_API_PREFIX:'/studio/api',MASTRA_SERVER_HOST:url.hostname,MASTRA_SERVER_PORT:url.port,MASTRA_SERVER_PROTOCOL:url.protocol.slice(0,-1),MASTRA_TELEMETRY_DISABLED:'true',MASTRA_HIDE_CLOUD_CTA:'true',MASTRA_EXPERIMENTAL_FEATURES:'false',MASTRA_TEMPLATES:'false',MASTRA_EXPERIMENTAL_UI:'false',MASTRA_THEME_TOGGLE:'true'};
    const html=bytes.toString().replace(/%%(\w+)%%/g,(_,key)=>values[key]||'');
    bytes=Buffer.from(html.replace('<div id="root"></div>','<div style="height:36px;display:flex;align-items:center;gap:20px;padding:0 16px;background:#123b31;color:white;font:13px sans-serif"><a href="/personal-tasks" style="color:white">← 返回数据台</a><span>本地 Studio · 离线合成演练 · 不连接正式业务</span></div><div id="root" style="height:calc(100dvh - 36px)"></div>'));
   }
   return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':type,'Content-Security-Policy':csp}});
  },
 };
}
