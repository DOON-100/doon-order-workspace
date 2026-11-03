/** Metal component outsourcing v1. Sources are references, never legacy ledger writes. */
export type MetalBase = {id:string;kind:string;version:number;createdAt:string;updatedAt:string;createdBy:string;updatedBy:string;voided?:boolean;voidReason?:string};
export type MetalSourceLine = {lineId:string;version:number;quantity:number;color:string;batch:string;pmcPlannedDate?:string;pmcRequestedDate?:string};
export type MetalSourceGroup = {key:string;customer:string;orderNo:string;style:string;quantity:number;plannedQuantity:number;availableQuantity:number;lines:MetalSourceLine[];productionReady:boolean;productionBlockers:string[];legacyOutsourceCount:number;historyNote:string};
export type MetalPart = MetalBase & {kind:'metal_part';code:string;name:string;specification:string;material:string;side:string;unit:string;revision:string;active:boolean;note:string};
export type MetalProcess = {id:string;version:number;name:string;code:string;actions:string[];active:boolean;statProcess:string;includeCost:string};
export type MetalBomLine = {id:string;partId:string;partVersion:number;processId:string;processVersion:number;unitsPerProduct:number;requirements:string};
export type MetalBom = MetalBase & {kind:'metal_bom';groupKey:string;customer:string;orderNo:string;style:string;revision:string;reference:string;lines:MetalBomLine[];status:'draft'|'approved'|'retired';approvedBy?:string;approvedAt?:string;sourceLineIds:string[]};
export type MetalPlan = MetalBase & {kind:'metal_plan';groupKey:string;customer:string;orderNo:string;style:string;bomId:string;bomVersion:number;quantity:number;dueDate:string;sourceLines:MetalSourceLine[];sourceLineIds:string[];status:'approved'|'cancelled';note:string};
export type MetalContribution = {planId:string;bomLineId:string;quantity:number;style:string};
export type MetalDemand = MetalBase & {kind:'metal_demand';customer:string;orderNo:string;part:MetalPart;process:MetalProcess;requirements:string;quantity:number;unit:string;sources:MetalContribution[];sourceLineIds:string[];status:'active'|'cancelled';dueDate:string;note:string};
export type MetalQuote = MetalBase & {kind:'metal_quote';supplierId:string;supplierName:string;partId:string;partVersion:number;processId:string;processVersion:number;requirements:string;quantityUnit:string;pricingUnit:string;pricingFactor:number;priceIncTax:number;taxRate:number;currency:string;validFrom:string;validTo:string;qtyFrom:number;qtyTo:number|null;freeReason:string;reference:string;status:'draft'|'approved'|'retired';approvedBy?:string;approvedAt?:string;teamId:string};
export type MetalJobLine = {id:string;demandId:string;quantity:number;quote:MetalQuote};
export type MetalJob = MetalBase & {kind:'metal_job';number:string;supplierId:string;supplierName:string;date:string;lines:MetalJobLine[];sourceLineIds:string[];status:'confirmed'|'cancelled';note:string};
export type MetalJobRelease = MetalBase & {kind:'metal_job_release';jobId:string;jobLineId:string;demandId:string;quantity:number;reason:string;reference:string;sourceLineIds:string[]};
export type MetalStock = MetalBase & {kind:'metal_stock';demandId:string;quantity:number;date:string;reference:string;sourceLineIds:string[];note:string;evidenceAttachmentId:string;status:'draft'|'confirmed';confirmedBy?:string;confirmedAt?:string};
export type MetalDeliveryLine = {id:string;jobId:string;jobLineId:string;demandId:string;quantity:number;reworkQcId:string;quote:MetalQuote;reworkQuote?:MetalQuote;freeReworkReason?:string};
export type MetalDelivery = MetalBase & {kind:'metal_delivery';number:string;supplierId:string;supplierName:string;date:string;dueDate:string;lines:MetalDeliveryLine[];sourceLineIds:string[];status:'draft'|'dispatched'|'cancelled';reference:string;note:string;dispatchedAt?:string;signedAt?:string;signedBy?:string;signatureReference?:string};
export type MetalReceipt = MetalBase & {kind:'metal_receipt';deliveryId:string;deliveryLineId:string;demandId:string;quantity:number;date:string;reference:string;sourceLineIds:string[];note:string};
export type MetalQc = MetalBase & {kind:'metal_qc';receiptId:string;demandId:string;date:string;billableGood:number;freeGood:number;bad:number;note:string;sourceLineIds:string[];supplierId:string;quote:MetalQuote;reworkQuote?:MetalQuote;originalAmountIncTax:number;reworkAmountIncTax:number;amountIncTax:number;amountExTax:number;currency:string};
export type MetalIssue = MetalBase & {kind:'metal_issue';qcId:string;demandId:string;planId:string;style:string;quantity:number;date:string;reference:string;amountIncTax:number;amountExTax:number;currency:string;sourceLineIds:string[];note:string};
export type MetalSettlement = MetalBase & {kind:'metal_settlement';number:string;supplierId:string;supplierName:string;period:string;qcIds:string[];adjustmentIds:string[];currency:string;amountIncTax:number;amountExTax:number;status:'draft'|'confirmed'|'cancelled';reference:string;sourceLineIds:string[];note:string;confirmedAt?:string;confirmedBy?:string};
export type MetalPayment = MetalBase & {kind:'metal_payment';settlementId:string;amount:number;date:string;reference:string;sourceLineIds:string[];note:string};
export type MetalAdjustment = MetalBase & {kind:'metal_adjustment';qcId:string;supplierId:string;currency:string;amountIncTax:number;amountExTax:number;reason:string;reference:string;status:'draft'|'approved';sourceLineIds:string[];approvedAt?:string;approvedBy?:string};
export type MetalDisposition = MetalBase & {kind:'metal_disposition';qcId:string;quantity:number;date:string;type:'scrap'|'return';reason:string;reference:string;sourceLineIds:string[]};
export type MetalCorrection = MetalBase & {kind:'metal_correction';targetId:string;targetKind:string;reason:string;reference:string;sourceLineIds:string[]};
export type MetalPermissions = {read:boolean;master:boolean;plan:boolean;operate:boolean;stock:boolean;quality:boolean;issue:boolean;price:boolean;approvePrice:boolean;settle:boolean;pay:boolean};
export type MetalDemandBalance = {demandId:string;reserved:number;dispatched:number;received:number;pendingQc:number;billableGood:number;freeGood:number;bad:number;issued:number;availableGood:number;stockAvailable:number;inTransit:number;unallocatedCost:number|null;unallocatedCostsByCurrency:{currency:string;amountIncTax:number}[]};
export type MetalData = {protocol:'doon-metal-outsourcing-v1';revision:number;teamId:string;permissions:MetalPermissions;sourceGroups:MetalSourceGroup[];parts:MetalPart[];processes:MetalProcess[];suppliers:{id:string;name:string}[];boms:MetalBom[];plans:MetalPlan[];demands:MetalDemand[];quotes:MetalQuote[];jobs:MetalJob[];releases:MetalJobRelease[];stock:MetalStock[];deliveries:MetalDelivery[];receipts:MetalReceipt[];quality:MetalQc[];issues:MetalIssue[];settlements:MetalSettlement[];payments:MetalPayment[];adjustments:MetalAdjustment[];dispositions:MetalDisposition[];corrections:MetalCorrection[];evidenceFiles:{id:string;lineId:string;filename:string}[];balances:MetalDemandBalance[];limitations:string[]};

