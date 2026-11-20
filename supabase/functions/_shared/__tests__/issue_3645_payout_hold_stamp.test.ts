// Issue #3645 — the payout-hold stamp reader used by every Paystack-capable
// checkout (ticket, chip-in, venue reservation, venue order guest + staff).
// A failed read must refuse; only a successful read decides stamped or not.
// venue-reservation-create, venue-order-create and venue-order-staff run
// serve() on import, so their refusal is proven here through the one reader
// they all call (readBrandPayoutHoldStamp); ticket-checkout-create,
// rsvp-contribution-create and installment-pay-link also have handler tests.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PAYOUT_HOLD_UNREADABLE_ERROR,
  PAYOUT_HOLD_UNREADABLE_STATUS,
  payoutHoldStampFromRead,
  readBrandPayoutHoldStamp,
} from "../payoutHoldStamp.ts";
import {
  venueOrderErrorCopy,
  venueOrderErrorStatus,
} from "../venueOrderPricing.ts";

type Read = { data: unknown; error: unknown } | "throw";

function brandsClient(read: Read) {
  const seen: Array<[string, string, string]> = [];
  return {
    seen,
    client: {
      from(table: string) {
        return {
          select(columns: string) {
            return {
              eq(column: string, value: string) {
                seen.push([table, columns, `${column}=${value}`]);
                return {
                  maybeSingle() {
                    if (read === "throw") return Promise.reject(new Error("socket closed"));
                    return Promise.resolve(read);
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

Deno.test("#3645 a brands read error refuses (never read as unstamped)", async () => {
  const { client, seen } = brandsClient({ data: null, error: { message: "statement timeout" } });
  assertEquals(await readBrandPayoutHoldStamp(client, "brand-1", "test"), { ok: false });
  assertEquals(seen, [["brands", "payout_hold_cutover_at", "id=brand-1"]]);
});

Deno.test("#3645 a thrown brands read refuses", async () => {
  const { client } = brandsClient("throw");
  assertEquals(await readBrandPayoutHoldStamp(client, "brand-1", "test"), { ok: false });
});

Deno.test("#3645 a readable stamp decides stamped / unstamped", async () => {
  assertEquals(
    await readBrandPayoutHoldStamp(
      brandsClient({ data: { payout_hold_cutover_at: "2026-01-01T00:00:00Z" }, error: null }).client,
      "b",
      "test",
    ),
    { ok: true, isCutover: true },
  );
  assertEquals(
    await readBrandPayoutHoldStamp(
      brandsClient({ data: { payout_hold_cutover_at: null }, error: null }).client,
      "b",
      "test",
    ),
    { ok: true, isCutover: false },
  );
  // A successful read with no row keeps its old meaning (no stamp).
  assertEquals(
    await readBrandPayoutHoldStamp(brandsClient({ data: null, error: null }).client, "b", "test"),
    { ok: true, isCutover: false },
  );
});

Deno.test("#3645 the events-embed read (ticket checkout) follows the same rule", () => {
  assertEquals(payoutHoldStampFromRead({ data: null, error: { message: "x" } }, "t"), { ok: false });
  assertEquals(
    payoutHoldStampFromRead({ data: { brands: { payout_hold_cutover_at: "2026-01-01" } }, error: null }, "t"),
    { ok: true, isCutover: true },
  );
  assertEquals(
    payoutHoldStampFromRead({ data: { brands: [{ payout_hold_cutover_at: "2026-01-01" }] }, error: null }, "t"),
    { ok: true, isCutover: true },
  );
  assertEquals(
    payoutHoldStampFromRead({ data: { brands: { payout_hold_cutover_at: null } }, error: null }, "t"),
    { ok: true, isCutover: false },
  );
});

Deno.test("#3645 the refusal is retryable and tells the buyer nothing was charged", () => {
  assertEquals(PAYOUT_HOLD_UNREADABLE_ERROR, "payout_settings_unavailable");
  assertEquals(PAYOUT_HOLD_UNREADABLE_STATUS, 503);
  assertEquals(venueOrderErrorStatus("payout_settings_unavailable"), 503);
  for (const audience of ["guest", "staff"] as const) {
    const copy = venueOrderErrorCopy("payout_settings_unavailable", audience) ?? "";
    assertEquals(copy.includes("Nothing has been charged"), true);
  }
});
