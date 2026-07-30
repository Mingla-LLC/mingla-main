const mockInvoke = jest.fn();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

import {
  commitExistingVenueDiscoveryRange,
  commitNewVenueDiscoveryRange,
  type BrandDiscoveryCurrencyState,
} from "../../../services/businessPlaceAuthoringService";

const state: BrandDiscoveryCurrencyState = {
  brandId: "brand-1",
  stateVersion: 4,
  authority: "settlement",
  currencyCode: "NGN",
  canAuthorRange: true,
  canAcceptPaidReservations: true,
  supportedCurrencies: [{
    code: "NGN",
    minorUnitExponent: 2,
    railSource: "paystack",
  }],
  reconciliation: null,
};

const baseInput = {
  brandId: "brand-1",
  venueId: "venue-1",
  placePoolId: "place-1",
  priceMinInput: "200.00",
  priceMaxInput: "500.00",
};

describe("issue #1384 live authoring controllers", () => {
  it("commits identical canonical NGN payloads for new and existing venues", async () => {
    const payloads: Record<string, unknown>[] = [];
    const dependencies = {
      getCurrencyState: jest.fn(async () => state),
      saveRange: jest.fn(async (payload) => {
        payloads.push(payload);
      }),
    };

    await commitNewVenueDiscoveryRange(baseInput, dependencies);
    await commitExistingVenueDiscoveryRange(
      { ...baseInput, expectedVersion: 7 },
      dependencies,
    );

    expect(payloads[0]).toEqual({
      brandId: "brand-1",
      venueId: "venue-1",
      placePoolId: "place-1",
      sourceMinMinor: 20_000,
      sourceMaxMinor: 50_000,
      currencyCode: "NGN",
      expectedVersion: null,
    });
    expect(payloads[1]).toEqual({
      ...payloads[0],
      expectedVersion: 7,
    });
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty("priceTiers");
      expect(payload).not.toHaveProperty("tier1");
      expect(payload).not.toHaveProperty("tier2");
    }
  });

  it.each(["new", "existing"] as const)(
    "blocks %s completion when canonical save rejects",
    async (kind) => {
    const onDone = jest.fn();
    const reset = jest.fn();
    const dependencies = {
      getCurrencyState: jest.fn(async () => state),
      saveRange: jest.fn(async () => {
        throw new Error("canonical_save_failed");
      }),
    };
    const runLiveOrder = async (): Promise<void> => {
      if (kind === "existing") {
        await commitExistingVenueDiscoveryRange(
          { ...baseInput, expectedVersion: 7 },
          dependencies,
        );
      } else {
        await commitNewVenueDiscoveryRange(baseInput, dependencies);
      }
      reset();
      onDone();
    };

    await expect(runLiveOrder()).rejects.toThrow("canonical_save_failed");
    expect(reset).toHaveBeenCalledTimes(0);
    expect(onDone).toHaveBeenCalledTimes(0);
    },
  );
});
