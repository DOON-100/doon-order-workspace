import type {WriteSchema,WriteField} from './write-input.js';
const text=(max=3000):WriteField=>({type:'string',max}),id:WriteField={type:'string',min:1,max:160,required:true},link=text(160),date=text(10),money:WriteField={type:'string',max:24},currency:WriteField={type:'string',enum:['CNY','USD','EUR','GBP','HKD']},reason:WriteField={type:'string',min:2,max:3000,required:true},version:WriteField={type:'number',integer:true,min:1,required:true},ids:WriteField={type:'array',items:id},edit={id:{...id,required:false}};
export const projectEntrySchemas:Record<string,WriteSchema>={
 receipts:{amount:money,currency,date,reference:text(240),payer:text(240),account:text(240),note:text()},
 allocations:{receiptId:link,chargeId:link,amount:money,currency,reason:text()},
 adjustments:{chargeId:link,caseId:link,type:{type:'string',enum:['discount','credit','waiver','debit']},amount:money,currency,prepay:{type:'boolean'},reason:text(),evidence:text()},
 creditApplications:{sourceChargeId:link,targetChargeId:link,amount:money,currency,reason:text(),evidence:text()},
};
export const projectFinanceSaveSchemas:Record<string,WriteSchema>={
 charge:{...edit,projectId:id,roundId:link,title:text(240),category:{type:'string',enum:['sample','tooling','freight','sales_sample','preproduction','bulk','development','revision','repair','replacement','other']},currency,amount:money,prepayAmount:money,dueDate:date,note:text(),plan:{type:'array',items:{type:'object',properties:{title:text(160),amount:money,dueDate:date,beforeOrder:{type:'boolean'}}}}},
 notice:{...edit,projectId:id,roundId:link,amount:money,currency,reference:text(240),note:text()},
 document:{...edit,customerId:id,projectId:link,roundId:link,manualTitle:text(),manualAmount:money,documentType:{type:'string',enum:['PI','CI','CHARGE','STATEMENT','CREDIT']},documentNo:text(120),chargeIds:ids,currency,date,customerAddress:text(),company:text(500),terms:text(6000),adjustmentIds:ids},
 ...Object.fromEntries(Object.entries(projectEntrySchemas).map(([type,properties])=>['entry-'+type,{...edit,projectId:id,roundId:link,data:{type:'object',required:true,properties}} as WriteSchema])),
};
export const projectFinanceActionSchemas:Record<string,WriteSchema>={
 'charge-confirm':{id},
 'payment-requirement':{projectId:id,roundId:id,mode:{type:'string',required:true,enum:['charges','free']},reason},
 'receipt-verify':{customerId:id,amount:{...money,required:true},currency:{...currency,required:true},date:{...date,required:true,min:1},reference:{type:'string',required:true,min:1,max:240},payer:text(240),account:{type:'string',required:true,min:1,max:240},note:text(),noticeIds:ids},
 'receipt-reverse':{receiptId:id,reason},
 allocation:{receiptId:id,chargeId:id,amount:{...money,required:true}},
 'allocation-release':{allocationId:id,amount:{...money,required:true},reason},
 adjustment:{chargeId:id,caseId:{...id,required:false},type:{type:'string',required:true,enum:['discount','credit','waiver','debit']},amount:{...money,required:true},prepay:{type:'boolean'},reason,evidence:{type:'string',required:true,min:1,max:3000}},
 'credit-apply':{sourceChargeId:id,targetChargeId:id,amount:{...money,required:true},reason,evidence:{type:'string',required:true,min:1,max:3000}},
 'document-confirm':{id},'document-revise':{id,reason},
 'document-sent':{sendId:{...id,required:false},projectId:link,roundId:link,documentId:link,expectedDocumentVersion:{...version,required:false},date,recipient:text(240),reference:text(1000)},
};
export const financeCollections=['charges','receipts','allocations','adjustments','creditApplications','documents','notices','requirements','sends','reversals'] as const;
export type FinanceCollection=typeof financeCollections[number];
export const partialProjectSchema=(schema:WriteSchema):WriteSchema=>Object.fromEntries(Object.entries(schema).map(([key,field])=>[key,{...field,required:key==='id'}]));
