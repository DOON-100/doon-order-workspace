# 查看中台使用记录

`scripts/view-usage-history.mjs` 是服务器管理员使用的独立只读工具，需要 Node.js 22.13 或更新版本，无需安装项目依赖。它直接读取显式指定的 SQLite 数据库，不加载业务运行时，不登录、刷新会话、写业务记录或操作服务。

在服务器上将下面路径替换成实际路径。脚本可以单独复制到服务器的运维目录执行，无需更新或重启中台。

```bash
# 最近 7 天的登录、退出和业务操作，最多 100 条
node /脚本所在目录/view-usage-history.mjs --db /实际数据目录/workspace.sqlite

# 查看某个账号最近 30 天的记录
node /脚本所在目录/view-usage-history.mjs --db /实际数据目录/workspace.sqlite --username zhangsan --days 30 --limit 500

# 仅查看登录成功、登录失败和主动退出
node /脚本所在目录/view-usage-history.mjs --db /实际数据目录/workspace.sqlite --kind login

# 仅查看业务操作；成员编号适用于已不存在的账号
node /脚本所在目录/view-usage-history.mjs --db /实际数据目录/workspace.sqlite --kind audit --member-id member_example

# 机器可读输出
node /脚本所在目录/view-usage-history.mjs --db /实际数据目录/workspace.sqlite --json
```

表格使用北京时间；JSON 保留记录原时间，同时返回查询范围。默认显示所有已记录操作人（也可能包含供应商），使用账号或成员编号筛选员工。同名员工不会按姓名混合。结果按事件时间倒序，超过上限会明确提示截断。

读取范围为 `records` 中的 `auth_event`、`audit`，以及本地账号表的账号与成员编号映射。只投影时间、事件、操作人、目标编号、来源、IP 等字段，不读取密码列、会话表或审计的 before/after 业务快照。该工具依赖操作系统文件权限，仅供能读取服务器数据库的管理员使用，不是员工 API，也不进行网页角色授权。

业务审计只表示已经留存的动作，并非所有访问或点击；确认流程的独立执行回执不另行展开，以免重复计算对应业务审计。登录事件只覆盖启用记录功能后实际留下的数据，无法还原此前的登录或计算在线时长。登录失败所用账号不证明对应员工本人发起。没有记录、记录时间无效或权限不足，均不能解释为无人使用。历史账号删除或改名后，可使用成员编号查询业务操作。

数据库以 SQLite 只读连接和 query_only 打开，查询在同一个读事务内完成，兼容 WAL 中已经提交的数据；不使用 immutable 模式，也不复制运行中的数据库主文件。账号映射使用当前值，事件中的操作者和账号保留历史值。正在运行的数据库仍须让 SQLite 能读取其所需的 WAL/共享内存文件；工具不会替用户修改文件权限。

输出可能含员工姓名、IP 或业务来源描述，仅在授权环境查看，不将实际查询结果提交公开仓库。工具本身不保存报告。合成验证：`node tests/usage-history.mjs`。
