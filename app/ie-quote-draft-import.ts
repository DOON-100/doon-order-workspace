import {ieQuoteInput,type IeQuoteFields} from '@/lib/ie-quote-input';

export const IE_DRAFT_IMPORT_MAX_BYTES=8*1024*1024;
export type IeDraftImportCustomer={id:string;customer:string;customerCode:string};
const labels:Record<string,string>={customerAccountId:'客户',quoteNo:'报价编号',quoteDate:'报价日期',validUntil:'有效期',batchId:'批次',exchangeRateCnyPerUsd:'汇率',exchangeRateDate:'汇率日期',exchangeRateSource:'汇率来源',lines:'产品',materials:'材料',processes:'工艺',outsourcing:'外发',tooling:'一次性费用',manualAdjustments:'人工调整',basePrice:'基价',unitPrice:'单价',difficulty:'难度系数',usage:'用量',coefficient:'系数',quantityMin:'数量下限',quantityMax:'数量上限',drawingNo:'图纸编号',drawingRevision:'图纸版本',id:'行编号',name:'名称',lossRate:'损耗比例',reason:'原因',value:'金额'};

/** Importing prepares a new local draft only. Identity, versions and permissions never come from a file. */
export function parseIeQuoteDraftImport(text:string,customers:readonly IeDraftImportCustomer[]):{fields:IeQuoteFields;customer:IeDraftImportCustomer}{
 if(new TextEncoder().encode(text).byteLength>IE_DRAFT_IMPORT_MAX_BYTES)throw new Error('报价草稿文件不能超过 8 MB。');
 let input:unknown;try{input=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('无法读取报价草稿文件，请选择按中台报价字段准备的有效草稿资料。');}
 if(input&&typeof input==='object'&&(['id','version'] as const).some(key=>Object.hasOwn(input,key)))throw new Error('仅支持载入新的报价草稿；文件不能携带已保存报价的编号或版本。');
 const parsed=ieQuoteInput.safeParse(input);
 if(!parsed.success){const issues=parsed.error.issues.slice(0,6).map(issue=>{const path=issue.path.map(part=>typeof part==='number'?String(part+1):(labels[String(part)]||String(part))).join(' / ');const message=/[\u4e00-\u9fff]/.test(issue.message)?issue.message:issue.code==='unrecognized_keys'?'含有不支持的字段，请只保留报价填写资料':'格式或取值不正确';return (path?path+'：':'')+message;});throw new Error('报价草稿校验未通过：'+issues.join('；'));}
 if(parsed.data.materialPricingMode!=='checklist')throw new Error('草稿须使用当前材料清单计价规则，请重新准备资料。');
 const customer=customers.find(item=>item.id===parsed.data.customerAccountId);
 if(!customer)throw new Error('文件中的客户不存在、已停用或不在当前查看范围，请核对有效客户后重新选择文件。');
 const {id:_id,version:_version,...fields}=parsed.data;
 return {fields,customer};
}
