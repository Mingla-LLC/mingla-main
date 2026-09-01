/**
 * Issue #1485 [web-missing-chunk-404] — T2, TESTER-OWNED ADVERSARIAL SUITE.
 *
 * The implementor's T1 pins the catch-all's shape and probes a hand-written list
 * of paths. T3 pins the guard's happy path. This suite attacks the angles those
 * two do not, in the order of how catastrophic the failure would be:
 *
 *   A. THE CATASTROPHIC REGRESSION. A real SPA deep link that now 404s is worse
 *      than the bug being fixed. Section A does NOT use a hardcoded URL list: it
 *      walks the real `app/` route tree at test time, derives a URL per route
 *      file, and then SIMULATES THE WHOLE REWRITE CHAIN (not just the catch-all)
 *      for a normal browser user-agent. Every derived URL must land on the SPA
 *      shell or its explicitly owned public-document handler. New routes are
 *      covered the moment they are added; a greedy rewrite inserted ABOVE the
 *      catch-all is caught even though the catch-all itself is untouched.
 *
 *   B. BOUNDARY / NEAR-MISS PATHS. `_expo/static` with no trailing slash,
 *      `_expo/staticX/`, a nested `/x/_expo/static/`, uppercase, percent-encoded
 *      `%5F`/`%2F`, doubled slashes, and an asset path smuggled into a query
 *      string. Each row states whether it is correctly EXCLUDED (404) or
 *      correctly CAUGHT (SPA shell) and why the answer is safe.
 *
 *   C. THE INERT-FORM TRAP, PROVED BEHAVIOURALLY. Section C does not merely
 *      assert the shipped string is not `"/((?!^_expo/static/).*)"`. It runs the
 *      three rejected candidate forms through the same matcher construction and
 *      proves each one WOULD be caught by section B — i.e. this suite has real
 *      detection power and the config cannot silently regress to an inert form.
 *
 *   D. THE JSON.parse FALSE-POSITIVE HAZARD. `Unexpected token '<'` is also what
 *      V8 throws when `JSON.parse` is handed an HTML error body. If the guard
 *      reloaded on that, EVERY API that returns an HTML error page would become
 *      a full page reload. Section D sweeps the V8 / SpiderMonkey / JSC / Hermes
 *      message shapes — including the legacy and short-body V8 forms T3 does not
 *      cover — and proves a genuine chunk failure is still caught.
 *
 *   E. RELOAD-LOOP UNDER ABUSE. T3 walks a clean clock. Section E fires a burst
 *      of errors inside one millisecond, corrupts the stored cooldown value to
 *      NaN / Infinity, dates it in the future, runs the clock BACKWARDS, drops
 *      sessionStorage entirely, and makes `setItem` (not `getItem`) throw. In
 *      every case the invariant is the same: AT MOST ONE reload, and never a
 *      loop.
 *
 * GROUND TRUTH FOR THE COMPILED FORMS. Every `compiled` string in COMPILED_SRC
 * below was produced by running Vercel's own `@vercel/routing-utils@6.4.0`
 * (bundling `path-to-regexp@6.1.0`) over THIS repo's `mingla-business/vercel.json`
 * via `getTransformedRoutes({ cleanUrls, trailingSlash, rewrites, headers })`.
 * That package is deliberately NOT a dependency of this repo, so the table is
 * transcribed rather than recomputed — and COMPILED_SRC is keyed by `source`
 * with an exhaustiveness assertion (A.0), so a rewrite added later fails loudly
 * instead of slipping through unsimulated.
 *
 * WHAT THIS SUITE CANNOT PROVE. It cannot prove DEPLOYED behaviour. Vercel
 * compiles `rewrites` at build time and only the live edge can answer SC-1…SC-6.
 * The deployed truth is captured post-merge with raw `curl -sSI` against
 * https://host.usemingla.com.
 *
 * Fails-on-revert: restoring `"/(.*)"` fails B.1 and C.1; shipping the inert
 * `"/((?!^_expo/static/).*)"` fails B.1, C.1 and C.2; deleting `JSON_PARSE_RE`
 * fails D.2; deleting the 10s cooldown fails E.1, E.2, E.5 and E.6.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "@jest/globals";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

type HasCondition = { type: string; key?: string; value?: string };
type Rewrite = { source: string; destination: string; has?: HasCondition[] };
type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type VercelConfig = {
  rewrites: Rewrite[];
  redirects?: Array<Rewrite & { permanent?: boolean }>;
  headers: HeaderRule[];
  cleanUrls?: boolean;
  trailingSlash?: boolean;
};

const REPO_ROOT = process.cwd();
const APP_DIR = path.join(REPO_ROOT, "app");

const vercel = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8"),
) as VercelConfig;

const catchAll = vercel.rewrites[vercel.rewrites.length - 1];

/**
 * `@vercel/routing-utils@6.4.0` output for every rewrite in the shipped config,
 * transcribed from a real `getTransformedRoutes` run over this exact file.
 * A.0 asserts this map covers every rewrite, so it cannot silently rot.
 */
