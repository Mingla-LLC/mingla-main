/**
 * #4389 (decision S-11) — native secure setup behind a kill switch.
 *
 * MINGLA-INVARIANT: I-4389-NATIVE-CONNECT-KILL-SWITCH | issue #4389 | The native secure setup opens only when biz_native_connect_onboarding is on for the platform (or the local non-EAS dev override), the native module is linked and no load error has fired; every other branch uses the browser sheet. Host web keeps the web component.
 *
 * FAILS-ON-REVERT: deleting any guard in decideConnectOnboardingSurface fails
 * block 1; deleting the onLoadError → browser sheet hand-off in
 * BrandOnboardView fails block 4; importing the native SDK into the web stub
 * or the web page losing ConnectAccountOnboarding fails block 5.
 */
import fs from "fs";
import path from "path";

import {
  CONNECT_ONBOARDING_COLLECTION_OPTIONS,
  CONNECT_ONBOARDING_PRIVACY_URL,
  CONNECT_ONBOARDING_TERMS_URL,
  classifyNativeConnectExit,
  decideConnectOnboardingSurface,
  nativeConnectFlagLive,
  nativeConnectLoadErrorMessage,
  type ConnectOnboardingSurfaceInput,
} from "../nativeConnectOnboarding";

const ROOT = path.resolve(__dirname, "../../../..");
const REPO = path.resolve(ROOT, "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ON: ConnectOnboardingSurfaceInput = {
  os: "ios",
  flagLive: true,
  devForce: false,
  moduleAvailable: true,
  loadFailed: false,
};

describe("#4389 S-11 — 1. which surface opens (every fallback branch)", () => {
  test("flag on, module linked, no load error → native (iPhone and Android)", () => {
    expect(decideConnectOnboardingSurface(ON)).toBe("native");
    expect(decideConnectOnboardingSurface({ ...ON, os: "android" })).toBe("native");
  });
  test("flag off → browser sheet", () => {
    expect(decideConnectOnboardingSurface({ ...ON, flagLive: false })).toBe("browser");
  });
  test("native module missing → browser sheet, even with the flag or dev override on", () => {
    expect(decideConnectOnboardingSurface({ ...ON, moduleAvailable: false })).toBe("browser");
    expect(
      decideConnectOnboardingSurface({ ...ON, moduleAvailable: false, devForce: true }),
    ).toBe("browser");
  });
  test("a load error already fired → browser sheet, even with the flag on", () => {
    expect(decideConnectOnboardingSurface({ ...ON, loadFailed: true })).toBe("browser");
    expect(
      decideConnectOnboardingSurface({ ...ON, loadFailed: true, devForce: true }),
    ).toBe("browser");
  });
  test("web never opens the native screen", () => {
    expect(decideConnectOnboardingSurface({ ...ON, os: "web" })).toBe("browser");
    expect(decideConnectOnboardingSurface({ ...ON, os: "web", devForce: true })).toBe("browser");
  });
  test("the local dev override opens native with the flag off", () => {
    expect(
      decideConnectOnboardingSurface({ ...ON, flagLive: false, devForce: true }),
    ).toBe("native");
  });
});

describe("#4389 S-11 — 2. the server switch per platform", () => {
  test("off when there is no answer, an unknown platform, or the other platform's flag", () => {
    expect(nativeConnectFlagLive("ios", null)).toBe(false);
    expect(nativeConnectFlagLive("ios", undefined)).toBe(false);
    expect(nativeConnectFlagLive("web", { iphone: true, android: true })).toBe(false);
    expect(nativeConnectFlagLive("ios", { iphone: false, android: true })).toBe(false);
    expect(nativeConnectFlagLive("android", { iphone: true, android: false })).toBe(false);
  });
  test("on only for the platform the server names", () => {
    expect(nativeConnectFlagLive("ios", { iphone: true, android: false })).toBe(true);
    expect(nativeConnectFlagLive("android", { iphone: false, android: true })).toBe(true);
  });
});

