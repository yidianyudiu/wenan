import crypto from 'node:crypto';
import { chatWithMetadata, extractJson, llmConfigured } from './llm-client.mjs';

const CATEGORIES = [
  { id: 'spoken_naturalness', name: '更口语、更有人味', pattern: /机械|书面|人气|口语|像AI|AI味|不自然|生硬/, instruction: '表达必须像一线经营者当面说话，段落之间有自然承接，避免机械拼接和书面报告腔。' },
  { id: 'paragraph_transition', name: '段落衔接自然', pattern: /衔接|过渡|段落.{0,10}(关系|连接)|前后.{0,8}(接不上|断裂)/, instruction: '相邻段落必须有清楚的因果或递进关系，不能只把几个正确观点硬拼在一起。' },
  { id: 'business_logic', name: '商业逻辑完整', pattern: /逻辑|因果|前半句|后半句|不成立|方向.{0,6}(错|不对)/, instruction: '每个判断都要讲清楚原因、经营动作和结果，前后句必须属于同一条商业因果链。' },
  { id: 'hook_precision', name: 'Hook更准确', pattern: /hook|钩子|开头|第一句|切入/iu, instruction: '第一句直接命中球馆老板正在承受的经营结果，不铺垫、不做泛泛提问。' },
  { id: 'structure_clarity', name: '结构更清楚', pattern: /结构|分点|层次|结尾|收束|重复/, instruction: '全文按问题放大、三到五个解决要点、经营判断收束组织，避免重复罗列。' },
  { id: 'fact_precision', name: '事实表达精确', pattern: /事实|数据|年份|数字|编造|口径|不准确|称谓/, instruction: '只使用已检索到且可追溯的事实，不补写具体数字、年份、案例或不存在的岗位称谓。' },
  { id: 'cta_compliance', name: 'CTA真实合规', pattern: /CTA|评论|留言|资料|手册|方案|诱导互动/iu, instruction: 'CTA只能引用已登记存在的资产，并避开评论、留言、扣1、点赞关注等诱导互动表达。' }
];

const CATEGORY_MAP = new Map(CATEGORIES.map(category => [category.id, category]));
const text = value => String(value || '').trim();
const now = () => new Date().toISOString();
const shortHash = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const numericScore = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const unique = values => [...new Set(values.filter(Boolean))];