/** Every POST requires a fresh UUID token. Update actions require the entity's version.
 * Price-bearing fields are removed at runtime when permissions.price=false.
 * GET metal-outsourcing returns all authorized rows (filter before pagination in UI).
 * No server mutation is performed for print/export; print the complete returned document.
 */
export type MetalPostInputs = {
 'metal-part-save':{id?:string;version:number;part:{code:string;name:string;specification:string;material:string;side:string;unit:string;revision:string;active:boolean;note:string}};
 'metal-bom-create':{groupKey:string;revision:string;reference:string;lines:{partId:string;partVersion:number;processId:string;processVersion:number;unitsPerProduct:number;requirements:string}[]};
 'metal-bom-approve':{id:string;version:number};
 'metal-bom-retire':{id:string;version:number;reason:string};
 'metal-plan-create':{bomId:string;bomVersion:number;sourceVersions:{lineId:string;version:number}[];quantity:number;dueDate:string;note:string};
 'metal-plan-cancel':{id:string;version:number;reason:string};
 'metal-demand-create':{sources:{planId:string;planVersion:number;bomLineId:string;quantity:number}[];dueDate:string;note:string};
 'metal-demand-cancel':{id:string;version:number;reason:string};
 'metal-quote-create':{supplierId:string;partId:string;partVersion:number;processId:string;processVersion:number;requirements:string;pricingUnit:string;pricingFactor:number;priceIncTax:number;taxRate:number;currency:string;validFrom:string;validTo:string;qtyFrom:number;qtyTo:number|null;freeReason:string;reference:string};
 'metal-quote-approve':{id:string;version:number};
 'metal-quote-retire':{id:string;version:number;reason:string};
 'metal-job-create':{date:string;lines:{demandId:string;demandVersion:number;quantity:number;quoteId:string;quoteVersion:number}[];note:string};
 'metal-job-cancel':{id:string;version:number;reason:string};
 'metal-job-release':{jobId:string;jobVersion:number;jobLineId:string;quantity:number;reason:string;reference:string};
 'metal-stock-add':{demandId:string;demandVersion:number;quantity:number;date:string;reference:string;note:string;evidenceAttachmentId:string};
 'metal-stock-confirm':{id:string;version:number};
 'metal-delivery-create':{date:string;dueDate:string;lines:{jobId:string;jobVersion:number;jobLineId:string;quantity:number}[];reference:string;note:string};
 'metal-delivery-dispatch':{id:string;version:number};
 'metal-delivery-cancel':{id:string;version:number;reason:string};
 'metal-delivery-sign':{id:string;version:number;signedAt:string;signedBy:string;reference:string};
 'metal-receipt-create':{deliveryId:string;deliveryVersion:number;deliveryLineId:string;quantity:number;date:string;reference:string;note:string};
 'metal-quality-create':{receiptId:string;receiptVersion:number;date:string;billableGood:number;freeGood:number;bad:number;note:string};
 'metal-rework-create':{qcId:string;qcVersion:number;quantity:number;date:string;dueDate:string;quoteId?:string;quoteVersion?:number;freeReason:string;reference:string;note:string};
 'metal-issue-create':{qcId:string;qcVersion:number;planId:string;planVersion:number;quantity:number;date:string;reference:string;note:string};
 'metal-settlement-create':{qcIds:string[];adjustmentIds?:string[];period:string;reference:string;note:string};
 'metal-settlement-confirm':{id:string;version:number};
 'metal-settlement-cancel':{id:string;version:number;reason:string};
 'metal-payment-create':{settlementId:string;settlementVersion:number;amount:number;date:string;reference:string;note:string};
 'metal-adjustment-create':{qcId:string;qcVersion:number;amountIncTax:number;reason:string;reference:string};
 'metal-adjustment-approve':{id:string;version:number};
 'metal-disposition-create':{qcId:string;qcVersion:number;quantity:number;date:string;type:'scrap'|'return';reason:string;reference:string};
 'metal-correction':{targetId:string;targetVersion:number;reason:string;reference:string};
};
export type MetalAction = keyof MetalPostInputs;
export type MetalRequest<A extends MetalAction> = MetalPostInputs[A] & {token:string};
export type MetalWriteResult = {ok:true;id:string;version:number};
