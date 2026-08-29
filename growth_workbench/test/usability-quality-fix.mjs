import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ContentOSAdapter } from '../src/content-os-adapter.mjs';
import { buildUserPrompt, composeLinScript } from '../src/lin-composer.mjs';
import { generateTopicCuts, generateTopicCutsWithLlm } from '../src/topic-generator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workbench = path.resolve(here, '..');
const contentRoot = path.resolve(process.env.CONTENT_OS_ROOT || path.resolve(workbench, '..'));

test('Q01 握拍主题不再回落成球馆利润', () => {
  const cuts = generateTopicCuts('羽毛球握拍：食指和拇指负责控制，后三指负责稳定和发力');
  assert.equal(cuts.length, 4);
  assert.equal(new Set(cuts.map(item => item.title)).size, 4);
  assert.ok(cuts.every(item => item.problem_space === '教学技术'));
  assert.ok(cuts.every(item => !/爆满|订场收入|球馆利润|6片场地/.test(item.title)));
});

test('Q02 LLM选题规划保留原主题并形成四个独立切口', async () => {
  const mock = {
    theme_summary: '羽毛球握拍的手指分工',
    cuts: [
      { title: '握拍为什么要分成两部分？', customer_problem: '初学者不知道不同手指各自负责什么。', hook: '握拍不是整只手一起用力。', argument_angle: '从手指分工切入。', content_structure: '误区→分工→配合→练习', solution_points: ['解释食指拇指', '解释后三指', '讲清配合'], problem_space: '教学技术' },
      { title: '握得越紧，为什么越打不出力量？', customer_problem: '初学者全程握紧导致动作僵硬。', hook: '握拍越紧，不代表力量越大。', argument_angle: '从反常识结果切入。', content_structure: '结果→原因→松紧→验证', solution_points: ['指出僵硬问题', '讲松紧变化', '给自检方法'], problem_space: '教学技术' },
      { title: '教练讲握拍，学员为什么总做不到？', customer_problem: '教练只讲结果，没有拆动作。', hook: '学员不是学不会，是动作没有拆明白。', argument_angle: '从教学方法切入。', content_structure: '痛点→错误讲法→分步→纠错', solution_points: ['说明动作目的', '分步示范', '一次纠一个点'], problem_space: '教学技术' },
      { title: '握拍错了，会影响后面哪些动作？', customer_problem: '初学者没有意识到握拍会影响后续击球。', hook: '握拍一开始错了，后面每个动作都在补偿。', argument_angle: '从后续连锁影响切入。', content_structure: '错误→影响→修正→练习', solution_points: ['解释动作影响', '指出错误反馈', '安排修正练习'], problem_space: '教学技术' }
    ]
  };
  const cuts = await generateTopicCutsWithLlm('羽毛球握拍手要分成食指拇指和后三指两部分', { complete: async () => ({ content: JSON.stringify(mock) }) });
  assert.equal(cuts.length, 4);
  assert.equal(new Set(cuts.map(item => item.customer_problem)).size, 4);
  assert.ok(cuts.every(item => item.theme.includes('握拍')));
  assert.ok(cuts.every(item => item.problem_space === '教学技术'));
});

test('Q03 选题阶段禁止加入无来源百分比和顶级球员话术', async () => {
  const badCuts = Array.from({ length: 4 }, (_, index) => ({
    title: index === 0 ? '90%的人都握错了' : index === 1 ? '顶级球员都这样握拍' : `握拍切口${index + 1}`,
    customer_problem: `握拍问题${index + 1}`,
    hook: `握拍钩子${index + 1}`,
    argument_angle: `握拍角度${index + 1}`,
    content_structure: `结构${index + 1}→原因→方法`,
    solution_points: [`要点${index + 1}A`, `要点${index + 1}B`, `要点${index + 1}C`],
    problem_space: '教学技术'
  }));
  await assert.rejects(
    () => generateTopicCutsWithLlm('食指和拇指负责控制，后三指负责握住拍子', { maxRetries: 0, complete: async () => ({ content: JSON.stringify({ theme_summary: '握拍分工', cuts: badCuts }) }) }),
    /不存在的数字|夸张判断/
  );
});

test('Q04 不相关内部知识不再因单字重合被强行检索', async () => {
  const adapter = new ContentOSAdapter(contentRoot, path.join(workbench, 'config'));
  await adapter.init();
  const results = adapter.searchInternal('羽毛球握拍：食指拇指和后三指如何分工', 4);
  assert.equal(results.length, 0);
});

test('Q05 外部全文进入成稿提示词但保持External边界', () => {
  const content = '握拍手分成两部分：食指和拇指负责控制，后三指负责稳定。';
  const prompt = buildUserPrompt({ title: '握拍为什么要分成两部分？' }, [], [], {
    externalMaterial: { inspiration_id: 'insp_test', title: '握拍原文', url: 'https://example.com/grip', content }
  });
  assert.ok(prompt.includes(content));
  assert.ok(prompt.includes('External Inspiration'));
  assert.ok(prompt.includes('不是 verified_internal'));
});

