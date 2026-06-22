// ORCH-1216 [Explorer "Get the app" lead-capture → TestFlight hard-gate] —
// public lead-submit endpoint. Near-clone of beta-access-lead-submit (ORCH-1045),
// re-pointed to the consumer/explorer surface.
//
// PUBLIC edge function (verify_jwt=false in config.toml): the explorer marketing
// site is UNAUTHENTICATED. Anon callers POST a lead from the 2-step "Get the app"
// form. The function:
//   1. re-validates EVERY field server-side (never trusts the client),
//   2. soft-throttles by salted IP hash (raw IP is NEVER stored),
//   3. inserts into public.explorer_app_leads via the SERVICE ROLE (bypasses RLS;
//      anon has no table policy — deny-by-default),
//   4. is idempotent on lower(email) → a resubmit returns already_on_list and
//      sends NO second notification,
//   5. fires a best-effort Resend notification to seth@usemingla.com on a NEW
//      lead only (failure is logged + non-fatal — the lead is already saved).
//
// NO lead-facing welcome email (NG-7): the consumer "welcome" IS the in-modal
// platform-branched success panel + the TestFlight link (iOS only). The
// ORCH-1056 buildWelcomeEmail was an organiser-only add and is NOT cloned here.
//
// HTTP contract (SPEC §3.4):
//   POST { name, email, city, interest, consent, platform, source }
//   → 200 { ok:true, status:'created'|'already_on_list' }
//   → 400 { ok:false, error:'validation', fields?:string[] }
//   → 405 { ok:false, error:'method_not_allowed' }
//   → 429 { ok:false, error:'rate_limited' }
//   → 500 { ok:false, error:'server' }
//   OPTIONS → 200 "ok" + CORS
//
// External API — Resend "Send Email" (COMMS-0003 docs cited):
//   POST https://api.resend.com/emails
//   https://resend.com/docs/api-reference/emails/send-email
//   payload fields { from, to[], subject, html, text } per the canonical reference.
//   Mirrors the live call at supabase/functions/marketing-send/index.ts:794-808.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1205 — use the shared CORS allow-list (it includes x-client-info, which
// supabase-js sends on EVERY request) so the browser preflight is not rejected.
// The shared object already uses "POST, OPTIONS", matching this function's
// methods, so behavior is unchanged except the widened allow-headers.
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Allow-sets (LOCKED to SPEC §3.2.3 / §3.4) ────────────────────────────────
const INTERESTS = new Set([
  "places",
  "events",
  "trips",
  "experiences",
  "all",
]);
const PLATFORMS = new Set([
  "ios",
  "other",
]);
const SOURCES = new Set([
  "explorer_marketing_nav",
]);

// Mirror the modal + client transport regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const THROTTLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_MAX = 5; // 6th attempt in-window → 429

const FIELD_MAX = 512; // user_agent / referer truncation cap

export interface ValidatedLead {
  name: string;
  email: string;
  city: string;
  interest: string;
  platform: string;
  consent: true;
  source: string;
}

export type ValidationResult =
  | { ok: true; lead: ValidatedLead }
  | { ok: false; fields: string[] };

// Pure, exported validator — re-validates the FULL payload server-side. Exported
// so the Deno test suite exercises the exact branching the handler ships.
export function validateLead(raw: unknown): ValidationResult {
  const fields: string[] = [];
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const name = str(body.name).trim();
  const city = str(body.city).trim();
  const email = str(body.email).trim().toLowerCase();
  const interest = str(body.interest).trim();
  const platform = str(body.platform).trim();
  const source = str(body.source).trim();
  const consent = body.consent;

  if (name.length < 1 || name.length > 80) fields.push("name");
  if (!EMAIL_RE.test(email) || email.length > 254 || email.length < 3) {
    fields.push("email");
  }
  if (city.length < 1 || city.length > 80) fields.push("city");
  if (!INTERESTS.has(interest)) fields.push("interest");
  if (!PLATFORMS.has(platform)) fields.push("platform");
  if (consent !== true) fields.push("consent");
  if (!SOURCES.has(source)) fields.push("source");

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    lead: {
      name,
      email,
      city,
      interest,
      platform,
      consent: true,
      source,
    },
  };
}

