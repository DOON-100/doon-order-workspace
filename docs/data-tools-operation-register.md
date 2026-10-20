# T01：19 个数据工具操作登记与首批封装范围

登记日期：2026-10-17。源码核对基线：`main@64c01491bb37505489a7b8a491bf39149d3053e9`。本表通过阅读入口及相关实现编制，没有运行、import 或调用业务脚本，也没有使用生产库、附件、账号或模型做试验。

本登记对应[第一阶段清单](phase-one-implementation-checklist.md)的 T01。**登记完成不表示脚本已安全封装、允许员工调用或已通过运行验收。** 现有默认路径、副作用和权限缺口照实保留；消除它们属于 T02/T03，界面和人工确认属于 T04，执行记录与幂等回读属于 T05。

## 1. 登记口径与执行边界

- 范围为 `scripts/data-tools/` 顶层 19 个 `.mjs` / `.py` 入口，辅助库不重复计数；子操作分别限定。全部是固定程序，无需 LLM。Agent/LLM 的 T06 仍在测试分支，T01 及后续通用固定功能在 `main`。
- “当前身份”指源码实际执行的检查；“拟开放角色”指封装约束，两者不能互换。OS 文件访问、配置中的用户名、主动选择 owner 都不是可信员工授权。
- “预览”区分只读数据库、写临时文件、写独立副本、加载可写运行时和真正写业务记录。存在 `dry-run`、`preview` 或 `rehearse` 字样不代表完全无副作用。
- 下文路径相对当前工作目录，另有说明除外。默认 `lan-data` / `lan-dist` 是正式目录风险，必须登记，不能在测试中使用。文件、报告、备份和导出都可能含业务内容，存放私有目录；首批开发只用合成数据及独立任务目录。
- 输入栏记录入口接受的参数及关键字段契约；业务记录的完整字段校验仍以链接源码为准。没有给出默认值的必填字段不得推测补齐。输出的 `unknown`、缺失映射或冲突留待人工核查。
- 所有运行入口继续由操作员按既有授权控制；本登记没有建立新的定时任务、员工权限、业务写入或发送授权。本轮不构建、部署、重启或修改 8787、正式数据及守护配置。
- 若源码构造 `Request('http://localhost:8787/...')` 后直接调用导入的 API 处理函数，这不等于发起 HTTP 请求；实际读写目标仍由 runtime 的数据目录决定。无网络请求不代表无生产数据副作用。

## 2. 总登记表

| 编号 | 入口 | 现有主要效果 | 本轮范围决定 |
| --- | --- | --- | --- |
| DT01 | `workbook.py` | 读工作簿，写检查/行数据/图片产物 | 首批 A：仅 `inspect`、`rows` |
| DT02 | `inspect-purchase.py` | 固定采购模板检查，输出明细 | 保留专项操作员入口 |
| DT03 | `split-workbook.mjs` | 按审核归属生成拆分工作簿与分类结果 | 后续候选，不在首批 |
| DT04 | `merge_workbooks.py` | 生成新工作簿与保全报告 | 后续候选，不在首批 |
| DT05 | `prepare-quote.mjs` | 复制原件并生成报价任务包 | 保留操作员准备入口，首批不开放 create |
| DT06 | `customer-price-template-to-json.mjs` | 固定价格模板转 JSON | 保留专项操作员入口 |
| DT07 | `import-purchase-live.mjs` | 保存采购导入任务、原件并分批提交 | 保留操作员入口，不接员工预览 |
| DT08 | `import-customer-quote.mjs` | 创建报价草稿并上传原件 | 保留旧专项入口，不用于首批封装 |
| DT09 | `import-customer-price-archive.mjs` | 追加历史价格及原件 | 保留操作员入口 |
| DT10 | `import-customer-followup.mjs` | 跟进/邮件迁入及选定转项目 | 保留迁移入口，不用于初始化 |
| DT11 | `import-ivy-service.mjs` | 服务历史增量迁入 | 保留迁移入口 |
| DT12 | `import-engineering-drawings.mjs` | 工程画图历史增量迁入 | 保留迁移入口 |
| DT13 | `export-workspace.mjs` | 只读库，生成范围化 JSON | 首批 A：`ownership`；B 内部准备才用 `quote` |
| DT14 | `audit-customer-project-relations.mjs` | 全库关系/附件只读检查，写报告 | 保留操作员审计；不设自动任务 |
| DT15 | `quote-maintenance.mjs` | 报价创建/费用维护，副本演练与应用 | 首批 B：单张既有草稿的费用变更闭环 |
| DT16 | `publish-finished-outsourcing.mjs` | 分类及供应商委外任务发布 | 保留操作员入口 |
| DT17 | `configure-customer-quote-access.mjs` | 报价权限初始化及首次客户绑定 | 保留 owner 配置入口 |
| DT18 | `update-customer-quote-access.mjs` | 变更报价授权策略 | 保留 owner 配置入口 |
| DT19 | `set-customer-price-selection.mjs` | 更新客户价格选择及说明 | 保留业务配置入口 |

## 3. 逐项操作卡

每张卡的“封装前”是未完成的实现要求；登记不改变源码原行为。证据行号对应上述核对提交。

### DT01 · workbook.py

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 子命令 `inspect\|rows\|images`，必填 `--input --output`；`--sheet` 可重复，默认全部页；`--range` 为有限 A1 矩形，默认页全部范围。inspect/rows 支持 `--header-row`，默认 1、0 表示无表头；rows 支持 `--include-empty`，默认 false。表头可在 range 外，数据从 range 起点与表头下一行的较大值开始。 |
| 读取/产物 | 读整簿；inspect/rows 分别加载公式和已保存缓存视图，不重算公式。写 `schemaVersion:1` JSON，含来源哈希、页结构/行值/公式/缓存/坐标/格式；images 写图片和 manifest。表头、公式及隐藏页信息也可能是业务内容。源文件处理前后核 SHA256，stdout 为摘要。 |
| 环境/默认 | 输入/输出显式，相对 CWD；无构建/数据目录/HTTP。使用 Python 文件工具依赖，[依赖声明](../scripts/data-tools/requirements.txt)；无受控根目录或整簿大小限制。range 限制扫描/返回，**不限制整簿加载内存**。 |
| 加载/预览 | 有 `__main__` 守卫，自身 import 不处理文件；调用 `run()` 会准备并写输出，无 dry-run。A 的预览需拆开计算和产物完成，不能把当前 CLI 当零副作用操作。 |
| 当前身份/人工 | 仅 OS 文件权限，无成员/owner 查询。人工选择正确原件、工作表、表头和范围；封装后按可信来源/上传归属及导出权限控制，sheet/range 不作为授权。 |
| 异常/重复 | 输出等于输入、已存在或输出自身为 symlink 均拒绝；新 JSON 排他创建，写失败可能留半文件；images 临时目录处理，完成后移动，失败清理本次输出。源变动、非法范围、openpyxl 警告等报错；错误返回 1。父目录链接及路径仍需受控，排他创建不是任务幂等。 |
| 封装前/首批 | A1 只选 inspect/rows，指定单表及有界范围，images 不开放。补文件 ID、读/导出权限、解压/行列/耗时限额、原子产物状态及下载 ACL，保留公式未重算和缺缓存标记。 |
| 证据 | [源码](../scripts/data-tools/workbook.py)：47–108（范围、单元格）、108–190（子操作）、193–255（读写保全）、257–284（参数/守卫）；[现有用例](../tests/data-tools/test_workbook_tools.py)未运行。 |

