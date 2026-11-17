/* eslint-disable import/first */
/**
 * issue #3281 — the reconciliation CSV reads the booked start in the same
 * offering zone as the guest export (it shares the serializer).
 */
import { describe, expect, jest, test } from "@jest/globals";

const mockShare = jest.fn<(content: { message: string }) => Promise<{ action: string }>>();
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Share: {
    share: (content: { message: string }) => mockShare(content),
    sharedAction: "sharedAction",
    dismissedAction: "dismissedAction",
  },
}));

import { exportReconciliationCsv } from "../guestCsvExport";
import { bookedStartCsvCell } from "../guestCsvDayOrder";

describe("issue #3281 — reconciliation CSV booked start", () => {
  test("uses the offering's zone, and Day stays last", async () => {
    mockShare.mockResolvedValue({ action: "sharedAction" });
    const order = {
      id: "ord-1",
      buyer: { name: "Ada Obi", email: "ada@example.test", phone: "" },
      lines: [{ ticketTypeId: "t1", ticketNameAtPurchase: "Sunset walk", unitPriceGbpAtPurchase: 20, quantity: 1, refundedQuantity: 0 }],
      status: "paid",
      paymentMethod: "card",
      paidAt: "2026-11-01T10:00:00Z",
      totalGbpAtPurchase: 20,
      refundedAmountGbp: 0,
      currency: "NGN",
      viaLinkLabel: null,
      bookedStartAt: "2026-11-14T18:30:00Z",
    };
    await exportReconciliationCsv({
      event: { name: "Sunset walk", eventSlug: "sunset", currency: "NGN", timezone: "Africa/Lagos" },
      orders: [order],
      doorSales: [],
      summary: {
        headlineCopy: "Live", totalLiveTickets: 1, grossRevenue: 20, totalRefunded: 0,
        doorCardMinglaFee: 0, uniqueScannedTickets: 0, currenciesPresent: ["NGN"], currencyMismatches: [],
      },
      bookedCell: (iso: string | null | undefined) => bookedStartCsvCell(iso, "Africa/Lagos"),
    } as unknown as Parameters<typeof exportReconciliationCsv>[0]);
    const csv = mockShare.mock.calls[0][0].message;
    const records = csv.split("\r\n").filter((l) => l.length > 0 && !l.startsWith("#"));
    const header = records[0].split(",");
    expect(header[header.length - 1]).toBe("Day");
    expect(header[header.length - 2]).toBe("Booked start");
    const row = records[1].split(",");
    // 18:30 UTC is 19:30 in Lagos.
    expect(row[header.length - 2]).toBe("2026-11-14 19:30");
  });
});
