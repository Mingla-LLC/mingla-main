# SPEC — BIZ Cycle 12 (Door Sales / In-Person Payments)

**Mode:** SPEC (forensics complete; operator-locked)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md`](../reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md)
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md)
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator/scanner-side door sales
**Target:** production-ready. Not "good enough." Not "works on happy path." Production.
**Date:** 2026-05-03

---

## 1 — Layman summary

Cycle 12 ships the operator's "work the door at a real event" surface. Organisers can: enable in-person payments per event, sell tickets at the door (multi-line cart so one friend pays for the group), use door-only or online-also tier visibility per ticket, accept cash + manual payments today (card/NFC TRANSITIONAL until B-cycle), refund door sales, see all door buyers in the existing guest list, and reconcile cash totals at the end of the night. Door sale auto-checks-in the buyer (they don't have a QR — the sale itself is the check-in). All client-side. PR #59 schema + ORCH-0706 hardening already live for the future B-cycle wire.

---

## 2 — Operator-locked decisions (verbatim — DO NOT re-debate)

| # | Decision | Locked value |
|---|----------|--------------|
| 1 | Cart shape at the door | **Multi-line-item cart** — group buyer pays for friends; mirrors Cycle 8 `CartLine` shape. |
| 2 | Tier source | **BOTH** door-only AND online-tier reuse via `TicketStub.availableAt: "online" \| "door" \| "both"`; existing tiers default `"both"`. |
| 3 | Reconciliation grain | **BOTH** per-scanner AND per-event totals. |
| 4 | `canAcceptPayments` toggle | **FLIP** type-lock to operator-controllable; semantics = "can take cash + manual"; card/NFC TRANSITIONAL until B-cycle. |
| 5 | Door sale auto-check-in | Door sale fires `useScanStore.recordScan({ via: "manual", scanResult: "success" })` per ticket sold. |

---

## 3 — Scope and non-goals

### 3.1 In-scope

- 1 NEW persisted Zustand store: `useDoorSalesStore`
- 1 NEW utility: `expandDoorTickets` (mirror `expandTicketIds`)
- 1 NEW Cycle 8 union extension: `CheckoutPaymentMethod` adds `"cash" | "card_reader" | "nfc" | "manual"`
- 2 NEW operator routes: `/event/{id}/door` (J-D2 list) + `/event/{id}/door/{saleId}` (J-D4 detail)
- 4 NEW components: `DoorSaleNewSheet`, `DoorSaleDetail`, `DoorRefundSheet`, `ReconciliationReport` (last may be inline; implementor's call)
- 1 NEW field on `TicketStub`: `availableAt: "online" | "door" | "both"` (schema bump v5→v6)
- 1 NEW field on `LiveEvent` + `DraftEvent`: `inPersonPaymentsEnabled: boolean` (additive default false)
- Cycle 8 surface modification: `app/checkout/[eventId]/index.tsx` — add `availableAt !== "door"` filter
- Cycle 11 InviteScannerSheet flip: `canAcceptPayments` becomes Pressable toggle
- Cycle 10 J-G1 + J-G2 extension: `kind: "door"` rows + parseGuestId + search predicate
- Step 5 Tickets in EventCreatorWizard + EditPublishedScreen: per-tier `availableAt` 3-state picker
- Step 6 Settings + EditPublishedScreen: `inPersonPaymentsEnabled` ToggleRow
- Logout cascade extension: `useDoorSalesStore.reset()` in `clearAllStores.ts`
- CSV export extension: include door sales in `guestCsvExport.ts`
- 2 NEW invariants ratified: I-29 (door sales not phantom orders) + I-30 (door-tier vs online-tier separation via availableAt)
- TESTING MODE banner on `DoorSaleNewSheet` (mirror Cycle 11 J-S1 banner pattern) — "Card + NFC payments coming when backend ships" copy

### 3.2 Out-of-scope (explicit hard lines)

- ❌ Real Stripe Terminal SDK integration — TRANSITIONAL stub only (card_reader payment method visible as option but disabled with copy "Coming in B-cycle")
- ❌ NFC tap-to-pay platform integration — TRANSITIONAL stub only
- ❌ Real Stripe Connect payout for door sales — B-cycle
- ❌ Cash drawer hardware integration — never; software-only forever
- ❌ Backend writes to `door_sales_ledger` table — UI-only this cycle; PR #59 schema READY, B-cycle wires writes
- ❌ Multi-currency — locked to GBP per existing constitution (Const #10)
- ❌ Anonymous door buyer surface — no buyer-facing receipt screen at the door this cycle (printed receipt is B-cycle)
- ❌ "Mark as reconciled" boolean toggle on individual door sales — defer to B-cycle (schema field exists but no UX)
- ❌ Per-scanner identity resolution — every door sale's `recordedBy` is the operator's `auth.users.id` for now (D-CYCLE12-4 deferred)
- ❌ "True cancellation" (refund + uncheck-in) — refund is money-only this cycle (OBS-1 lock; D-CYCLE12-5 deferred)
- ❌ B-cycle scanner-payments cluster (PRD §6.2 door sales subset that needs scanner-team functional flow) — Cycle 12 ships permission-toggle UI + cash/manual; functional flow B-cycle

### 3.3 Assumptions

- Cycle 11 (commit `ade877fb`) is shipped + live — `useScanStore` + `useScannerInvitationsStore` + `expandTicketIds` + `parseTicketId` exist and work
- Cycle 10 (commit `dc75b5dd`) is shipped + live — `useGuestStore` + `/event/{id}/guests/` + `/event/{id}/guests/{guestId}` exist and J-G1's GuestRow union is the integration target
- Cycle 9c (commit `12dcce02`) is shipped + live — `useOrderStore` + RefundSheet pattern available as reference
- Cycle 8 (commit `6d426755`) is shipped + live — `CartContext` + `CartLine` + `CheckoutPaymentMethod` available as reference
- ORCH-0706 (commit `9d879ac2`) is shipped + live — `door_sales_ledger.payment_method` CHECK constraint enforces the 4 enum values verbatim
- Operator's `auth.user.id` is reachable via `useAuth()` from `src/context/AuthContext`

---

## 4 — Per-layer specification

### 4.1 Database — none

Cycle 12 ships entirely client-side. PR #59 schema is READY. Implementor MUST NOT include any SQL.

### 4.2 Edge functions — none

No new edge functions. No deploys. Mobile-only.

### 4.3 Service layer — none

No new service files. All data access via Zustand stores.

### 4.4 NEW utility — `expandDoorTickets`

**File:** `mingla-business/src/utils/expandDoorTickets.ts` (NEW)

**Purpose:** Re-derive the full set of ticketIds for a door sale from `(saleId, lines[])`. Used by:
- J-D3 auto-check-in fire (per Decision #5 — N scan records per multi-line cart)
- J-D4 detail view per-ticket section
- J-G2 detail view for `kind: "door"` ticket rendering
- J-D5 reconciliation report (if surfacing per-ticket detail)

**Contract (verbatim):**

```ts
import type { DoorSaleLine } from "../store/doorSalesStore";

export interface ExpandedDoorTicket {
  /** dt_<saleSuffix>_<lineIdx>_<seatIdx> — DIFFERENT prefix from online tkt_ */
  ticketId: string;
  lineIdx: number;
  seatIdx: number;
  ticketName: string; // FROZEN at sale time
  isFreeAtSale: boolean;
  unitPriceGbpAtSale: number;
}

const generateDoorTicketId = (
  saleId: string,
  lineIdx: number,
  seatIdx: number,
): string => {
  const saleSuffix = saleId.startsWith("ds_") ? saleId.slice(3) : saleId;
  return `dt_${saleSuffix}_${lineIdx}_${seatIdx}`;
};

export const expandDoorTickets = (
  saleId: string,
  lines: DoorSaleLine[],
): ExpandedDoorTicket[] => {
  const out: ExpandedDoorTicket[] = [];
  lines.forEach((line, lineIdx) => {
    for (let seatIdx = 0; seatIdx < line.quantity; seatIdx += 1) {
      out.push({
        ticketId: generateDoorTicketId(saleId, lineIdx, seatIdx),
        lineIdx,
        seatIdx,
        ticketName: line.ticketNameAtSale,
        isFreeAtSale: line.isFreeAtSale,
        unitPriceGbpAtSale: line.unitPriceGbpAtSale,
      });
    }
  });
  return out;
};
```

**Why `dt_` prefix (not `tkt_`):** door tickets never round-trip through `parseQrPayload`/`parseTicketId` (no QR generation, no camera scan path). Different prefix prevents accidental misparse if a future cycle adds a code path that scans door tickets via camera (defensively bulletproof per HIDDEN-2 finding).

### 4.5 NEW Zustand store — `useDoorSalesStore`

**File:** `mingla-business/src/store/doorSalesStore.ts` (NEW)

**Persist config:**
- Persist key: `mingla-business.doorSalesStore.v1`
- Persist version: `1`
- Storage: `AsyncStorage` via `createJSONStorage(() => AsyncStorage)`
- Partialize: `(s) => ({ entries: s.entries })`

**Type definitions (verbatim):**

```ts
export type DoorPaymentMethod = "cash" | "card_reader" | "nfc" | "manual";

