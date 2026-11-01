/**
 * ORCH-1256 → #3355 P5 — buildBusinessTodos band 6 (brand-profile rows).
 *
 * Since #3355 P5 the rows are the server's canonical readiness items
 * (brand_readiness) through HOME_READINESS_ROWS, not client-derived
 * emptiness booleans. Kept from ORCH-1256: fixed order, ?section= deep
 * links, tail placement, one row per unmet item, absent input ⇒ zero rows,
 * no rows while the brand resolves.
 */
import { describe, expect, test } from "@jest/globals";

import {
  buildBusinessTodos,
  HOME_READINESS_ROWS,
  type BusinessTodoBrandReadiness,
  type BusinessTodoInput,
  type BusinessTodoReadinessItem,
} from "../businessTodos";

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible",
  pipelineRoute:
    "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 3, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
};

const EDIT_ROUTE = "/brand/b1/edit";

const item = (
  key: string,
  state: BusinessTodoReadinessItem["state"] = "missing",
): BusinessTodoReadinessItem => ({
  key,
  state,
  canCallerFix: true,
  whoCanFix: "a brand admin or the owner",
});

const MONEY_DONE = [
  item("money.can_sell", "verified"),
  item("money.can_be_paid_out", "verified"),
];

const readiness = (
  items: BusinessTodoReadinessItem[],
): BusinessTodoBrandReadiness => ({
  status: "ready",
  brandId: "b1",
  editRoute: EDIT_ROUTE,
  hideBrandRows: false,
  items: [...items, ...MONEY_DONE],
});

const allMissing = (): BusinessTodoReadinessItem[] =>
  HOME_READINESS_ROWS.map((row) => item(row.key));

const PROFILE_IDS = HOME_READINESS_ROWS.map((row) => row.id);

const ids = (input: BusinessTodoInput): string[] =>
  buildBusinessTodos(input).map((t) => t.id);

describe("buildBusinessTodos — profile band from canonical readiness", () => {
  test("T-1: every Home item missing → one row each, fixed order, ?section= deep links", () => {
    const todos = buildBusinessTodos({
      ...base,
      brandReadiness: readiness(allMissing()),
    });
    expect(todos.map((t) => t.id)).toEqual(PROFILE_IDS);
    for (const row of HOME_READINESS_ROWS) {
      const todo = todos.find((t) => t.id === row.id);
      expect(todo?.action).toEqual({
        kind: "route",
        route: `${EDIT_ROUTE}?section=${row.section}`,
      });
      expect(todo?.label).toBe(row.label);
      expect(todo?.sublabel).toBe(row.sublabel);
      expect(todo?.readinessKey).toBe(row.key);
    }
  });

  test("T-1b: the ORCH-1256 rows keep their ids, labels and sections", () => {
    const todos = buildBusinessTodos({
      ...base,
      brandReadiness: readiness(allMissing()),
    });
    const pick = (id: string): [string, string | undefined] => {
      const todo = todos.find((t) => t.id === id);
      return [todo?.label ?? "", todo?.sublabel];
    };
    expect(pick("profile_add_cover")).toEqual(["Add a cover", "Make your public page pop"]);
    expect(pick("profile_add_photo")).toEqual(["Add a profile photo", "Put a face on your brand"]);
    expect(pick("profile_add_tagline")).toEqual(["Add a tagline", "One line that says what you do"]);
    expect(pick("profile_add_description")).toEqual(["Describe your brand", "Tell people what you're about"]);
    expect(pick("profile_add_address")).toEqual(["Add your address", "Help people find you"]);
    expect(pick("profile_add_email")).toEqual(["Add a contact email", "So customers can reach you"]);
    expect(pick("profile_add_phone")).toEqual(["Add a phone number", "Another way to reach you"]);
    expect(pick("profile_add_socials")).toEqual(["Add your social links", "Instagram, TikTok, your website and more"]);
  });

  test("T-2: profile rows come after get_venue_live / connect_stripe / finish_draft", () => {
    const todos = ids({
      ...base,
      pipelineStatus: "needs_fix",
      stripeActive: false,
      counts: { total: 1, live: 0, draft: 1 },
      draftRoute: "/event/d1/edit",
      brandReadiness: readiness(allMissing()),
    });
    expect(todos).toEqual([
      "get_venue_live",
      "connect_stripe",
      "finish_draft",
      ...PROFILE_IDS,
    ]);
  });

  test.each(HOME_READINESS_ROWS.map((row) => [row.key, row.id] as const))(
    "T-3: %s verified → only %s absent",
    (key, id) => {
      const items = allMissing().map((i) => (i.key === key ? item(key, "verified") : i));
      const todos = ids({ ...base, brandReadiness: readiness(items) });
      expect(todos).toEqual(PROFILE_IDS.filter((p) => p !== id));
    },
  );

  test("not_applicable (an owner exception) never shows a row", () => {
    const items = allMissing().map((i) =>
      i.key === "address" ? item("address", "not_applicable") : i,
    );
    expect(ids({ ...base, brandReadiness: readiness(items) })).not.toContain(
      "profile_add_address",
    );
  });

  test("all items done → zero profile rows (healthy brand stays empty)", () => {
    const items = HOME_READINESS_ROWS.map((row) => item(row.key, "verified"));
    expect(buildBusinessTodos({ ...base, brandReadiness: readiness(items) })).toEqual([]);
  });

  test("T-7: brandReadiness omitted → zero profile rows; healthy brand still []", () => {
    expect(buildBusinessTodos(base)).toEqual([]);
    const busy = ids({
      ...base,
      pipelineStatus: "needs_fix",
      counts: { total: 0, live: 0, draft: 0 },
    });
    expect(busy.some((id) => id.startsWith("profile_"))).toBe(false);
  });

  test("T-8: brandResolving (or !hasBrand) → no profile rows", () => {
    expect(
      buildBusinessTodos({
        ...base,
        brandResolving: true,
        brandReadiness: readiness(allMissing()),
      }),
    ).toEqual([]);
    expect(
      buildBusinessTodos({
        ...base,
        hasBrand: false,
        brandReadiness: readiness(allMissing()),
      }),
    ).toEqual([]);
  });
});
