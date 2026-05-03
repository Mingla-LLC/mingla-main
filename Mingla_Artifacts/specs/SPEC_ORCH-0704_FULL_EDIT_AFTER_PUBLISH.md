# SPEC — ORCH-0704 — Full Edit-After-Publish + Buyer Protection

> **⚠️ OBSOLETE — superseded by [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md](SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md) (2026-05-02).** Operator overrode v1's Q-704-1..6 recommended defaults: notification stack (banner + email + SMS + push-deferred), whenMode unlocked entirely, refund-first as unified destructive pattern, mandatory reason capture on every save, edit audit log. Read v2 for the canonical contract. v1 retained as historical artifact only — do NOT implement against this file.

**Date:** 2026-05-02
**Author:** mingla-forensics
**Mode:** SPEC (companion to [INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../reports/INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md))
**Supersedes:** Cycle 9 spec §3.B (J-E11 narrow scope) — operator decision 2026-05-02
**Superseded by:** v2 (see banner above)

---

## 1 — Scope

### In scope (operator-side, this cycle)

- Replace narrow `EditPublishedScreen` with sectioned full-edit screen reusing `CreatorStepN` body components
- Replace `liveEventStore.updateLiveEventEditableFields` with `updateLiveEventFields` accepting full editable patch
- Add buyer-protection guard rails: capacity floor, tier-delete-block-with-sales, tier-price-lock-with-sales, whenMode-lock-with-sales, multi-date-removal-block-with-sales
- Extend `StepBodyProps` with optional `editMode?: { soldCountByTier: Record<string, number> }`
- Modify `CreatorStep5Tickets` to render price-lock UX when `editMode.soldCountByTier[ticketId] > 0`
- Subtract narrow 9b-2 files (`liveEventToEditPatch.ts`, narrow EditPublishedScreen content)
- Expand `EditAfterPublishBanner` copy
- Enrich `ChangeSummaryModal` differ to handle every editable field type

### In scope (forward-looking schema definitions, built in Cycle 9c)

- `useOrderStore` shape (OrderRecord, OrderLineRecord, BuyerSnapshot, RefundRecord)
- `getSoldCountByTier` selector contract
- Material-change banner detection algorithm + copy
- Cycle 9c implementor consumes these definitions verbatim

### Out of scope

- `useOrderStore` implementation (built in Cycle 9c)
- `confirm.tsx` wire-up to `useOrderStore` (built in Cycle 9c)
- Buyer order detail page rendering (built in Cycle 9c)
- Real Stripe charge/refund (B-cycle)
- Real email/push notifications (B-cycle)
- No-show + post-event ops (ORCH-0705)
- Dispute paths (ORCH-0705)
- Capacity-decrease-with-buyer-refund flow (post-Stripe)

### Assumptions

- Operator has confirmed 4 steering decisions on 2026-05-02 (per dispatch §1)
- Narrow 9b-2 files are uncommitted in the working tree (verified by `git status`)
- `mingla-business/` Expo Web only per DEC-081
- Existing routing (`?mode=edit-published` query param) is correct (per Cycle 9b-2 narrow impl)

---

## 2 — Non-Goals

| Non-Goal | Why |
|----------|-----|
| Wizard root refactor | Step bodies already decoupled (OBS-704-1); no refactor needed |
| Persistent draft storage for edit-mode | Local `useState` is correct — edit state must NOT pollute draftEventStore |
| Step 7 Preview reuse | Operator uses existing Cycle 9a "Preview" button on Event Detail |
| Edit history / changelog | Out of MVP; could land in 9c+ if requested |
| Pre-seeded fake orders for testing locked UX | Violates Const #9; tester verifies once 9c lands |
| Dynamic ticket / wallet pass updates | QR is opaque IDs; live data lookup at scan time (Cycle 11) |
| Real-time collaborative editing (multiple operators) | Single-operator model holds for MVP; conflict resolution is post-MVP |

---

## 3 — Layer-by-Layer Specification

### 3.1 Schema (TypeScript types)

**File:** `mingla-business/src/store/liveEventStore.ts`

#### 3.1.1 New type: `EditableLiveEventFields`

Define the explicit subset of LiveEvent fields that are editable post-publish. The complement (frozen fields) is inferred via TypeScript's `Omit`.

```ts
/**
 * Editable subset of LiveEvent post-publish.
 *
 * Frozen fields (NEVER editable): id, brandId, brandSlug, eventSlug, status,
 * publishedAt, cancelledAt, endedAt, createdAt, updatedAt, orders.
 *
 * The shape is the FULL editable surface — buyer-protection guard rails
 * (capacity floor, tier-delete-with-sales, etc.) are enforced separately
 * in updateLiveEventFields validation, NOT by omitting fields from this type.
 *
 * Per ORCH-0704 §3.1.1.
 */
export type EditableLiveEventFields = Pick<
  LiveEvent,
  | "name"
  | "description"
  | "format"
  | "category"
  | "whenMode"
  | "date"
  | "doorsOpen"
  | "endsAt"
  | "timezone"
  | "recurrenceRule"
  | "multiDates"
  | "venueName"
  | "address"
  | "onlineUrl"
  | "hideAddressUntilTicket"
  | "coverHue"
  | "tickets"
  | "visibility"
  | "requireApproval"
  | "allowTransfers"
  | "hideRemainingCount"
  | "passwordProtected"
>;
```

#### 3.1.2 New mutation result type

```ts
/**
 * Result type for updateLiveEventFields.
 *
 * Returns ok=true on successful apply; ok=false with classified error
 * on guard-rail rejection. Caller (EditPublishedScreen) maps errors
 * to inline UI feedback.
 *
 * Per ORCH-0704 §3.2.2.
 */
export type UpdateLiveEventResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "event_not_found"
        | "capacity_below_sold"
        | "tier_delete_with_sales"
        | "when_mode_change_with_sales"
        | "multi_date_remove_with_sales"
        | "tier_price_change_with_sales"
        | "tier_free_toggle_with_sales";
      // Optional context for inline UI rendering
      tierIds?: string[];
      details?: string;
    };
```

#### 3.1.3 OrderRecord + RefundRecord (forward-looking, built 9c)

Define here so 9c implementor builds verbatim. Save under `mingla-business/src/store/orderStore.ts` types section when 9c implements.

```ts
/**
 * Forward-looking — Cycle 9c builds useOrderStore implementing this contract.
 *
 * Per ORCH-0704 §3.1.3 + §5.2 of investigation.
 */

export type OrderStatus =
  | "paid"
  | "refunded_full"
  | "refunded_partial"
  | "cancelled";

export interface OrderLineRecord {
  /** References LiveEvent.tickets[].id (stable across edits). */
  ticketTypeId: string;
  /** FROZEN at purchase. NEVER mutated. */
  ticketNameAtPurchase: string;
  /** FROZEN at purchase. NEVER mutated. */
  unitPriceGbpAtPurchase: number;
  /** FROZEN at purchase. NEVER mutated. */
  isFreeAtPurchase: boolean;
  /** FROZEN at purchase. NEVER mutated. */
  quantity: number;
  /** Mutable post-refund. 0 ≤ refundedQuantity ≤ quantity. */
  refundedQuantity: number;
  /** Mutable post-refund. Sum of refunds applied to this line. */
  refundedAmountGbp: number;
}

export interface BuyerSnapshot {
  /** All FROZEN at purchase. NEVER mutated. */
  name: string;
  email: string;
  phone: string;       // empty string if buyer didn't provide
  marketingOptIn: boolean;
}

export interface OrderRecord {
  // Identity
  id: string;                    // matches CartContext OrderResult.orderId
  eventId: string;               // FK to LiveEvent.id
  brandId: string;               // denormalized for fast brand-scoped queries
  // Snapshot at purchase (write-once)
  buyer: BuyerSnapshot;
  lines: OrderLineRecord[];
  totalGbpAtPurchase: number;
  currency: "GBP";               // locked per Const #10 — SOURCE OF FUTURE EXPANSION
  paymentMethod: CheckoutPaymentMethod;  // from CartContext
  paidAt: string;                // ISO 8601
  // Mutable lifecycle
  status: OrderStatus;
  refundedAmountGbp: number;     // sum across all refunds (denormalized cache)
  refunds: RefundRecord[];       // append-only audit log
  cancelledAt: string | null;
  // Buyer-facing material-change tracking
  /**
   * Advances when buyer views their order detail page (built 9c).
   * Used for material-change banner detection.
   */
  lastSeenEventUpdatedAt: string;  // ISO 8601
}

export interface RefundRecord {
  id: string;
  orderId: string;
  amountGbp: number;
  reason: string | null;
  refundedAt: string;
  /** For partial refunds: which lines & quantities; full refund = all lines. */
  lines: { ticketTypeId: string; quantity: number; amountGbp: number }[];
}
```

