const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const notice = document.querySelector('#notice');

let state = null;
let currentView = 'dashboard';
let returnView = 'dashboard';
let selectedTopic = null;
let selectedScript = null;
let activeThemeId = null;
let activeBatchThemeId = null;
let topicFilter = '全部';
let inspirationFailure = null;

const names = {
  dashboard: '今日作战台',
  topics: '选题池',
  'topic-detail': '选题详情',
  studio: 'Content Studio',
  reviews: '待审稿',
  inspiration: '灵感收件箱',
  'to-shoot': '待拍内容',
  knowledge: '资料库',
  settings: '设置与数据'
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '操作失败');
    error.payload = data;
    throw error;
  }
  return data;
}

function flash(message, error = false) {
  notice.textContent = message;
  notice.className = `notice${error ? ' error' : ''}`;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => notice.classList.add('hidden'), 4500);
}

function latestThemeId() {
  return state.topics.find(topic => topic.theme_id)?.theme_id || null;
}

async function refresh() {
  state = await api('/api/bootstrap');
  if (!activeThemeId) activeThemeId = latestThemeId();
  render();
}

const badge = status => `<span class="badge ${status === '推荐' || status === '待评估' ? 'orange' : ''}">${esc(status)}</span>`;

function setView(view) {
  currentView = view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  render();
}

