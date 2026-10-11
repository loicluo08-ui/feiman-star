// 访客指纹ID（10/11 13:11逸翔令"修"：VPN绕过IP层监控——加设备指纹锚）
// 构成：UA+屏幕+色深+时区+语言+硬件并发+设备内存+Canvas渲染指纹 → SHA-256 → hex16
// 存储：cookie fx_vid（1年，middleware每请求可读=页面+API全覆盖）+ localStorage双保险（cookie被清时恢复）
// 边界（如实）：清浏览器数据/换浏览器/反指纹浏览器=新ID——与IP锚互补而非替代；
// VPN换节点换IP后vid不变 → 监控平台同访客归并+拉黑有效，这是本锚的全部目的
// 采集时机：invest页面首次加载（visitor-seed客户端组件挂layout），fire-and-forget不阻塞渲染

const COOKIE = "fx_vid";
const LS_KEY = "fx_vid_v1";

function hashHex(input: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(input))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16));
}

function canvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "nc";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 100, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("费曼星·fingerprint\u{1F511}", 2, 2);
    ctx.strokeStyle = "rgba(102,204,0,0.7)";
    ctx.arc(50, 20, 15, 0, Math.PI * 2, true);
    ctx.stroke();
    return canvas.toDataURL().slice(-64);
  } catch {
    return "nc";
  }
}

function setCookie(vid: string) {
  document.cookie = `${COOKIE}=${vid}; max-age=31536000; path=/; samesite=lax`;
}

function readCookie(): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function readCookieAnyCase(): string {
  // 防御：cookie名大小写敏感读不到时全量找（值格式hex16校验兜底）
  const all = document.cookie.split(";").map((s) => s.trim());
  const hit = all.find((s) => s.toLowerCase().startsWith(COOKIE.toLowerCase() + "="));
  if (!hit) return "";
  const v = decodeURIComponent(hit.slice(COOKIE.length + 1));
  return /^[0-9a-f]{16}$/.test(v) ? v : "";
}

export async function seedVisitorId(): Promise<string> {
  try {
    // 已有合法cookie → 补种localStorage后直接返回（幂等）
    const existing = readCookieAnyCase();
    if (existing) {
      try {
        if (localStorage.getItem(LS_KEY) !== existing) localStorage.setItem(LS_KEY, existing);
      } catch { /* localStorage不可用静默 */ }
      return existing;
    }
    // cookie丢了（被清/过期）→ localStorage恢复
    let restored = "";
    try {
      restored = localStorage.getItem(LS_KEY) || "";
    } catch { /* 静默 */ }
    if (/^[0-9a-f]{16}$/.test(restored)) {
      setCookie(restored);
      return restored;
    }
    // 首次：采集指纹特征（浏览器环境维度，不含任何个人内容）
    const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
    const traits = [
      navigator.userAgent,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "tz?",
      navigator.language || "lang?",
      (navigator.languages || []).join(","),
      String(nav.hardwareConcurrency || 0),
      String(nav.deviceMemory || 0),
      canvasFingerprint(),
    ].join("|");
    const vid = await hashHex(traits);
    setCookie(vid);
    try {
      localStorage.setItem(LS_KEY, vid);
    } catch { /* 静默 */ }
    return vid;
  } catch {
    return ""; // 指纹失败静默——监控降级回IP锚，不阻塞页面
  }
}
