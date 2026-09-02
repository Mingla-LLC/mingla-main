/**
 * Issue #1876 — F-2, config contract, happy path.
 *
 * WHY `assets/` JOINED THE EXCLUSION. `vercel.json` is strict JSON and cannot
 * carry a comment, so the "why" lives here — the same place #1485 put its own.
 *
 * #1485 stopped the SPA catch-all from swallowing `/_expo/static/**`, but it
 * fixed exactly that one prefix and filed the rest as discovery D-1: "the
 * /assets tree is deliberately still shell-served; out of scope." Eight days
 * after that shipped, #1876 re-probed production and D-1 was still live:
 *
 *   GET https://host.usemingla.com/assets/fake-bundle-0000.js
 *     HTTP/2 200 · content-type: text/html; charset=utf-8 · x-vercel-cache: HIT
 *     <!DOCTYPE html> …the SPA shell…
 *
 * Same defect class, one folder over, and EDGE-CACHED — the wrong answer was
 * being served from cache exactly as the original was. `/assets/**` carries the
 * Expo web export's fonts and images (JavaScript lives under
 * `/_expo/static/js/web/`), so this degrades rendering rather than
 * white-screening, which is why it is F-2 and not F-1. It is still a 200 that
 * lies about a file that does not exist.
 *
 * DO NOT RESTORE the two-alternate form. It reopens D-1 in full.
 * DO NOT "improve" it to `"/((?!^_expo/static/|^assets/).*)"` — the `^` is inert
 * inside the compiled `^(?:/(…))$` (the group is evaluated at index 1, where `^`
 * can never match), so the catch-all silently resumes swallowing both trees
 * while LOOKING correct. Section T-4 proves that behaviourally, not by string
 * comparison, so the trap cannot be re-entered by anyone reading only the diff.
 * DO NOT use the named-parameter form `"/:path((?!…).*)"` — Vercel's compiler
 * appends the unconsumed param to the destination, turning `"/"` into
 * `"/?path=$1"`.
 *
 * Fails-on-revert: deleting `assets/|` from the alternation fails T-1 (every
 * `/assets/**` row starts matching the catch-all again) and T-6.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

type Rewrite = { source: string; destination: string };
type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const vercel = JSON.parse(
  readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
) as { rewrites: Rewrite[]; headers: HeaderRule[] };

const shippedCatchAll = vercel.rewrites[vercel.rewrites.length - 1];

/**
 * Compiled FROM the shipped config, never from a local constant. If this
 * suite compiled a hard-coded string, a revert of `vercel.json` would leave
 * every assertion below green and the fails-on-revert contract would be a lie.
 * For a `source` with no `:named` parameters (asserted in T-5) path-to-regexp@6
 * — which `@vercel/routing-utils@6.4.0` uses — wraps the raw path in `^(?:…)$`
 * verbatim, the compiler output #1485's INVESTIGATION captured from the real
 * compiler.
 */
const COMPILED_CATCH_ALL = new RegExp(`^(?:${shippedCatchAll.source})$`);

/** Every wrapper a path-to-regexp-based compiler can plausibly apply. */
const WRAPPERS: { label: string; wrap: (src: string) => string }[] = [
  { label: "verified @vercel/routing-utils@6.4.0", wrap: (s) => `^(?:${s})$` },
  { label: "bare path-to-regexp anchoring", wrap: (s) => `^${s}$` },
  { label: "trailing-slash tolerant", wrap: (s) => `^(?:${s})(?:/)?$` },
];

const caughtUnderEveryWrapper = (url: string): boolean =>
  WRAPPERS.every(({ wrap }) => new RegExp(wrap(shippedCatchAll.source)).test(url));

const rejectedByEveryWrapper = (url: string): boolean =>
  WRAPPERS.every(({ wrap }) => !new RegExp(wrap(shippedCatchAll.source)).test(url));

describe("#1876 T-1 — no /assets/ path reaches the SPA catch-all", () => {
  test("T-1.1 — the real production repro paths are excluded", () => {
    // The exact two paths the #1876 INVESTIGATION captured returning
    // `200 text/html · x-vercel-cache: HIT` from production on 2026-08-11.
    for (const url of [
      "/assets/does-not-exist-0000.png",
      "/assets/fake-bundle-0000.js",
    ]) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, false]);
    }
  });

  test("T-1.2 — every shape the Expo web export emits under /assets/ is excluded", () => {
    for (const url of [
      "/assets/assets/google_icon.abc123.png",
      "/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
      "/assets/src/assets/images/logo.a1b2c3.png",
      "/assets/fonts/Inter-Regular.0f8e.otf",
      "/assets/a.js",
      "/assets/deeply/nested/tree/file.woff2",
    ]) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, false]);
    }
  });

  test("T-1.3 — the exclusion holds under every plausible compilation wrapper", () => {
    // No assertion in this suite may depend on guessing Vercel's exact wrapper.
    expect(rejectedByEveryWrapper("/assets/does-not-exist-0000.png")).toBe(true);
    expect(rejectedByEveryWrapper("/assets/fake-bundle-0000.js")).toBe(true);
  });

  test("T-1.4 — the exclusion is anchored at the FIRST segment and stays narrow", () => {
    // A path that merely CONTAINS `assets/` deeper in the tree is a real SPA
    // route as far as the app is concerned, and must still reach the shell.
    // Over-excluding here would 404 live pages — the inverse defect.
    for (const url of [
      "/assetsish/a.png",
      "/assetsmanager",
      "/venue/assets/create",
      "/b/assets",
      "/b/assets/v/rooftop",
      "/e/assets/summer-party",
      "/.well-known/assetlinks.json",
      "/insights/assets-report",
    ]) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, true]);
    }
  });
});

