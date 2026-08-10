/**
 * Issue #1735 T-G7/T-G8 — deterministic competitor diff
 * (I-PROPOSED-1735-COMPETITOR-DIFF-DETERMINISTIC).
 *
 * Fails-on-revert anchors: removing the schema_version guard, the
 * missing-key skip, the sub-score exclusion, the fetch-failed degrade, or
 * the 6-chip cap turns this suite RED.
 */

import {
  DIFF_CHIP_CAP,
  GRADER_SIGNAL_KEYS,
  diffGraderReports,
} from "../graderReportDiff";
import type { GraderReport } from "../../../../services/growthToolsService";

const check = (
  key: string,
  status: "pass" | "warn" | "fail",
  label?: string,
): { key: string; label: string; status: "pass" | "warn" | "fail"; detail: string } => ({
  key,
  label: label ?? key,
  status,
  detail: "",
});

const baseReport = (over: Partial<GraderReport> = {}): GraderReport => ({
  venue: { name: "Bar Toto", city: "London", website: "https://bartoto.com/" },
  scores: {
    overall: 62,
    grade: "C",
    first_impression: 60,
    findability: 55,
    mobile: 70,
    menu_offers: 40,
    occasion_signal: 50,
    reasons: {},
  },
  site_signals: {
    checks: [
      check("https", "pass", "HTTPS"),
      check("mobile_viewport", "fail", "Mobile viewport"),
      check("booking_or_order", "fail", "Booking or order"),
      check("prices_visible", "warn", "Prices visible"),
    ],
  },
  meta: { generated_at: "2026-07-12T10:00:00Z", schema_version: 1 },
  ...over,
});

describe("issue #1735 diffGraderReports (T-G7 determinism)", () => {
  it("grade change + 2 signal flips + missing key skipped + sub-score change produces NO chip", () => {
    const prev = baseReport();
    const latest = baseReport({
      scores: {
        overall: 74,
        grade: "B",
        // Sub-score moved a lot — deliberately EXCLUDED from the diff.
        first_impression: 95,
        findability: 55,
        mobile: 70,
        menu_offers: 40,
        occasion_signal: 50,
        reasons: {},
      },
      site_signals: {
        checks: [
          check("https", "pass", "HTTPS"),
          check("mobile_viewport", "pass", "Mobile viewport"), // flip 1
          check("booking_or_order", "pass", "Booking or order"), // flip 2
          // "prices_visible" ABSENT on this side — must be SKIPPED, never inferred.
          check("social_links", "warn", "Social links"), // present latest-only — skipped
        ],
      },
      meta: { generated_at: "2026-08-09T10:00:00Z", schema_version: 1 },
    });

    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-07-12T10:00:00Z" },
      { report: latest, createdAt: "2026-08-09T10:00:00Z" },
    );

    expect(diff.degradedToGradeOnly).toBe(false);
    expect(diff.unreadableOnIso).toBeNull();
    // EXACTLY grade chip + the two genuine flips — nothing else.
    expect(diff.chips).toEqual([
      { kind: "grade", label: "Grade C → B (+12)" },
      { kind: "signal", label: "Mobile viewport: fail → pass" },
      { kind: "signal", label: "Booking or order: fail → pass" },
    ]);
    expect(diff.overflowCount).toBe(0);
    // Dated footer (G-12 rule 4) — ISO pair carried through.
    expect(diff.prevCreatedAt).toBe("2026-07-12T10:00:00Z");
    expect(diff.latestCreatedAt).toBe("2026-08-09T10:00:00Z");
  });

  it("same grade ⇒ no grade chip; overall alone NEVER becomes its own chip", () => {
    const prev = baseReport();
    const latest = baseReport({
      scores: { ...baseReport().scores, overall: 90 },
      meta: { generated_at: "2026-08-09T10:00:00Z", schema_version: 1 },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "a" },
      { report: latest, createdAt: "b" },
    );
    expect(diff.chips.filter((c) => c.kind === "grade")).toEqual([]);
  });

  it("negative overall delta renders with a minus sign", () => {
    const prev = baseReport();
    const latest = baseReport({
      scores: { ...baseReport().scores, overall: 50, grade: "D" },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "a" },
      { report: latest, createdAt: "b" },
    );
    expect(diff.chips[0]).toEqual({ kind: "grade", label: "Grade C → D (−12)" });
  });

  it("caps at 6 chips and reports the overflow", () => {
    const flip = (status: "pass" | "fail") =>
      GRADER_SIGNAL_KEYS.map((key) => check(key, status, key));
    const prev = baseReport({
      site_signals: { checks: flip("fail") },
    });
    const latest = baseReport({
      scores: { ...baseReport().scores, grade: "A", overall: 95 },
      site_signals: { checks: flip("pass") },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "a" },
      { report: latest, createdAt: "b" },
    );
    // 1 grade chip + 11 flips = 12 → 6 shown, 6 overflow.
    expect(diff.chips).toHaveLength(DIFF_CHIP_CAP);
    expect(diff.overflowCount).toBe(6);
    expect(diff.chips[0]?.kind).toBe("grade");
    // Signal chips follow the LATEST report's declaration order.
    expect(diff.chips[1]?.label).toBe(`${GRADER_SIGNAL_KEYS[0]}: fail → pass`);
  });
});

describe("issue #1735 diffGraderReports guards (T-G8)", () => {
  it("cross-schema_version pairs degrade to the grade chip only", () => {
    const prev = baseReport(); // schema_version 1
    const latest = baseReport({
      scores: { ...baseReport().scores, grade: "B" },
      site_signals: {
        checks: [check("mobile_viewport", "pass", "Mobile viewport")],
      },
      meta: { generated_at: "x", schema_version: 2 },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "a" },
      { report: latest, createdAt: "b" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.chips).toEqual([{ kind: "grade", label: "Grade C → B (+0)" }]);
  });

  it("absent schema_version means 1 (P-11 legacy) — NOT a cross-version pair", () => {
    const prev = baseReport({ meta: { generated_at: "x" } }); // no version ⇒ 1
    const latest = baseReport(); // explicit 1
    const diff = diffGraderReports(
      { report: prev, createdAt: "a" },
      { report: latest, createdAt: "b" },
    );
    expect(diff.degradedToGradeOnly).toBe(false);
  });

  it("fetch_failed on the latest report ⇒ grade-only + the honest unreadable date", () => {
    const prev = baseReport();
    const latest = baseReport({
      scores: { ...baseReport().scores, grade: "B" },
      meta: { generated_at: "x", schema_version: 1, fetch_failed: true },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-07-12T10:00:00Z" },
      { report: latest, createdAt: "2026-08-09T10:00:00Z" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.unreadableOnIso).toBe("2026-08-09T10:00:00Z");
    expect(diff.chips).toEqual([{ kind: "grade", label: "Grade C → B (+0)" }]);
  });

  it("empty checks on either side ⇒ unreadable degrade (never an inferred diff)", () => {
    const prev = baseReport({ site_signals: { checks: [] } });
    const latest = baseReport();
    const diff = diffGraderReports(
      { report: prev, createdAt: "prev-iso" },
      { report: latest, createdAt: "latest-iso" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.unreadableOnIso).toBe("prev-iso");
  });

  it("the 11 deterministic keys match the deployed engine's set", () => {
    expect(GRADER_SIGNAL_KEYS).toEqual([
      "https",
      "title_tag",
      "meta_description",
      "mobile_viewport",
      "social_preview",
      "structured_data",
      "menu_reachable",
      "booking_or_order",
      "phone_clickable",
      "prices_visible",
      "social_links",
    ]);
  });
});
