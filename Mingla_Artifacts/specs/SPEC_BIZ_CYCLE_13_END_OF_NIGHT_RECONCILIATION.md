# SPEC — BIZ Cycle 13 (End-of-Night Reconciliation Report)

**Status:** BINDING contract — produced by `/mingla-forensics` SPEC mode 2026-05-04 against dispatch [`prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
**Cycle:** Cycle 13 — End-of-Night Reconciliation Report (canonical per [`github/epics/cycle-13.md`](../github/epics/cycle-13.md))
**Confidence:** **H** — investigation H per thread + H overall; all 11 architectural decisions locked via DEC-095; SPEC formalizes investigation §4 (data shape) + §5 (discrepancy formula) into IMPL-ready contracts. Zero new investigations needed.
**Estimated IMPL wall:** ~24h (epic budget)

---

## 1 — Layman summary

After an event ends, organisers manually cross-reference 4 client ledgers (online orders + door sales + comp guests + scans) to know "did the night make money? did everyone get in?". Cycle 13 ships ONE screen at `app/event/[id]/reconciliation.tsx` that joins all 4 sources — surfacing tickets-sold (online + door + comp), revenue (per-method break + corrected payout split), refunds (online + door), scans (success / dups / no-shows), advisory discrepancies (3 classes), and CSV export. Cycle 12 J-D5 door-only card stays put — Cycle 13 is the cross-source SUPERSET. Zero migrations, zero new dependencies, zero mutations to existing stores. Permission-gated `finance_manager+` (rank 30).

---

## 2 — Cited inputs (binding context)

| # | Input | Why bound to this SPEC |
|---|-------|----------------------|
| 1 | [`reports/INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../reports/INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md) | Source of cross-store data shape map (§4) + discrepancy formula (§5) + 5 forensics discoveries (§9) |
| 2 | [`DECISION_LOG.md`](../DECISION_LOG.md) DEC-095 | Locks 11 architectural decisions D-13-1 through D-13-11; SPEC writer does NOT re-litigate |
| 3 | [`github/epics/cycle-13.md`](../github/epics/cycle-13.md) | Canonical epic — 3 journeys (J-R1 + J-R2 + J-R3); ~24h budget |
| 4 | [`prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md) | Dispatch — scope/non-goals + layer specification + SC + tests + implementation order outlines |
| 5 | [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md) | Cycle 12 J-D5 reconciliation card — visual + selector + export pattern Cycle 13 mirrors; HIDDEN-1 contract definition |
| 6 | [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md) | Selector pattern rule (raw entries + useMemo, never fresh-array subscriptions) |
| 7 | [`reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md) | I-25 + native CSV degradation TRANSITIONAL D-CYCLE10-IMPL-1 baseline |
| 8 | [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md) | ORCH-0710 hook ordering rule + I-27 single-scan-per-ticket |
| 9 | [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md) | `MIN_RANK` + `useCurrentBrandRole` + `gateCaptionFor` plumbing reused verbatim |
| 10 | Memory rules (11 entries, MEMORY.md) | `feedback_diagnose_first_workflow` · `feedback_orchestrator_never_executes` · `feedback_no_summary_paragraph` · `feedback_implementor_uses_ui_ux_pro_max` · `feedback_keyboard_never_blocks_input` · `feedback_rn_color_formats` · `feedback_toast_needs_absolute_wrap` · `feedback_rn_sub_sheet_must_render_inside_parent` · `feedback_anon_buyer_routes` · `feedback_no_coauthored_by` · `feedback_sequential_one_step_at_a_time` |

---

## 3 — Scope · Non-goals · Assumptions

### 3.1 Scope (BINDING)

**3 NEW files:**

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `mingla-business/src/utils/reconciliation.ts` | Pure aggregator — joins 4 stores into deterministic `ReconciliationSummary`; computes D1+D2+D3 discrepancies; defensive scan dedupe per I-27 | ~220 |
| `mingla-business/src/components/event/ReconciliationCtaTile.tsx` | Permission-gated ActionTile for Event Detail action grid; null-return when rank < 30 | ~80 |
| `mingla-business/app/event/[id]/reconciliation.tsx` | Full route — TopBar + ScrollView + adaptive headline + 4 main sections (TICKETS/REVENUE/SCANS/DISCREPANCIES) + EXPORT section + Toast | ~720 |

**5 MOD files:**

| Path | Change | Approx LOC delta |
|------|--------|------------------|
| `mingla-business/src/utils/permissionGates.ts` | Add `VIEW_RECONCILIATION: BRAND_ROLE_RANK.finance_manager` constant | +1 |
| `mingla-business/src/utils/guestCsvExport.ts` | Add 3 NEW columns (`Gross / Refunded / Net`) at positions 12-14 + new optional `summaryStanza` arg + new `exportReconciliationCsv(args)` wrapper + new `ReconciliationCsvSummary` type | ~+95 |
| `mingla-business/app/event/[id]/index.tsx` | Import `ReconciliationCtaTile` + add `handleReconciliation` handler + render tile in action grid (between Door Sales and Public page) | +12 |
| `mingla-business/app/event/[id]/door/index.tsx` | Add small "View full reconciliation" CTA at top of route (above TESTING MODE banner); permission-gated via `useCurrentBrandRole` + `canPerformAction(rank, "VIEW_RECONCILIATION")`; per D-CYCLE13-RECON-FOR-4 polish | +25 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Append I-32 amendment noting `VIEW_RECONCILIATION` is forward-compat (server RLS counterpart lands B-cycle); no NEW invariant | +6 |

**Totals:** 3 NEW + 5 MOD = 8 files. ~+1,160 / -0 LOC.

**0 NEW migrations, 0 NEW dependencies, 0 mutations to existing Zustand stores.**

### 3.2 Non-goals (DO NOT IMPLEMENT)

- ANY backend / RLS / edge-function work (B-cycle territory)
- ANY mutation to `useOrderStore` / `useDoorSalesStore` / `useGuestStore` / `useScanStore` (reads-only over existing entries)
- PDF generation of any kind (DEFERRED to B-cycle per D-13-7); the "Email PDF report" CTA renders DISABLED with caption "B-cycle"
- Audit log integration on reconciliation route (DEFERRED per D-13-11)
- Block-on-discrepancy lifecycle action (D-13-4 ADVISORY-only)
- "Close night" / "Books closed" lifecycle concept (no current schema or workflow demands it)
- Per-event role assignments for non-scanner roles (DEFERRED via DEC-093)
- Event Detail KPI card payout correction (separate follow-up; reconciliation route uses corrected split locally per D-13-10)
- I-27 store-level enforcement (per D-CYCLE13-RECON-FOR-1; B-cycle backlog. Cycle 13 dedupes scans defensively via Set)
- Multi-day events / recurring-event reconciliation aggregation (single eventId scope only)
- Adding `expo-print`, `expo-sharing`, `expo-file-system`, or `react-native-html-to-pdf` to package.json
- Modifying the persisted Zustand schema versions for any of the 4 source stores
- Any new TextInput on the reconciliation route (read-only screen; keyboard-blocks-input rule N/A)
- Any sub-sheet inside the reconciliation route (no Sheet primitive needed)

### 3.3 Assumptions

- **Stores TRANSITIONAL:** `useOrderStore` / `useDoorSalesStore` / `useGuestStore` / `useScanStore` remain TRANSITIONAL persisted Zustand authority through B-cycle. The `reconciliation.ts` aggregator MUST be store-agnostic — when B-cycle swaps to React Query reads, the input shape stays identical (`ReconciliationInputs`) and the aggregator is consumed unchanged.
- **Permission gate is mobile-UX only:** because Cycle 13 is reads-only over local stores (no server reads), `MIN_RANK.VIEW_RECONCILIATION = 30` has no RLS counterpart yet. Forward-compat note appended to I-32 making this explicit.
- **4% Stripe-fee stub:** acceptable as TRANSITIONAL on online revenue; door revenue stays at 1.0 (no fee) per D-13-10. Real Stripe payout API + Stripe Terminal SDK fee schedules ship B-cycle.
- **`deriveLiveStatus(event)`:** the canonical event-status predicate from `app/event/[id]/index.tsx:191-203` MUST be reused (not re-implemented). SPEC §4.6.2 specifies extraction to a shared utility.

---

## 4 — Layer specification

### 4.1 Database / Edge function / Service / Realtime layers

**N/A.** Cycle 13 is client-only. No migrations, no edge functions, no Supabase queries, no Realtime subscriptions.

### 4.2 Utility layer (NEW)

#### 4.2.1 NEW — `mingla-business/src/utils/reconciliation.ts`

**Purpose:** Pure, deterministic aggregator that joins 4 client stores into a `ReconciliationSummary` with deterministic shape. Side-effect-free; same inputs → identical output structurally; no console.log; no async.

**Header docstring (mandatory):**

```ts
/**
 * reconciliation — Pure aggregator joining 4 client stores into ReconciliationSummary (Cycle 13).
 *
 * Cycle 13 + DEC-095 — 11 architectural decisions locked. Reads-only over:
 *   - useOrderStore.entries (Cycle 9c)
 *   - useDoorSalesStore.entries (Cycle 12)
 *   - useGuestStore.entries (Cycle 10)
 *   - useScanStore.entries (Cycle 11)
 *
 * Selector contract: caller passes RAW arrays (raw entries + useMemo at the route layer).
 * NEVER subscribe to fresh-array selectors directly (banned per Cycle 9c v2 + Cycle 12 lesson).
 *
 * I-27 defensive dedupe: scanStore does NOT enforce single-scan-per-ticket at store level
 * (D-CYCLE13-RECON-FOR-1; B-cycle backlog). Cycle 13 dedupes by ticketId via Set for the
 * uniqueScannedTickets count.
 *
 * D-13-10 settlement-stub split: payoutEstimate = round(onlineRevenue × 96)/100 + doorRevenue.
 * Online×0.96 (Stripe fee stub); door×1.0 (cash fees zero; card_reader/NFC schedules ship B-cycle).
 *
 * D1/D2/D3 discrepancy detection: ADVISORY-only per D-13-4. D4 (unscanned) is informational,
 * NOT a discrepancy (reframed as "no-shows" on past events per D-13-6).
 *
 * Per Cycle 13 SPEC §4.2.1.
 */
```

