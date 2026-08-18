/**
 * issue #2240 — "Open in Mingla" in every confirmation email was a 404.
 *
 * ─── WHY THIS SUITE IS SHAPED THE WAY IT IS ─────────────────────────────────
 *
 * The bug shipped, and then SURVIVED a review, because a test asserted the dead
 * URL's PRESENCE as "the universal-link fallback behaviour is unchanged". That
 * test was not weak by accident — it was the wrong KIND of test. A test that
 * pins a URL exactly can still never ask whether it resolves. It passes just as
 * green when the string names a route that has never existed.
 *
 * So nothing in here pins the email's URL to a literal. Every assertion
 * EXTRACTS the URL from rendered template output and then RESOLVES it:
 *
 *   T1  the URL names a route this repository actually serves on the apex host,
 *       decided by a resolver built from the real routing layers
 *       (mingla-marketing/app/**, next.config.ts redirects, middleware.ts,
 *       vercel.json) — not from a list of blessed strings.
 *   T2  that resolver is FALSIFIABLE: the dead path #2240 was reported for must
 *       come back UNRESOLVED from the same code path that passes the live one.
 *       Without this, a resolver that returned `true` for everything would make
 *       T1 a check that carries no information.
 *   T3  the destination's own device decision is executed, on the real
 *       `resolvePlatformFromUa` the route calls, for real iOS/Android UAs.
 *   T4  all three templates emit ONE identical destination, in HTML and text.
 *   T5  the loop closes: the URL each template actually renders is fed back
 *       through T1's resolver. Change appLink.ts to any unserved path and this
 *       suite goes red without anyone updating an expected string.
 *   T6  live network, opt-in (ISSUE_2240_LIVE=1): really request the URL with
 *       iOS / Android / desktop User-Agents and assert where it lands.
 *
 * T1–T5 are offline and deterministic. T6 is the acceptance criterion executed
 * against production and runs in the dedicated #2240 lane.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { MINGLA_APP_LINK_URL } from "../appLink.ts";
import { renderTicketBody } from "../ticketBody.ts";
import { renderTripConfirmationEmail } from "../tripConfirmationEmail.ts";
import { renderExperienceConfirmationEmail } from "../experienceConfirmationEmail.ts";
import { resolvePlatformFromUa } from "../../../../../mingla-marketing/lib/device-platform.ts";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
} from "../../../../../mingla-marketing/lib/store-links.ts";

Deno.env.set("DENO_TESTING", "1");

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname;
const APEX_HOSTS = new Set(["usemingla.com", "www.usemingla.com"]);

/** The path #2240 was filed for, from the real order in the issue. */
const DEAD_PATH = "/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat";

// ─── The resolver ───────────────────────────────────────────────────────────
// Built from the routing layers as they exist on disk, so it tracks the app
// rather than a hand-maintained list. Every layer it cannot model is a LOUD
// failure, never a silent "resolved" — an under-modelling resolver is exactly
// the unfalsifiable check this suite exists to avoid.

type RouteTable = { patterns: string[][]; sourceFiles: string[] };

/** Walk `mingla-marketing/app/**` into App-Router path patterns. */
function buildFilesystemRoutes(): RouteTable {
  const appDir = `${REPO_ROOT}mingla-marketing/app`;
  const patterns: string[][] = [];
  const sourceFiles: string[] = [];

  const walk = (dirAbs: string, segments: string[]): void => {
    for (const entry of Deno.readDirSync(dirAbs)) {
      const abs = `${dirAbs}/${entry.name}`;
      if (entry.isDirectory) {
        // Route groups `(marketing)` contribute NO path segment; parallel
        // routes `@slot` and private folders `_x` are not routable segments.
        if (entry.name.startsWith("(") && entry.name.endsWith(")")) {
          walk(abs, segments);
        } else if (entry.name.startsWith("@") || entry.name.startsWith("_")) {
          continue;
        } else {
          walk(abs, [...segments, entry.name]);
        }
        continue;
      }
      if (entry.name === "page.tsx" || entry.name === "page.ts" || entry.name === "route.ts") {
        patterns.push(segments);
        sourceFiles.push(abs.slice(REPO_ROOT.length));
      }
    }
  };
  walk(appDir, []);
  return { patterns, sourceFiles };
}

