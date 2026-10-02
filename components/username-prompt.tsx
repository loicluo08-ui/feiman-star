"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 用户名门禁（10/2逸翔令：未填写名字不能访问）——包裹式重构（P0-B修复）
 * 旧版问题：checking态渲染null=children照常挂载，数据请求已发出（"不能访问"语义不成立）
 * 新版：本组件包裹children——checking/locked状态children不渲染（数据零加载）
 * /lyx后台（token保护）不放门禁。自称式无密码（冒充=统计噪音，无数据权限）。
 */
const COOKIE_NAME = "fx_username";

function isValidName(v: string): boolean {
  return /^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,12}$/.test(v);
}

export function UsernameGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gate, setGate] = useState<"checking" | "locked" | "success" | "open">("checking");
  const [savedName, setSavedName] = useState("");
  const [value, setValue] = useState("");
  const [claimError, setClaimError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (pathname?.startsWith("/lyx")) return; // 后台token保护，不放门禁
    if (typeof window === "undefined") return;
    // P1-G修复：判断以cookie为准（cookie过期/清数据后必须重新注册，防静默丢名）；
    // localStorage只存"已关闭提示"的会话标记，不作为注册凭证
    if (document.cookie.includes(`${COOKIE_NAME}=`)) {
      setGate("open");
    } else {
      localStorage.removeItem("fx_username_set");
      setGate("locked");
    }
  }, [pathname]);

  async function save() {
    const v = value.trim();
    if (!isValidName(v)) {
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      return;
    }
    setSubmitting(true);
    try {
      // 唯一性裁决（10/2逸翔令：不能重名）——服务端登记，重名409+自动建议
      const res = await fetch("/api/invest/username-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.suggestion) {
        setValue(json.suggestion);
        setClaimError(`「${v}」已被使用，试试「${json.suggestion}」`);
        setShake(true);
        window.setTimeout(() => setShake(false), 400);
        return;
      }
      // 登记服务不可用：降级放行（可用性优先——监控无名字，功能不受影响）
      const finalName = (json.ok && json.name) || v;
      // 非HttpOnly（自称名字非敏感凭据）——与?setuser入口统一，门禁可检测
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(finalName)}; max-age=${365 * 24 * 3600}; path=/; samesite=lax`;
      // C1修复：cookie写入验证（禁cookie/存储满时种不上——不检测会死循环门禁）
      if (!document.cookie.includes(`${COOKIE_NAME}=`)) {
        setClaimError("浏览器已禁用Cookie，无法保存名字——请启用Cookie后重试");
        setSubmitting(false);
        return;
      }
      localStorage.setItem("fx_username_set", "1");
      setSavedName(finalName);
      setGate("success"); // 注册成功反馈：确认态1.4秒再进入
      window.setTimeout(() => setGate("open"), 1400);
    } catch {
      // 网络异常：降级放行
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value.trim())}; max-age=${365 * 24 * 3600}; path=/; samesite=lax`;
      localStorage.setItem("fx_username_set", "1");
      setSavedName(value.trim());
      setGate("success");
      window.setTimeout(() => setGate("open"), 1400);
    } finally {
      setSubmitting(false);
    }
  }

  // P1-D修复：/lyx直接放行（不渲染门禁也不拦截children）
  if (gate === "open" || pathname?.startsWith("/lyx")) {
    return <>{children}</>;
  }

  // P0-B修复：checking/locked/success状态children一律不渲染（数据零加载——"不能访问"数据语义成立）
  if (gate === "checking") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--background)]">
        <p className="text-sm text-[var(--text-muted)]">加载中…</p>
      </div>
    );
  }

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
            onKeyDown={(e) => e.key === "Enter" && valid && !submitting && save()}
            maxLength={12}
            autoFocus
            placeholder="你的名字（2-12字符）"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-base text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => void save()}
            disabled={!valid || submitting}
            className="w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
          >
            {submitting ? "登记中…" : "进入"}
          </button>
          {!valid && value.trim().length > 0 ? (
            <p className="text-center text-xs text-[var(--warning)]">名字需2-12个字符，仅限中文、字母、数字</p>
          ) : null}
          {claimError ? <p className="text-center text-xs text-[var(--warning)]">{claimError}</p> : null}
        </div>
        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          本工具为私人使用，访问记录仅用于统计
        </p>
      </div>
    </div>
  );
}