**Required exports (verbatim signatures):**

```ts
import type { CompGuestEntry } from "../store/guestStore";
import type { DoorSaleRecord } from "../store/doorSalesStore";
import type { OrderRecord } from "../store/orderStore";
import type { ScanRecord } from "../store/scanStore";
import { expandDoorTickets } from "./expandDoorTickets";

export type EventLifecycleStatus = "live" | "upcoming" | "past" | "cancelled";

export type PaymentMethodKey =
  | "card"
  | "apple_pay"
  | "google_pay"
  | "free"
  | "cash"
  | "card_reader"
  | "nfc"
  | "manual";

export type DiscrepancyKind =
  | "auto_check_in_mismatch"
  | "method_sum_mismatch"
  | "refund_status_mismatch";

export interface DiscrepancyEntry {
  kind: DiscrepancyKind;
  /** Plain-English copy for the discrepancy row (deterministic for same inputs). */
  copy: string;
  /** Sub-row dim hint text. Always present (never undefined) per SPEC §4.2.1. */
  followupHint: string;
}

export interface ReconciliationSummary {
  // ---- Headline / lifecycle ----
  status: EventLifecycleStatus;
  headlineCopy: string;

  // ---- Tickets ----
  onlineLiveTickets: number;
  doorLiveTickets: number;
  compTickets: number;
  totalLiveTickets: number;

  // ---- Revenue ----
  onlineRevenue: number;
  doorRevenue: number;
  grossRevenue: number;
  totalRefunded: number;
  /** Sum of values across all 8 keys MUST equal grossRevenue (within ±0.005 rounding tolerance). */
  revenueByMethod: Record<PaymentMethodKey, number>;
  /** [TRANSITIONAL] payoutEstimate per D-13-10. EXIT: B-cycle Stripe payout + Terminal SDK. */
  payoutEstimate: number;
  /** Online refund subtotal; for break-down rendering. */
  onlineRefunded: number;
  /** Door refund subtotal; for break-down rendering. */
  doorRefunded: number;

  // ---- Scans ----
  uniqueScannedTickets: number;
  scanDups: number;
  scanWrongEvent: number;
  scanNotFound: number;
  scanVoid: number;
  scanCancelled: number;
  /** key = scannerUserId; value = unique-ticket success-scan count for that scanner. */
  scansByScanner: Record<string, number>;

  // ---- D4 informational (not discrepancy) ----
  unscannedTickets: number;

  // ---- Discrepancies (D1+D2+D3 only) ----
  discrepancies: DiscrepancyEntry[];
}

export interface ReconciliationInputs {
  eventId: string;
  status: EventLifecycleStatus;
  eventName: string;
  orderEntries: OrderRecord[];
  doorEntries: DoorSaleRecord[];
  compEntries: CompGuestEntry[];
  scanEntries: ScanRecord[];
}

/**
 * EMPTY_SUMMARY — used when event === null OR eventId is not a string.
 * MUST satisfy: every numeric field === 0; revenueByMethod has all 8 keys at 0;
 * scansByScanner === {}; discrepancies === []; status === "upcoming";
 * headlineCopy === "" (route uses fallback when headline empty).
 */
export const EMPTY_SUMMARY: ReconciliationSummary;

/**
 * Deterministic aggregator. MUST be pure (no side effects, no console.log, no async).
 * MUST handle empty input arrays gracefully (returns zero-counts everywhere).
 * MUST dedupe scans by ticketId per I-27 defensive contract.
 */
export const computeReconciliation = (inputs: ReconciliationInputs): ReconciliationSummary;

/**
 * Headline copy lookup — exposed for route consumers + tests.
 */
export const headlineCopyFor = (status: EventLifecycleStatus): string;
```

**Filtering contracts (BINDING — match investigation §4 verbatim):**

| Source | Filter | Field projection | Notes |
|--------|--------|-----------------|-------|
| `orderEntries` (online live) | `o.eventId === eventId && (o.status === "paid" \|\| o.status === "refunded_partial")` | `lines[].quantity - .refundedQuantity`; `totalGbpAtPurchase - refundedAmountGbp`; `paymentMethod` | Cancelled orders contribute 0 (already excluded by status filter) |
| `doorEntries` (door live) | `s.eventId === eventId` | Same shape via `lines[].quantity - .refundedQuantity` + `totalGbpAtSale - refundedAmountGbp`; `paymentMethod` | NO status filter — refunded sales still contribute live tickets per OBS-1 (buyer was present); they contribute 0 revenue (max(0, total - refunded)) |
| `compEntries` (comps) | `g.eventId === eventId` | `length` (each comp = 1 ticket) | Zero revenue contribution |
| `scanEntries` (scans) | `s.eventId === eventId` | Group by `scanResult`; dedupe success scans by `ticketId` for `uniqueScannedTickets`; group by `scannerUserId` for `scansByScanner` | Defensive dedupe per I-27 (`new Set(...).size`) |

**Discrepancy detection contracts (BINDING):**

```ts
// D1 — Auto-check-in mismatch (HIDDEN-1 contract violation surface)
const successScansSet = new Set(
  scanEntries
    .filter((s) => s.eventId === eventId && s.scanResult === "success")
    .map((s) => s.ticketId),
);
const eventDoorSales = doorEntries.filter((s) => s.eventId === eventId);
const d1MissingCount = eventDoorSales.reduce((missing, sale) => {
  const expected = expandDoorTickets(sale.id, sale.lines).map((t) => t.ticketId);
  return missing + expected.filter((tid) => !successScansSet.has(tid)).length;
}, 0);
if (d1MissingCount > 0) {
  discrepancies.push({
    kind: "auto_check_in_mismatch",
    copy: `${d1MissingCount} door ticket${d1MissingCount === 1 ? "" : "s"} sold but never scanned in`,
    followupHint:
      "Likely auto-check-in race (HIDDEN-1). Manual verify with door scanner; B-cycle backend will reconcile.",
  });
}

// D2 — Method sum mismatch
const methodSum = (Object.keys(revenueByMethod) as PaymentMethodKey[])
  .reduce((sum, key) => sum + revenueByMethod[key], 0);
const d2Diff = Math.abs(grossRevenue - methodSum);
if (d2Diff > 0.005) {
  discrepancies.push({
    kind: "method_sum_mismatch",
    copy: `${formatGbp(d2Diff)} unattributed across payment methods`,
    followupHint: `Sum-by-method (${formatGbp(methodSum)}) doesn't equal grand revenue (${formatGbp(grossRevenue)}). Likely rounding artifact; verify in B-cycle.`,
  });
}

