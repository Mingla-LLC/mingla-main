/**
 * #4389 (iPhone 15 "New User" recording 23:53, ~266 s and 278 s) — after Tap to
 * Pay on iPhone was ON for the brand on this phone, F4 "You're all set." still
 * showed the card with "Set up Tap to Pay on iPhone".
 *
 *   O1 on for this brand → "Tap to Pay on iPhone · On", no setup button;
 *   O2 on + an event to sell for now → "Take a payment" opens the door sale;
 *   O3 on + no event → no button;
 *   O4 not on → the setup card as before.
 *
 * FAILS ON REVERT: the `ttpOn` branch removed → O1/O2/O3.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

let mockOn = false;
let mockHasEvent = false;
const mockOpenDoorSale = jest.fn(async () => "opened");
jest.mock("../../../hooks/useTapToPayAvailability", () => ({ useTapToPayOnForBrand: () => mockOn }));
jest.mock("../../../utils/openDoorSale", () => ({
  hasDoorSaleEvent: async () => mockHasEvent,
  openDoorSale: (...a: unknown[]) => mockOpenDoorSale(...(a as [])),
}));
jest.mock("../../../utils/tapToPayBrandEligible", () => ({ tapToPayBrandEligible: () => true }));

import {
  BrandCreationFlow,
  allText,
  byTestId,
  checklistAt,
  harness,
  mount,
  press,
  resetHarness,
  unmountAll,
  TestRenderer,
} from "./issue4389FlowHarness";

const ID = "43890000-0000-4000-8000-0000000000f5";
const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
  });
};
const open = async () => {
  harness.refreshStatus.mockImplementation(() => Promise.resolve({ state: "submitted", due: [] }));
  harness.checklist = checklistAt("done");
  const t = await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
  await flush();
  return t;
};

describe("#4389 — F4 shows Tap to Pay on iPhone as On once it is on for this phone and brand", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Object.defineProperty(require("react-native").Platform, "OS", { configurable: true, get: () => "ios" });
    resetHarness();
    harness.ttpEntry = { label: "Tap to Pay on iPhone" };
    mockOn = false;
    mockHasEvent = false;
    mockOpenDoorSale.mockClear();
  });
  afterEach(() => unmountAll());

  test("O1: on → '· On', never the setup button", async () => {
    mockOn = true;
    const t = await open();
    expect(allText(t)).toContain("Tap to Pay on iPhone · On");
    expect(byTestId(t, "brand-setup-ttp-setup")).toHaveLength(0);
  });

  test("O2: on with an event to sell → Take a payment opens the door sale", async () => {
    mockOn = true;
    mockHasEvent = true;
    const t = await open();
    const btn = byTestId(t, "brand-setup-ttp-take-payment");
    expect(btn.length).toBeGreaterThan(0);
    await press(btn[0]);
    await flush();
    expect(mockOpenDoorSale).toHaveBeenCalledTimes(1);
  });

  test("O3: on with no event → no button", async () => {
    mockOn = true;
    const t = await open();
    expect(byTestId(t, "brand-setup-ttp-take-payment")).toHaveLength(0);
  });

  test("O4: not on → the setup card", async () => {
    const t = await open();
    expect(byTestId(t, "brand-setup-ttp-setup").length).toBeGreaterThan(0);
    expect(allText(t)).not.toContain("· On");
  });
});
