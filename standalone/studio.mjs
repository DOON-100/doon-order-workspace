import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const isStudioPath=pathname=>pathname==='/studio'||pathname.startsWith('/studio/');
export const canUseStudio=current=>!!current&&!current.account.must_change&&current.member.active&&['admin','programmer'].includes(current.member.role);

// Opt-in local experiment. Validate before importing runtime / opening any database.
export async function studioConfig({host,port,supplierOnly,reviewMode,employeeGateway}){
 if(process.env.DOON_STUDIO_ENABLED!=='1')return null;
 if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1024||port>65535||port===8787||supplierOnly||reviewMode||employeeGateway||process.env.DOON_SYNTHETIC_ONLY!=='1')throw new Error('Studio 测试必须使用 127.0.0.1、独立端口和合成数据模式。');
 const dataDir=path.resolve(process.env.DOON_DATA_DIR||'');
 const marker=JSON.parse(await fs.readFile(path.join(dataDir,'studio-sandbox.json'),'utf8'));
 if(marker.kind!=='doon-synthetic-studio-v1')throw new Error('Studio 只能使用专用合成数据目录。');
 const directory=path.resolve(process.env.DOON_STUDIO_DIR||'');
 const pkg=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
 if(pkg.name!=='doon-mastra-studio-local')throw new Error('Studio 模块目录无效。');
 return {directory,dataDir:path.join(dataDir,'studio')};
}

export function createStudioGateway(config){
 let instance;
 const runtime=()=>{
  if(!instance){
   instance=(async()=>{
    let businessFacts;
    if(process.env.DOON_STUDIO_DATA_MODE==='real-snapshot'){
     const {loadBusinessFacts}=await import(pathToFileURL(path.join(config.directory,'business-facts.mjs')).href);
     if(!process.env.DOON_STUDIO_SNAPSHOT_DIR||!process.env.DOON_STUDIO_MEMBER_ID)throw new Error('真实快照需要显式快照目录和已授权成员');
     businessFacts=await loadBusinessFacts({snapshotDir:process.env.DOON_STUDIO_SNAPSHOT_DIR,memberId:process.env.DOON_STUDIO_MEMBER_ID});
    }else if(process.env.DOON_STUDIO_DATA_MODE&&process.env.DOON_STUDIO_DATA_MODE!=='synthetic')throw new Error('未知 Studio 数据模式');
    const module=await import(pathToFileURL(path.join(config.directory,'server.mjs')).href);
    return module.createStudio({dataDir:businessFacts?path.join(config.dataDir,'real-snapshot',businessFacts.coverage().snapshotId,process.env.DOON_STUDIO_MEMBER_ID.replace(/[^a-zA-Z0-9_-]/g,'_')):config.dataDir,businessFacts});
   })();instance.catch(()=>{instance=undefined;});
  }
  return instance;
 };
 return {
  async handle(request,current,workflowAccess){
   if(!config)return Response.json({error:'本实例未启用 Agent Studio。'},{status:404});
   const url=new URL(request.url);
   if(!current){
    if(request.method==='GET'&&['/studio','/studio/'].includes(url.pathname))return new Response(null,{status:302,headers:{Location:'/login'}});
    return Response.json({error:'请先登录数据台。'},{status:401});
   }
   if(!canUseStudio(current))return Response.json({error:'Studio 测试需要已完成改密的管理员或程序员账号。'},{status:403});
   if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==url.origin)return Response.json({error:'不允许跨站提交。'},{status:403});
   const actorId=current.member.userId||current.member.id;
   return (await runtime()).handle(request,{actor:actorId?{id:String(actorId),name:current.member.name,role:current.member.role}:undefined,workflowAccess});
  },
  async processTriggers(accessForOwner){return config?(await runtime()).workflowManager?.processTriggers(accessForOwner):[];},
  async close(){if(instance)await (await instance).close();},
 };
}
