/**
 * Issue #1485 [web-missing-chunk-404] — T1, config contract, happy path.
 *
 * WHY THE NEGATIVE LOOKAHEAD EXISTS. `vercel.json` is strict JSON and cannot
 * carry a comment, so the "why" lives here.
 *
 * Before #1485 the last rewrite was `{ "source": "/(.*)", "destination": "/" }`.
 * Vercel evaluates rewrites AFTER the filesystem, so a real asset always won —
 * but a MISSING asset fell through to that catch-all and Vercel answered
 * `200 OK` with the SPA shell `index.html`. The browser then executed an HTML
 * document as JavaScript and the route died silently:
 *
 *   GET /_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js
 *     HTTP/2 200 · content-type: text/html; charset=utf-8 · content-length: 2846
 *     etag: "f165fd5a81e43acdc354ef55353aa123"   <- identical to index.html
 *
 * Worse, outside `js/web/` the `/_expo/static/(.*)` header rule pinned that HTML
 * body with `public, max-age=31536000, immutable` — a one-year client-side cache
 * of an HTML document sitting where a font or image should be.
 *
 * `"/((?!_expo/static/).*)"` makes a missing asset return a real 404, which the
 * browser reports as a retryable dynamic-import failure that `chunkReloadGuard`
 * already recognises.
 *
 * DO NOT RESTORE `"/(.*)"`. It reintroduces the defect in full.
 * DO NOT "improve" it to `"/((?!^_expo/static/).*)"` — the `^` is inert inside
 * the compiled `^(?:/(…))$` (the group is evaluated at index 1, where `^` can
 * never match), so the catch-all keeps swallowing `_expo/static`.
 * DO NOT use the named-parameter form `"/:path((?!_expo/static/).*)"` — Vercel's
 * compiler appends the unconsumed param to the destination, turning `"/"` into
 * `"/?path=$1"`.
 *
 * Fails-on-revert: restoring `"/(.*)"` fails T1.1 and all four T1.3 assertions.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

type Rewrite = { source: string; destination: string };
type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const vercel = JSON.parse(
  readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
) as { rewrites: Rewrite[]; headers: HeaderRule[] };

// [TEST-MOD-APPROVED #922] The prior literal encoded superseded routing truth.
// The protected #1485 asset boundary is unchanged, and the additional exact
// entry exclusion prevents the later SPA rewrite from consuming #922's file.
const CATCH_ALL_SOURCE =
  "/((?!_expo/static/|accept-brand-invitation-entry$).*)";

/**
 * The exact regex `@vercel/routing-utils@6.4.0` (path-to-regexp@6.1.0) compiles
 * `CATCH_ALL_SOURCE` to. Verified in the #1485 INVESTIGATION by running the real
 * compiler over the real config.
 */
const COMPILED_CATCH_ALL_SOURCE =
  "^(?:/((?!_expo/static/|accept-brand-invitation-entry$).*))$";

const shippedCatchAll = vercel.rewrites[vercel.rewrites.length - 1];

/**
 * Compiled FROM the shipped config, never from a local constant — otherwise a
 * revert of `vercel.json` would leave T1.2/T1.3 green and the fails-on-revert
 * contract would be a lie. For a `source` with no `:named` parameters (asserted
 * below) path-to-regexp@6 wraps the raw path in `^(?:…)$` verbatim, which is
 * exactly the compiler output the INVESTIGATION captured.
 */
const COMPILED_CATCH_ALL = new RegExp(`^(?:${shippedCatchAll.source})$`);

const sourceIndex = (source: string): number =>
  vercel.rewrites.findIndex((rewrite) => rewrite.source === source);

const cacheControlFor = (source: string): string | undefined =>
  vercel.headers
    .find((rule) => rule.source === source)
    ?.headers.find((header) => header.key === "Cache-Control")?.value;

