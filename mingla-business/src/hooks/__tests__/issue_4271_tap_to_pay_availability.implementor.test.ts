/**
 * #4271 — useTapToPayAvailability: every reason Tap to Pay is hidden, the
 * needsSetup flag, and the over-the-air safety rule (the Stripe Terminal SDK is
 * never loaded at module scope, and never loaded on a binary without its native
 * module).
 *
 * fails-on-revert: removing any availability check in
 * resolveTapToPayAvailability, the native-module presence check in
 * loadTerminalSdk, or adding a runtime import of the SDK anywhere but
 * terminalSdk.ts fails an assertion here.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  resolveTapToPayAvailability,
  currentTapToPayDevice,
  type TapToPayBrandFacts,
  type TapToPayDeviceFacts,
} from "../useTapToPayAvailability";
import {
  loadTerminalSdk,
  resetTerminalSdkCacheForTests,
} from "../../services/terminal/terminalSdk";

const mockPlatform: { OS: string; Version: string | number; isPad?: boolean } = {
  OS: "ios",
  Version: "18.1",
};
const mockNativeModules: Record<string, unknown> = {};
const mockTurboGet = jest.fn((_name: string): unknown => null);
const mockSdkFactory = jest.fn(() => ({ marker: "terminal-sdk" }));

// Getters: the hook imports react-native at module scope, so this factory runs
// while the mock* consts above are still in their temporal dead zone.
jest.mock("react-native", () => ({
  get Platform() {
    return mockPlatform;
  },
  get NativeModules() {
    return mockNativeModules;
  },
  TurboModuleRegistry: { get: (name: string) => mockTurboGet(name) },
}));
jest.mock("@stripe/stripe-terminal-react-native", () => mockSdkFactory(), { virtual: false });
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

const IPHONE: TapToPayDeviceFacts = { os: "ios", version: "18.1", isPad: false, nativeModulePresent: true };
const ANDROID: TapToPayDeviceFacts = { os: "android", version: 34, isPad: false, nativeModulePresent: true };
const STRIPE_BRAND: TapToPayBrandFacts = {
  paymentProvider: "stripe",
  stripeStatus: "active",
  chargesEnabled: true,
};

beforeEach(() => {
  mockPlatform.OS = "ios";
  mockPlatform.Version = "18.1";
  delete mockPlatform.isPad;
  for (const key of Object.keys(mockNativeModules)) delete mockNativeModules[key];
  mockTurboGet.mockReset();
  mockTurboGet.mockImplementation(() => null);
  mockSdkFactory.mockClear();
  resetTerminalSdkCacheForTests();
});

describe("resolveTapToPayAvailability — each reason", () => {
  test("available on a supported iPhone for a GB Stripe brand; needsSetup until set up", () => {
    expect(resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency: "GBP" }, IPHONE, false)).toEqual({
      available: true,
      needsSetup: true,
      reason: "ok",
    });
    expect(resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency: "gbp" }, IPHONE, true)).toEqual({
      available: true,
      needsSetup: false,
      reason: "ok",
    });
  });

  test("available on Android 13+ for a US Stripe brand", () => {
    expect(resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency: "USD" }, ANDROID, true).available).toBe(true);
  });

  test("web → hidden", () => {
    const web = { ...IPHONE, os: "web" };
    expect(resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency: "GBP" }, web, true)).toEqual({
      available: false,
      needsSetup: false,
      reason: "web",
    });
  });

  test("binary without the Terminal native module (OTA on an old build) → hidden", () => {
    const old = { ...IPHONE, nativeModulePresent: false };
    expect(resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency: "GBP" }, old, true).reason).toBe("sdk_missing");
  });

  test("unsupported device or OS → hidden", () => {
    const cases: TapToPayDeviceFacts[] = [
      { ...IPHONE, version: "16.7" },
      { ...IPHONE, isPad: true },
      { ...ANDROID, version: 32 },
    ];
    for (const device of cases) {
      const result = resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency: "GBP" }, device, true);
      expect(result.available).toBe(false);
      expect(result.reason).toBe("unsupported_device");
    }
  });

  test("no brand yet → hidden", () => {
    expect(resolveTapToPayAvailability({ brand: null, currency: "GBP" }, IPHONE, true).reason).toBe("no_brand");
    expect(resolveTapToPayAvailability(null, IPHONE, true).reason).toBe("no_brand");
  });

  test("Paystack / Nigeria brand → hidden", () => {
    const paystack: TapToPayBrandFacts = {
      paymentProvider: "paystack",
      paystackSubaccountCode: "ACCT_123",
    };
    expect(resolveTapToPayAvailability({ brand: paystack, currency: "NGN" }, IPHONE, true).reason).toBe("paystack");
  });

  test("currency outside GB / US → hidden", () => {
    for (const currency of ["EUR", "NGN", "CAD", "", null]) {
      expect(resolveTapToPayAvailability({ brand: STRIPE_BRAND, currency }, IPHONE, true).reason).toBe(
        "unsupported_country",
      );
    }
  });

  test("brand without Stripe card payments → hidden", () => {
    const cases: TapToPayBrandFacts[] = [
      { paymentProvider: "stripe", stripeStatus: "onboarding" },
      { paymentProvider: "stripe", stripeStatus: "active", chargesEnabled: false },
      { paymentProvider: "stripe" },
    ];
    for (const brand of cases) {
      expect(resolveTapToPayAvailability({ brand, currency: "USD" }, IPHONE, true).reason).toBe("no_card_payments");
    }
  });
});

describe("loadTerminalSdk — over-the-air safety", () => {
  test("no native module → returns null and never requires the SDK", () => {
    expect(loadTerminalSdk()).toBeNull();
    expect(mockSdkFactory).not.toHaveBeenCalled();
    expect(currentTapToPayDevice().nativeModulePresent).toBe(false);
  });

  test("web → returns null even if a module object exists", () => {
    mockPlatform.OS = "web";
    mockNativeModules.StripeTerminalReactNative = {};
    expect(loadTerminalSdk()).toBeNull();
    expect(mockSdkFactory).not.toHaveBeenCalled();
  });

  test("native module present (bridge or TurboModule) → loads the SDK lazily", () => {
    mockNativeModules.StripeTerminalReactNative = {};
    expect(loadTerminalSdk()).toEqual({ marker: "terminal-sdk" });
    expect(mockSdkFactory).toHaveBeenCalledTimes(1);

    resetTerminalSdkCacheForTests();
    delete mockNativeModules.StripeTerminalReactNative;
    mockTurboGet.mockImplementation((name) => (name === "StripeTerminalReactNative" ? {} : null));
    expect(loadTerminalSdk()).not.toBeNull();
  });

  test("an iPad never qualifies", () => {
    mockPlatform.isPad = true;
    mockNativeModules.StripeTerminalReactNative = {};
    expect(currentTapToPayDevice()).toMatchObject({ os: "ios", isPad: true, nativeModulePresent: true });
  });
});

describe("the SDK is never imported at module scope", () => {
  const BIZ_ROOT = path.join(__dirname, "..", "..", "..");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(abs);
    }
  };
  walk(path.join(BIZ_ROOT, "src"));
  walk(path.join(BIZ_ROOT, "app"));

  test("only `import type` references the package outside terminalSdk.ts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      if (!source.includes("@stripe/stripe-terminal-react-native")) continue;
      const rel = path.relative(BIZ_ROOT, file);
      const runtimeImport =
        /^\s*import\s+(?!type\b)[^;]*from\s+["']@stripe\/stripe-terminal-react-native["']/m.test(source) ||
        /^\s*import\s+["']@stripe\/stripe-terminal-react-native["']/m.test(source) ||
        /import\(\s*["']@stripe\/stripe-terminal-react-native["']\s*\)/.test(source);
      const requireCall = /require\(\s*["']@stripe\/stripe-terminal-react-native["']\s*\)/.test(source);
      if (runtimeImport) offenders.push(`${rel}: runtime import`);
      if (requireCall && rel !== path.join("src", "services", "terminal", "terminalSdk.ts")) {
        offenders.push(`${rel}: require outside terminalSdk.ts`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("terminalSdk.ts requires the SDK inside a function, after the presence check", () => {
    const source = fs.readFileSync(path.join(BIZ_ROOT, "src", "services", "terminal", "terminalSdk.ts"), "utf8");
    const requireLine = source
      .split("\n")
      .find((line) => line.includes('require("@stripe/stripe-terminal-react-native")'));
    expect(requireLine).toBeDefined();
    // Indented = inside a function body, never at module scope.
    expect(requireLine?.startsWith(" ")).toBe(true);
    const presence = source.indexOf("if (!isTerminalNativeModulePresent())");
    const load = source.indexOf('require("@stripe/stripe-terminal-react-native")');
    expect(presence).toBeGreaterThan(-1);
    expect(presence).toBeLessThan(load);
  });

  test("terminalSdk.web.ts never loads the SDK", () => {
    const web = fs.readFileSync(path.join(BIZ_ROOT, "src", "services", "terminal", "terminalSdk.web.ts"), "utf8");
    expect(web).not.toMatch(/require\(|import\s+(?!type)[^;]*from\s+["']@stripe\/stripe-terminal/);
  });
});
