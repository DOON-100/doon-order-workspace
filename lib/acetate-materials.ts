import {z} from 'zod';
import {personnelTypeOf,type Member} from './domain';

const text=z.string().max(1200),short=z.string().max(160);
export const acetateMaterialSchema=z.object({
 id:short.min(1),supplier:short.min(1),code:short,entryType:z.enum(['product','series','specification']).default('product'),descriptionZh:text,descriptionOriginal:text.default(''),series:text,material:text,process:text,
 size:text,thickness:text,standardThickness:text,origin:short,status:text,delivery:text,moq:text,
 erpCode:short.default(''),source:text,sourceDate:short,detailUrl:z.string().url().max(2400).refine(v=>/^https?:\/\//.test(v)).or(z.literal('')),
 imageKind:short,imageData:z.string().max(400000).optional(),imageKey:short.optional(),
}).strict();
export type AcetateMaterial=z.infer<typeof acetateMaterialSchema>;
export const acetateMaterialReferenceSchema=z.object({catalogId:short.min(1),entryId:short.min(1),thickness:z.number().positive().max(30).nullable(),descriptionZh:text.optional(),part:z.enum(['圈料','脾料','庄头拼料','其他']).optional(),snapshot:z.unknown().optional()}).strict();
export type AcetateMaterialReference=z.infer<typeof acetateMaterialReferenceSchema>;
export type AcetateMaterialSnapshot=Omit<AcetateMaterial,'imageData'> & {catalogId:string;catalogVersion:number;selectedThickness:number|null;selectedAt:string;selectedPart?:string;sourceDescriptionZh?:string};
export const canReadAcetateMaterials=(m:Member)=>m.active&&m.role!=='supplier'&&personnelTypeOf(m)==='internal';
export function acetateDimensions(value:string):{length:number;width:number}|null{
 const m=value.replace(/\s|mm/gi,'').match(/^(\d+(?:\.\d+)?)[×xX*](\d+(?:\.\d+)?)$/);
 if(!m)return null;const a=Number(m[1]),b=Number(m[2]);return a>0&&b>0&&a<=10000&&b<=10000?{length:Math.max(a,b),width:Math.min(a,b)}:null;
}
export function acetateThicknesses(value:string):number[]{
 if(!/^\s*\d+(?:\.\d+)?(?:\s*[,/;&]\s*\d+(?:\.\d+)?)*\s*$/.test(value))return [];
 return [...new Set((value.match(/\d+(?:\.\d+)?/g)||[]).map(Number).filter(v=>v>0&&v<=30))];
}
export const acetateMaterialColumns=[['supplier','供应商'],['code','板料编号'],['descriptionZh','中文颜色描述'],['size','尺寸 mm'],['thickness','厚度 mm'],['standardThickness','标准厚度 mm'],['material','材料'],['series','系列'],['process','工艺'],['origin','产地'],['status','标准/停产状态'],['delivery','资料交期'],['moq','起订条件'],['erpCode','金蝶物料编码'],['sourceDate','资料日期'],['source','来源'],['descriptionOriginal','原文颜色'],['imageKind','图片类型'],['detailUrl','供应商详情链接'],['entryType','资料类别']] as const;
