// ORCH-1045 [Business "Get Beta Access" lead-capture] — public lead-submit endpoint.
//
// PUBLIC edge function (verify_jwt=false in config.toml): the organiser marketing
// site is UNAUTHENTICATED. Anon callers POST a lead from the 3-step "Get Beta
// Access" form. The function:
//   1. re-validates EVERY field server-side (never trusts the client),
//   2. soft-throttles by salted IP hash (raw IP is NEVER stored),
//   3. inserts into public.beta_access_leads via the SERVICE ROLE (bypasses RLS;
//      anon has no table policy — deny-by-default),
//   4. is idempotent on lower(email) → a resubmit returns already_on_list and
//      sends NO second notification,
//   5. fires a best-effort Resend notification to seth@usemingla.com on a NEW
//      lead only (failure is logged + non-fatal — the lead is already saved).
//
// HTTP contract (SPEC §3.3.3):
//   POST { brandType, brandName, contactName, city, email, consent, source }
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

// ── Allow-sets (LOCKED to SPEC §3.3.1 / §3.3.3) ──────────────────────────────
const BRAND_TYPES = new Set([
  "restaurant",
  "cafe_bar",
  "club_nightlife",
  "event_organiser",
  "experience_tour",
  "venue_space",
  "other",
]);
const SOURCES = new Set([
  "organiser_marketing_nav",
  "organiser_marketing_hero",
]);

// Mirror JoinWaitlistSheet.tsx:38 + the client transport regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const THROTTLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_MAX = 5; // 6th attempt in-window → 429

const FIELD_MAX = 512; // user_agent / referer truncation cap

export interface ValidatedLead {
  brand_type: string;
  brand_name: string;
  contact_name: string;
  city: string;
  email: string;
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
  const brandType = str(body.brandType).trim();
  const brandName = str(body.brandName).trim();
  const contactName = str(body.contactName).trim();
  const city = str(body.city).trim();
  const email = str(body.email).trim().toLowerCase();
  const source = str(body.source).trim();
  const consent = body.consent;

  if (!BRAND_TYPES.has(brandType)) fields.push("brandType");
  if (brandName.length < 1 || brandName.length > 120) fields.push("brandName");
  if (contactName.length < 1 || contactName.length > 80) {
    fields.push("contactName");
  }
  if (city.length < 1 || city.length > 80) fields.push("city");
  if (!EMAIL_RE.test(email) || email.length > 254 || email.length < 3) {
    fields.push("email");
  }
  if (consent !== true) fields.push("consent");
  if (!SOURCES.has(source)) fields.push("source");

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    lead: {
      brand_type: brandType,
      brand_name: brandName,
      contact_name: contactName,
      city,
      email,
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
    ["Business name", lead.brand_name],
    ["Business type", lead.brand_type],
    ["Contact name", lead.contact_name],
    ["City", lead.city],
    ["Email", lead.email],
    ["Source", lead.source],
    ["Received (UTC)", receivedAtIso],
  ];

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#0e0e10;">
  <h2 style="margin:0 0 12px;font-size:18px;">New beta lead</h2>
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
    subject: `New beta lead — ${lead.brand_name} (${lead.brand_type})`,
    html,
    text,
  };
}

