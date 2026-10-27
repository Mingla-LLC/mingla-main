// Issue #4130 (Wave 0) — export and sort a list over every row that matches
// its search and filters, not just the page on screen.
//
// Pure module: no React, no Supabase. EntityListView hands in the page's own
// `fetchPage` (the one data authority, ORCH-1271), and this walks it page by
// page up to a stated cap. A list longer than the cap says so; it never
// quietly exports or sorts a part as if it were the whole.

/** Rows fetched per request while walking a list. */
export const FETCH_ALL_PAGE_SIZE = 500;
/** The most rows one CSV export holds. */
export const EXPORT_ROW_CAP = 5000;
/** The most rows sorted in the browser for a list its server cannot sort. */
export const CLIENT_SORT_ROW_CAP = 2000;

/**
 * Every row for the query, up to `cap`.
 * Returns { rows, total, truncated }: `total` is what the server counted,
 * `truncated` is true when fewer rows came back than it counted.
 * A failed request throws (the caller shows the error); nothing is guessed.
 */
export async function fetchAllRows(fetchPage, query = {}, { pageSize = FETCH_ALL_PAGE_SIZE, cap = EXPORT_ROW_CAP } = {}) {
  const rows = [];
  let total = null;
  for (let page = 0; rows.length < cap; page += 1) {
    const result = await fetchPage({ ...query, page, pageSize });
    const batch = Array.isArray(result?.rows) ? result.rows : [];
    if (total === null) total = Number.isFinite(result?.total) ? result.total : null;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    if (total !== null && rows.length >= total) break;
  }
  const kept = rows.slice(0, cap);
  const counted = total ?? rows.length;
  return { rows: kept, total: counted, truncated: kept.length < counted || rows.length > cap };
}

function comparable(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return String(value);
}

/**
 * The rows sorted by one column. Empty values always sort last, whichever the
 * direction. Numbers compare as numbers, text by the reader's language with
 * numbers inside it in order ("Brand 2" before "Brand 10"). Stable.
 * `valueOf(row)` reads the column's value (defaults to row[key]).
 */
export function sortRowsBy(rows, key, direction, valueOf) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!key || (direction !== "asc" && direction !== "desc")) return list;
  const read = typeof valueOf === "function" ? valueOf : (row) => row?.[key];
  const sign = direction === "asc" ? 1 : -1;
  return list
    .map((row, index) => ({ row, index, value: comparable(read(row)) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      let order;
      if (typeof a.value === "number" && typeof b.value === "number") order = a.value - b.value;
      else order = String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
      return order === 0 ? a.index - b.index : order * sign;
    })
    .map((entry) => entry.row);
}
