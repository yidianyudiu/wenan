import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const workbench = path.resolve(here, '..');
const contentRoot = path.resolve(process.env.CONTENT_OS_ROOT || path.resolve(workbench, '..'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'growth-workbench-usability-'));

const listen = server => new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const sha256 = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const coreSnapshot = path.join(contentRoot, 'outputs', 'content_os_v1_phase4', 'phase4_probe.json');
const coreHashBefore = await sha256(coreSnapshot);

const fixture = http.createServer((req, res) => {
  if (req.url === '/article') {
    const article = `<!doctype html><html><head><title>球馆利润不是流水</title><meta name="description" content="拆解球馆收入和利润的差别"><script type="application/ld+json">${JSON.stringify({
      '@type': 'Article',
      headline: '球馆利润不是流水',
      author: { name: '公开作者' },
      datePublished: '2026-08-18',
      articleBody: '很多球馆晚上看起来爆满，但月底仍然没有利润。原因不是客人不够多，而是只看订场流水，没有拆固定成本、低峰空置、培训收入和会员复购。真正要判断一家球馆赚不赚钱，必须把场地利用率、不同业务毛利、人员成本和持续复购放在一张经营表里一起看。',
      interactionStatistic: { interactionType: { name: '点赞' }, userInteractionCount: 321 },
      comment: [{ text: '收入结构确实比单晚流水重要。' }]
    })}</script></head><body><article><h1>球馆利润不是流水</h1><p>普通公开网页正文。</p></article></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(article);
  }
  if (req.url === '/blocked') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<html><head><title>登录</title></head><body>请登录后继续访问，安全验证</body></html>');
  }
  res.writeHead(404).end();
});
const fixturePort = await listen(fixture);

const appProbe = http.createServer();
const appPort = await listen(appProbe);
await close(appProbe);
const base = `http://127.0.0.1:${appPort}`;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: workbench,
  env: { ...process.env, WORKBENCH_PORT: String(appPort), WORKBENCH_DATA_DIR: temp, CONTENT_OS_ROOT: contentRoot, OPEN_BROWSER: '0', ALLOW_PRIVATE_URLS: '1', OPENROUTER_API_KEY: 'your-key', LIN_LLM_API_KEY: 'your-key' },
  stdio: ['ignore', 'pipe', 'pipe']
});

const request = async (pathname, options = {}) => {
  const response = await fetch(base + pathname, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  return { status: response.status, data };
};
const send = (pathname, payload) => request(pathname, { method: 'POST', body: JSON.stringify(payload || {}) });
const checks = [];
const check = (name, condition, detail = '') => {
  if (!condition) throw new Error(`${name}失败${detail ? `：${detail}` : ''}`);
  checks.push(name);
};

try {
  for (let index = 0; index < 80; index += 1) {
    try { if ((await request('/api/health')).status === 200) break; } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
    if (index === 79) throw new Error('服务未启动');
  }

  const initial = await request('/api/bootstrap');
  check('启动与V0.5锁定', initial.status === 200 && initial.data.system.content_skill === '0.5.0 locked');

  const topicBefore = initial.data.dashboard.recommended.map(topic => `${topic.topic_id}:${topic.status}`);
  const afterViewOnly = await request('/api/bootstrap');
  const topicAfter = afterViewOnly.data.dashboard.recommended.map(topic => `${topic.topic_id}:${topic.status}`);
  check('推荐选题查看返回不变', JSON.stringify(topicBefore) === JSON.stringify(topicAfter));

  const firstTopic = initial.data.topics[0];
  const unavailable = await send(`/api/topics/${firstTopic.topic_id}/generate`);
  check('模型不可用时停止落库', unavailable.status === 422 && unavailable.data.error.includes('大模型'));
  const generated = await send(`/api/topics/${firstTopic.topic_id}/generate?mode=template`);
  check('明确模板模式生成单稿', generated.status === 201 && generated.data.version === 1);
  check('模板模式明确留痕并评分', generated.data.generation_mode === 'template' && Number.isFinite(generated.data.style_score) && generated.data.lin_fallback_reason === 'template_mode_selected');
  const originalText = generated.data.full_script;
  const modificationSuggestion = '段落之间增加自然衔接，整体表达更口语化。';
  const review = await send(`/api/scripts/${generated.data.script_id}/review`, { decision: '修改后拍', problem_description: '段落过渡生硬，语言偏机械。', modification_suggestion: modificationSuggestion });
  const afterReview = await request('/api/bootstrap');
  const untouched = afterReview.data.scripts.find(script => script.script_id === generated.data.script_id);
  check('保存反馈不覆盖原稿', review.status === 201 && untouched.full_script === originalText && untouched.version === 1 && untouched.full_script !== modificationSuggestion);

  const revised = await send(`/api/scripts/${generated.data.script_id}/revise`, { review_id: review.data.review_id, mode: 'template' });
  check('按建议生成V2', revised.status === 201 && revised.data.version === 2 && revised.data.full_script !== originalText && revised.data.parent_script_id === generated.data.script_id);
  check('V2同样完成风格质检', Number.isFinite(revised.data.style_score) && typeof revised.data.style_report === 'string');
  const afterRevision = await request('/api/bootstrap');
  const versionRows = afterRevision.data.scripts.filter(script => script.revision_group_id === generated.data.script_id).sort((a, b) => a.version - b.version);
  check('V1与V2分别保留', versionRows.length === 2 && versionRows[0].full_script === originalText && versionRows[1].script_id === revised.data.script_id);

  const restored = await send(`/api/scripts/${generated.data.script_id}/restore`);
  check('恢复旧版形成新版本', restored.status === 201 && restored.data.version === 3 && restored.data.full_script === originalText && restored.data.restored_from_script_id === generated.data.script_id);

  const secondTopic = initial.data.topics[1];
  const secondScript = await send(`/api/topics/${secondTopic.topic_id}/generate?mode=template`);
  const rejected = await send(`/api/scripts/${secondScript.data.script_id}/review`, { decision: '不拍', problem_description: '整体方向不成立。', modification_suggestion: '重新选择问题入口。', overall_problem_summary: '逻辑、结构和方向均不适合局部修改。' });
  check('不拍整体问题总结', rejected.status === 201 && rejected.data.overall_problem_summary.includes('方向'));

  const scriptsBeforeTheme = (await request('/api/bootstrap')).data.scripts.length;
  const cuts = await send('/api/themes/cuts', { theme: '球馆盈利', mode: 'template' });
  const four = cuts.data.topics;
  const unique = key => new Set(four.map(topic => topic[key])).size === 4;
  check('同主题四个不同切口', cuts.status === 201 && four.length === 4 && new Set(four.map(topic => topic.theme)).size === 1 && unique('customer_problem') && unique('hook') && unique('argument_angle') && unique('content_structure'));

  const selectedCut = await send(`/api/topics/${four[0].topic_id}/generate?mode=template`);
  const afterSelected = await request('/api/bootstrap');
  const newThemeScripts = afterSelected.data.scripts.filter(script => four.some(topic => topic.topic_id === script.topic_id));
  check('默认只生成所选一篇', selectedCut.status === 201 && afterSelected.data.scripts.length === scriptsBeforeTheme + 1 && newThemeScripts.length === 1 && newThemeScripts[0].topic_id === four[0].topic_id);

  const allDrafts = await send(`/api/themes/${cuts.data.theme_id}/generate-all`, { mode: 'template' });
  check('主动批量生成四篇', allDrafts.status === 201 && allDrafts.data.scripts.length === 4 && new Set(allDrafts.data.scripts.map(script => script.topic_id)).size === 4);

  const appSource = await (await fetch(`${base}/app.js`)).text();
  const indexSource = await (await fetch(`${base}/`)).text();
  check('首页四卡可点击路由', ['topics', 'reviews', 'to-shoot', 'inspiration'].every(route => appSource.includes(`data-route=\"${route}\"`)));
  check('Intelligence降为状态摘要', appSource.includes('system-summary') && !appSource.includes('class=\"boundary\"'));
  check('统一Content Studio入口', !indexSource.includes('data-view="studio"') && appSource.includes("studio: 'Content Studio'"));
  check('账号与内容数据移入设置', !indexSource.includes('data-view="creators"') && !indexSource.includes('data-view="performance"') && appSource.includes('同行账号基础配置') && appSource.includes('暂时支持人工录入'));
  check('人工审核字段已简化', appSource.includes('哪里有问题') && appSource.includes('修改建议') && appSource.includes('整体问题总结') && !appSource.includes('应该怎么表达'));
  check('Content Studio展示风格分', appSource.includes('风格匹配度') && appSource.includes('LIN STYLE QA'));
  check('设置页内置反馈数据飞轮', appSource.includes('你的反馈数据飞轮') && appSource.includes('确认启用') && appSource.includes('/api/calibration/rebuild'));
  check('灵感与Content Studio可以查看采集全文', appSource.includes('查看采集全文') && appSource.includes('查看本稿引用的采集全文'));

  const extracted = await send('/api/inspirations', { url: `http://127.0.0.1:${fixturePort}/article` });
  check('普通公开网页真实提取', extracted.status === 201 && extracted.data.extraction_status === 'content_extracted' && extracted.data.content.includes('固定成本') && extracted.data.author === '公开作者' && extracted.data.visible_comments.length === 1 && extracted.data.analysis_status === 'analyzed');

  const blocked = await send('/api/inspirations', { url: `http://127.0.0.1:${fixturePort}/blocked` });
  check('解析失败明确回退', blocked.status === 422 && blocked.data.error === '无法自动读取该链接内容' && blocked.data.reason && blocked.data.supplemental_options.includes('粘贴字幕'));

  const manual = await send('/api/inspirations', { url: `http://127.0.0.1:${fixturePort}/blocked`, content: '球馆客户来了却不成交，问题在体验课结束后没有把测评结果、课程方案和后续跟进连起来。只有把客户问题讲清楚，才能完成报名转化。' });
  check('失败链接补内容后再分析', manual.status === 201 && manual.data.extraction_warning && manual.data.analysis_status === 'analyzed');

  const derived = await send(`/api/inspirations/${extracted.data.inspiration_id}/create-topic?mode=template`);
  const coreHashAfter = await sha256(coreSnapshot);
  check('External Inspiration不写verified_internal', extracted.data.verified_internal_effect === 'none' && derived.status === 201 && coreHashBefore === coreHashAfter);

  console.log(JSON.stringify({ status: 'PASS', target: 'GROWTH_WORKBENCH_V0.1_USABILITY_FIX_01', checks: checks.length, passed: checks }, null, 2));
} finally {
  child.kill('SIGTERM');
  await close(fixture);
  await fs.rm(temp, { recursive: true, force: true });
}
