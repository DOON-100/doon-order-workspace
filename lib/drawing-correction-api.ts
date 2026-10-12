import {z} from 'zod';
import {all,broad,canCorrectDrawing,clean,now,type Member,type Order,type State} from './domain';
import {captureOrderIdentity,matchesOrderIdentity,orderIdentities} from './order-identity';
import {AppError,audit,commit,json} from './store';
import {colLabels} from './ledger';

// Source-field corrections deliberately do not share the department autosave endpoint.
// Keep stable line IDs and original files; reserve previous identities for future imports.
export async function drawingCorrectionPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='drawing-correction')return null;
 if(!broad(m))throw new AppError('仅管理员 / PMC 可更正图纸编号。',403);
 const parsed=z.object({id:z.string().min(1),version:z.number().int().positive(),drawing:z.string(),reason:z.string().trim().min(3).max(1000)}).strict().safeParse(await req.json());
 if(!parsed.success)throw new AppError('请填写新图纸编号和至少 3 个字的修改原因，仅可更正本条明细。');
 const input=parsed.data,o=all(s,'order').find(r=>r.id===input.id) as Order|undefined;
 if(!o||!canCorrectDrawing(m,o))throw new AppError('仅管理员 / PMC 可更正在制原表明细的图纸编号。',403);
 if(o.version!==input.version)throw new AppError('该明细已由其他同事更新，本次未保存。请重新打开详情，核对后再修改。',409);
 const drawing=clean(input.drawing);
 if(!drawing||drawing.length>120||/[\u0000-\u001f\u007f]/.test(input.drawing)||/^[-—]+$/.test(drawing))throw new AppError('图纸编号须为 1 至 120 个字符，不能是空值、占位横线、换行或控制字符。');
 if(drawing===o.drawing)return json({ok:true,unchanged:true,order:o});
 const identity=captureOrderIdentity({...o,drawing});
 if((all(s,'order') as Order[]).some(other=>other.id!==o.id&&matchesOrderIdentity(other,identity)))throw new AppError('此订单、图纸、色号、镜片及批次已对应其他明细（含历史图号），请核对，不能合并或覆盖。',409);
 const next:Order={...o,drawing,identityHistory:orderIdentities(o),ledger:{...o.ledger!,columns:{...o.ledger!.columns,J:drawing}},extra:{...o.extra,['J · '+colLabels.J]:drawing},version:o.version+1,updatedAt:now(),updatedBy:m.name};
 await commit(s.revision,[next,audit(m,next,o,'更正图纸编号',input.reason)]);
 return json({ok:true,order:next});
}
