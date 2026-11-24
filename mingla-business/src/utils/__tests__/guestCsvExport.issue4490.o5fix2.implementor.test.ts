/**
 * #4490 spec 08 O5 fix 2 (carried item 2): the guest list export writes every
 * text column as text. A name, note, phone or link label that starts with
 * = + - @ (or a tab / carriage return) can never run as a spreadsheet formula;
 * the four number columns (Quantity, Gross, Refunded, Net) stay numbers.
 * Same single cell owner as the day-close export (utils/csvCell).
 */
import { describe, expect, test } from "@jest/globals";

import { serializeGuestsToCsv, type ExportGuestRow } from "../guestCsvExport";
import { splitCsvRecords } from "../guestCsvDayOrder";

const baseOrder = {
  id: "ord-1",
  status: "paid",
  source: "online",
  paymentMethod: "card",
  paidAt: "2026-11-14T10:00:00Z",
  currency: "NGN",
  totalGbpAtPurchase: 100,
  refundedAmountGbp: 0,
  buyer: { name: "=HYPERLINK(\"http://x.y\",\"z\")", email: "-a@b.co", phone: "+2348012345678" },
  lines: [{ ticketNameAtPurchase: "@Early bird", quantity: 2 }],
  viaLinkLabel: "=1+1",
  bookedStartAt: null,
  ticketDays: [],
};

const orderRow = (over: Record<string, unknown> = {}): ExportGuestRow =>
  ({ kind: "order", id: "ord-1", sortKey: "a", order: { ...baseOrder, ...over } }) as unknown as ExportGuestRow;

describe("O5 fix 2: guest list CSV text columns are formula-safe", () => {
  test("a hostile name, email, phone, ticket name and link label are written as text", () => {
    const text = serializeGuestsToCsv([orderRow()]);
    expect(text).toContain("\"'=HYPERLINK(\"\"http://x.y\"\",\"\"z\"\")\"");
    expect(text).toContain("\"'-a@b.co\"");
    // [TEST-MOD-APPROVED #4490] 08-O5 fix 3: a phone in international form (+ and digits only) can
    // only be read as that number, so it stays quoted text with no visible apostrophe.
    expect(text).toContain("\"+2348012345678\"");
    expect(text).not.toContain("\"'+2348012345678\"");
    expect(text).toContain("\"'@Early bird\"");
    expect(text).toContain("\"'=1+1\"");
  });

  test("a guest-list (comp) row's typed reason is written as text", () => {
    const csv = serializeGuestsToCsv([
      orderRow({ source: "comp", paymentMethod: "comp", totalGbpAtPurchase: 0, compReason: "=cmd|' /C calc'!A0" }),
    ]);
    expect(csv).toContain("COMP");
    expect(csv).toContain("\"'=cmd|' /C calc'!A0\"");
  });

  test("a door sale's walk-up name, phone and notes are written as text", () => {
    const door = {
      kind: "door", id: "d1", sortKey: "x",
      sale: {
        id: "d1", buyerName: "@SUM(A1)", buyerEmail: "", buyerPhone: "=1+1", lines: [], status: "completed",
        paymentMethod: "cash", recordedAt: "2026-11-14T20:00:00Z", notes: "-2+3", currency: "NGN",
        totalGbpAtSale: 10, refundedAmountGbp: 0, refunds: [],
      },
    } as unknown as ExportGuestRow;
    const csv = serializeGuestsToCsv([door]);
    expect(csv).toContain("\"'@SUM(A1)\"");
    expect(csv).toContain("\"'=1+1\"");
    expect(csv).toContain("\"'-2+3\"");
  });

  test("no text cell starts with a formula character, and the number columns stay numbers", () => {
    const record = splitCsvRecords(serializeGuestsToCsv([orderRow()]))[1];
    expect(record).not.toMatch(/(^|,)[=+\-@\t\r]/);
    expect(record).toContain(",2,Paid,card,ord-1,");
    expect(record).toContain(",100.00,NGN,0.00,NGN,100.00,NGN,");
  });

  test("plain text is unchanged: quoted only when it has a comma", () => {
    const csv = serializeGuestsToCsv([
      orderRow({ buyer: { name: "Ada Obi, Jr", email: "ada@x.co", phone: "08012345678" }, viaLinkLabel: "" }),
    ]);
    expect(csv).toContain("\"Ada Obi, Jr\"");
    expect(csv).toContain(",ada@x.co,08012345678,");
  });
});