export interface DoorSaleLine {
  /** References LiveEvent.tickets[].id (stable across event edits). */
  ticketTypeId: string;
  /** FROZEN at sale. NEVER mutated. */
  ticketNameAtSale: string;
  /** FROZEN at sale. NEVER mutated. */
  unitPriceGbpAtSale: number;
  /** FROZEN at sale. NEVER mutated. */
  isFreeAtSale: boolean;
  /** FROZEN at sale. NEVER mutated. */
  quantity: number;
  /** Mutable post-refund. 0 ≤ refundedQuantity ≤ quantity. */
  refundedQuantity: number;
  /** Mutable post-refund. Sum of refunds applied to this line. */
  refundedAmountGbp: number;
}

export interface DoorRefundRecord {
  /** dr_<base36-ts>_<base36-rand4> */
  id: string;
  saleId: string;
  amountGbp: number;
  /** REQUIRED 10..200 chars trimmed (mirrors Cycle 9c refund reason). */
  reason: string;
  refundedAt: string;
  /** Per-line attribution. */
  lines: { ticketTypeId: string; quantity: number; amountGbp: number }[];
}

export type DoorSaleStatus = "completed" | "refunded_full" | "refunded_partial";

export interface DoorSaleRecord {
  // Identity
  /** ds_<base36-ts>_<base36-rand4> */
  id: string;
  eventId: string;
  /** Denormalized for fast brand-scoped queries. */
  brandId: string;
  /** Operator/scanner account_id (auth.users.id); audit. Cycle 12: always operator. */
  recordedBy: string;
  // Optional buyer info — door buyer may be anonymous walk-up
  /** Empty string for anonymous walk-ups. */
  buyerName: string;
  /** Empty string if not collected. */
  buyerEmail: string;
  /** Empty string if not collected. */
  buyerPhone: string;
  // Snapshot at sale (write-once)
  paymentMethod: DoorPaymentMethod;
  lines: DoorSaleLine[];
  totalGbpAtSale: number;
  /** Locked per Const #10. */
  currency: "GBP";
  /** Operator notes (e.g., "John gave £50 cash, change £20"). 0..500 chars. */
  notes: string;
  recordedAt: string;
  // Mutable lifecycle
  status: DoorSaleStatus;
  /** Sum across all refunds (denormalized cache). */
  refundedAmountGbp: number;
  /** Append-only audit log. */
  refunds: DoorRefundRecord[];
}

export interface DoorSalesStoreState {
  entries: DoorSaleRecord[];
  // ---- Mutations ----
  /**
   * Append-only. Returns the new DoorSaleRecord (caller fires N scan
   * records per Decision #5 + audit log entry if needed).
   */
  recordSale: (
    sale: Omit<DoorSaleRecord, "id" | "recordedAt" | "status" | "refundedAmountGbp" | "refunds">,
  ) => DoorSaleRecord;
  /**
   * Appends DoorRefundRecord, updates per-line refundedQuantity +
   * refundedAmountGbp, flips status. Returns updated DoorSaleRecord, or
   * null if sale not found.
   */
  recordRefund: (
    saleId: string,
    refund: Omit<DoorRefundRecord, "id" | "refundedAt">,
  ) => DoorSaleRecord | null;
  /** Logout reset. */
  reset: () => void;
  // ---- Selectors ----
  /** Single existing reference; safe to subscribe. */
  getSaleById: (saleId: string) => DoorSaleRecord | null;
  /** Fresh array; USE VIA .getState() ONLY (one-shot lookups). */
  getSalesForEvent: (eventId: string) => DoorSaleRecord[];
  getDoorRevenueForEvent: (eventId: string) => number;
  getDoorSoldCountForEvent: (eventId: string) => number;
  /** For reconciliation report — fresh map; USE VIA .getState() ONLY. */
  getEventTotalsByPaymentMethod: (eventId: string) => Record<DoorPaymentMethod, number>;
  getEventTotalsByScanner: (
    eventId: string,
  ) => Record<string, Record<DoorPaymentMethod, number>>;
}
```

**ID generators:**

```ts
const generateSaleId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `ds_${ts36}_${rand4}`;
};

const generateDoorRefundId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `dr_${ts36}_${rand4}`;
};
```

**Mutation contracts:**

```ts
recordSale: (sale): DoorSaleRecord => {
  const newSale: DoorSaleRecord = {
    ...sale,
    id: generateSaleId(),
    recordedAt: new Date().toISOString(),
    status: "completed",
    refundedAmountGbp: 0,
    refunds: [],
  };
  set((s) => ({ entries: [newSale, ...s.entries] }));
  return newSale;
},

recordRefund: (saleId, refund): DoorSaleRecord | null => {
  const sale = get().entries.find((e) => e.id === saleId);
  if (sale === undefined) return null;
  const id = generateDoorRefundId();
  const refundedAt = new Date().toISOString();
  const fullRefund: DoorRefundRecord = { ...refund, id, refundedAt };

  // Update per-line aggregates
  const newLines = sale.lines.map((line) => {
    const lineRefund = fullRefund.lines.find(
      (rl) => rl.ticketTypeId === line.ticketTypeId,
    );
    if (lineRefund === undefined) return line;
    return {
      ...line,
      refundedQuantity: line.refundedQuantity + lineRefund.quantity,
      refundedAmountGbp: line.refundedAmountGbp + lineRefund.amountGbp,
    };
  });

  const newRefundedAmount = sale.refundedAmountGbp + fullRefund.amountGbp;
  const allLinesFullyRefunded = newLines.every(
    (l) => l.refundedQuantity >= l.quantity,
  );
  const newStatus: DoorSaleStatus = allLinesFullyRefunded
    ? "refunded_full"
    : "refunded_partial";

  const updatedSale: DoorSaleRecord = {
    ...sale,
    lines: newLines,
    refundedAmountGbp: newRefundedAmount,
    refunds: [...sale.refunds, fullRefund],
    status: newStatus,
  };

  set((s) => ({
    entries: s.entries.map((e) => (e.id === saleId ? updatedSale : e)),
  }));
  return updatedSale;
},
```

**Selector rules:**
- `getSaleById` → safe to subscribe (single existing reference)
- `getSalesForEvent`, `getDoorRevenueForEvent`, `getDoorSoldCountForEvent`, `getEventTotalsByPaymentMethod`, `getEventTotalsByScanner` → fresh arrays/maps; USE VIA `.getState()` ONLY. For component reads of multiple sales, use raw `entries` + `useMemo` (Cycle 9c v2 pattern):

```ts
const allEntries = useDoorSalesStore((s) => s.entries);
const eventSales = useMemo(
  () => allEntries.filter((s) => s.eventId === eventId),
  [allEntries, eventId],
);
```

**[TRANSITIONAL] header (verbatim required):**

```ts
/**
 * doorSalesStore — persisted Zustand store for in-person door sales (Cycle 12).
 *
 * I-29: Door sales live in useDoorSalesStore.entries ONLY. NEVER as phantom
 * OrderRecord rows in useOrderStore. CheckoutPaymentMethod online union
 * filters to "card | apple_pay | google_pay | free"; door payment methods
 * "cash | card_reader | nfc | manual" are RESERVED for door flow ONLY.
 *
 * I-30: Door-tier vs online-tier separation enforced via TicketStub.availableAt.
 * Online checkout filters availableAt !== "door"; door flow filters
 * availableAt !== "online". AddCompGuestSheet filters availableAt === "both".
 *
 * Refund pattern (mirrors Cycle 9c orderStore): refunds are append-only;
 * original lines NEVER overwritten; status flips refunded_partial / refunded_full.
 *
 * I-19 spirit: refund of door sale affects MONEY only (DoorSaleRecord state).
 * Auto-check-in (useScanStore success record fired at sale time) is NEVER
 * voided by refund — physical attendance ≠ financial event. Cycle 12 OBS-1.
 *
 * Constitutional notes:
 *   - #2 one owner per truth: door sales live ONLY here; NEVER duplicated in
 *     orderStore or guestStore.
 *   - #6 logout clears: extended via clearAllStores.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *   - #10 currency-aware: currency: "GBP" frozen on every sale.
 *
 * [TRANSITIONAL] Zustand persist holds entries client-side. B-cycle migrates
 * to Supabase door_sales_ledger (PR #59 schema READY + ORCH-0706 hardened).
 * When backend lands, this store contracts to a cache + ID-only.
 *
 * Per Cycle 12 SPEC §4.5.
 */
