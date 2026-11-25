/**
 * #4490 W5 fix 2 (W5-D1) — the deck card's expand / save / dismiss analytics.
 *
 * The device pass found every Details tap, card tap and right-swipe save
 * throwing a ReferenceError from the W5 analytics block (a helper used but
 * never imported). No test caught it: the only pin was a source-text check,
 * and no test ever RAN the handlers' analytics. SwipeableCards itself cannot be
 * mounted in a test (native-only gesture / animation / payment chains; see
 * orch1065_experience_adversarial), so the handlers' analytics now live in
 * deckCard/deckCardAnalytics.ts and this suite RUNS them:
 *
 *   E-*  expand: an ordinary place (Mixpanel + PostHog) and a claimed venue
 *        (PostHog, destination venue_page), solo and shared-deck positions;
 *   S-*  save (right) and dismiss (left) for a claimed venue and a place,
 *        top card (solo) and a card swiped off a shared deck's queue (null);
 *   V-1  card_viewed carries venue_id;
 *   G-*  the guard: a throwing analytics client or a throwing property builder
 *        never escapes, it is logged, and the call returns;
 *   H-*  the handlers in SwipeableCards reach the save / the sheet / the
 *        venue page only through the guarded calls (no raw analytics call
 *        before the user's action).
 *
 * The undeclared-name class itself is pinned by
 * components/__tests__/issue_4490_w5_no_undeclared_names.implementor.test.cjs.
 *
 * FAILS-ON-REVERT: remove the try/catch in runDeckAnalytics and G-1..G-3 fail;
 * put a raw `postHogService.capture("card_saved"` back into handleSwipe and H-1
 * fails; call `captureVenueTappedToBook(` unguarded in handleCardExpand and H-2
 * fails.
 */
declare const jest: {
  mock(path: string, factory: () => unknown): void;
  fn<T extends (...args: never[]) => unknown>(impl?: T): T & { mock: { calls: unknown[][] } };
};
declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, body: () => void) => void;
declare const beforeEach: (body: () => void) => void;
declare const afterEach: (body: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual(v: unknown): void;
  toBe(v: unknown): void;
  toContain(v: unknown): void;
  toMatch(v: RegExp): void;
  not: { toMatch(v: RegExp): void; toThrow(): void; toContain(v: unknown): void };
  toBeGreaterThan(v: number): void;
};
import fs from "node:fs";
import path from "node:path";

type Call = { sink: string; event: string; props: Record<string, unknown> };
const mockCalls: Call[] = [];
const mockFail: { sink: string | null } = { sink: null };
const mockRecord = (sink: string, event: string, props: Record<string, unknown>): void => {
  if (mockFail.sink === sink) throw new TypeError(`${sink} exploded`);
  mockCalls.push({ sink, event, props });
};

jest.mock("../../../services/postHogService", () => ({
  postHogService: {
    capture: (event: string, props: Record<string, unknown>) => mockRecord("posthog", event, props),
  },
}));
jest.mock("../../../services/mixpanelService", () => ({
  mixpanelService: {
    trackCardViewed: (props: Record<string, unknown>) => mockRecord("mixpanel", "card_viewed", props),
    trackCardExpanded: (props: Record<string, unknown>) => mockRecord("mixpanel", "card_expanded", props),
    trackCardSaved: (props: Record<string, unknown>) => mockRecord("mixpanel", "card_saved", props),
    trackCardDismissed: (props: Record<string, unknown>) => mockRecord("mixpanel", "card_dismissed", props),
  },
}));
jest.mock("../../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: (event: string, props: Record<string, unknown>) => mockRecord("appsflyer", event, props),
}));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

import {
  runDeckAnalytics,
  trackDeckCardContentView,
  trackDeckCardExpanded,
  trackDeckCardSwiped,
  trackDeckCardViewed,
} from "../deckCardAnalytics";

const place = { id: "place-1", title: "Corner Cafe", category: "drinks_and_music" };
const hostedCard = { id: "card-v1", title: "Studio Nine", category: "drinks_and_music", deckLead: "hosted_venue" as const };
const claimed = { venueId: "venue-1", isBookable: true };

const events = (sink: string): Array<[string, Record<string, unknown>]> =>
  mockCalls.filter((c) => c.sink === sink).map((c) => [c.event, c.props]);

let warnings: unknown[][] = [];
const realWarn = console.warn;
beforeEach(() => {
  mockCalls.length = 0;
  mockFail.sink = null;
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
});
afterEach(() => {
  console.warn = realWarn;
});

