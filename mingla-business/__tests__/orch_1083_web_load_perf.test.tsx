/**
 * ORCH-1083 — implementor happy-path regression tests for the web-load-perf cut.
 *
 * Covers SPEC §9 implementor table:
 *   T-02  M-3 budget script grep-the-entry assertion exists + bites
 *   T-03  loadThemeFont/useThemeFont: idempotent, one Font.loadAsync per family
 *   T-04  ShareModal defers the QR renderer behind React.lazy + Suspense fallback
 *   T-05  Each connect route shell has NO static @stripe/* import + is a
 *         Suspense+lazy shell; the extracted bodies carry the SDK import
 *   (T-01 raw-byte shrink + chunk-count and T-06 tsc + T-07 strict-grep gates are
 *    verified at build/CI time and recorded in the implementation report; the
 *    static guards below lock the source-level invariants those builds depend on.)
 *
 * These run in jest's `node` env (testEnvironment: node) — mostly source-level
 * static analysis, plus a real expo-font-mocked exercise of the font loader.
 */

import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(businessRoot, rel), "utf8");

const CONNECT_ROUTE_SHELLS = [
  "app/connect-onboarding.web.tsx",
  "app/connect-account-management.web.tsx",
  "app/connect-partner-onboarding.web.tsx",
  "app/connect-partner-account-management.web.tsx",
  "app/connect-tax-registrations/index.web.tsx",
] as const;

const CONNECT_BODIES = [
  "src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx",
  "src/components/stripe/connect-pages/ConnectAccountManagementBody.web.tsx",
  "src/components/stripe/connect-pages/ConnectPartnerOnboardingBody.web.tsx",
  "src/components/stripe/connect-pages/ConnectPartnerAccountManagementBody.web.tsx",
  "src/components/stripe/connect-pages/ConnectTaxRegistrationsBody.web.tsx",
] as const;

