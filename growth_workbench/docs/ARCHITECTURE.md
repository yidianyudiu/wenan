# Growth Workbench V0.1｜最小接入架构

```text
Local Web UI
    ↓
Local API (Node.js, 127.0.0.1)
    ├─ Workbench Operational Store (JSON)
    │   ├─ topics / immutable script versions / human reviews
    │   ├─ external inspirations / creators
    │   ├─ performance snapshots
    │   ├─ inspiration supplemental files
    │   └─ knowledge inbox queue
    └─ Content OS Read-only Adapter
        ├─ PGlite/PostgreSQL + pgvector snapshot
        ├─ verified_internal / Positive Samples
        ├─ Topic Agent / Script Agent
        ├─ Brand Thesis / Calibration Data
        └─ Evidence、Retrieval与Quality Gates
```

## 三类 Intelligence 边界

- Internal Intelligence：只读消费 Content OS 原始资产；Workbench不复制事实主库。
- External Intelligence：独立写入 `inspirations.json` 和 `creators.json`，固定为市场信号。
- Performance Intelligence：独立写入 `performance.json`，只记录屿洁自己发布内容。

## 最小新增接口

- `/api/bootstrap`：工作台首页与各模块数据。
- `/api/themes/cuts`：同一主题生成4个不同切口，尚不生成完整稿。
- `/api/themes/:id/generate-all`：用户主动要求后生成4条完整稿。
- `/api/topics`：选题创建与状态流转。
- `/api/topics/:id/generate`：单一最优候选稿。
- `/api/scripts/:id/review`：只保存 Human Review / Calibration Data，不修改正文。
- `/api/scripts/:id/revise`：原稿、人工反馈与 Content OS 规则生成下一版本。
- `/api/scripts/:id/restore`：把旧版内容恢复为新的历史版本，不删除中间版本。
- `/api/inspirations`：先真实提取公开内容；无正文时返回明确失败和补充入口。
- `/api/knowledge`：内部资料候选队列。
- `/api/creators`：观察账号。
- `/api/performance`：发布数据回流。
- `/api/backup`：工作流数据备份。

## 数据库策略

V0.1不迁移、不重建、不写入 Content OS 数据库。日常状态写入独立工作流数据层；JIT Governance未来需要正式写回时，再通过已有治理接口执行。

脚本版本采用 append-only：人工建议从不直接写入 `full_script`，V2/V3 以新记录保存。External Inspiration 固定 `verified_internal_effect: none`。
