// 动态知识库层：与feimanstar-kb.ts静态框架层相对的"自动生长层"。
// 数据流：scripts/kb_grow.mjs（每日cron自动采集）→ data/kb_dynamic.json → route注入
// 设计原则：快照类条目必须带expires（数据会腐烂，30天强制过期）；
// 注入按关键词命中+新鲜度排序，不注入过期条目——KB永不过时是靠机制不是靠人工

import rawDynamic from "@/data/kb_dynamic.json";

export interface DynamicEntry {
  id: string;
  type: "data_snapshot" | "insight" | "gap";
  keywords: string[];
  content: string;
  source: string;
  created: string;
  expires?: string;
}

const raw = rawDynamic as { entries: DynamicEntry[] };

export function selectDynamicKB(
  userText: string,
  maxChars = 4000
): { block: string; count: number } {
  try {
    const now = new Date().toISOString().slice(0, 10);
    const q = (userText || "").toLowerCase();
    const list = raw.entries || [];
    const picked: DynamicEntry[] = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.expires && e.expires < now) continue;
      const kws = e.keywords || [];
      let hit = false;
      for (let j = 0; j < kws.length; j++) {
        if (q.indexOf(kws[j].toLowerCase()) >= 0) {
          hit = true;
          break;
        }
      }
      if (hit) picked.push(e);
    }
    picked.sort(function (a, b) {
      return a.created < b.created ? 1 : -1;
    });
    const parts: string[] = [];
    let used = 0;
    for (let i = 0; i < picked.length && used < maxChars; i++) {
      parts.push("- " + picked[i].content);
      used += picked[i].content.length;
    }
    if (parts.length === 0) return { block: "", count: 0 };
    return {
      block:
        "\n\n【动态知识层（每日自动采集沉淀，引用时注明数据日期）】\n" +
        parts.join("\n"),
      count: parts.length,
    };
  } catch {
    return { block: "", count: 0 };
  }
}
