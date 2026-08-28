import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workbench = path.resolve(here, '..');
const configDir = path.join(workbench, 'config');
const contentRoot = path.resolve(process.env.CONTENT_OS_ROOT || path.resolve(workbench, '..'));
const fewshot = JSON.parse(await fs.readFile(path.join(configDir, 'lin-fewshot.json'), 'utf8'));
const pack = JSON.parse(await fs.readFile(path.join(configDir, 'lin-style-pack.json'), 'utf8'));
const promptTpl = await fs.readFile(path.join(configDir, 'lin-style-prompt.md'), 'utf8');
const sourceGood = fewshot.samples.find(sample => sample.id === 'LS-03');
const good = { hook: sourceGood.hook, body: sourceGood.body, cta: '' };
const bad = {
  hook: '球馆经营需要注意很多问题',
  body: '首先，要关注经营，因为经营是球馆发展的重要环节，需要持续优化。其次，要关注团队，因为团队也是球馆发展的重要环节，需要持续提升。再次，要关注客户，因为客户同样是球馆发展的重要环节，需要不断维护。最后，还应该关注服务、活动和宣传等多个方面，并且做好相关工作。总之，球馆经营者应该重视这些问题，并且持续进行优化和提升。',
  cta: ''
};

const readBody = async request => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const mock = http.createServer(async (request, response) => {
  const payload = await readBody(request);
  const userText = payload.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
  const retryRequested = payload.messages.length > 2;
  const preferenceApplied = userText.includes('段落之间必须使用因果承接句');
  const retryProbe = userText.includes('重试口径测试');
  const selected = preferenceApplied || (retryProbe && retryRequested) ? good : bad;
  const content = JSON.stringify(selected);
  const result = JSON.stringify({ id: 'quality-stub', model: 'deterministic/flywheel-quality', provider: 'Local Deterministic Stub', usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: 0 }, choices: [{ message: { role: 'assistant', content } }] });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(result);
});
await new Promise((resolve, reject) => mock.once('error', reject).listen(0, '127.0.0.1', resolve));
after(() => new Promise(resolve => mock.close(resolve)));

process.env.LIN_LLM_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;
process.env.LIN_LLM_MODEL = 'deterministic/flywheel-quality';
process.env.LIN_LLM_API_KEY = 'quality-test-key';
process.env.OPENROUTER_API_KEY = 'your-key';
process.env.LIN_LLM_TIMEOUT_MS = '5000';

const { composeLinScript, buildSystemPrompt, buildUserPrompt } = await import('../src/lin-composer.mjs');
const { lintScript } = await import('../src/style-linter.mjs');
const { createCalibrationEvent, enrichCalibrationEvents, effectForRule, confidenceForRule, extractPreferenceCandidates, buildFeedbackFlywheel, syncFeedbackFlywheel } = await import('../src/feedback-flywheel.mjs');
const { ContentOSAdapter } = await import('../src/content-os-adapter.mjs');
const { scriptGate } = await import('../src/gates.mjs');

const topic = index => ({
  topic_id: `topic_${index}`,
  title: `球馆利润为什么总留不下来 ${index}`,
  customer_problem: '球馆有流水，但成本、低峰空置和收入结构让利润没有留下。',
  topic_domain: '老馆运营 / 利润',
  problem_space: '利润',
  audience: '羽毛球馆老板'
});
const approvedRule = { rule_id: 'pref_paragraph_transition', instruction: '段落之间必须使用因果承接句，让前一句自然推到后一句。', status: 'active', scope: { domains: ['老馆运营 / 利润'], problem_spaces: ['利润'], topic_ids: [] } };
const positiveExample = { script_id: 'positive_001', review_id: 'review_positive', full_script: [good.hook, good.body].join('\n') };
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const passRate = rows => rows.filter(row => row.lint.passed).length / rows.length;

