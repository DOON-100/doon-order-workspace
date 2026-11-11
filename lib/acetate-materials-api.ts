import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {canSeeSupplierPrice} from './suppliers';
import {acetateMaterialSchema,acetateMaterialReferenceSchema,acetateThicknesses,canReadAcetateMaterials,type AcetateMaterial,type AcetateMaterialSnapshot} from './acetate-materials';

const sha=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
const digest=(s:string)=>sha(new TextEncoder().encode(s));
const catalogs=(s:State)=>all(s,'acetate_material_catalog').sort((a,b)=>b.version-a.version);
const cache=new Map<string,Promise<AcetateMaterial[]>>();
function access(m:Member){if(!canReadAcetateMaterials(m))throw new AppError('仅获授权的内部成员可查看板料资料。',403);}
async function rows(c:Entity):Promise<AcetateMaterial[]>{
 if(!cache.has(c.id)){if(cache.size>=3)cache.delete(cache.keys().next().value!);cache.set(c.id,Promise.all(c.batches.map(async(b:{key:string})=>{const o=await bucket().get(b.key);if(!o)throw new AppError('板料资料暂未读取完整。',503);return await o.json() as AcetateMaterial[];})).then(v=>v.flat()).catch(e=>{cache.delete(c.id);throw e;}));}return cache.get(c.id)!;
}
export async function resolveAcetateMaterial(s:State,m:Member,value:unknown):Promise<AcetateMaterialSnapshot>{
 access(m);const ref=acetateMaterialReferenceSchema.parse(value),c=catalogs(s).find(v=>v.id===ref.catalogId);if(!c)throw new AppError('采用的板料资料版本不存在。',409);
 const r=(await rows(c)).find(v=>v.id===ref.entryId);if(!r)throw new AppError('板料编号不在采用的资料版本内。',409);
 if(!r.code||r.entryType!=='product')throw new AppError('系列报价或规格参考不能当作具体板料编号，请选具体色号。');
 if(/停产|廃番|廃盤|已停用/.test(r.status))throw new AppError('该板料已标记停用，请先核对替代料。');
 const options=acetateThicknesses(r.standardThickness||r.thickness);if(ref.thickness!==null&&options.length&&!options.includes(ref.thickness))throw new AppError('所选厚度与该板料资料不符。');
 return {...r,sourceDescriptionZh:r.descriptionZh,descriptionZh:ref.descriptionZh?.trim()||r.descriptionZh,selectedPart:ref.part||'其他',catalogId:c.id,catalogVersion:c.version,selectedThickness:ref.thickness,selectedAt:now()};
}
export async function acetateMaterialsGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['acetate-materials','acetate-material-image','acetate-material-original'].includes(action))return null;access(m);const u=new URL(req.url),c=u.searchParams.get('catalogId')?catalogs(s).find(c=>c.id===u.searchParams.get('catalogId')):catalogs(s)[0];
 if(!c)return action==='acetate-materials'?json({catalog:null,rows:[],total:0,canImport:m.role==='admin',canReadOriginal:canSeeSupplierPrice(m)}):json({error:'资料不存在'},404);
 if(action==='acetate-material-original'){
  if(!canSeeSupplierPrice(m))throw new AppError('原工作簿包含报价，仅对现有成本权限开放。',403);const o=await bucket().get(c.originalKey);if(!o)throw new AppError('原件未归档。',404);
  return new Response(o.body,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(c.sourceFilename)}`,'Cache-Control':'no-store'}});
 }
 const list=await rows(c);
 if(action==='acetate-material-image'){const r=list.find(v=>v.id===u.searchParams.get('entryId'));if(!r?.imageKey)throw new AppError('该色号没有已归档图片。',404);const o=await bucket().get(r.imageKey);if(!o)throw new AppError('图片暂不可读。',404);return new Response(o.body,{headers:{'Content-Type':r.imageKey.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 // Complete authorized dataset precedes the browser's field filters and pagination.
 const q=(u.searchParams.get('q')||'').trim().toLocaleLowerCase(),matches=q?list.filter(r=>[r.supplier,r.code,r.descriptionZh,r.descriptionOriginal,r.material,r.size,r.thickness].some(v=>v.toLocaleLowerCase().includes(q))):list;
 const limit=u.searchParams.has('limit')?Math.max(1,Math.min(100,Number(u.searchParams.get('limit'))||100)):null;
 return json({catalog:{id:c.id,version:c.version,sourceFilename:c.sourceFilename,sourceSha256:c.sourceSha256,count:c.count},rows:limit?matches.slice(0,limit):matches,total:matches.length,canImport:m.role==='admin',canReadOriginal:canSeeSupplierPrice(m)});
}
export async function acetateMaterialsPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['acetate-material-import','acetate-material-original-upload'].includes(action))return null;access(m);if(m.role!=='admin')throw new AppError('板料资料导入仅管理员可执行。',403);
 if(action==='acetate-material-original-upload'){
  const form=await req.formData(),file=form.get('file'),hash=String(form.get('sourceSha256')||'');if(!(file instanceof File)||file.size>20*1024*1024||!/^[a-f0-9]{64}$/.test(hash)||!file.name.endsWith('.xlsx'))throw new AppError('请提供20MB以内的Excel原件和摘要。');
  const bytes=await file.arrayBuffer();if(await sha(bytes)!==hash)throw new AppError('原件摘要不一致。');await bucket().put('acetate-original-'+hash,bytes);return json({ok:true});
 }
 const raw=await req.text();if(raw.length>8*1024*1024)throw new AppError('每批最多8MB。');
 const schema=z.object({sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceFilename:z.string().min(1).max(160),batch:z.number().int().min(0).max(1000),totalBatches:z.number().int().min(1).max(1001),rows:z.array(acetateMaterialSchema.omit({imageKey:true})).max(500),finalize:z.boolean().default(false)}).strict();
 let input:unknown;try{input=JSON.parse(raw);}catch{throw new AppError('板料批次不是有效JSON。');}const result=schema.safeParse(input);if(!result.success)throw new AppError('板料批次、字段或图片格式不完整。');const v=result.data,prefix='acetate_material_'+v.sourceSha256,bid=prefix+'_'+v.batch,prior=all(s,'acetate_material_batch').find(r=>r.id===bid);
 if(v.batch>=v.totalBatches)throw new AppError('批次编号超出范围。');
 if(v.finalize){
  const existing=catalogs(s).find(c=>c.sourceSha256===v.sourceSha256);if(existing)return json({ok:true,id:existing.id,idempotent:true});
  const batches=all(s,'acetate_material_batch').filter(b=>b.sourceSha256===v.sourceSha256).sort((a,b)=>a.batch-b.batch);
  if(batches.length!==v.totalBatches||batches.some((b,i)=>b.batch!==i||b.totalBatches!==v.totalBatches||b.sourceFilename!==v.sourceFilename))throw new AppError('批次尚未完整，不能启用资料库。',409);
  if(!await bucket().get('acetate-original-'+v.sourceSha256))throw new AppError('请先完整归档原Excel。');
  const candidate={id:prefix,kind:'acetate_material_catalog',version:(catalogs(s)[0]?.version||0)+1,sourceSha256:v.sourceSha256,sourceFilename:v.sourceFilename,originalKey:'acetate-original-'+v.sourceSha256,batches:batches.map(b=>({key:b.key,count:b.count})),count:batches.reduce((n,b)=>n+b.count,0),createdAt:now(),createdById:m.id};
  const loaded=await rows(candidate);if(!loaded.length||new Set(loaded.map(r=>r.id)).size!==loaded.length)throw new AppError('资料为空或存在重复记录标识。');
  await commit(s.revision,[candidate,audit(m,candidate,null,'启用板料清单版本','独立资料，不修改原订单、BOM、账号或报价')]);return json({ok:true,id:candidate.id,count:candidate.count});
 }
 if(!v.rows.length)throw new AppError('批次不能为空。');const fingerprint=await digest(raw);if(prior){if(prior.fingerprint!==fingerprint)throw new AppError('同批次已导入其他内容，不能覆盖。',409);return json({ok:true,idempotent:true});}
 const prepared:AcetateMaterial[]=[];
 for(const input of v.rows){const {imageData,...r}=input;let imageKey:string|undefined;
  if(imageData){const match=imageData.match(/^data:image\/(jpeg|png);base64,([a-zA-Z0-9+/=]+)$/);if(!match)throw new AppError('仅接受已归档的PNG/JPEG色图。');const bytes=Uint8Array.from(atob(match[2]),v=>v.charCodeAt(0));if(bytes.length>280000||!(match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216:bytes[0]===137&&bytes[1]===80&&bytes[2]===78))throw new AppError('色图内容不匹配。');imageKey='acetate-image-'+await sha(bytes)+(match[1]==='png'?'.png':'.jpg');await bucket().put(imageKey,bytes);}
  prepared.push({...r,...(imageKey?{imageKey}:{})});
 }
 const key=bid+'_'+fingerprint+'.json';await bucket().put(key,JSON.stringify(prepared));const record={id:bid,kind:'acetate_material_batch',key,sourceFilename:v.sourceFilename,sourceSha256:v.sourceSha256,batch:v.batch,totalBatches:v.totalBatches,count:prepared.length,fingerprint,createdAt:now(),createdById:m.id};await commit(s.revision,[record]);return json({ok:true,count:prepared.length});
}
