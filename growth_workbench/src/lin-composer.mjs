/**
 * lin-composer.mjs
 * 林总风格脚本生成器。这是本次集成的主入口。
 *
 * 流程：
 *   选题 + 内部知识
 *     → 按主题域挑 2 条林总正样本作为 few-shot
 *     → 渲染 system prompt（规则全部来自 lin-style-pack.json）
 *     → 调用 LLM
 *     → style-linter 打分
 *     → 不合格则把问题回喂重写（最多 N 次）
 *     → 返回最高分那一版 + 完整质检报告
 *
 * 与原 script-composer.mjs 的关系：并列，不替换。
 * 原模板拼接路径保留为 fallback（无 API key / 断网 / LLM 报错时自动回落）。
 */

import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatWithMetadata, extractJson, llmConfigured } from './llm-client.mjs';
import { lintScript, loadStylePack, formatReport, normalizeScript } from './style-linter.mjs';
import { applyCtaPolicy, ctaAssetNames } from './cta-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '../config');

let _cache = null;
function loadAssets() {
  if (_cache) return _cache;
  _cache = {
    pack: loadStylePack(path.join(CONFIG_DIR, 'lin-style-pack.json')),
    fewshot: JSON.parse(readFileSync(path.join(CONFIG_DIR, 'lin-fewshot.json'), 'utf8')),
    promptTpl: readFileSync(path.join(CONFIG_DIR, 'lin-style-prompt.md'), 'utf8'),
  };
  return _cache;
}

/** 允许外部热重载（林总改了规则以后不用重启服务） */
export function reloadAssets() {
  _cache = null;
  return loadAssets();
}

/* ------------------------------------------------------------------ */
/* few-shot 选样                                                       */
/* ------------------------------------------------------------------ */

/**
 * 按主题域标签 + 关键词重合度挑选最相关的正样本。
 * 不需要向量库——10 条样本用规则匹配足够，而且可解释。
 */
export function pickFewshot(topic, fewshot, n = 2) {
  const text = [topic.title, topic.customer_problem, topic.topic_domain, topic.domain, topic.problem_space]
    .filter(Boolean)
    .join(' ');

  const scored = fewshot.samples.map((s) => {
    let score = 0;
    for (const d of s.domains || []) if (text.includes(d)) score += 3;
    for (const k of s.keywords || []) if (text.includes(k)) score += 2;
    // 轻微偏好结构完整的样本，避免总是选到最短那条
    score += Math.min(2, (s.body || '').length / 400);
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x) => x.s);
}

/* ------------------------------------------------------------------ */
/* prompt 渲染：规则从 JSON 来，保证「教」和「考」同源                    */
/* ------------------------------------------------------------------ */

function renderIdentity(pack) {
  const i = pack.identity;
  return `${i.persona}\n说话方式：${i.voice}\n面向观众：${i.audience}`;
}

function renderHardRules(pack) {
  return (pack.hard_blocks || [])
    .map((r, idx) => `${idx + 1}. 【${r.name}】${r.why}\n   → ${r.fix}`)
    .join('\n');
}

function renderStyleRules(pack) {
  const lines = [];
  lines.push('必须避免：');
  (pack.warnings || []).forEach((w) => lines.push(`  · ${w.name} —— ${w.why}。${w.fix}`));
  lines.push('\n必须具备：');
  (pack.positive_signals || []).forEach((p) => lines.push(`  · ${p.name} —— ${p.why}`));
  return lines.join('\n');
}

function renderTopicOrientation(pack) {
  const t = pack.topic_orientation;
  const lines = [];
  lines.push(`正确路径：${(t.required_path || []).join(' → ')}`);
  lines.push(`禁止路径：${t.forbidden_path}`);
  lines.push('\n入口改写对照（左边是错的，右边是林总要的）：');
  (t.entry_rewrites || []).forEach((r) => {
    lines.push(`  ✗ ${r.wrong}`);
    lines.push(`  ✓ ${r.right}`);
    lines.push(`    原因：${r.why}`);
  });
  return lines.join('\n');
}

function renderBrandThesis(pack) {
  const b = pack.brand_thesis;
  return [
    `核心主张：${b.core}`,
    `适用范围：${b.when_required}`,
    '三大支撑（用到时用口语讲，不要照念）：',
    ...(b.pillars || []).map((p, i) => `  ${i + 1}. ${p}`),
    `禁止：${b.forbidden}`,
  ].join('\n');
}

