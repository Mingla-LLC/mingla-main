// META-ORCH-1222 [Careers site at career.usemingla.com] — public application
// endpoint. Clone of explorer-app-lead-submit (ORCH-1216), re-pointed to the
// careers surface with a 6-field application + a CV upload.
//
// PUBLIC edge function (verify_jwt=false in config.toml): the careers marketing
// site is UNAUTHENTICATED. Anon callers POST an application from the per-role
// form. The function:
//   1. re-validates EVERY field server-side (never trusts the client) — all SIX
//      required fields + the CV (I-PROPOSED-1222-APPLY-VALIDATES-ALL-SIX),
//   2. resolves the role from job_slug and rejects unless status='open',
//   3. soft-throttles by salted IP hash (raw IP is NEVER stored),
//   4. uploads the CV to the PRIVATE career-cvs bucket via the SERVICE ROLE,
//   5. inserts into public.job_applications via the SERVICE ROLE (bypasses RLS;
//      anon has no table policy — deny-by-default),
//   6. sends a branded confirmation email to the applicant + a branded
//      notification to seth@usemingla.com (best-effort, non-fatal), through the
//      shared renderShell + Resend senders (reused by import — NOT edited).
//
// Unlike explorer-lead there is NO idempotency-on-email dedupe: a person may
// apply to multiple roles, and re-applying to the same role is allowed (each
// submit is a fresh row).
//
// HTTP contract (SPEC §4.B):
//   POST { job_slug, full_name, email, whatsapp_phone, preferred_salary,
//          portfolio_url, cv_base64, cv_filename, cv_mime }
//   → 200 { ok:true }
//   → 400 { ok:false, error:'validation', fields?:string[] }
//   → 405 { ok:false, error:'method_not_allowed' }
//   → 429 { ok:false, error:'rate_limited' }
//   → 500 { ok:false, error:'server' }
//   OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1205 — shared CORS allow-list (includes x-client-info) so the browser
// preflight is not rejected. Do NOT inline a hand-rolled allow-list.
import { corsHeaders } from "../_shared/cors.ts";
// Branded email shell + senders + escape — reused by import (DO-NOT edit).
import { renderShell } from "../_shared/email/shell.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
} from "../_shared/email/senders.ts";
// ISSUE-1001 — canonical logo resolution; replaces the silent DEAD-404
// email-assets fallback URL with a live default.
import { minglaLogoUrl } from "../_shared/brandAssets.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Allow-sets (LOCKED to the bucket + migration constraints) ────────────────
const CV_MIME_ALLOW = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const CV_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches career-cvs file_size_limit.

// Mirror the client transport + form regexes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const THROTTLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_MAX = 5; // 6th attempt in-window → 429
const FIELD_MAX = 512; // user_agent / referer truncation cap

// ORCH-1226 [careers applicant email from careers@] — the APPLICANT confirmation
// email sends from a CAREERS identity (display "Mingla Careers") with a careers
// Reply-To, so a candidate's reply lands in the careers inbox — NOT the generic
// notifications@ no-reply. The seth@usemingla.com NOTIFY email is UNCHANGED.
// Built INLINE (the _shared/email/senders.ts module is DO-NOT-TOUCH per SPEC),
// mirroring its resolveSender env-override pattern: `RESEND_CAREERS_FROM` may
// override the display/address; default is "Mingla Careers <careers@usemingla.com>".
const CAREERS_REPLY_TO = "careers@usemingla.com";
function resolveCareersSender(): { name: string; address: string } {
  const fallback = { name: "Mingla Careers", address: CAREERS_REPLY_TO };
  const raw = Deno.env.get("RESEND_CAREERS_FROM");
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const match = raw.trim().match(/^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/);
  if (match === null) return fallback; // never throw — emails are best-effort
  return { name: (match[1] ?? fallback.name).trim(), address: match[2] };
}

export interface CareersApplyInput {
  job_slug: string;
  full_name: string;
  email: string;
  whatsapp_phone: string;
  preferred_salary: string;
  portfolio_url: string;
  cv_base64: string;
  cv_filename: string;
  cv_mime: string;
}

export interface ValidatedApplication {
  job_slug: string;
  full_name: string;
  email: string;
  whatsapp_phone: string;
  preferred_salary: string;
  portfolio_url: string;
  cv_bytes: Uint8Array;
  cv_filename: string;
  cv_mime: string;
}

