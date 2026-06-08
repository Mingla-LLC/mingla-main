import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shouldClearCurrentBrandId } from "../utils/currentBrandAutoClear";

// ORCH-1100 Wave 1A regression tests.
//
// TASK 1 — the mobile-web route firewall is RETIRED: the route-status resolver
//   defaults to "interactive" (the real app renders) for every signed-in
//   mobile-web route, with the safety valve narrowed to an explicit (currently
//   empty) proven-crash block-list. No signed-in mobile-web route returns the
//   recovery stub by default.
//
// TASK 2 — RC-1 auth-lock / brand-hydration resilience: the persisted brand
//   store exposes a hydration flag, the currentBrandId auto-clear is gated on
//   it (so a valid persisted id is NOT wiped during a token gap / before
//   rehydration), and the web auth client uses a bounded resilient lock.
//
// Both halves are written to FAIL ON REVERT (see the IMPLEMENTATION report's
// fails-on-revert proof).

// src/__tests__/ → mingla-business → repo root is three levels up.
const REPO_ROOT = join(__dirname, "..", "..", "..");
const businessFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

// [TEST-MOD-APPROVED ORCH-1102] ORCH-1100 emptied the mobile-web route firewall
// block-list (it never fired — dormant dead code). ORCH-1102 REMOVES the firewall
// machinery entirely (the block-list, the route-status resolver, the
// `isMobileWebRouteEntry()` UA sniff, and both stub render sites). This describe
// block is rewritten to assert the firewall is GONE rather than that its
// block-list is empty. The TASK 2 auth-lock / brand-hydration block below is
// unrelated to the firewall and is preserved verbatim.
describe("ORCH-1102 — TASK 1: mobile-web route firewall is REMOVED entirely", () => {
  const layout = stripComments(businessFile("app/_layout.tsx"));

  test("the firewall block-list and route-status resolver are gone", () => {
    expect(layout).not.toContain("ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES");
    expect(layout).not.toContain("orch1093RouteStatus");
    expect(layout).not.toContain("ORCH_1093_SIGNED_IN_ROUTE_STATUS");
    expect(layout).not.toContain('?? "static-section"');
  });

  test("the mobile-web UA sniff and the route-recovery stubs are gone", () => {
    expect(layout).not.toContain("isMobileWebRouteEntry");
    expect(layout).not.toContain("Orch1093MobileRouteRecovery");
    expect(layout).not.toContain("shouldShowMobileRouteRecovery");
    expect(layout).not.toContain("EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS");
  });

  test("auth routing is route-agnostic — every route redirects to the real sign-in screen", () => {
    expect(layout).toContain("shouldRedirectToSignIn");
    expect(layout).toContain("isWebAuthResolving");
    expect(layout).toContain('<Redirect href="/" />');
  });
});

describe("ORCH-1100 Wave 1A — TASK 2: auth-lock / brand-hydration resilience", () => {
  test("the persisted brand store exposes a hydration flag wired to onRehydrateStorage", () => {
    const store = stripComments(businessFile("src/store/currentBrandStore.ts"));
    expect(store).toContain("hasHydrated");
    expect(store).toContain("onRehydrateStorage");
    expect(store).toContain("setHasHydrated(true)");
    expect(store).toContain("useCurrentBrandHasHydrated");
    // hasHydrated must NOT be persisted — it has to start false on a fresh load.
    const partialize = store.match(/partialize:[\s\S]*?\}\),/);
    expect(partialize).not.toBeNull();
    expect(partialize ? partialize[0] : "").not.toContain("hasHydrated");
  });

  test("the web auth client uses a bounded resilient lock, native untouched", () => {
    const supa = stripComments(businessFile("src/services/supabase.ts"));
    expect(supa).toContain("navigatorLock");
    expect(supa).toContain("webResilientLock");
    expect(supa).toContain("WEB_LOCK_ACQUIRE_TIMEOUT_MS");
    // The lock is applied ONLY on web; native must keep the default behaviour.
    expect(supa).toContain('Platform.OS === "web" ? { lock: webResilientLock }');
  });

  describe("shouldClearCurrentBrandId — the hardened auto-clear guard", () => {
    const ready = {
      hasHydrated: true,
      isAuthReady: true,
      currentBrandId: "brand-1",
      isFetched: true,
      isError: false,
      brandIsNull: true,
    };

    test("clears only after a real null fetch with the store hydrated + auth ready", () => {
      expect(shouldClearCurrentBrandId(ready)).toBe(true);
    });

    test("does NOT clear before the store has rehydrated (the RC-1 window)", () => {
      // This is the load-bearing assertion: pre-hydration, a transient null read
      // must NOT wipe the valid persisted brand id. Revert (no hasHydrated gate)
      // would return true here and fail.
      expect(shouldClearCurrentBrandId({ ...ready, hasHydrated: false })).toBe(
        false,
      );
    });

    test("does NOT clear during a token gap (isError) or before fetch", () => {
      expect(shouldClearCurrentBrandId({ ...ready, isError: true })).toBe(false);
      expect(shouldClearCurrentBrandId({ ...ready, isFetched: false })).toBe(
        false,
      );
    });

    test("does NOT clear when auth is not ready or there is no brand id", () => {
      expect(shouldClearCurrentBrandId({ ...ready, isAuthReady: false })).toBe(
        false,
      );
      expect(
        shouldClearCurrentBrandId({ ...ready, currentBrandId: null }),
      ).toBe(false);
    });

    test("does NOT clear when the fetch returned a real brand (brandIsNull false)", () => {
      expect(shouldClearCurrentBrandId({ ...ready, brandIsNull: false })).toBe(
        false,
      );
    });
  });

  test("the tabs nav layout keeps the full tab set while the brand pointer is resolving", () => {
    // Raw file (not stripComments): the asserted tokens are CODE, and this file
    // contains `/*` inside a string literal that confuses the naive comment
    // stripper used elsewhere.
    const tabsLayout = businessFile("app/(tabs)/_layout.tsx");
    expect(tabsLayout).toContain("brandPointerPending");
    expect(tabsLayout).toContain("useCurrentBrandHasHydrated");
    // Pending → MAX_SAFE_INTEGER so visibleTabsForRank keeps every tab (not the
    // rank-0 Home+Account collapse that produced the 2-tab degraded shell).
    expect(tabsLayout).toContain(
      "brandPointerPending ? Number.MAX_SAFE_INTEGER : rank",
    );
  });
});
