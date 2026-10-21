export const kingdeeQueryHeaders=['单据编号','单据日期','供应商','业务员','单据关闭状态','商品编码','商品名称','规格','单位','数量（原单）','交货日期','行入库状态','行关闭状态','商品行备注','金蝶单据 ID','金蝶行 ID'];
export type KingdeeQueryRow={id:string;values:string[];uncertain:boolean};
export type KingdeeQueryPage={readOnly:true;page:number;pages:number;count:number;orderIds:string[];rows:KingdeeQueryRow[];excludedComplete:number;unknown:number;startedAt:string;finishedAt:string};
