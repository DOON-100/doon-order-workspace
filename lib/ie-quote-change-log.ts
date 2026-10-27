import type {IeQuote} from './ie-quotes';
export type IeQuoteChange={path:string;label:string;before:string;after:string};
type Cell={label:string;value:string};
const value=(v:unknown)=>v===null||v===undefined?'未填写':typeof v==='boolean'?v?'是':'否':typeof v==='number'?String(v):String(v)||'空白';
const status:Record<string,string>={draft:'工程草稿',submitted:'待工程复核',returned:'退回补充',released:'已复核发布'};
const feeMode:Record<string,string>={charge:'本次单独收费',already_charged:'已有收费凭证',included_in_batch:'引用本批其他报价收费',not_applicable:'不适用'};
function flatten(q:IeQuote|null){
 const cells=new Map<string,Cell>();if(!q)return cells;
 const put=(path:string,label:string,v:unknown)=>cells.set(path,{label,value:value(v)});
 const fields=(prefix:string,label:string,row:Record<string,unknown>,definitions:Record<string,string>)=>{for(const [key,name] of Object.entries(definitions))put(prefix+'/'+key,label?label+' · '+name:name,row[key]);};
 fields('quote','',q,{quoteNo:'工程报价编号',customerName:'客户',customerCode:'客户编号',quoteDate:'报价日期',validUntil:'有效期',batchId:'报价批次',exchangeRateCnyPerUsd:'手填汇率（1 USD = x CNY）',exchangeRateDate:'汇率日期',exchangeRateSource:'汇率来源',notes:'报价说明',reviewReason:'复核说明'});
 put('quote/status','报价状态',status[q.status]||q.status);
 put('quote/materialPricingMode','材料计价规则',q.materialPricingMode==='checklist'?'材料清单：未填价格按 0，空单耗和系数按 1':'原版本规则：未填价格待确认');
 if(q.costs)put('quote/formulaVersion','核价公式版本',q.costs.formulaVersion);
 for(const ref of q.attachmentRefs||[])fields('attachment/'+ref.attachmentId,'图纸附件 / '+ref.filename,ref,{filename:'文件名',lineId:'款式编号',drawingNo:'图纸编号',drawingRevision:'绑定图纸版本',sha256:'原件摘要'});
 for(const l of q.lines){
  const prefix='line/'+l.id,label=l.model||'未命名款式';
  fields(prefix,label,l,{model:'厂款',customerModel:'客款',color:'颜色',drawingNo:'图纸编号',drawingRevision:'图纸版本',quantityMin:'数量下限',quantityMax:'数量上限',structureNotes:'结构分析',scopeNotes:'供货范围'});
  for(const m of l.materials){const path=prefix+'/material/'+m.id,title=label+' / 材料 '+(m.name||'未命名');fields(path,title,m,{name:'名称',specification:'规格',unit:'单位',basePrice:'基价 CNY',usage:'单副用量',coefficient:'计价系数',lossAdjustmentReason:'损耗调整原因',notApplicable:'不适用',notes:'说明',priceSource:'价格来源',catalogId:'目录引用',catalogVersion:'目录版本'});put(path+'/lossRate',title+' · 总损耗率',`${Number(((m.lossRate??.1)*100).toFixed(6))}%`);put(path+'/extraLoss',title+' · 额外损耗百分点',`${Number((((m.lossRate??.1)-.1)*100).toFixed(6))}%`);}
  for(const m of l.materials)if(m.nameReference){const path=prefix+'/material/'+m.id+'/nameReference',title=label+' / 材料 '+(m.name||'未命名')+' / 名称来源';fields(path,title,m.nameReference,{catalogId:'词库编号',catalogVersion:'词库版本',entryId:'名称条目编号'});put(path+'/nameUsage',title+' · 名称取用方式',m.nameReference.nameUsage==='part-v1'?'配件名称（part-v1）':'颜色资料原名');}
  for(const p of l.processes)fields(prefix+'/process/'+p.id,label+' / 工序 '+(p.name||'未命名'),p,{name:'名称',parentId:'上级工序编号',sequence:'顺序',standardSeconds:'标准工时（秒）',basePrice:'基价 CNY',difficulty:'难度系数',usage:'每副用量 / 次数',notApplicable:'不适用',priceSource:'价格来源',catalogId:'目录引用',catalogVersion:'目录版本',notes:'说明'});
  for(const o of l.outsourcing)fields(prefix+'/outsource/'+o.id,label+' / '+(o.category==='plating'?'电镀':'一般外发')+' '+(o.name||'未命名'),o,{category:'费用归属',name:'名称',part:'加工部位',unitPrice:'未税基价 CNY',usage:'每副用量 / 次数',notApplicable:'不适用',priceSource:'价格来源',catalogId:'目录引用',catalogVersion:'目录版本',notes:'说明'});
  const c=q.costs?.lines.find(c=>c.lineId===l.id);if(c)fields(prefix+'/costs',label+' / 计算结果',c,{material:'材料净额',materialLoss:'材料损耗额',materialWithLoss:'材料含损耗合计',process:'厂内工序',plating:'电镀',outsourcing:'一般外发',outsourcingTotal:'电镀及一般外发合计',indirectLabor:'间接人工',rent:'房租',water:'水费',electricity:'电费',depreciation:'折旧',supplies:'辅料',indirect:'间接费用',laborTotal:'直接人工及间接费合计',productionCost:'生产成本 CNY',productionCostUsd:'生产成本 USD',factoryPriceCny:'出厂价 CNY',factoryPriceUsd:'出厂价 USD'});
 }
 for(const t of q.tooling){const path='tooling/'+t.id,title='一次性费用 / '+(t.name||'未命名');fields(path,title,t,{name:'名称',toolingId:'稳定登记编号',amount:'单独金额 CNY',chargeQuoteId:'收费来源报价',chargeVersion:'收费来源版本',evidence:'凭证',notes:'说明'});put(path+'/chargeMode',title+' · 计费方式',feeMode[t.chargeMode]||t.chargeMode);put(path+'/lines',title+' · 共用款式',t.lineIds.map(id=>q.lines.find(l=>l.id===id)?.model||id).sort().join(' / '));}
 for(const adjustment of q.manualAdjustments||[]){const cell=q.costs?.adjustmentCells?.find(c=>c.target===adjustment.target),path='adjustment/'+adjustment.target,title=(cell?.label||adjustment.target)+' / 人工调整';fields(path,title,adjustment,{value:'人工金额',reason:'调整原因',sourceSignature:'已确认计算依据'});put(path+'/automatic',title+' · 自动金额',cell?.automaticValue);put(path+'/effective',title+' · 实际采用金额',cell?.effectiveValue);put(path+'/state',title+' · 状态',cell?.stale?'依据变更，待重新确认':cell?.applied?'已采用':'未采用');}
 if(q.costs)put('quote/toolingChargeCny','整单一次性费用合计 CNY',q.costs.toolingChargeCny);
 return cells;
}
/** Only business fields are compared. Storage keys and unknown extension fields
 * are excluded even if a future quote snapshot contains them. Stable row IDs
 * ensure reordering never makes another material look like the old material. */
export function compareIeQuoteVersions(before:IeQuote|null,after:IeQuote):IeQuoteChange[]{
 const a=flatten(before),b=flatten(after),paths=new Set([...a.keys(),...b.keys()]);
 return [...paths].flatMap(path=>{const old=a.get(path),next=b.get(path);if(old?.value===next?.value)return [];return [{path,label:next?.label||old!.label,before:old?.value??'未存在',after:next?.value??'已删除'}];});
}
