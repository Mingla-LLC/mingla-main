// Issue #3645 (review of #4592) — buyer web's guest ordering, MOUNTED.
//
// `venue-order-create` answers `checkout_review_required` (409) when the price
// changed between the guest's preview and the order: a discount ended or ran
// out, or the order switched between free and paid. Before this, the hook
// showed "Something went wrong" and kept the old preview, so the next Pay
// re-sent the old quote digest and was refused again: the guest was stuck.
//
// This mounts the real hook over a real react-query client and a fake service,
// and proves: the guest reads that the price changed (not a generic failure),
// the preview is fetched again, the new total is what the guest sees, and the
// next Pay carries the NEW quote digest.
//
// fails-on-revert: drop the `venueOrderNeedsFreshQuote` branch in
// `useBuyerVenueOrdering.submit` and the refetch / digest assertions fail.

import React from "react";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { unmount: () => void };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Buyer web ships react-native-web; the shared cart's imports need its StyleSheet.
jest.mock("react-native", () => jest.requireActual("react-native-web"));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: jest.fn() }));

const fetchVenueOrderingState = jest.fn();
const fetchVenueMenuModifiers = jest.fn();
const previewVenueOrder = jest.fn();
const createVenueOrder = jest.fn();
jest.mock("../../../services/venueOrderingService", () => {
  const actual = jest.requireActual("../../../services/venueOrderingService");
  return {
    ...actual,
    fetchVenueOrderingState: (...a: unknown[]) => fetchVenueOrderingState(...a),
    fetchVenueMenuModifiers: (...a: unknown[]) => fetchVenueMenuModifiers(...a),
    previewVenueOrder: (...a: unknown[]) => previewVenueOrder(...a),
    createVenueOrder: (...a: unknown[]) => createVenueOrder(...a),
    fetchVenueOrderStatus: jest.fn(async () => null),
    venueOrderGuestAction: jest.fn(),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  parseVenueOrderFailureBody,
  VENUE_ORDER_PRICE_CHANGED_MESSAGE,
} from "@mingla/brand-rendering/venueOrdering/venueOrderingWire";
import { VenueOrderError } from "../../../services/venueOrderingService";
import {
  type BuyerVenueOrdering,
  useBuyerVenueOrdering,
} from "../useBuyerVenueOrdering";

const VENUE_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

const config = {
  state: "on",
  venueId: VENUE_ID,
  venueName: "Test Bar",
  spotState: "none",
  spot: null,
  serviceChargeBps: 0,
  serviceChargeLabel: "Service",
  tipsEnabled: false,
  tipPresetsBps: null,
  counterPickupEnabled: true,
  prepTimeMinutes: null,
};

const preview = (totalCents: number, quoteDigest: string) => ({
  kind: "preview",
  currency: "USD",
  listSubtotalCents: 2_500,
  discountCents: 2_500 - totalCents,
  subtotalCents: totalCents,
  serviceChargeCents: 0,
  serviceChargeLabel: "Service",
  feesAndTaxCents: 0,
  tipCents: 0,
  totalCents,
  discounts: [],
  codeOutcome: { supplied: false, applied: false, reason: null, discountId: null },
  notices: [],
  quoteDigest,
  lines: [],
  tipsEnabled: false,
  counterPickupEnabled: true,
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function mount(): { current: () => BuyerVenueOrdering; unmount: () => void } {
  let latest: BuyerVenueOrdering | null = null;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Probe(): null {
    latest = useBuyerVenueOrdering({
      brandSlug: "test-brand",
      venueSlug: "test-bar",
      spotCode: null,
      entrySource: null,
      menu: [],
      scanned: false,
    });
    return null;
  }
  let tree: { unmount: () => void } | null = null;
  void TestRenderer.act(() => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return {
    current: () => {
      if (latest === null) throw new Error("hook not mounted");
      return latest;
    },
    unmount: () => {
      void TestRenderer.act(() => {
        tree?.unmount();
      });
      client.clear();
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchVenueOrderingState.mockResolvedValue(config);
  fetchVenueMenuModifiers.mockResolvedValue([]);
});

describe("#3645 — the price changed while the guest was ordering", () => {
  test("the rail's bare 409 reads as a price change, not a failure", () => {
    const failure = parseVenueOrderFailureBody(
      JSON.stringify({ error: "checkout_review_required", detail: "discount_changed", quote: {} }),
    );
    expect(failure).toEqual({
      code: "checkout_review_required",
      message: VENUE_ORDER_PRICE_CHANGED_MESSAGE,
    });
  });

  test("a refused Pay fetches the preview again, shows the new total, and the next Pay carries the new digest", async () => {
    // The guest saw a free order; by the time they paid, the discount had run
    // out and the server answered "review the new price".
    previewVenueOrder
      .mockResolvedValueOnce(preview(0, "digest-free"))
      .mockResolvedValueOnce(preview(2_500, "digest-paid"));
    createVenueOrder.mockRejectedValueOnce(
      new VenueOrderError({
        code: "checkout_review_required",
        message: VENUE_ORDER_PRICE_CHANGED_MESSAGE,
      }),
    );

    const hook = mount();
    await flush();
    await TestRenderer.act(() => {
      hook.current().cart.add({
        menuItemId: ITEM_ID,
        itemName: "Negroni",
        modifierIds: [],
        modifierNames: [],
        notes: null,
      });
    });
    await flush();
    expect(hook.current().previewStatus).toBe("ready");
    expect(hook.current().preview?.quoteDigest).toBe("digest-free");
    expect(previewVenueOrder).toHaveBeenCalledTimes(1);

    await TestRenderer.act(() => {
      hook.current().submit();
    });
    await flush();

    expect(createVenueOrder).toHaveBeenCalledTimes(1);
    expect(createVenueOrder.mock.calls[0][0]).toMatchObject({
      quoteDigest: "digest-free",
    });
    expect(hook.current().submitError).toBe(VENUE_ORDER_PRICE_CHANGED_MESSAGE);
    // The preview was fetched again, and the guest now reads the new total.
    expect(previewVenueOrder).toHaveBeenCalledTimes(2);
    expect(hook.current().preview?.totalCents).toBe(2_500);
    expect(hook.current().preview?.quoteDigest).toBe("digest-paid");

    // Tapping Pay again is the guest confirming the new total: it carries the
    // NEW digest, so the server can accept it.
    createVenueOrder.mockRejectedValueOnce(
      new VenueOrderError({ code: "internal_error", message: "stop here" }),
    );
    await TestRenderer.act(() => {
      hook.current().submit();
    });
    await flush();
    expect(createVenueOrder).toHaveBeenCalledTimes(2);
    expect(createVenueOrder.mock.calls[1][0]).toMatchObject({
      quoteDigest: "digest-paid",
    });
    hook.unmount();
  });

  test("any other refusal keeps the preview as it is", async () => {
    previewVenueOrder.mockResolvedValue(preview(2_500, "digest-paid"));
    createVenueOrder.mockRejectedValueOnce(
      new VenueOrderError({ code: "too_many_orders", message: "Slow down." }),
    );
    const hook = mount();
    await flush();
    await TestRenderer.act(() => {
      hook.current().cart.add({
        menuItemId: ITEM_ID,
        itemName: "Negroni",
        modifierIds: [],
        modifierNames: [],
        notes: null,
      });
    });
    await flush();
    await TestRenderer.act(() => {
      hook.current().submit();
    });
    await flush();
    expect(hook.current().submitError).toBe("Slow down.");
    expect(previewVenueOrder).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