function latestScriptForTopic(topicId) {
  const topic = state.topics.find(item => item.topic_id === topicId);
  return state.scripts.find(script => script.script_id === topic?.latest_script_id)
    || state.scripts.filter(script => script.topic_id === topicId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

function versionsFor(script) {
  if (!script) return [];
  const groupId = script.revision_group_id || script.script_id;
  return state.scripts
    .filter(item => (item.revision_group_id || item.script_id) === groupId)
    .sort((a, b) => Number(a.version || 1) - Number(b.version || 1));
}

function latestReviewFor(scriptId) {
  return state.reviews.filter(review => review.script_id === scriptId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

function topicCard(topic, { compact = false } = {}) {
  return `<article class="topic-card" data-topic-card="${topic.topic_id}">
    <div class="topic-top">${badge(topic.status)}<span class="score">${esc(topic.topic_score)}</span></div>
    ${topic.theme ? `<p class="theme-label">主题 · ${esc(topic.theme)}　切口 ${esc(topic.cut_index)}/4</p>` : ''}
    <h3>${esc(topic.title)}</h3>
    <p>${esc(topic.customer_problem)}</p>
    ${compact ? '' : `<div class="meta"><span>${esc(topic.topic_domain)}</span><span>${esc(topic.brand_thesis_id)}</span></div><p><b>论证角度：</b>${esc(topic.argument_angle || topic.recommendation_reason)}</p>`}
    <div class="card-actions">
      <button class="primary" data-open-topic="${topic.topic_id}">查看详情</button>
      <button class="secondary" data-topic-action="generate" data-id="${topic.topic_id}">生成文案</button>
    </div>
  </article>`;
}

function dashboard() {
  const counts = state.dashboard.counts;
  const themeTopics = activeThemeId ? state.topics.filter(topic => topic.theme_id === activeThemeId).sort((a, b) => Number(a.cut_index) - Number(b.cut_index)) : [];
  return `<section class="task-grid" aria-label="核心任务">
      <button class="task-card" data-route="topics" data-route-filter="推荐"><span>01</span><b>今日推荐</b><strong>${counts.recommended}</strong><small>进入推荐选题</small></button>
      <button class="task-card" data-route="reviews"><span>02</span><b>待审稿</b><strong>${counts.pending_review}</strong><small>进入待审核文案</small></button>
      <button class="task-card" data-route="to-shoot"><span>03</span><b>待拍内容</b><strong>${counts.to_shoot}</strong><small>查看已通过内容</small></button>
      <button class="task-card" data-route="inspiration"><span>04</span><b>灵感收件箱</b><strong>${counts.inspirations}</strong><small>读取与拆解外部内容</small></button>
    </section>

    <section class="panel theme-builder">
      <div><p class="eyebrow">ONE THEME · FOUR CUTS</p><h2>今天先定一个主题</h2><p>系统围绕同一主题生成4个不同 Customer Problem、Hook、论证角度与内容结构。</p></div>
      <form id="theme-form"><input name="theme" placeholder="例如：球馆盈利" maxlength="60" required><button class="primary">生成4个不同切口</button></form>
    </section>

    ${themeTopics.length ? `<section><div class="section-head"><div><p class="eyebrow">CURRENT THEME</p><h2>${esc(themeTopics[0].theme)} · 4个选题切口</h2></div><button class="secondary" data-generate-all="${activeThemeId}">查看4条完整成稿</button></div><div class="topic-grid">${themeTopics.map(topic => topicCard(topic)).join('')}</div></section>` : ''}

    <section><div class="section-head"><div><p class="eyebrow">TODAY</p><h2>今日推荐选题</h2></div><p>查看详情不会改变状态或排序</p></div><div class="topic-grid">${state.dashboard.recommended.map(topic => topicCard(topic, { compact: true })).join('') || '<div class="empty">当前没有推荐选题，可先生成一个主题的四个切口。</div>'}</div></section>

    <section class="system-summary"><div class="section-head"><h2>系统状态摘要</h2></div><div class="summary-row"><span>内部知识 <b>正常</b></span><span>外部情报 <b>暂未自动接入</b></span><span>表现数据 <b>当前手动录入</b></span></div></section>`;
}

function topics() {
  const statuses = ['全部', '推荐', '待评估', '已采用', '已生成脚本', '待拍', '已拍', '已发布', '淘汰', '不感兴趣'];
  const rows = topicFilter === '全部' ? state.topics : state.topics.filter(topic => topic.status === topicFilter);
  return `<div class="tabs-line" id="topic-filters">${statuses.map(status => `<button class="${topicFilter === status ? 'active' : ''}" data-filter="${status}">${status}</button>`).join('')}</div><div class="topic-grid">${rows.map(topic => topicCard(topic)).join('') || '<div class="empty">该状态暂无选题</div>'}</div>`;
}

function topicDetail() {
  const topic = state.topics.find(item => item.topic_id === selectedTopic);
  if (!topic) return '<div class="empty">选题不存在</div>';
  return `<button class="back-link" data-back>← 返回上一页</button>
    <article class="panel detail-panel">
      <div class="topic-top">${badge(topic.status)}<span class="score">${esc(topic.topic_score)}</span></div>
      ${topic.theme ? `<p class="theme-label">主题 · ${esc(topic.theme)}　切口 ${esc(topic.cut_index)}/4</p>` : ''}
      <h2>${esc(topic.title)}</h2>
      <div class="detail-grid">
        <div><span>Customer Problem</span><p>${esc(topic.customer_problem)}</p></div>
        <div><span>Hook</span><p>${esc(topic.hook || topic.title)}</p></div>
        <div><span>论证角度</span><p>${esc(topic.argument_angle || topic.recommendation_reason)}</p></div>
        <div><span>内容结构</span><p>${esc(topic.content_structure || '问题 → 原因 → 方案 → 结论')}</p></div>
      </div>
      <div class="explicit-actions">
        <button class="ghost" data-topic-action="adopt" data-id="${topic.topic_id}">采用</button>
        <button class="primary" data-topic-action="generate" data-id="${topic.topic_id}">生成文案</button>
        <button class="secondary" data-topic-action="to_shoot" data-id="${topic.topic_id}">加入待拍</button>
        <button class="danger" data-topic-action="eliminate" data-id="${topic.topic_id}">淘汰</button>
        <button class="ghost" data-topic-action="dislike" data-id="${topic.topic_id}">不感兴趣</button>
      </div>
      <p class="state-rule">只有执行以上明确动作才会改变选题状态；查看与返回不会写入任何状态。</p>
    </article>`;
}

function reviewSummary(review) {
  return `<div class="review-saved"><div class="topic-top"><b>反馈已保存</b>${badge(review.decision)}</div>
    ${review.problem_description ? `<p><span>哪里有问题</span>${esc(review.problem_description)}</p>` : ''}
    ${review.modification_suggestion ? `<p><span>修改建议</span>${esc(review.modification_suggestion)}</p>` : ''}
    ${review.overall_problem_summary ? `<p><span>整体问题总结</span>${esc(review.overall_problem_summary)}</p>` : ''}
    <small>已写入 Human Review / Calibration Data 和反馈飞轮；原稿正文未修改。</small>
    ${review.decision === '修改后拍' ? `<button class="primary" data-revise="${review.script_id}" data-review-id="${review.review_id}">按建议修改文案</button>` : ''}
  </div>`;
}

function styleScoreCard(script) {
  if (script.style_score == null) return '';
  const passed = Boolean(script.style_passed);
  const model = script.generation_context?.llm_model;
  const modeText = script.generation_mode === 'lin' ? `林总风格引擎生成${model ? ` · ${model}` : ''}` : '模板生成 · 未调用大模型';
  const fallback = script.lin_fallback_reason === 'llm_not_configured'
    ? '尚未配置 LIN_LLM_API_KEY，已安全回落到原模板。'
    : script.lin_fallback_reason?.startsWith('llm_failed:')
      ? '模型暂时不可用，已安全回落到原模板。'
      : '';
  return `<section class="style-score ${passed ? 'ok' : 'warn'}">
    <div class="style-score-head"><div><p class="eyebrow">LIN STYLE QA</p><strong>风格匹配度 ${esc(script.style_score)}/100</strong></div><span>${passed ? '✓ 达标' : '⚠ 需人工确认'}</span></div>
    <p>${esc(modeText)}${script.style_pack_version ? ` · Style Pack ${esc(script.style_pack_version)}` : ''}</p>
    ${fallback ? `<p class="style-fallback">${esc(fallback)}</p>` : ''}
    <details><summary>查看风格缺失项与质检报告</summary><pre>${esc(script.style_report || '暂无详细报告')}</pre></details>
  </section>`;
}

function scriptView(script) {
  const knowledge = script.internal_knowledge || [];
  const externalMaterial = script.external_inspiration_id ? state.inspirations.find(item => item.inspiration_id === script.external_inspiration_id) : null;
  const gates = script.gate_checks || [];
  const versions = versionsFor(script);
  const latest = versions[versions.length - 1];
  const currentIndex = versions.findIndex(item => item.script_id === script.script_id);
  const review = latestReviewFor(script.script_id);
  return `<div class="studio-toolbar">
      <div><p class="eyebrow">VERSION HISTORY</p><div class="version-tabs">${versions.map(item => `<button class="${item.script_id === script.script_id ? 'active' : ''}" data-version="${item.script_id}">V${esc(item.version)}</button>`).join('')}</div></div>
      <div class="version-nav">${currentIndex > 0 ? `<button class="ghost" data-version="${versions[currentIndex - 1].script_id}">查看上一版</button>` : ''}${script.script_id !== latest.script_id ? `<button class="secondary" data-version="${latest.script_id}">查看当前版</button><button class="ghost" data-restore="${script.script_id}">恢复此版本</button>` : ''}</div>
    </div>
    <div class="two-col studio-layout">
      <div class="script-card">
        <div class="topic-top">${badge(script.status)}<span>Version ${esc(script.version)}</span></div>
        <h2>${esc(script.title)}</h2>
        ${script.restored_from_script_id ? '<p class="version-note">这是从旧版本恢复生成的新版本，历史记录仍完整保留。</p>' : ''}
        ${script.recovered_by === 'reconstruction' || script.recovery_warning ? `<p class="version-note recovery-warning">⚠ ${esc(script.recovery_warning || '当前内容为近似重构，不可作为原始稿证据。')}</p>` : ''}
        ${styleScoreCard(script)}
        <div class="script-text">${esc(script.full_script)}</div>
        ${review ? reviewSummary(review) : `<div class="review-section">
          <h3>人工审核</h3>
          <div class="review-actions"><button class="primary" data-review="直接拍">直接拍</button><button class="secondary" data-review="修改后拍">修改后拍</button><button class="danger" data-review="不拍">不拍</button></div>
          <form class="review-form hidden" id="review-form">
            <input type="hidden" name="decision">
            <label>哪里有问题<textarea name="problem_description" placeholder="描述原文哪里有问题、逻辑哪里不对"></textarea></label>
            <label>修改建议<textarea name="modification_suggestion" placeholder="告诉系统应该怎么修改"></textarea></label>
            <label class="hidden" id="overall-problem-label">整体问题总结<textarea name="overall_problem_summary" placeholder="说明整篇文案为什么不适合继续局部修改"></textarea></label>
            <button class="primary">保存反馈</button>
          </form>
        </div>`}
      </div>
      <aside class="side-stack">
        <div class="info-block"><h4>当前选题</h4><p>${esc(script.title)}</p></div>
        <div class="info-block"><h4>Customer Problem</h4><p>${esc(script.customer_problem)}</p></div>
        <div class="info-block"><h4>Brand Thesis</h4><p>${esc(script.brand_thesis?.statement || '待补充')}</p></div>
        <div class="info-block"><h4>Evidence</h4><p>${knowledge.map(item => `${esc(item.source_document)} · ${esc(item.source_locator)}`).join('<br>') || '未命中'}</p></div>
        ${externalMaterial ? `<div class="info-block"><h4>External Inspiration</h4><p>${esc(externalMaterial.title || '外部素材')}</p><details><summary>查看本稿引用的采集全文</summary><div class="source-full-text">${esc(externalMaterial.content || '未取得全文')}</div></details></div>` : ''}
        <div class="info-block"><h4>CTA</h4><p>${script.cta_asset?.exists ? `已存在：${esc(script.cta_asset.name)}` : '未承诺不存在的资产'}</p></div>
        <details><summary>查看风险与门禁</summary><div class="advanced-body"><b>风险</b><br>${(script.risks || []).map(esc).join('<br>') || '未发现新增风险'}<br><br><b>门禁</b><br>${gates.map(item => `${esc(item.gate)}：${esc(item.status)}`).join('<br>')}</div></details>
      </aside>
    </div>`;
}

function studio() {
  const script = state.scripts.find(item => item.script_id === selectedScript) || latestScriptForTopic(selectedTopic);
  if (!script) return '<div class="empty">尚未生成文案。请从推荐选题或选题池选择一个切口生成。</div>';
  selectedScript = script.script_id;
  selectedTopic = script.topic_id;
  const batchTopics = activeBatchThemeId ? state.topics.filter(topic => topic.theme_id === activeBatchThemeId).sort((a, b) => Number(a.cut_index) - Number(b.cut_index)) : [];
  return `<button class="back-link" data-studio-back>← 返回内容列表</button>
    ${batchTopics.length ? `<div class="batch-switch"><div><p class="eyebrow">FOUR COMPLETE DRAFTS</p><b>${esc(batchTopics[0].theme)}</b></div>${batchTopics.map(topic => { const item = latestScriptForTopic(topic.topic_id); return item ? `<button class="${item.script_id === selectedScript ? 'active' : ''}" data-batch-script="${item.script_id}">切口${esc(topic.cut_index)} · V${esc(item.version)}</button>` : ''; }).join('')}</div>` : ''}
    ${scriptView(script)}`;
}

function reviews() {
  const latest = new Map();
  state.scripts.forEach(script => {
    const group = script.revision_group_id || script.script_id;
    if (!latest.has(group) || Number(script.version) > Number(latest.get(group).version)) latest.set(group, script);
  });
  const pending = [...latest.values()].filter(script => script.status === '待审核');
  return `<div class="list">${pending.map(script => `<button class="queue-row" data-open-script="${script.script_id}"><div>${badge(script.status)}<h3>${esc(script.title)}</h3><p>Version ${esc(script.version)} · 点击进入统一 Content Studio 审核</p></div><span>进入审核 →</span></button>`).join('') || '<div class="empty">当前没有待审核文案</div>'}</div>`;
}

function inspirationErrorPanel() {
  if (!inspirationFailure) return '';
  const payload = inspirationFailure;
  return `<div class="extraction-failure" role="alert"><h3>无法自动读取该链接内容</h3><p>${esc(payload.reason || payload.error)}</p>${payload.partial?.title ? `<p><b>已取得标题：</b>${esc(payload.partial.title)}</p>` : ''}<div class="supplement-options">${(payload.supplemental_options || []).map(option => `<span>${esc(option)}</span>`).join('')}</div><small>请在上方补充文案、字幕或文件后重新点击“收件并拆解”。系统不会在没有正文的情况下生成分析。</small></div>`;
}

function inspiration() {
  return `<div class="two-col inspiration-layout">
    <div><form class="panel" id="inspiration-form">
      <div class="section-head"><div><p class="eyebrow">REAL EXTRACTION FIRST</p><h2>添加外部灵感</h2></div><p>先读取，再拆解</p></div>
      <div class="form-grid">
        <label>平台<select name="platform"><option value="">自动识别</option><option>抖音</option><option>小红书</option><option>视频号</option><option>公众号</option><option>网页</option></select></label>
        <label>标题<input name="title" placeholder="可选；可从网页自动提取"></label>
        <label class="full">公开链接<input name="url" placeholder="粘贴分享口令或 https:// 链接"></label>
        <label class="full">粘贴文案 / 字幕<textarea name="content" placeholder="链接无法读取时，可直接粘贴正文、口播或字幕"></textarea></label>
        <label class="full">上传字幕 / 视频 / 文件<input type="file" name="supplement_file" accept=".txt,.md,.srt,.vtt,.csv,.json,.mp4,.mov,.m4v,.mp3,.m4a,.wav,.pdf,.doc,.docx"></label>
        <button class="primary full">收件并拆解</button>
      </div>
      <p class="form-hint">TXT / SRT / VTT 可直接提取；视频及其他文件会先安全收件，无法自动转写时会明确提示补字幕。</p>
    </form>${inspirationErrorPanel()}</div>
    <div><div class="section-head"><h2>最近灵感</h2></div><div class="list">${state.inspirations.slice(0, 10).map(item => `<article class="inbox-card"><div class="topic-top">${badge('External Inspiration')}<small>${esc(item.extraction_status || 'manual')}</small></div><h3>${esc(item.title)}</h3><p><b>问题：</b>${esc(item.customer_problem)}</p><p><b>Hook：</b>${esc(item.hook)}</p>${item.author || item.published_at ? `<p class="source-meta">${esc(item.author)} ${esc(item.published_at)}</p>` : ''}<div class="card-actions"><button class="secondary" data-inspiration-topic="${item.inspiration_id}" ${item.derived_topic_id ? 'disabled' : ''}>${item.derived_topic_id ? '已进入 Topic Pool' : '生成原创屿洁版选题'}</button></div><details><summary>查看采集全文</summary><div class="source-full-text">${esc(item.content || '未取得全文')}</div></details><details><summary>查看完整拆解与采集字段</summary><div class="advanced-body">描述：${esc(item.description)}\n可见互动：${esc(item.visible_interactions || '未取得')}\n可见评论：${esc((item.visible_comments || []).join('｜') || '未取得')}\n\n冲突：${esc(item.conflict)}\n结构：${esc(item.structure)}\n证据：${esc(item.proof)}\n承接：${esc(item.retention_device)}\nCTA：${esc(item.cta)}\n复用方式：${esc(item.reusable_pattern)}\nCopy Risk：${esc(item.copy_risk)}\n\n${esc(item.internal_question)}</div></details></article>`).join('') || '<div class="empty">还没有完成拆解的外部灵感</div>'}</div></div>
  </div>`;
}

function toShoot() {
  const topics = state.topics.filter(topic => topic.status === '待拍');
  return `<div class="list">${topics.map(topic => { const script = latestScriptForTopic(topic.topic_id); return `<div class="list-row"><div>${badge(topic.status)}<h3>${esc(topic.title)}</h3><p>${script ? `已通过：Version ${esc(script.version)}` : '选题已加入待拍，尚无关联稿件'}</p></div>${script ? `<button class="secondary" data-open-script="${script.script_id}">查看文案</button>` : ''}</div>`; }).join('') || '<div class="empty">还没有通过审核的待拍内容</div>'}</div>`;
}

function knowledge() {
  return `<div class="two-col"><form class="panel" id="knowledge-form"><div class="section-head"><div><p class="eyebrow">KNOWLEDGE CANDIDATE</p><h2>导入内部资料</h2></div><p>不自动升级 verified_internal</p></div><label>资料分类<select name="asset_type"><option>场馆经营 / 盈利 / 选址</option><option>组织 / 薪酬 / 绩效</option><option>教学 / 课程 / 教练培训</option><option>活动方案</option><option>社群 / 私域</option><option>案例及经营数据</option><option>视觉素材</option><option>内容生产资产</option></select></label><label class="file-label">选择文件<input type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.md,.csv,.json"></label><button class="primary">加入资料库收件箱</button><p class="form-hint">上传成功不等于解析完成；治理边界保持不变。</p></form><div><div class="section-head"><h2>解析队列</h2></div><div class="list">${state.knowledge.map(item => `<div class="list-row"><div><h3>${esc(item.file_name)}</h3><p>${esc(item.asset_type)} · ${esc(item.parse_status)} · ${esc(item.evidence_classification)}</p></div>${badge(item.duplicate_status)}</div>`).join('') || '<div class="empty">暂无新增资料</div>'}</div></div></div>`;
}

function creatorSettings() {
  return `<details class="settings-section"><summary><span><b>同行账号基础配置</b><small>当前：V0.2将支持自动监测</small></span><em>${state.creators.length} 个账号</em></summary><div class="settings-body"><form id="creator-form" class="form-grid"><label>账号名称<input name="name" required></label><label>平台<select name="platform"><option>抖音</option><option>小红书</option><option>视频号</option><option>公众号</option></select></label><label class="full">主页链接<input name="profile_url"></label><label>行业<input name="industry" value="羽毛球 / 体育场馆"></label><label>Tier<select name="tier"><option value="A">A｜核心长期观察</option><option value="B">B｜高相关账号</option><option value="C">C｜跨行业参考</option></select></label><label class="full">为什么值得关注<textarea name="why_follow"></textarea></label><button class="primary full">保存基础配置</button></form></div></details>`;
}

function performanceSettings() {
  return `<details class="settings-section"><summary><span><b>内容数据</b><small>当前：暂时支持人工录入，V0.3接自动回流</small></span><em>${state.performance.length} 条记录</em></summary><div class="settings-body"><form id="performance-form" class="form-grid"><label>关联选题<select name="topic_id"><option value="">请选择</option>${state.topics.map(topic => `<option value="${topic.topic_id}">${esc(topic.title)}</option>`).join('')}</select></label><label>关联脚本<select name="script_id"><option value="">请选择</option>${state.scripts.map(script => `<option value="${script.script_id}">${esc(script.title)} · V${esc(script.version)}</option>`).join('')}</select></label><label>平台<select name="platform"><option>抖音</option><option>小红书</option><option>视频号</option></select></label><label>发布时间<input name="publish_time" type="datetime-local"></label><label class="full">发布链接<input name="publish_url"></label><label>24h 播放<input name="views" type="number"></label><label>24h 完播率<input name="completion_rate" type="number" step="0.01"></label><label>24h 点赞<input name="likes" type="number"></label><label>24h 收藏<input name="saves" type="number"></label><label>24h 分享<input name="shares" type="number"></label><label>24h 涨粉<input name="followers_gained" type="number"></label><label>有效线索<input name="leads" type="number"></label><label>合格线索<input name="qualified_leads" type="number"></label><button class="primary full">保存表现快照</button></form></div></details>`;
}

function feedbackFlywheelSettings() {
  const flywheel = state.feedback_flywheel || { metrics: {}, rules: [], governance: {} };
  const metrics = flywheel.metrics || {};
  const rules = flywheel.rules || [];
  const statusText = status => status === 'active' ? '已启用' : status === 'rejected' ? '暂不启用' : '待确认';
  return `<section class="settings-section flywheel-section">
    <div class="flywheel-head"><div><p class="eyebrow">FEEDBACK FLYWHEEL</p><h2>你的反馈数据飞轮</h2><p>每次审核完整留存“原稿 + 选题 + 模型 + 风格分 + 反馈 + V2结果”。只有你确认的偏好才进入后续生成。</p></div><button class="secondary" id="flywheel-rebuild">重新分析全部反馈</button></div>
    <div class="flywheel-metrics">
      <div><strong>${esc(metrics.total_feedback || 0)}</strong><span>反馈总数</span></div>
      <div><strong>${esc(metrics.full_snapshot_events || 0)}</strong><span>完整原稿快照</span></div>
      <div><strong>${esc(metrics.paired_revision_events || 0)}</strong><span>V1→V2训练对</span></div>
      <div><strong>${esc(metrics.active_rules || 0)}</strong><span>已启用偏好</span></div>
      <div><strong>${esc(metrics.positive_examples || 0)}</strong><span>直接拍正样本</span></div>
    </div>
    <div class="flywheel-decisions"><span>直接拍 ${esc(metrics.decision_counts?.['直接拍'] || 0)}</span><span>修改后拍 ${esc(metrics.decision_counts?.['修改后拍'] || 0)}</span><span>不拍 ${esc(metrics.decision_counts?.['不拍'] || 0)}</span></div>
    <div class="preference-list">${rules.map(rule => `<article class="preference-rule ${esc(rule.status)}">
      <div><div class="topic-top"><b>${esc(rule.name)}</b><span class="badge">${esc(statusText(rule.status))}</span></div><p>${esc(rule.instruction)}</p><small>来自 ${esc(rule.source_count || 0)} 条反馈 · 置信度 ${esc(rule.confidence || 'low')}</small></div>
      <div class="card-actions">${rule.status !== 'active' ? `<button class="primary" data-preference-action="approve" data-rule-id="${esc(rule.rule_id)}">确认启用</button>` : `<button class="ghost" data-preference-action="reset" data-rule-id="${esc(rule.rule_id)}">撤回待确认</button>`}${rule.status !== 'rejected' ? `<button class="ghost" data-preference-action="reject" data-rule-id="${esc(rule.rule_id)}">暂不启用</button>` : `<button class="ghost" data-preference-action="reset" data-rule-id="${esc(rule.rule_id)}">重新考虑</button>`}</div>
    </article>`).join('') || '<div class="empty">还没有可提炼的偏好。完成一次“修改后拍”或“不拍”审核后，这里会自动出现候选。</div>'}</div>
    <p class="flywheel-governance">治理边界：反馈数据仅保存在本地工作台；不会自动写入 verified_internal，不修改 Content OS Schema 或 Brand Thesis。</p>
  </section>`;
}

function settings() {
  const lin = state.system.lin_style || {};
  return `<div class="settings-stack">${feedbackFlywheelSettings()}${creatorSettings()}${performanceSettings()}<section class="settings-section static"><div><b>系统状态</b><small>Content OS ${esc(state.system.state)} · Content Skill ${esc(state.system.content_skill)}</small><small>林总风格引擎：${lin.configured ? `${esc(lin.provider || '')} · ${esc(lin.model)} 已配置` : '未配置 API Key，模型生成会停止且不会落库'} · 敏感知识脱敏 ${lin.redactSensitive === false ? '关闭' : '开启'}</small></div></section><section class="settings-section static"><div><b>数据备份</b><small>备份工作台本地数据，不修改 Content OS 核心数据库。</small></div><button class="secondary" id="backup-btn">立即备份</button></section></div>`;
}

const views = { dashboard, topics, 'topic-detail': topicDetail, studio, reviews, inspiration, 'to-shoot': toShoot, knowledge, settings };

function render() {
  title.textContent = names[currentView] || 'Growth Workbench';
  app.innerHTML = views[currentView]();
  bind();
}

function bind() {
  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.routeFilter) topicFilter = button.dataset.routeFilter;
    setView(button.dataset.route);
  }));
  document.querySelectorAll('[data-open-topic]').forEach(button => button.addEventListener('click', () => {
    selectedTopic = button.dataset.openTopic;
    returnView = currentView;
    setView('topic-detail');
  }));
  document.querySelector('[data-back]')?.addEventListener('click', () => setView(returnView));
  document.querySelector('[data-studio-back]')?.addEventListener('click', () => {
    activeBatchThemeId = null;
    setView(returnView === 'studio' ? 'topics' : returnView);
  });
  document.querySelectorAll('[data-topic-action]').forEach(button => button.addEventListener('click', () => topicAction(button.dataset.topicAction, button.dataset.id)));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { topicFilter = button.dataset.filter; render(); }));
  document.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', () => showReview(button.dataset.review)));
  document.querySelectorAll('[data-version]').forEach(button => button.addEventListener('click', () => { selectedScript = button.dataset.version; render(); }));
  document.querySelectorAll('[data-batch-script]').forEach(button => button.addEventListener('click', () => { selectedScript = button.dataset.batchScript; render(); }));
  document.querySelectorAll('[data-open-script]').forEach(button => button.addEventListener('click', () => {
    selectedScript = button.dataset.openScript;
    selectedTopic = state.scripts.find(item => item.script_id === selectedScript)?.topic_id;
    returnView = currentView;
    activeBatchThemeId = null;
    setView('studio');
  }));
  document.querySelectorAll('[data-inspiration-topic]').forEach(button => button.addEventListener('click', () => createInspirationTopic(button.dataset.inspirationTopic)));
  document.querySelectorAll('[data-revise]').forEach(button => button.addEventListener('click', () => reviseScript(button.dataset.revise, button.dataset.reviewId)));
  document.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => restoreVersion(button.dataset.restore)));
  document.querySelectorAll('[data-generate-all]').forEach(button => button.addEventListener('click', () => generateAll(button.dataset.generateAll)));
  document.querySelector('#theme-form')?.addEventListener('submit', submitTheme);
  document.querySelector('#review-form')?.addEventListener('submit', submitReview);
  document.querySelector('#inspiration-form')?.addEventListener('submit', submitInspiration);
  document.querySelector('#knowledge-form')?.addEventListener('submit', submitKnowledge);
  document.querySelector('#creator-form')?.addEventListener('submit', event => submitSimple(event, '/api/creators', '账号基础配置已保存'));
  document.querySelector('#performance-form')?.addEventListener('submit', submitPerformance);
  document.querySelector('#flywheel-rebuild')?.addEventListener('click', rebuildFeedbackFlywheel);
  document.querySelectorAll('[data-preference-action]').forEach(button => button.addEventListener('click', () => updatePreferenceRule(button.dataset.ruleId, button.dataset.preferenceAction)));
  document.querySelector('#backup-btn')?.addEventListener('click', backupData);
}

