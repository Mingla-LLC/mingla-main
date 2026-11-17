// ISSUE-1003 [Venue Website Grader growth tool — test cut] — the email gate.
//
// PUBLIC edge function (verify_jwt=false in config.toml): after growth-tools-run
// generates a report, the anonymous grader page asks for an email before
// revealing the full report. POST {run_id, email} →
//   1. validates the email format + run_id shape server-side,
//   2. loads the tool_leads row via the SERVICE ROLE (RLS deny-all for clients)
//      — the row must exist with status 'report_ready' or later and a report,
//   3. saves the email + status 'gated_email',
//   4. renders the report as a branded HTML email through the shared shell
//      (renderShell — the EMAIL_BRAND_SHELL_SINGLETON) and sends it via Resend
//      from the system sender, reply-to support@usemingla.com. When the report
//      carries a competition block (ISSUE-1003), the email adds "Who's eating
//      your Friday nights" + "How to outrank them"; absent → skipped cleanly,
//   5. on send success → status 'emailed', 200 {ok:true}.
// An email send failure returns 502 {error:"email_failed"} and the row STAYS
// 'gated_email' (the lead is captured; the send can be retried).
//
// HTTP contract:
//   POST {run_id, email} → 200 {ok:true}
//   → 400 {error:"validation", fields?:string[]} | {error:"invalid_json"}
//   → 404 {error:"not_found"}
//   → 405 {error:"method_not_allowed"}
//   → 409 {error:"report_not_ready"}
//   → 502 {error:"email_failed"}
//   → 500 {error:"server"}
//   OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1205 — shared CORS allow-list (includes x-client-info) so the browser
// preflight is not rejected. Do NOT inline a hand-rolled allow-list.
import { corsHeaders } from "../_shared/cors.ts";
// Branded email shell + senders + escape — reused by import (DO-NOT edit).
import { renderShell, SHELL_TOKENS } from "../_shared/email/shell.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
} from "../_shared/email/senders.ts";
// ISSUE-1001 — canonical logo resolution (env override, live fail-safe default).
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import { resolveRuntimeString } from "../_shared/runtimeConfig.ts";
// #4238 W3-3 (D7): a successful email unlock with the page's ad context is a
// host lead (event_id lead:tool:<tool_leads.id>).
import {
  type HostAdContext,
  parseHostAdContext,
  recordHostLead,
} from "../_shared/hostFunnelConversion.ts";
import type { FireAdConversionDeps } from "../_shared/adConversionFire.ts";
// #4452 §6.9: the smart report email (one builder for the four tools).
import { buildToolReportEmail, TOOL_ICP } from "./toolEmail.ts";

const { BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED } = SHELL_TOKENS;

const REPLY_TO = "support@usemingla.com";

// ISSUE-1354 — founder notification on email unlock (the report_ready →
// gated_email transition). Recipient is a code const — NO new Supabase secret
// (COMMS-0122 capacity). The deep-link opens the admin "Tool Leads" console.
const LEAD_NOTIFY_TO = "seth@usemingla.com";
const ADMIN_TOOL_LEADS_URL = "https://admin.usemingla.com/#/tool-leads";

// Mirror the careers-apply transport regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Client-supplied origin for the emailed report link — https + usemingla/vercel
// hosts only (never an attacker-controlled origin in the email).
export function validateToolsOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) {
    return null;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const ok = host === "usemingla.com" || host.endsWith(".usemingla.com") ||
    host.endsWith(".vercel.app");
  return ok ? u.origin : null;
}

// ── Defensive report readers (the report is service-written JSON, but the
//    email builder still never throws on a missing field). ───────────────────
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── #4452 §6.9: the report email is built by ./toolEmail.ts (one builder for the
//    four tools, on the rebranded frame). The email is a SUMMARY + a link, never
//    the full report: the full report lives on web behind the tokenized link.

