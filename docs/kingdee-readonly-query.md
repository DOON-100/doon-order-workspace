# 金蝶采购订单只读查询

入口：供应商管理工作台或采购未上货订单总表，点击「更新金蝶总表」旁的「同步金蝶总表」。弹窗明确标注「只读查询」，填写可选的单据日期范围后点击「只读查询金蝶」。

本功能按用户 2026-10-21 的要求只读查询。查询结果仅在弹窗显示；关闭即清除。不生成导入批次、采购来源快照、业务关联或业务审计记录，不修改已有订单、采购台账、附件和权限。不设定时任务，不回写金蝶。原有 Excel 上传入口仍沿用原流程，属于另外的人工操作。

## 查询口径

- 产品：金蝶云星辰；固定网关 `https://api.kingdee.com`。
- 列表固定为已审核采购订单，单据日期可选，每页 5 张。逐单读取商品行，再复查本页列表数量和内容；分页缺失、重复或变化时整页报错，不展示半页结果。
- 按商品行 `entry_realio_status` 区分未入库 A、部分入库 Z、全部入库 C。排除 C；未知状态保留并标为「待核查」。单据和行关闭状态单独展示，不以关闭推断入库完成。
- 总采购单数包含全部入库订单，不是未上货订单总数。某页无待入库商品行不代表其他页为空。分页读取不能保证不同页或商品行在同一时刻取得，界面显示读取起止时间。
- 数量展示源字段 `qty`，不计算剩余量。交货日期只使用商品行 `delivery_date`；单据 `due_date` 是结算日期，不能代替交期。
- 尚未核验客户订单自定义字段，不把 `src_bill_no`、客户名称或商品名称猜测为中台订单关联。查询结果不替换已上传总表。
- 只允许现有有效 PMC / 采购和管理员账号查询。因 API 商品行尚无已验收的小组关联，带业务小组筛选的请求拒绝访问，须由具有全表权限的账号在全部范围查询。

## 服务器私有配置

默认关闭，未配置时按钮可打开说明，但不会调用金蝶。原生服务通过进程环境读取以下变量；云端运行时使用同名私有 binding / secret：

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

应用侧为 `GET /api/workspace/kingdee-readonly-status` 与 `GET /api/workspace/kingdee-readonly-query?page=1&start=YYYY-MM-DD&end=YYYY-MM-DD`。不提供对应 POST 写入接口。状态接口仅检查配置完整性，不代表鉴权或网络已成功。每页查询才实际连接金蝶。响应只投影表格所需字段，不回传密钥、令牌、联系方式、价格或附件地址；不记录上游原始错误、请求头和完整 URL。

## 开发验证

`node tests/run.mjs` 包含合成金蝶响应测试：签名编码、凭据角色区分、账套与路由核验、令牌缓存、分页复核、状态缺失、保留关闭行、权限、小组范围、限流和网络异常。查询前后逐值比较原业务记录和文件，确认零业务写入。

运行 `node node_modules/typescript/bin/tsc --noEmit`。内网构建与验收使用独立 `DOON_BUILD_DIR`（例如 `test-output/kingdee-readonly-build`），执行 `node standalone/build.mjs` 和 `node standalone/test.mjs`；不得覆盖正式 `lan-dist`。合成测试不代表目标账套已开通采购 API 权限，也不代表已上线。

## 官方依据

2026-10-21 核对官方页面内容：

- [采购订单列表](https://open.jdy.com/#/files/api/detail?index=3&categrayId=3cc8ee9a663e11eda5c84b5d383a2b93&id=9e4fc58f712511eda0b3a33cf6007dda)
- [采购订单详情](https://open.jdy.com/#/files/api/detail?index=3&categrayId=3cc8ee9a663e11eda5c84b5d383a2b93&id=9e50aff0712511eda0b35bde18fd6367)
- [主动获取授权](https://open.jdy.com/#/files/api/detail?index=3&categrayId=5403e0fd6a5811eda819b759130d6d33&id=801d558dda9d11edbfb2d572de04f9ce)
- [换取 app-token](https://open.jdy.com/#/files/api/detail?index=3&categrayId=5403e0fd6a5811eda819b759130d6d33&id=9076d1a6da9d11ed8e36874bed64e0be)
- [网关签名](https://open.jdy.com/#/files/api/detail?index=3&categrayId=5403e0fd6a5811eda819b759130d6d33&id=b5c26557da9d11ed8e36f9799578d2e1)