### DT02 · inspect-purchase.py

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 恰一个位置参数工作簿路径，没有 output/sheet/range/dry-run；`--help` 也会当文件名。仅最大列数恰为 14 的页按第 4 行起、A 非空作明细；关键列 A采购单/C供应商/D采购员/E状态/F关闭/H明细键/J单位/K数量/N客户单。**未验证列标题**。 |
| 读取/产物 | 用缓存值加载整簿，将所有单元格展开；统计重复 `(A,H,N)`、全行重复、数量和空客户单号等。完整报告含前 8/后 4 行与异常示例，写文件并原样打印 stdout。 |
| 环境/默认 | 输入相对 CWD；固定报告 `test-output/purchase-workbook-structure.json`，不建父目录；无数据库或构建。 |
| 加载/预览 | **无 main 守卫，import 即检查 argv、读表并写报告**。不可用于工具自动发现或直接导入；无独立预览。 |
| 当前身份/人工 | 仅 OS 操作员，未校验成员/客户范围；人工核采购模板和数量口径，报告不得当公开日志。 |
| 异常/重复 | 固定报告截断覆盖，无排他创建、源哈希或原子写，异常直接 traceback；缺目录、非法数量可能失败。先过滤 A 空行再检查必填，可能漏报空单号，错误行号也可能偏移。没有任务幂等，不能只据此摘要证明采购数据有效。 |
| 封装前/首批 | 保留专项维护诊断，A1 用 DT01 做通用检查。后续若保留专项规则，须补真实源行号、列 schema、纯函数/守卫、显式输出、防覆盖和脱敏，不直接封装旧 CLI。 |
| 证据 | [源码](../scripts/data-tools/inspect-purchase.py)：8–14（顶层读取）、15–27（模板假定、统计及输出）。 |

### DT03 · split-workbook.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--config --output`。JSON：`schemaVersion:1`；`source/ownership:{path,sha256}`；sheet；非空 `groups:[{name,memberIds}]`；1-based customerColumn。headerRow 默认 1，firstRow 默认表头下一行，lastRow/columnCount 默认源末行/列；requiredColumns 默认空；unknownSheet/mappingSheet 默认 Unassigned/Customer mapping。组名合法且唯一，成员 ID 不跨组重复。ownership 有 customers 及 id/customerCode/acceptedIdentities/salesMembers/serviceMembers，当前嵌套 schema 校验不完整。 |
| 读取/产物 | 读整份 xlsx 和归属 JSON，核源/归属哈希，客户身份 trim+uppercase 精确匹配。写新目录 `extra.xlsx`、`classification.json`：源页占位、全部组、未分组页和客户映射页。**归组不是数据隔离，产物仍包含所有组**；公式指回原页坐标，保存缓存/格式但不重算。 |
| 环境/默认 | config/output 相对 CWD；source/ownership 相对配置目录，可解析到目录外，须普通文件且 source 为 xlsx。无需数据/构建/HTTP。后续 merge 必须明确 omit 源占位页，且会保留原簿全部原页。 |
| 加载/预览 | 有 CLI 守卫，import 仅定义函数；`splitWorkbook()` 会落盘，无 preview。生成前回读内存中的工作簿 bytes 核公式/缓存/格式。 |
| 当前身份/人工 | 只有 OS 权限；调用方的 memberIds、归属和别名不能证明授权。人工审核归属、范围与遗漏条件；原簿/全组产物只能给拥有完整读取权限者，不能直接作为个人分发文件。 |
| 异常/重复 | 未匹配保留未分组；别名跨客户、多组命中、公式无缓存或身份格为公式/错误时停止。空行/缺 requiredColumns 行会记录遗漏。输出目录和文件排他创建，写一半可能残留，重试同路径拒绝；无完整任务幂等或成套原子输出。 |
| 封装前/首批 | 后续候选，不入 A/B。补严格 schema、可信归属快照/版本、受控根目录、遗漏确认、真正输出权限隔离、资源限额和完成标记。 |
| 证据 | [源码](../scripts/data-tools/split-workbook.mjs)：20–84（路径/schema）、87–114（分类）、116–159（产物与保全）、161–174（CLI/守卫）。 |

### DT04 · merge_workbooks.py

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 三个必填位置参数 ORIGINAL、EXTRA、NEW_OUTPUT；可选一个 `--omit-sheet NAME`，默认不排除，指定页须同时存在两簿。追加页不能为空，新增页不得与原页/其他新页重名。实际接受可解析 OOXML ZIP，不靠文件扩展名保证格式。 |
| 读取/产物 | 整体读取两 ZIP，追加新页而非按业务键合并行；原页 XML/关系等受保护部件逐项保全，只允许指定包注册/样式等部件变化。写新簿及 `output.with_suffix('.merge-validation.json')` 报告，含路径、输入摘要、追加页、原部件保全结果；不重算公式，不主动抓取外链。 |
| 环境/默认 | 三路径显式，相对 CWD；无业务库/构建/HTTP，仅 Python 标准库；完整包入内存，尚无解压/内存限额。 |
| 加载/预览 | 有 main 守卫；`merge()` 校验后写输出，无 preview。序列化会修改 ElementTree 进程级 namespace 注册，未来并发封装宜隔离执行。 |
| 当前身份/人工 | OS 文件权限；须有两输入整体读取和完整结果导出权限。人工核追加页、omit 页及保全报告；合并保留原簿隐藏页/外链等，不能按 EXTRA 范围推断结果可见范围。 |
| 异常/重复 | 同输入输出、既有目标/报告、symlink 拒绝，均排他创建；日期系统冲突、签名、不支持依赖等失败，不静默丢部件。原 ZIP 检查重复成员，EXTRA 尚未同样检查。输出写后再做 CRC/保全/源哈希核查，失败可能残留工作簿且无成功报告；无原子成套完成或任务幂等。 |
| 封装前/首批 | 后续固定 split→merge 子步骤，不入 A/B。补预检、EXTRA 重复成员检查、输入限额、隔离执行、原子产物与完整报告门槛；文件出现不代表成功，保全报告不代表 Excel 公式业务结果已核验。 |
| 证据 | [源码](../scripts/data-tools/merge_workbooks.py)：82（namespace）、395–479（输入/兼容性）、504–671（合并/后验）、674–694（CLI）；[现有用例](../tests/data-tools/test_merge_workbooks.py)未运行。 |