describe("#1485 T1 — /_expo/static/ is excluded from the SPA catch-all", () => {
  test("T1.1 — the catch-all is the exact excluded form, still pointing at /", () => {
    const last = vercel.rewrites[vercel.rewrites.length - 1];
    expect(last.source).toBe(CATCH_ALL_SOURCE);
    expect(last.destination).toBe("/");
    // The source carries no `:named` parameter, so the compiled form below is a
    // faithful emulation AND the destination can never be rewritten to
    // "/?path=$1" by the named-parameter trap.
    expect(last.source).not.toMatch(/:\w+\(/);
    // `RegExp.prototype.source` escapes `/` as `\/`; unescape so the comparison
    // reads as the INVESTIGATION recorded the compiler's output.
    expect(COMPILED_CATCH_ALL.source.replace(/\\\//g, "/")).toBe(
      COMPILED_CATCH_ALL_SOURCE,
    );
  });

  test("T1.2 — every real deep link still matches the catch-all", () => {
    const deepLinks = [
      "/",
      "/e/acme/summer-party",
      "/t/acme/lagos-trip",
      "/b/acme",
      "/b/acme/v/rooftop",
      "/checkout/abc-123",
      "/insights/abc-123",
      "/rsvp/48db05a9-2b78-4af5-ada4-485b53aa26d1",
      "/venue/create",
      "/stripe-onboarding-return",
      "/auth/callback",
      "/favicon.ico",
      "/.well-known/apple-app-site-association",
    ];

    for (const url of deepLinks) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, true]);
    }
  });

  test("T1.3 — no /_expo/static/ asset path matches the catch-all", () => {
    const assets = [
      "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js",
      "/_expo/static/js/web/[id]-baf4771d14ff6e96d05d789394cc46ac.js",
      "/_expo/static/media/font-abc.ttf",
      "/_expo/static/css/app.css",
    ];

    for (const url of assets) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, false]);
    }
  });

  test("T1.3b — only the exact invitation entry is newly excluded", () => {
    expect(COMPILED_CATCH_ALL.test("/accept-brand-invitation-entry")).toBe(false);
    expect(COMPILED_CATCH_ALL.test("/accept-brand-invitation-entry/child")).toBe(true);
    expect(COMPILED_CATCH_ALL.test("/accept-brand-invitation-entry-evil")).toBe(true);
  });

  test("T1.4 — every rewrite that must win stays ordered before the catch-all", () => {
    const catchAllIndex = sourceIndex(CATCH_ALL_SOURCE);
    expect(catchAllIndex).toBe(vercel.rewrites.length - 1);

    const mustPrecede = [
      "/stripe-onboarding-return",
      "/auth/callback",
      "/accept-brand-invitation",
      "/og/event/:eventId.png",
      "/e/:brandSlug/:eventSlug",
      "/b/:brandSlug/v/:venueSlug",
    ];

    for (const source of mustPrecede) {
      const index = sourceIndex(source);
      expect([source, index >= 0]).toEqual([source, true]);
      expect([source, index < catchAllIndex]).toEqual([source, true]);
    }
    expect(
      vercel.rewrites.find((rewrite) => rewrite.source === "/accept-brand-invitation"),
    ).toEqual({
      source: "/accept-brand-invitation",
      destination: "/accept-brand-invitation-entry",
    });
  });

  test("T1.5 — the ORCH-1003 / ORCH-1091 header contract is untouched", () => {
    expect(cacheControlFor("/_expo/static/(.*)")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlFor("/_expo/static/js/web/(.*)")).toBe(
      "public, max-age=0, must-revalidate",
    );

    const broadIndex = vercel.headers.findIndex(
      (rule) => rule.source === "/_expo/static/(.*)",
    );
    const jsWebIndex = vercel.headers.findIndex(
      (rule) => rule.source === "/_expo/static/js/web/(.*)",
    );
    expect(broadIndex).toBeGreaterThanOrEqual(0);
    expect(jsWebIndex).toBeGreaterThan(broadIndex);
  });
});
