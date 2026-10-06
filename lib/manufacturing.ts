import type {Order} from './domain';
export type ProductionScope='internal'|'external';
const normalize=(value:unknown)=>String(value??'').normalize('NFKC').trim();
export function factoryName(o:Order){return normalize(o.ledger?.columns.A||o.extra?.['A · 生产厂']||o.extra?.['生产厂']);}
// Factory is a source field, not an inference from an order prefix, notes, or a process supplier.
export function isFinishedOutsource(o:Order){const name=factoryName(o);return !!name&&!['-','—','未填写','待确认','未知','度昂','DOON'].includes(name.toUpperCase());}
export function inProductionScope(o:Order,scope:ProductionScope){return scope==='external'?isFinishedOutsource(o):!isFinishedOutsource(o);}
export function productionScope(value:unknown):ProductionScope{return value==='external'?'external':'internal';}
