import type { Metadata } from "next";
import { readAllLedger, readKbEntries } from "@/lib/supabase";

/**
 * 判断账本 · 公开只读页（9/18能力工程）
 *
 * 定位：能力的陈列馆——AI过去判断了什么、失效条件是什么、现在存活还是被证伪，
 * 全部公开可查。不藏错：invalidated记录与confirmed同等展示。
 * 数据：judgment_ledger（判断）+ kb_dynamic(kind=judgment_settle)（结算）——服务端聚合
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "判断账本",
  description: "费曼星AI判断的公开账本——每条判断带失效条件，机械结算，错了也公开",
};

type LedgerRow = {
  symbol: string;
  stance: string;
  key_level?: string;
  invalidation?: string;
  confidence?: string;
  date: string;
  ts?: string;
};

type SettleInfo = {
  result: "invalidated" | "alive";
  settle_price: number;
  level: number;
  direction: string;
  settled_at: string;
};

function stanceLabel(stance: string): string {
  if (/看多|做多|long|多头|买入/i.test(stance)) return "看多";
  if (/看空|做空|short|空头|卖出|规避/i.test(stance)) return "看空";
  return stance || "观察";
}

function parseSettle(content: string): SettleInfo | null {
  try {
    const obj = JSON.parse(content) as { kind?: string } & SettleInfo;
    if (obj.kind === "judgment_settle" && (obj.result === "invalidated" || obj.result === "alive")) {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

export default async function LedgerPage() {
  const [ledger, kbRows] = await Promise.all([readAllLedger(500), readKbEntries(300)]);

  const settleMap = new Map<string, SettleInfo>();
  for (const row of kbRows ?? []) {
    const info = parseSettle(row.content);
    if (info) {
      // row.content里没有symbol字段——从id回取：settle-{SYMBOL}-{date}
      const m = row.id.match(/^settle-([A-Za-z0-9.]+)-(\d{4}-\d{2}-\d{2})$/);
      if (m) settleMap.set(`${m[1]}|${m[2]}`, info);
    }
  }

  // 按(symbol,date)聚合展示：同键多条取最新ts
  const grouped = new Map<string, LedgerRow>();
  for (const r of ledger ?? []) {
    if (!r.symbol || !r.date) continue;
    const key = `${r.symbol}|${r.date}`;
    const prev = grouped.get(key);
    if (!prev || (prev.ts ?? "") < (r.ts ?? "")) grouped.set(key, r);
  }
  const items = Array.from(grouped.values()).sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));

  let invalidated = 0;
  let alive = 0;
  for (const it of items) {
    const s = settleMap.get(`${it.symbol}|${it.date}`);
    if (s?.result === "invalidated") invalidated += 1;
    else if (s?.result === "alive") alive += 1;
  }
  const settledCount = invalidated + alive;
  const surviveRate = settledCount > 0 ? Math.round((alive / settledCount) * 100) : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--text)]">判断账本</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
          AI每条判断都带失效条件，由程序按行情机械结算——不靠AI自评，不挑着展示。
          <span className="text-[var(--text)]">被证伪的判断同样公开</span>
          ，错的可见性就是这份账本的信任来源。
        </p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "判断总数", value: items.length },
          { label: "已结算", value: settledCount },
          { label: "失效触发", value: invalidated, tone: "down" as const },
          { label: "存活率", value: surviveRate == null ? "—" : `${surviveRate}%`, tone: "up" as const },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="text-2xl font-semibold text-[var(--text)]">{s.value}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center text-sm text-[var(--text-muted)]">
          账本还没有判断记录。在投资对话里让AI给出带失效条件的判断后，这里会自动出现。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((it) => {
            const settle = settleMap.get(`${it.symbol}|${it.date}`);
            return (
              <article
                key={`${it.symbol}-${it.date}-${it.ts ?? ""}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-[var(--text)]">{it.symbol}</span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      stanceLabel(it.stance) === "看多"
                        ? "bg-red-500/10 text-red-500"
                        : stanceLabel(it.stance) === "看空"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "bg-[var(--border)] text-[var(--text-muted)]"
                    }`}
                  >
                    {stanceLabel(it.stance)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{it.date}</span>
                  {settle ? (
                    <span
                      className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${
                        settle.result === "invalidated"
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-sky-500/10 text-sky-500"
                      }`}
                    >
                      {settle.result === "invalidated" ? "✗ 已证伪" : "✓ 存活中"}
                    </span>
                  ) : (
                    <span className="ml-auto rounded-md bg-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                      观察中
                    </span>
                  )}
                </div>
                {it.invalidation ? (
                  <p className="mt-2 text-sm leading-6 text-[var(--text)]">
                    <span className="text-[var(--text-muted)]">失效条件：</span>
                    {it.invalidation}
                  </p>
                ) : null}
                {it.key_level ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">关键位：{it.key_level}</p>
                ) : null}
                {settle ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    结算价 <span className="text-[var(--text)]">{settle.settle_price}</span> ·
                    失效位 {settle.level} · {settle.settled_at.slice(0, 10)}由程序机械核验
                  </p>
                ) : null}
                {it.confidence ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">信心度：{it.confidence}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <footer className="mt-10 border-t border-[var(--border)] pt-4 text-xs leading-6 text-[var(--text-muted)]">
        结算机制：失效条件由AI生成判断时一并给出（跌破/突破+具体价位），程序每日按行情自动核验。
        存活≠正确，只代表失效条件未被触发；被证伪的判断保留在账本中作为校准依据。
        本页不构成投资建议。
      </footer>
    </div>
  );
}
