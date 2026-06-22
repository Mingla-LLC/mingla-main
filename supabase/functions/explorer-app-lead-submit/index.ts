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
// ORCH-1219 — lead-facing branded TestFlight email (Fix D): on EVERY newly
// `created` submit (iOS, Android, AND desktop/other) we ALSO send the lead a
// warm, on-brand email containing the iOS TestFlight install link, built through
// the shared `renderShell` + a CTA button (mirrors buildInviteEmail). On a
// duplicate (`already_on_list`) we send NO second email (idempotency parity with
// the internal seth@usemingla.com notify). The internal notify still fires too.
// (Supersedes ORCH-1216's NG-7 "no lead-facing email" — Seth follow-up.)
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
// ORCH-1219 (Fix D) — the lead-facing branded TestFlight email is built through
// the shared Mingla email shell (header/footer chrome) + the canonical
// escapeHtml, mirroring invite-brand-member/buildInviteEmail. EMAIL_SENDERS
// resolves the no-reply system sender (RESEND_SYSTEM_FROM env-overridable).
import { renderShell } from "../_shared/email/shell.ts";
import { escapeHtml as sharedEscapeHtml } from "../_shared/email/escape.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
} from "../_shared/email/senders.ts";

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
  "android", // ORCH-1219 Fix C — distinct from desktop ('other')
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
  interest: string[]; // ORCH-1219 Fix A — multi-select; ≥1 element, all ∈ enum
  platform: string;
  consent: true;
  source: string;
}

export type ValidationResult =
  | { ok: true; lead: ValidatedLead }
  | { ok: false; fields: string[] };

// ORCH-1219 Fix A — normalise a raw `interest` payload to a clean string[].
// Accepts ONLY an array (a bare string is NOT silently wrapped — the client
// transport always sends an array; a scalar is a contract violation and must
// reject as empty). Trims each element, drops empties, de-dupes (stable order).
export function normaliseInterest(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of raw) {
    if (typeof el !== "string") continue;
    const v = el.trim();
    if (v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

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
  const platform = str(body.platform).trim();
  const source = str(body.source).trim();
  const consent = body.consent;

  // ORCH-1219 Fix A — interest is now a NON-EMPTY array of allowed values. We
  // normalise (trim each element, drop empties, de-dupe) then require ≥1 element
  // and EVERY element ∈ the 5-value allow-set. A bare string, an empty array, an
  // array with an unknown element, or a non-array all reject.
  const interest = normaliseInterest(body.interest);
  if (
    interest.length < 1 ||
    interest.length > INTERESTS.size ||
    !interest.every((i) => INTERESTS.has(i))
  ) {
    fields.push("interest");
  }

  if (name.length < 1 || name.length > 80) fields.push("name");
  if (!EMAIL_RE.test(email) || email.length > 254 || email.length < 3) {
    fields.push("email");
  }
  if (city.length < 1 || city.length > 80) fields.push("city");
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

  const interestLabel = lead.interest.join(", "); // ORCH-1219 — multi-select
  const rows: Array<[string, string]> = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["City", lead.city],
    ["Interested in", interestLabel],
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
    subject: `New app lead — ${lead.name} (${interestLabel}, ${lead.platform})`,
    html,
    text,
  };
}

// ORCH-1219 Fix D — the LEAD-FACING branded TestFlight email.
//
// The live TestFlight join link is hard-coded here. NOTE: the modal-side gate
// I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT scans ONLY get-the-app-modal.tsx (the
// MODAL), so the URL living in this edge fn does NOT trip it — the modal keeps
// the link in its iOS-only success branch; the email is a SEPARATE, always-sent
// channel (Seth: "also send when the user is on ios too").
//
// Built through the shared `renderShell` (header/footer chrome) + a CTA button,
// mirroring invite-brand-member/buildInviteEmail. Every interpolated value flows
// through sharedEscapeHtml. The body is warm + on-brand: invites the lead to
// install Mingla on iPhone/iPad via TestFlight, CTA → the TestFlight URL, with a
// soft note for Android/desktop that it opens on an iPhone.
const TESTFLIGHT_URL = "https://testflight.apple.com/join/1gvHNqkQ";

