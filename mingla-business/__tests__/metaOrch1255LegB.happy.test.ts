/**
 * META-ORCH-1255 Leg B — implementor HAPPY-PATH regression tests
 * (SPEC §7 T-B1 / T-B2 / T-B3 + the SC-9 per-venue to-do matrix + the SC-10
 * per-brand draft store). The tester owns the adversarial angles
 * (T-B4/T-B5-negative/T-B6/T-B7 + Maestro).
 *
 * FAILS-ON-REVERT (proven by TRUE LINE DELETION, see the implementation
 * report):
 *  - deleting the venue entry from ROOT_OPTIONS → T-B1 assertions FAIL;
 *  - deleting the venueCount arm from deriveHubVisibleTabs → T-B2 FAILS;
 *  - deleting the per-venue get_venue_live/venue_claim_review bands from
 *    buildBusinessTodos → SC-9 assertions FAIL;
 *  - deleting the activateBrand stash logic from draftVenueStore → SC-10
 *    isolation assertions FAIL.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 */
import { describe, expect, jest, test } from "@jest/globals";

// ---- node-env neutralizers (default ts-jest config has no RN runtime) ----
jest.mock("react-native", () => ({
  __esModule: true,
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Pressable: () => null,
  Text: () => null,
  View: () => null,
}));
jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("../src/components/ui/TopSheet", () => ({
  __esModule: true,
  TopSheet: () => null,
  default: () => null,
}));
jest.mock("../src/components/ui/Icon", () => ({
  __esModule: true,
  Icon: () => null,
  default: () => null,
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("../src/hooks/useBrandOfferingCounts", () => ({
  __esModule: true,
  useBrandOfferingCounts: () => ({ data: undefined, isLoading: false }),
}));

// Import AFTER the mocks.
/* eslint-disable import/first */
import { ROOT_OPTIONS } from "../src/components/ui/UniversalCreatorSheet";
import { deriveHubVisibleTabs } from "../src/hooks/useHubTabs";
import { listingStatusView } from "../src/utils/listingStatus";
import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../src/utils/businessTodos";
import {
  draftVenueForBrand,
  useDraftVenueStore,
} from "../src/store/draftVenueStore";
/* eslint-enable import/first */

// ---------------------------------------------------------------------------
// T-B1 — the creator sheet's ROOT options carry the 4th venue row.
// ---------------------------------------------------------------------------
describe("T-B1 — UniversalCreatorSheet 4th root option (venue)", () => {
  test("exactly 4 root rows, venue LAST, routing to /venue/create", () => {
    expect(ROOT_OPTIONS).toHaveLength(4);
    const venue = ROOT_OPTIONS[ROOT_OPTIONS.length - 1];
    expect(venue.key).toBe("venue");
    expect(venue.iconName).toBe("location");
    expect(venue.title).toBe("Create venue listing");
    expect(venue.subtitle).toBe(
      "Your place on Mingla — discovered, recommended, bookable.",
    );
    // close+push path — a real route, never an in-place step (no dead tap).
    expect(venue.route).toBe("/venue/create");
    expect(venue.step).toBeUndefined();
    expect(venue.testID).toBe("universal-creator-venue");
  });

  test("the 3 sibling rows are untouched (event/experience/trip order)", () => {
    expect(ROOT_OPTIONS.map((o) => o.key)).toEqual([
      "event",
      "experience",
      "trip",
      "venue",
    ]);
  });
});

// ---------------------------------------------------------------------------
// T-B2 — the hub venue tab gate is venueCount > 0 (any state).
// ---------------------------------------------------------------------------
describe("T-B2 — hub venue tab gate (venueCount)", () => {
  const counts = { events: 1, trips: 0, experiences: 0 };
  test("venueCount 1 → venue tab present (appended last)", () => {
    const out = deriveHubVisibleTabs(counts, { venueCount: 1 });
    expect(out).toContain("venue");
    expect(out[out.length - 1]).toBe("venue");
  });
  test("venueCount 0 → venue tab absent", () => {
    expect(deriveHubVisibleTabs(counts, { venueCount: 0 })).not.toContain(
      "venue",
    );
  });
});

// ---------------------------------------------------------------------------
// T-B3 — card status mapping: pending_review → "In review".
// ---------------------------------------------------------------------------
describe("T-B3 — venue card status mapping", () => {
  test("pending_review claim shows the 'In review' chip label", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "deck_eligible",
      claimStatus: "pending_review",
    });
    expect(v.label).toBe("In review");
    expect(v.tone).toBe("info");
  });
  test("verified claim shows Live on Mingla", () => {
    expect(
      listingStatusView({
        hasVenue: true,
        status: "deck_eligible",
        claimStatus: "verified",
      }).label,
    ).toBe("Live on Mingla");
  });
});

