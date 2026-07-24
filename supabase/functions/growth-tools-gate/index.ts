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
// The email is a SUMMARY + a link — never the full report. The full report
// (scores, fixes, competition, before/after) lives on web behind the tokenized
// link, so it is only ever seen by someone who owns the email we sent it to.
export function buildSummaryEmail(
  report: Record<string, unknown>,
  reportLink: string,
): { subject: string; preheader: string; bodyHtml: string; text: string } {
  const venue = asRecord(report.venue);
  const scores = asRecord(report.scores);
  const venueName = asString(venue.name) || "your venue";
  const grade = asString(scores.grade) || "?";
  const overall = asNumber(scores.overall);
  const aiRead = asString(report.ai_read);
  const percentile = asRecord(report.percentile);
  const pct = asNumber(percentile.better_than_pct);
  const pctCity = asString(percentile.city);
  const competitors = Array.isArray(asRecord(report.competition).competitors)
    ? (asRecord(report.competition).competitors as unknown[]).length
    : 0;
  const fixCount = Array.isArray(report.fixes)
    ? (report.fixes as unknown[]).length
    : 0;
  const checks = Array.isArray(asRecord(report.site_signals).checks)
    ? (asRecord(report.site_signals).checks as unknown[])
    : [];
  const failing = checks.filter((c) => asRecord(c).status === "fail").length;

  const subject = `Your website grade: ${grade} — ${venueName}`;
  const preheader = aiRead ||
    `${venueName} scored ${overall ?? "?"}/100. Open your full report.`;

  const inside: string[] = [];
  if (checks.length > 0) {
    inside.push(
      `Your site health check — ${checks.length} points scored${
        failing > 0 ? `, ${failing} failing` : ""
      }`,
    );
  }
  if (pct !== null && pctCity) {
    inside.push(`Where you rank — better than ${pct}% of venues in ${pctCity}`);
  }
  if (competitors > 0) {
    inside.push(
      `Your head-to-head vs ${competitors} nearby competitor${
        competitors === 1 ? "" : "s"
      }`,
    );
  }
  inside.push("Your homepage redesigned — a real before / after");
  if (fixCount > 0) {
    inside.push(`${fixCount} specific fixes, ranked by impact`);
  }

  const sections: string[] = [];
  const textLines: string[] = [];

  sections.push(
    `<h1 style="margin:0 0 6px 0;font-size:24px;line-height:1.25;color:${BRAND_INK};font-weight:700;">Grade ${
      escapeHtml(grade)
    } — ${escapeHtml(venueName)}</h1>`,
  );
  textLines.push(`Grade ${grade} — ${venueName}`, "");
  if (overall !== null) {
    sections.push(
      `<p style="margin:0 0 12px 0;font-size:14px;color:${BRAND_MUTED};">Overall website score: ${overall}/100</p>`,
    );
    textLines.push(`Overall website score: ${overall}/100`, "");
  }
  if (aiRead) {
    sections.push(
      `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${
        escapeHtml(aiRead)
      }</p>`,
    );
    textLines.push(aiRead, "");
  }

  sections.push(
    `<p style="margin:18px 0 8px 0;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND_MUTED};">Inside your full report</p>`,
  );
  sections.push(
    `<ul style="margin:0 0 8px 0;padding:0 0 0 18px;">${
      inside.map((line) =>
        `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">${
          escapeHtml(line)
        }</li>`
      ).join("")
    }</ul>`,
  );
  textLines.push("INSIDE YOUR FULL REPORT");
  for (const line of inside) textLines.push(`- ${line}`);
  textLines.push("");

  // The primary CTA — the tokenized report link.
  sections.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px 0;">
      <tr><td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;">
        <a href="${
      escapeHtml(reportLink)
    }" style="display:inline-block;padding:14px 26px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">View your full report &amp; redesign</a>
      </td></tr>
    </table>
    <p style="margin:0 0 4px 0;font-size:12px;color:${BRAND_MUTED};">This link is just for you — it opens your full report on the web.</p>`,
  );
  textLines.push(
    "VIEW YOUR FULL REPORT & REDESIGN:",
    reportLink,
    "(This link is just for you.)",
    "",
  );

  // The offer.
  sections.push(
    `<div style="margin:22px 0 6px 0;padding:16px 18px;border-radius:12px;border:1px solid ${BRAND_BORDER};">
      <p style="margin:0;font-size:14px;line-height:1.5;color:${BRAND_INK};"><strong>Mingla can drive people to your venue for as low as $3.99 per person.</strong> That's the introductory promotion — the full report shows you the math.</p>
    </div>`,
  );
  textLines.push(
    "Mingla can drive people to your venue for as low as $3.99 per person — the full report shows the math.",
    "",
  );

  return {
    subject,
    preheader: preheader.slice(0, 120),
    bodyHtml: sections.join("\n"),
    text: textLines.join("\n"),
  };
}

// ISSUE-1004 — the Event Turnout Predictor summary email. Same posture as the
// grader's: a SUMMARY + a tokenized link, never the full forecast inline.
export function buildEventSummaryEmail(
  report: Record<string, unknown>,
  reportLink: string,
): { subject: string; preheader: string; bodyHtml: string; text: string } {
  const event = asRecord(report.event);
  const forecast = asRecord(report.forecast);
  const plan = asRecord(report.paid_plan);
  const title = asString(event.title) || "your event";
  const cur = asString(event.currency) || "USD";
  const lo = asNumber(forecast.total_low);
  const hi = asNumber(forecast.total_high);
  const range = lo !== null && hi !== null ? `${lo}–${hi}` : "?";
  const headline = asString(forecast.headline_read);
  const budget = asNumber(plan.budget);
  const attLo = asNumber(plan.attendees_low);
  const attHi = asNumber(plan.attendees_high);
  const competitors = Array.isArray(report.competitors)
    ? (report.competitors as unknown[]).length
    : 0;
  const fixCount = Array.isArray(report.fixes)
    ? (report.fixes as unknown[]).length
    : 0;

  const subject = `Turnout forecast: ~${range} at ${title}`;
  const preheader = headline ||
    `We forecast ~${range} people at ${title}. Open your full report.`;

  const inside: string[] = [];
  if (budget !== null && budget > 0 && attLo !== null && attHi !== null) {
    inside.push(
      `Your ad-spend plan — what ${budget} ${cur} can add (~${attLo}–${attHi} more people)`,
    );
  }
  if (competitors > 0) {
    inside.push(
      `Who you're up against — ${competitors} competing event${
        competitors === 1 ? "" : "s"
      } that night`,
    );
  }
  inside.push("What's driving your turnout — the full factor breakdown");
  if (fixCount > 0) {
    inside.push(`${fixCount} concrete ways to pull a bigger crowd`);
  }
  inside.push("Your event as a Mingla listing — ready to publish");

  const sections: string[] = [];
  const textLines: string[] = [];

  sections.push(
    `<h1 style="margin:0 0 6px 0;font-size:24px;line-height:1.25;color:${BRAND_INK};font-weight:700;">~${
      escapeHtml(range)
    } expected — ${escapeHtml(title)}</h1>`,
  );
  textLines.push(`~${range} expected — ${title}`, "");
  if (headline) {
    sections.push(
      `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${
        escapeHtml(headline)
      }</p>`,
    );
    textLines.push(headline, "");
  }

  sections.push(
    `<p style="margin:18px 0 8px 0;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND_MUTED};">Inside your full report</p>`,
  );
  sections.push(
    `<ul style="margin:0 0 8px 0;padding:0 0 0 18px;">${
      inside.map((line) =>
        `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">${
          escapeHtml(line)
        }</li>`
      ).join("")
    }</ul>`,
  );
  textLines.push("INSIDE YOUR FULL REPORT");
  for (const line of inside) textLines.push(`- ${line}`);
  textLines.push("");

  sections.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px 0;">
      <tr><td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;">
        <a href="${
      escapeHtml(reportLink)
    }" style="display:inline-block;padding:14px 26px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">View your full turnout report</a>
      </td></tr>
    </table>
    <p style="margin:0 0 4px 0;font-size:12px;color:${BRAND_MUTED};">This link is just for you — it opens your full forecast on the web.</p>`,
  );
  textLines.push("VIEW YOUR FULL TURNOUT REPORT:", reportLink, "(This link is just for you.)", "");

  sections.push(
    `<div style="margin:22px 0 6px 0;padding:16px 18px;border-radius:12px;border:1px solid ${BRAND_BORDER};">
      <p style="margin:0;font-size:14px;line-height:1.5;color:${BRAND_INK};"><strong>Mingla can put your event in front of high-intent people for as low as $3.99 per head.</strong> That's the introductory promotion — your report shows the math for your budget.</p>
    </div>`,
  );
  textLines.push(
    "Mingla can put your event in front of high-intent people for as low as $3.99 per head — your report shows the math.",
    "",
  );

  return {
    subject,
    preheader: preheader.slice(0, 120),
    bodyHtml: sections.join("\n"),
    text: textLines.join("\n"),
  };
}

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
  const pillBadge = (label: string): string =>
    `<span style="display:inline-block;margin-left:8px;padding:2px 10px;border:1px solid ${BRAND_BORDER};border-radius:999px;font-size:11px;font-weight:600;color:${BRAND_MUTED};vertical-align:middle;">${
      escapeHtml(label)
    }</span>`;

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

  // ── Site health (ISSUE-1003 depth) — deterministic pass/warn/fail checks. ──
  const siteSignals = asRecord(report.site_signals);
  const checks = Array.isArray(siteSignals.checks) ? siteSignals.checks : [];
  if (checks.length > 0) {
    let pass = 0, warn = 0, fail = 0;
    const rows: string[] = [];
    const textRows: string[] = [];
    for (const raw of checks) {
      const c = asRecord(raw);
      const label = asString(c.label);
      const status = asString(c.status);
      const detail = asString(c.detail);
      if (!label) continue;
      const mark = status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
      const color = status === "pass"
        ? "#2E7D52"
        : status === "warn"
        ? "#B7791F"
        : "#C0392B";
      if (status === "pass") pass++;
      else if (status === "warn") warn++;
      else fail++;
      rows.push(
        `<tr>
          <td style="padding:5px 10px 5px 0;font-size:15px;font-weight:700;color:${color};vertical-align:top;">${mark}</td>
          <td style="padding:5px 0;font-size:13px;line-height:1.45;color:${BRAND_INK};vertical-align:top;"><strong>${
          escapeHtml(label)
        }</strong>${
          detail ? ` — <span style="color:${BRAND_MUTED};">${escapeHtml(detail)}</span>` : ""
        }</td>
        </tr>`,
      );
      textRows.push(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
    }
    sections.push(h2("Site health check"));
    sections.push(
      muted(`${pass} passed · ${warn} warning${warn === 1 ? "" : "s"} · ${fail} failing`),
    );
    sections.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">${rows.join("")}</table>`,
    );
    textLines.push(
      `SITE HEALTH CHECK — ${pass} passed, ${warn} warnings, ${fail} failing`,
      ...textRows,
      "",
    );
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
      const impactLabel = fix.impact === "high" ? "High impact" : "";
      sections.push(
        `<div style="margin:0 0 14px 0;padding:12px 14px;border:1px solid ${BRAND_BORDER};border-radius:10px;">
          <p style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:${BRAND_INK};">${
          escapeHtml(title)
        }${impactLabel ? pillBadge(impactLabel) : ""}</p>
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

  // ── What your customers say (ISSUE-1003) — real review themes. ──
  const reviewThemes = asRecord(report.review_themes);
  const praise = asStringArray(reviewThemes.praise);
  const complaints = asStringArray(reviewThemes.complaints);
  if (praise.length > 0 || complaints.length > 0) {
    sections.push(h2("What your customers say"));
    textLines.push("WHAT YOUR CUSTOMERS SAY");
    if (praise.length > 0) {
      sections.push(p("People love:"));
      sections.push(
        `<ul style="margin:0 0 10px 0;padding:0 0 0 18px;">${
          praise.map((s) =>
            `<li style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">${
              escapeHtml(s)
            }</li>`
          ).join("")
        }</ul>`,
      );
      textLines.push("People love:");
      for (const s of praise) textLines.push(`  + ${s}`);
    }
    if (complaints.length > 0) {
      sections.push(p("What comes up as a gripe:"));
      sections.push(
        `<ul style="margin:0 0 10px 0;padding:0 0 0 18px;">${
          complaints.map((s) =>
            `<li style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:${BRAND_MUTED};">${
              escapeHtml(s)
            }</li>`
          ).join("")
        }</ul>`,
      );
      textLines.push("What comes up as a gripe:");
      for (const s of complaints) textLines.push(`  - ${s}`);
    }
    textLines.push("");
  }

  // ── Competition (ISSUE-1003) — skipped cleanly when the report has none. ──
  const competition = asRecord(report.competition);
  const competitors = Array.isArray(competition.competitors)
    ? competition.competitors
    : [];
  const rankRead = asString(competition.your_rank_read);
  if (competitors.length > 0) {
    sections.push(h2("Who's eating your Friday nights"));
    textLines.push("WHO'S EATING YOUR FRIDAY NIGHTS");
    if (rankRead) {
      sections.push(p(rankRead));
      textLines.push(rankRead);
    }
    for (const raw of competitors) {
      const comp = asRecord(raw);
      const name = asString(comp.name);
      if (!name) continue;
      const score = asNumber(comp.mingla_score);
      const better = asStringArray(comp.what_they_do_better);
      sections.push(
        `<div style="margin:0 0 14px 0;padding:12px 14px;border:1px solid ${BRAND_BORDER};border-radius:10px;">
          <p style="margin:0 0 6px 0;font-size:14px;font-weight:700;color:${BRAND_INK};">${
          escapeHtml(name)
        }${score !== null ? pillBadge(`Mingla ${Math.round(score)}`) : ""}</p>
          ${
          better.length > 0
            ? `<ul style="margin:0;padding:0 0 0 18px;">${
              better
                .map((b) =>
                  `<li style="margin:0 0 4px 0;font-size:13px;line-height:1.5;color:${BRAND_INK};">${
                    escapeHtml(b)
                  }</li>`
                )
                .join("")
            }</ul>`
            : ""
        }
        </div>`,
      );
      textLines.push(
        `* ${name}${score !== null ? ` (Mingla ${Math.round(score)})` : ""}`,
      );
      for (const b of better) textLines.push(`  - ${b}`);
    }
    textLines.push("");
  }

  // ── Head-to-head scorecard (ISSUE-1003) ──
  const headToHead = asRecord(report.head_to_head);
  const hhRows = Array.isArray(headToHead.rows) ? headToHead.rows : [];
  const hhCompetitor = asString(headToHead.competitor);
  if (hhRows.length > 0 && hhCompetitor) {
    sections.push(h2(`You vs ${hhCompetitor}`));
    textLines.push(`YOU VS ${hhCompetitor.toUpperCase()}`);
    const trs: string[] = [
      `<tr>
        <td style="padding:6px 12px 6px 0;font-size:12px;color:${BRAND_MUTED};font-weight:600;"></td>
        <td style="padding:6px 12px 6px 0;font-size:12px;color:${BRAND_INK};font-weight:700;">You</td>
        <td style="padding:6px 0;font-size:12px;color:${BRAND_MUTED};font-weight:700;">${escapeHtml(hhCompetitor)}</td>
      </tr>`,
    ];
    for (const raw of hhRows) {
      const r = asRecord(raw);
      const dim = asString(r.dimension);
      const you = asString(r.you);
      const them = asString(r.them);
      const winner = asString(r.winner);
      if (!dim) continue;
      const youWeight = winner === "you" ? "700" : "400";
      const themWeight = winner === "them" ? "700" : "400";
      trs.push(
        `<tr>
          <td style="padding:6px 12px 6px 0;font-size:13px;color:${BRAND_MUTED};vertical-align:top;">${escapeHtml(dim)}</td>
          <td style="padding:6px 12px 6px 0;font-size:13px;color:${BRAND_INK};font-weight:${youWeight};vertical-align:top;">${escapeHtml(you)}</td>
          <td style="padding:6px 0;font-size:13px;color:${BRAND_INK};font-weight:${themWeight};vertical-align:top;">${escapeHtml(them)}</td>
        </tr>`,
      );
      textLines.push(`${dim}: you — ${you} | ${hhCompetitor} — ${them}${winner === "you" ? " (you win)" : winner === "them" ? " (they win)" : ""}`);
    }
    sections.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">${trs.join("")}</table>`,
    );
    textLines.push("");
  }

  // ── Where you already win (ISSUE-1003) ──
  const whereYouWin = asStringArray(report.where_you_win);
  if (whereYouWin.length > 0) {
    sections.push(h2("Where you already win"));
    textLines.push("WHERE YOU ALREADY WIN");
    sections.push(
      `<ul style="margin:0 0 10px 0;padding:0 0 0 18px;">${
        whereYouWin.map((s) =>
          `<li style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:${BRAND_INK};">${escapeHtml(s)}</li>`
        ).join("")
      }</ul>`,
    );
    for (const s of whereYouWin) textLines.push(`+ ${s}`);
    textLines.push("");
  }

  // ── How to outrank them ──
  const playbook = Array.isArray(competition.outrank_playbook)
    ? competition.outrank_playbook
    : [];
  if (playbook.length > 0) {
    sections.push(h2("How to outrank them"));
    textLines.push("HOW TO OUTRANK THEM");
    for (const raw of playbook) {
      const item = asRecord(raw);
      const move = asString(item.move);
      if (!move) continue;
      const why = asString(item.why_it_works);
      const effort = asString(item.effort);
      const effortLabel = effort === "this_week"
        ? "This week"
        : effort === "this_month"
        ? "This month"
        : effort === "project"
        ? "Bigger project"
        : "";
      sections.push(
        `<div style="margin:0 0 14px 0;padding:12px 14px;border:1px solid ${BRAND_BORDER};border-radius:10px;">
          <p style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:${BRAND_INK};">${
          escapeHtml(move)
        }${effortLabel ? pillBadge(effortLabel) : ""}</p>
          ${
          why
            ? `<p style="margin:0;font-size:13px;line-height:1.5;color:${BRAND_MUTED};">${
              escapeHtml(why)
            }</p>`
            : ""
        }
        </div>`,
      );
      textLines.push(`* ${move}${effortLabel ? ` [${effortLabel}]` : ""}`);
      if (why) textLines.push(`  Why: ${why}`);
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

  // ── The offer (ISSUE-1003) — the wow close. ──
  sections.push(
    `<div style="margin:26px 0 6px 0;padding:18px 20px;border-radius:14px;background:${BRAND_ORANGE_BUTTON};">
      <p style="margin:0 0 4px 0;font-size:18px;line-height:1.3;color:#FFFFFF;font-weight:700;">We can drive people to your venue for as low as $3.99 per person.</p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#FFF3EA;">That's the introductory Mingla promotion — claim your page or book a free call and we'll show you the math.</p>
    </div>`,
  );
  textLines.push(
    "WE CAN DRIVE PEOPLE TO YOUR VENUE FROM $3.99 PER PERSON.",
    "That's the introductory Mingla promotion — claim your page or book a free call and we'll show you the math.",
    "",
  );

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
    const { data: lead, error: leadErr } = await supabase
      .from("tool_leads")
      .select("id, tool, status, report, report_token")
      .eq("id", runId as string)
      .maybeSingle();
    if (leadErr) {
      console.error("[growth-tools-gate] lead lookup failed", leadErr.message);
      return json({ error: "server" }, 500);
    }
    if (!lead) return json({ error: "not_found" }, 404);
    const status = (lead as { status: string }).status;
    const tool = (lead as { tool?: unknown }).tool === "events"
      ? "events"
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
      if (!capErr && (count ?? 0) >= 8) {
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
      .update({ email, status: "gated_email", report_token: reportToken })
      .eq("id", runId as string);
    if (gateErr) {
      console.error("[growth-tools-gate] email save failed", gateErr.message);
      return json({ error: "server" }, 500);
    }
    const reportPath = tool === "events" ? "/tools/events/report" : "/tools/venues/report";
    const reportLink = `${reportBase}${reportPath}?id=${
      encodeURIComponent(runId as string)
    }&t=${encodeURIComponent(reportToken)}`;

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

    const built = tool === "events"
      ? buildEventSummaryEmail(report as Record<string, unknown>, reportLink)
      : buildSummaryEmail(report as Record<string, unknown>, reportLink);
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
