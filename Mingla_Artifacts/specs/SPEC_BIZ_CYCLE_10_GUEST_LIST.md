# SPEC — BIZ Cycle 10 (Guest list, 6-journey slice)

**Mode:** SPEC (forensics complete; operator-locked)
**Dispatch:** [`prompts/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](../prompts/SPEC_BIZ_CYCLE_10_GUEST_LIST.md)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_10_GUEST_LIST.md`](../reports/INVESTIGATION_BIZ_CYCLE_10_GUEST_LIST.md)
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator-only
**Target:** production-ready. Not "good enough." Not "works on happy path." Production.
**Date:** 2026-05-02

---

## 1 — Layman summary

This spec turns the operator-locked Cycle 10 decisions into a binding contract for the implementor. Six new journeys (J-G1..J-G6) ship a guest-management surface for organisers — list / detail / search / manual-add comp / private-list toggle / CSV export. All client-side; zero backend deploy. Pattern mirrors Cycle 9c's J-M1..J-M6 orders surface (same store + sheet + list shapes).

The contract is binding: any deviation from the decisions in §2 forces the implementor to STOP and surface to operator. No silent overrides. The 7 locked operator decisions are repeated verbatim so traceability is one click away.

---

## 2 — Operator-locked decisions (verbatim — DO NOT re-debate)

| # | Decision | Locked value |
|---|----------|--------------|
| 1 | Attendee model | **Buyer-as-attendee** — 1 OrderRecord = 1 list row, qty = summed line quantity. Per-ticket identity deferred to B-cycle. |
| 2 | Journey count | **6 journeys: J-G1 list, J-G2 detail, J-G3 search, J-G4 manual-add comp, J-G5 private-toggle, J-G6 CSV export.** |
| 3 | Activity-feed integration | **Selective.** J-G4 (add comp) + J-G5 (private toggle) + comp-removal LOG via `useEventEditLogStore.recordEdit({severity: "material"})`. J-G3 (search) + J-G6 (export) DO NOT log. |
| 4 | Export format | **CSV only.** No JSON, no email send, no realtime sync link. RFC 4180 quoting. Filename `{event-slug}-guest-list-{YYYY-MM-DD}.csv`. |
| 5 | Search filters | **Search-only.** NO filter pills in J-G3 v1. Filter pills explicitly OUT of Cycle 10 scope. |
| 6 | Comp deletion | **Allowed** with audit log entry (`severity: "material"`, reason prompt). |
| 7 | Buyer surface | **Operator-only Cycle 10.** Zero buyer-facing surface. |

---

## 3 — Scope and non-goals

### 3.1 In-scope

- 1 new Zustand persisted store: `useGuestStore` (compEntries[] only)
- 1 new `LiveEvent`/`DraftEvent` field: `privateGuestList: boolean`
- 6 new operator screens/sheets (J-G1..J-G6)
- 2 stub-replace wires: `handleGuests` callback in `app/event/[id]/index.tsx` + `app/(tabs)/events.tsx`
- Logout cascade extension: `useGuestStore.reset()` in `clearAllStores.ts`
- 2 new invariants registered: I-25 (comp-not-orders) + I-26 (private-list-no-buyer-surface)

### 3.2 Out-of-scope (explicit non-goals)