/** Does one App-Router pattern match a concrete pathname's segments? */
function patternMatches(pattern: string[], segments: string[]): boolean {
  // Catch-all `[...x]` swallows one-or-more; optional `[[...x]]` zero-or-more.
  const last = pattern.at(-1);
  if (last !== undefined && last.startsWith("[[...") && last.endsWith("]]")) {
    return segments.length >= pattern.length - 1 &&
      pattern.slice(0, -1).every((p, i) => segmentMatches(p, segments[i]));
  }
  if (last !== undefined && last.startsWith("[...") && last.endsWith("]")) {
    return segments.length >= pattern.length &&
      pattern.slice(0, -1).every((p, i) => segmentMatches(p, segments[i]));
  }
  if (pattern.length !== segments.length) return false;
  return pattern.every((p, i) => segmentMatches(p, segments[i]));
}

function segmentMatches(pattern: string, segment: string | undefined): boolean {
  if (segment === undefined) return false;
  if (pattern.startsWith("[") && pattern.endsWith("]")) return segment.length > 0;
  return pattern === segment;
}

/** `next.config.ts` redirect sources — a redirect IS a resolution. */
function buildRedirectSources(): string[] {
  const src = Deno.readTextFileSync(`${REPO_ROOT}mingla-marketing/next.config.ts`);
  const block = /async\s+redirects\s*\(\s*\)\s*\{([\s\S]*?)\n {2}\}/.exec(src);
  assert(block !== null, "could not locate the redirects() block in next.config.ts — the resolver is out of sync with the app and must not guess");
  return [...block[1].matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * `middleware.ts` decisions that apply on the APEX host. Parsed from source so
 * a change to the middleware cannot leave this resolver quietly stale.
 */
function buildMiddlewareApexRules(): { shareRe: RegExp; careersPrefix: string } {
  const src = Deno.readTextFileSync(`${REPO_ROOT}mingla-marketing/middleware.ts`);
  const shareLine = /const PUBLIC_SHARE_PATH = (\/\^.*\$\/)\n/.exec(src);
  assert(shareLine !== null, "could not parse PUBLIC_SHARE_PATH out of middleware.ts — the resolver must not guess which paths the apex serves");
  const body = shareLine[1].slice(1, -1);
  const prefix = /const CAREERS_PREFIX = '([^']+)'/.exec(src);
  assert(prefix !== null, "could not parse CAREERS_PREFIX out of middleware.ts");
  return { shareRe: new RegExp(body), careersPrefix: prefix[1] };
}

/**
 * FAIL-LOUD GUARD. `vercel.json` rewrites run BEFORE the Next app. Each one is
 * host-gated to a host that is not the apex; if that ever stops being true this
 * resolver can no longer reason about the apex, and it must say so rather than
 * return a confident answer built on a layer it did not read.
 */
function assertVercelRewritesDoNotTouchApex(): number {
  const cfg = JSON.parse(
    Deno.readTextFileSync(`${REPO_ROOT}mingla-marketing/vercel.json`),
  ) as { rewrites?: Array<{ source: string; has?: Array<{ type: string; value: string }> }> };
  const rewrites = cfg.rewrites ?? [];
  for (const r of rewrites) {
    const hostGate = (r.has ?? []).find((h) => h.type === "host");
    assert(
      hostGate !== undefined,
      `vercel.json rewrite "${r.source}" has no host condition, so it applies on the apex. This resolver cannot model it — model it here rather than letting #2240's resolver silently under-report.`,
    );
    assert(
      !APEX_HOSTS.has(hostGate.value.toLowerCase()),
      `vercel.json rewrite "${r.source}" is gated to the APEX host "${hostGate.value}". Model it in this resolver before shipping.`,
    );
  }
  return rewrites.length;
}

type Resolution = { resolved: boolean; via: string };

