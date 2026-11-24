/**
 * The one owner of a CSV cell in mingla-business (RFC 4180 quoting), shared
 * by the guest list export (guestCsvExport) and the day-close export
 * (dayCloseCsv). Pure: no platform imports.
 *
 * #4490 08-O5 fix 1 (O5-T2): csvTextCell also neutralises text a spreadsheet
 * would run as a formula. A cell starting with =, +, -, @, a tab or a carriage
 * return gets a leading apostrophe and is quoted, the same rule as
 * mingla-admin's exportCsv (escapeField). Use csvTextCell for anything a
 * person typed (names, check labels, notes) and csvCell for numbers, so a
 * negative amount stays a number.
 */

export function csvCell(value: string | null): string {
  // #2411 — a zero-money online order legitimately has no currency. Preserve
  // that truth as an empty CSV cell; never stringify null or invent a code.
  const normalized = value ?? "";
  if (
    normalized.includes(",") ||
    normalized.includes("\"") ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvTextCell(value: string | null): string {
  const normalized = value ?? "";
  if (FORMULA_START.test(normalized)) {
    return `"'${normalized.replace(/"/g, "\"\"")}"`;
  }
  return csvCell(normalized);
}
