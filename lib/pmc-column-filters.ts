import {productTypeOf,type Order,type Report} from './domain';
import {balance,currentStage,ownerLabel} from './ledger';
import {factoryName,type ProductionScope} from './manufacturing';
import {pmcColumns,pmcValue,reviewLabels} from './pmc';

export const pmcFilterColumns=['sourceRow','order','productType','owner','U','AB','color','lens','quantity','balance','requestedDate','AC','AD','AE','AF','stage','close','review'] as const;
export type PmcFilterColumn=typeof pmcFilterColumns[number];
export type PmcColumnFilters=Partial<Record<PmcFilterColumn,string>>;
export const pmcFilterLabels:Record<PmcFilterColumn,string>={sourceRow:'原行号',order:'订单 / 图纸编号',productType:'产品类型',owner:'跟单员',U:'PMC排期',AB:'状态备注',color:'色号',lens:'镜片',quantity:'订单数',balance:'欠数',requestedDate:'客原交期',AC:'配件齐日期',AD:'板料齐期',AE:'配套齐料期',AF:'投产日',stage:'当前工序',close:'结单',review:'本轮核对'};

// Read only: use the same displayed values in the browser and filtered export.
export function pmcFilterValue(o:Order,column:PmcFilterColumn,reports:Report[],state:string,productionScope:ProductionScope='internal'):string{
 if((pmcColumns as readonly string[]).includes(column))return pmcValue(o,column);
 switch(column){
  case 'sourceRow':return String(o.ledger?.sourceRow||'新');
  case 'order':return [o.orderNo,productionScope==='external'?factoryName(o):'',o.customer,o.drawing,o.color,o.lens].filter(Boolean).join(' · ');
  case 'productType':return productTypeOf(o)||'未填写';
  case 'owner':return ownerLabel(o);
  case 'color':return o.color||'';
  case 'lens':return o.lens||'';
  case 'quantity':return String(o.quantity);
  case 'balance':return String(balance(o,reports)??'待核');
  case 'requestedDate':return o.requestedDate||'';
  case 'stage':return currentStage(o);
  case 'close':return '办理结单';
  case 'review':return reviewLabels[state]||state;
  default:return '';
 }
}

export function matchesPmcColumnFilters(o:Order,filters:PmcColumnFilters,reports:Report[],state:string,productionScope:ProductionScope='internal'){
 return pmcFilterColumns.every(column=>filters[column]===undefined||pmcFilterValue(o,column,reports,state,productionScope)===filters[column]);
}

// Keep validation browser-safe; the API boundary translates validation errors to AppError.
export function parsePmcColumnFilters(raw:string|null):PmcColumnFilters{
 if(raw===null)return {};
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{throw new Error('PMC列筛选格式无效，请重新选择筛选条件。');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('PMC列筛选必须为字段和值组成的对象。');
 const filters:PmcColumnFilters={};
 for(const [column,value] of Object.entries(parsed)){
  if(!(pmcFilterColumns as readonly string[]).includes(column)||typeof value!=='string')throw new Error('PMC列筛选包含无效字段或筛选值。');
  filters[column as PmcFilterColumn]=value;
 }
 return filters;
}
