import { composeBestScript, composeRevision } from './script-composer.mjs';
import { composeLinScript, llmConfigured, scoreExistingScript } from './lin-composer.mjs';
import { describeConfig } from './llm-client.mjs';
import { ctaAssetNames } from './cta-policy.mjs';

function styleTopic(topic) {
  return {
    ...topic,
    domain: topic.topic_domain || topic.domain || '',
    problem_space: topic.problem_space || topic.gate?.matched_problem_spaces?.[0] || '',
    audience: topic.audience || '羽毛球馆老板、投资人和经营者'
  };
}

function ctaAssets(topic) {
  return ctaAssetNames(topic);
}

function fullScript(script) {
  return [script.hook, script.body, script.cta].filter(Boolean).join('\n\n');
}

function safeError(error) {
  return String(error || 'unknown')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[API_KEY_REDACTED]')
    .slice(0, 300);
}

function withStyle(record, script, scored, metadata) {
  return {
    ...record,
    full_script: fullScript(script),
    generation_mode: metadata.mode,
    style_score: scored.lint.score,
    style_passed: scored.lint.passed,
    style_report: scored.report,
    style_lint: {
      threshold: scored.lint.threshold,
      blocks: scored.lint.blocks,
      warnings: scored.lint.warnings,
      missing_signals: scored.lint.signals.filter(item => !item.pass)
    },
    style_pack_version: metadata.stylePackVersion || '1.0.0',
    style_attempts: metadata.attempts || [],
    needs_human_review: !scored.lint.passed,
    sensitive_knowledge_redacted: metadata.sensitiveKnowledgeRedacted ?? null,
    lin_fallback_reason: metadata.fallbackReason || null,
    generation_context: {
      ...(record.generation_context || {}),
      generation_mode: metadata.mode,
      style_pack_version: metadata.stylePackVersion || '1.0.0',
      llm_used: metadata.mode === 'lin',
      llm_provider: metadata.provider || null,
      llm_model: metadata.model || null,
      llm_response_id: metadata.responseId || null,
      llm_usage: metadata.usage || null,
      active_preference_rule_ids: metadata.activePreferenceRuleIds || [],
      positive_example_ids: metadata.positiveExampleIds || [],
      fewshot_example_ids: metadata.fewshotExampleIds || [],
      retrieved_knowledge_ids: metadata.retrievedKnowledgeIds || [],
      prompt_hash: metadata.promptHash || null
    }
  };
}

function templateResult(legacy, reason, topic = {}) {
  if (legacy.blocked) return legacy;
  const scored = scoreExistingScript(legacy.script.full_script, { hasCtaAsset: ctaAssets(topic).length > 0 });
  return {
    blocked: false,
    script: withStyle(
      legacy.script,
      { hook: legacy.script.full_script, body: '', cta: '' },
      scored,
      { mode: 'template', fallbackReason: reason }
    )
  };
}

async function linResult(legacy, topic, opts = {}) {
  const assets = ctaAssets(topic);
  const relevantRules = (opts.preferenceRules || []).filter(rule => {
    const scope = rule.scope || {};
    const domains = scope.domains || [];
    const spaces = scope.problem_spaces || [];
    const topicIds = scope.topic_ids || [];
    if (!domains.length && !spaces.length && !topicIds.length) return true;
    return domains.includes(topic.topic_domain) || spaces.includes(topic.problem_space || topic.gate?.matched_problem_spaces?.[0]) || topicIds.includes(topic.topic_id);
  }).slice(0, 12);
  const relevantExamples = (opts.positiveExamples || []).filter(example => !example.topic_domain || example.topic_domain === topic.topic_domain).slice(0, 2);
  const result = await composeLinScript(styleTopic(topic), legacy.script.internal_knowledge || [], assets, { ...opts, preferenceRules: relevantRules, positiveExamples: relevantExamples });
  if (!result.ok) return { ok: false, error: result.error };
  const unsafeBlocks = (result.lint.blocks || []).filter(item => ['B01', 'B02', 'B03', 'B04'].includes(item.id));
  if (unsafeBlocks.length) {
    return { ok: false, error: `style_hard_block: ${unsafeBlocks.map(item => item.id).join(',')}` };
  }
  return {
    ok: true,
    script: withStyle(legacy.script, result.script, { lint: result.lint, report: result.report }, {
      mode: 'lin',
      stylePackVersion: result.stylePackVersion,
      attempts: result.attempts,
      sensitiveKnowledgeRedacted: result.sensitiveKnowledgeRedacted,
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage,
      activePreferenceRuleIds: result.trace?.active_preference_rule_ids || [],
      positiveExampleIds: result.trace?.positive_example_ids || [],
      fewshotExampleIds: result.trace?.fewshot_example_ids || [],
      retrievedKnowledgeIds: result.trace?.retrieved_knowledge_ids || [],
      promptHash: result.trace?.prompt_hash || null
    })
  };
}

export async function generateStyledScript(topic, adapter, { mode = 'lin', preferenceRules = [], positiveExamples = [] } = {}) {
  const legacy = composeBestScript(topic, adapter);
  if (legacy.blocked) return legacy;
  if (mode === 'template') return templateResult(legacy, 'template_mode_selected', topic);
  if (!llmConfigured()) return templateResult(legacy, 'llm_not_configured', topic);
  const styled = await linResult(legacy, topic, { preferenceRules, positiveExamples });
  if (!styled.ok) return templateResult(legacy, `llm_failed: ${safeError(styled.error)}`, topic);
  return { blocked: false, script: styled.script };
}

export async function reviseStyledScript(sourceScript, review, topic, adapter, version, { mode = 'lin', preferenceRules = [], positiveExamples = [] } = {}) {
  const legacy = composeRevision(sourceScript, review, topic, adapter, version);
  if (legacy.blocked) return legacy;
  if (mode === 'template') return templateResult(legacy, 'template_mode_selected', topic);
  if (!llmConfigured()) return templateResult(legacy, 'llm_not_configured', topic);
  const styled = await linResult(legacy, topic, {
    humanFeedback: {
      original_script: sourceScript.full_script,
      problem_description: review.problem_description,
      modification_suggestion: review.modification_suggestion
    },
    preferenceRules,
    positiveExamples
  });
  if (!styled.ok) return templateResult(legacy, `llm_failed: ${safeError(styled.error)}`, topic);
  return { blocked: false, script: styled.script };
}

export function styleRuntimeStatus() {
  return describeConfig();
}