### DT05 · prepare-quote.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--config --output`。仅 `schemaVersion:1, operation:create`；customer:{id,customerCode,customer}、actor:{username}、readers 数组、非空 quotes；可选 quoteCustomerCode/preconditions。每报价 payload 绑定 customerAccountId，有唯一 quoteNo、非空且 ID 唯一的 lines，禁止已有 id/version；source:{path,filename?,sha256?}，media 数组各含 lineId/category/path/filename?/sha256?。只是部分业务字段校验。 |
| 读取/产物 | 读 JSON 及原件 bytes，不查库。写新 bundle：`files/<sha256><extension>` 和重写路径/哈希的 `config.json`，按内容/扩展名去重。它准备材料，**不创建系统报价**。 |
| 环境/默认 | config/output 显式，相对 CWD；附件必须 `/` 相对路径且 realpath 位于配置目录内。来源允许 xlsx/xls/pdf/png/jpg/jpeg，媒体为图片或 PDF 图纸；单件 1 byte–10 MiB，检查文件头和可选 SHA256。无总数量/字节限制。 |
| 加载/预览 | 有 CLI 守卫，import 不打包；`prepareQuote()` 会生成目录和文件，无 dry-run。所有附件校验/入内存后再落盘。 |
| 当前身份/人工 | 仅 OS 权限；actor/readers/customer/preconditions 只作配置形状校验，未核真实账号、权限和当前来源版本。人工核客户、报价内容和附件与行的对应；真正提交仍由业务执行器重验。 |
| 异常/重复 | 新目录/文件排他创建，不覆盖；中途写失败会留不完整包，重试同路径拒绝。未统一回读包或最终复核所有源版本，基础签名不等于完整格式验证。设置的 POSIX mode 不等于 Windows ACL 验证。 |
| 封装前/首批 | 保留操作员材料准备，不入首批 create。后续须统一完整业务 schema、可信身份/客户/readers 范围、源版本、总量限额、原子成包及私有 ACL；准备成功不能当业务批准。 |
| 证据 | [源码](../scripts/data-tools/prepare-quote.mjs)：26–54（CLI/schema）、56–97（附件和载荷）、99–112（落盘/守卫）；[现有合成用例](../tests/data-tools/prepare-export.mjs)未运行。 |

### DT06 · customer-price-template-to-json.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--input --output --customer-code`；`--customer-name` 默认 code，`--source-root` 默认不校验/附加原件，`--allow-demo` 默认 false。须有产品SKU、历史价格、来源文件三数据页，第 6 行严格匹配源码 header，第 7 行起为数据；三页任何公式均拒绝。产品需 productId/sourceFileId，价格需 priceId/productId/sourceFileId，来源需 fileId/relativePath；每页客户代码明确、ID 唯一、引用存在。 |
| schema 关键语义 | 数量/价格/附加费为空为 null，否则非负有限数；范围 min≤max。产品 activity 默认 unknown；价格 scope 默认按 SKU 存在选择 sku/model、documentType 默认 quote、unit/quantityBasis 默认 unknown；reviewStatus 默认 needs_review，sentStatus 默认 unknown。来源 status 默认 included，excluded 会连带排除关联产品/价格。产品缺直接单价会产生 missing_price issue，不单因此改变价格 reviewStatus；币种、日期、单位或数量口径缺失会触发价格待复核，不能自行补价。字段全集与枚举以源码 header/转换函数为准。 |
| 读取/产物 | 全量读模板；只保留目标客户数据，其他客户 code/行号进入 excluded。写 `schemaVersion:1,customer,files,products,prices,issues,excluded` JSON；有 source-root 时读 included 原件、核哈希并将绝对路径写入结果。无 source-root 时不证明原件存在。 |
| 环境/默认 | 输入、输出、可选来源根相对 CWD，无数据库/构建/HTTP。提供来源根时核解析路径和真实路径都不越界；没有来源根时只处理文件元数据。 |
| 加载/预览 | 有 main 守卫；纯函数 `convertTemplateRows(sheets,{customerCode,customerName,allowDemo})` 不读写磁盘，但 CLI 的三页/公式检查和原件验证在函数外，不能漏掉。CLI 无 dry-run。 |
| 当前身份/人工 | 仅 OS 权限；customer-code 是筛选，verified/sent 是输入值，不是可信审批/发送回执。人工核客户、价格含义、来源、issue 和排除项；将来应隐藏其他客户标识和本机绝对路径。 |
| 异常/重复 | **输出默认覆盖，未防止与模板或原件同路径/链接重合**，读完后可能覆盖输入；不建父目录，无原子写、源前后摘要或任务幂等。异常 message 原样打印，可能含路径或业务标识。 |
| 封装前/首批 | 保留专项工具，不入 A/B。先补新目标/禁止源重合/受控根、防覆盖和错误脱敏，再考虑固定模板纯候选预览；不开放 allow-demo、任意来源根或自动导入。 |
| 证据 | [源码](../scripts/data-tools/customer-price-template-to-json.mjs)：8–30（字段）、32–76（转换/枚举）、79–105（CLI、来源及覆盖写入）。 |

### DT07 · import-purchase-live.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 位置参数：源 XLSX、截至日期；必填环境 `DOON_IMPORT_EXPECTATIONS` 指向 JSON，rows/orders/suppliers 均为正安全整数。源件非空且≤10 MiB，须唯一一个匹配采购 14 列表头的页，表头在前 30 行；1–10000 条数据，采购单/供应商/商品编码/单位/数量必有，数量正数且≤1e9、最多四位小数，公式拒绝。 |
| 读取/产物 | 读 records、账号身份摘要；先在线备份全库/附件到 data/backups 并更新备份元信息。**purchase-preview 自身保存 purchase_import、计划 JSON 和原 XLSX**，然后每批最多 40 行新增/更新 purchase、job 进度和相关 audit。最终报告默认覆盖 `test-output/purchase-live-import.json`。 |
| 环境/默认 | 构建 `DOON_IMPORT_BUILD`，默认 CWD/lan-dist；数据由 runtime 的 `DOON_DATA_DIR`，默认 CWD/lan-data。无 data/report/mode/actor CLI 参数；报告父目录不自动创建。文件导入不等于金蝶/MES数据库连接。 |
| 加载/预览 | 顶层在参数校验前加载可写 runtime，可能创建库/表/目录；没有外部 dry-run。验收计数检查在 preview 已存数据后才进行，不能作为员工预览按钮。 |
| 当前身份/人工 | 选择第一个 active admin+owner，API 实际支持 admin/pmc，但 CLI 未保留真实员工身份。人工确认来源、截至日期、数量口径、差异与 held 明细。 |
| 异常/重复 | 多重匹配、旧来源、收货/退货/归档冲突可 held。按文件 hash 找既有 job，不单独区分新传截至日期；offset/已完成检查可抑制重复批次。全批无事务，失败可能前批已提交；计数检查不要求 held=0，后验失败不代表未写入，旧采购的整体断言也有适用范围限制。报告失败不回滚。 |
| 封装前/首批 | 保留操作员导入，不入首批。需真只读预览、held/差异人工确认、显式环境/身份/输出、批准载荷和按 job/offset/记录回读的恢复机制；不直接整批重跑或做无条件定时导入。 |
| 证据 | [入口](../scripts/data-tools/import-purchase-live.mjs)：7–24；[采购 API](../lib/purchase-api.ts)：26–50；[原表解析](../lib/purchase-import.ts)：7–26。 |

