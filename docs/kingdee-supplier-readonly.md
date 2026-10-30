# 金蝶供应商只读连接检查

采购「供应商档案」中的「测试金蝶供应商连接」读取金蝶云星辰供应商列表第一页，最多 10 条。只显示返回条数和检查时间，不导入、更新或关联供应商，也不会启动定时任务。页面的 Excel 导入仍是独立的人工快照流程。

仅有效采购 / PMC 和管理员、且在全部业务范围内可使用。服务器须由管理员私下配置既有的 `DOON_KINGDEE_READONLY_ENABLED`、`DOON_KINGDEE_CLIENT_ID`、`DOON_KINGDEE_CLIENT_SECRET`、`DOON_KINGDEE_INSTANCE_ID` 和 `DOON_KINGDEE_ACCOUNT_ID`；账套须明确核实。凭据不应写入仓库或日志。Windows 用户的 DPAPI 配置不能直接搬到 Linux。

服务端使用固定 GET `/jdy/v2/bd/supplier`、第一页、10 条和 `show_contact_detail=false`，不接受浏览器传入的筛选或目标地址。身份、分页和响应格式异常时停止检查；返回投影不含银行账号、联系方式、令牌或上游原始错误。结果仅证明当次查询返回，不证明全部分页、字段映射或自动同步已经验收。

后续自动同步需要验证供应商接口权限、目标账套、历史 Excel 的账套归属、完整分页及事件或轮询的可靠性。固定外部身份、冲突处理、幂等、失败补偿、持久调度及原数据保全需另行实现和验收。金蝶供应商事件是否可订阅尚未核实；轮询有延迟，不能称为实时推送。

参考：[金蝶云星辰供应商列表](https://open.jdy.com/#/files/api/detail?index=3&categrayId=3cc8ee9a663e11eda5c84b5d383a2b93&id=9ce7f88f712511eda0b313592b350ebd)。专项合成测试为 `node tests/kingdee-supplier-diagnostic.mjs` 与 `node tests/supplier-diagnostic-ui.mjs`。这些测试和代码提交不代表正式配置或上线。
