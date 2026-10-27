# 写入表单字段源码索引（W0 初筛）

此表由服务端源码中部分 Zod 对象声明的顶层字段静态提取，只是进一步盘点线索，不是可直接提交的完整 schema：`...` 表示共享字段未展开，嵌套字段、字段约束、默认值、权限、路由映射及副作用须阅读原文件并由对应批次测试。部分行是嵌套数据类型或内部 schema 而非独立 API，不应由此推断接口可用。无法静态识别的表单不在表中，必须结合 [页面覆盖清单](cli-write-coverage.md) 逐项补齐。

| 源码及行 | schema 键 | 可直接提取的顶层字段 |
| --- | --- | --- |
| `lib/customer-project-api.ts`:20 | `customerProjectSchemas.trash` | `id, version, token, reason` |
| `lib/customer-project-api.ts`:21 | `customerProjectSchemas.restore` | `id, version, token` |
| `lib/customer-project-api.ts`:22 | `customerProjectSchemas.assignment-roster-save` | `...mutation, token, serviceFollowerIds, salesReviewerIds` |
| `lib/customer-project-api.ts`:23 | `customerProjectSchemas.team-save` | `...mutation, name, leaderIds, salesMemberIds, serviceMemberIds, customerIds, active` |
| `lib/customer-project-api.ts`:24 | `customerProjectSchemas.save` | `...mutation, customerId, code, title, description, teamId, salesMemberId, serviceMemberId, serviceMemberIds, serviceReviewerId, salesReviewerId, dueDate, status, development` |
| `lib/customer-project-api.ts`:25 | `customerProjectSchemas.item-save` | `...mutation, projectId, model, customerModel, drawing, color, lens, material, requirements, quantity` |
| `lib/customer-project-api.ts`:26 | `customerProjectSchemas.round-save` | `...mutation, projectId, title, type, parentRoundId, scope, stage, requiredDrawingTypes, requireQuote, requiredSampleIds, sampleGateStage, sampleGateNote, dueDate, reason, status` |
| `lib/customer-project-api.ts`:27 | `customerProjectSchemas.communication` | `...append, channel, contact, occurredAt, content, nextAction, ownerId, dueDate, visibility, attachmentIds` |
| `lib/customer-project-api.ts`:28 | `customerProjectSchemas.task-save` | `...mutation, projectId, roundId, title, description, ownerId, serviceReviewerId, salesReviewerId, waitingFor, dueDate, status, result, changeReason` |
| `lib/customer-project-api.ts`:29 | `customerProjectSchemas.task-submit` | `token, projectId, id, version, result` |
| `lib/customer-project-api.ts`:30 | `customerProjectSchemas.task-review` | `token, projectId, id, version, stage, decision, comment` |
| `lib/customer-project-api.ts`:31 | `customerProjectSchemas.drawing` | `...append, roundId, itemIds, type, drawingNo, revision, previousId, pairedDrawingId, attachmentIds, changeNote` |
| `lib/customer-project-api.ts`:32 | `customerProjectSchemas.drawing-withdraw` | `id, version, reason` |
| `lib/customer-project-api.ts`:33 | `customerProjectSchemas.confirmation` | `...append, roundId, drawingId, itemIds, decision, contact, date, evidence, conditions, attachmentIds` |
| `lib/customer-project-api.ts`:34 | `customerProjectSchemas.quote-link` | `...append, roundId, itemIds, quoteId, quoteVersion, lineIds, acceptedBy, acceptedDate, evidence` |
| `lib/customer-project-api.ts`:35 | `customerProjectSchemas.sample-release` | `...append, roundId, roundVersion, purpose, scope, drawingIds, quoteLinkId, ownerId, requiredDate, note` |
| `lib/customer-project-api.ts`:36 | `customerProjectSchemas.sample-update` | `id, version, status, plannedDate, note` |
| `lib/customer-project-api.ts`:37 | `customerProjectSchemas.sample-promise` | `id, version, promisedDate, promiseNote` |
| `lib/customer-project-api.ts`:38 | `customerProjectSchemas.sample-dispatch` | `token, projectId, sampleId, lines, carrier, trackingNo, recipient, address, shipDate, receivedDate, note, attachmentIds` |
| `lib/customer-project-api.ts`:39 | `customerProjectSchemas.dispatch-receive` | `id, version, receivedDate` |
| `lib/customer-project-api.ts`:40 | `customerProjectSchemas.sample-feedback` | `token, projectId, sampleId, itemId, decision, contact, date, evidence, note, attachmentIds` |
| `lib/customer-project-api.ts`:41 | `customerProjectSchemas.bulk-link` | `...append, roundId, roundVersion, orderLinks, drawingIds, quoteLinkId` |
| `lib/customer-project-finance-api.ts`:16 | `entrySchemas.receipts` | `amount, currency, date, reference, payer, account, note` |
| `lib/customer-project-finance-api.ts`:17 | `entrySchemas.allocations` | `receiptId, chargeId, amount, currency, reason` |
| `lib/customer-project-finance-api.ts`:18 | `entrySchemas.adjustments` | `chargeId, caseId, type, amount, currency, prepay, reason, evidence` |
| `lib/customer-project-finance-api.ts`:19 | `entrySchemas.creditApplications` | `sourceChargeId, targetChargeId, amount, currency, reason, evidence` |
| `lib/customer-project-finance-api.ts`:20 | `entrySchemas.refunds` | `receiptId, caseId, amount, currency, reason, date, reference, account` |
| `lib/customer-project-finance-api.ts`:24 | `projectFinanceSchemas.project-finance-entry-save` | `...edit, ...token, projectId, roundId, entryType, data` |
| `lib/customer-project-finance-api.ts`:25 | `projectFinanceSchemas.project-charge-save` | `...edit, ...token, projectId, roundId, title, category, currency, amount, prepayAmount, dueDate, note, plan` |
| `lib/customer-project-finance-api.ts`:26 | `projectFinanceSchemas.project-charge-confirm` | `...token, id, version` |
| `lib/customer-project-finance-api.ts`:27 | `projectFinanceSchemas.project-payment-requirement` | `...token, projectId, roundId, mode, reason, version` |
| `lib/customer-project-finance-api.ts`:28 | `projectFinanceSchemas.project-payment-notice` | `...edit, ...token, projectId, roundId, amount, currency, reference, note` |
| `lib/customer-project-finance-api.ts`:29 | `projectFinanceSchemas.project-receipt-verify` | `...token, customerId, amount, currency, date, reference, payer, account, note, noticeIds` |
| `lib/customer-project-finance-api.ts`:30 | `projectFinanceSchemas.project-receipt-reverse` | `...token, receiptId, reason` |
| `lib/customer-project-finance-api.ts`:31 | `projectFinanceSchemas.project-allocation` | `...token, receiptId, chargeId, amount` |
| `lib/customer-project-finance-api.ts`:32 | `projectFinanceSchemas.project-allocation-release` | `...token, allocationId, amount, reason` |
| `lib/customer-project-finance-api.ts`:33 | `projectFinanceSchemas.project-adjustment` | `...token, chargeId, caseId, type, amount, prepay, reason, evidence` |
| `lib/customer-project-finance-api.ts`:34 | `projectFinanceSchemas.project-credit-apply` | `...token, sourceChargeId, targetChargeId, amount, reason, evidence` |
| `lib/customer-project-finance-api.ts`:35 | `projectFinanceSchemas.project-document-save` | `...edit, ...token, customerId, projectId, roundId, manualTitle, manualAmount, documentType, documentNo, chargeIds, currency, date, customerAddress, company, terms, adjustmentIds` |
| `lib/customer-project-finance-api.ts`:36 | `projectFinanceSchemas.project-document-confirm` | `...token, id, version` |
| `lib/customer-project-finance-api.ts`:37 | `projectFinanceSchemas.project-document-revise` | `...token, id, version, reason` |
| `lib/customer-project-finance-api.ts`:38 | `projectFinanceSchemas.project-document-sent` | `...token, id, sendId, version, projectId, roundId, documentId, date, recipient, reference` |
| `lib/customer-project-finance-api.ts`:39 | `projectFinanceSchemas.project-after-sale-save` | `...edit, ...token, projectId, roundId, orderId, shipmentReference, title, description, quantity, resolution, status, ownerMemberId, dueDate, customerEvidence, executionNote, returnedQuantity, completedQuantity, resentQuantity, trackingNo, customerAccepted` |
| `lib/customer-project-finance-api.ts`:40 | `projectFinanceSchemas.project-after-sale-cost` | `...edit, ...token, projectId, roundId, caseId, category, description, currency, budget, actual, bearer, supplierReference` |
| `lib/customer-project-finance-api.ts`:41 | `projectFinanceSchemas.project-refund-request` | `...token, projectId, roundId, receiptId, caseId, amount, reason` |
| `lib/customer-project-finance-api.ts`:42 | `projectFinanceSchemas.project-refund-execute` | `...token, id, version, date, reference, account` |
| `lib/customer-project-finance-api.ts`:43 | `projectFinanceSchemas.project-refund-cancel` | `...token, id, version, reason` |
| `lib/customer-project-finance-api.ts`:44 | `projectFinanceSchemas.project-finance-grant-save` | `...token, ...edit, memberId, customerIds, active` |
| `lib/customer-project-followup-api.ts`:19 | `customerProjectFollowupSchemas.classify` | `token, id, version, followupIds` |
| `lib/customer-project-followup-api.ts`:20 | `customerProjectFollowupSchemas.promote` | `token, id, version, customerId, teamId, title, description, code` |
| `lib/customer-project-followup-api.ts`:21 | `customerProjectFollowupSchemas.import` | `token, format, sourceKey, ownerId, followups, mails, sourceFiles` |
| `lib/payment-terms-api.ts`:10 | `schemas.authorize` | `token, id, version, reason` |
| `lib/payment-terms-api.ts`:11 | `schemas.disable` | `token, id, version, reason` |
| `lib/payment-terms-api.ts`:12 | `schemas.authorizers-save` | `token, version, authorizerMemberIds, reason` |
| `lib/project-collaboration-api.ts`:12 | `schemas.save` | `token, id, version, projectId, roundId, stepKey, department, ownerId, title, description, dueDate, reason` |
| `lib/project-collaboration-api.ts`:13 | `schemas.followup` | `...existing, comment, status` |
| `lib/project-collaboration-api.ts`:14 | `schemas.complete` | `...existing, comment` |
| `lib/project-collaboration-api.ts`:15 | `schemas.cancel` | `...existing, comment` |
| `lib/project-collaboration-api.ts`:16 | `schemas.acknowledge` | `...existing, comment` |
