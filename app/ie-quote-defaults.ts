import {clientId} from '@/lib/client-id';
import type {IeMaterialNameItem} from './ie-material-picker';
import type {Line,Material,Quote} from './ie-quote-panel';

// Keep new rows within the server's per-style material limit. The panel discloses
// larger catalogs and keeps all candidates searchable for deliberate replacements.
export const IE_MATERIAL_ROW_LIMIT=200;

/** Copy only part names and their immutable source references. Prices are never inherited. */
export function newIeMaterial(item?:IeMaterialNameItem,idFactory=clientId):Material{
 return {id:idFactory(),name:item?.name||'',...(item?{nameReference:{catalogId:item.catalogId,catalogVersion:item.version,entryId:item.id,nameUsage:'part-v1' as const}}:{}),specification:'',unit:'',basePrice:null,usage:1,coefficient:1,lossRate:0.1,lossAdjustmentReason:'',notApplicable:false,priceSource:'',notes:''};
}
export function newIeLine(checklist:IeMaterialNameItem[]=[],idFactory=clientId):Line{
 return {id:idFactory(),model:'',customerModel:'',color:'',drawingNo:'',drawingRevision:'',quantityMin:null,quantityMax:null,structureNotes:'',scopeNotes:'',materials:checklist.slice(0,IE_MATERIAL_ROW_LIMIT).map(item=>newIeMaterial(item,idFactory)),processes:[],outsourcing:[]};
}
/** Editing opts into the new material policy without writing or replacing a saved snapshot. */
export function prepareIeQuoteDraft(quote:Quote,historical=false):Quote{
 const copy=structuredClone(quote);
 if(!historical&&copy.canEdit&&['draft','returned'].includes(copy.status))copy.materialPricingMode='checklist';
 return copy;
}
