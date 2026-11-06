import {matchesExcelColumn,normalizeExcelValue,type ExcelColumnFilter,type ExcelFilters} from './excel-filters';
import {personnelTypeOf,type Member} from './domain';

/** Deployment-local additions only; never expand an empty configuration to all members. */
export function projectListExtraFollowers<T extends Pick<Member,'id'|'active'|'role'|'personnelType'>>(members:T[],configuration:string):T[]{
 let ids:unknown;try{ids=JSON.parse(configuration);}catch{return [];}
 if(!Array.isArray(ids)||ids.length>300||!ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id)))return [];
 const allowed=new Set(ids);
 return members.filter(member=>allowed.has(member.id)&&member.active&&member.role!=='supplier'&&personnelTypeOf(member)==='internal');
}

export const projectListOwnerColumn=5;
export const projectListServiceColumn=11;
export type ProjectListFilterRow={values:unknown[];ownerNames:string[];serviceNames?:string[]};
type FollowupTask={id?:string;projectId?:string;ownerId?:string;dueDate?:string;status?:string};
const unique=(values:string[])=>[...new Set(values.map(normalizeExcelValue))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));

/** Inputs must already be permission-scoped. This view never changes assignments. */
export function projectListPendingTasks<T extends FollowupTask>(tasks:T[],projectId:string):T[]{
 return tasks.filter(task=>task.projectId===projectId&&!['done','completed','cancelled'].includes(task.status||'')).sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')));
}

export function projectListOwnerNames(tasks:FollowupTask[],memberName:(id:string)=>string):string[]{
 return tasks.length?[...new Set(tasks.map(task=>task.ownerId?memberName(task.ownerId):'待指派'))]:['尚未安排下一步'];
}

function matchesOwners(names:string[],filter:ExcelColumnFilter):boolean{
 const values=names.length?names:['待指定'];
 // Excluding a person must exclude the project even when another person also follows it.
 const every=!Array.isArray(filter)&&(filter.kind==='text'&&['notContains','notEquals'].includes(filter.operator)||filter.kind==='blank'&&filter.operator==='empty');
 return every?values.every(value=>matchesExcelColumn(value,filter)):values.some(value=>matchesExcelColumn(value,filter));
}

export function matchesProjectListFilters(row:ProjectListFilterRow,filters:ExcelFilters):boolean{
 return Object.entries(filters).every(([column,filter])=>Number(column)===projectListOwnerColumn?matchesOwners(row.ownerNames,filter):Number(column)===projectListServiceColumn?matchesOwners(row.serviceNames||[],filter):matchesExcelColumn(row.values[Number(column)],filter));
}

/** Unassigned candidates remain selectable with zero matches; no records are fabricated. */
export function projectListFilterValues(rows:ProjectListFilterRow[],column:number,followupNames:string[]):string[]{
 return column===projectListOwnerColumn?unique([...followupNames.filter(name=>normalizeExcelValue(name)),...rows.flatMap(row=>row.ownerNames)]):column===projectListServiceColumn?unique(rows.flatMap(row=>row.serviceNames||[])):unique(rows.map(row=>normalizeExcelValue(row.values[column])));
}