- ❌ Filter pills in J-G3 (status / ticket-type / paid-vs-comp). Search-only v1.
- ❌ Approve / reject pending guests (gated on B4 Stripe payment-hold backend)
- ❌ Manual ticket scan / check-in flow (gated on Cycle 11 scanner)
- ❌ Per-ticket attendee identity at the row level (buyer-as-attendee for v1; B-cycle migrates)
- ❌ Comp-as-phantom-OrderRecord (separate `useGuestStore` per locked decision #1)
- ❌ Email send / QR ticket gen / Apple Wallet pass for comp guests (all gated on B-cycle)
- ❌ Buyer-facing guest-list-preview surface (locked decision #7)
- ❌ Backend work: no migrations, no edge functions, no RLS, no service layer
- ❌ Cross-brand purchase history in J-G2 (scoped to current brand only)
- ❌ Comp guest editing (only add + delete; edit cascades into "what about audit log? new severity?" — defer to future polish if requested)

### 3.3 Assumptions

- Cycle 9c-2 activity feed is shipped and live (commit `5e4b04d2`); J-G4 + J-G5 + comp-removal entries surface there automatically with no Cycle 9c-2 changes.
- ORCH-0704 edit-log infrastructure is shipped (Cycle 9b-2); `useEventEditLogStore.recordEdit` API is stable.
- `useOrderStore.entries` carries valid `buyer.{name,email,phone}` for every paid order (verified — Cycle 9c v3 shipped this with full coverage).
- `LiveEvent.endedAt` and `cancelledAt` already exist (verified — Cycle 9b-1).
- React Native Share API available via `expo-sharing` (already in mingla-business per Cycle 7 share modal).
- `expo-file-system` available for CSV temp file writes (verify at IMPL time; if missing, add to `package.json`).

---

## 4 — Per-layer specification

### 4.1 Database — none

Cycle 10 ships entirely client-side. No new tables, columns, RLS policies, or migrations. PR #59 schema-side per-attendee + approval-status fields are NOT used by Cycle 10. Implementor MUST NOT include any SQL in this cycle.

### 4.2 Edge functions — none

No new edge functions, no deploys. Mobile-only.

### 4.3 Service layer — none

No new service files. All data access is direct Zustand store reads.

### 4.4 New Zustand store — `useGuestStore`

**File:** `mingla-business/src/store/guestStore.ts` (NEW)

**Persist config:**
- Persist key: `mingla-business.guestStore.v1`
- Persist version: `1`
- Storage: `AsyncStorage` via `createJSONStorage(() => AsyncStorage)`
- Partialize: `(s) => ({ entries: s.entries })`

**Type definitions (verbatim):**

```ts
export interface CompGuestEntry {
  /** cg_<base36-ts>_<base36-rand4> */
  id: string;
  eventId: string;
  /** Denormalized for fast brand-scoped queries. */
  brandId: string;
  /** Operator-supplied. 1..120 chars trimmed. NEVER empty. */
  name: string;
  /** Operator-supplied. 1..200 chars trimmed. Basic format guard (contains @ and .). */
  email: string;
  /** Empty string if not provided. */
  phone: string;
  /** Optional ticket type association. null = "general comp". */
  ticketTypeId: string | null;
  /** Snapshot at creation if ticketTypeId set; null otherwise. */
  ticketNameAtCreation: string | null;
  /** ISO 8601. */
  addedAt: string;
  /** Operator account_id (audit). */
  addedBy: string;
  /** Operator-provided, optional. 0..200 chars trimmed. */
  notes: string;
}

export interface GuestStoreState {
  entries: CompGuestEntry[];
  // ---- Mutations ----
  /** Returns the new entry (caller fires audit log + notification side effects). */
  recordCompEntry: (
    entry: Omit<CompGuestEntry, "id" | "addedAt">,
  ) => CompGuestEntry;
  /** Returns the removed entry, or null if id not found. */
  removeCompEntry: (id: string) => CompGuestEntry | null;
  /** Logout reset — wired via clearAllStores. */
  reset: () => void;
  // ---- Selectors (use via .getState() OR raw-entries + useMemo only) ----
  getCompEntriesForEvent: (eventId: string) => CompGuestEntry[];
  getCompEntryById: (id: string) => CompGuestEntry | null;
}
```

**ID generator (verbatim, mirrors orderStore + eventEditLogStore pattern):**

```ts
const generateCompId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `cg_${ts36}_${rand4}`;
};
```

**Mutation contracts:**

`recordCompEntry`:
- Generates `id` + `addedAt` server-side (here: client clock — TRANSITIONAL note)
- Prepends entry to `entries[]` (newest-first natural ordering)
- Returns the full new entry

`removeCompEntry`:
- Filters `entries[]` by id
- Returns the removed entry, or `null` if id not found
- Caller fires `useEventEditLogStore.recordEdit({severity: "material", reason, diffSummary: ["removed comp guest: {name}"]})` (component layer, NOT store layer — avoids require cycle)

`reset`:
- `set({ entries: [] })`
- Wired into `clearAllStores.ts` cascade

**Selector rules (memory rule from Cycle 9c v2):**
- `getCompEntriesForEvent` returns a fresh filtered array — used ONLY via `.getState()`, NEVER via direct subscription `useGuestStore(s => s.getCompEntriesForEvent(id))` (would break `useSyncExternalStore` Object.is and infinite-loop).
- `getCompEntryById` returns a single existing reference (find result) — safe to subscribe directly.
- For component reads of multiple compEntries, use raw-entries + `useMemo`:
  ```ts
  const allCompEntries = useGuestStore((s) => s.entries);
  const eventComps = useMemo(
    () => allCompEntries.filter((c) => c.eventId === eventId),
    [allCompEntries, eventId],
  );
  ```

**`[TRANSITIONAL]` comment at top of file (verbatim required):**

```ts
/**
 * guestStore — persisted Zustand store for operator-created comp guests.
 *
 * Cycle 10: comp guests live client-only. B-cycle migrates to backend
 * (decision deferred to B-cycle SPEC: either tickets table with
 * order_id IS NULL OR a new comp_guests table with its own RLS).
 *
 * I-25: Comp guests live in useGuestStore.entries ONLY — NEVER as
 * phantom OrderRecord rows (would violate I-19 immutable order
 * financials). CheckoutPaymentMethod union does NOT include "comp".
 *
 * Per Cycle 10 SPEC §4.4.
 */
```

**Logout integration (`clearAllStores.ts`):**

Add after the existing reset chain:

```ts
import { useGuestStore } from "../store/guestStore";

// ... existing resets ...
useGuestStore.getState().reset();
```

### 4.5 LiveEvent + DraftEvent extensions

**File:** `mingla-business/src/store/draftEventStore.ts`

Add to `DraftEvent` interface (alongside `requireApproval`):

```ts
/** Cycle 10: hide guest count from buyer-side surfaces. */
privateGuestList: boolean;
```

Default: `false`. Add to `INITIAL_DRAFT` const.

**File:** `mingla-business/src/store/liveEventStore.ts`

Add to `LiveEvent` interface and `LiveEventEditableFieldKey` union:

```ts
| "privateGuestList"
```

Add `privateGuestList: boolean` to the interface (alongside `requireApproval`).

**File:** `mingla-business/src/utils/liveEventConverter.ts`

Add to draft→live conversion (mirror `requireApproval` line):

```ts
privateGuestList: draft.privateGuestList,
```

**File:** `mingla-business/src/utils/liveEventAdapter.ts`

Three additions, mirroring existing `requireApproval`:

1. In the snapshot-extract function:
   ```ts
   privateGuestList: e.privateGuestList,
   ```

2. In the field-label map:
   ```ts
   privateGuestList: "Private guest list",
   ```

3. In the editable-keys array:
   ```ts
   "privateGuestList",
   ```

4. In the diff-detector:
   ```ts
   if (original.privateGuestList !== edited.privateGuestList) {
     patch.privateGuestList = edited.privateGuestList;
   }
   ```

**File:** `mingla-business/src/components/event/ChangeSummaryModal.tsx`

Add to label map (mirror `approvalRequired: "Approval required"`):

```ts
privateGuestList: "Private guest list",
```

**Severity classification:** When the field changes, severity = `"material"` (consistent with other event-level toggles). The existing edit-log pipeline handles classification — implementor adds the field to whichever map drives severity (verify location at IMPL time).

**Persist version bump consideration:** If `liveEventStore` persist config has a `version: N` value, IMPLEMENTOR decides whether to bump (and add a migrate function defaulting `privateGuestList = false` for old persisted state) OR rely on the field's optional-with-default semantics in selectors (`event.privateGuestList ?? false`). The latter is simpler if the field is read defensively. Choose ONE consistently and document in the implementation report.

### 4.6 Activity-feed integration (selective per locked decision #3)

The Cycle 9c-2 activity feed (commit `5e4b04d2`) renders `event_edit` kinds from `useEventEditLogStore`. Cycle 10 mutations that should log:

| Mutation | Severity | `diffSummary` (first line — what the activity feed renders) | `reason` capture |
|----------|----------|-------------------------------------------------------------|------------------|
| J-G4 manual-add | `material` | `added comp guest: {name}` | Operator-provided in sheet (10..200 chars trimmed) |
| J-G5 private-toggle ON | `material` | `enabled private guest list` | Operator-provided in EditPublishedScreen reason field (10..200 chars) |
| J-G5 private-toggle OFF | `material` | `disabled private guest list` | Operator-provided in EditPublishedScreen reason field (10..200 chars) |
| Comp-removal (from J-G2) | `material` | `removed comp guest: {name}` | Operator-provided in confirm dialog (10..200 chars trimmed) |

`recordEdit` payload shape (mirrors RefundSheet at `mingla-business/src/components/orders/RefundSheet.tsx`):

```ts
useEventEditLogStore.getState().recordEdit({
  eventId: event.id,
  brandId: event.brandId,
  reason: reason.trim(),
  severity: "material",
  changedFieldKeys: ["compEntries"],         // or ["privateGuestList"] for J-G5
  diffSummary: ["added comp guest: Tunde Olu"], // or matching summary
  affectedOrderIds: [],                       // none — this is comp-only
  // orderId NOT set — so Cycle 9c-2 filter (orderId === undefined)
  // includes this entry in the activity feed.
});
```

**Notification fire (mirror RefundSheet/CancelOrderDialog pattern):**

```ts
notifyEventChanged(
  { eventId, severity: "material", reason },
  deriveChannelFlags("material", false),
);
```

(For J-G5 only — manual-add and comp-remove do NOT fire buyer notifications since buyers don't have a guest-list-preview surface yet per locked decision #7. Update the sheet's onConfirm to skip `notifyEventChanged` for J-G4 + comp-remove, but DO fire it for J-G5.)

**Crucial:** `orderId` MUST remain `undefined` in the `recordEdit` payload. Cycle 9c-2's `recentActivity` useMemo filters edit-log entries via `e.orderId === undefined` (event-level only — order-level entries are double-counted via the order streams). If J-G4 / J-G5 / comp-remove accidentally set `orderId`, they DROP OUT of the activity feed silently.

### 4.7 Search behavior (J-G3)

Case-insensitive substring match on:

- For order rows: `buyer.name`, `buyer.email`, `buyer.phone`
- For comp rows: `name`, `email`, `phone`

**No fuzzy matching, no Soundex, no levenshtein.** Plain `.toLowerCase().includes(query.toLowerCase().trim())`.

**Empty query:** show all entries (no filtering).

**No-match state:** render `EmptyState` primitive with copy `No guests match "${query}"`. Variant `illustration="search"`.

**Real-time search:** filter as the operator types (no debounce v1 — guest lists are bounded ~hundreds, performance fine without).

**Field union for matching:** `[buyer.name, buyer.email, buyer.phone].join(" ")` for orders OR `[name, email, phone].join(" ")` for comps — single substring check.

### 4.8 CSV export (J-G6)

**Columns (verbatim, in this order):**

| # | Header | Source (order row) | Source (comp row) |
|---|--------|-------------------|-------------------|
| 1 | `Name` | `buyer.name` | `name` |
| 2 | `Email` | `buyer.email` | `email` |
| 3 | `Phone` | `buyer.phone` | `phone` |
| 4 | `Ticket type` | `lines[].ticketNameAtPurchase` joined `; ` for multi-line | `ticketNameAtCreation ?? "General comp"` |
| 5 | `Quantity` | `lines.reduce((s, l) => s + l.quantity, 0)` | `1` |
| 6 | `Status` | `Paid` / `Refunded` (full or partial) / `Cancelled` | `Comp` |
| 7 | `Order ID` | `id` | `id` (cg_-prefixed naturally) |
| 8 | `Purchase date` | `paidAt` formatted `YYYY-MM-DD` | `addedAt` formatted `YYYY-MM-DD` |
| 9 | `Comp note` | (empty) | `notes` |

**RFC 4180 escape rules (implement verbatim):**

```ts
const csvEscape = (value: string): string => {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
};
```

**Filename:** `{event-slug}-guest-list-{YYYY-MM-DD}.csv` where date is today's local date (NOT event date — operators export multiple times).

**Platform shapes:**

- **iOS / Android:** `expo-file-system` writeAsStringAsync to temp file → `expo-sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export guest list" })`. Sharing dialog lets operator pick AirDrop / Mail / Files / etc.
- **Web (Platform.OS === "web"):** Convert string to Blob `new Blob([csv], { type: "text/csv;charset=utf-8" })`, generate object URL via `URL.createObjectURL`, create anchor with `download` attribute = filename, click programmatically, revoke URL.

**Status value derivation (verbatim — order-level only; comps always `"Comp"`):**

```ts
const orderStatusLabel = (status: OrderStatus): string => {
  if (status === "paid") return "Paid";
  if (status === "refunded_full") return "Refunded";
  if (status === "refunded_partial") return "Refunded (partial)";
  if (status === "cancelled") return "Cancelled";
  const _exhaust: never = status;
  return _exhaust;
};
```

---

## 5 — Per-journey specification

### J-G1 — Guest list view

**File:** `mingla-business/app/event/[id]/guests/index.tsx` (NEW)
**Route:** `/event/{id}/guests`
**Reachable from:**
- `app/event/[id]/index.tsx` `handleGuests` callback (currently shows toast — REPLACE with `router.push(\`/event/${id}/guests\` as never)`)
- `app/(tabs)/events.tsx` if list-card menu has "Guests" entry — verify at IMPL time

**Layout:**

- TopBar (mirror `app/event/[id]/orders/index.tsx`):
  - Left: `IconChrome icon="close"` → handleBack
  - Center: title `"Guests"`
  - Right slot: `IconChrome icon="search"` (toggle search bar) + `IconChrome icon="download"` (J-G6 export) + `IconChrome icon="plus"` (open J-G4 sheet)

- Search bar (collapsible, hidden by default — mirror Orders list):
  - `<Input variant="text" value={search} onChangeText={setSearch} placeholder="Buyer name, email, or phone" />`
  - `keyboardShouldPersistTaps="handled"` on parent ScrollView

- ScrollView with merged + sorted + (optionally) filtered list:
  - Source: `useOrderStore.entries.filter(o => o.eventId === id) ⊕ useGuestStore.entries.filter(c => c.eventId === id)`
  - Both subscribed via raw-entries pattern + merged in useMemo
  - Sort: by `paidAt` (orders) / `addedAt` (comps) descending (newest first)
  - Cap: render all (no pagination v1; guest lists bounded)
  - Row component: inline `GuestRow` (composed similarly to `OrderListCard`):
    - Left: avatar with `hsl(hashStringToHue(id), 60%, 45%)` background + initials
    - Body: `name` (bold) + secondary line `{email} · {ticketSummary} · {relativeTime}`
    - Right: status pill (`Pill variant="info">PAID</Pill>` / `variant="warn">REFUNDED</Pill>` / `variant="draft">CANCELLED</Pill>` / `variant="accent">COMP</Pill>`) + `Pill variant="draft" small>NOT CHECKED IN</Pill>` placeholder
  - Press handler: `router.push(\`/event/${id}/guests/${kind}-${innerId}\` as never)` (composite ID format)

**States:**

| State | Render |
|-------|--------|
| `event === null \|\| typeof id !== "string"` | "Event not found" EmptyState + back CTA (mirror Orders list pattern) |
| `totalCount === 0` (no orders, no comps) | EmptyState `illustration="ticket"` `title="No guests yet"` `description="Once buyers buy tickets — or you add comp guests manually — they'll appear here."` `cta={{label:"Share event link", onPress: navigateToPublic}}` |
| `filtered.length === 0 && search.trim().length > 0` | EmptyState `illustration="search"` `title="No matches"` `description={\`No guests match "${search.trim()}".\`}` |
| populated | `<GuestRow>` per entry |

**Submitting / loading / offline:** N/A — pure client state, instant.

**Accessibility:**
- Search button: `accessibilityLabel="Search guests"`
- Export button: `accessibilityLabel="Export guest list"`
- Add comp button: `accessibilityLabel="Add comp guest"`
- Each row: `accessibilityRole="button"` `accessibilityLabel={\`Guest ${name}, ${ticketSummary}, ${statusLabel}\`}`

**Memory rule `feedback_implementor_uses_ui_ux_pro_max`:** Pre-flight `/ui-ux-pro-max` design step REQUIRED — new visual surface with multiple new elements (status pill, comp pill, check-in placeholder, search bar). Not derivative of an existing list.

**Memory rule `feedback_keyboard_never_blocks_input`:** Search bar input must remain visible above keyboard on iOS + Android + Web. Reference Cycle 4 wizard root pattern (Keyboard listener + dynamic paddingBottom + deferred scrollToEnd via requestAnimationFrame).

### J-G2 — Guest detail

**File:** `mingla-business/app/event/[id]/guests/[guestId].tsx` (NEW)
**Route:** `/event/{id}/guests/{guestId}`
**`guestId` param format:** `{kind}-{innerId}` where:
- `kind` ∈ `"order" | "comp"`
- For orders: `innerId` = OrderRecord.id (e.g., `order-ord_abc123`)
- For comps: `innerId` = CompGuestEntry.id (e.g., `comp-cg_xyz789`)

**Layout sections (top-to-bottom):**

1. **Chrome:** TopBar with `close` icon → back, title `"Guest"`, no right slot
2. **Hero card:** avatar (large 64×64) + name (24pt) + email (secondary) + phone (tertiary if present)
3. **Status row:** paid/comp/refunded/cancelled pill + "Not checked in" placeholder pill
4. **Ticket section:** GlassCard with label `TICKETS`
   - For orders: one row per `OrderLineRecord` with `ticketNameAtPurchase` + `quantity ×` + `formatGbp(unitPriceGbpAtPurchase)` + total
   - For comps: one row with `ticketNameAtCreation ?? "General comp"` + `1× Comp`
5. **Activity section** (orders only): GlassCard with label `ORDER ACTIVITY` — show paidAt, paymentMethod, refunds[] timeline, cancelledAt if cancelled
6. **Comp metadata section** (comps only): GlassCard with `ADDED BY` operator name (lookup from currentBrandStore — show "you" if matches current operator, else operator name) + addedAt + notes (if present)
7. **Purchase history section** (orders only): GlassCard with label `OTHER ORDERS BY THIS BUYER FOR {brand.displayName}` — list other OrderRecords from `useOrderStore.entries.filter(o => o.brandId === order.brandId && o.buyer.email.toLowerCase() === order.buyer.email.toLowerCase() && o.id !== order.id)` with deep-link to each via `router.push(\`/event/${o.eventId}/orders/${o.id}\`)`. Empty case: don't render the section at all.
8. **Action footer** (comps only):
   - `<Button label="Remove guest" variant="ghost" destructive size="md" fullWidth onPress={handleRemoveOpen} />`
9. **Confirm dialog** (mounted, hidden by default — opens on Remove tap):
   - `<ConfirmDialog visible={removeOpen} onClose={...} onConfirm={handleRemoveConfirm} title="Remove this comp guest?" description="They'll be deleted from your guest list. This action records to the audit log." variant="reasoned" reasonLabel="Why are you removing them? (10–200 chars)" reasonMin={10} reasonMax={200} confirmLabel="Remove guest" cancelLabel="Keep guest" destructive />`
   - `handleRemoveConfirm(reason)`: `useGuestStore.removeCompEntry(id)` → if returned entry non-null → `useEventEditLogStore.recordEdit({eventId, brandId, reason, severity: "material", changedFieldKeys: ["compEntries"], diffSummary: [\`removed comp guest: ${entry.name}\`], affectedOrderIds: [], orderId: undefined})` → toast `"Comp guest removed."` → `router.back()`

**States:**

| State | Render |
|-------|--------|
| `guestId` malformed (not `{kind}-{innerId}` format) | "Guest not found" EmptyState + back CTA |
| `kind === "order"` and order not found in `useOrderStore` | Same |
| `kind === "comp"` and comp not found in `useGuestStore` | Same |
| populated (order) | sections 1–5, 7 |
| populated (comp) | sections 1–4, 6, 8 |

**Memory rule:** `/ui-ux-pro-max` pre-flight required. New visual surface with multiple new card sections.

### J-G3 — Search/filter (inline on J-G1)

Already specified in §5/J-G1 layout. Additional rules:

- **Debounce:** none (filter on every keystroke; lists bounded)
- **Auto-clear search on navigate-back:** YES (mirror Orders list)
- **Search persistence:** none — search state is local component state, resets on unmount
- **Hard line:** NO filter pills. Comments in code MUST NOT include `// TODO add filter pills`. Implementor MUST NOT add a `<FilterPills>` component, even if "while I'm here, I'll add a placeholder."
- **Test gate:** T-18 below catches any filter-pill regression at tester time.

### J-G4 — Manual-add comp guest sheet

**File:** `mingla-business/src/components/guests/AddCompGuestSheet.tsx` (NEW)

**Pattern:** Mirror `mingla-business/src/components/orders/RefundSheet.tsx` — Sheet primitive, controlled state, async confirm with simulated processing, side effects fired by component.

**Props interface:**

```ts
export interface AddCompGuestSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (entry: CompGuestEntry) => void;
}
```

**Controlled inputs (component local state):**

- `name: string` (TextInput — required, 1..120 chars trimmed)
- `email: string` (TextInput — required, 1..200 chars trimmed, must contain `@` and `.`)
- `phone: string` (TextInput — optional, 0..50 chars)
- `ticketTypeId: string | null` (Picker / segmented — optional dropdown of `event.tickets.filter(t => t.visibility !== "hidden").sort(displayOrder)`)
- `notes: string` (TextInput multiline — optional, 0..200 chars)
- `reason: string` (TextInput multiline — required, 10..200 chars trimmed)
- `submitting: boolean` (state for disabling controls during simulated processing)

**Validation rules (verbatim):**

| Field | Rule | Error copy |
|-------|------|------------|
| `name` | `name.trim().length >= 1 && name.trim().length <= 120` | "Enter the guest's name." |
| `email` | `email.trim().length >= 1 && email.trim().length <= 200 && email.includes("@") && email.includes(".")` | "Enter a valid email." |
| `phone` | `phone.length <= 50` | "Phone too long." |
| `notes` | `notes.length <= 200` | "Notes can't exceed 200 characters." |
| `reason` | `reason.trim().length >= 10 && reason.trim().length <= 200` | "Tell us why (10–200 chars)." |

`isValid = name.valid && email.valid && phone.valid && notes.valid && reason.valid`. Confirm button disabled when `!isValid || submitting`.

**Confirm handler (verbatim shape — mirror RefundSheet):**

```ts
const handleConfirm = useCallback(async (): Promise<void> => {
  if (!isValid) return;
  setSubmitting(true);
  await sleep(800);  // simulated processing (shorter than RefundSheet's 1.2s — comp-add is non-financial)
  const ticketStub = ticketTypeId !== null
    ? event.tickets.find((t) => t.id === ticketTypeId) ?? null
    : null;
  const newEntry = useGuestStore.getState().recordCompEntry({
    eventId: event.id,
    brandId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    ticketTypeId,
    ticketNameAtCreation: ticketStub?.name ?? null,
    addedBy: operatorAccountId,
    notes: notes.trim(),
  });
  // Side effects (audit log) — caller-side per Cycle 9c v2 require-cycle lesson.
  useEventEditLogStore.getState().recordEdit({
    eventId: event.id,
    brandId,
    reason: reason.trim(),
    severity: "material",
    changedFieldKeys: ["compEntries"],
    diffSummary: [`added comp guest: ${newEntry.name}`],
    affectedOrderIds: [],
    // orderId NOT set — keeps activity feed visibility per Cycle 9c-2 filter
  });
  setSubmitting(false);
  onSuccess(newEntry);
}, [isValid, ticketTypeId, event, brandId, operatorAccountId, name, email, phone, notes, reason, onSuccess]);
```

**Error path:** if `recordCompEntry` somehow throws (shouldn't — it's pure state set), catch and toast `"Couldn't add guest. Tap to try again."`. Reset `submitting` in `finally`.

**States:**

| State | Render |
|-------|--------|
| Sheet hidden | nothing |
| visible + `!submitting` + `!isValid` | All inputs editable, confirm button disabled with copy "Add guest" |
| visible + `!submitting` + `isValid` | Same but confirm button enabled |
| visible + `submitting` | All inputs disabled, confirm button shows "Adding..." with spinner |

**Memory rule `feedback_keyboard_never_blocks_input`:** Sheet is multi-input → keyboard avoidance MUST work on all platforms. Use the Sheet primitive's built-in keyboard avoidance + verify on iOS / Android / Web at IMPL time.

**Memory rule:** `/ui-ux-pro-max` pre-flight required.

### J-G5 — Private guest list toggle

**Wired through existing edit-after-publish pipeline.** No new component — extends:

**File 1:** `mingla-business/src/components/event/EditPublishedScreen.tsx`

Add a new toggle row in the settings section (alongside `requireApproval` toggle). Use the existing `ToggleRow` primitive (find pattern via `requireApproval`'s render). Label: `"Private guest list"`. Subtitle: `"Hide attendee count from buyers."`.

When toggled, the change flows through the existing `updateLiveEventFields` mutation → `recordEdit` is fired automatically by the edit-log pipeline (orchestrator-owned per ORCH-0704). No additional code in EditPublishedScreen — just the field wire.

**File 2 (optional shortcut):** `mingla-business/src/components/event/EventManageMenu.tsx`

Add a menu row "Toggle private guest list" with subtitle showing current state (`"On"` / `"Off"`). Tap fires the same `updateLiveEventFields` mutation via a confirm dialog that captures reason. Implementor's call whether to ship the shortcut in Cycle 10 or defer — if budget tight, EditPublishedScreen-only is acceptable. Document the decision in implementation report §"Discoveries for Orchestrator" if the shortcut is deferred.

### J-G6 — CSV export

Already specified in §4.8. Inline handler on J-G1 chrome — no new component.

**Handler shape (verbatim):**

```ts
const handleExport = useCallback(async (): Promise<void> => {
  const rows = mergedAndSortedGuests; // same source as J-G1 list
  const csv = serializeGuestsToCsv(rows);
  const filename = `${event.eventSlug}-guest-list-${formatYmdToday()}.csv`;
  try {
    if (Platform.OS === "web") {
      await downloadCsvWeb(csv, filename);
    } else {
      await downloadCsvNative(csv, filename);
    }
    showToast(`Exported ${rows.length} guests.`);
  } catch (err) {
    showToast("Couldn't export. Tap to try again.");
  }
}, [mergedAndSortedGuests, event, showToast]);
```

`serializeGuestsToCsv`, `downloadCsvWeb`, `downloadCsvNative`, `formatYmdToday` are utility functions — implementor decides single file vs co-located vs `mingla-business/src/utils/csvExport.ts`. Recommendation: co-locate at `mingla-business/src/utils/guestCsvExport.ts` since CSV serialization is feature-specific and unlikely to be reused by other surfaces.

---

## 6 — Success criteria

Each criterion is observable, testable, unambiguous. Tester verifies all of them before PASS.

| SC | Observable expectation |
|----|------------------------|
| **SC-1** | On a pristine event with zero orders and zero comps, J-G1 renders the EmptyState with title "No guests yet" and primary CTA "Share event link". CTA tap navigates to `/e/{brandSlug}/{eventSlug}`. |
| **SC-2** | After 1 paid OrderRecord exists for the event, J-G1 renders 1 row with: avatar (with hsl background based on order ID hash), buyer name (bold), `{email} · {ticketSummary} · {relativeTime}` secondary line, "PAID" status pill, and "NOT CHECKED IN" placeholder pill. |
| **SC-3** | Adding a comp via J-G4 (valid inputs + reason) → J-G1 renders 2 rows; comp row distinguished by "COMP" status pill + accent color avatar; appears at top (newest-first sort). |
| **SC-4** | J-G3 search input filters list to case-insensitive substring matches on `name` / `email` / `phone`. Typing "tunde" matches "Tunde Olu" AND "tundeolu@example.com" AND "20772TUNDE7". Backspace to empty restores full list. |
| **SC-5** | Inspecting J-G1 chrome reveals NO filter pills element. `grep -rn "FilterPill\|filterByStatus" mingla-business/app/event/\[id\]/guests/` returns 0 hits. |
| **SC-6** | J-G2 detail (paid order) shows: hero with name + email + phone if present, paid+not-checked-in pills, TICKETS section listing each line, ORDER ACTIVITY section with paidAt + payment method + refund timeline, OTHER ORDERS BY THIS BUYER section if other orders exist for same brand. |
| **SC-7** | J-G2 detail (comp) shows: hero, comp+not-checked-in pills, TICKETS section with ticket name + "1× Comp", ADDED BY section with operator + addedAt + notes, "Remove guest" destructive button. |
| **SC-8** | Tapping "Remove guest" on a comp opens ConfirmDialog with reason input; entering valid reason + tapping confirm → comp removed from `useGuestStore`, activity feed shows "removed comp guest: {name}" with material severity, navigates back to J-G1, toast "Comp guest removed.". |
| **SC-9** | J-G5 toggle ON via EditPublishedScreen → confirmation flow with reason → `LiveEvent.privateGuestList === true` after persist → ChangeSummaryModal lists "Private guest list" diff line ("Off → On") → activity feed shows "enabled private guest list" entry. |
| **SC-10** | J-G6 export with 3 paid + 0 comps → produces a CSV file named `{event-slug}-guest-list-{YYYY-MM-DD}.csv` with header row + 3 data rows + correct columns + correct values. |
| **SC-11** | J-G6 export with mix of paid + refunded + cancelled + comp → produces CSV where Status column reflects each row's actual status correctly. |
| **SC-12** | J-G6 export with a buyer named `O'Brien, Jr. "VIP"` produces a CSV where the Name field is `"O'Brien, Jr. ""VIP"""` (RFC 4180-escaped). Opens cleanly in Excel + Numbers + Google Sheets. |
| **SC-13** | Logout from operator account (or `clearAllStores` direct call) wipes `useGuestStore.entries` to `[]`. New login does NOT see prior comp guests. |
| **SC-14** | Add comp → kill app process → reopen → comp persists in J-G1 list. (Persisted-state startup per Const #14.) |
| **SC-15** | `cd mingla-business && npx tsc --noEmit` exits 0 after all changes. |
| **SC-16** | Const #1 — every interactive element responds: search button toggle search bar, export button fires CSV flow with success/failure toast, "+" button opens J-G4 sheet, every row tap navigates to J-G2, J-G2 deep-link buttons navigate, "Remove guest" opens dialog. |
| **SC-17** | No `oklch` / `lab` / `lch` color literals in any new component. `grep -rn "oklch\|lab(\|lch(" mingla-business/app/event/\[id\]/guests/ mingla-business/src/components/guests/` returns 0 hits. |
| **SC-18** | Search input (J-G3) and all manual-add inputs (J-G4) remain visible above keyboard on iOS + Android + Web during text entry. |
| **SC-19** | All `useGuestStore` reads use raw-entries + `useMemo` pattern, NEVER `useGuestStore(s => s.getCompEntriesForEvent(id))` or similar fresh-array selectors. `grep -rn "useGuestStore((s) => s\\.getCompEntries" mingla-business/` returns 0 hits. |
| **SC-20** | `clearAllStores.ts` references `useGuestStore.getState().reset()`. SC-13 verifies runtime behavior. |
| **SC-21** | I-25 enforced — `grep -rn "paymentMethod: \"comp\"" mingla-business/` returns 0 hits. `CheckoutPaymentMethod` union still `"card" | "apple_pay" | "google_pay" | "free"`. |
| **SC-22** | I-26 enforced — `grep -rn "privateGuestList\|useGuestStore" mingla-business/app/o/ mingla-business/app/e/` returns 0 hits. No buyer-facing surface reads either field. |

---

## 7 — Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-01** | Empty event | New event, no orders, no comps | J-G1 renders EmptyState with "No guests yet" + "Share event link" CTA | Component |
| **T-02** | Single paid order | 1 order, qty 1 | J-G1 renders 1 row with name/email + "PAID" + "NOT CHECKED IN" pills | Store + Component |
| **T-03** | Multi-line order | 1 order with 2 ticket types | J-G1 row shows "{N}× tickets" summary, J-G2 lists both lines | Component |
| **T-04** | Comp add — valid | J-G4 with name="Tunde", email="tunde@x.com", reason="VIP comp friend" | New row at top of J-G1 with "COMP" pill; activity feed shows "added comp guest: Tunde" | Store + Activity feed |
| **T-05** | Comp add — invalid name | Empty name | Confirm button disabled, "Enter the guest's name." inline error | Component validation |
| **T-06** | Comp add — invalid email | Email "notanemail" | Confirm button disabled, "Enter a valid email." inline error | Component validation |
| **T-07** | Comp add — invalid reason (too short) | Reason "ok" (< 10 chars) | Confirm button disabled, "Tell us why (10–200 chars)." inline error | Component validation |
| **T-08** | Comp removal | J-G2 detail "Remove guest" + reason "Mistake — wrong person" | Row gone from J-G1, activity feed entry "removed comp guest: ${name}", toast "Comp guest removed." | Store + Activity feed |
| **T-09** | Search match — name | Type "tun" with 1 paid + 1 comp matching | List filters to 2 matching rows | Component |
| **T-10** | Search match — email | Type "@example" | List filters to all rows whose email contains "@example" | Component |
| **T-11** | Search no-match | Type "zzzzz" | EmptyState `"No guests match \"zzzzz\""` rendered | Component |
| **T-12** | Search clear on backspace | Type then backspace to empty | Full list restored | Component |
| **T-13** | Private toggle ON | J-G5 toggle + confirm reason "Hide for prestige event" | LiveEvent.privateGuestList === true; ChangeSummaryModal showed "Private guest list" diff; activity feed entry logged | Store + Modal |
| **T-14** | Private toggle OFF | Same, toggle OFF | LiveEvent.privateGuestList === false; ChangeSummaryModal showed reverse diff | Store + Modal |
| **T-15** | CSV export — paid only | 3 paid orders, no comps | CSV file with 3 data rows, correct columns, opens in Excel | Export |
| **T-16** | CSV export — mixed | 2 paid + 1 comp | CSV with 3 rows; comp row Status="Comp", note populated, Order ID has "cg_" prefix | Export |
| **T-17** | CSV export — refund | 1 paid + 1 refunded order | CSV Status column shows "Paid" for one and "Refunded" for the other | Export |
| **T-18** | CSV export — special chars (RFC 4180) | Buyer "O'Brien, Jr. \"VIP\"" + note "Note with\nnewline" | CSV preserves comma + quotes + newline via RFC 4180 escape; opens in Excel without column shift | Export |
| **T-19** | Logout cascade | Sign out from operator | useGuestStore.entries === [] post-logout | Const #6 |
| **T-20** | Cold-start hydration | Add comp → kill app → reopen | Comp persists, J-G1 renders correctly | Const #14 |
| **T-21** | Keyboard visibility — J-G3 | Open search, focus input on iOS + Android + Web | Input remains visible above keyboard | Memory rule |
| **T-22** | Keyboard visibility — J-G4 | Open AddCompGuestSheet, focus name + email + reason inputs sequentially | All inputs remain visible above keyboard | Memory rule |
| **T-23** | tsc clean | `cd mingla-business && npx tsc --noEmit` | Exit 0 | Static |
| **T-24** | No dead taps | Tap every button on J-G1, J-G2, J-G4 sheet, J-G5 toggle | Every tap responds (toast or navigation or state change) | Const #1 |
| **T-25** | Filter-pills regression | Inspect J-G3 search bar UI + grep code | NO filter pills rendered, `grep -rn "FilterPill" mingla-business/app/event/\[id\]/guests/` returns 0 | Hard-line check |
| **T-26** | Selector-pattern check | Read all useGuestStore consumers | All multi-entry reads use raw-entries + useMemo, no fresh-array selectors directly subscribed | Static |
| **T-27** | Buyer-route regression | grep `app/o/`, `app/e/` for `privateGuestList` + `useGuestStore` | 0 hits | I-21, I-25, I-26 |
| **T-28** | Activity feed visibility | After T-04, T-08, T-13 — open Event Detail Recent Activity card | Each operation produces a visible row (not filtered out by Cycle 9c-2's orderId filter) | Activity feed wire |
| **T-29** | Cross-event scoping | Operator has 2 events; comp added to Event A | J-G1 for Event B does NOT show the comp; J-G1 for Event A does | Selector scoping |
| **T-30** | Purchase history scoping | Buyer "x@y.com" has orders for brand A (this event + another) and brand B | J-G2 OTHER ORDERS section shows brand A other-event order, NOT brand B order | Selector scoping |
| **T-31** | Comp deduplication via email | Add 2 comps with same email | Both render as separate rows (no dedup); operator can remove either independently | Store integrity |
| **T-32** | Operator account_id audit | Add comp logged in as Operator A; switch to Operator B (sign out + in) | New login does NOT see Operator A's comps (logout cascade per T-19); J-G2 if a comp survived would show "Added by Operator A" not "you" | Audit + auth |

---

## 8 — Invariants

### 8.1 Existing invariants this cycle preserves

| ID | Statement | How preserved | Test |
|----|-----------|---------------|------|
| **I-19** | Immutable order financials | Cycle 10 NEVER mutates OrderRecord. Comp guests in separate store. | T-26 + manual code review |
| **I-20** | Edit reason mandatory + audit log permanence | J-G4 + J-G5 + comp removal all require operator-provided reason 10..200 chars. | T-04 + T-08 + T-13 |
| **I-21** | Anon-tolerant buyer routes | Cycle 10 introduces ZERO buyer routes. SPEC + IMPL must NOT add anything to `app/o/` or `app/e/`. | T-27 |
| **Const #1** | No dead taps | Every interactive element responds. | T-24 |
| **Const #2** | One owner per truth | `useGuestStore` is sole authority for comp guests. | T-26 |
| **Const #6** | Logout clears everything | `useGuestStore.reset()` wired in `clearAllStores.ts`. | T-19 + SC-20 |
| **Const #8** | Subtract before adding | Replace `handleGuests` toast stub with real `router.push`; do NOT layer new code on top. | Code review |
| **Const #9** | No fabricated data | Empty states show genuine empty copy. | T-01 + T-11 |
| **Const #10** | Currency-aware UI | Amounts use existing `formatGbp`. CSV Status column doesn't embed currency. | Code review |
| **Const #14** | Persisted-state startup | `useGuestStore` Zustand persist hydrates cleanly on cold start. | T-20 |

### 8.2 NEW invariants this cycle establishes

#### I-25 — Comp guests live in `useGuestStore.compEntries` ONLY

**Statement:** Comp guests live in `useGuestStore.entries` only — NEVER as phantom OrderRecord rows. `CheckoutPaymentMethod` union NEVER includes `"comp"`. Future cycles that introduce manual-add features MUST extend `useGuestStore` (or its B-cycle backend equivalent), NEVER fabricate orders.

**Origin:** Cycle 10 (2026-05-02)
**Enforcement:** Convention + static check (T-26 + SC-21)
**Reason:** I-19 requires write-once order financials. Comp guests are operator-created and don't pay — calling them orders is a category error that cascades into checkout-flow type checks that don't make sense for a non-purchase. Cycle 10's separate-`useGuestStore` strategy keeps semantics clean.

#### I-26 — `LiveEvent.privateGuestList` is operator-only flag with zero buyer-surface impact in Cycle 10

**Statement:** `LiveEvent.privateGuestList` is a UI flag introduced in Cycle 10 that affects NO buyer-facing surface in Cycle 10. Future cycles that add buyer surfaces (e.g., guest-list preview on `/o/[orderId]`) MUST honor this flag — when `true`, hide attendee count or show only "you're confirmed" — but Cycle 10 SPEC + IMPL must NOT preempt that surface.

**Origin:** Cycle 10 (2026-05-02)
**Enforcement:** Static check (T-27 + SC-22)
**Reason:** Buyer-side guest-list-preview is its own cycle decision (locked decision #7 — operator-only Cycle 10). Pre-implementing the buyer surface from this cycle would couple two design decisions that should remain independent.

**Implementor pre-flight:** confirm next-available invariant numbers in `Mingla_Artifacts/INVARIANT_REGISTRY.md` before locking I-25 / I-26 IDs. If those numbers are already taken (by ORCH-0706 or ORCH-0708 work in flight), bump to next free. Document in implementation report §"Invariants Registered".

---

## 9 — Implementation order

The implementor should follow this sequence. Each step lists exact files to create or modify.

1. **Type extensions** (no new files yet — pure additions):
   - `mingla-business/src/store/draftEventStore.ts` — add `privateGuestList: boolean` to DraftEvent + `INITIAL_DRAFT`
   - `mingla-business/src/store/liveEventStore.ts` — add to `LiveEvent` + `LiveEventEditableFieldKey` union
   - `mingla-business/src/utils/liveEventConverter.ts` — add to draft→live conversion
   - `mingla-business/src/utils/liveEventAdapter.ts` — 4 additions (snapshot extract, label map, editable keys array, diff detector)
   - `mingla-business/src/components/event/ChangeSummaryModal.tsx` — add label map entry
   - **Verify:** `npx tsc --noEmit` exits 0 before continuing.

2. **Create `useGuestStore`** (new file):
   - `mingla-business/src/store/guestStore.ts` — full implementation per §4.4
   - **Verify:** import works in a quick sandbox file (delete after); tsc clean.

3. **Wire logout cascade**:
   - `mingla-business/src/utils/clearAllStores.ts` — add `useGuestStore.getState().reset()` call

4. **Pre-flight `/ui-ux-pro-max` for J-G1 + J-G4** (memory rule mandate):
   - Run before writing component code: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "operator guest list ticket organiser dark glass card" --domain product`
   - Apply findings to component design before writing code.

5. **AddCompGuestSheet (J-G4)** (new file):
   - `mingla-business/src/components/guests/AddCompGuestSheet.tsx` per §5/J-G4

6. **Guest list view (J-G1)** (new file):
   - `mingla-business/app/event/[id]/guests/index.tsx` per §5/J-G1
   - **Verify:** route resolves, search bar toggles, EmptyState renders on empty, comp add via "+" button creates entry visible in list.

7. **Guest detail (J-G2)** (new file):
   - `mingla-business/app/event/[id]/guests/[guestId].tsx` per §5/J-G2
   - Separate composite-ID parsing logic (`{kind}-{innerId}` format)
   - **Verify:** order-kind resolves, comp-kind resolves, malformed param shows EmptyState.

8. **EditPublishedScreen + EventManageMenu (J-G5)**:
   - `mingla-business/src/components/event/EditPublishedScreen.tsx` — add toggle row
   - `mingla-business/src/components/event/EventManageMenu.tsx` — optional shortcut (operator's call; document if deferred)

9. **CSV export (J-G6)**:
   - `mingla-business/src/utils/guestCsvExport.ts` (new file) — utility functions
   - Add export button to J-G1 chrome with handler

10. **Wire `handleGuests` stub replacement**:
    - `mingla-business/app/event/[id]/index.tsx` — replace toast with `router.push(\`/event/${id}/guests\` as never)`. SUBTRACT the toast (Const #8 — don't leave it as dead code).
    - `mingla-business/app/(tabs)/events.tsx` — verify if it has an equivalent stub; replace likewise.

11. **Verification matrix**:
    - `cd mingla-business && npx tsc --noEmit` → exit 0 (T-23 / SC-15)
    - Manual smoke: T-01 through T-32 (operator runs)
    - `grep` checks per SC-5, SC-17, SC-21, SC-22

12. **Implementation report**:
    - `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`
    - Per `references/report-template.md` 15-section template
    - Old → New receipts for every file changed
    - Spec traceability: each SC mapped to verification step
    - Invariant registrations: I-25 + I-26 with confirmed final IDs
    - Discoveries for orchestrator: any side issues found
    - Memory rule deference: confirm `/ui-ux-pro-max` was invoked pre-flight on J-G1 + J-G4

---

## 10 — Regression prevention

For the class of bugs this cycle could introduce:

| Risk | Structural safeguard | Test that catches recurrence |
|------|----------------------|------------------------------|
| Filter pills sneak back in | Hard-line in §3.2 + memory rule reference + grep test T-25/SC-5 | T-25 + SC-5 fail if any `FilterPill` import or component appears |
| Comp guests fabricated as phantom orders | I-25 invariant + grep test SC-21 | SC-21 fails if `paymentMethod: "comp"` appears |
| Buyer-facing surface introduced accidentally | I-26 invariant + grep test SC-22 + I-21 protection | T-27 + SC-22 fail if `app/o/` or `app/e/` references `useGuestStore` or `privateGuestList` |
| Fresh-array selector pattern returns | Selector rule documented in `useGuestStore` header doc + grep test SC-19 | SC-19 / T-26 fail if any direct subscription to `getCompEntriesForEvent` appears |
| Activity feed entries silently filtered out | `orderId === undefined` rule documented in §4.6 + T-28 covers visibility | T-28 fails if any J-G4 / J-G5 / comp-remove entry doesn't appear in Recent Activity |
| Logout doesn't clear comps | Const #6 + SC-20 + T-19 | T-19 fails if logout doesn't reset `useGuestStore.entries` |
| Cold-start state drift | Const #14 + T-20 | T-20 fails if persisted state doesn't hydrate |
| Cross-event comp leakage | Selector scoping in J-G1 (filter by `eventId === id`) + T-29 | T-29 fails if Event A's comps appear in Event B's J-G1 |
| Cross-brand purchase history leakage | Selector scoping in J-G2 (filter by `brandId === order.brandId`) + T-30 | T-30 fails if cross-brand orders appear in OTHER ORDERS section |

**Protective comments required in code:**

- `useGuestStore.ts` header: I-25 statement verbatim
- `liveEventStore.ts` near `privateGuestList` field: `// I-26 — operator-only flag; buyer surfaces honor this when added (NOT in Cycle 10)`
- `recentActivity` useMemo in `app/event/[id]/index.tsx` (already commented from Cycle 9c-2): no change needed; the existing `orderId === undefined` filter is the protection.

---

## 11 — Cross-references

- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_10_GUEST_LIST.md`](../reports/INVESTIGATION_BIZ_CYCLE_10_GUEST_LIST.md)
- Dispatch: [`prompts/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](../prompts/SPEC_BIZ_CYCLE_10_GUEST_LIST.md)
- PRD source: `Mingla_Artifacts/BUSINESS_PRD.md` §5.3
- Cycle 9c v2 (selector pattern lessons): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md)
- Cycle 9c v3 (activity feed wire J-G4 / J-G5 piggyback): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md)
- Cycle 9c-2 (event_edit kind in activity feed; commit `5e4b04d2` on `Seth`)
- ORCH-0704 edit-log infrastructure: [`reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md)
- Sister sheet pattern (J-G4 mirrors): `mingla-business/src/components/orders/RefundSheet.tsx`
- Sister list pattern (J-G1 mirrors): `mingla-business/app/event/[id]/orders/index.tsx`
- Sister detail pattern (J-G2 mirrors): `mingla-business/app/event/[id]/orders/[oid]/index.tsx`
- Memory rule: `feedback_keyboard_never_blocks_input` — keyboard avoidance non-negotiable
- Memory rule: `feedback_rn_color_formats` — hex/rgb/hsl/hwb only, no oklch
- Memory rule: `feedback_implementor_uses_ui_ux_pro_max` — pre-flight design step REQUIRED on J-G1 + J-G4
- Memory rule: `feedback_anon_buyer_routes` — no buyer surfaces in Cycle 10
- PR #59 schema (informational only — Cycle 10 doesn't write to backend): head `836ce108054800aba1573d8bc30684f5728a86ce`

---

## 12 — Output contract for the implementor

Implementor produces TWO things:

1. **Code changes** per §9 implementation order
2. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`

The report MUST include:

- Old → New receipts for every file modified or created
- SC-1..SC-22 verification matrix with PASS / UNVERIFIED labels per SC
- Invariant registrations: confirmed final I-25 / I-26 IDs in `INVARIANT_REGISTRY.md`
- Memory rule deference proof: state that `/ui-ux-pro-max` was invoked pre-flight on J-G1 + J-G4
- Discoveries for orchestrator (side issues found during IMPL — register, don't fix)
- Constitutional compliance scan
- Regression surface (3-5 adjacent features tester should spot-check)

Implementor MUST NOT:

- Re-debate any locked decision from §2
- Add scope beyond §3.1
- Touch backend / RLS / edge functions
- Skip the `/ui-ux-pro-max` pre-flight requirement on J-G1 + J-G4
- Silently override an invariant — surface to operator if conflict arises

If the spec is wrong or contradicts what the implementor finds in code: STOP. State the contradiction. Wait for direction.
