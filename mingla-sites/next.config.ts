import type { NextConfig } from "next";
import { MINGLA_BUSINESS_ORIGIN } from "./src/lib/origins";

// One CSP string with one variable part, so the public policy and the preview
// policy can never drift in any dimension EXCEPT frame-ancestors.
const BASE_CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; frame-ancestors __FRAME_ANCESTORS__; base-uri 'none'; " +
  "form-action 'self' https://usemingla.com https://www.usemingla.com; object-src 'none'; " +
  "upgrade-insecure-requests";

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
        { key: "Content-Security-Policy", value: BASE_CSP.replace("__FRAME_ANCESTORS__", "'none'") },
      ],
    },
    {
      /*
       * #2830 — the private preview is the ONE page that may be framed, and
       * only by Business web, so the Website workspace can show the draft
       * beside the controls. Listed AFTER the catch-all so it overrides the
       * same header key for this path only; every public page keeps
       * `frame-ancestors 'none'`. The route itself is noindex and needs an
       * unguessable artifact key, so framing grants no reach that visiting the
       * URL did not already grant.
       */
      source: "/preview",
      headers: [
        { key: "Content-Security-Policy", value: BASE_CSP.replace("__FRAME_ANCESTORS__", `'self' ${MINGLA_BUSINESS_ORIGIN}`) },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store, private" },
      ],
    },
  ],
};

export default config;
