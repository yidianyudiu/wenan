# Content OS V1.0 工程盘点（V0.1接入依据）

## 当前工程

- 工程根目录：Growth Workbench上一级目录。
- 数据库：`outputs/content_os_v1_phase2/postgres_data_release`，PGlite/PostgreSQL内核 + pgvector。
- Topic Agent：`outputs/content_os_v1_phase3/content_research_topic_agent_v0_1.mjs`。
- Script Agent：`outputs/content_os_v1_phase4/script_agent_v0_1.mjs`。
- Retrieval / Internal Knowledge快照：`outputs/content_os_v1_phase4/phase4_probe.json`。
- Evidence / Claim Gate：Script Agent中的Claim Ledger、Evidence Gate及blocked claim检查。
- Brand Thesis：Workbench治理注册表 `config/brand-thesis.json`；身份保持Brand Thesis Candidate，不混入verified_internal。
- Calibration Data：`outputs/content_os_v1_final_calibration/topic_orientation_calibration_v1.0.json`；Workbench新增人工反馈保存在 `data/calibration_events.json`。
- Positive Samples：数据库 `positive_samples`，现有导出 `outputs/content_os_v1_phase3_1/positive_samples_seed.json`。
- Topic Domain Map原图：`upload/01-png`，只作为方向约束。
- 原始资料与入库索引：`outputs/content_os_v1_ingestion`、`outputs/content_os_v1_incremental_review`，数据库中已有76个公司文件、438个knowledge candidates。

## 实际基线

- verified_internal：11。
- Positive Samples：10。
- Historical Publications：38。
- performance snapshots：0。
- Content Skill：`0.5.0 locked`。

## 直接复用

- Topic Orientation Gate、Topic Agent问题建模。
- verified_internal与pending knowledge治理语义。
- Positive Samples的结构参考边界。
- Script Agent的Evidence、Claim、Copy Risk与口播质量规则。
- Final Calibration中的`customer_problem_orientation`。

## Workbench最小新增层

- Local API和中文Local Web UI。
- 选题/脚本/审稿的操作状态。
- External Inspiration、Creator和Performance独立集合。
- Knowledge Inbox文件队列和哈希去重。
- 启动、日志、备份与恢复脚本。

没有迁移数据库，没有创建平行知识库。