const COMPILED_SRC: Record<string, string> = {
  // [TEST-MOD-APPROVED #2986] Host discovery documents must bypass the Expo
  // shell with their own MIME-correct handlers.
  "/robots.txt": "^/robots\\.txt$",
  "/sitemap.xml": "^/sitemap\\.xml$",
  // [TEST-MOD-APPROVED #1615] The stable content page and immutable portrait
  // rewrites did not exist when #1485 froze this exhaustive transcription.
  // Their real compiled forms keep every rewrite covered without weakening the
  // last catch-all or the /_expo/static/ exclusion.
  "/s/:code": "^/s(?:/([^/]+?))$",
  // [TEST-MOD-APPROVED #1615] Variant A retired the current PNG producer after
  // physical WhatsApp rejected it; this keeps #1485's exhaustive route oracle
  // exact for the revisioned r2 JPEG without changing its catch-all behavior.
  "/og/s/:code/v:version-r2.jpg":
    "^/og/s(?:/([^/]+?))/v([^/]+?)-r2\\.jpg$",
  "/share/:shareId.png": "^/share(?:/([^/]+?))\\.png$",
  "/og/share/:shareId.png": "^/og/share(?:/([^/]+?))\\.png$",
  "/p/:shareId": "^/p(?:/([^/]+?))$",
  "/og/event/:eventId.png": "^/og/event(?:/([^/]+?))\\.png$",
  "/og/brand/:brandSlug.png": "^/og/brand(?:/([^/]+?))\\.png$",
  "/og/trip/:tripId.png": "^/og/trip(?:/([^/]+?))\\.png$",
  "/og/venue/:brandSlug/:venueSlug.png":
    "^/og/venue(?:/([^/]+?))(?:/([^/]+?))\\.png$",
  "/e/:brandSlug/:eventSlug": "^/e(?:/([^/]+?))(?:/([^/]+?))$",
  // [TEST-MOD-APPROVED #1968] Canonical experience pages now have their own
  // crawler-only metadata handler so their ordinary browser route stays SPA-owned.
  "/exp/:brandSlug/:experienceSlug":
    "^/exp(?:/([^/]+?))(?:/([^/]+?))$",
  "/t/:brandSlug/:tripSlug": "^/t(?:/([^/]+?))(?:/([^/]+?))$",
  "/b/:brandSlug": "^/b(?:/([^/]+?))$",
  "/b/:brandSlug/v/:venueSlug": "^/b(?:/([^/]+?))/v(?:/([^/]+?))$",
  "/stripe-onboarding-return": "^/stripe-onboarding-return$",
  "/auth/callback": "^/auth/callback$",
  // [TEST-MOD-APPROVED #922] The prior literal encoded superseded routing
  // truth. The exhaustive #1485 oracle now preserves the exact invitation
  // owner while retaining the original static-asset exclusion unchanged.
  "/accept-brand-invitation": "^/accept-brand-invitation$",
  // [TEST-MOD-APPROVED #1876] #1876 F-2 adds `assets/` to the same alternation
  // (#1485's deferred discovery D-1). This table is a lookup keyed by the
  // SHIPPED source, so the key has to track it or `resolveForBrowser` stops
  // finding the catch-all and A.3 reports every route as a 404. The compiled
  // form is the same `^(?:…)$` wrapper with the same bare alternation.
  "/((?!_expo/static/|assets/|accept-brand-invitation-entry$).*)":
    "^(?:/((?!_expo/static/|assets/|accept-brand-invitation-entry$).*))$",
};

/**
 * Every plausible wrapper a path-to-regexp-based compiler can put around a
 * `source` that carries NO named parameter. The shipped source must behave
 * identically under all of them, so no assertion in this suite depends on
 * guessing the exact wrapper. The first entry is the verified real one.
 */
const WRAPPERS: { label: string; wrap: (src: string) => string }[] = [
  { label: "verified @vercel/routing-utils@6.4.0", wrap: (s) => `^(?:${s})$` },
  { label: "bare path-to-regexp anchoring", wrap: (s) => `^${s}$` },
  { label: "trailing-slash tolerant", wrap: (s) => `^(?:${s})(?:/)?$` },
];

const matchersFor = (source: string): { label: string; re: RegExp }[] =>
  WRAPPERS.map(({ label, wrap }) => ({ label, re: new RegExp(wrap(source)) }));

const SHIPPED_MATCHERS = matchersFor(catchAll.source);

/** True only when EVERY plausible compilation agrees the path matches. */
const matchesUnderEveryWrapper = (pathname: string): boolean =>
  SHIPPED_MATCHERS.every(({ re }) => re.test(pathname));

/** True only when EVERY plausible compilation agrees the path does NOT match. */
const rejectedByEveryWrapper = (pathname: string): boolean =>
  SHIPPED_MATCHERS.every(({ re }) => !re.test(pathname));

// ---------------------------------------------------------------------------
// Route-tree derivation — the URL set is DERIVED, never hardcoded.
// ---------------------------------------------------------------------------

function walkRouteFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...walkRouteFiles(path.join(dir, entry.name), childRel));
      continue;
    }
    const base = entry.name;
    if (!/\.(tsx|jsx)$/.test(base)) continue; // helper .ts modules are not screens
    if (base.startsWith("+")) continue; // +html / +not-found are not addressable
    if (/^_layout\./.test(base)) continue; // layouts are not addressable
    out.push(childRel);
  }
  return out;
}

