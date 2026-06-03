/**
 * ORCH-1038 — buildBusinessTodos priority/condition matrix.
 *
 * Pure-function coverage: each row appears only when its condition is unmet,
 * the list is ordered by priority, and satisfied conditions drop their rows
 * (the "vanish when done" contract).
 */
import { describe, expect, test } from "@jest/globals";

import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../businessTodos";

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible", // healthy venue by default
  pipelineRoute: "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 3, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  // META-ORCH-1059 — venue-claim to-do row inputs (default: no pending claim).
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
};

const ids = (input: BusinessTodoInput): string[] =>
  buildBusinessTodos(input).map((t) => t.id);

describe("buildBusinessTodos — brand gate", () => {
  test("no brands → single create_brand opening the switcher", () => {
    const todos = buildBusinessTodos({ ...base, hasNoBrands: true });
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      id: "create_brand",
      action: { kind: "open_brand_switcher" },
    });
  });

  test("brands but none selected → single select_brand opening the switcher", () => {
    const todos = buildBusinessTodos({
      ...base,
      hasBrandsButNoSelection: true,
    });
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      id: "select_brand",
      action: { kind: "open_brand_switcher" },
    });
  });

  test("brand still resolving → empty (no flash)", () => {
    expect(buildBusinessTodos({ ...base, brandResolving: true })).toEqual([]);
  });

  test("no brand at all (not resolving) → empty", () => {
    expect(buildBusinessTodos({ ...base, hasBrand: false })).toEqual([]);
  });

  test("brand gate short-circuits everything else", () => {
    // even with venue/offering work pending, no-brands shows ONLY create_brand
    const todos = buildBusinessTodos({
      ...base,
      hasNoBrands: true,
      pipelineStatus: null,
      counts: { total: 0, live: 0, draft: 0 },
    });
    expect(ids({ ...base, hasNoBrands: true, pipelineStatus: null })).toEqual([
      "create_brand",
    ]);
    expect(todos).toHaveLength(1);
  });
});