let ablation = null;
test('T1 规则消融提升平均分与通过率', async () => {
  const topics = [1, 2, 3, 4].map(topic);
  const off = await Promise.all(topics.map(item => composeLinScript(item, [], [], { maxRetries: 0, preferenceRules: [] })));
  const on = await Promise.all(topics.map(item => composeLinScript(item, [], [], { maxRetries: 0, preferenceRules: [approvedRule] })));
  const delta = mean(on.map(row => row.lint.score)) - mean(off.map(row => row.lint.score));
  assert.ok(delta >= 5, `规则启用后平均分应至少提升5分，实际 ${delta}`);
  assert.ok(passRate(on) > passRate(off), `规则启用后通过率应提升，off=${passRate(off)} on=${passRate(on)}`);
  ablation = { off, on, delta };
});

test('T2 无CTA资产不再存在74分天花板', () => {
  const withAsset = lintScript(sourceGood, pack, { hasCtaAsset: true });
  const withoutAsset = lintScript({ ...sourceGood, cta: '' }, pack, { hasCtaAsset: false });
  assert.equal(withAsset.score, 100);
  assert.equal(withAsset.passed, true);
  assert.ok(withoutAsset.score >= 82, `无CTA资产时应可达合格线，实际 ${withoutAsset.score}`);
  assert.equal(withoutAsset.passed, true);
  const gate = scriptGate({ topic: { ...topic('gate'), solution_points: ['拆收入', '拆成本'], cta_text: '' }, knowledge: [{}, {}], thesis: { id: 'BT-01' }, ctaAsset: null });
  assert.equal(gate.checks.find(check => check.gate === 'CTA Asset Gate').status, 'PASS');
  assert.equal(gate.blocked, false);
});

test('T3 已确认规则降低同类缺陷复现率并注入负样本', async () => {
  if (!ablation) throw new Error('T1 未完成');
  const abrupt = script => (script.body.match(/首先|其次|再次|总之/g) || []).length;
  const offDefects = ablation.off.reduce((sum, row) => sum + abrupt(row.script), 0);
  const onDefects = ablation.on.reduce((sum, row) => sum + abrupt(row.script), 0);
  assert.ok(onDefects < offDefects, `同类缺陷应下降，off=${offDefects} on=${onDefects}`);
  const prompt = buildUserPrompt(topic('negative'), [], [], { preferenceRules: [{ ...approvedRule, contrast_examples: [{ rejected_output: '首先做A，其次做B，总之要重视。', rejection_reason: '段落机械拼接', preferred_alternative: '用因果关系承接' }] }] });
  assert.match(prompt, /反例：/);
  assert.match(prompt, /被否原因：段落机械拼接/);
});

