// #4490 07-D: the venue's ordering mode applied to a guest order.
// Fails-on-revert: deleting the routing branch in routeGuestOrder (so a
// scanned spot always orders to the table) fails the counter and pickup cases.
import { assertEquals } from "jsr:@std/assert@1";

import { type OrderContext, routeGuestOrder } from "../venueOrderCore.ts";

function ctx(table: boolean, counter: boolean, spot = true): OrderContext {
  return {
    spotId: spot ? "spot-6" : null,
    spotLabel: spot ? "Table 6" : null,
    venueTableId: spot ? "table-6" : null,
    stayUnitId: null,
    zone: spot ? "Terrace" : null,
    servingVenueId: "venue-1",
    servingMenuId: spot ? "menu-drinks" : null,
    brandId: "brand-1",
    venueName: "Palm & Pepper",
    settings: {
      ordering_enabled: true,
      paused_at: null,
      service_charge_bps: 0,
      service_charge_label: "Service charge",
      tips_enabled: false,
      counter_pickup_enabled: counter,
      table_service_enabled: table,
      staff_tabs_enabled: false,
    },
  };
}

Deno.test("07-D at the table: a scanned spot orders to the table", () => {
  const r = routeGuestOrder(ctx(true, false), false);
  assertEquals(r.ok && r.context.spotId, "spot-6");
  assertEquals(r.ok && r.routedToCounter, false);
});

Deno.test("07-D at the table: pickup is refused (only allowed in Both)", () => {
  const r = routeGuestOrder(ctx(true, false), true);
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.code, "counter_pickup_unavailable");
});

Deno.test("07-D counter: a scanned table becomes exactly a counter order", () => {
  const r = routeGuestOrder(ctx(false, true), false);
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.routedToCounter, true);
  assertEquals(r.context.spotId, null);
  assertEquals(r.context.venueTableId, null);
  assertEquals(r.context.spotLabel, null);
  assertEquals(r.context.zone, null);
  assertEquals(r.context.servingMenuId, null);
  assertEquals(r.context.servingVenueId, "venue-1");
});

Deno.test("07-D both: table by default, counter when the guest picks pickup", () => {
  const table = routeGuestOrder(ctx(true, true), false);
  assertEquals(table.ok && table.context.spotId, "spot-6");
  const pickup = routeGuestOrder(ctx(true, true), true);
  assertEquals(pickup.ok && pickup.context.spotId, null);
  assertEquals(pickup.ok && pickup.routedToCounter, true);
});

Deno.test("07-D no spot: the counter order is untouched", () => {
  const c = ctx(true, true, false);
  const r = routeGuestOrder(c, false);
  assertEquals(r.ok && r.context, c);
  assertEquals(r.ok && r.routedToCounter, false);
});

Deno.test("07-D a row from before the column (undefined) keeps table service", () => {
  const c = ctx(true, false);
  const legacy = { ...c, settings: { ...c.settings, table_service_enabled: undefined as unknown as boolean } };
  const r = routeGuestOrder(legacy, false);
  assertEquals(r.ok && r.context.spotId, "spot-6");
});
