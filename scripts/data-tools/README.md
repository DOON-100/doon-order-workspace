# Portable private data tools

## 工具统一入口

本目录集中存放可复用的文件处理、导入和数据维护代码，统一测试入口为 `tests/data-tools/run.mjs`。网站日常运行不启动这些脚本；迁移已有数据时保留完整数据库与附件，不用重跑历史 Excel 导入。

| 脚本 | 用途 | 输入和运行位置 |
| --- | --- | --- |
| `workbook.py` | 检查 Excel、提取行和图片 | 显式文件路径，可在维护机运行 |
| `split-workbook.mjs` | 按审核过的归属清单拆分工作表 | 私有 JSON 配置、原表与归属数据 |
| `merge_workbooks.py` | 合并新增工作表并保留原表内容 | 原表、新表、全新输出文件 |
| `prepare-quote.mjs` | 把报价配置和原件整理成可搬运任务包 | 私有配置、Excel/图片等原件，不写数据库 |
| `export-workspace.mjs` | 只读导出报价快照或客户归属 | 显式已有 SQLite 数据目录；输出属于私有业务数据 |
| `quote-maintenance.mjs` | 报价创建与费用维护，先演练再应用 | 已验收构建、目标数据目录、私有任务包与报告目录 |

代码、测试、客户数据的边界如下：

```text
scripts/data-tools/       通用脚本、共享库、依赖说明
tests/data-tools/         只含合成数据的测试
standalone/test-*.mjs     既有专项合成测试，相关用例由统一入口调用
private-data-tools/       客户原表、图片、配置、结果与检查点，Git 忽略
```

历史原件和任务目录保留在原处，不为了整理代码而移动、删除或提交客户文件。一次性业务任务脚本只保存在本机被忽略的 `private-data-tools/one-off-scripts/` 或仓库外，不提交到 GitHub。路径参数化意味着可换机器运行，并不意味着所有输入都已经存进数据库。

### 专项导入和维护入口

以下程序也统一放在本目录，按输入参数或私有配置处理任务。旧路径已移除，调用时使用 `scripts/data-tools/<脚本名>`。这份索引不是迁移执行顺序。

| 脚本 | 定位与使用限制 |
| --- | --- |
| `inspect-purchase.py` | 采购表检查，输出可能含原始明细；通用检查优先用 workbook.py |
| `import-purchase-live.mjs` | 指定采购数据导入，需来源及验收清单；不作为迁云初始化 |
| `import-customer-quote.mjs` | 报价草稿专用导入；新任务优先使用准备任务包、演练和维护流程 |
| `import-customer-price-archive.mjs`、`customer-price-template-to-json.mjs` | 历史价格档案/模板专用转换与导入，保留原件和专用验收 |
| `import-customer-followup.mjs`、`import-ivy-service.mjs`、`import-engineering-drawings.mjs` | 跟进、客户服务和工程图纸专项维护，不能用来重建已迁移业务 |
| `configure-customer-quote-access.mjs`、`update-customer-quote-access.mjs`、`set-customer-price-selection.mjs` | 权限或业务选择维护，不属于文件转换，更不是部署必跑脚本 |
| `publish-finished-outsourcing.mjs` | 根据私有计划预览或发布委外记录，使用目标数据库及已验收构建 |
| `audit-customer-project-relations.mjs` | 只读检查客户项目关联与附件完整性，报告属于私有数据 |

这些既有入口保留各自参数约定，部分默认使用当前工作目录下的 `lan-data`、`lan-dist` 或 `test-output`。运行前按对应说明显式指定目标数据、构建及输出路径；整理目录不代表每个旧入口都具备 `quote-maintenance.mjs` 的演练与应用保护。Excel、JSON 和图片原件仍是私有输入，数据库保存导入后的业务记录，二者分别保留。

备份、守护和部署脚本属于运维工具，仍由 `standalone/` 和 `scripts/` 中对应入口管理，不混入 Excel 处理执行流程。

These offline tools separate reusable code from customer files and task configuration. They do not run when the website starts. All examples refer to private job files, not to production customer data. Original task scripts and input documents remain in their original locations.

The current storage adapter is the standalone application's SQLite database plus its `files` directory. Running a maintenance tool on a cloud server still requires access to that server's data and validated application build. Changing an HTTP address does not turn these tools into remote API clients. Filesystem access is an operator privilege; these CLIs must not be exposed as public upload endpoints.

## Installation and checks

