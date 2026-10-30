import type {Entity} from './domain';
import {stageDefs} from './ledger';

export type OutsourcingScope='all'|'semifinished'|'plating';
export const isOutsourcingScope=(value:string):value is OutsourcingScope=>['all','semifinished','plating'].includes(value);
const supportedStages=stageDefs.filter(stage=>!['procurement','packing'].includes(stage.id));

/** View scopes reuse the stored process identifier; they never convert a business record. */
export function matchesOutsourcingScope(process:unknown,scope:OutsourcingScope='all'){
 if(scope==='all')return true;
 if(scope==='plating')return process==='plating';
 return supportedStages.some(stage=>stage.id===process&&stage.id!=='plating');
}
export const outsourcingStages=(scope:OutsourcingScope='all')=>supportedStages.filter(stage=>matchesOutsourcingScope(stage.id,scope));

/** A delivery document may contain several processes. Project its lines without changing the original. */
export function scopeOutsourcingReceipts(receipts:readonly Entity[],scope:OutsourcingScope,sources:readonly Entity[]=[]):Entity[]{
 if(scope==='all')return [...receipts];
 const processById=new Map(sources.map(source=>[source.id,source.process]));
 return receipts.flatMap(receipt=>{
  const lines=(receipt.lines||[]).filter((line:Entity)=>matchesOutsourcingScope(line.process||processById.get(line.outsourceId),scope));
  return lines.length?[{...receipt,lines}]:[];
 });
}
