import {z} from 'zod';
import {all,now,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';

export const businessServiceConfigId='handoff_business_service_config';
const path=z.string().trim().max(3000).refine(v=>!v||/^(?:[A-Za-z]:[\\/]|\\\\|\/|smb:\/\/)/i.test(v),'请登记完整的本地、共享盘或 SMB 路径');
const schema=z.object({token:z.string().uuid(),expectedVersion:z.number().int().min(0),drawingRoot:path,quoteRoot:path,leadDays:z.number().int().min(1).max(90)}).strict();
export function businessServiceConfig(s:State){const r=all(s,'handoff_business_settings').find(r=>r.id===businessServiceConfigId);return {version:r?.version||0,drawingRoot:r?.drawingRoot||'',quoteRoot:r?.quoteRoot||'',leadDays:r?.leadDays||7,configured:!!r};}
export async function businessSettingsPost(action:string,req:Request,s:State,m:Member){
 if(action!=='handoff-business-service-config')return null;if(!m.active||m.role!=='admin')throw new AppError('仅管理员可维护工程资料路径与提醒设置',403);
 const p=schema.safeParse(await req.json());if(!p.success)throw new AppError(p.error.issues[0].message);const input=p.data,requestId='handoff_business_request_'+input.token,fingerprint=JSON.stringify({action,input}),prior=s.records.find(r=>r.id===requestId);
 if(prior){if(prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('请求编号冲突',409);return json({ok:true,idempotent:true,serviceConfig:businessServiceConfig(s)});}
 const before=all(s,'handoff_business_settings').find(r=>r.id===businessServiceConfigId);if((before?.version||0)!==input.expectedVersion)throw new AppError('配置已被其他人更新，请重新读取',409);
 const item={id:businessServiceConfigId,kind:'handoff_business_settings',version:(before?.version||0)+1,drawingRoot:input.drawingRoot,quoteRoot:input.quoteRoot,leadDays:input.leadDays,updatedAt:now(),updatedBy:m.name};
 await commit(s.revision,[item,audit(m,item,before||null,'保存工程路径与提前提醒设置'),{id:requestId,kind:'handoff_business_request',actorId:m.id,fingerprint,action}]);return json({ok:true,serviceConfig:{...item,configured:true}});
}
