"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type WatchItem = {
  code: string;
  market: string;
  name?: string;
  price?: number;
  changePct?: number;
  amount?: number;
  pe?: number;
};

const STORAGE_KEY = "feimanstar_watchlist";

export default function DashboardPage() {
  const [list, setList] = useState<WatchItem[]>([]);
  const [code, setCode] = useState("");
  const [market, setMarket] = useState("sh");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载本地存储
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setList(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, []);

  // 保存到本地存储
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }, [list]);

  // 定时刷新行情
  async function refreshPrices(items: WatchItem[]) {
    if (!items.length) return;
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const res = await fetch(`/api/invest/stock?code=${item.code}&market=${item.market}`);
          if (!res.ok) return item;
          const json = await res.json();
          const q = json.data?.quote;
          if (!q) return item;
          return {
            ...item,
            name: q.f58 ? String(q.f58) : item.name,
            price: num(q.f43),
            changePct: num(q.f170),
            amount: num(q.f47),
            pe: num(q.f162),
          };
        } catch {
          return item;
        }
      }),
    );
    setList(results);
  }

  useEffect(() => {
    if (list.length === 0) return;
    refreshPrices(list);
    timerRef.current = setInterval(() => refreshPrices(list), 15000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((i) => i.code).join(",")]);

  function add(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c || list.some((i) => i.code === c)) return;
    const newItem: WatchItem = { code: c, market };
    setList((prev) => [...prev, newItem]);
    setCode("");
  }

  function remove(code: string) {
    setList((prev) => prev.filter((i) => i.code !== code));
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <h1 className="text-2xl font-semibold tracking-tight">自选看板</h1>
      <p className="mt-2 text-sm text-[#6e6e73]">添加自选股，每15秒自动刷新行情。</p>

      {/* 添加 */}
      <form onSubmit={add} className="mt-6 flex flex-wrap gap-3">
        <select
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          className="rounded-xl border border-[#d1d1d6] px-3 py-2.5 text-sm outline-none focus:border-[#1a1a1a]"
        >
          <option value="sh">沪市</option>
          <option value="sz">深市</option>
          <option value="bj">北证</option>
        </select>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="股票代码"
          maxLength={6}
          className="min-w-[160px] flex-1 rounded-xl border border-[#d1d1d6] px-4 py-2.5 text-sm outline-none focus:border-[#1a1a1a]"
        />
        <button
          type="submit"
          disabled={!code.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          添加
        </button>
      </form>

      {/* 列表 */}
      {list.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-[#d1d1d6] p-10 text-center">
          <p className="text-sm text-[#8e8e93]">还没有自选股，添加一个开始监控。</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e7] bg-[#f7f7f8] text-left text-xs text-[#8e8e93]">
                <th className="px-4 py-3 font-medium">名称/代码</th>
                <th className="px-4 py-3 text-right font-medium">最新价</th>
                <th className="px-4 py-3 text-right font-medium">涨跌幅</th>
                <th className="px-4 py-3 text-right font-medium">成交额</th>
                <th className="px-4 py-3 text-right font-medium">PE</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e5e7]">
              {list.map((item) => (
                <tr key={item.code} className="transition-colors hover:bg-[#f7f7f8]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{item.name ?? item.code}</div>
                    <div className="text-xs text-[#8e8e93]">{item.code}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.price != null ? item.price.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.changePct != null ? (
                      <span className={item.changePct >= 0 ? "text-red-600" : "text-green-600"}>
                        {item.changePct >= 0 ? "+" : ""}
                        {item.changePct.toFixed(2)}%
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#6e6e73]">
                    {fmtAmt(item.amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#6e6e73]">
                    {item.pe != null ? item.pe.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => remove(item.code)}
                      className="text-xs text-[#8e8e93] transition-colors hover:text-red-600"
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 text-xs text-[#8e8e93]">
        行情数据来自东方财富，15秒自动刷新。仅供研究参考，不构成投资建议。
      </p>
    </div>
  );
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function fmtAmt(v?: number): string {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}