### DT08 · import-customer-quote.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--build-dir --draft --source`；draft.sourceSha256 可选。原件非空≤10 MiB，XLSX/XLS/PDF/PNG/JPG/JPEG 扩展及签名匹配。JSON 透传固定 company/collection/customer/contact/quote/date/currency/cost/charges/lines/terms/reviewNotes 字段；强制 customerAccountId=null，id/version 等其余字段静默丢弃，甚至不透传当前 API 已支持的部分业务字段。完整报价字段要求见模型，不按字符串自动强转数值。 |
| 读取/产物 | 文件检查后读全部 records；先保存 draft 报价/历史/审计，再上传原件、更新版本和历史/审计。**脚本没有内部备份**，仅 stdout 结果，无持久报告；不发送或最终确认报价。 |
| 环境/默认 | 构建及文件显式、相对 CWD；数据 `DOON_DATA_DIR` 默认 lan-data。无模式/data/report/actor 参数，当前参数解析不严格拒绝重复/未知项。 |
| 加载/预览 | 顶层执行，文件核查后导入可写 runtime；无独立 dry-run，创建与上传为两个提交。 |
| 当前身份/人工 | 新建时选择 active owner 管理员并注入 API；没有实际调用者会话。人工核客户代码/名称、售价、费用、完整草稿和原件；强制未关联客户不等于客户匹配已确认。 |
| 异常/重复 | 以 quoteNo+customerCode 查重，恰一份相同 draft/payload/sourceHash 且有原件引用才 no-op；不读原件字节验证该复用。已有草稿缺原件则停止，须补传已有草稿。保存后核验或上传失败可留草稿/孤立文件；finally 保全失败不恢复旧库，不能盲重跑。 |
| 封装前/首批 | 保留旧专项入口，新任务不从此扩展。需完整 schema、不静默丢字段、必填源摘要、真预览、真实身份/客户范围、明确备份/阶段恢复与最终字节回读；首批 B 改用 DT15 的收窄方案。 |
| 证据 | [入口](../scripts/data-tools/import-customer-quote.mjs)：8–25（参数/透传）、40–78（查重/两次写入/保全）；[报价模型](../lib/customer-quotes.ts)：11–40；[业务 API](../lib/customer-quote-api.ts)：84–128。 |

### DT09 · import-customer-price-archive.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--build-dir --dataset --customer-id`；可选 `--source-root --actor-member-id`，互斥 `--dry-run/--apply`，默认 dry-run。dataset 顶层 strict：schemaVersion=1、customer.code/name、files≤20000、products/prices≤100000、issues/excluded 默认空；各类型 ID 唯一，产品/价格/sourceRefs 引用存在，sku 范围需 SKU，数量范围正确。对象仍可保留部分未知字段，原输入摘要与解析后的默认值不能混用。 |
| 读取/产物 | 读 records、账号身份和 revision；无 source-root 则只导入元数据。有根时核每个 `status !== 'excluded'` 的原件相对路径、真实路径、非空≤64 MiB 和必填 hash。apply 先写 customer_price_archive/audit，再逐原件写 files 及档案映射/audit；**无本脚本备份**，stdout 报告。 |
| 环境/默认 | 构建显式，数据 `DOON_DATA_DIR` 默认 CWD/lan-data；当前源码模型通过 esbuild `write:false` 内存构建，未证明指定旧 bundle 已验收。无独立报告/批准摘要参数。 |
| 加载/预览 | 顶层解析和前检；默认只读库，不导入可写 runtime。apply 才加载 runtime，检查数据目录及前检 revision；不要求已有 dry-run 报告。 |
| 当前身份/人工 | actor 为指定活跃 admin/报价管理员且有对应本地账号；省略时须恰一个 active owner。核明确客户及代码，但不是实际员工认证。人工确认档案含义、来源、客户及原件范围，dry-run 不代替批准。 |
| 异常/重复 | 档案 ID 绑定 customerId+原 dataset hash，相同输入可复用，原文件同 hash 可复用；不同输入另建档案。多原件非整批事务，可能部分成功/孤立对象；`preserved:true,incomplete:true` 仍不是完成。未做每件最终物理字节回读。 |
| 封装前/首批 | 保留操作员历史档案入口。补完整输入/附件/环境/构建/有效期审批绑定、备份方案、逐件结果及字节核对；中断先查档案与原件状态，再受控补齐。 |
| 证据 | [入口](../scripts/data-tools/import-customer-price-archive.mjs)：9–55；[模型](../lib/customer-price-archive.ts)：5–18；[API](../lib/customer-price-archive-api.ts)：43–74。 |

### DT10 · import-customer-followup.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填首个位置参数 payload JSON；可选 `--plan --build --data --report --preflight`，`--apply` 为开关，默认 rehearsal。payload：UUID token、format=doon-customer-followup-v1、sourceKey、ownerId；followups≤1000（sourceId/source/title 等）、mails≤3000（sourceId/source、关联与正文等）、sourceFiles≤20（sourceId/filename/base64，解码总≤50 MiB）。API 数组有默认值，但 CLI 后验直接用原数组/邮件 draftStatus，故不能靠默认省略。plan 可含 sourceKey、newCustomers、teamId、promotions，缺少独立严格 schema。 |
| 读取/产物 | 读完整库/附件、payload/plan。演练和 apply 前均在线复制全库及 files；默认写副本，apply 可新建客户、扩团队范围、导入跟进/邮件/原件、转项目，产生多个业务类型/请求/审计。最后为验证源去重再次用新 UUID 调 import，仍可能新增请求记录。报告和检查点含私有数据。 |
| 环境/默认 | build 默认 CWD/lan-dist，data 默认 CWD/lan-data（不沿用原 DOON_DATA_DIR）；report 默认 test-output 下带时间文件。checkpoint 固定在 CWD/test-output/customer-followup-rehearsal/backup 前缀目录，自定义 report 不改变它。运行时重设进程 DOON_DATA_DIR 为副本或目标。 |
| 加载/预览 | 顶层执行且改进程环境。rehearsal 是完整快照上的实际写入，不是纯读。apply 需成功演练报告，绑定 payload/plan/bundle/sourceData、时间<24h，但未完整绑定 DB revision/runtime/Node/审批人，未来时间检查也不完整。 |
| 当前身份/人工 | 须唯一有效 owner 管理员与本地账号，内部 API 再验管理员/owner角色/客户责任和项目状态；没有真实发起人认证。人工分别确认新客户、团队范围、邮件/跟进来源和转项目，不能把复合 plan 当单一上传。 |
| 异常/重复 | 各客户、团队、导入、promotion 分别提交，整个流程无回滚。token 及 owner/sourceKey/sourceId/sourceHash 分层去重，不等于复合 plan 任意重跑安全。CLI 后验默认值/新增类型与当前 API 存在兼容性待核验点，报错可能已有提交；不得用 checkpoint 覆盖现库。 |
| 封装前/首批 | 保留低频迁移入口，不入首批。拆分受控动作、固定 plan 字段、统一规范化输入、补环境/版本/审批绑定及逐阶段回读恢复；日常员工跟进优先复用业务 API，不直接给迁移 CLI 加按钮。 |
| 证据 | [入口](../scripts/data-tools/import-customer-followup.mjs)：9–35（路径/快照）、44–95（身份/复合动作）、96–119（后验）；[API/schema](../lib/customer-project-followup-api.ts)：8–49、78–139。 |

