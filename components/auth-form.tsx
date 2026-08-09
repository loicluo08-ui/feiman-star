"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AuthFormProps = { mode: "login" | "register" };

function normalizePhone(value: string) {
  const compact = value.replace(/[\s-]/g, "");
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
  return compact;
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return payload.error ?? "请求失败，请稍后重试";
}

export function AuthForm({ mode }: AuthFormProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const normalizedPhone = normalizePhone(phone);
    try {
      if (step === "phone") {
        const response = await fetch("/api/auth/otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: normalizedPhone,
            createUser: isRegister,
          }),
        });
        if (!response.ok) throw new Error(await readError(response));
        setPhone(normalizedPhone);
        setStep("code");
        return;
      }

      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, token: code }),
      });
      if (!response.ok) throw new Error(await readError(response));

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

        <h1 className="text-2xl font-semibold tracking-tight">{isRegister ? "创建账户" : "登录费曼星"}</h1>
        <p className="mt-2 text-sm leading-6 text-[#8e8e93]">
          {step === "phone" ? "使用手机号接收验证码" : `验证码已发送至 ${phone}`}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {step === "phone" ? (
            <label className="block">
              <span className="mb-2 block text-sm font-medium">手机号</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="138 0000 0000"
                required
                className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 text-base outline-none transition-colors focus:border-[#1a1a1a]"
              />
              <span className="mt-2 block text-xs text-[#8e8e93]">中国大陆手机号可直接输入，其他地区请带国家区号。</span>
            </label>
          ) : (
            <label className="block">
              <span className="mb-2 block text-sm font-medium">6位验证码</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                pattern="\d{6}"
                required
                autoFocus
                className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 text-center text-lg tracking-[0.35em] outline-none transition-colors focus:border-[#1a1a1a]"
              />
            </label>
          )}

          {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="focus-ring h-12 w-full rounded-xl bg-[#1a1a1a] px-4 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "请稍候…" : step === "phone" ? "获取验证码" : isRegister ? "注册并登录" : "登录"}
          </button>

          {step === "code" ? (
            <button type="button" onClick={() => { setStep("phone"); setCode(""); setError(""); }} className="focus-ring w-full rounded-lg py-2 text-sm text-[#6e6e73]">
              更换手机号
            </button>
          ) : null}
        </form>

        <p className="mt-8 text-center text-sm text-[#8e8e93]">
          {isRegister ? "已有账户？" : "还没有账户？"}{" "}
          <Link href={isRegister ? "/login" : "/register"} className="focus-ring rounded font-medium text-[#1a1a1a] underline underline-offset-4">
            {isRegister ? "直接登录" : "立即注册"}
          </Link>
        </p>
      </section>
    </main>
  );
}
