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
 *   T2  that resolver is FALSIFIABLE: a path the apex serves with NOTHING must
 *       come back UNRESOLVED from the same code path that passes the live one.
 *       Without this, a resolver that returned `true` for everything would make
 *       T1 a check that carries no information. (The control used to be the dead
 *       `/orders/{id}/chat` itself; #2272 now SERVES that path deliberately —
 *       delivered emails still carry it — so the control moved to an unserved
 *       path and a new T2 pins that #2272's landing is what answers it.)
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
 *
 * ─── #2272 EXTRACTED THE RESOLVER ───────────────────────────────────────────
 *
 * The route-table resolver that was defined inline here now lives in
 * `scripts/apex-route-model/apex-route-resolver.mjs`, unchanged in behaviour, so
 * #2240 and #2272 model the apex with ONE piece of code. Copying it would have
 * re-created exactly the drift it exists to prevent.
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
import {
  APEX_HOSTS,
  assertVercelRewritesDoNotTouchApex,
  buildApexRouteResolver,
} from "../../../../../scripts/apex-route-model/apex-route-resolver.mjs";

Deno.env.set("DENO_TESTING", "1");

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname;

/**
 * The path #2240 was filed for, from the real order in the issue.
 *
 * IT IS NO LONGER DEAD. Issue #2272 serves `/orders/*` (and `/chat/*`,
 * `/board/*`, `/invite/*`) with an honest "this opens in the Mingla app"
 * landing, because every confirmation email delivered before #2240 still
 * carries this URL and those cannot be recalled. So this constant now records
 * WHERE #2240 CAME FROM, and T2's falsifiability control moved to a path that
 * is genuinely served by nothing — see UNSERVED_PATH.
 */
const HISTORICAL_2240_PATH = "/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat";

/**
 * T2's control: a path with NO route, NO redirect and NO rewrite on the apex.
 * Deliberately shaped like the #2240 URL so the control still exercises the
 * multi-segment path it was written for. If this ever starts resolving, T1/T5
 * carry no information and this suite must be fixed, not the assertion.
 */
const UNSERVED_PATH = "/receipts/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat";

// ─── The resolver ───────────────────────────────────────────────────────────
// EXTRACTED to scripts/apex-route-model/apex-route-resolver.mjs by #2272 so
// that this suite and #2272's suites share ONE model of the apex instead of two
// that can disagree. Behaviour is unchanged: it is built from the routing layers
// as they exist on disk (mingla-marketing/app/**, next.config.ts redirects,
// middleware.ts, vercel.json), it tracks the app rather than a hand-maintained
// list, and every layer it cannot model is a LOUD failure — never a silent
// "resolved". Plain ESM over node:fs, so the identical file runs here under Deno
// and under `node --test` in #2272's lane.

const MODEL = buildApexRouteResolver(REPO_ROOT.replace(/\/$/, ""));
const ROUTES = MODEL.routes;
const REDIRECTS = MODEL.redirectSources;

const resolve = (pathname: string): { resolved: boolean; via: string } =>
  MODEL.resolve(pathname);

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

Deno.test("T2 the resolver returns UNRESOLVED for a path the apex serves with nothing", () => {
  const dead = resolve(UNSERVED_PATH);
  assert(
    !dead.resolved,
    `the resolver claims ${UNSERVED_PATH} resolves (via ${dead.via}). Nothing serves that path, so the resolver is broken and T1/T5 carry no information.`,
  );
});

Deno.test("T2 the #2240 path is now SERVED, and by the #2272 landing specifically", () => {
  // Not a formality. If /orders/* ever stops resolving, every confirmation
  // email already sitting in a buyer's inbox goes back to being a 404 (#2272),
  // and this suite is the one place that reads the real route table.
  const r = resolve(HISTORICAL_2240_PATH);
  assert(
    r.resolved,
    `${HISTORICAL_2240_PATH} no longer resolves (${r.via}). #2272 served it precisely because delivered emails still carry it and cannot be recalled.`,
  );
  assertStringIncludes(
    r.via,
    "mingla-marketing/app/orders/",
    `expected the #2272 landing to be what serves it; got "${r.via}"`,
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
  assert(
    assertVercelRewritesDoNotTouchApex(REPO_ROOT.replace(/\/$/, "")) >= 1,
    "no vercel.json rewrites parsed — the guard read nothing",
  );
  // Paths that are NOT served must come back unresolved, or the walk is matching everything.
  for (
    const nonsense of [
      "/definitely-not-a-route",
      "/receipts",
      "/download/extra/segments",
    ]
  ) {
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

// The negative control for T6: SOMETHING must still 404 in production, or a
// green T6 is just the apex answering 200 to everything.
//
// This used to probe the #2240 path itself. #2272 serves that path on purpose
// (delivered emails still carry it), so the control moved to a path nothing
// serves. Keeping the old assertion would have made this lane go red the moment
// #2272 deployed — for the correct behaviour.
Deno.test({
  name: "T6 LIVE a genuinely unserved path is really a 404 in production",
  ignore: !LIVE,
  fn: async () => {
    const res = await fetch(`https://usemingla.com${UNSERVED_PATH}`, { redirect: "manual" });
    await res.body?.cancel();
    assertEquals(
      res.status,
      404,
      `expected HTTP 404 for an unserved path; got ${res.status}. If the apex now answers 200 to anything, T6 carries no information.`,
    );
  },
});
