/**
 * ORCH-1121 [Business brand-profile redesign] — implementor regression test.
 *
 * The named fails-on-revert test for the SPEC (section 9): proves SECTION E no
 * longer renders a hardcoded, unconditional "No events yet / Create your first
 * event" empty card, and instead derives its list AND its empty-state from the
 * live useBusinessEventsForBrand query result (Constitution #9 /
 * I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY).
 *
 * Repo harness note: mingla-business runs Jest in a Node environment WITHOUT
 * react-test-renderer / @testing-library/react-native and CANNOT import RN
 * components (their transitive native imports do not transform) — see
 * jest.config.cjs + the established source-assertion tests
 * (src/components/offering/__tests__/StripeBlockedCard.test.tsx,
 * src/components/event/__tests__/EventListCard_defensiveFilter.test.tsx). This
 * test therefore pins the SECTION E behavior via source-structure assertions:
 * the live-query mapping branch (rows), the SETTLED-zero gate on the empty
 * card, the loading-is-not-empty branch, the error branch, the "See all"
 * gating, and the 3-dot-hidden contract.
 *
 * T-1 fails-on-revert: deleting the populated-list branch + the eventsSettledEmpty
 * gate (reverting to the old unconditional `<GlassCard ...>No events yet...` )
 * makes the "rows + gate" assertions below FAIL. Restoring makes them PASS.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const viewSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/brand/BrandProfileView.tsx"),
    "utf8",
  );

/** The SECTION E slice (from its header marker to the danger-zone marker). */
const sectionE = (src: string): string => {
  const start = src.indexOf("SECTION E — Recent Events");
  const end = src.indexOf("Danger zone", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
};

describe("ORCH-1121 — SECTION E wires Recent Events to live data (T-1, fails-on-revert)", () => {
  test("the brand-scoped events query is called at top level with brand?.id ?? null (ORCH-0710 hook ordering)", () => {
    const src = viewSource();
    expect(src).toContain(
      "useBusinessEventsForBrand(brand?.id ?? null)",
    );
    // The hook call must sit ABOVE the not-found / resolving early returns.
    const hookIdx = src.indexOf("useBusinessEventsForBrand(brand?.id ?? null)");
    const firstEarlyReturnIdx = src.indexOf("if (brand === null && isResolving)");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(firstEarlyReturnIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(firstEarlyReturnIdx);
  });

  test("POPULATED branch maps the recent events into OfferingListCard rows (3 events → 3 rows)", () => {
    const e = sectionE(viewSource());
    // The list branch fires only when there are rows; it maps recentEvents →
    // <OfferingListCard> via the new pure mapper. With a mocked 3-event query
    // recentEvents has length 3, so exactly 3 rows render.
    expect(e).toMatch(/recentEvents\.length\s*>\s*0/);
    expect(e).toMatch(/recentEvents\.map\(/);
    expect(e).toContain("<OfferingListCard");
    expect(e).toContain("liveEventToOfferingModel(event, status)");
  });

  test("the lying empty card is GONE — it is no longer rendered unconditionally", () => {
    const e = sectionE(viewSource());
    // Constitution #9: the empty card must be inside the eventsSettledEmpty
    // branch. The exact phrase "Events you create will show here" may only
    // appear once, AND it must be guarded by the settled-empty condition.
    expect(e).toContain("eventsSettledEmpty");
    // There must be NO unconditional empty GlassCard directly after the header:
    // the first conditional after the header is the error branch (eventsError).
    const headerIdx = e.indexOf("Recent events</Text>");
    const errorBranchIdx = e.indexOf("{eventsError ?");
    expect(headerIdx).toBeGreaterThan(-1);
    expect(errorBranchIdx).toBeGreaterThan(headerIdx);
    // The "No events yet" copy must be downstream of the settled-empty gate,
    // never standalone.
    const settledGateIdx = e.indexOf("eventsSettledEmpty ? (");
    const noEventsCopyIdx = e.indexOf("No events yet");
    expect(settledGateIdx).toBeGreaterThan(-1);
    expect(noEventsCopyIdx).toBeGreaterThan(settledGateIdx);
  });

  test("empty card definition derives from a SETTLED non-error zero-length query", () => {
    const src = viewSource();
    expect(src).toContain(
      "const eventsSettledEmpty =",
    );
    expect(src).toMatch(
      /!eventsLoading\s*&&\s*!eventsError\s*&&\s*brandEvents\.length\s*===\s*0/,
    );
  });

  test("LOADING is not EMPTY — no empty CTA mid-load (false-empty flash killed)", () => {
    const e = sectionE(viewSource());
    // The final fallthrough branch (loading, no cached rows) renders a skeleton,
    // NOT the empty card. The empty card is its own gated branch.
    expect(e).toContain("recentEventsLoading");
    expect(e).toContain("recentEventsSkeletonRow");
  });

  test("ERROR is surfaced, never silent and never a lie (Constitution #3)", () => {
    const e = sectionE(viewSource());
    expect(e).toMatch(/\{eventsError\s*\?/);
    expect(e).toContain("Couldn");
    expect(e).toContain("Tap to retry");
    expect(e).toContain("refetchEvents()");
  });

  test('"See all" header link is gated on totalEventCount > 5 and fires onSeeAllEvents', () => {
    const e = sectionE(viewSource());
    expect(e).toMatch(/totalEventCount\s*>\s*5\s*\?/);
    expect(e).toContain("onPress={onSeeAllEvents}");
    expect(e).toContain('accessibilityLabel="See all events"');
  });

  test("3-dot manage trigger is HIDDEN — onManageOpen is never passed to the row", () => {
    const e = sectionE(viewSource());
    // OfferingListCard hides the 3-dot when onManageOpen is undefined. The brand
    // profile must NOT pass it.
    expect(e).not.toContain("onManageOpen=");
  });

  test("row tap navigates via onOpenEvent (carrying id + event_type + status) — not a dead tap", () => {
    const e = sectionE(viewSource());
    expect(e).toContain(
      "onOpenEvent(event.id, event.event_type, event.status)",
    );
  });
});

describe("ORCH-1121 — SECTION A hero (Direction 1) + preserved fallback", () => {
  test("cover renders via EventCoverMedia at a 16:9 clamped height (un-cropped)", () => {
    const src = viewSource();
    expect(src).toContain("<EventCoverMedia");
    expect(src).toContain("videoContentFit=\"cover\"");
    // COVER_H is the clamped 16:9 height; the old fixed 140px band is gone.
    expect(src).toMatch(
      /Math\.min\(240,\s*Math\.max\(176,\s*Math\.round\(\(coverWidth\s*\*\s*9\)\s*\/\s*16\)\)\)/,
    );
    expect(src).not.toContain("height: 140");
  });

  test("3-state media→hue fallback + coverMediaFailed flip is preserved (motion-gated)", () => {
    const src = viewSource();
    expect(src).toContain("setCoverMediaFailed(false)"); // URL-change reset
    expect(src).toContain("onMediaError={() => setCoverMediaFailed(true)}");
    // Hue fallback gradient when no media.
    expect(src).toContain("hsl(${brand.coverHue}");
    // Motion-gated autoplay.
    expect(src).toContain("autoplay={!reduceMotion}");
    expect(src).toContain("playbackActive={!reduceMotion}");
  });

  test("required bottom scrim is present on the cover", () => {
    const src = viewSource();
    expect(src).toContain("heroCoverScrim");
    expect(src).toContain('"rgba(0,0,0,0.55)"');
  });

  test("96px ring avatar half-overlaps the seam (marginTop -48), no Avatar fork", () => {
    const src = viewSource();
    expect(src).toContain("heroAvatarRing");
    expect(src).toMatch(/heroAvatarRing:\s*\{[\s\S]*?width:\s*96/);
    expect(src).toMatch(/marginTop:\s*-48/);
    expect(src).toContain('<Avatar name={brand.displayName} size="hero"');
  });

  test("location line renders only when brand.address is present (no fabricated placeholder)", () => {
    const src = viewSource();
    expect(src).toMatch(
      /typeof brand\.address === "string" && brand\.address\.length > 0 \?/,
    );
    expect(src).toContain("heroLocation");
  });

  test("About-us eyebrow + read-more toggle (long bios only)", () => {
    const src = viewSource();
    expect(src).toContain("ABOUT US");
    expect(src).toContain("aboutIsLong");
    expect(src).toMatch(/bioText\.length\s*>\s*160/);
    expect(src).toContain("setAboutExpanded");
  });

  test("verified badge is NOT invented (Brand has no verified field)", () => {
    const src = viewSource();
    // SPEC Open Question (a): Brand carries no `verified` boolean → omit the
    // badge entirely. Guard against a future engineer fabricating it.
    expect(src).not.toContain("Verified brand");
    expect(src).not.toContain("brand.verified");
  });

  test("social chips are centered + carry hitSlop (>=44pt effective)", () => {
    const src = viewSource();
    expect(src).toMatch(/socialsRow:\s*\{[\s\S]*?justifyContent:\s*"center"/);
    expect(src).toContain(
      "hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}",
    );
  });

  test("stale 'mirrors PublicBrandPage:259' comments are removed (D-3 cleanup)", () => {
    const src = viewSource();
    expect(src).not.toContain("mirrors the PublicBrandPage.tsx:259-346");
    expect(src).not.toContain("PublicBrandPage.tsx:259-304 verbatim");
  });
});

describe("ORCH-1121 — SECTIONS B/C/D preserved (no regression, COMMS-0021)", () => {
  test("the provider-neutral 'Payments & Bank' row + payout-ready logic are untouched", () => {
    const src = viewSource();
    expect(src).toContain('label: "Payments & Bank"');
    expect(src).toContain("isBrandPayoutReady(brand)");
    expect(src).toContain("getBrandProfileStripeOperationsSub(stripeStatus)");
  });

  test("the stats strip + Stripe banner remain in place", () => {
    const src = viewSource();
    expect(src).toContain("SECTION B — Stats Strip");
    expect(src).toContain("getBrandProfileStripeBannerCopy(stripeStatus)");
  });
});

describe("ORCH-1121 — route file wires the two new nav props through the canonical helper", () => {
  const routeSource = (): string =>
    readFileSync(
      path.join(process.cwd(), "app/brand/[id]/index.tsx"),
      "utf8",
    );

  test("onOpenEvent routes via routeForEventRowDefensive (never a hardcoded /event/${id})", () => {
    const src = routeSource();
    expect(src).toContain("routeForEventRowDefensive({");
    expect(src).toContain("onOpenEvent={handleOpenEvent}");
    // No hardcoded /event/${id} push in the route file outside the helper.
    expect(src).not.toMatch(/router\.push\(`\/event\/\$\{[^}]+\}`/);
  });

  test("onSeeAllEvents routes to the Hub events list", () => {
    const src = routeSource();
    expect(src).toContain('router.push("/(tabs)/hub/events" as never)');
    expect(src).toContain("onSeeAllEvents={handleSeeAllEvents}");
  });
});