/** Resolve a pathname as the apex host serves it. */
function resolveOnApex(
  pathname: string,
  routes: RouteTable,
  redirectSources: string[],
  mw: { shareRe: RegExp; careersPrefix: string },
): Resolution {
  const segments = pathname.split("/").filter((s) => s.length > 0);

  for (const source of redirectSources) {
    const pat = source.split("/").filter((s) => s.length > 0)
      .map((s) => (s.startsWith(":") ? "[x]" : s));
    if (patternMatches(pat, segments)) {
      return { resolved: true, via: `next.config redirect ${source}` };
    }
  }

  // The apex guard 404s the careers segment — it is NOT served here.
  if (
    pathname === mw.careersPrefix || pathname.startsWith(`${mw.careersPrefix}/`)
  ) {
    return { resolved: false, via: "middleware apex guard → careers-not-found (404)" };
  }

  if (mw.shareRe.test(pathname)) {
    return { resolved: true, via: "middleware public-share rewrite" };
  }

  for (let i = 0; i < routes.patterns.length; i++) {
    if (patternMatches(routes.patterns[i], segments)) {
      return { resolved: true, via: routes.sourceFiles[i] };
    }
  }
  return { resolved: false, via: "no route, no redirect, no rewrite — HTTP 404" };
}

// Built once; the guard runs as part of construction so every test inherits it.
const ROUTES = buildFilesystemRoutes();
const REDIRECTS = buildRedirectSources();
const MIDDLEWARE = buildMiddlewareApexRules();

const resolve = (pathname: string): Resolution =>
  resolveOnApex(pathname, ROUTES, REDIRECTS, MIDDLEWARE);

/** Pull the app-CTA URL out of rendered output rather than assuming it. */
function urlsInHtml(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}
function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>")]+/g)].map((m) => m[0]);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORDER_ID = "0a0870b0-c117-4707-bdf4-21fc64bebcab";

