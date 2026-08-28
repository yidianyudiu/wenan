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
 * 原模板拼接路径只保留为用户明确选择的 template 模式；模型失败时停止落库。
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

function renderStyleRules(pack, topic = {}) {
  const lines = [];
  lines.push('必须避免：');
  (pack.warnings || []).forEach((w) => lines.push(`  · ${w.name} —— ${w.why}。${w.fix}`));
  lines.push('\n必须具备：');
  (pack.positive_signals || []).filter(p => !(p.id === 'P07' && topic.problem_space === '教学技术')).forEach((p) => lines.push(`  · ${p.name} —— ${p.why}`));
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
    .replace('{{STYLE_RULES}}', renderStyleRules(pack, topic))
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

function compactKnowledge(value) {
  const seen = new Set();
  return String(value || '')
    .split(/\n+/)
    .map(line => line.replace(/\s*\|\s*/g, '｜').replace(/\s+/g, ' ').trim())
    .filter(line => line && !seen.has(line) && seen.add(line))
    .join('\n');
}

function normalizedClaimText(value) {
  return String(value || '').toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’《》【】（）()\-]/g, '');
}

function externalGroundingIssues(script, knowledge, externalMaterial) {
  if (!externalMaterial?.content) return [];
  const source = normalizedClaimText([
    externalMaterial.content,
    externalMaterial.title,
    ...knowledge.map(knowledgeText)
  ].join('\n'));
  const full = [script.hook, script.body, script.cta].filter(Boolean).join('\n');
  const risky = [
    /\d+(?:\.\d+)?\s*(?:%|％|年|家|片|万|元|块|次|小时|分钟|天|人|成)/g,
    /[一二三四五六七八九十百千万两]+个有[一二三四五六七八九十百千万两]+个/g,
    /[一二三四五六七八九十]成(?:以上|以下)?/g,
    /我(?:带|教|看|做|跑|服务).{0,12}(?:年|多年|这么多年)/g,
    /我们(?:全国)?.{0,12}(?:第一考|第一关|规定|要求|统一标准)/g
  ];
  const issues = [];
  for (const pattern of risky) {
    for (const match of full.match(pattern) || []) {
      if (!source.includes(normalizedClaimText(match))) issues.push(match);
    }
  }
  return [...new Set(issues)].slice(0, 8);
}

