/**
 * #962 [pre-bank currency de-GBP] Phase 2 — R5 TESTER adversarial (DIFFERENT
 * angle from the implementor's R4). Assumes the fix is BROKEN until proven.
 *
 * The implementor's R4 (issue_0962_prebank_display_no_gbp.test.ts) calls
 * `convertDraftToLiveEvent` on a SYNTHETIC draft and source-greps the screens.
 * This suite attacks angles R4 never touches:
 *
 *  A1. write -> read -> convert ROUND-TRIP through the REAL persistence seam
 *      (draftToServerInsert -> [server row] -> serverRowToDraft ->
 *      convertDraftToLiveEvent). Proves no fabricated GBP is re-manufactured at
 *      ANY stage of serialize/deserialize/convert — the exact seam where a GBP
 *      could re-enter downstream after Phase 1 fixed the mapper. (G1 + Phase-1
 *      mapper.)
 *  A2. moneySummary COMPUTATION INVARIANCE — proves N1/N2/G5 severed only the
 *      DISPLAY read; feeding `null` (pre-bank) vs the old `"GBP"` into
 *      summarizeEventMoney yields byte-identical amounts (the math was NOT
 *      nulled). Guard, not a fails-on-revert.
 *  A3. honor-when-set across the pure surfaces — a REAL currency (USD/EUR/NGN)
 *      still renders its symbol; the hide logic did not nuke legitimate display.
 *  A5. crash-safety — empty/whitespace/null currency never throws a RangeError
 *      (ORCH-1152 class) AND is treated as UNSET (hidden), never GBP.
 *
 * The N1/N2 KpiCard runtime render + VM2 are proven in the sibling render file
 * (issue_0962_r5_kpicard_hide.render.test.tsx under jest.issue0962r5.render.cjs).
 */
import { describe, expect, jest, test } from "@jest/globals";

// --- converter needs the brand cache + live-event store (mocked) -------------
let brandDefaultCurrencyForCache: string | undefined = undefined;
jest.mock("../../hooks/brandCache", () => ({
  getBrandFromCache: jest.fn(() => ({
    id: "00000000-0000-4000-8000-000000000002",
    slug: "brand",
    defaultCurrency: brandDefaultCurrencyForCache,
  })),
}));
jest.mock("../../store/liveEventStore", () => ({
  useLiveEventStore: {
    getState: () => ({
      getLiveEventsForBrand: () => [],
      addLiveEvent: jest.fn(),
    }),
  },
}));
// mapper reaches for supabase transitively via its module graph in some builds.
jest.mock("../../services/supabase", () => ({ supabase: { from: jest.fn() } }));

