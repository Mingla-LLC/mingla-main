/**
 * #4490 spec 08 O5 part B — the day-close export: one CSV row per payment of
 * the day (the server's rows, never re-added here), delivered on the same
 * download / share path as the guest list (guestCsvExport.exportCsvText):
 * web downloads a file, iOS and Android open the share sheet.
 *
 * Money columns are plain decimal amounts in the day's currency (a currency
 * column says which), so a spreadsheet can add them up. Names only; the
 * server never sends an email.
 */

import type { DayExport, DayExportRow, DayPerson } from "../services/venueDayCloseService";
import { csvCell, csvTextCell } from "./csvCell";
import { exportCsvText, type ExportResult } from "./guestCsvExport";

// ISO 4217 minor units that are not 2 (the same list the floor PDFs use).
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND",
  "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export const DAY_CLOSE_CSV_HEADER = [
  "Paid at",
  "Reference",
  "Check",
  "Payment type",
  "Currency",
  "Amount",
  "Service charge",
  "Tip",
  "Guest-paid fee",
  "Refunded",
  "Taken by",
  "Served by",
  "Late (after close)",
  "Paid after cancel",
] as const;

const METHOD: Record<string, string> = {
  cash: "Cash",
  own_machine: "Card machine (yours)",
  tap: "Tap to pay",
  scan_card: "Scan to pay - card",
  scan_transfer: "Scan to pay - bank transfer",
  scan_other: "Scan to pay - other",
  room: "Charge to room",
};

// #4490 08-O5 fix 1 (O5-T2): the money columns stay plain numbers (a
// negative amount is still a number); every other column may hold text a
// person typed (a check name, a staff name), so it is written through the
// shared formula-safe cell (utils/csvCell.csvTextCell).
const AMOUNT_COLUMNS = new Set(["Amount", "Service charge", "Tip", "Guest-paid fee", "Refunded"]);
const NUMERIC_AT = new Set(DAY_CLOSE_CSV_HEADER.flatMap((name, i) => (AMOUNT_COLUMNS.has(name) ? [i] : [])));

function rowCells(values: readonly string[]): string {
  return values.map((value, i) => (NUMERIC_AT.has(i) ? csvCell(value) : csvTextCell(value))).join(",");
}

/** A minor amount as a plain decimal ("18500.00", "1200" for zero-decimal currencies). */
export function csvAmount(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits = ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
  const factor = 10 ** digits;
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / factor);
  const fraction = abs % factor;
  const text = digits === 0 ? String(whole) : `${whole}.${String(fraction).padStart(digits, "0")}`;
  return negative ? `-${text}` : text;
}

function who(p: DayPerson): string {
  if (p.kind === "device") return "Till device";
  if (p.kind === "system") return "Cleared by the Till";
  // #4490 after #4579: the name already reads "Kunle from Mingla" (never an email).
  if (p.kind === "mingla_support") return p.name ?? "Mingla Team";
  return p.name ?? "Team member";
}

export function dayCloseCsvRow(row: DayExportRow, currency: string): string[] {
  return [
    row.paidAtLocal,
    row.reference,
    row.check ?? "",
    METHOD[row.method] ?? "Other",
    currency,
    csvAmount(row.amountMinor, currency),
    csvAmount(row.serviceChargeMinor, currency),
    csvAmount(row.tipMinor, currency),
    csvAmount(row.guestFeeMinor, currency),
    csvAmount(row.refundedMinor, currency),
    who(row.takenBy),
    who(row.server),
    row.late ? "Yes" : "No",
    row.paidAfterCancel ? "Yes" : "No",
  ];
}

export function serializeDayCloseCsv(data: DayExport): string {
  const lines = [DAY_CLOSE_CSV_HEADER.map((name) => csvTextCell(name)).join(",")];
  for (const row of data.rows) lines.push(rowCells(dayCloseCsvRow(row, data.currency)));
  return `${lines.join("\r\n")}\r\n`;
}

export function dayCloseCsvFilename(venueName: string, businessDate: string): string {
  const slug = venueName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue";
  return `${slug}-day-close-${businessDate}.csv`;
}

export function exportDayCloseCsv(data: DayExport): Promise<ExportResult> {
  return exportCsvText(serializeDayCloseCsv(data), dayCloseCsvFilename(data.venueName, data.businessDate), "Export the day");
}
