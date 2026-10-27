import {z} from 'zod';
import {all,newId,now,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {canConfigureIeQuotes,canUseIeQuotes} from './ie-quote-access';
import {ieMaterialNameCatalog,latestIeMaterialNameCatalog,searchIeMaterialNames,type IeMaterialNameCatalogRecord} from './ie-material-names';

export function ieMaterialNamesGet(action:string,url:URL,s:State,m:Member):Response|null{
 if(action!=='ie-material-names')return null;
 if(!canUseIeQuotes(s,m))throw new AppError('没有 IE 工程报价权限。',403);
 const catalog=latestIeMaterialNameCatalog(s),query=url.searchParams.get('q')||'';if(query.length>100)throw new AppError('查询名称不能超过100字。');
 return json({...searchIeMaterialNames(catalog,query,2000),catalogId:catalog?.id||'',version:catalog?.version||0,sourceFilename:catalog?.catalog.sourceFilename||'',sourceSha256:catalog?.catalog.sourceSha256||''});
}
const inputSchema=z.object({version:z.number().int().nonnegative(),token:z.string().uuid(),catalog:ieMaterialNameCatalog}).strict();
export async function ieMaterialNamesPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='ie-material-names-import')return null;
 if(!canConfigureIeQuotes(m))throw new AppError('仅管理员可导入材料名称参考资料。',403);
 const raw=await req.text();if(raw.length>2000000)throw new AppError('材料名称参考资料过大。');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new AppError('参考资料不是有效 JSON。');}
 const result=inputSchema.safeParse(parsed);if(!result.success)throw new AppError('请提供完整的资料版本、来源文件摘要、名称与原始行号；编号必须唯一。');
 const input=result.data;
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const requestId='ie_material_name_request_'+input.token,prior=all(s,'ie_material_name_request').find(r=>r.id===requestId);
 if(prior){if(prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('请求标识已用于其他内容或人员。',409);return json({...prior.result,idempotent:true});}
 const before=latestIeMaterialNameCatalog(s);if((before?.version||0)!==input.version)throw new AppError('名称资料已更新，请刷新后重新导入。',409);
 const item:IeMaterialNameCatalogRecord={id:newId('ie_material_name_catalog'),kind:'ie_material_name_catalog',version:input.version+1,previousId:before?.id||'',catalog:input.catalog,createdAt:now(),createdById:m.id};
 const response={ok:true,id:item.id,version:item.version,count:item.catalog.entries.length};
 await commit(s.revision,[item,audit(m,item,null,'导入 IE 材料名称参考','独立名称资料；不修改旧颜色字典、报价或基价'),{id:requestId,kind:'ie_material_name_request',actorId:m.id,fingerprint,result:response,createdAt:now()}]);
 return json(response);
}