```

**Logout cascade:** Add to `src/utils/clearAllStores.ts`:

```ts
import { useDoorSalesStore } from "../store/doorSalesStore";

// ... existing resets ...
useDoorSalesStore.getState().reset(); // NEW Cycle 12 — Constitution #6
```

### 4.6 `TicketStub.availableAt` field cascade

**File:** `mingla-business/src/store/draftEventStore.ts` (MOD)

**Schema bump v5 → v6.** Additive field; migrate function defaults `"both"`.

**TicketStub addition (verbatim):**

```ts
export type TicketAvailableAt = "online" | "door" | "both";

export interface TicketStub {
  // ... existing fields ...
  /**
   * Cycle 12 — controls which checkout surface this tier appears on.
   * "online": only visible at /checkout/{eventId} buyer flow.
   * "door":   only visible at /event/{id}/door door-sale flow.
   * "both":   visible everywhere (default for migrated tiers).
   * I-30 enforced via filter chains in J-C1 + J-D3 + AddCompGuestSheet.
   */
  availableAt: TicketAvailableAt;
}
```

**Migrate function (v5 → v6):**

```ts
type V5TicketStub = Omit<TicketStub, "availableAt">;
type V5DraftSnapshot = ... { tickets: V5TicketStub[]; ... };

const upgradeV5TicketToV6 = (t: V5TicketStub): TicketStub => ({
  ...t,
  availableAt: "both",
});

const upgradeDraftV5ToV6 = (s: V5DraftSnapshot): DraftSnapshot => ({
  ...s,
  tickets: s.tickets.map(upgradeV5TicketToV6),
});

// In persist version chain:
case 5:
  return upgradeDraftV5ToV6(persistedState as V5DraftSnapshot);
```

**LiveEvent persist:** Same migrate logic for any persist version chain on `liveEventStore` (verify via implementor pre-flight). Default `"both"` for all migrated tier rows.

**No change** to `LiveEventEditableFieldKey` — `"tickets"` already covers tier-level changes including this field per Cycle 9b-2 / ORCH-0704 v2 architecture.

### 4.7 `LiveEvent.inPersonPaymentsEnabled` field

**File:** `mingla-business/src/store/liveEventStore.ts` (MOD) + `mingla-business/src/store/draftEventStore.ts` (MOD)

**LiveEvent + DraftEvent addition:**

```ts
/**
 * Cycle 12 — when true, J-D1 "Door Sales" ActionTile appears on Event Detail
 * + door sale flow is reachable. When false, no door tile, no /event/{id}/door
 * route. Default false. Operator-toggled via Step 6 Settings + EditPublishedScreen.
 */
inPersonPaymentsEnabled: boolean;
```

**LiveEventEditableFieldKey union extension:**

```ts
export type LiveEventEditableFieldKey = Extract<
  keyof LiveEvent,
  | "name"
  | "description"
  // ... existing ...
  | "privateGuestList"
  | "inPersonPaymentsEnabled"  // NEW Cycle 12
>;
```

**liveEventConverter.ts (MOD):** propagate field in `draftToLive(...)`.

**liveEventAdapter.ts (MOD):** 4 surfaces — extract snapshot, label map ("In-person payments"), editable keys array, diff detector — all gain `inPersonPaymentsEnabled`. Mirror Cycle 10 `privateGuestList` integration pattern verbatim.

**ChangeSummaryModal.tsx (MOD):** label map entry `inPersonPaymentsEnabled: "In-person payments"`.

**Default for migrated rows:** `false` (operators must explicitly enable).

### 4.8 `CheckoutPaymentMethod` union extension

**File:** `mingla-business/src/components/checkout/CartContext.tsx` (MOD)

**Current:**
```ts
export type CheckoutPaymentMethod = "card" | "apple_pay" | "google_pay" | "free";
```

**Cycle 12:**
```ts
export type CheckoutPaymentMethod =
  | "card"          // online
  | "apple_pay"     // online
  | "google_pay"    // online
  | "free"          // online (free tier)
  | "cash"          // door
  | "card_reader"   // door (TRANSITIONAL — Stripe Terminal SDK B-cycle)
  | "nfc"           // door (TRANSITIONAL — platform NFC integration B-cycle)
  | "manual";       // door (operator manually records)
