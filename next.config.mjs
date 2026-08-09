/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
    outputFileTracingIncludes: {
      "/api/upload": ["./node_modules/@napi-rs/canvas*/**/*"],
    },
  },
};

export default nextConfig;
