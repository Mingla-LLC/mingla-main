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
    expect(last.source).toBe("/(.*)");
    expect(last.destination).toBe("/");
  });

  test("the .well-known JSON content-type rules are preserved (not clobbered)", () => {
    const wellKnown = vercel.headers.filter((r) => r.source.startsWith("/.well-known/"));
    expect(wellKnown.length).toBeGreaterThanOrEqual(2);
    for (const rule of wellKnown) {
      expect(rule.headers.some((h) => h.key === "Content-Type" && h.value === "application/json")).toBe(true);
    }
  });
});