// D3 — Refund status mismatch
const d3OrderCount = orderEntries.filter(
  (o) =>
    o.eventId === eventId &&
    o.refunds.length > 0 &&
    o.status !== "refunded_full" &&
    o.status !== "refunded_partial",
).length;
const d3DoorCount = eventDoorSales.filter(
  (s) =>
    s.refunds.length > 0 &&
    s.status !== "refunded_full" &&
    s.status !== "refunded_partial",
).length;
const d3Total = d3OrderCount + d3DoorCount;
if (d3Total > 0) {
  discrepancies.push({
    kind: "refund_status_mismatch",
    copy: `${d3Total} record${d3Total === 1 ? "" : "s"} with refunds but mismatched status`,
    followupHint:
      "Internal data integrity issue — refund applied but parent status didn't flip. Reset client cache + retry.",
  });
}
```

**Headline copy contract (BINDING):**

```ts
export const headlineCopyFor = (status: EventLifecycleStatus): string => {
  switch (status) {
    case "live":      return "Live · reconciliation in progress";
    case "upcoming":  return "Upcoming · pre-event door sales";
    case "past":      return "Ticket sales ended · final reconciliation";
    case "cancelled": return "Event cancelled · refund/payout audit";
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};
```

**Per-method revenue derivation (BINDING):**

```ts
const revenueByMethod: Record<PaymentMethodKey, number> = {
  card: 0, apple_pay: 0, google_pay: 0, free: 0,
  cash: 0, card_reader: 0, nfc: 0, manual: 0,
};

// Online: paid + refunded_partial orders contribute (totalGbpAtPurchase - refundedAmountGbp).
// Cancelled orders excluded by status filter; their net is 0 anyway via max(0, ...).
for (const o of orderEntries) {
  if (o.eventId !== eventId) continue;
  if (o.status !== "paid" && o.status !== "refunded_partial") continue;
  const live = Math.max(0, o.totalGbpAtPurchase - o.refundedAmountGbp);
  if (live <= 0) continue;
  revenueByMethod[o.paymentMethod] += live;
}

// Door: all door sales for the event contribute (totalGbpAtSale - refundedAmountGbp).
for (const s of doorEntries) {
  if (s.eventId !== eventId) continue;
  const live = Math.max(0, s.totalGbpAtSale - s.refundedAmountGbp);
  if (live <= 0) continue;
  revenueByMethod[s.paymentMethod] += live;
}
```

**Settlement-stub split (BINDING per D-13-10):**

```ts
const onlineFee = Math.round(onlineRevenue * 96) / 100;  // 4% Stripe stub on online only
const doorFee = doorRevenue;                              // No fee on door (cash/manual)
const payoutEstimate = onlineFee + doorFee;
```

**EMPTY_SUMMARY definition (BINDING):**

```ts
export const EMPTY_SUMMARY: ReconciliationSummary = {
  status: "upcoming",
  headlineCopy: "",
  onlineLiveTickets: 0,
  doorLiveTickets: 0,
  compTickets: 0,
  totalLiveTickets: 0,
  onlineRevenue: 0,
  doorRevenue: 0,
  grossRevenue: 0,
  totalRefunded: 0,
  revenueByMethod: {
    card: 0, apple_pay: 0, google_pay: 0, free: 0,
    cash: 0, card_reader: 0, nfc: 0, manual: 0,
  },
  payoutEstimate: 0,
  onlineRefunded: 0,
  doorRefunded: 0,
  uniqueScannedTickets: 0,
  scanDups: 0,
  scanWrongEvent: 0,
  scanNotFound: 0,
  scanVoid: 0,
  scanCancelled: 0,
  scansByScanner: {},
  unscannedTickets: 0,
  discrepancies: [],
};
```

**`unscannedTickets` clamp (BINDING):**

```ts
const unscannedTickets = Math.max(0, totalLiveTickets - uniqueScannedTickets);
```

This handles the edge case where scans exceed live tickets (e.g., I-27 violation produced two success scans for the same ticketId AND the dedupe somehow missed; never below zero).

#### 4.2.2 MOD — `mingla-business/src/utils/permissionGates.ts`

**Single-line addition** to `MIN_RANK` const (insert after `REFUND_DOOR_SALE` for thematic grouping with refund actions):

```ts
export const MIN_RANK = {
  // J-T6 gates (Cycle 13a)
  EDIT_EVENT: BRAND_ROLE_RANK.event_manager, // 40
  EDIT_TICKET_PRICE: BRAND_ROLE_RANK.finance_manager, // 30
  REFUND_ORDER: BRAND_ROLE_RANK.finance_manager, // 30
  REFUND_DOOR_SALE: BRAND_ROLE_RANK.finance_manager, // 30
  // Cycle 13 — read-only reconciliation surface (D-13-3)
  VIEW_RECONCILIATION: BRAND_ROLE_RANK.finance_manager, // 30
  ADD_COMP_GUEST: BRAND_ROLE_RANK.event_manager, // 40
  // ... (existing entries unchanged)
} as const;
```

No other change to the file. `gateCaptionFor` resolves correctly via existing rank-bucket logic (returns "finance manager or above" for rank 30).

#### 4.2.3 MOD — `mingla-business/src/utils/guestCsvExport.ts`

**3 additions:**

##### 4.2.3.1 Extend `serializeGuestsToCsv` with NEW columns

Insert NEW columns at positions 12, 13, 14 (after existing `Notes` becomes the 11th — preserving order; new ones APPENDED at the end):

```ts
const headers = [
  "Kind",            // 1
  "Name",            // 2
  "Email",           // 3
  "Phone",           // 4
  "Ticket type",     // 5
  "Quantity",        // 6
  "Status",          // 7
  "Payment method", // 8
  "Order/Sale ID",  // 9
  "Date",           // 10
  "Notes",          // 11
  "Gross",          // 12 — NEW Cycle 13
  "Refunded",       // 13 — NEW Cycle 13
  "Net",            // 14 — NEW Cycle 13
];
```

Per-row serializer extension (per kind):

```ts
// kind: "order"
const grossPaid = o.totalGbpAtPurchase;
const refunded = o.refundedAmountGbp;
const net = Math.max(0, grossPaid - refunded);
const fields = [
  "ONLINE", o.buyer.name, o.buyer.email, o.buyer.phone,
  orderTicketSummary(o.lines), String(orderQuantity(o.lines)),
  orderStatusLabel(o.status), o.paymentMethod, o.id,
  formatYmd(o.paidAt), "",
  String(grossPaid.toFixed(2)),  // Gross
  String(refunded.toFixed(2)),   // Refunded
  String(net.toFixed(2)),        // Net
];

// kind: "comp"
const fields = [
  "COMP", c.name, c.email, c.phone, c.ticketNameAtCreation ?? "General comp",
  "1", "Comp", "", c.id, formatYmd(c.addedAt), c.notes,
  "0.00",  // Gross — comps are zero-priced
  "0.00",  // Refunded
  "0.00",  // Net
];

// kind: "door"
const grossPaid = s.totalGbpAtSale;
const refunded = s.refundedAmountGbp;
const net = Math.max(0, grossPaid - refunded);
const fields = [
  "DOOR", buyerName, s.buyerEmail, s.buyerPhone,
  doorTicketSummary(s.lines), String(doorQuantity(s.lines)),
  doorStatusLabel(s.status), doorPaymentLabel(s.paymentMethod), s.id,
  formatYmd(s.recordedAt), s.notes,
  String(grossPaid.toFixed(2)),
  String(refunded.toFixed(2)),
  String(net.toFixed(2)),
];
```

##### 4.2.3.2 NEW optional `summaryStanza` arg + `ReconciliationCsvSummary` type

Extend `serializeGuestsToCsv` signature:

```ts
export interface ReconciliationCsvSummary {
  eventName: string;
  status: string;                  // headline e.g. "Ticket sales ended · final reconciliation"
  totalLiveTickets: number;
  grossRevenue: number;
  totalRefunded: number;
  netRevenue: number;              // = grossRevenue (already net of refunds; rendered same as grossRevenue line for clarity)
  uniqueScannedTickets: number;
}

export const serializeGuestsToCsv = (
  rows: ExportGuestRow[],
  summary?: ReconciliationCsvSummary,
): string => {
  const stanzaLines: string[] = [];
  if (summary !== undefined) {
    // 5-line preamble (each starts with "#" — RFC 4180-ish comment convention; spreadsheet apps typically skip).
    stanzaLines.push(`# ${summary.eventName} — ${summary.status}`);
    stanzaLines.push(`# Tickets: ${summary.totalLiveTickets} live · ${summary.uniqueScannedTickets} scanned`);
    stanzaLines.push(`# Revenue: gross ${summary.grossRevenue.toFixed(2)} GBP`);
    stanzaLines.push(`# Refunded: ${summary.totalRefunded.toFixed(2)} GBP`);
    stanzaLines.push(`# Net: ${summary.netRevenue.toFixed(2)} GBP`);
  }
  // ... existing header + rows logic ...
  return [...stanzaLines, headerRow, ...dataRows].join("\r\n") + "\r\n";
};
```

Existing callers (`exportGuestsCsv`, `exportDoorSalesCsv`) MUST continue to work without passing the new arg — `summary?` is optional.

##### 4.2.3.3 NEW `exportReconciliationCsv(args)` wrapper

```ts
export interface ExportReconciliationCsvArgs {
  event: LiveEvent;
  /** ALL three sources merged + filtered by eventId in the route layer; passed pre-filtered. */
  orders: OrderRecord[];
  doorSales: DoorSaleRecord[];
  comps: CompGuestEntry[];
  /** ReconciliationSummary from computeReconciliation — used to populate the summary stanza. */
  summary: ReconciliationSummary;
}

export const exportReconciliationCsv = async (
  args: ExportReconciliationCsvArgs,
): Promise<void> => {
  const rows: ExportGuestRow[] = [
    ...args.orders.map((o) => ({
      kind: "order" as const,
      id: o.id,
      order: o,
      sortKey: o.paidAt,
    })),
    ...args.doorSales.map((s) => ({
      kind: "door" as const,
      id: s.id,
      sale: s,
      sortKey: s.recordedAt,
    })),
    ...args.comps.map((c) => ({
      kind: "comp" as const,
      id: c.id,
      comp: c,
      sortKey: c.addedAt,
    })),
  ];
  // Newest-first sort for consistent reading
  rows.sort((a, b) => (a.sortKey > b.sortKey ? -1 : a.sortKey < b.sortKey ? 1 : 0));

  const stanza: ReconciliationCsvSummary = {
    eventName: args.event.name,
    status: args.summary.headlineCopy,
    totalLiveTickets: args.summary.totalLiveTickets,
    grossRevenue: args.summary.grossRevenue,
    totalRefunded: args.summary.totalRefunded,
    netRevenue: args.summary.grossRevenue, // grossRevenue is already net of refunds
    uniqueScannedTickets: args.summary.uniqueScannedTickets,
  };

  const csv = serializeGuestsToCsv(rows, stanza);
  const filename = `${args.event.eventSlug}-reconciliation-${formatYmdToday()}.csv`;
  if (Platform.OS === "web") {
    downloadCsvWeb(csv, filename);
    return;
  }
  await downloadCsvNative(csv, filename);
};
```

The existing `downloadCsvWeb` + `downloadCsvNative` helpers are reused verbatim (TRANSITIONAL native CSV degradation D-CYCLE10-IMPL-1 persists; B-cycle resolves).

### 4.3 Component layer

#### 4.3.1 NEW — `mingla-business/src/components/event/ReconciliationCtaTile.tsx`

**Header docstring:**

```ts
/**
 * ReconciliationCtaTile — Permission-gated ActionTile adapter for Event Detail action grid (Cycle 13).
 *
 * Per DEC-095 D-13-3: gated on MIN_RANK.VIEW_RECONCILIATION (finance_manager rank 30).
 *
 * Const #1 — no dead taps: returns null when permission missing (NOT disabled with caption);
 * the tile entirely disappears for sub-rank users to keep the action grid clean.
 *
 * Per Cycle 13 SPEC §4.3.1.
 */
```

**Component contract:**

```ts
import React from "react";

import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { canPerformAction } from "../../utils/permissionGates";
import { ActionTile } from "./ActionTile"; // Imported or composed inline if no shared file exists

export interface ReconciliationCtaTileProps {
  brandId: string | null;
  onPress: () => void;
}

export const ReconciliationCtaTile: React.FC<ReconciliationCtaTileProps> = ({
  brandId,
  onPress,
}) => {
  const { rank } = useCurrentBrandRole(brandId);
  if (!canPerformAction(rank, "VIEW_RECONCILIATION")) return null;
  return (
    <ActionTile
      icon="chart"
      label="Reconciliation"
      onPress={onPress}
    />
  );
};
```

**Implementor note:** if `ActionTile` is currently composed inline in `app/event/[id]/index.tsx` (verified by reading the file — it IS inline at lines 868-899), this component MUST either:
- (A) Re-define `ActionTile` inline within `ReconciliationCtaTile.tsx`, OR
- (B) Extract `ActionTile` from `app/event/[id]/index.tsx` to a shared file `src/components/event/ActionTile.tsx` and import in both places.

Recommended: **(B)** — clean shared primitive, reduces duplication, mirrors how `EventDetailKpiCard` was extracted in Cycle 9c. Add as Step 5 sub-task in §8 implementation order.

**States:**

| State | Trigger | Render |
|-------|---------|--------|
| No permission | `canPerformAction(rank, "VIEW_RECONCILIATION") === false` | `null` (tile not rendered) |
| Has permission | rank ≥ 30 | ActionTile with `icon="chart"` + `label="Reconciliation"` + onPress handler |
| Loading rank | `useCurrentBrandRole` isLoading | `null` (hook return rank=0; null-return holds; tile pops in once query resolves — acceptable UX since grid populates incrementally) |
| Error | `useCurrentBrandRole` isError → rank=0 | `null` (gates default-closed per Cycle 13a forensics) |

#### 4.3.2 NEW — `mingla-business/app/event/[id]/reconciliation.tsx`

**Header docstring (mandatory protective comment):**

```ts
/**
 * Reconciliation route — Cycle 13 J-R1 + J-R2 + J-R3 cross-source reconciliation summary.
 *
 * Per Cycle 13 + DEC-095 (11 architectural decisions locked):
 *   D-13-1: NEW route (mirrors Cycle 12 J-D5 pattern; supersets door-only card)
 *   D-13-2: Always-visible permission-gated; copy adapts per status
 *   D-13-3: VIEW_RECONCILIATION = finance_manager (rank 30)
 *   D-13-4: D1+D2+D3 ADVISORY-only; D4 informational ("no-shows")
 *   D-13-5: Warm-orange (accent.warm) for D1/D2/D3 visual severity
 *   D-13-6: "No-shows" (past) / "Waiting" (live/upcoming)
 *   D-13-7: PDF DEFERRED to B-cycle (CTA renders disabled with "B-cycle" caption)
 *   D-13-8: CSV with Gross/Refunded/Net columns + summary stanza prefix
 *   D-13-9: filename {slug}-reconciliation-{YYYY-MM-DD}.csv
 *   D-13-10: payoutEstimate split (online×0.96 + door×1.0)
 *   D-13-11: audit_log integration DEFERRED entirely
 *
 * Selector pattern rule (Cycle 9c v2 + Cycle 12 lesson): ALL multi-record reads use raw
 * `entries` selector + useMemo. NEVER subscribe to fresh-array selectors directly.
 *
 * I-21: operator-side route. Uses useAuth via useCurrentBrandRole. NEVER imported by
 * anon-tolerant buyer routes (app/o/, app/e/, app/checkout/).
 *
 * I-27 defensive: scans deduped by ticketId via Set in computeReconciliation.
 *
 * ORCH-0710: ALL hooks declared BEFORE any conditional early-return shell.
 *
 * [TRANSITIONAL] payoutEstimate uses 4% Stripe-fee stub on online revenue. EXIT: B-cycle
 * Stripe payout API integration + Stripe Terminal SDK fee schedules.
 *
 * Per Cycle 13 SPEC §4.3.2.
 */
```

**Imports (BINDING — verify all available):**

```ts
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useCurrentBrandStore } from "../../../src/store/currentBrandStore";
import { useDoorSalesStore } from "../../../src/store/doorSalesStore";
import { useGuestStore } from "../../../src/store/guestStore";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import { useOrderStore } from "../../../src/store/orderStore";
import { useScanStore } from "../../../src/store/scanStore";
import { canPerformAction, gateCaptionFor } from "../../../src/utils/permissionGates";
import { formatGbp } from "../../../src/utils/currency";
import { exportReconciliationCsv } from "../../../src/utils/guestCsvExport";
import {
  computeReconciliation,
  EMPTY_SUMMARY,
  type DiscrepancyEntry,
  type EventLifecycleStatus,
  type PaymentMethodKey,
  type ReconciliationSummary,
} from "../../../src/utils/reconciliation";

