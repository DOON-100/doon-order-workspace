# 金蝶采购订单一键同步

入口：供应商管理工作台或采购未上货订单总表，点击「更新金蝶总表」旁的「同步金蝶总表」。直接执行，没有预览或二次确认；一次点击只执行一个有上限的批次，不创建定时任务。

## 同步规则

- 金蝶业务接口只读；中台仅新增独立 `kingdee_pending_api_row` 记录、批次回执、进度与摘要审计，已有订单、采购跟进、源文件、历史版本和权限不改动。
- 每次检查一页已审核采购单（最多 5 张），读取商品行并复核列表完整性。只将未入库 A、部分入库 Z 的有效行纳入新增；全部入库 C 排除，未知入库状态或必要字段缺失跳过并计为待核查，不自动创建人工任务。关闭状态原样保留，不据此推断已入库。
- 单次最多新增 **30 条商品明细行**。同页余下新行留给下一次点击；没有余下新行则推进下一页，末页后回到第一页。全为已有记录的一页可能新增 0 条，不自动继续翻页。采购总数变化时从第一页重新检查。分页期间来源不是全账套同一时刻快照。
- API 记录以账套 ID、采购单 ID、商品行 ID 为稳定键。旧采购台账（含归档）和所有已保存 Excel 版本按采购单号、商品编码、供应商、单位匹配；已存在即跳过，数量、日期和备注变化也不更新。旧数据同单号但无法准确匹配时暂不新增。
- 写入前重读候选订单并核对来源；原子提交在数据库修订号未变化时保存新增行、游标、回执与审计。并发冲突、源变化、存储错误整批失败，不留下部分新增。
- 每次点击携带随机请求 ID。响应丢失先回读同 ID 回执，再用原 ID 重试，避免重复执行。单实例同账套运行锁与数据库修订号共同防止并发重复新增。
- 当前总表合并展示原 Excel 与 API 新增记录，历史版本和「来源原表」仍是原 Excel。源数量使用 `qty`，不推算未上货剩余量；交期只取 `delivery_date`，不使用结算日期 `due_date`。客户订单关联尚未核验，留空而不猜测。
- 仅有效 PMC / 采购和管理员可同步；带业务小组筛选的同步请求拒绝，需在具有全表权限的全部范围操作。新增行按原有采购表的读取权限显示。

## 服务器私有配置

默认关闭，未配置时点击按钮提示连接未配置，不调用金蝶、不写入中台。原生服务通过进程环境读取以下变量；云端运行时使用同名私有 binding / secret：

| 变量 | 用途 |
| --- | --- |
| `DOON_KINGDEE_READONLY_ENABLED` | 值为 `1` 才启用 |
| `DOON_KINGDEE_CLIENT_ID` | 目标应用 ID |
| `DOON_KINGDEE_CLIENT_SECRET` | 应用 Client Secret；与企业 appSecret 不同 |
| `DOON_KINGDEE_INSTANCE_ID` | 明确指定正式企业授权实例，不能沿用沙箱实例 |
| `DOON_KINGDEE_ACCOUNT_ID` | 固定目标账套 ID，不默认选第一个账套 |

密钥应由管理员通过私有运行配置或凭据管理器注入。不要放在命令参数、URL、网页输入框、仓库文件或日志中。Windows DPAPI 加密配置不能直接在 Linux 使用。不要因提交代码自动修改生产配置或重启服务；正式启用按项目发布及备份规则单独执行。

授权材料需同时匹配应用、实例、账套和有效状态，且恰好一个匹配；路由来自授权响应并限制为 HTTPS 的金蝶 `*.jdy.com` 域名。令牌仅在服务端内存缓存 23 小时，凭据改变会失效；同进程并发鉴权合并，失败后限制再次请求频率，不盲目刷新重试。服务多实例运行时，每实例各有缓存，应另行评估金蝶令牌接口限流。

只有以下固定金蝶调用：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/jdyconnector/app_management/push_app_authorize` | 获取企业授权，空请求体，不提交业务单据 |
| GET | `/jdyconnector/app_management/kingdee_auth_token` | 获取令牌 |
| GET | `/jdy/v2/scm/pur_order` | 查询已审核采购订单 |
| GET | `/jdy/v2/scm/pur_order_detail` | 查询采购商品行 |

应用侧接口：

- `POST /api/workspace/kingdee-sync-run`，只接受 `{requestId: UUID}`，服务端固定范围与 30 行上限；不接受浏览器提交的源行、页码或数量上限。
- `GET /api/workspace/kingdee-sync-result?requestId=UUID`，只回读当前操作人的批次结果，不重新同步。
- 保留 `GET /api/workspace/kingdee-readonly-status` 和 `GET /api/workspace/kingdee-readonly-query?page=1&start=YYYY-MM-DD&end=YYYY-MM-DD` 供只读诊断。状态接口只检查配置，不代表网络成功；只读查询不写中台。

回执只返回新增、跳过、待核查、本页余量和分页统计。凭据、令牌、联系方式、价格和上游原始错误不进入响应与日志。运行变量中的 `READONLY` 指金蝶业务访问方式，不禁止已授权的中台新增。

## 开发验证

`node tests/kingdee-sync.mjs` 专项使用临时 SQLite、合成金蝶响应，覆盖 30 行上限、同页续传、跨页、旧台账/原表去重、源变化不覆盖、回执幂等、并发、事务回滚、权限、历史原件不变。`node tests/run.mjs` 包含该专项与只读客户端测试。

运行 `node node_modules/typescript/bin/tsc --noEmit`。内网构建与验收使用独立 `DOON_BUILD_DIR`（例如 `test-output/kingdee-sync-build`），执行 `node standalone/build.mjs`、`node standalone/test.mjs` 和 `node standalone/test-kingdee-sync-browser.mjs`；不得覆盖本机正式 `lan-dist`。浏览器测试使用合成响应，验证一键执行、失联回读和手机布局。生产发布另按备份、回退和完整性核验规则执行。

## 官方依据

2026-10-21 核对官方页面内容：

- [采购订单列表](https://open.jdy.com/#/files/api/detail?index=3&categrayId=3cc8ee9a663e11eda5c84b5d383a2b93&id=9e4fc58f712511eda0b3a33cf6007dda)
- [采购订单详情](https://open.jdy.com/#/files/api/detail?index=3&categrayId=3cc8ee9a663e11eda5c84b5d383a2b93&id=9e50aff0712511eda0b35bde18fd6367)
- [主动获取授权](https://open.jdy.com/#/files/api/detail?index=3&categrayId=5403e0fd6a5811eda819b759130d6d33&id=801d558dda9d11edbfb2d572de04f9ce)
- [换取 app-token](https://open.jdy.com/#/files/api/detail?index=3&categrayId=5403e0fd6a5811eda819b759130d6d33&id=9076d1a6da9d11ed8e36874bed64e0be)
- [网关签名](https://open.jdy.com/#/files/api/detail?index=3&categrayId=5403e0fd6a5811eda819b759130d6d33&id=b5c26557da9d11ed8e36f9799578d2e1)