describe("#4490 W5-D1 deck card analytics run, and never break the action", () => {
  it("E-1 expand an ordinary place (solo): Mixpanel + PostHog, not hosted, no lead", () => {
    trackDeckCardExpanded({ card: place, claimedVenue: null, positionInDeck: 2 });
    expect(events("mixpanel")).toEqual([
      ["card_expanded", { cardId: "place-1", cardTitle: "Corner Cafe", category: "drinks_and_music", source: "home", positionInDeck: 2, isHostedVenue: false, deckLead: null }],
    ]);
    expect(events("posthog")).toEqual([
      ["card_expanded", { card_id: "place-1", card_title: "Corner Cafe", category: "drinks_and_music", source: "home", position_in_deck: 2, is_hosted_venue: false, deck_lead: null }],
    ]);
    expect(warnings).toEqual([]);
  });

  it("E-2 expand a claimed venue: PostHog only, destination venue_page, hosted, no venue_id", () => {
    trackDeckCardExpanded({ card: hostedCard, claimedVenue: claimed, positionInDeck: 0 });
    expect(events("mixpanel")).toEqual([]);
    expect(events("posthog")).toEqual([
      ["card_expanded", { card_id: "card-v1", card_title: "Studio Nine", category: "drinks_and_music", source: "home", destination: "venue_page", position_in_deck: 0, is_hosted_venue: true, deck_lead: "hosted_venue" }],
    ]);
  });

  it("E-3 the pool sheet's AppsFlyer content view", () => {
    trackDeckCardContentView({ ...place, estimatedCostPerPerson: 3500, rating: 4.5 });
    expect(events("appsflyer")).toEqual([
      ["af_content_view", { af_content_type: "drinks_and_music", af_content_id: "place-1", af_price: 3500, source: "home", rating: 4.5 }],
    ]);
  });

  it("S-1 right swipe on an ordinary place (solo top card): AppsFlyer, Mixpanel and PostHog card_saved", () => {
    trackDeckCardSwiped({ direction: "right", card: place, claimedVenue: null, positionInDeck: 1, isCurated: false });
    expect(mockCalls.map((c) => `${c.sink}:${c.event}`)).toEqual([
      "appsflyer:af_add_to_wishlist",
      "mixpanel:card_saved",
      "posthog:card_saved",
    ]);
    expect(events("posthog")[0][1]).toEqual({
      card_id: "place-1", card_title: "Corner Cafe", category: "drinks_and_music", is_curated: false, source: "swipe", position_in_deck: 1, is_hosted_venue: false, deck_lead: null,
    });
  });

  it("S-2 right swipe on a claimed venue off a shared deck's queue (not the top card): position null", () => {
    trackDeckCardSwiped({ direction: "right", card: hostedCard, claimedVenue: claimed, positionInDeck: null, isCurated: false });
    expect(events("mixpanel")[0][1]).toEqual({
      card_id: "card-v1", card_title: "Studio Nine", category: "drinks_and_music", is_curated: false, source: "swipe", position_in_deck: undefined, is_hosted_venue: true, deck_lead: "hosted_venue",
    });
    expect(events("posthog")[0]).toEqual([
      "card_saved",
      { card_id: "card-v1", card_title: "Studio Nine", category: "drinks_and_music", is_curated: false, source: "swipe", position_in_deck: null, is_hosted_venue: true, deck_lead: "hosted_venue" },
    ]);
  });

  it("S-3 left swipe (dismiss) on a claimed venue and on a place", () => {
    trackDeckCardSwiped({ direction: "left", card: hostedCard, claimedVenue: claimed, positionInDeck: 0, isCurated: false });
    trackDeckCardSwiped({ direction: "left", card: place, claimedVenue: null, positionInDeck: null, isCurated: true });
    expect(mockCalls.map((c) => `${c.sink}:${c.event}`)).toEqual([
      "appsflyer:card_dismissed", "mixpanel:card_dismissed", "posthog:card_dismissed",
      "appsflyer:card_dismissed", "mixpanel:card_dismissed", "posthog:card_dismissed",
    ]);
    expect(events("posthog")[0][1]).toEqual({ card_id: "card-v1", card_title: "Studio Nine", category: "drinks_and_music", is_curated: false, position_in_deck: 0, is_hosted_venue: true, deck_lead: "hosted_venue" });
    expect(events("posthog")[1][1]).toEqual({ card_id: "place-1", card_title: "Corner Cafe", category: "drinks_and_music", is_curated: true, position_in_deck: null, is_hosted_venue: false, deck_lead: null });
  });

  it("V-1 card_viewed carries venue_id for a claimed venue and null for a place", () => {
    trackDeckCardViewed({ card: hostedCard, claimedVenue: claimed, positionInDeck: 3, isCurated: false });
    trackDeckCardViewed({ card: place, claimedVenue: null, positionInDeck: 4, isCurated: false });
    expect(events("posthog").map(([, p]) => p.venue_id)).toEqual(["venue-1", null]);
    expect(events("mixpanel").map(([, p]) => p.is_hosted_venue)).toEqual([true, false]);
  });

  it("G-1 a throwing analytics client never escapes: logged, and the call returns", () => {
    for (const sink of ["appsflyer", "mixpanel", "posthog"]) {
      mockFail.sink = sink;
      expect(() => trackDeckCardSwiped({ direction: "right", card: hostedCard, claimedVenue: claimed, positionInDeck: 0, isCurated: false })).not.toThrow();
      expect(() => trackDeckCardSwiped({ direction: "left", card: place, claimedVenue: null, positionInDeck: 0, isCurated: false })).not.toThrow();
      expect(() => trackDeckCardExpanded({ card: place, claimedVenue: null, positionInDeck: 0 })).not.toThrow();
      expect(() => trackDeckCardExpanded({ card: hostedCard, claimedVenue: claimed, positionInDeck: 0 })).not.toThrow();
      expect(() => trackDeckCardViewed({ card: place, claimedVenue: null, positionInDeck: 0, isCurated: false })).not.toThrow();
      expect(() => trackDeckCardContentView(place)).not.toThrow();
    }
    expect(warnings.length).toBeGreaterThan(0);
    expect(String(warnings[0][0])).toContain("[SwipeableCards] analytics failed at");
  });

  it("G-2 a throwing property build (the W5-D1 ReferenceError) never escapes", () => {
    // Building the venue properties reads card.deckLead first; make that throw.
    const broken = Object.defineProperty({ ...place }, "deckLead", {
      get(): never {
        throw new ReferenceError("expandVenueProps is not defined");
      },
    }) as typeof place & { deckLead?: "hosted_venue" };
    expect(() => trackDeckCardSwiped({ direction: "right", card: broken, claimedVenue: claimed, positionInDeck: 0, isCurated: false })).not.toThrow();
    expect(() => trackDeckCardExpanded({ card: broken, claimedVenue: claimed, positionInDeck: 0 })).not.toThrow();
    expect(() => trackDeckCardViewed({ card: broken, claimedVenue: claimed, positionInDeck: 0, isCurated: false })).not.toThrow();
    expect(mockCalls).toEqual([]);
    expect(warnings.map((w) => String(w[0]))).toEqual([
      "[SwipeableCards] analytics failed at card_saved; the action continues",
      "[SwipeableCards] analytics failed at card_expanded; the action continues",
      "[SwipeableCards] analytics failed at card_viewed; the action continues",
    ]);
    expect(String(warnings[0][1])).toContain("ReferenceError");
  });

  it("G-3 runDeckAnalytics swallows and logs, and runs the step when it does not throw", () => {
    let ran = false;
    runDeckAnalytics("ok", () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(() =>
      runDeckAnalytics("venue_tapped_to_book", () => {
        throw new ReferenceError("x is not defined");
      }),
    ).not.toThrow();
    expect(String(warnings[0][0])).toBe("[SwipeableCards] analytics failed at venue_tapped_to_book; the action continues");
  });

  // ── the handlers reach the user's action only through the guarded calls ──
  const src = fs.readFileSync(path.resolve(__dirname, "../../SwipeableCards.tsx"), "utf8");
  const RAW_ANALYTICS = /mixpanelService\.|postHogService\.|logAppsFlyerEvent\(|deckCardVenueProps\(|expandVenueProps\(/;
  const between = (start: string, end: string): string => {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i);
    if (i < 0 || j < 0) throw new Error(`anchor gone: ${i < 0 ? start : end}`);
    return src.slice(i, j);
  };

  it("H-1 handleSwipe: one guarded analytics call, then the save (solo and shared deck)", () => {
    const beforeSave = between("const handleSwipe = async (", "savedCardsService.saveCard(user.id, card, \"solo\")");
    expect(beforeSave).not.toMatch(RAW_ANALYTICS);
    expect(beforeSave.split("trackDeckCardSwiped(").length - 1).toBe(1);
    // The shared deck's save and left-swipe record come after the same single call.
    const beforeCollab = between("const handleSwipe = async (", "await collabSaveCard({");
    expect(beforeCollab).not.toMatch(RAW_ANALYTICS);
    expect(beforeCollab.split("trackDeckCardSwiped(").length - 1).toBe(1);
  });

  it("H-2 handleCardExpand: venue page and sheet are reached through guarded analytics only", () => {
    const toVenuePage = between("const handleCardExpand = async () => {", "leaveDeckTo(");
    expect(toVenuePage).not.toMatch(RAW_ANALYTICS);
    expect(toVenuePage).toContain("trackDeckCardExpanded({");
    expect(toVenuePage).toMatch(/runDeckAnalytics\('venue_tapped_to_book', \(\) =>\s+captureVenueTappedToBook\(/);
    expect(toVenuePage.split("captureVenueTappedToBook(").length - 1).toBe(1);
    const toSheet = between("setIsReviewMode(false); // ORCH-1064: normal deck tap", "const handleCloseExpandedModal");
    expect(toSheet).not.toMatch(RAW_ANALYTICS);
    expect(toSheet).toContain("trackDeckCardExpanded({");
    expect(toSheet).toContain("trackDeckCardContentView({");
  });

  it("H-3 card_viewed goes through the guarded call", () => {
    const viewed = between("// Track card viewed when the current card changes", "enqueuePostSwipeWork(trackCardViewed)");
    expect(viewed).not.toMatch(RAW_ANALYTICS);
    expect(viewed).toContain("trackDeckCardViewed({");
  });
});