```

**I-29 enforcement:** `app/checkout/[eventId]/payment.tsx` (Cycle 8 buyer payment screen) MUST filter to online union ONLY when constructing OrderResult. Door payment methods MUST NEVER appear in buyer flow. Implementor: verify with grep test post-IMPL.

### 4.9 NEW component — `DoorSaleNewSheet`

**File:** `mingla-business/src/components/door/DoorSaleNewSheet.tsx` (NEW)

**Pattern:** Multi-line cart inside a `Sheet snapPoint="full"`. Operator selects tickets + qty + payment method + (optional) buyer details + (optional) notes → confirm → record.

**Props:**

```ts
export interface DoorSaleNewSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (sale: DoorSaleRecord) => void;
}
```

**Internal state:**

```ts
const [lines, setLines] = useState<CartLine[]>([]);  // mirror Cycle 8 CartLine
const [paymentMethod, setPaymentMethod] = useState<DoorPaymentMethod>("cash");
const [buyerName, setBuyerName] = useState("");
const [buyerEmail, setBuyerEmail] = useState("");
const [buyerPhone, setBuyerPhone] = useState("");
const [notes, setNotes] = useState("");
const [submitting, setSubmitting] = useState(false);
```

**Layout (top to bottom):**

1. **Title:** "New door sale"
2. **TESTING MODE banner** (mirror Cycle 11 J-S1 banner; see §4.9.x for exact copy)
3. **Tier picker section** (Step 1 — pick tickets):
   - List of `event.tickets.filter(t => t.visibility !== "hidden" && t.availableAt !== "online").sort(by displayOrder)` — surfaces "door" + "both"
   - Each tier row: name + price + `Qty -|N|+` stepper (0..maxPurchaseQty or 99 if no cap)
   - Empty state if no tiers available: *"No tiers available for door sales. Edit the event to mark tiers as available at the door."*
4. **Cart summary:**
   - List of selected lines with qty × name + line total
   - Total
5. **Payment method picker** (Step 2):
   - 4 options as ToggleRow / SegmentedControl-style picker:
     - **Cash** ✅ enabled
     - **Card reader** ⏳ disabled with TRANSITIONAL caption "Coming when backend ships"
     - **NFC tap** ⏳ disabled with TRANSITIONAL caption "Coming when backend ships"
     - **Manual** ✅ enabled — for operator-recorded payments (e.g., bank transfer pre-paid; comp converted to paid)
6. **Buyer details (optional)** (Step 3):
   - Name (optional, defaults to "Walk-up" if empty)
   - Email (optional)
   - Phone (optional)
   - Notes (optional, 0..500 chars)
7. **Sticky bottom bar:**
   - Total readout
   - "Record sale" CTA (enabled when `lines.length > 0 && paymentMethod is enabled`)

**Confirm handler (verbatim — mirrors HIDDEN-1 contract):**

```ts
const handleConfirm = useCallback(async (): Promise<void> => {
  if (lines.length === 0) return;
  if (paymentMethod === "card_reader" || paymentMethod === "nfc") return; // TRANSITIONAL guard
  setSubmitting(true);
  try {
    await sleep(400); // light simulated processing
    const totalGbp = lines.reduce(
      (sum, l) => sum + l.unitPriceGbp * l.quantity,
      0,
    );
    const newSale = useDoorSalesStore.getState().recordSale({
      eventId: event.id,
      brandId,
      recordedBy: operatorAccountId,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim().toLowerCase(),
      buyerPhone: buyerPhone.trim(),
      paymentMethod,
      lines: lines.map((l) => ({
        ticketTypeId: l.ticketTypeId,
        ticketNameAtSale: l.ticketName,
        unitPriceGbpAtSale: l.unitPriceGbp,
        isFreeAtSale: l.isFree,
        quantity: l.quantity,
        refundedQuantity: 0,
        refundedAmountGbp: 0,
      })),
      totalGbpAtSale: totalGbp,
      currency: "GBP",
      notes: notes.trim(),
    });
    // Decision #5 — fire auto-check-in scan records per ticket
    const expanded = expandDoorTickets(newSale.id, newSale.lines);
    const buyerNameForScan =
      newSale.buyerName.length > 0 ? newSale.buyerName : "Walk-up";
    expanded.forEach((t) => {
      useScanStore.getState().recordScan({
        ticketId: t.ticketId,
        orderId: newSale.id, // ds_xxx ID, NOT empty string
        eventId: newSale.eventId,
        brandId: newSale.brandId,
        scannerUserId: newSale.recordedBy,
        scanResult: "success",
        via: "manual",
        offlineQueued: true,
        buyerNameAtScan: buyerNameForScan,
        ticketNameAtScan: t.ticketName,
      });
    });
    onSuccess(newSale);
  } finally {
    setSubmitting(false);
  }
}, [
  lines, paymentMethod, buyerName, buyerEmail, buyerPhone, notes,
  event, brandId, operatorAccountId, onSuccess,
]);
```

**Memory rule `feedback_keyboard_never_blocks_input`:** sheet has 4 text inputs (buyerName, buyerEmail, buyerPhone, notes) → MUST honor `keyboardShouldPersistTaps="handled"` + `automaticallyAdjustKeyboardInsets` + `keyboardDismissMode="on-drag"` (mirror Cycle 11 InviteScannerSheet pattern).

**TESTING MODE banner copy (verbatim — mirrors Cycle 11 ORCH-0711 banner pattern):**

> "Testing mode — only Cash and Manual payments work today. Card reader and NFC tap-to-pay land when the backend ships in B-cycle."

### 4.10 NEW component — `DoorSaleDetail`

**File:** `mingla-business/src/components/door/DoorSaleDetail.tsx` (NEW) OR `app/event/[id]/door/[saleId].tsx` route directly.

**Implementor's call:** if J-D4 detail is sheet-based, use the component file. If route-based, inline in the route file. Recommend **route-based** — door sale detail is a substantive surface; modal sheet would feel cramped.

**Layout:**

1. Chrome (close back to /door)
2. Hero (sale ID + recorded date + status pill + paymentMethod pill)
3. **TICKETS section** — per-ticket rows from `expandDoorTickets(sale.id, sale.lines)`:
   - Ticket name
   - Unit price
   - Refund indicator if line.refundedQuantity > 0
4. **PAYMENT section:**
   - Payment method
   - Total
   - Refunded amount (if any)
5. **BUYER section (if any details captured):**
   - Name / email / phone
6. **NOTES section (if notes present)**
7. **REFUND HISTORY section (if refunds.length > 0):**
   - Per-refund: amount + reason + relative time
8. **CTA:** "Refund" button (variant=ghost) → opens DoorRefundSheet — only visible when `status !== "refunded_full"`

### 4.11 NEW component — `DoorRefundSheet`

**File:** `mingla-business/src/components/door/DoorRefundSheet.tsx` (NEW)

**Pattern:** mirror Cycle 9c RefundSheet. Operator picks per-line refund quantities + amount + reason → confirm → record refund.

**Props:**

```ts
export interface DoorRefundSheetProps {
  visible: boolean;
  sale: DoorSaleRecord;
  onClose: () => void;
  onSuccess: (updatedSale: DoorSaleRecord) => void;
}
```

**Inputs:**
- Per-line refund qty stepper (0..line.quantity - line.refundedQuantity)
- Refund total auto-computed
- Reason (REQUIRED 10..200 chars trimmed — mirrors Cycle 9c)

**Confirm handler:**

```ts
const handleConfirm = useCallback((): void => {
  if (!reasonValid) return;
  setSubmitting(true);
  const refundLines = perLineRefundQty
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      ticketTypeId: l.ticketTypeId,
      quantity: l.quantity,
      amountGbp: l.amountGbp,
    }));
  const totalRefundAmount = refundLines.reduce(
    (sum, l) => sum + l.amountGbp,
    0,
  );
  const updated = useDoorSalesStore.getState().recordRefund(sale.id, {
    saleId: sale.id,
    amountGbp: totalRefundAmount,
    reason: reason.trim(),
    lines: refundLines,
  });
  if (updated === null) {
    setSubmitting(false);
    showToast("Couldn't record refund. Tap to try again.");
    return;
  }
  setSubmitting(false);
  onSuccess(updated);
  // OBS-1 lock: NO useScanStore touch — refund is money-only, not attendance.
}, [reason, reasonValid, sale, perLineRefundQty, onSuccess]);
```

**Important:** **NO `useScanStore.recordScan` call here** per OBS-1 lock + I-19 spirit.

### 4.12 NEW route — `/event/{id}/door/index.tsx` (J-D2 list view)

**File:** `mingla-business/app/event/[id]/door/index.tsx` (NEW)

**Layout:**
1. Chrome ("Door Sales" title; back to Event Detail; right slot: "+" → opens DoorSaleNewSheet)
2. **TESTING MODE banner** (event-scoped — same copy as DoorSaleNewSheet)
3. **Reconciliation summary card at top** (J-D5 inlined):
   - Event totals: cash £X · card £Y · nfc £Z · manual £W · refunded -£R · NET £NET
   - "View by scanner" toggle expands per-scanner breakdown
   - "Export CSV" button
4. **Sales list** sorted newest-first by `recordedAt`:
   - Each row: avatar (paymentMethod-tinted) + buyerName-or-"Walk-up" + total + paymentMethod pill + status pill + relative time
   - Tap row → `/event/{id}/door/{saleId}` detail
5. Empty state if `eventSales.length === 0`: *"No door sales yet. Tap + to record one."*

**Source data (selector pattern):**

```ts
const allEntries = useDoorSalesStore((s) => s.entries);
const eventSales = useMemo(
  () => allEntries
    .filter((s) => s.eventId === eventId)
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()),
  [allEntries, eventId],
);
const totalsByMethod = useMemo(() => {
  const totals: Record<DoorPaymentMethod, number> = { cash: 0, card_reader: 0, nfc: 0, manual: 0 };
  for (const s of eventSales) {
    if (s.status === "refunded_full") continue;
    const live = s.totalGbpAtSale - s.refundedAmountGbp;
    totals[s.paymentMethod] += live;
  }
  return totals;
}, [eventSales]);
const totalsByScanner = useMemo(() => {
  const map = new Map<string, Record<DoorPaymentMethod, number>>();
  for (const s of eventSales) {
    if (s.status === "refunded_full") continue;
    const live = s.totalGbpAtSale - s.refundedAmountGbp;
    const existing = map.get(s.recordedBy) ?? { cash: 0, card_reader: 0, nfc: 0, manual: 0 };
    existing[s.paymentMethod] += live;
    map.set(s.recordedBy, existing);
  }
  return map;
}, [eventSales]);
```

### 4.13 NEW route — `/event/{id}/door/{saleId}.tsx` (J-D4 detail view)

**File:** `mingla-business/app/event/[id]/door/[saleId].tsx` (NEW)

Renders `DoorSaleDetail` component (or inlined per implementor's call). Composite ID parsing: `params.saleId` directly.

### 4.14 Cycle 8 surface modification — `/checkout/{eventId}/index.tsx`

**File:** `mingla-business/app/checkout/[eventId]/index.tsx` (MOD)

**Add filter:** in the ticket picker rendering, filter `event.tickets.filter(t => t.visibility !== "hidden" && t.availableAt !== "door")`.

**Why:** I-30 — door-only tiers MUST NOT surface in online checkout. Forensics G3.

### 4.15 Cycle 11 InviteScannerSheet flip

**File:** `mingla-business/src/components/scanners/InviteScannerSheet.tsx` (MOD)

Replace the disabled `<View>` for canAcceptPayments with a real Pressable toggle (mirror the canManualCheckIn toggle one row above):

```tsx
<View style={styles.toggleRow}>
  <View style={styles.toggleCol}>
    <Text style={styles.toggleLabel}>Accept payments at the door</Text>
    <Text style={styles.toggleSubline}>
      They can take cash and manual payments. Card reader and NFC land in B-cycle.
    </Text>
  </View>
  <Pressable
    onPress={() => !submitting && setCanAcceptPayments((v) => !v)}
    accessibilityRole="switch"
    accessibilityState={{ checked: canAcceptPayments }}
    accessibilityLabel="Accept payments at the door"
    disabled={submitting}
    style={[styles.toggleTrack, canAcceptPayments && styles.toggleTrackOn]}
  >
    <View style={[styles.toggleThumb, canAcceptPayments && styles.toggleThumbOn]} />
  </Pressable>
</View>
```

**Add state:** `const [canAcceptPayments, setCanAcceptPayments] = useState<boolean>(false);`

**Pass user selection** in `handleConfirm` (replace hardcoded false):

```ts
permissions: {
  canScan: true,
  canManualCheckIn,
  canAcceptPayments,  // <-- was hardcoded false; now operator-controlled
},
```

**Reset on visible flip:** add `setCanAcceptPayments(false);` in the existing reset useEffect.

**Update `scannerInvitationsStore.ts:46-48` comment:**

```ts
/**
 * Operator-set — controls J-D1 / J-D3 door sale CTA visibility for this scanner.
 * Cycle 12: semantics = "can take cash + manual payments". Card reader + NFC
 * remain TRANSITIONAL until B-cycle Stripe Terminal SDK lands.
 */
