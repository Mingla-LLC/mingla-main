/**
 * #962 [pre-bank currency de-GBP] Phase 2 — R4 (implementor happy-path, source
 * shape). fails-on-revert proof for the SCREEN surfaces that cannot be unit-
 * rendered under the default node/ts-jest config (expo-router / store / RN-tree
 * dependencies): reconciliation (G4), door (G5), event & trip dashboards
 * (N1/N2), brand tiles (G6/G7), create-wizard (G12/G13/G14/G15), venue-menu (VM).
 *
 * Each surface asserts (a) the null-safe `currencyCodeOrNull` / hide-when-null
 * shape is PRESENT, and (b) the fabricated-GBP fallback it replaced is ABSENT —
 * so reverting the fix to `?? "GBP"` flips the assertion RED. (Behavioral proofs
 * for the pure surfaces + the shared KpiCard live in the sibling test files.)
 */
import fs from "node:fs";
import path from "node:path";

const BIZ = path.join(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ, rel), "utf8");

describe("#962 R4 (source shape) — no fabricated GBP on the screen surfaces", () => {
  test("G16 EventDetailKpiCard.tsx — null-safe code, hides money when null, no GBP default", () => {
    // The shared REVENUE/PAYOUT card on the event, trip AND experience dashboards.
    // Behavioral proof of the identical currencyCodeOrNull-hide pattern lives in
    // the sibling pure-function test (G3/G8/G1); here we pin that the `= "GBP"`
    // default param is GONE and the null-guard is present (RN cannot be rendered
    // to a host tree under the default node/ts-jest config — the tester's R5 owns
    // the runtime render proof).
    const src = read("src/components/event/EventDetailKpiCard.tsx");
    expect(src).toContain("const code = currencyCodeOrNull(currency)");
    expect(src).toContain('code === null ? "—"');
    expect(src).not.toContain('currency = "GBP"');
  });

  test("G4 reconciliation.tsx — sections resolve currencyCodeOrNull, no GBP fallback", () => {
    const src = read("app/event/[id]/reconciliation.tsx");
    expect(src).toContain("currencyCodeOrNull(event.currency)");
    expect(src).not.toContain('event.currency ?? "GBP"');
  });

  test("G5 door/index.tsx — display resolves currencyCodeOrNull, no GBP fallback", () => {
    const src = read("app/event/[id]/door/index.tsx");
    expect(src).toContain("currencyCodeOrNull(event.currency)");
    expect(src).not.toContain('event.currency ?? "GBP"');
  });

  test("G5 DoorSaleNewSheet.tsx — paid record gated on a set currency, no GBP freeze", () => {
    const src = read("src/components/door/DoorSaleNewSheet.tsx");
    expect(src).toContain("eventCurrencyCode !== null");
    expect(src).toContain("currency: eventCurrencyCode,");
    expect(src).not.toContain('event.currency ?? "GBP"');
  });

  test("N1 event/[id]/index.tsx — display currency severed from expectedCurrency, no GBP", () => {
    const src = read("app/event/[id]/index.tsx");
    expect(src).toContain(
      "currencyCodeOrNull(event?.currency ?? brand?.defaultCurrency)",
    );
    expect(src).not.toContain("?? moneySummary.expectedCurrency");
  });

  test("N2 trip/[id]/index.tsx — nullable display currency, no USD/GBP literal on the KpiCard", () => {
    const src = read("app/trip/[id]/index.tsx");
    expect(src).toContain("const displayCurrency = currencyCodeOrNull(");
    expect(src).not.toContain("currency={moneySummary.expectedCurrency}");
  });

  test("G6 BrandProfileView.tsx — GMV tile hides when defaultCurrency undefined", () => {
    const src = read("src/components/brand/BrandProfileView.tsx");
    expect(src).toContain("brand.defaultCurrency !== undefined");
    expect(src).not.toContain('brand.defaultCurrency ?? "GBP"');
  });

  test("G7 BrandPricingDefaultsView.tsx — pricing example resolves currencyCodeOrNull", () => {
    const src = read("src/components/brand/BrandPricingDefaultsView.tsx");
    expect(src).toContain("currencyCodeOrNull(brand.defaultCurrency)");
    expect(src).not.toContain('brand.defaultCurrency ?? "GBP"');
  });

  test("G12 CreatorStep5Tickets.tsx — fee preview currency null when unset", () => {
    const src = read("src/components/event/CreatorStep5Tickets.tsx");
    expect(src).toContain("hasDisplayCurrency ? displayCurrency : null");
    expect(src).not.toContain('hasDisplayCurrency ? displayCurrency : "GBP"');
  });

  test("G12 WhoCoversCostsSection.tsx — nullable currency + plain-number fallback", () => {
    const src = read("src/components/pricing/WhoCoversCostsSection.tsx");
    expect(src).toContain("currency: string | null");
    expect(src).toContain("currency !== null ? formatCurrency");
  });

  test("G13 PreviewEventView.tsx — ticket price resolves currencyCodeOrNull, no GBP", () => {
    const src = read("src/components/event/PreviewEventView.tsx");
    expect(src).toContain("currencyCodeOrNull(ticket.currency ?? eventCurrency)");
    expect(src).not.toContain('ticket.currency ?? "GBP"');
  });

  test("G14 EventDetailTicketTypeRow.tsx — price hides when currency unset, no GBP", () => {
    const src = read("src/components/event/EventDetailTicketTypeRow.tsx");
    expect(src).toContain("currencyCodeOrNull(ticket.currency)");
    expect(src).not.toContain('ticket.currency ?? "GBP"');
  });

  test("G15 EventDetailActivityRow.tsx — amount resolves currencyCodeOrNull, no GBP", () => {
    const src = read("src/components/event/EventDetailActivityRow.tsx");
    expect(src).toContain("currencyCodeOrNull(a.currency)");
    expect(src).not.toContain('a.currency ?? "GBP"');
  });

  test("VM VenueMenuModule.tsx — price DISPLAY gated on brandHasCurrency", () => {
    const src = read("src/components/venue/VenueMenuModule.tsx");
    expect(src).toContain("const brandHasCurrency = currencyCodeOrNull(");
    expect(src).toContain("brandHasCurrency ? (");
  });

  test("VM MenuItemSheet.tsx — currency code suppressed when brandHasCurrency is false", () => {
    const src = read("src/components/venue/MenuItemSheet.tsx");
    expect(src).toContain("brandHasCurrency");
    expect(src).toContain("`Price${brandHasCurrency ? ` (${code})` : \"\"}`");
  });
});
