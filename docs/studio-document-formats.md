# Agent 对话文档格式适配

核对日期：2026-10-29。范围为 Agent 分支的独立文档解析、生成模块；业务数据库、业务附件原件和账号权限不在本模块的读写范围内。

## DeepSeek 接口边界

DeepSeek [Files API](https://api-docs.deepseek.com/guides/files_api/) 的上传对象是 JPEG、PNG、GIF、WebP 图片，配合 `deepseek-flash` 使用。`POST /files` 不提供 PDF、Word、Excel 文档解析。[Responses API](https://api-docs.deepseek.com/guides/responses_api/) 也明确不支持通用文件输入。因此，本模块先通过固定程序提取文档文字，再由调用方把带来源标记的正文交给 DeepSeek。不会伪装成 DeepSeek 原生文档上传，也不会把未解析的二进制文件直接交给模型。

图片的上传与视觉理解由独立图片模块处理；本模块不会做 OCR。纯扫描 PDF 返回 `DOCUMENT_OCR_REQUIRED`，含有空白／扫描页的混合 PDF 在 `warnings` 中明确指出未读取的页。

## 开源依赖

所有依赖固定版本；运行时不下载依赖或字体。

| 用途 | 项目与版本 | 许可证 |
| --- | --- | --- |
| DOCX 提取纯文字 | [mammoth](https://github.com/mwilliamson/mammoth.js) 1.13.0 | BSD-2-Clause |
| PDF 文字层读取 | [PDF.js](https://github.com/mozilla/pdf.js) / pdfjs-dist 6.4.299 | Apache-2.0 |
| Excel 与 CSV 读取、XLSX 生成 | [SheetJS](https://github.com/SheetJS/sheetjs) 0.20.3 | Apache-2.0 |
| DOCX 生成 | [docx](https://github.com/dolanmiu/docx) 9.15.0 | MIT |
| PDF 生成 | [PDFKit](https://github.com/foliojs/pdfkit) 0.20.2 | MIT |
| 中文 PDF 字体 | [Noto CJK](https://github.com/notofonts/noto-cjk) NotoSansCJKsc-Regular.otf | OFL-1.1 |

SheetJS 使用其[官方 Node 安装文档](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)中的 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，不使用 npm 上的旧版 0.18.5。

字体位于 `experiments/mastra-studio/assets/fonts/`，包含原始 OTF、OFL 许可证和来源／长度／SHA-256 清单。字体 SHA-256 为 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`，生成 PDF 时再次核对。PDFKit 嵌入实际使用的中文字体字形，避免依赖员工电脑字体；未覆盖的字符会明确拒绝，不产生看似成功的方框文字。

## 接口

入口：`experiments/mastra-studio/document-formats.mjs`。两种操作都返回 Promise，调用方应等待实际成功结果再向用户报告完成。

```js
const parsed = await parseDocument({
  filename: '示例.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  bytes: Buffer.from(uploadedBytes),
});
// {filename, format, text, sections: [{source, text}], characters, warnings}

const generated = await renderDocument({
  format: 'docx', // docx | xlsx | pdf | md | txt
  title: '示例报告',
  blocks: [
    {type: 'heading', text: '核验结果', level: 1},
    {type: 'paragraph', text: '这是一份合成示例。'},
    {type: 'table', headers: ['项目', '数量'], rows: [['示例', 12]]},
  ],
});
// {filename, mimeType, bytes: Buffer}
```

输入接受 PDF 文字层、DOCX、XLS、XLSX、CSV、TXT、MD。文字支持 UTF-8、带 BOM 的 UTF-16；不推测其他编码。源文件名只允许名称，不接受文件系统路径或 URL。来源标签为 PDF 页码、Word 正文段落号、Excel 工作表与行号、文本行号。

段落结构使用严格字段白名单。heading 的 level 为 1–6；table 各行必须与 headers 等宽，单元格只允许字符串、有限数值、布尔值或 null，不接受对象、公式指令、模板代码、任意样式、HTML、Shell、文件路径或远端获取参数。文字中出现的网址只作为普通文本，不会被请求。

XLSX 输出按表格分 sheet，标题与段落放在「说明」sheet；字符串以字符串单元格写入，包括以 `=` 开头的字符串，不设置公式。输入工作簿只读取缓存的公式结果，缺失缓存会标为尚未计算；不执行宏、公式或外部连接。

DOCX 解析只提取正文，不声称保留页面排版、图片和修订显示。PDF 输出使用自动换行、分页的正文及按行排列的表格；它不是原文件的版式复刻。MD/TXT 输出为普通文字文档。

## 限制与隔离

- 单输入及单输出均不超过 10 MiB。
- PDF 不超过 100 页；表格累计不超过 5000 行、每表不超过 100 列、工作簿不超过 100 个 sheet。
- 含来源标签的解析正文及生成内容不超过 120000 字符；生成 blocks 不超过 1000。
- Office ZIP 不超过 5000 个条目、单条解压不超过 24 MiB、累计解压不超过 64 MiB；校验条目边界、实际解压长度与 CRC，拒绝重复路径、路径穿越、分卷、ZIP64、加密或异常压缩条目。
- 重型解析／生成只在 worker_threads 中执行，默认并发 1、最多等待 8 个任务、每任务超时 30 秒、V8 old-generation 内存上限 256 MiB。Node 的该限额不涵盖全部原生／ArrayBuffer 内存，因此另有原始与实际解压字节上限。
- 超限明确拒绝，不静默截取前几页、前几行或正文前缀。解析器诊断不会直接输出源文件内容或内部异常栈。

错误为 `DocumentFormatError`，包含安全中文 `message`、机器可读 `code` 和 HTTP 风格 `status`。队列满为 429，输入／内容超限为 413，不支持格式为 415，超时为 408；格式损坏或需要 OCR 通常为 422。调用方应把安全消息显示给用户，并保留原件供用户重新选择或拆分。

本模块不保存文件、不读写业务表、不生成公开下载链接、不负责身份鉴权。上传保存、可下载文件的账号／会话隔离、校验和记录、保留策略和下载权限由上层集成负责。原文件字节不要放进模型会话或日志。

## 验证

```sh
node --test --test-concurrency=1 experiments/mastra-studio/document-formats.test.mjs
```

测试仅使用合成内容，覆盖中文五种输出的回读、PDF 页码、Word 段落、Excel 类型与表格、XLS/CSV、扫描 PDF、输入与行数／页数／文字限额、损坏及伪造解压大小的 ZIP、公式样式文字保持纯文本、无路径输入能力、错误不泄漏原文、有界队列和主线程响应、字体／许可证校验。测试不调用真实模型或正式数据。