function renderBusinessRuleFidelity(pack) {
  const b = pack.business_rule_fidelity;
  const lines = [
    `原则：${b.principle}`,
    `不可改动：${(b.immutable || []).join('、')}`,
    `允许：${b.allowed}`,
    `禁止：${b.not_allowed}`,
  ];
  (b.examples || []).forEach((e) => {
    lines.push(`  ✗ ${e.wrong}`);
    lines.push(`  ✓ ${e.right}`);
    lines.push(`    原因：${e.why}`);
  });
  return lines.join('\n');
}

function renderStructure(pack) {
  const s = pack.structure_model;
  return [
    `Hook：${s.hook.chars[0]}-${s.hook.chars[1]}字，${s.hook.note}`,
    `问题放大：${s.problem_amplify.chars[0]}-${s.problem_amplify.chars[1]}字，${s.problem_amplify.note}`,
    `分点方案：${s.solution_points.count[0]}-${s.solution_points.count[1]}个，每个${s.solution_points.chars_each[0]}-${s.solution_points.chars_each[1]}字，用「${s.solution_points.marker}」标记`,
    `结尾判断：${s.closing_judgment.chars[0]}-${s.closing_judgment.chars[1]}字，${s.closing_judgment.note}`,
    `CTA：${s.cta.chars[0]}-${s.cta.chars[1]}字，${s.cta.note}`,
    `全文：${s.total_chars[0]}-${s.total_chars[1]}字`,
  ].join('\n');
}

function renderExpressionPrecision(pack) {
  return (pack.expression_precision || [])
    .map((e) => `  ✗ ${e.wrong}\n  ✓ ${e.right}\n    规则：${e.rule}`)
    .join('\n');
}

function renderCtaRules(pack) {
  const c = pack.cta_rules;
  return [
    `硬要求：${c.why}`,
    '可用句式：',
    ...(c.templates || []).map((t) => `  · ${t}`),
    `禁用词：${(c.forbidden_words || []).join('、')}`,
  ].join('\n');
}

function renderFewshot(samples) {
  return samples
    .map(
      (s, i) =>
        `【样稿${i + 1}｜${s.title}】\nHook：${s.hook}\n正文：${s.body}\nCTA：${s.cta}`
    )
    .join('\n\n');
}

export function buildSystemPrompt(topic, assets) {
  const { pack, fewshot, promptTpl } = assets;
  const picked = pickFewshot(topic, fewshot, 2);
  return promptTpl
    .replace('{{IDENTITY}}', renderIdentity(pack))
    .replace('{{HARD_RULES}}', renderHardRules(pack))
    .replace('{{TOPIC_ORIENTATION}}', renderTopicOrientation(pack))
    .replace('{{BRAND_THESIS}}', renderBrandThesis(pack))
    .replace('{{BUSINESS_RULE_FIDELITY}}', renderBusinessRuleFidelity(pack))
    .replace('{{STYLE_RULES}}', renderStyleRules(pack))
    .replace('{{STRUCTURE}}', renderStructure(pack))
    .replace('{{EXPRESSION_PRECISION}}', renderExpressionPrecision(pack))
    .replace('{{CTA_RULES}}', renderCtaRules(pack))
    .replace('{{FEWSHOT}}', renderFewshot(picked));
}

export function shouldRedactSensitive() {
  return process.env.LIN_REDACT_SENSITIVE !== 'false';
}

export function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\d+(?:\.\d+)?\s*%/g, '[比例已脱敏]')
    .replace(/百分之[零〇一二三四五六七八九十百千万两]+/g, '[比例已脱敏]')
    .replace(/(?:人民币\s*)?\d+(?:\.\d+)?\s*(?:万元|元|块|万)(?![\p{L}\p{N}])/gu, '[金额已脱敏]')
    .replace(/[零〇一二三四五六七八九十百千万两]+\s*(?:元|块)(?![\p{L}\p{N}])/gu, '[金额已脱敏]');
}

function knowledgeText(item) {
  if (typeof item === 'string') return item;
  return item.statement || item.content || item.text || item.summary || '';
}

