"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 用户名门禁（10/2逸翔令：未填写名字不能访问）
 * 全屏盖层：首次访问（无fx_username）必须输入名字才能看到内容。
 * 保存→种1年cookie+localStorage镜像→放行。/lyx后台（token保护）不放门禁。
 * 边界：自称式无密码（冒充=统计噪音无数据权限）；API直访由意图分类兜底。
 */
const COOKIE_NAME = "fx_username";

function isValidName(v: string): boolean {
  return /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/.test(v);
}

export function UsernamePrompt() {
  const pathname = usePathname();
  const [gate, setGate] = useState<"checking" | "locked" | "open">("checking");
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

  if (gate !== "locked") return null;

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
    setGate("open");
  }

  const valid = isValidName(value.trim());

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--bg)] px-6">
      <div className={`w-full max-w-sm ${shake ? "animate-pulse" : ""}`}>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-[var(--text)]">费曼星</h1>
        <p className="mt-3 text-center text-sm leading-6 text-[var(--text-muted)]">
          输入你的名字，进入投资工作台。
          <br />
          名字用于访问统计识别，保存后1年内不再询问。
        </p>
        <div className="mt-6 flex flex-col gap-3">
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
