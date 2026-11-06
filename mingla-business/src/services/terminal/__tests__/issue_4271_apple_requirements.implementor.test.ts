/**
 * #4271 phase 2 — the Tap to Pay on iPhone build against Apple's requirements.
 * Pure behaviour and source rules. Render proofs live in
 * src/components/door/__tests__/issue_4271_apple_surfaces.render.test.tsx.
 *
 * Every test here fails when its change is reverted (recorded on the issue).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const mockPlatform: { OS: string; Version: string | number; isPad?: boolean } = {
  OS: "ios",
  Version: "18.1",
};
const mockOptionalModule = jest.fn((_name: string): unknown => null);

jest.mock("react-native", () => ({
  get Platform() {
    return mockPlatform;
  },
  NativeModules: {},
  TurboModuleRegistry: { get: () => null },
}));
jest.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) => mockOptionalModule(name),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));

import AsyncStorage from "@react-native-async-storage/async-storage";

import { tapReaderProblemCopy } from "../../../constants/tapToPayCopy";
import {
  resolveTapToPayAvailability,
  tapToPayNeedsSetup,
  type TapToPayBrandFacts,
  type TapToPayDeviceFacts,
} from "../../../hooks/useTapToPayAvailability";
import { tapToPayLive } from "../../../hooks/useTapToPayRelease";
import { isTapToPayIphoneEntitled } from "../howToTap";
import { fetchDoorTapLocation, fetchTerminalConnectionToken } from "../doorTapEdge";
import { buildTapReceiptText } from "../tapReceipt";
import { consumeDoorTapPress, markDoorTapPress } from "../tapTiming";
import { TAP_WARM_THROTTLE_MS, TapToPayWarmUp, type TapToPayWarmUpDeps } from "../tapToPayWarmUp";
import { supabase } from "../../supabase";
import {
  markTapToPayWarmHint,
  readTapToPayWarmHint,
  resetTapToPayWarmHintForTests,
  TAP_TO_PAY_LEGACY_SETUP_KEY,
  tapToPayWarmHintKey,
} from "../tapToPaySetupStore";
import {
  getTapToPaySession,
  noteTapToPayConnectResult,
  parseTapProgress,
  resetTapToPaySessionForTests,
  tapToPayAcceptanceFor,
  setTapToPayScope,
  subscribeTapToPaySession,
} from "../tapToPaySession";
import { classifyTerminalError, shouldReportTapSeen, TapToPaySaleFlow, type TerminalErrorLike } from "../tapToPayFlow";
import { runTapToPaySetup, type TapToPaySetupDeps } from "../tapToPaySetup";

const BIZ_ROOT = path.join(__dirname, "..", "..", "..", "..");
const makeSetupDeps = (overrides: Partial<TapToPaySetupDeps> = {}): TapToPaySetupDeps => ({
  os: "ios",
  checkDeviceSupport: async () => ({ supported: true }),
  fetchLocation: async () => "tml_1",
  ensureReaderConnected: async () => ({}),
  showHowToTap: async () => "shown",
  markComplete: async () => undefined,
  ...overrides,
});

const STRIPE: TapToPayBrandFacts = {
  id: "brand-1",
  paymentProvider: "stripe",
  stripeStatus: "active",
  chargesEnabled: true,
};
const IPHONE: TapToPayDeviceFacts = {
  os: "ios",
  version: "18.1",
  isPad: false,
  nativeModulePresent: true,
  entitled: true,
};
const ANDROID: TapToPayDeviceFacts = {
  os: "android",
  version: 34,
  isPad: false,
  nativeModulePresent: true,
  entitled: false,
};

beforeEach(() => {
  mockPlatform.OS = "ios";
  mockPlatform.Version = "18.1";
  mockOptionalModule.mockReset();
  mockOptionalModule.mockReturnValue(null);
});

describe("B1 release gate", () => {
  const sale = (released: boolean) => ({ brand: STRIPE, currency: "GBP", released });

  test("iPhone with every other fact good but no entitlement is hidden as not_released", () => {
    expect(resolveTapToPayAvailability(sale(true), { ...IPHONE, entitled: false }, true)).toEqual({
      available: false,
      needsSetup: false,
      reason: "not_released",
    });
  });

  test("iPhone entitled but the server says no is hidden as not_released", () => {
    expect(resolveTapToPayAvailability(sale(false), IPHONE, true).reason).toBe("not_released");
  });

  test("Android the server says no is hidden; the entitlement means nothing there", () => {
    expect(resolveTapToPayAvailability(sale(false), ANDROID, true).reason).toBe("not_released");
    expect(resolveTapToPayAvailability(sale(true), ANDROID, true).available).toBe(true);
  });

  test("both halves true is available", () => {
    expect(resolveTapToPayAvailability(sale(true), IPHONE, true).available).toBe(true);
  });

  test("the one live value: loading, error and web read as off", () => {
    expect(tapToPayLive("ios", true, { iphone: true, android: false })).toBe(true);
    expect(tapToPayLive("ios", false, { iphone: true, android: true })).toBe(false);
    expect(tapToPayLive("ios", true, { iphone: false, android: true })).toBe(false);
    expect(tapToPayLive("android", false, { iphone: false, android: true })).toBe(true);
    expect(tapToPayLive("android", true, { iphone: true, android: false })).toBe(false);
    expect(tapToPayLive("ios", true, null)).toBe(false);
    expect(tapToPayLive("ios", true, undefined)).toBe(false);
    expect(tapToPayLive("web", true, { iphone: true, android: true })).toBe(false);
  });

  test("the entitlement is read from the native module and an older binary reads false", () => {
    expect(isTapToPayIphoneEntitled()).toBe(false);
    mockOptionalModule.mockReturnValue({ isEntitled: () => true });
    expect(isTapToPayIphoneEntitled()).toBe(true);
    mockOptionalModule.mockReturnValue({ isEntitled: () => false });
    expect(isTapToPayIphoneEntitled()).toBe(false);
    // A module from an older build has no isEntitled at all.
    mockOptionalModule.mockReturnValue({ isAvailable: async () => true });
    expect(isTapToPayIphoneEntitled()).toBe(false);
    mockOptionalModule.mockReturnValue({
      isEntitled: () => {
        throw new Error("native failure");
      },
    });
    expect(isTapToPayIphoneEntitled()).toBe(false);
    mockPlatform.OS = "android";
    mockOptionalModule.mockReturnValue({ isEntitled: () => true });
    expect(isTapToPayIphoneEntitled()).toBe(false);
  });

  // EAS signs `distribution: internal` iOS builds ad hoc, and Apple allows the
  // development Tap to Pay entitlement only in development-signed apps, so any
  // EAS profile that sets the switch fails Xcode signing. Entitled phone builds
  // are local (`expo prebuild` + `expo run:ios --device`) only.
  test("no eas.json profile sets MINGLA_TAP_TO_PAY_ENTITLEMENT", () => {
    const eas = JSON.parse(fs.readFileSync(path.join(BIZ_ROOT, "eas.json"), "utf8")) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    expect(Object.keys(eas.build)).toEqual(
      expect.arrayContaining(["development", "production", "preview"]),
    );
    for (const [name, profile] of Object.entries(eas.build)) {
      expect([name, profile.env?.MINGLA_TAP_TO_PAY_ENTITLEMENT]).toEqual([name, undefined]);
    }
  });

  test("the Swift module reads the Info.plist key the config writes", () => {
    const swift = fs.readFileSync(
      path.join(BIZ_ROOT, "modules/mingla-tap-to-pay-education/ios/MinglaTapToPayEducationModule.swift"),
      "utf8",
    );
    expect(swift).toContain('forInfoDictionaryKey: "MinglaTapToPayEntitled"');
  });

  test("__DEV__ never appears in the release decision", () => {
    for (const rel of ["src/hooks/useTapToPayRelease.ts"]) {
      const code = fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code).not.toContain("__DEV__");
    }
  });
});

describe("B2 iOS update message", () => {
  const sale = { brand: STRIPE, currency: "GBP", released: true };
  const on = (version: string): TapToPayDeviceFacts => ({ ...IPHONE, version });

  test("17.5 keeps the row with the update reason, 17.6 is fine, 16.7 is hidden", () => {
    expect(resolveTapToPayAvailability(sale, on("17.5"), false)).toEqual({
      available: true,
      needsSetup: false,
      reason: "ios_update_required",
    });
    expect(resolveTapToPayAvailability(sale, on("17.0.1"), true).reason).toBe("ios_update_required");
    expect(resolveTapToPayAvailability(sale, on("17.6"), true)).toEqual({
      available: true,
      needsSetup: false,
      reason: "ok",
    });
    expect(resolveTapToPayAvailability(sale, on("18.0"), true).reason).toBe("ok");
    expect(resolveTapToPayAvailability(sale, on("16.7"), true)).toEqual({
      available: false,
      needsSetup: false,
      reason: "unsupported_device",
    });
  });

  test("native 2910 is its own kind and beats the SDK's generic code", () => {
    const error: TerminalErrorLike = { code: "UNSUPPORTED_OPERATION", nativeErrorCode: "2910" };
    expect(classifyTerminalError(error)).toBe("ios_update_required");
    expect(classifyTerminalError({ code: "UNSUPPORTED_OPERATION" })).toBe("not_on_this_phone");
  });

  test("setup reads Stripe's own answer: support.error 2910 is the update, not a rejected phone", async () => {
    await expect(
      runTapToPaySetup(
        makeSetupDeps({
          checkDeviceSupport: async () => ({
            supported: false,
            error: { code: "UNSUPPORTED_OPERATION", nativeErrorCode: "2910" },
          }),
        }),
      ),
    ).resolves.toEqual({ kind: "ios_update_required" });
    await expect(
      runTapToPaySetup(makeSetupDeps({ checkDeviceSupport: async () => ({ supported: false }) })),
    ).resolves.toEqual({ kind: "device_rejected" });
  });

  test("a connect that answers 2910 is the update too", async () => {
    await expect(
      runTapToPaySetup(
        makeSetupDeps({
          ensureReaderConnected: async () => ({ error: { nativeErrorCode: "2910" } }),
        }),
      ),
    ).resolves.toEqual({ kind: "ios_update_required" });
  });
});

describe("B3 the Terminal session lives at the root", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");

  test("the host is a sibling of the Stack, never a wrapper", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toMatch(/<Stack screenOptions=\{\{ headerShown: false \}\} \/>[\s\S]{0,160}<TapToPayTerminalHost \/>/);
    expect(layout).not.toMatch(/<TapToPayTerminalHost[^/]*>\s*<Stack/);
    expect(fs.existsSync(path.join(BIZ_ROOT, "src/components/door/tap/TapToPayTerminalBoundary.tsx"))).toBe(false);
  });

  test("the tap routes set the scope and clear it, and mount no SDK", () => {
    const route = read("app/event/[id]/door/tap/_layout.tsx");
    expect(route).toContain("setTapToPayScope({ brandId, eventId, merchantDisplayName })");
    expect(route).toContain("setTapToPayScope(null)");
    expect(route).not.toContain("StripeTerminalProvider");
  });

  test("the store notifies subscribers and scope clears back to the current brand", () => {
    resetTapToPaySessionForTests();
    const listener = jest.fn();
    const unsubscribe = subscribeTapToPaySession(listener);
    setTapToPayScope({ brandId: "b1", eventId: "e1", merchantDisplayName: "Door" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getTapToPaySession().scope?.eventId).toBe("e1");
    setTapToPayScope(null);
    expect(getTapToPaySession().scope).toBeNull();
    unsubscribe();
    setTapToPayScope({ brandId: "b1", eventId: null, merchantDisplayName: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("token and Location ask by event when there is one, else by brand", async () => {
    const invoke = supabase.functions.invoke as unknown as jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    invoke.mockResolvedValue({ data: { secret: "pst", locationId: "tml" }, error: null });
    await fetchTerminalConnectionToken({ brandId: "b1", eventId: "e1" });
    expect(invoke).toHaveBeenLastCalledWith("terminal-connection-token", {
      body: { eventId: "e1", platform: "ios" },
    });
    await fetchTerminalConnectionToken({ brandId: "b1" });
    expect(invoke).toHaveBeenLastCalledWith("terminal-connection-token", {
      body: { brandId: "b1", platform: "ios" },
    });
    await fetchDoorTapLocation({ brandId: "b1", eventId: null });
    expect(invoke).toHaveBeenLastCalledWith("door-tap-intent", {
      body: { action: "location", brandId: "b1", platform: "ios" },
    });
  });
});

describe("B4 acceptance comes from Apple, and errors say what happened", () => {
  test("the hint can't overrule Apple: hint true with 3930 needs setup", () => {
    resetTapToPaySessionForTests();
    noteTapToPayConnectResult("b1", { nativeErrorCode: "3930" });
    const acceptance = tapToPayAcceptanceFor(getTapToPaySession(), "b1");
    expect(acceptance).toBe("not_accepted");
    expect(tapToPayNeedsSetup("ios", acceptance, true)).toBe(true);
  });

  test("hint false with a good connect needs no setup", () => {
    resetTapToPaySessionForTests();
    noteTapToPayConnectResult("b1", undefined);
    const acceptance = tapToPayAcceptanceFor(getTapToPaySession(), "b1");
    expect(acceptance).toBe("accepted");
    expect(tapToPayNeedsSetup("ios", acceptance, false)).toBe(false);
  });

  test("unknown falls back to the hint; another error tells us nothing", () => {
    resetTapToPaySessionForTests();
    noteTapToPayConnectResult("b1", { nativeErrorCode: "2960" });
    expect(getTapToPaySession().acceptance).toBe("unknown");
    expect(tapToPayNeedsSetup("ios", "unknown", true)).toBe(false);
    expect(tapToPayNeedsSetup("ios", "unknown", false)).toBe(true);
  });

  test("Android has no Apple terms: only the hint counts", () => {
    expect(tapToPayNeedsSetup("android", "not_accepted", true)).toBe(false);
    expect(tapToPayNeedsSetup("android", "accepted", false)).toBe(true);
  });

  test("a brand switch reads as unknown", () => {
    resetTapToPaySessionForTests();
    noteTapToPayConnectResult("b1", undefined);
    expect(tapToPayAcceptanceFor(getTapToPaySession(), "b1")).toBe("accepted");
    expect(tapToPayAcceptanceFor(getTapToPaySession(), "b2")).toBe("unknown");
    expect(tapToPayAcceptanceFor(getTapToPaySession(), null)).toBe("unknown");
  });

  test("the hint is per brand and the old phone-wide flag goes away", async () => {
    resetTapToPayWarmHintForTests();
    await markTapToPayWarmHint("b1");
    expect(await readTapToPayWarmHint("b1")).toBe(true);
    expect(await readTapToPayWarmHint("b2")).toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(tapToPayWarmHintKey("b1"), "1");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(TAP_TO_PAY_LEGACY_SETUP_KEY);
  });

  test("the setup store is never read for iPhone status", () => {
    const code = fs.readFileSync(path.join(BIZ_ROOT, "src/hooks/useTapToPayAvailability.ts"), "utf8");
    expect(code).not.toContain("readTapToPaySetupComplete");
    const pure = code.slice(code.indexOf("export const tapToPayNeedsSetup"), code.indexOf("export const currentTapToPayDevice"));
    expect(pure).toContain('acceptance === "not_accepted" || (acceptance === "unknown" && !hint)');
  });

  test.each([
    ["3930", "terms_not_accepted"],
    ["2960", "icloud_required"],
    ["2970", "terms_cancelled"],
    ["3940", "terms_failed"],
    ["3910", "prepare_failed"],
    ["3920", "device_banned"],
    ["3950", "merchant_blocked"],
    ["3960", "merchant_blocked"],
    ["3970", "merchant_blocked"],
  ])("native %s classifies as %s, whatever the SDK's shared code says", (nativeErrorCode, kind) => {
    for (const code of ["DECLINED_BY_STRIPE_API", "READER_SOFTWARE_UPDATE_FAILED", "UNSUPPORTED_OPERATION"]) {
      expect(classifyTerminalError({ code, nativeErrorCode })).toBe(kind);
    }
  });

  test("a blocked merchant is not a broken phone and not a declined card", () => {
    expect(classifyTerminalError({ code: "TAP_TO_PAY_READER_MERCHANT_BLOCKED" })).toBe("merchant_blocked");
    expect(classifyTerminalError({ code: "DECLINED_BY_STRIPE_API", nativeErrorCode: "3970" })).not.toBe("declined");
  });

  test("the sale goes to setup on 3930 and never asks for terms itself", async () => {
    const ensure = jest.fn(async () => ({ error: { nativeErrorCode: "3930" } }));
    const states: string[] = [];
    const flow = new TapToPaySaleFlow({
      eventId: "e1",
      draft: { lines: [], eventDateId: null, buyerPhone: null, phoneCountryIso: null } as never,
      clientRequestId: "r1",
      terminal: {
        ensureReaderConnected: ensure as never,
        retrievePaymentIntent: jest.fn(async () => ({})),
        collectPaymentMethod: jest.fn(async () => ({})),
        confirmPaymentIntent: jest.fn(async () => ({})),
        cancelCollectPaymentMethod: jest.fn(async () => ({})),
      },
      server: {
        createIntent: async () =>
          ({ paymentIntentId: "pi_1", clientSecret: "s", totalCents: 100, currency: "GBP", stripeAccountId: "a", locationId: "tml" }),
        completeIntent: jest.fn() as never,
        cancelIntent: jest.fn() as never,
      },
      onState: (state) => states.push(state.kind),
    });
    await flow.start();
    expect(states[states.length - 1]).toBe("needs_setup");
    expect(ensure).toHaveBeenCalledWith("tml", { mayAcceptTerms: false });
  });

  test("setup names each Apple problem, on the platform's own name", async () => {
    const result = await runTapToPaySetup(
      makeSetupDeps({ ensureReaderConnected: async () => ({ error: { nativeErrorCode: "3970" } }) }),
    );
    expect(result).toEqual({
      kind: "failed",
      message: "Tap to Pay on iPhone is off for this brand. Contact Mingla support. Use a pay code for now.",
    });
    expect(tapReaderProblemCopy("merchant_blocked", "android")).not.toContain("iPhone");
    expect(tapReaderProblemCopy("prepare_failed", "android")).not.toContain("iPhone");
  });
});

describe("B5 terms are allowed in one place", () => {
  test("the connect parameter is the only tosAcceptancePermitted, and never a literal true", () => {
    const host = fs.readFileSync(path.join(BIZ_ROOT, "src/components/door/tap/TapToPayTerminalHost.tsx"), "utf8");
    expect(host).toContain("tosAcceptancePermitted: mayAcceptTerms");
    expect(host).not.toMatch(/tosAcceptancePermitted:\s*true/);
    expect(host).toContain('options?.mayAcceptTerms === true');
  });
});

describe("B6 warm-up", () => {
  const harness = (overrides: Partial<TapToPayWarmUpDeps> = {}) => {
    let clock = 1_000_000;
    const connect = jest.fn(async () => ({}));
    const report = jest.fn();
    const warmUp = new TapToPayWarmUp({
      isLive: () => true,
      readHint: async () => true,
      fetchLocation: async () => "tml_1",
      connect,
      now: () => clock,
      report,
      ...overrides,
    });
    return { warmUp, connect, report, advance: (ms: number) => (clock += ms) };
  };

  test("with a hint it connects, never allowing Apple's terms", async () => {
    const h = harness();
    await h.warmUp.trigger();
    expect(h.connect).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: false });
  });

  test("no hint, no connect, and no Location asked for", async () => {
    const fetchLocation = jest.fn(async () => "tml_1");
    const h = harness({ readHint: async () => false, fetchLocation });
    await h.warmUp.trigger();
    expect(fetchLocation).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  test("not live, no connect", async () => {
    const h = harness({ isLive: () => false });
    await h.warmUp.trigger();
    expect(h.connect).not.toHaveBeenCalled();
  });

  test("the foreground re-fires only after the throttle", async () => {
    const h = harness();
    await h.warmUp.trigger();
    h.advance(TAP_WARM_THROTTLE_MS - 1);
    await h.warmUp.trigger();
    expect(h.connect).toHaveBeenCalledTimes(1);
    h.advance(1);
    await h.warmUp.trigger();
    expect(h.connect).toHaveBeenCalledTimes(2);
  });

  test("a failed warm-up is reported and throws nothing", async () => {
    const failed = harness({ connect: async () => ({ error: { nativeErrorCode: "3930" } }) });
    await expect(failed.warmUp.trigger()).resolves.toBe(true);
    expect(failed.report).toHaveBeenCalledTimes(1);
    const thrown = harness({
      fetchLocation: async () => {
        throw new Error("offline");
      },
    });
    await expect(thrown.warmUp.trigger()).resolves.toBe(true);
    expect(thrown.report).toHaveBeenCalledTimes(1);
  });

  test("the press timer is measured once per press", () => {
    markDoorTapPress(true, 1000);
    expect(consumeDoorTapPress(1450)).toEqual({ ms: 450, warm: true });
    expect(consumeDoorTapPress(2000)).toBeNull();
  });
});

describe("B7 progress from the SDK", () => {
  test("a string becomes 0 to 1, anything else reads as unknown", () => {
    expect(parseTapProgress("0.4")).toBe(0.4);
    expect(parseTapProgress("1.7")).toBe(1);
    expect(parseTapProgress("-1")).toBe(0);
    expect(parseTapProgress("soon")).toBeNull();
    expect(parseTapProgress("")).toBeNull();
    expect(parseTapProgress(undefined)).toBeNull();
  });
  test("the host passes the SDK's four callbacks", () => {
    const host = fs.readFileSync(path.join(BIZ_ROOT, "src/components/door/tap/TapToPayTerminalHost.tsx"), "utf8");
    for (const name of [
      "onDidStartInstallingUpdate",
      "onDidReportReaderSoftwareUpdateProgress",
      "onDidFinishInstallingUpdate",
      "onDidAcceptTermsOfService",
    ]) {
      expect(host).toContain(name);
    }
  });
});

describe("B8 the mark", () => {
  test("iPhone uses Apple's SF Symbol only, loaded lazily, with no fallback art", () => {
    const icon = fs.readFileSync(path.join(BIZ_ROOT, "src/components/door/tap/TapToPayIcon.tsx"), "utf8");
    expect(icon).toContain('"wave.3.right.circle.fill"');
    expect(icon).toContain('require("expo-symbols")');
    expect(icon).not.toMatch(/^import .*expo-symbols/m);
    expect(icon).toContain("if (SymbolView === null) return null;");
  });
});

describe("B9 every Android string stays clear of the iPhone", () => {
  test("the copy functions take the platform", () => {
    const { tapEducationRows, tapToPayName, tapConfiguringTitle, tapToPaySetupButtonLabel, tapOnboardingCopy } =
      jest.requireActual<typeof import("../../../constants/tapToPayCopy")>("../../../constants/tapToPayCopy");
    const android = [
      tapToPayName("android"),
      tapConfiguringTitle("android"),
      tapToPaySetupButtonLabel("android"),
      JSON.stringify(tapEducationRows("android", { pinRow: true })),
      JSON.stringify(tapOnboardingCopy("android")),
    ].join(" ");
    expect(android).not.toContain("iPhone");
    expect(android).not.toContain("Apple's terms");
  });
  test("Settings and Payments each have the entry, and the route exists", () => {
    const read = (rel: string): string => fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");
    expect(read("app/(tabs)/account.tsx")).toContain("const tapToPayEntry = useTapToPaySettingsEntry(useCurrentBrandId());");
    expect(read("app/(tabs)/account.tsx")).toContain("{tapToPayEntry !== null ? (");
    expect(read("app/(tabs)/account.tsx")).toContain('"/account/tap-to-pay"');
    expect(read("src/components/brand/BrandPaymentsView.tsx")).toContain("tapToPayBrandEligible(brand)");
    expect(fs.existsSync(path.join(BIZ_ROOT, "app/account/tap-to-pay.tsx"))).toBe(true);
  });
});

// Shared components that existing suites load under the stock Jest config (which
// doesn't transform expo-router) never import expo-router at module scope: the
// route owns navigation and passes the callback down. Reverting the card to its
// own useRouter fails this (and the #3645 BrandOnboardView suites fail to load).
describe("#4271 Tap to Pay entries take navigation from their route", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");
  const EXPO_ROUTER_IMPORT = /^\s*import\b[^;]*from\s+["']expo-router["']/m;
  test.each([
    "src/components/door/tap/TapToPayOnboardingCard.tsx",
    "src/components/brand/BrandOnboardView.tsx",
    "src/components/brand/BrandPaymentsView.tsx",
  ])("%s has no module-scope expo-router import", (rel) => {
    const source = read(rel);
    expect(source).not.toMatch(EXPO_ROUTER_IMPORT);
    expect(source).not.toMatch(/\buseRouter\s*\(/);
  });
  test("each route passes a callback that opens Tap to Pay setup for its brand", () => {
    const onboard = read("app/brand/[id]/payments/onboard.tsx");
    expect(onboard).toContain("onOpenTapToPay={brandId !== null ? handleOpenTapToPay : undefined}");
    expect(onboard).toContain("`/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}`");
    const payments = read("app/brand/[id]/payments/index.tsx");
    expect(payments).toContain("onOpenTapToPay={handleOpenTapToPay}");
    expect(payments).toContain("`/account/tap-to-pay?brandId=${encodeURIComponent(brand.id)}`");
  });
});

describe("B10 where the card goes", () => {
  test("complete-active and already-active have it, complete-verifying does not", () => {
    const view = fs.readFileSync(path.join(BIZ_ROOT, "src/components/brand/BrandOnboardView.tsx"), "utf8");
    expect(view.match(/<TapToPayOnboardingCard brand=\{brand\} onSetUp=\{onOpenTapToPay\} \/>/g)).toHaveLength(2);
    const verifying = view.slice(view.indexOf('viewState === "complete-verifying" ? ('));
    expect(verifying.slice(0, 1200)).not.toContain("TapToPayOnboardingCard");
  });
  test("the modal is a sibling of the Stack and the assets are unset until the toolkit lands", () => {
    expect(fs.readFileSync(path.join(BIZ_ROOT, "app/_layout.tsx"), "utf8")).toContain("<TapToPayAwarenessModal />");
    expect(fs.readFileSync(path.join(BIZ_ROOT, "src/constants/tapToPayMarketing.ts"), "utf8")).toContain(
      "TAP_TO_PAY_AWARENESS: TapToPayAwarenessAssets | null = null",
    );
  });
});

describe("B11 source rule", () => {
  test('name="tap" only appears behind an Android branch or in TapToPayIcon', () => {
    const dir = path.join(BIZ_ROOT, "src/components/door/tap");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".tsx") || file === "TapToPayIcon.tsx") continue;
      const code = fs.readFileSync(path.join(dir, file), "utf8");
      expect([file, /icon="tap"|icon="phone"/.test(code)]).toEqual([file, false]);
      const at = code.indexOf('name="tap"');
      if (at !== -1) expect(code.slice(Math.max(0, at - 200), at)).toContain('Platform.OS === "android"');
    }
  });
});

describe("B12 each outcome from each code", () => {
  const flow = (terminal: Record<string, unknown> = {}) => {
    const states: Array<Record<string, unknown>> = [];
    const f = new TapToPaySaleFlow({
      eventId: "e1",
      draft: { lines: [], eventDateId: null, buyerPhone: null, phoneCountryIso: null } as never,
      clientRequestId: "r1",
      terminal: {
        ensureReaderConnected: async () => ({}),
        retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
        collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1" } }),
        confirmPaymentIntent: async () => ({ paymentIntent: { id: "pi_1", status: "succeeded" } }),
        cancelCollectPaymentMethod: async () => ({}),
        ...terminal,
      } as never,
      server: {
        createIntent: async () =>
          ({ paymentIntentId: "pi_1", clientSecret: "s", totalCents: 100, currency: "GBP", stripeAccountId: "a", locationId: "tml", feeCents: 5, subtotalCents: 95 }),
        completeIntent: async () => ({ orderId: "o", ticketIds: [], receiptQueued: false, replayed: false }),
        cancelIntent: async () => undefined,
      },
      onState: (state) => states.push(state as never),
    });
    return { f, states, last: () => states[states.length - 1]?.kind };
  };

  test("CARD_READ_TIMED_OUT is timed_out", async () => {
    const h = flow({ collectPaymentMethod: async () => ({ error: { code: "CARD_READ_TIMED_OUT" } }) });
    await h.f.start();
    expect(h.last()).toBe("timed_out");
  });

  test("confirm with no PaymentIntent back is unknown, whatever the error says", async () => {
    for (const error of [{ code: "STRIPE_API_ERROR" }, { code: "DECLINED_BY_STRIPE_API" }, {}]) {
      const h = flow({ confirmPaymentIntent: async () => ({ error }) });
      await h.f.start();
      expect(h.last()).toBe("unknown_result");
    }
  });

  test("REQUEST_TIMED_OUT during confirm is unknown even with a PaymentIntent", async () => {
    const h = flow({
      confirmPaymentIntent: async () => ({ error: { code: "REQUEST_TIMED_OUT", paymentIntent: { status: "requires_payment_method" } } }),
    });
    await h.f.start();
    expect(h.last()).toBe("unknown_result");
  });

  test('"Nothing was charged" only when Stripe says requires_payment_method', async () => {
    const said = flow({
      confirmPaymentIntent: async () => ({ error: { code: "OTHER", paymentIntent: { status: "requires_payment_method" } } }),
    });
    await said.f.start();
    expect(said.last()).toBe("declined");
    const unsure = flow({
      confirmPaymentIntent: async () => ({ error: { code: "OTHER", paymentIntent: { status: "processing" } } }),
    });
    await unsure.f.start();
    expect(unsure.last()).toBe("unknown_result");
    const declinedButProcessing = flow({
      confirmPaymentIntent: async () => ({
        error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { status: "processing" } },
      }),
    });
    await declinedButProcessing.f.start();
    expect(declinedButProcessing.last()).toBe("unknown_result");
  });

  test("a retried confirm that succeeded records the sale", async () => {
    let calls = 0;
    const h = flow({
      confirmPaymentIntent: async () => {
        calls += 1;
        return calls === 1 ? { error: {} } : { paymentIntent: { id: "pi_1", status: "succeeded" } };
      },
    });
    await h.f.start();
    await h.f.retryConfirm();
    expect(h.last()).toBe("approved");
  });

  test("closing cancels an open intent, but never one mid-confirm or paid", async () => {
    const cancel = jest.fn(async () => undefined);
    const open = new TapToPaySaleFlow({
      eventId: "e1",
      draft: { lines: [], eventDateId: null, buyerPhone: null, phoneCountryIso: null } as never,
      clientRequestId: "r1",
      terminal: {
        ensureReaderConnected: async () => ({}),
        retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
        collectPaymentMethod: async () => ({ error: { code: "CANCELED" } }),
        confirmPaymentIntent: async () => ({}),
        cancelCollectPaymentMethod: async () => ({}),
      } as never,
      server: {
        createIntent: async () =>
          ({ paymentIntentId: "pi_1", clientSecret: "s", totalCents: 100, currency: "GBP", stripeAccountId: "a", locationId: "tml", feeCents: 0, subtotalCents: 100 }),
        completeIntent: jest.fn() as never,
        cancelIntent: cancel,
      },
      onState: () => undefined,
    });
    await open.start();
    await open.closeSale();
    expect(cancel).toHaveBeenCalledTimes(1);
    const paid = flow();
    await paid.f.start();
    expect(paid.last()).toBe("approved");
    const before = paid.states.length;
    await paid.f.closeSale();
    expect(paid.states.length).toBe(before);
  });

  test("the receipt names the outcome and the fee, never a person", () => {
    const base = {
      eventName: "Night",
      brandName: "Door",
      totalCents: 3135,
      feeCents: 135,
      currency: "GBP",
      cardLabel: "Visa contactless ending 4242",
      whenIso: "2026-11-05T20:00:00.000Z",
      paymentIntentId: "pi_abcdefgh12345678",
    };
    const approved = buildTapReceiptText({ ...base, outcome: "approved" });
    expect(approved).toContain("Approved.");
    expect(approved).toContain("Reference: 12345678");
    expect(approved).not.toContain("pi_abcdefgh");
    expect(approved).toContain("£1.35");
    const declined = buildTapReceiptText({ ...base, outcome: "declined", feeCents: 0 });
    expect(declined).toContain("Not approved. No money was taken.");
    expect(declined).not.toContain("Includes fees");
    expect(`${approved}${declined}`).not.toMatch(/@|\+\d{6}/);
  });
});

describe("B13 the app says what the host saw", () => {
  test("an end state counts only with the app in front of someone", () => {
    expect(shouldReportTapSeen("declined", "active")).toBe(true);
    expect(shouldReportTapSeen("declined", "background")).toBe(false);
    expect(shouldReportTapSeen("declined", "inactive")).toBe(false);
  });
  test("a sale still open doesn't count: the sweep must still finish it", () => {
    for (const kind of ["ready", "reading", "saving", "unknown_result", "save_failed", "starting"] as const) {
      expect(shouldReportTapSeen(kind, "active")).toBe(false);
    }
  });
  test("the push uses the short name, routes to the door and has a template", () => {
    const { BUSINESS_NOTIFICATION_TEMPLATES } = jest.requireActual<
      typeof import("../../../constants/businessNotificationTemplates")
    >("../../../constants/businessNotificationTemplates");
    const template = BUSINESS_NOTIFICATION_TEMPLATES["business.door_tap_not_completed"];
    expect(template.pushBody).toContain("Tap to Pay sale");
    expect(template.pushBody).not.toContain("iPhone");
    const routing = fs.readFileSync(path.join(BIZ_ROOT, "src/services/businessNotificationRouting.ts"), "utf8");
    // Retest 4 P3-C: the paid-unseen push shares this case.
    expect(routing).toMatch(
      /business\.door_tap_not_completed":\s*(?:case "business\.door_tap_paid_unseen":\s*)?return eventId \? `\/event\/\$\{eventId\}\/door`/,
    );
  });
  test("retest 4 P3-C: the paid-unseen push says the card was charged, matches the server, and routes to the door", () => {
    const { BUSINESS_NOTIFICATION_TEMPLATES } = jest.requireActual<
      typeof import("../../../constants/businessNotificationTemplates")
    >("../../../constants/businessNotificationTemplates");
    const template = BUSINESS_NOTIFICATION_TEMPLATES["business.door_tap_paid_unseen"];
    expect(template.pushTitle).toBe("Door card payment went through");
    expect(template.pushBody).toContain("went through");
    expect(template.pushBody).toContain("Don't take this payment again.");
    expect(template.pushBody).not.toMatch(/no money|wasn't approved|iPhone/i);
    const server = fs.readFileSync(path.join(BIZ_ROOT, "../supabase/functions/door-tap-intent/index.ts"), "utf8");
    const serverBody = /doorTapPaidUnseenBody = \(eventTitle: string\): string =>\s*`([^`]+)`/.exec(server)?.[1];
    expect(serverBody?.replace("${eventTitle}", "{eventTitle}")).toBe(template.pushBody);
    expect(server).toContain('title: "Door card payment went through"');
    const routing = fs.readFileSync(path.join(BIZ_ROOT, "src/services/businessNotificationRouting.ts"), "utf8");
    expect(routing).toMatch(/case "business\.door_tap_paid_unseen":\s*return eventId \? `\/event\/\$\{eventId\}\/door`/);
  });
});

describe("override 7: never a second way to pay while the result is unknown", () => {
  test("an unknown result whose cancel failed refuses the pay code", async () => {
    const report = jest.fn();
    const flow = new TapToPaySaleFlow({
      eventId: "e1",
      draft: { lines: [], eventDateId: null, buyerPhone: null, phoneCountryIso: null } as never,
      clientRequestId: "r1",
      terminal: {
        ensureReaderConnected: async () => ({}),
        retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
        collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1" } }),
        confirmPaymentIntent: async () => ({ error: {} }),
        cancelCollectPaymentMethod: async () => ({}),
      } as never,
      server: {
        createIntent: async () =>
          ({ paymentIntentId: "pi_1", clientSecret: "s", totalCents: 100, currency: "GBP", stripeAccountId: "a", locationId: "tml" }),
        completeIntent: jest.fn() as never,
        cancelIntent: async () => {
          throw new Error("offline");
        },
      },
      onState: () => undefined,
      report,
    });
    await flow.start();
    expect(flow.getState().kind).toBe("unknown_result");
    await expect(flow.abandonForPayCode()).resolves.toBe("blocked");
    expect(report).toHaveBeenCalled();
  });
});
