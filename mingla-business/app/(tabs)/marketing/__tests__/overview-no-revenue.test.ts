/**
 * overview-no-revenue.test.ts — ORCH-0863 T-06.
 *
 * Constitution #9 / I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION:
 *   The Overview route MUST NOT render a `$` symbol or "revenue" string
 *   anywhere, since no UTM-to-campaign attribution exists yet (Phase F).
 *   Also MUST NOT render "Opened" as a funnel-card label (no Resend
 *   webhook ingest path; SPEC NG-8).
 *
 * Source-grep style — reads the route file from disk and asserts the
 * forbidden tokens are absent. Lightweight, deterministic, and immune to
 * the RN render harness's complexity.
 */

import fs from "node:fs";
import path from "node:path";

const ROUTE_PATH = path.resolve(
  __dirname,
  "..",
  "index.tsx",
);

describe("Marketing Overview tab (ORCH-0863) — Constitution #9 enforcement", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(ROUTE_PATH, "utf8");
  });

  it("(T-06) does NOT contain a `$` literal anywhere in the file", () => {
    // Allow `$` only inside template-literal interpolation `${...}` and
    // inside import paths (not relevant here). Match a literal `$` that is
    // NOT immediately followed by `{`.
    const lines = source.split("\n");
    const offenders: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      // Strip ${...} occurrences before checking — those are TS interpolations.
      const stripped = line.replace(/\$\{[^}]*\}/g, "");
      if (stripped.includes("$")) {
        offenders.push(`L${i + 1}: ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(T-06) does NOT contain the word 'revenue' (case-insensitive)", () => {
    const lower = source.toLowerCase();
    expect(lower.includes("revenue")).toBe(false);
  });

  /**
   * [TEST-MOD-APPROVED #2510]
   *
   * SUPERSEDED ASSERTION, named explicitly: T-06's "does NOT render 'Opened'
   * as a funnel-card label".
   *
   * Its stated premise was "no Resend webhook ingest path; SPEC NG-8" — and
   * that premise was TRUE and worth enforcing: showing an open rate we could
   * not measure is exactly the Constitution #9 fabrication this file exists to
   * prevent. #2510 removes the premise by building the ingest
   * (`supabase/functions/resend-webhook` → `mkt_ingest_email_event` →
   * `marketing_messages.opened_at`), so the label now has evidence behind it.
   *
   * The PROTECTION does not go away, it MOVES: the card may only show a number
   * when real events exist, and must render an em-dash otherwise. A campaign
   * sent before the webhook existed still shows "—", never "0%", because
   * "nobody opened it" remains a claim we cannot make. That is asserted below,
   * so this file still fails if anyone shows an unmeasured open rate.
   *
   * The revenue half of T-06 is UNTOUCHED — no attribution exists, so `$` and
   * "revenue" stay banned.
   */
  it("(T-06) renders 'Opened' ONLY behind real event coverage (#2510)", () => {
    // The label is allowed now...
    expect(source.includes('label="OPENED"')).toBe(true);
    // ...but only guarded by hasEventCoverage, and only with an unknown
    // fallback. Both halves must be present, or an unmeasured campaign would
    // be shown a fabricated 0%.
    expect(source.includes("snap.funnel.hasEventCoverage")).toBe(true);
    expect(
      /label="OPENED"[\s\S]{0,240}hasEventCoverage \? snap\.funnel\.opened : null/
        .test(source),
    ).toBe(true);
  });

  it("(T-06b) an unmeasured campaign can never be shown a 0% open rate (#2510)", () => {
    // The percent prop must be gated too. A `null` value with a live percent
    // would still render "0%" beside the em-dash.
    expect(
      /label="OPENED"[\s\S]{0,300}hasEventCoverage \? openedPct : undefined/
        .test(source),
    ).toBe(true);
  });
});
