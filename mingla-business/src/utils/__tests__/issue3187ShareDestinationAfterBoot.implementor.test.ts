/**
 * #3187 P2-1 — `share_destination_action` survives the Host web app taking the
 * shared page over.
 *
 * THE RACE. The server document binds the destination event to its CTA, which
 * lives inside `#root`. The app's first commit replaces `#root`'s contents, so
 * after boot that CTA and its listener are gone and only the app's controls can
 * be tapped. These tests run the page's REAL emitted analytics script against a
 * fake DOM, model the takeover by detaching the server CTA, and then tap through
 * the REAL app bridge (`recordShareDestination`) — asserting the event still
 * reaches the REAL relay handler, exactly once per intent.
 *
 * Executed-page wiring for the event page lives beside the #2101 render harness
 * (`src/components/event/__tests__/PublicEventPage.issue2101.test.tsx`), which
 * invokes the page's own handlers.
 */
import { readFileSync } from "fs";
import path from "path";

import { afterEach, describe, expect, test } from "@jest/globals";

import {
  SHARE_DESTINATION_GLOBAL as APP_GLOBAL,
  recordShareDestination,
  type ShareDestinationAction,
} from "../../analytics/shareDestination";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const analytics = require("../../../server/publicSharePageAnalytics") as {
  SHARE_DESTINATION_ACTIONS: readonly string[];
  SHARE_DESTINATION_GLOBAL: string;
  SHARE_DESTINATION_LEDGER_KEY: string;
  shareAnalyticsScript: (input: { code: string; version: number; kind: string }) => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createContentShareAnalyticsHandler } = require("../../../api/content-share-analytics") as {
  createContentShareAnalyticsHandler: (send?: (url: string, init: { body: string }) => Promise<unknown>) =>
    (req: unknown, res: unknown) => Promise<unknown>;
};

const BUSINESS = path.resolve(__dirname, "../../..");
const read = (relative: string): string => readFileSync(path.join(BUSINESS, relative), "utf8");
const CODE = "Aa0Bb1Cc2Dd3Ee4F";
const GRANTED = JSON.stringify({ choice: "granted" });

/** Every action the app's controls report — must be a subset of the relay's. */
const APP_ACTIONS: ShareDestinationAction[] = [
  "buy_tickets", "rsvp", "book_trip", "book_experience", "view_brand", "view_venue",
  "view_offering", "directions", "website", "call",
];

type Posted = { url: string; body: Record<string, unknown>; keepalive: unknown };

/**
 * Runs the page's emitted script. `globalThis` stands in for `window`, so the
 * app bridge finds the recorder exactly as it does in a browser.
 */
function loadPage(options: { path: string; consent: string | null; session?: Map<string, string>; kind?: string }) {
  const html = analytics.shareAnalyticsScript({ code: CODE, version: 4, kind: options.kind ?? "event" });
  const js = html.replace(/^<script>/, "").replace(/<\/script>$/, "");
  const posted: Posted[] = [];
  const session = options.session ?? new Map<string, string>();
  const location = { pathname: options.path };
  let consent = options.consent;
  const clicks: Array<() => void> = [];
  const cta = { dataset: { shareDestination: "buy_tickets" }, addEventListener: (_: string, fn: () => void) => clicks.push(fn) };
  // eslint-disable-next-line no-new-func -- the page's own emitted script
  new Function("localStorage", "sessionStorage", "location", "window", "document", "fetch", js)(
    { getItem: () => consent },
    { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value); } },
    location,
    globalThis,
    { querySelectorAll: () => [cta] },
    (url: string, init: { body: string; keepalive: unknown }) => {
      posted.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive });
      return Promise.resolve();
    },
  );
  return {
    posted,
    session,
    location,
    /** A tap on the SERVER CTA — only possible before the app takes over. */
    tapServerCta: () => clicks.forEach((fn) => fn()),
    grantConsent: () => { consent = GRANTED; },
  };
}

const destinations = (posted: Posted[]) =>
  posted.filter((request) => request.body.event === "share_destination_action").map((request) => request.body.action);

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[APP_GLOBAL];
});

describe("#3187 P2-1 contract — one recorder, the relay's own actions", () => {
  test("the app and the page agree on the recorder's name", () => {
    expect(APP_GLOBAL).toBe(analytics.SHARE_DESTINATION_GLOBAL);
  });

  test("every action the page accepts is one the REAL relay accepts, and the app reports only those", async () => {
    const handler = createContentShareAnalyticsHandler(async () => ({}));
    const status = async (body: Record<string, unknown>): Promise<number> => {
      const res = { statusCode: 0, setHeader() {}, end() {} };
      await handler({ method: "POST", headers: { origin: "https://host.usemingla.com" }, body }, res);
      return res.statusCode;
    };
    for (const action of analytics.SHARE_DESTINATION_ACTIONS) {
      expect([action, await status({ event: "share_destination_action", code: CODE, version: 4, kind: "event", action })]).toEqual([action, 204]);
    }
    expect(await status({ event: "share_destination_action", code: CODE, version: 4, kind: "event", action: "steal" })).toBe(400);
    for (const action of APP_ACTIONS) expect(analytics.SHARE_DESTINATION_ACTIONS).toContain(action);
  });

  test("off a shared link (no recorder) the bridge is a silent no-op that never throws", () => {
    expect(recordShareDestination("buy_tickets")).toBe(false);
    Object.defineProperty(globalThis, APP_GLOBAL, { value: () => { throw new Error("foreign"); }, configurable: true });
    expect(recordShareDestination("buy_tickets")).toBe(false);
  });
});