/** `app/rsvp/[id]/index.tsx` -> `/rsvp/sample-id`; `(tabs)` groups disappear. */
function routeFileToUrl(relPath: string): string {
  const withoutExt = relPath
    .replace(/\.(tsx|jsx)$/, "")
    .replace(/\.(web|native|ios|android)$/, "");
  let segments = withoutExt.split("/").filter((s) => !/^\(.*\)$/.test(s));
  if (segments[segments.length - 1] === "index") segments.pop();
  segments = segments.map((s) =>
    s.replace(/^\[\.\.\.(.+)\]$/, "a/b").replace(/^\[(.+)\]$/, "sample-$1"),
  );
  return `/${segments.join("/")}`;
}

const ROUTE_FILES = walkRouteFiles(APP_DIR).sort();
const DERIVED_URLS = [...new Set(ROUTE_FILES.map(routeFileToUrl))].sort();

/** Non-route paths the SPA still has to serve. */
const EXTRA_LIVE_PATHS = [
  "/favicon.ico",
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
  // [TEST-MOD-APPROVED #2986] These are live server documents, never SPA HTML.
  "/robots.txt",
  "/sitemap.xml",
];

/**
 * Paths that MUST be answered by an earlier rewrite rather than the SPA shell.
 * Everything else must reach the shell.
 */
const STATIC_HANDLER_PATHS: Record<string, string> = {
  "/robots.txt": "/api/robots",
  "/sitemap.xml": "/api/sitemap",
  "/stripe-onboarding-return": "/stripe-onboarding-return.html",
  "/auth/callback": "/auth/callback.html",
  "/accept-brand-invitation": "/accept-brand-invitation-entry",
};

// [TEST-MOD-APPROVED #2986] These five route families are now authoritative
// server documents for browsers and crawlers alike. This is deliberately
// separate from static callbacks so A.3 continues deriving route examples from
// the real Expo tree rather than hard-coding its coverage set.
const PUBLIC_DOCUMENT_HANDLERS: Array<{ pattern: RegExp; destination: string }> = [
  { pattern: /^\/e\/[^/]+\/[^/]+$/, destination: "/api/public-event?brandSlug=:brandSlug&eventSlug=:eventSlug" },
  { pattern: /^\/t\/[^/]+\/[^/]+$/, destination: "/api/public-trip?brandSlug=:brandSlug&tripSlug=:tripSlug" },
  { pattern: /^\/exp\/[^/]+\/[^/]+$/, destination: "/api/public-experience?brandSlug=:brandSlug&experienceSlug=:experienceSlug" },
  { pattern: /^\/b\/[^/]+\/v\/[^/]+$/, destination: "/api/public-venue?brandSlug=:brandSlug&venueSlug=:venueSlug" },
  { pattern: /^\/b\/[^/]+$/, destination: "/api/public-brand?brandSlug=:brandSlug" },
];

const publicDocumentDestination = (pathname: string): string | undefined =>
  PUBLIC_DOCUMENT_HANDLERS.find(({ pattern }) => pattern.test(pathname))?.destination;

/**
 * Walks the compiled rewrite chain the way Vercel does for an ordinary browser.
 * [TEST-MOD-APPROVED #2986] Public documents no longer carry User-Agent gates;
 * retaining the defensive skip means any future bot-only rewrite is still
 * unable to masquerade as browser coverage.
 */
function resolveForBrowser(
  pathname: string,
): { source: string; destination: string } | null {
  for (const rewrite of vercel.rewrites) {
    if (rewrite.has && rewrite.has.length > 0) continue; // bot-only rewrite
    const compiled = COMPILED_SRC[rewrite.source];
    if (!compiled) continue; // A.0 guarantees this never happens
    if (new RegExp(compiled).test(pathname)) {
      return { source: rewrite.source, destination: rewrite.destination };
    }
  }
  return null; // nothing matched => Vercel's real 404
}

// ---------------------------------------------------------------------------
// A. THE CATASTROPHIC REGRESSION — no real deep link may 404
// ---------------------------------------------------------------------------

