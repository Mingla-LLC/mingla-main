/**
 * ORCH-1378 / ORCH-1380 — T-20 / T-21: the `.web.*` shim exports that were
 * MISSING and threw live TypeErrors in production.
 *
 * These tests IMPORT THE REAL SHIMS and CALL the restored exports. A test that
 * merely asserted the source text contains the name would be decorative — the
 * bug was a runtime `is not a function`, so the proof must be a runtime call.
 *
 * WHY TYPESCRIPT NEVER CAUGHT THIS: `tsc` resolves `./appsFlyerService` to the
 * NATIVE module (moduleSuffixes unset); Metro substitutes the `.web.*` override
 * at bundle time. Typecheck GREEN, shipped web bundle broken. The structural fix
 * is the CI parity gate (i-1378-web-shim-export-parity.mjs); these tests pin the
 * two specific live bugs.
 */

import * as appsFlyerWeb from "../appsFlyerService.web";
import * as oneSignalWeb from "../oneSignalService.web";

describe("ORCH-1378 — appsFlyerService.web shim (T-20)", () => {
  it("EXPORTS subscribeOneLinkDeepLink as a callable function (the live root-_layout TypeError, 3/3)", () => {
    expect(typeof appsFlyerWeb.subscribeOneLinkDeepLink).toBe("function");
  });

  it("subscribeOneLinkDeepLink does not throw when called the way _layout.tsx:518 calls it", () => {
    expect(() => {
      appsFlyerWeb.subscribeOneLinkDeepLink(() => {
        throw new Error("the sink must never be invoked on web");
      });
    }).not.toThrow();
  });

  it("subscribeOneLinkDeepLink returns void — EXACT parity with the native twin (appsFlyerService.ts:257)", () => {
    // The native fn stores the sink and returns nothing; _layout does not read
    // the return. Returning an unsubscribe fn here would be a native/web
    // signature divergence — the class this shim exists to close.
    expect(appsFlyerWeb.subscribeOneLinkDeepLink(() => undefined)).toBeUndefined();
  });

  it("EXPORTS resolveBusinessOneLinkDestination as a callable function", () => {
    expect(typeof appsFlyerWeb.resolveBusinessOneLinkDestination).toBe("function");
  });

  it("resolveBusinessOneLinkDestination returns null for every input (no web SDK produces a payload)", () => {
    expect(appsFlyerWeb.resolveBusinessOneLinkDestination(null)).toBeNull();
    expect(appsFlyerWeb.resolveBusinessOneLinkDestination(undefined)).toBeNull();
    expect(appsFlyerWeb.resolveBusinessOneLinkDestination({})).toBeNull();
    expect(
      appsFlyerWeb.resolveBusinessOneLinkDestination({
        deep_link_value: "referral",
        deep_link_sub1: "CODE",
      }),
    ).toBeNull();
  });
});

describe("ORCH-1380 — oneSignalService.web shim (T-21)", () => {
  it("EXPORTS syncPushPermissionTag as a callable function (the live every-tab-refocus TypeError)", () => {
    expect(typeof oneSignalWeb.syncPushPermissionTag).toBe("function");
  });

  it("syncPushPermissionTag resolves without throwing, as _layout.tsx:654 calls it", async () => {
    await expect(oneSignalWeb.syncPushPermissionTag()).resolves.toBeUndefined();
  });

  it("EXPORTS canRequestPushPermission as a callable function", () => {
    expect(typeof oneSignalWeb.canRequestPushPermission).toBe("function");
  });

  it("canRequestPushPermission resolves false (no SDK on web — never prompt)", async () => {
    await expect(oneSignalWeb.canRequestPushPermission()).resolves.toBe(false);
  });
});