describe("#1876 T-2 — /_expo/static/ is untouched (F-1 must not regress)", () => {
  test("T-2.1 — no /_expo/static/ path matches the catch-all", () => {
    for (const url of [
      "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js",
      "/_expo/static/js/web/[id]-baf4771d14ff6e96d05d789394cc46ac.js",
      "/_expo/static/media/font-abc.ttf",
      "/_expo/static/css/app.css",
    ]) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, false]);
    }
  });

  test("T-2.2 — `_expo/static/` is still the FIRST alternate", () => {
    const excluded = /\(\?!([^)]+)\)/.exec(shippedCatchAll.source)?.[1];
    expect(excluded?.split("|")).toEqual([
      "_expo/static/",
      "assets/",
      "accept-brand-invitation-entry$",
    ]);
  });
});

describe("#1876 T-3 — every real deep link still reaches the SPA shell", () => {
  test("T-3.1 — the nine SC-5 deep links all match the catch-all", () => {
    const deepLinks = [
      "/",
      "/insights/48db05a9-2b78-4af5-ada4-485b53aa26d1",
      "/venue/create",
      "/rsvp/48db05a9-2b78-4af5-ada4-485b53aa26d1",
      "/e/acme/summer-party",
      "/t/acme/lagos-trip",
      "/b/acme",
      "/b/acme/v/rooftop",
      "/checkout/48db05a9-2b78-4af5-ada4-485b53aa26d1",
    ];
    for (const url of deepLinks) {
      expect([url, COMPILED_CATCH_ALL.test(url)]).toEqual([url, true]);
      expect([url, caughtUnderEveryWrapper(url)]).toEqual([url, true]);
    }
  });

  test("T-3.2 — the pre-catch-all owners are still ordered ahead of it", () => {
    const catchAllIndex = vercel.rewrites.length - 1;
    for (const source of [
      "/stripe-onboarding-return",
      "/auth/callback",
      "/accept-brand-invitation",
      "/og/event/:eventId.png",
      "/e/:brandSlug/:eventSlug",
      "/b/:brandSlug/v/:venueSlug",
    ]) {
      const index = vercel.rewrites.findIndex((rewrite) => rewrite.source === source);
      expect([source, index >= 0]).toEqual([source, true]);
      expect([source, index < catchAllIndex]).toEqual([source, true]);
    }
  });
});

describe("#1876 T-4 — the inert `^`-anchored form is rejected behaviourally", () => {
  test("T-4.1 — the shipped source carries no `^` anchor and no named parameter", () => {
    expect(shippedCatchAll.source).not.toMatch(/\(\?!\^/);
    expect(shippedCatchAll.source).not.toMatch(/:\w+\(/);
    expect(shippedCatchAll.destination).toBe("/");
  });

  test("T-4.2 — the anchored form WOULD reopen the defect, so the ban has teeth", () => {
    // Not a string comparison: the anchored form is compiled and shown to let
    // both asset trees straight through. This is why the ban exists.
    const anchored = new RegExp(
      "^(?:/((?!^_expo/static/|^assets/|^accept-brand-invitation-entry$).*))$",
    );
    expect(anchored.test("/assets/does-not-exist-0000.png")).toBe(true);
    expect(anchored.test("/_expo/static/js/web/a.js")).toBe(true);
    // …while the SHIPPED form rejects both.
    expect(COMPILED_CATCH_ALL.test("/assets/does-not-exist-0000.png")).toBe(false);
    expect(COMPILED_CATCH_ALL.test("/_expo/static/js/web/a.js")).toBe(false);
  });

  test("T-4.3 — the original unrestricted catch-all WOULD swallow everything", () => {
    const original = new RegExp("^(?:/(.*))$");
    expect(original.test("/assets/does-not-exist-0000.png")).toBe(true);
    expect(original.test("/_expo/static/js/web/a.js")).toBe(true);
  });
});

describe("#1876 T-5 — the catch-all is still LAST and still bare", () => {
  test("T-5.1 — it is the final rewrite and points at the bare shell", () => {
    expect(vercel.rewrites.indexOf(shippedCatchAll)).toBe(vercel.rewrites.length - 1);
    expect(shippedCatchAll.destination).toBe("/");
  });

  test("T-5.2 — the ORCH-1003 / ORCH-1091 header block is byte-identical", () => {
    // SC-7. Pinned as a whole structure, not field-by-field: the cache suites
    // read this block and #1876 must not have moved a single byte of it.
    // [TEST-MOD-APPROVED #2986] Private-route robots headers may precede this
    // terminal block; these four protected rules remain exact and ordered.
    expect(vercel.headers.slice(-4)).toEqual([
      {
        source: "/_expo/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/_expo/static/js/web/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/assetlinks.json",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ]);
  });
});

describe("#1876 T-6 — #1806's invitation-entry alternate is preserved exactly", () => {
  test("T-6.1 — the alternate keeps its trailing `$` (exact match, not prefix)", () => {
    expect(shippedCatchAll.source).toContain("accept-brand-invitation-entry$");
    expect(COMPILED_CATCH_ALL.test("/accept-brand-invitation-entry")).toBe(false);
    expect(COMPILED_CATCH_ALL.test("/accept-brand-invitation-entry/child")).toBe(true);
    expect(COMPILED_CATCH_ALL.test("/accept-brand-invitation-entry-evil")).toBe(true);
  });

  test("T-6.2 — the rewrite that produces that entry is unchanged", () => {
    expect(
      vercel.rewrites.find((rewrite) => rewrite.source === "/accept-brand-invitation"),
    ).toEqual({
      source: "/accept-brand-invitation",
      destination: "/accept-brand-invitation-entry",
    });
  });
});
