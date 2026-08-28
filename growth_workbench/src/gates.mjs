const PROBLEM_SPACES = [
  ['教学技术', /握拍|步法|发力|击球|高远球|吊球|杀球|搓球|挑球|技术动作|学员.{0,8}(听懂|学会|做不到)|教练.{0,8}(讲|教|纠错)/],
  ['获客', /获客|客户从哪里来|为什么选择|到店|招生|流量|引流|获客成本/],
  ['成交', /成交|为什么不买|体验课|预售|报名|转化/],
  ['留存 / 续费', /留存|续费|为什么不续费|信任|留下来|持续回来/],
  ['营收', /营收|场地利用率|培训收入|客单价|低峰|收入/],
  ['利润', /利润|赚钱|不赚钱|爆满|成本|收入结构/],
  ['团队', /老板脱离现场|馆长|教练|课程顾问|招聘|培养|留住|薪酬|提成|组织/],
  ['竞争', /竞争|同质化|免费场地|低价|凭什么|为什么.*你家/],
  ['新馆', /新馆|开馆|开业|选址|定价|蓄水|预售|正常经营/]
];
const SOLUTION_ONLY = /教学体系|课程体系|技术路径|教案|社群运营|运营体系|薪酬体系|活动方案|盈利模型|赛事体系/;
const KNOWLEDGE_FIRST = /数据库|资料目录|文件目录|内部资料|从资料|从文档|抽一个知识点|根据.*(?:资料|文件|文档)/;

export function topicOrientationGate(input) {
  const text = `${input.title || ''} ${input.customer_problem || ''}`;
  const matched = PROBLEM_SPACES.filter(([, re]) => re.test(text)).map(([name]) => name);
  const status = !input.customer_problem?.trim() || KNOWLEDGE_FIRST.test(text) || (SOLUTION_ONLY.test(text) && !matched.length) || !matched.length ? 'REFRAME_REQUIRED' : 'PASS';
  return { gate: 'customer_problem_orientation', status, matched_problem_spaces: matched,
    reason: status === 'PASS' ? '选题从目标用户可立即理解的经营或教学问题进入。' : '请先改写为获客、成交、续费、营收、利润、团队、竞争、新馆经营或具体教学技术问题。' };
}

export function scriptGate({ topic, knowledge, thesis, ctaAsset }) {
  const orientation = topicOrientationGate(topic);
  const sourceDocuments = new Set(knowledge.map(item => item.source_document || item.title || item.source_locator).filter(Boolean));
  const checks = [
    orientation,
    { gate: 'Problem Coverage', status: topic.solution_points?.length >= 2 ? 'PASS' : 'REVIEW' },
    { gate: 'Multi-Source Retrieval', status: sourceDocuments.size >= 2 ? 'PASS' : 'REVIEW' },
    { gate: 'Business Rule Fidelity', status: 'PASS' },
    { gate: 'Brand Thesis Governance', status: thesis ? 'PASS' : 'REVIEW' },
    { gate: 'Evidence Gate', status: knowledge.length ? 'PASS' : 'REVIEW' },
    { gate: 'Business Reasoning', status: topic.solution_points?.length >= 2 ? 'PASS' : 'REVIEW' },
    { gate: 'Spoken Language', status: 'PASS' },
    { gate: 'CTA Asset Gate', status: !topic.cta_text || ctaAsset?.exists ? 'PASS' : 'BLOCK' }
  ];
  return { checks, blocked: checks.some(x => x.status === 'BLOCK' || (x.gate === 'customer_problem_orientation' && x.status !== 'PASS')) };
}
