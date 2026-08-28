# 屿洁说干货 Growth Workbench V0.1｜OpenRouter + 反馈数据飞轮

状态：`GROWTH_WORKBENCH_V0.1_MINIMAX_PRECISION_FIX_01_READY`

本轮只修复 V0.1 的 UX 与逻辑，不进入 V0.2。Content OS 核心数据库、`verified_internal`、Brand Thesis 治理逻辑与 Content Skill V0.5 均保持锁定。

## 林总风格生成

默认生成路径现为：选题与 Content OS 检索结果 → 林总正样本 few-shot → OpenAI 兼容模型 → 规则质检 → 不合格最多重写2次 → Content Studio 显示风格匹配度与缺失项。

- 原 `composeBestScript()` 只保留为用户明确选择的模板模式；未配密钥、断网、模型失败、残缺 JSON、风格硬禁词或素材忠实门禁失败时停止落库；
- `topicOrientationGate`、`scriptGate` 继续运行，分别负责选题方向、事实与业务合规；风格检查只增加写法质检，不替代门禁；
- CTA 只能引用选题中登记存在的资产；没有真实资产时不生成资料承诺；
- 发送给外部模型的内部知识默认隐藏金额与比例；可在私有模型部署中显式关闭；
- 人工反馈只保存为 Calibration Data，按建议修改时由模型生成 V2/V3，绝不把反馈文字直接覆盖整篇稿件。

## OpenRouter 接入

当前默认模型为 OpenRouter `minimax/minimax-m3:free`，请求走官方 OpenAI 兼容端点 `https://openrouter.ai/api/v1/chat/completions`。首次配置时复制 `.env.example` 为本机 `.env`，只填写 `OPENROUTER_API_KEY` 后重启。密钥不会进入脚本、反馈数据、日志、备份、公开 ZIP 或 GitHub 仓库。

模型请求默认使用 `reasoning.effort=low`、隐藏 reasoning 内容，并给免费模型预留 12000 completion tokens。请求未返回最终正文时最多自动重试2次；连续失败会明确报错且不保存稿件。模板稿只能由用户明确选择模板模式生成。

隐私边界：工作台只向模型发送当前选题、脱敏后的检索片段、已人工确认的写作偏好、少量“直接拍”正样本，以及当前选择的 External Inspiration 全文。免费模型可能由 OpenRouter 路由到第三方供应商，不要上传不应发送给第三方的秘密信息。需要换模型时可修改 `LIN_LLM_MODEL`；接口层仍兼容其他 OpenAI 协议服务。

## 反馈数据飞轮

每次点击“保存反馈”，工作台会在本地完整记录：原稿快照、版本、选题、模型与 token 用量、风格分、Evidence 引用、审核结论、“哪里有问题”、“修改建议”，以及后续 V2/V3 的改稿结果。

- “修改后拍 / 不拍”会提炼为偏好候选，但默认是“待确认”；
- 只有在“设置与数据 → 你的反馈数据飞轮”点击“确认启用”的规则，才会进入后续提示词；
- “直接拍”的成稿自动成为正向风格样本，但只学习写法，不复制事实、数字或 CTA；
- V1 永远保留，按建议修改会创建 V2/V3，并形成可回看、可恢复的训练对；
- 原始反馈和飞轮规则只存于本地工作台，不写入 `verified_internal`，不改变 Content OS Schema、Brand Thesis 或 Content Skill V0.5。

历史人工审核会在启动时自动补齐为 `feedback_flywheel_v1` 快照。当前已有的候选规则不会被自动启用，需由用户逐条确认。

## Windows 启动

必须先解压完整 ZIP，不能只单独下载 `.bat` 文件。

1. 双击工程根目录的 `启动屿洁说干货工作台.bat`。
2. 启动器会检查工程文件、Content OS、Node.js 20+、端口、写入权限和 API 健康状态。
3. 浏览器会自动打开 `http://127.0.0.1:4310`。