describe("#3187 P2-1 the race — after takeover, the app's tap still records", () => {
  test("RACE-LOST: the server CTA is gone, the app's Get tickets records exactly one event the relay accepts", async () => {
    const page = loadPage({ path: "/e/acme/autumn-night", consent: GRANTED });
    // Takeover: the app replaced #root. The server CTA is never tapped — it no
    // longer exists. The recipient taps the APP's control.
    expect(recordShareDestination("buy_tickets")).toBe(true);
    expect(page.posted.map((request) => request.body)).toEqual([
      { event: "share_public_page_viewed", code: CODE, version: 4, kind: "event" },
      { event: "share_destination_action", code: CODE, version: 4, kind: "event", action: "buy_tickets" },
    ]);
    const forwarded: Array<Record<string, any>> = [];
    const previous = process.env.EXPO_PUBLIC_POSTHOG_KEY;
    process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test3187p21";
    try {
      const handler = createContentShareAnalyticsHandler(async (_url, init) => { forwarded.push(JSON.parse(init.body)); return {}; });
      const res = { statusCode: 0, setHeader() {}, end() {} };
      await handler({ method: "POST", headers: { origin: "https://host.usemingla.com" }, body: page.posted[1].body }, res);
      expect(res.statusCode).toBe(204);
      expect(forwarded[0]).toMatchObject({ event: "share_destination_action", properties: { short_code: CODE, version: 4, content_kind: "event", action: "buy_tickets" } });
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
      else process.env.EXPO_PUBLIC_POSTHOG_KEY = previous;
    }
    expect(page.posted[1].url).toBe("/api/content-share-analytics");
    expect(page.posted[1].keepalive).toBe(true);
  });

  test("the recorder carries the page's kind — the app never supplies it", () => {
    const page = loadPage({ path: "/e/acme/drinks", consent: GRANTED, kind: "rsvp_event" });
    recordShareDestination("rsvp");
    expect(page.posted[1].body).toEqual({ event: "share_destination_action", code: CODE, version: 4, kind: "rsvp_event", action: "rsvp" });
  });
});

describe("#3187 P2-1 de-duplication — one intent, one event", () => {
  test("a server CTA tap before boot, then the same action in the app, is ONE event", () => {
    const page = loadPage({ path: "/e/acme/autumn-night", consent: GRANTED });
    page.tapServerCta();
    expect(recordShareDestination("buy_tickets")).toBe(false);
    expect(destinations(page.posted)).toEqual(["buy_tickets"]);
  });

  test("repeated app taps on one action are one event; a different action is its own", () => {
    const page = loadPage({ path: "/e/acme/autumn-night", consent: GRANTED });
    expect(recordShareDestination("buy_tickets")).toBe(true);
    expect(recordShareDestination("buy_tickets")).toBe(false);
    expect(recordShareDestination("directions")).toBe(true);
    expect(destinations(page.posted)).toEqual(["buy_tickets", "directions"]);
  });

  test("the ledger survives a reload in the same tab (sessionStorage), and is per share", () => {
    const first = loadPage({ path: "/e/acme/autumn-night", consent: GRANTED });
    recordShareDestination("buy_tickets");
    delete (globalThis as Record<string, unknown>)[APP_GLOBAL];
    const reloaded = loadPage({ path: "/e/acme/autumn-night", consent: GRANTED, session: first.session });
    expect(recordShareDestination("buy_tickets")).toBe(false);
    expect(destinations(reloaded.posted)).toEqual([]);
    expect(JSON.parse(first.session.get(analytics.SHARE_DESTINATION_LEDGER_KEY) ?? "[]")).toEqual([`${CODE}.4:buy_tickets`]);
  });

  test("without consent nothing is sent AND nothing is marked, so the tap after granting still counts", () => {
    const page = loadPage({ path: "/e/acme/autumn-night", consent: null });
    expect(recordShareDestination("buy_tickets")).toBe(false);
    expect(page.posted).toEqual([]);
    page.grantConsent();
    expect(recordShareDestination("buy_tickets")).toBe(true);
    expect(destinations(page.posted)).toEqual(["buy_tickets"]);
  });

  test("after the app navigates to another page, taps there are not this share's", () => {
    const page = loadPage({ path: "/b/acme/", consent: GRANTED, kind: "brand" });
    expect(recordShareDestination("view_offering")).toBe(true);
    page.location.pathname = "/e/acme/autumn-night";
    expect(recordShareDestination("buy_tickets")).toBe(false);
    page.location.pathname = "/b/acme";
    expect(recordShareDestination("website")).toBe(true);
    expect(destinations(page.posted)).toEqual(["view_offering", "website"]);
  });
});

