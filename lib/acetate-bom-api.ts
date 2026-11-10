import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {canFillIeQuote,canReadIeQuote,canUseIeQuotes} from './ie-quote-access';
import {ACETATE_RULE_VERSION,acetateBomFields,acetateStockSchema,calculateAcetateBom} from './acetate-bom';

const saveSchema=z.object({id:z.string().max(160).optional(),version:z.number().int().nonnegative(),token:z.string().uuid(),fields:acetateBomFields}).strict();
const catalogSchema=z.object({version:z.number().int().nonnegative(),token:z.string().uuid(),sourceFilename:z.string().min(1).max(160),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),stocks:z.array(acetateStockSchema).min(1).max(500)}).strict();
function catalog(s:State){return all(s,'acetate_bom_catalog').sort((a,b)=>b.version-a.version)[0]||null;}
const readable=(s:State,m:Member,r:Entity)=>canReadIeQuote(s,m,r.fields);
export function acetateBomGet(action:string,url:URL,s:State,m:Member):Response|null{
 if(action!=='acetate-boms')return null;
 if(!canUseIeQuotes(s,m))throw new AppError('没有板材算料查看权限。',403);
 const stock=catalog(s),id=url.searchParams.get('id');
 if(id){const record=all(s,'acetate_bom').find(r=>r.id===id);if(!record||!readable(s,m,record))throw new AppError('BOM不存在或无权查看。',403);return json({record,history:all(s,'acetate_bom_version').filter(r=>r.bomId===id),canEdit:canFillIeQuote(s,m)});}
 return json({ruleVersion:ACETATE_RULE_VERSION,canEdit:canFillIeQuote(s,m),canImport:m.active&&m.role==='admin',catalog:stock?{id:stock.id,version:stock.version,stocks:stock.stocks,sourceFilename:stock.sourceFilename}:null,records:all(s,'acetate_bom').filter(r=>readable(s,m,r)).map(r=>({id:r.id,version:r.version,model:r.fields.model,drawingRevision:r.fields.drawingRevision,customerAccountId:r.fields.customerAccountId,updatedAt:r.updatedAt,issueCount:r.result.issues.length}))});
}
export async function acetateBomPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['acetate-bom-save','acetate-bom-catalog-import'].includes(action))return null;
 if(!m.active||!canUseIeQuotes(s,m))throw new AppError('没有板材算料权限。',403);
 const catalogImport=action==='acetate-bom-catalog-import';
 if(catalogImport?m.role!=='admin':!canFillIeQuote(s,m))throw new AppError('没有维护板材BOM的权限。',403);
 const raw=await req.text();if(raw.length>1000000)throw new AppError('BOM请求过大。');let value:unknown;try{value=JSON.parse(raw);}catch{throw new AppError('请求格式无效。');}
 const parsed=catalogImport?catalogSchema.safeParse(value):saveSchema.safeParse(value);if(!parsed.success)throw new AppError('请核对完整字段、数字范围、组件编号和版本。');
 const input=parsed.data,fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({action,input}))))).map(v=>v.toString(16).padStart(2,'0')).join('');
 if('fields'in input&&!canReadIeQuote(s,m,input.fields))throw new AppError('没有该客户的算料权限。',403);
 const requestId='acetate_bom_request_'+input.token,prior=all(s,'acetate_bom_request').find(r=>r.id===requestId);
 if(prior){if(prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('请求编号已用于其他内容或人员。',409);return json({...prior.result,idempotent:true});}
 let record:Entity,before:Entity|null=null,versionRecord:Entity|null=null;
 if('stocks'in input){before=catalog(s);if((before?.version||0)!==input.version)throw new AppError('规格库版本已更新。',409);if(new Set(input.stocks.map(v=>v.id)).size!==input.stocks.length)throw new AppError('规格编号重复。');record={...input,id:newId('acetate_catalog'),kind:'acetate_bom_catalog',version:input.version+1,createdAt:now(),createdById:m.id};delete record.token;}
 else{before=input.id?all(s,'acetate_bom').find(r=>r.id===input.id)||null:null;if(input.id&&(!before||!readable(s,m,before)))throw new AppError('BOM不存在或无权修改。',403);if((before?.version||0)!==input.version)throw new AppError('BOM已被修改，请重新读取并核对。',409);if(before&&before.fields.customerAccountId!==input.fields.customerAccountId)throw new AppError('已保存BOM不能更换客户，请新建。');
  record={id:before?.id||newId('acetate_bom'),kind:'acetate_bom',version:input.version+1,fields:input.fields,result:calculateAcetateBom(input.fields),ruleVersion:ACETATE_RULE_VERSION,createdAt:before?.createdAt||now(),createdById:before?.createdById||m.id,updatedAt:now(),updatedById:m.id};
  versionRecord={...record,id:newId('acetate_version'),kind:'acetate_bom_version',bomId:record.id};
 }
 const result={ok:true,id:record.id,version:record.version};
 await commit(s.revision,[record,...(versionRecord?[versionRecord]:[]),audit(m,record,before,catalogImport?'导入板材规格库':'保存整副板材BOM','独立算料记录，不改旧报价、订单或ERP'),{id:requestId,kind:'acetate_bom_request',actorId:m.id,fingerprint,result,createdAt:now()}]);return json(result);
}
