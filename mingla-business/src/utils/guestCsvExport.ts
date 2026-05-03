/**
 * guestCsvExport — CSV serialization + platform-specific download for J-G6.
 *
 * Cycle 10: client-only. iOS/Android use expo-file-system + expo-sharing;
 * Web uses Blob + anchor-download. Filename format:
 * `{event-slug}-guest-list-{YYYY-MM-DD}.csv`. RFC 4180 quoting.
 *
 * Per Cycle 10 SPEC §4.8 + §5/J-G6.
 */

import { Platform, Share } from "react-native";

import type { LiveEvent } from "../store/liveEventStore";
import type { OrderRecord } from "../store/orderStore";
import type { CompGuestEntry } from "../store/guestStore";

// Re-typed locally to avoid importing the screen-level GuestRow shape
// here (keeps the utility decoupled from the J-G1 implementation).
export type ExportGuestRow =
  | { kind: "order"; id: string; order: OrderRecord; sortKey: string }
  | { kind: "comp"; id: string; comp: CompGuestEntry; sortKey: string };

const csvEscape = (value: string): string => {
  if (
    value.includes(",") ||
    value.includes("\"") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
};

const formatYmd = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatYmdToday = (): string => formatYmd(new Date().toISOString());

const orderStatusLabel = (status: OrderRecord["status"]): string => {
  if (status === "paid") return "Paid";
  if (status === "refunded_full") return "Refunded";
  if (status === "refunded_partial") return "Refunded (partial)";
  if (status === "cancelled") return "Cancelled";
  const _exhaust: never = status;
  return _exhaust;
};

const orderTicketSummary = (lines: OrderRecord["lines"]): string =>
  lines.map((l) => l.ticketNameAtPurchase).join("; ");

const orderQuantity = (lines: OrderRecord["lines"]): number =>
  lines.reduce((s, l) => s + l.quantity, 0);

export const serializeGuestsToCsv = (
  rows: ExportGuestRow[],
): string => {
  const headers = [
    "Name",
    "Email",
    "Phone",
    "Ticket type",
    "Quantity",
    "Status",
    "Order ID",
    "Purchase date",
    "Comp note",
  ];
  const lines: string[] = [headers.join(",")];

  for (const row of rows) {
    if (row.kind === "order") {
      const o = row.order;
      const fields = [
        o.buyer.name,
        o.buyer.email,
        o.buyer.phone,
        orderTicketSummary(o.lines),
        String(orderQuantity(o.lines)),
        orderStatusLabel(o.status),
        o.id,
        formatYmd(o.paidAt),
        "",
      ];
      lines.push(fields.map(csvEscape).join(","));
    } else {
      const c = row.comp;
      const fields = [
        c.name,
        c.email,
        c.phone,
        c.ticketNameAtCreation ?? "General comp",
        "1",
        "Comp",
        c.id,
        formatYmd(c.addedAt),
        c.notes,
      ];
      lines.push(fields.map(csvEscape).join(","));
    }
  }

  return `${lines.join("\r\n")}\r\n`;
};

export interface ExportGuestsCsvArgs {
  event: LiveEvent;
  rows: ExportGuestRow[];
}

const downloadCsvWeb = (csv: string, filename: string): void => {
  // Web-only path — guard via Platform.OS check before calling.
  // Use globalThis to avoid TS errors on RN where document/URL don't exist.
  const g = globalThis as unknown as {
    Blob?: typeof Blob;
    URL?: typeof URL;
    document?: Document;
  };
  if (g.Blob === undefined || g.URL === undefined || g.document === undefined) {
    throw new Error("Web download primitives not available");
  }
  const blob = new g.Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = g.URL.createObjectURL(blob);
  const anchor = g.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  g.document.body.appendChild(anchor);
  anchor.click();
  g.document.body.removeChild(anchor);
  g.URL.revokeObjectURL(url);
};

const downloadCsvNative = async (
  csv: string,
  filename: string,
): Promise<void> => {
  // [TRANSITIONAL] Native CSV file export is degraded — RN built-in
  // Share API can't share files directly without expo-sharing +
  // expo-file-system (not installed in mingla-business). For now,
  // share the CSV text content; operators can paste/import in their
  // target app or copy to clipboard. Discovery D-CYCLE10-IMPL-1
  // recommends adding expo-sharing + expo-file-system in a future
  // cycle to enable proper file-share UX on iOS/Android.
  await Share.share(
    {
      message: csv,
      title: filename,
    },
    {
      dialogTitle: "Export guest list",
      subject: filename,
    },
  );
};

export const exportGuestsCsv = async (
  args: ExportGuestsCsvArgs,
): Promise<void> => {
  const csv = serializeGuestsToCsv(args.rows);
  const filename = `${args.event.eventSlug}-guest-list-${formatYmdToday()}.csv`;
  if (Platform.OS === "web") {
    downloadCsvWeb(csv, filename);
    return;
  }
  await downloadCsvNative(csv, filename);
};
