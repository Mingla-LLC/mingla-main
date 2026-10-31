/**
 * issue #3281 — uneven carts wait for the by-date database helpers.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  byDateDatabaseReady,
  cartHasByDateLines,
} from "../byDateDatabaseGuard.ts";

const EDGE = "supabase/functions/ticket-checkout-create/index.ts";

Deno.test("only lines that carry byDate need the database check", () => {
  assertEquals(cartHasByDateLines([]), false);
  assertEquals(cartHasByDateLines([{}, { byDate: undefined }]), false);
  assertEquals(cartHasByDateLines([{ byDate: null }]), false);
  assertEquals(cartHasByDateLines([{}, { byDate: {} }]), true);
  assertEquals(cartHasByDateLines([{ byDate: { "day-1": 2 } }]), true);
});

Deno.test("ready only when the helper answers without an error", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ready = await byDateDatabaseReady({
    rpc: (fn, args) => {
      calls.push([fn, args]);
      return Promise.resolve({ error: null });
    },
  });
  assertEquals(ready, true);
  assertEquals(calls, [["issue_3281_line_qty_sum", {
    p_line: { quantity: 1 },
  }]]);
});

Deno.test("a missing helper or any failure refuses the cart", async () => {
  const missing = { code: "PGRST202", message: "Could not find the function" };
  assertEquals(
    await byDateDatabaseReady({
      rpc: () => Promise.resolve({ error: missing }),
    }),
    false,
  );
  assertEquals(
    await byDateDatabaseReady({
      rpc: () => Promise.reject(new Error("network down")),
    }),
    false,
  );
});

Deno.test("the guard runs before any session, quote or provider work", () => {
  const text = Deno.readTextFileSync(EDGE);
  const guard = text.indexOf("cartHasByDateLines(lines)");
  assert(guard > 0);
  assert(text.includes('refuse({ error: "by_date_unavailable" }, 409)'));
  for (
    const later of [
      '"issue_3872_ticket_quote"',
      '"biz_ticket_checkout_create_session"',
    ]
  ) {
    assert(guard < text.indexOf(later), `${later} ran before the guard`);
  }
});