### DT11 · import-ivy-service.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--backup --mapping --actor-id`；可选 `--apply --plan-hash`，默认 preview，apply 要 64 位小写 hash。backup≤10 MiB、mapping≤1 MiB。mapping strict：instanceId、customerBindings（sourceId/targetId/targetVersion，confirmedCustomerCode 可选、默认空）；waitingForOverrides 默认 `{}`，值枚举 customer/factory/jennifer/none。backup 必有 customers/waitingItems/projects/orders/samples/shipments/payments/tasks 八数组，后六类必须空；行保留 original，ID 不可空。 |
| 读取/产物 | 读取全 records/revision。把 customers 映射为既有客户的 service profile，waitingItems 转 followup；不迁整个外部系统。apply 新增 service_record/service_revision/audit，原客户只读引用。每次还会在 repo/test-output 生成临时 adapter 构建；stdout 输出预览/结果。 |
| 环境/默认 | 数据 `DOON_DATA_DIR`，默认 **repo/lan-data**；无 data/build/report 参数。模型从当前源码临时构建，不是指定已验收 bundle，临时目录未自动清理。 |
| 加载/预览 | 顶层执行；默认数据库只读，但 preview 也写临时构建。apply 可写打开已有库，不导入 runtime 建表；缺 apply hash 的后续检查失败前也可能已生成构建。 |
| 当前身份/人工 | actor-id 须活跃 admin，未验证本地登录会话。所有源客户须一一精确映射到不同的活跃现有客户，目标版本/代码正确；waitingFor 不能猜。人工确认映射与等待对象，既有 profile 不覆盖。 |
| 异常/重复 | apply hash 匹配且有增量才在线备份全库、附件并核哈希，保存原 backup/mapping bytes 和 prepared。`BEGIN IMMEDIATE` 重验 revision/记录数，插入后核旧记录字节、增 revision、commit，异常回滚增量。稳定 ID 按 instance/table/sourceId，相同来源跳过、冲突停止。提交后 manifest 失败仅警告，不代表未提交。 |
| 封装前/首批 | 保留迁移入口。planHash 包含 actor/revision/state/输入/计划，未绑定真实审批人、可执行代码、目标目录和有效期；补可信身份、受控构建/路径及提交后新结果回读，不把 preview 当零副作用。 |
| 证据 | [入口](../scripts/data-tools/import-ivy-service.mjs)：10–34（参数/构建）、61–110（读取/备份/事务）；[映射模型](../lib/service-ivy-import.ts)：5–75。 |

### DT12 · import-engineering-drawings.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--input --source --actor-id`；可选 `--apply --plan-hash`，默认 preview。input/source 均非空≤20 MiB，source 必须 XLSX/ZIP；input.sourceSha256 必须匹配原件，records 1–5000，各有同一存在页的 sourceSheet、唯一 sourceRow≥2、恰 13 个 A..M 地址/值的 sourceValues，并逐格核对原行，公式拒绝。qualityIssues 可选；其他 JSON 业务字段不直接采纳。 |
| 固定映射 | A..M 对应状态、客户编号、画图类型、需求日期、新款数、改图数、需求者、款号、备注、画图人员、截止/完成日期、历史审批。空数量为 null，否则非负整数；日期按原表固定格式核验。客户/人员 ID 保持空，不做模糊关联；全部 legacyNeedsReview=true，历史完成/审批标记不等于当前验收。 |
| 读取/产物 | 读原表、review JSON、全 records/revision，生成 engineering_drawing/engineering_drawing_revision/audit。apply 备份中保存原 XLSX、review JSON 及 prepared；本次原表**未注册为 files 附件引用**，记录仅保留来源行证据。stdout 结果，临时模型写 repo/test-output。 |
| 环境/默认 | 数据 `DOON_DATA_DIR` 默认 **repo/lan-data**；无 data/build/report 参数，当前源码临时构建模型，未证明已验收。 |
| 加载/预览 | 顶层执行；preview 已有库只读，但写临时构建；apply 才可写库，不经 runtime 建表。 |
| 当前身份/人工 | actor-id 须活跃 admin，不证明真实会话；人工核原件、逐行证据、映射口径及未知关联，人员/客户文本不自动映射为 ID。 |
| 异常/重复 | apply hash 匹配且有增量才在线备份全库/附件并核验；事务重读 revision/全部旧记录，插入新增、核旧记录保全、增 revision 后 commit，异常回滚增量。ID 按源文件 hash+sheet+row，同 source 跳过；文件字节变化产生新 ID，**不是跨修订业务去重**。manifest 失败可能已提交，只警告。 |
| 封装前/首批 | 保留历史迁移入口。planHash 尚未覆盖完整新增载荷、代码/目录、真实审批人/有效期；补完整批准绑定、修订去重、受控产物及新记录回读；不依据报告缺失盲重跑。 |
| 证据 | [入口](../scripts/data-tools/import-engineering-drawings.mjs)：11–60（输入/映射/构建）、75–132（备份/事务）；[模型](../lib/engineering-drawings.ts)：25–30、49–59。 |

