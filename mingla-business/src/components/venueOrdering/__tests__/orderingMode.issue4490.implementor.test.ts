/**
 * #4490 07-D — menu ordering mode: the shared rules the buyer page and the
 * consumer app read, the wire (state in, `pickup` out) and the Host mode helpers.
 *
 * Fails-on-revert: restoring `venueOrderingIsCounterPickup` to
 * `spotState !== "ok"` fails the counter and pickup cases; dropping the
 * `pickup` spread in venueOrderCreateBody fails the wire case; dropping the
 * counter check in venueOrderHandoverChip fails the review-header case.
 */
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));

import {
  parseVenueOrderPreview,
  parseVenueOrderingConfig,
  venueOrderCreateBody,
} from "@mingla/brand-rendering/venueOrdering/venueOrderingWire";
import {
  venueOrderHandoverChip,
  venueOrderingFulfilmentLine,
  venueOrderingIsCounterPickup,
  venueOrderingOffersPickup,
  venueOrderingReviewConfig,
  venueOrderSubmitFailure,
  venueOrderBuyerFailure,
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

  it("the review header names the counter, never the table, when the order is collected", () => {
    // Regression (round 1 review): counter mode said "Ordering for B1"-style table words.
    expect(venueOrderHandoverChip(state("counter"))).toBe("Collect from the counter");
    expect(venueOrderHandoverChip(state("both"), true)).toBe("Collect from the counter");
    expect(venueOrderHandoverChip(state("both"))).toBe("Ordering for Table 6");
    expect(venueOrderHandoverChip(state("table"))).toBe("Ordering for Table 6");
  });

  it("N126: the review follows the server's current mode, not the basket's", () => {
    // The basket was built while the venue ordered to the table; the host then
    // switched to counter. The preview carries the server's mode.
    const preview = parseVenueOrderPreview({ currency: "NGN", orderMode: "counter" });
    expect(preview.orderMode).toBe("counter");
    const shown = venueOrderingReviewConfig(state("table"), preview);
    expect(venueOrderingFulfilmentLine(shown)).toBe("Collect it at the counter. We'll call your name.");
    expect(venueOrderHandoverChip(shown)).toBe("Collect from the counter");
    // ...and back to table: the I'll collect it switch is no longer offered.
    const back = venueOrderingReviewConfig(state("both"), parseVenueOrderPreview({ currency: "NGN", orderMode: "table" }));
    expect(venueOrderingOffersPickup(back)).toBe(false);
    // An older server (no orderMode) leaves the basket's config untouched.
    const old = state("both");
    expect(venueOrderingReviewConfig(old, parseVenueOrderPreview({ currency: "NGN" }))).toBe(old);
    expect(venueOrderingReviewConfig(old, null)).toBe(old);
  });

  it("N134: after a failed payment start, Pay works again (fresh key, plain message)", () => {
    expect(venueOrderSubmitFailure({ kind: "threw" }, "x")).toEqual({ resetKey: true, message: null });
    expect(venueOrderSubmitFailure({ kind: "already_created", paymentStatus: "failed" }, "x")).toEqual({
      resetKey: true,
      message: "Your card wasn't charged. Try again.",
    });
    // A real duplicate (paid or pending) still says it is already in, and keeps the key.
    expect(venueOrderSubmitFailure({ kind: "already_created", paymentStatus: "pending" }, "That order is already in.")).toEqual({
      resetKey: false,
      message: "That order is already in.",
    });
  });

  it("N134: both guest hooks mint a fresh key after a failed start", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    for (const f of ["../useBuyerVenueOrdering.ts", "../../../../../app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts"]) {
      const src = fs.readFileSync(require.resolve(f), "utf8");
      expect(src).toMatch(/if \(failure\.resetKey\) keyRef\.current = null;/);
      expect(src).toMatch(/venueOrderSubmitFailure\(\{ kind: "threw" \}, ""\)\.resetKey\) keyRef\.current = null;/);
    }
  });

  it("N126 residual: an open review keeps re-reading the mode and re-prices on a change", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    for (const f of ["../useBuyerVenueOrdering.ts", "../../../../../app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts"]) {
      const src = fs.readFileSync(require.resolve(f), "utf8");
      expect(src).toMatch(/setInterval\(\(\) => void refetchConfig\(\), VENUE_ORDER_REVIEW_MODE_POLL_MS\)/);
      expect(src).toMatch(/mode: config\.orderMode \?\? null,/);
    }
    const pane = fs.readFileSync(require.resolve("../../../../../packages/brand-rendering/venueOrdering/VenueOrderReviewPane.tsx"), "utf8");
    expect(pane).toMatch(/previewStatus === "ready" \? venueOrderingReviewConfig\(config, preview\) : config/);
  });

  it("N139: a reserved test email is refused before Pay, in words", () => {
    const b = (email: string) => venueOrderBuyerFailure({ name: "Ada", email, phone: "08030000000" });
    expect(b("bola@example.test")?.message).toMatch(/can get receipts at/);
    expect(b("a@x.invalid")?.field).toBe("email");
    expect(b("tester-4490@example.com")).toBeNull();
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
