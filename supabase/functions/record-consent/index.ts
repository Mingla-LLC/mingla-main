/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — record-consent
 *
 * The SHARED, surface-agnostic consent writer for the bundled-mandatory consent
 * gate (DEC-186). Both consent-capture surfaces call this one function:
 *   - S2 consumer onboarding (app-mobile, source='onboarding', authenticated)
 *   - S3 anon buyer checkout (mingla-business, source='checkout', anon)
 *
 * It appends `consent_records` rows via the service-role client (RLS is
 * service-role-only for writes). For ONE grant it writes the cartesian product
 * of {scope: transactional, marketing} × {provided channel/contact}:
 *   - an 'sms'   row per provided phone (E.164)
 *   - an 'email' row per provided email (lowercased)
 * so a single bundled grant produces a transactional AND a marketing audit row
 * per channel (DESIGN §6 / SPEC §8.1).
 *
 * The disclosure_text is recorded VERBATIM (the §1b string, the legal
 * burden-of-proof artifact backing the risk-accepted bundling, R-8). The server
 * also computes ip_hash from the request IP (web) — the client never sends it.
 *
 * Idempotent-ish: append-only audit is acceptable to duplicate, but to avoid
 * spamming the table on retries/double-taps we dedupe on
 * (contact, channel, scope, source) within a short window (DEDUPE_WINDOW_MS).
 *
 * verify_jwt = false (config.toml) — the checkout buyer is ANON; this is an
 * anon-tolerant write path. It does NOT trust a client-supplied user_id beyond
 * recording it; the legal record is keyed by contact + disclosure_text.
 *
 * Cross-refs:
 *   SPEC:   Mingla_Artifacts/specs/SPEC_META-ORCH-1161_NOTIFICATION_MESSAGING_SYSTEM.md §5.1, §8.6
 *   DESIGN: Mingla_Artifacts/design/ORCH-1161/DESIGN_META-ORCH-1161_SUBA_CONSENT_AND_PREFS_UX.md §6
 *   COPY:   Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md §1b
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// META-ORCH-1161 Sub-A.2 (P2-1 hardening) — record-consent is an anon
// (verify_jwt=false) write path: anyone can POST fabricated consent rows. The
// dedupe above only blocks an IDENTICAL (contact,channel,scope,source) tuple,
// so an attacker rotating distinct fabricated contacts bypasses it entirely.
// This lightweight per-IP sliding-window throttle blunts the cheap-burst abuse
// vector (audit-log pollution / cost-spam) without adding a JWT requirement
// (the legit buyer/onboarding callers are anon). It is a per-instance in-memory
// guard — see "Residual" in the rework note: it does not coordinate across
// warm instances or survive a cold start, but it caps a single hot client's
// burst, which is the realistic abuse shape. Fail-OPEN on a missing IP so a
// legitimate caller behind a stripped header is never blocked.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_PER_WINDOW = 12; // a real grant is 1 call → 12/min is generous
const rateBuckets = new Map<string, number[]>();

/**
 * Returns true when the caller (keyed by IP) is OVER the per-window cap.
 * Prunes timestamps outside the window on each call so the map stays bounded
 * for active keys. `null` IP → never rate-limited (fail-open, can't attribute).
 */
function isRateLimited(ipKey: string | null): boolean {
  if (ipKey === null) return false;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateBuckets.get(ipKey) ?? []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    rateBuckets.set(ipKey, hits); // keep the pruned window; do NOT record this call
    return true;
  }
  hits.push(now);
  rateBuckets.set(ipKey, hits);
  return false;
}

type ConsentSource =
  | "onboarding"
  | "checkout"
  | "prefs_ui"
  | "stop_keyword"
  | "unsubscribe_link"
  | "reservation";

