/**
 * ORCH-0889 [Marketing tab desktop-web fit-and-finish] — T-01 happy path.
 *
 * Implementor regression test (Step 0.5 of CLOSE protocol). Asserts the
 * Marketing Overview route's loading-state guard:
 *
 *   (a) USES the disabled-query-safe pattern
 *       `!overviewQuery.hasResolved && !overviewQuery.isError` so the
 *       skeleton renders during the auth-bootstrap window where
 *       `enabled: false` → `isLoading: false` → `data: undefined`.
 *
 *   (b) does NOT contain the brittle pattern
 *       `overviewQuery.isLoading && overviewQuery.data === undefined`
 *       which surfaced "Couldn't load metrics" during the 4-8s web
 *       auth-bootstrap window (per ORCH-0887 timing data) — the bug
 *       this ORCH closes.
 *
 *   (c) declares a `testID="overview-skeleton"` on the loading branch
 *       so tester adversarial / future RTL tests can target it.
 *
 * Source-grep style — reads the route file from disk and asserts on its
 * contents. Repo precedent: `overview-no-revenue.test.ts`. Repo's
 * `jest.config.cjs` is `testEnvironment: "node"` with no jsdom / RTL
 * setup, so render-based RTL tests would require new infrastructure
 * out of ORCH-0889 scope. The source-grep test still satisfies the
 * Step-0.5 fails-on-revert discipline: reverting the route's guard
 * back to the brittle pattern flips the file content and the test
 * fails.
 *
 * Adversarial counterpart: `MarketingAudiences.disabled-query.adversarial.test.ts`
 * (different route, different empty-state text, different hook).
 */

import fs from "node:fs";
import path from "node:path";

const ROUTE_PATH = path.resolve(__dirname, "..", "index.tsx");

describe("ORCH-0889 — Marketing Overview disabled-query guard (T-01 happy)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(ROUTE_PATH, "utf8");
  });

  it("(T-01a) uses the disabled-query-safe pattern `!hasResolved && !isError`", () => {
    // Must contain the corrected guard. Tolerate whitespace variation.
    const pattern = /!\s*overviewQuery\.hasResolved\s*&&\s*!\s*overviewQuery\.isError/;
    expect(pattern.test(source)).toBe(true);
  });

  it("(T-01b) does NOT contain the brittle `isLoading && data === undefined` pattern", () => {
    // The brittle pattern was:
    //   if (overviewQuery.isLoading && overviewQuery.data === undefined)
    // Any whitespace variant of that string is the bug. The strict-grep
    // CI gate enforces this repo-wide; this test enforces it on the
    // specific route the operator reported.
    const brittle = /overviewQuery\.isLoading\s*&&\s*overviewQuery\.data\s*===\s*undefined/;
    expect(brittle.test(source)).toBe(false);
  });

  it("(T-01c) declares testID=\"overview-skeleton\" on the loading branch", () => {
    expect(source.includes('testID="overview-skeleton"')).toBe(true);
  });

  it("(T-01d) reads from useStickyFooterOffset for FAB positioning (no inline `insets.bottom + 96`)", () => {
    expect(source.includes("useStickyFooterOffset")).toBe(true);
    // Confirm no inline `insets.bottom + 96` remains anywhere.
    expect(/insets\.bottom\s*\+\s*96/.test(source)).toBe(false);
  });
});
