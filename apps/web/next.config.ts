import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const dataMode = process.env.NEXT_PUBLIC_DATA_MODE === "fixtures" ? "fixtures" : "live";
const agentApi = process.env.NEXT_PUBLIC_AGENT_API || "https://api.yinglong-agent.tech";

// The app must work from mainland China: no third-party origin is ever contacted at runtime.
// The only other origin allowed is the agent API itself (live mode).
const connectSrc = ["'self'"];
if (dataMode === "live") connectSrc.push(new URL(agentApi).origin);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc.join(" ")}`,
  "worker-src 'self' blob:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Do not write an AGENTS.md into the project tree.
  agentRules: false,
  devIndicators: false,
  // Separate output for the fixtures build used by Playwright (NEXT_DIST_DIR=.next-e2e).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@yinglong/ui"],
  images: {
    dangerouslyAllowSVG: false,
    formats: ["image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)",
          },
        ],
      },
      {
        source: "/fonts/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default config;