test('T4 规则效果归因、持久化与置信度反映真实结果', async () => {
  const base = { review_id: 'base', decision: '直接拍', created_at: '2026-01-01T00:00:00.000Z', topic_snapshot: { topic_domain: '利润' }, script_snapshot: { style_score: 60, active_preference_rule_ids: [] }, preference_candidates: [] };
  const accepted = { review_id: 'accept', decision: '直接拍', created_at: '2026-01-02T00:00:00.000Z', topic_snapshot: { topic_domain: '利润' }, script_snapshot: { style_score: 80, active_preference_rule_ids: ['pref_paragraph_transition'] }, preference_candidates: [] };
  const revised = { review_id: 'revise', decision: '修改后拍', created_at: '2026-01-03T00:00:00.000Z', topic_snapshot: { topic_domain: '利润' }, script_snapshot: { style_score: 70, active_preference_rule_ids: ['pref_paragraph_transition'] }, preference_candidates: [{ dimension: 'paragraph_transition' }] };
  const effect = effectForRule('pref_paragraph_transition', 'paragraph_transition', [base, accepted, revised]);
  assert.deepEqual(effect, { applied_count: 2, accepted_after: 1, revised_after: 1, rejected_after: 0, avg_score_delta: 15, recurrence_rate: 0.5 });
  const sources = [accepted, revised];
  const goodConfidence = confidenceForRule(sources, effect);
  const badConfidence = confidenceForRule(sources, { ...effect, accepted_after: 0, rejected_after: 2, avg_score_delta: -10 });
  assert.ok(goodConfidence.score > badConfidence.score, `效果更差的同来源规则置信度必须更低，good=${goodConfidence.score} bad=${badConfidence.score}`);
  const neutralEffect = { applied_count: 0, accepted_after: 0, revised_after: 0, rejected_after: 0, avg_score_delta: null, recurrence_rate: null };
  const recentAt = new Date().toISOString();
  const oneSource = [{ ...accepted, created_at: recentAt, topic_snapshot: { topic_domain: '利润' } }];
  const repeatedSources = [oneSource[0], { ...revised, created_at: recentAt, topic_snapshot: { topic_domain: '利润' } }, { ...base, created_at: recentAt, topic_snapshot: { topic_domain: '利润' } }];
  assert.ok(confidenceForRule(repeatedSources, neutralEffect).score > confidenceForRule(oneSource, neutralEffect).score, '来源数量与重复确认增加时置信度应提高');
  const mixedScopes = repeatedSources.map((event, index) => ({ ...event, topic_snapshot: { topic_domain: ['利润', '招生', '增长'][index] } }));
  assert.ok(confidenceForRule(repeatedSources, neutralEffect).score > confidenceForRule(mixedScopes, neutralEffect).score, '主题范围更一致时置信度应提高');
  const oldSource = [{ ...oneSource[0], created_at: '2020-01-01T00:00:00.000Z' }];
  assert.ok(confidenceForRule(oneSource, neutralEffect).score > confidenceForRule(oldSource, neutralEffect).score, '更新的反馈证据应获得更高时间权重');
  const positiveDelta = { ...effect, accepted_after: 1, revised_after: 1, rejected_after: 0, avg_score_delta: 10 };
  const negativeDelta = { ...positiveDelta, avg_score_delta: -10 };
  assert.ok(confidenceForRule(sources, positiveDelta).score > confidenceForRule(sources, negativeDelta).score, '平均分差为正时置信度应更高');
  const acceptedOutcome = { ...positiveDelta, accepted_after: 2, revised_after: 0, rejected_after: 0 };
  const rejectedOutcome = { ...positiveDelta, accepted_after: 0, revised_after: 0, rejected_after: 2 };
  assert.ok(confidenceForRule(sources, acceptedOutcome).score > confidenceForRule(sources, rejectedOutcome).score, '后续接受结果优于不拍时置信度应更高');
  const memory = {
    calibration_events: [base, accepted, revised],
    scripts: [], topics: [],
    preference_rules: [{ ...approvedRule, dimension: 'paragraph_transition', instruction: '用因果句承接', source_review_ids: ['revise'] }]
  };
  const store = {
    async read(name) { return structuredClone(memory[name] || []); },
    async write(name, value) { memory[name] = structuredClone(value); },
    async update(name, updater) { memory[name] = updater(structuredClone(memory[name] || [])); return memory[name]; }
  };
  await syncFeedbackFlywheel(store, { scripts: [], topics: [], extractor: event => [{ dimension: 'paragraph_transition', instruction: event.modification_suggestion || '用因果句承接' }] });
  const persisted = memory.preference_rules.find(rule => rule.rule_id === 'pref_paragraph_transition');
  assert.equal(persisted.effect.applied_count, 2);
  assert.equal(persisted.effect.avg_score_delta, 15);
  assert.ok(persisted.weight >= 0 && persisted.weight <= 1);
});

