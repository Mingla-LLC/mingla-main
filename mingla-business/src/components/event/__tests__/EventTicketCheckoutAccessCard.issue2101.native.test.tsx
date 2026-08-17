/**
 * issue #2101 [named-buyer checkout] — the NATIVE half of the owner card,
 * asserted behaviourally.
 *
 * WHY THIS FILE EXISTS (F-3). The A8.2 guard clauses pass on an EMPTIED
 * `.native` half. Amendment 2 §A2.4 declares Business iOS and Android as
 * "backend-enforced compatibility; NO new UI", so the native contract is that
 * NOTHING renders and NOTHING pulls the configuration stack into the app —
 * both of which have to be asserted, not inferred from a filename.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import { EventTicketCheckoutAccessCard } from "../EventTicketCheckoutAccessCard.native";

const NATIVE_SOURCE = readFileSync(
  path.resolve(__dirname, "../EventTicketCheckoutAccessCard.native.tsx"),
  "utf8",
);

describe("issue #2101 — native owner card is a typed null renderer", () => {
  test("is a real component and renders null — no native configuration control", () => {
    expect(typeof EventTicketCheckoutAccessCard).toBe("function");
    const Renderer = EventTicketCheckoutAccessCard as unknown as (
      props: { eventId: string },
    ) => unknown;
    expect(Renderer({ eventId: "evt-2101" })).toBeNull();
    expect(Renderer({ eventId: "" })).toBeNull();
  });

  test("imports NEITHER the access hook, the service, NOR Supabase", () => {
    for (const forbidden of [
      "useEventTicketCheckoutAccess",
      "eventTicketCheckoutAccessService",
      "services/supabase",
      "@supabase",
    ]) {
      expect(NATIVE_SOURCE.includes(forbidden)).toBe(false);
    }
    expect(NATIVE_SOURCE).toContain("EventTicketCheckoutAccessCard");
  });
});
