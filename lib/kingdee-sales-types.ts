import type {SalesOrderSourceRecord} from './sales-order-sources';

export const KINGDEE_SALES_RULE='doon-finished-six-segment-2025-07-08-v1';
export const KINGDEE_SALES_CATEGORIES=['TI','SS','MU+SS','CP','AC','AC+TI','GJ-AC+TI','GJ-AC','GJ-TI','TI+AC','NJ/SUN','NJ+CP','NJ'] as const;
export type KingdeeSalesLineInput={sourceLineId:string;categoryCode:string;drawing:string;customerModel:string;finishCode:string;color:string;quantity:string;unitName:string;unitPrice:string;taxRate:string;isFree:boolean;deliveryDate:string;remark:string};
export type KingdeeSalesInputs={billDate:string;customerNumber:string;employeeName:string;currencyName:string;exchangeRate:string;businessType:string;taxMode:''|'exclusive'|'inclusive';customerPO:string;remark:string;lines:KingdeeSalesLineInput[]};
export type KingdeeSalesIssue={field:string;message:string;sourceLineId?:string};
export type KingdeeSalesValidation={valid:boolean;issues:KingdeeSalesIssue[];warnings:string[];codes:{sourceLineId:string;productCode:string}[];totalQuantity:string;netAmount:string;taxAmount:string;grossAmount:string;checkedAt:string;remoteVerified:boolean};
export type KingdeeSalesStatus='draft'|'validated'|'confirmed'|'uploading'|'unknown'|'uploaded';
export type KingdeeSalesConfirmation={actorId:string;actor:string;at:string;expiresAt:string;binding:string};
export type KingdeeSalesDraft={id:string;kind:'kingdee_sales_draft';version:number;sourceId:string;sourceHash:string;templateId:string;templateHash:string;ruleVersion:string;customer:string;orderNo:string;inputs:KingdeeSalesInputs;status:KingdeeSalesStatus;validation:KingdeeSalesValidation;confirmation?:KingdeeSalesConfirmation;createdAt:string;updatedAt:string;createdById:string;updatedById:string;attemptId?:string;remoteId?:string;remoteNumber?:string};
export type KingdeeSalesPublicDraft=KingdeeSalesDraft&{canPrepare:boolean;canConfirm:boolean;canUpload:boolean;attempt?:{id:string;status:string;message:string;createdAt:string;remoteId?:string;remoteNumber?:string}};
export type KingdeeSalesData={sources:SalesOrderSourceRecord[];drafts:KingdeeSalesPublicDraft[];template:{id:string;filename:string;headers:string[]}|null;connection:{configured:boolean;writeEnabled:boolean;message:string;readinessIssues:string[]};ruleVersion:string;categories:readonly string[]};