// ORCH-1056 — lead-facing welcome email. Pure → testable. Static marketing copy
// only (no user-controlled field is interpolated into the HTML/text → no
// injection surface, Constitution #9 — no fabricated data). Confirms the lead is
// on the beta list, points them at the LIVE web app (business.usemingla.com),
// flags the mobile app as in-the-works, and previews capabilities incl. Ari.
export function buildWelcomeEmail(
  lead: ValidatedLead,
  from: string,
): { from: string; to: string[]; subject: string; html: string; text: string } {
  const BUSINESS_URL = "https://business.usemingla.com";

  const html =
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55;color:#0e0e10;max-width:560px;">
  <h1 style="margin:0 0 12px;font-size:22px;">You're on the list.</h1>
  <p style="margin:0 0 16px;">Thanks for joining the Mingla Business beta. Your place deserves to be found — and you don't have to wait.</p>
  <p style="margin:0 0 8px;font-weight:600;">Start now, on the web:</p>
  <p style="margin:0 0 16px;"><a href="${BUSINESS_URL}" style="display:inline-block;background:#eb7825;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:14px;">Open Mingla Business →</a></p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px;">That link (business.usemingla.com) is our web app. The mobile app is in the works — we'll email you the moment it lands.</p>
  <h2 style="margin:0 0 8px;font-size:16px;">What you can do today</h2>
  <ul style="margin:0 0 20px;padding-left:20px;">
    <li>Create and publish events, trips, and experiences</li>
    <li>Sell tickets and take bookings — one all-in price up front, paid out to you, no checkout surprises for your guests</li>
    <li>Get discovered by people nearby looking for exactly your vibe</li>
    <li>Build your audience and send email campaigns</li>
    <li>Open a waitlist, set your hours and schedule, manage it all in one place</li>
  </ul>
  <h2 style="margin:0 0 8px;font-size:16px;">Coming very soon</h2>
  <ul style="margin:0 0 20px;padding-left:20px;">
    <li><strong>Ari — your AI co-pilot.</strong> We're building it right now. Very soon you'll run the whole business just by asking Ari: "create tonight's event," "launch a campaign," "who's coming Friday?" — done.</li>
    <li>The mobile app</li>
    <li>More ways to reach your people (SMS, and more)</li>
  </ul>
  <p style="margin:0;">We'll keep you posted as your spot opens.<br/>— The Mingla team</p>
</div>`;

  const text = [
    "You're on the list.",
    "",
    "Thanks for joining the Mingla Business beta. Your place deserves to be found — and you don't have to wait.",
    "",
    `Start now, on the web: ${BUSINESS_URL}`,
    "That link is our web app. The mobile app is in the works — we'll email you the moment it lands.",
    "",
    "What you can do today",
    "- Create and publish events, trips, and experiences",
    "- Sell tickets and take bookings — one all-in price up front, paid out to you, no checkout surprises for your guests",
    "- Get discovered by people nearby looking for exactly your vibe",
    "- Build your audience and send email campaigns",
    "- Open a waitlist, set your hours and schedule, manage it all in one place",
    "",
    "Coming very soon",
    "- Ari, your AI co-pilot. We're building it right now. Very soon you'll run the whole business just by asking Ari: create tonight's event, launch a campaign, who's coming Friday — done.",
    "- The mobile app",
    "- More ways to reach your people (SMS, and more)",
    "",
    "We'll keep you posted as your spot opens.",
    "— The Mingla team",
  ].join("\n");

  return {
    from,
    to: [lead.email],
    subject: "You're on the list — start with Mingla Business on the web",
    html,
    text,
  };
}

// Best-effort Resend send. Returns ok/err; the CALLER decides it is non-fatal.
// Generalized (ORCH-1056) to send any built email payload — the single Resend
// fetch site keeps the ORCH-0785-A no-attachment opt-out below authoritative.
async function sendEmail(
  apiKey: string,
  payload: ReturnType<typeof buildNotifyEmail>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // no-attachment: ORCH-1045 lead-notify is a plain text/HTML alert to the
    // Mingla inbox (brand type / name / city / email). It carries no PDF or
    // file — there is nothing to attach (ORCH-0785-A opt-out).
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

    // ── Abuse guard: salted-IP-hash soft throttle (§3.3.5) ──────────────────
    const salt = Deno.env.get("BETA_LEAD_IP_SALT") ?? "";
    const ip = firstForwardedHop(req.headers.get("x-forwarded-for"));
    const ipHash = salt ? await hashIp(ip, salt) : null;

    if (ipHash) {
      const sinceIso = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
      const { count, error: countErr } = await supabase
        .from("beta_access_leads")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", sinceIso);
      if (countErr) {
        console.error(
          "[beta-access-lead-submit] throttle count failed",
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
      .from("beta_access_leads")
      .insert({
        brand_type: lead.brand_type,
        brand_name: lead.brand_name,
        contact_name: lead.contact_name,
        city: lead.city,
        email: lead.email,
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
        "[beta-access-lead-submit] insert failed",
        insertErr.message,
      );
      return json({ ok: false, error: "server" }, 500);
    }

    // ── Best-effort notify (NEW lead only). Failure is logged + non-fatal. ──
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const from = Deno.env.get("RESEND_BETA_FROM") ??
      Deno.env.get("RESEND_MARKETING_FROM") ??
      "Mingla Beta <beta@usemingla.com>";
    if (resendKey) {
      // (1) Internal notify → Mingla inbox.
      const notify = await sendEmail(
        resendKey,
        buildNotifyEmail(lead, from, new Date().toISOString()),
      );
      if (!notify.ok) {
        console.error(
          "[beta-access-lead-submit] notify email failed (non-fatal):",
          notify.error,
        );
      }
      // (2) ORCH-1056 — lead-facing welcome email (NEW lead only; non-fatal).
      const welcome = await sendEmail(resendKey, buildWelcomeEmail(lead, from));
      if (!welcome.ok) {
        console.error(
          "[beta-access-lead-submit] welcome email failed (non-fatal):",
          welcome.error,
        );
      }
    } else {
      console.error(
        "[beta-access-lead-submit] RESEND_API_KEY missing — skipped notify + welcome (non-fatal)",
      );
    }

    return json({ ok: true, status: "created" }, 200);
  } catch (err) {
    console.error(
      "[beta-access-lead-submit] unexpected error",
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