import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Icon } from "../../../src/components/ui/Icon";
import type { IconName } from "../../../src/components/ui/Icon";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { Toast } from "../../../src/components/ui/Toast";
```

**Note on `deriveLiveStatus` extraction:** the existing `deriveLiveStatus` in `app/event/[id]/index.tsx:191-203` MUST be EXTRACTED to a shared utility (recommended: `src/utils/eventLifecycle.ts`) so both files import it. Pre-existing `app/event/[id]/index.tsx` continues to work via re-import. This is part of Step 1 sub-task in §8.

**Default export route function (state machine — BINDING):**

```ts
export default function ReconciliationRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  // ---- All hooks declared BEFORE early returns (ORCH-0710) ----
  const event = useLiveEventStore((s) =>
    typeof eventId === "string"
      ? s.events.find((e) => e.id === eventId) ?? null
      : null,
  );
  const brand = useCurrentBrandStore((s) =>
    event !== null
      ? s.brands.find((b) => b.id === event.brandId) ?? null
      : null,
  );
  const { rank } = useCurrentBrandRole(brand?.id ?? null);

  // Raw entries + useMemo per selector pattern rule (T-33 grep gate)
  const allOrderEntries = useOrderStore((s) => s.entries);
  const allDoorEntries = useDoorSalesStore((s) => s.entries);
  const allCompEntries = useGuestStore((s) => s.entries);
  const allScanEntries = useScanStore((s) => s.entries);

  const summary = useMemo<ReconciliationSummary>(() => {
    if (event === null || typeof eventId !== "string") return EMPTY_SUMMARY;
    return computeReconciliation({
      eventId,
      status: deriveLiveStatus(event),
      eventName: event.name,
      orderEntries: allOrderEntries,
      doorEntries: allDoorEntries,
      compEntries: allCompEntries,
      scanEntries: allScanEntries,
    });
  }, [event, eventId, allOrderEntries, allDoorEntries, allCompEntries, allScanEntries]);

  // Pre-filtered arrays for CSV export (avoids re-filtering inside exportReconciliationCsv)
  const eventOrders = useMemo(
    () =>
      event === null
        ? []
        : allOrderEntries.filter((o) => o.eventId === event.id),
    [allOrderEntries, event],
  );
  const eventDoorSales = useMemo(
    () =>
      event === null
        ? []
        : allDoorEntries.filter((s) => s.eventId === event.id),
    [allDoorEntries, event],
  );
  const eventComps = useMemo(
    () =>
      event === null
        ? []
        : allCompEntries.filter((c) => c.eventId === event.id),
    [allCompEntries, event],
  );

  // ---- UI state ----
  const [byScannerExpanded, setByScannerExpanded] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}` as never);
    }
  }, [router, eventId]);

  const hasAnyData = useMemo<boolean>(
    () =>
      summary.totalLiveTickets > 0 ||
      summary.uniqueScannedTickets > 0 ||
      summary.scanDups + summary.scanWrongEvent + summary.scanNotFound +
        summary.scanVoid + summary.scanCancelled > 0,
    [summary],
  );

  const handleExport = useCallback(async (): Promise<void> => {
    if (event === null || !hasAnyData || exporting) return;
    setExporting(true);
    try {
      await exportReconciliationCsv({
        event,
        orders: eventOrders,
        doorSales: eventDoorSales,
        comps: eventComps,
        summary,
      });
      showToast(`Exported reconciliation report.`);
    } catch (_err) {
      showToast("Couldn't export. Tap to try again.");
    } finally {
      setExporting(false);
    }
  }, [event, eventOrders, eventDoorSales, eventComps, summary, hasAnyData, exporting, showToast]);

  // ---- Early returns (after all hooks) ----

  // 1. Not found shell
  if (event === null || typeof eventId !== "string") {
    return (
      <NotFoundShell insets={insets} onBack={handleBack} />
    );
  }

  // 2. Permission gate shell — friendly, NOT a 404
  if (!canPerformAction(rank, "VIEW_RECONCILIATION")) {
    return (
      <NotAuthorizedShell
        insets={insets}
        onBack={handleBack}
        caption={gateCaptionFor("VIEW_RECONCILIATION")}
      />
    );
  }

  // 3. Populated render — full screen
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Reconciliation</Text>
        <View style={styles.chromeRight}>
          <IconChrome
            icon="download"
            size={36}
            onPress={handleExport}
            accessibilityLabel="Export reconciliation CSV"
            disabled={!hasAnyData || exporting}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Headline banner — adaptive copy per status */}
        <HeadlineBanner
          headline={summary.headlineCopy}
          eventName={event.name}
          dateLine={formatEventDateLine(event) /* reuse formatDraftDateLine pattern */}
        />

        {/* TICKETS section */}
        <TicketsSection summary={summary} hasAnyData={hasAnyData} />

        {/* REVENUE section */}
        <RevenueSection summary={summary} hasAnyData={hasAnyData} />

        {/* SCANS section */}
        <ScansSection
          summary={summary}
          status={summary.status}
          operatorAccountId={operatorAccountId}
          byScannerExpanded={byScannerExpanded}
          onToggleByScanner={() => setByScannerExpanded((v) => !v)}
        />

        {/* DISCREPANCIES section — only renders if non-empty */}
        {summary.discrepancies.length > 0 ? (
          <DiscrepanciesSection entries={summary.discrepancies} />
        ) : null}

        {/* EXPORT section */}
        <ExportSection
          hasAnyData={hasAnyData}
          exporting={exporting}
          onExportCsv={handleExport}
        />
      </ScrollView>

      {/* Toast — absolute-wrapped per memory rule */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}
```