export function buildUserPrompt(topic, knowledge = [], ctaAssets = [], opts = {}) {
  const lines = [];
  lines.push(`选题：${topic.title || ''}`);
  if (topic.customer_problem) lines.push(`客户的经营问题：${topic.customer_problem}`);
  if (topic.problem_space) lines.push(`所属问题空间：${topic.problem_space}`);
  if (topic.audience) lines.push(`目标观众：${topic.audience}`);
  if (topic.hook) lines.push(`本切口 Hook 方向：${topic.hook}`);
  if (topic.argument_angle) lines.push(`本切口论证角度：${topic.argument_angle}`);
  if (topic.content_structure) lines.push(`本切口内容结构：${topic.content_structure}`);
  if (Array.isArray(topic.solution_points) && topic.solution_points.length) {
    lines.push(`建议论证要点：${topic.solution_points.join('；')}`);
  }
  if (topic.conclusion) lines.push(`结论方向：${topic.conclusion}`);

  if (knowledge.length) {
    lines.push('\n可用的搜羽内部知识（只能用这里的事实，不要自行编造数字、年份、案例）：');
    knowledge.forEach((k, i) => {
      const original = knowledgeText(k);
      const body = (opts.redactSensitive ?? shouldRedactSensitive()) ? redactSensitiveText(original) : String(original);
      const title = typeof k === 'object' ? k.title || k.name || `知识${i + 1}` : `知识${i + 1}`;
      lines.push(`  [${i + 1}] ${title}：${String(body).slice(0, 700)}`);
    });
  } else {
    lines.push('\n注意：本次没有检索到内部知识。只讲你有把握的经营常识，不要编造搜羽的具体数据、案例或制度条文。');
  }

  if (ctaAssets.length) {
    lines.push('\nCTA 只能引用以下已存在的资产（写全名）：');
    ctaAssets.forEach((a) => lines.push(`  · ${typeof a === 'string' ? a : a.name || a.title}`));
  } else {
    lines.push('\n本次没有已验证的 CTA 资产：cta 必须输出空字符串。不要承诺任何方案、表格、手册或资料。');
  }

  if (opts.humanFeedback) {
    const feedback = opts.humanFeedback;
    lines.push('\n这是一次基于人工反馈的版本修改。必须保留原稿事实边界，修改建议只能作为要求，绝不能直接替代整篇稿件。');
    lines.push(`原稿：${String(feedback.original_script || '').slice(0, 4000)}`);
    lines.push(`哪里有问题：${String(feedback.problem_description || '').slice(0, 1200)}`);
    lines.push(`修改建议：${String(feedback.modification_suggestion || '').slice(0, 1200)}`);
  }

  if (Array.isArray(opts.preferenceRules) && opts.preferenceRules.length) {
    lines.push('\n已由用户人工确认的个性化偏好（每条都必须遵守，但不能改变事实和业务规则）：');
    opts.preferenceRules.slice(0, 12).forEach((rule, index) => {
      lines.push(`  ${index + 1}. ${String(rule.instruction || rule).slice(0, 500)}`);
      (rule.contrast_examples || []).slice(0, 1).forEach(example => {
        lines.push(`     反例：${String(example.rejected_output || '').slice(0, 500)}`);
        lines.push(`     被否原因：${String(example.rejection_reason || '').slice(0, 300)}`);
        if (example.preferred_alternative) lines.push(`     更好方向：${String(example.preferred_alternative).slice(0, 300)}`);
      });
    });
  }

  if (Array.isArray(opts.positiveExamples) && opts.positiveExamples.length) {
    lines.push('\n最近被用户明确判定为“直接拍”的成稿（只学习语气、节奏与结构，禁止复制其中的具体事实、数字或 CTA）：');
    opts.positiveExamples.slice(0, 2).forEach((example, index) => {
      lines.push(`  【直接拍样稿${index + 1}】${String(example.full_script || example).slice(0, 1600)}`);
    });
  }

  lines.push('\n现在按要求输出 JSON。');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 主函数                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {object} topic  {title, customer_problem, problem_space, audience, domain}
 * @param {Array}  knowledge  检索到的内部知识
 * @param {Array}  ctaAssets  可引用的真实资产名
 * @param {object} [opts]  {maxRetries, temperature, onProgress}
 * @returns {Promise<{ok, script, lint, attempts, systemPrompt, error}>}
 */
export async function composeLinScript(topic, knowledge = [], ctaAssets = [], opts = {}) {
  const assets = loadAssets();
  const { pack } = assets;
  const maxRetries = opts.maxRetries ?? pack.scoring?.max_retries ?? 2;
  const onProgress = opts.onProgress || (() => {});

  const systemPrompt = buildSystemPrompt(topic, assets);
  const userPrompt = buildUserPrompt(topic, knowledge, ctaAssets, opts);
  const actualCtaAssets = ctaAssetNames(ctaAssets);
  const lintContext = { hasCtaAsset: actualCtaAssets.length > 0 };
  const selectedFewshot = pickFewshot(topic, assets.fewshot, 2);
  const traceBase = {
    active_preference_rule_ids: (opts.preferenceRules || []).slice(0, 12).map(rule => rule.rule_id).filter(Boolean),
    positive_example_ids: (opts.positiveExamples || []).slice(0, 2).map(example => example.script_id || example.review_id).filter(Boolean),
    fewshot_example_ids: selectedFewshot.map(example => example.id).filter(Boolean),
    retrieved_knowledge_ids: knowledge.map((item, index) => ({
      knowledge_id: item?.knowledge_id || item?.evidence_id || item?.source_locator || `knowledge_${index + 1}`,
      source_locator: item?.source_locator || '',
      source_document: item?.source_document || item?.title || item?.name || ''
    })),
    style_pack_version: pack.version
  };

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const attempts = [];
  let best = null;

  for (let i = 0; i <= maxRetries; i++) {
    onProgress({ phase: 'generating', attempt: i + 1, of: maxRetries + 1 });

    let raw;
    let responseMeta;
    const promptHash = crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');
    try {
      responseMeta = await chatWithMetadata(messages, { temperature: opts.temperature, responseFormat: 'json_object' });
      raw = responseMeta.content;
    } catch (e) {
      return { ok: false, error: e.message, attempts, systemPrompt };
    }

    const parsed = extractJson(raw);
    const parsedScript = parsed && parsed.hook
      ? { hook: parsed.hook, body: parsed.body || '', cta: parsed.cta || '' }
      : normalizeScript(raw);
    const script = applyCtaPolicy(parsedScript, { assets: actualCtaAssets, fallbackCta: topic.cta_text });

    const lint = lintScript(script, pack, lintContext);
    attempts.push({ attempt: i + 1, script, lint, raw: raw.slice(0, 200), responseMeta, promptHash });
    onProgress({ phase: 'linted', attempt: i + 1, score: lint.score, passed: lint.passed });

    if (!best || lint.score > best.lint.score || (lint.passed && !best.lint.passed)) {
      best = { script, lint, responseMeta, promptHash };
    }

    if (lint.passed) break;
    if (i === maxRetries) break;

    // 把质检结果回喂给模型重写
    messages.push({ role: 'assistant', content: JSON.stringify(script) });
    messages.push({ role: 'user', content: lint.feedback });
  }

  return {
    ok: true,
    script: best.script,
    lint: best.lint,
    report: formatReport(best.lint),
    attempts: attempts.map((a) => ({ attempt: a.attempt, score: a.lint.score, passed: a.lint.passed, model: a.responseMeta.model, usage: a.responseMeta.usage, prompt_hash: a.promptHash })),
    systemPrompt,
    needsHumanReview: !best.lint.passed,
    stylePackVersion: pack.version,
    sensitiveKnowledgeRedacted: opts.redactSensitive ?? shouldRedactSensitive(),
    model: best.responseMeta.model,
    provider: best.responseMeta.provider,
    responseId: best.responseMeta.responseId,
    usage: attempts.reduce((sum, attempt) => ({
      prompt_tokens: sum.prompt_tokens + attempt.responseMeta.usage.prompt_tokens,
      completion_tokens: sum.completion_tokens + attempt.responseMeta.usage.completion_tokens,
      total_tokens: sum.total_tokens + attempt.responseMeta.usage.total_tokens,
      cost: sum.cost == null && attempt.responseMeta.usage.cost == null ? null : Number(sum.cost || 0) + Number(attempt.responseMeta.usage.cost || 0)
    }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: null }),
    lintContext,
    trace: { ...traceBase, prompt_hash: best.promptHash },
  };
}

/** 只做质检，不生成——供人工改稿后复查、或给原模板路径的产出打分 */
export function scoreExistingScript(script, ctx = {}) {
  const { pack } = loadAssets();
  const lint = lintScript(script, pack, ctx);
  return { lint, report: formatReport(lint) };
}

export { llmConfigured };
