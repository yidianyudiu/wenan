import crypto from 'node:crypto';
import { chatWithMetadata, extractJson, llmConfigured } from './llm-client.mjs';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

const PROFILES = [
  { test: /握拍|步法|发力|击球|高远球|吊球|杀球|搓球|挑球|技术动作|教学技术/, problem: '教学技术', problemSpace: '教学技术', domain: '教学培训 / 技术', thesis: 'BT-02' },
  { test: /盈利|利润|赚钱|收入|营收|收入结构/, problem: '利润', problemSpace: '利润', domain: '老馆运营 / 利润', thesis: 'BT-01' },
  { test: /获客|招生|流量|客户/, problem: '获客', problemSpace: '获客', domain: '老馆运营 / 获客', thesis: 'BT-05' },
  { test: /成交|报名|体验课|转化/, problem: '成交', problemSpace: '成交', domain: '教学培训 / 成交', thesis: 'BT-02' },
  { test: /续费|留存/, problem: '续费', problemSpace: '留存 / 续费', domain: '教学培训 / 续费', thesis: 'BT-02' },
  { test: /团队|馆长|教练|员工|薪酬|提成/, problem: '团队', problemSpace: '团队', domain: '团队 / 组织', thesis: 'BT-03' },
  { test: /新馆|开业|选址|预售/, problem: '新馆', problemSpace: '新馆', domain: '新馆经营 / 开业', thesis: 'BT-04' },
  { test: /竞争|低价|同质化/, problem: '竞争', problemSpace: '竞争', domain: '老馆运营 / 竞争', thesis: 'BT-05' }
];

const PROFILE_BY_SPACE = new Map(PROFILES.map(item => [item.problemSpace, item]));
const ALLOWED_SPACES = [...PROFILE_BY_SPACE.keys()];

function profileFor(text) {
  return PROFILES.find(item => item.test.test(text)) || null;
}

