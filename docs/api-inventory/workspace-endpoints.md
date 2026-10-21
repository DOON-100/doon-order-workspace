# 中台工作区接口逐项清单

由 `node scripts/audit-api-inventory.mjs` 静态生成；不要手改。总体结论、原生认证/调度接口和范围说明见[清点报告](../api-inventory.md)。

按 HTTP 方法 + action 去重，共 **358 项**，其中 GET 119、POST 239。所有 action 的路径前缀为 `/api/workspace/`。

“动作索引”仅帮助检索，不是 CRUD 授权声明；保存可能仅更新或兼有新增，取消/退回/退货不是物理删除。GET 不自动证明零副作用。权限说明为模块入口摘要，完整判定仍需沿处理器及其调用的规则函数核对。页面引用仅证明存在字符串引用，不证明请求方法、页面可见性或执行成功。

## 模块索引

| 模块 | GET | POST | 总计 |
| --- | ---: | ---: | ---: |
| [订单总表、导入、附件与成员](#module-1) | 7 | 14 | 21 |
| [订单工序、外发收货与原表](#module-2) | 3 | 8 | 11 |
| [客户主档、工厂订单与金蝶模板](#module-3) | 7 | 8 | 15 |
| [销售颜色字段库](#module-4) | 1 | 1 | 2 |
| [供应商与外协](#module-5) | 4 | 6 | 10 |
| [损耗](#module-6) | 1 | 1 | 2 |
| [采购跟单](#module-7) | 4 | 5 | 9 |
| [PMC 核单](#module-8) | 1 | 3 | 4 |
| [成品供应商协作](#module-9) | 2 | 16 | 18 |
| [金蝶待核对](#module-10) | 2 | 2 | 4 |
| [金蝶采购仅新增同步](#module-11) | 2 | 1 | 3 |
| [金蝶采购只读查询](#module-12) | 2 | 0 | 2 |
| [部门流程记录](#module-13) | 2 | 1 | 3 |
| [采购变更人工确认](#module-14) | 2 | 3 | 5 |
| [流程变更人工确认](#module-15) | 2 | 3 | 5 |
| [计划与产能](#module-16) | 2 | 6 | 8 |
| [工程画图](#module-17) | 2 | 6 | 8 |
| [图号更正](#module-18) | 0 | 1 | 1 |
| [工程 SOP](#module-19) | 3 | 8 | 11 |
| [客服业务](#module-20) | 3 | 4 | 7 |
| [客户报价](#module-21) | 6 | 6 | 12 |
| [客户报价授权配置](#module-22) | 0 | 1 | 1 |
| [报价模板](#module-23) | 4 | 3 | 7 |
| [历史价格原件](#module-24) | 3 | 3 | 6 |
| [客户档案与跟进](#module-25) | 3 | 3 | 6 |
| [客户文件与轻量项目](#module-26) | 4 | 5 | 9 |
| [客户待办](#module-27) | 2 | 1 | 3 |
| [客户公海与交接](#module-28) | 1 | 10 | 11 |
| [客户项目、样办与回收站](#module-29) | 3 | 24 | 27 |
| [项目跨部门协作](#module-30) | 1 | 5 | 6 |
| [项目跟进与历史邮件](#module-31) | 3 | 4 | 7 |
| [项目财务](#module-32) | 3 | 21 | 24 |
| [应收工作台与授权](#module-33) | 4 | 2 | 6 |
| [发票原件与对账](#module-34) | 3 | 5 | 8 |
| [应收客户模板](#module-35) | 1 | 3 | 4 |
| [应收总表](#module-36) | 2 | 3 | 5 |
| [正式财务单据](#module-37) | 0 | 3 | 3 |
| [付款条件](#module-38) | 1 | 4 | 5 |
| [业务交接与单据](#module-39) | 5 | 6 | 11 |
| [交接定金与例外](#module-40) | 0 | 2 | 2 |
| [交接服务配置](#module-41) | 0 | 1 | 1 |
| [生产审核规则与采纳](#module-42) | 0 | 2 | 2 |
| [沟通渠道、规则文档与通知](#module-43) | 7 | 7 | 14 |
| [财务协作任务](#module-44) | 3 | 6 | 9 |
| [离职交接](#module-45) | 2 | 4 | 6 |
| [人工沟通草稿](#module-46) | 2 | 4 | 6 |
| [固定数据工具](#module-47) | 3 | 2 | 5 |
| [固定报价费用工具](#module-48) | 1 | 2 | 3 |

<a id="module-1"></a>

## 订单总表、导入、附件与成员

权限入口：actor、canRead、allowedFields、requireAdmin/requirePMC；原生 member 新增另有限制。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `attachment` | 新增/登记/上传 | [POST:198](../../app/api/workspace/%5Baction%5D/route.ts#L198) | [app/customer-project-entry-forms.ts:32](../../app/customer-project-entry-forms.ts#L32) |
| GET | `backup` | 查询/历史/能力 | [workspaceGet:128](../../app/api/workspace/%5Baction%5D/route.ts#L128) | [app/support-panels.tsx:37](../../app/support-panels.tsx#L37) |
| GET | `business-team-data` | 查询/历史/能力 | [workspaceRead:162](../../app/api/workspace/%5Baction%5D/route.ts#L162) | [app/workspace-read-queue.ts:20](../../app/workspace-read-queue.ts#L20) |
| POST | `comment` | 新增/登记/上传 | [POST:231](../../app/api/workspace/%5Baction%5D/route.ts#L231) | [app/customer-project-panel.tsx:252](../../app/customer-project-panel.tsx#L252) |
| POST | `commit-import` | 解析/预览/导入（不能假定无副作用） | [POST:219](../../app/api/workspace/%5Baction%5D/route.ts#L219) | [app/import-panel.tsx:26](../../app/import-panel.tsx#L26) |
| POST | `correction` | 修改/关联/指派 | [POST:262](../../app/api/workspace/%5Baction%5D/route.ts#L262) | [app/purchase-panel.tsx:35](../../app/purchase-panel.tsx#L35) |
| GET | `data` | 查询/历史/能力 | [workspaceGet:116](../../app/api/workspace/%5Baction%5D/route.ts#L116) | [app/customer-directory-panel.tsx:104](../../app/customer-directory-panel.tsx#L104) |
| POST | `edit-order` | 修改/关联/指派 | [POST:220](../../app/api/workspace/%5Baction%5D/route.ts#L220) | [app/detail-panel.tsx:21](../../app/detail-panel.tsx#L21) |
| POST | `enroll` | 专用业务动作 | [POST:168](../../app/api/workspace/%5Baction%5D/route.ts#L168) | [app/assignment-panel.tsx:16](../../app/assignment-panel.tsx#L16) |
| POST | `export` | 专用业务动作 | [POST:197](../../app/api/workspace/%5Baction%5D/route.ts#L197) | [app/workspace.tsx:130](../../app/workspace.tsx#L130) |
| GET | `file` | 读取/文件/导出 | [workspaceGet:118](../../app/api/workspace/%5Baction%5D/route.ts#L118) | [app/ar-invoice-ledger-panel.tsx:112](../../app/ar-invoice-ledger-panel.tsx#L112) |
| POST | `inspect` | 解析/预览/导入（不能假定无副作用） | [POST:198](../../app/api/workspace/%5Baction%5D/route.ts#L198) | [app/fixed-data-tools-panel.tsx:21](../../app/fixed-data-tools-panel.tsx#L21) |
| GET | `job` | 查询/历史/能力 | [workspaceGet:117](../../app/api/workspace/%5Baction%5D/route.ts#L117) | [app/import-panel.tsx:27](../../app/import-panel.tsx#L27) |
| POST | `match` | 修改/关联/指派 | [POST:257](../../app/api/workspace/%5Baction%5D/route.ts#L257) | [app/support-panels.tsx:18](../../app/support-panels.tsx#L18) |
| POST | `member` | 保存（具体新增/修改见实现） | [POST:238](../../app/api/workspace/%5Baction%5D/route.ts#L238) | [app/support-panels.tsx:36](../../app/support-panels.tsx#L36) |
| POST | `pack` | 专用业务动作 | [POST:196](../../app/api/workspace/%5Baction%5D/route.ts#L196) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `preview` | 解析/预览/导入（不能假定无副作用） | [POST:198](../../app/api/workspace/%5Baction%5D/route.ts#L198) | [app/import-panel.tsx:25](../../app/import-panel.tsx#L25) |
| GET | `read-version` | 查询/历史/能力 | [GET:133](../../app/api/workspace/%5Baction%5D/route.ts#L133) | [app/workspace-read-queue.ts:104](../../app/workspace-read-queue.ts#L104) |
| POST | `review` | 专用业务动作 | [POST:266](../../app/api/workspace/%5Baction%5D/route.ts#L266) | [app/customer-quote-panel.tsx:229](../../app/customer-quote-panel.tsx#L229) |
| POST | `task` | 专用业务动作 | [POST:235](../../app/api/workspace/%5Baction%5D/route.ts#L235) | [app/customer-project-entry-forms.ts:31](../../app/customer-project-entry-forms.ts#L31) |
| GET | `template` | 读取/文件/导出 | [workspaceGet:124](../../app/api/workspace/%5Baction%5D/route.ts#L124) | [app/handoff-framework-panel.tsx:56](../../app/handoff-framework-panel.tsx#L56) |

<a id="module-2"></a>

## 订单工序、外发收货与原表

权限入口：canRead、departmentColumns、mayReceive、canCreateOutsource、PMC 范围及生产闸门。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `ledger-assign` | 修改/关联/指派 | [operationPost:83](../../lib/operations.ts#L83) | [app/assignment-panel.tsx:15](../../app/assignment-panel.tsx#L15) |
| POST | `ledger-commit` | 解析/预览/导入（不能假定无副作用） | [operationPost:66](../../lib/operations.ts#L66) | [app/ledger-panels.tsx:25](../../app/ledger-panels.tsx#L25) |
| POST | `ledger-edit` | 修改/关联/指派 | [operationPost:74](../../lib/operations.ts#L74) | [app/ledger-panels.tsx:56](../../app/ledger-panels.tsx#L56) |
| GET | `ledger-export` | 读取/文件/导出 | [operationGet:40](../../lib/operations.ts#L40) | [app/ledger-panels.tsx:20](../../app/ledger-panels.tsx#L20) |
| GET | `ledger-file` | 读取/文件/导出 | [operationGet:35](../../lib/operations.ts#L35) | [app/ledger-panels.tsx:28](../../app/ledger-panels.tsx#L28) |
| POST | `ledger-lifecycle` | 取消/回收/归档/恢复等状态动作 | [operationPost:78](../../lib/operations.ts#L78) | [app/ledger-panels.tsx:57](../../app/ledger-panels.tsx#L57) |
| POST | `ledger-preview` | 解析/预览/导入（不能假定无副作用） | [operationPost:55](../../lib/operations.ts#L55) | [app/ledger-panels.tsx:24](../../app/ledger-panels.tsx#L24) |
| GET | `metric-export` | 读取/文件/导出 | [operationGet:29](../../lib/operations.ts#L29) | [app/metric-details.tsx:32](../../app/metric-details.tsx#L32) |
| POST | `outsource-create` | 新增/登记/上传 | [operationPost:89](../../lib/operations.ts#L89) | [app/receiving-panel.tsx:21](../../app/receiving-panel.tsx#L21) |
| POST | `receipt-confirm` | 专用业务动作 | [operationPost:107](../../lib/operations.ts#L107) | [app/receiving-panel.tsx:23](../../app/receiving-panel.tsx#L23) |
| POST | `receipt-photo` | 新增/登记/上传 | [operationPost:101](../../lib/operations.ts#L101) | [app/receiving-panel.tsx:22](../../app/receiving-panel.tsx#L22) |

<a id="module-3"></a>

## 客户主档、工厂订单与金蝶模板

权限入口：客户主档能力、客户责任、roles、订单/工厂范围和模板权限。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `customer-import` | 解析/预览/导入（不能假定无副作用） | [collaborationPost:133](../../lib/collaboration-api.ts#L133) | [app/customer-directory-panel.tsx:118](../../app/customer-directory-panel.tsx#L118) |
| GET | `customer-master-capabilities` | 查询/历史/能力 | [collaborationGet:69](../../lib/collaboration-api.ts#L69) | [app/customer-directory-panel.tsx:66](../../app/customer-directory-panel.tsx#L66) |
| POST | `customer-save` | 保存（具体新增/修改见实现） | [collaborationPost:157](../../lib/collaboration-api.ts#L157) | [app/customer-directory-panel.tsx:97](../../app/customer-directory-panel.tsx#L97) |
| GET | `customer-template` | 读取/文件/导出 | [collaborationGet:83](../../lib/collaboration-api.ts#L83) | [app/customer-directory-panel.tsx:139](../../app/customer-directory-panel.tsx#L139) |
| GET | `factory-order-export` | 读取/文件/导出 | [collaborationGet:90](../../lib/collaboration-api.ts#L90) | [app/factory-order-panel.tsx:36](../../app/factory-order-panel.tsx#L36) |
| POST | `factory-order-save` | 保存（具体新增/修改见实现） | [collaborationPost:180](../../lib/collaboration-api.ts#L180) | [app/factory-order-panel.tsx:29](../../app/factory-order-panel.tsx#L29) |
| POST | `factory-order-table-commit` | 解析/预览/导入（不能假定无副作用） | [collaborationPost:124](../../lib/collaboration-api.ts#L124) | [app/factory-order-panel.tsx:34](../../app/factory-order-panel.tsx#L34) |
| GET | `factory-order-table-export` | 读取/文件/导出 | [collaborationGet:71](../../lib/collaboration-api.ts#L71) | [app/factory-order-panel.tsx:35](../../app/factory-order-panel.tsx#L35) |
| POST | `factory-order-table-preview` | 解析/预览/导入（不能假定无副作用） | [collaborationPost:103](../../lib/collaboration-api.ts#L103) | [app/factory-order-panel.tsx:22](../../app/factory-order-panel.tsx#L22) |
| POST | `factory-order-template` | 专用业务动作 | [collaborationPost:97](../../lib/collaboration-api.ts#L97) | [app/factory-order-panel.tsx:22](../../app/factory-order-panel.tsx#L22) |
| GET | `factory-order-templates` | 读取/文件/导出 | [collaborationGet:81](../../lib/collaboration-api.ts#L81) | [app/factory-order-panel.tsx:21](../../app/factory-order-panel.tsx#L21) |
| GET | `factory-orders` | 查询/历史/能力 | [collaborationGet:82](../../lib/collaboration-api.ts#L82) | [app/business-process-panel.tsx:16](../../app/business-process-panel.tsx#L16) |
| GET | `kingdee-export` | 读取/文件/导出 | [collaborationGet:84](../../lib/collaboration-api.ts#L84) | [app/customer-directory-panel.tsx:139](../../app/customer-directory-panel.tsx#L139) |
| POST | `kingdee-template` | 专用业务动作 | [collaborationPost:154](../../lib/collaboration-api.ts#L154) | [app/customer-directory-panel.tsx:118](../../app/customer-directory-panel.tsx#L118) |
| POST | `workflow` | 专用业务动作 | [collaborationPost:183](../../lib/collaboration-api.ts#L183) | [app/collaboration-panel.tsx:26](../../app/collaboration-panel.tsx#L26) |

<a id="module-4"></a>

## 销售颜色字段库

权限入口：在职内部成员读取标准标题；客户规则按既有客户/订单及业务组范围；配置仅管理员、版本与幂等校验。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `sales-color-fields-data` | 查询/历史/能力 | [salesColorFieldsGet:33](../../lib/sales-color-fields-api.ts#L33) | [app/sales-color-fields-panel.tsx:42](../../app/sales-color-fields-panel.tsx#L42) |
| POST | `sales-color-fields-save` | 保存（具体新增/修改见实现） | [salesColorFieldsPost:44](../../lib/sales-color-fields-api.ts#L44) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-5"></a>

## 供应商与外协

权限入口：managesSuppliers、canSeeSupplierPrice、订单/工序权限及审批责任。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `outsource-approve` | 专用业务动作 | [supplierPost:32](../../lib/supplier-api.ts#L32) | [app/supplier-panel.tsx:61](../../app/supplier-panel.tsx#L61) |
| POST | `outsource-cancel` | 取消/回收/归档/恢复等状态动作 | [supplierPost:32](../../lib/supplier-api.ts#L32) | [app/supplier-panel.tsx:43](../../app/supplier-panel.tsx#L43) |
| POST | `outsource-update` | 修改/关联/指派 | [supplierPost:32](../../lib/supplier-api.ts#L32) | [app/supplier-panel.tsx:41](../../app/supplier-panel.tsx#L41) |
| GET | `supplier-export` | 读取/文件/导出 | [supplierGet:24](../../lib/supplier-api.ts#L24) | [app/supplier-panel.tsx:60](../../app/supplier-panel.tsx#L60) |
| GET | `supplier-quote-export` | 读取/文件/导出 | [supplierGet:21](../../lib/supplier-api.ts#L21) | [app/supplier-quote-panel.tsx:22](../../app/supplier-quote-panel.tsx#L22) |
| GET | `supplier-quote-file` | 读取/文件/导出 | [supplierGet:18](../../lib/supplier-api.ts#L18) | [app/supplier-quote-panel.tsx:19](../../app/supplier-quote-panel.tsx#L19) |
| POST | `supplier-quote-file` | 专用业务动作 | [supplierPost:32](../../lib/supplier-api.ts#L32) | [app/supplier-quote-panel.tsx:19](../../app/supplier-quote-panel.tsx#L19) |
| POST | `supplier-quote-save` | 保存（具体新增/修改见实现） | [supplierPost:32](../../lib/supplier-api.ts#L32) | [app/supplier-quote-panel.tsx:20](../../app/supplier-quote-panel.tsx#L20) |
| GET | `supplier-quote-template` | 读取/文件/导出 | [supplierGet:13](../../lib/supplier-api.ts#L13) | [app/supplier-quote-panel.tsx:22](../../app/supplier-quote-panel.tsx#L22) |
| POST | `supplier-save` | 保存（具体新增/修改见实现） | [supplierPost:32](../../lib/supplier-api.ts#L32) | [app/supplier-panel.tsx:42](../../app/supplier-panel.tsx#L42) |

<a id="module-6"></a>

## 损耗

权限入口：订单可见性、部门损耗确认权限及来源版本。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `loss-export` | 读取/文件/导出 | [lossGet:37](../../lib/loss-api.ts#L37) | [app/loss-panel.tsx:36](../../app/loss-panel.tsx#L36) |
| POST | `loss-record` | 专用业务动作 | [lossPost:12](../../lib/loss-api.ts#L12) | [app/loss-panel.tsx:30](../../app/loss-panel.tsx#L30) |

<a id="module-7"></a>

## 采购跟单

权限入口：visiblePurchases；维护 manage/broad；来源、数量、归档条件校验。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `purchase-archive` | 取消/回收/归档/恢复等状态动作 | [post:25](../../lib/purchase-api.ts#L25) | [app/purchase-panel.tsx:56](../../app/purchase-panel.tsx#L56) |
| POST | `purchase-commit` | 解析/预览/导入（不能假定无副作用） | [post:42](../../lib/purchase-api.ts#L42) | [app/purchase-panel.tsx:54](../../app/purchase-panel.tsx#L54) |
| GET | `purchase-data` | 查询/历史/能力 | [purchaseGet:17](../../lib/purchase-api.ts#L17) | [app/purchase-panel.tsx:19](../../app/purchase-panel.tsx#L19) |
| GET | `purchase-export` | 读取/文件/导出 | [purchaseGet:19](../../lib/purchase-api.ts#L19) | [app/purchase-panel.tsx:38](../../app/purchase-panel.tsx#L38) |
| GET | `purchase-held` | 查询/历史/能力 | [purchaseGet:20](../../lib/purchase-api.ts#L20) | [app/purchase-panel.tsx:54](../../app/purchase-panel.tsx#L54) |
| GET | `purchase-history` | 查询/历史/能力 | [purchaseGet:18](../../lib/purchase-api.ts#L18) | [app/purchase-panel.tsx:34](../../app/purchase-panel.tsx#L34) |
| POST | `purchase-preview` | 解析/预览/导入（不能假定无副作用） | [post:27](../../lib/purchase-api.ts#L27) | [app/purchase-panel.tsx:54](../../app/purchase-panel.tsx#L54) |
| POST | `purchase-receipt` | 专用业务动作 | [post:25](../../lib/purchase-api.ts#L25) | [app/purchase-panel.tsx:36](../../app/purchase-panel.tsx#L36) |
| POST | `purchase-save` | 保存（具体新增/修改见实现） | [post:25](../../lib/purchase-api.ts#L25) | [app/purchase-panel.tsx:31](../../app/purchase-panel.tsx#L31) |

<a id="module-8"></a>

## PMC 核单

权限入口：access、订单/生产范围；核对轮次与版本。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `pmc-data` | 查询/历史/能力 | [pmcGet:14](../../lib/pmc-api.ts#L14) | [app/pmc-panel.tsx:31](../../app/pmc-panel.tsx#L31) |
| POST | `pmc-review` | 专用业务动作 | [pmcPost:21](../../lib/pmc-api.ts#L21) | [app/pmc-panel.tsx:90](../../app/pmc-panel.tsx#L90) |
| POST | `pmc-round` | 专用业务动作 | [pmcPost:21](../../lib/pmc-api.ts#L21) | [app/pmc-panel.tsx:141](../../app/pmc-panel.tsx#L141) |
| POST | `pmc-save` | 保存（具体新增/修改见实现） | [pmcPost:21](../../lib/pmc-api.ts#L21) | [app/pmc-panel.tsx:67](../../app/pmc-panel.tsx#L67) |

<a id="module-9"></a>

## 成品供应商协作

权限入口：authenticated、employee、供应商身份及任务分配；阶段分别校验。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `finished-supplier-accept` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-attachment` | 新增/登记/上传 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-baseline-confirm` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-baseline-stage` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-close` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `finished-supplier-data` | 查询/历史/能力 | [finishedSupplierGet:62](../../lib/finished-supplier-api.ts#L62) | [app/finished-supplier-panel.tsx:55](../../app/finished-supplier-panel.tsx#L55) |
| POST | `finished-supplier-exception` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `finished-supplier-file` | 读取/文件/导出 | [finishedSupplierGet:62](../../lib/finished-supplier-api.ts#L62) | [app/finished-supplier-panel.tsx:137](../../app/finished-supplier-panel.tsx#L137) |
| POST | `finished-supplier-order-confirm` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-progress` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-promise` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-qc` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-receive` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-return` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-rework-confirm` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-shipment` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-stock` | 专用业务动作 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `finished-supplier-task-create` | 新增/登记/上传 | [finishedSupplierPost:71](../../lib/finished-supplier-api.ts#L71) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-10"></a>

## 金蝶待核对

权限入口：读取范围与维护角色；原表下载和导入权限。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `kingdee-pending-commit` | 解析/预览/导入（不能假定无副作用） | [kingdeePendingPost:37](../../lib/kingdee-pending-api.ts#L37) | [app/kingdee-pending-panel.tsx:58](../../app/kingdee-pending-panel.tsx#L58) |
| GET | `kingdee-pending-data` | 查询/历史/能力 | [kingdeePendingGet:14](../../lib/kingdee-pending-api.ts#L14) | [app/kingdee-pending-panel.tsx:30](../../app/kingdee-pending-panel.tsx#L30) |
| GET | `kingdee-pending-file` | 读取/文件/导出 | [kingdeePendingGet:14](../../lib/kingdee-pending-api.ts#L14) | [app/kingdee-pending-panel.tsx:52](../../app/kingdee-pending-panel.tsx#L52) |
| POST | `kingdee-pending-preview` | 解析/预览/导入（不能假定无副作用） | [kingdeePendingPost:37](../../lib/kingdee-pending-api.ts#L37) | [app/kingdee-pending-panel.tsx:58](../../app/kingdee-pending-panel.tsx#L58) |

<a id="module-11"></a>

## 金蝶采购仅新增同步

权限入口：有效PMC/管理员、全表范围；金蝶只读，每批最多30条中台新增、去重及回执。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `kingdee-sync-ready` | 查询/历史/能力 | [kingdeeSyncGet:27](../../lib/kingdee-sync-api.ts#L27) | [app/kingdee-sync-button.tsx:15](../../app/kingdee-sync-button.tsx#L15) |
| GET | `kingdee-sync-result` | 查询/历史/能力 | [kingdeeSyncGet:31](../../lib/kingdee-sync-api.ts#L31) | [app/kingdee-sync-button.tsx:22](../../app/kingdee-sync-button.tsx#L22) |
| POST | `kingdee-sync-run` | 专用业务动作 | [kingdeeSyncPost:41](../../lib/kingdee-sync-api.ts#L41) | [app/kingdee-sync-button.tsx:25](../../app/kingdee-sync-button.tsx#L25) |

<a id="module-12"></a>

## 金蝶采购只读查询

权限入口：有效PMC/管理员、全表范围；只读外部API查询，零业务写入。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `kingdee-readonly-query` | 查询/历史/能力 | [kingdeeReadonlyGet:64](../../lib/kingdee-readonly-api.ts#L64) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `kingdee-readonly-status` | 查询/历史/能力 | [kingdeeReadonlyGet:64](../../lib/kingdee-readonly-api.ts#L64) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-13"></a>

## 部门流程记录

权限入口：requestTeam、canWriteProcessKind、canEditProcessRecord；客户/订单关联。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `process-data` | 查询/历史/能力 | [processWorkspaceGet:43](../../lib/process-workspace-api.ts#L43) | [app/process-workspace-panel.tsx:63](../../app/process-workspace-panel.tsx#L63) |
| GET | `process-history` | 查询/历史/能力 | [processWorkspaceGet:43](../../lib/process-workspace-api.ts#L43) | [app/process-workspace-panel.tsx:67](../../app/process-workspace-panel.tsx#L67) |
| POST | `process-save` | 保存（具体新增/修改见实现） | [processWorkspacePost:96](../../lib/process-workspace-api.ts#L96) | [app/process-workspace-panel.tsx:105](../../app/process-workspace-panel.tsx#L105) |

<a id="module-14"></a>

## 采购变更人工确认

权限入口：本人权限、完整载荷、版本、来源与数量效果绑定；五种动作复用原采购执行规则。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `purchase-change` | 查询/历史/能力 | [purchaseChangeGet:47](../../lib/purchase-change-api.ts#L47) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `purchase-change-cancel` | 取消/回收/归档/恢复等状态动作 | [purchaseChangePost:48](../../lib/purchase-change-api.ts#L48) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `purchase-change-confirm` | 专用业务动作 | [purchaseChangePost:48](../../lib/purchase-change-api.ts#L48) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `purchase-change-contract` | 查询/历史/能力 | [purchaseChangeGet:47](../../lib/purchase-change-api.ts#L47) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `purchase-change-preview` | 解析/预览/导入（不能假定无副作用） | [purchaseChangePost:48](../../lib/purchase-change-api.ts#L48) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-15"></a>

## 流程变更人工确认

权限入口：本人身份、同源、完整预览摘要、来源/规则版本及有效期；复用原流程保存校验。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `process-change` | 查询/历史/能力 | [processChangeGet:15](../../lib/process-change-api.ts#L15) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `process-change-cancel` | 取消/回收/归档/恢复等状态动作 | [processChangePost:16](../../lib/process-change-api.ts#L16) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `process-change-confirm` | 专用业务动作 | [processChangePost:16](../../lib/process-change-api.ts#L16) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `process-change-contract` | 查询/历史/能力 | [processChangeGet:15](../../lib/process-change-api.ts#L15) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `process-change-preview` | 解析/预览/导入（不能假定无副作用） | [processChangePost:16](../../lib/process-change-api.ts#L16) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-16"></a>

## 计划与产能

权限入口：currentMember、visible、planningManager、ownerProgress；业务组范围。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `planning-capacity-allocation-save` | 保存（具体新增/修改见实现） | [planningControlPost:76](../../lib/planning-control-api.ts#L76) | [app/planning-control-panel.tsx:135](../../app/planning-control-panel.tsx#L135) |
| POST | `planning-capacity-allocation-transition` | 专用业务动作 | [planningControlPost:76](../../lib/planning-control-api.ts#L76) | [app/planning-control-panel.tsx:136](../../app/planning-control-panel.tsx#L136) |
| POST | `planning-capacity-window-save` | 保存（具体新增/修改见实现） | [planningControlPost:76](../../lib/planning-control-api.ts#L76) | [app/planning-control-panel.tsx:134](../../app/planning-control-panel.tsx#L134) |
| POST | `planning-control-calculation-save` | 保存（具体新增/修改见实现） | [planningControlPost:76](../../lib/planning-control-api.ts#L76) | [app/planning-control-panel.tsx:132](../../app/planning-control-panel.tsx#L132) |
| GET | `planning-control-data` | 查询/历史/能力 | [planningControlGet:68](../../lib/planning-control-api.ts#L68) | [app/planning-control-panel.tsx:76](../../app/planning-control-panel.tsx#L76) |
| GET | `planning-control-history` | 查询/历史/能力 | [planningControlGet:68](../../lib/planning-control-api.ts#L68) | [app/planning-control-panel.tsx:80](../../app/planning-control-panel.tsx#L80) |
| POST | `planning-control-save` | 保存（具体新增/修改见实现） | [planningControlPost:76](../../lib/planning-control-api.ts#L76) | [app/planning-control-panel.tsx:131](../../app/planning-control-panel.tsx#L131) |
| POST | `planning-control-transition` | 专用业务动作 | [planningControlPost:76](../../lib/planning-control-api.ts#L76) | [app/planning-control-panel.tsx:133](../../app/planning-control-panel.tsx#L133) |

<a id="module-17"></a>

## 工程画图

权限入口：画图读取/维护、客户范围、事件审核及字段权限。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `drawing-data` | 查询/历史/能力 | [engineeringDrawingGet:36](../../lib/engineering-drawing-api.ts#L36) | [app/engineering-department-panel.tsx:14](../../app/engineering-department-panel.tsx#L14) |
| POST | `drawing-detail-add` | 新增/登记/上传 | [engineeringDrawingPost:51](../../lib/engineering-drawing-api.ts#L51) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `drawing-email-intake` | 专用业务动作 | [engineeringDrawingPost:51](../../lib/engineering-drawing-api.ts#L51) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `drawing-event-review` | 专用业务动作 | [engineeringDrawingPost:51](../../lib/engineering-drawing-api.ts#L51) | [app/engineering-drawing-panel.tsx:92](../../app/engineering-drawing-panel.tsx#L92) |
| GET | `drawing-history` | 查询/历史/能力 | [engineeringDrawingGet:36](../../lib/engineering-drawing-api.ts#L36) | [app/engineering-drawing-panel.tsx:49](../../app/engineering-drawing-panel.tsx#L49) |
| POST | `drawing-import` | 解析/预览/导入（不能假定无副作用） | [engineeringDrawingPost:51](../../lib/engineering-drawing-api.ts#L51) | [standalone/verify-engineering-drawing-release.mjs:32](../../standalone/verify-engineering-drawing-release.mjs#L32) |
| POST | `drawing-review` | 专用业务动作 | [engineeringDrawingPost:51](../../lib/engineering-drawing-api.ts#L51) | [app/engineering-drawing-panel.tsx:48](../../app/engineering-drawing-panel.tsx#L48) |
| POST | `drawing-save` | 保存（具体新增/修改见实现） | [engineeringDrawingPost:51](../../lib/engineering-drawing-api.ts#L51) | [app/engineering-drawing-panel.tsx:47](../../app/engineering-drawing-panel.tsx#L47) |

<a id="module-18"></a>

## 图号更正

权限入口：canCorrectDrawing；订单范围、版本与历史关联保护。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `drawing-correction` | 修改/关联/指派 | [drawingCorrectionPost:10](../../lib/drawing-correction-api.ts#L10) | [app/drawing-correction-panel.tsx:19](../../app/drawing-correction-panel.tsx#L19) |

<a id="module-19"></a>

## 工程 SOP

权限入口：canReadSop、manage、canInstructDrawing；图纸/客户关联。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `sop-attachment` | 新增/登记/上传 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:38](../../app/engineering-sop-panel.tsx#L38) |
| POST | `sop-cancel` | 取消/回收/归档/恢复等状态动作 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `sop-change` | 专用业务动作 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:47](../../app/engineering-sop-panel.tsx#L47) |
| POST | `sop-confirm` | 专用业务动作 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:57](../../app/engineering-sop-panel.tsx#L57) |
| POST | `sop-create` | 新增/登记/上传 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:47](../../app/engineering-sop-panel.tsx#L47) |
| GET | `sop-data` | 查询/历史/能力 | [engineeringSopGet:22](../../lib/engineering-sop-api.ts#L22) | [app/engineering-department-panel.tsx:14](../../app/engineering-department-panel.tsx#L14) |
| GET | `sop-file` | 读取/文件/导出 | [engineeringSopGet:22](../../lib/engineering-sop-api.ts#L22) | [app/engineering-sop-panel.tsx:59](../../app/engineering-sop-panel.tsx#L59) |
| GET | `sop-history` | 查询/历史/能力 | [engineeringSopGet:22](../../lib/engineering-sop-api.ts#L22) | [app/engineering-sop-panel.tsx:60](../../app/engineering-sop-panel.tsx#L60) |
| POST | `sop-mes-upload` | 新增/登记/上传 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:40](../../app/engineering-sop-panel.tsx#L40) |
| POST | `sop-prepare` | 专用业务动作 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:39](../../app/engineering-sop-panel.tsx#L39) |
| POST | `sop-target` | 专用业务动作 | [engineeringSopPost:34](../../lib/engineering-sop-api.ts#L34) | [app/engineering-sop-panel.tsx:53](../../app/engineering-sop-panel.tsx#L53) |

<a id="module-20"></a>

## 客服业务

权限入口：canReadServiceRecord、客户责任、维护/收款及附件权限。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `service-attachment` | 新增/登记/上传 | [serviceWorkspacePost:109](../../lib/service-workspace-api.ts#L109) | [app/service-workspace-panel.tsx:142](../../app/service-workspace-panel.tsx#L142) |
| GET | `service-data` | 查询/历史/能力 | [serviceWorkspaceGet:77](../../lib/service-workspace-api.ts#L77) | [app/customer-directory-panel.tsx:75](../../app/customer-directory-panel.tsx#L75) |
| GET | `service-file` | 读取/文件/导出 | [serviceWorkspaceGet:77](../../lib/service-workspace-api.ts#L77) | [app/service-workspace-panel.tsx:186](../../app/service-workspace-panel.tsx#L186) |
| GET | `service-history` | 查询/历史/能力 | [serviceWorkspaceGet:77](../../lib/service-workspace-api.ts#L77) | [app/service-workspace-panel.tsx:139](../../app/service-workspace-panel.tsx#L139) |
| POST | `service-receipt` | 专用业务动作 | [serviceWorkspacePost:109](../../lib/service-workspace-api.ts#L109) | [app/service-workspace-panel.tsx:143](../../app/service-workspace-panel.tsx#L143) |
| POST | `service-receipt-reverse` | 取消/回收/归档/恢复等状态动作 | [serviceWorkspacePost:109](../../lib/service-workspace-api.ts#L109) | [app/service-workspace-panel.tsx:144](../../app/service-workspace-panel.tsx#L144) |
| POST | `service-save` | 保存（具体新增/修改见实现） | [serviceWorkspacePost:109](../../lib/service-workspace-api.ts#L109) | [app/service-workspace-panel.tsx:138](../../app/service-workspace-panel.tsx#L138) |

<a id="module-21"></a>

## 客户报价

权限入口：报价授权、客户范围、内部核价字段隔离、版本确认。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-quote-access` | 查询/历史/能力 | [customerQuoteGet:32](../../lib/customer-quote-api.ts#L32) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `customer-quote-completed` | 查询/历史/能力 | [customerQuoteGet:32](../../lib/customer-quote-api.ts#L32) | [app/customer-quote-panel.tsx:86](../../app/customer-quote-panel.tsx#L86) |
| POST | `customer-quote-confirm` | 专用业务动作 | [customerQuotePost:64](../../lib/customer-quote-api.ts#L64) | [app/customer-quote-panel.tsx:124](../../app/customer-quote-panel.tsx#L124) |
| GET | `customer-quote-file` | 读取/文件/导出 | [customerQuoteGet:32](../../lib/customer-quote-api.ts#L32) | [app/customer-quote-panel.tsx:193](../../app/customer-quote-panel.tsx#L193) |
| GET | `customer-quote-media-file` | 读取/文件/导出 | [customerQuoteGet:32](../../lib/customer-quote-api.ts#L32) | [app/customer-quote-archive.tsx:20](../../app/customer-quote-archive.tsx#L20) |
| POST | `customer-quote-media-upload` | 新增/登记/上传 | [customerQuotePost:64](../../lib/customer-quote-api.ts#L64) | [app/customer-quote-archive.tsx:62](../../app/customer-quote-archive.tsx#L62) |
| POST | `customer-quote-record-sent` | 专用业务动作 | [customerQuotePost:64](../../lib/customer-quote-api.ts#L64) | [app/customer-quote-archive.tsx:63](../../app/customer-quote-archive.tsx#L63) |
| POST | `customer-quote-revise` | 专用业务动作 | [customerQuotePost:64](../../lib/customer-quote-api.ts#L64) | [app/customer-quote-panel.tsx:125](../../app/customer-quote-panel.tsx#L125) |
| POST | `customer-quote-save` | 保存（具体新增/修改见实现） | [customerQuotePost:64](../../lib/customer-quote-api.ts#L64) | [app/customer-quote-panel.tsx:121](../../app/customer-quote-panel.tsx#L121) |
| POST | `customer-quote-upload` | 新增/登记/上传 | [customerQuotePost:64](../../lib/customer-quote-api.ts#L64) | [app/customer-quote-panel.tsx:122](../../app/customer-quote-panel.tsx#L122) |
| GET | `customer-quote-version` | 查询/历史/能力 | [customerQuoteGet:32](../../lib/customer-quote-api.ts#L32) | [app/customer-quote-archive.tsx:59](../../app/customer-quote-archive.tsx#L59) |
| GET | `customer-quotes` | 查询/历史/能力 | [customerQuoteGet:32](../../lib/customer-quote-api.ts#L32) | [app/business-process-panel.tsx:15](../../app/business-process-panel.tsx#L15) |

<a id="module-22"></a>

## 客户报价授权配置

权限入口：管理员配置授权；不能由普通报价查询权限推导。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `customer-quote-access-update` | 修改/关联/指派 | [customerQuotePolicyPost:9](../../lib/customer-quote-policy-api.ts#L9) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-23"></a>

## 报价模板

权限入口：报价客户授权、模板归属、确认状态及原件访问。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-quote-completed-export` | 读取/文件/导出 | [customerQuoteTemplateGet:60](../../lib/customer-quote-template-api.ts#L60) | [app/customer-quote-archive.tsx:65](../../app/customer-quote-archive.tsx#L65) |
| POST | `customer-quote-template-apply` | 专用业务动作 | [customerQuoteTemplatePost:92](../../lib/customer-quote-template-api.ts#L92) | [app/customer-quote-panel.tsx:94](../../app/customer-quote-panel.tsx#L94) |
| POST | `customer-quote-template-archive` | 取消/回收/归档/恢复等状态动作 | [customerQuoteTemplatePost:92](../../lib/customer-quote-template-api.ts#L92) | [app/customer-quote-panel.tsx:94](../../app/customer-quote-panel.tsx#L94) |
| GET | `customer-quote-template-export` | 读取/文件/导出 | [customerQuoteTemplateGet:60](../../lib/customer-quote-template-api.ts#L60) | [app/customer-quote-archive.tsx:66](../../app/customer-quote-archive.tsx#L66) |
| GET | `customer-quote-template-output-file` | 读取/文件/导出 | [customerQuoteTemplateGet:60](../../lib/customer-quote-template-api.ts#L60) | [app/customer-quote-template-panel.tsx:51](../../app/customer-quote-template-panel.tsx#L51) |
| POST | `customer-quote-template-register` | 新增/登记/上传 | [customerQuoteTemplatePost:92](../../lib/customer-quote-template-api.ts#L92) | [app/customer-quote-template-panel.tsx:37](../../app/customer-quote-template-panel.tsx#L37) |
| GET | `customer-quote-templates` | 读取/文件/导出 | [customerQuoteTemplateGet:60](../../lib/customer-quote-template-api.ts#L60) | [app/customer-quote-template-panel.tsx:21](../../app/customer-quote-template-panel.tsx#L21) |

<a id="module-24"></a>

## 历史价格原件

权限入口：allowed/customer 范围；导入及来源选择需 admin。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-price-archive` | 查询/历史/能力 | [customerPriceArchiveGet:24](../../lib/customer-price-archive-api.ts#L24) | [app/business-process-panel.tsx:15](../../app/business-process-panel.tsx#L15) |
| GET | `customer-price-archive-export` | 读取/文件/导出 | [customerPriceArchiveGet:24](../../lib/customer-price-archive-api.ts#L24) | [app/customer-price-archive-panel.tsx:42](../../app/customer-price-archive-panel.tsx#L42) |
| GET | `customer-price-archive-file` | 读取/文件/导出 | [customerPriceArchiveGet:24](../../lib/customer-price-archive-api.ts#L24) | [app/customer-price-archive-panel.tsx:19](../../app/customer-price-archive-panel.tsx#L19) |
| POST | `customer-price-archive-file-upload` | 新增/登记/上传 | [customerPriceArchivePost:44](../../lib/customer-price-archive-api.ts#L44) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-price-archive-import` | 解析/预览/导入（不能假定无副作用） | [customerPriceArchivePost:44](../../lib/customer-price-archive-api.ts#L44) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-price-selection-save` | 保存（具体新增/修改见实现） | [customerPriceArchivePost:44](../../lib/customer-price-archive-api.ts#L44) | [app/customer-price-archive-panel.tsx:41](../../app/customer-price-archive-panel.tsx#L41) |

<a id="module-25"></a>

## 客户档案与跟进

权限入口：workflowCustomer、workflowCapabilities、policyConfirmed；银行字段独立写权限。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-workflow-data` | 查询/历史/能力 | [customerWorkflowGet:91](../../lib/customer-workflow-api.ts#L91) | [app/customer-directory-panel.tsx:72](../../app/customer-directory-panel.tsx#L72) |
| GET | `customer-workflow-export` | 读取/文件/导出 | [customerWorkflowGet:81](../../lib/customer-workflow-api.ts#L81) | [app/customer-directory-panel.tsx:139](../../app/customer-directory-panel.tsx#L139) |
| POST | `customer-workflow-followup` | 新增/登记/上传 | [customerWorkflowPost:107](../../lib/customer-workflow-api.ts#L107) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `customer-workflow-history` | 查询/历史/能力 | [customerWorkflowGet:91](../../lib/customer-workflow-api.ts#L91) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-profile-save` | 保存（具体新增/修改见实现） | [customerWorkflowPost:107](../../lib/customer-workflow-api.ts#L107) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-schedule` | 专用业务动作 | [customerWorkflowPost:107](../../lib/customer-workflow-api.ts#L107) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-26"></a>

## 客户文件与轻量项目

权限入口：客户/项目授权、原件访问与维护能力。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-workflow-file` | 读取/文件/导出 | [customerWorkflowFileGet:35](../../lib/customer-workflow-files.ts#L35) | [app/customer-workflow-files.tsx:33](../../app/customer-workflow-files.tsx#L33) |
| POST | `customer-workflow-file-save` | 保存（具体新增/修改见实现） | [customerWorkflowFilePost:60](../../lib/customer-workflow-files.ts#L60) | [app/customer-workflow-files.tsx:26](../../app/customer-workflow-files.tsx#L26) |
| POST | `customer-workflow-file-upload` | 新增/登记/上传 | [customerWorkflowFilePost:60](../../lib/customer-workflow-files.ts#L60) | [app/customer-workflow-files.tsx:25](../../app/customer-workflow-files.tsx#L25) |
| GET | `customer-workflow-files` | 读取/文件/导出 | [customerWorkflowFileGet:35](../../lib/customer-workflow-files.ts#L35) | [app/customer-workflow-files.tsx:16](../../app/customer-workflow-files.tsx#L16) |
| GET | `customer-workflow-project` | 查询/历史/能力 | [customerWorkflowFileGet:35](../../lib/customer-workflow-files.ts#L35) | [app/customer-early-development.tsx:13](../../app/customer-early-development.tsx#L13) |
| GET | `customer-workflow-project-document` | 查询/历史/能力 | [customerWorkflowFileGet:35](../../lib/customer-workflow-files.ts#L35) | [app/customer-workflow-files.tsx:17](../../app/customer-workflow-files.tsx#L17) |
| POST | `customer-workflow-project-document-save` | 保存（具体新增/修改见实现） | [customerWorkflowFilePost:60](../../lib/customer-workflow-files.ts#L60) | [app/customer-workflow-files.tsx:33](../../app/customer-workflow-files.tsx#L33) |
| POST | `customer-workflow-project-log` | 专用业务动作 | [customerWorkflowFilePost:60](../../lib/customer-workflow-files.ts#L60) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-project-save` | 保存（具体新增/修改见实现） | [customerWorkflowFilePost:60](../../lib/customer-workflow-files.ts#L60) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-27"></a>

## 客户待办

权限入口：customerTaskOwnerEligible、customerTaskCanEdit；本人/负责人范围。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-workflow-task-history` | 查询/历史/能力 | [customerWorkflowTaskGet:33](../../lib/customer-workflow-tasks.ts#L33) | [app/customer-workflow-tasks.tsx:19](../../app/customer-workflow-tasks.tsx#L19) |
| POST | `customer-workflow-task-save` | 保存（具体新增/修改见实现） | [customerWorkflowTaskPost:48](../../lib/customer-workflow-tasks.ts#L48) | [app/customer-workflow-tasks.tsx:33](../../app/customer-workflow-tasks.tsx#L33) |
| GET | `customer-workflow-tasks` | 查询/历史/能力 | [customerWorkflowTaskGet:33](../../lib/customer-workflow-tasks.ts#L33) | [app/customer-workflow-tasks.tsx:17](../../app/customer-workflow-tasks.tsx#L17) |

<a id="module-28"></a>

## 客户公海与交接

权限入口：客户责任、主负责人、管理员审批；指定销售本人接收。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `customer-workflow-accept` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-cancel-handoff` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-claim` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-claim-approve` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-handoff` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-pool-approve` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-pool-reject` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-pool-request` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-pool-withdraw` | 取消/回收/归档/恢复等状态动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-workflow-primary` | 专用业务动作 | [customerWorkflowTransferPost:45](../../lib/customer-workflow-transfers.ts#L45) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `customer-workflow-transfers` | 查询/历史/能力 | [customerWorkflowTransferGet:31](../../lib/customer-workflow-transfers.ts#L31) | [app/customer-workflow-panel.tsx:41](../../app/customer-workflow-panel.tsx#L41) |

<a id="module-29"></a>

## 客户项目、样办与回收站

权限入口：projectAccess、任务/审核名单、canManageProjectAssignments；客户范围和回收站保护。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `customer-project-assignment-roster-save` | 保存（具体新增/修改见实现） | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-attachment` | 新增/登记/上传 | [customerProjectPost:141](../../lib/customer-project-api.ts#L141) | [app/customer-project-attachment-upload.tsx:68](../../app/customer-project-attachment-upload.tsx#L68) |
| POST | `customer-project-bulk-link` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:262](../../app/customer-project-panel.tsx#L262) |
| POST | `customer-project-communication` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-confirmation` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `customer-project-data` | 查询/历史/能力 | [customerProjectGet:92](../../lib/customer-project-api.ts#L92) | [app/customer-dossier-panel.tsx:96](../../app/customer-dossier-panel.tsx#L96) |
| POST | `customer-project-dispatch-receive` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-drawing` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-drawing-withdraw` | 取消/回收/归档/恢复等状态动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-entry-save` | 保存（具体新增/修改见实现） | [customerProjectPost:140](../../lib/customer-project-api.ts#L140) | [app/customer-project-entry-forms.ts:25](../../app/customer-project-entry-forms.ts#L25) |
| GET | `customer-project-file` | 读取/文件/导出 | [customerProjectGet:92](../../lib/customer-project-api.ts#L92) | [app/customer-project-attachment-preview.tsx:16](../../app/customer-project-attachment-preview.tsx#L16) |
| GET | `customer-project-history` | 查询/历史/能力 | [customerProjectGet:92](../../lib/customer-project-api.ts#L92) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-item-save` | 保存（具体新增/修改见实现） | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-quote-link` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:260](../../app/customer-project-panel.tsx#L260) |
| POST | `customer-project-restore` | 取消/回收/归档/恢复等状态动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:126](../../app/customer-project-panel.tsx#L126) |
| POST | `customer-project-round-save` | 保存（具体新增/修改见实现） | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-sample-dispatch` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-sample-feedback` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-sample-promise` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-sample-release` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:261](../../app/customer-project-panel.tsx#L261) |
| POST | `customer-project-sample-update` | 修改/关联/指派 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:258](../../app/customer-project-panel.tsx#L258) |
| POST | `customer-project-save` | 保存（具体新增/修改见实现） | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:126](../../app/customer-project-panel.tsx#L126) |
| POST | `customer-project-task-review` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:252](../../app/customer-project-panel.tsx#L252) |
| POST | `customer-project-task-save` | 保存（具体新增/修改见实现） | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:242](../../app/customer-project-panel.tsx#L242) |
| POST | `customer-project-task-submit` | 专用业务动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:249](../../app/customer-project-panel.tsx#L249) |
| POST | `customer-project-team-save` | 保存（具体新增/修改见实现） | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:228](../../app/customer-project-panel.tsx#L228) |
| POST | `customer-project-trash` | 取消/回收/归档/恢复等状态动作 | [customerProjectPost:142](../../lib/customer-project-api.ts#L142) | [app/customer-project-panel.tsx:126](../../app/customer-project-panel.tsx#L126) |

<a id="module-30"></a>

## 项目跨部门协作

权限入口：canReadProjectCollaboration、项目写权限、任务责任与版本。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `project-collaboration-acknowledge` | 专用业务动作 | [projectCollaborationPost:57](../../lib/project-collaboration-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `project-collaboration-cancel` | 取消/回收/归档/恢复等状态动作 | [projectCollaborationPost:57](../../lib/project-collaboration-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `project-collaboration-complete` | 专用业务动作 | [projectCollaborationPost:57](../../lib/project-collaboration-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `project-collaboration-data` | 查询/历史/能力 | [projectCollaborationGet:41](../../lib/project-collaboration-api.ts#L41) | [app/project-collaboration-panel.tsx:53](../../app/project-collaboration-panel.tsx#L53) |
| POST | `project-collaboration-followup` | 新增/登记/上传 | [projectCollaborationPost:57](../../lib/project-collaboration-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `project-collaboration-save` | 保存（具体新增/修改见实现） | [projectCollaborationPost:57](../../lib/project-collaboration-api.ts#L57) | [app/project-collaboration-panel.tsx:110](../../app/project-collaboration-panel.tsx#L110) |

<a id="module-31"></a>

## 项目跟进与历史邮件

权限入口：assertAccess、客户/负责人范围；历史迁入仅管理员。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `customer-project-followup-data` | 查询/历史/能力 | [customerProjectFollowupGet:52](../../lib/customer-project-followup-api.ts#L52) | [app/customer-directory-panel.tsx:75](../../app/customer-directory-panel.tsx#L75) |
| GET | `customer-project-followup-history` | 查询/历史/能力 | [customerProjectFollowupGet:52](../../lib/customer-project-followup-api.ts#L52) | [app/customer-project-followup-panel.tsx:100](../../app/customer-project-followup-panel.tsx#L100) |
| POST | `customer-project-followup-import` | 解析/预览/导入（不能假定无副作用） | [customerProjectFollowupPost:77](../../lib/customer-project-followup-api.ts#L77) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `customer-project-followup-mail-classify` | 专用业务动作 | [customerProjectFollowupPost:77](../../lib/customer-project-followup-api.ts#L77) | [app/customer-project-followup-panel.tsx:94](../../app/customer-project-followup-panel.tsx#L94) |
| POST | `customer-project-followup-promote` | 专用业务动作 | [customerProjectFollowupPost:77](../../lib/customer-project-followup-api.ts#L77) | [app/customer-project-followup-panel.tsx:92](../../app/customer-project-followup-panel.tsx#L92) |
| POST | `customer-project-followup-save` | 保存（具体新增/修改见实现） | [customerProjectFollowupPost:77](../../lib/customer-project-followup-api.ts#L77) | [app/customer-project-followup-panel.tsx:87](../../app/customer-project-followup-panel.tsx#L87) |
| GET | `customer-project-followup-source-file` | 读取/文件/导出 | [customerProjectFollowupGet:52](../../lib/customer-project-followup-api.ts#L52) | [app/customer-project-followup-panel.tsx:157](../../app/customer-project-followup-panel.tsx#L157) |

<a id="module-32"></a>

## 项目财务

权限入口：access(read/write/verify)、financialDto；授权、资金状态、来源版本。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `project-adjustment` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:39](../../app/customer-project-finance-panel.tsx#L39) |
| POST | `project-after-sale-cost` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:45](../../app/customer-project-finance-panel.tsx#L45) |
| POST | `project-after-sale-save` | 保存（具体新增/修改见实现） | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:44](../../app/customer-project-finance-panel.tsx#L44) |
| POST | `project-allocation` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:36](../../app/customer-project-finance-panel.tsx#L36) |
| POST | `project-allocation-release` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:37](../../app/customer-project-finance-panel.tsx#L37) |
| POST | `project-charge-confirm` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:78](../../app/customer-project-finance-panel.tsx#L78) |
| POST | `project-charge-save` | 保存（具体新增/修改见实现） | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:32](../../app/customer-project-finance-panel.tsx#L32) |
| POST | `project-credit-apply` | 修改/关联/指派 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:40](../../app/customer-project-finance-panel.tsx#L40) |
| POST | `project-document-confirm` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:99](../../app/customer-project-finance-panel.tsx#L99) |
| GET | `project-document-print` | 读取/文件/导出 | [customerProjectFinanceGet:101](../../lib/customer-project-finance-api.ts#L101) | [app/customer-project-finance-panel.tsx:99](../../app/customer-project-finance-panel.tsx#L99) |
| POST | `project-document-revise` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:43](../../app/customer-project-finance-panel.tsx#L43) |
| POST | `project-document-save` | 保存（具体新增/修改见实现） | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:41](../../app/customer-project-finance-panel.tsx#L41) |
| POST | `project-document-sent` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:42](../../app/customer-project-finance-panel.tsx#L42) |
| GET | `project-finance-data` | 查询/历史/能力 | [customerProjectFinanceGet:101](../../lib/customer-project-finance-api.ts#L101) | [app/customer-project-finance-panel.tsx:18](../../app/customer-project-finance-panel.tsx#L18) |
| POST | `project-finance-entry-save` | 保存（具体新增/修改见实现） | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:67](../../app/customer-project-finance-panel.tsx#L67) |
| POST | `project-finance-grant-save` | 保存（具体新增/修改见实现） | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:49](../../app/customer-project-finance-panel.tsx#L49) |
| GET | `project-finance-history` | 查询/历史/能力 | [customerProjectFinanceGet:101](../../lib/customer-project-finance-api.ts#L101) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `project-payment-notice` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:34](../../app/customer-project-finance-panel.tsx#L34) |
| POST | `project-payment-requirement` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:33](../../app/customer-project-finance-panel.tsx#L33) |
| POST | `project-receipt-reverse` | 取消/回收/归档/恢复等状态动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:38](../../app/customer-project-finance-panel.tsx#L38) |
| POST | `project-receipt-verify` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:35](../../app/customer-project-finance-panel.tsx#L35) |
| POST | `project-refund-cancel` | 取消/回收/归档/恢复等状态动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:48](../../app/customer-project-finance-panel.tsx#L48) |
| POST | `project-refund-execute` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:47](../../app/customer-project-finance-panel.tsx#L47) |
| POST | `project-refund-request` | 专用业务动作 | [customerProjectFinancePost:134](../../lib/customer-project-finance-api.ts#L134) | [app/customer-project-finance-panel.tsx:46](../../app/customer-project-finance-panel.tsx#L46) |

<a id="module-33"></a>

## 应收工作台与授权

权限入口：arAccess、canConfigure；公司/业务组/客户范围。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `ar-access-data` | 查询/历史/能力 | [arWorkspaceGet:16](../../lib/ar-workspace-api.ts#L16) | [app/ar-workspace-panel.tsx:39](../../app/ar-workspace-panel.tsx#L39) |
| POST | `ar-access-grant-save` | 保存（具体新增/修改见实现） | [arWorkspacePost:35](../../lib/ar-workspace-api.ts#L35) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `ar-dashboard-data` | 查询/历史/能力 | [arWorkspaceGet:16](../../lib/ar-workspace-api.ts#L16) | [standalone/schedule-engine/workflow-sources.mjs:9](../../standalone/schedule-engine/workflow-sources.mjs#L9) |
| GET | `ar-export` | 读取/文件/导出 | [arWorkspaceGet:16](../../lib/ar-workspace-api.ts#L16) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `ar-source-binding-save` | 保存（具体新增/修改见实现） | [arWorkspacePost:35](../../lib/ar-workspace-api.ts#L35) | [app/ar-workspace-panel.tsx:66](../../app/ar-workspace-panel.tsx#L66) |
| GET | `ar-workspace-data` | 查询/历史/能力 | [arWorkspaceGet:16](../../lib/ar-workspace-api.ts#L16) | [app/ar-workspace-panel.tsx:37](../../app/ar-workspace-panel.tsx#L37) |

<a id="module-34"></a>

## 发票原件与对账

权限入口：应收读取/维护范围、原件归属、对账及请求幂等。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `ar-invoice-data` | 查询/历史/能力 | [arInvoiceLedgerGet:104](../../lib/ar-invoice-ledger-api.ts#L104) | [app/ar-customer-profile-panel.tsx:41](../../app/ar-customer-profile-panel.tsx#L41) |
| GET | `ar-invoice-file` | 读取/文件/导出 | [arInvoiceLedgerGet:104](../../lib/ar-invoice-ledger-api.ts#L104) | [app/ar-customer-profile-panel.tsx:111](../../app/ar-customer-profile-panel.tsx#L111) |
| POST | `ar-invoice-import` | 解析/预览/导入（不能假定无副作用） | [arInvoiceLedgerPost:111](../../lib/ar-invoice-ledger-api.ts#L111) | [app/ar-invoice-ledger-panel.tsx:114](../../app/ar-invoice-ledger-panel.tsx#L114) |
| POST | `ar-invoice-note` | 专用业务动作 | [arInvoiceLedgerPost:111](../../lib/ar-invoice-ledger-api.ts#L111) | [app/ar-invoice-ledger-panel.tsx:121](../../app/ar-invoice-ledger-panel.tsx#L121) |
| POST | `ar-invoice-proof` | 专用业务动作 | [arInvoiceLedgerPost:111](../../lib/ar-invoice-ledger-api.ts#L111) | [app/ar-invoice-ledger-panel.tsx:126](../../app/ar-invoice-ledger-panel.tsx#L126) |
| POST | `ar-invoice-reconcile` | 专用业务动作 | [arInvoiceLedgerPost:111](../../lib/ar-invoice-ledger-api.ts#L111) | [app/ar-invoice-ledger-panel.tsx:133](../../app/ar-invoice-ledger-panel.tsx#L133) |
| POST | `ar-invoice-statement` | 专用业务动作 | [arInvoiceLedgerPost:111](../../lib/ar-invoice-ledger-api.ts#L111) | [app/ar-invoice-ledger-panel.tsx:139](../../app/ar-invoice-ledger-panel.tsx#L139) |
| GET | `ar-invoice-statement-file` | 读取/文件/导出 | [arInvoiceLedgerGet:104](../../lib/ar-invoice-ledger-api.ts#L104) | [app/ar-invoice-ledger-panel.tsx:155](../../app/ar-invoice-ledger-panel.tsx#L155) |

<a id="module-35"></a>

## 应收客户模板

权限入口：writer、customer 授权；核心账务字段禁止重定义。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `ar-customer-profile-save` | 保存（具体新增/修改见实现） | [arCustomerProfilesPost:50](../../lib/ar-customer-profiles-api.ts#L50) | [app/ar-customer-profile-panel.tsx:85](../../app/ar-customer-profile-panel.tsx#L85) |
| GET | `ar-customer-profiles-data` | 读取/文件/导出 | [arCustomerProfilesGet:40](../../lib/ar-customer-profiles-api.ts#L40) | [app/ar-customer-profile-panel.tsx:40](../../app/ar-customer-profile-panel.tsx#L40) |
| POST | `ar-invoice-extra-save` | 保存（具体新增/修改见实现） | [arCustomerProfilesPost:50](../../lib/ar-customer-profiles-api.ts#L50) | [app/ar-customer-profile-panel.tsx:98](../../app/ar-customer-profile-panel.tsx#L98) |
| POST | `ar-invoice-source-link` | 专用业务动作 | [arCustomerProfilesPost:50](../../lib/ar-customer-profiles-api.ts#L50) | [app/ar-customer-profile-panel.tsx:105](../../app/ar-customer-profile-panel.tsx#L105) |

<a id="module-36"></a>

## 应收总表

权限入口：现有 AR 读取范围；登记与核对仅有权管理员；原来源只读及版本校验。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `ar-master-data` | 查询/历史/能力 | [arMasterLedgerGet:33](../../lib/ar-master-ledger-api.ts#L33) | [app/ar-master-ledger-panel.tsx:133](../../app/ar-master-ledger-panel.tsx#L133) |
| POST | `ar-master-entry-save` | 保存（具体新增/修改见实现） | [arMasterLedgerPost:48](../../lib/ar-master-ledger-api.ts#L48) | [app/ar-master-ledger-panel.tsx:207](../../app/ar-master-ledger-panel.tsx#L207) |
| GET | `ar-master-export` | 读取/文件/导出 | [arMasterLedgerGet:33](../../lib/ar-master-ledger-api.ts#L33) | [app/ar-master-ledger-panel.tsx:226](../../app/ar-master-ledger-panel.tsx#L226) |
| POST | `ar-master-register-legacy` | 专用业务动作 | [arMasterLedgerPost:48](../../lib/ar-master-ledger-api.ts#L48) | [app/ar-master-ledger-panel.tsx:221](../../app/ar-master-ledger-panel.tsx#L221) |
| POST | `ar-master-source-link` | 专用业务动作 | [arMasterLedgerPost:48](../../lib/ar-master-ledger-api.ts#L48) | [app/ar-master-ledger-panel.tsx:214](../../app/ar-master-ledger-panel.tsx#L214) |

<a id="module-37"></a>

## 正式财务单据

权限入口：审核、签发及里程碑分别按财务/业务组/来源权限校验。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `ar-document-issue` | 专用业务动作 | [arDocumentPost:58](../../lib/ar-document-issue.ts#L58) | [app/ar-workspace-panel.tsx:60](../../app/ar-workspace-panel.tsx#L60) |
| POST | `ar-document-milestone` | 专用业务动作 | [arDocumentPost:58](../../lib/ar-document-issue.ts#L58) | [app/ar-workspace-panel.tsx:68](../../app/ar-workspace-panel.tsx#L68) |
| POST | `ar-document-review` | 专用业务动作 | [arDocumentPost:58](../../lib/ar-document-issue.ts#L58) | [app/ar-workspace-panel.tsx:60](../../app/ar-workspace-panel.tsx#L60) |

<a id="module-38"></a>

## 付款条件

权限入口：requireRead/requireWrite；只读取数账号禁止写、管理员指定授权负责人。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `payment-terms-authorize` | 专用业务动作 | [paymentTermsPost:31](../../lib/payment-terms-api.ts#L31) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `payment-terms-authorizers-save` | 保存（具体新增/修改见实现） | [paymentTermsPost:31](../../lib/payment-terms-api.ts#L31) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `payment-terms-data` | 查询/历史/能力 | [paymentTermsGet:25](../../lib/payment-terms-api.ts#L25) | [app/ar-workspace-panel.tsx:38](../../app/ar-workspace-panel.tsx#L38) |
| POST | `payment-terms-disable` | 取消/回收/归档/恢复等状态动作 | [paymentTermsPost:31](../../lib/payment-terms-api.ts#L31) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `payment-terms-save` | 保存（具体新增/修改见实现） | [paymentTermsPost:31](../../lib/payment-terms-api.ts#L31) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-39"></a>

## 业务交接与单据

权限入口：业务角色、来源/单据/客户范围；提交、审核、附件和打印。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `handoff-business-attachment` | 新增/登记/上传 | [handoffBusinessPost:123](../../lib/handoff-business-api.ts#L123) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `handoff-business-confirm` | 专用业务动作 | [handoffBusinessPost:123](../../lib/handoff-business-api.ts#L123) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `handoff-business-data` | 查询/历史/能力 | [handoffBusinessGet:87](../../lib/handoff-business-api.ts#L87) | [app/handoff-order-hub.tsx:20](../../app/handoff-order-hub.tsx#L20) |
| GET | `handoff-business-file` | 读取/文件/导出 | [handoffBusinessGet:87](../../lib/handoff-business-api.ts#L87) | [app/framework-business-query-panel.tsx:43](../../app/framework-business-query-panel.tsx#L43) |
| POST | `handoff-business-generate` | 专用业务动作 | [handoffBusinessPost:123](../../lib/handoff-business-api.ts#L123) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `handoff-business-history` | 查询/历史/能力 | [handoffBusinessGet:87](../../lib/handoff-business-api.ts#L87) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `handoff-business-print` | 读取/文件/导出 | [handoffBusinessGet:87](../../lib/handoff-business-api.ts#L87) | [app/handoff-business-panel.tsx:119](../../app/handoff-business-panel.tsx#L119) |
| POST | `handoff-business-return` | 专用业务动作 | [handoffBusinessPost:123](../../lib/handoff-business-api.ts#L123) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `handoff-business-review-data` | 查询/历史/能力 | [handoffBusinessGet:87](../../lib/handoff-business-api.ts#L87) | [app/handoff-workbench-panel.tsx:24](../../app/handoff-workbench-panel.tsx#L24) |
| POST | `handoff-business-save` | 保存（具体新增/修改见实现） | [handoffBusinessPost:123](../../lib/handoff-business-api.ts#L123) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `handoff-business-submit` | 专用业务动作 | [handoffBusinessPost:123](../../lib/handoff-business-api.ts#L123) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-40"></a>

## 交接定金与例外

权限入口：来源业务权限、定金声明与财务例外授权。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `handoff-business-deposit-declaration` | 专用业务动作 | [businessPaymentPost:11](../../lib/handoff-payment-actions.ts#L11) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `handoff-business-payment-exception` | 专用业务动作 | [businessPaymentPost:11](../../lib/handoff-payment-actions.ts#L11) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-41"></a>

## 交接服务配置

权限入口：配置管理权限；不等同于业务单据读写。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `handoff-business-service-config` | 专用业务动作 | [businessSettingsPost:10](../../lib/handoff-business-settings.ts#L10) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-42"></a>

## 生产审核规则与采纳

权限入口：审核规则配置与采纳签署权限；原生产闸门保留。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `handoff-business-adoption-sign` | 专用业务动作 | [productionReviewPost:29](../../lib/handoff-production-review.ts#L29) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `handoff-business-review-policy` | 专用业务动作 | [productionReviewPost:29](../../lib/handoff-production-review.ts#L29) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-43"></a>

## 沟通渠道、规则文档与通知

权限入口：actorAllowed、渠道/消息上下文和客户范围；配置与通知签收分别限制。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `framework-account-save` | 保存（具体新增/修改见实现） | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-framework-panel.tsx:59](../../app/handoff-framework-panel.tsx#L59) |
| GET | `framework-channel-context` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-framework-panel.tsx:105](../../app/handoff-framework-panel.tsx#L105) |
| GET | `framework-channel-history` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-framework-panel.tsx:105](../../app/handoff-framework-panel.tsx#L105) |
| GET | `framework-channels` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-framework-panel.tsx:39](../../app/handoff-framework-panel.tsx#L39) |
| POST | `framework-config-save` | 保存（具体新增/修改见实现） | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-framework-panel.tsx:58](../../app/handoff-framework-panel.tsx#L58) |
| GET | `framework-knowledge` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-framework-panel.tsx:69](../../app/handoff-framework-panel.tsx#L69) |
| GET | `framework-knowledge-document` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-framework-panel.tsx:71](../../app/handoff-framework-panel.tsx#L71) |
| POST | `framework-message-bind` | 专用业务动作 | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-framework-panel.tsx:98](../../app/handoff-framework-panel.tsx#L98) |
| POST | `framework-message-link` | 专用业务动作 | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-framework-panel.tsx:107](../../app/handoff-framework-panel.tsx#L107) |
| POST | `framework-message-process` | 专用业务动作 | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-framework-panel.tsx:98](../../app/handoff-framework-panel.tsx#L98) |
| POST | `framework-message-save` | 保存（具体新增/修改见实现） | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-framework-panel.tsx:99](../../app/handoff-framework-panel.tsx#L99) |
| POST | `framework-notice-receive` | 专用业务动作 | [frameworkPost:90](../../lib/handoff-framework-api.ts#L90) | [app/handoff-workbench-panel.tsx:34](../../app/handoff-workbench-panel.tsx#L34) |
| GET | `framework-notices` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-workbench-panel.tsx:25](../../app/handoff-workbench-panel.tsx#L25) |
| GET | `framework-settings` | 查询/历史/能力 | [frameworkGet:48](../../lib/handoff-framework-api.ts#L48) | [app/handoff-framework-panel.tsx:29](../../app/handoff-framework-panel.tsx#L29) |

<a id="module-44"></a>

## 财务协作任务

权限入口：内部身份、business/work、指定财务与当前阶段。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `framework-finance-task-accept` | 专用业务动作 | [frameworkFinanceTaskPost:66](../../lib/framework-finance-task.ts#L66) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `framework-finance-task-cancel` | 取消/回收/归档/恢复等状态动作 | [frameworkFinanceTaskPost:66](../../lib/framework-finance-task.ts#L66) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `framework-finance-task-history` | 查询/历史/能力 | [frameworkFinanceTaskGet:47](../../lib/framework-finance-task.ts#L47) | [app/framework-finance-task-panel.tsx:47](../../app/framework-finance-task-panel.tsx#L47) |
| POST | `framework-finance-task-return` | 专用业务动作 | [frameworkFinanceTaskPost:66](../../lib/framework-finance-task.ts#L66) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `framework-finance-task-review` | 专用业务动作 | [frameworkFinanceTaskPost:66](../../lib/framework-finance-task.ts#L66) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `framework-finance-task-save` | 保存（具体新增/修改见实现） | [frameworkFinanceTaskPost:66](../../lib/framework-finance-task.ts#L66) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `framework-finance-task-submit` | 专用业务动作 | [frameworkFinanceTaskPost:66](../../lib/framework-finance-task.ts#L66) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `framework-finance-task-summary` | 查询/历史/能力 | [frameworkFinanceTaskGet:47](../../lib/framework-finance-task.ts#L47) | [app/framework-finance-task-panel.tsx:46](../../app/framework-finance-task-panel.tsx#L46) |
| GET | `framework-finance-tasks` | 查询/历史/能力 | [frameworkFinanceTaskGet:47](../../lib/framework-finance-task.ts#L47) | [app/framework-finance-task-panel.tsx:21](../../app/framework-finance-task-panel.tsx#L21) |

<a id="module-45"></a>

## 离职交接

权限入口：内部人员、requireManager、指定接收人；完成前逐项检查责任转移。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `framework-offboarding` | 查询/历史/能力 | [frameworkOffboardingGet:119](../../lib/framework-offboarding.ts#L119) | [app/framework-offboarding-panel.tsx:12](../../app/framework-offboarding-panel.tsx#L12) |
| POST | `framework-offboarding-accept` | 专用业务动作 | [frameworkOffboardingPost:169](../../lib/framework-offboarding.ts#L169) | [app/framework-offboarding-panel.tsx:36](../../app/framework-offboarding-panel.tsx#L36) |
| POST | `framework-offboarding-cancel` | 取消/回收/归档/恢复等状态动作 | [frameworkOffboardingPost:169](../../lib/framework-offboarding.ts#L169) | [app/framework-offboarding-panel.tsx:17](../../app/framework-offboarding-panel.tsx#L17) |
| POST | `framework-offboarding-draft` | 专用业务动作 | [frameworkOffboardingPost:169](../../lib/framework-offboarding.ts#L169) | [app/framework-offboarding-panel.tsx:17](../../app/framework-offboarding-panel.tsx#L17) |
| POST | `framework-offboarding-finalize` | 专用业务动作 | [frameworkOffboardingPost:169](../../lib/framework-offboarding.ts#L169) | [app/framework-offboarding-panel.tsx:18](../../app/framework-offboarding-panel.tsx#L18) |
| GET | `framework-offboarding-incoming` | 查询/历史/能力 | [frameworkOffboardingGet:115](../../lib/framework-offboarding.ts#L115) | [app/framework-offboarding-panel.tsx:34](../../app/framework-offboarding-panel.tsx#L34) |

<a id="module-46"></a>

## 人工沟通草稿

权限入口：活跃业务角色、客户/来源范围；仅人工沟通草稿，不是发送接口。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `unified-communication-complete-review` | 专用业务动作 | [unifiedCommunicationPost:57](../../lib/unified-communication-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| GET | `unified-communication-data` | 查询/历史/能力 | [unifiedCommunicationGet:36](../../lib/unified-communication-api.ts#L36) | [app/customer-dossier-panel.tsx:98](../../app/customer-dossier-panel.tsx#L98) |
| GET | `unified-communication-history` | 查询/历史/能力 | [unifiedCommunicationGet:36](../../lib/unified-communication-api.ts#L36) | [app/unified-communication-panel.tsx:41](../../app/unified-communication-panel.tsx#L41) |
| POST | `unified-communication-return` | 专用业务动作 | [unifiedCommunicationPost:57](../../lib/unified-communication-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `unified-communication-save` | 保存（具体新增/修改见实现） | [unifiedCommunicationPost:57](../../lib/unified-communication-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |
| POST | `unified-communication-submit` | 专用业务动作 | [unifiedCommunicationPost:57](../../lib/unified-communication-api.ts#L57) | 未找到精确静态引用；不能据此认定未使用 |

<a id="module-47"></a>

## 固定数据工具

权限入口：assertFixedToolOwner、assertFixedToolJobAccess；客户/任务归属。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| GET | `fixed-data-tools` | 查询/历史/能力 | [fixedDataToolsGet:49](../../lib/fixed-data-tools-api.ts#L49) | [app/fixed-data-tools-panel.tsx:90](../../app/fixed-data-tools-panel.tsx#L90) |
| GET | `fixed-tool-file` | 读取/文件/导出 | [fixedDataToolsGet:49](../../lib/fixed-data-tools-api.ts#L49) | [app/fixed-data-tools-panel.tsx:141](../../app/fixed-data-tools-panel.tsx#L141) |
| GET | `fixed-tool-job` | 查询/历史/能力 | [fixedDataToolsGet:49](../../lib/fixed-data-tools-api.ts#L49) | [app/fixed-data-tools-panel.tsx:98](../../app/fixed-data-tools-panel.tsx#L98) |
| POST | `fixed-tool-ownership` | 专用业务动作 | [fixedDataToolsPost:67](../../lib/fixed-data-tools-api.ts#L67) | [app/fixed-data-tools-panel.tsx:118](../../app/fixed-data-tools-panel.tsx#L118) |
| POST | `fixed-tool-workbook` | 专用业务动作 | [fixedDataToolsPost:67](../../lib/fixed-data-tools-api.ts#L67) | [app/fixed-data-tools-panel.tsx:116](../../app/fixed-data-tools-panel.tsx#L116) |

<a id="module-48"></a>

## 固定报价费用工具

权限入口：任务归属、报价授权、预览/决定及来源版本。

| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |
| --- | --- | --- | --- | --- |
| POST | `fixed-tool-fees-decision` | 专用业务动作 | [fixedToolFeesPost:106](../../lib/fixed-tool-fees.ts#L106) | [app/fixed-data-tools-panel.tsx:138](../../app/fixed-data-tools-panel.tsx#L138) |
| POST | `fixed-tool-fees-preview` | 解析/预览/导入（不能假定无副作用） | [fixedToolFeesPost:106](../../lib/fixed-tool-fees.ts#L106) | [app/fixed-data-tools-panel.tsx:130](../../app/fixed-data-tools-panel.tsx#L130) |
| GET | `fixed-tool-quote` | 查询/历史/能力 | [fixedToolFeesGet:99](../../lib/fixed-tool-fees.ts#L99) | [app/fixed-data-tools-panel.tsx:122](../../app/fixed-data-tools-panel.tsx#L122) |

## 静态核对

- 追踪 92 个方法/处理器组合；支持字面量、允许列表、前缀拼接、后缀分发、schema 键和动作映射。
- 无法解析的允许列表：0；页面直接工作区 URL 未匹配项：0。
- 另有 4 组页面动态拼接前缀，已单列到 JSON 的 dynamicClientPrefixes；它们不计为未匹配完整路径，也不构成逐参数运行验收。
- 完整分发链、全部证据和引用位置、参与扫描文件的 SHA-256 见同目录 JSON。源码按 UTF-8、CRLF 统一为 LF 后计算哈希，不含业务记录。
- 不是通用 TypeScript 控制流证明器；新增分发写法、动态调用及运行环境差异仍需人工核对。本次未调用业务接口或运行旧维护脚本。