### DT13 · export-workspace.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--data`、`--output`、`--scope ownership\|quote`。ownership 至少传 `--customer-ids` 或 `--member-ids`，逗号分隔且唯一；两者同时传取交集。quote 必须传 `--quote-id`、`--customer-id`；两类选择器不能混用。导出的函数为 `exportWorkspace({data,output,scope,customerIds,memberIds,quoteId,customerId})`。 |
| 读取/产物 | 只读已有 `workspace.sqlite`。ownership 读取客户身份、业务/客服成员 ID 及姓名；quote 导出单份当前报价白名单字段，**包括 internalCosts、internalNotesZh、汇率等内部字段**。写一个 `schemaVersion:1` 私有 JSON；控制台仅返回计数摘要。 |
| 环境/默认 | `data`、`output` 无默认；无需构建或 HTTP 服务。真实路径检查要求库在指定目录，输出及其已存在祖先不能位于来源数据目录。输出父目录可新建。 |
| 加载/预览 | 有 CLI 入口保护，正常 import 只定义函数。调用时用 SQLite `readOnly:true`、`query_only` 和读事务；不写业务库，但创建输出目录及文件。无单独 preview/apply 模式。 |
| 当前身份/人工 | OS 操作员，无员工会话/角色校验。客户或成员过滤是选择范围，**不是授权证明**。人工核对导出范围及接收对象；首批仅拟向已有授权的 owner 维护角色提供受控入口，身份及客户范围由服务端校验。 |
| 异常/重复 | 缺库、未知客户/成员、报价客户不符、非法存储字段/版本或重复参数报错。输出 `wx` 排他创建，不覆盖旧文件；失败可能已创建输出目录，不能把目录存在当成功。 |
| 封装前/首批 | A 开放 ownership 的指定客户集合；成员过滤仅作进一步缩小，不能放大授权范围。B 的 quote 仅作单张草稿维护的内部快照，不向普通员工开放完整原始导出。补任务产物 ACL、字段投影、大小限制、来源版本绑定及下载审计；浏览器不得传服务器任意路径。 |
| 证据 | [源码](../scripts/data-tools/export-workspace.mjs)：25（报价字段）、26–61（参数与路径）、63–108（只读查询与排他输出）、110–115（入口保护）。[现有合成用例](../tests/data-tools/prepare-export.mjs)仅登记，未运行。 |

### DT14 · audit-customer-project-relations.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | CLI 第一个位置参数为报告路径；数据根由 `DOON_DATA_DIR` 指定。纯计算函数 `auditProjectRelations(records)` 接收记录数组，检查引用、客户/项目/轮次一致性、循环和来源摘要。 |
| 读取/产物 | CLI 读几乎全部 records（排除 audit 及两类 request）、工作区 revision 和 `quick_check`；另读客户项目附件/跟进原件字节校验长度与哈希。写完整 JSON，并把包含业务标识/标题的完整报告打印到 stdout。 |
| 环境/默认 | 默认数据 `lan-data`，报告 `test-output/customer-project-relations-audit.json`；无需构建或 HTTP 服务。现有输出路径没有“必须在数据目录之外”和排他创建约束。 |
| 加载/预览 | 有入口保护；import 仅定义函数。CLI 库以只读/query_only 方式打开，数据库快照事务结束后才校验附件；文件与数据库不是统一时点快照。 |
| 当前身份/人工 | OS 操作员，未实施员工字段/资源可见范围。全库扫描结果可能暴露不可见记录。异常交业务/维护负责人核查，不自动修复。 |
| 异常/重复 | 缺失或哈希不符附件记为 issue；其他 I/O、JSON 或 SQL 错误终止。发现 issue 不等于进程必定非零退出；默认报告会覆盖，重复运行无业务写入。不能只按退出码判断审计通过。 |
| 封装前/首批 | 暂保留操作员手动审计，不纳入首批员工页面或定时任务。后续需显式数据/输出、禁止覆盖和输出越界、范围化报告、日志脱敏及可判断的审计状态；数据库/附件变动时应标为需重核，不自动修补。 |
| 证据 | [源码](../scripts/data-tools/audit-customer-project-relations.mjs)：8–56（计算）、58–68（默认值、查询、附件、报告）。[现有计算用例](../tests/customer-project-relations-audit.mjs)仅登记，未运行。 |

### DT15 · quote-maintenance.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--config --build --data --report`；`--rehearse` / `--apply` 必须二选一，apply 另需 `--preflight`。JSON：`schemaVersion:1`、`operation:create\|update-fees`、`customer:{id,customer,customerCode}`、`actor:{username}`、`readers:[{username}]`；可选 `quoteCustomerCode`、`preconditions:[{id,kind,sha256}]`，客户代码不同时必须有证据摘要。create 为非空 `quotes:[{payload,source:{path,sha256,filename?},media:[]}]`，媒体含 path/sha256/lineId/category；update-fees 为 `update:{before,payload,expectedExtraTotal}`，before 是完整既有 draft，id/version 与 payload 一致。 |
| 读取/产物 | 读完整 records、账号身份列、全附件及代码/构建摘要。两种模式均创建在线全库快照、全附件和代码副本、manifest、报告；**全库快照包含敏感账号/会话表，不是脱敏产物**。create 新增报价/媒体/原件及历史审计；update-fees 更新一张报价并新增历史/审计，禁止附件写入。 |
| 环境/默认 | 数据、构建、配置、报告、模式都显式，无默认正式路径；附件相对配置目录。已有库/账号/files/build 必须有效；报告须新文件、在 data/build 目录外，且不与 config/preflight 是同一文件。checkpoint 位于报告同级私有目录，另须在 config 所在目录外。来源/媒体须普通文件、哈希和签名匹配，单件有 10 MiB 限额。 |
| 加载/预览 | 主 CLI 顶层调用 main，不可直接 import；辅助 core 仅定义函数。rehearse 在完整副本中实际调用业务 API，**不是纯读预览**。apply 写指定 data；要求 24 小时内成功演练，绑定配置、代码、Node、构建、真实路径及附件摘要。技术 preflight 不等于人工审批。 |
| 当前身份/人工 | 按配置 username 找唯一、双向绑定的活跃 admin+owner；核客户及 preconditions，业务 API 重验客户写权限，readers 用于访问保全检查。尚无可信员工调用者、审批载荷或到期决定记录。人工确认客户、差异、费用口径与执行范围。 |
| 异常/重复 | `BEGIN IMMEDIATE` 后重验记录/账号/附件，业务 batch 使用 savepoint，保全通过才 commit；事务内失败回滚并只清理本次新附件。create 可复用完全一致的既有报价；update-fees 旧 before 会拒绝，**没有通用任务幂等回执**。commit 后报告写入失败可能 `success:false, committed:true`，必须回读，不能重跑或恢复旧库覆盖。runtime 初始化不在该业务事务内。 |
| 封装前/首批 | B 选单张 draft 的金额修改。原代码允许行 toolingFee 及部分描述/scopeNotes、customerCharges 数组、tooling 条款、internalNotes 和部分 reviewNotes，**并非仅改金额**；须新增更窄白名单，锁定输入业务字段中的既有 ID、顺序、数量和非金额内容；允许程序正常递增版本、维护元数据及追加历史/审计。再补真实身份、人工审批、持久任务回执和结果不明处理；全库副本须隔离、容量受控且不能给普通员工下载。create 不纳入。 |
| 证据 | [主入口](../scripts/data-tools/quote-maintenance.mjs)：18–76（路径、演练、快照）、96–140（身份）、145–260（事务、复用、失败）。[契约核心](../scripts/data-tools/lib/quote-maintenance-core.mjs)：40–51、75–122。[现有合成用例](../tests/data-tools/quote-maintenance.mjs)未运行。 |

