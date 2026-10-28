# W10全栏目收尾验收

2026-10-28（Asia/Shanghai）。当前已按最新远端基线接入实际源码；开发通过、阶段验收和正式业务授权分别记录。

0.39.0登记396条唯一命令，基础7条前置；12条金蝶暂缓，本期384非金蝶。W10新增管理6、通讯9、工具15，共30条。91项CLI、网站/CLI类型、72组/30条真实隔离接口检查、402项全站及全部独立子套件、18项独立HTTP通过；Windows成品384条/217组、CI及GitHub来源核验通过。此为W10基础批，不宣称所有网页表单已覆盖。下文开发期“待验”描述保留为历史过程，以文末最终验收为准。

| 检查 | 当前结果 |
| --- | --- |
| 合并CLI/服务器类型 | root通过 |
| 396唯一目录、基础7条前置 | root通过 |
| 原生API/进程内Commander集中检查 | 最新72组、30条新增命令通过 |
| 父记录、原件及临时数据/进程 | 逐值/字节保全，全部session exit0并清理 |
| 正式、真实SMTP及金蝶请求 | 0 |
| 文档、命令生成器及目录 | 本次补齐；仅执行文档生成，未重跑类型/targeted |
| 完整CLI/字段/命令检查 | 91项及字段/命令说明通过 |
| 全站、独立HTTP | 402项及全部独立子套件、18HTTP通过 |
| Windows0.39安装后384条本期命令 | 未通过，待执行 |
| CI、GitHub成品来源及安装核验 | 未通过，待执行 |
| IE sales_approval通知正向 | 补充独立通讯套件13组/9命令本地合成通过；Windows仍待验 |
| 实际源码应用、提交及部署 | 已接入，提交同步及成品验收进行中；未部署 |

基线为实际W8加未来W9代码，通讯framework先合入，管理局部patch随后，主route仅局部挂接。保留W8 AR导出范围、付款eligible和W9售后，文档不整份覆盖W9及root后来验收记录。

`admin management schema/references/form/save/action/history`提供11种固定save及4种离岗动作。沿用管理员或原框架配置角色，完整表单携带真实version、完整来源hash和UUID；重放重核当前身份，保全未知字段、既有userId/邮箱/创建时间。业务成员新增是未绑定身份，不写认证账号表。AR读取grant、项目财务核实grant、付款授权名单、IE/客价/双签政策分别按原规则维护，不从目录可见推断核实权限。离岗由指定接收人本人确认，管理员完成时重核库存/来源hash，原子转交并停用，保留全部历史；不能代接收或自动接受。

`management communications schema/list/references/form/history/context/preview/save/action`按固定resource/type复用人工email/WhatsApp、统一沟通、通知、知识和通知邮箱。原客户、渠道、项目/订单与版本/来源/内容hash继续有效；手工稿、processed、本人接收、负责销售内部核对和发送各自独立。新CLI写邮箱要求UUID，登录身份不改；知识22键只读全文，缺失保持缺失，没有导入/维护或Shell补齐入口。 IE内部通知仅固定原生协议，服务器决定收件人/邮箱与原Excel附件；engineering与sales_approval正向均经本地合成transport验证；sales_approval补充独立通讯套件13组/9命令通过，Windows成品仍待验。sending/unknown先查原历史，不自动重发；不宣称真实SMTP已验证。

`system workspace schema/list/form/references/history/save/action/inspect/preview/commit/workbook/ownership/report/template/file-download`覆盖原跟进待办、财务协作任务、普通/原版导入、精确owner绑定和固定工具。comment要求订单版本+UUID，task要求完整原hash/版本；财务任务save/submit/accept/return/review/cancel只做协作，不产生现金。owner按明确ID/版本与previewHash一次原子提交，不循环姓名/30行旧接口。普通导入每批200行、原版35行，绑定原件hash、原选择/原因/offset及计划行摘要；旧原版缺rowsHash/writeContract只回读和下载，不补造历史摘要去提交。报表生成归档hash/ID；旧报表未存摘要时明示为本次只读计算的当前原件hash。

固定工作簿和客户归属工具仅管理员；未知归属不猜测。文件/费用预览可能保存任务和原件，inspect及owner预览只读。费用保留原报价单位/null，不能套AR整数分；fixed-decision须显式填写原job/previewHash及approve/reject/defer，由原程序重核版本、范围、规则和有效期，不接聊天批准、不自动approve。没有任意HTTP/SQL/Shell或SMTP兜底。结果不明先查询原请求/批次，不换UUID盲重提。