### 3.2 Store layer mutation

**File:** `mingla-business/src/store/liveEventStore.ts`

#### 3.2.1 Replace narrow mutation

DELETE the existing `updateLiveEventEditableFields` (lines 117-120 type signature + lines 160-177 implementation).

#### 3.2.2 Add new full mutation

Add to `LiveEventState` interface:

```ts
/**
 * Update editable post-publish fields (ORCH-0704). Accepts the full
 * editable subset; rejects frozen fields at the type level. Validates
 * buyer-protection guard rails BEFORE applying the patch.
 *
 * Guard rails enforced (caller MUST handle rejection):
 *   - Capacity floor: tickets[i].capacity >= soldCountByTier[tickets[i].id]
 *   - Tier delete with sales: cannot remove a tier whose ID has soldCount > 0
 *   - whenMode change with sales: cannot change whenMode if any orders exist
 *   - multiDates remove with sales: cannot remove an entry if any orders exist
 *   - Tier price change with sales: cannot change priceGbp on tier with sales
 *   - Tier free toggle with sales: cannot toggle isFree on tier with sales
 *
 * Bumps updatedAt on success. Returns UpdateLiveEventResult discriminated union.
 *
 * Per ORCH-0704 §3.2.2.
 */
updateLiveEventFields: (
  id: string,
  patch: Partial<EditableLiveEventFields>,
  context: {
    /** Sold-count-by-tier-id map. Built from useOrderStore in Cycle 9c.
     *  In ORCH-0704 stub mode, the helper returns {} (all zero-equivalent). */
    soldCountByTier: Record<string, number>;
    /** Total event sold count. {} = 0 in stub mode. */
    soldCountForEvent: number;
  },
) => UpdateLiveEventResult;
```

Implementation:

```ts
updateLiveEventFields: (id, patch, context): UpdateLiveEventResult => {
  const event = get().events.find((e) => e.id === id);
  if (event === undefined) return { ok: false, reason: "event_not_found" };

  const { soldCountByTier, soldCountForEvent } = context;

  // -------- Guard rail: whenMode change with sales --------
  if (
    patch.whenMode !== undefined &&
    patch.whenMode !== event.whenMode &&
    soldCountForEvent > 0
  ) {
    return { ok: false, reason: "when_mode_change_with_sales" };
  }

  // -------- Guard rail: multiDates entry removal with sales --------
  if (patch.multiDates !== undefined && event.multiDates !== null) {
    const oldIds = new Set(event.multiDates.map((d) => d.id));
    const newIds = new Set(patch.multiDates?.map((d) => d.id) ?? []);
    const removed = [...oldIds].filter((mid) => !newIds.has(mid));
    if (removed.length > 0 && soldCountForEvent > 0) {
      return { ok: false, reason: "multi_date_remove_with_sales" };
    }
  }

  // -------- Guard rails: per-tier --------
  if (patch.tickets !== undefined) {
    const oldTickets = event.tickets;
    const newTickets = patch.tickets;
    const oldById = new Map(oldTickets.map((t) => [t.id, t]));
    const newIds = new Set(newTickets.map((t) => t.id));

    // Tier delete with sales
    for (const oldT of oldTickets) {
      if (!newIds.has(oldT.id) && (soldCountByTier[oldT.id] ?? 0) > 0) {
        return {
          ok: false,
          reason: "tier_delete_with_sales",
          tierIds: [oldT.id],
        };
      }
    }

    // Per-tier mutations
    for (const newT of newTickets) {
      const oldT = oldById.get(newT.id);
      if (oldT === undefined) continue;  // new tier; no constraints
      const sold = soldCountByTier[newT.id] ?? 0;
      if (sold === 0) continue;  // unsold tier; no constraints

      // Capacity floor
      if (
        newT.capacity !== null &&
        newT.capacity < sold
      ) {
        return {
          ok: false,
          reason: "capacity_below_sold",
          tierIds: [newT.id],
          details: `${newT.id}:${sold}`,  // implementor formats inline error
        };
      }

      // Price change with sales
      if (newT.priceGbp !== oldT.priceGbp) {
        return {
          ok: false,
          reason: "tier_price_change_with_sales",
          tierIds: [newT.id],
        };
      }

      // Free toggle with sales
      if (newT.isFree !== oldT.isFree) {
        return {
          ok: false,
          reason: "tier_free_toggle_with_sales",
          tierIds: [newT.id],
        };
      }
    }
  }

  // -------- Apply patch --------
  const now = new Date().toISOString();
  set((s) => ({
    events: s.events.map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: now } : e,
    ),
  }));
  return { ok: true };
},
```

**TypeScript note:** the patch parameter is typed `Partial<EditableLiveEventFields>` so passing a frozen field key (e.g. `id`, `brandSlug`) is a compile-time error. The runtime guards above enforce SEMANTIC constraints (sold-count guards), not field-key validity.

### 3.3 Sold-count helper (TRANSITIONAL stub)

**File (NEW):** `mingla-business/src/store/orderStoreHelpers.ts`

This file provides the SHAPE the sectioned EditPublishedScreen consumes. In ORCH-0704 it returns empty/zero values (since `useOrderStore` is built in 9c). The component code consumes the helper EXACTLY as it will once 9c flips it to live. Zero-changes-to-callers when 9c lands.

```ts
/**
 * Sold-count helpers for edit-published flow.
 *
 * [TRANSITIONAL] Returns zero-counts in ORCH-0704 because useOrderStore
 * is built in Cycle 9c. When 9c lands:
 *   1. This file replaced by selectors that read from useOrderStore
 *   2. Callers (EditPublishedScreen) DO NOT change — same signature
 *
 * EXIT CONDITION: Cycle 9c implementor wires useOrderStore + replaces this
 * stub helper with live selectors.
 *
 * Per ORCH-0704 §3.3.
 */

import type { LiveEvent } from "./liveEventStore";

export interface SoldCountContext {
  soldCountByTier: Record<string, number>;
  soldCountForEvent: number;
}

/**
 * Returns sold-count map for a given event. Used by EditPublishedScreen
 * to render lock UX + by liveEventStore.updateLiveEventFields to enforce
 * guard rails.
 *
 * [TRANSITIONAL] Stub returning empty/zero. Replace in Cycle 9c.
 */
export const getSoldCountContextForEvent = (
  event: LiveEvent,
): SoldCountContext => {
  // [TRANSITIONAL] No useOrderStore yet — return empty until 9c.
  void event;  // silence unused-param lint
  return {
    soldCountByTier: {},
    soldCountForEvent: 0,
  };
};
```

When Cycle 9c implements `useOrderStore`, this file is rewritten:

```ts
// FUTURE CYCLE 9C VERSION (NOT IMPLEMENTED IN ORCH-0704)
import { useOrderStore } from "./orderStore";

export const getSoldCountContextForEvent = (
  event: LiveEvent,
): SoldCountContext => {
  const orders = useOrderStore.getState().getOrdersForEvent(event.id);
  const liveOrders = orders.filter((o) =>
    o.status === "paid" || o.status === "refunded_partial",
  );
  const soldCountByTier: Record<string, number> = {};
  let soldCountForEvent = 0;
  for (const order of liveOrders) {
    for (const line of order.lines) {
      const live = line.quantity - line.refundedQuantity;
      if (live <= 0) continue;
      soldCountByTier[line.ticketTypeId] =
        (soldCountByTier[line.ticketTypeId] ?? 0) + live;
      soldCountForEvent += live;
    }
  }
  return { soldCountByTier, soldCountForEvent };
};
```

