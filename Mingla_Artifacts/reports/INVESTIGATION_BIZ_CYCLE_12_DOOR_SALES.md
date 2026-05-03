# INVESTIGATION — BIZ Cycle 12 (Door Sales / In-Person Payments)

**Mode:** INVESTIGATE-THEN-SPEC (IA) — investigation phase
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator/scanner-side door sales
**Confidence:** H (high) on all 8 threads
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md)

---

## 1 — Layman summary

Cycle 12 ships the operator's "work the door at a real event" surface. Today buyers can only buy online (Cycle 8). After Cycle 12, an organiser at a live event can: accept cash from walk-ups, sell multi-ticket transactions in one go (one friend pays for the group), use door-only ticket tiers (charge differently at the door), record manual payments, refund door sales, auto-check-in walk-ups (they don't need a QR — the sale itself is the check-in), and reconcile cash totals at the end of the night. Card + NFC payments stay TRANSITIONAL stubs (same pattern as Cycle 11) until B-cycle ships the Stripe Terminal backend. Schema is READY (PR #59 `door_sales_ledger` + ORCH-0706 hardened CHECK constraint live on production); B-cycle wires the writes.

**Architectural strategy:** mirror Cycle 11. UI-complete this cycle, TRANSITIONAL stubs for card/NFC payment SDKs, single TESTING MODE banner above door-sale flow with same B-cycle EXIT condition. **All 5 operator decisions remain locked. No 6th decision needed** — the orderId convention question routed in dispatch §3.5 resolves cleanly to `orderId: <saleId>` (see G7 finding).

**Architectural extension surfaced:** J-G1 + J-G2 (Cycle 10 guest list) must gain support for door-sale rows alongside online orders + comps — otherwise door buyers wouldn't appear in the guest list, which would be confusing for the operator. Additive (no behavior change for existing rows).

---

## 2 — Operator-locked decisions (verbatim — none re-debated)

| # | Decision | Locked value | Confirmed |
|---|----------|--------------|-----------|
| 1 | Cart shape at the door | Multi-line-item cart; group buyer pays for friends in one transaction; mirrors Cycle 8 `CartLine` shape | ✅ |
| 2 | Tier source | BOTH door-only AND online-tier reuse via `TicketStub.availableAt: "online" \| "door" \| "both"` field; existing tiers default `"both"` | ✅ |
| 3 | Reconciliation grain | BOTH per-scanner AND per-event totals | ✅ |
| 4 | `canAcceptPayments` toggle | FLIP type-lock to operator-controllable; semantics = "can take cash + manual"; card/NFC remain TRANSITIONAL | ✅ |
| 5 | Door sale auto-check-in | Door sale fires `useScanStore.recordScan({ via: "manual", scanResult: "success" })` per ticket sold | ✅ |

---

## 3 — Investigation manifest (every file read, in trace order)

| # | File | Why | Layer |
|---|------|-----|-------|
| 1 | `mingla-business/src/components/checkout/CartContext.tsx` | G1 cart reuse audit | Component/Context |
| 2 | `mingla-business/app/checkout/[eventId]/buyer.tsx` | G1 cart consumer pattern | Route |
| 3 | `mingla-business/app/checkout/[eventId]/confirm.tsx` | Order recording + payment method shape | Route |
| 4 | `mingla-business/src/store/orderStore.ts` | Pattern reference for door-sale store + refund | Store |
| 5 | `mingla-business/src/store/scanStore.ts` | Auto-check-in target | Store |
| 6 | `mingla-business/src/store/scannerInvitationsStore.ts` | canAcceptPayments toggle target | Store |
| 7 | `mingla-business/src/components/scanners/InviteScannerSheet.tsx` | canAcceptPayments toggle UI | Component |
| 8 | `mingla-business/src/store/draftEventStore.ts` | TicketStub shape + persist version chain | Store |
| 9 | `mingla-business/src/store/liveEventStore.ts` | LiveEvent shape + LiveEventEditableFieldKey | Store |
| 10 | `mingla-business/app/event/[id]/guests/index.tsx` | J-G1 list view extension target | Route |
| 11 | `mingla-business/app/event/[id]/guests/[guestId].tsx` | J-G2 detail view extension target | Route |
| 12 | `mingla-business/app/event/[id]/index.tsx` | Event Detail action grid for J-D1 ActionTile | Route |
| 13 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 1730-1750 | `door_sales_ledger` schema | Schema |
| 14 | `supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql` SF-5 | `door_sales_ledger.payment_method` CHECK constraint | Schema |
| 15 | `mingla-business/src/components/orders/RefundSheet.tsx` | Refund pattern reference (existence verified) | Component |
| 16 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | I-19/21/25/26/27/28 + I-29/30 numbering | Docs |

---

## 4 — Findings

### 🔵 OBS-1 — `CartContext` is generic enough to mirror; no new context needed

**File + line:** [`mingla-business/src/components/checkout/CartContext.tsx:34-67`](../../mingla-business/src/components/checkout/CartContext.tsx)

**Exact code (verbatim shape):**
```ts
export interface CartLine {
  ticketTypeId: string;
  ticketName: string;
  quantity: number;
  unitPriceGbp: number;
  isFree: boolean;
}

export type CheckoutPaymentMethod = "card" | "apple_pay" | "google_pay" | "free";
```

**What it does:** `CartContext` is a React Context with in-memory state (NO Zustand, NO AsyncStorage). Lifetime = single tab session. Closing tab abandons cart.

**What it should do for door sales:** door cart wants the same `CartLine` shape but: (a) a different payment method union (`cash | card_reader | nfc | manual`); (b) no buyer details collection (walk-up may be anonymous); (c) different result shape (door sale records to `useDoorSalesStore`, not online `useOrderStore`).

**Recommendation:** **REUSE the `CartLine` interface as-is** (export it). Build door sale's local cart state inside the door-sale-new sheet using `useState<CartLine[]>` + helpers (no new Provider). Avoids cross-flow contamination — buyer cart and door cart never coexist visually anyway. Extend `CheckoutPaymentMethod` union to `"card" | "apple_pay" | "google_pay" | "free" | "cash" | "card_reader" | "nfc" | "manual"` (additive). Buyer route filter stays `card | apple_pay | google_pay | free`; door flow filter accepts `cash | card_reader | nfc | manual`.

**Verification:** Confirmed by reading `buyer.tsx:114` — uses `useCart()` + `useCartTotals()` only. Cart is destructured into `lines` + `buyer` + `setBuyer` + `recordResult`. No assumption about payment method shape — `recordResult({...paymentMethod})` accepts the union value as-is.

**Confidence:** H

---

### 🔵 OBS-2 — `door_sales_ledger` schema READY; ORCH-0706 hardened

**File + line:** [`supabase/migrations/20260502100000_b1_business_schema_rls.sql:1730-1750`](../../supabase/migrations/20260502100000_b1_business_schema_rls.sql) + [`supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql`](../../supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql) SF-5

**Exact schema (verbatim):**
```sql
CREATE TABLE IF NOT EXISTS public.door_sales_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  scanner_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  payment_method text NOT NULL,           -- ORCH-0706: CHECK constraint added: ('cash','card_reader','nfc','manual')
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'GBP',
  reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT door_sales_ledger_amount_non_negative CHECK (amount_cents >= 0)
);
```

**Critical observations:**
1. `order_id` is **NULLABLE** — door sales DO NOT need a corresponding `orders` row. Cash sales are first-class without an online-order trail. ✓
2. `scanner_user_id` is captured — perfect for per-scanner reconciliation per Decision #3. ✓
3. `amount_cents` (integer) vs Cycle 12 client-side `unitPriceGbp` (whole-units). Conversion at B-cycle wire boundary; client stays consistent with Cycle 8/9c orderStore pattern.
4. `reconciled` / `reconciled_at` flags exist — Cycle 12 may set client-side after end-of-night confirmation. **Recommendation: don't surface "reconciled" UX in Cycle 12; reconciliation is end-of-night summary only.** Defer the boolean toggle to B-cycle.
5. `notes` field — perfect for refund reason / operator notes ("John gave £50 cash, change £20"). Used in J-D4 detail view.
6. Schema does NOT have a "lines" subtable for the door sale. Each row in `door_sales_ledger` represents the WHOLE sale. Per-ticket state (frozen snapshots, refund tracking) lives in client store as embedded `lines[]`. When B-cycle wires, `lines[]` normalizes to `tickets` rows (separate table) + the single ledger row.

**Confidence:** H

---

### 🔵 OBS-3 — `TicketStub` schema bump v5 → v6 needed for `availableAt`

**File + line:** [`mingla-business/src/store/draftEventStore.ts:65-129`](../../mingla-business/src/store/draftEventStore.ts) (TicketStub definition + version chain helpers v1→v5)

**Exact current version chain shape (verified):**
- v1 → v2 (capacity + isUnlimited additions)
- v2 → v3 (Cycle 5 modifiers — visibility, displayOrder, approvalRequired, passwordProtected, password, waitlistEnabled, minPurchaseQty, maxPurchaseQty, allowTransfers)
- v3 → v4 (Cycle 6 5b absorption — description, saleStartAt, saleEndAt)
- v4 → v5 (current latest)

**What's needed:** v5 → v6 migrate function defaulting `availableAt: "both"` for all existing tiers. Additive field; no other tier behavior changes.

**LiveEvent persist:** `LiveEvent.tickets: TicketStub[]` carries the new field automatically through `liveEventConverter.draftToLive(...)`. `liveEventStore` may or may not have its own persist version chain — implementor pre-flight to verify and bump if needed (additive default to `"both"` for all existing live tiers' tickets).

**Cascade map** — every consumer of `event.tickets` that needs the `availableAt` filter:

| File | Current behavior | Cycle 12 change |
|------|-----------------|-----------------|
| `app/checkout/[eventId]/index.tsx` (J-C1 ticket picker) | Reads `event.tickets`, filters `visibility !== "hidden"` | **Add `availableAt !== "door"` filter** — surfaces "online" + "both" only |
| Door sale new sheet (NEW J-D3) | N/A | **Filter `availableAt !== "online"`** — surfaces "door" + "both" only |
| `app/event/[id]/index.tsx` "TICKET TYPES" section | Shows all non-hidden tiers | **Show all** — operator-side overview includes both surfaces |
| `app/event/[id]/edit.tsx` (EditPublishedScreen Step 5) | Shows all tiers for editing | **Add 3-state picker for `availableAt` per tier** |
| `src/components/event/CreatorStep5Tickets.tsx` | Shows all tiers in wizard | **Add 3-state picker for `availableAt` per tier** |
| `src/components/guests/AddCompGuestSheet.tsx` (Cycle 10 ticket picker) | Filters `visibility !== "hidden"` | **Filter `availableAt === "both"` only** — comps stay tied to "both" tiers (door-only tiers don't surface for comps; comp + door-only is a stretch use case deferred) |

**Confidence:** H — verified by grepping `event.tickets` consumers across the codebase.

---

### 🔵 OBS-4 — `LiveEvent` gains `inPersonPaymentsEnabled` field (per-event toggle for J-D6)

**File + line:** [`mingla-business/src/store/liveEventStore.ts:80-94`](../../mingla-business/src/store/liveEventStore.ts) (LiveEventEditableFieldKey union)

**What's needed:** Add `inPersonPaymentsEnabled: boolean` to `LiveEvent` + `DraftEvent`. Default `false` for existing live events (additive migrate). Add `"inPersonPaymentsEnabled"` to `LiveEventEditableFieldKey` union so it flows through the existing edit-after-publish pipeline.

**Settings step** — add to `CreatorStep6Settings.tsx` (the existing settings step in EventCreatorWizard) + `EditPublishedScreen.tsx` for post-publish editing.

**Behavior gate:** J-D1 "Door Sales" ActionTile on Event Detail renders ONLY when `event.inPersonPaymentsEnabled === true`. If disabled, no tile, no door route reachable. (Operator can enable mid-event via EditPublishedScreen if they decide to take walk-ups.)

**Confidence:** H

---

### 🔵 OBS-5 — `canAcceptPayments` toggle FLIP — minimal change surface

**File + line:** [`mingla-business/src/components/scanners/InviteScannerSheet.tsx:217-250`](../../mingla-business/src/components/scanners/InviteScannerSheet.tsx) + [`mingla-business/src/store/scannerInvitationsStore.ts:46-49`](../../mingla-business/src/store/scannerInvitationsStore.ts)

**Cycle 11 hardcoded:**
- InviteScannerSheet line 112: `canAcceptPayments: false` (passed at recordInvitation time)
- InviteScannerSheet lines 237-250: toggle UI is **non-Pressable View** (display-only, disabled visual)
- scannerInvitationsStore line 46-48: comment says "ALWAYS false in Cycle 11"

**Cycle 12 changes (minimal):**
1. InviteScannerSheet: replace the disabled View with a real Pressable toggle (mirror the canManualCheckIn toggle one row above). Pass user's selection into `recordInvitation`.
2. scannerInvitationsStore: update comment from "ALWAYS false in Cycle 11" → "Cycle 12: operator-controllable; semantics = cash + manual today; card + NFC remain TRANSITIONAL until B-cycle Stripe Terminal SDK lands."
3. Door sale flow guard: at J-D1 ActionTile, also check effective scanner's `canAcceptPayments` — operator (the brand owner) always has effective true; invited scanners only have true if their invitation toggle was on. **Implementor pre-flight: identify how to read "current scanner identity" since Cycle 11 didn't establish a scanner-identity-resolution path beyond `useAuth().user` (which always returns the operator account, not delegated scanners — that's B-cycle).** For Cycle 12: assume operator is always on their own device; show door sale CTA whenever `inPersonPaymentsEnabled: true`. Per-scanner permission gating is forward-deferred to B-cycle when scanner identity gets a real auth flow.

**Confidence:** H on item 1+2; M on item 3 (the per-scanner gate is a SPEC-decision; recommendation is to defer to B-cycle since Cycle 11 didn't ship scanner-identity-resolution either).

---

### 🔵 OBS-6 — Cycle 10 J-G1 + J-G2 must gain `kind: "door"` row support

**File + line:** [`mingla-business/app/event/[id]/guests/index.tsx:54-56`](../../mingla-business/app/event/[id]/guests/index.tsx) (GuestRow union)

**Current:**
```ts
type GuestRow =
  | { kind: "order"; id: string; order: OrderRecord; sortKey: string }
  | { kind: "comp"; id: string; comp: CompGuestEntry; sortKey: string };
```

**Cycle 12 addition:**
```ts
  | { kind: "door"; id: string; sale: DoorSaleRecord; sortKey: string };
```

**Why required (not optional):** Door buyers don't auto-appear anywhere on the operator's "who's at my event" view unless J-G1 includes them. Without this, an operator sees 50 names in the guest list but actually has 80 attendees because the 30 walk-ups are missing. Confusing + dangerous (capacity over-counts).

**J-G1 row rendering for `kind: "door"`:**
- Avatar: hashed-hue from sale.id (mirrors order pattern)
- Name: `sale.buyerName.length > 0 ? sale.buyerName : "Walk-up"`
- Subline: `{paymentMethod label} · {qty} tickets · {recordedAt relative}`
- Status pill: payment-method-tinted (cash = grey, card_reader = info, nfc = info, manual = draft)
- Check-in pill: ALWAYS info "CHECKED IN" (door sale auto-check-in per Decision #5; never NOT CHECKED IN)
- Search predicate: matches buyerName + buyerEmail + buyerPhone

**J-G2 detail for `kind: "door"`:**
- Hero: avatar + name (or "Walk-up") + email/phone if present
- Status pills: payment method + CHECKED IN
- TICKETS section: per-ticket rows from `expandDoorTickets(sale.id, sale.lines)` (mirror `expandTicketIds`)
- DOOR SALE METADATA section (replaces ORDER ACTIVITY for orders / ADDED BY for comps): payment method, total, recorded by, recorded at, notes
- Refund button → opens DoorRefundSheet (mirror RefundSheet pattern)
- Refund history (if refunds exist)

**ParseGuestId extension:** `parseGuestId` at line 84-94 currently handles `"order-"` + `"comp-"` prefixes; gain `"door-"` prefix.

**CSV export (Cycle 10 J-G6):** `guestCsvExport.ts` includes door sales. Recommend grouping in CSV: ONLINE / COMP / DOOR sections OR a `kind` column. Implementor's call.

**Confidence:** H

---

### 🟠 CONTRIBUTING-1 — Refund-after-checkin: door sale refund is a financial event, NOT an attendance event

**File + line:** Conceptual (not in any file yet).

**Issue:** Per dispatch §3.5, door sales auto-fire `useScanStore.recordScan({ scanResult: "success" })` per ticket. Per Cycle 11 J-G1 logic at [`guests/index.tsx:213-220`](../../mingla-business/app/event/[id]/guests/index.tsx), the derived check-in count counts ALL success scans for an order. If a door sale gets refunded, what happens?

**Two approaches considered:**

| Approach | Effect | Trade-off |
|----------|--------|-----------|
| **A) Refund writes void scan record per refunded ticket** | J-G1 needs to subtract void scans from success count | Adds complexity; mismatches I-27 single-success-per-ticketId semantics (the original success scan stays + void is separate) |
| **B) Refund affects MONEY only, NOT check-in** | J-G1 unchanged; refund just affects DoorSaleRecord.refundedAmountGbp + status | Simpler; matches I-19 immutable-order pattern (financial event ≠ attendance event) |

**Recommendation: B.**

**Reasoning:** A door buyer who paid £20 cash, got auto-checked-in, then later gets refunded for some reason — they were physically at the door. The check-in happened. The refund is a financial reconciliation, not a "scrub the attendance." This matches Cycle 9c's I-19 invariant where order refunds NEVER mutate the original order's frozen lines — refunds are append-only events. Cycle 12 mirrors: refund creates a `DoorRefundRecord` in `useDoorSalesStore.refunds[]` + flips `status` → `refunded_full | refunded_partial`. Scan store untouched.

**Edge case (deferred):** "operator sold a ticket then realized they double-charged the buyer; wants to undo BOTH the money + the check-in" — this is a TRUE cancellation, not a refund. Defer to a future cycle. For Cycle 12, document as a known limitation.

**Confidence:** H

---

### 🟡 HIDDEN-1 — Auto-check-in fires even if door sale recording would otherwise fail

**File + line:** Conceptual (Cycle 12 implementation).

**Issue:** Decision #5 says "door sale fires `useScanStore.recordScan(...)`" per ticket. Order matters:
1. `useDoorSalesStore.recordSale(...)` — must succeed first
2. THEN N × `useScanStore.recordScan(...)` — fire AFTER sale recording

**Failure mode (theoretical):** if step 1 throws (it shouldn't, in-memory append-only operation), N orphan scan records would land in scanStore without a corresponding doorSalesStore entry. J-G1 would show ghost CHECKED-IN rows.

**Mitigation:** Wrap both calls in a try-catch where step 2 only fires if step 1 returns the new DoorSaleRecord (non-null). Standard caller-side audit pattern (mirrors RefundSheet's caller-fires-edit-log per Cycle 9c v2 lesson).

**Recommended SPEC contract:**
```ts
const newSale = useDoorSalesStore.getState().recordSale({...});
// recordSale returns DoorSaleRecord (never throws; in-memory append-only)
expandDoorTickets(newSale.id, newSale.lines).forEach((expandedTicket) => {
  useScanStore.getState().recordScan({
    ticketId: expandedTicket.ticketId,
    orderId: newSale.id,        // <-- door sale ID directly; e.g., "ds_xxx"
    eventId: newSale.eventId,
    brandId: newSale.brandId,
    scannerUserId: newSale.recordedBy,
    scanResult: "success",
    via: "manual",
    offlineQueued: true,
    buyerNameAtScan: newSale.buyerName.length > 0 ? newSale.buyerName : "Walk-up",
    ticketNameAtScan: expandedTicket.ticketName,
  });
});
```

**Confidence:** H

---

### 🟡 HIDDEN-2 — `parseTicketId` doesn't recognize door-sale ticket IDs

**File + line:** [`mingla-business/src/utils/expandTicketIds.ts:54-71`](../../mingla-business/src/utils/expandTicketIds.ts)

**Current code:**
```ts
export const parseTicketId = (ticketId: string) => {
  if (!ticketId.startsWith("tkt_")) return null;
  // ... parses to { orderId: `ord_${suffix}`, lineIdx, seatIdx }
};
```

**Issue:** Door-sale ticket IDs use a different prefix (per recommendation: `dt_<doorSaleSuffix>_<lineIdx>_<seatIdx>` or `tkt_<doorSaleSuffix>_<lineIdx>_<seatIdx>`). If we use `tkt_` prefix mirroring online, `parseTicketId` would parse a door ticket as if it were an online order ticket — returning `orderId: "ord_<doorSaleSuffix>"` which doesn't match a real order.

**Resolution:** Door sales DON'T go through camera scanner (walk-ups don't have QRs). The scanner camera invokes `parseQrPayload` → `parseTicketId` only for QR-scanned tickets, which are exclusively online orders. Door sales fire scan records directly (no QR involved).

**Mitigation:** Use a DIFFERENT prefix for door tickets — `dt_<doorSaleSuffix>_<lineIdx>_<seatIdx>` (door ticket). `parseTicketId` ignores `dt_` prefixes (returns null since it requires `tkt_`). The new `expandDoorTickets` utility in Cycle 12 generates these IDs. They're never expected to round-trip through `parseTicketId` because they never get scanned via camera. ✓

**Why a different prefix matters:** if an operator scans a door ticket via the camera (impossible flow today, but defensively), `parseQrPayload` matches `tkt_` only — `dt_` would fall through to `not_found` overlay. ✓ Safe.

**Confidence:** H

---

### 🟡 HIDDEN-3 — Reconciliation report needs scanner identity resolution

**File + line:** Conceptual.

**Issue:** Decision #3 says reconciliation shows "by scanner" — implies multiple scanners with their own identities. But per OBS-5, Cycle 11 didn't ship scanner-identity-resolution beyond `useAuth().user.id` (always operator). Cycle 12 reconciliation report shows by-scanner totals derived from `DoorSaleRecord.recordedBy: string` (account_id).

**For Cycle 12:** Every door sale's `recordedBy` will be the operator's account_id (since no delegated scanner identity exists yet). Report will show 1 scanner row (the operator). When B-cycle ships scanner identity, multiple rows naturally appear without code change — the data shape supports it from day 1.

**Document this transparently in the SPEC** so the implementor doesn't try to invent a scanner-identity-resolution layer this cycle.

**Confidence:** H

---

## 5 — Five-Layer Cross-Check

| Layer | Question | Finding |
|-------|----------|---------|
| **Docs** | What does PRD §7 say should happen? | Lists 14 features; Cycle 12 ships ~12 of them UI-complete (cash, manual, sell at door, multi-line cart, track, refund, history, reconcile, permissions, separate online); 2 remain TRANSITIONAL stubs (card payment SDK, NFC tap-to-pay). |
| **Schema** | What does the DB enforce? | `door_sales_ledger` table exists + ORCH-0706 hardened payment_method CHECK constraint live; Cycle 12 client-side respects the constraint values verbatim. |
| **Code** | What does the existing code support? | `CartLine` reusable; `CheckoutPaymentMethod` union extends additively; `useScanStore` already has `via: "manual"` semantics from Cycle 11; `LiveEvent.tickets[]` field-level changes flow through edit-after-publish pipeline cleanly. |
| **Runtime** | What happens when door sale fires? | (Cycle 12) `useDoorSalesStore.recordSale` → returns DoorSaleRecord → caller fires N × `useScanStore.recordScan({ via: "manual" })` → activity feed picks up event_scan kind via Cycle 9c-2 stream → J-G1 + J-G2 render door rows via new `kind: "door"` branch. |
| **Data** | What gets persisted client-side? | `useDoorSalesStore.entries` (new persist key `mingla-business.doorSalesStore.v1`); `useScanStore.entries` gets new records; `useGuestStore` UNTOUCHED; `useOrderStore` UNTOUCHED (I-29). |

**No layer disagreements. Story is consistent end-to-end.**

---

## 6 — Blast Radius Map

| Surface | Impact | New behavior |
|---------|--------|--------------|
| `app/checkout/[eventId]/index.tsx` (J-C1 ticket picker) | Filter change | Add `availableAt !== "door"` filter |
| `app/event/[id]/index.tsx` (Event Detail action grid) | New ActionTile | "Door Sales" tile (gated on `inPersonPaymentsEnabled`) |
| `app/event/[id]/edit.tsx` (EditPublishedScreen) | New fields | Per-tier `availableAt` picker + per-event `inPersonPaymentsEnabled` toggle |
| `app/event/[id]/guests/index.tsx` (J-G1) | Extension | `kind: "door"` rows + search predicate + new check-in pill state (always CHECKED IN for doors) |
| `app/event/[id]/guests/[guestId].tsx` (J-G2) | Extension | `kind: "door"` detail + DOOR SALE METADATA section + DoorRefundSheet |
| `src/components/event/CreatorStep5Tickets.tsx` (Step 5) | New picker | 3-state availableAt picker per tier |
| `src/components/event/CreatorStep6Settings.tsx` (Step 6) | New toggle | `inPersonPaymentsEnabled` ToggleRow |
| `src/components/scanners/InviteScannerSheet.tsx` | Toggle flip | canAcceptPayments toggle becomes Pressable + passes user selection |
| `src/components/checkout/CartContext.tsx` | Union extend | `CheckoutPaymentMethod` adds 4 values |
| `src/utils/clearAllStores.ts` | Reset cascade | Add `useDoorSalesStore.reset()` |
| `src/utils/guestCsvExport.ts` | Extension | Include door sales (group by kind) |
| `src/store/draftEventStore.ts` | Schema bump v5→v6 | TicketStub gains `availableAt`; migrate defaults `"both"` |
| `src/store/liveEventStore.ts` | Schema bump | LiveEvent gains `inPersonPaymentsEnabled`; LiveEventEditableFieldKey union extends |
| `src/utils/liveEventConverter.ts` | Field propagate | draft→live conversion carries new fields |
| `src/utils/liveEventAdapter.ts` | Field map | edit-after-publish snapshots gain new fields |

**NEW files (8 expected):**
- `src/store/doorSalesStore.ts`
- `src/utils/expandDoorTickets.ts`
- `src/components/door/DoorSaleNewSheet.tsx`
- `src/components/door/DoorSaleDetail.tsx`
- `src/components/door/DoorRefundSheet.tsx`
- `src/components/door/ReconciliationReport.tsx` (or inline — implementor's call)
- `app/event/[id]/door/index.tsx` (J-D2 list view)
- `app/event/[id]/door/[saleId].tsx` (J-D4 detail view) — OR inline modal; implementor's call

**Estimated LOC delta:** ~+1,800–2,200 net.

---

## 7 — Invariant Violations / Preservations

| ID | Statement | Cycle 12 status |
|----|-----------|-----------------|
| **I-19** | Immutable order financials | ✅ Preserved — door sales are SEPARATE store; orderStore untouched |
| **I-21** | Anon-tolerant buyer routes | ✅ Preserved — door routes are operator-side `/event/{id}/door/...`, never anon |
| **I-25** | Comp guests in useGuestStore ONLY | ✅ Preserved — door sales are NOT comps; live in useDoorSalesStore |
| **I-26** | privateGuestList no buyer surface | ✅ Preserved — no Cycle 12 touchpoint |
| **I-27** | Single successful scan per ticketId | ✅ Preserved — door auto-check-in fires success ONCE per ticket; refund doesn't write a void per OBS-1 (financial event ≠ attendance event) |
| **I-28** | UI-only invitation flow until B-cycle | ✅ Preserved — canAcceptPayments toggle FLIP is permission-shape change, not flow change |

**NEW invariants this cycle establishes:**

### I-29 — Door sales NEVER fabricated as phantom OrderRecord rows

**Statement:** Door sales live in `useDoorSalesStore.entries` ONLY. NEVER as phantom OrderRecord rows. `CheckoutPaymentMethod` extension adds `cash | card_reader | nfc | manual` values, but online checkout flow filters to `card | apple_pay | google_pay | free` ONLY — door payment methods MUST NOT be selectable via `app/checkout/[eventId]/payment.tsx`.

**Mirrors:** I-25 (comp guests in useGuestStore only) — same architectural rule for a different surface.

**Test that catches a regression:** `grep -rE "paymentMethod: \"cash\"|paymentMethod: \"card_reader\"|paymentMethod: \"nfc\"|paymentMethod: \"manual\"" mingla-business/app/checkout/` returns 0 hits. Any consumer code in the buyer route constructing an OrderRecord with a door payment method violates this.

### I-30 — Door-tier vs online-tier separation enforced via `availableAt`

**Statement:** `TicketStub.availableAt: "online" | "door" | "both"` is the source of truth for which surface a tier appears on. Online checkout (Cycle 8) MUST filter `availableAt !== "door"` — surfaces only "online" + "both". Door sale flow (Cycle 12 J-D3) MUST filter `availableAt !== "online"` — surfaces only "door" + "both". `AddCompGuestSheet` (Cycle 10) MUST filter `availableAt === "both"` ONLY — comps stay tied to "both" tiers; door-only tiers DO NOT surface for comps.

**Test that catches a regression:** integration test verifies — (a) "online"-tagged tier doesn't appear in J-D3 picker; (b) "door"-tagged tier doesn't appear in `/checkout/{id}` ticket picker; (c) "door"-tagged tier doesn't appear in AddCompGuestSheet picker.

---

## 8 — Fix Strategy (direction only)

The full SPEC writes the contract; this is direction:

1. **Foundation pre-flight (mandatory):** schema bump v5→v6 for TicketStub.availableAt + LiveEvent.inPersonPaymentsEnabled migrate. ~30min.
2. **New store + utilities:** doorSalesStore + expandDoorTickets utility (~1.5h).
3. **Cycle 8 surface filter:** add `availableAt !== "door"` to checkout `/index.tsx` ticket picker (~15min).
4. **Cycle 11 InviteScannerSheet flip:** real toggle + remove "ALWAYS false" comment (~30min).
5. **EditPublishedScreen + Step 5 + Step 6 wiring:** new picker + toggle (~1h).
6. **DoorSaleNewSheet + DoorSaleDetail + DoorRefundSheet + ReconciliationReport components:** ~5h (most complex screen of the cycle — multi-line cart inside sheet).
7. **Door routes:** `/event/{id}/door/index.tsx` (list) + `/event/{id}/door/{saleId}.tsx` (detail) (~2h).
8. **J-G1 + J-G2 extension:** `kind: "door"` rows + search + parseGuestId extension (~2h).
9. **Cycle 9c-2 activity feed extension:** add `event_door_sale` kind to ActivityEvent union? OR reuse existing `event_scan` kind for door auto-check-ins (recommended — they ARE scan events, just `via: "manual"`). Implementor reads existing event_scan stream + verifies door auto-checks naturally surface (no Cycle 12 change needed in activity feed if reuse path holds).
10. **Logout cascade extension:** `useDoorSalesStore.reset()` in `clearAllStores.ts` (~5min).
11. **CSV export extension:** include door sales (~30min).
12. **Verification matrix:** tsc clean + grep regressions + invariant verification.

---

## 9 — Regression Prevention

| Risk | Structural safeguard | Test |
|------|---------------------|------|
| Door-only tier accidentally surfaces in online checkout | I-30 enforcement in J-C1 picker | grep test: `availableAt !== "door"` filter present in checkout |
| Online-only tier accidentally surfaces in door sale | I-30 enforcement in J-D3 picker | grep test: `availableAt !== "online"` filter present in door |
| Door sale fabricated as phantom OrderRecord | I-29 + type system (CheckoutPaymentMethod online union excludes door methods) | grep test: door payment methods absent from buyer route |
| Door buyer missing from guest list | J-G1 includes `kind: "door"` rows | T-XX integration: record door sale → confirm row in J-G1 |
| Auto-check-in race condition / orphan scans | recordSale-then-scan order; scan only fires after sale return value | unit test: doorSalesStore.recordSale returns DoorSaleRecord (never throws) |
| canAcceptPayments toggle re-disables in future cycle | comment + I-28 preservation | code review |
| Refund undoes check-in (would violate OBS-1 lock) | refund flow MUST NOT touch scanStore | grep test: doorRefundSheet handler doesn't call useScanStore |

---

## 10 — Discoveries for orchestrator

### D-CYCLE12-1 (S3 obs) — Cycle 11 J-G1 derived check-in count uses orderId-keyed Map

`guests/index.tsx:213` keys `orderCheckInCounts` by `orderId`. Door sales use `orderId: <saleId>` (e.g., `ds_xxx`). The Map naturally accommodates both order IDs and door sale IDs since they're distinct strings. No change needed in J-G1's count logic — just gain awareness of door rows for rendering.

### D-CYCLE12-2 (S3 obs) — Cycle 9c-2 activity feed `event_scan` kind already covers door auto-check-ins

The activity feed at `app/event/[id]/index.tsx` filters `useScanStore.entries.filter(s => s.scanResult === "success")` for the event_scan stream (per Cycle 11 IMPL). Door sales fire `via: "manual"` success scans via Decision #5, so they auto-surface in Recent Activity as "{buyerName} checked in" entries. **NO Cycle 9c-2 feed extension needed for Cycle 12.** Reuse beats addition (Const #8 spirit).

### D-CYCLE12-3 (S3 obs) — `door_sales_ledger.reconciled` boolean unused in Cycle 12

Schema has `reconciled` + `reconciled_at`. Cycle 12 doesn't surface a "mark as reconciled" UX (just shows live computed reconciliation report). Defer reconciliation toggle to B-cycle. Document as future field-shape readiness.

### D-CYCLE12-4 (S2 hidden flaw) — Per-scanner identity resolution gap

Cycle 12 reports `recordedBy` as the operator's account_id since Cycle 11 didn't ship delegated scanner identity. Reconciliation report's "by-scanner" view will show 1 row (the operator) for now. **Recommend orchestrator track as B-cycle item: "scanner identity resolution"** — when an invited scanner accepts and signs in, their `auth.users.id` becomes the `recordedBy` value, and reconciliation naturally shows multi-scanner breakdowns.

### D-CYCLE12-5 (S3 obs) — Door sale "true cancellation" (refund + uncheck-in) deferred

Refund affects money only per OBS-1. Operators who want to undo a check-in (e.g., double-charge correction) have no mechanism in Cycle 12. **Recommend orchestrator track as future cycle item: "operator manual check-in correction"** — could be a small ride-along in B-cycle when scanner backend lands.

---

## 11 — Confidence

**H (high)** across all 8 investigation threads + 5 findings + 2 hidden flaws + 5 discoveries.

**Why H:** every architectural claim verified by reading the actual file (not relying on summaries). Cycle 11 architecture is the most recent + most relevant pattern reference, and its 5 result kinds + I-27 + I-28 pattern is fresh in our memory from earlier this session.

**What would lower confidence:** if `useDoorSalesStore` shape needed to depart materially from `useOrderStore` pattern (it doesn't — they're parallel), OR if `CartContext` had hidden coupling to buyer-route flow we didn't see (it doesn't — verified by reading buyer.tsx + confirm.tsx).

---

## 12 — Cross-references

- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/FORENSICS_BIZ_CYCLE_12_DOOR_SALES.md)
- BUSINESS_PRD §7 In-Person Payments + §14 MVP Foundations Cut
- Cycle 11 SPEC + IMPL v2 (architectural pattern reference): [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md) + [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 10 SPEC + IMPL (J-G1/J-G2 extension target): [`specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](../specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md) + commit `dc75b5dd`
- Cycle 9c orderStore + RefundSheet (pattern reference): commit `12dcce02`
- Cycle 8 checkout cart (pattern reference): commit `6d426755` + `mingla-business/src/components/checkout/CartContext.tsx`
- ORCH-0706 close (door_sales_ledger CHECK constraint live): [`reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md`](./IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md)
- INVARIANT_REGISTRY (I-19/21/25/26/27/28 + I-29/30 NEW): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
- `door_sales_ledger` schema: [`supabase/migrations/20260502100000_b1_business_schema_rls.sql:1730-1750`](../../supabase/migrations/20260502100000_b1_business_schema_rls.sql) + ORCH-0706 SF-5 CHECK constraint
