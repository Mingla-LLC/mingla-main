/**
 * #962 [pre-bank currency de-GBP] Phase 2 — R4 happy-path (implementor).
 *
 * BEHAVIORAL fails-on-revert proof that a pre-bank / null-currency brand renders
 * NO £/GBP on the PURE-function money surfaces, and that a brand WITH a currency
 * still renders it. Each assertion FAILS if the corresponding fix is reverted to
 * a `?? "GBP"` fallback.
 *
 * Surfaces covered here (pure, no RN render): G1 liveEventConverter · G3
 * eventSalesSummary · G8 ticketDisplay · G17 useEventOrders cache key · G18
 * guestCsvExport. The screen components (G2/G4/G5/G16/N1/N2/VM) are covered by
 * the sibling KpiCard render proof + source-shape proof.
 */

// ---- G1: liveEventConverter — mock the brand cache + live-event store --------
const addLiveEventMock = jest.fn();
let brandDefaultCurrencyForCache: string | undefined = undefined;

jest.mock("../../hooks/brandCache", () => ({
  getBrandFromCache: jest.fn(() => ({
    id: "b1",
    slug: "brand",
    defaultCurrency: brandDefaultCurrencyForCache,
  })),
}));

jest.mock("../../store/liveEventStore", () => ({
  useLiveEventStore: {
    getState: () => ({
      getLiveEventsForBrand: () => [],
      addLiveEvent: addLiveEventMock,
    }),
  },
}));

import { convertDraftToLiveEvent } from "../liveEventConverter";
import type { DraftEvent } from "../../store/draftEventStore";
import { buildEventSalesSummary } from "../eventSalesSummary";
import { formatTicketSubline } from "../ticketDisplay";
import type { TicketStub } from "../../store/draftEventStore";
import { eventOrdersKeys } from "../../hooks/useEventOrders";
import { currencyCodeOrNull } from "../currency";
import {
  serializeGuestsToCsv,
  type ReconciliationCsvSummary,
} from "../guestCsvExport";

const draftWith = (currency: string | null): DraftEvent =>
  ({
    id: "d1",
    brandId: "b1",
    name: "Test event",
    description: "",
    serverSlug: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    tickets: [],
    multiDates: [],
    currency,
  }) as unknown as DraftEvent;

describe("#962 R4.G1 — liveEventConverter never fabricates GBP", () => {
  beforeEach(() => {
    addLiveEventMock.mockClear();
  });

  test("null draft + null brand currency → LiveEvent.currency === null (not GBP)", () => {
    brandDefaultCurrencyForCache = undefined;
    const live = convertDraftToLiveEvent(draftWith(null));
    expect(live).not.toBeNull();
    expect(live?.currency).toBeNull();
    expect(live?.currency).not.toBe("GBP");
  });

  test("a SET draft currency passes through unchanged", () => {
    brandDefaultCurrencyForCache = undefined;
    const live = convertDraftToLiveEvent(draftWith("USD"));
    expect(live?.currency).toBe("USD");
  });

  test("null draft but brand currency set → the brand's real currency", () => {
    brandDefaultCurrencyForCache = "EUR";
    const live = convertDraftToLiveEvent(draftWith(null));
    expect(live?.currency).toBe("EUR");
  });
});

describe("#962 R4.G3 — eventSalesSummary hides the revenue label when unset", () => {
  test("null currency → displayCurrency null + revenueLabel '—'", () => {
    const s = buildEventSalesSummary({
      eventId: "e1",
      tickets: [],
      eventCurrency: null,
      brandDefaultCurrency: null,
      orders: [],
    });
    expect(s.displayCurrency).toBeNull();
    expect(s.revenueLabel).toBe("—");
    expect(s.revenueLabel).not.toMatch(/£|GBP/);
  });

  test("a SET currency renders that symbol", () => {
    const s = buildEventSalesSummary({
      eventId: "e1",
      tickets: [],
      eventCurrency: "USD",
      brandDefaultCurrency: null,
      orders: [],
    });
    expect(s.displayCurrency).toBe("USD");
    expect(s.revenueLabel).toContain("$");
  });
});

describe("#962 R4.G8 — ticket subline hides the price when currency unset", () => {
  const ticket = (currency: string | undefined): TicketStub =>
    ({
      isFree: false,
      priceGbp: 20,
      currency,
      maxPurchaseQty: null,
      approvalRequired: false,
      passwordProtected: false,
      waitlistEnabled: false,
      allowTransfers: true,
    }) as unknown as TicketStub;

  test("priced ticket, no currency → subline starts with '—', no £/GBP", () => {
    const line = formatTicketSubline(ticket(undefined));
    expect(line).toBe("—");
    expect(line).not.toMatch(/£|GBP/);
  });

  test("priced ticket WITH currency → shows the symbol", () => {
    const line = formatTicketSubline(ticket("USD"));
    expect(line).toContain("$");
  });
});

describe("#962 R4.G17 — sales-summary cache key segment is null, never GBP", () => {
  test("null-currency brand → key currency segment is null", () => {
    const key = eventOrdersKeys.salesSummary(
      "e1",
      currencyCodeOrNull(undefined),
      "sig",
    );
    expect(key[3]).toBeNull();
    expect(key[3]).not.toBe("GBP");
  });

  test("a SET currency → the real code as the segment", () => {
    const key = eventOrdersKeys.salesSummary("e1", currencyCodeOrNull("usd"), "sig");
    expect(key[3]).toBe("USD");
  });
});

describe("#962 R4.G18 — reconciliation CSV omits the currency code when unset", () => {
  const summary = (currency: string | null): ReconciliationCsvSummary => ({
    eventName: "E",
    status: "live",
    totalLiveTickets: 0,
    grossRevenue: 0,
    totalRefunded: 0,
    netRevenue: 0,
    uniqueScannedTickets: 0,
    currency,
  });

  test("null currency → preamble carries NO currency code (no GBP)", () => {
    const csv = serializeGuestsToCsv([], summary(null));
    expect(csv).toContain("# Revenue: gross 0.00");
    // NO trailing code after the amount — a reverted serializer would append
    // " null"/" GBP" (a space then a non-space) right after "0.00".
    expect(csv).not.toMatch(/# Revenue: gross 0\.00 \S/);
    expect(csv).not.toContain("GBP");
  });

  test("a SET currency → the code is appended", () => {
    const csv = serializeGuestsToCsv([], summary("USD"));
    expect(csv).toContain("# Revenue: gross 0.00 USD");
  });
});
