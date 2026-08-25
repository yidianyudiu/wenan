const firstSentence = text => (String(text || '').split(/[。！？!?\n]/).find(Boolean) || '').trim();
const problemMap = [
  ['获客',/获客|招生|流量|客户从哪里/],['成交',/成交|报名|体验课|转化/],['续费',/续费|留存|留下/],['利润',/利润|赚钱|成本/],['竞争',/竞争|低价|为什么选择|凭什么/],['团队',/馆长|教练|员工|团队/],['新馆',/新馆|开业|选址|预售/]
];
export function analyzeInspiration(input) {
  const text = String(input.content || '').trim();
  const matched = problemMap.filter(([,r])=>r.test(text)).map(([x])=>x);
  const paragraphs = text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  return {
    analysis_status: text ? 'analyzed' : 'needs_content', topic: input.title || firstSentence(text) || '待补充内容', hook: firstSentence(text),
    customer_problem: matched.length ? matched.join(' / ') : '待人工确认', audience_anxiety: matched.length ? `目标用户正在担心：${matched.join('、')}` : '待人工补充',
    conflict: /但是|却|反而|不是|别/.test(text) ? '原内容存在明确转折或反常识冲突' : '未识别到明确冲突',
    structure: paragraphs.length > 1 ? `共${paragraphs.length}个内容段落` : '单段表达', proof: /\d/.test(text) ? '包含数字，必须核验来源与适用范围' : '未识别到可直接使用的事实证据',
    retention_device: /第一|第二|第三|三个|步骤|原因/.test(text) ? '清单/步骤式承接' : '待补充',
    cta: /需要|可以|点击|评论|留言|私信/.test(text) ? '存在CTA；正式稿需经过CTA Asset Gate' : '未识别到CTA',
    comments_insight: Array.isArray(input.visible_comments) && input.visible_comments.length ? `取得${input.visible_comments.length}条公开可见评论，仅作为外部信号` : '页面未提供可公开提取的评论', reusable_pattern: '只提取问题入口、Hook、冲突与结构，不复用原文表达',
    copy_risk: text ? '需在生成屿洁版内容时执行相似度与洗稿风险检查' : '无法评估',
    internal_question: '搜羽在这个问题上有没有更真实、更专业、更有经营经验的答案？'
  };
}
