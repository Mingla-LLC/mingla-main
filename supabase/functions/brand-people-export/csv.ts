export function csvCell(value: unknown): string {
  let rendered = value === null || value === undefined
    ? ""
    : Array.isArray(value)
    ? value.join("; ")
    : String(value);
  // A spreadsheet reads a leading = + - @, tab or carriage return as a formula
  // (#4514: guest-written answers now reach host CSVs); keep it text.
  if (/^[=+\-@\t\r]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}

export function csvFromRows(
  rows: Record<string, unknown>[],
  columns: readonly string[] = rows.length > 0 ? Object.keys(rows[0]) : [],
): string {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(",")
    ),
  ].join("\r\n") + "\r\n";
}
