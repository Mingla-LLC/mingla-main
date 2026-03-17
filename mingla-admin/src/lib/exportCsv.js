/**
 * CSV Export Utility
 * Exports table data as a UTF-8 CSV file with BOM prefix for Excel compatibility.
 * Maximum 10,000 rows to prevent memory issues.
 */

const MAX_EXPORT_ROWS = 10_000;

export function exportCsv(columns, rows, filename) {
  const capped = rows.length > MAX_EXPORT_ROWS ? rows.slice(0, MAX_EXPORT_ROWS) : rows;
  const headers = columns.map((c) => escapeField(c.label));

  const csvRows = capped.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        if (val == null) return "";
        if (typeof val === "object") return escapeField(JSON.stringify(val));
        return escapeField(String(val));
      })
      .join(",")
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  return { exported: capped.length, capped: rows.length > MAX_EXPORT_ROWS };
}

function escapeField(str) {
  // Prevent CSV formula injection — neutralize cells starting with formula-trigger chars
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("'")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export { MAX_EXPORT_ROWS };
