/**
 * issue #3281 PR8 — Day-cell ordering for guest CSV export.
 * Kept out of guestCsvExport.ts so the shared __common chunk does not grow
 * (guests / door / reconciliation / finance all share that module).
 */

import type { LiveEvent } from "../store/liveEventStore";
import {
  exportCsvText,
  serializeGuestsToCsv,
  type ExportGuestRow,
  type ExportResult,
} from "./guestCsvExport";

export type GuestCsvDayCellOrder = {
  ticketDays?: { eventDateIds: string[] }[];
};

export const orderDayCellByOccurrence = (
  order: GuestCsvDayCellOrder,
  dayLabels: ReadonlyMap<string, string>,
): string => {
  const ids = new Set<string>();
  for (const t of order.ticketDays ?? []) {
    for (const id of t.eventDateIds) ids.add(id);
  }
  if (ids.size === 0) return "";
  // A pass that covers every labelled day → "All N dates".
  const allIds = [...dayLabels.keys()];
  if (
    allIds.length >= 2 &&
    ids.size === allIds.length &&
    allIds.every((id) => ids.has(id))
  ) {
    return `All ${allIds.length} dates`;
  }
  // Sort by the event's date order (Map insertion = occurrence start order),
  // never lexicographic label order. Ids on the order but missing from
  // dayLabels stay omitted (#9).
  const labels: string[] = [];
  for (const id of allIds) {
    if (!ids.has(id)) continue;
    const label = dayLabels.get(id);
    if (label !== undefined && label.length > 0) labels.push(label);
  }
  return labels.join("; ");
};

const csvEscapeDay = (value: string): string => {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

/** Split RFC 4180 records; CRLF inside quotes stays inside the same record. */
export const splitCsvRecords = (csv: string): string[] => {
  const records: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i] ?? "";
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && ch === "\r" && csv[i + 1] === "\n") {
      records.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    if (!inQuotes && ch === "\n") {
      records.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || csv.endsWith("\n") || csv.endsWith("\r\n")) {
    records.push(cur);
  }
  return records;
};

const lastUnquotedComma = (line: string): number => {
  let inQuotes = false;
  let last = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      last = i;
    }
  }
  return last;
};

const daySourceForRow = (row: ExportGuestRow): GuestCsvDayCellOrder => {
  if (row.kind === "order") return row.order;
  return {};
};

/**
 * Same as serializeGuestsToCsv, but the Day column uses occurrence order /
 * "All N dates" without growing the shared guestCsvExport __common module.
 * Record splitting respects quoted CRLF so notes cannot desync rowIdx.
 */
export const serializeGuestsToCsvByOccurrence = (
  rows: ExportGuestRow[],
  dayLabels: ReadonlyMap<string, string> = new Map(),
): string => {
  const raw = serializeGuestsToCsv(rows, undefined, dayLabels);
  const records = splitCsvRecords(raw);
  if (records.length === 0) return raw;
  const out: string[] = [];
  let rowIdx = 0;
  for (let i = 0; i < records.length; i += 1) {
    const line = records[i] ?? "";
    if (i === 0 || line.length === 0 || line.startsWith("#")) {
      out.push(line);
      continue;
    }
    const row = rows[rowIdx];
    rowIdx += 1;
    if (row === undefined) {
      out.push(line);
      continue;
    }
    const day = orderDayCellByOccurrence(daySourceForRow(row), dayLabels);
    const comma = lastUnquotedComma(line);
    if (comma < 0) {
      out.push(line);
      continue;
    }
    out.push(`${line.slice(0, comma + 1)}${csvEscapeDay(day)}`);
  }
  return `${out.join("\r\n")}\r\n`;
};

export const exportGuestsCsvByOccurrence = async (args: {
  event: LiveEvent;
  rows: ExportGuestRow[];
  dayLabels?: ReadonlyMap<string, string>;
}): Promise<ExportResult> => {
  const csv = serializeGuestsToCsvByOccurrence(
    args.rows,
    args.dayLabels ?? new Map(),
  );
  const ymd = new Date().toISOString().slice(0, 10);
  const filename = `${args.event.eventSlug}-guest-list-${ymd}.csv`;
  return exportCsvText(csv, filename, "Export guest list");
};