canAcceptPayments: boolean;
```

### 4.16 Step 5 Tickets — per-tier `availableAt` picker

**File:** `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (MOD)

For each ticket in the list, add a 3-state segmented picker (or pill row) below the existing visibility row:

```
Available at:  [Online] [Door] [Both]
```

Tap toggles the field. Default `"both"` for new tiers.

**Same UI in EditPublishedScreen** at the per-tier edit surface.

### 4.17 Step 6 Settings — `inPersonPaymentsEnabled` toggle

**File:** `mingla-business/src/components/event/CreatorStep6Settings.tsx` (MOD)

Add a 6th ToggleRow (or wherever fits the existing ordering):

```
[ ] In-person payments
    Sell tickets at the door. Adds a "Door Sales" tile to your event.
```

**Same toggle in EditPublishedScreen.**

### 4.18 Cycle 10 J-G1 + J-G2 extension — `kind: "door"` rows

**File:** `mingla-business/app/event/[id]/guests/index.tsx` (MOD)

**GuestRow union extension:**

```ts
type GuestRow =
  | { kind: "order"; id: string; order: OrderRecord; sortKey: string }
  | { kind: "comp"; id: string; comp: CompGuestEntry; sortKey: string }
  | { kind: "door"; id: string; sale: DoorSaleRecord; sortKey: string }; // NEW Cycle 12
```

**Selector extension** — add door sales to the merged + sorted list:

```ts
const allDoorEntries = useDoorSalesStore((s) => s.entries);
// in the merged useMemo:
const doorRows = allDoorEntries
  .filter((s) => s.eventId === eventId)
  .map<GuestRow>((s) => ({
    kind: "door",
    id: s.id,
    sale: s,
    sortKey: s.recordedAt,
  }));
return [...orders, ...comps, ...doorRows].sort(/* by sortKey desc */);
```

**Search predicate extension:**

```ts
if (row.kind === "door") {
  const s = row.sale;
  return (
    s.buyerName.toLowerCase().includes(lower) ||
    s.buyerEmail.toLowerCase().includes(lower) ||
    s.buyerPhone.toLowerCase().includes(lower)
  );
}
```

**GuestRowCard extension:**

```ts
} else if (row.kind === "door") {
  const s = row.sale;
  const name = s.buyerName.trim().length > 0 ? s.buyerName : "Walk-up";
  const ticketSummary = `${s.lines.reduce((sum, l) => sum + l.quantity, 0)} tickets`;
  // payment method status pill
  const paymentPillSpec = doorPaymentPill(s.paymentMethod, s.status);
  // check-in pill: ALWAYS info CHECKED IN for doors (auto-check-in per Decision #5)
  // ... render
}
```

**Pill spec for door payment method:**

```ts
const doorPaymentPill = (method: DoorPaymentMethod, status: DoorSaleStatus) => {
  if (status === "refunded_full") return { variant: "warn", label: "REFUNDED" };
  if (status === "refunded_partial") return { variant: "accent", label: "PARTIAL" };
  switch (method) {
    case "cash": return { variant: "info", label: "CASH" };
    case "card_reader": return { variant: "info", label: "CARD" };
    case "nfc": return { variant: "info", label: "NFC" };
    case "manual": return { variant: "draft", label: "MANUAL" };
  }
};
```

**File:** `mingla-business/app/event/[id]/guests/[guestId].tsx` (MOD)

**parseGuestId extension:**

```ts
const parseGuestId = (raw: string) => {
  if (raw.startsWith("order-")) return { kind: "order", innerId: raw.slice(6) };
  if (raw.startsWith("comp-")) return { kind: "comp", innerId: raw.slice(5) };
  if (raw.startsWith("door-")) return { kind: "door", innerId: raw.slice(5) };
  return null;
};
```

**Selector extension:** `useDoorSalesStore.getSaleById(parsed.innerId)` for `parsed.kind === "door"`.

**Detail view extension** — add a third branch alongside isOrder + isComp for `isDoor`:
- TICKETS section per-ticket from `expandDoorTickets(sale.id, sale.lines)`
- DOOR SALE METADATA section (replaces ORDER ACTIVITY)
- Refund button → opens DoorRefundSheet

