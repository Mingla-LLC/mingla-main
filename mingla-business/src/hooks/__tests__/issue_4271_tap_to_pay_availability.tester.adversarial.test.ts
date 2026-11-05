/**
 * #4271 — TESTER adversarial suite for useTapToPayAvailability and the
 * over-the-air safety of the Stripe Terminal SDK. Different angles from the
 * implementor's per-reason table:
 *   - the LIVE device read (currentTapToPayDevice) on web, macOS and Windows
 *     says "no module" even when a stray native-module object is registered;
 *   - a binary whose module registry THROWS, and a binary whose native module
 *     exists but whose JS package fails to load, both hide Tap to Pay and never
 *     throw (an OTA must not brick an older or mismatched binary);
 *   - Nigeria is hidden whichever way it shows up: a Paystack brand even with
 *     a GBP/USD sale, a Stripe brand selling in NGN, an unset provider with a
 *     Paystack subaccount;
 *   - currency casing/whitespace is normalised, and look-alikes (EUR, "GB",
 *     "US", "") are refused; iOS "16.7.10" and Android API 32 are refused,
 *     iOS "17.0.1" and API 33 accepted; an iPad on iOS 18 is refused.
 *
 * fails-on-revert (verified by the tester): removing the try/catch around
 * require() in loadTerminalSdk fails "a package that fails to load". (Removing
 * only the Paystack check does NOT fail "Nigeria is hidden": the charge-ready
 * check hides a Paystack brand too, which is the defence in depth we want.)
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// React Native always defines __DEV__; plain node does not.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const mockPlatform: { OS: string; Version: string | number; isPad?: boolean } = {
  OS: "ios",
  Version: "18.1",
};
const mockNativeModules: Record<string, unknown> = {};
const mockTurboGet = jest.fn((_name: string): unknown => null);
const mockSdkFactory = jest.fn((): unknown => ({ marker: "terminal-sdk" }));

jest.mock("react-native", () => ({
  get Platform() {
    return mockPlatform;
  },
  get NativeModules() {
    return mockNativeModules;
  },
  TurboModuleRegistry: { get: (name: string) => mockTurboGet(name) },
}));
jest.mock("@stripe/stripe-terminal-react-native", () => mockSdkFactory());
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

import {
  currentTapToPayDevice,
  resolveTapToPayAvailability,
  type TapToPayBrandFacts,
  type TapToPayDeviceFacts,
} from "../useTapToPayAvailability";
import {
  isTerminalNativeModulePresent,
  loadTerminalSdk,
  resetTerminalSdkCacheForTests,
} from "../../services/terminal/terminalSdk";
import * as webSdk from "../../services/terminal/terminalSdk.web";

const IPHONE: TapToPayDeviceFacts = { os: "ios", version: "18.1", isPad: false, nativeModulePresent: true, entitled: true };
const STRIPE: TapToPayBrandFacts = { paymentProvider: "stripe", stripeStatus: "active", chargesEnabled: true };

beforeEach(() => {
  mockPlatform.OS = "ios";
  mockPlatform.Version = "18.1";
  delete mockPlatform.isPad;
  for (const key of Object.keys(mockNativeModules)) delete mockNativeModules[key];
  mockTurboGet.mockReset();
  mockTurboGet.mockImplementation(() => null);
  mockSdkFactory.mockReset();
  mockSdkFactory.mockImplementation(() => ({ marker: "terminal-sdk" }));
  resetTerminalSdkCacheForTests();
});

describe("#4271 tester: the live device read", () => {
  test.each(["web", "macos", "windows"])("%s never reports the module, even with a stray registration", (os) => {
    mockPlatform.OS = os;
    mockNativeModules.StripeTerminalReactNative = {};
    mockTurboGet.mockImplementation(() => ({}));
    const device = currentTapToPayDevice();
    expect(device.nativeModulePresent).toBe(false);
    expect(resolveTapToPayAvailability({ brand: STRIPE, currency: "GBP", released: true }, device, true)).toEqual({
      available: false,
      needsSetup: false,
      reason: "web",
    });
    expect(loadTerminalSdk()).toBeNull();
    expect(mockSdkFactory).not.toHaveBeenCalled();
  });

  test("the web build of the SDK shim never loads anything", () => {
    expect(webSdk.isTerminalNativeModulePresent()).toBe(false);
    expect(webSdk.loadTerminalSdk()).toBeNull();
  });
});

describe("#4271 tester: an over-the-air update on an older or mismatched binary", () => {
  test("a module registry that throws hides Tap to Pay and never throws", () => {
    mockTurboGet.mockImplementation(() => {
      throw new Error("TurboModuleRegistry: malformed");
    });
    expect(() => isTerminalNativeModulePresent()).not.toThrow();
    expect(isTerminalNativeModulePresent()).toBe(false);
    expect(loadTerminalSdk()).toBeNull();
    expect(mockSdkFactory).not.toHaveBeenCalled();
    const device = currentTapToPayDevice();
    expect(resolveTapToPayAvailability({ brand: STRIPE, currency: "USD", released: true }, device, true).available).toBe(false);
  });

  test("a package that fails to load on a binary with the module returns null, never throws", () => {
    mockNativeModules.StripeTerminalReactNative = {};
    mockSdkFactory.mockImplementation(() => {
      throw new Error("Invariant Violation: native module version mismatch");
    });
    let sdk: unknown = "unset";
    expect(() => {
      sdk = loadTerminalSdk();
    }).not.toThrow();
    expect(sdk).toBeNull();
    // Cached: a second call neither retries the require nor throws.
    expect(loadTerminalSdk()).toBeNull();
  });
});

describe("#4271 tester: Nigeria is hidden whichever way it shows up", () => {
  test("a Paystack brand, even on a GBP or USD sale", () => {
    for (const currency of ["GBP", "USD", "NGN"]) {
      const result = resolveTapToPayAvailability(
        { brand: { ...STRIPE, paymentProvider: "paystack" }, currency, released: true },
        IPHONE,
        true,
      );
      expect(result.available).toBe(false);
    }
  });

  test("a Stripe brand selling in naira", () => {
    expect(resolveTapToPayAvailability({ brand: STRIPE, currency: "NGN", released: true }, IPHONE, true).available).toBe(false);
  });

  test("an unset provider carrying a Paystack subaccount and naira", () => {
    const brand = {
      paymentProvider: undefined,
      paystackSubaccountCode: "ACCT_ng",
      stripeStatus: "not_connected",
      chargesEnabled: false,
    } as unknown as TapToPayBrandFacts;
    expect(resolveTapToPayAvailability({ brand, currency: "NGN", released: true }, IPHONE, true).available).toBe(false);
  });
});

describe("#4271 tester: boundaries", () => {
  test("currency is normalised and look-alikes are refused", () => {
    expect(resolveTapToPayAvailability({ brand: STRIPE, currency: "  gbp ", released: true }, IPHONE, true).available).toBe(true);
    for (const currency of ["EUR", "GB", "US", "", null, undefined, "GBPX"]) {
      expect(resolveTapToPayAvailability({ brand: STRIPE, currency, released: true }, IPHONE, true).available).toBe(false);
    }
  });

  test("OS version edges", () => {
    const at = (os: string, version: string | number, isPad = false) =>
      resolveTapToPayAvailability({ brand: STRIPE, currency: "USD", released: true }, { os, version, isPad, nativeModulePresent: true, entitled: true }, true)
        .available;
    expect(at("ios", "16.7.10")).toBe(false);
    expect(at("ios", "17.0.1")).toBe(true);
    expect(at("ios", "")).toBe(false);
    expect(at("ios", "18.1", true)).toBe(false);
    expect(at("android", 32)).toBe(false);
    expect(at("android", 33)).toBe(true);
  });

  test("setup state only changes needsSetup, never availability", () => {
    const fresh = resolveTapToPayAvailability({ brand: STRIPE, currency: "USD", released: true }, IPHONE, false);
    const ready = resolveTapToPayAvailability({ brand: STRIPE, currency: "USD", released: true }, IPHONE, true);
    expect(fresh).toEqual({ available: true, needsSetup: true, reason: "ok" });
    expect(ready).toEqual({ available: true, needsSetup: false, reason: "ok" });
    const hidden = resolveTapToPayAvailability({ brand: STRIPE, currency: "NGN", released: true }, IPHONE, false);
    expect(hidden.needsSetup).toBe(false);
  });
});