function renderAllThree(): Array<{ name: string; html: string; text: string }> {
  const ticket = renderTicketBody({
    variant: "ticket_confirmation_paid",
    event: {
      title: "Rooftop Sessions",
      coverMediaUrl: null,
      coverMediaType: null,
      locationText: "Lagos",
      isOnline: false,
      startAt: "2026-09-01T18:00:00Z",
      endAt: "2026-09-01T22:00:00Z",
      timezone: "Africa/Lagos",
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
    order: {
      id: ORDER_ID,
      shortId: "MG-1234",
      totalCents: 5000,
      currency: "NGN",
      buyerName: "Ada",
      lineItems: [
        { ticketName: "General", quantity: 2, unitPriceCents: 2500, totalCents: 5000 },
      ],
      tickets: [{ ticketId: "t1", ticketName: "General" }],
    },
  });

  const trip = renderTripConfirmationEmail({
    recipient: { name: "Ada", email: "ada@example.com" },
    trip: {
      title: "Obudu Weekend",
      startAtIso: "2026-10-02T08:00:00Z",
      endAtIso: "2026-10-04T18:00:00Z",
      destinationText: "Obudu",
      timezone: "Africa/Lagos",
      days: [{ ordinal: 1, title: "Arrival" }],
      inclusions: [{ kind: "included", item: "Transport" }],
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
    order: { id: ORDER_ID, shortId: "MG-1235", totalCents: 90000, currency: "NGN" },
  });

  const experience = renderExperienceConfirmationEmail({
    recipient: { name: "Ada", email: "ada@example.com" },
    experience: {
      title: "Island Food Crawl",
      dateIso: "2026-09-12T15:00:00Z",
      timezone: "Africa/Lagos",
      venueText: "Victoria Island",
      stops: [
        { stopOrder: 1, placeName: "Stop One", address: "1 Road", startTime: "15:00", priceCents: null },
      ],
    },
    brand: { name: "Alte Nights", profilePhotoUrl: null },
    order: { id: ORDER_ID, shortId: "MG-1236", totalCents: 30000, currency: "NGN" },
  });

  return [
    { name: "ticket", html: ticket.html, text: ticket.text },
    { name: "trip", html: trip.html, text: trip.text },
    { name: "experience", html: experience.html, text: experience.text },
  ];
}

// ─── T1 — the email's destination resolves ──────────────────────────────────

Deno.test("T1 the email app link names a route the apex host actually serves", () => {
  const url = new URL(MINGLA_APP_LINK_URL);
  assert(
    APEX_HOSTS.has(url.host),
    `the email app link points at "${url.host}", which this resolver cannot vouch for. Either serve it from the apex or extend the resolver to model that host.`,
  );
  const r = resolve(url.pathname);
  assert(
    r.resolved,
    `the "Open in Mingla" destination ${MINGLA_APP_LINK_URL} does NOT resolve: ${r.via}. This is exactly the #2240 defect — a link in a shipped email that reaches nothing.`,
  );
});

// ─── T2 — the resolver is falsifiable ───────────────────────────────────────

Deno.test("T2 the resolver returns UNRESOLVED for the dead #2240 path", () => {
  const dead = resolve(DEAD_PATH);
  assert(
    !dead.resolved,
    `the resolver claims ${DEAD_PATH} resolves (via ${dead.via}). That path returns HTTP 404 in production, so the resolver is broken and T1/T5 carry no information.`,
  );
});

Deno.test("T2 the resolver returns RESOLVED for routes that demonstrably exist", () => {
  for (const [pathname, why] of [
    ["/", "app/(explorer)/page.tsx — a route group contributes no segment"],
    ["/download", "app/download/page.tsx"],
    ["/host", "app/host/page.tsx"],
    // A DYNAMIC filesystem segment. Deliberately not /careers/roles/[slug]:
    // that route exists on disk but the middleware apex guard 404s the whole
    // careers segment on this host, and the resolver models that correctly.
    ["/api/internal-share-proxy/data/abc123", "app/api/internal-share-proxy/data/[shareId]/route.ts"],
    ["/p/" + "a".repeat(36), "a middleware public-share rewrite"],
    ["/business/anything", "a next.config redirect source"],
  ] as const) {
    const r = resolve(pathname);
    assert(r.resolved, `${pathname} should resolve (${why}) but did not: ${r.via}`);
  }
});

Deno.test("T2 the resolver is not vacuous and its inputs were really read", () => {
  assert(
    ROUTES.patterns.length >= 30,
    `only ${ROUTES.patterns.length} routes discovered — the walk is not reading mingla-marketing/app`,
  );
  assert(REDIRECTS.length >= 5, `only ${REDIRECTS.length} redirect sources parsed from next.config.ts`);
  assert(assertVercelRewritesDoNotTouchApex() >= 1, "no vercel.json rewrites parsed — the guard read nothing");
  // Paths that are NOT served must come back unresolved, or the walk is matching everything.
  for (const nonsense of ["/definitely-not-a-route", "/orders", "/download/extra/segments"]) {
    assert(!resolve(nonsense).resolved, `${nonsense} must not resolve — the resolver is over-matching`);
  }
  // The careers apex guard is a real 404 on this host.
  assert(!resolve("/careers").resolved, "the apex must 404 /careers (middleware apex guard)");
});

// ─── T3 — the destination's own device decision, executed ───────────────────

Deno.test("T3 the destination resolves per device using the route's real detector", () => {
  const routeSrc = Deno.readTextFileSync(
    `${REPO_ROOT}mingla-marketing/app/download/page.tsx`,
  );
  // The email's destination is only device-aware because THIS route branches.
  // Assert the wiring exists, then execute the detector it calls.
  assertStringIncludes(routeSrc, "resolvePlatformFromUa");
  assertStringIncludes(routeSrc, "redirect(APP_STORE_URL)");
  assertStringIncludes(routeSrc, "redirect(PLAY_STORE_URL)");

  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
  const MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

  assertEquals(resolvePlatformFromUa(IPHONE), "ios");
  assertEquals(resolvePlatformFromUa(ANDROID), "android");
  assertEquals(resolvePlatformFromUa(MAC), "other");

  // And the two destinations it redirects to are the LIVE listings, not a
  // TestFlight or a stale id (the ORCH-1342 F-12 class).
  assertStringIncludes(APP_STORE_URL, "apps.apple.com/app/id6760440898");
  assertStringIncludes(PLAY_STORE_URL, "id=com.mingla.app.v2");
});

// ─── T4 — one destination, three templates, both bodies ─────────────────────

Deno.test("T4 all three templates emit ONE app link, identical in HTML and text", () => {
  for (const { name, html, text } of renderAllThree()) {
    const htmlCta = urlsInHtml(html).filter((u) => u === MINGLA_APP_LINK_URL);
    assertEquals(
      htmlCta.length,
      1,
      `${name}: expected exactly one "Open in Mingla" href, found ${htmlCta.length}`,
    );
    assertStringIncludes(html, "Open in Mingla");

    const textCta = urlsInText(text).filter((u) => u === MINGLA_APP_LINK_URL);
    assertEquals(
      textCta.length,
      1,
      `${name}: the plain-text body must carry the SAME working link as the HTML (#2240), found ${textCta.length}`,
    );

    // The recurrence class itself: no per-order chat path in either body.
    assert(!html.includes("/orders/"), `${name}: HTML still builds an /orders/ path`);
    assert(!text.includes("/orders/"), `${name}: text still builds an /orders/ path`);
  }
});

// ─── T5 — close the loop: what is RENDERED must RESOLVE ─────────────────────

Deno.test("T5 the URL each template actually renders resolves on the apex", () => {
  for (const { name, html, text } of renderAllThree()) {
    for (const [body, raw] of [["html", urlsInHtml(html)], ["text", urlsInText(text)]] as const) {
      const cta = raw.find((u) => u === MINGLA_APP_LINK_URL);
      assert(cta !== undefined, `${name}/${body}: no app CTA URL found in the rendered output`);
      const url = new URL(cta);
      assert(APEX_HOSTS.has(url.host), `${name}/${body}: app CTA host "${url.host}" is not the apex`);
      const r = resolve(url.pathname);
      assert(
        r.resolved,
        `${name}/${body}: the rendered "Open in Mingla" URL ${cta} does not resolve (${r.via}). A buyer tapping it gets a 404.`,
      );
    }
  }
});

// ─── T6 — the acceptance criterion, against production ──────────────────────

const LIVE = Deno.env.get("ISSUE_2240_LIVE") === "1";

Deno.test({
  name: "T6 LIVE the destination really resolves per device over HTTP",
  ignore: !LIVE,
  fn: async () => {
    const cases: Array<{ label: string; ua: string; expect: (status: number, loc: string | null) => string | null }> = [
      {
        label: "iOS",
        ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        expect: (s, loc) =>
          s >= 300 && s < 400 && loc !== null && loc.includes("apps.apple.com")
            ? null
            : `expected a redirect to the App Store, got ${s} -> ${loc}`,
      },
      {
        label: "Android",
        ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
        expect: (s, loc) =>
          s >= 300 && s < 400 && loc !== null && loc.includes("play.google.com")
            ? null
            : `expected a redirect to Google Play, got ${s} -> ${loc}`,
      },
      {
        label: "desktop",
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        expect: (s) => (s === 200 ? null : `expected the download page to render, got ${s}`),
      },
    ];

    for (const c of cases) {
      let lastProblem = "never attempted";
      let ok = false;
      // Three attempts: a transient network fault must not be reported as a
      // dead destination, and a dead destination must not be excused as flake.
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const res = await fetch(MINGLA_APP_LINK_URL, {
            headers: { "user-agent": c.ua },
            redirect: "manual",
          });
          await res.body?.cancel();
          const problem = c.expect(res.status, res.headers.get("location"));
          if (problem === null) ok = true;
          else lastProblem = problem;
        } catch (err) {
          lastProblem = `network error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      assert(ok, `${c.label}: ${MINGLA_APP_LINK_URL} — ${lastProblem}`);
    }
  },
});

// The negative control for T6: the path #2240 was filed for must still 404, so
// a green T6 is never the result of the apex answering 200 to everything.
Deno.test({
  name: "T6 LIVE the dead #2240 path is really a 404 in production",
  ignore: !LIVE,
  fn: async () => {
    const res = await fetch(`https://usemingla.com${DEAD_PATH}`, { redirect: "manual" });
    await res.body?.cancel();
    assertEquals(
      res.status,
      404,
      `expected HTTP 404 for the dead path; got ${res.status}. If this route now exists the #2240 analysis needs revisiting.`,
    );
  },
});
