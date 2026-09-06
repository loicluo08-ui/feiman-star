/** @type {import('next').NextConfig} */
import { fileURLToPath } from "url";
// workspace root显式锚定（9/6修复）：/home/z下的流浪package-lock.json（8/19遗留）会把
// Next 15的root推断拉到/home/z，page data阶段报PageNotFoundError: /_document。
// 显式声明root=本目录，与流浪lockfile解耦
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig = {
  outputFileTracingRoot: projectRoot,
  reactStrictMode: true,
  async headers() {
    const scriptPolicy = process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; ${scriptPolicy} https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://www.jin10.com https://qt.gtimg.cn https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
    outputFileTracingIncludes: {
      "/api/upload": ["./node_modules/@napi-rs/canvas*/**/*"],
    },
  },
};

export default nextConfig;
