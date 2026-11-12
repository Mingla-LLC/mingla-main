/* eslint-disable import/first */
/**
 * #4389 (iPhone 15 recording 23:10, ~328–330 s) — after the app reopened, Charge
 * for a brand already set up on this phone landed on the full setup screen.
 * One cause: useTapToPayAvailability started every mount with hint = false
 * while the phone's per-brand setup hint was still being read from storage, so
 * with Apple's answer still "unknown" it said needsSetup = true, and the Tap to
 * Pay sale screen's redirect effect sent the host to setup on its first commit.
 *
 *   C1 while the hint is unread (acceptance unknown): needsSetup is reported
 *      with checking = true; once read as set up → needsSetup false;
 *   C2 a hint this runtime already read is used from the first render;
 *   C3 the sale screen never redirects to setup while checking.
 *
 * FAILS ON REVERT: `checking` dropped from the hook → C1; the sale screen's
 * `availability.checking !== true` guard dropped → C3.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Renderer {
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

let mockRelease: (v: boolean) => void = () => undefined;
let mockPeek: boolean | undefined;
jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "26.6.2" } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("../../services/brandsService", () => ({ getBrand: async () => null }));
jest.mock("../useTapToPayRelease", () => ({ useTapToPayRelease: () => ({ live: true }) }));
jest.mock("../../services/terminal/tapToPaySetupStore", () => ({
  readTapToPayWarmHint: () => new Promise<boolean>((resolve) => { mockRelease = resolve; }),
  peekTapToPayWarmHint: () => mockPeek,
  subscribeTapToPayWarmHint: () => () => undefined,
}));
jest.mock("../../services/terminal/tapToPaySession", () => ({
  useTapToPayTerminal: () => ({}),
  tapToPayAcceptanceFor: () => "unknown",
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
  useTapToPayAvailability,
  useTapToPayOnForBrand,
  type TapToPayAvailability,
  type TapToPayBrandFacts,
} from "../useTapToPayAvailability";

const BRAND = {
  id: "14fee35b-0000-4000-8000-000000004389",
  paymentProvider: "stripe",
  stripeStatus: "active",
  chargesEnabled: true,
  paystackSubaccountCode: null,
  payoutHoldCutoverAt: null,
} as unknown as TapToPayBrandFacts;

const mount = async (): Promise<{ seen: TapToPayAvailability[]; r: Renderer }> => {
  const seen: TapToPayAvailability[] = [];
  const Probe = (): null => {
    seen.push(useTapToPayAvailability({ brand: BRAND, currency: "USD" }));
    return null;
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let r: Renderer | null = null;
  await TestRenderer.act(async () => {
    r = TestRenderer.create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  });
  return { seen, r: r as unknown as Renderer };
};

describe("#4389 — a Tap to Pay setup answer still being read never counts as 'needs setup'", () => {
  test("C1: unread hint → checking; read as set up → no setup", async () => {
    mockPeek = undefined;
    const { seen, r } = await mount();
    expect(seen[0]).toMatchObject({ available: true, needsSetup: true, checking: true });
    await TestRenderer.act(async () => mockRelease(true));
    expect(seen[seen.length - 1]).toMatchObject({ available: true, needsSetup: false });
    expect(seen[seen.length - 1].checking).not.toBe(true);
    r.unmount();
  });

  test("C2: a hint already read in this runtime is used from the first render", async () => {
    mockPeek = true;
    const { seen, r } = await mount();
    for (const s of seen) expect(s.needsSetup).toBe(false);
    r.unmount();
  });

  test("C3: the sale screen's setup redirect waits while checking", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../components/door/tap/TapToPaySaleScreen.tsx"),
      "utf8",
    );
    expect(src).toMatch(/availability\.needsSetup && availability\.checking !== true/);
  });

  test("C4: F4's 'On' reads the same hint — off while unread, on once read as set up", async () => {
    mockPeek = undefined;
    const seen: boolean[] = [];
    const Probe = (): null => {
      seen.push(useTapToPayOnForBrand("14fee35b-0000-4000-8000-000000004389"));
      return null;
    };
    let r: Renderer | null = null;
    await TestRenderer.act(async () => { r = TestRenderer.create(<Probe />); });
    expect(seen[0]).toBe(false);
    await TestRenderer.act(async () => mockRelease(true));
    expect(seen[seen.length - 1]).toBe(true);
    (r as unknown as Renderer).unmount();
  });
});
