// Synthetic only. Shared by native API and cross-checkout Studio tests.
export function seedPurchase(h,id='SYN-PURCHASE',patch={}){
 const row={id,kind:'purchase',version:1,sourceVersion:1,po:'SYN-PO-001',supplier:'合成供应商',buyer:'合成采购',itemCode:'SYN-ITEM',itemName:'合成镜片',unit:'件',quantity:100,orderDate:'2026-10-01',dueDate:'2026-10-30',customerOrder:'SYN-ORDER',auditStatus:'已审核',closeStatus:'未关闭',sourceNote:'SYN original note',sourceRow:4,sourceAsOf:'2026-10-20',sourceHash:'SYN-original-hash',sourceFile:'SYN-original.xlsx',sourceSheet:'SYN-sheet',sourceFilter:'SYN-filter',raw:{'原列':'SYN-原值'},promisedDate:'',expectedDate:'',nextFollowupDate:'',followupNote:'',balanceKnown:true,received:20,returnPending:0,lifecycle:'active',completedDate:'',archivedAt:'',archivedBy:'',archiveNote:'',...patch};
 h.put(row);return structuredClone(row);
}
