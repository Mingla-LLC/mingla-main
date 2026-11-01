/**
 * issue #3281 PR10 — byDate quantity helpers + wire pins.
 * [TEST-MOD-APPROVED #3281]
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = Deno.cwd().endsWith("mingla-business")
  ? `${Deno.cwd()}/..`
  : Deno.cwd();

const read = (rel: string): string =>
  Deno.readTextFileSync(`${ROOT}/${rel}`);

Deno.test("uniform payload omits byDate (source helper)", () => {
  const src = read(
    "mingla-business/src/components/checkout/byDateQuantities.ts",
  );
  assertEquals(src.includes("sameTicketsForEveryDate"), true);
  assertEquals(src.includes("Remove this date and continue"), true);
  assertEquals(src.includes("just filled up"), true);
});

Deno.test("the deferred checkout route owns the switch; shared cart stores only line data", () => {
  const cart = read("mingla-business/src/components/checkout/CartContext.tsx");
  const index = read("mingla-business/app/checkout/[eventId]/index.tsx");
  assertEquals(cart.includes("sameTicketsForEveryDate"), false);
  assertEquals(cart.includes("SET_SAME_TICKETS_FOR_EVERY_DATE"), false);
  assertEquals(cart.includes("byDate"), true);
  assertEquals(index.includes("const [sameTicketsForEveryDate"), true);
  assertEquals(index.includes("handleSameTicketsForEveryDate"), true);
  assertEquals(index.includes("Same tickets for every date"), true);
  assertEquals(index.includes("issue-3281-same-tickets-switch"), true);
  assertEquals(index.includes("Up to"), true);
});

Deno.test("service and edge forward byDate; migration has DETAIL", () => {
  const svc = read("mingla-business/src/services/ticketCheckoutService.ts");
  const edge = read("supabase/functions/ticket-checkout-create/index.ts");
  const mig = read(
    "supabase/migrations/20271224003281_issue_3281_by_date_quantities.sql",
  );
  assertEquals(svc.includes("byDate"), true);
  assertEquals(edge.includes("capacityEventDateIdFromError"), true);
  assertEquals(mig.includes("issue_3281_line_qty_for_date"), true);
  assertEquals(mig.includes("USING DETAIL"), true);
});