describe("buildBusinessTodos — venue", () => {
  test("no venue + no draft → add_venue → /venue/create", () => {
    const todos = buildBusinessTodos({
      ...base,
      pipelineStatus: null,
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(todos[0]).toMatchObject({
      id: "add_venue",
      action: { kind: "route", route: "/venue/create" },
    });
  });

  test("ORCH-1040: no physical location → NO add_venue/finish_venue", () => {
    const noPhysical = ids({
      ...base,
      hasPhysicalLocation: false,
      pipelineStatus: null,
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(noPhysical).not.toContain("add_venue");
    expect(noPhysical).not.toContain("finish_venue");
    // a draft-in-progress is also suppressed when the brand isn't physical
    const noPhysicalDraft = ids({
      ...base,
      hasPhysicalLocation: false,
      venueDraftInProgress: true,
      pipelineStatus: null,
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(noPhysicalDraft).not.toContain("finish_venue");
  });

  test("ORCH-1040: get_venue_live shows even without the flag (venue already exists)", () => {
    const v = ids({
      ...base,
      hasPhysicalLocation: false,
      pipelineStatus: "needs_fix",
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(v).toContain("get_venue_live");
  });

  test("no venue + draft-in-progress → finish_venue", () => {
    const todos = buildBusinessTodos({
      ...base,
      pipelineStatus: null,
      venueDraftInProgress: true,
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(todos[0]).toMatchObject({
      id: "finish_venue",
      action: { kind: "route", route: "/venue/create" },
    });
  });

  test("pipeline not fetched yet → no venue row (avoid flash)", () => {
    const todos = buildBusinessTodos({
      ...base,
      pipelineFetched: false,
      pipelineStatus: null,
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(ids({ ...base, pipelineFetched: false, pipelineStatus: null, counts: { total: 1, live: 1, draft: 0 } })).not.toContain("add_venue");
    expect(todos).toEqual([]);
  });

  const venueStatusCases: Array<[BusinessTodoInput["pipelineStatus"], string]> = [
    ["processing", "We're reviewing your details"],
    ["needs_fix", "A few things need fixing"],
    ["failed", "Something went wrong — tap to retry"],
  ];
  test.each(venueStatusCases)(
    "venue status %s → get_venue_live via pipelineRoute",
    (status, sub) => {
    const todos = buildBusinessTodos({
      ...base,
      pipelineStatus: status,
      counts: { total: 1, live: 1, draft: 0 },
    });
    expect(todos[0]).toMatchObject({
      id: "get_venue_live",
      sublabel: sub,
      action: { kind: "route", route: base.pipelineRoute },
    });
  });

  test("venue status draft → no venue row (still mid-wizard server-side)", () => {
    expect(
      ids({ ...base, pipelineStatus: "draft", counts: { total: 1, live: 1, draft: 0 } }),
    ).not.toContain("get_venue_live");
  });

  test("venue deck_eligible → no venue row (live)", () => {
    expect(ids(base)).not.toContain("get_venue_live");
    expect(ids(base)).not.toContain("add_venue");
  });
});

describe("buildBusinessTodos — offering / stripe / draft", () => {
  test("zero offerings → create_offering opens the universal creator", () => {
    const todos = buildBusinessTodos({
      ...base,
      counts: { total: 0, live: 0, draft: 0 },
    });
    expect(todos.find((t) => t.id === "create_offering")).toMatchObject({
      action: { kind: "open_universal_creator" },
    });
  });

  test("paid draft + Stripe inactive → connect_stripe via stripeRoute", () => {
    const todos = buildBusinessTodos({
      ...base,
      stripeActive: false,
      hasDraftPaidOffering: true,
      counts: { total: 1, live: 0, draft: 1 },
      draftRoute: "/event/d1/edit",
    });
    expect(todos.find((t) => t.id === "connect_stripe")).toMatchObject({
      action: { kind: "route", route: "/brand/b1/payments" },
    });
  });

  test("Stripe inactive shows connect_stripe even with NO paid draft (ORCH-1040)", () => {
    const stripe = buildBusinessTodos({
      ...base,
      stripeActive: false,
      hasDraftPaidOffering: false,
    }).find((t) => t.id === "connect_stripe");
    expect(stripe).toBeDefined();
    expect(stripe?.sublabel).toBe("Set up payouts so you can sell");
    expect(stripe?.action).toEqual({
      kind: "route",
      route: "/brand/b1/payments",
    });
  });

  test("Stripe active → no connect_stripe", () => {
    expect(ids({ ...base, stripeActive: true })).not.toContain("connect_stripe");
  });

  test("has draft + nothing live + draftRoute → finish_draft", () => {
    const todos = buildBusinessTodos({
      ...base,
      counts: { total: 1, live: 0, draft: 1 },
      draftRoute: "/event/d1/edit",
    });
    expect(todos.find((t) => t.id === "finish_draft")).toMatchObject({
      action: { kind: "route", route: "/event/d1/edit" },
    });
  });

  test("draft present but draftRoute null → no finish_draft", () => {
    expect(
      ids({ ...base, counts: { total: 1, live: 0, draft: 1 }, draftRoute: null }),
    ).not.toContain("finish_draft");
  });

  test("create_offering and finish_draft are mutually exclusive (counts)", () => {
    // total 0 ⇒ draft 0 ⇒ finish_draft can't fire
    const todos = ids({ ...base, counts: { total: 0, live: 0, draft: 0 } });
    expect(todos).toContain("create_offering");
    expect(todos).not.toContain("finish_draft");
  });
});

describe("buildBusinessTodos — ordering + vanishing", () => {
  test("priority order: venue → offering → stripe → finish_draft", () => {
    const todos = ids({
      ...base,
      pipelineStatus: "needs_fix", // get_venue_live
      counts: { total: 1, live: 0, draft: 1 }, // finish_draft (not create_offering)
      stripeActive: false,
      hasDraftPaidOffering: true, // connect_stripe
      draftRoute: "/event/d1/edit",
    });
    expect(todos).toEqual(["get_venue_live", "connect_stripe", "finish_draft"]);
  });

  test("fully healthy brand → empty list (toggle hides)", () => {
    expect(buildBusinessTodos(base)).toEqual([]);
  });

  test("completing the venue drops its row; offering remains", () => {
    const withVenue = ids({
      ...base,
      pipelineStatus: "needs_fix",
      counts: { total: 0, live: 0, draft: 0 },
    });
    expect(withVenue).toEqual(["get_venue_live", "create_offering"]);
    // venue now live → its row vanishes, offering stays
    const venueDone = ids({
      ...base,
      pipelineStatus: "deck_eligible",
      counts: { total: 0, live: 0, draft: 0 },
    });
    expect(venueDone).toEqual(["create_offering"]);
  });
});

// META-ORCH-1059 — venue-claim "under review" to-do row (replaces the Hub blue
// banner). Shows only while the claim is pending; vanishes on resolution.
describe("buildBusinessTodos — venue claim under review (META-ORCH-1059)", () => {
  test("pending claim → venue_claim_review row appears, routes to listing", () => {
    const todos = buildBusinessTodos({ ...base, venueClaimPending: true });
    const row = todos.find((t) => t.id === "venue_claim_review");
    expect(row).toBeDefined();
    expect(row?.label).toBe("Venue claim under review");
    expect(row?.action).toEqual({ kind: "route", route: "/brand/b1/listing" });
  });

  test("no pending claim → row absent (default healthy brand)", () => {
    expect(ids({ ...base, venueClaimPending: false })).not.toContain(
      "venue_claim_review",
    );
  });

  test("claim row vanishes once resolved (pending → not pending)", () => {
    const pending = ids({ ...base, venueClaimPending: true });
    expect(pending).toContain("venue_claim_review");
    const resolved = ids({ ...base, venueClaimPending: false });
    expect(resolved).not.toContain("venue_claim_review");
  });

  test("claim row sits after venue rows, before first-offering", () => {
    const todos = ids({
      ...base,
      venueClaimPending: true,
      pipelineStatus: "needs_fix", // get_venue_live
      counts: { total: 0, live: 0, draft: 0 }, // create_offering
    });
    expect(todos).toEqual([
      "get_venue_live",
      "venue_claim_review",
      "create_offering",
    ]);
  });
});
