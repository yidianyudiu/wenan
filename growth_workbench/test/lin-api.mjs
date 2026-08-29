import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildUserPrompt, redactSensitiveText } from '../src/lin-composer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workbench = path.resolve(here, '..');
const contentRoot = path.resolve(process.env.CONTENT_OS_ROOT || path.resolve(workbench, '..'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'growth-workbench-lin-api-'));
const fewshot = JSON.parse(await fs.readFile(path.join(workbench, 'config', 'lin-fewshot.json'), 'utf8'));
const firstDraft = fewshot.samples.find(item => item.id === 'LS-01');
const revisedDraft = fewshot.samples.find(item => item.id === 'LS-06');
const captured = [];

const listen = server => new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const readBody = async req => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const mock = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  const payload = await readBody(req);
  captured.push({ authorization: req.headers.authorization || '', payload });
  const userText = payload.messages?.filter(message => message.role === 'user').map(message => message.content).join('\n') || '';
  const sample = userText.includes('这是一次基于人工反馈的版本修改') ? revisedDraft : firstDraft;
  const content = userText.includes('硬门禁回退测试')
    ? JSON.stringify({ hook: '球馆爆满为什么还是不赚钱？', body: `评论区告诉我。${sample.body}`, cta: sample.cta })
    : JSON.stringify({ hook: sample.hook, body: sample.body, cta: sample.cta });
  const response = JSON.stringify({ id: `mock-${captured.length}`, model: 'mock/lin-v1', provider: 'Local Mock', usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, cost: 0 }, choices: [{ message: { role: 'assistant', content } }] });
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(response) });
  res.end(response);
});