The ORCH-0704 implementor writes the stub version. The 9c implementor replaces it.

### 3.4 Component layer

#### 3.4.1 Extend `StepBodyProps`

**File:** `mingla-business/src/components/event/types.ts`

Add optional `editMode` field. Backward-compatible: create-flow doesn't pass it, edit-flow does.

```ts
export interface StepBodyProps {
  draft: DraftEvent;
  updateDraft: (
    patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>,
  ) => void;
  errors: ValidationError[];
  showErrors: boolean;
  onShowToast: (message: string) => void;
  scrollToBottom: () => void;
  /**
   * When provided, the step body is in edit-after-publish mode.
   * Currently only Step 5 reads this (price/capacity/delete locks).
   * Other steps ignore it transparently.
   *
   * Per ORCH-0704 §3.4.1.
   */
  editMode?: {
    /** Sold count per tier ID. Used to render lock UX. */
    soldCountByTier: Record<string, number>;
  };
}
```

#### 3.4.2 Modify `CreatorStep5Tickets`

**File:** `mingla-business/src/components/event/CreatorStep5Tickets.tsx`

Read `props.editMode?.soldCountByTier`. Apply the following UX changes when present:

**Tier card list:**
- Add a "Sold: N" line on the TicketCard subline when `soldCountByTier[t.id] > 0`
- Hide/disable the Delete (trash) icon button when `soldCountByTier[t.id] > 0`. Add helper text on long-press / hover (web): "N tickets sold — stop selling instead of deleting."

**TicketSheet (open on tier edit):**
- When editing a tier with `soldCountByTier[t.id] > 0`:
  - Price field: render disabled with helper "Existing buyers locked at £X. Change applies to new buyers only."
  - Free toggle: render disabled with same helper styling.
  - Capacity field: editable, BUT validate `>= soldCount` inline. Inline error: "Can't go below {sold} tickets sold."
  - "Stop selling this tier" affordance: a new tertiary action in the sheet. Setting `visibility = "disabled"` is the canonical "stop selling." Add a labeled toggle in the sheet for visibility = public/disabled (currently visibility is in the modifiers section; promote to top-level when in edit-mode-with-sales).
- All other modifier fields editable freely.
- Delete button at sheet bottom: hide when `soldCountByTier[t.id] > 0`.

**Add-tier flow:**
- Always allow. New tiers have `id` not yet in `soldCountByTier` map (defaults to 0 via `?? 0`). No constraints fire.

**Implementation hints:**
- The TicketSheet state machine doesn't need significant refactor — read `props.editMode?.soldCountByTier?.[editingTicket.id] ?? 0` at sheet open time, branch on >0 for disabled UX.
- Use `pointerEvents="none"` + `opacity: 0.5` for disabled inputs (consistent with existing wizard disabled pattern).

#### 3.4.3 New `EditPublishedScreen` (sectioned)

**File:** `mingla-business/src/components/event/EditPublishedScreen.tsx` (REPLACE existing narrow content)

**Component structure:**

```
<View host>
  <Chrome>
    Back arrow → router.back
    Title: "Edit event"
    [optional] Save changes button (visible when keyboard hidden + has diffs)
  </Chrome>
  <ScrollView body>
    <EditAfterPublishBanner />

    <SectionCard expanded={section === 'basics'} onPressHeader={...}>
      <Header>Basics</Header>
      {expanded && <CreatorStep1Basics {...stepBodyProps} />}
    </SectionCard>

    <SectionCard expanded={section === 'when'}>
      <Header>When</Header>
      {expanded && <CreatorStep2When {...stepBodyProps} />}
    </SectionCard>

    <SectionCard expanded={section === 'where'}>
      <Header>Where</Header>
      {expanded && <CreatorStep3Where {...stepBodyProps} />}
    </SectionCard>

    <SectionCard expanded={section === 'cover'}>
      <Header>Cover</Header>
      {expanded && <CreatorStep4Cover {...stepBodyProps} />}
    </SectionCard>

    <SectionCard expanded={section === 'tickets'}>
      <Header>Tickets</Header>
      {expanded && <CreatorStep5Tickets {...stepBodyProps} editMode={editModeCtx} />}
    </SectionCard>

    <SectionCard expanded={section === 'settings'}>
      <Header>Settings</Header>
      {expanded && <CreatorStep6Settings {...stepBodyProps} />}
    </SectionCard>

  </ScrollView>

  <StickyDock>
    <Button label="Save changes" onPress={handleSavePress} />
  </StickyDock>

  <ChangeSummaryModal
    visible={modalVisible}
    diffs={pendingDiffs}
    onConfirm={handleConfirmSave}
    onCancel={() => setModalVisible(false)}
    submitting={submitting}
  />

  <ConfirmDialog (only shown for guard-rail rejection)
    visible={rejectDialog !== null}
    title={rejectDialog?.title}
    message={rejectDialog?.message}
    onConfirm={() => setRejectDialog(null)}
  />

  <Toast (self-positioning via Modal portal) />
</View>
```

**State:**

```ts
// Local edit state — DraftEvent-shaped view of the LiveEvent
const [editState, setEditState] = useState<DraftEvent>(() =>
  liveEventToEditableDraft(liveEvent),
);
// Currently expanded section (only one at a time — accordion pattern)
const [openSection, setOpenSection] = useState<SectionKey | null>("basics");
// Per-section validation errors (re-runs on save attempt)
const [errors, setErrors] = useState<Record<SectionKey, ValidationError[]>>({...});
const [showErrors, setShowErrors] = useState<boolean>(false);
// ChangeSummary modal state
const [modalVisible, setModalVisible] = useState<boolean>(false);
const [pendingDiffs, setPendingDiffs] = useState<FieldDiff[]>([]);
const [submitting, setSubmitting] = useState<boolean>(false);
// Guard-rail rejection dialog state
const [rejectDialog, setRejectDialog] = useState<{ title: string; message: string } | null>(null);
// Toast
const [toast, setToast] = useState<{ visible: boolean; message: string; kind: "info" | "error" | "success" }>({...});
// Keyboard tracking (mirrors EventCreatorWizard pattern)
const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
const scrollViewRef = useRef<ScrollView | null>(null);
const pendingScrollToBottomRef = useRef<boolean>(false);

// Sold-count context (live in 9c; stub now)
const editModeCtx = useMemo(
  () => getSoldCountContextForEvent(liveEvent),
  [liveEvent],
);
```

**Adapter helper (NEW utility):**

**File (NEW):** `mingla-business/src/utils/liveEventAdapter.ts`