async function verifyExternalGrounding(script, knowledge, externalMaterial, opts = {}) {
  if (!externalMaterial?.content || opts.verifyExternalGrounding === false) return { passed: true, issues: [], responseMeta: null };
  if (opts.groundingVerifier) return { ...(await opts.groundingVerifier({ script, knowledge, externalMaterial })), responseMeta: null };
  const sourceText = [
    `外部原文：\n${String(externalMaterial.content).slice(0, 7000)}`,
    knowledge.length ? `可用内部知识：\n${knowledge.map((item, index) => `[${index + 1}] ${knowledgeText(item)}`).join('\n').slice(0, 5000)}` : '可用内部知识：无'
  ].join('\n\n');
  const scriptText = [script.hook, script.body, script.cta].filter(Boolean).join('\n');
  const messages = [
    { role: 'system', content: '你是严格但不过度挑词的素材忠实审计器，只比较来源与成稿，禁止调用常识替成稿补证。必须拦截：来源没有的具体技术动作、手型、练习方法、可验证因果、数字、案例、制度和经验背书；与来源含义相反则属于contradiction。必须放行：不改变原意的同义口语改写、修辞问句、段落承接。例如“分成两部分”改成“两组分工”、“负责握住拍子”改成“负责把拍子握住”不算新增事实。不要因为措辞不同就判unsupported。' },
    { role: 'user', content: `${sourceText}\n\n待审成稿：\n${scriptText}\n\n输出JSON：{"passed":true,"unsupported":["成稿中的具体问题片段"],"contradictions":["成稿中的矛盾片段"]}。passed只有在两个数组都为空时才能为true。` }
  ];
  try {
    const responseMeta = await chatWithMetadata(messages, { temperature: 0, responseFormat: 'json_object' });
    const parsed = extractJson(responseMeta.content) || {};
    const unsupported = Array.isArray(parsed.unsupported) ? parsed.unsupported.filter(Boolean).slice(0, 8) : [];
    const contradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions.filter(Boolean).slice(0, 8) : [];
    const valid = typeof parsed.passed === 'boolean' || Array.isArray(parsed.unsupported) || Array.isArray(parsed.contradictions);
    const passed = valid && parsed.passed !== false && unsupported.length === 0 && contradictions.length === 0;
    return { passed, issues: [...unsupported, ...contradictions, ...(!valid ? ['素材忠实审计器没有返回有效结论'] : [])], unsupported, contradictions, responseMeta };
  } catch (error) {
    return { passed: false, issues: [`素材忠实审计失败：${String(error.message || error).slice(0, 180)}`], responseMeta: null };
  }
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
      const compacted = compactKnowledge(original);
      const body = (opts.redactSensitive ?? shouldRedactSensitive()) ? redactSensitiveText(compacted) : compacted;
      const title = typeof k === 'object' ? k.title || k.name || `知识${i + 1}` : `知识${i + 1}`;
      lines.push(`  [${i + 1}] ${title}：${String(body).slice(0, 520)}`);
    });
  } else {
    lines.push('\n注意：本次没有检索到内部知识。只讲你有把握的经营常识，不要编造搜羽的具体数据、案例或制度条文。');
  }

  if (opts.externalMaterial?.content) {
    const external = opts.externalMaterial;
    lines.push('\n外部灵感原文（External Inspiration，不是 verified_internal）：');
    if (external.title) lines.push(`标题：${String(external.title).slice(0, 300)}`);
    if (external.url) lines.push(`来源：${String(external.url).slice(0, 800)}`);
    lines.push(String(external.content).slice(0, 6000));
    lines.push('使用边界：必须忠实理解原文讲的主题、动作和冲突；可以重新组织原创表达，但禁止逐句改写、洗稿或把外部主张冒充搜羽内部事实。');
    lines.push('素材忠实硬门禁：所有具体技术动作、手型、练习标准、数字、案例、制度和经验背书，都必须能在上面的外部原文或内部知识中直接找到。原文没写的“V字、虎口、练习次数、我们多少家球馆怎么考”等内容一律不要补。素材不足时宁可少写，也不许靠常识扩写。');
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
  const lintContext = { hasCtaAsset: actualCtaAssets.length > 0, allowExperienceClaims: knowledge.length > 0 };
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
    external_inspiration: opts.externalMaterial?.content ? {
      inspiration_id: opts.externalMaterial.inspiration_id || opts.externalMaterial.external_inspiration_id || null,
      title: opts.externalMaterial.title || '',
      source_url: opts.externalMaterial.url || '',
      content_chars: String(opts.externalMaterial.content).length,
      content_hash: crypto.createHash('sha256').update(String(opts.externalMaterial.content)).digest('hex')
    } : null,
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
      attempts.push({ attempt: i + 1, script: null, lint: null, raw: '', responseMeta: null, promptHash, request_error: String(e.message || e).slice(0, 300) });
      if (i < maxRetries) {
        messages.push({ role: 'user', content: '上一轮请求没有返回完整正文。请减少推理过程，直接输出300到500字的完整JSON稿件，不要解释。' });
        continue;
      }
      return { ok: false, error: e.message, attempts, systemPrompt };
    }

    const parsed = extractJson(raw);
    const validShape = parsed && typeof parsed.hook === 'string' && parsed.hook.trim() && typeof parsed.body === 'string' && parsed.body.replace(/\s/g, '').length >= 120;
    if (!validShape) {
      attempts.push({ attempt: i + 1, script: null, lint: null, raw: raw.slice(0, 200), responseMeta, promptHash, invalid_output: true });
      onProgress({ phase: 'invalid_output', attempt: i + 1 });
      if (i < maxRetries) {
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: '上一条输出不是合法且完整的JSON稿件，或正文不足120字。请重新输出完整JSON，必须包含非空hook、完整body和cta字段，不要解释。' });
      }
      continue;
    }
    const parsedScript = { hook: parsed.hook.trim(), body: parsed.body.trim(), cta: typeof parsed.cta === 'string' ? parsed.cta.trim() : '' };
    const script = applyCtaPolicy(parsedScript, { assets: actualCtaAssets, fallbackCta: topic.cta_text });

    const groundingIssues = externalGroundingIssues(script, knowledge, opts.externalMaterial);
    if (groundingIssues.length) {
      attempts.push({ attempt: i + 1, script, lint: null, raw: raw.slice(0, 200), responseMeta, promptHash, grounding_issues: groundingIssues });
      onProgress({ phase: 'grounding_failed', attempt: i + 1, issues: groundingIssues });
      if (i < maxRetries) {
        messages.push({ role: 'assistant', content: JSON.stringify(script) });
        messages.push({ role: 'user', content: `上一稿加入了素材中找不到的事实或经验背书：${groundingIssues.join('、')}。全部删除，只使用已提供原文和内部知识中能直接找到的内容，重新输出完整JSON。` });
      }
      continue;
    }

    const groundingVerification = await verifyExternalGrounding(script, knowledge, opts.externalMaterial, opts);
    if (!groundingVerification.passed) {
      attempts.push({ attempt: i + 1, script, lint: null, raw: raw.slice(0, 200), responseMeta, promptHash, grounding_issues: groundingVerification.issues, grounding_verification: groundingVerification });
      onProgress({ phase: 'grounding_failed', attempt: i + 1, issues: groundingVerification.issues });
      if (i < maxRetries) {
        messages.push({ role: 'assistant', content: JSON.stringify(script) });
        messages.push({ role: 'user', content: `素材忠实审计发现以下内容没有来源或与来源矛盾：${groundingVerification.issues.join('；')}。删除这些内容，只按原文和内部知识重写完整JSON。不要用常识补充新的技术动作或练习方法。` });
      }
      continue;
    }

    const lint = lintScript(script, pack, lintContext);
    attempts.push({ attempt: i + 1, script, lint, raw: raw.slice(0, 200), responseMeta, promptHash, grounding_verification: groundingVerification });
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

  if (!best) {
    const grounding = attempts.flatMap(attempt => attempt.grounding_issues || []);
    const error = grounding.length
      ? `模型连续加入素材中不存在的事实或经验背书（${[...new Set(grounding)].slice(0, 5).join('、')}），已停止落库`
      : '模型连续返回不完整或无法解析的稿件，已停止落库';
    return { ok: false, error, attempts, systemPrompt };
  }

  return {
    ok: true,
    script: best.script,
    lint: best.lint,
    report: formatReport(best.lint),
    attempts: attempts.map((a) => ({ attempt: a.attempt, score: a.lint?.score ?? null, passed: a.lint?.passed ?? false, invalid_output: Boolean(a.invalid_output), request_error: a.request_error || null, grounding_issues: a.grounding_issues || [], grounding_verified: a.grounding_verification?.passed ?? null, model: a.responseMeta?.model || null, usage: a.responseMeta?.usage || null, grounding_usage: a.grounding_verification?.responseMeta?.usage || null, prompt_hash: a.promptHash })),
    systemPrompt,
    needsHumanReview: !best.lint.passed,
    stylePackVersion: pack.version,
    sensitiveKnowledgeRedacted: opts.redactSensitive ?? shouldRedactSensitive(),
    model: best.responseMeta.model,
    provider: best.responseMeta.provider,
    responseId: best.responseMeta.responseId,
    usage: attempts.reduce((sum, attempt) => {
      const usage = [attempt.responseMeta?.usage, attempt.grounding_verification?.responseMeta?.usage].filter(Boolean).reduce((total, item) => ({
        prompt_tokens: total.prompt_tokens + item.prompt_tokens,
        completion_tokens: total.completion_tokens + item.completion_tokens,
        total_tokens: total.total_tokens + item.total_tokens,
        cost: total.cost == null && item.cost == null ? null : Number(total.cost || 0) + Number(item.cost || 0)
      }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: null });
      return {
      prompt_tokens: sum.prompt_tokens + usage.prompt_tokens,
      completion_tokens: sum.completion_tokens + usage.completion_tokens,
      total_tokens: sum.total_tokens + usage.total_tokens,
      cost: sum.cost == null && usage.cost == null ? null : Number(sum.cost || 0) + Number(usage.cost || 0)
      };
    }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: null }),
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