项目没有第三方 npm 运行依赖，不需要执行 `npm install`。如果普通启动失败，双击 `诊断并启动.bat`；需要停止时双击 `停止屿洁说干货工作台.bat`。

## 日常工作流

1. 在“今日作战台”输入一个主题。
2. 系统围绕同一主题生成4个不同切口。
3. 选择一个切口，默认只生成1篇文案并进入同一个 Content Studio。
4. 人工审核选择“直接拍 / 修改后拍 / 不拍”。
5. “修改后拍”先保存反馈，再点击“按建议修改文案”生成 V2；V1 永远保留。
6. 可在版本历史中查看上一版、当前版，或把旧版本恢复成新的历史版本。

只有点击“查看4条完整成稿”时，系统才会生成该主题下的4篇完整稿。

## 灵感收件箱

粘贴公开 URL 后，系统会先真实尝试读取页面，再进行 External Inspiration 拆解。当前自动提取：

- 普通公开 HTML 文章页、服务端渲染内容页；
- 标题、描述、正文、作者、发布时间；
- JSON-LD 中公开可见的互动数据与评论；
- 页面或结构化数据中公开提供的字幕 / transcript；
- 纯文本、JSON、VTT 等公开文本响应。

受登录、反爬、人机验证、纯客户端渲染或平台权限限制的链接，系统会明确显示“无法自动读取该链接内容”，不会生成无依据的分析。可立即补充：粘贴文案、粘贴字幕、上传 TXT / SRT / VTT，或上传视频/文件后再补字幕。当前本地 V0.1 不承诺自动转写视频。

外部内容始终保存为 `external_inspiration`，`verified_internal_effect` 固定为 `none`。

生成原创选题和成稿时，外部全文会进入本次模型上下文，并记录来源 ID、字符数和内容哈希。成稿还会经过独立的素材忠实审计：来源中不存在的具体技术动作、数字、案例、制度或经验背书会触发重写；连续失败则不落库。灵感箱和 Content Studio 都可展开查看实际采集全文。

## 导航

主导航只有：今日作战台、选题池、灵感收件箱、待拍内容、资料库。

同行账号、人工内容数据、系统状态和数据备份位于“设置与数据”。Content Studio 不维护独立入口或独立状态，只从推荐选题、Topic Pool、待审稿和待拍内容进入。

## 数据位置

- 工作台数据：`growth_workbench/data/`
- 灵感补充文件：`growth_workbench/data/inspiration_files/`
- 新增资料：`growth_workbench/data/knowledge_files/`
- 日志：`growth_workbench/logs/`
- 备份：`growth_workbench/backups/`

## 回归测试

在 `growth_workbench` 目录运行：

```bash
npm test
```

当前自动化覆盖82项检查：26项 V0.1 可用性回归、13项林总风格规则自检、20项飞轮与语义质量测试、23项本地 OpenAI/OpenRouter 兼容接口端到端测试。新增覆盖握拍主题不再误判利润、不相关知识不强行检索、外部全文注入与查看、残缺 JSON 停止落库、数字/经验背书门禁和语义素材忠实审计。

真实 OpenRouter 探针可在已配置密钥的本机运行 `npm run openrouter:check`。它只输出服务商、实际模型、风格分和用量摘要，不打印提示词或成稿。公开交付 ZIP 不包含本机 `.env`、API Key 或真实用户数据；未配置外部密钥时，自动化测试仍会使用本地模拟兼容端点验证完整链路。

## 旧版规则校准工具

内置反馈飞轮已成为日常入口。以下命令只保留给林总风格包的旧版规则校准，不会替代“设置与数据”中的人工确认：

```bash
npm run lin:calibration
```

确认候选正则和改法无误后，才可执行 `node tools/ingest-calibration.mjs --apply`，随后必须再跑 `npm run lin:smoke`。不要让工具无人值守修改林总风格规则。

已知限制：82 分合格线会让少数列举型、留白型真实样稿进入“需人工确认”，但不会丢稿；选址、定价、预售、课程体系等反馈样本较少的主题，仍需重点人工审核。