```ts
import type { LiveEvent } from "../store/liveEventStore";
import type { DraftEvent } from "../store/draftEventStore";

/**
 * Adapter: project a LiveEvent into a DraftEvent shape for consumption
 * by step body components. Only field overlap is real; DraftEvent-only
 * fields are stubbed.
 *
 * The result is a transient view object — NOT persisted to draftEventStore.
 * Used as initial state seed in EditPublishedScreen's useState.
 *
 * Per ORCH-0704 §3.4.3.
 */
export const liveEventToEditableDraft = (e: LiveEvent): DraftEvent => ({
  id: e.id,
  brandId: e.brandId,
  name: e.name,
  description: e.description,
  format: e.format,
  category: e.category,
  whenMode: e.whenMode,
  date: e.date,
  doorsOpen: e.doorsOpen,
  endsAt: e.endsAt,
  timezone: e.timezone,
  recurrenceRule: e.recurrenceRule,
  multiDates: e.multiDates,
  venueName: e.venueName,
  address: e.address,
  onlineUrl: e.onlineUrl,
  hideAddressUntilTicket: e.hideAddressUntilTicket,
  coverHue: e.coverHue,
  tickets: e.tickets,
  visibility: e.visibility,
  requireApproval: e.requireApproval,
  allowTransfers: e.allowTransfers,
  hideRemainingCount: e.hideRemainingCount,
  passwordProtected: e.passwordProtected,
  // DraftEvent-only fields (wizard-internal; stubbed for edit mode)
  lastStepReached: 0,
  status: "live" as const,  // never triggers publishDraft path
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

/**
 * Reverse adapter: extract editable patch from edit state by diffing
 * against the original LiveEvent. Returns only fields that changed.
 *
 * Per ORCH-0704 §3.4.3.
 */
export const editableDraftToPatch = (
  original: LiveEvent,
  edited: DraftEvent,
): Partial<EditableLiveEventFields> => {
  const patch: Partial<EditableLiveEventFields> = {};
  // Compare each editable field; only include if changed.
  if (original.name !== edited.name) patch.name = edited.name;
  if (original.description !== edited.description) patch.description = edited.description;
  if (original.format !== edited.format) patch.format = edited.format;
  if (original.category !== edited.category) patch.category = edited.category;
  if (original.whenMode !== edited.whenMode) patch.whenMode = edited.whenMode;
  if (original.date !== edited.date) patch.date = edited.date;
  if (original.doorsOpen !== edited.doorsOpen) patch.doorsOpen = edited.doorsOpen;
  if (original.endsAt !== edited.endsAt) patch.endsAt = edited.endsAt;
  if (original.timezone !== edited.timezone) patch.timezone = edited.timezone;
  // Deep compare for nested:
  if (!deepEqual(original.recurrenceRule, edited.recurrenceRule)) {
    patch.recurrenceRule = edited.recurrenceRule;
  }
  if (!deepEqual(original.multiDates, edited.multiDates)) {
    patch.multiDates = edited.multiDates;
  }
  if (original.venueName !== edited.venueName) patch.venueName = edited.venueName;
  if (original.address !== edited.address) patch.address = edited.address;
  if (original.onlineUrl !== edited.onlineUrl) patch.onlineUrl = edited.onlineUrl;
  if (original.hideAddressUntilTicket !== edited.hideAddressUntilTicket) {
    patch.hideAddressUntilTicket = edited.hideAddressUntilTicket;
  }
  if (original.coverHue !== edited.coverHue) patch.coverHue = edited.coverHue;
  if (!deepEqual(original.tickets, edited.tickets)) patch.tickets = edited.tickets;
  if (original.visibility !== edited.visibility) patch.visibility = edited.visibility;
  if (original.requireApproval !== edited.requireApproval) {
    patch.requireApproval = edited.requireApproval;
  }
  if (original.allowTransfers !== edited.allowTransfers) {
    patch.allowTransfers = edited.allowTransfers;
  }
  if (original.hideRemainingCount !== edited.hideRemainingCount) {
    patch.hideRemainingCount = edited.hideRemainingCount;
  }
  if (original.passwordProtected !== edited.passwordProtected) {
    patch.passwordProtected = edited.passwordProtected;
  }
  return patch;
};

// deepEqual: use a small util — for ORCH-0704 implementor:
// import { isEqual } from a util file, OR JSON.stringify comparison
// (acceptable for these shapes since they're plain JSON-serializable).
const deepEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
```

**Save flow:**

```
1. User taps "Save changes" → handleSavePress()
2. Run validation across all sections (per-step validateStep on edited state) →
   if any errors, set showErrors=true + scroll to first error → return
3. Compute diffs via editableDraftToPatch(liveEvent, editState) →
   if Object.keys(diffs).length === 0, toast "No changes to save." → return
4. Compute pendingDiffs (for ChangeSummaryModal) via richer differ helper →
   setModalVisible(true)
5. User confirms in ChangeSummaryModal → handleConfirmSave()
6. setSubmitting(true)
7. await new Promise(resolve => setTimeout(resolve, 800)) // simulated processing
8. const result = liveEventStore.getState().updateLiveEventFields(
     liveEvent.id, diffs, editModeCtx,
   );
9. setSubmitting(false); setModalVisible(false);
10. If result.ok=true → toast "Saved. Live now." (success) → 600ms delay → router.back
11. If result.ok=false → setRejectDialog({title, message}) (mapped from reason)
12. (User taps "Got it" on reject dialog → setRejectDialog(null) → user fixes + retries)
```

**Reason → dialog mapping:**

| reason | title | message |
|--------|-------|---------|
| `event_not_found` | "Couldn't find this event" | "It may have been deleted. Tap back to return." |
| `capacity_below_sold` | "Capacity too low" | "You have {sold} tickets already sold for this tier. Increase capacity above {sold}, or stop selling instead." |
| `tier_delete_with_sales` | "Can't delete this tier" | "{N} tickets have been sold for this tier. Stop selling it instead." |
| `when_mode_change_with_sales` | "Can't change date mode" | "Tickets have been sold. To switch between single/recurring/multi-date, you'd need to cancel + re-publish." |
| `multi_date_remove_with_sales` | "Can't remove this date" | "Tickets have been sold. You can edit existing dates but can't remove them once any sales exist." |
| `tier_price_change_with_sales` | "Can't change price for sold tier" | "Existing buyers are protected at the price they paid. To change the price for new buyers, create a new tier." |
| `tier_free_toggle_with_sales` | "Can't change free/paid for sold tier" | "Existing buyers paid the original amount. Stop selling this tier and create a new one for the new option." |

(Implementor: copy the dialog table verbatim; tester checks each.)

**Discard handling:**

- Back arrow / chrome X / native back: discard local edits, navigate back. NO confirmation dialog (matches narrow 9b-2 narrow behavior; D-IMPL-CYCLE9b2-6 noted).
- Unsaved changes are simply lost. Accepting this tradeoff; if user feedback requests confirmation dialog later, add `beforeRemove` listener with disarm flag (per `feedback_back_listener_disarm_pattern`).

#### 3.4.4 Modify `EditAfterPublishBanner`

**File:** `mingla-business/src/components/event/EditAfterPublishBanner.tsx`

Update body copy:

```ts
// Before (narrow 9b-2):
// "You're editing a live event. Changes go live immediately when you save.
//  Some fields are locked — Cancel + republish to change them."

// After (ORCH-0704):
// "Changes save immediately. Existing buyers stay protected — their
//  tickets and prices won't change. Buyers with material updates
//  (date, venue, format) will see a notification on their order page."
```

Heading: "You're editing a live event" (unchanged).
Layout: unchanged (orange-tinted GlassCard + flag icon + heading + body).

#### 3.4.5 Enrich `ChangeSummaryModal`

**File:** `mingla-business/src/components/event/ChangeSummaryModal.tsx`

The current modal renders `FieldDiff` items with `oldValue`/`newValue` strings. Enrich the differ to handle every editable field type:

**Differ logic** (lives in `liveEventAdapter.ts` or a new `editFieldDiffer.ts`):

