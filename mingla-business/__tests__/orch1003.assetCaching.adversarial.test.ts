/**
 * ORCH-1003 [Business web asset caching] — adversarial regression test.
 *
 * DIFFERENT ANGLE than the happy-path: that one proves the static assets ARE
 * cached. This one proves we did NOT over-cache (which would strand users on
 * stale code) and did NOT break SPA routing. The freshness guarantee depends on
 * the HTML shell staying uncached and the SPA catch-all rewrite surviving.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
const vercel = JSON.parse(
  readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
) as { headers: HeaderRule[]; rewrites: { source: string; destination: string }[] };

const cacheControlFor = (source: string): string | undefined =>
  vercel.headers
    .find((r) => r.source === source)
    ?.headers.find((h) => h.key === "Cache-Control")?.value;

describe("ORCH-1003 caching did not over-reach", () => {
  test("no header rule applies immutable/long caching to the HTML shell or catch-all", () => {
    const dangerousSources = ["/", "/(.*)", "/index.html"];
    for (const src of dangerousSources) {
      const value = cacheControlFor(src);
      if (value) {
        expect(value).not.toContain("immutable");
        expect(value).not.toMatch(/max-age=(?!0\b)\d{3,}/); // no long max-age on HTML
      }
    }
  });

  test("immutable caching is scoped ONLY to the hashed-asset path, never a broad glob", () => {
    const immutableRules = vercel.headers.filter((r) =>
      r.headers.some((h) => h.key === "Cache-Control" && h.value.includes("immutable")),
    );
    expect(immutableRules.length).toBeGreaterThan(0);
    for (const rule of immutableRules) {
      // Must target the Expo static dir — never a catch-all that would pin the HTML.
      expect(rule.source.startsWith("/_expo/static")).toBe(true);
      expect(rule.source).not.toBe("/(.*)");
      expect(rule.source).not.toBe("/");
    }
  });

  test("the SPA catch-all rewrite still exists and is the LAST rewrite", () => {
    const last = vercel.rewrites[vercel.rewrites.length - 1];
    // [TEST-MOD-APPROVED 1485] (CI token form: [TEST-MOD-APPROVED ORCH-1485])
    // Issue #1485 [web-missing-chunk-404]: the catch-all now excludes
    // /_expo/static/ so a missing hashed asset returns a real 404 instead of a
    // 200 with the SPA shell. The property this test protects — a catch-all
    // exists, it is LAST, and it points at "/" — is unchanged; only the literal
    // moved. Do not restore "/(.*)".
    // [TEST-MOD-APPROVED #922] The prior literal encoded superseded routing
    // truth. The exact internal-entry exclusion is additive; the #1003 asset
    // boundary and ordinary SPA ownership remain unchanged.
    // [TEST-MOD-APPROVED #1876] Issue #1876 F-2: `assets/` joins the same
    // alternation, so a missing file under /assets/ returns a real 404 instead
    // of the SPA shell (it was still 200 text/html on production 2026-08-11).
    // The property this test protects — a catch-all exists, it is LAST, it
    // points at "/", and it never swallows a static asset path — is unchanged
    // and now covers one more asset tree.
    expect(last.source).toBe(
      "/((?!_expo/static/|assets/|accept-brand-invitation-entry$).*)",
    );
    expect(last.destination).toBe("/");
    const matcher = new RegExp(`^(?:${last.source})$`);
    expect(matcher.test("/_expo/static/js/web/app.js")).toBe(false);
    expect(matcher.test("/home")).toBe(true);
  });

  test("the .well-known JSON content-type rules are preserved (not clobbered)", () => {
    const wellKnown = vercel.headers.filter((r) => r.source.startsWith("/.well-known/"));
    expect(wellKnown.length).toBeGreaterThanOrEqual(2);
    for (const rule of wellKnown) {
      expect(rule.headers.some((h) => h.key === "Content-Type" && h.value === "application/json")).toBe(true);
    }
  });
});
