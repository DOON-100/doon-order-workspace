# 岗位协作中台接口

接口默认关闭。当前代码在 Agent 测试分支验证，提交不代表启用正式服务。中台与 worker 独立运行，员工仍使用中台工作台。

## 服务端配置

启用需要 `DOON_AGENT_PLATFORM_ENABLED=1` 与 `DOON_AGENT_PLATFORM_SECRET_FILE`。私有 JSON 文件包含 `token` 和 `serviceMemberId`；token 使用至少 32 字节随机值的 base64url 编码。配置文件和密钥必须置于忽略的私有目录，由服务进程读取，不进入命令行、URL、员工页面、镜像、日志或 Git。

`serviceMemberId` 引用既有内部有效成员，决定服务可以读取的业务范围；不自动创建成员或扩大员工权限。接口不向供应商、员工公网网关或验收副本开放。当前单一服务身份模式不支持多个 worker 各自订阅，正式扩展前需设计消费者隔离与密钥轮换。

独立协作配置由有效管理员调用 `/api/agent-platform/bindings` 创建，明确 sourceId、审核人、协调人、配置版本及稳定请求ID。服务身份、审核人和协调人必须当前均有来源读取权限。当前只支持采购核查/协调方案，不支持任意业务动作。

## API

| 接口 | 身份 | 结果 |
| --- | --- | --- |
| `GET /api/agent-platform/identity` | 原生员工 session | 当前有效身份，不返回凭据 |
| `GET /api/agent-platform/inbox` | 原生员工 session | 本人当前授权范围中的持久事项 |
| `POST /api/agent-platform/decide` | 原生员工 session | 批准、退回、拒绝；保存身份、方案与事件 |
| `POST /api/agent-platform/bindings` | 管理员 session | 增量设置对象与人员映射，不改业务源记录 |
| `GET /api/agent-platform/status` | 管理员 session | 配置、待处理数、观察器状态 |
| `POST /api/agent-platform/service/poll` | Bearer 服务身份 | 当前范围内的事件、证据投影、配置及人工回执，支持去重确认 |
| `POST /api/agent-platform/service/review` | Bearer 服务身份 | 保存完整待核验方案，收件人由中台映射决定 |
| `POST /api/agent-platform/service/verify` | Bearer 服务身份 | 重新校验恢复/完成前置条件并保存核验回执；不执行源单写入 |
| `POST /api/agent-platform/service/escalated` | Bearer 服务身份 | 幂等登记超时升级，不完成原待办 |

所有 POST 继续执行原生同源校验。服务调用必须使用中台 Origin 与 Authorization；浏览器转发不能获得服务 token。员工接口每次检查真实 session 和当前权限，不能通过模型或请求参数冒充员工。只有服务身份可以取得其授权范围的业务投影；不提供 Shell、文件或数据库访问。

启用时原生 HTML 加载 `agent-workbench-inbox.js?platform=native` 和 CSS，使用现有“我的待办”事件桥渲染。无 Studio 权限也可处理本人待办；原生组件不会显示合成收货、手动启动或验证管理按钮。关闭功能时不会加载组件或发出额外轮询。

## 数据与执行边界

中台只新增 `agent_*` 独立记录。每条记录保存完整方案、来源/配置/规则版本、有效期、处理历史与消费回执；业务源、成员主键和附件仅按授权引用。接口启用和绑定不会改变已有采购数量、交期或账号权限。

采购批准确认内部跟进方案，不代表收货或对外承诺。既有收货程序仍由有权限员工操作；实际收货变化可触发下一轮证据核验。协调批准仅允许 worker 在重验后恢复原岗位任务，随后还需新的采购确认。`manual-handoff` 接管确认永远不能用于自动恢复。员工回执、中台核验与 worker 实际执行结果必须区分。

当前变化发现为已绑定来源的定期/提交后观察，观察间隔内的变化可能合并。中台故障、撤权、模型失败和人工未处理不能被解释为成功。正式启用前必须保留一致性数据备份和代码回退点，核对原数据与附件；失败只回退代码，不自动以旧库覆盖运行期间增量。实际部署和真实人员任务需要独立授权，本地链路验证不代表已经上线。
