import crypto from 'node:crypto';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

const PROFILES = [
  { test: /盈利|利润|赚钱|收入|营收|收入结构/, problem: '利润', domain: '老馆运营 / 利润', thesis: 'BT-01' },
  { test: /获客|招生|流量|客户/, problem: '获客', domain: '老馆运营 / 获客', thesis: 'BT-05' },
  { test: /成交|报名|体验课|转化/, problem: '成交', domain: '教学培训 / 成交', thesis: 'BT-02' },
  { test: /续费|留存/, problem: '续费', domain: '教学培训 / 续费', thesis: 'BT-02' },
  { test: /团队|馆长|教练|员工|薪酬/, problem: '团队', domain: '团队 / 组织', thesis: 'BT-03' },
  { test: /新馆|开业|选址|预售/, problem: '新馆', domain: '新馆经营 / 开业', thesis: 'BT-04' },
  { test: /竞争|低价|同质化/, problem: '竞争', domain: '老馆运营 / 竞争', thesis: 'BT-05' }
];

function profileFor(theme) {
  return PROFILES.find(item => item.test.test(theme)) || PROFILES[0];
}

function profitCuts(theme) {
  return [
    {
      title: '晚上爆满为什么还是不赚钱？',
      customer_problem: `围绕“${theme}”，场地高峰期很满，但固定成本、低峰空置和收入结构让利润没有留下。`,
      hook: '晚上场场爆满，月底一算账却没赚到钱，问题到底出在哪？',
      argument_angle: '从“人多不等于利润高”的结果悖论切入。',
      content_structure: '反常识结果 → 成本拆解 → 低峰利用 → 利润结论',
      solution_points: ['区分高峰爆满和全天场地利用率', '拆清固定成本与边际收入', '检查低峰时段是否持续空置', '回到整月利润而不是单晚流水']
    },
    {
      title: '为什么订场收入越高反而越危险？',
      customer_problem: `围绕“${theme}”，收入过度依赖订场，客单、复购和抗波动能力不足。`,
      hook: '如果一家球馆八成收入都靠订场，这可能不是优势，而是风险。',
      argument_angle: '从单一收入依赖带来的经营风险切入。',
      content_structure: '风险警报 → 收入集中度 → 波动场景 → 安全结构',
      solution_points: ['计算订场收入占比', '识别天气、淡旺季和价格竞争风险', '检查培训与会员复购承接', '建立更稳定的多层收入结构']
    },
    {
      title: '球馆利润到底应该从哪里来？',
      customer_problem: `围绕“${theme}”，老板只盯场租流水，没有看清不同业务各自承担的利润角色。`,
      hook: '球馆真正的利润，通常不是只靠多卖两个小时场地。',
      argument_angle: '从收入树和业务角色切入利润来源。',
      content_structure: '核心判断 → 收入分层 → 业务协同 → 利润路径',
      solution_points: ['区分引流业务、复购业务和利润业务', '看订场、培训、赛事与零售如何承接', '核算各业务的毛利和复购周期', '让每层收入服务同一个经营结果']
    },
    {
      title: '一个6片场地的球馆，收入结构应该怎么看？',
      customer_problem: `围绕“${theme}”，缺少按场地数、时段、业务类型拆解的单馆经营测算。`,
      hook: '同样是6片场地，为什么有的馆能赚钱，有的馆一直在填坑？',
      argument_angle: '从一个6片场地的微型经营模型切入。',
      content_structure: '场景设定 → 时段测算 → 业务叠加 → 结构诊断',
      solution_points: ['先算可售场地小时和真实利用率', '再拆高峰与低峰的单位产出', '叠加培训、会员和活动收入', '用收入结构反推人员与成本配置']
    }
  ];
}

function genericCuts(theme, profile) {
  const problem = profile.problem;
  return [
    {
      title: `${theme}做了很多，为什么经营结果还是没出来？`,
      customer_problem: `围绕“${theme}”，球馆投入了动作，但${problem}结果没有发生。`,
      hook: `${theme}不是做得越多越好，先看它有没有接到最后的${problem}结果。`,
      argument_angle: '从投入很多但结果没有发生的反常识切入。',
      content_structure: '结果反差 → 关键断点 → 原因拆解 → 行动结论',
      solution_points: ['先定义真正要发生的经营结果', '检查客户旅程中的关键断点', '区分表面动作和有效动作', '把负责人、指标和复盘节奏拆清楚']
    },
    {
      title: `${theme}最容易被忽略的风险是什么？`,
      customer_problem: `围绕“${theme}”，短期数据看起来正常，但${problem}链路存在被忽略的风险。`,
      hook: `${theme}最危险的，不一定是没效果，而是你以为有效。`,
      argument_angle: '从隐藏风险和错误指标切入。',
      content_structure: '风险预警 → 错误指标 → 真实损失 → 防错动作',
      solution_points: ['识别容易制造假象的表面指标', '定位对经营结果影响最大的风险点', '验证风险发生时谁来承接', '建立可持续复盘的防错机制']
    },
    {
      title: `${theme}真正应该抓住的核心杠杆是什么？`,
      customer_problem: `围绕“${theme}”，资源平均分配，没有集中解决决定${problem}结果的核心环节。`,
      hook: `${theme}不是每个环节都平均用力，真正决定结果的往往只有一两个杠杆。`,
      argument_angle: '从关键杠杆和资源配置切入。',
      content_structure: '核心判断 → 杠杆识别 → 资源取舍 → 执行顺序',
      solution_points: ['先找出决定结果的核心变量', '停止不能形成承接的低效动作', '把资源集中到关键节点', '用结果指标验证杠杆是否有效']
    },
    {
      title: `一家普通球馆，应该怎么判断${theme}做对了没有？`,
      customer_problem: `围绕“${theme}”，缺少可观察、可计算、可复盘的${problem}判断标准。`,
      hook: `别先问${theme}有没有标准答案，先看一家普通球馆该怎么算这笔账。`,
      argument_angle: '从单馆经营算账和验证标准切入。',
      content_structure: '单馆场景 → 指标拆解 → 阈值判断 → 复盘清单',
      solution_points: ['确定单馆当前阶段和约束', '选择能反映结果的核心指标', '拆出过程指标与责任人', '按固定周期复盘并调整']
    }
  ];
}

export function generateTopicCuts(rawTheme) {
  const theme = clean(rawTheme);
  if (!theme) throw new Error('请输入一个主题');
  if (theme.length > 60) throw new Error('主题请控制在60个字以内');
  const profile = profileFor(theme);
  const themeId = `theme_${crypto.randomUUID()}`;
  const source = profile.problem === '利润' ? profitCuts(theme) : genericCuts(theme, profile);
  return source.map((cut, index) => ({
    ...cut,
    theme_id: themeId,
    theme,
    cut_index: index + 1,
    topic_domain: profile.domain,
    brand_thesis_id: profile.thesis,
    recommendation_reason: `同一主题“${theme}”的第${index + 1}个独立切口：Customer Problem、Hook、论证角度和内容结构均单独设计。`,
    knowledge_coverage: '生成脚本时实时检索 Internal Intelligence',
    inspiration_source: 'Theme → Four Cuts',
    topic_score: 94 - index * 2,
    status: '推荐',
    problem_explanation: cut.customer_problem,
    conclusion: `判断“${theme}”有没有做对，最终要回到可验证的${profile.problem}结果，而不是停在动作本身。`
  }));
}

