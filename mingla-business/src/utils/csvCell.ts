/**
 * The one owner of a CSV cell in mingla-business (RFC 4180 quoting), shared
 * by the guest list export (guestCsvExport) and the day-close export
 * (dayCloseCsv). Pure: no platform imports.
 *
 * #4490 08-O5 fix 1 (O5-T2): csvTextCell also neutralises text a spreadsheet
 * would run as a formula. A cell whose first non-space character is =, +, -,
 * @ (or their full-width forms), a tab, a carriage return or a line feed gets
 * a leading apostrophe and is quoted (08-O5 fix 3 widened the rule from the
 * first character), close to the rule of
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

// #4490 08-O5 fix 3: the trigger is the FIRST NON-SPACE character, so
// "  =1+1" and a full-width "＝1+1" (＝ ＋ － ＠, which some spreadsheets
// read as = + - @) are caught too; a tab, carriage return or line feed at the
// start (or after leading spaces) also counts.
const FORMULA_START = /^[\p{Zs}\u200B\uFEFF]*[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/u;

// A phone number in international form (+ then 6 to 15 digits, the E.164
// shape, nothing else): a spreadsheet can only read it as that number, so it
// is written as quoted text with no visible apostrophe.
const E164_PHONE = /^\+[1-9][0-9]{5,14}$/;

export function csvTextCell(value: string | null): string {
  const normalized = value ?? "";
  if (E164_PHONE.test(normalized)) {
    return `"${normalized}"`;
  }
  if (FORMULA_START.test(normalized)) {
    return `"'${normalized.replace(/"/g, "\"\"")}"`;
  }
  return csvCell(normalized);
}
