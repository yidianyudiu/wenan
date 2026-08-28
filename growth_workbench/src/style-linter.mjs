/**
 * style-linter.mjs
 * 林总口播风格确定性检查器。不调用任何模型，纯规则打分。
 *
 * 用途：
 *   1) 生成后自动质检，低于阈值把问题回喂给 LLM 重写
 *   2) 给人工审核界面提供可解释的分数与违规清单
 *
 * 唯一事实源：config/lin-style-pack.json
 */

import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/** 有效字数（去掉所有空白） */
export function charCount(text) {
  return String(text || '').replace(/\s/g, '').length;
}

/** 切句：按中文句末标点和换行切分 */
export function splitSentences(text) {
  return String(text || '')
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 统计正则出现次数 */
function countMatches(text, pattern) {
  const re = new RegExp(pattern, 'g');
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

/** 取匹配到的原文片段（给人看的证据） */
function firstMatchContext(text, pattern, radius = 14) {
  const re = new RegExp(pattern);
  const m = re.exec(String(text || ''));
  if (!m) return null;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** 把脚本对象或字符串统一成 {hook, body, cta, full} */
export function normalizeScript(script) {
  if (typeof script === 'string') {
    const lines = script.split('\n').map((l) => l.trim()).filter(Boolean);
    const hook = lines[0] || '';
    const cta = lines.length > 1 ? lines[lines.length - 1] : '';
    const body = lines.slice(1, -1).join('\n');
    return { hook, body, cta, full: script };
  }
  const hook = script.hook || '';
  const body = script.body || script.script || '';
  const cta = script.cta || '';
  return { hook, body, cta, full: [hook, body, cta].filter(Boolean).join('\n') };
}

export function loadStylePack(jsonPath) {
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

/* ------------------------------------------------------------------ */
/* 具名检查项                                                          */
/* ------------------------------------------------------------------ */

// 兼容 第一， / 第一类， / 第一层， / 第一步， / 第一点，
const ENUM_MARKER = /第[一二三四五六七八九十]+[类层步点条种个]?[，,、：:．.]/g;

const CHECKS = {
  enumeration_present(s) {
    const n = countMatches(s.full, ENUM_MARKER.source);
    return { pass: n >= 2, detail: `检测到 ${n} 个分点标记` };
  },

  length_range(s, rule) {
    const n = charCount(s.full);
    return {
      pass: n >= rule.min && n <= rule.max,
      detail: `全文 ${n} 字（要求 ${rule.min}-${rule.max}）`,
    };
  },

  /**
   * Hook 检查采用「反向排除」而非「正向白名单」。
   * 依据：10条正样本的 Hook 形态高度多样（提问/断言/条件结果/痛点场景/矛盾场景），
   * 白名单必然误杀。真正要拦的只有一种——平淡的选题陈述句。
   */
  hook_style(s) {
    const h = s.hook;
    // 平淡陈述：「X是Y的重要节点」「X要兼顾A和B」「X需要注意…」
    const bland = /(是.{0,12}(重要|关键)(节点|环节|因素|一环)|要(兼顾|同步|统筹)|需要注意|应该重视|至关重要)/.test(h);
    // 张力信号：提问 / 判断 / 因果 / 痛点 / 数字冲击
    const tension = /[？?]|为什么|凭什么|怎么|要不要|是什么|靠的是|最(大|贵|怕|容易|危险)|别[一上再]|不要|不是.{1,15}(而)?是|都是|坑|错|\d+%|\d+万|其实|就要|你要|必须|才是|不敢|不等于|顾不好|被.{1,6}(掌|拿|捏|牵)/.test(h);
    const pass = !bland && (tension || charCount(h) <= 30);
    return {
      pass,
      detail: bland ? 'Hook 是平淡的选题陈述句，没有张力' : tension ? 'Hook 有张力' : 'Hook 尚可',
    };
  },

  hook_length(s, rule) {
    const n = charCount(s.hook);
    return { pass: n >= rule.min && n <= rule.max, detail: `Hook ${n} 字（要求 ${rule.min}-${rule.max}）` };
  },

  closing_judgment(s, rule) {
    const sents = splitSentences(s.body);
    const tail = sents.slice(-2).join('。');
    const hit = (rule.patterns || []).some((p) => new RegExp(p).test(tail));
    return { pass: hit, detail: hit ? '结尾是经营判断句' : `结尾未收成判断句：「${tail.slice(-40)}」` };
  },

  closing_no_enumeration(s) {
    const sents = splitSentences(s.body);
    const tail = sents.slice(-2).join('。');
    const bad = new RegExp(ENUM_MARKER.source).test(tail);
    return { pass: !bad, detail: bad ? '结尾又罗列了分点' : '结尾未重复罗列' };
  },

  cta_has_asset(s) {
    const c = s.cta || '';
    const hit = /《[^》]{2,20}》|["'“”「『][^"'“”」』]{2,12}["'”」』]|(方案|表格?|手册|清单|标准|流程|模板|资料|体系|课表|指南|文案|脚本|话术|案例|结构|模型|逻辑|测算|数据|规则|机制|路径)/.test(c);
    return { pass: hit, detail: hit ? 'CTA 指向了具体资产' : 'CTA 没有具体资产名，观众不知道能拿到什么' };
  },

  cta_phrasing(s, rule) {
    const c = s.cta || '';
    const hit = (rule.patterns || []).some((p) => new RegExp(p).test(c));
    return { pass: hit, detail: hit ? 'CTA 句式符合林总习惯' : 'CTA 不是林总常用句式（如「拿去直接用」「我整理好了」）' };
  },

  first_person_credibility(s, rule) {
    const hit = (rule.patterns || []).some((p) => new RegExp(p).test(s.full));
    return { pass: hit, detail: hit ? '有第一人称经验背书' : '缺少「我们200多家」「17年」这类经验背书' };
  },

  enumeration_count(s, rule) {
    const n = countMatches(s.full, ENUM_MARKER.source);
    return { pass: n >= rule.min && n <= rule.max, detail: `${n} 个分点（要求 ${rule.min}-${rule.max}）` };
  },

  second_person(s, rule) {
    const n = countMatches(s.full, '你');
    return { pass: n >= (rule.min_count || 3), detail: `「你」出现 ${n} 次` };
  },

  avg_sentence_length(s, rule) {
    const sents = splitSentences(s.full);
    if (!sents.length) return { pass: false, detail: '无有效句子' };
    const avg = sents.reduce((a, x) => a + charCount(x), 0) / sents.length;
    return { pass: avg <= rule.max, detail: `平均句长 ${avg.toFixed(1)} 字（上限 ${rule.max}）` };
  },
};

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {string|{hook,body,cta}} script
 * @param {object} pack  lin-style-pack.json 内容
 * @param {{hasCtaAsset?:boolean}} ctx  评分适用性上下文
 * @returns {{passed:boolean, score:number, blocks:Array, warnings:Array, signals:Array, feedback:string}}
 */
export function lintScript(script, pack, ctx = {}) {
  const s = normalizeScript(script);
  const blocks = [];
  const warnings = [];
  const signals = [];

  /* --- 1. 硬门禁 --- */
  for (const rule of pack.hard_blocks || []) {
    let violated = false;
    let detail = '';
    if (rule.pattern) {
      const ctx = firstMatchContext(s.full, rule.pattern);
      if (ctx) {
        violated = true;
        detail = `命中：${ctx}`;
      }
    } else if (rule.check && CHECKS[rule.check]) {
      const r = CHECKS[rule.check](s, rule);
      if (!r.pass) {
        violated = true;
        detail = r.detail;
      }
    }
    if (violated) blocks.push({ id: rule.id, name: rule.name, why: rule.why, fix: rule.fix, detail });
  }

  /* --- 2. 扣分项 --- */
  let deduction = 0;
  for (const rule of pack.warnings || []) {
    const ctx = firstMatchContext(s.full, rule.pattern);
    if (ctx) {
      deduction += rule.weight || 5;
      warnings.push({ id: rule.id, name: rule.name, why: rule.why, fix: rule.fix, detail: `命中：${ctx}`, weight: rule.weight || 5 });
    }
  }

  /* --- 3. 加分项 --- */
  let earned = 0;
  let total = 0;
  for (const rule of pack.positive_signals || []) {
    if ((rule.id === 'P05' || rule.id === 'P06') && ctx.hasCtaAsset === false) continue;
    if (rule.id === 'P07' && ctx.allowExperienceClaims === false) continue;
    const w = rule.weight || 5;
    total += w;
    const fn = CHECKS[rule.check];
    const r = fn ? fn(s, rule) : { pass: false, detail: `未实现的检查项 ${rule.check}` };
    if (r.pass) earned += w;
    signals.push({ id: rule.id, name: rule.name, pass: r.pass, detail: r.detail, weight: w });
  }

  const base = total > 0 ? (earned / total) * 100 : 0;
  const score = Math.max(0, Math.round(base - deduction));
  const threshold = pack.scoring?.pass_threshold ?? 82;
  const passed = blocks.length === 0 && score >= threshold;

  return { passed, score, threshold, blocks, warnings, signals, feedback: buildFeedback(blocks, warnings, signals, score, threshold) };
}

/** 生成回喂给 LLM 的修改意见 */
export function buildFeedback(blocks, warnings, signals, score, threshold) {
  if (!blocks.length && score >= threshold) return '';
  const lines = [`上一稿风格匹配度 ${score} 分（合格线 ${threshold}）。请按以下问题逐条修正，然后重写完整脚本：`];
  let i = 1;
  for (const b of blocks) {
    lines.push(`${i++}. 【必须修正】${b.name} — ${b.detail}。${b.fix ? '改法：' + b.fix : ''}`);
  }
  for (const w of warnings) {
    lines.push(`${i++}. 【建议修正】${w.name} — ${w.detail}。${w.fix ? '改法：' + w.fix : ''}`);
  }
  for (const s of signals.filter((x) => !x.pass)) {
    lines.push(`${i++}. 【风格缺失】${s.name} — ${s.detail}`);
  }
  lines.push('注意：只输出修改后的完整脚本，不要解释你改了什么。');
  return lines.join('\n');
}

/** 给人看的简报 */
export function formatReport(result) {
  const out = [];
  out.push(`风格匹配度：${result.score} / 100  （合格线 ${result.threshold}）  ${result.passed ? '✅ 通过' : '❌ 未通过'}`);
  if (result.blocks.length) {
    out.push('\n【硬门禁违规】');
    result.blocks.forEach((b) => out.push(`  ✗ ${b.name}：${b.detail}`));
  }
  if (result.warnings.length) {
    out.push('\n【扣分项】');
    result.warnings.forEach((w) => out.push(`  - ${w.name}（-${w.weight}）：${w.detail}`));
  }
  const missed = result.signals.filter((s) => !s.pass);
  if (missed.length) {
    out.push('\n【风格特征缺失】');
    missed.forEach((s) => out.push(`  ○ ${s.name}（-${s.weight}）：${s.detail}`));
  }
  const hit = result.signals.filter((s) => s.pass);
  if (hit.length) {
    out.push('\n【已具备的风格特征】');
    hit.forEach((s) => out.push(`  ● ${s.name}：${s.detail}`));
  }
  return out.join('\n');
}
