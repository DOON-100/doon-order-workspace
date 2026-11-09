# 私有加密备份

自 2026-11-05 起，生产备份不再上传本公开仓库，包括加密归档及备份清单。本目录仅保留通用说明；历史备份已从分支当前版本撤下，本机原件仍保留并被 Git 忽略。普通删除提交无法撤回旧提交或其他人的副本，不代表 Git 历史已经清除。

## 创建与保管

`standalone/encrypted-backup.mjs` 保留 SQLite 在线快照、不可变附件复制、AES-256-GCM 认证加密与独立目录还原。不得直接复制正在运行的 SQLite 主文件。源码编辑不会自动运行此工具。

```powershell
node standalone/encrypted-backup.mjs create
```

默认输出到被忽略的 `private-data-tools/encrypted-backups/<时间>/`；密钥仍位于本机被忽略的 `lan-data/backup-keys/repository-backup.key`，不改变既有备份的解密方式。密钥应与备份分开保管，并保留受控离线副本。不要将密钥、账号、会话、数据库、附件、密文或清单加入公开 Git。

工具使用随机 256 位密钥、独立 96 位随机 IV 和 AES-256-GCM，格式为 `DOONBAK1`。每次生成新目录，不覆盖原件。转存受控私有存储前，应在独立目录完成解密还原及附件完整性验证。

## 独立验证与还原

```powershell
node standalone/encrypted-backup.mjs restore --backup "private-data-tools/encrypted-backups/<时间>" --key "lan-data/backup-keys/repository-backup.key" --destination "test-output/restored-data"
```

还原先验证密文摘要及 GCM 认证，再检查归档路径、全部文件摘要与 SQLite 完整性；密钥错误、篡改或目标目录已存在时拒绝。此操作不会覆盖正式数据。恢复正式数据需要单独明确授权并核对期间新增记录。

`node standalone/test-encrypted-backup.mjs` 仅使用合成数据验证工具。`node scripts/check-public-repository.mjs` 检查暂存路径，防止将私有文件重新加入仓库；它不是完整秘密扫描。
