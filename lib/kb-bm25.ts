/**
 * KB动态层BM25打分 — 2026-10-23（质量工程路线件3）
 * 背景：动态层召回=关键词子串命中+向量语义命中两通道。失效面：
 *   ①query用词与条目keywords标签不同=关键词通道漏 ②专名/代码/缩写类短query向量召回弱（bge已知失效面）
 *   BM25=更聪明的关键词匹配（词频饱和+文档长度归一），补第三通道。
 * 设计约束（保险丝哲学）：零依赖纯函数/零网络调用/失败静默回退——最差回到现状。
 * 分词：ASCII词 + 中文单字 + 中文bigram（bigram对中文词形匹配强于单字）。
 */

const K1 = 1.5;
const B = 0.75;

export interface BM25Doc {
  id: string;
  text: string;
}

export interface BM25Hit {
  id: string;
  score: number;
}

// 停用词（中文虚词+高频弱信号——2026-10-23对照验收3/5 FAIL根因：虚词bigram噪声分，
// 语料小时IDF区分度不足，必须显式过滤）：单字虚词 + 双字虚词bigram + 高频泛词
const STOP_SINGLE = new Set<string>(); // 已废弃：单字不参与打分（假命中实锤），保留空集防外部引用断
const STOP_WORD = new Set([
  "这个", "那个", "什么", "怎么", "这样", "那样", "意味着", "可以", "我们", "你们", "他们",
  "还是", "不是", "如果", "因为", "所以", "现在", "然后", "因此", "其中", "关于", "通过",
  "对于", "由于", "以及", "就是", "也是", "这个", "一个", "一下", "起来", "过来", "出来",
  "知道", "觉得", "感觉", "问题", "情况", "时候", "今天", "明天", "昨天", "可能", "应该",
]);

/** 分词：ASCII词 + 中文单字 + 中文bigram；停用词过滤 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  const asciiWords = lower.match(/[a-z0-9][a-z0-9.\-]*/g) || [];
  for (const w of asciiWords) out.push(w);
  const cnRuns = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of cnRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!STOP_WORD.has(bg)) out.push(bg);
    }
  }
  return out;
}

/**
 * BM25打分：query对docs集合，返回按分数降序的命中（score>0）。
 * docs数量级≤100（kb_dynamic单次读取80条），即建即用，无跨请求状态。
 */
export function bm25Search(query: string, docs: BM25Doc[]): BM25Hit[] {
  try {
    const qTerms = Array.from(new Set(tokenize(query)));
    if (qTerms.length === 0 || docs.length === 0) return [];

    // 建索引：每文档词频表 + 文档长度；DF表
    const docTf: Map<string, number>[] = [];
    const docLen: number[] = [];
    const df = new Map<string, number>();
    let totalLen = 0;
    for (const d of docs) {
      const tf = new Map<string, number>();
      const tokens = tokenize(d.text);
      docLen.push(tokens.length);
      totalLen += tokens.length;
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      tf.forEach((_v, t) => df.set(t, (df.get(t) || 0) + 1)); // forEach迭代（MapIterator直接for-of撞tsconfig target限制）
      docTf.push(tf);
    }
    const avgLen = totalLen / docs.length || 1;
    const N = docs.length;

    // 命中构成判据（2026-10-23两轮阈值调参收敛失败后转结构化，机理明确）：
    // ①ASCII词（ticker/缩写）=高熵唯一标识，命中1个即可信
    // ②中文bigram=单bigram是领域词（"板块""订单"跨主题假命中实锤），需≥2个不同bigram共现
    // ③单字不参与打分（"气"连接"天气/油气/量子"的假命中实锤）
    const qAsciiSet = new Set(tokenize(query).filter((t) => /[a-z0-9]/.test(t)));
    const qCnSet = new Set(tokenize(query).filter((t) => /[\u4e00-\u9fff]/.test(t) && t.length === 2));
    const qAscii = Array.from(qAsciiSet);
    const qCn = Array.from(qCnSet);

    const results: Array<{ id: string; score: number; asciiHits: number; cnHits: number }> = [];
    for (let i = 0; i < docs.length; i++) {
      let s = 0;
      let asciiHits = 0;
      const cnHitSet = new Set<string>();
      for (const t of qAscii) {
        const f = docTf[i].get(t);
        if (!f) continue;
        asciiHits += 1;
        const n = df.get(t) || 0;
        s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * docLen[i]) / avgLen)));
      }
      for (const t of qCn) {
        const f = docTf[i].get(t);
        if (!f) continue;
        cnHitSet.add(t);
        const n = df.get(t) || 0;
        s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * docLen[i]) / avgLen)));
      }
      const cnHits = cnHitSet.size;
      if (asciiHits >= 1 || cnHits >= 2) results.push({ id: docs[i].id, score: s, asciiHits, cnHits });
    }
    return results.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("[kb-bm25] 打分异常，回退双通道现状:", error instanceof Error ? error.message : error); return []; // 静默回退但必须留痕（429静默72h教训）
  }
}
