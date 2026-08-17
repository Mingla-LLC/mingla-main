/**
 * issue #2101 [named-buyer checkout] — the NATIVE half of the route access
 * adapter, asserted behaviourally.
 *
 * WHY THIS FILE EXISTS (F-3). Amendment 8 §A8.2's four guard clauses check that
 * both halves EXIST, that Metro resolves the right half per platform, that no
 * forbidden web module is reachable from a native entry, and that the walk is
 * non-vacuous. None of them can detect a `.native` half that is EMPTIED rather
 * than deleted: the file still exists, still resolves, and still imports
 * nothing forbidden — while the platform override silently renders nothing and
 * the hook returns `undefined`. Only a behavioural assertion closes that, and
 * this is it.
 *
 * It also pins the isolation property by SOURCE: the native half must import
 * neither the web adapter, the eligibility hook, the service, nor Supabase.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import { usePublicTicketCheckoutRouteAccess } from "../usePublicTicketCheckoutRouteAccess.native";

const NATIVE_SOURCE = readFileSync(
  path.resolve(__dirname, "../usePublicTicketCheckoutRouteAccess.native.ts"),
  "utf8",
);

describe("issue #2101 — native route access adapter is a legacy pass-through", () => {
  test("returns the exhaustive pass-through state, not undefined", () => {
    const access = usePublicTicketCheckoutRouteAccess("evt-2101");
    // An emptied file would make this throw or return undefined.
    expect(access).toBeDefined();
    expect(access.state).toBe("unrestricted");
    expect(access.canPurchase).toBe(true);
    expect(access.requiresSignIn).toBe(false);
    expect(access.blocked).toBe(false);
    expect(typeof access.retry).toBe("function");
  });

  test("never fences a native buyer — no event id changes the answer", () => {
    for (const eventId of ["", "evt-a", "evt-b"]) {
      expect(usePublicTicketCheckoutRouteAccess(eventId).state).toBe(
        "unrestricted",
      );
    }
  });

  test("retry is inert and does not throw", () => {
    expect(() => usePublicTicketCheckoutRouteAccess("evt-2101").retry()).not.toThrow();
  });

  test("imports NEITHER the web adapter, the eligibility hook, the service, NOR Supabase", () => {
    for (const forbidden of [
      "useEventTicketCheckoutAccess",
      "eventTicketCheckoutAccessService",
      "services/supabase",
      "@supabase",
    ]) {
      expect(NATIVE_SOURCE.includes(forbidden)).toBe(false);
    }
    // It must not be an empty shell either — the exported symbol is present.
    expect(NATIVE_SOURCE).toContain("usePublicTicketCheckoutRouteAccess");
    expect(NATIVE_SOURCE).toContain("unrestricted");
  });
});