**Section components (composed inline OR extracted — implementor's call):**

##### HeadlineBanner

```tsx
<View style={styles.headlineBanner}>
  <Text style={styles.headlineText}>{headline}</Text>
  <Text style={styles.headlineSubline} numberOfLines={1}>
    {eventName}
    {dateLine.length > 0 ? ` · ${dateLine}` : ""}
  </Text>
</View>
```

##### TicketsSection

Renders 4 rows + divider + total. If `hasAnyData === false`, render dashes (`—`) in value slots; total shows `0`.

```tsx
<View style={styles.section}>
  <Text style={styles.sectionHeading}>TICKETS</Text>
  <Row label="Online sold" value={hasAnyData ? `${summary.onlineLiveTickets}` : "—"} subValue={hasAnyData ? formatGbp(summary.onlineRevenue) : ""} />
  <Row label="Door sold" value={hasAnyData ? `${summary.doorLiveTickets}` : "—"} subValue={hasAnyData ? formatGbp(summary.doorRevenue) : ""} />
  <Row label="Comps" value={hasAnyData ? `${summary.compTickets}` : "—"} subValue="" />
  <Divider />
  <Row label="TOTAL LIVE" value={`${summary.totalLiveTickets}`} variant="big" />
</View>
```

##### RevenueSection

8 method rows (4 online + 4 door, with B-cycle hint copy on `card_reader` and `nfc`) + divider + Gross + Refunded (warm) + divider + NET (big) + Stripe fee online + Door fee 0 + PAYOUT (mid).

```tsx
<View style={styles.section}>
  <Text style={styles.sectionHeading}>REVENUE</Text>
  <Row label="Card (online)" value={formatGbp(summary.revenueByMethod.card)} />
  <Row label="Apple Pay" value={formatGbp(summary.revenueByMethod.apple_pay)} />
  <Row label="Google Pay" value={formatGbp(summary.revenueByMethod.google_pay)} />
  <Row label="Free (online)" value={formatGbp(summary.revenueByMethod.free)} />
  <Row label="Cash (door)" value={formatGbp(summary.revenueByMethod.cash)} />
  <Row label="Card reader (door)" value={formatGbp(summary.revenueByMethod.card_reader)} hint="B-cycle" />
  <Row label="NFC tap (door)" value={formatGbp(summary.revenueByMethod.nfc)} hint="B-cycle" />
  <Row label="Manual (door)" value={formatGbp(summary.revenueByMethod.manual)} />
  <Divider />
  <Row label="Gross" value={formatGbp(summary.grossRevenue)} />
  <Row label="Refunded (online)" value={`−${formatGbp(summary.onlineRefunded)}`} variant="warn" />
  <Row label="Refunded (door)" value={`−${formatGbp(summary.doorRefunded)}`} variant="warn" />
  <Divider />
  <Row label="NET" value={formatGbp(summary.grossRevenue)} variant="big" />
  <Row label="Stripe fee (online, 4% stub)" value={`−${formatGbp(Math.round(summary.onlineRevenue * 4) / 100)}`} variant="muted" />
  <Row label="Door fee" value={formatGbp(0)} variant="muted" />
  <Row label="PAYOUT (estimated)" value={formatGbp(summary.payoutEstimate)} variant="mid" hint="TRANSITIONAL — B-cycle Stripe payout API" />
</View>
```

##### ScansSection

Computes `pct = totalLiveTickets > 0 ? Math.round((uniqueScannedTickets / totalLiveTickets) * 100) : 0`.

Unscanned label: `(status === "past" || status === "cancelled") ? "No-shows" : "Waiting"`.

```tsx
<View style={styles.section}>
  <Text style={styles.sectionHeading}>SCANS</Text>
  <Row label="Scanned in" value={`${summary.uniqueScannedTickets} of ${summary.totalLiveTickets}${summary.totalLiveTickets > 0 ? ` · ${pct}%` : ""}`} />
  <Row label={unscannedLabel} value={`${summary.unscannedTickets}`} variant={(status === "past" || status === "cancelled") ? "muted" : undefined} />
  <Row label="Duplicate scans" value={`${summary.scanDups}`} />
  <Row label="Wrong event" value={`${summary.scanWrongEvent}`} />
  <Row label="Not-found" value={`${summary.scanNotFound}`} />
  <Row label="Voided" value={`${summary.scanVoid}`} />
  <Row label="Cancelled" value={`${summary.scanCancelled}`} />
  {Object.keys(summary.scansByScanner).length > 0 ? (
    <Pressable
      onPress={onToggleByScanner}
      accessibilityRole="button"
      accessibilityLabel={byScannerExpanded ? "Hide by-scanner breakdown" : "Show by-scanner breakdown"}
      style={styles.byScannerToggle}
    >
      <Text style={styles.byScannerToggleText}>
        {byScannerExpanded ? "Hide by scanner" : "View by scanner"}
      </Text>
    </Pressable>
  ) : null}
  {byScannerExpanded
    ? Object.keys(summary.scansByScanner).map((scannerKey) => {
        const count = summary.scansByScanner[scannerKey];
        const label = scannerKey === operatorAccountId ? "You (operator)" : `Scanner ${scannerKey.slice(0, 8)}`;
        return (
          <View key={scannerKey} style={styles.scannerCard}>
            <Text style={styles.scannerName}>{label}</Text>
            <Text style={styles.scannerCount}>{count} scan{count === 1 ? "" : "s"}</Text>
          </View>
        );
      })
    : null}
</View>
```

##### DiscrepanciesSection (only renders if `entries.length > 0`)

```tsx
<View style={styles.section}>
  <Text style={styles.sectionHeading}>DISCREPANCIES</Text>
  {entries.map((entry, idx) => (
    <View key={`${entry.kind}-${idx}`} style={styles.discrepancyRow}>
      <View style={[styles.iconBadge, { backgroundColor: "rgba(235, 120, 37, 0.18)" }]}>
        <Icon name="flag" size={16} color={accent.warm} />
      </View>
      <View style={styles.discrepancyCol}>
        <Text style={styles.discrepancyCopy} numberOfLines={2}>{entry.copy}</Text>
        <Text style={styles.discrepancyHint} numberOfLines={2}>{entry.followupHint}</Text>
      </View>
    </View>
  ))}
</View>
```

##### ExportSection

```tsx
<View style={styles.section}>
  <Text style={styles.sectionHeading}>EXPORT</Text>
  <Pressable
    onPress={onExportCsv}
    disabled={!hasAnyData || exporting}
    accessibilityRole="button"
    accessibilityLabel="Export reconciliation CSV"
    style={({ pressed }) => [
      styles.exportPrimaryCta,
      (!hasAnyData || exporting) && styles.exportCtaDisabled,
      pressed && hasAnyData && !exporting && styles.exportCtaPressed,
    ]}
  >
    <Icon name="download" size={18} color={accent.warm} />
    <Text style={styles.exportPrimaryLabel}>
      {exporting ? "Exporting..." : "Export reconciliation CSV"}
    </Text>
  </Pressable>
  {!hasAnyData ? (
    <Text style={styles.exportCaption}>No data to export yet.</Text>
  ) : null}
  <View style={styles.exportSecondaryDisabled}>
    <Icon name="mail" size={18} color={textTokens.tertiary} />
    <Text style={styles.exportSecondaryLabel}>Email PDF report</Text>
    <Text style={styles.exportSecondaryHint}>B-cycle</Text>
  </View>
</View>
```

##### NotFoundShell + NotAuthorizedShell

```tsx
const NotFoundShell: React.FC<{insets, onBack}> = (...) => (
  <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
    <View style={styles.chromeRow}>
      <IconChrome icon="close" size={36} onPress={onBack} accessibilityLabel="Back" />
      <Text style={styles.chromeTitle}>Reconciliation</Text>
      <View style={styles.chromeRightSlot} />
    </View>
    <View style={styles.emptyHost}>
      <EmptyState illustration="ticket" title="Event not found" description="It may have been deleted." />
    </View>
  </View>
);

const NotAuthorizedShell: React.FC<{insets, onBack, caption}> = (...) => (
  <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
    <View style={styles.chromeRow}>
      <IconChrome icon="close" size={36} onPress={onBack} accessibilityLabel="Back" />
      <Text style={styles.chromeTitle}>Reconciliation</Text>
      <View style={styles.chromeRightSlot} />
    </View>
    <View style={styles.emptyHost}>
      <EmptyState illustration="shield" title="Restricted" description={caption} />
    </View>
  </View>
);
```

(`shield` icon exists in IconName per verified set. If `EmptyState` requires a different `illustration` prop, implementor maps to nearest match.)

#### 4.3.3 MOD — `mingla-business/app/event/[id]/index.tsx`

**Two changes:**

1. Add `handleReconciliation` callback (insert after `handleDoorSales`):

```ts
const handleReconciliation = useCallback((): void => {
  if (id !== null) {
    router.push(`/event/${id}/reconciliation` as never);
  }
}, [router, id]);
```

2. Render `ReconciliationCtaTile` in action grid (insert AFTER the Door Sales tile gated block, BEFORE the Public page tile):

```tsx
{/* Cycle 13 — J-R1 Reconciliation tile, permission-gated. */}
<ReconciliationCtaTile
  brandId={brand?.id ?? null}
  onPress={handleReconciliation}
/>
```

Plus import:

```ts
import { ReconciliationCtaTile } from "../../../src/components/event/ReconciliationCtaTile";
```

**Note:** if `ActionTile` is extracted to a shared file per §4.3.1 implementor note (B), update the existing inline `ActionTile` definition in this file to import from the shared location instead. ~5 LOC change.

#### 4.3.4 MOD — `mingla-business/app/event/[id]/door/index.tsx`

**Add small "View full reconciliation" CTA at top of route content** (per D-CYCLE13-RECON-FOR-4 polish), permission-gated.

Position: ABOVE the TESTING MODE banner (the existing first child of the ScrollView). Permission-gated via `useCurrentBrandRole` + `canPerformAction(rank, "VIEW_RECONCILIATION")`.

```tsx
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../../src/utils/permissionGates";
// ... existing imports ...

// Inside component, after existing hooks:
const { rank } = useCurrentBrandRole(brand?.id ?? null);
const canViewReconciliation = canPerformAction(rank, "VIEW_RECONCILIATION");

const handleViewReconciliation = useCallback((): void => {
  if (typeof eventId === "string") {
    router.push(`/event/${eventId}/reconciliation` as never);
  }
}, [router, eventId]);

// In the ScrollView, ABOVE the existing <View style={styles.banner}> (TESTING MODE):
{canViewReconciliation ? (
  <Pressable
    onPress={handleViewReconciliation}
    accessibilityRole="button"
    accessibilityLabel="View full reconciliation report"
    style={({ pressed }) => [
      styles.viewReconCta,
      pressed && styles.viewReconCtaPressed,
    ]}
  >
    <Icon name="chart" size={16} color={accent.warm} />
    <Text style={styles.viewReconCtaLabel}>View full reconciliation report</Text>
    <Icon name="chevR" size={16} color={textTokens.tertiary} />
  </Pressable>
) : null}
```

New styles:

```ts
viewReconCta: {
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  padding: spacing.sm + 2,
  borderRadius: radiusTokens.md,
  borderWidth: 1,
  borderColor: glass.border.profileBase,
  backgroundColor: glass.tint.profileBase,
},
viewReconCtaPressed: {
  opacity: 0.7,
},
viewReconCtaLabel: {
  flex: 1,
  fontSize: 13,
  fontWeight: "600",
  color: textTokens.primary,
},
```

Plus import `Icon` if not already imported (it is — verified).

### 4.4 INVARIANT_REGISTRY amendment

Append to existing I-32 entry (Cycle 13a established it; Cycle 13 amends with VIEW_RECONCILIATION note):

```markdown
**Cycle 13 amendment (2026-05-04):** NEW `MIN_RANK.VIEW_RECONCILIATION = finance_manager (30)` declared
client-side per DEC-095 D-13-3. **Forward-compat note:** because Cycle 13 is reads-only over local
Zustand stores, there is NO server RLS counterpart yet — gate is mobile-UX only. When B-cycle ships
server-side reconciliation RPC (e.g. `compute_event_reconciliation` SECURITY DEFINER wrapper), RLS
policy MUST mirror finance_manager+ rank gate to preserve I-32. Until then, the mobile gate is the
sole enforcement point for VIEW_RECONCILIATION (acceptable since the data being gated is already
operator-side and reads-only over local persisted state — sub-rank operator hitting the route
directly via deep-link sees friendly "Restricted" shell).
```

No NEW invariants registered Cycle 13.

### 4.5 Styles (BINDING — RN color format rule)

ALL inline colors MUST be hex (`#xxxxxx`), `rgb()` / `rgba()`, `hsl()`, or `hwb()`. **NEVER** `oklch()`, `lab()`, `lch()`, or `color-mix()` (silently invisible per memory rule `feedback_rn_color_formats`).

Reuse existing tokens:
- `accent.warm` — discrepancy icons, export CTA icon, polish CTA icon
- `glass.tint.profileBase` / `glass.border.profileBase` — section card backgrounds + border
- `glass.tint.profileElevated` / `glass.border.profileElevated` — by-scanner expandable cards
- `text.primary` / `secondary` / `tertiary` / `quaternary` — typography
- `canvas.discover` — host background
- `radius.md` / `radius.sm` — card corners
- `spacing.xs` / `sm` / `md` / `lg` / `xl` — gaps + padding
- `semantic.error` — ONLY for cancelled-event red badge if needed

`fontVariant: ["tabular-nums"]` on all currency + count values per Cycle 12 J-D5 precedent.

### 4.6 Realtime layer

**N/A.** No Realtime subscriptions in Cycle 13.

---

## 5 — Success criteria (SC-1..SC-34)

| # | Criterion | Verification |
|---|-----------|--------------|
| **SC-1** | NEW route exists at `app/event/[id]/reconciliation.tsx`; deep-linkable via `/event/{eventId}/reconciliation` | File exists; `expo-router` recognizes the path |
| **SC-2** | `MIN_RANK.VIEW_RECONCILIATION = BRAND_ROLE_RANK.finance_manager` constant added to `permissionGates.ts`; equals 30 | grep + tsc |
| **SC-3** | `canPerformAction(rank, "VIEW_RECONCILIATION")` returns `true` for rank ≥ 30; `false` for rank < 30 | Unit test |
| **SC-4** | `ReconciliationCtaTile` renders only when `useCurrentBrandRole` returns rank ≥ 30; returns `null` otherwise | Unit test (mock `useCurrentBrandRole`) |
| **SC-5** | Route hit by sub-rank user renders friendly "Restricted" shell using `gateCaptionFor("VIEW_RECONCILIATION")`; NOT a 404 | Unit test |
| **SC-6** | `computeReconciliation(inputs)` is pure: same inputs → identical structural output; deterministic; no side effects | Unit test (run twice with same inputs, deepEqual) |
| **SC-7** | `summary.totalLiveTickets === onlineLiveTickets + doorLiveTickets + compTickets` for any inputs | Unit test |
| **SC-8** | `summary.grossRevenue === onlineRevenue + doorRevenue` for any inputs | Unit test |
| **SC-9** | `Math.abs(summary.grossRevenue - sum(values(summary.revenueByMethod))) <= 0.005` (rounding tolerance) | Unit test |
| **SC-10** | `summary.payoutEstimate === Math.round(onlineRevenue * 96) / 100 + doorRevenue` (D-13-10 split lock) | Unit test |
| **SC-11** | `uniqueScannedTickets === new Set(successScans.map(s => s.ticketId)).size` (defensive dedupe per I-27) | Unit test (input with 2 success scans of same ticketId → count 1) |
| **SC-12** | `unscannedTickets === Math.max(0, totalLiveTickets - uniqueScannedTickets)`; never negative | Unit test |
| **SC-13** | Headline copy matches table for each of 4 statuses (live/upcoming/past/cancelled) | Unit test |
| **SC-14** | Past-event unscanned label === "No-shows"; live/upcoming label === "Waiting"; cancelled label === "No-shows" | Component test |
| **SC-15** | D1 detection: door sale with N tickets but zero matching success scans → discrepancy entry with `kind: "auto_check_in_mismatch"` and copy referencing N | Unit test |
| **SC-16** | D2 detection: synthetic mismatched method totals → discrepancy entry with `kind: "method_sum_mismatch"` and copy referencing unattributed delta | Unit test |
| **SC-17** | D3 detection: refund without status flip → discrepancy entry with `kind: "refund_status_mismatch"` and copy referencing record count | Unit test |
| **SC-18** | D1+D2+D3 ALL render warm-orange (`accent.warm`) icon-badge + copy + dim hint sub-row | Component test |
| **SC-19** | Discrepancy section silent (NOT rendered) when `summary.discrepancies.length === 0` (Const #9 — no false-positive warm-orange noise) | Component test |
| **SC-20** | "Email PDF report" CTA visibly DISABLED with caption "B-cycle" — never tappable (Const #1 + #7) | Component test |
| **SC-21** | "Export reconciliation CSV" CTA: tap → calls `exportReconciliationCsv(args)`; success → toast `Exported reconciliation report.`; failure → toast "Couldn't export. Tap to try again." | Component test (mock export + Toast) |
| **SC-22** | CSV file shape: 14 columns including `Gross / Refunded / Net` at positions 12-14 | Snapshot test on `serializeGuestsToCsv` output |
| **SC-23** | CSV summary stanza prefix: 5 lines beginning with `#` containing event name + status + tickets summary + revenue + refunded + net | Snapshot test |
| **SC-24** | CSV filename === `${eventSlug}-reconciliation-${YYYY-MM-DD}.csv` per D-13-9 | Unit test on `exportReconciliationCsv` |
| **SC-25** | Web export downloads `.csv` file via Blob + anchor pattern (works in Chrome / Safari / Firefox) | Mock test (Platform.OS="web") |
| **SC-26** | Native export shares CSV text via `Share.share({ message: csv })` per existing TRANSITIONAL pattern | Mock test (Platform.OS="ios"/"android") |
| **SC-27** | All multi-record reads use raw `entries` selector + `useMemo` — ZERO direct subscriptions to fresh-array selectors | grep gate |
| **SC-28** | Hook ordering per ORCH-0710 — ALL hooks declared BEFORE any conditional early-return | grep gate (line numbers verified) |
| **SC-29** | tsc clean — `npx tsc --noEmit` exits 0 (filter `.expo/types/router.d.ts` autogen noise) | Build check |
| **SC-30** | NO oklch/lab/lch/color-mix in any new file | grep gate |
| **SC-31** | NO new TextInputs in route (read-only screen) | grep gate |
| **SC-32** | Toast component wrapped in `<View style={{position:"absolute", ...}}>` per memory rule | grep gate |
| **SC-33** | Cycle 12 J-D5 door-only reconciliation card UNCHANGED — only ADDITIVE polish CTA per D-CYCLE13-RECON-FOR-4 | git diff |
| **SC-34** | Constitutional compliance — all 14 principles verified PASS (or N/A documented) | IMPL report §11 |

---

## 6 — Invariants

| ID | Status | Cycle 13 application |
|----|--------|---------------------|
| I-19 | PRESERVE | Reconciliation is read-only over OrderRecord / RefundRecord. ZERO mutations. |
| I-21 | PRESERVE | Reconciliation route is operator-side; uses `useAuth` via `useCurrentBrandRole`. NEVER imported by anon-tolerant buyer routes. **Verified by grep gate T-34.** |
| I-25 | PRESERVE | Comps stay in `useGuestStore.entries` only — reconciliation reads them in place. |
| I-26 | PRESERVE | `LiveEvent.privateGuestList` is operator-only flag — no Cycle 13 touchpoint. |
| I-27 | PRESERVE + DEFENSIVE | Cycle 13 dedupes scans by ticketId via `Set` — defensive against the missing store-level enforcement (D-CYCLE13-RECON-FOR-1; B-cycle backlog). |
| I-28 | PRESERVE | Scanner invitation flow unchanged. |
| I-29 | PRESERVE | Door sales reconciled FROM `useDoorSalesStore` — NEVER as phantom OrderRecord rows. |
| I-30 | PRESERVE | Door-tier vs online-tier separation honored — reconciliation merges by source not by tier. |
| I-31 | PRESERVE | Brand team UI-only invitation flow unaffected. |
| **I-32** | **AMEND** | NEW `MIN_RANK.VIEW_RECONCILIATION = finance_manager (30)` declared client-side. Forward-compat note appended per §4.4 — server RLS counterpart MUST mirror when B-cycle ships. |
| I-33 | PRESERVE | permissions_override jsonb deny-list unaffected. |
| I-34 | PRESERVE | permissions_matrix DECOMMISSIONED status unchanged. |

**No NEW invariants registered Cycle 13.**

---

## 7 — Test cases (T-01..T-38)

### 7.1 Aggregator unit tests (deterministic, offline)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Empty event | All store arrays empty | `totalLiveTickets===0` · `grossRevenue===0` · `uniqueScannedTickets===0` · `discrepancies===[]` · `revenueByMethod` all 8 keys === 0 | Util |
| T-02 | Online-only happy path | 2 paid `OrderRecord`, each with 1 line × 3 tickets at £25 (paymentMethod="card") | `onlineLiveTickets===6` · `onlineRevenue===150` · `grossRevenue===150` · `revenueByMethod.card===150` · `revenueByMethod.cash===0` | Util |
| T-03 | Door-only happy path | 1 cash `DoorSaleRecord` with 1 line × 4 tickets at £20, totalGbpAtSale=80 | `doorLiveTickets===4` · `doorRevenue===80` · `grossRevenue===80` · `revenueByMethod.cash===80` | Util |
| T-04 | Mixed happy path | 1 online (2 tickets, £40) + 1 door (3 tickets, £60) + 1 comp | `totalLiveTickets===6` · `onlineRevenue===40` · `doorRevenue===60` · `compTickets===1` · `grossRevenue===100` | Util |
| T-05 | Online refund | OrderRecord with 3 tickets, status="refunded_partial", refundedQuantity=1 on 1 line, refundedAmountGbp=10 of total 30 | `onlineLiveTickets===2` · `onlineRevenue===20` · `totalRefunded===10` · `revenueByMethod.card===20` | Util |
| T-06 | Door refund (OBS-1) | DoorSale with 2 tickets fully refunded, status="refunded_full", AND scanStore has 2 success scans for the door ticketIds | `doorLiveTickets===0` · `doorRevenue===0` · `totalRefunded===saleAmount` · `uniqueScannedTickets===2` (scans intact per OBS-1) | Util |
| T-07 | Cancelled order excluded | OrderRecord with status="cancelled", cancelledAt set | Order contributes 0 to onlineLiveTickets and onlineRevenue | Util |
| T-08 | D1 trigger — door sale missing scan | 1 door sale with 3 tickets, scanStore has 2 success scans for 2 of the 3 expected door ticketIds | `discrepancies.length===1` · `discrepancies[0].kind === "auto_check_in_mismatch"` · `copy === "1 door ticket sold but never scanned in"` | Util |
| T-09 | D1 plural | door sale with 5 tickets, 0 matching scans | `copy === "5 door tickets sold but never scanned in"` (plural) | Util |
| T-10 | D2 trigger — method sum drift | Synthetic test: monkey-patch revenueByMethod (e.g. force unbalanced via test fixture) | `discrepancies` includes entry with `kind: "method_sum_mismatch"` | Util |
| T-11 | D3 trigger — refund without status | OrderRecord with `refunds.length>0` AND `status==="paid"` (synthetic violation) | `discrepancies` includes `kind: "refund_status_mismatch"` · `copy === "1 record with refunds but mismatched status"` | Util |
| T-12 | Scan dedup defensive | scanStore has 2 success scans with same ticketId (I-27 violation) | `uniqueScannedTickets===1` (NOT 2) | Util |
| T-13 | Headline live | `status="live"` | `headlineCopy === "Live · reconciliation in progress"` | Util |
| T-14 | Headline upcoming | `status="upcoming"` | `headlineCopy === "Upcoming · pre-event door sales"` | Util |
| T-15 | Headline past | `status="past"` | `headlineCopy === "Ticket sales ended · final reconciliation"` | Util |
| T-16 | Headline cancelled | `status="cancelled"` | `headlineCopy === "Event cancelled · refund/payout audit"` | Util |
| T-17 | Payout split D-13-10 | onlineRevenue=100, doorRevenue=50 | `payoutEstimate === Math.round(100 × 96)/100 + 50 === 96 + 50 === 146` | Util |
| T-18 | Payout door-only no Stripe fee | onlineRevenue=0, doorRevenue=80 | `payoutEstimate === 80` (no fee deducted from door) | Util |
| T-19 | Unscanned clamp | totalLiveTickets=2, uniqueScannedTickets=3 (edge case) | `unscannedTickets === Math.max(0, 2-3) === 0` (NOT -1) | Util |

### 7.2 Component / route tests

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-20 | Tile gated below rank | rank=20 (team_member) on Event Detail | `ReconciliationCtaTile` returns `null`; tile not in DOM tree | Component |
| T-21 | Tile renders at rank | rank=30 (finance_manager) | Tile renders + tappable; `icon="chart"` · `label="Reconciliation"` | Component |
| T-22 | Route deep-link below rank | rank=20 user navigates directly to `/event/{id}/reconciliation` | NotAuthorizedShell renders; "Restricted" title + caption from `gateCaptionFor("VIEW_RECONCILIATION")` | Component |
| T-23 | Route renders at rank | rank≥30 | Full reconciliation screen renders; all 4 sections visible | Component |
| T-24 | Stub-mode synthesis | Local stub brand (lm/tll/sl/hr) with role="owner" | `useCurrentBrandRole` synthesizes account_owner (rank=60) → tile renders + route accessible | Hook |
| T-25 | Past-event terminology | route rendered with `status="past"`, `unscannedTickets=3` | "No-shows" label visible (NOT "Waiting") | Component |
| T-26 | Live-event terminology | route rendered with `status="live"`, `unscannedTickets=5` | "Waiting" label visible | Component |
| T-27 | Discrepancy section silent when clean | `summary.discrepancies===[]` | DiscrepanciesSection NOT rendered (no warm-orange noise) | Component |
| T-28 | Discrepancy section renders when present | `summary.discrepancies.length===2` | DiscrepanciesSection renders 2 rows; both have warm-orange icon badge | Component |
| T-29 | Empty-state rendering | `hasAnyData===false` | Section value slots show `—` (em dash) for tickets; "No data to export yet." caption visible; export CTA disabled | Component |
| T-30 | Export disabled when empty | `hasAnyData===false` and operator taps export icon | No `Share.share` / `Blob.create` called; toast NOT fired | Component |
| T-31 | Export success | `hasAnyData===true`, mock `exportReconciliationCsv` succeeds | Toast `"Exported reconciliation report."` fires | Component |
| T-32 | Export failure | `exportReconciliationCsv` rejects | Toast `"Couldn't export. Tap to try again."` fires; exporting flag cleared | Component |
| T-33 | By-scanner expand | `scansByScanner` has 2 keys; tap toggle | Per-scanner card rows visible; second tap collapses | Component |
| T-34 | Email PDF disabled | route rendered | `Email PDF report` row visible but NOT a Pressable; "B-cycle" hint text present | Component |

### 7.3 CSV export tests

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-35 | CSV column shape | 1 online + 1 door + 1 comp row, no summary | First line = comma-separated 14 headers including `Gross,Refunded,Net` at positions 12-14 | Util |
| T-36 | CSV summary stanza | `exportReconciliationCsv` called with summary | Lines 1-5 begin with `#`; line 6 is the header row; line 7+ are data | Util |
| T-37 | Filename | export with `eventSlug="party-night"` on simulated date "2026-05-04" | `filename === "party-night-reconciliation-2026-05-04.csv"` | Util |
| T-38 | Web export | `Platform.OS==="web"` with mocked Blob+URL+document | `downloadCsvWeb` invoked; anchor.click() called; filename property set correctly | Util |

### 7.4 Static + regression tests

| Test | Scenario | Method | Expected |
|------|----------|--------|----------|
| T-39 | tsc clean | `cd mingla-business && npx tsc --noEmit \| grep -v "\\.expo/types/router\\.d\\.ts"` | exit 0, no output |
| T-40 | RN color formats | `grep -rE "oklch\|lab\\(\|lch\\(\|color-mix" src/utils/reconciliation.ts src/components/event/ReconciliationCtaTile.tsx "app/event/[id]/reconciliation.tsx"` | 0 hits |
| T-41 | Selector pattern | `grep -rEn "useOrderStore\\(\\(s\\) => s\\.getOrdersForEvent\|useDoorSalesStore\\(\\(s\\) => s\\.getSalesForEvent\|useGuestStore\\(\\(s\\) => s\\.getCompEntriesForEvent\|useScanStore\\(\\(s\\) => s\\.getScansForEvent" "app/event/[id]/reconciliation.tsx"` | 0 hits |
| T-42 | I-21 anon-route safety | `grep -rE "reconciliation\|useOrderStore\|useDoorSalesStore\|useGuestStore\|useScanStore" "app/o/" "app/e/" "app/checkout/"` | 0 hits to reconciliation; existing zero hits to scan/door stores preserved |
| T-43 | Hook ordering ORCH-0710 | grep all `useMemo\|useState\|useCallback\|useEffect` line numbers in `app/event/[id]/reconciliation.tsx` and verify all BEFORE the first conditional `return` | All hook lines < first conditional return line |
| T-44 | Toast wrap absolute | `grep -nE 'position: "absolute"' "app/event/[id]/reconciliation.tsx"` | At least 1 match (the Toast wrap View) |
| T-45 | No new TextInputs | `grep -nE "TextInput" "app/event/[id]/reconciliation.tsx" "src/utils/reconciliation.ts" "src/components/event/ReconciliationCtaTile.tsx"` | 0 hits |
| T-46 | Cycle 12 J-D5 ADDITIVE-only | `git diff HEAD -- "app/event/[id]/door/index.tsx"` | Diff shows ONLY ADDITIVE changes (the polish CTA + style entries); no removed lines except whitespace |
| T-47 | TRANSITIONAL labels | `grep -nE "\[TRANSITIONAL\]\|TESTING MODE\|B-cycle" "app/event/[id]/reconciliation.tsx" src/utils/reconciliation.ts` | At least 3 matches: payoutEstimate stub + "Email PDF report" disabled caption + (likely) Stripe-fee comment |
| T-48 | No fabricated data (Const #9) | grep for hardcoded sample names / amounts / IDs in new files | 0 hits — all data flows from store entries |

---

## 8 — Implementation order (10 sequential steps with tsc checkpoints)

**Per memory rule `feedback_sequential_one_step_at_a_time` — implementor MUST run tsc checkpoint after each step and stop on failure. Surface to orchestrator if any step blocks.**

### Step 1 — Extract `deriveLiveStatus` utility
Create `mingla-business/src/utils/eventLifecycle.ts` containing the verbatim `deriveLiveStatus` function from `app/event/[id]/index.tsx:191-203` (export `EventLifecycleStatus` type matching the 4-state value used by reconciliation aggregator). Update `app/event/[id]/index.tsx` to import from the new utility (delete the inline definition). **tsc checkpoint.**

### Step 2 — Aggregator + types (`src/utils/reconciliation.ts`)
Create the file with full content per §4.2.1. Includes: types · `EMPTY_SUMMARY` const · `headlineCopyFor` · `computeReconciliation` · header docstring. **tsc checkpoint.** Run T-01..T-19 unit tests (deterministic, offline). All MUST pass before proceeding.

### Step 3 — Permission constant (`src/utils/permissionGates.ts`)
Add 1 line `VIEW_RECONCILIATION: BRAND_ROLE_RANK.finance_manager,` to `MIN_RANK` per §4.2.2. **tsc checkpoint.**

### Step 4 — CSV serializer extension (`src/utils/guestCsvExport.ts`)
Implement 3 changes per §4.2.3: NEW columns at positions 12-14 + optional `summaryStanza` arg + `exportReconciliationCsv` wrapper + `ReconciliationCsvSummary` type. **tsc checkpoint.** Run T-35..T-38 tests.

### Step 5 — `/ui-ux-pro-max` pre-flight (mandatory per memory rule)
**This is a process step, not a code step.** Implementor MUST run:

```
python .claude/skills/ui-ux-pro-max/scripts/search.py \
  "operator finance reconciliation summary multi-source dashboard dark glass" \
  --domain product
```

Apply guidance to component decisions (existing GlassCard / Pill / KpiTile / IconChrome / EmptyState should cover; verify before writing component code). Document the search query + applied guidance in IMPL report §8 "Memory rule deference proof" table per Cycle 12 precedent.

### Step 6 — Extract `ActionTile` to shared file (sub-task of Step 7)
Create `mingla-business/src/components/event/ActionTile.tsx` with the verbatim `ActionTile` component currently inline in `app/event/[id]/index.tsx:868-899`. Update `app/event/[id]/index.tsx` to import from the new file (delete inline definition). **tsc checkpoint.** This unblocks `ReconciliationCtaTile` import.

### Step 7 — `ReconciliationCtaTile` component (`src/components/event/ReconciliationCtaTile.tsx`)
Create per §4.3.1. Imports `ActionTile` from Step 6. **tsc checkpoint.** Run T-20+T-21+T-24 tests.

### Step 8 — Reconciliation route (`app/event/[id]/reconciliation.tsx`)
Create per §4.3.2 — full route with all 4 sections + 2 shells + Toast. **ALL hooks declared BEFORE any conditional return per ORCH-0710** — verify by grep mid-write. Toast wrapped per memory rule. **tsc checkpoint.** Run T-22+T-23+T-25..T-34 tests.

### Step 9 — Event Detail wire-up (`app/event/[id]/index.tsx`)
Add `handleReconciliation` callback + render `<ReconciliationCtaTile />` in action grid per §4.3.3. **tsc checkpoint.**

### Step 10 — Door route polish CTA (`app/event/[id]/door/index.tsx`)
Add small "View full reconciliation" CTA at top of route per §4.3.4 + D-CYCLE13-RECON-FOR-4. Permission-gated. **tsc checkpoint.** Run T-46 (ADDITIVE-only diff verification).

### Step 11 — INVARIANT_REGISTRY amendment (`Mingla_Artifacts/INVARIANT_REGISTRY.md`)
Append I-32 amendment per §4.4. **No NEW invariants Cycle 13.**

### Step 12 — Verification matrix + grep regression battery + final IMPL report
Run T-39..T-48 grep regression tests. Produce `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md` per Cycle 12 precedent (15 sections including Old → New receipts + SC verification matrix + invariant verification + memory rule deference proof + constitutional compliance scan + transition items + discoveries for orchestrator). Recommend curated `git add` list.

---

## 9 — Regression prevention

| Class | Safeguard | Test |
|-------|-----------|------|
| Selector pattern drift (Cycle 9c v2 lesson) | grep gate — 0 fresh-array selector subscriptions | T-41 |
| Hook ordering crash (ORCH-0710 lesson) | grep gate — all hooks BEFORE early-return | T-43 |
| Anon buyer route leakage (I-21) | grep gate — reconciliation NEVER imported by anon routes | T-42 |
| Cycle 12 J-D5 regression | git diff — ADDITIVE-only on `door/index.tsx` | T-46 |
| RN color silent invisibility (memory rule) | grep gate — 0 hits for oklch/lab/lch/color-mix | T-40 |
| Discrepancy false positives (Const #9) | render gate — section silent when clean | T-27 |
| Permission UX dishonesty (Const #1) | code gate — null-return on tile + friendly shell on route deep-link | T-20+T-22 |
| Export silent failure (Const #3) | code gate — empty-export disabled with caption + toast on success/failure | T-30+T-31+T-32 |
| Fabricated data (Const #9) | grep gate — no hardcoded sample data in new files | T-48 |

**Protective comments mandatory:**
- Header docstring on `reconciliation.ts` per §4.2.1 (cites Cycle 13 + DEC-095 + selector rule + I-27 dedupe + D-13-10 split formula)
- Header docstring on `app/event/[id]/reconciliation.tsx` per §4.3.2 (cites all 11 D-13-N decisions + selector rule + I-21 + I-27 + ORCH-0710 + TRANSITIONAL payoutEstimate)
- Header docstring on `ReconciliationCtaTile.tsx` per §4.3.1 (cites D-13-3 + Const #1 null-return rationale)

---

## 10 — Hard constraints / non-goals

### 10.1 What implementor MUST NOT do

- DO NOT propose new data infrastructure (no new stores; no DB schema changes)
- DO NOT alter Cycle 12 J-D5 door-only reconciliation card behavior beyond the polish CTA addition (D-CYCLE13-RECON-FOR-4)
- DO NOT alter Event Detail KPI card payout calculation (D-13-10 explicitly defers that as separate follow-up)
- DO NOT introduce new dependencies (`expo-print`, `expo-sharing`, `expo-file-system`, `react-native-html-to-pdf`)
- DO NOT propose audit_log integration (D-13-11 DEFER)
- DO NOT propose blocking lifecycle action on discrepancies (D-13-4 ADVISORY-only)
- DO NOT subscribe to fresh-array selectors (`getOrdersForEvent` / `getSalesForEvent` / `getCompEntriesForEvent` / `getScansForEvent`) — banned per Cycle 9c v2 + Cycle 12 lesson
- DO NOT introduce TextInputs or Sheet primitives in the reconciliation route
- DO NOT skip the `/ui-ux-pro-max` pre-flight (Step 5)
- DO NOT amend persisted Zustand schema versions

### 10.2 What implementor MUST do

- Run tsc checkpoint after each of the 12 steps in §8
- Honor ALL memory rules (§11)
- Produce 15-section IMPL report per Cycle 12 precedent
- Surface ANY ambiguity to orchestrator BEFORE silent reinterpretation (memory rule `feedback_diagnose_first_workflow`)
- Stop on tsc failure; do NOT proceed past a checkpoint with errors

---

## 11 — Memory rule deference (mandatory checklist)

| Rule | Application | Verify by |
|------|-------------|-----------|
| `feedback_diagnose_first_workflow` | Surface ANY ambiguity in §3-§7 to orchestrator BEFORE writing IMPL — no silent reinterpretation | IMPL report §8 |
| `feedback_orchestrator_never_executes` | Implementor does NOT spawn forensics/orchestrator/tester | No agent calls in IMPL |
| `feedback_no_summary_paragraph` | Chat output is tight summary + report path; IMPL report carries detail | IMPL report §1 |
| `feedback_implementor_uses_ui_ux_pro_max` | Step 5 mandatory `/ui-ux-pro-max` pre-flight before component code; document query + applied guidance | IMPL report §8 |
| `feedback_keyboard_never_blocks_input` | NO new TextInputs Cycle 13 — verify by grep T-45 | IMPL report §11 |
| `feedback_rn_color_formats` | Mandatory hex/rgb/hsl/hwb only — grep gate T-40 | IMPL report §8 |
| `feedback_toast_needs_absolute_wrap` | Mandatory absolute-positioned wrap — grep gate T-44 | IMPL report §8 |
| `feedback_rn_sub_sheet_must_render_inside_parent` | NO sub-sheets Cycle 13 — verify by grep | IMPL report §8 |
| `feedback_anon_buyer_routes` | I-21 enforcement — grep gate T-42 | IMPL report §8 |
| `feedback_no_coauthored_by` | Commit message MUST NOT include AI attribution | IMPL report §15 commit message proposal |
| `feedback_sequential_one_step_at_a_time` | Sequential 12 steps with tsc checkpoints; stop on failure | IMPL report §3 + §8 |

---

## 12 — Cross-references

- Canonical epic: [`Mingla_Artifacts/github/epics/cycle-13.md`](../github/epics/cycle-13.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../reports/INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
- SPEC dispatch: [`prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
- Decision lock-in: `DECISION_LOG.md` DEC-095
- Cycle 12 close (J-D5 partial coverage): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- Cycle 9c v3 (orderStore + activity feed): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md)
- Cycle 10 (guestStore + CSV TRANSITIONAL): [`reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md)
- Cycle 11 v2 (scanStore + ORCH-0710): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 13a (rank gate prerequisite): [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md)
- Cycle 13b (audit_log RLS — DEFERRED): [`reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md)
- INVARIANT_REGISTRY: I-19 / I-21 / I-25 / I-26 / I-27 / I-28 / I-29 / I-30 / I-31 / I-32 (amend) / I-33 / I-34
- Memory rules honored (§11): 11 entries
- Forensics discoveries registered (D-CYCLE13-RECON-FOR-1..5)

---

**SPEC ready. Implementor dispatched via separate orchestrator dispatch prompt.**