export type ValidationResult =
  | { ok: true; application: ValidatedApplication }
  | { ok: false; fields: string[] };

// Strip spaces, keep an optional leading +, count digits (7–20).
export function isValidWhatsApp(raw: string): boolean {
  const trimmed = raw.trim().replace(/[\s()-]/g, "");
  const m = trimmed.match(/^\+?(\d+)$/);
  if (!m) return false;
  const digits = m[1];
  return digits.length >= 7 && digits.length <= 20;
}

export function isValidHttpUrl(raw: string): boolean {
  if (raw.length < 4 || raw.length > 2048) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Decode a base64 string to bytes. Returns null on a malformed payload.
export function decodeBase64(b64: string): Uint8Array | null {
  try {
    // Tolerate a data: URL prefix the client might send.
    const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
    const bin = atob(cleaned);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// Sanitize a filename to [a-zA-Z0-9._-], cap length, keep extension.
export function sanitizeFilename(name: string): string {
  const trimmed = (name || "cv").trim();
  const dot = trimmed.lastIndexOf(".");
  let base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  let ext = dot > 0 ? trimmed.slice(dot + 1) : "";
  base = base
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") // drop leading/trailing separators
    .slice(0, 60) || "cv";
  ext = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return ext ? `${base}.${ext}` : base;
}

// Pure, exported validator — re-validates the FULL payload server-side. Each of
// the SIX required fields + the CV pushes its own field name on failure.
export function validateApplication(raw: unknown): ValidationResult {
  const fields: string[] = [];
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  const job_slug = str(body.job_slug).trim();
  const full_name = str(body.full_name).trim();
  const email = str(body.email).trim().toLowerCase();
  const whatsapp_phone = str(body.whatsapp_phone).trim();
  const preferred_salary = str(body.preferred_salary).trim();
  const portfolio_url = str(body.portfolio_url).trim();
  const cv_base64 = str(body.cv_base64);
  const cv_filename = str(body.cv_filename).trim();
  const cv_mime = str(body.cv_mime).trim();

  // job_slug is required (role binding) but its open/closed check is a DB lookup
  // done by the handler; here we only require a syntactically valid slug.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(job_slug) || job_slug.length > 80) {
    fields.push("job_slug");
  }
  if (full_name.length < 1 || full_name.length > 80) fields.push("full_name");
  if (!EMAIL_RE.test(email) || email.length > 254 || email.length < 3) {
    fields.push("email");
  }
  if (!isValidWhatsApp(whatsapp_phone)) fields.push("whatsapp_phone");
  if (preferred_salary.length < 1 || preferred_salary.length > 60) {
    fields.push("preferred_salary");
  }
  if (!isValidHttpUrl(portfolio_url)) fields.push("portfolio_url");

  // CV: mime allowlist + decoded byte length ≤ 5 MB + filename present.
  let cv_bytes: Uint8Array | null = null;
  if (
    !CV_MIME_ALLOW.has(cv_mime) ||
    cv_filename.length < 1 ||
    cv_base64.length < 1
  ) {
    fields.push("cv");
  } else {
    cv_bytes = decodeBase64(cv_base64);
    if (cv_bytes === null || cv_bytes.length < 1 || cv_bytes.length > CV_MAX_BYTES) {
      fields.push("cv");
    }
  }

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    application: {
      job_slug,
      full_name,
      email,
      whatsapp_phone,
      preferred_salary,
      portfolio_url,
      cv_bytes: cv_bytes as Uint8Array,
      cv_filename,
      cv_mime,
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

// ── Applicant confirmation email (branded shell). Pure → testable. ───────────
export function buildApplicantEmail(
  fullName: string,
  roleTitle: string,
  email: string,
  from: string,
): {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
} {
  const firstName = fullName.split(/\s+/)[0] || fullName;
  const subject = "We got your application";
  const preheader = `Thanks for applying to Mingla — we've got your application for ${roleTitle}.`;

  const bodyHtml = `
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#0F1115;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#0F1115;">
      Thanks — we've got your application for
      <strong>${escapeHtml(roleTitle)}</strong>. We review every one and reach
      out by email if there's a fit. Keep an eye on your inbox.
    </p>
    <p style="margin:18px 0 0 0;font-size:13px;line-height:1.5;color:#5B6172;">
      — The Mingla team
    </p>`;

  const html = renderShell({
    preheader,
    bodyHtml,
    supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? "support@usemingla.com",
    logoUrl: minglaLogoUrl(),
    footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ??
      "Mingla, hello@usemingla.com",
  });

  const text =
    `Hi ${firstName},\n\nThanks — we've got your application for ${roleTitle}. ` +
    `We review every one and reach out by email if there's a fit. Keep an eye ` +
    `on your inbox.\n\n— The Mingla team`;

  // ORCH-1226: applicant replies route to the careers inbox (Resend `reply_to`).
  return { from, to: [email], reply_to: CAREERS_REPLY_TO, subject, html, text };
}

// ── Notification email to Seth (branded shell, captured fields only). ────────
export function buildNotifyEmail(
  app: { full_name: string; email: string; whatsapp_phone: string; preferred_salary: string; portfolio_url: string },
  roleTitle: string,
  from: string,
  receivedAtIso: string,
): { from: string; to: string[]; subject: string; html: string; text: string } {
  const rows: Array<[string, string]> = [
    ["Role", roleTitle],
    ["Name", app.full_name],
    ["Email", app.email],
    ["WhatsApp", app.whatsapp_phone],
    ["Preferred salary", app.preferred_salary],
    ["Portfolio", app.portfolio_url],
    ["Received (UTC)", receivedAtIso],
  ];

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:18px;color:#0F1115;">New careers application</h2>
    <table role="presentation" style="border-collapse:collapse;">
      ${
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#5B6172;font-size:14px;">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600;font-size:14px;color:#0F1115;">${escapeHtml(v)}</td></tr>`,
      )
      .join("\n      ")
  }
    </table>
    <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#5B6172;">
      The CV is attached in the Mingla admin (Careers → Applications → this row → Download CV).
    </p>`;

  const html = renderShell({
    preheader: `New application for ${roleTitle} from ${app.full_name}.`,
    bodyHtml,
    supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? "support@usemingla.com",
    logoUrl: minglaLogoUrl(),
    footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ??
      "Mingla, hello@usemingla.com",
  });

  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    "\n\nThe CV is in the Mingla admin (Careers → Applications).";

  return {
    from,
    to: ["seth@usemingla.com"],
    subject: `New application — ${app.full_name} (${roleTitle})`,
    html,
    text,
  };
}

// Best-effort Resend send. Returns ok/err; the CALLER decides it is non-fatal.
async function sendEmail(
  apiKey: string,
  // Accepts either email payload shape. ONLY the applicant payload carries
  // `reply_to` (ORCH-1226) — the seth@usemingla.com notify payload omits it, so
  // its Resend reply-to is unchanged. Resend treats an absent `reply_to` as none.
  payload:
    | ReturnType<typeof buildNotifyEmail>
    | ReturnType<typeof buildApplicantEmail>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // no-attachment: both careers emails (the applicant confirmation AND the
    // seth@usemingla.com new-application notification) are plain text/HTML
    // messages. The CV lives in the Mingla admin (Careers → Applications),
    // NOT attached to the email — there is nothing to attach (ORCH-0785-A opt-out).
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
      const b = await response.json() as { message?: string };
      detail = b?.message ?? "";
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

  const validated = validateApplication(raw);
  if (!validated.ok) {
    return json({ ok: false, error: "validation", fields: validated.fields }, 400);
  }
  const app = validated.application;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Resolve role (must be status='open'). ───────────────────────────────
    const { data: posting, error: postingErr } = await supabase
      .from("job_postings")
      .select("id, title, status")
      .eq("slug", app.job_slug)
      .eq("status", "open")
      .maybeSingle();
    if (postingErr) {
      console.error("[careers-apply] posting lookup failed", postingErr.message);
      return json({ ok: false, error: "server" }, 500);
    }
    if (!posting) {
      // Role not open / nonexistent → 400 with job_slug (role_not_open).
      return json({ ok: false, error: "validation", fields: ["job_slug"] }, 400);
    }

    // ── Abuse guard: salted-IP-hash soft throttle. Reuse BETA_LEAD_IP_SALT. ──
    const salt = Deno.env.get("BETA_LEAD_IP_SALT") ?? "";
    const ip = firstForwardedHop(req.headers.get("x-forwarded-for"));
    const ipHash = salt ? await hashIp(ip, salt) : null;

    if (ipHash) {
      const sinceIso = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
      const { count, error: countErr } = await supabase
        .from("job_applications")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", sinceIso);
      if (countErr) {
        console.error("[careers-apply] throttle count failed", countErr.message);
        // Fail-open on a throttle read error — do NOT block a legit application.
      } else if ((count ?? 0) >= THROTTLE_MAX) {
        return json({ ok: false, error: "rate_limited" }, 429);
      }
    }

    // ── Upload CV first (no orphan row if the upload fails). ─────────────────
    const applicationId = crypto.randomUUID();
    const safeName = sanitizeFilename(app.cv_filename);
    const cvPath = `${posting.id}/${applicationId}-${safeName}`;
    const { error: uploadErr } = await supabase.storage
      .from("career-cvs")
      .upload(cvPath, app.cv_bytes, {
        contentType: app.cv_mime,
        upsert: false,
      });
    if (uploadErr) {
      console.error("[careers-apply] CV upload failed", uploadErr.message);
      return json({ ok: false, error: "server" }, 500);
    }

    // ── Insert the application (service role bypasses RLS). ──────────────────
    const userAgent = truncate(req.headers.get("user-agent"), FIELD_MAX);
    const referer = truncate(req.headers.get("referer"), FIELD_MAX);
    const { error: insertErr } = await supabase
      .from("job_applications")
      .insert({
        id: applicationId,
        job_posting_id: posting.id,
        full_name: app.full_name,
        email: app.email,
        whatsapp_phone: app.whatsapp_phone,
        preferred_salary: app.preferred_salary,
        cv_path: cvPath,
        portfolio_url: app.portfolio_url,
        user_agent: userAgent,
        referer: referer,
        ip_hash: ipHash,
      });
    if (insertErr) {
      console.error("[careers-apply] insert failed", insertErr.message);
      // Best-effort: remove the orphaned CV object so storage doesn't leak.
      await supabase.storage.from("career-cvs").remove([cvPath]).catch(() => {});
      return json({ ok: false, error: "server" }, 500);
    }

    // ── Best-effort emails (NEVER fatal — the row is already saved). ─────────
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (resendKey) {
      // System no-reply sender for the seth@usemingla.com notify (UNCHANGED).
      const notifyFrom = (() => {
        try {
          assertNotResendSandbox(EMAIL_SENDERS.system);
          return formatSenderHeader(EMAIL_SENDERS.system);
        } catch {
          return "Mingla <notifications@usemingla.com>";
        }
      })();
      // ORCH-1226 — the APPLICANT confirmation sends from the careers identity
      // ("Mingla Careers <careers@usemingla.com>"), guarded against the Resend
      // sandbox exactly like the system sender.
      const applicantFrom = (() => {
        const careers = resolveCareersSender();
        try {
          assertNotResendSandbox(careers);
          return formatSenderHeader(careers);
        } catch {
          return "Mingla Careers <careers@usemingla.com>";
        }
      })();
      const receivedAt = new Date().toISOString();

      const applicant = await sendEmail(
        resendKey,
        buildApplicantEmail(app.full_name, posting.title, app.email, applicantFrom),
      );
      if (!applicant.ok) {
        console.error(
          "[careers-apply] applicant confirmation email failed (non-fatal):",
          applicant.error,
        );
      }

      const notify = await sendEmail(
        resendKey,
        buildNotifyEmail(app, posting.title, notifyFrom, receivedAt),
      );
      if (!notify.ok) {
        console.error(
          "[careers-apply] notify email failed (non-fatal):",
          notify.error,
        );
      }
    } else {
      console.error(
        "[careers-apply] RESEND_API_KEY missing — skipped applicant + notify " +
          "emails (non-fatal)",
      );
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error(
      "[careers-apply] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ ok: false, error: "server" }, 500);
  }
}

// Run the HTTP server only when this module is the program entry point — NOT
// when imported by the test suite (which would otherwise try to bind a port).
if (import.meta.main) {
  serve(handler);
}