```ts
export interface FieldDiff {
  fieldKey: string;
  fieldLabel: string;
  oldValue: string;  // human-readable, truncated
  newValue: string;
  /** Optional severity hint — UI may color-code material vs safe diffs. */
  severity?: "safe" | "material";
}

const FIELD_LABELS: Record<keyof EditableLiveEventFields, string> = {
  name: "Event name",
  description: "Description",
  format: "Format",
  category: "Category",
  whenMode: "Date mode",
  date: "Date",
  doorsOpen: "Doors open",
  endsAt: "Ends at",
  timezone: "Timezone",
  recurrenceRule: "Recurrence",
  multiDates: "Multiple dates",
  venueName: "Venue",
  address: "Address",
  onlineUrl: "Online link",
  hideAddressUntilTicket: "Hide address until ticket",
  coverHue: "Cover hue",
  tickets: "Tickets",
  visibility: "Visibility",
  requireApproval: "Require approval",
  allowTransfers: "Allow transfers",
  hideRemainingCount: "Hide remaining count",
  passwordProtected: "Password protected",
};

const MATERIAL_KEYS: ReadonlyArray<keyof EditableLiveEventFields> = [
  "format", "date", "doorsOpen", "endsAt", "timezone",
  "venueName", "address", "onlineUrl", "multiDates", "tickets",
];

export const computeRichFieldDiffs = (
  original: LiveEvent,
  edited: DraftEvent,
): FieldDiff[] => {
  const diffs: FieldDiff[] = [];
  // Per-key formatters:
  const fmt = (key: keyof EditableLiveEventFields, value: unknown): string => {
    if (value === null) return "(empty)";
    if (typeof value === "string") {
      return value.length === 0 ? "(empty)" : truncate(value, 80);
    }
    if (typeof value === "number") {
      if (key === "coverHue") return `${value}°`;
      return String(value);
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (key === "tickets") {
      const tickets = value as TicketStub[];
      return `${tickets.length} tier${tickets.length === 1 ? "" : "s"}`;
    }
    if (key === "multiDates") {
      const dates = value as MultiDateEntry[] | null;
      return dates === null ? "(none)" : `${dates.length} date${dates.length === 1 ? "" : "s"}`;
    }
    if (key === "recurrenceRule") {
      return value === null ? "(none)" : "Custom rule";
    }
    return JSON.stringify(value).slice(0, 80);
  };

  for (const key of Object.keys(FIELD_LABELS) as Array<keyof EditableLiveEventFields>) {
    const a = original[key];
    const b = edited[key];
    if (deepEqual(a, b)) continue;
    diffs.push({
      fieldKey: String(key),
      fieldLabel: FIELD_LABELS[key],
      oldValue: fmt(key, a),
      newValue: fmt(key, b),
      severity: MATERIAL_KEYS.includes(key) ? "material" : "safe",
    });
  }
  return diffs;
};
```

**Modal UI changes:**
- Diff rows: existing layout (label + old → new). Add subtle severity indicator (small dot or border-left tint) — `safe = textTokens.tertiary`, `material = accent.warm` (same as banner).
- Footer note (when any material diff present): "Material changes (date, venue, format, ticket changes) will notify your existing buyers."
- Submit/Cancel buttons unchanged.

For `tickets` diffs specifically, the old "X tiers → Y tiers" summary is too coarse. Spec recommends an EXPANDED tickets diff section showing per-tier changes (added / removed / edited):

```
Tickets changed:
  • Added: VIP (£50, 100 capacity)
  • Removed: Early bird
  • Updated: General — capacity 200 → 300
```

The implementor implements this as a sub-renderer for `fieldKey === "tickets"`. Helper:

```ts
export interface TicketDiff {
  kind: "added" | "removed" | "updated";
  ticketId: string;
  ticketName: string;
  /** For "updated": which fields changed within this tier. */
  fieldChanges?: Array<{ key: keyof TicketStub; old: unknown; new: unknown }>;
}

export const computeTicketDiffs = (
  original: TicketStub[],
  edited: TicketStub[],
): TicketDiff[] => {
  const oldById = new Map(original.map((t) => [t.id, t]));
  const newById = new Map(edited.map((t) => [t.id, t]));
  const out: TicketDiff[] = [];
  for (const newT of edited) {
    const oldT = oldById.get(newT.id);
    if (oldT === undefined) {
      out.push({ kind: "added", ticketId: newT.id, ticketName: newT.name });
    } else if (!deepEqual(oldT, newT)) {
      // Diff individual fields
      const fieldChanges: TicketDiff["fieldChanges"] = [];
      for (const k of Object.keys(newT) as Array<keyof TicketStub>) {
        if (!deepEqual(oldT[k], newT[k])) {
          fieldChanges.push({ key: k, old: oldT[k], new: newT[k] });
        }
      }
      out.push({ kind: "updated", ticketId: newT.id, ticketName: newT.name, fieldChanges });
    }
  }
  for (const oldT of original) {
    if (!newById.has(oldT.id)) {
      out.push({ kind: "removed", ticketId: oldT.id, ticketName: oldT.name });
    }
  }
  return out;
};
```

The modal's tickets-diff sub-renderer uses `computeTicketDiffs` to render the expanded list.

### 3.5 Validation layer

**File:** `mingla-business/src/utils/draftEventValidation.ts` (no changes needed)

The existing `validateStep(step, draft)` function works on the DraftEvent shape. EditPublishedScreen calls it per section using the section-to-step mapping:

```ts
const SECTION_TO_STEP: Record<SectionKey, number> = {
  basics: 0,
  when: 1,
  where: 2,
  cover: 3,
  tickets: 4,
  settings: 5,
};
```

Skip `validateStep(6, draft)` (Step 7 Preview validation) — irrelevant for edit mode.

`validatePublish` is NOT called in edit mode (no Stripe re-check needed; D-704-4).

### 3.6 Routing

**File:** `mingla-business/app/event/[id]/edit.tsx`

NO CHANGE. The current `?mode=edit-published` branch already renders `<EditPublishedScreen liveEvent={liveEvent} />` — and the new sectioned EditPublishedScreen accepts the same `liveEvent: LiveEvent` prop.

### 3.7 Forward-looking Cycle 9c contract (do NOT implement in ORCH-0704)

When 9c implementor builds `useOrderStore`:

1. **Replace stub `getSoldCountContextForEvent`** in `mingla-business/src/store/orderStoreHelpers.ts` with the live version (per §3.3 example).
2. **Wire `confirm.tsx`** to call `useOrderStore.getState().recordOrder({...})` after `recordResult` (1-line addition; idempotent dedupe by orderId).
3. **Build buyer order detail page** at TBD route (e.g. `/order/[orderId]` outside `(tabs)/`, anon-tolerant per `feedback_anon_buyer_routes`):
   - Reads `OrderRecord` from useOrderStore + `LiveEvent` from liveEventStore (live)
   - Renders frozen financial fields from OrderRecord.lines[]
   - Renders displayable fields from LiveEvent
   - Renders material-change banner per algorithm in §6 of investigation
   - "Got it" action advances `lastSeenEventUpdatedAt`

ORCH-0704 implementor MUST NOT touch any of these. They're documented here for 9c context only.

---

## 4 — Success Criteria

### Operator-side (full-edit, this cycle)

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#1 | Open EditPublishedScreen on a live event with no sales — every section is expandable; every field editable; no lock UX shown | Manual: open + tap each section + verify each input accepts changes |
| 0704-AC#2 | Edit name → save → confirms in modal → ChangeSummaryModal shows "Event name: old → new" → Confirm → 800ms → toast "Saved. Live now." → router.back | Manual full flow |
| 0704-AC#3 | Edit address → save → ChangeSummaryModal shows material-severity indicator on the diff row | Visual verification of UI |
| 0704-AC#4 | Edit cover hue + description in same session → save → ChangeSummaryModal shows BOTH diffs | Manual |
| 0704-AC#5 | Add a new ticket tier → save → ChangeSummaryModal shows "Tickets: Added: {name}" | Manual |
| 0704-AC#6 | Remove a ticket tier (with no sales) → save → ChangeSummaryModal shows "Tickets: Removed: {name}" | Manual |
| 0704-AC#7 | Update a ticket tier's price (with no sales) → save → ChangeSummaryModal shows "Tickets: Updated: {name} — price £X → £Y" | Manual |
| 0704-AC#8 | Change recurrenceRule pattern (with no sales) → save successfully | Manual |
| 0704-AC#9 | Edit visibility / requireApproval / allowTransfers / hideRemainingCount / passwordProtected → save successfully | Manual |
| 0704-AC#10 | Edit multi-date entries (add new, edit existing time/venue) → save successfully | Manual |
| 0704-AC#11 | TypeScript: passing a frozen field key (e.g. `id`) to `updateLiveEventFields` is a compile error | tsc check |
| 0704-AC#12 | Try to delete a tier that has soldCountByTier[id] > 0 (verifiable only after 9c — for ORCH-0704, simulate by setting non-zero map manually in test environment) → tier card has no Delete button + helper text shows | Manual + unit test |
| 0704-AC#13 | Try to drop tier capacity below soldCount (simulated) → save returns `{ok: false, reason: "capacity_below_sold"}` → reject dialog shown with sold count in copy | Manual + unit test |
| 0704-AC#14 | Try to change tier price (simulated soldCount > 0) → price field disabled with helper "Existing buyers locked at £X" | Manual |
| 0704-AC#15 | Try to change whenMode (simulated soldCountForEvent > 0) → save returns `{ok: false, reason: "when_mode_change_with_sales"}` | Manual |
| 0704-AC#16 | Save with no changes → toast "No changes to save." stays on screen | Manual |
| 0704-AC#17 | ChangeSummaryModal Cancel → returns to edit screen with edits intact | Manual |
| 0704-AC#18 | Back arrow / chrome X → discards edits, returns to /event/[id] | Manual |
| 0704-AC#19 | Public event page (/e/{brandSlug}/{eventSlug}) reflects the edit immediately after save | Manual |
| 0704-AC#20 | Drafts: editing a draft from Drafts pill opens the original Cycle 3 wizard (NOT EditPublishedScreen) — REGRESSION CHECK | Manual |
| 0704-AC#21 | Cycle 3 wizard create flow unchanged — pristine draft → wizard → publish → live event | Manual regression |
| 0704-AC#22 | tsc --noEmit EXIT=0 across entire mingla-business workspace | Build verify |
| 0704-AC#23 | grep `oklch(` returns no matches in mingla-business/src and mingla-business/app | grep verify |
| 0704-AC#24 | Subtraction verified: `liveEventToEditPatch.ts` does NOT exist; old `EditPublishedScreen.tsx` content fully replaced; old `updateLiveEventEditableFields` removed from store | grep + read verify |