test('Q06 残缺JSON连续失败后停止，不返回可落库脚本', async () => {
  const previous = {
    fetch: globalThis.fetch,
    base: process.env.LIN_LLM_BASE_URL,
    key: process.env.LIN_LLM_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    model: process.env.LIN_LLM_MODEL
  };
  process.env.LIN_LLM_BASE_URL = 'http://127.0.0.1:9/v1';
  process.env.LIN_LLM_API_KEY = 'test-only-key';
  process.env.OPENROUTER_API_KEY = 'your-key';
  process.env.LIN_LLM_MODEL = 'local-invalid-output';
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'invalid-output', model: 'local-invalid-output', provider: 'Local Test',
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0 },
    choices: [{ message: { content: '{"hook":"只有开头","body":"正文被截断"' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await composeLinScript({ title: '测试残缺输出', customer_problem: '测试模型输出不完整时不得落库。' }, [], [], { maxRetries: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error, /不完整|无法解析/);
    assert.equal(result.attempts.length, 2);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['LIN_LLM_BASE_URL', previous.base], ['LIN_LLM_API_KEY', previous.key], ['OPENROUTER_API_KEY', previous.openrouter], ['LIN_LLM_MODEL', previous.model]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Q07 外部素材稿出现无来源数字与经验背书时停止落库', async () => {
  const previous = {
    fetch: globalThis.fetch,
    base: process.env.LIN_LLM_BASE_URL,
    key: process.env.LIN_LLM_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    model: process.env.LIN_LLM_MODEL
  };
  process.env.LIN_LLM_BASE_URL = 'http://127.0.0.1:9/v1';
  process.env.LIN_LLM_API_KEY = 'test-only-key';
  process.env.OPENROUTER_API_KEY = 'your-key';
  process.env.LIN_LLM_MODEL = 'local-grounding-test';
  const invented = {
    hook: '为什么很多学员握拍一直做不对？',
    body: '原素材只讲了食指、拇指和后三指的分工，但模型自行补充了没有来源的经验。我们全国200多家球馆第一考就是握拍，十个有九个学员都在这里出错。第一，食指和拇指负责控制球拍。第二，后三指负责稳定。第三，击球时两部分配合发力。这段正文故意写长，用来确认结构完整也不能绕过素材忠实门禁。',
    cta: ''
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'grounding-output', model: 'local-grounding-test', provider: 'Local Test',
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0 },
    choices: [{ message: { content: JSON.stringify(invented) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await composeLinScript({ title: '握拍分工', customer_problem: '学员不知道不同手指负责什么。', problem_space: '教学技术' }, [], [], {
      maxRetries: 0,
      externalMaterial: { inspiration_id: 'insp_grounding', title: '握拍原文', content: '食指和拇指负责控制球拍，后三指负责稳定，并在击球时配合发力。' }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /素材中不存在|经验背书/);
    assert.ok(result.attempts[0].grounding_issues.length > 0);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['LIN_LLM_BASE_URL', previous.base], ['LIN_LLM_API_KEY', previous.key], ['OPENROUTER_API_KEY', previous.openrouter], ['LIN_LLM_MODEL', previous.model]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Q08 语义忠实审计拦截无数字但无来源的技术动作', async () => {
  const previous = {
    fetch: globalThis.fetch,
    base: process.env.LIN_LLM_BASE_URL,
    key: process.env.LIN_LLM_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    model: process.env.LIN_LLM_MODEL
  };
  process.env.LIN_LLM_BASE_URL = 'http://127.0.0.1:9/v1';
  process.env.LIN_LLM_API_KEY = 'test-only-key';
  process.env.OPENROUTER_API_KEY = 'your-key';
  process.env.LIN_LLM_MODEL = 'local-semantic-grounding-test';
  const invented = {
    hook: '为什么很多学员握拍一直做不对？',
    body: '原素材讲了食指、拇指和后三指的分工。第一，食指和拇指负责控制球拍。第二，后三指负责稳定。第三，模型又自行加入指尖发麻发白的自检方法，还让学员先放松手指再练习。这段正文故意保持结构完整，用来确认没有数字的技术扩写同样需要经过语义素材忠实审计，不能因为风格正确就直接保存。',
    cta: ''
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'semantic-grounding-output', model: 'local-semantic-grounding-test', provider: 'Local Test',
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0 },
    choices: [{ message: { content: JSON.stringify(invented) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await composeLinScript({ title: '握拍分工', customer_problem: '学员不知道不同手指负责什么。', problem_space: '教学技术' }, [], [], {
      maxRetries: 0,
      externalMaterial: { inspiration_id: 'insp_semantic', title: '握拍原文', content: '食指和拇指负责控制球拍，后三指负责稳定。' },
      groundingVerifier: async () => ({ passed: false, issues: ['指尖发麻发白的自检方法没有来源'] })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /指尖发麻发白/);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['LIN_LLM_BASE_URL', previous.base], ['LIN_LLM_API_KEY', previous.key], ['OPENROUTER_API_KEY', previous.openrouter], ['LIN_LLM_MODEL', previous.model]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Q09 用户本轮金标准与业务规则已固化', () => {
  const fewshot = JSON.parse(fs.readFileSync(path.join(workbench, 'config', 'lin-fewshot.json'), 'utf8'));
  const stylePack = JSON.parse(fs.readFileSync(path.join(workbench, 'config', 'lin-style-pack.json'), 'utf8'));
  const direct = fewshot.samples.find(item => item.id === 'LS-11');
  assert.equal(direct?.human_decision, '直接拍');
  assert.ok(direct.body.includes('“满”不是答案') || direct.hook.includes('“满”不是答案'));
  const packed = JSON.stringify(stylePack);
  assert.ok(packed.includes('除了课时费，再按照教练一星到五星的评级'));
  assert.ok(packed.includes('而是一套招生系统在运转'));
  assert.ok(packed.includes('最先准备的不是开业当天的活动'));
  assert.ok(packed.includes('再把接待、教学、成交和系统操作都熟练掌握'));
});
