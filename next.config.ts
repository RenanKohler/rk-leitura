import type { NextConfig } from "next";

/**
 * Cabecalhos de seguranca aplicados a todas as respostas.
 * Sao baratos e cobrem clickjacking, sniffing de MIME e vazamento de referer.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/**
 * Identificador do build (US-176): vai no endereco do service worker, que o
 * usa no nome dos caches. Cada deploy troca o worker e descarta os caches do
 * anterior. Na Vercel e o commit; fora dela, a hora do build.
 */
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || String(Date.now());

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
