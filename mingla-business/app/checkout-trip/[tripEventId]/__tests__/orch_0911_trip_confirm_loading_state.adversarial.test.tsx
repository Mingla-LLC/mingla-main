/**
 * ORCH-0911 [Buyer-web checkout confirm black screen] — ADVERSARIAL
 * regression tests for the TRIP confirm screen. Tester-authored 2026-05-22.
 * Attack DIFFERENT angles than the implementor happy-path file
 * `orch_0911_trip_confirm_loading_state.test.tsx`:
 *   - happy-path proves the hero branches exist with trip copy
 *   - adversarial proves (a) the trip copy is exactly "Confirming your
 *     reservation…" (not "tickets") so the trip surface speaks
 *     trip-language end-to-end, (b) the hasCs gate reads ONLY the URL
 *     (not sessionStorage) — trip mirror of event-side TA-EV-01,
 *     (c) the deleted pre-fix realtimePending+trip-gated hero is GONE,
 *     and (d) no retry/help/dead-end UI introduced.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "../confirm.tsx"), "utf8");

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

function sliceResultNullBranch(): string {
  const startIndex = activeSource.indexOf("if (result === null)");
  const endIndex = activeSource.indexOf("if (trip === null)", startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return activeSource.slice(startIndex, endIndex);
}

describe("ORCH-0911 — trip confirm adversarial gates", () => {
  it("TA-TR-01: trip-language copy is exactly 'Confirming your reservation…' (not 'tickets')", () => {
    // The trip surface has its own vocabulary: reservation, not tickets.
    // If a future copy-edit drift swapped the trip hero copy to use the
    // event-side string, buyers would experience surface-language
    // confusion. Adversarial: pin the exact trip copy and confirm the
    // event-side copy does NOT appear in the result===null branch.
    const branch = sliceResultNullBranch();
    expect(branch).toContain("Confirming your reservation…");
    // Event copy is "Confirming your tickets…" with the trailing
    // ellipsis. The trip branch must NOT use that variant.
    expect(branch).not.toContain("Confirming your tickets…");
  });

  it("TA-TR-02: hasCs hero gate reads ONLY URL search, NOT sessionStorage (trip mirror)", () => {
    const branch = sliceResultNullBranch();
    expect(branch).toContain("const hasCs = /[?&]cs=/.test");
    const hasCsBlock = branch.slice(branch.indexOf("if (hasCs)"));
    expect(hasCsBlock).not.toMatch(/sessionStorage/);
    expect(hasCsBlock).not.toMatch(/readCheckoutResumePayload/);
  });

  it("TA-TR-03: deleted pre-fix realtimePending+trip-gated hero block is GONE", () => {
    expect(activeSource).not.toMatch(
      /result === null\s*&&\s*realtimePending\s*&&\s*trip !== null/,
    );
    expect(activeSource).not.toMatch(
      /Platform\.OS === "web"\s*&&\s*result === null\s*&&\s*realtimePending\s*&&\s*trip !== null/,
    );
  });

  it("TA-TR-04: no retry/help/dead-end UI introduced on trip confirm", () => {
    const branch = sliceResultNullBranch();
    expect(branch).not.toMatch(/\bRetry\b/i);
    expect(branch).not.toMatch(/Try again/i);
    expect(branch).not.toMatch(/\bRefresh\b/i);
    expect(branch).not.toMatch(/help@usemingla\.com/i);
    expect(branch).not.toMatch(/contact (?:us|support)/i);
    expect(branch).not.toMatch(/onPress=\{/);
    expect(branch).not.toMatch(/<Button\b/);
  });
});
