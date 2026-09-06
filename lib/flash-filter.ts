/**
 * 快讯质量过滤（前端直连与服务端共用）
 * 服务端 route.ts 与客户端 page.tsx 都从金十/华尔街拉原始数据，
 * 过滤逻辑必须单源维护，否则客户端直连路径会绕过服务端过滤（9/5修复的教训）。
 */

export function stripHtml(html: string): string {
  // 9/6红队复核：`<[^>]+>`对纯"<"输入是二次方回溯（10K字符36ms→15K 80ms实测）
  // 超长输入先截断（正常快讯全文<1KB，5KB帽只对对抗输入生效）
  const text = html.length > 5000 ? html.slice(0, 5000) : html;
  return text
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?b>/g, "")
    .replace(/<\/?strong>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

export function isLowQuality(content: string): boolean {
  if (!content || content.length < 8) return true;
  if (/扫码|加微信|进群|限时|优惠|点击链接/.test(content)) return true;
  if (/笔者认为|我们认为|小编觉得/.test(content)) return true;
  return false;
}

export function isEnglishDominant(text: string): boolean {
  if (!text || text.length < 10) return false;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  // 中文字符占比<15%且英文字母≥30 → 英文主导（阈值30：拦截短英文快讯，如49字母的CENTCOM条；中文快讯夹少量英文缩写不受影响）
  return chinese / text.length < 0.15 && letters >= 30;
}

/** 合并过滤：质量+英文，供直连数据在渲染前调用 */
export function filterFlashItems<T extends { content_text?: string; content: string }>(items: T[]): T[] {
  return items.filter((i) => !isLowQuality(i.content) && !isEnglishDominant(i.content_text ?? i.content));
}

// ── 跨源去重（9/6红队D发现6收紧版，服务端route与客户端page共用） ──

/** 归一化：剥【】壳/金十讯头/英文/非数字汉字 */
export function normalizeForDedup(content: string): string {
  let t = content.replace(/【[^】]*】/g, "");
  t = t.replace(/金十数据\d{1,2}月\d{1,2}日讯[，,]?/g, "");
  t = t.replace(/[A-Za-z]+/g, "");
  t = t.replace(/[^0-9\u4e00-\u9fff]/g, "");
  return t;
}

/**
 * 判重规则（收紧后）：
 * R1 归一化全等 → 丢新条
 * R2 一方为另一方前缀且重叠≥12字 → 丢短版；新条更长时升级替换（保留增量信息，时间戳取较新）
 * R3 开头22字全等（跨源同事件通稿——22字为台风错位案例实测公共前缀；
 *     非农"增加16万vs21万人"类数字差在第14字内分叉，不受影响）→ 同R2升级策略
 * R4 开头30字全等 → 同R2
 *
 * 已删除旧条件"开头14字被任意包含"——摘要类条目（如"周六重要消息汇总"）会吞掉
 * 单条新闻（9/5线上30条实测4对误杀）。误杀优先级高于漏杀：宁重复展示，不静默丢真信息。
 * 已知漏杀（接受）：同事件加"快讯："等前缀仍会绕过——重复展示无害。
 */
export function dedupFlashItems<T extends { content_text?: string; content: string; timestamp: number }>(
  items: T[],
): T[] {
  const normTexts: string[] = [];
  const kept: T[] = [];
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);

  for (const item of sorted) {
    const t = normalizeForDedup(item.content_text ?? item.content);

    // 归一化后<6字的短讯（剥壳剩空壳）直接保留不参与判重，防误杀（原逻辑保留）
    if (t.length < 6) {
      kept.push(item);
      normTexts.push(t);
      continue;
    }

    let verdict: "dup" | "upgrade" | null = null;
    let upgradeIndex = -1;

    for (let i = 0; i < normTexts.length; i++) {
      const prev = normTexts[i];
      if (prev === t) {
        verdict = "dup";
        break;
      }
      const isPrefix =
        Math.min(prev.length, t.length) >= 12 && (prev.startsWith(t) || t.startsWith(prev));
      const isStart22 = t.length >= 22 && prev.length >= 22 && t.slice(0, 22) === prev.slice(0, 22);
      const isStart30 = t.slice(0, 30) === prev.slice(0, 30);
      if (isPrefix || isStart22 || isStart30) {
        // 新条更长=信息更全 → 升级替换；否则丢弃新条（旧条已覆盖）
        if (t.length > prev.length) {
          verdict = "upgrade";
          upgradeIndex = i;
        } else {
          verdict = "dup";
        }
        break;
      }
    }

    if (verdict === "upgrade") {
      const old = kept[upgradeIndex];
      kept[upgradeIndex] = { ...item, timestamp: Math.max(item.timestamp, old.timestamp) };
      normTexts[upgradeIndex] = t;
      continue;
    }
    if (verdict === "dup") continue;

    kept.push(item);
    normTexts.push(t);
  }

  return kept;
}
