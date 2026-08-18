import { buildBusinessTodos, type BusinessTodoInput } from "../businessTodos";

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible",
  pipelineRoute: "",
  venueDraftInProgress: false,
  venuePipelines: [],
  venueClaims: [],
  counts: { total: 1, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "",
};

describe("#1795 order-data completeness to-dos", () => {
  it("adds exact zone and item-cost actions only when successful metrics supplied them", () => {
    const todos = buildBusinessTodos({
      ...base,
      venueOrderCompleteness: [
        { venueId: "v1", venueName: "Bar Toto", kind: "zones", count: 2, route: "/venue/v1?module=tables" },
        { venueId: "v1", venueName: "Bar Toto", kind: "item_costs", count: 1, route: "/venue/v1?module=menu" },
      ],
    });
    expect(todos.map((todo) => todo.id)).toEqual([
      "venue_order_zones:v1",
      "venue_order_item_costs:v1",
    ]);
    expect(todos[0]?.sublabel).toContain("2 active tables need a zone");
    expect(todos[1]?.sublabel).toContain("1 sold item needs a cost");
  });

  it("renders no order completeness action when the live hook supplies none", () => {
    expect(buildBusinessTodos(base)).toEqual([]);
  });
});
