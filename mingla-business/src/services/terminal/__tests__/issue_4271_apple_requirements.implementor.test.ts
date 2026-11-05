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
  resetTapToPaySessionForTests,
  tapToPayAcceptanceFor,
  setTapToPayScope,
  subscribeTapToPaySession,
} from "../tapToPaySession";
import { classifyTerminalError, TapToPaySaleFlow, type TerminalErrorLike } from "../tapToPayFlow";
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

  test("eas.json sets the entitlement on development and on no other profile", () => {
    const eas = JSON.parse(fs.readFileSync(path.join(BIZ_ROOT, "eas.json"), "utf8")) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    expect(eas.build.development?.env?.MINGLA_TAP_TO_PAY_ENTITLEMENT).toBe("1");
    expect(Object.keys(eas.build)).toEqual(expect.arrayContaining(["production", "preview"]));
    for (const [name, profile] of Object.entries(eas.build)) {
      if (name === "development") continue;
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
