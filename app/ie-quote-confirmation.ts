export type IeOfflineConfirmation={id:string;quoteId:string;quoteVersion:number;contentSha256:string;attachmentId:string;attachmentSha256:string;confirmedRole:string;evidence:string;recordedAt:string;recordedBy:string;recordedById:string};
export type IeOfflineConfirmationAttachment={id:string;originalName:string;size:number;sha256:string};
type ConfirmationQuote={id?:string;version?:number;status:string;offlineConfirmation?:IeOfflineConfirmation|null};

export const IE_OFFLINE_CONFIRMED_LABEL='工程主管已确认（线下）';
export const IE_QUOTE_STATUS_LABELS:Record<string,string>={draft:'工程草稿',submitted:'待工程复核',returned:'退回补充',released:'工程已释放'};
export function isIeOfflineConfirmed(quote:ConfirmationQuote,dirty=false){return !dirty&&!!quote.id&&quote.offlineConfirmation?.quoteId===quote.id&&quote.offlineConfirmation.quoteVersion===quote.version;}
export function ieQuoteDisplayStatus(quote:ConfirmationQuote,dirty=false){return isIeOfflineConfirmed(quote,dirty)?IE_OFFLINE_CONFIRMED_LABEL:dirty&&isIeOfflineConfirmed(quote)?'已修改 · 待保存':IE_QUOTE_STATUS_LABELS[quote.status]||quote.status;}
export function ieQuoteFilterStatus(quote:ConfirmationQuote){return isIeOfflineConfirmed(quote)?'offline-confirmed':quote.status;}
export function ieQuoteWorkbookDownloadText(quote:ConfirmationQuote){return isIeOfflineConfirmed(quote)?{label:'下载已确认报价 Excel',suffix:'已确认报价',notice:'已下载当前主管线下确认版本的报价 Excel。原始空白项目继续保留，可在修改新版本时补充。'}:{label:'下载 Excel 填写草稿',suffix:'填写草稿',notice:'已下载当前保存版本的 Excel 填写草稿。材料空价按 0（历史版本按原规则）；其他未定项目保留空白，不能作为已审核报价。'};}
