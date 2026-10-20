# 采购五类受控动作

继续使用现有 `departmentPurchasing`，新增五个 `prepare` 动作，不新增独立 Tool：

| action | 参数（另需 basis） | 行为 |
| --- | --- | --- |
| prepare-purchase-followup | id、expectedVersion、fields | 修改供应商复期、预计到货、下次催交、跟进备注 |
| prepare-purchase-receipt | id、expectedVersion、quantity、date、reference、note | 普通收货 |
| prepare-purchase-return | 同上 | 退货待补；已存档明细退货后恢复跟进 |
| prepare-purchase-replacement | 同上 | 退货补回 |
| prepare-purchase-archive | id、expectedVersion、date、note | 已审核且核对齐货、无待补时存档 |

先 `list`、`inspect`、`query` 核对明细编号、供应商、物料、单位、源行和当前版本。一次只处理一条采购明细。依据须保留来源位置、未知项和冲突；不猜测基数或单位。期初核定、更正、原表导入、新建采购单、修改采购来源列及删除未开放。

默认返回未保存的草稿。仅在真实业务模式并单独配置 `DOON_AGENT_PURCHASE_CHANGES_ENABLED=1` 后，程序向中台登记预览并返回 `/studio/purchase-change/?id=...` 链接。该开关独立于原 14 类流程开关，本次未修改正式运行配置。

预览展示完整操作参数、采购单／供应商／物料／单位与源行，并展示原生规则计算的执行前后已收、待补、剩余数量及存档状态。本人核对后勾选并确认，服务端才执行。模型只获得 `stagePurchaseDraft`，不能获得确认／取消处理器；后台只读任务也不能生成采购修改提案。

五类动作通过中台 `purchase-change-*` 固定接口、原会话和 HTTPS 访问，协议为 `doon-purchase-change-v1`。旧中台未具备接口时明确失败，不回退直接写入。中台根据真实当前权限、原记录、来源、规则版本、完整载荷和预计效果复核；数量计算只由原业务程序完成。资料或内容变更须重新预览。

保存后的业务和回执在同一中台事务内，页面随后独立回读。响应丢失或回读失败显示待核查，只查询原提案，不自动重发。重复确认已完成提案返回原结果。取消提案不撤销已发生业务。

原部门清单仍固定在已审核基线；采购原始 POST 不作为任意接口工具暴露，目录标注为 `controlled-actions-only` 并列出允许动作。采购收货原接口中的 opening/correction 仍不开放。

## 合成验收

```powershell
cd experiments/mastra-studio
npm run test:purchases -- --middleware-root <包含采购确认接口的中台源码工作树>
```

使用真实 Studio、真实中台 API 路由、合成身份与隔离内存数据库；没有正式网络请求或外部模型调用。设置 `DOON_PLAYWRIGHT_MODULE` 为本机 Playwright 模块绝对路径时，使用本机 Chrome 检查页面，覆盖五类操作、数量效果、确认按钮、响应丢失恢复、取消、旧版本／伪造参数／越组／后台任务拒绝和撤权。截图保留在忽略的 `test-output/`。

代码分别提交到主线固定业务层与 Agent 测试分支。提交、镜像打包及测试均不代表已部署，未触碰 8787、正式数据或原附件。
