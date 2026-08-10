/**
 * Issue #1735 T-G11 — the Insights nudge band in `buildBusinessTodos`.
 *
 * Fails-on-revert anchors: deleting the insightsNudges band turns the
 * presence assertions RED; moving it above the profile band turns the
 * LAST-band ordering assertion RED (the operator-locked priority order above
 * it is untouched — a nudge, never a setup blocker).
 */

import { buildBusinessTodos, type BusinessTodoInput } from "../businessTodos";

const baseInput = (): BusinessTodoInput => ({
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: null,
  pipelineRoute: "",
  venueDraftInProgress: false,
  venuePipelines: [],
  venueClaims: [],
  counts: { total: 1, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "",
});

describe("issue #1735 buildBusinessTodos insights nudges (T-G11)", () => {
  it("emits the site row with the exact label + deep-link route", () => {
    const todos = buildBusinessTodos({
      ...baseInput(),
      insightsNudges: [
        {
          venueId: "v1",
          venueName: "Bar Toto",
          kind: "site",
          route: "/venue/v1?module=insights",
        },
      ],
    });
    const row = todos.find((t) => t.id === "insights_site:v1");
    expect(row).toBeDefined();
    expect(row!.label).toBe("You haven't checked Bar Toto's website");
    expect(row!.action).toEqual({
      kind: "route",
      route: "/venue/v1?module=insights",
    });
  });

  it("emits the pricing row shape (the hook gates it on #1737 registration)", () => {
    const todos = buildBusinessTodos({
      ...baseInput(),
      insightsNudges: [
        {
          venueId: "v1",
          venueName: "Bar Toto",
          kind: "pricing",
          route: "/venue/v1?module=insights",
        },
      ],
    });
    const row = todos.find((t) => t.id === "insights_pricing:v1");
    expect(row).toBeDefined();
    expect(row!.label).toBe("You haven't checked Bar Toto's pricing");
  });

  it("vanishes when the caller stops emitting it (report exists ⇒ no nudge)", () => {
    const todos = buildBusinessTodos({ ...baseInput(), insightsNudges: [] });
    expect(todos.some((t) => t.id.startsWith("insights_"))).toBe(false);
    // Absent entirely (pre-1735 callers) behaves identically.
    const legacy = buildBusinessTodos(baseInput());
    expect(legacy.some((t) => t.id.startsWith("insights_"))).toBe(false);
  });

  it("is the LAST band — after the ORCH-1256 profile rows", () => {
    const todos = buildBusinessTodos({
      ...baseInput(),
      profile: {
        needsCover: true,
        needsPhoto: false,
        needsTagline: false,
        needsDescription: false,
        needsAddress: false,
        needsEmail: false,
        needsPhone: false,
        needsSocials: false,
        editRoute: "/brand/b1/edit",
      },
      insightsNudges: [
        {
          venueId: "v1",
          venueName: "Bar Toto",
          kind: "site",
          route: "/venue/v1?module=insights",
        },
      ],
    });
    const profileIdx = todos.findIndex((t) => t.id === "profile_add_cover");
    const nudgeIdx = todos.findIndex((t) => t.id === "insights_site:v1");
    expect(profileIdx).toBeGreaterThanOrEqual(0);
    expect(nudgeIdx).toBeGreaterThan(profileIdx);
    expect(todos[todos.length - 1]!.id).toBe("insights_site:v1");
  });

  it("does not disturb any band above it (operator-locked order untouched)", () => {
    const withNudges = buildBusinessTodos({
      ...baseInput(),
      stripeActive: false,
      insightsNudges: [
        {
          venueId: "v1",
          venueName: "Bar Toto",
          kind: "site",
          route: "/venue/v1?module=insights",
        },
      ],
    });
    const without = buildBusinessTodos({ ...baseInput(), stripeActive: false });
    expect(withNudges.slice(0, without.length).map((t) => t.id)).toEqual(
      without.map((t) => t.id),
    );
  });
});
