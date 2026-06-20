/**
 * META-ORCH-1161 COMPLIANCE-PAGES — self-serve-unsubscribe
 *
 * The PUBLIC, no-login opt-out endpoint behind the marketing-site /unsubscribe
 * page (https://www.usemingla.com/unsubscribe) and CAN-SPAM email footers.
 *
 * Accepts `{ email?, phone?, scope: 'marketing'|'all', token? }`:
 *   - email   — lowercased; produces an 'email' channel_suppressions row + a
 *               legacy marketing_unsubscribes (contact_email) row.
 *   - phone   — E.164; produces an 'sms' channel_suppressions row + a legacy
 *               marketing_unsubscribes (contact_phone) row.
 *   - scope   — 'marketing' (stop promos, keep transactional) or 'all'.
 *   - token   — OPTIONAL. When present (one-click email link), the HS256 signed
 *               unsubscribe token is verified and its recipient_email is used as
 *               the email contact, so the link works with no typing. A token is
 *               additive: the resolver still requires at least one valid contact.
 *
 * Writes via the service role (RLS is service-role-only for writes) to BOTH
 * suppression models so every downstream consumer honors it (see suppress.ts).
 * Idempotent: a re-submit tolerates the unique-violation and still returns 200.
 *
 * verify_jwt = false (config.toml) — this is an anon, no-login path by design
 * (CAN-SPAM: the page must work standalone). A lightweight per-IP sliding-window
 * throttle (mirrors record-consent: 12/min, fail-OPEN on a missing IP) blunts
 * cheap-burst abuse without requiring a JWT.
 *
 * Cross-refs:
 *   COPY:   Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md §4, §5.1
 *   SCHEMA: supabase/migrations/20261110000000_orch_1161_notification_foundation_tables.sql (channel_suppressions)
 *           supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql (marketing_unsubscribes)
 *   WRITER: ./suppress.ts (DB-write logic, behaviorally tested)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUnsubscribeToken } from "../_shared/marketingTokens.ts";
import {
  type SuppressionScope,
  writeSuppressions,
} from "./suppress.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Per-IP sliding-window throttle (mirrors record-consent §P2-1). Per-instance,
// in-memory; caps a single hot client's burst. Fail-OPEN on a missing IP.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_PER_WINDOW = 12; // a real opt-out is 1 call → 12/min is generous
const rateBuckets = new Map<string, number[]>();

function isRateLimited(ipKey: string | null): boolean {
  if (ipKey === null) return false;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateBuckets.get(ipKey) ?? []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    rateBuckets.set(ipKey, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(ipKey, hits);
  return false;
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

// E.164: leading +, 1 non-zero digit, up to 14 more digits.
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UnsubscribeRequest {
  email?: string | null;
  phone?: string | null;
  scope?: string | null;
  token?: string | null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Abuse guard BEFORE any parse/DB work.
  const requestIp = clientIp(req);
  if (isRateLimited(requestIp)) {
    console.warn("[self-serve-unsubscribe] rate-limited", { ip: requestIp });
    return new Response(
      JSON.stringify({ error: "rate_limited" }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
        },
      },
    );
  }

  let body: UnsubscribeRequest;
  try {
    body = (await req.json()) as UnsubscribeRequest;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // Scope: default to 'marketing' (the safe, narrow choice) if absent.
  const scope: SuppressionScope = body.scope === "all" ? "all" : "marketing";

  // Resolve the email contact: an explicit email OR a verified token's recipient.
  let email: string | null =
    typeof body.email === "string" && EMAIL_REGEX.test(body.email.trim())
      ? body.email.trim().toLowerCase()
      : null;

  const tokenRaw = typeof body.token === "string" ? body.token.trim() : "";
  if (tokenRaw.length > 0) {
    try {
      const payload = await verifyUnsubscribeToken(tokenRaw);
      // The token binds a recipient_email; honor it if no explicit email given,
      // and never let an invalid token silently no-op a one-click link.
      if (email === null && typeof payload.recipient_email === "string") {
        email = payload.recipient_email.trim().toLowerCase();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason.startsWith("unsubscribe_token_secret_missing")) {
        console.error("[self-serve-unsubscribe]", reason);
        return jsonResponse({ error: "server_misconfigured" }, 503);
      }
      // Bad/expired token with NO usable typed contact → tell the caller so the
      // page can fall back to the manual email/phone form (no silent failure).
      if (email === null) {
        return jsonResponse({ error: "invalid_token" }, 400);
      }
      // A typed email is present → proceed with it; the bad token is ignored.
    }
  }

  const phone: string | null =
    typeof body.phone === "string" && PHONE_REGEX.test(body.phone.trim())
      ? body.phone.trim()
      : null;

  if (email === null && phone === null) {
    return jsonResponse({ error: "at_least_one_contact_required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[self-serve-unsubscribe] missing SUPABASE_URL / service key");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const result = await writeSuppressions(admin, { email, phone, scope });
    return jsonResponse(
      {
        ok: true,
        scope,
        suppressed_email: email !== null,
        suppressed_phone: phone !== null,
        channel_suppressions_written: result.channelSuppressionsWritten,
        marketing_unsubscribes_written: result.marketingUnsubscribesWritten,
        already_suppressed: result.alreadySuppressed,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[self-serve-unsubscribe] suppression write failed", message);
    return jsonResponse({ error: "suppression_write_failed" }, 500);
  }
});
