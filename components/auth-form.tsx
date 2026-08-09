"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AuthFormProps = { mode: "login" | "register" };

async function readError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? "请求失败，请稍后重试";
}

export function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);
  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (isRegister && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(await readError(response));

      const payload = (await response.json()) as { requiresEmailConfirmation?: boolean };
      if (payload.requiresEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/chat");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f8] px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[#e5e5e7] bg-white p-7 shadow-sm sm:p-9">
        <Link href="/" className="focus-ring mb-8 inline-flex items-center gap-3 rounded-lg">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#1a1a1a] text-sm font-semibold text-white">费</span>
          <span>
            <span className="block text-sm font-semibold">费曼星</span>
            <span className="block text-xs text-[#8e8e93]">AI 工具平台</span>
          </span>
        </Link>

        {confirmationSent ? (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">请验证您的邮箱</h1>
            <p className="mt-3 text-sm leading-6 text-[#6e6e73]">
              确认邮件已发送至 {email}。完成邮箱验证后，请返回登录。
            </p>
            <Link href="/login" className="focus-ring mt-8 block h-12 rounded-xl bg-[#1a1a1a] px-4 text-center text-sm font-medium leading-[3rem] text-white">
              返回登录
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{isRegister ? "创建账户" : "登录费曼星"}</h1>
            <p className="mt-2 text-sm leading-6 text-[#8e8e93]">使用邮箱和密码{isRegister ? "注册" : "登录"}</p>

            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="name@example.com"
                  required
                  maxLength={254}
                  className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 text-base outline-none transition-colors focus:border-[#1a1a1a]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  placeholder="至少8位"
                  required
                  minLength={8}
                  maxLength={72}
                  className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 text-base outline-none transition-colors focus:border-[#1a1a1a]"
                />
              </label>

              {isRegister ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium">确认密码</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    required
                    minLength={8}
                    maxLength={72}
                    className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 text-base outline-none transition-colors focus:border-[#1a1a1a]"
                  />
                </label>
              ) : null}

              {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

              <button
                type="submit"
                disabled={loading}
                className="focus-ring h-12 w-full rounded-xl bg-[#1a1a1a] px-4 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "请稍候…" : isRegister ? "注册" : "登录"}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-[#8e8e93]">
              {isRegister ? "已有账户？" : "还没有账户？"}{" "}
              <Link href={isRegister ? "/login" : "/register"} className="focus-ring rounded font-medium text-[#1a1a1a] underline underline-offset-4">
                {isRegister ? "直接登录" : "立即注册"}
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