**Hero check-in pill for door:** ALWAYS info CHECKED IN (auto-check-in per Decision #5).

**Hook ordering:** when adding new useMemos for door-related derivations, place them BEFORE the early-return shell at line 273 (post-ORCH-0710 lesson — this is a hard rule for J-G2 now).

### 4.19 Event Detail — J-D1 ActionTile

**File:** `mingla-business/app/event/[id]/index.tsx` (MOD)

Add a new ActionTile next to existing tiles, gated on `event.inPersonPaymentsEnabled`:

```tsx
{event.inPersonPaymentsEnabled ? (
  <ActionTile
    icon="cash"
    label="Door Sales"
    sub={`${doorSoldCount} sold · £${doorRevenue.toFixed(0)}`}
    onPress={handleDoorSales}
  />
) : null}
```

**Handler:**

```ts
const handleDoorSales = useCallback((): void => {
  if (id !== null) router.push(`/event/${id}/door` as never);
}, [router, id]);
```

**KPI derivations (mirror Cycle 9c orderStore reads):**

```ts
const doorSoldCount = useDoorSalesStore((s) =>
  event !== null ? s.getDoorSoldCountForEvent(event.id) : 0,
);
const doorRevenue = useDoorSalesStore((s) =>
  event !== null ? s.getDoorRevenueForEvent(event.id) : 0,
);
```

**Optional:** display blended Total = online + door revenue on EventDetailKpiCard. Implementor's call (recommended; small additive).

### 4.20 CSV export extension

**File:** `mingla-business/src/utils/guestCsvExport.ts` (MOD)

Extend the CSV generator to include door sale rows. Recommend a `kind` column at the front: `ONLINE | COMP | DOOR`. Door sale rows use buyer fields if present, else "Walk-up".

---

## 5 — Six journeys (J-D1..J-D6 — full per-journey detail)

### J-D1 — "Door Sales" ActionTile on Event Detail

**File:** `mingla-business/app/event/[id]/index.tsx` (MOD per §4.19)

**Layout:** New ActionTile in the action grid, gated on `event.inPersonPaymentsEnabled === true`. Hidden when toggle off.

**Subtext:** `{doorSoldCount} sold · £{doorRevenue}` — live from `useDoorSalesStore` selectors.

**Tap:** routes to `/event/{id}/door`.

**States:** if `!event.inPersonPaymentsEnabled`: tile not rendered. If enabled with 0 sales yet: shows "0 sold · £0".

### J-D2 — Door sales list view

**Route:** `/event/{id}/door`
**File:** `mingla-business/app/event/[id]/door/index.tsx` (NEW)

Layout per §4.12. Includes inline reconciliation summary card at top (J-D5 surface). "+" button opens DoorSaleNewSheet. Empty state when no sales yet.

### J-D3 — New door sale flow (DoorSaleNewSheet)

**Component:** `mingla-business/src/components/door/DoorSaleNewSheet.tsx` (NEW)

Full multi-line cart with TESTING MODE banner. Per §4.9.

**Tier filter:** `availableAt !== "online"` — surfaces "door" + "both".

**Payment methods:** cash + manual enabled today; card_reader + nfc TRANSITIONAL disabled.

**Auto-check-in:** Decision #5 — fires N scan records.

### J-D4 — Door sale detail view + refund

**Route:** `/event/{id}/door/{saleId}`
**File:** `mingla-business/app/event/[id]/door/[saleId].tsx` (NEW)

Renders DoorSaleDetail per §4.10. "Refund" CTA opens DoorRefundSheet per §4.11. Refund records via `useDoorSalesStore.recordRefund(...)`.

**OBS-1 lock:** refund DOES NOT touch `useScanStore` (financial event ≠ attendance event).

### J-D5 — Reconciliation summary

**Surface:** Inline at top of `/event/{id}/door` route per §4.12.

**Content:**
- Event total (cash / card / nfc / manual / refunded / NET)
- "By scanner" expandable section (1 row per `recordedBy` value)
- "Export CSV" button → invokes extended `guestCsvExport.ts` filtered to door sales for this event

### J-D6 — Operator settings

**Surfaces:**
- Step 6 Settings in EventCreatorWizard — `inPersonPaymentsEnabled` ToggleRow per §4.17
- EditPublishedScreen — same toggle for post-publish editing
- Step 5 Tickets in EventCreatorWizard — per-tier `availableAt` 3-state picker per §4.16
- EditPublishedScreen — same per-tier picker
- InviteScannerSheet — `canAcceptPayments` toggle FLIP per §4.15

---

## 6 — Success criteria (SC-1..SC-32)

| SC | Description |
|----|-------------|
| SC-1 | Operator enables in-person payments via Step 6 Settings → "Door Sales" tile appears on Event Detail |
| SC-2 | Operator disables in-person payments → "Door Sales" tile disappears on Event Detail |
| SC-3 | Tap "Door Sales" tile → routes to `/event/{id}/door` list view |
| SC-4 | Empty event door list shows "No door sales yet. Tap + to record one." |
| SC-5 | "+" CTA opens DoorSaleNewSheet with TESTING MODE banner visible |
| SC-6 | Tier picker in DoorSaleNewSheet shows tiers with `availableAt: "door"` and `availableAt: "both"` only; `"online"` tiers are HIDDEN |
| SC-7 | Multi-line cart: pick 2× "VIP" + 3× "General" → cart shows both lines + total |
| SC-8 | Payment method picker — Cash + Manual are tappable; Card reader + NFC are visually disabled with TRANSITIONAL caption |
| SC-9 | Confirm cash sale (qty=2 General £20 each) → DoorSaleRecord recorded + toast + sheet closes |
| SC-10 | After SC-9: door list view shows the new sale with paymentMethod=CASH pill + total £40 |
| SC-11 | After SC-9: 2 ScanRecord entries fired with `via: "manual", scanResult: "success", orderId: <ds_xxx>` per Decision #5 |
| SC-12 | After SC-9: Recent Activity feed on Event Detail shows "{buyerName} checked in" entries (event_scan kind) |
| SC-13 | After SC-9: J-G1 guest list shows the door sale row with CHECKED IN pill (always green for doors) |
| SC-14 | After SC-9: Door sale row tap → opens J-D4 detail view at `/event/{id}/door/{saleId}` |
| SC-15 | J-D4 detail view: TICKETS section shows 2 rows (per seat), payment method = CASH, total £40, refund button visible |
| SC-16 | Refund flow: tap Refund → DoorRefundSheet opens with per-line stepper |
| SC-17 | Refund partial (refund 1 ticket £20) with 10+ char reason → recorded; sale status = "refunded_partial"; refundedAmountGbp = 20 |
| SC-18 | After SC-17: J-G1 row pill remains CHECKED IN (OBS-1 — refund doesn't void check-in) |
| SC-19 | After SC-17: J-D4 detail shows REFUND HISTORY section with 1 entry |
| SC-20 | Refund full: 2nd refund of remaining £20 → status flips to "refunded_full"; refund button no longer visible |
| SC-21 | Reconciliation summary at top of /door route: cash £20 (after partial refund of £20 from £40) ; refunded -£20 ; NET £20 |
| SC-22 | "By scanner" expand: shows 1 row (operator) with cash £20 ; net £0 (after full refund test) |
| SC-23 | Export CSV button: downloads CSV (web) or shares text (native) with door sales included |
| SC-24 | InviteScannerSheet: canAcceptPayments toggle is now Pressable + flips state |
| SC-25 | InviteScannerSheet: invite scanner with canAcceptPayments=true → invitation appears in /scanners list with the permission |
| SC-26 | Online checkout at /checkout/{id}: tier with `availableAt: "door"` does NOT appear in J-C1 picker (I-30 enforced) |
| SC-27 | AddCompGuestSheet (Cycle 10): tier with `availableAt: "door"` does NOT appear in tier picker (I-30 enforced) |
| SC-28 | Logout cascade: useDoorSalesStore.entries === [] post-logout (Const #6) |
| SC-29 | Cold-start hydration: door sale persists across app restart (Const #14) |
| SC-30 | tsc clean across mingla-business workspace |
| SC-31 | Grep regression: `useDoorSalesStore` not subscribed to fresh-array selectors directly (only via `.getState()` or raw entries + useMemo) |
| SC-32 | TRANSITIONAL labels honored: useDoorSalesStore header + TESTING MODE banner copy + canAcceptPayments comment update + card_reader/nfc TRANSITIONAL captions all present |

---

## 7 — Test matrix (T-01..T-50)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Toggle ON in Step 6 / Edit | inPersonPaymentsEnabled=true | Door Sales tile appears | Component |
| T-02 | Toggle OFF | inPersonPaymentsEnabled=false | Door Sales tile hidden | Component |
| T-03 | Tile tap → route | tap | `/event/{id}/door` reachable | Route |
| T-04 | Empty list state | 0 sales | EmptyState rendered | Component |
| T-05 | Open new-sale sheet | + tap | DoorSaleNewSheet visible with banner | Component |
| T-06 | Tier filter in new-sale | "online"-only tier | Tier hidden | Selector + UI |
| T-07 | Tier filter — "both" tier | "both" tier | Tier visible | Selector + UI |
| T-08 | Multi-line cart | 2× VIP + 3× GA | Cart shows 2 lines + correct total | Component |
| T-09 | Payment method picker — cash | Tap Cash | Selected; Confirm enabled | Component |
| T-10 | Payment method picker — card_reader | Tap Card | Disabled; TRANSITIONAL copy visible; Confirm stays disabled | Component |
| T-11 | Confirm cash sale | Valid lines + cash | DoorSaleRecord created; toast; sheet closes | Full stack |
| T-12 | Auto-check-in fired | qty=3 sale | 3 ScanRecord entries recorded with `via: "manual", scanResult: "success"` | Store |
| T-13 | Activity feed picks up | After cash sale | Recent Activity shows {name} checked in N times | Cycle 9c-2 wire |
| T-14 | J-G1 row appears | After cash sale | New door row in guest list with CHECKED IN pill | Cycle 10 wire |
| T-15 | J-G1 row search by name | Search "Tunde" matches "Tunde" walk-up | Row matched | Predicate |
| T-16 | J-G1 anonymous walk-up | Empty buyer name | Row shows "Walk-up · 3 tickets · CASH" | Component |
| T-17 | J-G2 detail (door kind) | tap door row | DoorSaleDetail renders with all sections | Route |
| T-18 | Refund partial | Refund 1 of 2 tickets | status=refunded_partial; refunded -£X; J-G1 stays CHECKED IN | Store + Component |
| T-19 | Refund full | Refund remaining | status=refunded_full; refund button hidden | Store + Component |
| T-20 | Refund reason validation | <10 chars | Confirm disabled | Validation |
| T-21 | Refund history surfaces | After 2 refunds | DoorSaleDetail shows 2 refund entries | Component |
| T-22 | Reconciliation cash total | 3 cash sales £20 each | summary shows £60 | Selector |
| T-23 | Reconciliation refunded total | 1 refund £10 | summary shows refunded -£10 | Selector |
| T-24 | Reconciliation NET | After above | NET = £50 | Selector |
| T-25 | Reconciliation by-scanner | All sales recorded by operator | "By scanner" shows 1 row | Selector |
| T-26 | CSV export — door rows | tap export | CSV includes door sale rows tagged DOOR kind | Util |
| T-27 | InviteScannerSheet toggle flip | tap canAcceptPayments | Toggle visually flips on/off | Component |
| T-28 | InviteScannerSheet save with permission | toggle on + send | Invitation row in /scanners shows permission |  Store + Component |
| T-29 | Online checkout J-C1 — door tier hidden | "door"-only tier exists | J-C1 picker doesn't show it | Selector |
| T-30 | AddCompGuestSheet — door tier hidden | "door"-only tier exists | Comp picker doesn't show it | Selector |
| T-31 | Persist v5→v6 migrate | Cold-start with v5 data | All tiers default `availableAt: "both"` | Persist |
| T-32 | LiveEvent inPersonPaymentsEnabled migrate | Cold-start old live | Default false | Persist |
| T-33 | Logout cascade | Sign out | useDoorSalesStore.entries === [] | Const #6 |
| T-34 | Cold-start hydration | Sale → kill app → reopen | Sale persists; J-G1 still shows row | Const #14 |
| T-35 | Cross-event scoping | Sale on Event A; open Event B /door | Event B's list empty | Selector scoping |
| T-36 | tsc clean | `npx tsc --noEmit` | Exit 0 | Static |
| T-37 | No oklch / lab / lch | grep new files | 0 hits | Memory rule |
| T-38 | Selector pattern | grep door fresh-array selectors directly subscribed | 0 hits | Memory rule |
| T-39 | Buyer-route safety | grep app/o/, app/e/, app/checkout/ for useDoorSalesStore | 0 hits | I-21 |
| T-40 | OBS-1 — refund doesn't touch scanStore | grep DoorRefundSheet handler for useScanStore | 0 hits | OBS-1 lock |
| T-41 | I-29 — door payment methods absent from buyer route | grep app/checkout/ for "cash"|"manual"|"card_reader"|"nfc" payment methods | 0 hits | Invariant |
| T-42 | I-30 — availableAt filter present in J-C1 | grep J-C1 ticket picker for `availableAt !== "door"` filter | Present | Invariant |
| T-43 | I-30 — availableAt filter present in J-D3 | grep J-D3 tier picker for `availableAt !== "online"` filter | Present | Invariant |
| T-44 | I-30 — AddCompGuestSheet filter | grep AddCompGuestSheet for `availableAt === "both"` filter | Present | Invariant |
| T-45 | Const #1 No dead taps | tap every button on door surfaces | Every tap responds | Const |
| T-46 | TRANSITIONAL labels grep | scan headers + comments | scanStore + scannerInvitationsStore + canAcceptPayments + doorSalesStore + DoorSaleNewSheet banner all present | Const #7 |
| T-47 | Multi-line cart total accuracy | qty=2 @ £20 + qty=3 @ £15 = £85 | Cart shows £85 | Math |
| T-48 | Free door tier (price=0) | Sell free comp tier at door | Records with totalGbpAtSale=0; auto-check-in fires | Edge case |
| T-49 | Notes field 500 char limit | type 600 chars | Truncates to 500 (UI maxLength) | Validation |
| T-50 | parseGuestId for door | composite "door-ds_xxx" | Returns { kind: "door", innerId: "ds_xxx" } | Util |

---

## 8 — Invariants

### 8.1 Existing invariants this cycle preserves

| ID | Statement | How preserved | Test |
|----|-----------|---------------|------|
| **I-19** | Immutable order financials | Door sales are SEPARATE store (orderStore untouched). DoorSaleLine has FROZEN snapshot pattern mirroring OrderLineRecord. | T-36 + code review |
| **I-21** | Anon-tolerant buyer routes | Door routes are operator-side (`/event/{id}/door/...`); never anon | T-39 |
| **I-25** | Comp guests in useGuestStore ONLY | Door sales are NOT comps; live in useDoorSalesStore | T-36 + code review |
| **I-26** | privateGuestList no buyer surface | Unchanged | (no Cycle 12 touchpoint) |
| **I-27** | Single successful scan per ticketId | Door auto-check-in fires success ONCE per door ticket; refund doesn't write a void per OBS-1 | T-12 + code review |
| **I-28** | UI-only invitation flow until B-cycle | canAcceptPayments toggle FLIP is permission-shape change, not flow change. Scanner backend still B-cycle. | T-28 |
| **Const #1** | No dead taps | Every button responds | T-45 |
| **Const #2** | One owner per truth | useDoorSalesStore = sole door sale authority | T-36 |
| **Const #6** | Logout clears | reset() in clearAllStores | T-33 |
| **Const #7** | Label temporary | TRANSITIONAL markers + EXIT conditions documented | T-46 |
| **Const #8** | Subtract before adding | Reuse CartLine from Cycle 8; reuse activity feed event_scan kind from Cycle 11 (no new ActivityEvent kind) | code review |
| **Const #9** | No fabricated data | Stores empty at launch | T-36 |
| **Const #10** | Currency-aware UI | currency: "GBP" frozen on every sale | code review |
| **Const #14** | Persisted-state startup | Zustand persist v1 hydrates cleanly | T-34 |

### 8.2 NEW invariants this cycle establishes

#### I-29 — Door sales NEVER fabricated as phantom OrderRecord rows

**Statement:** Door sales live in `useDoorSalesStore.entries` ONLY. NEVER as phantom `OrderRecord` rows in `useOrderStore`. The `CheckoutPaymentMethod` union extension adds `"cash" | "card_reader" | "nfc" | "manual"` values, but online checkout flow (`app/checkout/[eventId]/payment.tsx`) MUST filter to `"card" | "apple_pay" | "google_pay" | "free"` ONLY when constructing OrderResult — door payment methods MUST NEVER appear in buyer flow.

**Origin:** Cycle 12 (2026-05-03)
**Enforcement (Cycle 12):** Convention + grep test (T-41)
**Reason:** Mirrors I-25 (comp guests in useGuestStore only) — same architectural rule for a different surface. I-19 (immutable order financials) requires write-once snapshot fields on OrderRecord; door sales have parallel write-once snapshot fields on DoorSaleRecord. Calling them orders is a category error that would cascade into checkout-flow type checks that don't make sense for in-person walk-ups.

#### I-30 — Door-tier vs online-tier separation enforced via `availableAt`

**Statement:** `TicketStub.availableAt: "online" | "door" | "both"` is the source of truth for which surface a tier appears on. Online checkout (Cycle 8) MUST filter `availableAt !== "door"` — surfaces only `"online"` + `"both"`. Door sale flow (Cycle 12 J-D3) MUST filter `availableAt !== "online"` — surfaces only `"door"` + `"both"`. `AddCompGuestSheet` (Cycle 10) MUST filter `availableAt === "both"` ONLY — comps stay tied to `"both"` tiers; door-only tiers DO NOT surface for comps (use case is unclear; deferred).

**Origin:** Cycle 12 (2026-05-03)
**Enforcement (Cycle 12):** Convention + 3 grep tests (T-42, T-43, T-44)
**Reason:** Operators want pricing flexibility — charge £25 advance / £30 at door is a common pattern. Without enforcement, an operator could accidentally make door-only tiers show up online (and vice versa), creating customer confusion + revenue loss.

**Implementor pre-flight:** confirm next-available invariant numbers in `Mingla_Artifacts/INVARIANT_REGISTRY.md` before locking I-29 + I-30 IDs. Cycle 11 used I-27 + I-28 (verified live in registry); ORCH-0700 Phase 2 may consume future I-IDs in flight. If I-29 + I-30 are taken at write time, bump to next free + document final IDs in implementation report.

---

## 9 — Implementation order

Numbered sequence. Implementor follows exactly; verify between major milestones.

1. **Type extensions:**
   - `TicketStub.availableAt` field added to `draftEventStore.ts` + persist v5→v6 migrate
   - `LiveEvent.inPersonPaymentsEnabled` + `DraftEvent.inPersonPaymentsEnabled` fields
   - `LiveEventEditableFieldKey` union gains `"inPersonPaymentsEnabled"`
   - `CheckoutPaymentMethod` union extended with 4 door values
   - tsc clean checkpoint
2. **NEW utility:** `src/utils/expandDoorTickets.ts` per §4.4
3. **NEW store:** `src/store/doorSalesStore.ts` per §4.5
4. **Logout cascade:** `src/utils/clearAllStores.ts` adds useDoorSalesStore.reset
5. **`/ui-ux-pro-max` pre-flight** for J-D3 DoorSaleNewSheet + J-D2 list view + J-D5 reconciliation (memory rule mandate)
6. **liveEventConverter + liveEventAdapter + ChangeSummaryModal:** propagate new fields per §4.7
7. **Cycle 8 surface modification:** `app/checkout/[eventId]/index.tsx` adds `availableAt !== "door"` filter
8. **AddCompGuestSheet (Cycle 10) modification:** add `availableAt === "both"` filter
9. **Cycle 11 InviteScannerSheet flip:** Pressable toggle + state + pass user selection
10. **Step 5 Tickets (CreatorStep5Tickets) modification:** per-tier 3-state availableAt picker
11. **Step 6 Settings (CreatorStep6Settings) modification:** inPersonPaymentsEnabled ToggleRow
12. **EditPublishedScreen modification:** same 2 controls as Step 5/6 above
13. **DoorSaleNewSheet** component (most complex single component — multi-line cart + 4 payment methods + buyer details + auto-check-in fire)
14. **DoorSaleDetail** component
15. **DoorRefundSheet** component
16. **NEW route:** `app/event/[id]/door/index.tsx` (J-D2 list + J-D5 inline reconciliation)
17. **NEW route:** `app/event/[id]/door/[saleId].tsx` (J-D4 detail)
18. **Event Detail (J-D1) modification:** new ActionTile + handler + KPI subtext
19. **Cycle 10 J-G1 + J-G2 extension:** GuestRow union + parseGuestId + search predicate + GuestRowCard door branch + J-G2 detail door branch
20. **CSV export extension:** `src/utils/guestCsvExport.ts` includes door sales
21. **Verification matrix:**
    - `cd mingla-business && npx tsc --noEmit` (filtered)
    - Manual smoke T-01..T-50
    - Grep checks per SC-31, SC-32 + T-37..T-44
22. **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md` per `references/report-template.md` 15-section template

---

## 10 — Forward backend handoff (B-cycle requirements)

Cycle 12 ships UI-complete; B-cycle ships functional. The B-cycle dispatch must include:

### 10.1 Door sale backend write path

- New edge function: `supabase/functions/record-door-sale/index.ts`
  - Accepts: `{ eventId, brandId, paymentMethod, lines[], buyer, notes }` from authenticated operator/scanner
  - Validates: scanner has `canAcceptPayments` permission (or is brand admin); operator owns event's brand
  - Writes single row to `door_sales_ledger` table
  - For card_reader / nfc payment methods: hand off to Stripe Terminal SDK before writing the row (capture intent → confirm → write ledger row with `payment_method=card_reader` + amount_cents)
  - For cash / manual: write ledger row directly with no Stripe call
  - Returns: `{ saleId, recordedAt }` for client mirror

### 10.2 Stripe Terminal SDK integration (card_reader)

- Operator must pair a physical card reader (Stripe BBPOS, Verifone P400, etc.) via the Stripe Terminal mobile SDK
- Terminal connection state managed in a new `useStripeTerminalContext` (lifecycle longer than a single sale)
- DoorSaleNewSheet's Card Reader payment method becomes enabled when terminal is connected
- Payment intent capture → confirm flow integrated; success → record-door-sale edge function
- Failure → retry / fallback to cash UX

### 10.3 NFC tap-to-pay (nfc)

- iOS: Apple's Tap to Pay on iPhone (US-only as of late-2025; UK rollout pending)
- Android: Stripe Terminal SDK + NFC capability negotiation
- Same flow as card_reader but uses platform NFC instead of paired terminal

### 10.4 Refund backend wire

- Edge function: `supabase/functions/refund-door-sale/index.ts`
  - Accepts: `{ saleId, amountGbp, reason, lines[] }`
  - For card_reader / nfc: invoke Stripe refund API
  - For cash / manual: write refund record (no API call; operator manually refunds the cash)
  - Returns updated sale state

### 10.5 Sync architecture for offline queue

- When client comes online, batch-replay `useDoorSalesStore.entries.filter(s => s.offlineQueued === true)` to `record-door-sale` (one call per sale, OR new bulk endpoint)
- Per-sale conflict resolution if backend already has the sale
- After successful sync, flip `offlineQueued: false`
- (Decision needed for B-cycle: does Cycle 12's `useDoorSalesStore` already have an `offlineQueued` field? Recommend YES — add now for forward-compat)

### 10.6 Scanner identity resolution

When scanner team functional flow ships (B-cycle), `useDoorSalesStore.recordSale.recordedBy` becomes the scanner's actual `auth.users.id` instead of always the operator's. Reconciliation report's "by-scanner" view naturally shows multi-row breakdowns. No Cycle 12 code change needed at that point — data shape supports it from day 1.

### 10.7 Migration cutover plan

- B-cycle migration moves `useDoorSalesStore.entries` → backend `door_sales_ledger` rows
- Cycle 12 client store contracts to a read-through cache (or removes entirely if backend is sole authority)
- API surface (`recordSale`, `recordRefund`, `getSaleById`, etc.) preserved across cutover — only the underlying source changes

---

## 11 — Regression prevention

| Risk | Structural safeguard | Test |
|------|----------------------|------|
| Door-only tier surfaces in online checkout | I-30 enforcement in J-C1 picker | T-29 + T-42 |
| Online-only tier surfaces in door sale flow | I-30 enforcement in J-D3 picker | T-43 |
| Door-only tier surfaces in comp guest sheet | I-30 enforcement in AddCompGuestSheet | T-30 + T-44 |
| Door sale fabricated as phantom OrderRecord | I-29 enforcement (CheckoutPaymentMethod union filter in buyer route) | T-41 |
| Door buyer missing from guest list | J-G1 includes `kind: "door"` rows | T-14 |
| Auto-check-in race / orphan scans | recordSale-then-scan order; scan only fires after sale return value (HIDDEN-1 fix) | T-12 |
| Refund undoes check-in (would violate OBS-1) | DoorRefundSheet handler MUST NOT call useScanStore | T-40 |
| canAcceptPayments toggle re-disabled in future cycle | comment update + I-28 preservation | code review |
| Payment method picker accidentally enables card_reader / nfc | TRANSITIONAL state hardcoded in picker | T-10 |
| Persist v5 cold-start fails to migrate availableAt | Migrate function defaults `"both"` | T-31 |
| inPersonPaymentsEnabled toggle missing on existing live events | Default false; explicit operator opt-in | T-32 |
| Door sale list selector returns fresh array directly subscribed | Raw `entries` + useMemo pattern enforced | T-38 |

**Protective comments required in code:**
- `doorSalesStore.ts` header: I-29 + I-30 + OBS-1 statements verbatim
- `DoorRefundSheet.tsx` `handleConfirm` body: `// OBS-1 lock: refund affects MONEY only, NOT check-in. NO useScanStore touch. I-19 spirit.`
- `app/checkout/[eventId]/index.tsx` ticket picker filter: `// Cycle 12 I-30 — door-only tiers excluded from online checkout. SUBTRACT before adding pattern: this filter MUST stay in place forever.`
- `InviteScannerSheet.tsx` canAcceptPayments toggle: `// Cycle 12 — semantics = cash + manual today; card + NFC TRANSITIONAL until B-cycle Stripe Terminal SDK.`

---

## 12 — Cross-references

- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md`](../reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md)
- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md)
- BUSINESS_PRD §7 In-Person Payments + §14 MVP Foundations Cut
- Cycle 11 SPEC + IMPL v2 (architectural pattern reference): [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](./SPEC_BIZ_CYCLE_11_QR_SCANNER.md) + [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 10 SPEC (J-G1/J-G2 extension target): [`specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](./SPEC_BIZ_CYCLE_10_GUEST_LIST.md)
- Cycle 9c orderStore + RefundSheet (pattern reference): commit `12dcce02`
- Cycle 8 checkout (CartLine + CartContext source): commit `6d426755` + `mingla-business/src/components/checkout/CartContext.tsx`
- ORCH-0706 close (door_sales_ledger CHECK constraint live): [`reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md)
- INVARIANT_REGISTRY (I-19/21/25/26/27/28 + I-29/30 NEW): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
- `door_sales_ledger` schema: [`supabase/migrations/20260502100000_b1_business_schema_rls.sql:1730-1750`](../../supabase/migrations/20260502100000_b1_business_schema_rls.sql) + ORCH-0706 SF-5 CHECK constraint
- Memory rules referenced: `feedback_keyboard_never_blocks_input`, `feedback_rn_color_formats`, `feedback_implementor_uses_ui_ux_pro_max`, `feedback_anon_buyer_routes`, `feedback_orchestrator_never_executes`, `feedback_no_coauthored_by`, `feedback_post_pass_protocol`, `feedback_no_summary_paragraph`

---

## 13 — Output contract for the implementor

Implementor produces TWO things:

1. **Code changes** per §9 implementation order
2. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`

The report MUST include (per Mingla implementor skill 15-section template):

- Old → New receipts for every file modified or created (~22 files expected)
- SC-1..SC-32 verification matrix with PASS / UNVERIFIED labels per SC
- T-01..T-50 outcomes
- Invariant registrations: confirmed final I-29 / I-30 IDs in `INVARIANT_REGISTRY.md`
- Memory rule deference proof: `/ui-ux-pro-max` invoked pre-flight on J-D3 + J-D5 with applied guidance
- Constitutional compliance scan (14 principles)
- Cache safety: confirm new selector pattern grep-clean + persist v5→v6 migrate clean
- Regression surface: 4-5 adjacent features tester should spot-check (Cycle 8 J-C1 picker, Cycle 10 J-G1+J-G2, Cycle 11 InviteScannerSheet, Cycle 9c-2 activity feed, AddCompGuestSheet)
- Discoveries for orchestrator (any new side issues)
- Transition items (`[TRANSITIONAL]` comments + EXIT CONDITIONs)
- Files touched matrix (path + action + LOC delta)
- Verification commands run + outputs

Implementor MUST NOT:
- Re-debate any locked decision from §2
- Add scope beyond §3.1
- Touch backend / RLS / edge functions
- Skip the `/ui-ux-pro-max` pre-flight on J-D3 + J-D5
- Build a real Stripe Terminal SDK integration (TRANSITIONAL stub only)
- Build a real NFC tap-to-pay integration (TRANSITIONAL stub only)
- Wire scan store to door refund flow (OBS-1 lock)
- Silently override an invariant — surface to operator if conflict arises

If the spec is wrong or contradicts what the implementor finds in code: STOP. State the contradiction. Wait for direction.
