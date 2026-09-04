import type { NextConfig } from "next";
import { API_CSP } from "./src/lib/csp";

/*
 * The Content-Security-Policy for every HTML route is built per request in
 * src/proxy.ts, because it carries a nonce. It deliberately is NOT set here as
 * well: two Content-Security-Policy headers on one response are enforced as
 * their intersection, so a static copy here would silently re-block the very
 * inline scripts the nonce exists to allow.
 */
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
    {
      // API routes are outside the proxy matcher, so they carry their own —
      // stricter — policy: JSON needs no scripts, styles, or framing.
      source: "/api/:path*",
      headers: [{ key: "Content-Security-Policy", value: API_CSP }],
    },
    {
      source: "/preview",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store, private" },
      ],
    },
  ],
};

export default config;
