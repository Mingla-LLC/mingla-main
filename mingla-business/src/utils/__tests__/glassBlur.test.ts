/**
 * ORCH-1100 RC-2 — shared glass-blur fallback helper.
 *
 * `utils/glassBlur.shouldUseRealBlur(windowWidth)` is the SINGLE source of truth
 * for "render a real backdrop blur vs an opaque fallback fill?" across every
 * glass surface (SheetMobile, TopSheet, GlassChrome, Toast, BlastCustomersCta,
 * AiDisclosureModal). It must encode three opaque-fallback cases:
 *   - Android (expo-blur backdrop too thin)
 *   - web without `backdrop-filter` support
 *   - web on phones (< 768px) where the injected blur-kill media rule strips
 *     `backdrop-filter` even though CSS.supports() still reports true
 *
 * jest.config.cjs uses `testEnvironment: node` with no jsdom, so we mock
 * `react-native` to a minimal `{ Platform }` and drive `Platform.OS` per case.
 * This exercises the REAL helper logic (not a source grep) — it fails on revert
 * if the width-aware blur-kill branch is removed.
 */

import { describe, expect, test, jest, beforeEach } from "@jest/globals";

// Minimal react-native mock — only Platform is needed by glassBlur.
const platform = { OS: "ios" as "ios" | "android" | "web" };
jest.mock("react-native", () => ({
  get Platform() {
    return platform;
  },
}));

// The helper reads `globalThis.CSS.supports` once at module scope for the web
// support probe. Provide a stub that reports backdrop-filter as supported so we
// can isolate the WIDTH branch (the blur-kill) from the support branch.
(globalThis as { CSS?: unknown }).CSS = {
  supports: () => true,
};

// Import AFTER the mock + CSS stub are in place.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHelper = (): typeof import("../glassBlur") => {
  let mod: typeof import("../glassBlur") | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../glassBlur");
  });
  if (mod === undefined) throw new Error("glassBlur failed to load");
  return mod;
};

describe("ORCH-1100 — shouldUseRealBlur(windowWidth)", () => {
  beforeEach(() => {
    platform.OS = "ios";
  });

  test("iOS always uses real blur (width irrelevant)", () => {
    platform.OS = "ios";
    const { shouldUseRealBlur } = loadHelper();
    expect(shouldUseRealBlur(320)).toBe(true);
    expect(shouldUseRealBlur(1440)).toBe(true);
  });

  test("Android always uses the opaque fallback (width irrelevant)", () => {
    platform.OS = "android";
    const { shouldUseRealBlur } = loadHelper();
    expect(shouldUseRealBlur(320)).toBe(false);
    expect(shouldUseRealBlur(1440)).toBe(false);
  });

  test("phone web (< 768px) uses the opaque fallback — the RC-2 blur-kill case", () => {
    platform.OS = "web";
    const { shouldUseRealBlur } = loadHelper();
    // Below the 768px breakpoint the injected media rule strips backdrop-filter,
    // so a BlurView renders transparent → MUST fall back to opaque.
    expect(shouldUseRealBlur(767)).toBe(false);
    expect(shouldUseRealBlur(390)).toBe(false);
  });

  test("desktop web (>= 768px) keeps real blur when backdrop-filter is supported", () => {
    platform.OS = "web";
    const { shouldUseRealBlur } = loadHelper();
    expect(shouldUseRealBlur(768)).toBe(true);
    expect(shouldUseRealBlur(1280)).toBe(true);
  });

  test("breakpoint constant matches the inject-mobile-blur-css media rule (768)", () => {
    const { MOBILE_WEB_BLUR_KILL_MAX_WIDTH } = loadHelper();
    expect(MOBILE_WEB_BLUR_KILL_MAX_WIDTH).toBe(768);
  });
});
