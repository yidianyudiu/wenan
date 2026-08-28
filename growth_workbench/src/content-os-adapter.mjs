import fs from 'node:fs/promises';
import path from 'node:path';

const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const safeJson = async (p, fallback) => { try { return await readJson(p); } catch { return fallback; } };
const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, '');
const TOKENS = ['获客','成交','体验课','续费','社群','培训','盈利','利润','成本','低峰','馆长','教练','薪酬','课时费','提成','开业','选址','活动','赛事','课程','教学','家长','客户','新馆','转介绍','预售','握拍','步法','发力','击球'];
const TITLE_STOPWORDS = new Set(['为什么','怎么','应该','到底','一个','一家','什么','还是','真正','结果','问题','围绕','球馆','羽毛球馆','羽毛球']);
const meaningfulTerms = value => [...new Set(String(value || '').match(/[\p{Script=Han}]{2,8}/gu) || [])]
  .flatMap(term => term.length <= 4 ? [term] : [term, ...Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2))])
  .filter(term => term.length >= 2 && !TITLE_STOPWORDS.has(term));
function score(query, item) {
  const q = normalize(query), t = normalize(`${item.title} ${item.statement} ${item.summary} ${item.topic} ${item.hook} ${item.core_claim}`);
  let n = 0;
  for (const token of TOKENS) if (q.includes(token) && t.includes(token)) n += 4;
  for (const term of meaningfulTerms(query)) if (t.includes(normalize(term))) n += term.length >= 4 ? 2 : .6;
  return n;
}

export class ContentOSAdapter {
  constructor(root, configDir) { this.root = root; this.configDir = configDir; }
  async init() {
    this.paths = await readJson(path.join(this.configDir, 'content-os-paths.json'));
    this.probe = await readJson(path.join(this.root, this.paths.retrieval_snapshot));
    this.calibration = await readJson(path.join(this.root, this.paths.calibration_data));
    this.theses = await readJson(path.join(this.configDir, 'brand-thesis.json'));
    this.domainMap = await readJson(path.join(this.configDir, 'topic-domain-map.json'));
    this.positiveSeed = await safeJson(path.join(this.root, this.paths.positive_samples), { samples: [] });
  }
  resolve(key) { return path.join(this.root, this.paths[key]); }
  status() {
    return { system: 'Content OS V1.0', state: 'PRODUCTION_READY_WITH_JIT_GOVERNANCE', database: 'static probe lexical retrieval（只读有效词项相关性检索）',
      baseline: this.probe.baseline, content_skill: '0.5.0 locked', topic_orientation: this.calibration.mandatory_gate.gate_name,
      intelligence_boundaries: { internal: '公司知识、经营主张与人工反馈', external: '仅作 External Inspiration / Market Signal', performance: '仅记录屿洁自己发布后的真实表现' } };
  }
  searchInternal(query, limit = 4) {
    return [...this.probe.knowledge].map(x => ({ ...x, relevance_score: score(query, x) })).filter(item => item.relevance_score >= 2).sort((a,b) => b.relevance_score-a.relevance_score).slice(0, limit);
  }
  searchPositive(query, limit = 2) {
    return [...this.probe.positives].map(x => ({ ...x, relevance_score: score(query, x) })).filter(item => item.relevance_score >= 2).sort((a,b) => b.relevance_score-a.relevance_score).slice(0, limit);
  }
  thesis(id) { return this.theses.items.find(x => x.id === id) || null; }
  allTheses() { return this.theses; }
  domains() { return this.domainMap; }
  inventory() {
    return { paths: this.paths, reusable: {
      database: this.resolve('database_snapshot'), topic_agent: this.resolve('topic_agent'), script_agent: this.resolve('script_agent'),
      retrieval: this.resolve('retrieval_snapshot'), positive_samples: this.resolve('positive_samples'), calibration: this.resolve('calibration_data'),
      topic_domain_map: this.resolve('topic_domain_map_image'), internal_ingestion: this.resolve('internal_ingestion')
    }};
  }
}