Use Node 24, or at least Node 22.16.0 for the `node:sqlite` backup API (a higher minimum than the website's root `package.json`). Install the project's locked Node dependencies, and use Python 3.10 or later with the pinned Python requirements:

```text
python -m pip install -r scripts/data-tools/requirements.txt
node tests/data-tools/run.mjs
```

Set `DOON_PYTHON` to a Python executable if `python` is not the desired environment. The test suite creates synthetic workbooks, customers, members, quotations and databases in temporary directories. It does not read desktop files, production databases, or employee passwords.

The unified runner also invokes the existing quotation, price archive, access, engineering drawing, Ivy migration and relationship-audit regressions from `standalone/` and `tests/`. New CLI relocation checks use isolated builds and synthetic data. Test files stay at their existing paths so other validation entry points continue to work.

Node workbook generation uses the project's existing `xlsx` package. No tool here requires Codex, `@oai/artifact-tool`, a Windows drive letter, a company network share, or a running GUI copy of Excel. Formula results are not recalculated: existing cached values are retained, and newly linked cells refer to the unchanged original sheet.

## Private job layout

Create a new private directory for every job. `/private-data-tools/` is ignored by Git; a private location outside the repository is also supported.

```text
private-data-tools/
  job-unique-id/
    source.xlsx
    images/
    quote-task.json
    ownership.json
    split-task.json
    results/
```

JSON configurations and exported business records are private data, even though they are text. Never commit source Excel files, images, quotation values, customer IDs, account names, snapshots, generated reports, or checkpoints to the public repository. The examples below use synthetic labels only. Supply actual SHA-256 hashes in private job files.

Input paths in quotation and split configurations resolve relative to the configuration file, not the current working directory. Prepared quotation bundles copy their referenced files into the bundle and use relative paths so the entire bundle can move between machines. Existing output files/directories are rejected instead of overwritten.

## Excel inspection and extraction

```text
python scripts/data-tools/workbook.py inspect --input PRIVATE.xlsx --output NEW-inspection.json
python scripts/data-tools/workbook.py rows --input PRIVATE.xlsx --sheet "Source rows" --header-row 1 --output NEW-rows.json
python scripts/data-tools/workbook.py images --input PRIVATE.xlsx --output NEW-media-directory
```

Use each command's `--help` for sheet/range options. Inspection distinguishes formulas from saved values; extracting images writes a manifest with relative paths and file hashes. Full inspection JSON can contain business content and belongs in private storage. Console output is restricted to operational summaries.

Template-specific cost calculations, fixed cell mappings and quote amounts are not inferred by the generic tools. Preserve those business decisions in a reviewed private configuration. The old customer-specific audit and PNG preview scripts remain archived; PNG rendering is not required by the portable processing chain.

## Read-only workspace export

```text
node scripts/data-tools/export-workspace.mjs --data EXISTING_DATA_DIRECTORY --output NEW-ownership.json --scope ownership --customer-ids test_customer_a,test_customer_b
node scripts/data-tools/export-workspace.mjs --data EXISTING_DATA_DIRECTORY --output NEW-ownership.json --scope ownership --member-ids test_member_a
node scripts/data-tools/export-workspace.mjs --data EXISTING_DATA_DIRECTORY --output NEW-quote.json --scope quote --quote-id test_quote --customer-id test_customer_a
```

Ownership export uses explicit member IDs. It does not infer identity from a person's name and does not require `server-status.json` or a health endpoint. Combining customer and member filters narrows the export to their intersection. Accepted customer identities include explicit master codes; verify any additional alias mapping before adding it to a private task.

Quotation export supplies the current snapshot needed for a controlled fee update. Exports use SQLite in read-only/query-only mode and do not query password or session columns. A missing database is an error, not an instruction to create an empty one.

## Shipment split and original workbook preservation

`split-workbook.mjs` takes a private configuration such as:

```json
{
  "schemaVersion": 1,
  "source": {"path": "source.xlsx", "sha256": "ACTUAL_FILE_SHA256"},
  "ownership": {"path": "ownership.json", "sha256": "ACTUAL_FILE_SHA256"},
  "sheet": "Source rows",
  "headerRow": 1,
  "customerColumn": 3,
  "groups": [{"name": "Group A", "memberIds": ["test_member_a"]}],
  "unknownSheet": "Unassigned",
  "mappingSheet": "Customer mapping"
}
```

`firstRow`, `lastRow`, `columnCount` and `requiredColumns` are optional explicit range/filter settings. Without `requiredColumns`, every nonempty row in the selected range is retained, including a row without a customer code. Unknown identities or customers without a selected owner remain in the unassigned sheet. Multiple matching groups or duplicate customer identities stop the job for review. Personnel labels and membership are supplied by the task, not hard-coded.

```text
node scripts/data-tools/split-workbook.mjs --config PRIVATE-split-task.json --output NEW-split-directory
python scripts/data-tools/merge_workbooks.py ORIGINAL.xlsx NEW-split-directory/extra.xlsx NEW-final.xlsx --omit-sheet "Source rows"
```

The split output includes `extra.xlsx` and `classification.json`. The extra workbook contains a placeholder with the original source sheet's name; explicitly omit that placeholder during merging. The final workbook retains the original sheet and uses its cells for formula references. Cached values, error types, date systems and number formats are checked during the split. No calculation engine is used. A formula without a saved cached value stops the job, including when that column is a required filter; recalculate and review a separate input copy instead of silently treating the formula as empty.

The merger requires explicit original, extra and output paths. It has no date-specific sheet default. It preserves original worksheet XML, relationships, external links and other protected package parts byte-for-byte, verifies existing style references and writes a separate validation report. Unsupported dependent parts fail instead of being silently discarded. Never use the original workbook as the output destination.

## Quotation bundles and maintenance

A create configuration has this structure. Values, member/account identities, customer mappings and media-to-line links come from the private reviewed task:

```json
{
  "schemaVersion": 1,
  "operation": "create",
  "customer": {"id": "test_customer_a", "customerCode": "TEST-A", "customer": "Synthetic customer"},
  "actor": {"username": "test_operator"},
  "readers": [{"username": "test_reader"}],
  "quotes": [{
    "payload": {"customerAccountId": "test_customer_a", "customerCode": "TEST-A", "customerName": "Synthetic customer", "quoteNo": "TEST-QUOTE", "lines": []},
    "source": {"path": "source.xlsx", "sha256": "ACTUAL_FILE_SHA256"},
    "media": []
  }]
}
```

This is a shape example, not an executable quotation. The application requires the real quotation fields and valid line IDs. Media entries include `path`, `sha256`, `filename`, `lineId` and `category`. If a quotation's source customer code differs from the existing master code (including a blank master code), explicitly supply top-level `quoteCustomerCode` and nonempty `preconditions: [{id, kind, sha256}]` for the reviewed evidence records. Each evidence hash is the complete record's recursively key-sorted JSON SHA-256 (`fingerprint` in the maintenance helper), not the export file's byte hash. The master record is not rewritten to fit the quotation. Prepare a new portable bundle before rehearsing:

```text
node scripts/data-tools/prepare-quote.mjs --config PRIVATE-quote-task.json --output NEW-bundle-directory
node scripts/data-tools/quote-maintenance.mjs --config NEW-bundle-directory/config.json --build VALIDATED_BUILD_DIRECTORY --data EXISTING_DATA_DIRECTORY --report NEW-rehearsal.json --rehearse
node scripts/data-tools/quote-maintenance.mjs --config NEW-bundle-directory/config.json --build VALIDATED_BUILD_DIRECTORY --data EXISTING_DATA_DIRECTORY --report NEW-apply.json --apply --preflight NEW-rehearsal.json
```

The create operation supports source attachments and line media through the application's business handlers. The `update-fees` operation takes `update.before` (the current snapshot), `update.payload` (the reviewed next values including ID/version), and `update.expectedExtraTotal`, plus the same customer/actor/reader scope. It permits a bounded draft quotation update, not arbitrary record editing or changes to customer/member permissions. Use `export-workspace` to obtain a fresh snapshot; do not replay an old fixed version.

There is no implicit production directory, account, or apply mode. All maintenance commands require explicit configuration, build, data, report and mode. The actor must be an active owner administrator with existing access to the target customer. Reader checks preserve each configured account's original readable/writable/inaccessible state. Reports must be new files outside the data directory, build directory and configuration bundle directory; their parent contains the private checkpoints directory. Rehearsal uses an independent snapshot. Apply requires a recent matching successful rehearsal bound to input files, configuration, code, Node runtime and target directories; moving to a different server requires a new rehearsal. Existing records/files are checked, and uncertain failures must not be retried by overwriting the database from an old checkpoint.

Checkpoints contain a full private SQLite backup and attachment copy, not just a small log for the current quotation. Provide sufficient private disk space and retain them under an operator-controlled lifecycle policy. These CLIs do not upload checkpoints to GitHub.

## Cloud preparation boundary

Deploy the website's validated build, consistent database snapshot and complete attachment storage first. Do not replay these historical imports to rebuild an already populated database. Keep scripts and dependency versions separate from private jobs and runtime data.

For a single-server Node/SQLite/files deployment, run the same CLIs against explicit persistent paths on the server. For a remote database or object storage deployment, replace the direct storage adapter and transaction/file-preservation code; parameterized paths alone do not implement those backends. No command in this toolkit installs, restarts or deploys the production service.
