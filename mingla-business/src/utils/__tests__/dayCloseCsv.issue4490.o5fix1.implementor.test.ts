/**
 * #4490 spec 08 O5 fix 1 (O5-T2): the day-close export never lets a
 * staff-typed check name or a staff name run as a spreadsheet formula, and a
 * negative amount stays a number. One cell owner (utils/csvCell) for the
 * guest list and the day close.
 */
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn() } }));
jest.mock("../guestCsvExport", () => ({ exportCsvText: jest.fn(async () => ({ method: "downloaded" })) }));

import { mapDayExport } from "../../services/venueDayCloseService";
import { csvCell, csvTextCell } from "../csvCell";
import { serializeDayCloseCsv } from "../dayCloseCsv";

const HOSTILE = ["=HYPERLINK(\"http://x.y\",\"z\")", "+SUM(1+1)", "-2+3", "@cmd", "\tTAB", "\rCR"];

function row(i: number, check: string | null, taken: string, served: string) {
  return {
    paymentId: `p${i}`, reference: `REF0000${i}`, paidAtLocal: "2026-11-24 01:46", check, method: "cash",
    amountMinor: 2800000, serviceChargeMinor: 0, tipMinor: 0, guestFeeMinor: 0, refundedMinor: -500000,
    takenBy: { kind: "person", name: taken }, server: { kind: "person", name: served }, paidAfterCancel: false, late: false,
  };
}

describe("O5-T2 formula text is neutralised in every text column", () => {
  const data = mapDayExport({
    venueName: "Guest QA Grill", businessDate: "2026-11-24", currency: "NGN",
    rows: HOSTILE.map((h, i) => row(i, h, h, h)),
  });
  const csv = serializeDayCloseCsv(data);
  const lines = csv.split("\r\n").filter((l) => l.length > 0);

  test("each hostile check, taken-by and served-by value is written as text (a leading apostrophe, quoted)", () => {
    HOSTILE.forEach((h, i) => {
      const safe = `"'${h.replace(/"/g, "\"\"")}"`;
      const cells = lines[1 + i];
      expect(cells.split(safe).length - 1).toBe(3);
    });
  });

  test("no cell of the file starts with a formula character", () => {
    // Split on commas outside quotes; a quoted cell starts with ".
    for (const line of lines.slice(1)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "")).filter((c) => c !== "") ?? [];
      for (const c of cells) {
        const text = c.startsWith("\"") ? c.slice(1, -1).replace(/""/g, "\"") : c;
        if (!/^-?\d+\.\d{2}$/.test(text)) expect(text).not.toMatch(/^[=+\-@\t\r]/);
      }
    }
  });

  test("money stays numbers: a negative amount is written as -5000.00, unquoted", () => {
    expect(lines[1]).toContain(",28000.00,0.00,0.00,0.00,-5000.00,");
  });

  test("the shared cell: plain text unchanged, commas quoted, numbers never prefixed", () => {
    expect(csvTextCell("Table 4")).toBe("Table 4");
    expect(csvTextCell("Table 6, by the window")).toBe("\"Table 6, by the window\"");
    expect(csvTextCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("-15.05")).toBe("-15.05");
    expect(csvCell(null)).toBe("");
  });
});
