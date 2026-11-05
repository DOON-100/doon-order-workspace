# 公开仓库边界检查

本分支的 `.github/workflows/public-repository.yml` 在 push、pull_request 和手动触发时运行，不需要安装业务依赖。流程先用合成 Git 仓库验证路径检查器，再检查提交树，拒绝数据库、附件、备份密文及清单、私有目录和已撤下的运维报告。它不会读取文件内容或连接正式服务，也不执行部署；通过只表示路径规则未发现违规，不能替代内容审查或秘密扫描。

本分支保留既有 `.github/workflows/data-tools.yml`。本分支没有主线的 `native-ci.yml` 原生打包流程；不能将主线的手动打包说明或结果视为本分支已经完成业务回归、TypeScript、构建或部署验收。

本地提交前由 `.githooks/pre-commit` 检查暂存树。配置方法见 [README](../README.md)。也可手动运行 `node tests/public-repository.mjs` 与 `node scripts/check-public-repository.mjs`，提交后使用 `node scripts/check-public-repository.mjs --ref HEAD` 核对提交树。