async function submitTheme(event) {
  event.preventDefault();
  try {
    const result = await api('/api/themes/cuts', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    activeThemeId = result.theme_id;
    await refresh();
    flash('已围绕同一主题生成4个不同切口；默认尚未生成任何完整稿件');
  } catch (error) { flash(error.message, true); }
}

async function topicAction(action, id) {
  try {
    if (action === 'generate') {
      const script = await api(`/api/topics/${id}/generate`, { method: 'POST' });
      selectedTopic = id;
      selectedScript = script.script_id;
      returnView = currentView;
      activeBatchThemeId = null;
      await refresh();
      setView('studio');
      flash(script.generation_mode === 'lin' ? `已生成1篇林总风格文案，风格匹配度 ${script.style_score}/100` : `已按用户明确选择生成模板草稿，风格评分 ${script.style_score}/100`);
      return;
    }
    await api(`/api/topics/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) });
    await refresh();
    const labels = { adopt: '已采用', to_shoot: '已加入待拍', eliminate: '已淘汰', dislike: '已标记不感兴趣' };
    flash(labels[action] || '状态已更新');
  } catch (error) { flash(error.message, true); }
}

async function generateAll(themeId) {
  try {
    const result = await api(`/api/themes/${themeId}/generate-all`, { method: 'POST' });
    activeBatchThemeId = themeId;
    selectedScript = result.scripts[0]?.script_id;
    selectedTopic = result.scripts[0]?.topic_id;
    returnView = currentView;
    await refresh();
    setView('studio');
    flash('已按你的主动操作生成并打开4条完整成稿');
  } catch (error) { flash(error.message, true); }
}

function showReview(decision) {
  const form = document.querySelector('#review-form');
  form.classList.remove('hidden');
  form.decision.value = decision;
  document.querySelectorAll('[data-review]').forEach(button => button.classList.toggle('selected', button.dataset.review === decision));
  document.querySelector('#overall-problem-label').classList.toggle('hidden', decision !== '不拍');
  form.overall_problem_summary.required = decision === '不拍';
  form.problem_description.required = decision === '修改后拍';
  form.modification_suggestion.required = decision === '修改后拍';
}

async function submitReview(event) {
  event.preventDefault();
  try {
    const original = state.scripts.find(script => script.script_id === selectedScript)?.full_script;
    await api(`/api/scripts/${selectedScript}/review`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    await refresh();
    const unchanged = state.scripts.find(script => script.script_id === selectedScript)?.full_script === original;
    flash(unchanged ? '反馈已完整进入数据飞轮；原稿完全未变' : '反馈已保存', !unchanged);
  } catch (error) { flash(error.message, true); }
}

async function rebuildFeedbackFlywheel() {
  try {
    await api('/api/calibration/rebuild', { method: 'POST' });
    await refresh();
    flash('已重新分析全部反馈；新增偏好仍需你确认后才会启用');
  } catch (error) { flash(error.message, true); }
}

async function updatePreferenceRule(ruleId, action) {
  try {
    await api(`/api/calibration/rules/${encodeURIComponent(ruleId)}/action`, { method: 'POST', body: JSON.stringify({ action }) });
    await refresh();
    const messages = { approve: '偏好已启用，将进入之后的新稿与改稿', reject: '该偏好暂不启用', reset: '偏好已恢复为待确认' };
    flash(messages[action] || '偏好状态已更新');
  } catch (error) { flash(error.message, true); }
}

async function reviseScript(scriptId, reviewId) {
  try {
    const revised = await api(`/api/scripts/${scriptId}/revise`, { method: 'POST', body: JSON.stringify({ review_id: reviewId }) });
    selectedScript = revised.script_id;
    await refresh();
    flash(`已由原稿 + 人工反馈 + Content OS 规则生成 Version ${revised.version}；风格匹配度 ${revised.style_score ?? '待评估'}/100，旧版本仍保留`);
  } catch (error) { flash(error.message, true); }
}

async function restoreVersion(scriptId) {
  try {
    const restored = await api(`/api/scripts/${scriptId}/restore`, { method: 'POST' });
    selectedScript = restored.script_id;
    await refresh();
    flash(`旧版内容已恢复为 Version ${restored.version}，其他版本未删除`);
  } catch (error) { flash(error.message, true); }
}

async function createInspirationTopic(id) {
  try {
    await api(`/api/inspirations/${id}/create-topic`, { method: 'POST' });
    await refresh();
    flash('External Inspiration 已经 Internal Intelligence 复核，并生成原创屿洁版选题');
  } catch (error) { flash(error.message, true); }
}

async function submitInspiration(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const file = formData.get('supplement_file');
  const payload = Object.fromEntries(formData);
  delete payload.supplement_file;
  if (file?.size) {
    payload.supplement_file_name = file.name;
    payload.supplement_file_base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  try {
    const submit = event.submitter;
    if (submit) { submit.disabled = true; submit.textContent = '正在读取公开页面…'; }
    await api('/api/inspirations', { method: 'POST', body: JSON.stringify(payload) });
    inspirationFailure = null;
    await refresh();
    flash('已取得实际内容并完成 External Inspiration 拆解');
  } catch (error) {
    inspirationFailure = error.payload || { error: error.message, reason: error.message };
    render();
    flash(inspirationFailure.error || error.message, true);
  }
}

async function submitKnowledge(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const file = formData.get('file');
  if (!file?.size) return flash('请选择文件', true);
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api('/api/knowledge', { method: 'POST', body: JSON.stringify({ file_name: file.name, base64, asset_type: formData.get('asset_type') }) });
    await refresh();
    flash('资料已进入 Knowledge Candidate 队列，未写入 verified_internal');
  } catch (error) { flash(error.message, true); }
}

async function submitSimple(event, url, message) {
  event.preventDefault();
  try {
    await api(url, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    await refresh();
    flash(message);
  } catch (error) { flash(error.message, true); }
}

async function submitPerformance(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target));
  const metrics = {};
  ['views', 'completion_rate', 'likes', 'saves', 'shares', 'followers_gained', 'leads', 'qualified_leads'].forEach(key => {
    metrics[key] = Number(payload[key] || 0);
    delete payload[key];
  });
  payload.metrics_24h = metrics;
  try {
    await api('/api/performance', { method: 'POST', body: JSON.stringify(payload) });
    await refresh();
    flash('表现快照已保存');
  } catch (error) { flash(error.message, true); }
}

async function backupData() {
  try {
    const result = await api('/api/backup', { method: 'POST' });
    flash(`备份完成：${result.path}`);
  } catch (error) { flash(error.message, true); }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#clock').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
refresh().catch(error => { app.innerHTML = `<div class="empty">连接失败：${esc(error.message)}</div>`; });
