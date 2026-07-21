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
//      from the system sender, reply-to support@usemingla.com,
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

const { BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED, BRAND_BORDER } =
  SHELL_TOKENS;

const REPLY_TO = "support@usemingla.com";
const CTA_URL = "https://biz.usemingla.com/ZSCW?pid=tool_venues&c=tool_venues";
const CTA_LABEL = "Claim your venue on Mingla";

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

// ── Defensive report readers (the report is service-written JSON, but the
//    email builder still never throws on a missing field). ───────────────────
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── Email body builder (inline per SPEC — shared shell + escape only). ───────
export function buildReportEmail(report: Record<string, unknown>): {
  subject: string;
  preheader: string;
  bodyHtml: string;
  text: string;
} {
  const venue = asRecord(report.venue);
  const scores = asRecord(report.scores);
  const reasons = asRecord(scores.reasons);
  const vibeCard = asRecord(report.vibe_card);
  const googleListing = asRecord(report.google_listing);
  const hero = asRecord(report.rewritten_hero);

  const venueName = asString(venue.name, "your venue");
  const grade = asString(scores.grade, "?");
  const overall = asNumber(scores.overall);
  const aiRead = asString(report.ai_read);

  const subject = `Your website grade: ${grade} — ${venueName}`;
  const preheader = aiRead ||
    `${venueName} scored ${overall ?? "?"}/100. Here's what to fix.`;

  const h2 = (label: string): string =>
    `<h2 style="margin:26px 0 10px 0;font-size:16px;line-height:1.3;color:${BRAND_INK};font-weight:700;">${
      escapeHtml(label)
    }</h2>`;
  const p = (text: string): string =>
    `<p style="margin:0 0 10px 0;font-size:14px;line-height:1.55;color:${BRAND_INK};">${
      escapeHtml(text)
    }</p>`;
  const muted = (text: string): string =>
    `<p style="margin:0 0 10px 0;font-size:13px;line-height:1.5;color:${BRAND_MUTED};">${
      escapeHtml(text)
    }</p>`;

  const textLines: string[] = [];
  const sections: string[] = [];

  // ── Headline: grade + venue name ──
  sections.push(
    `<h1 style="margin:0 0 6px 0;font-size:24px;line-height:1.25;color:${BRAND_INK};font-weight:700;">Grade ${
      escapeHtml(grade)
    } — ${escapeHtml(venueName)}</h1>`,
  );
  textLines.push(`Grade ${grade} — ${venueName}`, "");
  if (overall !== null) {
    sections.push(muted(`Overall score: ${overall}/100`));
    textLines.push(`Overall score: ${overall}/100`, "");
  }
  if (aiRead) {
    sections.push(p(aiRead));
    textLines.push(aiRead, "");
  }

  // ── Vibe card ──
  const vibes = asStringArray(vibeCard.vibes);
  const occasions = asStringArray(vibeCard.occasions);
  const signature = asString(vibeCard.signature_mention);
  if (vibes.length > 0 || occasions.length > 0 || signature) {
    sections.push(h2("Your vibe card"));
    textLines.push("YOUR VIBE CARD");
    if (vibes.length > 0) {
      sections.push(p(`Vibes: ${vibes.join(" · ")}`));
      textLines.push(`Vibes: ${vibes.join(", ")}`);
    }
    if (occasions.length > 0) {
      sections.push(p(`Occasions: ${occasions.join(" · ")}`));
      textLines.push(`Occasions: ${occasions.join(", ")}`);
    }
    if (signature) {
      sections.push(p(`Signature: ${signature}`));
      textLines.push(`Signature: ${signature}`);
    }
    textLines.push("");
  }

  // ── Scores with numbers ──
  const scoreRows: Array<[string, string]> = [
    ["First impression", "first_impression"],
    ["Findability", "findability"],
    ["Mobile", "mobile"],
    ["Menu & offers", "menu_offers"],
    ["Occasion signal", "occasion_signal"],
  ];
  sections.push(h2("Scores"));
  textLines.push("SCORES");
  const scoreCells = scoreRows
    .map(([label, key]) => {
      const value = asNumber(scores[key]);
      const reason = asString(reasons[key]);
      textLines.push(
        `${label}: ${value ?? "-"}/100${reason ? ` — ${reason}` : ""}`,
      );
      return `<tr>
        <td style="padding:6px 14px 6px 0;font-size:14px;color:${BRAND_MUTED};white-space:nowrap;vertical-align:top;">${
        escapeHtml(label)
      }</td>
        <td style="padding:6px 14px 6px 0;font-size:14px;font-weight:700;color:${BRAND_INK};vertical-align:top;">${
        value ?? "-"
      }/100</td>
        <td style="padding:6px 0;font-size:13px;line-height:1.45;color:${BRAND_INK};vertical-align:top;">${
        escapeHtml(reason)
      }</td>
      </tr>`;
    })
    .join("");
  sections.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">${scoreCells}</table>`,
  );
  textLines.push("");

  // ── Google listing observations ──
  const listingLines = asStringArray(googleListing.lines);
  if (listingLines.length > 0) {
    sections.push(h2("How you show up online"));
    textLines.push("HOW YOU SHOW UP ONLINE");
    sections.push(
      `<ul style="margin:0 0 10px 0;padding:0 0 0 18px;">${
        listingLines
          .map((line) =>
            `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">${
              escapeHtml(line)
            }</li>`
          )
          .join("")
      }</ul>`,
    );
    for (const line of listingLines) textLines.push(`- ${line}`);
    textLines.push("");
  }

  // ── Fixes ──
  const fixes = Array.isArray(report.fixes) ? report.fixes : [];
  if (fixes.length > 0) {
    sections.push(h2("What to fix first"));
    textLines.push("WHAT TO FIX FIRST");
    for (const raw of fixes) {
      const fix = asRecord(raw);
      const title = asString(fix.title);
      const why = asString(fix.why);
      const change = asString(fix.change);
      if (!title) continue;
      sections.push(
        `<div style="margin:0 0 14px 0;padding:12px 14px;border:1px solid ${BRAND_BORDER};border-radius:10px;">
          <p style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:${BRAND_INK};">${
          escapeHtml(title)
        }</p>
          ${
          why
            ? `<p style="margin:0 0 4px 0;font-size:13px;line-height:1.5;color:${BRAND_MUTED};">${
              escapeHtml(why)
            }</p>`
            : ""
        }
          ${
          change
            ? `<p style="margin:0;font-size:13px;line-height:1.5;color:${BRAND_INK};">${
              escapeHtml(change)
            }</p>`
            : ""
        }
        </div>`,
      );
      textLines.push(`* ${title}`);
      if (why) textLines.push(`  Why: ${why}`);
      if (change) textLines.push(`  Change: ${change}`);
    }
    textLines.push("");
  }

  // ── Rewritten hero ──
  const before = asString(hero.before_excerpt);
  const after = asString(hero.after_copy);
  if (before || after) {
    sections.push(h2("Your homepage, rewritten"));
    textLines.push("YOUR HOMEPAGE, REWRITTEN");
    if (before) {
      sections.push(muted(`Now: “${before}”`));
      textLines.push(`Now: "${before}"`);
    }
    if (after) {
      sections.push(p(`Better: “${after}”`));
      textLines.push(`Better: "${after}"`);
    }
    textLines.push("");
  }

  // ── Footer CTA ──
  sections.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
      <tr>
        <td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;">
          <a href="${
      escapeHtml(CTA_URL)
    }" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${
      escapeHtml(CTA_LABEL)
    }</a>
        </td>
      </tr>
    </table>`,
  );
  textLines.push(`${CTA_LABEL}: ${CTA_URL}`);

  return {
    subject,
    preheader: preheader.slice(0, 120),
    bodyHtml: sections.join("\n"),
    text: textLines.join("\n"),
  };
}

// ── HTTP entry ───────────────────────────────────────────────────────────────
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
    const { data: lead, error: leadErr } = await supabase
      .from("tool_leads")
      .select("id, status, report")
      .eq("id", runId as string)
      .maybeSingle();
    if (leadErr) {
      console.error("[growth-tools-gate] lead lookup failed", leadErr.message);
      return json({ error: "server" }, 500);
    }
    if (!lead) return json({ error: "not_found" }, 404);
    const status = (lead as { status: string }).status;
    const report = (lead as { report: unknown }).report;
    const gateable = status === "report_ready" || status === "gated_email" ||
      status === "emailed";
    if (!gateable || report === null || typeof report !== "object") {
      return json({ error: "report_not_ready" }, 409);
    }

    // ── Capture the email FIRST (the lead survives a send failure). ──────────
    const { error: gateErr } = await supabase
      .from("tool_leads")
      .update({ email, status: "gated_email" })
      .eq("id", runId as string);
    if (gateErr) {
      console.error("[growth-tools-gate] email save failed", gateErr.message);
      return json({ error: "server" }, 500);
    }

    // ── Render + send via Resend (system sender, reply-to support@). ─────────
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error("[growth-tools-gate] RESEND_API_KEY missing");
      return json({ error: "email_failed" }, 502);
    }
    const sender = EMAIL_SENDERS.system;
    try {
      assertNotResendSandbox(sender);
    } catch (e) {
      console.error(
        "[growth-tools-gate] sandbox sender rejected",
        e instanceof Error ? e.message : String(e),
      );
      return json({ error: "email_failed" }, 502);
    }

    const built = buildReportEmail(report as Record<string, unknown>);
    const html = renderShell({
      preheader: built.preheader,
      bodyHtml: built.bodyHtml,
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? REPLY_TO,
      logoUrl: minglaLogoUrl(),
      footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ??
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

    return json({ ok: true }, 200);
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