// ---------------------------------------------------------------------------
// SC-9 — per-venue to-do rows (venue A processing, venue B claim pending).
// ---------------------------------------------------------------------------
describe("SC-9 — per-venue to-do rows", () => {
  const base: BusinessTodoInput = {
    hasNoBrands: false,
    hasBrandsButNoSelection: false,
    brandResolving: false,
    hasBrand: true,
    pipelineFetched: true,
    pipelineStatus: null,
    pipelineRoute: "",
    venueDraftInProgress: false,
    counts: { total: 1, live: 1, draft: 0 },
    stripeActive: true,
    hasDraftPaidOffering: false,
    stripeRoute: "/brand/b1/payments",
    draftRoute: null,
    venueClaimPending: false,
    venueListingRoute: "/brand/b1/listing",
    venueClaimOpenFeedbackCount: 0,
    venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
  };

  test("venue A processing + venue B pending → exactly one row each, named", () => {
    const todos = buildBusinessTodos({
      ...base,
      venuePipelines: [
        { venueId: "va", venueName: "Lumen", status: "processing", route: "/venue/deck-readiness?brand_id=b1&venue_id=va" },
        { venueId: "vb", venueName: "Vine", status: "deck_eligible", route: "/venue/deck-readiness?brand_id=b1&venue_id=vb" },
      ],
      venueClaims: [
        {
          venueId: "vb",
          venueName: "Vine",
          variant: "pending_review",
          openCount: 0,
          route: "/brand/b1/listing?venue=vb",
          feedbackRoute: "/brand/b1/listing?venue=vb&focus=feedback",
        },
      ],
    });
    const ids = todos.map((t) => t.id);
    expect(ids.filter((i) => i.startsWith("get_venue_live"))).toEqual([
      "get_venue_live:va",
    ]);
    expect(ids.filter((i) => i.startsWith("venue_claim_review"))).toEqual([
      "venue_claim_review:vb",
    ]);
    const live = todos.find((t) => t.id === "get_venue_live:va");
    expect(live?.label).toBe("Get Lumen live");
    const claim = todos.find((t) => t.id === "venue_claim_review:vb");
    expect(claim?.action).toEqual({
      kind: "route",
      route: "/brand/b1/listing?venue=vb",
    });
  });

  test("0 venues + no draft → NO venue rows, NO add_venue nag", () => {
    const todos = buildBusinessTodos({
      ...base,
      venuePipelines: [],
      venueClaims: [],
    });
    const ids = todos.map((t) => t.id);
    expect(ids.some((i) => i.startsWith("get_venue_live"))).toBe(false);
    expect(ids.some((i) => i.startsWith("venue_claim_review"))).toBe(false);
    expect(ids).not.toContain("add_venue");
    expect(ids).not.toContain("finish_venue");
  });

  test("in-progress draft (current brand) → finish_venue survives", () => {
    const ids = buildBusinessTodos({
      ...base,
      venueDraftInProgress: true,
      venuePipelines: [],
      venueClaims: [],
    }).map((t) => t.id);
    expect(ids).toContain("finish_venue");
  });
});

// ---------------------------------------------------------------------------
// SC-10 — per-brand multi-draft store (v2).
// ---------------------------------------------------------------------------
describe("SC-10 — draftVenueStore per-brand isolation", () => {
  test("brand 1 draft survives a switch to brand 2 and back; reset(b) is scoped", () => {
    const store = useDraftVenueStore;
    store.getState().reset(); // clean slate

    store.getState().activateBrand("b1");
    store.getState().patch({ displayName: "Lumen Wine Bar", step: 2 });
    expect(store.getState().displayName).toBe("Lumen Wine Bar");

    // Switch to brand 2 → blank draft (no bleed).
    store.getState().activateBrand("b2");
    expect(store.getState().displayName).toBe("");
    expect(store.getState().step).toBe(0);
    store.getState().patch({ displayName: "Vine Hall" });

    // Back to brand 1 → resumes the exact draft.
    store.getState().activateBrand("b1");
    expect(store.getState().displayName).toBe("Lumen Wine Bar");
    expect(store.getState().step).toBe(2);

    // brand 2's parked draft readable without activation.
    expect(draftVenueForBrand(store.getState(), "b2").displayName).toBe(
      "Vine Hall",
    );

    // reset("b2") clears ONLY brand 2.
    store.getState().reset("b2");
    expect(draftVenueForBrand(store.getState(), "b2").displayName).toBe("");
    expect(store.getState().displayName).toBe("Lumen Wine Bar");

    // reset(activeBrand) blanks the active fields.
    store.getState().reset("b1");
    expect(store.getState().displayName).toBe("");
  });
});
