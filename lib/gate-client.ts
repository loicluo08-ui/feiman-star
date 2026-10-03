"use client";

/**
 * 前端共享口令助手（10/3安全审计P0配套，服务端lib/gate.ts的对端）
 *
 * 行为：请求自动带localStorage里的fx_gate_token；被401 gate_required拦下时prompt一次→
 * 存储→自动重试。设备一次性输入，此后无感。换口令=清key刷新页。
 *
 * 用法：把受闸端点的 fetch("/api/...") 换成 gateFetch("/api/...")，其余参数不变。
 * 只用于受闸端点（AI+judgment写入+team-upload）；数据端点继续用原fetch。
 */
const KEY = "fx_gate_token";

export function getGateToken(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function clearGateToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 隐私模式等场景静默
  }
}

export async function gateFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getGateToken();
  if (token) headers.set("x-gate-token", token);

  let res = await fetch(input, { ...init, headers });
  if (res.status !== 401) return res;

  let body: { error?: string } | null = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  if (!body || body.error !== "gate_required") return res;

  let entered = "";
  try {
    entered = (window.prompt("费曼星访问口令（本设备只需输入一次）") || "").trim();
  } catch {
    entered = "";
  }
  if (!entered) return res; // 用户取消：返回原401，由调用方按失败处理

  try {
    localStorage.setItem(KEY, entered);
  } catch {
    // 存储失败也继续本次会话内使用
  }
  headers.set("x-gate-token", entered);
  return fetch(input, { ...init, headers });
}
