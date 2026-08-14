"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type WatchItem = {
  code: string;
  name?: string;
  price?: number;
  changePct?: number;
  volume?: number;
  marketCap?: number;
};

const STORAGE_KEY = "feimanstar_us_watchlist";

export default function DashboardPage() {
  const [list, setList] = useState<WatchItem[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }, [list]);

  async function refreshPrices(items: WatchItem[]) {
    if (items.length === 0) return;
    const results = await Promise.allSettled(
      items.map(async (item) => {
        const res = await fetch(`/api/invest/stock?code=${encodeURIComponent(item.code)}`);
        if (!res.ok) throw new Error("fail");
        const json = await res.json();
        return json.data as WatchItem;
      }),
    );
    setList((prev) =>
      prev.map((item, i) => {
        const result = results[i];
        if (result?.status === "fulfilled") {
          return {
            ...item,
            name: result.value.name,
            price: result.value.price,
            changePct: result.value.changePct,
            volume: result.value.volume,
            marketCap: result.value.marketCap,
          };
        }
        return item;
      }),
    );
  }

  useEffect(() => {
    if (list.length > 0) {
      refreshPrices(list);
      timerRef.current = setInterval(() => refreshPrices(list), 15000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((i) => i.code).join(",")]);

  function add(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c || list.some((i) => i.code === c)) return;
    setLoading(true);
    setError("");

    fetch(`/api/invest/stock?code=${encodeURIComponent(c)}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "未找到");
        }
        return res.json();
      })
      .then((json) => {
        const d = json.data as WatchItem;
        setList((prev) => [...prev, { code: d.code, name: d.name, price: d.price, changePct: d.changePct, volume: d.volume, marketCap: d.marketCap }]);
        setCode("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "添加失败"))
      .finally(() => setLoading(false));
  }

  function remove(c: string) {
    setList((prev) => prev.filter((i) => i.code !== c));
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">自选看板</h1>
      <p className="mt-2 text-sm text-[#6e6e73]">美股自选股实时监控，15秒自动刷新。</p>

      <form onSubmit={add} className="mt-8 flex gap-2.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="输入美股代码，如 AAPL"
          maxLength={6}
          className="flex-1 rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm uppercase outline-none focus:border-[#1a1a1a]"
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "添加中…" : "添加"}
        </button>
      </form>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {list.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-[#d1d1d6] py-16 text-center">
          <p className="text-sm text-[#8e8e93]">还没有自选股，输入代码添加</p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e7] bg-[#f7f7f8]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[#8e8e93]">代码</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#8e8e93]">名称</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#8e8e93]">现价</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#8e8e93]">涨跌%</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#8e8e93]">市值</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.code} className="border-b border-[#f2f2f3] last:border-0">
                  <td className="px-4 py-3 text-sm font-medium">{item.code}</td>
                  <td className="px-4 py-3 text-sm text-[#6e6e73]">{item.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtPrice(item.price)}</td>
                  <td className={`px-4 py-3 text-right text-sm tabular-nums ${item.changePct != null && item.changePct >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {item.changePct != null ? `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-[#6e6e73]">{fmtAmt(item.marketCap)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(item.code)} className="text-xs text-[#8e8e93] transition-colors hover:text-red-600">
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 text-xs text-[#8e8e93]">行情数据来自Yahoo Finance，15秒自动刷新。仅供研究参考，不构成投资建议。</p>
    </div>
  );
}

function fmtPrice(v?: number): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtAmt(v?: number): string {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}
