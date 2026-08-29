import crypto from 'node:crypto';
import { scriptGate } from './gates.mjs';

const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function retrieve(topic, adapter) {
  const knowledge = adapter.searchInternal(`${topic.title} ${topic.customer_problem}`, 4).filter(item => item.relevance_score > 0);
  const positives = adapter.searchPositive(topic.title, 2);
  const thesis = adapter.thesis(topic.brand_thesis_id);
  const ctaAsset = topic.cta_asset || null;
  const gate = scriptGate({ topic, knowledge, thesis, ctaAsset });
  return { knowledge, positives, thesis, ctaAsset, gate };
}

function standardText(topic, thesis, ctaAsset) {
  const points = (topic.solution_points || []).filter(Boolean).slice(0, 4);
  const hook = clean(topic.hook || topic.title);
  const middle = points.length
    ? points.map((point, index) => `${index === 0 ? '先' : index === points.length - 1 ? '最后' : '再'}看${clean(point)}。`).join('\n')
    : '先把问题拆到客户、产品、流程和结果，再决定具体动作。';
  const thesisLine = thesis ? clean(thesis.statement) : '这件事不能只看一个动作，要回到完整经营结果。';
  const conclusion = clean(topic.conclusion || '真正要解决的，不是表面热闹，而是让每一步都能接到最后的经营结果。');
  const cta = topic.cta_text && ctaAsset?.exists ? `\n${clean(topic.cta_text)}` : '';
  return `${hook}\n\n${clean(topic.problem_explanation || topic.customer_problem)}\n\n${middle}\n\n${thesisLine}\n\n${conclusion}${cta}`;
}

function revisedText(topic, thesis, ctaAsset, review) {
  const feedback = `${review.problem_description || ''} ${review.modification_suggestion || ''}`;
  const concise = /精简|太长|啰嗦|缩短/.test(feedback);
  const conversational = /口语|机械|书面|自然|生硬|衔接|过渡/.test(feedback);
  const requestedPoints = (topic.solution_points || []).filter(Boolean).slice(0, concise ? 3 : 4);
  const hook = clean(topic.hook || topic.title);
  const opening = concise ? hook : conversational ? `很多球馆老板都会问：${hook}` : hook;
  const problem = clean(topic.problem_explanation || topic.customer_problem);
  const transitions = ['第一步，先看', '接着要看', '再往下看', '最后别漏掉'];
  const middle = requestedPoints.length
    ? requestedPoints.map((point, index) => `${transitions[index] || '还要看'}${clean(point)}。`).join('\n')
    : '先把客户、产品、流程和最后的经营结果连起来看。';
  const bridge = conversational ? '这几步为什么一定要连起来？因为任何一处断掉，前面的热闹都很难变成最后的结果。' : '这些环节不是并列清单，而是一条连续的经营链路。';
  const thesisLine = thesis ? clean(thesis.statement) : '所有动作都要回到完整经营结果。';
  const conclusion = clean(topic.conclusion || '真正要解决的不是表面动作，而是最后的经营结果。');
  const cta = topic.cta_text && ctaAsset?.exists ? `\n${clean(topic.cta_text)}` : '';
  return `${opening}\n\n${problem}\n\n${middle}\n\n${bridge}\n${thesisLine}\n\n所以，${conclusion}${cta}`;
}

function scriptRecord(topic, retrieved, fullScript, metadata = {}) {
  const { knowledge, positives, thesis, ctaAsset, gate } = retrieved;
  const scriptId = id('script');
  const risks = [];
  if (knowledge.length < 2) risks.push('Multi-Source Retrieval覆盖不足，进入人工审稿前应补充资料。');
  if (!thesis) risks.push('未绑定Brand Thesis。');
  return {
    script_id: scriptId,
    revision_group_id: metadata.revision_group_id || scriptId,
    parent_script_id: metadata.parent_script_id || null,
    source_review_id: metadata.source_review_id || null,
    restored_from_script_id: metadata.restored_from_script_id || null,
    topic_id: topic.topic_id,
    version: metadata.version || 1,
    label: metadata.label || 'workbench_single_best_draft',
    status: '待审核',
    title: topic.title,
    full_script: fullScript,
    customer_problem: topic.customer_problem,
    topic_domain: topic.topic_domain,
    brand_thesis: thesis,
    internal_knowledge: knowledge.map(item => ({ id: item.id, title: item.title, statement: item.statement, source_document: item.source_document, source_locator: item.source_locator, evidence_status: item.fact_status })),
    positive_samples: positives.map(item => ({ id: item.sample_id, topic: item.topic, transferable_pattern: item.transferable_pattern })),
    external_inspiration_id: topic.external_inspiration_id || null,
    evidence: knowledge.map(item => ({ source: item.source_document, locator: item.source_locator, status: item.fact_status })),
    risks,
    cta_asset: ctaAsset,
    gate_checks: gate.checks,
    generation_context: metadata.generation_context || { source: 'original_topic', content_os_rules: true },
    created_at: new Date().toISOString()
  };
}

export function composeBestScript(topic, adapter) {
  const retrieved = retrieve(topic, adapter);
  if (retrieved.gate.blocked) return { blocked: true, gate: retrieved.gate };
  return { blocked: false, script: scriptRecord(topic, retrieved, standardText(topic, retrieved.thesis, retrieved.ctaAsset)) };
}

export function composeRevision(sourceScript, review, topic, adapter, version) {
  const retrieved = retrieve(topic, adapter);
  if (retrieved.gate.blocked) return { blocked: true, gate: retrieved.gate };
  const fullScript = revisedText(topic, retrieved.thesis, retrieved.ctaAsset, review);
  return {
    blocked: false,
    script: scriptRecord(topic, retrieved, fullScript, {
      version,
      revision_group_id: sourceScript.revision_group_id || sourceScript.script_id,
      parent_script_id: sourceScript.script_id,
      source_review_id: review.review_id,
      label: 'workbench_human_feedback_revision',
      generation_context: {
        source: 'original_script_plus_human_review_plus_content_os',
        original_script_id: sourceScript.script_id,
        review_id: review.review_id,
        problem_description: review.problem_description,
        modification_suggestion: review.modification_suggestion,
        content_os_rules: true,
        verified_internal_effect: 'none'
      }
    })
  };
}

export function reconstructOriginalText(topic, adapter) {
  const retrieved = retrieve(topic, adapter);
  return standardText(topic, retrieved.thesis, retrieved.ctaAsset);
}