interface RecordConsentRequest {
  source: ConsentSource;
  /** EXACT §1b disclosure string the user saw — recorded VERBATIM. */
  disclosureText: string;
  /** Pins the disclosure wording version for the audit trail (DESIGN §6). */
  disclosureVersion?: string;
  /** The just-created user (S2) or NULL (anon checkout, S3). */
  userId?: string | null;
  /** E.164 phone — produces the 'sms' consent rows. */
  phone?: string | null;
  /** Email — lowercased, produces the 'email' consent rows. */
  email?: string | null;
  /** ISO-2 buyer country at grant (e.g. derived from the phone country). */
  countryCode?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // META-ORCH-1161 Sub-A.2 (P2-1) — per-IP abuse guard BEFORE any parse/DB work
  // so a burst is rejected as cheaply as possible.
  const requestIp = clientIp(req);
  if (isRateLimited(requestIp)) {
    console.warn("[record-consent] rate-limited", { ip: requestIp });
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

  let body: RecordConsentRequest;
  try {
    body = (await req.json()) as RecordConsentRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const source = body.source;
  const disclosureText = (body.disclosureText ?? "").trim();
  if (!source || disclosureText.length === 0) {
    return new Response(
      JSON.stringify({ error: "source_and_disclosure_required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Normalize contacts. SMS rows key off the phone, email rows off the email.
  const phone =
    typeof body.phone === "string" && body.phone.trim().length > 0
      ? body.phone.trim()
      : null;
  const email =
    typeof body.email === "string" && EMAIL_REGEX.test(body.email.trim())
      ? body.email.trim().toLowerCase()
      : null;

  if (phone === null && email === null) {
    return new Response(
      JSON.stringify({ error: "at_least_one_contact_required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[record-consent] missing SUPABASE_URL / service key");
    return new Response(
      JSON.stringify({ error: "server_misconfigured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Build the channel/contact pairs for this grant.
  const channelContacts: Array<{ channel: "sms" | "email"; contact: string }> = [];
  if (phone !== null) channelContacts.push({ channel: "sms", contact: phone });
  if (email !== null) channelContacts.push({ channel: "email", contact: email });

  const scopes: Array<"transactional" | "marketing"> = [
    "transactional",
    "marketing",
  ];

  const ipHash = requestIp !== null ? await hashIp(requestIp) : null;
  const countryCode =
    typeof body.countryCode === "string" && body.countryCode.trim().length > 0
      ? body.countryCode.trim().toUpperCase()
      : null;
  const userId =
    typeof body.userId === "string" && body.userId.length > 0
      ? body.userId
      : null;

  const sinceIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const toInsert: Array<Record<string, unknown>> = [];
  let deduped = 0;

  for (const { channel, contact } of channelContacts) {
    for (const scope of scopes) {
      // Dedupe: skip if an identical (contact, channel, scope, source) grant
      // landed within the window (double-tap / retry guard).
      const { data: recent, error: recentErr } = await admin
        .from("consent_records")
        .select("id")
        .eq("contact", contact)
        .eq("channel", channel)
        .eq("scope", scope)
        .eq("source", source)
        .eq("action", "granted")
        .gte("created_at", sinceIso)
        .limit(1);
      if (recentErr) {
        console.error("[record-consent] dedupe query failed", recentErr);
        return new Response(
          JSON.stringify({ error: "consent_write_failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (recent && recent.length > 0) {
        deduped += 1;
        continue;
      }
      toInsert.push({
        user_id: userId,
        contact,
        channel,
        scope,
        action: "granted",
        source,
        disclosure_text: disclosureText,
        ip_hash: ipHash,
        country_code: countryCode,
      });
    }
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await admin
      .from("consent_records")
      .insert(toInsert)
      .select("id");
    if (error) {
      console.error("[record-consent] insert failed", error);
      return new Response(
        JSON.stringify({ error: "consent_write_failed", detail: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    inserted = data?.length ?? 0;
  }

  return new Response(
    JSON.stringify({ ok: true, inserted, deduped, version: body.disclosureVersion ?? null }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