describe("#1485 T2/A — every route in the real app/ tree still resolves", () => {
  it("A.0 — the compiled-form table covers every rewrite in the shipped config", () => {
    const unmapped = vercel.rewrites
      .map((r) => r.source)
      .filter((source) => !(source in COMPILED_SRC));
    // A new rewrite must be transcribed into COMPILED_SRC (run
    // getTransformedRoutes from @vercel/routing-utils) or the chain simulation
    // below would silently stop covering it.
    expect(unmapped).toEqual([]);
    // [TEST-MOD-APPROVED #1876] Literal tracks the shipped alternation (F-2).
    expect(COMPILED_SRC[catchAll.source]).toBe(
      "^(?:/((?!_expo/static/|assets/|accept-brand-invitation-entry$).*))$",
    );
  });

  it("A.1 — the derivation actually found the route tree (never vacuously green)", () => {
    // Guards against a walker bug turning every loop below into a no-op.
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(100);
    expect(DERIVED_URLS.length).toBeGreaterThanOrEqual(100);
    expect(DERIVED_URLS).toContain("/");
  });

  it("A.0b — stable share routes resolve before the unchanged SPA catch-all", () => {
    expect(resolveForBrowser("/s/Aa0Bb1Cc2Dd3Ee4F")).toEqual({
      source: "/s/:code", destination: "/api/content-share?code=:code",
    });
    // [TEST-MOD-APPROVED #1615] The route assertion must exercise the same
    // exact immutable r2 JPEG path represented in COMPILED_SRC above.
    expect(resolveForBrowser("/og/s/Aa0Bb1Cc2Dd3Ee4F/v7-r2.jpg")).toEqual({
      source: "/og/s/:code/v:version-r2.jpg",
      destination: "/api/content-share-image?code=:code&version=:version",
    });
    // [TEST-MOD-APPROVED #1876] Literal tracks the shipped alternation (F-2).
    expect(catchAll.source).toBe(
      "/((?!_expo/static/|assets/|accept-brand-invitation-entry$).*)",
    );
  });

  it("A.2 — the four production incident routes are inside the derived set", () => {
    // Sentry MINGLA-BUSINESS-A/B/E/G. If a refactor moves these files the
    // derivation must follow them, otherwise this suite stops proving anything
    // about the incidents that opened #1485.
    for (const url of [
      "/rsvp/sample-id", // E — app/rsvp/[id]/index.tsx
      "/venue/create", // B — app/venue/create.tsx
      "/insights/sample-id", // G — app/insights/[id].tsx
      "/e/sample-brandSlug/sample-eventSlug", // A — app/e/[brandSlug]/[eventSlug].tsx
    ]) {
      expect([url, DERIVED_URLS.includes(url)]).toEqual([url, true]);
    }
  });

  it("A.3 — every derived route reaches its explicit document owner through the full rewrite chain", () => {
    const failures: string[] = [];
    for (const url of [...DERIVED_URLS, ...EXTRA_LIVE_PATHS]) {
      const resolved = resolveForBrowser(url);
      if (!resolved) {
        failures.push(`${url} -> 404 (no rewrite matched)`);
        continue;
      }
      const expectedStatic = STATIC_HANDLER_PATHS[url];
      if (expectedStatic) {
        if (resolved.destination !== expectedStatic) {
          failures.push(`${url} -> ${resolved.destination} (want ${expectedStatic})`);
        }
        continue;
      }
      const expectedPublicDocument = publicDocumentDestination(url);
      if (expectedPublicDocument) {
        if (resolved.destination !== expectedPublicDocument) {
          failures.push(`${url} -> ${resolved.destination} (want ${expectedPublicDocument})`);
        }
        continue;
      }
      if (resolved.destination !== "/") {
        failures.push(`${url} -> ${resolved.destination} (want the SPA shell "/")`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("A.4 — dynamic, nested, grouped and multi-param routes are all represented", () => {
    // Proves A.3's coverage is not accidentally limited to flat static routes.
    const shapes: [string, (u: string) => boolean][] = [
      ["dynamic segment", (u) => u.includes("/sample-")],
      ["nested dynamic + child", (u) => /\/sample-[^/]+\/[a-z-]+$/.test(u)],
      ["two dynamic segments", (u) => (u.match(/sample-/g) ?? []).length >= 2],
      ["(tabs) group flattened", (u) => u === "/home" || u === "/analytics"],
      ["deep nesting (>=4 segments)", (u) => u.split("/").length >= 5],
    ];
    for (const [label, predicate] of shapes) {
      expect([label, DERIVED_URLS.some(predicate)]).toEqual([label, true]);
    }
  });

  it("A.5 — public documents are UA-independent; OG endpoints still precede the shell", () => {
    const botGated = vercel.rewrites.filter((r) => (r.has?.length ?? 0) > 0);
    // [TEST-MOD-APPROVED #2986] The five crawler-only forks were the root
    // defect: browser and crawler status/body truth can no longer diverge.
    expect(botGated).toEqual([]);
    expect(JSON.stringify(vercel.rewrites)).not.toMatch(/facebookexternalhit|googlebot|crawler|spider/i);
    for (const [pathname, expected] of [
      ["/e/acme/summer-party", "/api/public-event?brandSlug=:brandSlug&eventSlug=:eventSlug"],
      ["/t/acme/weekend-away", "/api/public-trip?brandSlug=:brandSlug&tripSlug=:tripSlug"],
      ["/exp/acme/gallery-tour", "/api/public-experience?brandSlug=:brandSlug&experienceSlug=:experienceSlug"],
      ["/b/acme", "/api/public-brand?brandSlug=:brandSlug"],
      ["/b/acme/v/rooftop", "/api/public-venue?brandSlug=:brandSlug&venueSlug=:venueSlug"],
    ] as [string, string][]) {
      expect([pathname, resolveForBrowser(pathname)?.destination]).toEqual([pathname, expected]);
    }
    // And the OG image endpoints are not bot-gated but still precede the shell.
    expect(resolveForBrowser("/og/event/abc-123.png")?.destination).toBe(
      "/api/og-event?eventId=:eventId",
    );
  });

  it("A.6 — no route in app/ can ever be shadowed by the exclusion", () => {
    // The exclusion is a prefix rule. If a route file ever produced a URL under
    // an excluded prefix, that route would 404 in production. Derived, so a
    // future `app/_expo/...` directory fails here instead of in production.
    //
    // [TEST-MOD-APPROVED #1876] WIDENED. This used to hard-code the single
    // literal `/_expo/static/`, so when `assets/` joined the alternation in
    // #1876 the guard's coverage silently NARROWED in relative terms: a future
    // `app/assets/…` route would have 404'd in production with this suite green.
    // The alternates are now read out of the SHIPPED alternation itself, so
    // alternate number four is covered the day it lands rather than the day it
    // breaks. No assertion was weakened — the original `_expo/static/` case is
    // still checked, now as one member of a derived set.
    const alternates = (/\(\?!([^)]+)\)/.exec(catchAll.source)?.[1] ?? "").split("|");
    expect(alternates.length).toBeGreaterThanOrEqual(3); // never silently empty
    expect(alternates).toContain("_expo/static/"); // the original guard, intact

    const shadowed: string[] = [];
    for (const alternate of alternates) {
      // `foo/` is a DIRECTORY PREFIX and swallows the whole subtree under it.
      // `foo$` is an EXACT match and can only ever collide with that one URL.
      const exact = alternate.endsWith("$");
      const bare = alternate.replace(/\$$/, "");
      const hits = (value: string): boolean =>
        exact ? value === bare : value.startsWith(bare);
      shadowed.push(
        ...DERIVED_URLS.filter((u) => hits(u.replace(/^\//, ""))).map(
          (u) => `${alternate} shadows ${u}`,
        ),
        ...ROUTE_FILES.filter((f) => hits(f)).map((f) => `${alternate} shadows app/${f}`),
      );
    }
    expect(shadowed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B. BOUNDARY / NEAR-MISS PATHS
// ---------------------------------------------------------------------------

/**
 * `caught: false` = the catch-all must NOT match, so Vercel answers a real 404.
 * `caught: true`  = the catch-all DOES match, so the SPA shell is served. Every
 * `true` row below is a path that is not, and can never be, a real Expo asset
 * URL, so serving the shell there is correct and cannot resurrect the bug.
 */
const BOUNDARY_ROWS: { pathname: string; caught: boolean; why: string }[] = [
  // --- must 404: the real, browser-generated asset shapes -------------------
  {
    pathname: "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js",
    caught: false,
    why: "MINGLA-BUSINESS-E's exact failing chunk",
  },
  {
    pathname: "/_expo/static/js/web/[id]-baf4771d14ff6e96d05d789394cc46ac.js",
    caught: false,
    why: "MINGLA-BUSINESS-G — unencoded brackets in a chunk name",
  },
  {
    pathname: "/_expo/static/js/web/%5Bid%5D-baf4771d14ff6e96d05d789394cc46ac.js",
    caught: false,
    why: "the same chunk percent-encoded, which the CDN also serves",
  },
  {
    pathname: "/_expo/static/media/font-abc.ttf",
    caught: false,
    why: "D-2 — the one-year immutable header applied to an HTML body",
  },
  { pathname: "/_expo/static/css/app.css", caught: false, why: "css tree" },
  {
    pathname: "/_expo/static/js/web/a.js",
    caught: false,
    why: "shortest realistic chunk path",
  },
  {
    pathname: "/_expo/static/",
    caught: false,
    why: "bare directory with a trailing slash",
  },
  // [TEST-MOD-APPROVED #922] The new exclusion is exact: only the internal
  // clean entry bypasses the SPA, while its children and lookalikes stay owned
  // by the same fallback that #1485 has always protected.
  {
    pathname: "/accept-brand-invitation-entry",
    caught: false,
    why: "the exact internal invitation artifact resolves through cleanUrls",
  },
  {
    pathname: "/accept-brand-invitation-entry/child",
    caught: true,
    why: "the invitation exclusion is exact rather than prefix-wide",
  },
  {
    pathname: "/accept-brand-invitation-entry-evil",
    caught: true,
    why: "a suffix lookalike remains an ordinary SPA deep link",
  },
  // --- correctly caught: not asset URLs, so the shell is the right answer ---
  {
    pathname: "/_expo/static",
    caught: true,
    why: "no trailing slash: a directory path, never an asset; trailingSlash:false already 308s /_expo/static/ here",
  },
  {
    pathname: "/_expo/staticX/a.js",
    caught: true,
    why: "prefix extension — expo only ever emits `_expo/static/`",
  },
  {
    pathname: "/_expostatic/a.js",
    caught: true,
    why: "missing separator — not the emitted prefix",
  },
  {
    pathname: "/x/_expo/static/a.js",
    caught: true,
    why: "nested: the exclusion is anchored at the first segment, which is exactly right — assets only exist at the root",
  },
  {
    pathname: "//_expo/static/a.js",
    caught: true,
    why: "doubled leading slash — not a path any Metro-emitted <script src> produces",
  },
  {
    pathname: "/_expo//static/a.js",
    caught: true,
    why: "doubled inner slash — same",
  },
  {
    pathname: "/_EXPO/STATIC/a.js",
    caught: true,
    why: "uppercase: the compiled src carries no `i` flag, and Metro emits only the lowercase prefix, so no real asset lives here",
  },
  {
    pathname: "/%5Fexpo/static/a.js",
    caught: true,
    why: "percent-encoded underscore: matching is on the raw path; no browser encodes `_`",
  },
  {
    pathname: "/_expo%2Fstatic/a.js",
    caught: true,
    why: "percent-encoded separator: same",
  },
  {
    pathname: "/venue/create?next=/_expo/static/js/web/a.js",
    caught: true,
    why: "CRITICAL: an asset path smuggled into a query string must never 404 a real deep link",
  },
  {
    pathname: "/venue/create#/_expo/static/js/web/a.js",
    caught: true,
    why: "a fragment never reaches the server, but must not 404 even if it did",
  },
  {
    // [TEST-MOD-APPROVED #1876] This row is the DEFECT #1876 F-2 fixes, and it
    // flips from `caught: true` to `caught: false`. #1485 recorded it as
    // discovery D-1 and deliberately left the /assets tree shell-served; it was
    // still returning `200 text/html · x-vercel-cache: HIT` for a missing file
    // on production on 2026-08-11 — an edge-cached lie about a missing font or
    // image. #1876 excludes `assets/` from the catch-all so it 404s honestly.
    // The row is retained, inverted, NOT deleted: its coverage is strictly
    // stronger now, because a revert of the exclusion re-reds this suite.
    pathname: "/assets/assets/google_icon.abc123.png",
    caught: false,
    why: "#1876 F-2 (= #1485 discovery D-1) — the /assets tree is now excluded, so a missing file returns a real 404 instead of the SPA shell",
  },
];

describe("#1485 T2/B — boundary and near-miss paths behave exactly as intended", () => {
  it("B.1 — every boundary row resolves the same way under every plausible compilation", () => {
    const failures: string[] = [];
    for (const row of BOUNDARY_ROWS) {
      // The pathname is what Vercel matches; strip query/fragment first, which
      // is itself the assertion for the two smuggling rows.
      const pathname = row.pathname.split(/[?#]/)[0];
      for (const { label, re } of SHIPPED_MATCHERS) {
        if (re.test(pathname) !== row.caught) {
          failures.push(
            `${row.pathname} [${label}] expected caught=${row.caught} (${row.why})`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("B.2 — the query/fragment rows are only safe because matching is path-only", () => {
    // If anyone ever matched the full request line instead of the pathname, the
    // asset-in-query row would still be safe (the lookahead is anchored at the
    // first segment) but the asset-with-query row must still be excluded.
    expect(matchesUnderEveryWrapper("/venue/create?next=/_expo/static/js/web/a.js")).toBe(
      true,
    );
    expect(rejectedByEveryWrapper("/_expo/static/js/web/a.js?v=1")).toBe(true);
  });

  it("B.3 — the exclusion prefix and the cache-header prefix are the same string", () => {
    // D-2: the one-year immutable rule is keyed on `/_expo/static/(.*)`. If the
    // two prefixes ever drift, a tree could be long-cached while still being
    // shell-served — the exact failure #1485 exists to kill.
    const headerSources = vercel.headers.map((h) => h.source);
    expect(headerSources).toContain("/_expo/static/(.*)");
    expect(catchAll.source).toContain("_expo/static/");
    const excluded = /\(\?!([^)]+)\)/.exec(catchAll.source)?.[1];
    const alternatives = excluded?.split("|");
    // [TEST-MOD-APPROVED #1876] `assets/` joins the alternation (F-2 = #1485's
    // deferred D-1). `_expo/static/` remains the FIRST alternate, which is what
    // the prefix-drift assertion below is actually keyed on, and the exhaustive
    // list is still exhaustive — it grew by exactly one known entry.
    expect(alternatives).toEqual([
      "_expo/static/",
      "assets/",
      "accept-brand-invitation-entry$",
    ]);
    expect(alternatives?.[0]).toBe(
      vercel.headers.find((header) => header.source === "/_expo/static/(.*)")
        ?.source.replace(/^\//, "").replace("(.*)", ""),
    );
    expect(alternatives).toHaveLength(3);
    expect(headerSources.every((s) => s === s.toLowerCase())).toBe(true);
  });

  it("B.4 — trailingSlash/cleanUrls are unchanged, so the near-miss reasoning holds", () => {
    // `/_expo/static/` only 404s because trailingSlash:false 308s it to
    // `/_expo/static` first; and cleanUrls never touches .js/.png/.ttf.
    expect(vercel.trailingSlash).toBe(false);
    expect(vercel.cleanUrls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. THE INERT-FORM TRAP — proved behaviourally, not just by string equality
// ---------------------------------------------------------------------------

const REJECTED_FORMS: { label: string; source: string; why: string }[] = [
  {
    label: "the original bug",
    source: "/(.*)",
    why: "swallows every missing asset and answers 200 + index.html",
  },
  {
    label: "the inert lookahead",
    source: "/((?!^_expo/static/).*)",
    why: "the `^` is evaluated at index 1 of `^(?:/(…))$`, where it can never match, so the lookahead never fails",
  },
];

describe("#1485 T2/C — the config cannot silently regress to an inert form", () => {
  it("C.1 — each rejected form WOULD be caught by section B (this suite has teeth)", () => {
    const assetPath = "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js";
    for (const form of REJECTED_FORMS) {
      const wouldSwallow = matchersFor(form.source).every(({ re }) => re.test(assetPath));
      // If this ever became false the form would be harmless — and B.1 would
      // stop being a regression test for it.
      expect([form.label, wouldSwallow]).toEqual([form.label, true]);
      expect([form.label, catchAll.source]).not.toEqual([form.label, form.source]);
    }
  });

  it("C.2 — the shipped source carries no inert anchor and no named parameter", () => {
    expect(catchAll.source).not.toContain("(?!^");
    expect(catchAll.source).not.toMatch(/:\w+\(/);
    // The named-parameter form compiles to the SAME regex but rewrites the
    // destination to "/?path=$1", which silently breaks the SPA shell contract.
    for (const rewrite of vercel.rewrites) {
      expect([rewrite.source, /:\w+\(\(\?!/.test(rewrite.source)]).toEqual([
        rewrite.source,
        false,
      ]);
    }
  });

  it("C.3 — the catch-all is still last and still points at the bare shell", () => {
    expect(catchAll.destination).toBe("/");
    expect(catchAll.destination).not.toContain("?");
    expect(vercel.rewrites.filter((r) => r.destination === "/").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Guard harness — loads the REAL module against a synthetic window.
// ---------------------------------------------------------------------------

type GuardHarness = {
  reload: jest.Mock;
  setItem: jest.Mock;
  seed: (value: string) => void;
  error: (message: string) => void;
  reject: (reason: unknown) => void;
};

type MountOptions = {
  setItemThrows?: boolean;
  noSessionStorage?: boolean;
  seed?: string;
};

const savedWindow = (global as unknown as { window?: unknown }).window;
let clock = 2_000_000_000;

afterEach(() => {
  (global as unknown as { window?: unknown }).window = savedWindow;
  jest.restoreAllMocks();
});

function mountGuard(options: MountOptions = {}): GuardHarness {
  clock = 2_000_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);

  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const store = new Map<string, string>();
  if (options.seed !== undefined) store.set("mingla:last-chunk-reload", options.seed);

  const reload = jest.fn();
  const setItem = jest.fn((key: string, value: string) => {
    if (options.setItemThrows) throw new Error("QuotaExceededError");
    store.set(key, value);
  });
  const getItem = jest.fn((key: string) => store.get(key) ?? null);

  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    location: { reload },
  };
  if (!options.noSessionStorage) fakeWindow.sessionStorage = { getItem, setItem };

  (global as unknown as { window?: unknown }).window = fakeWindow;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../src/diagnostics/chunkReloadGuard");
  });

  const fire = (type: string, event: unknown): void => {
    const registered = listeners.get(type) ?? [];
    expect(registered.length).toBeGreaterThan(0);
    for (const listener of registered) listener(event);
  };

  return {
    reload,
    setItem,
    seed: (value: string) => store.set("mingla:last-chunk-reload", value),
    error: (message: string) => fire("error", { message }),
    reject: (reason: unknown) => fire("unhandledrejection", { reason }),
  };
}

// ---------------------------------------------------------------------------
// D. THE JSON.parse FALSE-POSITIVE HAZARD
// ---------------------------------------------------------------------------

/**
 * Every shape a JSON parse of an HTML error body produces across the engines
 * business web actually runs on. NONE may reload: an API returning an HTML error
 * page must never hard-reload the user's page. The V8 short-body and legacy rows
 * are the ones T3 does not cover.
 */
const JSON_SHAPES: [string, string][] = [
  ["V8 / Chromium, long body", `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`],
  ["V8 / Chromium, short body", `Unexpected token '<', "<" is not valid JSON`],
  [
    "V8 / Chromium, mid-body context",
    `Unexpected token '<', ..."tml>\\n<body" ... is not valid JSON`,
  ],
  [
    "V8, SyntaxError prefix as reported to onerror",
    `Uncaught SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
  ],
  [
    "V8 legacy (Chrome <=107 / Node <=18)",
    "Unexpected token < in JSON at position 0",
  ],
  [
    "SpiderMonkey / Gecko",
    "JSON.parse: unexpected character at line 1 column 1 of the JSON data",
  ],
  ["JSC / Safari", `JSON Parse error: Unexpected identifier "html"`],
  ["Hermes", "JSON Parse error: Unexpected token: <"],
  [
    "wrapped by a service layer but suffix intact",
    `venue_intelligence_overview failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
  ],
];

/**
 * Genuine 200-HTML / missing-module signatures in shapes T3 does not use. Each
 * MUST still reload exactly once, otherwise the fix does nothing.
 */
const GENUINE_SHAPES: [string, string][] = [
  ["bare V8 script parse", `Uncaught SyntaxError: Unexpected token '<'`],
  [
    "V8 with source location",
    `SyntaxError: Unexpected token '<' (at index-c71bd65d4564bece548e38b8d5512d1e.js:1:1)`,
  ],
  ["Metro registry, falsy module id", `Requiring unknown module "0"`],
  [
    "Metro registry, full production text",
    `Requiring unknown module "771". If you are sure the module exists, try restarting Metro.`,
  ],
  ["lowercase phrasing (matcher is case-insensitive)", `unexpected token '<'`],
];

describe("#1485 T2/D — a JSON.parse of an HTML error body must never reload", () => {
  it("D.1 — a genuine 200-HTML / unknown-module failure still reloads exactly once", () => {
    for (const [label, message] of GENUINE_SHAPES) {
      const guard = mountGuard();
      guard.error(message);
      expect([label, guard.reload.mock.calls.length]).toEqual([label, 1]);
    }
  });

  it("D.2 — no JSON parse shape reloads, on any engine, from either listener", () => {
    const failures: string[] = [];
    for (const [label, message] of JSON_SHAPES) {
      const viaError = mountGuard();
      viaError.error(message);
      if (viaError.reload.mock.calls.length !== 0) failures.push(`${label} (error event)`);

      const viaRejection = mountGuard();
      viaRejection.reject(new Error(message));
      if (viaRejection.reload.mock.calls.length !== 0) {
        failures.push(`${label} (unhandledrejection)`);
      }

      const viaStringRejection = mountGuard();
      viaStringRejection.reject(message);
      if (viaStringRejection.reload.mock.calls.length !== 0) {
        failures.push(`${label} (string rejection)`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("D.3 — the exclusion is checked AFTER the HTML signature, never instead of it", () => {
    // A message carrying BOTH a real chunk-load failure AND the JSON wording is
    // still a chunk failure: CHUNK_ERROR_RE short-circuits before the exclusion.
    const guard = mountGuard();
    guard.error(
      "ChunkLoadError: Loading chunk 771 failed — body was not valid JSON",
    );
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("D.4 — KNOWN BOUNDARY: an unmatched engine phrasing does not reload", () => {
    // Documents the matcher's edge, deliberately. Gecko phrases an HTML-as-JS
    // parse failure as "expected expression, got '<'", which is NOT matched.
    // Acceptable because part (a) turns the underlying condition into a real
    // 404, and Gecko's dynamic-import failure text IS in CHUNK_ERROR_RE (proved
    // on the next line). If that ever stops being true, widen HTML_FOR_JS_RE.
    const unmatched = mountGuard();
    unmatched.error("SyntaxError: expected expression, got '<'");
    expect(unmatched.reload).not.toHaveBeenCalled();

    const gecko404 = mountGuard();
    gecko404.reject(new Error("error loading dynamically imported module"));
    expect(gecko404.reload).toHaveBeenCalledTimes(1);
  });

  it("D.5 — a wrapped message that LOSES the JSON suffix is bounded to one reload", () => {
    // Residual, deliberately pinned: if a future caller truncates a V8 JSON
    // error before "is not valid JSON", the guard cannot tell it from a chunk
    // failure. No mingla-business code does this today. The invariant that
    // matters is that the blast radius is ONE reload, never a loop.
    const guard = mountGuard();
    for (let i = 0; i < 25; i += 1) {
      guard.error("Failed to parse response: Unexpected token '<'");
    }
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// E. RELOAD-LOOP UNDER ABUSE
// ---------------------------------------------------------------------------

const CHUNK_MSG = `Uncaught SyntaxError: Unexpected token '<'`;

describe("#1485 T2/E — the guard can never loop, however the clock or storage behaves", () => {
  it("E.1 — a burst of 200 errors inside a single millisecond reloads exactly once", () => {
    // The real failure mode: one poisoned chunk throws from every module that
    // touches it, all in the same tick. T3 only ever fires events seconds apart.
    const guard = mountGuard();
    for (let i = 0; i < 200; i += 1) guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(1);
    expect(guard.setItem).toHaveBeenCalledTimes(1);
  });

  it("E.2 — errors arriving on BOTH listeners in one tick still reload only once", () => {
    const guard = mountGuard();
    guard.error(CHUNK_MSG);
    guard.reject(new Error("Failed to fetch dynamically imported module: /a.js"));
    guard.error(`Requiring unknown module "771"`);
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("E.3 — the cooldown boundary is exactly 10,000ms and is closed on both sides", () => {
    const guard = mountGuard();
    guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(1);

    clock += 9_999;
    guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(1);

    clock += 1; // exactly 10,000ms — the boundary T3 never probes
    guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(2);
  });

  it("E.4 — a corrupted cooldown value cannot wedge the guard OR let it loop", () => {
    for (const corrupt of ["not-a-number", "NaN", "Infinity", "-Infinity", ""]) {
      const guard = mountGuard({ seed: corrupt });
      for (let i = 0; i < 10; i += 1) guard.error(CHUNK_MSG);
      // At most one reload, and the corrupt value is replaced with a real
      // timestamp so the next page load starts from a sane cooldown.
      expect([corrupt, guard.reload.mock.calls.length]).toEqual([corrupt, 1]);
      expect([corrupt, guard.setItem.mock.calls.length]).toEqual([corrupt, 1]);
    }
  });

  it("E.5 — a future-dated cooldown fails SAFE (suppresses reloads, never loops)", () => {
    const guard = mountGuard({ seed: String(2_000_000_000 + 3_600_000) });
    for (let i = 0; i < 10; i += 1) guard.error(CHUNK_MSG);
    expect(guard.reload).not.toHaveBeenCalled();
    expect(guard.setItem).not.toHaveBeenCalled();
  });

  it("E.6 — a clock that jumps BACKWARDS suppresses reloads rather than looping", () => {
    const guard = mountGuard();
    guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(1);

    clock -= 3_600_000; // NTP correction / user changed the system clock
    for (let i = 0; i < 10; i += 1) guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("E.7 — setItem throwing (quota / private mode) blocks the reload, not the page", () => {
    // T3 covers getItem throwing. This is the other half of the try block: the
    // write fails, so the timestamp is never recorded — reloading anyway would
    // be an unbounded loop.
    const guard = mountGuard({ setItemThrows: true });
    expect(() => guard.error(CHUNK_MSG)).not.toThrow();
    expect(guard.reload).not.toHaveBeenCalled();
  });

  it("E.8 — a window with no sessionStorage at all neither throws nor reloads", () => {
    const guard = mountGuard({ noSessionStorage: true });
    expect(() => guard.error(CHUNK_MSG)).not.toThrow();
    expect(guard.reload).not.toHaveBeenCalled();
  });

  it("E.9 — a non-matching error never records a cooldown (no self-DoS)", () => {
    // A stray unrelated error must not consume the one reload the user gets.
    const guard = mountGuard();
    guard.error("TypeError: undefined is not a function");
    guard.reject({ some: "object" });
    guard.reject(undefined);
    expect(guard.setItem).not.toHaveBeenCalled();
    guard.error(CHUNK_MSG);
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });
});
