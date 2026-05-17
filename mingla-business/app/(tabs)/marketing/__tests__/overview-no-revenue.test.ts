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

  it("(T-06) does NOT render 'Opened' as a funnel-card label", () => {
    // Tolerate the word in surrounding prose / comments, but the LITERAL
    // funnel-card label is `<OverviewMetricCard label="Opened" ...>` — block
    // that pattern. Also block a `"OPENED"` (all-caps labelCap style) literal.
    expect(source.includes('label="Opened"')).toBe(false);
    expect(source.includes('label="OPENED"')).toBe(false);
  });
});