describe("#4389 S-11 — 3. leaving the native screen", () => {
  test("any account progress is finished (→ F4); none is an early close (→ K1)", () => {
    expect(classifyNativeConnectExit("complete-active")).toBe("finished");
    expect(classifyNativeConnectExit("complete-verifying")).toBe("finished");
    expect(classifyNativeConnectExit("needs-information")).toBe("finished");
    expect(classifyNativeConnectExit("failed-stripe")).toBe("finished");
    expect(classifyNativeConnectExit("session-expired")).toBe("closed-early");
  });
  test("load-error payloads always give a readable reason", () => {
    expect(nativeConnectLoadErrorMessage({ error: { message: "boom" } })).toBe("boom");
    expect(nativeConnectLoadErrorMessage({ error: { type: "api_error" } })).toBe("api_error");
    expect(nativeConnectLoadErrorMessage(null)).toBe("load_error");
  });
  test("the onboard route sends finished to F4 and an early close to F3 with K1 open", () => {
    const route = stripComments(read("app/brand/[id]/payments/onboard.tsx"));
    expect(route).toMatch(/exit === "finished"\s*\?\s*`\/brand\/\$\{id\}\/setup\?step=done`\s*:\s*`\/brand\/\$\{id\}\/setup\?step=pay&k1=1`/);
    expect(route).toMatch(/onNativeExit=\{isBrandCreateFunnel \? handleNativeExit : undefined\}/);
    const setup = read("app/brand/[id]/setup.tsx");
    expect(setup).toMatch(/openK1=\{params\.k1 === "1"\}/);
    const flow = read("src/components/brand/BrandCreationFlow.tsx");
    expect(flow).toMatch(/useState<"country" \| "pay" \| null>\(openK1 \? "pay" : null\)/);
  });
});

describe("#4389 S-11 — 4. BrandOnboardView wiring", () => {
  const view = stripComments(read("src/components/brand/BrandOnboardView.tsx"));
  test("the decision reads the server switch, the dev override, the module probe and the load-error latch", () => {
    expect(view).toMatch(/flagLive: nativeConnect\.flagLive/);
    expect(view).toMatch(/devForce: nativeConnect\.devForce/);
    expect(view).toMatch(/moduleAvailable: isNativeConnectModuleAvailable\(\)/);
    expect(view).toMatch(/loadFailed: nativeLoadFailedRef\.current/);
    expect(view).toMatch(/useNativeConnectOnboardingRelease\(brand\?\.id \?\? null\)/);
  });
  test("onLoadError latches and reopens the SAME setup link in the browser sheet", () => {
    const body = view.slice(view.indexOf("const handleNativeLoadError"));
    expect(body).toMatch(/nativeLoadFailedRef\.current = true/);
    expect(body).toMatch(/openBrowserSheetAndSettle\(session\.brandId, session\.onboardingUrl\)/);
  });
  test("the browser sheet path is unchanged (same deep link)", () => {
    expect(view).toMatch(/WebBrowser\.openAuthSessionAsync\(\s*onboardingUrl,\s*RETURN_DEEP_LINK,?\s*\)/);
  });
  test("Host web still assigns the web page (never the native screen)", () => {
    const start = view.slice(view.indexOf("const handleStart"));
    const webIdx = start.indexOf('if (Platform.OS === "web")');
    const decideIdx = start.indexOf("decideConnectOnboardingSurface(");
    expect(webIdx).toBeGreaterThan(-1);
    expect(decideIdx).toBeGreaterThan(webIdx);
    expect(start.slice(webIdx, decideIdx)).toMatch(/window\.location\.assign\(result\.onboarding_url\)/);
  });
});

