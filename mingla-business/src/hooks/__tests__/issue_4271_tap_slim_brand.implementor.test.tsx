/* eslint-disable import/first */
/**
 * #4271 — Tap to Pay at the door reads the brand's REAL card facts.
 *
 * Measured on a real iPhone: the door sheet got the event detail's slim brand
 * ({id, name}, no paymentProvider / stripeStatus / chargesEnabled), so
 * isBrandChargeReady said no and availability was "no_card_payments" for every
 * brand. The real useTapToPayAvailability hook is mounted here with a slim
 * brand whose own record can take cards; only the platform edges are faked.
 *
 * fails-on-revert: using the given brand as is (dropping the useTapToPayBrandFacts
 * completion) leaves Tap to Pay out of the door sheet and fails here.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Renderer {
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

const mockGetBrand = jest.fn(async (_id: string): Promise<unknown> => null);

jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "26.6.2" } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("../../services/brandsService", () => ({ getBrand: (id: string) => mockGetBrand(id) }));
jest.mock("../useTapToPayRelease", () => ({ useTapToPayRelease: () => ({ live: true }) }));
jest.mock("../../services/terminal/tapToPaySetupStore", () => ({
  readTapToPayWarmHint: async () => true,
  peekTapToPayWarmHint: () => undefined,
  subscribeTapToPayWarmHint: () => () => undefined,
}));
jest.mock("../../services/terminal/tapToPaySession", () => ({
  useTapToPayTerminal: () => ({}),
  tapToPayAcceptanceFor: () => "accepted",
}));
jest.mock("../../services/terminal/tapToPayDevice", () => ({
  currentTapToPayDevice: () => ({ os: "ios", version: "26.6.2", isPad: false, nativeModulePresent: true, entitled: true }),
  isTapToPayDeviceSupported: () => true,
  isIosBelowTapFloor: () => false,
  MIN_ANDROID_API: 33,
  MIN_IOS_FOR_TAP: "17.6",
  MIN_IOS_MAJOR: 17,
}));

import {
  hasTapToPayCardFacts,
  useTapToPayAvailability,
  type TapToPayAvailability,
  type TapToPayBrandFacts,
} from "../useTapToPayAvailability";
import { buildDoorPaymentOptions } from "../../components/door/doorPaymentOptions";

const BRAND_ID = "14fee35b-0000-4000-8000-000000004271";
const FULL_BRAND = {
  id: BRAND_ID,
  paymentProvider: "stripe",
  stripeStatus: "active",
  chargesEnabled: true,
  paystackSubaccountCode: null,
  payoutHoldCutoverAt: null,
};

const mount = async (brand: TapToPayBrandFacts): Promise<{ seen: TapToPayAvailability[]; r: Renderer }> => {
  const seen: TapToPayAvailability[] = [];
  const Probe = (): null => {
    seen.push(useTapToPayAvailability({ brand, currency: "USD" }));
    return null;
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let r: Renderer | null = null;
  await TestRenderer.act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i += 1) await TestRenderer.act(async () => { await Promise.resolve(); });
  return { seen, r: r as unknown as Renderer };
};

afterEach(() => {
  mockGetBrand.mockReset();
});

describe("#4271 Tap to Pay at the door with the event's slim brand", () => {
  test("a slim brand {id} whose own record can take cards lists Tap to Pay in the door sheet", async () => {
    mockGetBrand.mockImplementation(async () => FULL_BRAND);
    const slim = { id: BRAND_ID } as unknown as TapToPayBrandFacts;
    expect(hasTapToPayCardFacts(slim)).toBe(false);
    const { seen, r } = await mount(slim);
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ available: true, reason: "ok" });
    expect(mockGetBrand).toHaveBeenCalledWith(BRAND_ID);
    const options = buildDoorPaymentOptions({ eventCurrency: "USD", tapToPay: last, platform: "ios" });
    expect(options[0].id).toBe("tap_to_pay");
    r.unmount();
  });

  test("a slim brand whose own record can't take cards stays without Tap to Pay", async () => {
    mockGetBrand.mockImplementation(async () => ({ ...FULL_BRAND, chargesEnabled: false, stripeStatus: "onboarding" }));
    const { seen, r } = await mount({ id: BRAND_ID } as unknown as TapToPayBrandFacts);
    expect(seen[seen.length - 1]).toMatchObject({ available: false, reason: "no_card_payments" });
    r.unmount();
  });

  test("a full brand is used as is and fetches nothing", async () => {
    const { seen, r } = await mount(FULL_BRAND as unknown as TapToPayBrandFacts);
    expect(seen[seen.length - 1]).toMatchObject({ available: true });
    expect(mockGetBrand).not.toHaveBeenCalled();
    r.unmount();
  });
});
