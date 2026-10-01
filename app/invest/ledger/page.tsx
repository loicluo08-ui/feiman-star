import { Suspense } from "react";
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
  time_box?: number | null;
  env_tags?: string | null;
  failure_strictness?: string | null;
  exec_plan?: string | null;
  corrects?: string | null;
};

type SettleInfo = {
  result: "invalidated" | "alive" | "signal_done" | "expired";
  settle_price: number;
  level: number;
  direction: string;
  settled_at: string;
  time_box?: number | null;
  env_tags?: string | null;
  exec_plan?: string | null;
  failure_strictness?: string | null;
};

// Schema V2结算态语义（宪法2：错账=数据点+失效条件复盘+环境标签，不是红字惩罚）
const SETTLE_LABEL: Record<SettleInfo["result"], string> = {
  invalidated: "✗ 失效触发（数据点）",
  alive: "✓ 存活中",
  signal_done: "⊘ 信号完成",
  expired: "⏱ 时间盒到期",
};

function stanceLabel(stance: string): string {
  if (/看多|做多|long|多头|买入/i.test(stance)) return "看多";
  if (/看空|做空|short|空头|卖出|规避/i.test(stance)) return "看空";
  return stance || "观察";
}

function parseSettle(content: string): SettleInfo | null {
  try {
    const obj = JSON.parse(content) as { kind?: string } & SettleInfo;
    if (obj.kind === "judgment_settle" && ["invalidated", "alive", "signal_done", "expired"].includes(obj.result)) {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

// 10/1 P2-7修复：页头+骨架屏立即渲染（TTFB不受Supabase查询拖累——全站最慢2.3s实锤），
// 数据聚合+列表包Suspense流式补齐；footer保留在数据区尾部（流式后自然出现）
export default function LedgerPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">判断账本</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
          AI每条判断都带失效条件，由程序按行情机械结算——不靠AI自评，不挑着展示。
          <span className="text-[var(--text)]">被证伪的判断同样公开</span>
          ，错的可见性就是这份账本的信任来源。
        </p>
      </header>
      <Suspense fallback={<LedgerSkeleton />}>
        <LedgerData />
      </Suspense>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="h-8 w-12 rounded bg-[var(--surface-muted)]" />
            <div className="mt-2 h-3 w-20 rounded bg-[var(--surface-muted)]" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <div className="h-4 w-40 rounded bg-[var(--surface-muted)]" />
            <div className="mt-3 h-3 w-full rounded bg-[var(--surface-muted)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function LedgerData() {
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
  let signalDone = 0;
  let expired = 0;
  for (const it of items) {
    const s = settleMap.get(`${it.symbol}|${it.date}`);
    if (s?.result === "invalidated") invalidated += 1;
    else if (s?.result === "alive") alive += 1;
    else if (s?.result === "signal_done") signalDone += 1;
    else if (s?.result === "expired") expired += 1;
  }
  const settledCount = invalidated + alive + signalDone + expired;
  const surviveRate = invalidated + alive > 0 ? Math.round((alive / (invalidated + alive)) * 100) : null;
  const watching = items.length - settledCount;

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "判断总数", value: items.length },
          { label: "失效触发（数据点）", value: invalidated },
          { label: "存活率（失效位核验）", value: surviveRate == null ? "—" : `${surviveRate}%` },
          { label: "信号完成", value: signalDone },
          { label: "时间盒到期", value: expired },
          { label: "观察中", value: Math.max(watching, 0) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums text-[var(--text)]">{s.value}</div>
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
            const isInvalidated = settle?.result === "invalidated";
            const settleStyle =
              settle?.result === "invalidated"
                ? "bg-[var(--warning-bg)] text-[var(--warning)]"
                : settle?.result === "alive"
                  ? "bg-[var(--accent-surface)] text-[var(--accent)]"
                  : "bg-[var(--border)] text-[var(--text-muted)]";
            const envTags = (settle?.env_tags ?? it.env_tags ?? "").split(/[,，]/).filter(Boolean);
            return (
              <article
                key={`${it.symbol}-${it.date}-${it.ts ?? ""}`}
                className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 ${
                  isInvalidated ? "border-l-2 border-l-[var(--warning)]" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-[var(--text)]">{it.symbol}</span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      stanceLabel(it.stance) === "看多"
                        ? "bg-[var(--positive-bg)] text-[var(--positive)]"
                        : stanceLabel(it.stance) === "看空"
                          ? "bg-[var(--negative-bg)] text-[var(--negative)]"
                          : "bg-[var(--border)] text-[var(--text-muted)]"
                    }`}
                  >
                    {stanceLabel(it.stance)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{it.date}</span>
                  {it.time_box ? (
                    <span className="rounded-md bg-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                      时间盒{it.time_box}日
                    </span>
                  ) : null}
                  {settle ? (
                    <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${settleStyle}`}>
                      {SETTLE_LABEL[settle.result]}
                    </span>
                  ) : (
                    <span className="ml-auto rounded-md bg-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                      观察中
                    </span>
                  )}
                </div>
                {envTags.length > 0 ? (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {envTags.map((t) => (
                      <span key={t} className="rounded bg-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
                        {t}
                      </span>
                    ))}
                  </p>
                ) : null}
                {it.invalidation ? (
                  <p className="mt-2 text-sm leading-6 text-[var(--text)]">
                    <span className="text-[var(--text-muted)]">失效条件：</span>
                    {it.invalidation}
                  </p>
                ) : null}
                {it.key_level ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">关键位：{it.key_level}</p>
                ) : null}
                {it.exec_plan ? (
                  <p className="mt-1 text-xs leading-6 text-[var(--text-muted)]">执行层：{it.exec_plan}</p>
                ) : null}
                {settle ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    结算价 <span className="font-medium tabular-nums text-[var(--text)]">{settle.settle_price}</span> ·
                    失效位 <span className="tabular-nums">{settle.level}</span> · {settle.settled_at.slice(0, 10)}由程序机械核验
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
    </>
  );
}
