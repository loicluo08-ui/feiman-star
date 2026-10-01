"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 用户名门禁（10/2逸翔令：未填写名字不能访问 + 注册成功反馈）
 * 全屏盖层：首次访问（无fx_username）必须输入名字，保存显示成功态1.4秒再进入。
 * /lyx后台（token保护）不放门禁。自称式无密码（冒充=统计噪音，无数据权限）。
 */
const COOKIE_NAME = "fx_username";

function isValidName(v: string): boolean {
  return /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/.test(v);
}

export function UsernamePrompt() {
  const pathname = usePathname();
  const [gate, setGate] = useState<"checking" | "locked" | "success" | "open">("checking");
  const [savedName, setSavedName] = useState("");
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (pathname?.startsWith("/lyx")) return; // 后台token保护，不放门禁
    if (typeof window === "undefined") return;
    if (localStorage.getItem("fx_username_set") || document.cookie.includes(`${COOKIE_NAME}=`)) {
      setGate("open");
      localStorage.setItem("fx_username_set", "1");
    } else {
      setGate("locked");
    }
  }, [pathname]);

  function save() {
    const v = value.trim();
    if (!isValidName(v)) {
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      return;
    }
    // 种1年cookie（非HttpOnly——自称式名字非敏感凭据，前端可写）
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(v)}; max-age=${365 * 24 * 3600}; path=/; samesite=lax`;
    localStorage.setItem("fx_username_set", "1");
    localStorage.setItem("fx_username", v);
    setSavedName(v);
    setGate("success"); // 注册成功反馈（10/2逸翔令）：确认态1.4秒再进入
    window.setTimeout(() => setGate("open"), 1400);
  }

  if (gate === "open" || gate === "checking") return null;

  if (gate === "success") {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-3 px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--positive-bg)] text-2xl text-[var(--positive)]">✓</div>
          <p className="text-lg font-semibold text-[var(--text)]">已注册：{savedName}</p>
          <p className="text-sm text-[var(--text-muted)]">访问记录将以这个名字保存，正在进入…</p>
        </div>
      </div>
    );
  }

  const valid = isValidName(value.trim());
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--background)] px-6">
      <div className={`w-full max-w-sm ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
        <p className="mb-1 text-center text-2xl font-semibold tracking-tight text-[var(--text)]">费曼星</p>
        <p className="mb-8 text-center text-sm text-[var(--text-muted)]">请输入你的名字开始使用——访问记录将以它保存</p>
        <div className="flex flex-col gap-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            maxLength={12}
            autoFocus
            placeholder="你的名字（2-12字符）"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-base text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={save}
            disabled={!valid}
            className="w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
          >
            进入
          </button>
          {!valid && value.trim().length > 0 ? (
            <p className="text-center text-xs text-[var(--warning)]">名字需2-12个字符，仅限中文、字母、数字</p>
          ) : null}
        </div>
        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          本工具为私人使用，访问记录仅用于统计
        </p>
      </div>
    </div>
  );
}
