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
import type {
  DoorPaymentMethod,
  DoorSaleRecord,
} from "../store/doorSalesStore";

// Re-typed locally to avoid importing the screen-level GuestRow shape
// here (keeps the utility decoupled from the J-G1 implementation).
//
// Cycle 12: extended with `kind: "door"` rows. CSV grouping: each row's
// "Kind" column is ONLINE | COMP | DOOR per SPEC §4.20.
export type ExportGuestRow =
  | { kind: "order"; id: string; order: OrderRecord; sortKey: string }
  | { kind: "comp"; id: string; comp: CompGuestEntry; sortKey: string }
  | { kind: "door"; id: string; sale: DoorSaleRecord; sortKey: string };

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

// Cycle 12 — door sale helpers
const doorTicketSummary = (lines: DoorSaleRecord["lines"]): string =>
  lines.map((l) => l.ticketNameAtSale).join("; ");

const doorQuantity = (lines: DoorSaleRecord["lines"]): number =>
  lines.reduce((s, l) => s + l.quantity, 0);

const doorPaymentLabel = (method: DoorPaymentMethod): string => {
  switch (method) {
    case "cash":
      return "Cash";
    case "card_reader":
      return "Card reader";
    case "nfc":
      return "NFC tap";
    case "manual":
      return "Manual";
    default: {
      const _exhaust: never = method;
      return _exhaust;
    }
  }
};

const doorStatusLabel = (status: DoorSaleRecord["status"]): string => {
  if (status === "completed") return "Door (paid)";
  if (status === "refunded_full") return "Door (refunded)";
  if (status === "refunded_partial") return "Door (refunded partial)";
  const _exhaust: never = status;
  return _exhaust;
};

export const serializeGuestsToCsv = (
  rows: ExportGuestRow[],
): string => {
  // Cycle 12 — added "Kind" column at front (ONLINE | COMP | DOOR) +
  // "Payment method" column (online sales: card/apple/google; door sales:
  // cash/card_reader/nfc/manual; comps: blank).
  const headers = [
    "Kind",
    "Name",
    "Email",
    "Phone",
    "Ticket type",
    "Quantity",
    "Status",
    "Payment method",
    "Order/Sale ID",
    "Date",
    "Notes",
  ];
  const lines: string[] = [headers.join(",")];

  for (const row of rows) {
    if (row.kind === "order") {
      const o = row.order;
      const fields = [
        "ONLINE",
        o.buyer.name,
        o.buyer.email,
        o.buyer.phone,
        orderTicketSummary(o.lines),
        String(orderQuantity(o.lines)),
        orderStatusLabel(o.status),
        o.paymentMethod,
        o.id,
        formatYmd(o.paidAt),
        "",
      ];
      lines.push(fields.map(csvEscape).join(","));
    } else if (row.kind === "comp") {
      const c = row.comp;
      const fields = [
        "COMP",
        c.name,
        c.email,
        c.phone,
        c.ticketNameAtCreation ?? "General comp",
        "1",
        "Comp",
        "",
        c.id,
        formatYmd(c.addedAt),
        c.notes,
      ];
      lines.push(fields.map(csvEscape).join(","));
    } else {
      // Cycle 12 — door sale row.
      const s = row.sale;
      const buyerName = s.buyerName.length > 0 ? s.buyerName : "Walk-up";
      const fields = [
        "DOOR",
        buyerName,
        s.buyerEmail,
        s.buyerPhone,
        doorTicketSummary(s.lines),
        String(doorQuantity(s.lines)),
        doorStatusLabel(s.status),
        doorPaymentLabel(s.paymentMethod),
        s.id,
        formatYmd(s.recordedAt),
        s.notes,
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

// ---- Cycle 12 — door-sales-only export (J-D5 reconciliation) -------

export interface ExportDoorSalesCsvArgs {
  event: LiveEvent;
  sales: DoorSaleRecord[];
}

export const exportDoorSalesCsv = async (
  args: ExportDoorSalesCsvArgs,
): Promise<void> => {
  // Reuse the merged serializer with door-only rows for consistent CSV shape.
  const rows: ExportGuestRow[] = args.sales.map((s) => ({
    kind: "door",
    id: s.id,
    sale: s,
    sortKey: s.recordedAt,
  }));
  const csv = serializeGuestsToCsv(rows);
  const filename = `${args.event.eventSlug}-door-sales-${formatYmdToday()}.csv`;
  if (Platform.OS === "web") {
    downloadCsvWeb(csv, filename);
    return;
  }
  await downloadCsvNative(csv, filename);
};
