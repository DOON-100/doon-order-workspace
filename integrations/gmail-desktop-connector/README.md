# Gmail 本机连接器

Windows 本机通过 Gmail API 收发邮件；独立 Chatwoot 容器显示原生邮件界面并保存操作队列。Google OAuth 令牌只保存在本机，以 Windows 当前用户的 DPAPI 加密。连接器不读取、挂载或修改中台业务数据库，不要求更新中台程序。

## 行为

- 首次导入最近 30 天的邮件，包含已发送和已归档邮件，不导入草稿；Gmail 默认列表不含垃圾邮件和垃圾箱。
- 保存固定的初始时间范围、分页位置和 Gmail history ID。电脑重连后补同步；history 过期时重新核对固定范围和已同步邮件，按 Gmail message ID 去重。确认 Chatwoot 收到消息后才推进位置。
- 个人邮箱使用独立 Chatwoot 工作区和 Email 收件箱，默认只加入本人，隔离会话及工作区级联系人列表；原工作区仍可切换进入。普通员工不获得新工作区权限；若主动增设该工作区管理员，对方也能查看。Google 网页授权只在首次接入或重新授权时出现。
- 在 Chatwoot 原生编辑器发新邮件、回复、添加附件。服务器只渲染 MIME 并排队，电脑通过 Gmail API 发送；Google 返回成功后才显示已发送。原生 `progress` 状态表示等待发送。
- 本人打开会话会排队标为已读；标为未读会移回未读；这个 Gmail 收件箱的“已解决”对应归档，“重新打开”对应移回收件箱。浮动状态栏提供明确的 Gmail 操作按钮。
- 状态操作针对点击时已同步的邮件 ID；离线期间新到的邮件不会被旧的已读/归档操作误处理。Gmail 的逐封状态汇总为 Chatwoot 会话的未读/归档状态，两个产品的概念并不完全相同。
- 操作离线排队、重连重放；读取同步不会自行修改 Gmail 标签。Gmail 删除邮件时保留 Chatwoot 原件和消息，不执行永久删除。
- 每封邮件保留完整 `.eml` 原件及附件；内联 CID 图片使用受鉴权的附件路径。Chatwoot 最多显示 15 个附件，超出时通过完整 EML 保留所有附件，并在状态栏提示。
- 发送超时或结果不明时查询 Gmail 已发送邮件中的固定 RFC Message-ID，不盲目重发。查无结果时保持“待核查”，可能需要本人确认后另行发送。

## 本机准备与授权

需要 Windows、Node 24.13+、能够访问 Google 和 Chatwoot 的网络。支持 `HTTPS_PROXY`，也读取已启用的 Windows 手动代理；浏览器 PAC 扩展不一定覆盖 Node，必要时明确配置进程代理。Google 连接始终验证 TLS。Chatwoot 私有地址使用经可信服务器通道核对的证书 SHA-256 指纹，证书变化时停止连接。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node cli.mjs auth --oauth 'C:\private\desktop-client.json'
node cli.mjs setup --bridge 'C:\private\chatwoot-connector.json'
node cli.mjs run
node cli.mjs status
```

OAuth 客户端类型为“桌面应用”，开启 Gmail API，并请求 `https://www.googleapis.com/auth/gmail.modify`。本机 loopback 回调使用临时端口、PKCE 和 state，无需公网域名。Google 项目处于 External/Testing 时授权可能较快过期；届时连接器停止并提示运行 `auth`，不会假装持续在线。

私有连接文件由维护人员通过可信通道配置，含 `origin`、独立 43 字符设备 `token`、证书 `fingerprint`。它只能访问固定的连接器接口，不能访问任意 Chatwoot API。文件、Google 客户端 JSON、邮件、SQLite 和运行日志均不应提交到仓库。导入后连接配置也存入 DPAPI。默认私有目录为 `%LOCALAPPDATA%\Doon\GmailConnector`，含加密凭据、仅保存 ID/状态的 SQLite、运行锁及日志。

生成独立客户端：从仓库根目录运行 `node integrations/gmail-desktop-connector/package-client.mjs`。包输出到被忽略的 `test-output/gmail-desktop-connector/client`。用 `install-windows.ps1 -SourceDirectory <该目录> -NodePath <node.exe>` 安装到当前 Windows 用户专属目录，保留版本和校验值，增加独立启动快捷方式；`-NoStartup` 可跳过登录启动。安装不负责授权，不改已有 Windows 服务。

## Chatwoot 适配

基线：Chatwoot v4.19.1。`chatwoot/doon_gmail.rb` 以独立 initializer 挂载到 Rails 和 worker，只接管新收件箱；`schema.sql` 只新增 `doon_gmail_*` 表。不得覆盖已有数据库、收件箱或联系人。邮箱与现有 Email channel 冲突时，为新通道生成独立的 `@connector.invalid` 内部标识，保留旧配置。该标识不用于收发，状态栏展示真实邮箱，发送 MIME 的身份仍是经 Google 授权的邮箱。

服务端私有 `DOON_GMAIL_CONFIG` 文件包含已核实的原 `account_id`、`user_id`、设备令牌 SHA-256、附件鉴权令牌 SHA-256；个人接入设置 `private_workspace: true`。网关私有配置增加 `gmailConnectorTokenSha256` 和独立 `gmailBlobScopeToken`，注册后按已核实结果设置 `gmailPrivateAccountId` 和 `gmailOwnerUserId`。网关只有该身份能进入新工作区，同时保留其原工作区访问。网页、API 和 WebSocket 都校验工作区范围。不在该文件配置 Google 凭据。撤销对应 Chatwoot 成员或设备令牌可阻止连接器继续接入。

网关仅为设备开放 `POST /chatwoot/gmail-bridge/v1/{register,heartbeat,ingest,missing,claim,complete,defer,uncertain}`；浏览器请求仍校验中台登录。附件检查走仅内部可访问的独立鉴权接口，阻止非授权成员利用复制的 Gmail 附件链接读取原件。原有其他收件箱不套用 Gmail 操作语义。

发布前做 Chatwoot PostgreSQL 一致性导出、附件哈希核对、恢复验证与私有加密备份，保留原镜像和 compose 回退点。分别固定 Rails 和 worker 当前镜像，仅重建这两个 Chatwoot 服务和网关；不重启 PostgreSQL、Redis、中台或 Agent。回退只撤回代码和配置，不用旧库覆盖新增邮件。后续发布必须包含 Gmail 的 compose override，防止漏挂 initializer。

## 验证

```powershell
npm test
node ../../tests/chatwoot-gateway.mjs
node package-server.mjs
```

`chatwoot/synthetic.rb` 只能在 `doon_gmail_synthetic_*` 临时数据库、独立 Redis 与独立存储运行。它验证原生 HTTP 操作、MIME、附件权限、幂等、队列租约和原记录保全，不调用 Google，也不发送真实邮件。合成测试通过与实际浏览器点击验收分别报告。