// ── ISSUE-1354 founder-notify builder ───────────────────────────────────────
// Pure + exported (the regression test imports it). Maps the tool to its
// friendly product name and pulls 1-3 defensive report highlights (each guarded,
// skipped cleanly when absent). The visitor's exact tokenized report link and a
// deep-link to the admin Tool Leads console are both included. Rendered through
// renderShell at the call site (mirrors the visitor path). Never throws on a
// missing field; every interpolated string is escaped via escapeHtml.
export function buildLeadNotifyEmail(
  args: {
    tool: "venues" | "events" | "trips" | "experiences";
    email: string;
    report: Record<string, unknown>;
    reportLink: string;
    adminUrl: string;
    whenIso: string;
  },
): { subject: string; bodyHtml: string; text: string } {
  const { tool, email, report, reportLink, adminUrl, whenIso } = args;
  const friendly = tool === "events"
    ? "Event Turnout Predictor"
    : tool === "trips"
    ? "Quote Any Trip"
    : tool === "experiences"
    ? "Undercharging Audit"
    : "Venue Website Grader";

  // 1-3 defensive report highlights per tool (each guarded; absent → skipped).
  const highlights: string[] = [];
  if (tool === "venues") {
    const scores = asRecord(report.scores);
    const grade = asString(scores.grade);
    const overall = asNumber(scores.overall);
    if (grade) highlights.push(`Grade: ${grade}`);
    if (overall !== null) highlights.push(`Overall score: ${overall}`);
  } else if (tool === "events") {
    const forecast = asRecord(report.forecast);
    const lo = asNumber(forecast.total_low);
    const hi = asNumber(forecast.total_high);
    if (lo !== null && hi !== null) {
      highlights.push(`Forecast turnout: ${lo}–${hi}`);
    }
  } else if (tool === "trips") {
    const plan = asRecord(report.plan);
    const ppp = asNumber(plan.recommended_price_per_person);
    if (ppp !== null) highlights.push(`Recommended price / person: ${ppp}`);
  } else if (tool === "experiences") {
    const audit = asRecord(report.audit);
    const verdict = asString(audit.verdict);
    const amount = asNumber(audit.headline_amount);
    if (verdict) highlights.push(`Verdict: ${verdict}`);
    if (amount !== null) highlights.push(`Headline amount: ${amount}`);
  }

  const subject = `New lead: ${friendly} — ${email}`;

  const sections: string[] = [];
  sections.push(
    `<h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.25;color:${BRAND_INK};font-weight:700;">New ${
      escapeHtml(friendly)
    } lead</h1>`,
  );
  sections.push(
    `<p style="margin:0 0 4px 0;font-size:15px;color:${BRAND_INK};font-weight:600;">${
      escapeHtml(email)
    }</p>`,
  );
  sections.push(
    `<p style="margin:0 0 16px 0;font-size:13px;color:${BRAND_MUTED};">Unlocked ${
      escapeHtml(whenIso)
    }</p>`,
  );
  if (highlights.length > 0) {
    sections.push(
      `<ul style="margin:0 0 16px 0;padding-left:18px;">${
        highlights
          .map((h) =>
            `<li style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">${
              escapeHtml(h)
            }</li>`
          )
          .join("")
      }</ul>`,
    );
  }
  sections.push(
    `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">The lead's report: <a href="${
      escapeHtml(reportLink)
    }" style="color:${BRAND_ORANGE_BUTTON};font-weight:600;">open the exact link they received</a></p>`,
  );
  sections.push(
    `<p style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};"><a href="${
      escapeHtml(adminUrl)
    }" style="color:${BRAND_ORANGE_BUTTON};font-weight:600;">View all in Admin → Tool Leads</a></p>`,
  );

  const textLines: string[] = [];
  textLines.push(`New ${friendly} lead`, email, `Unlocked ${whenIso}`, "");
  for (const h of highlights) textLines.push(h);
  if (highlights.length > 0) textLines.push("");
  textLines.push(
    "The lead's report (the exact link they received):",
    reportLink,
    "",
    "View all in Admin -> Tool Leads:",
    adminUrl,
  );

  return { subject, bodyHtml: sections.join("\n"), text: textLines.join("\n") };
}

// ── HTTP entry ───────────────────────────────────────────────────────────────
/**
 * #4238 W3-3: the email unlock with the page's ad context is the host lead
 * (event id lead:tool:<id>). #4452 B20: a test or internal email or name
 * (public.inbound_lead_is_test, checked inside recordHostLead) sends nothing
 * and answers null, so the page's browser Lead twin stays silent. A real
 * visitor with ads off still records the opt-out-only Lead. Never throws.
 */