test('T5 生成留痕、统一评分与历史V1到V2配对可审计', async () => {
  const knowledge = [{ evidence_id: 'evidence_001', source_document: '只读知识样例', source_locator: 'document#chunk:1', statement: '利润判断要同时看收入结构与固定成本。' }];
  const result = await composeLinScript(topic('trace'), knowledge, [], { maxRetries: 0, preferenceRules: [approvedRule], positiveExamples: [positiveExample] });
  const systemPrompt = buildSystemPrompt(topic('trace'), { pack, fewshot, promptTpl });
  const userPrompt = buildUserPrompt(topic('trace'), knowledge, [], { preferenceRules: [approvedRule], positiveExamples: [positiveExample] });
  const expectedHash = crypto.createHash('sha256').update(JSON.stringify([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }])).digest('hex');
  assert.deepEqual(result.trace.active_preference_rule_ids, [approvedRule.rule_id]);
  assert.deepEqual(result.trace.positive_example_ids, [positiveExample.script_id]);
  assert.equal(result.trace.retrieved_knowledge_ids[0].source_locator, 'document#chunk:1');
  assert.equal(result.trace.prompt_hash, expectedHash);
  assert.equal(result.trace.style_pack_version, pack.version);
  assert.equal(result.lint.score, result.attempts[0].score, '重试评分与最终返回评分必须同口径');

  const v1 = { script_id: 'v1', revision_group_id: 'group', version: 1, full_script: '真实V1', topic_id: 'topic_pair' };
  const v2 = { script_id: 'v2', revision_group_id: 'group', parent_script_id: 'v1', version: 2, full_script: '真实V2', topic_id: 'topic_pair' };
  const review = { review_id: 'review_pair', script_id: 'v1', topic_id: 'topic_pair', decision: '修改后拍', problem_description: '逻辑断裂', modification_suggestion: '补充因果承接', created_at: '2026-01-01T00:00:00.000Z' };
  const event = createCalibrationEvent(review, v1, { topic_id: 'topic_pair', topic_domain: '利润' });
  const enriched = enrichCalibrationEvents([event], [v1, v2], [{ topic_id: 'topic_pair', topic_domain: '利润' }]);
  assert.equal(enriched[0].revision_outcome.script_id, 'v2');
  assert.equal(enriched[0].script_snapshot.full_script, '真实V1');
});

test('C04 重试沿最终落库口径改善', async () => {
  const result = await composeLinScript({ ...topic('retry'), title: '重试口径测试：球馆利润为什么留不下来' }, [], [], { maxRetries: 1 });
  assert.equal(result.attempts.length, 2);
  assert.ok(result.attempts[1].score >= result.attempts[0].score);
  assert.equal(result.lint.score, result.attempts[1].score);
});

test('C08 不拍事件保留完整对比样本', () => {
  const event = createCalibrationEvent({ review_id: 'reject', decision: '不拍', overall_problem_summary: '方向错误', modification_suggestion: '改为讨论利润结构' }, { script_id: 'reject_script', full_script: '被否全文' }, topic('reject'));
  assert.equal(event.rejected_output, '被否全文');
  assert.equal(event.rejection_reason, '方向错误');
  assert.equal(event.preferred_alternative, '改为讨论利润结构');
});

test('C09 语义候选随反馈变化且离线兜底可用', async () => {
  const one = { review_id: 'one', decision: '修改后拍', problem_description: '段落切换太突然', modification_suggestion: '用因果句承接', topic_snapshot: { topic_domain: '利润' } };
  const two = { review_id: 'two', decision: '修改后拍', problem_description: '开头太泛', modification_suggestion: '直接说老板损失', topic_snapshot: { topic_domain: '利润' } };
  const extractor = event => [{ dimension: event.review_id === 'one' ? 'paragraph_transition' : 'hook_precision', instruction: `用户原意：${event.modification_suggestion}` }];
  const a = await extractPreferenceCandidates(one, { extractor });
  const b = await extractPreferenceCandidates(two, { extractor });
  assert.notEqual(a[0].instruction, b[0].instruction);
  const fallback = await extractPreferenceCandidates(one, { extractor: () => [] });
  assert.equal(fallback[0].extraction_mode, 'regex_fallback');
});

test('C12 空风格分不再被当作0计入均值', () => {
  const event = { decision: '修改后拍', script_snapshot: { full_script: '稿件', style_score: null }, preference_candidates: [] };
  assert.equal(buildFeedbackFlywheel([event], []).metrics.average_style_by_decision['修改后拍'], null);
});

test('C11 检索状态与静态词法实现一致', async () => {
  const adapter = new ContentOSAdapter(contentRoot, configDir);
  await adapter.init();
  assert.match(adapter.status().database, /static probe lexical retrieval/);
  assert.doesNotMatch(adapter.status().database, /pgvector/i);
});

test('T6 冷启动与多轮偏好存在显著质量差', () => {
  if (!ablation) throw new Error('T1 未完成');
  assert.ok(ablation.delta >= 5);
  assert.ok(passRate(ablation.on) > passRate(ablation.off));
});
