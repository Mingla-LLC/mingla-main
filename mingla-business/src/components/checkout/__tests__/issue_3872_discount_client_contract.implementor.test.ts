import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saleAvailabilityCopy } from "@mingla/offering-rendering/saleAvailabilityCopy";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (relative: string): string =>
  readFileSync(join(ROOT, relative), "utf8");

describe("#3872 buyer discount client contract", () => {
  test("scarcity copy prefers a small remaining count and otherwise shows the end", () => {
    expect(saleAvailabilityCopy(4, "2027-01-01T20:00:00.000Z", "UTC")).toBe(
      "Only 4 left at this price",
    );
    expect(saleAvailabilityCopy(11, "2027-01-01T20:00:00.000Z", "UTC")).toMatch(
      /^Sale ends /,
    );
    expect(saleAvailabilityCopy(null, null)).toBeNull();
  });

  test("ticket carts submit server quote digests and never multiply display prices", () => {
    const nativeCart = read(
      "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
    );
    expect(nativeCart).toContain("quoteDigest: acceptedQuote.quoteDigest");
    expect(nativeCart).toContain(
      "quoteListDigest: acceptedQuote.quoteListDigest",
    );
    expect(nativeCart).toContain('terminalOutcome?.outcome === "review"');
    expect(nativeCart).not.toMatch(/price(?:AllIn)?Gbp\s*\*/);
  });

  test("venue deposits show server previews, hide codes when free, and bind create", () => {
    const web = read(
      "mingla-business/src/components/venue/GuestVenueReservation.tsx",
    );
    const native = read(
      "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx",
    );
    for (const source of [web, native]) {
      expect(source).toContain("activePreview.requiresPayment");
      expect(source).toContain("activePreview.quoteDigest");
      expect(source).toContain("Confirm updated total");
      expect(source).toContain("Discount code");
    }
  });

  test("public listing cards preserve list price beside the server sale minimum", () => {
    const brand = read("packages/brand-rendering/PublicBrandPage.tsx");
    const service = read("mingla-business/src/services/publicEventsService.ts");
    expect(service).toContain('supabase.rpc("pg_public_event_display_prices"');
    expect(brand).toContain("event.displaySalePriceCents");
    expect(brand).toContain("styles.oCardListPrice");
  });
});
