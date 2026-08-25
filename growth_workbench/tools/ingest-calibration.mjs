/**
 * ingest-calibration.mjs
 * 把林总每次审核的反馈，转成候选规则，追加进 lin-style-pack.json。
 *
 * 这是「品味沉淀」能持续变厚的关键：
 *   林总审核 → calibration_events.json → 本工具 → 候选规则 → 人工确认 → 规则库
 * 没有这一环，风格包就是一次性快照，三个月后就过期了。
 *
 * 用法：
 *   node tools/ingest-calibration.mjs                    # 只输出候选规则，不写文件
 *   node tools/ingest-calibration.mjs --apply            # 确认后写入 lin-style-pack.json
 *   node tools/ingest-calibration.mjs --events <path>    # 指定审核数据文件
 *
 * 设计原则：默认只提议，不自动改规则库。规则库是林总品味的存档，
 * 让脚本无人值守地往里写，等于让 AI 自己定义"什么像林总"。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_PATH = path.resolve(__dirname, '../config/lin-style-pack.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const eventsIdx = args.indexOf('--events');
const EVENTS_PATH = eventsIdx >= 0 ? args[eventsIdx + 1] : findEventsFile();

function findEventsFile() {
  const candidates = [
    path.resolve(__dirname, '../data/calibration_events.json'),
    path.resolve(__dirname, '../../data/calibration_events.json'),
    path.resolve(__dirname, '../../calibration_events.json'),
    path.resolve(process.cwd(), 'data/calibration_events.json'),
    path.resolve(process.cwd(), 'calibration_events.json'),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

/* ------------------------------------------------------------------ */

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从一条审核记录推断候选规则。
 * 审核表单字段（Usability Fix 01）：
 *   decision                 直接拍 / 修改后拍 / 不拍
 *   problem_description      哪里有问题
 *   modification_suggestion  修改建议
 *   overall_problem_summary  不拍时的整体问题总结
 * 同时兼容历史字段 problem_sentence / reason / preferred_expression。
 */
function deriveRule(ev, idx) {
  const bad = String(ev.problem_description || ev.problem_sentence || '').trim();
  const good = String(ev.modification_suggestion || ev.preferred_expression || '').trim();
  const why = String(ev.overall_problem_summary || ev.reason || ev.problem_description || '').trim();
  if (!bad && !good) return null;

  // 从原句里抠出最短的可复用特征：优先引号内内容，其次 4-12 字的片段
  let pattern = null;
  const quoted = bad.match(/[""''「『]([^""''」』]{2,14})[""''」』]/);
  if (quoted) {
    pattern = escapeRegex(quoted[1]);
  } else if (bad && bad.length <= 16) {
    pattern = escapeRegex(bad);
  }

  return {
    id: `AUTO-${String(idx + 1).padStart(3, '0')}`,
    name: why ? why.slice(0, 30) : '来自人工审核的新规则',
    pattern,
    why: why || '（林总审核时未填写原因，需回访补充）',
    fix: good || '（未提供替代表达，需回访补充）',
    weight: ev.decision === '不拍' ? 15 : 8,
    _source: {
      decision: ev.decision,
      script_id: ev.script_id || ev.id || null,
      date: ev.created_at || ev.date || null,
      original: bad,
      preferred: good,
      field_version: ev.problem_description !== undefined ? 'usability_fix_01' : 'legacy_review',
    },
    _needs_human_review: !pattern || !good,
  };
}

/* ------------------------------------------------------------------ */

function main() {
  if (!existsSync(EVENTS_PATH)) {
    console.error(`找不到审核数据文件：${EVENTS_PATH}`);
    console.error('请用 --events <路径> 指定，或确认工作台已产生 calibration_events.json');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(EVENTS_PATH, 'utf8'));
  const events = Array.isArray(raw) ? raw : raw.events || raw.calibration_events || [];
  const pack = JSON.parse(readFileSync(PACK_PATH, 'utf8'));

  const existingIds = new Set([
    ...(pack.hard_blocks || []).map((r) => r.id),
    ...(pack.warnings || []).map((r) => r.id),
    ...(pack.auto_rules || []).map((r) => r.id),
  ]);
  const seenOriginals = new Set((pack.auto_rules || []).map((r) => r._source?.original).filter(Boolean));

  const candidates = [];
  events.forEach((ev, i) => {
    const r = deriveRule(ev, i);
    if (!r) return;
    if (existingIds.has(r.id)) return;
    if (r._source.original && seenOriginals.has(r._source.original)) return;
    candidates.push(r);
  });

  console.log(`\n审核记录：${events.length} 条`);
  console.log(`可提炼为规则的：${candidates.length} 条`);
  console.log(`其中需人工补全的：${candidates.filter((c) => c._needs_human_review).length} 条\n`);

  if (!candidates.length) {
    console.log('没有新规则可提炼。');
    return;
  }

  console.log('─'.repeat(70));
  candidates.forEach((c) => {
    console.log(`\n${c.id}  [${c._source.decision || '未知决策'}]${c._needs_human_review ? '  ⚠ 需人工补全' : ''}`);
    console.log(`  名称：${c.name}`);
    console.log(`  原句：${c._source.original || '（无）'}`);
    console.log(`  改为：${c._source.preferred || '（无）'}`);
    console.log(`  正则：${c.pattern || '（无法自动提取，需手写）'}`);
    console.log(`  权重：${c.weight}`);
  });
  console.log('\n' + '─'.repeat(70));

  if (!APPLY) {
    console.log('\n以上仅为候选。确认无误后加 --apply 写入 config/lin-style-pack.json');
    console.log('写入前请人工检查：正则是否会误伤正常表达？改法是否是林总原意？\n');
    return;
  }

  pack.auto_rules = [...(pack.auto_rules || []), ...candidates];
  // 有正则且无需人工补全的，直接进 warnings 参与打分
  const promotable = candidates.filter((c) => c.pattern && !c._needs_human_review);
  pack.warnings = [
    ...(pack.warnings || []),
    ...promotable.map(({ _source, _needs_human_review, ...r }) => r),
  ];
  pack.updated = new Date().toISOString().slice(0, 10);
  pack.version = bumpMinor(pack.version);

  writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  console.log(`\n✅ 已写入 ${PACK_PATH}`);
  console.log(`   新增候选规则 ${candidates.length} 条，其中 ${promotable.length} 条已参与打分`);
  console.log(`   版本 → ${pack.version}`);
  console.log('\n下一步：跑 node test/lin-smoke.mjs，确认新规则没有把正样本误伤到 85 分以下。\n');
}

function bumpMinor(v) {
  const p = String(v || '1.0.0').split('.').map(Number);
  p[1] = (p[1] || 0) + 1;
  p[2] = 0;
  return p.join('.');
}

main();