### DT16 · publish-finished-outsourcing.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 位置参数 `preview\|apply` 与计划 JSON 路径。计划 `format:'finished-outsourcing-pending-plan-v1'`、supplier、1–20 个 lines；行含 lineId、正整数 orderVersion/quantity、productType=成品、businessType=finished_full_outsource、unit=付/副、note、互不重复的 UUID confirmToken/taskToken、cutoffDate、dueDate（可空）、1–20 个 steps（唯一 ID 且含 packing）。 |
| 读取/产物 | 读全部记录，核供应商、订单、数量和来源。apply 在线备份全库/附件并更新 local_meta 备份时间，逐行调用分类确认及任务创建，写订单/任务/事件/审计/回执。成功报告写计划旁 `basename-result.json`，可覆盖；stdout 包含业务明细，中途失败可能无完整报告。 |
| 环境/默认 | 构建 `DOON_BUILD_DIR`，默认 `lan-dist`；runtime 数据 `DOON_DATA_DIR`，默认 `lan-data`。不能凭 Request URL 判断目标；实际是本机 API 函数调用。 |
| 加载/预览 | 全部顶层执行；**preview 退出前已 import 可写 runtime**，可能创建目录、库、表和初始 revision。preview 也未完成 apply 才执行的所有权限/版本检查，不能作为安全只读入口。 |
| 当前身份/人工 | 自动寻找活跃 owner 管理员及其本地账号，内部 API 再检查订单/供应商、权限与版本；不是实际操作者认证。供应商、分类、数量、工序、日期和期初均由人工审核计划，未知期初不能当零。 |
| 异常/重复 | 单个 API 有事务和 revision guard，整份计划的多 API/多行没有整体事务；后续失败不撤销前序分类/任务。稳定 token 绑定身份、动作和内容，可复用同内容，异内容冲突；没有整批作业审批与完整回执。末尾保全失败也不能假定已回滚。 |
| 封装前/首批 | 保留操作员入口。先拆真只读 preview、真实身份/审批、固定目标、私有排他报告和逐步骤恢复；按原 token 核对局部结果，禁止换 token 盲重试。 |
| 证据 | [源码](../scripts/data-tools/publish-finished-outsourcing.mjs)：8–23（schema、默认、preview）、27–40（备份、逐项提交、报告）；[runtime](../standalone/runtime.mjs)：8–20、37、43–54。 |

### DT17 · configure-customer-quote-access.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--build-dir --config`；可选互斥 `--dry-run` / `--apply`，默认 dry-run。JSON 仅接受 memberIds（唯一数组，最多 1000，代码允许空）、aliasesByMember（名单内成员，每人最多 30 别名）、expectedMembers（默认空；id/name/username）、confirmedBindings（默认空；quoteId/customerAccountId/正整数 expectedVersion）。 |
| 读取/产物 | 读完整 records、revision、账号身份、附件哈希和数据库完整性。apply 创建初始报价策略/审计，并逐张绑定明确未绑定 draft 的稳定客户，生成对应历史/审计。输出 stdout 摘要，没有脚本内部备份或持久失败报告。 |
| 环境/默认 | build 显式；数据 `DOON_DATA_DIR`，默认 `lan-data`。dry-run 以只读库检查，apply 才导入可写 runtime。 |
| 加载/预览 | 顶层执行。默认 dry-run 不写业务库，不创建备份；仍读取真实配置及范围内外 records/附件，不能直接开放给员工。 |
| 当前身份/人工 | 验成员活跃、本地账号双向绑定及可选姓名/用户名；须恰一个有效 owner 管理员。报价必须是符合版本的未绑定草稿，客户有效。apply 注入 owner；人工确认权限名单、别名及每个首次绑定。 |
| 异常/重复 | 已有策略必须与计划一致；已有绑定仅在严格历史证据相同时跳过。策略事务与各报价保存**不是整体事务**，失败可能已完成部分动作。finally 核保全但不自动还原；无审批有效期或通用作业幂等键。 |
| 封装前/首批 | 保留 owner 配置入口，不入首批。需真实操作人、完整差异及独立审批、固定数据目录、备份/局部结果核对；不能把 dry-run 当批准凭据。 |
| 证据 | [源码](../scripts/data-tools/configure-customer-quote-access.mjs)：9–46（输入与只读）、50–101（身份及计划）、104–169（提交及保全）。 |

### DT18 · update-customer-quote-access.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--build-dir --config`；互斥 dry-run/apply，默认 dry-run。JSON 含 memberIds、aliasesByMember、administratorMemberIds、internalMemberIds、customerMemberIds、非空 expectedMembers（id/name/username/accountId）、expectedPolicySha256（当前完整策略 canonical SHA256，无策略时 null）；writableMemberIds 可选。授权成员必须在名单和 expectedMembers 内，客户键必须有效。 |
| 读取/产物 | 读全部 records 与账号身份；apply 经 `customer-quote-access-update` 写策略和审计，回读无关记录及账号身份。只输出摘要，无脚本内部备份/持久失败回执，未做全附件回读。 |
| 环境/默认 | build 显式，数据 `DOON_DATA_DIR` 默认 `lan-data`。默认只读库，apply 才加载 runtime/API。 |
| 加载/预览 | 顶层执行；dry-run 不打开可写 runtime，不写策略。不能据此跳过真实员工认证、字段与资源授权。 |
| 当前身份/人工 | 核 expectedMembers 的活跃身份、姓名、账号与双向绑定；writer 角色限 sales/clerk/pmc；恰一个本地 owner。内部 API 要求有效系统管理员并校验客户和成员。人工审核完整权限差异，配置 username/accountId 不是操作者身份。 |
| 异常/重复 | API 旧策略哈希及 revision 检查，策略和审计单次原子提交；相同当前内容可 alreadyPresent，成功后旧 hash 再用会冲突。省略 writableMemberIds 会继承旧策略，不能解释为清空。后验检查失败可能已提交，不自动回滚。 |
| 封装前/首批 | 保留 owner 权限入口。需完整前后字段预览、真实身份/审批、目标目录固定、持久回执及不明结果核对；不交模型决定权限。 |
| 证据 | [源码](../scripts/data-tools/update-customer-quote-access.mjs)：8–27（参数及身份）、30–34（提交/回读）；[策略 API](../lib/customer-quote-policy-api.ts)：9–19。 |

### DT19 · set-customer-price-selection.mjs

