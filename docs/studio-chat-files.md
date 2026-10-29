# Agent 对话附件与生成文档

实现分支：`codex/mastra-local-validation`。提交、推送和通过测试不代表已经发布到服务器。

## 员工使用

进入 Agent 对话页，点击 **添加附件 → 添加本地文件**，选择文件后输入问题并发送。也可使用现有粘贴、拖放入口。每条消息最多 4 个附件，每个不超过 10 MiB，总计不超过 20 MiB。上传或解析失败会显示原因并保留草稿；修改后再发送。

| 操作 | 支持范围 |
| --- | --- |
| 阅读文档 | PDF 文字层、DOCX、XLS、XLSX、CSV、TXT、MD |
| 阅读图片 | PNG、JPEG、GIF、WebP；使用 DeepSeek Flash |
| 生成可下载文件 | Word DOCX、Excel XLSX、PDF、Markdown MD、纯文本 TXT |
| Markdown 对话 | 可直接输入 Markdown，也可上传 `.md`；要求“生成 Markdown 文件”可得到下载文件 |

例如：“根据附件整理核查报告，注明来源和待核查项，生成 Word 文档。”或“把这张图片里的信息整理为 Markdown 文件。”生成成功后，点击回复中的文件名下载。下载链接绑定当前登录账号，不能作为对外分享链接。

纯扫描 PDF 尚未接入 OCR；请提供文字版 PDF，或把相关页面作为图片上传。混合 PDF 的未读取页会显示提示。Word 提取正文，Excel 读取已有公式结果；不执行宏或公式、不猜测缺失的结果，也不复刻原文档版式。图片接口用于理解图片，目前不提供图片生成。

## 接口与数据边界

- `POST /studio/documents/upload`：同源、已登录的 multipart 单文件上传。网关仅对这个路径允许 11 MiB 请求体，其他 API 保持 512 KiB；最多同时处理 4 个上传请求。
- `GET/HEAD /studio/documents/:id/download`：重新检查当前登录人，只读取该用户空间中的对象；逐次核对原件长度与 SHA-256，以附件方式下载，禁止缓存和嵌入执行。
- `createDocument`：模型只提交标题、段落、表格及目标格式；固定程序生成真实文件并保存成功后返回下载回执。工具执行前后重新校验登录权限。没有任意文件路径、Shell、代码、外部 URL 或业务写入能力。

上传原件不可变；首次发送时绑定会话。其他用户不能读取，同一上传不能跨会话复用；新会话请重新选择文件。每个账号限 1000 个文件、500 MiB 原件及解析元数据，单件输入和输出均不超过 10 MiB。配额不包含数据库索引、日志等存储开销。

云端使用当前用户既有的 `agent_user_<hash>` PostgreSQL schema 中新增的 `doon_studio_documents` 表，包含原件 BYTEA、来源、会话、长度和校验值。该表不覆盖中台的业务记录、账号权限或业务附件。备份应覆盖 `doon_agent_studio` 与 `doon_agent_studio_observability` 的全部 schema；不要仅备份 public schema。合成测试使用独立 SQLite 或显式指定的独立 PostgreSQL 测试库。

内置 Agent 始终提供文档生成工具，并在管理界面标明必需工具；自定义 Agent 须在工具列表中选中 `createDocument`。原有自定义工具选择不会被隐藏地扩大。生成结果存入当前用户与当前对话，后台流式响应在确认收件后继续执行时仍保留这一归属。

## 官方接口及复用来源

DeepSeek 的 [Files API](https://api-docs.deepseek.com/guides/files_api/) 和[视觉指南](https://api-docs.deepseek.com/guides/vision/)提供图片上传及理解。文档先由固定解析器提取带来源位置的正文，再作为用户资料传给模型。图片原件在获准的模型调用中上传，远端文件设置 24 小时有效期；同一用户、同一 API Key、同一图片可在有效期内复用文件编号。浏览器不能自行提交远端文件编号或外部图片 URL。

桌面 MindMesh 的源码审查确认可参考其附件预览、选择、粘贴、拖放，以及“工具真实成功后登记成果”的设计；没有发现可直接移植的 PDF、Word、Excel 解析和生成实现。本项目复用已固定版本的 Mastra Studio 附件交互，按源码摘要校验适配位置；SDK 升级后适配失配会明确失败。没有复制 MindMesh 的任意 Shell、文件系统路径或桌面权限模型。

格式处理选用固定版本的 Mammoth、PDF.js、SheetJS、docx、PDFKit 与 Noto 中文字体。来源、许可证、限制及解析器测试见[文档格式适配](studio-document-formats.md)；图片限制及官方请求结构见[DeepSeek 图片接口](studio-deepseek-images.md)。

## 验证

```sh
npm test --prefix experiments/mastra-studio
npm run test:documents --prefix experiments/mastra-studio
npm run test:documents:browser --prefix experiments/mastra-studio
npm run test:documents:pg --prefix experiments/mastra-studio
```

浏览器测试需显式配置 `DOON_PLAYWRIGHT_MODULE` 指向已有 Playwright，使用本机 Chrome、临时端口、合成账号与假 DeepSeek 响应。PG 测试默认跳过，启用方式和独立测试库约束写在 `document-store.pg.test.mjs` 开头。SDK 与浏览器测试不调用真实付费接口，不代表已经完成实际模型效果验收。

部署时中台登录性能修复和 Agent 镜像分别发布。原生中台仅跟随已验证的 `main`；Agent 使用本测试分支的独立版本镜像，并单独更新 Nginx 上传大小配置。发布前需保留一致性快照及可恢复代码，发布后核验旧记录、原件和账户权限；失败优先回退代码，不能用旧库覆盖期间新增记录。