function requireTheme(rawTheme) {
  const theme = clean(rawTheme);
  if (!theme) throw new Error('请输入一个主题或一段完整素材');
  if (theme.length > 3000) throw new Error('主题或素材请控制在3000字以内；更长内容请通过灵感收件箱上传');
  return theme;
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
      solution_points: ['计算订场收入占比', '识别淡旺季和价格竞争风险', '检查培训与会员复购承接', '建立更稳定的多层收入结构']
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

function teachingCuts(theme) {
  return [
    {
      title: `${theme.slice(0, 24)}，初学者最容易错在哪里？`,
      customer_problem: `学员刚开始学习“${theme}”时容易形成错误动作，后续越练越难改。`,
      hook: `${theme.slice(0, 22)}，一开始错了，后面练得越多反而越难改。`,
      argument_angle: '从初学者最常见的错误动作切入。',
      content_structure: '常见错误 → 错误后果 → 正确动作 → 自检方法',
      solution_points: ['指出最常见的错误动作', '解释错误为什么影响后续发力', '拆解正确动作的关键位置', '给出可以立即执行的自检方法']
    },
    {
      title: `${theme.slice(0, 24)}，为什么一定要拆开讲？`,
      customer_problem: `学员听过“${theme}”的完整动作说明，但没有理解不同手指或动作阶段各自负责什么。`,
      hook: `${theme.slice(0, 20)}不是一个动作，拆开以后你才真正学得会。`,
      argument_angle: '从动作分工和控制逻辑切入。',
      content_structure: '错误整体理解 → 动作分工 → 配合关系 → 练习重点',
      solution_points: ['把动作拆成两个以上职责部分', '说明每部分分别控制什么', '解释它们如何协同', '给出分步练习顺序']
    },
    {
      title: `${theme.slice(0, 24)}，手上越用力为什么越不对？`,
      customer_problem: `学员在“${theme}”中习惯全程握紧或僵硬发力，导致动作不灵活、击球质量下降。`,
      hook: `${theme.slice(0, 18)}，不是握得越紧越好，很多问题就出在手太死。`,
      argument_angle: '从“更用力反而更差”的反常识切入。',
      content_structure: '反常识结果 → 僵硬原因 → 松紧转换 → 练习反馈',
      solution_points: ['解释全程用力带来的限制', '区分准备阶段和击球阶段', '讲清松紧变化的时机', '给出判断是否做对的身体反馈']
    },
    {
      title: `教练讲${theme.slice(0, 20)}，为什么学员总是听懂了却做不到？`,
      customer_problem: `教练讲解“${theme}”时只说结果，没有把动作拆成学员能理解和执行的教学步骤。`,
      hook: `学员不是学不会${theme.slice(0, 16)}，很多时候是教练没有把动作讲明白。`,
      argument_angle: '从教学表达和纠错方法切入。',
      content_structure: '教学痛点 → 错误讲法 → 分步示范 → 纠错标准',
      solution_points: ['先让学员理解动作目的', '再拆成可以观察的动作步骤', '每次只纠正一个关键问题', '用结果反馈验证是否掌握']
    }
  ];
}

function genericCuts(theme, profile) {
  const problem = profile.problem;
  return [
    {
      title: `${theme.slice(0, 30)}做了很多，为什么结果还是没出来？`,
      customer_problem: `围绕“${theme}”，球馆投入了动作，但${problem}结果没有发生。`,
      hook: `${theme.slice(0, 26)}不是做得越多越好，先看它有没有接到最后的${problem}结果。`,
      argument_angle: '从投入很多但结果没有发生的反常识切入。',
      content_structure: '结果反差 → 关键断点 → 原因拆解 → 行动结论',
      solution_points: ['先定义真正要发生的经营结果', '检查客户旅程中的关键断点', '区分表面动作和有效动作', '把负责人、指标和复盘节奏拆清楚']
    },
    {
      title: `${theme.slice(0, 34)}最容易被忽略的风险是什么？`,
      customer_problem: `围绕“${theme}”，短期数据看起来正常，但${problem}链路存在被忽略的风险。`,
      hook: `${theme.slice(0, 28)}最危险的，不一定是没效果，而是你以为有效。`,
      argument_angle: '从隐藏风险和错误指标切入。',
      content_structure: '风险预警 → 错误指标 → 真实损失 → 防错动作',
      solution_points: ['识别容易制造假象的表面指标', '定位对经营结果影响最大的风险点', '验证风险发生时谁来承接', '建立可持续复盘的防错机制']
    },
    {
      title: `${theme.slice(0, 32)}真正应该抓住的核心是什么？`,
      customer_problem: `围绕“${theme}”，资源平均分配，没有集中解决决定${problem}结果的核心环节。`,
      hook: `${theme.slice(0, 26)}不是每个环节都平均用力，真正决定结果的往往只有一两个。`,
      argument_angle: '从关键变量和资源配置切入。',
      content_structure: '核心判断 → 变量识别 → 资源取舍 → 执行顺序',
      solution_points: ['先找出决定结果的核心变量', '停止不能形成承接的低效动作', '把资源集中到关键节点', '用结果指标验证是否有效']
    },
    {
      title: `一家普通球馆，应该怎么判断${theme.slice(0, 24)}做对了没有？`,
      customer_problem: `围绕“${theme}”，缺少可观察、可计算、可复盘的${problem}判断标准。`,
      hook: `别先问${theme.slice(0, 24)}有没有标准答案，先看一家普通球馆该怎么算这笔账。`,
      argument_angle: '从单馆经营算账和验证标准切入。',
      content_structure: '单馆场景 → 指标拆解 → 阈值判断 → 复盘清单',
      solution_points: ['确定单馆当前阶段和约束', '选择能反映结果的核心指标', '拆出过程指标与责任人', '按固定周期复盘并调整']
    }
  ];
}

function finalizeCuts(theme, source, options = {}) {
  const themeId = `theme_${crypto.randomUUID()}`;
  return source.map((cut, index) => {
    const inferred = PROFILE_BY_SPACE.get(clean(cut.problem_space)) || profileFor(`${cut.title} ${cut.customer_problem} ${theme}`) || options.profile;
    if (!inferred) throw new Error('暂时无法判断这个主题对应的用户问题，请把主题写成一个具体问题，或补充完整素材');
    return {
      ...cut,
      theme_id: themeId,
      theme: clean(options.themeSummary || theme).slice(0, 100),
      theme_source_excerpt: theme.slice(0, 1000),
      cut_index: index + 1,
      problem_space: inferred.problemSpace,
      topic_domain: inferred.domain,
      brand_thesis_id: inferred.thesis,
      recommendation_reason: `同一主题的第${index + 1}个独立切口：Customer Problem、Hook、论证角度和内容结构均单独设计。`,
      knowledge_coverage: '生成脚本时实时检索 Internal Intelligence；无相关证据时明确显示未命中',
      inspiration_source: options.source || 'Theme → Four Cuts',
      topic_score: 94 - index * 2,
      status: '推荐',
      problem_explanation: cut.customer_problem,
      conclusion: clean(cut.conclusion || `判断这件事有没有做对，最终要回到可验证的${inferred.problem}结果。`)
    };
  });
}

function validateDistinctCuts(cuts) {
  if (!Array.isArray(cuts) || cuts.length !== 4) throw new Error('模型没有返回完整的4个选题切口');
  const fields = ['title', 'customer_problem', 'hook', 'argument_angle', 'content_structure'];
  for (const field of fields) {
    const values = cuts.map(item => clean(item?.[field]));
    if (values.some(value => !value) || new Set(values).size !== 4) throw new Error(`4个切口的${field}不完整或重复`);
  }
  for (const cut of cuts) {
    if (!Array.isArray(cut.solution_points) || cut.solution_points.filter(Boolean).length < 3) throw new Error('每个切口至少需要3个独立论证要点');
  }
}

function validateGroundedCuts(theme, cuts) {
  const source = clean(theme);
  const combined = cuts.map(cut => [cut.title, cut.customer_problem, cut.hook, cut.argument_angle, ...(cut.solution_points || [])].join(' ')).join('\n');
  const riskyPatterns = [
    /\d+(?:\.\d+)?\s*(?:%|％|成|家|年|次|天|小时|分钟|人)/g,
    /十个有九个|绝大多数|人人都|顶级|顶尖|高手|新手|打了几年|打了很久|天生没劲|手掌紧绷|手腕僵硬|对手节奏|被动跑位|发力瓶颈|悄悄偷走|秒懂|一定会|立刻就能/g
  ];
  const issues = [];
  for (const pattern of riskyPatterns) {
    for (const match of combined.match(pattern) || []) if (!source.includes(match)) issues.push(match);
  }
  if (issues.length) throw new Error(`选题加入了原主题中不存在的数字或夸张判断：${[...new Set(issues)].join('、')}`);
}

export function generateTopicCuts(rawTheme) {
  const theme = requireTheme(rawTheme);
  const profile = profileFor(theme);
  if (!profile) throw new Error('模板模式无法准确识别这个主题，请启用大模型生成，或把主题写成具体的经营/教学问题');
  const source = profile.problem === '利润' ? profitCuts(theme) : profile.problem === '教学技术' ? teachingCuts(theme) : genericCuts(theme, profile);
  return finalizeCuts(theme, source, { profile, source: 'Theme → Four Cuts (explicit template mode)' });
}

export async function generateTopicCutsWithLlm(rawTheme, opts = {}) {
  const theme = requireTheme(rawTheme);
  if (!opts.complete && !llmConfigured()) throw new Error('大模型未配置，不能准确生成选题切口');
  const prompt = [
    '把用户给出的一个主题或一段素材，规划成4个真正不同但围绕同一母主题的内容切口。',
    '先忠实理解素材讲的是什么，禁止把无法识别的主题默认改成“球馆盈利”。',
    '4个切口必须分别拥有不同的Customer Problem、Hook、论证角度和内容结构，不能只是同义改写。',
    `problem_space只能从以下值选择：${ALLOWED_SPACES.join('、')}。`,
    '如果是握拍、步法、发力等技术素材，使用“教学技术”；如果是球馆经营问题，再选择相应经营空间。',
    '不要编造素材里没有出现的数字、案例、制度或结果。',
    '输出JSON：{"theme_summary":"20到40字母主题","cuts":[{"title":"","customer_problem":"","hook":"","argument_angle":"","content_structure":"","solution_points":["","",""] ,"problem_space":""}]}',
    `用户主题/素材：${theme}`
  ].join('\n');
  const complete = opts.complete || (async messages => chatWithMetadata(messages, { temperature: 0.45, responseFormat: 'json_object' }));
  const messages = [
    { role: 'system', content: '你是屿洁内容选题规划器，只做忠实理解和四切口规划，不写完整稿。' },
    { role: 'user', content: prompt }
  ];
  const maxRetries = opts.maxRetries ?? 2;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      response = await complete(messages);
    } catch (error) {
      throw new Error(`选题模型调用失败：${String(error.message || error).slice(0, 260)}`);
    }
    const raw = typeof response === 'string' ? response : response?.content;
    const parsed = extractJson(raw);
    const cuts = parsed?.cuts;
    try {
      validateDistinctCuts(cuts);
      validateGroundedCuts(theme, cuts);
      return finalizeCuts(theme, cuts.map(cut => ({ ...cut, solution_points: cut.solution_points.filter(Boolean).slice(0, 5) })), {
        themeSummary: parsed.theme_summary,
        profile: profileFor(`${parsed.theme_summary || ''} ${theme}`),
        source: 'Theme → Four Cuts (LLM grounded)'
      });
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        messages.push({ role: 'assistant', content: raw || '' });
        messages.push({ role: 'user', content: `${error.message}。请删除无来源数字、顶级/高手/绝大多数等夸张判断，仍围绕原素材生成4个不同切口，重新输出完整JSON。` });
      }
    }
  }
  throw lastError || new Error('选题模型没有返回可用的四切口结果');
}
