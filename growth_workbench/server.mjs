import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { JsonStore } from './src/store.mjs';
import { ContentOSAdapter } from './src/content-os-adapter.mjs';
import { topicOrientationGate } from './src/gates.mjs';
import { reconstructOriginalText } from './src/script-composer.mjs';
import { generateStyledScript, reviseStyledScript, styleRuntimeStatus } from './src/styled-script-service.mjs';
import { attachRevisionOutcome, buildFeedbackFlywheel, createCalibrationEvent, feedbackGenerationContext, setPreferenceRuleStatus, syncFeedbackFlywheel } from './src/feedback-flywheel.mjs';
import { analyzeInspiration } from './src/inspiration-analyzer.mjs';
import { generateTopicCuts, generateTopicCutsWithLlm } from './src/topic-generator.mjs';
import { extractUrlContent, parseSupplementFile } from './src/url-content-extractor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(process.env.CONTENT_OS_ROOT || path.join(here, '..'));
const dataDir = path.resolve(process.env.WORKBENCH_DATA_DIR || path.join(here, 'data'));
const publicDir = path.join(here, 'public');
const store = new JsonStore(dataDir, path.join(here, 'seeds'));
const adapter = new ContentOSAdapter(contentRoot, path.join(here, 'config'));
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const json = (res, status, payload) => {
  const data = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 35 * 1024 * 1024) throw new Error('请求内容超过35MB');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const routeId = (pathname, prefix) => decodeURIComponent(pathname.slice(prefix.length).split('/')[0]);

async function replaceById(collection, field, id, patch) {
  let found;
  await store.update(collection, rows => rows.map(row => row[field] === id ? (found = { ...row, ...patch, updated_at: now() }) : row));
  return found;
}

function newestByGroup(scripts) {
  const latest = new Map();
  for (const script of scripts) {
    const group = script.revision_group_id || script.script_id;
    if (!latest.has(group) || Number(script.version || 1) > Number(latest.get(group).version || 1)) latest.set(group, script);
  }
  return [...latest.values()];
}

