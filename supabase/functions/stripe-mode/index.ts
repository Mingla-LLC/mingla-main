/**
 * stripe-mode — public edge fn that reports the Supabase Stripe mode.
 *
 * ORCH-1056. Anonymous / no-auth — the answer is also discoverable from the
 * bundled publishable key on the client (pk_test_ vs pk_live_). The point
 * of this endpoint is to let the client boot handshake catch backend/frontend
 * mode drift BEFORE it silently collapses the Stripe Connect embedded iframe
 * (the failure that motivated this whole ORCH on 2026-06-02).
 *
 * Response:
 *   {
 *     "mode": "test" | "live",
 *     "publishablePrefix": "pk_test_" | "pk_live_"
 *   }
 *
 * Stripe docs:
 *   - https://docs.stripe.com/keys (publishable key prefixes)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  resolvePublishablePrefix,
  resolveStripeMode,
} from "../_shared/stripeMode.ts";

// CORS: business.usemingla.com (prod), *.vercel.app (Vercel previews), and
// localhost during dev. Matches the pattern used by other public edge fns
// (e.g. check-launch-city). Echo the request Origin when it matches so that
// authenticated browsers honor the Set-Cookie path the handshake uses.
const ALLOWED_ORIGIN_PATTERNS: ReadonlyArray<RegExp> = [
  /^https:\/\/business\.usemingla\.com$/,
  /^https:\/\/[^.]+\.vercel\.app$/,
  /^https:\/\/usemingla\.com$/,
  /^https:\/\/www\.usemingla\.com$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

function buildCorsHeaders(originHeader: string | null): HeadersInit {
  const origin = originHeader ?? "";
  const matched = ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  return {
    "Access-Control-Allow-Origin": matched ? origin : "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
  };
}

serve((req) => {
  const cors = buildCorsHeaders(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
  try {
    const mode = resolveStripeMode();
    const publishablePrefix = resolvePublishablePrefix();
    return new Response(
      JSON.stringify({ mode, publishablePrefix }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown_error";
    console.error("[stripe-mode] resolve failed:", detail);
    return new Response(
      JSON.stringify({ error: "stripe_mode_unconfigured", detail }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
});
