import {z} from 'zod';
import {all,type Entity,type State} from './domain';

const id=z.string().trim().min(1).max(120);
export const ieMaterialNameReference=z.object({catalogId:id,catalogVersion:z.number().int().positive(),entryId:id}).strict();
export type IeMaterialNameReference=z.infer<typeof ieMaterialNameReference>;
export const ieMaterialNameEntry=z.object({id,code:z.string().min(1).max(100),name:z.string().min(1).max(240),nameEn:z.string().max(300).default(''),sourceSheet:z.string().min(1).max(100),sourceRow:z.number().int().positive().max(1048576)}).strict();
export const ieMaterialNameCatalog=z.object({sourceFilename:z.string().min(1).max(240).refine(v=>!/[\\/]/.test(v),'只保存文件名'),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),entries:z.array(ieMaterialNameEntry).min(1).max(2000)}).strict().superRefine((value,ctx)=>{
 for(const key of ['id','code'] as const)if(new Set(value.entries.map(e=>e[key])).size!==value.entries.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'名称资料的编号和编码必须唯一',path:['entries']});
});
export type IeMaterialNameEntry=z.infer<typeof ieMaterialNameEntry>;
export type IeMaterialNameCatalogRecord=Entity&{kind:'ie_material_name_catalog';version:number;previousId:string;catalog:z.infer<typeof ieMaterialNameCatalog>;createdAt:string;createdById:string};
export function latestIeMaterialNameCatalog(s:State){return (all(s,'ie_material_name_catalog') as IeMaterialNameCatalogRecord[]).sort((a,b)=>b.version-a.version)[0]||null;}
const normalize=(v:string)=>v.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
function distance(a:string,b:string){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}return prev[b.length];}
function rank(entry:IeMaterialNameEntry,query:string){
 const names=[entry.code,entry.name,entry.nameEn,entry.name.replace(/(?:颜色|色)$/u,''),entry.nameEn.replace(/\s+colou?r$/i,'')].map(normalize).filter(Boolean);
 let score=0;for(const name of names){if(name===query)score=Math.max(score,100);else if(name.startsWith(query))score=Math.max(score,90);else if(name.includes(query))score=Math.max(score,80);else if(query.length>=3&&Math.abs(name.length-query.length)<=2){const d=distance(name,query),similarity=1-d/Math.max(name.length,query.length);if(d<=2&&similarity>=0.6)score=Math.max(score,Math.round(similarity*60));}}
 return score;
}
export function searchIeMaterialNames(catalog:IeMaterialNameCatalogRecord|null,query:string,limit=20){
 if(!catalog)return {items:[],total:0};const q=normalize(query).slice(0,100);
 const matches=catalog.catalog.entries.map((entry,index)=>({entry,index,score:q?rank(entry,q):1})).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
 return {items:matches.slice(0,limit).map(({entry})=>({...entry,catalogId:catalog.id,version:catalog.version})),total:matches.length};
}
export function validateIeMaterialNameReferences(s:State,fields:{lines:{materials:{name:string;nameReference?:IeMaterialNameReference}[]}[]}):string|null{
 for(const line of fields.lines)for(const material of line.materials){const ref=material.nameReference;if(!ref)continue;
  const catalog=all(s,'ie_material_name_catalog').find(r=>r.id===ref.catalogId&&r.version===ref.catalogVersion) as IeMaterialNameCatalogRecord|undefined;
  const entry=catalog?.catalog.entries.find(e=>e.id===ref.entryId);
  if(!entry||entry.name!==material.name)return '材料名称与所选资料版本不一致，请重新选用名称；手工改名时须清除资料引用。';
 }return null;
}