const mockPort = await listen(mock);
const probe = http.createServer();
const appPort = await listen(probe);
await close(probe);
const base = `http://127.0.0.1:${appPort}`;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: workbench,
  env: {
    ...process.env,
    WORKBENCH_PORT: String(appPort),
    WORKBENCH_DATA_DIR: temp,
    CONTENT_OS_ROOT: contentRoot,
    OPEN_BROWSER: '0',
    LIN_LLM_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    LIN_LLM_MODEL: 'local-lin-test',
    LIN_LLM_API_KEY: 'test-only-key',
    OPENROUTER_API_KEY: 'your-key',
    LIN_LLM_TIMEOUT_MS: '5000',
    LIN_REDACT_SENSITIVE: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const request = async (pathname, options = {}) => {
  const response = await fetch(base + pathname, { headers: { 'content-type': 'application/json' }, ...options });
  return { status: response.status, data: await response.json() };
};
const send = (pathname, payload = {}) => request(pathname, { method: 'POST', body: JSON.stringify(payload) });
const checks = [];
const check = (name, condition, detail = '') => {
  if (!condition) throw new Error(`${name}失败${detail ? `：${detail}` : ''}`);
  checks.push(name);
};

try {
  for (let index = 0; index < 80; index += 1) {
    try { if ((await request('/api/health')).status === 200) break; } catch { /* 等待服务启动 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
    if (index === 79) throw new Error('服务未启动');
  }

  const health = await request('/api/health');
  check('本地兼容模型已配置', health.status === 200 && health.data.lin_style.configured && health.data.lin_style.apiKeySet);
  check('健康信息不暴露密钥', !JSON.stringify(health.data).includes('test-only-key'));

  const redacted = redactSensitiveText('内部方案成本100万元，转化率15%，预估三十万元。');
  check('金额比例默认脱敏', !redacted.includes('100万元') && !redacted.includes('15%') && !redacted.includes('三十万元') && redacted.includes('[金额已脱敏]'));
  const promptProbe = buildUserPrompt(
    { title: '球馆盈利', customer_problem: '球馆爆满却不赚钱', hook: '晚上爆满为什么还是不赚钱？', argument_angle: '收入结构', content_structure: '反常识→拆账→判断' },
    [{ title: '内部账目', statement: '成本100万元，利润率15%。' }],
    ['球馆收入结构表']
  );
  check('切口与脱敏进入提示词', promptProbe.includes('本切口 Hook 方向') && promptProbe.includes('本切口论证角度') && !promptProbe.includes('100万元') && !promptProbe.includes('15%'));

  const initial = await request('/api/bootstrap');
  const topic = initial.data.topics[0];
  const generated = await send(`/api/topics/${topic.topic_id}/generate`);
  check('API走林总风格引擎', generated.status === 201 && generated.data.generation_mode === 'lin' && generated.data.generation_context.llm_used === true);
  check('生成结果带风格质检', Number.isFinite(generated.data.style_score) && generated.data.style_pack_version === '1.0.0' && typeof generated.data.style_report === 'string');
  check('模型与用量元数据已留痕', generated.data.generation_context.llm_model === 'mock/lin-v1' && generated.data.generation_context.llm_provider === 'Local Mock' && generated.data.generation_context.llm_usage.total_tokens >= 300);
  check('成稿不含风格硬禁词', !/(19|20)\d{2}\s*年|评论区|评论["'“”『「]|留言["'“”『「]|馆主|搜羽(?:现行|体育)?(?:的)?(?:岗位)?说明书/.test(generated.data.full_script));
  check('CTA受真实资产白名单约束', generated.data.full_script.includes(topic.cta_asset.name));
  check('模型请求不含密钥正文', captured.length >= 1 && captured.every(item => !JSON.stringify(item.payload).includes('test-only-key')));
  check('认证只在请求头', captured[0].authorization === 'Bearer test-only-key');

  const sourceText = generated.data.full_script;
  const review = await send(`/api/scripts/${generated.data.script_id}/review`, {
    decision: '修改后拍',
    problem_description: '论证需要更贴近老板日常管理。',
    modification_suggestion: '改成岗位与结果责任的表达。'
  });
  const revised = await send(`/api/scripts/${generated.data.script_id}/revise`, { review_id: review.data.review_id });
  check('人工反馈触发模型生成V2', revised.status === 201 && revised.data.version === 2 && revised.data.generation_mode === 'lin' && revised.data.full_script !== sourceText);
  const snapshot = await request('/api/bootstrap');
  const sourceAfter = snapshot.data.scripts.find(item => item.script_id === generated.data.script_id);
  check('模型改稿仍保留V1原稿', sourceAfter.full_script === sourceText && snapshot.data.scripts.some(item => item.script_id === revised.data.script_id));
  check('改稿提示包含两字段而非整稿覆盖', captured.some(item => JSON.stringify(item.payload).includes('哪里有问题：论证需要更贴近老板日常管理。') && JSON.stringify(item.payload).includes('修改建议：改成岗位与结果责任的表达。')));

  const flywheel = await request('/api/calibration/flywheel');
  const candidate = flywheel.data.rules.find(rule => rule.status === 'pending');
  const rawEvents = JSON.parse(await fs.readFile(path.join(temp, 'calibration_events.json'), 'utf8'));
  const pairedEvent = rawEvents.find(event => event.review_id === review.data.review_id);
  check('反馈全量快照进入飞轮', review.data.feedback_flywheel_recorded === true && flywheel.data.metrics.total_feedback === 1 && pairedEvent.script_snapshot.full_script === sourceText);
  check('V1到V2形成训练对', flywheel.data.metrics.paired_revision_events === 1 && pairedEvent.revision_outcome.script_id === revised.data.script_id);
  check('偏好规则默认等待人工确认', candidate && flywheel.data.metrics.active_rules === 0);
  const approved = await send(`/api/calibration/rules/${encodeURIComponent(candidate.rule_id)}/action`, { action: 'approve' });
  check('人工确认后偏好才启用', approved.status === 200 && approved.data.rule.status === 'active' && approved.data.feedback_flywheel.metrics.active_rules === 1);

  const direct = await send(`/api/scripts/${revised.data.script_id}/review`, { decision: '直接拍' });
  check('直接拍自动沉淀正样本', direct.status === 201 && (await request('/api/calibration/flywheel')).data.metrics.positive_examples === 1);

  const learnedTopic = await send('/api/topics', {
    title: '球馆客户到店了为什么还是成交不了？',
    customer_problem: '客户已经到店体验，但最后没有完成报名成交。',
    topic_domain: '教学培训 / 成交',
    brand_thesis_id: 'BT-02',
    solution_points: ['看体验过程', '看结果解释', '看后续跟进'],
    status: '待评估'
  });
  const captureStart = captured.length;
  const learned = await send(`/api/topics/${learnedTopic.data.topic_id}/generate`);
  const learnedRequests = captured.slice(captureStart).map(item => JSON.stringify(item.payload)).join('\n');
  check('已确认偏好进入生成留痕', learned.status === 201 && learned.data.generation_context.active_preference_rule_ids.includes(candidate.rule_id) && learned.data.generation_context.prompt_hash?.length === 64);
  check('直接拍样稿与检索证据进入生成留痕', learned.data.generation_context.positive_example_ids.includes(revised.data.script_id) && learned.data.generation_context.retrieved_knowledge_ids.length > 0 && learned.data.generation_context.style_pack_version === '1.0.0');
  check('最终分数与重试选优口径一致', learned.data.style_score === Math.max(...learned.data.style_attempts.map(attempt => attempt.score)));

  const unsafeTopic = await send('/api/topics', {
    title: '硬门禁回退测试：球馆爆满为什么还是不赚钱？',
    customer_problem: '球馆晚上爆满但月底仍然没有利润。',
    topic_domain: '老馆运营 / 利润',
    brand_thesis_id: 'BT-01',
    solution_points: ['拆收入结构', '拆固定成本', '看低峰利用率'],
    status: '待评估'
  });
  const guarded = await send(`/api/topics/${unsafeTopic.data.topic_id}/generate`);
  const guardedBootstrap = await request('/api/bootstrap');
  check('模型硬禁词触发停止落库', guarded.status === 422 && guarded.data.error.includes('style_hard_block') && !guardedBootstrap.data.scripts.some(script => script.topic_id === unsafeTopic.data.topic_id));

  console.log(JSON.stringify({ status: 'PASS', target: 'LIN_STYLE_ENGINE_LOCAL_COMPAT_TEST', checks: checks.length, passed: checks }, null, 2));
} finally {
  child.kill('SIGTERM');
  await close(mock);
  await fs.rm(temp, { recursive: true, force: true });
}