import {
  draftToServerInsert,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../serverDraftEventMapper";
import { convertDraftToLiveEvent } from "../liveEventConverter";
import { summarizeEventMoney } from "../moneySummary";
import { buildEventSalesSummary } from "../eventSalesSummary";
import { formatTicketSubline } from "../ticketDisplay";
import {
  serializeGuestsToCsv,
  type ReconciliationCsvSummary,
} from "../guestCsvExport";
import {
  normalizeCurrency,
  currencyCodeOrNull,
  formatCurrency,
  formatCurrencyRound,
} from "../currency";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";

// ----------------------------------------------------------------------------
// Fixtures (modelled on issue1022ThemeDraftRoundTrip.test.ts).
// ----------------------------------------------------------------------------
const draftWith = (currency: string | null): DraftEvent =>
  ({
    id: "d_local_1",
    brandId: "00000000-0000-4000-8000-000000000002",
    name: "Rooftop Sessions",
    description: "",
    format: "in_person",
    whenMode: "single",
    date: "2026-06-01",
    doorsOpen: "18:00",
    endsAt: "22:00",
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Main Hall",
    address: "1 High Street",
    onlineUrl: null,
    coverMediaUrl: null,
    coverMediaType: null,
    currency,
    tickets: [],
    visibility: "public",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: null,
    locationGeo: null,
    themeOverrides: null,
  }) as unknown as DraftEvent;

/** Project a builder's column output back onto a server row shape. */
const rowFrom = (columns: Record<string, unknown>): ServerDraftEventRow =>
  ({
    id: "00000000-0000-4000-8000-000000000009",
    brand_id: "00000000-0000-4000-8000-000000000002",
    created_by: "00000000-0000-4000-8000-000000000003",
    slug: "draft-abcd",
    is_online: false,
    is_recurring: false,
    is_multi_date: false,
    recurrence_rules: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    published_at: null,
    deleted_at: null,
    ...columns,
  }) as unknown as ServerDraftEventRow;

const roundTrip = (
  draftCurrency: string | null,
  brandDefaultCurrency: string | undefined,
): {
  insert: Record<string, unknown>;
  rehydrated: DraftEvent;
  liveCurrency: string | null | undefined;
} => {
  brandDefaultCurrencyForCache = brandDefaultCurrency;
  const insert = draftToServerInsert(
    draftWith(draftCurrency),
    "00000000-0000-4000-8000-000000000003",
    "draft-abcd",
  ) as unknown as Record<string, unknown>;
  const rehydrated = serverRowToDraft(rowFrom(insert));
  const live = convertDraftToLiveEvent(rehydrated);
  return { insert, rehydrated, liveCurrency: live?.currency };
};

// ============================================================================
// A1 — write -> read -> convert round-trip never re-manufactures GBP
// ============================================================================
describe("#962 R5.A1 — pre-bank draft survives persist->rehydrate->convert as NULL, never GBP", () => {
  test("null draft + null brand → null at EVERY stage (insert, rehydrate, LiveEvent)", () => {
    const { insert, rehydrated, liveCurrency } = roundTrip(null, undefined);

    // Stage 1 — serialize (Phase-1 mapper): the persisted column is null...
    expect(insert.currency).toBeNull();
    // ...and the theme JSONB mirror carries null, never "GBP".
    expect(JSON.stringify(insert.theme)).not.toContain("GBP");

    // Stage 2 — rehydrate: the re-read draft is null.
    expect(rehydrated.currency).toBeNull();

    // Stage 3 — G1 converter (the load-bearing seam): LiveEvent.currency is
    // null. On a true revert of liveEventConverter.ts:131 (`?? null` -> `??
    // "GBP"`) this flips to "GBP" and the assertion goes RED.
    expect(liveCurrency).toBeNull();
    expect(liveCurrency).not.toBe("GBP");
  });

  test("null draft but a SET brand default → the brand's REAL currency flows through", () => {
    const { insert, rehydrated, liveCurrency } = roundTrip(null, "EUR");
    // The event has no own currency, so nothing is persisted on the event row...
    expect(insert.currency).toBeNull();
    expect(rehydrated.currency).toBeNull();
    // ...but the converter resolves the brand default (honor-when-set).
    expect(liveCurrency).toBe("EUR");
  });

  test("a SET draft currency (NGN) round-trips EXACTLY — no de-GBP over-reach", () => {
    const { insert, rehydrated, liveCurrency } = roundTrip("NGN", undefined);
    expect(insert.currency).toBe("NGN");
    expect(rehydrated.currency).toBe("NGN");
    expect(liveCurrency).toBe("NGN");
  });
});

// ============================================================================
// A2 — moneySummary computation is UNCHANGED by the display severing
// ============================================================================
describe("#962 R5.A2 — severing display currency did NOT touch the money math", () => {
  // A door sale in a real currency; expectedCurrency null (pre-bank, post-N1/G5)
  // vs the OLD fabricated "GBP" must compute IDENTICAL amounts, because
  // moneySummary normalizes null -> "GBP" internally (byte-identical crash-guard).
  const doorSales = [
    {
      id: "ds_1",
      totalGbpAtSale: 40,
      refundedAmountGbp: 0,
      currency: "GBP",
      paymentMethod: "cash" as const,
      refunds: [],
    },
  ];

  test("null vs 'GBP' expectedCurrency → identical (non-trivial) computed amounts", () => {
    const asNull = summarizeEventMoney({
      expectedCurrency: null,
      orders: [],
      doorSales,
    });
    const asGbp = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [],
      doorSales,
    });
    // Non-trivial: the fixture actually produces revenue (guards against a
    // vacuous 0 === 0).
    expect(asNull.doorRevenue).toBe(40);
    expect(asNull.grossRevenue).toBe(40);
    // Invariance across the display-severing input change (N1/G5 caller edit).
    expect(asNull.doorRevenue).toBe(asGbp.doorRevenue);
    expect(asNull.grossRevenue).toBe(asGbp.grossRevenue);
    expect(asNull.onlineRevenue).toBe(asGbp.onlineRevenue);
    expect(asNull.totalRefunded).toBe(asGbp.totalRefunded);
    expect(asNull.expectedCurrency).toBe("GBP"); // internal normalize unchanged
  });
});

