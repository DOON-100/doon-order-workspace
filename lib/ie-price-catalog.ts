import {z} from 'zod';
import {strictDate} from './domain';
import {ieNumericValue,type IeCatalog} from './ie-quotes';

const text=(length:number)=>z.string().trim().max(length).optional();
/** Optional metadata keeps historical catalog versions valid without migration. */
export const ieCatalogMetadata={supplier:text(240),frameType:text(240),processType:text(240),color:text(500),currency:z.string().trim().regex(/^[A-Z]{3}$/).optional(),taxBasis:z.enum(['exclusive','inclusive']).optional(),taxRate:z.number().finite().min(0).max(1).optional(),notes:text(4000),evidenceId:text(120)};
export type IeCatalogMetadata={supplier?:string;frameType?:string;processType?:string;color?:string;currency?:string;taxBasis?:'exclusive'|'inclusive';taxRate?:number;notes?:string;evidenceId?:string;sourceImportId?:string;sourceSheet?:string;sourceRow?:number};
export const ieCatalogInput=z.object({id:z.string().trim().min(1).max(120).optional(),version:z.number().int().positive().optional(),category:z.enum(['material','process','plating','general']),name:z.string().trim().min(1).max(240),specification:z.string().trim().max(1000),unit:z.string().trim().max(40),basePrice:ieNumericValue,standardSeconds:ieNumericValue.nullable(),priceSource:z.string().trim().min(1).max(1000),effectiveDate:z.string().refine(v=>{try{return !!v&&strictDate(v)===v;}catch{return false;}},'生效日期无效'),active:z.boolean(),...ieCatalogMetadata}).strict();
export type IeCatalogInput=z.infer<typeof ieCatalogInput>;
export function publicIeCatalog(c:IeCatalog){
 const {id,version,category,name,specification,unit,basePrice,standardSeconds,priceSource,effectiveDate,active,supplier,frameType,processType,color,currency,taxBasis,taxRate,notes,evidenceId,sourceImportId,sourceSheet,sourceRow}=c;
 return {id,version,category,name,specification,unit,basePrice,standardSeconds,priceSource,effectiveDate,active,supplier,frameType,processType,color,currency,taxBasis,taxRate,notes,evidenceId,sourceImportId,sourceSheet,sourceRow};
}
export function ieCatalogIsCnyExclusive(c:Pick<IeCatalog,'currency'|'taxBasis'>){return (!c.currency||c.currency==='CNY')&&(!c.taxBasis||c.taxBasis==='exclusive');}
/** Same item at another supplier, date, currency or tax basis is a separate offer. */
export function ieCatalogOfferKey(c:IeCatalogInput){return JSON.stringify([c.category,c.name,c.specification,c.unit,c.supplier||'',c.frameType||'',c.processType||'',c.color||'',c.currency||'CNY',c.taxBasis||'exclusive',c.taxRate??0,c.effectiveDate,c.basePrice,c.standardSeconds].map(v=>typeof v==='string'?v.normalize('NFKC').trim():v));}
