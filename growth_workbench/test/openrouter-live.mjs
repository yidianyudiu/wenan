import { composeLinScript } from '../src/lin-composer.mjs';

const result = await composeLinScript({
  title: '球馆晚上爆满为什么月底还是没有利润？',
  customer_problem: '球馆高峰期很满，但收入结构单一，固定成本和低峰空置让利润没有留下。',
  problem_space: '利润',
  audience: '羽毛球馆老板、投资人和经营者',
  hook: '球馆晚上爆满为什么月底还是没有利润？',
  argument_angle: '从人多不等于利润高的反常识结果切入',
  content_structure: '经营结果→成本与低峰→收入结构→判断',
  solution_points: ['先拆固定成本', '再看低峰利用率', '最后看培训与复购收入']
}, [], [], { maxRetries: 2, temperature: 0.4 });

if (!result.ok) throw new Error(`OpenRouter live check failed: ${result.error}`);
if (!result.model) throw new Error('OpenRouter live check missing model metadata');
if (!result.script?.hook || !result.script?.body) throw new Error('OpenRouter live check missing generated script');
if (/(19|20)\d{2}\s*年|评论区|评论["'“”『「]|留言["'“”『「]|馆主|搜羽(?:现行|体育)?(?:的)?(?:岗位)?说明书/.test([result.script.hook, result.script.body, result.script.cta].join('\n'))) {
  throw new Error('OpenRouter live check hit a hard style block');
}

console.log(JSON.stringify({
  status: 'PASS',
  provider: result.provider,
  model: result.model,
  style_score: result.lint.score,
  style_passed: result.lint.passed,
  attempts: result.attempts.length,
  usage: result.usage,
  sensitive_knowledge_redacted: result.sensitiveKnowledgeRedacted,
  script_content_logged: false
}, null, 2));
