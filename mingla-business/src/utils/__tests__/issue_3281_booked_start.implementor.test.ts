/**
 * issue #3281 — the guest-chosen experience start (orders.booked_start_at) as
 * every Host surface words it: the display line, the door line and the CSV
 * cell. Always the offering's zone, never the phone's.
 */
import { describe, expect, test } from "@jest/globals";

import * as fs from "node:fs";
import * as path from "node:path";

import {
  bookedStartLine,
  doorBookedLine,
  formatBookedStart,
} from "../bookedStart";
import { serializeGuestsToCsv, type ExportGuestRow } from "../guestCsvExport";
import {
  bookedStartCsvCell,
  serializeGuestsToCsvByOccurrence,
  splitCsvRecords,
} from "../guestCsvDayOrder";

describe("issue #3281 — booked start formatting", () => {
  test("nothing to show gives null / blank, never an invented time", () => {
    for (const bad of [null, undefined, "", "   ", "not-a-date", "2026-13-40T00:00:00Z"]) {
      expect(formatBookedStart(bad, "Africa/Lagos")).toBeNull();
      expect(bookedStartLine(bad, "Africa/Lagos")).toBeNull();
      expect(bookedStartCsvCell(bad, "Africa/Lagos")).toBe("");
    }
  });

  test("the offering's zone decides the day and the hour", () => {
    const iso = "2026-11-14T23:30:00Z";
    expect(bookedStartCsvCell(iso, "Africa/Lagos")).toBe("2026-11-15 00:30");
    expect(bookedStartCsvCell(iso, "America/Chicago")).toBe("2026-11-14 17:30");
    expect(formatBookedStart(iso, "Africa/Lagos")).toMatch(/Sun/);
    expect(formatBookedStart(iso, "America/Chicago")).toMatch(/Sat/);
  });

  test("midnight is 00:00, never 24:00", () => {
    expect(bookedStartCsvCell("2026-11-14T23:00:00Z", "Africa/Lagos")).toBe("2026-11-15 00:00");
  });

  test("daylight saving is applied by the zone", () => {
    // 2026-03-08: US clocks jump 02:00 -> 03:00 CDT. 08:30Z is 03:30 CDT.
    expect(bookedStartCsvCell("2026-03-08T08:30:00Z", "America/Chicago")).toBe("2026-03-08 03:30");
    // A day before, still CST (UTC-6).
    expect(bookedStartCsvCell("2026-03-07T08:30:00Z", "America/Chicago")).toBe("2026-03-07 02:30");
  });

  test("no zone or an unknown zone reads as UTC", () => {
    expect(bookedStartCsvCell("2026-11-14T18:30:00Z", null)).toBe("2026-11-14 18:30");
    expect(bookedStartCsvCell("2026-11-14T18:30:00Z", "Mars/Base")).toBe("2026-11-14 18:30");
    expect(formatBookedStart("2026-11-14T18:30:00Z", "Mars/Base")).toMatch(/6:30|18:30/);
  });

  test("the door line carries the prefix", () => {
    expect(bookedStartLine("2026-11-14T18:30:00Z", "Africa/Lagos")).toMatch(/^Booked for .*(7:30|19:30)/);
  });
});

const baseOrder = {
  id: "ord-1",
  buyer: { name: "Ada, \"the\" Obi", email: "ada@example.test", phone: "" },
  lines: [{ ticketTypeId: "t1", ticketNameAtPurchase: "Sunset walk", unitPriceGbpAtPurchase: 20, quantity: 1, refundedQuantity: 0 }],
  status: "paid",
  paymentMethod: "card",
  paidAt: "2026-11-01T10:00:00Z",
  totalGbpAtPurchase: 20,
  refundedAmountGbp: 0,
  currency: "NGN",
  viaLinkLabel: null,
  bookedStartAt: "2026-11-14T23:30:00Z",
  ticketDays: [{ ticketId: "tk1", eventDateIds: ["d1"], status: "valid", usedAt: null }],
};

const rows = (): ExportGuestRow[] => [
  { kind: "order", id: "ord-1", order: baseOrder, sortKey: "a" } as unknown as ExportGuestRow,
  {
    kind: "order",
    id: "comp-1",
    order: { ...baseOrder, id: "comp-1", paymentMethod: "comp", totalGbpAtPurchase: 0, isComp: true, compReason: "Press,\r\nlist", bookedStartAt: null },
    sortKey: "b",
  } as unknown as ExportGuestRow,
  {
    kind: "door",
    id: "door-1",
    sale: {
      id: "door-1", buyerName: "", buyerEmail: "", buyerPhone: "", lines: [], status: "active",
      paymentMethod: "cash", recordedAt: "2026-11-14T20:00:00Z", notes: "", currency: "NGN",
      totalGbpAtSale: 10, refundedAmountGbp: 0, refunds: [],
    },
    sortKey: "c",
  } as unknown as ExportGuestRow,
];

