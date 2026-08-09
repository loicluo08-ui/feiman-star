"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SessionState =
  | { loading: true }
  | { loading: false; authenticated: false }
  | { loading: false; authenticated: true; phone?: string };

function maskPhone(phone?: string) {
  if (!phone) return "已登录";
  return phone.replace(/(\d{3})\d+(\d{4})$/, "$1****$2");
}

export function AccountPanel() {
  const [session, setSession] = useState<SessionState>({ loading: true });

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { authenticated?: boolean; user?: { phone?: string } }) => {
        if (!active) return;
        setSession(
          payload.authenticated
            ? { loading: false, authenticated: true, phone: payload.user?.phone }
            : { loading: false, authenticated: false },
        );
      })
      .catch(() => active && setSession({ loading: false, authenticated: false }));
    return () => { active = false; };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  if (session.loading) return <div className="h-10 animate-pulse rounded-lg bg-white/70" />;
  if (!session.authenticated) {
    return <Link href="/login" className="focus-ring block rounded-lg border border-[#e5e5e7] bg-white px-3 py-2.5 text-center text-sm font-medium">登录 / 注册</Link>;
  }

  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white p-3">
      <p className="truncate text-xs text-[#6e6e73]">{maskPhone(session.phone)}</p>
      <button type="button" onClick={logout} className="focus-ring mt-2 rounded text-xs font-medium text-[#1a1a1a] underline underline-offset-4">退出登录</button>
    </div>
  );
}
