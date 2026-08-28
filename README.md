# wenan

屿洁说干货 Growth Workbench V0.1（安全协作版）。

当前模型：OpenRouter `minimax/minimax-m3:free`。生成失败、素材不足或事实越界时会明确拦截，不会静默切换成模板稿。

## 安全边界

- 仓库不包含 `.env`、API Key、真实脚本、用户反馈、Content OS 数据库快照或内部语料。
- `outputs/**`、`verified_internal`、Brand Thesis 治理逻辑和 Content Skill V0.5 均不在本仓库内修改。
- Content Skill 固定为 `0.5.0 locked`；外部内容不会写入 `verified_internal`。

## Windows 启动

1. 安装 Node.js 20 或更高版本。
2. 将 `growth_workbench/.env.example` 复制为 `growth_workbench/.env`。
3. 在本机 `.env` 设置 `OPENROUTER_API_KEY` 与 `CONTENT_OS_ROOT`。
4. 双击 `诊断并启动.bat`；停止时双击 `停止屿洁说干货工作台.bat`。
5. 浏览器访问 `http://127.0.0.1:4310/`。

安全协作版不会携带 Content OS 内部资产；未配置 `CONTENT_OS_ROOT` 时启动器会给出明确提示。

## 研发验收

```powershell
cd growth_workbench
npm test
```

主要审计入口：

- `growth_workbench/src/feedback-flywheel.mjs`：反馈事件、语义候选、规则效果与置信度。
- `growth_workbench/src/topic-generator.mjs`：同主题四切口生成与选题事实边界。
- `growth_workbench/src/content-os-adapter.mjs`：内部知识相关性检索。
- `growth_workbench/src/lin-composer.mjs`：规则/样本/证据注入、CTA 处理与生成留痕。
- `growth_workbench/src/url-content-extractor.mjs`：公开链接正文提取与显式失败。
- `growth_workbench/src/style-linter.mjs`：动态适用性评分。
- `growth_workbench/test/flywheel-quality.mjs`：规则消融、复现率、CTA、版本配对和冷启动回归。
- `growth_workbench/test/usability-quality-fix.mjs`：主题漂移、全文素材、无依据技术动作和非法模型输出回归。
- `PACKAGE_MANIFEST.json`：安全边界与关键文件哈希。

## 协作规则

- 不提交 `.env`、密钥、真实运行数据、日志、备份和内部语料。
- 所有改动通过分支和 Pull Request 提交，避免直接改 `main`。
- 本仓库停留在 V0.1，不在此分支引入 V0.2 功能。