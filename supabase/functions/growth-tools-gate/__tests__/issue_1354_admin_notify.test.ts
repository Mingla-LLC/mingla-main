// ISSUE-1354 [Admin: see all free-tool submissions] — implementor happy-path
// regression test for the founder-notify hook in growth-tools-gate.
//
// Run: deno test --allow-read supabase/functions/growth-tools-gate/__tests__/issue_1354_admin_notify.test.ts
//
// Two angles:
//   1. buildLeadNotifyEmail (pure, exported) content is correct — friendly tool
//      name, lead email, a defensive report highlight, and the visitor's exact
//      report link all appear in subject/text/bodyHtml.
//   2. The notify is STRUCTURALLY guarded in index.ts — it fires only on the
//      report_ready transition (`status === "report_ready"`), targets
//      LEAD_NOTIFY_TO / seth@usemingla.com, and is wrapped in try/catch
//      (best-effort — never breaks the visitor gate).
//
// fails-on-revert: deleting the notify block from index.ts drops the
// `status === "report_ready"` guard + `to: [LEAD_NOTIFY_TO]` + the try/catch, so
// the §2 structural assertions FAIL. Renaming/removing the exported
// buildLeadNotifyEmail breaks the import, so §1 FAILS. See the report's
// Regression Test section for the verified commit hash.

import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { buildLeadNotifyEmail } from "../index.ts";

const INDEX_URL = new URL("../index.ts", import.meta.url);

// ── §1. builder content ──────────────────────────────────────────────────────
Deno.test("buildLeadNotifyEmail — venues content (friendly name + email + highlight + link)", () => {
  const reportLink =
    "https://usemingla.com/tools/venues/report?id=abc123&t=tok999";
  const out = buildLeadNotifyEmail({
    tool: "venues",
    email: "lead@example.com",
    report: {
      venue: { name: "The Corner Bar" },
      scores: { grade: "C+", overall: 62 },
    },
    reportLink,
    adminUrl: "https://admin.usemingla.com/#/tool-leads",
    whenIso: "2026-07-29T12:00:00.000Z",
  });

  // Subject names the friendly tool + the lead email.
  assertStringIncludes(out.subject, "Venue Website Grader");
  assertStringIncludes(out.subject, "lead@example.com");

  // Plain-text body carries the friendly name, email, a highlight, and the exact
  // (unescaped) report link.
  assertStringIncludes(out.text, "Venue Website Grader");
  assertStringIncludes(out.text, "lead@example.com");
  assertStringIncludes(out.text, "Grade: C+");
  assertStringIncludes(out.text, "Overall score: 62");
  assertStringIncludes(out.text, reportLink);
  assertStringIncludes(out.text, "https://admin.usemingla.com/#/tool-leads");

  // HTML body carries the friendly name, a highlight, and the report link (the
  // `&` is HTML-escaped to `&amp;`, so assert the pre-`&` prefix).
  assertStringIncludes(out.bodyHtml, "Venue Website Grader");
  assertStringIncludes(out.bodyHtml, "Grade: C+");
  assertStringIncludes(out.bodyHtml, "/tools/venues/report?id=abc123");
});

Deno.test("buildLeadNotifyEmail — every tool maps to its friendly product name", () => {
  const cases: Array<
    [Parameters<typeof buildLeadNotifyEmail>[0]["tool"], string]
  > = [
    ["venues", "Venue Website Grader"],
    ["events", "Event Turnout Predictor"],
    ["trips", "Quote Any Trip"],
    ["experiences", "Undercharging Audit"],
  ];
  for (const [tool, friendly] of cases) {
    const out = buildLeadNotifyEmail({
      tool,
      email: "x@y.com",
      report: {},
      reportLink: "https://usemingla.com/tools/x/report?id=1&t=2",
      adminUrl: "https://admin.usemingla.com/#/tool-leads",
      whenIso: "2026-07-29T12:00:00.000Z",
    });
    assertStringIncludes(out.subject, friendly);
    assertStringIncludes(out.bodyHtml, friendly);
  }
});

Deno.test("buildLeadNotifyEmail — never throws on a missing/empty report (highlights skipped cleanly)", () => {
  const out = buildLeadNotifyEmail({
    tool: "events",
    email: "z@z.com",
    report: {}, // no forecast → highlight skipped, still produces a valid email
    reportLink: "https://usemingla.com/tools/events/report?id=1&t=2",
    adminUrl: "https://admin.usemingla.com/#/tool-leads",
    whenIso: "2026-07-29T12:00:00.000Z",
  });
  assertStringIncludes(out.subject, "Event Turnout Predictor");
  assert(out.text.length > 0);
  assert(out.bodyHtml.length > 0);
});

// ── §2. structural: notify guarded + best-effort in index.ts ─────────────────
Deno.test("growth-tools-gate index — notify fires only on report_ready + best-effort try/catch", async () => {
  const src = await Deno.readTextFile(INDEX_URL);

  // Guard: the notify block opens with `if (status === "report_ready") { try {`
  // — the prior-status idempotency signal, immediately wrapped in try/catch.
  assertMatch(src, /if \(status === "report_ready"\)\s*\{\s*try \{/);

  // Recipient is the founder const (seth@usemingla.com), targeted via LEAD_NOTIFY_TO.
  assertStringIncludes(src, 'const LEAD_NOTIFY_TO = "seth@usemingla.com"');
  assertStringIncludes(src, "to: [LEAD_NOTIFY_TO]");

  // reply_to = the lead's email (distinct from the visitor send's reply_to: REPLY_TO).
  assertStringIncludes(src, "reply_to: email,");

  // Best-effort: the block ends in a catch that only console.errors (never rethrows).
  assertStringIncludes(src, "[growth-tools-gate] founder notify threw");
});