export async function recordToolGateLead(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  input: { runId: string; tool: string; email: string; name: string | null; ad: HostAdContext | null },
  deps: FireAdConversionDeps = {},
): Promise<string | null> {
  if (!input.ad) return null;
  return await recordHostLead(supabase, {
    subjectId: `tool:${input.runId}`,
    ad: input.ad,
    // #4452 §4.7: free tools are host tools; the label rides as host_lead, the source as tool:<tool>.
    source: `tool:${input.tool}`,
    contact: { email: input.email, name: input.name },
  }, deps);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const fields: string[] = [];
  const runId = body.run_id;
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  if (!isUuid(runId)) fields.push("run_id");
  if (!EMAIL_RE.test(email) || email.length < 3 || email.length > 254) {
    fields.push("email");
  }
  if (fields.length > 0) {
    return json({ error: "validation", fields }, 400);
  }
  // Origin of the report link in the email — validated to usemingla/vercel only.
  const reportBase = validateToolsOrigin(body.origin) ?? "https://usemingla.com";

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "server" }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Load the run (must have a generated report). ─────────────────────────
    // ISSUE-1734 P-30 (I-PROPOSED-1734-NOTIFY-WEB-GATE-ONLY): the gate REFUSES
    // app-lane rows — `lane = 'web'` is the row-lookup predicate, so an app
    // run's UUID posted here gets the existing 404: no fake "lead", no founder
    // notify, no report token minted for an app row. This predicate is the
    // ONLY #1734 change to this function.
    const { data: lead, error: leadErr } = await supabase
      .from("tool_leads")
      .select("id, tool, status, report, report_token, input")
      .eq("id", runId as string)
      .eq("lane", "web")
      .maybeSingle();
    if (leadErr) {
      console.error("[growth-tools-gate] lead lookup failed", leadErr.message);
      return json({ error: "server" }, 500);
    }
    if (!lead) return json({ error: "not_found" }, 404);
    const status = (lead as { status: string }).status;
    const toolRaw = (lead as { tool?: unknown }).tool;
    const tool = (toolRaw === "events" || toolRaw === "trips" || toolRaw === "experiences")
      ? toolRaw
      : "venues";
    const report = (lead as { report: unknown }).report;
    const gateable = status === "report_ready" || status === "gated_email" ||
      status === "emailed";
    if (!gateable || report === null || typeof report !== "object") {
      return json({ error: "report_not_ready" }, 409);
    }

    // ── Per-email cap (8 reports / 24h / tool) — the "scoped by email" guard.
    //    Counts existing runs this email already gated for THIS tool. The
    //    current row isn't counted (its email is set below), so >= max blocks
    //    the next one. Skips when this row is a re-gate of the same email.
    const alreadyThisRow =
      (lead as { email?: unknown }).email === email;
    if (!alreadyThisRow) {
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count, error: capErr } = await supabase
        .from("tool_leads")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .eq("tool", tool)
        .gte("created_at", sinceIso);
      if (!capErr && (count ?? 0) >= 10) {
        return json({ error: "rate_limited" }, 429);
      }
    }

    // ── Capture the email + mint a report-access token. Entering an email does
    //    NOT unlock the page; the full report is reachable only via the tokenized
    //    link we email — so the feature is only revealed to real, owned emails.
    const existingToken =
      typeof (lead as { report_token?: unknown }).report_token === "string"
        ? (lead as { report_token: string }).report_token
        : "";
    const reportToken = existingToken.length >= 16
      ? existingToken
      : crypto.randomUUID().replace(/-/g, "") +
        crypto.randomUUID().replace(/-/g, "");
    const { error: gateErr } = await supabase
      .from("tool_leads")
      .update({
        email,
        status: "gated_email",
        report_token: reportToken,
        // #4452 Q-A1-2: the optional, unticked "Also send me tips for hosts" box; strict true only.
        ...(body.marketing_consent === true
          ? { marketing_consent: true, consent_text: "Also send me tips for hosts. Optional.", consent_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", runId as string);
    if (gateErr) {
      console.error("[growth-tools-gate] email save failed", gateErr.message);
      return json({ error: "server" }, 500);
    }

    // #4238 W3-3: the email is captured, so this is the lead. Only with the
    // page's ad context; never fails or delays the unlock past one sender
    // timeout. The same row always yields the same event id (dedup).
    const leadInput = (lead as { input?: unknown }).input;
    const leadName = leadInput && typeof leadInput === "object" &&
        typeof (leadInput as { name?: unknown }).name === "string"
      ? (leadInput as { name: string }).name
      : null;
    const leadEventId = await recordToolGateLead(supabase, {
      runId: runId as string,
      tool,
      email,
      name: leadName,
      ad: parseHostAdContext(body.ad, req),
    });
    const reportPath = tool === "events"
      ? "/tools/events/report"
      : tool === "trips"
      ? "/tools/trips/report"
      : tool === "experiences"
      ? "/tools/pricing/report"
      : "/tools/venues/report";
    const reportLink = `${reportBase}${reportPath}?id=${
      encodeURIComponent(runId as string)
    }&t=${encodeURIComponent(reportToken)}`;

    // ── Render + send via Resend (system sender, reply-to support@). ─────────
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error("[growth-tools-gate] RESEND_API_KEY missing");
      return json({ error: "email_failed" }, 502);
    }

    // ── ISSUE-1354 — founder notification (best-effort). Fires ONCE per lead on
    //    the report_ready → gated_email transition: `status` is the PRIOR status
    //    read above, so re-gates (prior status gated_email/emailed) never
    //    re-notify, and the anonymous run — which never reaches this function —
    //    never notifies. Entirely wrapped in try/catch that only console.errors:
    //    a throw or a non-ok Resend response MUST NOT change the visitor's HTTP
    //    response or the visitor report email below. Reuses the already-validated
    //    resendKey + the same no-reply sender identity; adds no new secret.
    if (status === "report_ready") {
      try {
        const notify = buildLeadNotifyEmail({
          tool,
          email,
          report: report as Record<string, unknown>,
          reportLink,
          adminUrl: ADMIN_TOOL_LEADS_URL,
          whenIso: new Date().toISOString(),
        });
        const notifyHtml = renderShell({
          preheader: notify.subject,
          bodyHtml: notify.bodyHtml,
          supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? REPLY_TO,
          logoUrl: minglaLogoUrl(),
          footerAddress: resolveRuntimeString("mingla_footer_address", "MINGLA_FOOTER_ADDRESS") ??
            "Mingla, hello@usemingla.com",
        });
        const notifySender = EMAIL_SENDERS.noreply;
        assertNotResendSandbox(notifySender);
        // no-attachment: the founder lead-notify is plain transactional HTML (links only, no file).
        const notifyRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: formatSenderHeader(notifySender),
            to: [LEAD_NOTIFY_TO],
            reply_to: email,
            subject: notify.subject,
            html: notifyHtml,
            text: notify.text,
          }),
        });
        if (!notifyRes.ok) {
          console.error(
            "[growth-tools-gate] founder notify failed",
            notifyRes.status,
          );
        }
      } catch (e) {
        console.error(
          "[growth-tools-gate] founder notify threw",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // #1154 — the growth-tools funnel gets its own no-reply identity instead of
    // the shared `system` sender (a payments@ identity in prod). reply_to below
    // still routes replies to support@.
    const sender = EMAIL_SENDERS.noreply;
    try {
      assertNotResendSandbox(sender);
    } catch (e) {
      console.error(
        "[growth-tools-gate] sandbox sender rejected",
        e instanceof Error ? e.message : String(e),
      );
      return json({ error: "email_failed" }, 502);
    }

    const tips = body.marketing_consent === true;
    const built = buildToolReportEmail({ tool, report: report as Record<string, unknown>, reportLink, tips });
    const html = renderShell({
      preheader: built.preheader,
      bodyHtml: built.bodyHtml,
      label: built.label,
      // §5.10: free tools are host tools; the call goes to /schedule?icp=<tool's icp>.
      actionBar: { kind: "host", icp: TOOL_ICP[tool] },
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? REPLY_TO,
      logoUrl: minglaLogoUrl(),
      footerAddress: resolveRuntimeString("mingla_footer_address", "MINGLA_FOOTER_ADDRESS") ??
        "Mingla, hello@usemingla.com",
    });

    // no-attachment: the grader report is plain transactional HTML only.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(sender),
        to: [email],
        reply_to: REPLY_TO,
        subject: built.subject,
        html,
        text: built.text,
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const b = await res.json() as { message?: string };
        detail = b?.message ?? "";
      } catch {
        /* ignore unparsable error body */
      }
      console.error(
        "[growth-tools-gate] resend failed",
        `resend_${res.status}:${detail}`,
      );
      // Row stays 'gated_email' — the lead is captured; the send can retry.
      return json({ error: "email_failed" }, 502);
    }

    // ── #4452 §6.9 (SC-144): the tool follow-ups (day 2, day 7) run through the
    //    forms automation engine, and only for people who ticked "Also send me
    //    tips for hosts". Best-effort: a failure never changes the response.
    if (tips) {
      try {
        const tz = typeof body.time_zone === "string" && body.time_zone.length <= 64 ? body.time_zone : null;
        const { error: enrolErr } = await supabase.rpc("forms_tool_followup_enroll", {
          p_tool: tool,
          p_run_id: runId as string,
          p_email: email,
          p_time_zone: tz,
        });
        if (enrolErr) console.error("[growth-tools-gate] follow-up enrol failed", enrolErr.message);
      } catch (e) {
        console.error("[growth-tools-gate] follow-up enrol threw", e instanceof Error ? e.message : String(e));
      }
    }

    // ── Mark emailed (best-effort — the send already succeeded). ─────────────
    const { error: emailedErr } = await supabase
      .from("tool_leads")
      .update({ status: "emailed" })
      .eq("id", runId as string);
    if (emailedErr) {
      console.error(
        "[growth-tools-gate] emailed-status update failed (non-fatal)",
        emailedErr.message,
      );
    }

    return json(
      leadEventId ? { ok: true, lead_event_id: leadEventId } : { ok: true },
      200,
    );
  } catch (err) {
    console.error(
      "[growth-tools-gate] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

// Run the HTTP server only when this module is the program entry point — NOT
// when imported by a test suite (which would otherwise try to bind a port).
if (import.meta.main) {
  serve(handler);
}
