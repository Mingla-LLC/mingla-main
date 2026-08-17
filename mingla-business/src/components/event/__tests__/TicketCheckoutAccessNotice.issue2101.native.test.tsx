/**
 * issue #2101 [named-buyer checkout] — the NATIVE half of the public notice,
 * asserted behaviourally.
 *
 * WHY THIS FILE EXISTS (F-3). Amendment 8 §A8.2's guard clauses cannot detect a
 * `.native` half that is EMPTIED rather than deleted — it still exists, still
 * resolves, and still imports nothing forbidden. Only a behavioural assertion
 * catches that, and native's whole contract is "renders nothing", so the
 * assertion has to be made on purpose.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import { TicketCheckoutAccessNotice } from "../TicketCheckoutAccessNotice.native";

const NATIVE_SOURCE = readFileSync(
  path.resolve(__dirname, "../TicketCheckoutAccessNotice.native.tsx"),
  "utf8",
);

describe("issue #2101 — native public notice is a typed null renderer", () => {
  test("is a real component that renders null for every state", () => {
    expect(typeof TicketCheckoutAccessNotice).toBe("function");
    const Renderer = TicketCheckoutAccessNotice as unknown as (
      props: { eventId: string },
    ) => unknown;
    expect(Renderer({ eventId: "evt-2101" })).toBeNull();
    expect(Renderer({ eventId: "" })).toBeNull();
  });

  test("imports NEITHER the eligibility hook, the service, NOR Supabase", () => {
    for (const forbidden of [
      "usePublicTicketCheckoutRouteAccess",
      "useEventTicketCheckoutAccess",
      "eventTicketCheckoutAccessService",
      "services/supabase",
      "@supabase",
    ]) {
      expect(NATIVE_SOURCE.includes(forbidden)).toBe(false);
    }
    expect(NATIVE_SOURCE).toContain("TicketCheckoutAccessNotice");
  });
});
