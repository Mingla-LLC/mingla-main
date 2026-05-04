/**
 * guestCsvExport — CSV serialization + platform-specific download for J-G6.
 *
 * Cycle 10: client-only. iOS/Android use expo-file-system + expo-sharing;
 * Web uses Blob + anchor-download. Filename format:
 * `{event-slug}-guest-list-{YYYY-MM-DD}.csv`. RFC 4180 quoting.
 *
 * Cycle 12: extended with `kind: "door"` rows; door-only export wrapper.
 *
 * Cycle 13 (DEC-095 D-13-8): extended `serializeGuestsToCsv` with
 * Gross/Refunded/Net columns at positions 12-14 + optional summary stanza
 * preamble (5 lines starting with `#`) + new `exportReconciliationCsv`
 * wrapper for J-R3 reconciliation export. Native CSV degradation
 * (D-CYCLE10-IMPL-1 — Share.share text-content) persists.
 *
 * Per Cycle 10 SPEC §4.8 + Cycle 12 SPEC §4.20 + Cycle 13 SPEC §4.2.3.
 */

import { Platform, Share } from "react-native";

import type { LiveEvent } from "../store/liveEventStore";
import type { OrderRecord } from "../store/orderStore";
import type { CompGuestEntry } from "../store/guestStore";
import type {
  DoorPaymentMethod,
  DoorSaleRecord,
} from "../store/doorSalesStore";
import type { ReconciliationSummary } from "./reconciliation";

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

/**
 * Cycle 13 (DEC-095 D-13-8): summary stanza shape — 5 lines of `#`-prefixed
 * comment metadata prepended to the CSV when reconciliation export is fired.
 * Spreadsheet apps typically skip `#`-prefixed lines (RFC 4180 leaves comment
 * conventions to consumers; Excel + Google Sheets both treat them as data
 * unless explicitly skipped — operator may need to filter row 1-5 manually
 * during import). Acceptable: the data still imports; comment lines are
 * discarded once.
 */
export interface ReconciliationCsvSummary {
  eventName: string;
  status: string;
  totalLiveTickets: number;
  grossRevenue: number;
  totalRefunded: number;
  netRevenue: number;
  uniqueScannedTickets: number;
}

const formatGbpForCsv = (n: number): string => n.toFixed(2);

export const serializeGuestsToCsv = (
  rows: ExportGuestRow[],
  summary?: ReconciliationCsvSummary,
): string => {
  // Cycle 12 — added "Kind" column at front (ONLINE | COMP | DOOR) +
  // "Payment method" column (online sales: card/apple/google; door sales:
  // cash/card_reader/nfc/manual; comps: blank).
  // Cycle 13 — added "Gross", "Refunded", "Net" columns at positions 12-14
  // for accountant-friendly per-row refund attribution (DEC-095 D-13-8).
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
    "Gross",
    "Refunded",
    "Net",
  ];

  // Cycle 13 — optional summary stanza (5 lines of `#`-prefixed metadata)
  // prepended to the CSV when reconciliation export is fired.
  const stanzaLines: string[] = [];
  if (summary !== undefined) {
    stanzaLines.push(`# ${summary.eventName} — ${summary.status}`);
    stanzaLines.push(
      `# Tickets: ${summary.totalLiveTickets} live · ${summary.uniqueScannedTickets} scanned`,
    );
    stanzaLines.push(`# Revenue: gross ${formatGbpForCsv(summary.grossRevenue)} GBP`);
    stanzaLines.push(`# Refunded: ${formatGbpForCsv(summary.totalRefunded)} GBP`);
    stanzaLines.push(`# Net: ${formatGbpForCsv(summary.netRevenue)} GBP`);
  }

  const lines: string[] = [...stanzaLines, headers.join(",")];

  for (const row of rows) {
    if (row.kind === "order") {
      const o = row.order;
      const grossPaid = o.totalGbpAtPurchase;
      const refunded = o.refundedAmountGbp;
      const net = Math.max(0, grossPaid - refunded);
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
        formatGbpForCsv(grossPaid),
        formatGbpForCsv(refunded),
        formatGbpForCsv(net),
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
        "0.00",
        "0.00",
        "0.00",
      ];
      lines.push(fields.map(csvEscape).join(","));
    } else {
      // Cycle 12 — door sale row.
      const s = row.sale;
      const buyerName = s.buyerName.length > 0 ? s.buyerName : "Walk-up";
      const grossPaid = s.totalGbpAtSale;
      const refunded = s.refundedAmountGbp;
      const net = Math.max(0, grossPaid - refunded);
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
        formatGbpForCsv(grossPaid),
        formatGbpForCsv(refunded),
        formatGbpForCsv(net),
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

/**
 * Cycle 13 v2 — Export-result discriminator (D-CYCLE13-IMPL-6 fix).
 *
 * Const #3 — no silent failures. Native Share.share() resolves on BOTH
 * sharedAction (user picked a destination) AND dismissedAction (user
 * dismissed the share sheet). Pre-rework code awaited without checking
 * result.action and toasted success unconditionally — meaning a dismissed
 * share sheet still fired a "successfully exported" toast (caught at
 * Cycle 13 device smoke 2026-05-04).
 *
 * The rework returns a discriminated union so callers can adapt their toast
 * copy honestly:
 *   - "downloaded" → web Blob+anchor.click() actually fired
 *   - "shared" → native share sheet completed (user picked Mail/Notes/etc.)
 *   - "dismissed" → native share sheet dismissed (user backed out — silent toast)
 *
 * The TRANSITIONAL native-Share-text-content limitation (D-CYCLE10-IMPL-1)
 * persists; full file-share UX (`expo-sharing` + `expo-file-system` install +
 * Sharing.shareAsync()) defers to B-cycle.
 */
export type ExportResult =
  | { method: "downloaded" }
  | { method: "shared" }
  | { method: "dismissed" };

const downloadCsvNative = async (
  csv: string,
  filename: string,
): Promise<"shared" | "dismissed"> => {
  // [TRANSITIONAL] Native CSV file export is degraded — RN built-in
  // Share API can't share files directly without expo-sharing +
  // expo-file-system (not installed in mingla-business). For now,
  // share the CSV text content; operators can paste/import in their
  // target app or copy to clipboard. Discovery D-CYCLE10-IMPL-1
  // recommends adding expo-sharing + expo-file-system in a future
  // cycle to enable proper file-share UX on iOS/Android.
  //
  // Cycle 13 v2 (D-CYCLE13-IMPL-6): capture result.action so callers can
  // toast honestly. RN's Share.share() returns
  // { action: "sharedAction" | "dismissedAction"; activityType?: string }.
  const result = await Share.share(
    {
      message: csv,
      title: filename,
    },
    {
      dialogTitle: "Export guest list",
      subject: filename,
    },
  );
  return result.action === "sharedAction" ? "shared" : "dismissed";
};

export const exportGuestsCsv = async (
  args: ExportGuestsCsvArgs,
): Promise<ExportResult> => {
  const csv = serializeGuestsToCsv(args.rows);
  const filename = `${args.event.eventSlug}-guest-list-${formatYmdToday()}.csv`;
  if (Platform.OS === "web") {
    downloadCsvWeb(csv, filename);
    return { method: "downloaded" };
  }
  const action = await downloadCsvNative(csv, filename);
  return { method: action };
};

// ---- Cycle 12 — door-sales-only export (J-D5 reconciliation) -------

export interface ExportDoorSalesCsvArgs {
  event: LiveEvent;
  sales: DoorSaleRecord[];
}

export const exportDoorSalesCsv = async (
  args: ExportDoorSalesCsvArgs,
): Promise<ExportResult> => {
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
    return { method: "downloaded" };
  }
  const action = await downloadCsvNative(csv, filename);
  return { method: action };
};

