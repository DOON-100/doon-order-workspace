# Studio 的 DeepSeek 图片输入

本适配器使用 DeepSeek 官方 Files API，仅支持图片。PDF、Word、Excel 等文档的文本提取属于独立处理流程，不能把它们伪装为图片上传给此接口。

官方依据（2026-10-29 核对）：

- [上传文件接口](https://api-docs.deepseek.com/api/create-file/)：`POST /files`，multipart 字段 `file`、`purpose=user_data`。
- [Files API 指南](https://api-docs.deepseek.com/guides/files_api/)：聊天引用为 `{ "type": "file", "file_id": "file-api-..." }`。
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：图片 `image_url` 和根级 `file_id` 的消息格式。
- [Vision 指南](https://api-docs.deepseek.com/guides/vision/)：图片模型和尺寸限制。

## 当前处理链路

`deepseek.mjs` 在既有模型队列获准执行、重新校验用户身份后调用 `deepseek-files.mjs`。适配器校验 SDK 生成的内联图片，逐个上传，再将消息中的 `image_url` 转为服务端得到的 `file_id`，最后调用聊天接口。上传与生成共用同一个模型并发名额、取消信号及执行期限；没有自动上传重试，也不会重放聊天动作。

只允许 `deepseek-flash` 使用图片。允许 JPEG、PNG、GIF、WebP；只接受标准 base64 data URL，不抓取外部 URL、不读取任意文件路径、不接受客户端提供的远端文件编号。图片通过格式头、声明 MIME 和 `sharp` 完整解码核验，拒绝损坏内容和尺寸伪装。GIF 的所有帧均受准入检查；这不代表模型会解释动画中的每一帧。

应用限额比官方容量更小：单图 10 MiB；单次发往模型的历史上下文最多 24 图、合计 64 MiB；每边最多 8192 像素，达到 15 图时每边最多 4096 像素；每图所有帧累计最多 3200 万像素、最多 100 帧。当前消息的附件数量和大小另由上传入口限制，不应将历史上下文数量误当成当前输入框限制。所有图片在首个外发请求前完成校验，同一模型请求中的上传串行执行。

服务端上传指定 `expires_after[anchor]=created_at`、`expires_after[seconds]=86400`。远端图片一天后失效。内存缓存最多 128 项、最长 20 小时，并提前于远端失效时间到期；键包含真实用户、服务端密钥指纹和图片 SHA-256。不同用户、不同密钥不能复用远端编号。缓存不存原始图片、账号凭据、原文件名或业务路径；服务重启后重新上传。已成功上传但后续失败的图片不会用于发送聊天，远端仍按一天有效期自动过期。

图片原件在 DOON 的独立会话存储中保留与否，由上传入口负责；此适配器不会删除或改写业务原件。浏览器拿不到 DeepSeek 密钥、上传响应或缓存编号。错误仅返回受控中文说明与状态分类，不回传服务商响应正文。

## 验证与依赖

运行：

```text
node --test --test-concurrency=1 experiments/mastra-studio/deepseek-files.test.mjs experiments/mastra-studio/deepseek.test.mjs experiments/mastra-studio/model-scheduler.test.mjs
```

使用生成的合成图片与注入的假服务接口，覆盖四种格式、损坏内容、尺寸/总量、历史复用、用户/密钥隔离、有效期、错误脱敏、取消、真实 SDK 消息转换和排队撤权；不调用付费接口。

运行依赖为 `sharp`，应在 Studio 的锁定依赖和镜像中显式安装，不能依赖开发目录的偶然传递依赖。实现参考了 MindMesh“格式校验、附件来源可追溯、只根据真实工具结果登记成果”的设计，代码独立编写，未复制 MindMesh 或 DSH 的实现。后续若复制其 MIT 代码，应保留相应版权与许可声明。
