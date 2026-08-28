/**
 * llm-client.mjs
 * OpenAI 兼容协议的极简客户端。Node 18+ 自带 fetch，无第三方依赖。
 *
 * 支持任何 OpenAI 兼容端点，只需改环境变量：
 *   DeepSeek  LIN_LLM_BASE_URL=https://api.deepseek.com/v1        LIN_LLM_MODEL=deepseek-chat
 *   豆包/方舟   LIN_LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3   LIN_LLM_MODEL=<接入点ID>
 *   月之暗面    LIN_LLM_BASE_URL=https://api.moonshot.cn/v1        LIN_LLM_MODEL=moonshot-v1-8k
 *   通义       LIN_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  LIN_LLM_MODEL=qwen-plus
 *   本地 Ollama LIN_LLM_BASE_URL=http://127.0.0.1:11434/v1        LIN_LLM_MODEL=qwen2.5:14b
 *   OpenRouter LIN_LLM_BASE_URL=https://openrouter.ai/api/v1     LIN_LLM_MODEL=minimax/minimax-m3:free
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, '../.env');

// 原生读取 .env，不引入第三方依赖。已有进程环境变量优先，不输出任何密钥。
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function defaultConfig() {
  const baseUrl = process.env.LIN_LLM_BASE_URL || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : 'https://api.deepseek.com/v1');
  const openRouter = /openrouter\.ai/i.test(baseUrl);
  return {
    baseUrl,
    apiKey: openRouter ? (process.env.OPENROUTER_API_KEY || process.env.LIN_LLM_API_KEY || '') : (process.env.LIN_LLM_API_KEY || process.env.OPENROUTER_API_KEY || ''),
    model: process.env.LIN_LLM_MODEL || (openRouter ? 'minimax/minimax-m3:free' : 'deepseek-chat'),
    temperature: Number(process.env.LIN_LLM_TEMPERATURE ?? 0.85),
    maxTokens: Number(process.env.LIN_LLM_MAX_TOKENS ?? 12000),
    timeoutMs: Number(process.env.LIN_LLM_TIMEOUT_MS ?? 90000),
    reasoningEffort: process.env.LIN_LLM_REASONING_EFFORT || 'low',
    appTitle: process.env.OPENROUTER_APP_TITLE || 'Yujie Growth Workbench V0.1',
    appUrl: process.env.OPENROUTER_APP_URL || '',
  };
}

const usableKey = key => Boolean(key) && !/在这里|your[-_ ]?key|changeme/i.test(String(key));
const configuredFor = cfg => usableKey(cfg.apiKey) || /(?:127\.0\.0\.1|localhost)/i.test(cfg.baseUrl);

export function llmConfigured() {
  return configuredFor(defaultConfig());
}

export function describeConfig() {
  const cfg = defaultConfig();
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    provider: /openrouter\.ai/i.test(cfg.baseUrl) ? 'OpenRouter' : 'OpenAI-compatible',
    apiKeySet: usableKey(cfg.apiKey),
    configured: configuredFor(cfg),
    redactSensitive: process.env.LIN_REDACT_SENSITIVE !== 'false',
  };
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opts]
 * @returns {Promise<string>} 模型返回的文本
 */
export async function chatWithMetadata(messages, opts = {}) {
  const cfg = { ...defaultConfig(), ...opts };
  if (!configuredFor(cfg)) {
    throw new Error(
      '未配置大模型。请在 growth_workbench/.env 中设置 OPENROUTER_API_KEY 或 LIN_LLM_API_KEY。'
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (usableKey(cfg.apiKey)) headers.Authorization = `Bearer ${cfg.apiKey}`;
    if (/openrouter\.ai/i.test(cfg.baseUrl)) {
      headers['X-OpenRouter-Title'] = cfg.appTitle;
      if (cfg.appUrl) headers['HTTP-Referer'] = cfg.appUrl;
    }
    const requestBody = {
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      stream: false,
    };
    if (opts.responseFormat === 'json_object') requestBody.response_format = { type: 'json_object' };
    if (/openrouter\.ai/i.test(cfg.baseUrl)) requestBody.reasoning = { effort: cfg.reasoningEffort, exclude: true };
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`LLM 未返回最终正文（finish_reason: ${data?.choices?.[0]?.finish_reason || 'unknown'}）`);
    return {
      content,
      responseId: data.id || null,
      model: data.model || cfg.model,
      provider: data.provider || (/openrouter\.ai/i.test(cfg.baseUrl) ? 'OpenRouter' : 'OpenAI-compatible'),
      usage: {
        prompt_tokens: Number(data.usage?.prompt_tokens || 0),
        completion_tokens: Number(data.usage?.completion_tokens || 0),
        total_tokens: Number(data.usage?.total_tokens || 0),
        cost: data.usage?.cost == null ? null : Number(data.usage.cost)
      }
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`LLM 请求超时（${cfg.timeoutMs}ms）`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(messages, opts = {}) {
  return (await chatWithMetadata(messages, opts)).content;
}

/** 从模型输出里稳健地抠出 JSON（模型经常多包一层 ```json） */
export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch (_) {
    /* 继续尝试 */
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = t.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {
      /* 放弃 */
    }
  }
  return null;
}