### Schema lock (forward-looking, validated when 9c implements)

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#25 | `OrderRecord`, `OrderLineRecord`, `BuyerSnapshot`, `RefundRecord` types defined exactly as spec'd in §3.1.3 | Read forward 9c implementation |
| 0704-AC#26 | `getSoldCountContextForEvent` stub returns `{soldCountByTier: {}, soldCountForEvent: 0}` and is labeled `[TRANSITIONAL]` | grep + read |
| 0704-AC#27 | When 9c replaces the stub, EditPublishedScreen + updateLiveEventFields callers do NOT change | Forward verify |

### Buyer-side (deferred to 9c — banner not rendered this cycle)

The material-change banner detection algorithm + copy + acknowledge mechanism are spec'd here. 9c implementor builds the rendering surface. ORCH-0704 has nothing to verify on this front.

---

## 5 — Invariants

### Preserved

| ID | How |
|----|-----|
| I-11 | All event/tier IDs remain opaque strings |
| I-12 | Host-bg cascade — EditPublishedScreen sets canvas.discover bg |
| I-13 | Overlay portal contract — ChangeSummaryModal uses Sheet primitive (DEC-085 portal-correct) |
| I-14 | Date display single source — step bodies already use `formatDraftDateLine` |
| I-15 | Ticket display single source — Step 5 already routes through `ticketDisplay.ts` |
| I-16 | Live-event ownership separation — `addLiveEvent` still called only by liveEventConverter; `updateLiveEventFields` is a MUTATE (orthogonal) |
| I-17 | Brand-slug stability — `brandSlug`, `eventSlug` in FROZEN bucket |
| I-18 (DRAFT) | Buyer→founder order persistence — preserved in 9c by spec'd OrderRecord shape carrying CartLine snapshot fields |

### Proposed (NEW)

**I-19 — Immutable order financials**

> An order's `totalGbpAtPurchase`, `lines[i].unitPriceGbpAtPurchase`, `lines[i].ticketNameAtPurchase`, `lines[i].isFreeAtPurchase`, `currency`, and `buyer` snapshot are write-once at order insertion to `useOrderStore`. No subsequent operator action — including event edit, tier rename, tier reprice, refund, cancel — mutates these fields. Refund/cancel mutations create NEW records (RefundRecord) and update `status` + `refundedAmountGbp` aggregates only; original snapshots are never overwritten.

**Preservation in ORCH-0704:**
- The `EditableLiveEventFields` Pick excludes any path that could touch persisted orders (orders are in a separate forward-looking store).
- Operator-side `updateLiveEventFields` only mutates LiveEvent; never touches order records.

**Preservation in 9c (forward):**
- `useOrderStore` mutations: `recordOrder` (write-once on confirmation entry); `recordRefund` (creates RefundRecord, updates aggregates); `cancelOrder` (sets status=cancelled, cancelledAt). NO updateLine, NO updateBuyer, NO updatePrice.
- TypeScript: order line snapshot fields are `Readonly<...>` at the type level when returned from selectors.

**CI gate (post-Stripe, B-cycle):** SQL CHECK constraint or trigger on `order_line_items` preventing UPDATE to `unit_price_gbp_at_purchase`, `ticket_name_at_purchase`, `is_free_at_purchase`, `quantity` columns once non-null.

**Test verifying preservation:**
1. Build a stub OrderRecord
2. Operator edits LiveEvent (rename tier, change price)
3. Verify the OrderRecord's `lines[i].ticketNameAtPurchase` and `unitPriceGbpAtPurchase` are unchanged