function countMap(values) {
  return values.reduce((result, value) => {
    const key = text(value) || '未知';
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function evidenceTrace(item, index) {
  const sourceLocator = item?.source_locator || '';
  const sourceDocument = item?.source_document || item?.title || item?.name || '';
  return {
    knowledge_id: item?.knowledge_id || item?.evidence_id || sourceLocator || `knowledge_${index + 1}_${shortHash(`${sourceDocument}|${sourceLocator}`)}`,
    source_locator: sourceLocator,
    source_document: sourceDocument
  };
}

function scriptSnapshot(script = {}) {
  return {
    script_id: script.script_id || null,
    revision_group_id: script.revision_group_id || script.script_id || null,
    version: Number(script.version || 1),
    title: script.title || '',
    full_script: script.full_script || '',
    generation_mode: script.generation_mode || 'unknown',
    style_score: script.style_score ?? null,
    style_passed: script.style_passed ?? null,
    style_pack_version: script.style_pack_version || script.generation_context?.style_pack_version || null,
    model: script.generation_context?.llm_model || null,
    provider: script.generation_context?.llm_provider || null,
    usage: script.generation_context?.llm_usage || null,
    active_preference_rule_ids: script.generation_context?.active_preference_rule_ids || [],
    positive_example_ids: script.generation_context?.positive_example_ids || [],
    retrieved_knowledge_ids: script.generation_context?.retrieved_knowledge_ids || (script.internal_knowledge || []).map(evidenceTrace),
    prompt_hash: script.generation_context?.prompt_hash || null,
    evidence_refs: (script.internal_knowledge || []).map(evidenceTrace)
  };
}

function topicSnapshot(topic = {}) {
  return {
    topic_id: topic.topic_id || null,
    theme_id: topic.theme_id || null,
    theme: topic.theme || '',
    title: topic.title || '',
    customer_problem: topic.customer_problem || '',
    problem_space: topic.problem_space || topic.gate?.matched_problem_spaces?.[0] || '',
    topic_domain: topic.topic_domain || '',
    hook: topic.hook || '',
    argument_angle: topic.argument_angle || '',
    content_structure: topic.content_structure || '',
    brand_thesis_id: topic.brand_thesis_id || null
  };
}

function eventFeedback(event) {
  return [event.problem_description, event.modification_suggestion, event.overall_problem_summary, event.rejection_reason, event.preferred_alternative].filter(Boolean).join('\n');
}

function feedbackHash(event) {
  return shortHash([event.decision, eventFeedback(event), event.topic_snapshot?.topic_domain, event.topic_snapshot?.problem_space].join('|'));
}

function scopeFromEvent(event) {
  return {
    domains: unique([event.topic_snapshot?.topic_domain]),
    problem_spaces: unique([event.topic_snapshot?.problem_space]),
    topic_ids: unique([event.topic_snapshot?.topic_id])
  };
}

function normalizeDimension(value) {
  const raw = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (CATEGORY_MAP.has(raw)) return raw;
  const matched = CATEGORIES.find(category => raw.includes(category.id) || text(value).includes(category.name));
  return matched?.id || 'custom';
}

function normalizeCandidate(candidate, event, mode, meta = {}) {
  const instruction = text(candidate?.instruction || candidate?.preference || candidate?.rule);
  if (!instruction) return null;
  const dimension = normalizeDimension(candidate?.dimension || candidate?.category);
  const sourceScope = scopeFromEvent(event);
  const suppliedScope = candidate?.scope || {};
  return {
    candidate_id: `cand_${event.review_id || event.calibration_event_id}_${dimension}_${shortHash(instruction)}`,
    dimension,
    instruction: instruction.slice(0, 600),
    scope: {
      domains: unique([...(Array.isArray(suppliedScope.domains) ? suppliedScope.domains : [suppliedScope.domain]), ...sourceScope.domains]),
      problem_spaces: unique([...(Array.isArray(suppliedScope.problem_spaces) ? suppliedScope.problem_spaces : [suppliedScope.problem_space]), ...sourceScope.problem_spaces]),
      topic_ids: sourceScope.topic_ids
    },
    evidence_review_ids: unique([...(candidate?.evidence_review_ids || []), event.review_id]),
    extraction_mode: mode,
    extraction_model: meta.model || null,
    extraction_provider: meta.provider || null,
    extracted_at: now()
  };
}

function fallbackCandidates(event, reason = 'offline_or_invalid_semantic_result') {
  const feedback = eventFeedback(event);
  const matched = CATEGORIES.filter(category => category.pattern.test(feedback));
  const rows = matched.length
    ? matched.map(category => ({ dimension: category.id, instruction: category.instruction }))
    : [{ dimension: 'custom', instruction: text(event.modification_suggestion) || text(event.preferred_alternative) || `避免出现以下整体问题：${text(event.overall_problem_summary || event.problem_description || event.rejection_reason)}` }];
  return rows.map(row => normalizeCandidate(row, event, 'regex_fallback', { reason })).filter(Boolean);
}

export async function extractPreferenceCandidates(event, { extractor, semantic = true } = {}) {
  if (extractor) {
    const result = await extractor(event);
    const rows = Array.isArray(result) ? result : result?.candidates || [];
    const normalized = rows.map(row => normalizeCandidate(row, event, 'deterministic_semantic_test')).filter(Boolean);
    return normalized.length ? normalized : fallbackCandidates(event, 'empty_test_extractor');
  }
  if (!semantic) return fallbackCandidates(event, 'startup_offline_migration');
  if (!llmConfigured()) return fallbackCandidates(event, 'llm_not_configured');
  const prompt = [
    '把下面一条人工审核反馈抽取成1到3条可执行、可验证的写作偏好。只能忠实转述用户反馈，禁止补充用户没有表达的偏好。',
    '输出JSON：{"candidates":[{"dimension":"spoken_naturalness|paragraph_transition|business_logic|hook_precision|structure_clarity|fact_precision|cta_compliance|custom","instruction":"具体可执行规则","scope":{"domains":[],"problem_spaces":[]},"evidence_review_ids":[]}]}',
    `审核结论：${event.decision || ''}`,
    `哪里有问题：${event.problem_description || ''}`,
    `修改建议：${event.modification_suggestion || ''}`,
    `整体问题总结：${event.overall_problem_summary || ''}`,
    `拒绝原因：${event.rejection_reason || ''}`,
    `希望替代方向：${event.preferred_alternative || ''}`,
    `选题域：${event.topic_snapshot?.topic_domain || ''}`,
    `问题空间：${event.topic_snapshot?.problem_space || ''}`
  ].join('\n');
  try {
    const response = await chatWithMetadata([
      { role: 'system', content: '你是反馈校准器，只做忠实结构化抽取，不写文案。' },
      { role: 'user', content: prompt }
    ], { temperature: 0.1, responseFormat: 'json_object' });
    const parsed = extractJson(response.content) || {};
    const rows = Array.isArray(parsed) ? parsed : parsed.candidates || [];
    const normalized = rows.map(row => normalizeCandidate(row, event, 'semantic_llm', response)).filter(Boolean);
    return normalized.length ? normalized : fallbackCandidates(event, 'semantic_result_empty');
  } catch (error) {
    return fallbackCandidates(event, `semantic_error_${shortHash(error?.message || error)}`);
  }
}

export function createCalibrationEvent(review, script, topic) {
  const rejected = review.decision === '不拍';
  return {
    ...review,
    calibration_event_id: `cal_${review.review_id}`,
    schema_version: 'feedback_flywheel_v2',
    event_type: 'script_calibration_data',
    script_snapshot: scriptSnapshot(script),
    topic_snapshot: topicSnapshot(topic),
    rejected_output: rejected ? script?.full_script || '' : '',
    rejection_reason: rejected ? text(review.overall_problem_summary || review.problem_description) : '',
    preferred_alternative: rejected ? text(review.modification_suggestion) : '',
    revision_outcome: null,
    learning_status: 'captured_pending_rule_review',
    preference_candidates: [],
    preference_candidate_feedback_hash: null,
    privacy: { storage: 'local_workbench_only', api_key_recorded: false, verified_internal_effect: 'none', content_os_schema_effect: 'none' }
  };
}

function findHistoricalRevision(event, scripts) {
  if (event.decision !== '修改后拍' || event.revision_outcome?.script_id) return null;
  const source = scripts.find(script => script.script_id === event.script_id);
  if (!source) return null;
  const groupId = source.revision_group_id || source.script_id;
  return scripts
    .filter(script => (script.revision_group_id || script.script_id) === groupId && Number(script.version || 1) > Number(source.version || 1))
    .sort((a, b) => Number(a.version || 1) - Number(b.version || 1) || String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}

export function enrichCalibrationEvents(events, scripts = [], topics = []) {
  return events.map(event => {
    const script = scripts.find(item => item.script_id === event.script_id) || {};
    const topic = topics.find(item => item.topic_id === (event.topic_id || script.topic_id)) || {};
    const snapshot = event.script_snapshot || scriptSnapshot(script);
    const revision = findHistoricalRevision(event, scripts);
    const rejected = event.decision === '不拍';
    return {
      ...event,
      calibration_event_id: event.calibration_event_id || `cal_${event.review_id || shortHash(JSON.stringify(event))}`,
      schema_version: 'feedback_flywheel_v2',
      event_type: 'script_calibration_data',
      script_snapshot: snapshot,
      topic_snapshot: event.topic_snapshot || topicSnapshot(topic),
      rejected_output: event.rejected_output ?? (rejected ? snapshot.full_script : ''),
      rejection_reason: event.rejection_reason ?? (rejected ? text(event.overall_problem_summary || event.problem_description) : ''),
      preferred_alternative: event.preferred_alternative ?? (rejected ? text(event.modification_suggestion) : ''),
      revision_outcome: event.revision_outcome || (revision ? scriptSnapshot(revision) : null),
      learning_status: event.learning_status || (revision ? 'paired_v1_to_revision' : 'captured_pending_rule_review'),
      preference_candidates: Array.isArray(event.preference_candidates) ? event.preference_candidates : [],
      preference_candidate_feedback_hash: event.preference_candidate_feedback_hash || null,
      privacy: { storage: 'local_workbench_only', api_key_recorded: false, verified_internal_effect: 'none', content_os_schema_effect: 'none', ...(event.privacy || {}) },
      verified_internal_effect: 'none'
    };
  });
}

function activeRuleIds(event) {
  return event.script_snapshot?.active_preference_rule_ids || [];
}

function candidateDimensionForEvent(event, dimension) {
  return (event.preference_candidates || []).some(candidate => candidate.dimension === dimension);
}

export function effectForRule(ruleId, dimension, events) {
  const applied = events.filter(event => activeRuleIds(event).includes(ruleId));
  const deltas = [];
  for (const event of applied) {
    const score = numericScore(event.script_snapshot?.style_score);
    if (score == null) continue;
    const scope = event.topic_snapshot?.topic_domain || event.topic_snapshot?.problem_space || '';
    const baseline = events.filter(other => {
      const otherScore = numericScore(other.script_snapshot?.style_score);
      if (otherScore == null || activeRuleIds(other).includes(ruleId)) return false;
      const otherScope = other.topic_snapshot?.topic_domain || other.topic_snapshot?.problem_space || '';
      return otherScope === scope && String(other.created_at || '') < String(event.created_at || '');
    }).map(other => other.script_snapshot.style_score);
    if (baseline.length) deltas.push(score - baseline.reduce((sum, value) => sum + value, 0) / baseline.length);
  }
  const recurrence = applied.filter(event => event.decision !== '直接拍' && candidateDimensionForEvent(event, dimension)).length;
  return {
    applied_count: applied.length,
    accepted_after: applied.filter(event => event.decision === '直接拍').length,
    revised_after: applied.filter(event => event.decision === '修改后拍').length,
    rejected_after: applied.filter(event => event.decision === '不拍').length,
    avg_score_delta: deltas.length ? Math.round((deltas.reduce((sum, value) => sum + value, 0) / deltas.length) * 10) / 10 : null,
    recurrence_rate: applied.length ? Math.round((recurrence / applied.length) * 1000) / 1000 : null
  };
}

export function confidenceForRule(sourceEvents, effect) {
  const sourceFactor = Math.min(1, sourceEvents.length / 3);
  const scopeCounts = countMap(sourceEvents.map(event => event.topic_snapshot?.topic_domain || event.topic_snapshot?.problem_space || '未知'));
  const scopeConsistency = sourceEvents.length ? Math.max(...Object.values(scopeCounts)) / sourceEvents.length : 0;
  const recency = sourceEvents.length ? sourceEvents.reduce((sum, event) => {
    const ageDays = Math.max(0, (Date.now() - new Date(event.created_at || 0).getTime()) / 86400000);
    return sum + Math.exp(-ageDays / 90);
  }, 0) / sourceEvents.length : 0;
  const repeated = sourceEvents.length > 1 ? Math.min(1, (sourceEvents.length - 1) / 2) : 0;
  const effectSignal = effect.avg_score_delta == null ? 0.5 : clamp((effect.avg_score_delta + 10) / 20);
  const outcomeSignal = effect.applied_count ? clamp((effect.accepted_after - effect.rejected_after + effect.applied_count) / (2 * effect.applied_count)) : 0.5;
  const score = clamp(sourceFactor * 0.25 + scopeConsistency * 0.2 + recency * 0.15 + repeated * 0.15 + effectSignal * 0.15 + outcomeSignal * 0.1);
  return { score: Math.round(score * 1000) / 1000, label: score >= 0.72 ? 'high' : score >= 0.45 ? 'medium' : 'low' };
}

function ruleRows(events, existingRules) {
  const existing = new Map(existingRules.map(rule => [rule.rule_id, rule]));
  const groups = new Map();
  for (const event of events.filter(item => item.decision === '修改后拍' || item.decision === '不拍')) {
    for (const candidate of event.preference_candidates || []) {
      const ruleId = candidate.dimension === 'custom' ? `pref_custom_${shortHash(candidate.instruction)}` : `pref_${candidate.dimension}`;
      if (!groups.has(ruleId)) groups.set(ruleId, []);
      groups.get(ruleId).push({ event, candidate });
    }
  }
  const rows = [];
  for (const [ruleId, sources] of groups) {
    const previous = existing.get(ruleId) || {};
    const latest = sources.slice().sort((a, b) => String(b.event.created_at || '').localeCompare(String(a.event.created_at || '')))[0];
    const dimension = latest.candidate.dimension;
    const instruction = latest.candidate.instruction;
    const sourceEvents = sources.map(source => source.event);
    const effect = effectForRule(ruleId, dimension, events);
    const confidence = confidenceForRule(sourceEvents, effect);
    const instructionChanged = previous.instruction && previous.instruction !== instruction;
    const status = instructionChanged && previous.status === 'active' ? 'pending' : previous.status || 'pending';
    const contrasts = sourceEvents.filter(event => event.decision === '不拍').slice(0, 2).map(event => ({
      calibration_event_id: event.calibration_event_id,
      rejected_output: event.rejected_output,
      rejection_reason: event.rejection_reason,
      preferred_alternative: event.preferred_alternative
    }));
    rows.push({
      rule_id: ruleId,
      dimension,
      name: CATEGORY_MAP.get(dimension)?.name || '来自人工反馈的具体偏好',
      instruction,
      scope: {
        domains: unique(sources.flatMap(source => source.candidate.scope?.domains || [])),
        problem_spaces: unique(sources.flatMap(source => source.candidate.scope?.problem_spaces || [])),
        topic_ids: unique(sources.flatMap(source => source.candidate.scope?.topic_ids || []))
      },
      source_count: unique(sourceEvents.map(event => event.review_id)).length,
      source_review_ids: unique(sourceEvents.map(event => event.review_id)),
      sample_feedback: sourceEvents.slice(0, 2).map(event => eventFeedback(event).slice(0, 500)),
      contrast_examples: contrasts,
      confidence: confidence.label,
      confidence_score: confidence.score,
      weight: Math.round(clamp(confidence.score * 0.75 + (effect.avg_score_delta == null ? 0.5 : clamp((effect.avg_score_delta + 10) / 20)) * 0.25) * 1000) / 1000,
      effect,
      status,
      decided_at: status === previous.status ? previous.decided_at || null : null,
      created_at: previous.created_at || now(),
      updated_at: now(),
      verified_internal_effect: 'none'
    });
  }
  for (const previous of existingRules) {
    if (!rows.some(rule => rule.rule_id === previous.rule_id)) rows.push({
      ...previous,
      status: previous.status === 'active' ? 'rejected' : previous.status,
      retired_at: previous.retired_at || now(),
      retirement_reason: previous.retirement_reason || '语义重分析后没有当前反馈证据，已停止注入后续生成',
      effect: previous.effect || effectForRule(previous.rule_id, previous.dimension || 'custom', events),
      weight: clamp(previous.weight ?? 0.5)
    });
  }
  return rows.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0) || Number(b.source_count || 0) - Number(a.source_count || 0));
}

function averageStyle(events, decision) {
  const scores = events.filter(event => event.decision === decision).map(event => event.script_snapshot?.style_score).filter(value => typeof value === 'number' && Number.isFinite(value));
  return scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null;
}

export function buildFeedbackFlywheel(events, existingRules = []) {
  const rules = ruleRows(events, existingRules);
  const directExamples = events.filter(event => event.decision === '直接拍' && text(event.script_snapshot?.full_script))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 6)
    .map(event => ({ review_id: event.review_id, script_id: event.script_snapshot.script_id, title: event.script_snapshot.title, full_script: event.script_snapshot.full_script, topic_domain: event.topic_snapshot?.topic_domain || '', problem_space: event.topic_snapshot?.problem_space || '', style_score: event.script_snapshot.style_score, model: event.script_snapshot.model, created_at: event.created_at }));
  const categoryCounts = {};
  for (const category of CATEGORIES) categoryCounts[category.name] = events.filter(event => candidateDimensionForEvent(event, category.id)).length;
  const decisionCounts = { '直接拍': 0, '修改后拍': 0, '不拍': 0 };
  events.forEach(event => { if (decisionCounts[event.decision] !== undefined) decisionCounts[event.decision] += 1; });
  return {
    schema_version: 'feedback_flywheel_v2', generated_at: now(),
    metrics: {
      total_feedback: events.length,
      full_snapshot_events: events.filter(event => text(event.script_snapshot?.full_script)).length,
      paired_revision_events: events.filter(event => event.revision_outcome?.script_id).length,
      decision_counts: decisionCounts,
      generation_modes: countMap(events.map(event => event.script_snapshot?.generation_mode)),
      models: countMap(events.map(event => event.script_snapshot?.model).filter(Boolean)),
      average_style_by_decision: { '直接拍': averageStyle(events, '直接拍'), '修改后拍': averageStyle(events, '修改后拍'), '不拍': averageStyle(events, '不拍') },
      preference_categories: categoryCounts,
      active_rules: rules.filter(rule => rule.status === 'active').length,
      pending_rules: rules.filter(rule => rule.status === 'pending').length,
      positive_examples: directExamples.length
    },
    rules,
    active_preferences: rules.filter(rule => rule.status === 'active').sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0)),
    positive_examples: directExamples,
    governance: { rule_activation: 'human_confirmation_required', direct_shoot_examples: 'automatically_eligible_as_positive_style_examples', verified_internal_effect: 'none', content_os_schema_effect: 'none' }
  };
}