function dashboard(topics, scripts, reviews, inspirations, performance) {
  const recommended = topics
    .filter(topic => topic.status === '推荐')
    .sort((a, b) => Number(b.topic_score || 0) - Number(a.topic_score || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(0, 8);
  const currentScripts = newestByGroup(scripts);
  return {
    recommended,
    counts: {
      topics: topics.length,
      recommended: topics.filter(topic => topic.status === '推荐').length,
      scripts: scripts.length,
      pending_review: currentScripts.filter(script => script.status === '待审核').length,
      to_shoot: topics.filter(topic => topic.status === '待拍').length,
      inspirations: inspirations.filter(item => item.analysis_status === 'analyzed').length,
      published: topics.filter(topic => topic.status === '已发布').length,
      performance_records: performance.length,
      calibration_feedback: reviews.length
    }
  };
}

function normalizeReview(input, script) {
  const decision = String(input.decision || '').trim();
  if (!['直接拍', '修改后拍', '不拍'].includes(decision)) throw new Error('请选择审核结论');
  const problemDescription = String(input.problem_description || input.problem_sentence || input.reason || '').trim();
  const modificationSuggestion = String(input.modification_suggestion || input.preferred_expression || '').trim();
  const overallProblemSummary = String(input.overall_problem_summary || '').trim();
  if (decision === '修改后拍' && (!problemDescription || !modificationSuggestion)) throw new Error('“修改后拍”需要填写哪里有问题和修改建议');
  if (decision === '不拍' && !overallProblemSummary) throw new Error('“不拍”需要填写整体问题总结');
  return {
    review_id: uid('review'),
    script_id: script.script_id,
    revision_group_id: script.revision_group_id || script.script_id,
    script_version: script.version || 1,
    topic_id: script.topic_id,
    decision,
    problem_description: problemDescription,
    modification_suggestion: modificationSuggestion,
    overall_problem_summary: overallProblemSummary,
    source: 'human_review',
    created_at: now(),
    knowledge_effect: 'no_verified_internal_change',
    verified_internal_effect: 'none'
  };
}

async function migrateLocalWorkbenchData() {
  const [topics, scripts, reviews] = await Promise.all([store.read('topics'), store.read('scripts'), store.read('reviews')]);
  const normalizedReviews = reviews.map(review => ({
    ...review,
    problem_description: review.problem_description ?? [review.problem_sentence, review.reason].filter(Boolean).join('\n'),
    modification_suggestion: review.modification_suggestion ?? review.preferred_expression ?? '',
    overall_problem_summary: review.overall_problem_summary ?? '',
    verified_internal_effect: review.verified_internal_effect ?? 'none'
  }));
  const normalizedScripts = scripts.map(script => {
    const matchingReview = normalizedReviews.find(review => review.script_id === script.script_id && review.modification_suggestion && String(review.modification_suggestion).trim() === String(script.full_script || '').trim());
    let recovered = script;
    if (matchingReview) {
      const alternate = scripts.find(candidate => candidate.topic_id === script.topic_id && candidate.script_id !== script.script_id && Number(candidate.version || 1) === 1 && String(candidate.full_script || '').trim() !== String(matchingReview.modification_suggestion).trim());
      const topic = topics.find(item => item.topic_id === script.topic_id);
      const originalText = alternate?.full_script || (topic ? reconstructOriginalText(topic, adapter) : script.full_script);
      recovered = {
        ...script,
        full_script: originalText,
        version: 1,
        status: '反馈已保存',
        legacy_feedback_overwrite_recovered: true,
        legacy_feedback_overwrite_recovered_from: alternate?.script_id || 'topic_reconstruction',
        recovered_by: alternate ? 'historical_version' : 'reconstruction',
        recovery_source_script_id: alternate?.script_id || null,
        recovery_warning: alternate ? null : '未找到可验证的历史原稿；当前文本为按选题与只读规则近似重构，不可作为原始稿证据。',
        recovered_at: now()
      };
    }
    return {
      ...recovered,
      revision_group_id: recovered.revision_group_id || recovered.script_id,
      parent_script_id: recovered.parent_script_id || null,
      source_review_id: recovered.source_review_id || null,
      restored_from_script_id: recovered.restored_from_script_id || null,
      recovered_by: recovered.recovered_by || (recovered.legacy_feedback_overwrite_recovered ? (recovered.legacy_feedback_overwrite_recovered_from === 'topic_reconstruction' ? 'reconstruction' : 'historical_version') : null),
      recovery_source_script_id: recovered.recovery_source_script_id || (recovered.legacy_feedback_overwrite_recovered_from && recovered.legacy_feedback_overwrite_recovered_from !== 'topic_reconstruction' ? recovered.legacy_feedback_overwrite_recovered_from : null),
      recovery_warning: recovered.recovery_warning || (recovered.legacy_feedback_overwrite_recovered_from === 'topic_reconstruction' ? '未找到可验证的历史原稿；当前文本为按选题与只读规则近似重构，不可作为原始稿证据。' : null)
    };
  });
  await store.write('reviews', normalizedReviews);
  await store.write('scripts', normalizedScripts);
  await store.update('calibration_events', events => events.map(event => ({
    ...event,
    problem_description: event.problem_description ?? [event.problem_sentence, event.reason].filter(Boolean).join('\n'),
    modification_suggestion: event.modification_suggestion ?? event.preferred_expression ?? '',
    overall_problem_summary: event.overall_problem_summary ?? '',
    verified_internal_effect: event.verified_internal_effect ?? 'none'
  })));
  await syncFeedbackFlywheel(store, { scripts: normalizedScripts, topics, semantic: false });
}

async function createScriptForTopic(topic, { mode = 'lin' } = {}) {
  const [calibration, inspirations] = await Promise.all([
    feedbackGenerationContext(store),
    topic.external_inspiration_id ? store.read('inspirations') : Promise.resolve([])
  ]);
  const externalMaterial = topic.external_inspiration_id
    ? inspirations.find(item => item.inspiration_id === topic.external_inspiration_id && String(item.content || '').trim()) || null
    : null;
  const result = await generateStyledScript(topic, adapter, {
    mode,
    preferenceRules: calibration.preferenceRules,
    positiveExamples: calibration.positiveExamples,
    externalMaterial
  });
  if (result.blocked) return result;
  await store.update('scripts', rows => [result.script, ...rows]);
  await replaceById('topics', 'topic_id', topic.topic_id, { status: '已生成脚本', latest_script_id: result.script.script_id });
  return result;
}

async function saveSupplementFile(input, parsed) {
  if (!input.supplement_file_name || !input.supplement_file_base64) return null;
  const directory = path.join(dataDir, 'inspiration_files');
  await fs.mkdir(directory, { recursive: true });
  const safe = `${Date.now()}_${path.basename(input.supplement_file_name).replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
  const buffer = parsed.buffer || Buffer.from(input.supplement_file_base64, 'base64');
  await fs.writeFile(path.join(directory, safe), buffer);
  return { original_name: input.supplement_file_name, stored_name: safe, size: buffer.length, parse_status: parsed.ok ? 'text_extracted' : 'stored_needs_manual_transcript' };
}

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, workbench: '0.1.4-minimax-precision-fix-01', content_os: adapter.status(), lin_style: styleRuntimeStatus(), feedback_flywheel: 'feedback_flywheel_v2', data_dir: dataDir });

  if (method === 'GET' && p === '/api/bootstrap') {
    const [topics, scripts, reviews, inspirations, knowledge, creators, performance, calibrationEvents, preferenceRules] = await Promise.all(['topics', 'scripts', 'reviews', 'inspirations', 'knowledge_inbox', 'creators', 'performance', 'calibration_events', 'preference_rules'].map(name => store.read(name)));
    const feedbackFlywheel = buildFeedbackFlywheel(calibrationEvents, preferenceRules);
    return json(res, 200, { system: { ...adapter.status(), lin_style: styleRuntimeStatus() }, dashboard: dashboard(topics, scripts, reviews, inspirations, performance), topics, scripts, reviews, inspirations, knowledge, creators, performance, feedback_flywheel: feedbackFlywheel, theses: adapter.allTheses(), domains: adapter.domains() });
  }

  if (method === 'GET' && p === '/api/system/inventory') return json(res, 200, adapter.inventory());

  if (method === 'POST' && p === '/api/themes/cuts') {
    const input = await body(req);
    let cuts;
    let topics;
    try {
      cuts = input.mode === 'template' ? generateTopicCuts(input.theme) : await generateTopicCutsWithLlm(input.theme);
      const createdAt = now();
      topics = cuts.map(cut => {
        const topic = { topic_id: uid('topic'), ...cut, created_at: createdAt };
        const gate = topicOrientationGate(topic);
        if (gate.status !== 'PASS') throw new Error(gate.reason);
        return { ...topic, gate };
      });
    } catch (error) { return json(res, 422, { error: error.message }); }
    await store.update('topics', rows => [...topics, ...rows]);
    return json(res, 201, { theme_id: topics[0].theme_id, theme: topics[0].theme, topics });
  }

  if (method === 'POST' && /\/api\/themes\/[^/]+\/generate-all$/.test(p)) {
    const themeId = p.split('/')[3];
    const input = await body(req);
    const mode = input.mode || url.searchParams.get('mode') || 'lin';
    const [topics, existingScripts] = await Promise.all([store.read('topics'), store.read('scripts')]);
    const group = topics.filter(topic => topic.theme_id === themeId).sort((a, b) => Number(a.cut_index) - Number(b.cut_index));
    if (group.length !== 4) return json(res, 404, { error: '没有找到完整的四切口主题组' });
    const generated = [];
    for (const topic of group) {
      const existing = existingScripts.find(script => script.script_id === topic.latest_script_id);
      if (existing) { generated.push(existing); continue; }
      const result = await createScriptForTopic(topic, { mode });
      if (result.blocked) return json(res, 422, { error: '脚本门禁未通过', ...result });
      generated.push(result.script);
    }
    return json(res, 201, { theme_id: themeId, scripts: generated });
  }

  if (method === 'POST' && p === '/api/topics') {
    const input = await body(req);
    const gate = topicOrientationGate(input);
    if (gate.status !== 'PASS') return json(res, 422, { error: gate.reason, gate });
    const topic = { topic_id: uid('topic'), status: '待评估', topic_score: input.topic_score || 70, inspiration_source: input.inspiration_source || 'Manual', ...input, gate, created_at: now() };
    await store.update('topics', rows => [topic, ...rows]);
    return json(res, 201, topic);
  }

  if (method === 'POST' && /\/api\/topics\/[^/]+\/action$/.test(p)) {
    const id = p.split('/')[3];
    const input = await body(req);
    const statuses = { adopt: '已采用', to_shoot: '待拍', eliminate: '淘汰', dislike: '不感兴趣' };
    if (!statuses[input.action]) return json(res, 422, { error: '不支持的选题动作' });
    const updated = await replaceById('topics', 'topic_id', id, { status: statuses[input.action], last_explicit_action: input.action });
    return updated ? json(res, 200, updated) : json(res, 404, { error: '选题不存在' });
  }

  if (method === 'PATCH' && p.startsWith('/api/topics/')) {
    const id = routeId(p, '/api/topics/');
    const input = await body(req);
    const allowed = ['已采用', '已生成脚本', '待拍', '淘汰', '不感兴趣', '已拍', '已发布'];
    if (input.status && !allowed.includes(input.status)) return json(res, 422, { error: '状态只能由明确业务动作改变' });
    const updated = await replaceById('topics', 'topic_id', id, input);
    return updated ? json(res, 200, updated) : json(res, 404, { error: '选题不存在' });
  }

  if (method === 'POST' && /\/api\/topics\/[^/]+\/generate$/.test(p)) {
    const id = p.split('/')[3];
    const input = await body(req);
    const mode = input.mode || url.searchParams.get('mode') || 'lin';
    const [topics, scripts] = await Promise.all([store.read('topics'), store.read('scripts')]);
    const topic = topics.find(item => item.topic_id === id);
    if (!topic) return json(res, 404, { error: '选题不存在' });
    const existing = scripts.find(script => script.script_id === topic.latest_script_id);
    if (existing) return json(res, 200, existing);
    const result = await createScriptForTopic(topic, { mode });
    if (result.blocked) return json(res, 422, { error: '脚本门禁未通过', ...result });
    return json(res, 201, result.script);
  }

  if (method === 'POST' && /\/api\/scripts\/[^/]+\/review$/.test(p)) {
    const scriptId = p.split('/')[3];
    const input = await body(req);
    const [scripts, topics] = await Promise.all([store.read('scripts'), store.read('topics')]);
    const script = scripts.find(item => item.script_id === scriptId);
    if (!script) return json(res, 404, { error: '脚本不存在' });
    let review;
    try { review = normalizeReview(input, script); }
    catch (error) { return json(res, 422, { error: error.message }); }
    await store.update('reviews', rows => [review, ...rows]);
    const topic = topics.find(item => item.topic_id === script.topic_id);
    const calibrationEvent = createCalibrationEvent(review, script, topic);
    await store.update('calibration_events', rows => [calibrationEvent, ...rows]);
    await syncFeedbackFlywheel(store, { scripts, topics });
    const scriptStatus = review.decision === '直接拍' ? '直接拍' : review.decision === '修改后拍' ? '反馈已保存' : '不拍';
    await replaceById('scripts', 'script_id', scriptId, { status: scriptStatus, latest_review_id: review.review_id });
    if (review.decision === '直接拍') await replaceById('topics', 'topic_id', script.topic_id, { status: '待拍', latest_script_id: scriptId });
    if (review.decision === '不拍') await replaceById('topics', 'topic_id', script.topic_id, { status: '淘汰', latest_script_id: scriptId });
    return json(res, 201, { ...review, feedback_flywheel_recorded: true });
  }

  if (method === 'POST' && /\/api\/scripts\/[^/]+\/revise$/.test(p)) {
    const scriptId = p.split('/')[3];
    const input = await body(req);
    const [scripts, reviews, topics] = await Promise.all([store.read('scripts'), store.read('reviews'), store.read('topics')]);
    const source = scripts.find(item => item.script_id === scriptId);
    if (!source) return json(res, 404, { error: '原稿不存在' });
    const review = reviews.find(item => item.review_id === input.review_id && item.script_id === scriptId) || reviews.find(item => item.script_id === scriptId && item.decision === '修改后拍');
    if (!review || review.decision !== '修改后拍') return json(res, 422, { error: '请先保存“修改后拍”的人工反馈' });
    const topic = topics.find(item => item.topic_id === source.topic_id);
    if (!topic) return json(res, 404, { error: '关联选题不存在' });
    const groupId = source.revision_group_id || source.script_id;
    const versions = scripts.filter(item => (item.revision_group_id || item.script_id) === groupId);
    const nextVersion = Math.max(...versions.map(item => Number(item.version || 1))) + 1;
    const [calibration, inspirations] = await Promise.all([
      feedbackGenerationContext(store),
      source.external_inspiration_id ? store.read('inspirations') : Promise.resolve([])
    ]);
    const externalMaterial = source.external_inspiration_id
      ? inspirations.find(item => item.inspiration_id === source.external_inspiration_id && String(item.content || '').trim()) || null
      : null;
    const result = await reviseStyledScript(source, review, topic, adapter, nextVersion, {
      mode: input.mode || 'lin',
      preferenceRules: calibration.preferenceRules,
      positiveExamples: calibration.positiveExamples,
      externalMaterial
    });
    if (result.blocked) return json(res, 422, { error: '脚本门禁未通过', ...result });
    await store.update('scripts', rows => [result.script, ...rows]);
    await attachRevisionOutcome(store, review.review_id, result.script);
    await syncFeedbackFlywheel(store);
    await replaceById('topics', 'topic_id', topic.topic_id, { status: '已生成脚本', latest_script_id: result.script.script_id });
    return json(res, 201, result.script);
  }

  if (method === 'GET' && p === '/api/calibration/flywheel') {
    const snapshot = buildFeedbackFlywheel(await store.read('calibration_events'), await store.read('preference_rules'));
    return json(res, 200, snapshot);
  }

  if (method === 'POST' && p === '/api/calibration/rebuild') {
    return json(res, 200, await syncFeedbackFlywheel(store));
  }

  if (method === 'POST' && /\/api\/calibration\/rules\/[^/]+\/action$/.test(p)) {
    const ruleId = decodeURIComponent(p.split('/')[4]);
    const input = await body(req);
    try {
      const rule = await setPreferenceRuleStatus(store, ruleId, input.action);
      const snapshot = buildFeedbackFlywheel(await store.read('calibration_events'), await store.read('preference_rules'));
      return json(res, 200, { rule, feedback_flywheel: snapshot });
    } catch (error) {
      return json(res, 422, { error: error.message });
    }
  }

  if (method === 'POST' && /\/api\/scripts\/[^/]+\/restore$/.test(p)) {
    const targetId = p.split('/')[3];
    const scripts = await store.read('scripts');
    const target = scripts.find(item => item.script_id === targetId);
    if (!target) return json(res, 404, { error: '要恢复的版本不存在' });
    const groupId = target.revision_group_id || target.script_id;
    const versions = scripts.filter(item => (item.revision_group_id || item.script_id) === groupId);
    const latest = versions.sort((a, b) => Number(b.version || 1) - Number(a.version || 1))[0];
    const restored = {
      ...target,
      script_id: uid('script'),
      revision_group_id: groupId,
      parent_script_id: latest.script_id,
      source_review_id: null,
      restored_from_script_id: target.script_id,
      recovered_by: 'historical_version',
      recovery_source_script_id: target.script_id,
      recovery_warning: null,
      version: Number(latest.version || 1) + 1,
      label: 'workbench_restored_version',
      status: '待审核',
      generation_context: { source: 'restored_old_version', restored_from_script_id: target.script_id, verified_internal_effect: 'none' },
      created_at: now(),
      updated_at: null
    };
    await store.update('scripts', rows => [restored, ...rows]);
    await replaceById('topics', 'topic_id', target.topic_id, { status: '已生成脚本', latest_script_id: restored.script_id });
    return json(res, 201, restored);
  }

  if (method === 'POST' && p === '/api/inspirations') {
    const input = await body(req);
    const manualContent = String(input.content || '').trim();
    const parsedFile = parseSupplementFile(input.supplement_file_name, input.supplement_file_base64);
    const savedFile = await saveSupplementFile(input, parsedFile);
    const extraction = input.url ? await extractUrlContent(input.url) : null;
    const extractedContent = extraction?.ok ? extraction.content : '';
    const fileContent = parsedFile.ok ? parsedFile.content : '';
    const analysisContent = [extractedContent, manualContent, fileContent].filter(Boolean).join('\n\n').trim();
    if (!analysisContent) {
      const reason = extraction?.reason || parsedFile.reason || '没有取得正文、口播或字幕内容';
      return json(res, 422, {
        error: input.url ? '无法自动读取该链接内容' : '缺少可分析的内容',
        reason,
        extraction_status: extraction?.extraction_status || 'content_unavailable',
        code: extraction?.code || 'CONTENT_REQUIRED',
        partial: extraction?.partial || {},
        uploaded_file: savedFile,
        supplemental_options: extraction?.supplemental_options || ['粘贴文案', '粘贴字幕', '上传字幕文件', '上传视频/文件', '手动补充内容']
      });
    }
    const merged = { ...input, title: input.title || extraction?.title || '', content: analysisContent, visible_comments: extraction?.visible_comments || [] };
    const analysis = analyzeInspiration(merged);
    const item = {
      inspiration_id: uid('insp'),
      intelligence_type: 'external_inspiration',
      platform: input.platform || extraction?.platform || '网页',
      url: input.url || '',
      resolved_url: extraction?.resolved_url || '',
      title: input.title || extraction?.title || analysis.topic,
      description: extraction?.description || '',
      content: analysisContent,
      author: extraction?.author || '',
      published_at: extraction?.published_at || '',
      visible_interactions: extraction?.visible_interactions || '',
      visible_comments: extraction?.visible_comments || [],
      extraction_status: extraction?.ok ? 'content_extracted' : manualContent ? 'manual_content_provided' : 'supplement_file_parsed',
      extraction_warning: extraction && !extraction.ok ? extraction.reason : '',
      uploaded_file: savedFile,
      source_status: 'external_not_company_fact',
      brand_thesis_effect: 'none',
      verified_internal_effect: 'none',
      internal_review_status: 'pending_internal_intelligence_review',
      ...analysis,
      created_at: now()
    };
    await store.update('inspirations', rows => [item, ...rows]);
    return json(res, 201, item);
  }

  if (method === 'POST' && /\/api\/inspirations\/[^/]+\/create-topic$/.test(p)) {
    const inspirationId = p.split('/')[3];
    const inspirations = await store.read('inspirations');
    const item = inspirations.find(inspiration => inspiration.inspiration_id === inspirationId);
    if (!item) return json(res, 404, { error: '灵感不存在' });
    if (item.analysis_status !== 'analyzed' || !String(item.content || '').trim()) return json(res, 422, { error: '尚未取得正文或字幕，不能生成原创选题' });
    let orientation;
    try {
      const sourceTheme = `${item.title || ''}\n${String(item.content).slice(0, 2800)}`;
      const cuts = url.searchParams.get('mode') === 'template' ? generateTopicCuts(sourceTheme) : await generateTopicCutsWithLlm(sourceTheme);
      orientation = cuts[0];
    } catch (error) {
      return json(res, 422, { error: `无法基于原文生成原创选题：${error.message}` });
    }
    const internal = adapter.searchInternal(`${orientation.title} ${orientation.customer_problem}`, 3);
    const topic = {
      topic_id: uid('topic'),
      title: orientation.title,
      customer_problem: orientation.customer_problem,
      hook: orientation.hook,
      argument_angle: orientation.argument_angle,
      content_structure: orientation.content_structure,
      problem_space: orientation.problem_space,
      topic_domain: orientation.topic_domain,
      brand_thesis_id: orientation.brand_thesis_id,
      recommendation_reason: '由外部市场信号发现问题，再回到 Internal Intelligence 形成屿洁自己的经营答案。',
      knowledge_coverage: internal.length ? internal.map(entry => entry.title).join('；') : '没有命中足够相关的内部知识；生成时不得补写搜羽事实',
      inspiration_source: 'External Inspiration + Internal Intelligence',
      external_inspiration_id: inspirationId,
      topic_score: 82,
      status: '待评估',
      solution_points: orientation.solution_points,
      problem_explanation: orientation.customer_problem,
      conclusion: orientation.conclusion,
      created_at: now()
    };
    const gate = topicOrientationGate(topic);
    if (gate.status !== 'PASS') return json(res, 422, { error: gate.reason, gate });
    topic.gate = gate;
    await store.update('topics', rows => [topic, ...rows]);
    await store.update('inspirations', rows => rows.map(inspiration => inspiration.inspiration_id === inspirationId ? { ...inspiration, derived_topic_id: topic.topic_id, internal_review_status: 'completed', updated_at: now() } : inspiration));
    return json(res, 201, topic);
  }

  if (method === 'POST' && p === '/api/knowledge') {
    const input = await body(req);
    if (!input.file_name || !input.base64) return json(res, 400, { error: '请选择文件' });
    const buffer = Buffer.from(input.base64, 'base64');
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = (await store.read('knowledge_inbox')).find(item => item.sha256 === sha);
    if (existing) return json(res, 409, { error: '文件重复', duplicate_of: existing.knowledge_inbox_id });
    const ext = path.extname(input.file_name).toLowerCase();
    const safe = `${Date.now()}_${path.basename(input.file_name).replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
    await fs.writeFile(path.join(dataDir, 'knowledge_files', safe), buffer);
    const immediate = ['.txt', '.md', '.csv', '.json'].includes(ext);
    const preview = immediate ? buffer.toString('utf8').replace(/\s+/g, ' ').slice(0, 500) : null;
    const item = { knowledge_inbox_id: uid('kin'), file_name: input.file_name, stored_name: safe, sha256: sha, size: buffer.length, asset_type: input.asset_type || '待分类', parse_status: immediate ? 'text_parse_complete' : 'queued_existing_ingestion_pipeline', text_complete: immediate, table_complete: ext === '.csv' || ext === '.json' ? true : null, image_or_diagram_complete: null, extracted_text_preview: preview, duplicate_status: 'new', evidence_classification: 'knowledge_candidate_pending', verified_internal_effect: 'none', jit_trigger: false, created_at: now() };
    await store.update('knowledge_inbox', rows => [item, ...rows]);
    return json(res, 201, item);
  }

  if (method === 'POST' && p === '/api/creators') {
    const input = await body(req);
    const item = { creator_id: uid('creator'), tier: 'B', status: 'active', ...input, intelligence_type: 'external_creator_signal', created_at: now() };
    await store.update('creators', rows => [item, ...rows]);
    return json(res, 201, item);
  }

  if (method === 'POST' && p === '/api/performance') {
    const input = await body(req);
    const item = { performance_id: uid('perf'), content_id: input.content_id || uid('content'), intelligence_type: 'own_content_performance', topic_id: input.topic_id || null, script_id: input.script_id || null, platform: input.platform || '抖音', publish_url: input.publish_url || '', publish_time: input.publish_time || null, metrics_24h: input.metrics_24h || {}, metrics_72h: input.metrics_72h || {}, metrics_7d: input.metrics_7d || {}, metrics_30d: input.metrics_30d || {}, created_at: now() };
    await store.update('performance', rows => [item, ...rows]);
    if (input.topic_id) await replaceById('topics', 'topic_id', input.topic_id, { status: '已发布' });
    return json(res, 201, item);
  }

  if (method === 'POST' && p === '/api/backup') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(here, 'backups', `workbench_${stamp}`);
    await fs.mkdir(target, { recursive: true });
    await fs.cp(dataDir, target, { recursive: true });
    return json(res, 201, { ok: true, path: target });
  }

  return json(res, 404, { error: '接口不存在' });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const requestPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(publicDir, requestPath);
    const relative = path.relative(publicDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return json(res, 403, { error: '禁止访问' });
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: '页面不存在' });
    return json(res, 500, { error: error.message });
  }
}

export async function startServer({ host = process.env.WORKBENCH_HOST || '127.0.0.1', port = Number(process.env.WORKBENCH_PORT || 4310) } = {}) {
  await store.init();
  await adapter.init();
  await migrateLocalWorkbenchData();
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve));
  return { server, url: `http://${host}:${port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer();
  console.log(`屿洁说干货 Growth Workbench 已启动：${url}`);
  if (process.env.OPEN_BROWSER !== '0') {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  }
}