保留W8 AR导出范围、付款授权人当前角色及未来W9售后；业务成员新增不创建登录账号。框架执行关闭，模板/路径仅登记；知识没有维护API。账号密码、正式运行配置/调度/备份/部署及真实外发不因本批自动授权。

维护状态沿用原网站与doctor，认证维护/备份动作没有加入CLI。W8 main4cb613f与local8e8fe15代码树同步成功，0.37完整成品仍待最终结果；不得借用其他批次检查宣称W10阶段通过。8787、正式业务库/原件、真实账号权限及外发未因文档收尾改变。

补充独立通讯验证为13组/9命令，包含sales_approval正向；原集中仍为71组/30命令，未重跑，不能合并成72组。固定总经理收件人、cc空、原Excel哈希、旧报价版本/旧fingerprint拒绝、UUID同内容重放与异人/异内容冲突均已核对；发送后客价保持草稿。证据为本机忽略目录的[13组结果](../test-output/w10-sales-approval-review/result.json)、[局部测试补丁](../test-output/w10-sales-approval-review/sales-approval.patch)与[跑法](../test-output/w10-sales-approval-review/RUN.txt)，不随公开源码发布；Windows及上表其他未过项不变。

## 最新实际接入验证

已保留e2cf4cb的业务沟通入口及数据权限保护。91CLI、网站/CLI类型、命令说明、72组真实隔离API/Commander（30条新增）、18HTTP通过，原记录/原件保全，正式请求0；整站、Windows成品与GitHub来源仍待验。

## 本次回归修正与覆盖边界

整站初次因MES失权账号先遇到编号冲突而未按原规则403拒绝而失败；已将当前MES写权限移至来源/冲突/重放前检查，完整回归重跑402项和全部独立子套件通过。记录cli-w10-business-regression-final2.log，类型和原生18HTTP重跑通过。

W11审计确认客服独立记录四类及项目协作任务需要继续补齐，不能以W1近似模型代替。客服补齐只在忽略目录准备，尚未应用或验收。用户已取消WorkBuddy实机操作，后续自行完成自动验证，WorkBuddy不标已通过。

## 2026-10-28 基础批成品最终验收

测试环境，不含正式业务数据。实际安装后的384条本期命令、217组合成检查通过；原记录与附件保全，测试数据、安装及会话清理。CLI CI 40658957951、Native CI 40658958036均成功，GitHub artifact 12803302281下载后完成摘要、清单、安装与程序字节核验；仅6份文档有换行差异。

源码本地提交 `1b9d1362e0cecb8a95af18307b659b6614f6c0db` 与远端 `59d2cd6d4d4f5909af286e89bbae9777696dad0a` 完整Git树相同：`f59bfe08b343978a1d6bc61e845f9cc831c471ed`。保留远端e2cf4cb新增业务沟通及数据保护规则，提交不部署。

| 成品 | SHA-256 |
| --- | --- |
| 本地0.39.0 ZIP | `03e65d9e0df7f7132fffd56b69091b508e5860456880ee26dcf3218616d31f01` |
| GitHub artifact外层 | `ac7c2a74fe7219a776fa1d9cfc3e1c5e49959c2ce07e105b1a946a40ce0ef358` |
| GitHub内层安装ZIP | `98f423e0e2bc5b2a913b280355d1328b2d5e837c71b871596f527f9ea3ba53c7` |

本机被忽略的报告：`test-output/cli-0.39-local-package-acceptance.json`、`cli-0.39-ci-download-verification.json`。这批包含engineering和sales_approval本机合成通知正向检查，没有真实SMTP外发。

W11升级验证新增可复用工具 `cli/scripts/test-windows-upgrade.mjs`，最终脚本实际重跑通过。0.38→0.39→0.38经安装后的真实入口验证版本切换；两个版本程序完整保留，配置和加密合成DPAPI会话逐字节不变，网络请求0、用户PATH不变、临时目录清理。报告为 `test-output/cli-0.38-to-0.39-upgrade.json`。这不代替员工实际环境验收。

基础批成品完成；W10剩余客服四类独立记录、项目协作任务及上游新增通用业务跟进继续补齐。客服/协作16条候选在隔离目录通过61组集中检查，未并入产品源码、未完成实际包验证。W11容量、完整覆盖、员工实机与正式分发入口仍待，不宣称全栏目完成。用户取消WorkBuddy操作，互操作仍未验证。