/**
 * The four pages without a render harness: each destination handler records its
 * action BEFORE it navigates or opens (a tap that throws on navigation must not
 * lose the event), inside that handler's own body.
 */
describe("#3187 P2-1 wiring — every in-scope control on every shared public page", () => {
  const body = (source: string, start: string, end: string): string => {
    const from = source.indexOf(start);
    expect([start, from]).not.toEqual([start, -1]);
    const to = source.indexOf(end, from + start.length);
    expect([end, to]).not.toEqual([end, -1]);
    return source.slice(from, to);
  };
  const recordsBefore = (handler: string, action: ShareDestinationAction, effect: RegExp): void => {
    const recordAt = handler.indexOf(`recordShareDestination("${action}")`);
    const effectAt = handler.search(effect);
    expect([action, recordAt]).not.toEqual([action, -1]);
    expect([action, effectAt]).not.toEqual([action, -1]);
    expect([action, recordAt < effectAt]).toEqual([action, true]);
  };

  test("brand page: offerings → view_offering, venues → view_venue, website → website, phone → call", () => {
    const src = read("src/components/brand/PublicBrandPage.tsx");
    expect(src).toContain('import { recordShareDestination } from "../../analytics/shareDestination"');
    for (const [start, end] of [
      ["const handleOpenEvent = useCallback(", "const handleOpenTrip"],
      ["const handleOpenTrip = useCallback(", "const handleOpenExperience"],
      ["const handleOpenExperience = useCallback(", "const handleOpenVenue"],
      ["const handleOpenUpcoming = useCallback(", "[router],"],
    ]) recordsBefore(body(src, start, end), "view_offering", /router\.push\(/);
    recordsBefore(body(src, "const handleOpenVenue = useCallback(", "const handleOpenUpcoming"), "view_venue", /router\.push\(/);
    const external = body(src, "const handleOpenExternal = useCallback(", "[websiteUrl],");
    recordsBefore(external, "call", /Linking\.openURL\(/);
    recordsBefore(external, "website", /Linking\.openURL\(/);
    expect(external).toMatch(/url\.startsWith\("tel:"\)\) recordShareDestination\("call"\)/);
    expect(external).toMatch(/url === websiteUrl\) recordShareDestination\("website"\)/);
    expect(src).toContain("onOpenExternal: handleOpenExternal,");
  });

  test("venue page: directions and the brand link", () => {
    const src = read("app/b/[brandSlug]/v/[venueSlug].tsx");
    recordsBefore(body(src, "const handleOpenMaps = useCallback(", "const handleCopyAddress"), "directions", /openMapsTarget\(target/);
    recordsBefore(body(src, "const handleOpenBrand = useCallback(", "const handleClose"), "view_brand", /router\.push\(/);
  });

  test("trip page: Reserve (checkout and the sign-in that resumes it) and the brand link", () => {
    const src = read("app/t/[brandSlug]/[tripSlug].tsx");
    const reserve = body(src, "const handleTripReserve = useCallback(", "    [\n");
    expect(reserve.match(/recordShareDestination\("book_trip"\)/g)).toHaveLength(2);
    recordsBefore(body(reserve, "if (tripAccess.requiresSignIn) {", "return;"), "book_trip", /router\.push\(/);
    recordsBefore(body(reserve, "if (tripAccess.blocked) return;", "} as never"), "book_trip", /router\.push\(/);
    recordsBefore(body(src, "const handleViewBrand = useCallback(", "}, [router, brandSlug]);"), "view_brand", /router\.push\(/);
  });

  test("experience page: Reserve (both entry paths into checkout) and the brand link", () => {
    const src = read("app/exp/[brandSlug]/[experienceSlug].tsx");
    const goToCart = body(src, "const goToCart = useCallback(", "const handleReserve");
    expect(goToCart.match(/recordShareDestination\("book_experience"\)/g)).toHaveLength(2);
    recordsBefore(body(goToCart, "if (experienceAccess.blocked) return;", "} as never"), "book_experience", /router\.push\(/);
    recordsBefore(body(src, "const handleReserve = useCallback(", "if (experienceAccess.blocked) return;"), "book_experience", /router\.push\(/);
    recordsBefore(body(src, "const handleViewBrand = (): void => {", "};"), "view_brand", /router\.push\(/);
  });

  test("event page: every navigation into the purchase path, RSVP, directions and the brand link", () => {
    const src = read("src/components/event/PublicEventPage.tsx");
    expect(src.match(/recordShareDestination\("buy_tickets"\)/g)).toHaveLength(6);
    expect(src.match(/recordShareDestination\("view_brand"\)/g)).toHaveLength(3);
    recordsBefore(body(src, "const openMapsForTarget = (", "};"), "directions", /openMapsTarget\(target/);
    const rsvp = body(src, "const rsvpSubmit = useCallback(", "submitPublicRsvp({");
    expect(rsvp).toContain('if (input.rsvpStatus !== "not_going") recordShareDestination("rsvp");');
  });
});