export async function syncFeedbackFlywheel(store, options = {}) {
  const loadedScripts = options.scripts || await store.read('scripts');
  const loadedTopics = options.topics || await store.read('topics');
  const reanalyze = options.reanalyze ?? (!options.scripts && !options.topics);
  let events = enrichCalibrationEvents(await store.read('calibration_events'), loadedScripts, loadedTopics);
  events = await Promise.all(events.map(async event => {
    if (event.decision !== '修改后拍' && event.decision !== '不拍') return event;
    const hash = feedbackHash(event);
    if (!reanalyze && event.preference_candidate_feedback_hash === hash && event.preference_candidates?.length) return event;
    return { ...event, preference_candidates: await extractPreferenceCandidates(event, options), preference_candidate_feedback_hash: hash, preference_candidates_updated_at: now() };
  }));
  const snapshot = buildFeedbackFlywheel(events, await store.read('preference_rules'));
  await store.write('calibration_events', events);
  await store.write('preference_rules', snapshot.rules);
  return snapshot;
}

export async function feedbackGenerationContext(store) {
  const snapshot = buildFeedbackFlywheel(await store.read('calibration_events'), await store.read('preference_rules'));
  return { preferenceRules: snapshot.active_preferences.slice(0, 12), positiveExamples: snapshot.positive_examples.slice(0, 2), snapshot };
}

export async function setPreferenceRuleStatus(store, ruleId, action) {
  const statuses = { approve: 'active', reject: 'rejected', reset: 'pending' };
  if (!statuses[action]) throw new Error('偏好规则动作无效');
  let updated = null;
  await store.update('preference_rules', rules => rules.map(rule => {
    if (rule.rule_id !== ruleId) return rule;
    updated = { ...rule, status: statuses[action], decided_at: now(), updated_at: now() };
    return updated;
  }));
  if (!updated) throw new Error('偏好候选不存在');
  return updated;
}

export async function attachRevisionOutcome(store, reviewId, revisedScript) {
  await store.update('calibration_events', events => events.map(event => event.review_id === reviewId ? { ...event, revision_outcome: scriptSnapshot(revisedScript), learning_status: 'paired_v1_to_revision', updated_at: now() } : event));
}
