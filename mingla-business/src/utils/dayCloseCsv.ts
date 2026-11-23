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

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
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
  if (p.kind === "mingla_support") return p.name ? `${p.name} (Mingla support)` : "Mingla support";
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
  const lines = [DAY_CLOSE_CSV_HEADER.map(cell).join(",")];
  for (const row of data.rows) lines.push(dayCloseCsvRow(row, data.currency).map(cell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function dayCloseCsvFilename(venueName: string, businessDate: string): string {
  const slug = venueName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue";
  return `${slug}-day-close-${businessDate}.csv`;
}

export function exportDayCloseCsv(data: DayExport): Promise<ExportResult> {
  return exportCsvText(serializeDayCloseCsv(data), dayCloseCsvFilename(data.venueName, data.businessDate), "Export the day");
}
