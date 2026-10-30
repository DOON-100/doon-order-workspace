import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

// Only serves synthetic UI fixtures; never imports the business server or database.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'test-output','excel-table-fixture');
const port=Number(process.env.DOON_EXCEL_FIXTURE_PORT||18879);
if(!Number.isInteger(port)||port<1024||port>65535||[8787,8797,18787].includes(port))throw Error('Use an isolated test port.');
await fs.mkdir(output,{recursive:true});
await build({entryPoints:[path.join(root,'tests','excel-table-fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':root},define:{'process.env.NODE_ENV':'"development"'}});
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>测试环境 · Excel 表格筛选</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:#233c35;background:#edf2ef}main{max-width:1140px;margin:24px auto;padding:0 20px}h1{font-size:25px}h2{font-size:18px}section{margin:20px 0;padding:18px;background:white;border:1px solid #ccd8d1;border-radius:7px}.test-banner{padding:12px;background:#fff1c9;border:1px solid #d8b564}.fixture-scroll{overflow:auto}.fixture-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:default}input[type=checkbox]{width:16px;height:16px}button{padding:6px 10px}td input:not([type=checkbox]){max-width:170px;padding:6px;border:1px solid #b9c8be}.business-followup-record-row{color:#697a70;font-size:12px}tfoot{background:#f2f5f3}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
const server=http.createServer(async(req,res)=>{
  if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
  if(!['/fixture.js','/fixture.css'].includes(req.url)){res.writeHead(404);res.end();return;}
  try{const content=await fs.readFile(path.join(output,req.url.slice(1)));res.writeHead(200,{'Content-Type':req.url.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end();}
});
if(!process.argv.includes('--build-only')){
  server.listen(port,'127.0.0.1',()=>console.log(`测试环境，不含正式业务数据：http://127.0.0.1:${port}`));
  process.on('SIGINT',()=>server.close());
  process.on('SIGTERM',()=>server.close());
}