describe("#4389 S-11 — 5. Host web keeps the web component; native mirrors its contract", () => {
  test("the web page still renders the web SDK's ConnectAccountOnboarding with the same props", () => {
    const web = read("src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx");
    expect(web).toMatch(/from "@stripe\/react-connect-js"/);
    expect(web).toMatch(/<ConnectAccountOnboarding[\s\S]*onExit=\{handleExit\}/);
    expect(web).toContain(`fullTermsOfServiceUrl="${CONNECT_ONBOARDING_TERMS_URL}"`);
    expect(web).toContain(`recipientTermsOfServiceUrl="${CONNECT_ONBOARDING_TERMS_URL}"`);
    expect(web).toContain(`privacyPolicyUrl="${CONNECT_ONBOARDING_PRIVACY_URL}"`);
    expect(web).toMatch(/fields: "eventually_due",\s*futureRequirements: "include"/);
    expect(CONNECT_ONBOARDING_COLLECTION_OPTIONS).toEqual({
      fields: "eventually_due",
      futureRequirements: "include",
    });
  });
  test("the web/tsc stub never imports the native SDK and is never available", () => {
    const stub = stripComments(read("src/components/stripe/ConnectOnboardingNative.tsx"));
    expect(stub).not.toMatch(/@stripe\/stripe-react-native/);
    expect(stub).toMatch(/isNativeConnectModuleAvailable = \(\): boolean => false/);
  });
  test("the native file passes the shared terms, privacy, collection, onExit, onStepChange and onLoadError", () => {
    const native = stripComments(read("src/components/stripe/ConnectOnboardingNative.native.tsx"));
    expect(native).toMatch(/fullTermsOfServiceUrl=\{CONNECT_ONBOARDING_TERMS_URL\}/);
    expect(native).toMatch(/recipientTermsOfServiceUrl=\{CONNECT_ONBOARDING_TERMS_URL\}/);
    expect(native).toMatch(/privacyPolicyUrl=\{CONNECT_ONBOARDING_PRIVACY_URL\}/);
    expect(native).toMatch(/collectionOptions=\{CONNECT_ONBOARDING_COLLECTION_OPTIONS\}/);
    expect(native).toMatch(/onExit=\{onExit\}/);
    expect(native).toMatch(/onStepChange=/);
    expect(native).toMatch(/onLoadError=/);
    // The SDK is required lazily, only after the module probe.
    expect(native).not.toMatch(/^import[^;]*from\s+["']@stripe\/stripe-react-native["']/m);
    expect(native).toMatch(/fetchBrandStripeAccountSession\(brandId, "onboarding"\)/);
    // Host copy never names the partner or says "business".
    expect(native).toMatch(/title="Secure setup"/);
  });
});

describe("#4389 S-11 — 6. the native module probe", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("react-native");
  });
  const load = (get: () => unknown): { isNativeConnectModuleAvailable: () => boolean } => {
    jest.doMock("react-native", () => ({ TurboModuleRegistry: { get } }));
    jest.doMock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
    jest.doMock("../../../services/brandStripeAccountSessionService", () => ({
      fetchBrandStripeAccountSession: jest.fn(),
    }));
    jest.doMock("../../../constants/designSystem", () => ({
      accent: { warm: "#eb7825" },
      radius: { md: 12 },
      semantic: { error: "#ef4444" },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../ConnectOnboardingNative.native");
  };
  test("module missing → false (browser sheet)", () => {
    expect(load(() => null).isNativeConnectModuleAvailable()).toBe(false);
  });
  test("probe throws → false (browser sheet)", () => {
    expect(
      load(() => {
        throw new Error("no registry");
      }).isNativeConnectModuleAvailable(),
    ).toBe(false);
  });
  test("module linked → true", () => {
    expect(load(() => ({})).isNativeConnectModuleAvailable()).toBe(true);
  });
});

describe("#4389 S-11 — 7. kill switch migration and local-only override", () => {
  test("the switch migration seeds OFF and returns only the two platform flags", () => {
    const dir = path.join(REPO, "supabase/migrations");
    const file = fs.readdirSync(dir).find((f) => /_issue_4389_native_connect_flag\.sql$/.test(f));
    expect(file).toBeDefined();
    const sql = fs.readFileSync(path.join(dir, file as string), "utf8");
    expect(sql).toContain(`'{"iphone":false,"android":false,"test_brand_ids":[]}'::jsonb`);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.biz_native_connect_onboarding\(uuid\) FROM PUBLIC, anon/);
    // Every earlier key is still allowed by the swapped constraint.
    for (const key of ["auto_steps", "brand_auto_cards", "brand_auto_since", "marketing_owner", "follow_through_since", "auto_promo_cards", "tap_to_pay_release"]) {
      expect(sql).toContain(`'${key}'`);
    }
  });
  test("app.config.js writes the dev override only locally and throws for any EAS build", () => {
    const original = { ...process.env };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appJson = require("../../../../app.json") as { expo: Record<string, unknown> };
    const run = (env: Record<string, string | undefined>): { extra?: Record<string, unknown> } => {
      jest.resetModules();
      process.env = { ...original, ...env };
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../../../../app.config.js") as
        | ((ctx: { config: Record<string, unknown> }) => { extra?: Record<string, unknown> })
        | { default: (ctx: { config: Record<string, unknown> }) => { extra?: Record<string, unknown> } };
      const fn = typeof mod === "function" ? mod : mod.default;
      return fn({ config: { ...appJson.expo } });
    };
    try {
      expect(run({ MINGLA_NATIVE_CONNECT_DEV_FORCE: undefined, EAS_BUILD_PROFILE: undefined }).extra?.nativeConnectDevForce).toBeUndefined();
      expect(run({ MINGLA_NATIVE_CONNECT_DEV_FORCE: "1", EAS_BUILD_PROFILE: undefined }).extra?.nativeConnectDevForce).toBe(true);
      expect(() => run({ MINGLA_NATIVE_CONNECT_DEV_FORCE: "1", EAS_BUILD_PROFILE: "development" })).toThrow(/local-only override/);
    } finally {
      process.env = original;
    }
  });
  test("the native SDK config plugin is registered exactly once", () => {
    const appJson = read("app.json");
    expect(appJson.match(/"@stripe\/stripe-react-native"/g)).toHaveLength(1);
    const config = stripComments(read("app.config.js"));
    expect(config).not.toMatch(/["']@stripe\/stripe-react-native["']/);
  });
});
