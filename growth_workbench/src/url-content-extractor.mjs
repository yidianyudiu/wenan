import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_DOWNLOAD = 5 * 1024 * 1024;
const MIN_ANALYSIS_TEXT = 80;
const BLOCKED_TEXT = /登录后|请登录|安全验证|访问过于频繁|人机验证|captcha|verify you are human|access denied|forbidden|enable javascript|扫码登录/i;

const decodeEntities = text => String(text || '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;|&#34;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));

const cleanText = text => decodeEntities(String(text || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\r/g, '')
  .replace(/[\t ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const meta = (html, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(match[1]);
  }
  return '';
};

function flattenJsonLd(value, output = []) {
  if (Array.isArray(value)) for (const item of value) flattenJsonLd(item, output);
  else if (value && typeof value === 'object') {
    output.push(value);
    if (value['@graph']) flattenJsonLd(value['@graph'], output);
  }
  return output;
}

function jsonLdObjects(html) {
  const objects = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenJsonLd(JSON.parse(decodeEntities(match[1].trim())), objects); } catch { /* malformed publisher metadata is ignored */ }
  }
  return objects;
}

const authorName = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(authorName).filter(Boolean).join('、') : value?.name || '';
const interactionValue = value => Array.isArray(value)
  ? value.map(interactionValue).filter(Boolean).join('；')
  : value && typeof value === 'object' ? `${value.interactionType?.name || value.interactionType?.['@type'] || '互动'}：${value.userInteractionCount ?? ''}` : '';

function platformFor(hostname) {
  if (/douyin\.com$/i.test(hostname)) return '抖音';
  if (/xiaohongshu\.com$/i.test(hostname)) return '小红书';
  if (/weixin\.qq\.com$/i.test(hostname)) return '公众号';
  if (/bilibili\.com$/i.test(hostname)) return '哔哩哔哩';
  return '网页';
}

function extractUrl(raw) {
  const match = String(raw || '').match(/https?:\/\/[^\s<>"']+/i);
  if (!match) throw new Error('没有识别到有效的 http/https 链接');
  return match[0].replace(/[，。！？、；：）)\]}]+$/u, '');
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

async function assertPublicTarget(url) {
  if (process.env.ALLOW_PRIVATE_URLS === '1') return;
  if (url.hostname === 'localhost') throw new Error('出于安全原因不能读取本机地址');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw new Error('出于安全原因不能读取内网地址');
}

function failure(code, reason, partial = {}) {
  return {
    ok: false,
    extraction_status: 'content_unavailable',
    code,
    reason,
    partial,
    supplemental_options: ['粘贴文案', '粘贴字幕', '上传字幕文件', '上传视频/文件', '手动补充内容']
  };
}

export function parsePublicHtml(html, resolvedUrl) {
  const ld = jsonLdObjects(html);
  const primary = ld.find(item => /Article|NewsArticle|BlogPosting|VideoObject/i.test(String(item['@type'] || ''))) || {};
  const title = primary.headline || primary.name || meta(html, 'og:title') || meta(html, 'twitter:title') || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = primary.description || meta(html, 'description') || meta(html, 'og:description');
  const articleBody = primary.articleBody || primary.transcript || '';
  const mainHtml = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
  const strippedBody = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  const content = cleanText(articleBody || mainHtml || strippedBody);
  const comments = ld.flatMap(item => Array.isArray(item.comment) ? item.comment : item.comment ? [item.comment] : [])
    .map(item => cleanText(typeof item === 'string' ? item : item.text || item.description || ''))
    .filter(Boolean)
    .slice(0, 20);
  const author = authorName(primary.author) || meta(html, 'author') || meta(html, 'article:author');
  const publishedAt = primary.datePublished || meta(html, 'article:published_time') || meta(html, 'date');
  const visibleInteractions = interactionValue(primary.interactionStatistic) || meta(html, 'interactionCount');
  return {
    title: cleanText(title),
    description: cleanText(description),
    content,
    author: cleanText(author),
    published_at: cleanText(publishedAt),
    visible_interactions: cleanText(visibleInteractions),
    visible_comments: comments,
    resolved_url: resolvedUrl
  };
}

export async function extractUrlContent(rawInput) {
  let inputUrl;
  try { inputUrl = new URL(extractUrl(rawInput)); }
  catch (error) { return failure('INVALID_URL', error.message); }
  if (!['http:', 'https:'].includes(inputUrl.protocol)) return failure('INVALID_URL', '只支持 http/https 公开链接');
  try { await assertPublicTarget(inputUrl); }
  catch (error) { return failure('UNSAFE_URL', error.message); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(inputUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GrowthWorkbench/0.1',
        accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.2'
      }
    });
  } catch (error) {
    return failure(error.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED', error.name === 'AbortError' ? '读取超时，页面可能限制了自动访问' : `网络读取失败：${error.message}`);
  } finally { clearTimeout(timeout); }

  if (!response.ok) return failure('HTTP_ERROR', `页面返回 HTTP ${response.status}，可能需要登录或限制了自动访问`, { resolved_url: response.url });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_DOWNLOAD) return failure('CONTENT_TOO_LARGE', '页面内容超过5MB，无法自动读取');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD) return failure('CONTENT_TOO_LARGE', '页面内容超过5MB，无法自动读取');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!/text|html|json|xml|vtt/.test(contentType)) return failure('UNSUPPORTED_CONTENT_TYPE', `链接返回 ${contentType || '未知文件类型'}，当前不能直接提取正文`, { resolved_url: response.url });

  const text = buffer.toString('utf8');
  const extracted = /html|xml/.test(contentType) || /<html|<article|<main/i.test(text)
    ? parsePublicHtml(text, response.url)
    : { title: '', description: '', content: cleanText(text), author: '', published_at: '', visible_interactions: '', visible_comments: [], resolved_url: response.url };
  if (BLOCKED_TEXT.test(extracted.content.slice(0, 1200)) && extracted.content.length < 1200) {
    return failure('ACCESS_RESTRICTED', '页面要求登录、验证或启用脚本，无法自动取得正文', extracted);
  }
  if (extracted.content.length < MIN_ANALYSIS_TEXT) {
    return failure('INSUFFICIENT_CONTENT', '页面已打开，但没有取得足够的正文或字幕，不能据此完成内容分析', extracted);
  }
  return {
    ok: true,
    extraction_status: 'content_extracted',
    platform: platformFor(new URL(response.url).hostname),
    input_url: inputUrl.href,
    ...extracted
  };
}

export function parseSupplementFile(fileName, base64) {
  if (!fileName || !base64) return { ok: false, reason: '未上传补充文件' };
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 25 * 1024 * 1024) return { ok: false, reason: '补充文件超过25MB' };
  if (!['.txt', '.md', '.srt', '.vtt', '.csv', '.json'].includes(ext)) {
    return { ok: false, reason: `已接收 ${fileName}，但当前本地版本不能从${ext || '该类型'}自动提取字幕；请粘贴字幕/文案或上传 TXT、SRT、VTT 文件`, buffer, ext };
  }
  const content = cleanText(buffer.toString('utf8').replace(/^WEBVTT[^\n]*\n/i, '').replace(/^\d+\s*$/gm, '').replace(/\d{2}:\d{2}(?::\d{2})?[,.]\d{3}\s*-->[^\n]+/g, ''));
  if (content.length < 20) return { ok: false, reason: '字幕/文案文件内容过短，暂时不能分析', buffer, ext };
  return { ok: true, content, buffer, ext };
}

