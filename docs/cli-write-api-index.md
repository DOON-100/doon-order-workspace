# CLI 写入 API 源码索引（W0 初筛）

本表静态扫描项目源码中的 `Post` 处理函数和其后的直接 action 条件，供逐批盘点使用；并非完整的接口清单，也不表示对应页面可写、已完成鉴权或已接入 CLI。动态前缀、映射表、调用链、外部发送、multipart/文件、共享辅助函数与字段 schema 均须人工展开。相同文件中的条件可能包含状态值或辅助分支，不能仅凭本表开放接口。请求字段与权限以各源码和服务端合成验收为准。

| 源码 | 处理函数 | 静态候选 action | 漏项提醒 |
| --- | --- | --- | --- |
| `lib/ar-customer-profiles-api.ts` | `arCustomerProfilesPost` | `ar-customer-profile-save`, `ar-invoice-extra-save`, `ar-invoice-source-link` | 条件和间接分发仍需核查 |
| `lib/ar-invoice-ledger-api.ts` | `arInvoiceLedgerPost` | `ar-invoice-import`, `ar-invoice-note`, `ar-invoice-proof`, `ar-invoice-reconcile`, `ar-invoice-statement` | 条件和间接分发仍需核查 |
| `lib/ar-master-ledger-api.ts` | `arMasterLedgerPost` | `ar-master-entry-save`, `ar-master-register-legacy`, `ar-master-source-link` | 条件和间接分发仍需核查 |
| `lib/ar-workspace-api.ts` | `arWorkspacePost` | `ar-access-grant-save`, `ar-source-binding-save` | 条件和间接分发仍需核查 |
| `lib/collaboration-api.ts` | `collaborationPost` | `accept-pmc`, `customer-import`, `customer-save`, `factory-order-save`, `factory-order-table-commit`, `factory-order-table-preview`, `factory-order-template`, `kingdee-template`, `pmc-confirm`, `return-business`, `save-pmc`, `service-confirm`, `submit-pmc`, `submit-service` | 条件和间接分发仍需核查 |
| `lib/customer-price-archive-api.ts` | `customerPriceArchivePost` | `customer-price-archive-file-upload`, `customer-price-archive-import`, `customer-price-selection-save` | 条件和间接分发仍需核查 |
| `lib/customer-project-api.ts` | `customerProjectPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/customer-project-finance-api.ts` | `customerProjectFinancePost` | `project-adjustment`, `project-after-sale-cost`, `project-after-sale-save`, `project-allocation`, `project-allocation-release`, `project-charge-confirm`, `project-charge-save`, `project-credit-apply`, `project-document-confirm`, `project-document-revise`, `project-document-save`, `project-document-sent`, `project-finance-entry-save`, `project-finance-grant-save`, `project-payment-notice`, `project-payment-requirement`, `project-receipt-reverse`, `project-receipt-verify`, `project-refund-cancel`, `project-refund-execute`, `project-refund-request` | 条件和间接分发仍需核查 |
| `lib/customer-project-followup-api.ts` | `customerProjectFollowupPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/customer-quote-api.ts` | `customerQuotePost` | `customer-quote-adopt-ie`, `customer-quote-confirm`, `customer-quote-media-upload`, `customer-quote-record-sent`, `customer-quote-revise`, `customer-quote-save`, `customer-quote-template-apply`, `customer-quote-template-archive`, `customer-quote-template-register`, `customer-quote-upload` | 条件和间接分发仍需核查 |
| `lib/customer-quote-policy-api.ts` | `customerQuotePolicyPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/customer-quote-template-api.ts` | `customerQuoteTemplatePost` | `customer-quote-template-apply`, `customer-quote-template-archive`, `customer-quote-template-register` | 条件和间接分发仍需核查 |
| `lib/customer-workflow-api.ts` | `customerWorkflowPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/drawing-correction-api.ts` | `drawingCorrectionPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/engineering-drawing-api.ts` | `engineeringDrawingPost` | `drawing-detail-add`, `drawing-email-intake`, `drawing-event-review`, `drawing-import`, `drawing-review`, `drawing-save` | 条件和间接分发仍需核查 |
| `lib/engineering-sop-api.ts` | `engineeringSopPost` | `sop-attachment`, `sop-cancel`, `sop-change`, `sop-confirm`, `sop-create`, `sop-mes-upload`, `sop-prepare`, `sop-target` | 条件和间接分发仍需核查 |
| `lib/finished-supplier-api.ts` | `finishedSupplierPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/fixed-data-tools-api.ts` | `fixedDataToolsPost` | `fixed-tool-fees-decision`, `fixed-tool-fees-preview`, `fixed-tool-workbook` | 条件和间接分发仍需核查 |
| `lib/handoff-business-api.ts` | `handoffBusinessPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/handoff-framework-api.ts` | `frameworkPost` | `framework-account-save`, `framework-config-save`, `framework-message-bind`, `framework-message-link`, `framework-message-process`, `framework-message-save`, `framework-notice-receive` | 前缀/映射需人工展开 |
| `lib/ie-quote-api.ts` | `ieQuotePost` | `ie-quote-catalog-save`, `ie-quote-policy`, `ie-quote-process-preset-save`, `ie-quote-review`, `ie-quote-revise`, `ie-quote-save`, `ie-quote-submit`, `ie-quote-tooling-register` | 条件和间接分发仍需核查 |
| `lib/ie-quote-notification-api.ts` | `ieQuoteNotificationPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/ie-quote-workbook-api.ts` | `ieWorkbookPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/kingdee-pending-api.ts` | `kingdeePendingPost` | `kingdee-pending-commit`, `kingdee-pending-preview` | 条件和间接分发仍需核查 |
| `lib/kingdee-sales-api.ts` | `kingdeeSalesPost` | `kingdee-sales-confirm`, `kingdee-sales-prepare`, `kingdee-sales-reconcile`, `kingdee-sales-save`, `kingdee-sales-source-commit`, `kingdee-sales-source-preview`, `kingdee-sales-upload`, `kingdee-sales-validate` | 条件和间接分发仍需核查 |
| `lib/kingdee-sync-api.ts` | `kingdeeSyncPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/loss-api.ts` | `lossPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/payment-terms-api.ts` | `paymentTermsPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/planning-control-api.ts` | `planningControlPost` | `planning-capacity-allocation-save`, `planning-capacity-allocation-transition`, `planning-capacity-window-save`, `planning-control-calculation-save`, `planning-control-save`, `planning-control-transition` | 条件和间接分发仍需核查 |
| `lib/pmc-api.ts` | `pmcPost` | `pmc-review`, `pmc-round`, `pmc-save` | 条件和间接分发仍需核查 |
| `lib/process-change-api.ts` | `processChangePost` | `process-change-cancel`, `process-change-confirm`, `process-change-preview` | 条件和间接分发仍需核查 |
| `lib/process-workspace-api.ts` | `processWorkspacePost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/project-collaboration-api.ts` | `projectCollaborationPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/purchase-api.ts` | `purchasePost` | `purchase-archive`, `purchase-receipt`, `purchase-save` | 条件和间接分发仍需核查 |
| `lib/purchase-change-api.ts` | `purchaseChangePost` | `purchase-change-cancel`, `purchase-change-confirm`, `purchase-change-preview` | 条件和间接分发仍需核查 |
| `lib/sales-color-fields-api.ts` | `salesColorFieldsPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/sales-order-sources-api.ts` | `salesOrderSourcesPost` | 未从直接条件提取 | 条件和间接分发仍需核查 |
| `lib/service-workspace-api.ts` | `serviceWorkspacePost` | `service-attachment`, `service-receipt`, `service-receipt-reverse`, `service-save` | 条件和间接分发仍需核查 |
| `lib/supplier-api.ts` | `supplierPost` | `outsource-approve`, `outsource-cancel`, `outsource-update`, `supplier-quote-file`, `supplier-quote-save`, `supplier-save` | 条件和间接分发仍需核查 |
| `lib/unified-communication-api.ts` | `unifiedCommunicationPost` | 未从直接条件提取 | 前缀/映射需人工展开 |
| `lib/operations.ts` | `operationPost` | `ledger-assign`, `ledger-commit`, `ledger-edit`, `ledger-lifecycle`, `ledger-preview`, `outsource-create`, `receipt-confirm`, `receipt-photo` | 条件和间接分发仍需核查 |
