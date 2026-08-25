/**
 * 冒烟测试：不需要 API key 也能跑完前两项。
 * 用法：node test/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintScript, loadStylePack, formatReport } from '../src/style-linter.mjs';
import { pickFewshot, buildSystemPrompt, buildUserPrompt, scoreExistingScript, llmConfigured } from '../src/lin-composer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = path.resolve(__dirname, '../config');
const pack = loadStylePack(path.join(CFG, 'lin-style-pack.json'));
const fewshot = JSON.parse(readFileSync(path.join(CFG, 'lin-fewshot.json'), 'utf8'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

console.log('\n[1/4] 规则库与正样本自洽性');
const scores = fewshot.samples.map(s => lintScript({hook:s.hook, body:s.body, cta:s.cta}, pack).score);
const avg = scores.reduce((a,b)=>a+b,0)/scores.length;
console.log(`  正样本得分: ${scores.join(', ')}`);
ok(avg >= 85, `正样本均分 ${avg.toFixed(1)} ≥ 85（规则不能比林总本人还严）`);
ok(scores.filter(s=>s>=pack.scoring.pass_threshold).length >= 6, `至少6条正样本达到合格线 ${pack.scoring.pass_threshold}`);

console.log('\n[2/4] 判别力：被林总毙掉的稿子必须低分');
const bad = { hook:'球馆晚上爆满还不赚钱，问题可能就藏在"爆满"这两个字里。',
  body:`别急着怪房租，也别马上加价。先拆四张表。
第一张，收入：订场、培训和其他业务分别贡献什么；第二张，时间：高峰满了，低峰是不是长期空着；第三张，成本：人员、耗材、能耗和活动投入有没有单独记录；第四张，客户：新客来了以后，有没有持续回来。
这些是诊断问题，不是我在替你下结论。当前数据库没有足够的已验证盈利数字，我不会告诉你"行业利润率应该多少"。能确认的是，搜羽的馆长岗位说明书把客户关系、成本控制、后勤保障都列进职责。
满场是现象，盈利是系统。`,
  cta:'想拿"四张表"诊断模板，评论"盈利"。' };
const badR = lintScript(bad, pack);
ok(!badR.passed, `被毙稿判定为不通过（得分 ${badR.score}）`);
ok(badR.blocks.some(b=>b.id==='B01'), '正确识别「评论」平台违规');
ok(avg - badR.score >= 25, `正负样本分差 ${(avg-badR.score).toFixed(1)} ≥ 25（判别力足够）`);

console.log('\n[3/4] few-shot 选样与 prompt 渲染');
const topic = { title:'为什么体验课来了不少家长，最后就是成交不了', customer_problem:'体验课到店率不低但成交率低', problem_space:'成交', audience:'羽毛球馆老板' };
const picked = pickFewshot(topic, fewshot, 2);
ok(picked.length === 2, `选中 2 条 few-shot：${picked.map(p=>p.id).join(', ')}`);
const sys = buildSystemPrompt(topic, { pack, fewshot, promptTpl: readFileSync(path.join(CFG,'lin-style-prompt.md'),'utf8') });
ok(!/\{\{[A-Z_]+\}\}/.test(sys), '所有 {{占位符}} 已渲染，无残留');
ok(sys.includes('林屿洁'), 'system prompt 含身份设定');
ok(sys.includes('评论'), 'system prompt 含平台禁用词规则');
ok(sys.length > 3000, `system prompt 长度 ${sys.length} 字符`);
const usr = buildUserPrompt(topic, [{title:'体验课流程', content:'接待→测评→体验→反馈→方案→成交'}], ['《体验课转化流程表》']);
ok(usr.includes('《体验课转化流程表》'), 'user prompt 含 CTA 资产白名单');

console.log('\n[4/4] 环境与回落');
console.log(`  LLM 已配置: ${llmConfigured() ? '是' : '否（将回落到原模板路径）'}`);
ok(typeof scoreExistingScript === 'function', 'scoreExistingScript 可用（给旧模板产出打分）');
const s2 = scoreExistingScript({hook:'测试', body:'第一，测试。第二，测试。第三，测试。', cta:'需要的话我可以把方案给你参考。'});
ok(typeof s2.lint.score === 'number', '打分接口返回数值');

console.log(fail === 0 ? '\n✅ 全部通过\n' : `\n❌ ${fail} 项失败\n`);
process.exit(fail === 0 ? 0 : 1);