export function buildDownloadLinkEmail(
  lead: ValidatedLead,
  from: string,
): { from: string; to: string[]; subject: string; html: string; text: string } {
  const firstName = lead.name.split(/\s+/)[0] || lead.name;
  const isIos = lead.platform === "ios";

  const subject = "Your Mingla TestFlight invite";
  const preheader =
    "Install Mingla on your iPhone or iPad through TestFlight — tap to open.";

  const greeting =
    `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#0F1115;">
      Hi ${sharedEscapeHtml(firstName)},
    </p>`;

  const lead1 = isIos
    ? `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#0F1115;">
        You're in. Mingla is in TestFlight while we polish it — tap the button
        below on your iPhone or iPad to install it and start finding things to do.
      </p>`
    : `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#0F1115;">
        Thanks for grabbing Mingla. We're in beta on iPhone &amp; iPad right now —
        tap the button below <strong>on your iPhone or iPad</strong> to install it
        through TestFlight and start finding things to do.
      </p>`;

  // CTA button — table-based for mail-client compatibility (mirror buildInviteEmail).
  const cta =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr>
        <td style="background:#FF6B2C;border-radius:999px;">
          <a href="${sharedEscapeHtml(TESTFLIGHT_URL)}"
             style="display:inline-block;padding:14px 26px;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            Install Mingla in TestFlight
          </a>
        </td>
      </tr>
    </table>`;

  const softNote = isIos
    ? ""
    : `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.5;color:#5B6172;">
        Heads up: Mingla's beta opens on an iPhone or iPad. Open this email on your
        Apple device and tap the button to install — we'll let you know the moment
        we land on your platform.
      </p>`;

  const finePrint =
    `<p style="margin:18px 0 0 0;font-size:13px;line-height:1.5;color:#5B6172;">
      If the button doesn't work, copy and paste this link into Safari on your
      iPhone or iPad:
    </p>
    <p style="margin:6px 0 0 0;word-break:break-all;font-size:12px;color:#5B6172;">
      ${sharedEscapeHtml(TESTFLIGHT_URL)}
    </p>`;

  const bodyHtml = `${greeting}
    ${lead1}
    ${cta}
    ${softNote}
    ${finePrint}`;

  const html = renderShell({
    preheader,
    bodyHtml,
    supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? "support@usemingla.com",
    logoUrl: Deno.env.get("MINGLA_LOGO_URL") ??
      "https://usemingla.com/email-assets/mingla-logo.png",
    footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ??
      "Mingla, hello@usemingla.com",
  });

  const text = isIos
    ? `Hi ${firstName},\n\nYou're in. Mingla is in TestFlight while we polish it — ` +
      `install it on your iPhone or iPad here:\n${TESTFLIGHT_URL}\n\n— Mingla`
    : `Hi ${firstName},\n\nThanks for grabbing Mingla. We're in beta on iPhone & ` +
      `iPad right now — open this on your Apple device and install through ` +
      `TestFlight:\n${TESTFLIGHT_URL}\n\nWe'll let you know the moment we land on ` +
      `your platform.\n\n— Mingla`;

  return {
    from,
    to: [lead.email],
    subject,
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

      // ── ORCH-1219 Fix D — ALWAYS send the LEAD the branded TestFlight email
      //    on a NEW (created) submit (iOS, Android AND desktop/other). This path
      //    is reached only AFTER a successful insert — i.e. never on a duplicate
      //    (already_on_list returns above), so we keep idempotency parity with
      //    the internal notify. Best-effort: failure is logged + non-fatal (the
      //    lead is already saved). The system no-reply sender is used (never the
      //    Resend sandbox — assertNotResendSandbox throws if misconfigured).
      const userFrom = (() => {
        try {
          assertNotResendSandbox(EMAIL_SENDERS.system);
          return formatSenderHeader(EMAIL_SENDERS.system);
        } catch {
          // Fall back to the internal notify `from` if the system sender is
          // somehow a sandbox identity — still a real Mingla address.
          return from;
        }
      })();
      const userEmail = await sendEmail(
        resendKey,
        buildDownloadLinkEmail(lead, userFrom),
      );
      if (!userEmail.ok) {
        console.error(
          "[explorer-app-lead-submit] download-link email to lead failed (non-fatal):",
          userEmail.error,
        );
      }
    } else {
      console.error(
        "[explorer-app-lead-submit] RESEND_API_KEY missing — skipped notify + " +
          "download-link email (non-fatal)",
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
