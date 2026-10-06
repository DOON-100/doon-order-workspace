# 生产数据加密备份

用户已授权把数据库和附件加密后同步到本公开仓库。这里仅保存 `workspace.tar.gz.enc` 和不含业务记录的 `manifest.json`。未加密的数据库、附件、账号资料及解密密钥禁止提交。

备份包含 `lan-data/workspace.sqlite` 的一致性快照和 `lan-data/files` 中已完成上传的附件，也保留数据库内的账号及会话。SQLite 在线备份包含已经提交到 WAL 的数据；随后复制不可变附件，不停止或重启 8787 服务。临时明文在任务结束时删除。备份是执行时的快照，不会跟随数据库实时更新。

加密使用随机 256 位密钥、每次独立的 96 位随机 IV 和 AES-256-GCM 认证，文件头为 `DOONBAK1`。公开清单只包含加密格式、时间、密钥指纹、密文大小和 SHA-256。附件名及文件校验清单位于加密归档内。

需要支持 `node:sqlite` 在线备份的 Node.js 和 `tar`（当前 Windows 自带）。从项目根目录执行：

```powershell
node standalone/encrypted-backup.mjs create
```

默认密钥保存在本机 `lan-data/backup-keys/repository-backup.key`，该目录被 Git 忽略。首次执行生成随机密钥，后续使用同一密钥；脚本不会输出密钥内容。请把密钥另存到受控的离线位置，密钥丢失后无法恢复已有备份。不要把密钥放到 `encrypted-backups`、GitHub、截图或聊天中。

每次生成新的带时间目录，确认只包含密文和公开清单，再按项目规则提交、推送到 `origin/main`。该命令本身不自动执行 Git 推送，也没有设置定时任务。密文超过 95 MiB 会拒绝生成可上传清单，需先分卷处理；日常源码改动不自动生成数据备份。

还原到一个尚不存在的独立目录；替换正式数据需要单独安排维护：

```powershell
node standalone/encrypted-backup.mjs restore --backup "encrypted-backups/<备份时间目录>" --key "lan-data/backup-keys/repository-backup.key" --destination "test-output/restored-data"
```

还原先验证密文 SHA-256 和 GCM 认证，再检查归档路径、全部明文文件的 SHA-256 及 SQLite 完整性。密钥错误、文件篡改或目标目录已存在时拒绝还原。不会覆盖正在运行的 `lan-data`。

验证加密及还原工具：`node standalone/test-encrypted-backup.mjs`，只使用临时合成数据。