(Cannot test in ORCH-0704 stub mode — useOrderStore doesn't exist. Test ships in 9c.)

---

## 6 — Test Cases

### Operator-side full edit (T-1 to T-18)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Happy path — edit name | Open EditPublishedScreen, change name, save | ChangeSummaryModal lists "Event name: old → new"; Confirm → store mutated; toast "Saved. Live now."; router.back | Component + Store |
| T-2 | Happy path — edit description | Change description text | Modal lists diff; Confirm; saved | Component + Store |
| T-3 | Happy path — edit cover hue | Tap a different hue tile | Modal lists "Cover hue: 25° → 100°"; saved | Component + Store |
| T-4 | Happy path — edit address (material) | Change address | Modal lists diff with material-severity indicator + footer note about buyer notification | Component + Differ |
| T-5 | Happy path — add new tier | In Tickets section, "Add ticket type" → fill out tier → save section | Modal: "Tickets: Added: {name}"; saved | Component + Differ |
| T-6 | Happy path — remove tier (no sales) | Delete a tier with soldCount=0 | Modal: "Tickets: Removed: {name}"; saved | Component + Store |
| T-7 | Happy path — update tier (no sales) | Edit tier, change capacity | Modal: "Tickets: Updated: {name} — capacity 100 → 200"; saved | Component + Differ |
| T-8 | Multi-field edit | Change name + description + add tier in one session | Modal lists 3 diffs; saved | Component + Differ |
| T-9 | No-change save | Open + save without changes | Toast "No changes to save."; stays on screen | Component |
| T-10 | Cancel review | Open save modal → tap Cancel | Modal closes; edit state preserved | Component |
| T-11 | Discard via back | Make edits → tap back arrow | Edits lost; navigate to /event/[id] | Component |
| T-12 | Public event page reflects edit | Save → navigate to /e/{brandSlug}/{eventSlug} | New values shown | Cross-component |
| T-13 | tsc strict — frozen field rejection | `updateLiveEventFields(id, { id: "x" })` | Compile error | TypeScript |
| T-14 | Capacity floor (simulated sold>0) | Set soldCountByTier mock + try drop capacity | Save returns `{ok: false, reason: "capacity_below_sold"}`; reject dialog shown | Store + Component |
| T-15 | Tier delete block (simulated sold>0) | Set soldCountByTier mock + try delete tier | Tier card has no Delete button (UI guard); attempting via API returns `{ok: false, reason: "tier_delete_with_sales"}` | Component + Store |
| T-16 | Tier price lock (simulated sold>0) | Set soldCountByTier mock + open TicketSheet | Price field disabled with helper "Existing buyers locked at £X" | Component |
| T-17 | whenMode lock (simulated sold>0) | Set soldCountForEvent mock + try change whenMode | Save returns `{ok: false, reason: "when_mode_change_with_sales"}`; reject dialog | Store |
| T-18 | multiDates remove block (simulated sold>0) | Set soldCountForEvent mock + try remove date | Save returns `{ok: false, reason: "multi_date_remove_with_sales"}`; reject dialog | Store |

### Regression (T-R1 to T-R5)

| Test | Scenario | Expected |
|------|----------|----------|
| T-R1 | Cycle 3 wizard create | Pristine draft → /event/create → wizard opens → all 7 steps work → publish → live event |
| T-R2 | Cycle 3 wizard edit-draft | Open draft from Drafts pill → wizard opens (NOT EditPublishedScreen) at lastStepReached |
| T-R3 | Cycle 9a manage menu | Manage menu actions all work as before; Edit details routes correctly per status |
| T-R4 | Cycle 9b-1 lifecycle | End sales / Cancel event / Delete draft sheets unchanged |
| T-R5 | Cycle 8 checkout | Buyer adds tickets → checkout → confirmation; cart line shows correct snapshot price |

### Schema lock (forward 9c, T-S1 to T-S3)

| Test | Scenario | Expected |
|------|----------|----------|
| T-S1 | OrderRecord shape | When 9c implements useOrderStore, OrderRecord matches §3.1.3 verbatim |
| T-S2 | Helper API stability | Replacing stub `getSoldCountContextForEvent` with live version requires zero changes to EditPublishedScreen |
| T-S3 | I-19 preservation | Operator edits LiveEvent (rename tier, change price); existing OrderRecord lines unchanged |

(T-S1 to T-S3 verified at 9c implementation time, not in ORCH-0704 testing.)

---

## 7 — Implementation Order

### Subtract phase (Const #8 — before adding)

1. DELETE `mingla-business/src/utils/liveEventToEditPatch.ts`
2. MOD `mingla-business/src/store/liveEventStore.ts`:
   - Remove `updateLiveEventEditableFields` type signature + implementation
   - Add `EditableLiveEventFields` type
   - Add `UpdateLiveEventResult` type
   - Add `updateLiveEventFields` mutation with full guard rails

### Add phase

3. CREATE `mingla-business/src/store/orderStoreHelpers.ts`:
   - `SoldCountContext` type
   - `getSoldCountContextForEvent` stub (TRANSITIONAL — returns zero)

4. MOD `mingla-business/src/components/event/types.ts`:
   - Extend `StepBodyProps` with optional `editMode?: { soldCountByTier: Record<string, number> }`

5. CREATE `mingla-business/src/utils/liveEventAdapter.ts`:
   - `liveEventToEditableDraft(liveEvent: LiveEvent): DraftEvent`
   - `editableDraftToPatch(original: LiveEvent, edited: DraftEvent): Partial<EditableLiveEventFields>`
   - `computeRichFieldDiffs(original: LiveEvent, edited: DraftEvent): FieldDiff[]`
   - `computeTicketDiffs(original: TicketStub[], edited: TicketStub[]): TicketDiff[]`
   - `FIELD_LABELS` map
   - `MATERIAL_KEYS` array

6. MOD `mingla-business/src/components/event/CreatorStep5Tickets.tsx`:
   - Read `props.editMode?.soldCountByTier`
   - TicketSheet: when soldCount > 0 → disable price + isFree fields; capacity validates floor inline
   - TicketCard: when soldCount > 0 → show "Sold: N" subline; hide Delete button
   - Sheet bottom Delete button: hide when soldCount > 0

7. MOD `mingla-business/src/components/event/EditAfterPublishBanner.tsx`:
   - Update body copy

8. MOD `mingla-business/src/components/event/ChangeSummaryModal.tsx`:
   - Accept richer `FieldDiff` shape (with severity)
   - Add tickets-diff sub-renderer (uses `TicketDiff[]`)
   - Add material-changes footer note

9. REPLACE `mingla-business/src/components/event/EditPublishedScreen.tsx` (full rewrite per §3.4.3):
   - Sectioned layout (6 collapsible cards)
   - Local edit state via `useState(liveEventToEditableDraft(liveEvent))`
   - Section bodies = CreatorStepN components (1, 2, 3, 4, 5, 6) — Step 7 omitted
   - Save flow per §3.4.3 (validate → diff → modal → confirm → mutation → toast → back)
   - Reject dialog mapping per §3.4.3 reason→dialog table
   - Keyboard handling mirrors EventCreatorWizard pattern (memory rule `feedback_keyboard_never_blocks_input`)

### Verify phase

10. tsc --noEmit → EXIT=0
11. grep `oklch(` in mingla-business/src + mingla-business/app → no matches
12. grep `liveEventToEditPatch` in mingla-business/ → no matches (file deleted)
13. grep `updateLiveEventEditableFields` in mingla-business/ → no matches (mutation removed)
14. Visual smoke per success criteria (manual)

---

## 8 — Regression Prevention

### Structural safeguards

1. **TypeScript-enforced frozen fields.** `updateLiveEventFields` accepts `Partial<EditableLiveEventFields>` only. `EditableLiveEventFields` is an explicit `Pick` from LiveEvent, omitting all frozen keys. Compile error on any frozen key.

2. **Runtime guard rails in store.** All buyer-protection rules (capacity floor, tier-delete-with-sales, etc.) enforced in `updateLiveEventFields` BEFORE applying the patch. Returns discriminated union `UpdateLiveEventResult`. UI cannot bypass.

3. **TRANSITIONAL labels.** `getSoldCountContextForEvent` stub MUST be labeled `[TRANSITIONAL]` with explicit EXIT CONDITION pointing at Cycle 9c. 9c implementor's grep for TRANSITIONAL surfaces this instantly.

4. **Optional `editMode` prop.** Step bodies' new `editMode?` prop is optional and defaulted-undefined. Create-mode passes nothing → no behavior change. Backward-compatible.

5. **Adapter functions are pure.** `liveEventToEditableDraft` + `editableDraftToPatch` are stateless. No store mutations. No side effects. Easy to verify.

6. **Frozen-field acid test.** TypeScript will reject `patch.id = "x"`. Runtime mutation-set spread is `{ ...e, ...patch, updatedAt: now }` — frozen fields like `id` are never in `patch` (compile-blocked) so spread can't overwrite.

### Protective comments

- `liveEventStore.ts` — comment above `updateLiveEventFields`: "// Per ORCH-0704. Frozen fields: id, brandId, brandSlug, eventSlug, status, publishedAt, cancelledAt, endedAt, createdAt, updatedAt, orders. Editable subset enforced via EditableLiveEventFields type."
- `orderStoreHelpers.ts` — header doc: `[TRANSITIONAL] EXIT CONDITION: Cycle 9c builds useOrderStore + replaces stub.`
- `liveEventAdapter.ts` — header doc: "Adapter projects LiveEvent into DraftEvent shape for step body reuse. Transient view object; never persisted to draftEventStore."

### Test that catches regression

A unit test on `updateLiveEventFields` with synthetic inputs:

```ts
test("updateLiveEventFields blocks capacity drop below sold count", () => {
  const live = makeFakeLiveEvent({ ticketsWithSoldCount: { tier1: 50 } });
  const result = useLiveEventStore.getState().updateLiveEventFields(
    live.id,
    { tickets: live.tickets.map(t => t.id === "tier1" ? { ...t, capacity: 30 } : t) },
    { soldCountByTier: { tier1: 50 }, soldCountForEvent: 50 },
  );
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("capacity_below_sold");
});
```

(Optional for ORCH-0704; recommended for 9c when integration test infrastructure is in place.)

---

## 9 — Decisions to log

When ORCH-0704 closes:

### DEC-087 — Full edit-after-publish with buyer protection

**Date:** 2026-05-02 (steering); ratify on close
**Decision:** Published events are fully editable (every field except identity + lifecycle metadata). Existing buyers are protected via:
1. Frozen order financials (price, tier name, currency, buyer details locked at purchase per I-19)
2. Buyer-side displayable info reads LIVE from current LiveEvent (auto-rerender)
3. Material changes (date, address, format, etc.) trigger banner on buyer order detail page (rendered Cycle 9c)
4. Hard guard rails: capacity floor, tier-delete-with-sales block, tier-price-lock-with-sales, whenMode-lock-with-sales, multi-date-remove-with-sales block
5. Stub-mode (ORCH-0704) ships with `getSoldCountByTier` returning 0; guard rails inactive until Cycle 9c wires `useOrderStore`

**Rationale:** Operator decision 2026-05-02 — narrow 9b-2 (description + coverHue only) was unshippable for real organisers. Full edit + buyer protection is the industry-standard pattern (Eventbrite/Ticketmaster). Half-measures leak into every downstream cycle.

**Alternatives considered:**
- Wizard mode prop refactor (Option A) — rejected: wrong UX shape (sequential), 769 LOC churn
- Per-section sub-routes (Option C) — rejected: navigation overhead, save-per-section worse UX

### I-19 — Immutable order financials

**Status when ORCH-0704 closes:** ratified, status=ACTIVE.

(Operator-side ORCH-0704 work doesn't construct or mutate orders — useOrderStore is 9c. But I-19 is operator-asserted and forward-binding on 9c. Ratify on ORCH-0704 close because the spec defining the constraint ships now.)

### ORCH-0705 placeholder

Register ORCH-0705 (no-show + post-event ops + dispute paths + post-Stripe refund flows) as deferred. Add to MASTER_BUG_LIST + WORLD_MAP with status=deferred + dependency=Stripe-real-integration.

---

## 10 — Layer touchpoint summary

| Layer | Files |
|-------|-------|
| **Schema (types)** | `liveEventStore.ts` (EditableLiveEventFields, UpdateLiveEventResult); spec'd-only `OrderRecord`/`OrderLineRecord`/`BuyerSnapshot`/`RefundRecord` for 9c |
| **Store** | `liveEventStore.ts` (replace `updateLiveEventEditableFields` with `updateLiveEventFields`); NEW `orderStoreHelpers.ts` (TRANSITIONAL stub) |
| **Adapter** | NEW `liveEventAdapter.ts` (LiveEvent ↔ DraftEvent view; rich diff helpers) |
| **Hook** | None (no React Query in mingla-business) |
| **Component** | REPLACE `EditPublishedScreen.tsx`; MOD `EditAfterPublishBanner.tsx`, `ChangeSummaryModal.tsx`, `CreatorStep5Tickets.tsx`; MOD `types.ts` (StepBodyProps) |
| **Realtime** | N/A |
| **Edge function** | N/A (all client-side stub) |
| **Database** | N/A (Zustand persist only) |
| **Routing** | None — `?mode=edit-published` already correct |

Total: 1 NEW utility, 1 NEW helper, 1 REPLACE, 4 MOD, 1 DELETE.

---

## 11 — File touch matrix

| File | Action | LOC est |
|------|--------|---------|
| `mingla-business/src/store/liveEventStore.ts` | MOD | +60 / -25 (replace mutation; add types) |
| `mingla-business/src/store/orderStoreHelpers.ts` | NEW | ~40 (TRANSITIONAL stub) |
| `mingla-business/src/utils/liveEventAdapter.ts` | NEW | ~180 (adapter + rich diff helpers) |
| `mingla-business/src/utils/liveEventToEditPatch.ts` | DELETE | -110 |
| `mingla-business/src/components/event/types.ts` | MOD | +8 (editMode optional prop) |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | +60 / -5 (lock UX in TicketSheet + TicketCard) |
| `mingla-business/src/components/event/EditAfterPublishBanner.tsx` | MOD | +5 / -5 (copy update) |
| `mingla-business/src/components/event/ChangeSummaryModal.tsx` | MOD | +120 / -40 (tickets sub-renderer + severity indicator + footer note) |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | REPLACE | ~600 (full rewrite as sectioned screen) |
| **Net** | | ~+860 / -200 (~+660 net) |

---

## 12 — Constraints reminder

Memory rules in force (verify implementor honors):
- `feedback_keyboard_never_blocks_input` — EditPublishedScreen mirrors EventCreatorWizard's keyboard pattern
- `feedback_rn_color_formats` — hsl/hex only
- `feedback_toast_needs_absolute_wrap` (REVISED 2026-05-02) — Toast self-positions via Modal portal
- `feedback_anon_buyer_routes` — buyer order detail page (9c) must stay outside `(tabs)/`, must NOT call `useAuth`
- `feedback_implementor_uses_ui_ux_pro_max` — implementor MUST run `/ui-ux-pro-max` pre-flight before writing the new EditPublishedScreen UI

Constitution honored:
- #1 No dead taps (every section header / button wired)
- #2 One owner per truth (LiveEvent in liveEventStore; OrderRecord in useOrderStore-9c; CartLine in cart context)
- #3 No silent failures (UpdateLiveEventResult discriminated union surfaces every reject)
- #7 TRANSITIONAL labels honored (`getSoldCountContextForEvent` stub)
- #8 Subtract before adding (delete narrow 9b-2 first)
- #9 No fabricated data (real soldCount in 9c; zero stub in ORCH-0704; never seeded fake)
- #10 Currency-aware UI (`currency: "GBP"` snapshotted in OrderRecord)

---

## 13 — Open questions for orchestrator (Q-704-1 through Q-704-6)

Operator must answer before implementor dispatch. Recommendations included.

| ID | Question | Recommendation |
|----|----------|----------------|
| Q-704-1 | `name` field — 🟢 SAFE (no banner) or 🟡 MATERIAL (banner)? | SAFE — renames common, attendance plan unaffected |
| Q-704-2 | `format` change — 🟡 MATERIAL with banner or 🔴 LOCK with sales? | MATERIAL with banner — pivots are legitimate |
| Q-704-3 | `whenMode` — locked-when-sold or always-locked-post-publish? | Locked-when-sold — allows operator's immediate "oh I meant recurring" fix |
| Q-704-4 | Multi-date entry removal — block all once any sale? | Yes — per-date tracking is post-MVP |
| Q-704-5 | Material-change banner copy — ship as proposed? | Ship as-is; refine with user feedback after 9c |
| Q-704-6 | Stub-mode behaviour — guard rails inactive in ORCH-0704 (no orders persisted yet)? | Ok — pre-seeded fake orders violate Const #9 |

If operator confirms all 6 recommendations, no spec edits needed. If any deviation, orchestrator updates spec sections accordingly before dispatch.

---

## 14 — Implementor dispatch readiness

This spec is implementor-ready WHEN:
- Operator confirms 6 questions in §13 (or steers deviations)
- Orchestrator ratifies the spec (REVIEW mode)
- Orchestrator writes IMPLEMENTOR_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md prompt referencing this spec + the investigation

Implementor pre-flight reading list (in dispatch prompt):
1. This spec
2. The investigation report (companion file)
3. The narrow Cycle 9b-2 implementation report (to understand what's being subtracted)
4. The 6 step body files (Step 1, 2, 3, 4, 5, 6) — to understand the StepBodyProps consumers
5. EventCreatorWizard.tsx (to understand keyboard + scroll patterns to mirror)
6. CartContext.tsx (to understand the cart line snapshot fields)
7. liveEventStore.ts (to understand current shape + I-16 guard)

Pre-implementation checklist:
- [ ] Read all 7 files
- [ ] Run `/ui-ux-pro-max` for the sectioned screen (collapsible cards UI)
- [ ] Confirm subtract list (delete liveEventToEditPatch.ts; replace EditPublishedScreen content)
- [ ] Begin implementation in order: subtract → store/types/adapters → step5 mod → component build → verification

---

## 15 — Cross-references

- Investigation: [INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../reports/INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- Dispatch: [FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../prompts/FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- Supersedes: Cycle 9 spec §3.B (J-E11 narrow scope)
- Forward dependency: Cycle 9c (useOrderStore + buyer order detail page)
- Forward dependency: ORCH-0705 (no-show + post-event ops; deferred until post-Stripe)
- Constitutional reference: principles #2, #3, #7, #8, #9, #10
- Memory rules in force: see §12