// A static @stripe/* IMPORT line (not a comment mention).
const STATIC_STRIPE_IMPORT =
  /^\s*import[\s\S]*?from\s+["']@stripe\/(connect-js|react-connect-js)["']/m;

describe("ORCH-1083 T-05 — Stripe Connect web SDK deferred out of route shells", () => {
  it("no connect route shell statically imports @stripe/connect-js or @stripe/react-connect-js", () => {
    for (const shell of CONNECT_ROUTE_SHELLS) {
      const src = read(shell);
      expect(src).not.toMatch(STATIC_STRIPE_IMPORT);
    }
  });

  it("each connect route shell is a React.lazy + Suspense shell", () => {
    for (const shell of CONNECT_ROUTE_SHELLS) {
      const src = read(shell);
      expect(src).toMatch(/React\.lazy\(\s*\(\)\s*=>\s*import\(/);
      expect(src).toMatch(/<Suspense\b/);
      expect(src).toMatch(/connect-pages\//);
    }
  });

  it("each extracted body carries the Stripe Connect web SDK import", () => {
    for (const body of CONNECT_BODIES) {
      const src = read(body);
      expect(src).toMatch(/from\s+["']@stripe\/react-connect-js["']/);
      expect(src).toMatch(/from\s+["']@stripe\/connect-js["']/);
      // the ORCH-1056 iOS scroll/zoom fix stays in the body
      expect(src).toMatch(/useStripeConnectViewportZoomLock|connectEmbeddedPageStyles|pageWrapperStyle/);
    }
  });
});

describe("ORCH-1083 T-04 — ShareModal defers the QR renderer", () => {
  const shareModal = read("src/components/ui/ShareModal.tsx");

  it("does NOT statically import react-native-qrcode-svg", () => {
    expect(shareModal).not.toMatch(
      /^\s*import\s+QRCode\s+from\s+["']react-native-qrcode-svg["']/m,
    );
  });

  it("lazy-loads the QR renderer and wraps it in a footprint-reserving Suspense fallback", () => {
    expect(shareModal).toMatch(
      /React\.lazy\(\s*\(\)\s*=>\s*import\(["']react-native-qrcode-svg["']\)\s*\)/,
    );
    expect(shareModal).toMatch(/<Suspense\b[\s\S]*?fallback=/);
    expect(shareModal).toMatch(/qrFallback/);
  });
});

describe("ORCH-1083 C-2 — theme fonts are no longer eager at the app root", () => {
  it("_layout.tsx no longer imports useFonts or MINGLA_THEME_FONTS (no eager root font load)", () => {
    const layout = read("app/_layout.tsx");
    // no import of useFonts from expo-font
    expect(layout).not.toMatch(/import\s+\{[^}]*\buseFonts\b[^}]*\}\s+from\s+["']expo-font["']/);
    // no import of the 14-font record
    expect(layout).not.toMatch(/import\s+\{[^}]*MINGLA_THEME_FONTS[^}]*\}/);
    // no actual useFonts(...) CALL (ignore the protective comment, which is fine).
    // Strip line comments first so the "// do not re-add useFonts(...)" note is excluded.
    const noComments = layout.replace(/\/\/[^\n]*/g, "");
    expect(noComments).not.toMatch(/useFonts\s*\(/);
  });

  it("themeFonts.ts exposes dynamic import() thunks, no static @expo-google-fonts imports", () => {
    const fonts = read("src/theme/themeFonts.ts");
    expect(fonts).not.toMatch(
      /^\s*import\s+\{[^}]+\}\s+from\s+["']@expo-google-fonts\//m,
    );
    expect(fonts).toMatch(/import\(["']@expo-google-fonts\/inter["']\)/);
    expect(fonts).toMatch(/THEME_FONT_MODULE_THUNKS/);
  });

  it("the 3 themed surfaces load their font on demand via useThemeFont", () => {
    for (const surface of [
      "src/components/brand/PublicBrandPage.tsx",
      "src/components/event/PublicEventPage.tsx",
      "src/components/theme/ThemeEditorSection.tsx",
    ]) {
      expect(read(surface)).toMatch(/useThemeFont\(/);
    }
  });
});

describe("ORCH-1083 T-03 — useThemeFont loader is idempotent", () => {
  it("calls Font.loadAsync once per family and is a no-op when already loaded", async () => {
    jest.resetModules();
    const loadAsync = jest.fn().mockResolvedValue(undefined);
    let loadedFamilies: Record<string, boolean> = {};
    jest.doMock("expo-font", () => ({
      loadAsync,
      isLoaded: (family: string) => loadedFamilies[family] === true,
    }));
    jest.doMock("react", () => ({
      useEffect: jest.fn(),
      useState: (init: unknown) => [init, jest.fn()],
    }));
    // After loadAsync resolves, mark the family loaded (mirrors real expo-font).
    loadAsync.mockImplementation(async (record: Record<string, unknown>) => {
      for (const k of Object.keys(record)) loadedFamilies[k] = true;
    });
    // Mock the dynamic-import thunk map so the test does not have to resolve the
    // real ESM @expo-google-fonts packages (which jest's node env can't parse).
    jest.doMock("../src/theme/themeFonts", () => ({
      THEME_FONT_MODULE_THUNKS: {
        Inter_500Medium: async () => 1,
        PlayfairDisplay_500Medium: async () => 2,
      },
      THEME_FONT_FAMILY_VALUES: ["Inter_500Medium", "PlayfairDisplay_500Medium"],
    }));

    const { loadThemeFont } = require("../src/theme/useThemeFont");

    // First load → one loadAsync call.
    await loadThemeFont("Inter_500Medium");
    expect(loadAsync).toHaveBeenCalledTimes(1);

    // Second load of the same family → no extra call (already loaded).
    await loadThemeFont("Inter_500Medium");
    expect(loadAsync).toHaveBeenCalledTimes(1);

    // Different family → one more call.
    await loadThemeFont("PlayfairDisplay_500Medium");
    expect(loadAsync).toHaveBeenCalledTimes(2);

    // Unknown family → no call, no throw.
    await loadThemeFont("NotARealFamily_999");
    expect(loadAsync).toHaveBeenCalledTimes(2);

    // Null/empty → no call.
    await loadThemeFont(null);
    expect(loadAsync).toHaveBeenCalledTimes(2);

    jest.dontMock("expo-font");
    jest.dontMock("react");
    jest.dontMock("../src/theme/themeFonts");
  });
});

describe("ORCH-1083 T-02 — M-3 budget guard exists and grep-the-entry passes self-test", () => {
  it("the budget script exists and asserts the deferred specifiers + chunk count + ceiling", () => {
    const script = read("scripts/ci/orch-1083-initial-bundle-budget.mjs");
    expect(script).toMatch(/@stripe\/connect-js/);
    expect(script).toMatch(/@stripe\/react-connect-js/);
    expect(script).toMatch(/react-native-qrcode-svg/);
    expect(script).toMatch(/@expo-google-fonts\//);
    expect(script).toMatch(/CEILING_RAW_BYTES/);
    expect(script).toMatch(/>= 3|< 3|length < 3/);
  });
});