describe("issue #3281 — which door results name the booked start", () => {
  const iso = "2026-11-14T18:30:00Z";
  test("let in, already in and early show it, in the offering's zone", () => {
    for (const kind of ["success", "duplicate", "not_yet_open"]) {
      expect(doorBookedLine(kind, iso, "Africa/Lagos")).toMatch(/^Booked for .*(7:30|19:30)/);
    }
  });
  test("every other result shows nothing, even with a booked start", () => {
    for (const kind of ["void", "wrong_event", "cancelled_order", "not_found", "event_ended", "refunded", ""]) {
      expect(doorBookedLine(kind, iso, "Africa/Lagos")).toBeNull();
    }
  });
  test("no booked start shows nothing on any result", () => {
    expect(doorBookedLine("success", null, "Africa/Lagos")).toBeNull();
  });
  test("the scanner and both doors use this rule with the offering's zone", () => {
    const root = path.join(__dirname, "../../..");
    const native = fs.readFileSync(path.join(root, "app/event/[id]/scanner/index.tsx"), "utf8");
    const web = fs.readFileSync(path.join(root, "app/event/[id]/scanner/index.web.tsx"), "utf8");
    const sheet = fs.readFileSync(path.join(root, "src/components/scanner/DoorGuestSearchSheet.tsx"), "utf8");
    expect(native).toMatch(/doorBookedLine\(kind, result\.bookedStartAt, event\.timezone\)/);
    expect(native).toMatch(/timeZone=\{event\.timezone\}/);
    expect(web).toMatch(/<DoorGuestSearchPanel[^>]*timeZone=\{event\.timezone\}/);
    expect(sheet).toMatch(/doorBookedLine\(\s*lastResult\.kind,/);
  });
});

const lagos = (iso: string | null | undefined): string => bookedStartCsvCell(iso, "Africa/Lagos");

describe("issue #3281 — the guest CSV's Booked start column", () => {
  test("sits right before Day, and Day stays last", () => {
    const [header] = splitCsvRecords(serializeGuestsToCsv(rows(), undefined, new Map(), lagos));
    const cols = header.split(",");
    expect(cols[cols.length - 1]).toBe("Day");
    expect(cols[cols.length - 2]).toBe("Booked start");
    expect(cols[cols.length - 3]).toBe("Came with");
  });

  test("the online order shows the offering's wall clock; comp and door rows are blank; every row is as wide as the header", () => {
    const csv = serializeGuestsToCsv(rows(), undefined, new Map([["d1", "Sat 14 Nov"]]), lagos);
    const records = splitCsvRecords(csv).filter((r) => r.length > 0);
    const width = records[0].split(",").length;
    const cells = records.map(parseCsvRecord);
    for (const row of cells) expect(row).toHaveLength(width);
    const booked = width - 2;
    expect(cells[1][booked]).toBe("2026-11-15 00:30");
    expect(cells[2][booked]).toBe("");
    expect(cells[3][booked]).toBe("");
  });

  test("the per-date export (the one the guest list uses) keeps the booked start and still rewrites Day", () => {
    const csv = serializeGuestsToCsvByOccurrence(rows(), new Map([["d1", "Sat 14 Nov"]]), "Africa/Lagos");
    const records = splitCsvRecords(csv).filter((r) => r.length > 0).map(parseCsvRecord);
    const width = records[0].length;
    expect(records[0][width - 2]).toBe("Booked start");
    expect(records[1][width - 2]).toBe("2026-11-15 00:30");
    expect(records[1][width - 1]).toBe("Sat 14 Nov");
    for (const row of records) expect(row).toHaveLength(width);
  });

  test("without a cell writer the column stays, blank, so positions never move", () => {
    const csv = serializeGuestsToCsv(rows());
    const records = splitCsvRecords(csv).filter((r) => r.length > 0).map(parseCsvRecord);
    expect(records[0][records[0].length - 2]).toBe("Booked start");
    expect(records[1][records[0].length - 2]).toBe("");
  });
});

/** RFC 4180 record -> cells (quotes, doubled quotes, embedded commas/CRLF). */
function parseCsvRecord(record: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < record.length; i += 1) {
    const c = record[i];
    if (quoted) {
      if (c === '"' && record[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