// First hop of X-Forwarded-For (the client IP at the edge).
export function firstForwardedHop(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// Salted SHA-256 of the client IP → hex. Raw IP is NEVER stored (privacy).
export async function hashIp(
  ip: string | null,
  salt: string,
): Promise<string | null> {
  if (!ip) return null;
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// Build the notification email payload (pure → testable). The HTML/text render
// ONLY captured fields (Constitution #9 — no fabricated data).
export function buildNotifyEmail(
  lead: ValidatedLead,
  from: string,
  receivedAtIso: string,
): { from: string; to: string[]; subject: string; html: string; text: string } {
  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const rows: Array<[string, string]> = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["City", lead.city],
    ["Interested in", lead.interest],
    ["Platform", lead.platform],
    ["Source", lead.source],
    ["Received (UTC)", receivedAtIso],
  ];

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#0e0e10;">
  <h2 style="margin:0 0 12px;font-size:18px;">New app lead</h2>
  <table style="border-collapse:collapse;">
    ${
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`,
      )
      .join("\n    ")
  }
  </table>
</div>`;

  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  return {
    from,
    to: ["seth@usemingla.com"],
    subject: `New app lead — ${lead.name} (${lead.interest}, ${lead.platform})`,
    html,
    text,
  };
}

// Best-effort Resend send. Returns ok/err; the CALLER decides it is non-fatal.
async function sendEmail(
  apiKey: string,
  payload: ReturnType<typeof buildNotifyEmail>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // no-attachment: the ORCH-1216 lead-notify is a plain text/HTML alert to the
    // Mingla inbox (name / email / city / interest / platform). It carries no PDF
    // or file — there is nothing to attach (ORCH-0785-A opt-out).
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    let detail = "";
    try {
      const body = await response.json() as { message?: string };
      detail = body?.message ?? "";
    } catch {
      /* ignore unparsable error body */
    }
    return { ok: false, error: `resend_${response.status}:${detail}` };
  } catch (err) {
    return {
      ok: false,
      error: `resend_throw:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Postgres unique-violation code (idempotent email index hit).
const PG_UNIQUE_VIOLATION = "23505";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "validation" }, 400);
  }

  const validated = validateLead(raw);
  if (!validated.ok) {
    return json({ ok: false, error: "validation", fields: validated.fields }, 400);
  }
  const lead = validated.lead;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Abuse guard: salted-IP-hash soft throttle (§3.4) ────────────────────
    // REUSE the existing ORCH-1045 salt secret (BETA_LEAD_IP_SALT) — no new env.
    const salt = Deno.env.get("BETA_LEAD_IP_SALT") ?? "";
    const ip = firstForwardedHop(req.headers.get("x-forwarded-for"));
    const ipHash = salt ? await hashIp(ip, salt) : null;

    if (ipHash) {
      const sinceIso = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
      const { count, error: countErr } = await supabase
        .from("explorer_app_leads")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", sinceIso);
      if (countErr) {
        console.error(
          "[explorer-app-lead-submit] throttle count failed",
          countErr.message,
        );
        // Fail-open on a throttle read error — do NOT block a legit lead.
      } else if ((count ?? 0) >= THROTTLE_MAX) {
        return json({ ok: false, error: "rate_limited" }, 429);
      }
    }

    // ── Insert (service role bypasses RLS). Idempotent on lower(email). ──────
    const userAgent = truncate(req.headers.get("user-agent"), FIELD_MAX);
    const referer = truncate(req.headers.get("referer"), FIELD_MAX);

    const { error: insertErr } = await supabase
      .from("explorer_app_leads")
      .insert({
        name: lead.name,
        email: lead.email,
        city: lead.city,
        interest: lead.interest,
        platform: lead.platform,
        consent: lead.consent,
        source: lead.source,
        user_agent: userAgent,
        referer: referer,
        ip_hash: ipHash,
      });

    if (insertErr) {
      // Idempotent resubmit → existing email. Return already_on_list, NO email.
      if (insertErr.code === PG_UNIQUE_VIOLATION) {
        return json({ ok: true, status: "already_on_list" }, 200);
      }
      console.error(
        "[explorer-app-lead-submit] insert failed",
        insertErr.message,
      );
      return json({ ok: false, error: "server" }, 500);
    }

    // ── Best-effort notify (NEW lead only). Failure is logged + non-fatal. ──
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const from = Deno.env.get("RESEND_BETA_FROM") ??
      Deno.env.get("RESEND_MARKETING_FROM") ??
      "Mingla <hello@usemingla.com>";
    if (resendKey) {
      const notify = await sendEmail(
        resendKey,
        buildNotifyEmail(lead, from, new Date().toISOString()),
      );
      if (!notify.ok) {
        console.error(
          "[explorer-app-lead-submit] notify email failed (non-fatal):",
          notify.error,
        );
      }
    } else {
      console.error(
        "[explorer-app-lead-submit] RESEND_API_KEY missing — skipped notify (non-fatal)",
      );
    }

    return json({ ok: true, status: "created" }, 200);
  } catch (err) {
    console.error(
      "[explorer-app-lead-submit] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ ok: false, error: "server" }, 500);
  }
}

// Run the HTTP server only when this module is the program entry point — NOT when
// imported by the test suite (which would otherwise try to bind a port).
if (import.meta.main) {
  serve(handler);
}
