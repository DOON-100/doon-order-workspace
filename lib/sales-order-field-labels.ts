import {matchSalesColorField,salesOrderFieldKeys,type SalesColorCatalog,type SalesColorField} from './sales-color-fields';
import type {SalesOrderSourceRecord} from './sales-order-sources';

export type SalesOrderDisplayLabel={
 zh:string;en:string;sourceRef?:string;originalZh?:string;originalEn?:string;kingdee?:SalesColorField['kingdee'];notes?:string;
};
export type SalesOrderDisplayLabels=Record<string,SalesOrderDisplayLabel>;
const display=(field:SalesColorField|NonNullable<SalesColorCatalog['orderFields']>[number]):SalesOrderDisplayLabel=>({
 zh:field.labelZh,en:field.labelEn,sourceRef:field.sourceRef,
 ...(field.originalLabelZh?{originalZh:field.originalLabelZh,originalEn:field.originalLabelEn}:{}),
 ...(field.kingdee?{kingdee:field.kingdee}:{}),
 ...('notes' in field&&field.notes?{notes:field.notes}:{}),
});

/** Labels only: never mutates source snapshots, values, column slots or permissions. */
export function salesOrderDisplayLabels(catalog:SalesColorCatalog|null,records:SalesOrderSourceRecord[]):SalesOrderDisplayLabels{
 const labels:SalesOrderDisplayLabels=Object.create(null);
 if(!catalog||!records.length)return labels;
 for(const field of catalog.orderFields||[])labels[field.key]=display(field);
 const reserved=new Set<string>(salesOrderFieldKeys);
 const names=new Set(records.flatMap(record=>record.source.lines.flatMap(line=>line.colorFields.map(field=>field.standardZh))).filter(Boolean));
 for(const name of names){
  // A legacy source has no dictionary ID. Only a unique exact name/approved
  // historical alias can relabel it; fuzzy or ambiguous matches keep the source.
  if(reserved.has(name))continue;
  const result=matchSalesColorField(catalog,name);
  if(result.status==='matched'&&result.basis==='dictionary-exact'&&result.field)labels[name]=display(result.field);
 }
 return labels;
}