| 登记项 | 当前行为与封装约束 |
| --- | --- |
| 输入 | 必填 `--build-dir --config`；互斥 dry-run/apply，默认 dry-run。JSON：customerAccountId、expectedCustomer:{id,customer,customerCode}、invoicePreference（null/rx/solar/highest/both）、非负整数 expectedVersion、expectedSelectionSha256（null 或 64 位小写 SHA256）；可选 configurationNotes 必须恰含 rx/solar 字符串，各不超过 2000 字。 |
| 读取/产物 | 读 records 与账号身份；apply 写该客户的价格选择及审计，增加版本；未传 notes 时保留旧值。回读无关记录及账号身份，只输出摘要；没有脚本内部备份或持久失败报告。 |
| 环境/默认 | build 显式，数据 `DOON_DATA_DIR` 默认 `lan-data`；无需远端 API 地址。 |
| 加载/预览 | 顶层执行。dry-run 仅只读库，apply 才导入可写 runtime/API。 |
| 当前身份/人工 | 核活跃客户及名称/代码、该客户最多一条 selection、旧版本/摘要、唯一有效本地 owner；内部 API 再验报价管理员及客户 eligible 范围。规则选择与商业说明由业务负责人确认，不能由 LLM 推断。 |
| 异常/重复 | selection+audit 单次原子提交；当前版本/摘要匹配且内容相同时 no-op，成功后旧版本重试拒绝。后验检查异常可能已经提交，须回读核对，无通用任务级幂等恢复。 |
| 封装前/首批 | 保留业务配置入口，不入首批。补业务决定证据、真实操作者、载荷/版本/有效期绑定、固定目标和持久回执；不扩大现有权限。 |
| 证据 | [源码](../scripts/data-tools/set-customer-price-selection.mjs)：8–25（输入、默认、核对）、26–31（提交/回读）；[业务 API](../lib/customer-price-archive-api.ts)：44–53。 |

## 4. 首批封装范围：3 个入口，按 A、B 顺序交付

以下是 T02—T05 的具体开发边界，均走 `main`。2026-10-17 已实现 A/B 的独立应用入口，使用合成数据验证；操作、权限、回执与迁移说明见 [首批固定程序工具](fixed-data-tools.md)。未部署到 8787，也未改造全部 19 个入口。

| 批次/操作 | 明确纳入 | 明确排除 | 必须补齐后才能验收 |
| --- | --- | --- | --- |
| A1 文件检查 | DT01 的 `inspect`、`rows`；用户指定工作表、表头/行列范围；新建检查或行数据产物 | 图片提取、文件拆分/合并、价格推断、原文件覆盖和任何数据库连接 | 文件归属与访问校验；文件/解压体积、行数、耗时限额；无任意路径；原件哈希保全；未知值可见；产物 ACL |
| A2 客户归属只读导出 | DT13 的 `ownership`；指定、已授权的客户集合，成员过滤只缩小范围 | 全库无范围导出；把过滤条件当授权；普通员工下载包含报价内部字段的快照 | 真实会话及 owner/客户范围检查；字段投影；固定输出目录；来源版本/摘要；产物下载权限；不接正式库做测试 |
| B1 单张草稿费用维护 | DT15 的 `update-fees`，只针对一张已存在且版本匹配的 draft；拟只调整既有报价行 `toolingFee` 与既有 `customerCharges` 项的 `amount`。DT13 `quote` 仅用于该流程内部准备与对比 | create、批量更新、增删费用项/行、单价/数量/客户变更、说明/条款修改、附件增删、确认报价、权限修改及正式写入试点 | 除费用金额外的输入业务字段和既有 ID 锁定，允许程序正常递增 version、维护元数据及追加 revision/audit；差异预览与人工确认绑定；执行前鉴权/版本重验；幂等操作回执；失败回读；只改批准范围；先完成 A 与 T02/T03 |

B 保留当前维护入口所要求的有效 owner 和目标客户既有访问边界，不能把配置中的 `actor.username` 当员工身份。业务负责人审核费用口径与确切差异；执行人由可信会话/任务身份确定。先证明合成数据下的预览、拒绝、过期、执行和回读闭环，不能据此开放正式写入。当前 CLI 的演练会复制完整库和附件，不能未经隔离与容量评估直接放入在线请求。

旧 quote 维护 CLI 原生允许修改的字段比 B 更宽；新在线 B 入口已实施独立的严格服务端金额白名单，未知字段拒绝，行数量/顺序/编号保持原样。A2/B 自 2026-10-20 起向有效管理员开放，所有者标记仅用于初始账号保护；工具本身不修改角色或账号授权。

DT02–DT12、DT14、DT16–DT19 继续保留各自操作员边界，未开放子操作同样保留。例如 DT01 的 images、DT15 的 create 都不因同文件入选而一起开放。维护、迁移、权限配置和备份职责不得交给模型。

## 5. T02/T03 接手约束与责任

- **开发负责人**：按操作 ID 枚举入口，拆开校验/预览/执行；不动态 import 旧 CLI，不提供任意 Shell/SQL/路径。登记中的正式默认路径在封装入口必须消除，采用服务端配置的独立环境与任务目录，不能由浏览器选择数据根或构建根。
- **权限管理员与后端开发**：核对真实身份、客户/文件/字段范围；读取、预览、审批、执行、结果查询和下载分别检查。当前操作员权限不是目标 API 的可复用授权。
- **业务负责人**：确认 A 的输入与范围和 B 的费用定义、可变字段及异常处理，保留未知项；人工确认绑定完整载荷、目标、来源/规则版本及有效期，拒绝/暂缓/超时不执行。
- **测试与运维**：使用合成数据、隔离构建/数据/产物目录和测试端口；检查模块加载、预览和失败的副作用，记录实际结果而非只看退出码。未使用模型即可跑通 A/B；不连接或改动 8787。
- **实际人员分配**：以上为责任岗位，尚未指定个人；具体人员与权限范围在对应任务开工时登记，不写真实员工或客户信息到公开仓库。

首批任务契约现由操作 ID、受权限控制的文件/记录 ID、严格参数、来源版本/哈希和任务回执组成。内部数据库和产物使用部署注入的绑定，输出只返回有权限的任务句柄；历史记录与产物查询仍重新鉴权。其他入口继续按上述约束逐项实施。

## 6. T01 完成证据与未完成项

- 19 个顶层脚本一一对应 DT01–DT19；每项登记输入、读写资源、环境/默认路径、加载与预览副作用、当前身份、异常/重复行为、人工点和封装缺口。
- 首批已限定到 3 个入口的具体子操作，A/B 的依赖、暂缓范围和责任岗位已明确；无需全量迁移，也无需模型评测或 Agent 中心作为前置。
- T01 登记当时采用静态源码与文档核查。后续首批封装的合成测试及实现边界单独记录在[交付说明](fixed-data-tools.md)，不将旧测试入口存在当作本次通过证据。
- **T01 完成的是登记和范围决策。** 首批新增在线入口已补充员工鉴权、无路径输入、预览分离及幂等回执；旧 19 个 CLI 没有整体重写。19 项都“已登记”不代表都“可上线”。

后续依赖及验收保持在[第一阶段实施清单](phase-one-implementation-checklist.md)维护；本表作为入口边界的详细依据，改变任一脚本行为或首批范围时同步更新。
