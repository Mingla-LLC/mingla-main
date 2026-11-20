/**
 * #4490 07-D — menu ordering mode: the shared rules the buyer page and the
 * consumer app read, the wire (state in, `pickup` out) and the Host mode helpers.
 *
 * Fails-on-revert: restoring `venueOrderingIsCounterPickup` to
 * `spotState !== "ok"` fails the counter and pickup cases; dropping the
 * `pickup` spread in venueOrderCreateBody fails the wire case.
 */
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));

import {
  parseVenueOrderingConfig,
  venueOrderCreateBody,
} from "@mingla/brand-rendering/venueOrdering/venueOrderingWire";
import {
  venueOrderingFulfilmentLine,
  venueOrderingIsCounterPickup,
  venueOrderingOffersPickup,
  type VenueOrderingConfig,
} from "@mingla/brand-rendering/venueOrdering";
import { venueOrderModeOf, venueOrderModeErrorCopy, type VenueOrderingSettings } from "../../../hooks/useVenueOrderingSettings";

const state = (mode: "table" | "counter" | "both", spot = true): VenueOrderingConfig =>
  parseVenueOrderingConfig({
    state: "on",
    venue_id: "11111111-1111-4111-8111-111111111111",
    venue_name: "Palm & Pepper",
    spot_state: spot ? "ok" : "none",
    spot: spot ? { label: "Table 6", kind: "table", serving_menu_id: null } : null,
    service_charge_bps: 0,
    tips_enabled: false,
    counter_pickup_enabled: mode !== "table",
    table_service_enabled: mode !== "counter",
    order_mode: mode,
  });

describe("#4490 07-D ordering mode", () => {
  it("parses table_service_enabled and order_mode (older servers read as table)", () => {
    expect(state("counter").tableServiceEnabled).toBe(false);
    expect(state("both").orderMode).toBe("both");
    const legacy = parseVenueOrderingConfig({ state: "on", spot_state: "ok", counter_pickup_enabled: true });
    expect(legacy.tableServiceEnabled).toBe(true);
    expect(legacy.orderMode).toBe("table");
  });

  it("at the table: the order goes to the scanned spot", () => {
    expect(venueOrderingIsCounterPickup(state("table"))).toBe(false);
    expect(venueOrderingFulfilmentLine(state("table"))).toBe("We'll bring it to Table 6.");
    expect(venueOrderingOffersPickup(state("table"))).toBe(false);
  });

  it("collect at the counter: a scanned table is a counter order", () => {
    expect(venueOrderingIsCounterPickup(state("counter"))).toBe(true);
    expect(venueOrderingFulfilmentLine(state("counter"))).toBe(
      "Collect it at the counter. We'll call your name.",
    );
  });

  it("both: table by default, the guest may choose to collect", () => {
    expect(venueOrderingOffersPickup(state("both"))).toBe(true);
    expect(venueOrderingIsCounterPickup(state("both"))).toBe(false);
    expect(venueOrderingIsCounterPickup(state("both"), true)).toBe(true);
    expect(venueOrderingFulfilmentLine(state("both"), true)).toBe(
      "Collect it at the counter. We'll call your name.",
    );
    // pickup is ignored where the venue does not offer the choice
    expect(venueOrderingIsCounterPickup(state("table"), true)).toBe(false);
  });

  it("no scanned spot stays a counter order", () => {
    expect(venueOrderingIsCounterPickup(state("both", false))).toBe(true);
  });

  it("sends pickup:true only when chosen", () => {
    const base = {
      spotCode: "kq7m3pd2xw",
      venueId: null,
      sessionId: null,
      lines: [],
      buyer: { name: "Tolu", email: "t@example.test", phone: "08030000000" },
      partySizeClaimed: null,
      tipBps: null,
      tipFlatCents: null,
      entrySource: null,
    };
    expect(venueOrderCreateBody({ request: { ...base, pickup: true }, mode: "preview", surface: "web" }).pickup).toBe(true);
    expect("pickup" in venueOrderCreateBody({ request: base, mode: "preview", surface: "web" })).toBe(false);
  });

  it("Host: mode derived from the two switches, plain error copy", () => {
    const s = (table: boolean, counter: boolean): VenueOrderingSettings => ({
      venueId: "v", brandId: "b", orderingEnabled: true, paused: false, pausedAt: null,
      serviceChargeBps: 0, serviceChargeLabel: "Service charge", counterPickupEnabled: counter,
      tableServiceEnabled: table, staffTabsEnabled: false, prepTimeMinutes: null,
    });
    expect(venueOrderModeOf(s(true, false))).toBe("table");
    expect(venueOrderModeOf(s(false, true))).toBe("counter");
    expect(venueOrderModeOf(s(true, true))).toBe("both");
    expect(venueOrderModeOf(null)).toBe("both");
    expect(venueOrderModeErrorCopy(new Error("not_authorized"))).not.toContain("not_authorized");
  });
});