// ============================================================================
// A3 — honor-when-set: a REAL currency still renders on the pure surfaces
// ============================================================================
describe("#962 R5.A3 — a brand WITH a currency is NOT over-hidden", () => {
  test.each([
    ["USD", "$"],
    ["EUR", "€"],
    ["NGN", "₦"],
  ])("eventSalesSummary(%s) renders the %s symbol", (code, symbol) => {
    const s = buildEventSalesSummary({
      eventId: "e1",
      tickets: [],
      eventCurrency: code,
      brandDefaultCurrency: null,
      orders: [],
    });
    expect(s.displayCurrency).toBe(code);
    expect(s.revenueLabel).toContain(symbol);
    expect(s.revenueLabel).not.toBe("—");
    expect(s.revenueLabel).not.toMatch(/£|GBP/);
  });

  test("ticket subline honors a SET currency (USD → $)", () => {
    const t = {
      isFree: false,
      priceGbp: 20,
      currency: "USD",
      maxPurchaseQty: null,
    } as unknown as TicketStub;
    expect(formatTicketSubline(t)).toContain("$");
  });

  test("reconciliation CSV appends a SET currency code (NGN)", () => {
    const summary: ReconciliationCsvSummary = {
      eventName: "E",
      status: "live",
      totalLiveTickets: 3,
      grossRevenue: 90,
      totalRefunded: 0,
      netRevenue: 90,
      uniqueScannedTickets: 3,
      currency: "NGN",
    };
    const csv = serializeGuestsToCsv([], summary);
    expect(csv).toContain("# Revenue: gross 90.00 NGN");
    expect(csv).not.toContain("GBP");
  });
});

// ============================================================================
// A5 — crash-safety + empty/whitespace treated as UNSET (never GBP display)
// ============================================================================
describe("#962 R5.A5 — null/empty/whitespace currency is crash-safe AND hidden", () => {
  test("normalizeCurrency crash-guard is byte-intact (ORCH-1152): empty → GBP, never throws", () => {
    // The crash-guard MUST still return GBP so Intl never throws — proving the
    // de-GBP sweep did NOT weaken normalizeCurrency (DO-NOT-TOUCH invariant).
    expect(normalizeCurrency("")).toBe("GBP");
    expect(normalizeCurrency("   ")).toBe("GBP");
    expect(normalizeCurrency(null)).toBe("GBP");
    expect(() => formatCurrency(1234, "")).not.toThrow();
    expect(() => formatCurrencyRound(1234, "  ")).not.toThrow();
  });

  test("currencyCodeOrNull treats empty/whitespace as UNSET (the display gate)", () => {
    expect(currencyCodeOrNull("")).toBeNull();
    expect(currencyCodeOrNull("   ")).toBeNull();
    expect(currencyCodeOrNull("\t \n")).toBeNull();
    expect(currencyCodeOrNull(" usd ")).toBe("USD");
  });

  test.each(["", "   ", null])(
    "eventSalesSummary(%p) hides the revenue label without throwing",
    (bad) => {
      let s!: ReturnType<typeof buildEventSalesSummary>;
      expect(() => {
        s = buildEventSalesSummary({
          eventId: "e1",
          tickets: [],
          eventCurrency: bad as unknown as string,
          brandDefaultCurrency: null,
          orders: [],
        });
      }).not.toThrow();
      expect(s.displayCurrency).toBeNull();
      expect(s.revenueLabel).toBe("—");
      expect(s.revenueLabel).not.toMatch(/£|GBP/);
    },
  );

  test("ticket subline with a blank currency renders '—', no throw, no £", () => {
    const t = {
      isFree: false,
      priceGbp: 20,
      currency: "  ",
      maxPurchaseQty: null,
    } as unknown as TicketStub;
    let line = "";
    expect(() => {
      line = formatTicketSubline(t);
    }).not.toThrow();
    // Price is always the FIRST segment; a blank currency hides it to "—".
    expect(line.startsWith("—")).toBe(true);
    expect(line).not.toMatch(/£|GBP/);
  });

  test("reconciliation CSV with null currency omits the code, no throw, no GBP", () => {
    // Cast so this suite compiles even under a full-file revert of G18 (which
    // narrows `currency` back to `string`) — the RUNTIME assertion below is
    // then what catches the serializer behavioral revert.
    const summary = {
      eventName: "E",
      status: "live",
      totalLiveTickets: 0,
      grossRevenue: 0,
      totalRefunded: 0,
      netRevenue: 0,
      uniqueScannedTickets: 0,
      currency: null,
    } as unknown as ReconciliationCsvSummary;
    let csv = "";
    expect(() => {
      csv = serializeGuestsToCsv([], summary);
    }).not.toThrow();
    expect(csv).toContain("# Revenue: gross 0.00");
    // no trailing code token right after the amount.
    expect(csv).not.toMatch(/# Revenue: gross 0\.00 \S/);
    expect(csv).not.toContain("GBP");
  });
});
