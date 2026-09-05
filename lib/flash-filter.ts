/**
 * 快讯质量过滤（前端直连与服务端共用）
 * 服务端 route.ts 与客户端 page.tsx 都从金十/华尔街拉原始数据，
 * 过滤逻辑必须单源维护，否则客户端直连路径会绕过服务端过滤（9/5修复的教训）。
 */

export function stripHtml(html: string): string {
  return html
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