// ---- Cycle 13 — cross-source reconciliation export (J-R3) -----------

export interface ExportReconciliationCsvArgs {
  event: LiveEvent;
  /** Pre-filtered (eventId-scoped) at the route layer. */
  orders: OrderRecord[];
  doorSales: DoorSaleRecord[];
  comps: CompGuestEntry[];
  /** ReconciliationSummary from computeReconciliation; populates the 5-line summary stanza prefix. */
  summary: ReconciliationSummary;
}

/**
 * Cycle 13 J-R3 reconciliation export (DEC-095 D-13-7 + D-13-8 + D-13-9).
 * - Joins orders + door sales + comps into a single newest-first ledger
 * - Prepends 5-line summary stanza (event name + status + tickets + revenue + refunded + net)
 * - 14-column row shape (Kind/Name/Email/Phone/Ticket type/Quantity/Status/Payment method/ID/Date/Notes/Gross/Refunded/Net)
 * - Filename `{slug}-reconciliation-{YYYY-MM-DD}.csv`
 * - Web: Blob + anchor-download. Native: Share.share text content (TRANSITIONAL D-CYCLE10-IMPL-1).
 *
 * PDF DEFERRED to B-cycle email-attachment-via-Resend per D-13-7 (no expo-print dep).
 */
export const exportReconciliationCsv = async (
  args: ExportReconciliationCsvArgs,
): Promise<ExportResult> => {
  const rows: ExportGuestRow[] = [
    ...args.orders.map(
      (o): ExportGuestRow => ({
        kind: "order",
        id: o.id,
        order: o,
        sortKey: o.paidAt,
      }),
    ),
    ...args.doorSales.map(
      (s): ExportGuestRow => ({
        kind: "door",
        id: s.id,
        sale: s,
        sortKey: s.recordedAt,
      }),
    ),
    ...args.comps.map(
      (c): ExportGuestRow => ({
        kind: "comp",
        id: c.id,
        comp: c,
        sortKey: c.addedAt,
      }),
    ),
  ];
  // Newest-first sort across all 3 kinds for consistent reading
  rows.sort((a, b) =>
    a.sortKey > b.sortKey ? -1 : a.sortKey < b.sortKey ? 1 : 0,
  );

  const stanza: ReconciliationCsvSummary = {
    eventName: args.event.name,
    status: args.summary.headlineCopy,
    totalLiveTickets: args.summary.totalLiveTickets,
    grossRevenue: args.summary.grossRevenue,
    totalRefunded: args.summary.totalRefunded,
    // grossRevenue is already net of refunds (live amount); we surface it again
    // here under "Net" so the 5-line preamble reads cleanly to an accountant.
    netRevenue: args.summary.grossRevenue,
    uniqueScannedTickets: args.summary.uniqueScannedTickets,
  };

  const csv = serializeGuestsToCsv(rows, stanza);
  const filename = `${args.event.eventSlug}-reconciliation-${formatYmdToday()}.csv`;
  if (Platform.OS === "web") {
    downloadCsvWeb(csv, filename);
    return { method: "downloaded" };
  }
  const action = await downloadCsvNative(csv, filename);
  return { method: action };
};
