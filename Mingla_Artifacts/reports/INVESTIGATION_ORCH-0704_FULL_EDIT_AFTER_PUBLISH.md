# Investigation — ORCH-0704 — Full Edit-After-Publish + Buyer Protection

**Date:** 2026-05-02
**Author:** mingla-forensics
**Mode:** INVESTIGATE-THEN-SPEC (this file = investigation half; spec lives at [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md))
**Confidence:** HIGH
**Supersedes:** narrow Cycle 9b-2 (description + coverHue only)

---

## 1 — Symptom & charter

The narrow Cycle 9b-2 implementation (uncommitted in working tree) ships a single-screen `EditPublishedScreen` that only lets organisers edit `description` and `coverHue` on a published event. Operator hit the wall: real organisers must be able to fix any post-publish mistake — wrong address, mispriced tier, missing FAQ, need to add a VIP tier, capacity wrong, contact info wrong. Locking them out is unshippable.

But uncapped edit power on a published event collides with buyers who have already paid: an organiser could "update" the price they paid, "delete" the tier they bought, or "drop capacity" below the sold count. Those collisions need explicit rules.

**Operator's steering decisions (locked 2026-05-02):**

1. Material-change buyer notification → stub as a banner on the buyer's order detail page; real email/push waits for 9c.
2. Full event edit allowed; existing orders lock their financials.
3. Capacity drop below sold count → blocked hard.
4. No-show + post-event ops → split to **ORCH-0705**, post-Stripe integration. Out of scope here (must-do, registered).

This investigation catalogs every editable field on LiveEvent, classifies by buyer-protection risk, identifies the order-shape gap, decides the wizard-reuse strategy, and lists every narrow-9b-2 file to subtract.

---

## 2 — Investigation Manifest

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9b2_EDIT_AFTER_PUBLISH.md` | What narrow 9b-2 built + why it's too narrow |
| 2 | `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` | Original Cycle 9 forensics — Q-9-5 conservative defaults (now overridden) |
| 3 | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` | Cycle 9 spec — §3.B (J-E11) section now obsolete |
| 4 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | I-11..I-17 registered; I-18 DRAFT (Cycle 8); propose I-19 in spec |
| 5 | `Mingla_Artifacts/DECISION_LOG.md` | DEC-079 kit closure, DEC-085 portal, DEC-086 separate website; propose DEC-087 |
| 6 | `mingla-business/src/store/liveEventStore.ts` | LiveEvent shape (full); current narrow `updateLiveEventEditableFields` |
| 7 | `mingla-business/src/store/draftEventStore.ts` (lines 1-300) | DraftEvent shape, TicketStub shape, store mutations |
| 8 | `mingla-business/src/components/event/EventCreatorWizard.tsx` (lines 1-280) | 769 LOC wizard root — coupling assessment |
| 9 | `mingla-business/src/components/event/types.ts` | StepBodyProps contract — step bodies are decoupled from store |
| 10 | `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (lines 1-100) | Tier UI — confirms ticket-edit lives in this body component |
| 11 | `mingla-business/src/components/event/EditPublishedScreen.tsx` (current narrow 9b-2) | Subtract candidate |
| 12 | `mingla-business/src/components/event/EditAfterPublishBanner.tsx` (current narrow 9b-2) | Reusable; expand copy |
| 13 | `mingla-business/src/components/event/ChangeSummaryModal.tsx` (current narrow 9b-2) | Reusable; enrich differ |
| 14 | `mingla-business/src/utils/liveEventToEditPatch.ts` (current narrow 9b-2) | Subtract — replaced by richer differ |
| 15 | `mingla-business/app/event/[id]/edit.tsx` | `?mode=edit-published` branch (narrow 9b-2 wired); KEEP routing, REWIRE target |
| 16 | `mingla-business/app/checkout/[eventId]/confirm.tsx` | Confirmation screen — reads live event for displayable fields ✅ correct pattern |
| 17 | `mingla-business/src/components/checkout/CartContext.tsx` | Cycle 8 cart shape — `OrderResult`, `CartLine` (with snapshot fields), `BuyerDetails` |
| 18 | `mingla-business/src/utils/stubOrderId.ts` | QR payload format — opaque IDs only (no event details encoded) |
| 19 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | Public event page subscribes to `useLiveEventBySlug` — auto-rerenders on edit |
| 20 | `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md` | This dispatch |

---

## 3 — Findings

### 🔵 OBS-704-1 — Step bodies are decoupled from `useDraftEventStore`

**File:** `mingla-business/src/components/event/types.ts:14-33`
**Code:**
```ts
export interface StepBodyProps {
  draft: DraftEvent;
  updateDraft: (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>) => void;
  errors: ValidationError[];
  showErrors: boolean;
  onShowToast: (message: string) => void;
  scrollToBottom: () => void;
}
```
**Why this matters:** The 7 `CreatorStepN` components each accept `draft + updateDraft` via props. They DO NOT directly call `useDraftEventStore`. The wizard root (EventCreatorWizard.tsx:146-149) is the only thing tied to the persisted draft store — selecting `liveDraft`, `updateDraft`, `setLastStep`, `deleteDraft`, `publishDraft`.

**Implication:** Step body components are reusable in any host that satisfies StepBodyProps. We can build a parallel `EditPublishedScreen` that holds local edit state in `useState` (shadow-state pattern) and passes it + a local setter to the same step body components. No fork of CreatorStepN files. No refactor of EventCreatorWizard root.

**Verification:** grep `useDraftEventStore` inside step body files:
- Step1Basics: 0 hits (uses `errorForKey` from types.ts only)
- Step2When: 0 hits
- Step3Where: 0 hits
- Step4Cover: 0 hits
- Step5Tickets: 0 hits (imports `TicketStub` type from store, that's it)
- Step6Settings: 0 hits
- Step7Preview: 0 hits

All step bodies are pure prop-driven components. **This is the unlock.**

### 🔵 OBS-704-2 — LiveEvent and DraftEvent share every editable field

**File:** `mingla-business/src/store/liveEventStore.ts:43-83` vs `mingla-business/src/store/draftEventStore.ts:187-245`

Side-by-side editable fields (excluding identity + lifecycle metadata):

| Field | DraftEvent | LiveEvent | Same shape? |
|-------|-----------|-----------|-------------|
| `name` | ✅ string | ✅ string | YES |
| `description` | ✅ string | ✅ string | YES |
| `format` | ✅ DraftEventFormat | ✅ DraftEventFormat | YES |
| `category` | ✅ string \| null | ✅ string \| null | YES |
| `whenMode` | ✅ WhenMode | ✅ WhenMode | YES |
| `date` | ✅ string \| null | ✅ string \| null | YES |
| `doorsOpen` | ✅ string \| null | ✅ string \| null | YES |
| `endsAt` | ✅ string \| null | ✅ string \| null | YES |
| `timezone` | ✅ string | ✅ string | YES |
| `recurrenceRule` | ✅ RecurrenceRule \| null | ✅ RecurrenceRule \| null | YES |
| `multiDates` | ✅ MultiDateEntry[] \| null | ✅ MultiDateEntry[] \| null | YES |
| `venueName` | ✅ string \| null | ✅ string \| null | YES |
| `address` | ✅ string \| null | ✅ string \| null | YES |
| `onlineUrl` | ✅ string \| null | ✅ string \| null | YES |
| `hideAddressUntilTicket` | ✅ boolean | ✅ boolean | YES |
| `coverHue` | ✅ number | ✅ number | YES |
| `tickets` | ✅ TicketStub[] | ✅ TicketStub[] | YES |
| `visibility` | ✅ DraftEventVisibility | ✅ DraftEventVisibility | YES |
| `requireApproval` | ✅ boolean | ✅ boolean | YES |
| `allowTransfers` | ✅ boolean | ✅ boolean | YES |
| `hideRemainingCount` | ✅ boolean | ✅ boolean | YES |
| `passwordProtected` | ✅ boolean | ✅ boolean | YES |

**Implication:** Reusing the wizard step bodies is mechanically clean. Their input prop `draft: DraftEvent` reads ONLY the shared editable subset. We can wrap a LiveEvent into a "DraftEvent-shaped" view object via a thin adapter (no schema bumps, no data conversion — just a type assertion against a shared subset).

The DraftEvent-only fields (`lastStepReached`, `status: DraftEventStatus`) are wizard-internal state and can be stubbed:
- `lastStepReached`: 0 (sectioned UI doesn't use it)
- `status`: `"live"` (won't trigger publish-draft logic; we never call `publishDraft` from edit mode)

### 🔵 OBS-704-3 — QR payload encodes opaque IDs only

**File:** `mingla-business/src/utils/stubOrderId.ts:47-48`
**Code:**
```ts
export const buildQrPayload = (orderId: string, ticketId: string): string =>
  `mingla:order:${orderId}:ticket:${ticketId}`;
```
**Implication:** Operator edits to event details have ZERO impact on existing QR codes. The door scanner (Cycle 11) will look up live event + frozen order data. No QR regeneration is needed when fields change. This decouples the buyer-protection problem from any cryptographic concern.

### 🔵 OBS-704-4 — Public event page auto-rerenders on edit

**File:** `mingla-business/app/e/[brandSlug]/[eventSlug].tsx:30-33`
**Code:** Uses `useLiveEventBySlug(brandSlug, eventSlug)` which subscribes to `useLiveEventStore`. Any mutation re-renders. ✅ correct.
**Confirmation screen** (`confirm.tsx:76-78`) similarly reads `useLiveEventStore((s) => s.events.find...)`. Same auto-rerender behavior.

**Implication:** Buyer-side displays already use the LIVE-READ pattern. Frozen financial fields (`unitPriceGbp`, `ticketName`) are in `CartLine` (snapshot at selection time per CartContext.tsx:34-42). The architecture is already correctly split between live-read for displayable info and snapshot for financials.

### 🔴 RC-704-1 — Narrow `updateLiveEventEditableFields` rejects all the fields organisers actually need

**File:** `mingla-business/src/store/liveEventStore.ts:160-177`
**Code:**
```ts
updateLiveEventEditableFields: (id, patch): void => {
  const safePatch: Partial<Pick<LiveEvent, "description" | "coverHue">> = {};
  if (patch.description !== undefined) {
    safePatch.description = patch.description;
  }
  if (patch.coverHue !== undefined) {
    safePatch.coverHue = patch.coverHue;
  }
  if (Object.keys(safePatch).length === 0) return;
  // ...
}
```
**What it does:** Defense-in-depth filter that silently drops every field except `description` and `coverHue`.
**What it should do:** Accept the full editable patch — name, format, category, whenMode, date, doorsOpen, endsAt, timezone, recurrenceRule, multiDates, venueName, address, onlineUrl, hideAddressUntilTicket, coverHue, tickets, visibility, requireApproval, allowTransfers, hideRemainingCount, passwordProtected, description.
**Causal chain:** Operator → narrow `EditPublishedScreen` → exposes only 2 fields → narrow store mutation only accepts 2 fields → operator stuck → operator's 4 steering decisions DEMAND the full surface.
**Verification step:** Run the narrow flow today: open Edit on a live event → only description + cover-hue are editable → user pain confirmed.

### 🔴 RC-704-2 — No tier-sales tracking exists; capacity / price guard rails have no signal

**File:** `mingla-business/src/components/checkout/CartContext.tsx:62-67`
**Code:**
```ts
export interface CartState {
  lines: CartLine[];
  buyer: BuyerDetails;
  result: OrderResult | null;
}
```
**What it does:** Cycle 8 cart state is **in-memory React Context only**. `OrderResult` is populated post-purchase but lives only for the buyer's tab session. Closing the tab discards it.
**What it should do (forward-looking):** Persist OrderResult to a `useOrderStore` (Zustand persisted, eventId-keyed) at confirmation entry. This is exactly Q-9-2 option B from Cycle 9 forensics — it's already specced as a 1-line addition in `confirm.tsx`, planned for Cycle 9c.
**Causal chain:** No persisted orders → can't compute `soldCountByTier(eventId, ticketTypeId)` → can't enforce capacity floor → can't lock tier prices when sold>0 → can't block tier delete when sold>0.
**Verification step:** grep `useOrderStore` in mingla-business/ — 0 hits. Cycle 9 forensics Cycle 9 §6 Blast Radius row 11 confirms the store doesn't exist yet.

**Resolution path (per orchestrator's decision):** ORCH-0704 specifies the order-snapshot SHAPE + the guard-rail formulas; **ORCH-0705 / Cycle 9c** wires `useOrderStore` and the `confirm.tsx` integration. Until 9c lands, ORCH-0704 ships with a stub helper `getSoldCountByTier()` that returns 0 (clearly TRANSITIONAL-labeled). Operator can edit prices freely in stub mode — there are no real buyers yet, so the guard rails never fire. Once 9c lands, the guard rails become live with no further code changes to ORCH-0704's edit UI.

### 🟠 CF-704-1 — Order snapshot fields aren't fully frozen at the cart layer today

**File:** `mingla-business/src/components/checkout/CartContext.tsx:34-42`
**Code:**
```ts
export interface CartLine {
  ticketTypeId: string;
  ticketName: string;       // snapshot ✅
  quantity: number;
  unitPriceGbpAtPurchase: number;  // ❌ missing
  unitPriceGbp: number;     // current per-cart-mutation; not "at-purchase"
  isFree: boolean;
}
```
**What it does:** `CartLine.unitPriceGbp` is set when the buyer adjusts quantities. If the operator changes the tier price BETWEEN buyer-tier-selection and buyer-checkout-completion (mid-flight), the cart line still holds the price the buyer saw. ✅ correct.
**What's missing:** `OrderResult` (line 54-60 of CartContext) only stores `orderId, ticketIds, paidAt, paymentMethod, totalGbp`. It does NOT carry the per-line snapshot. The post-purchase `confirm.tsx` re-reads `lines` from CartContext and `event` LIVE — so if the tab stayed open, it shows lines correctly, but if the order is later persisted to `useOrderStore` (9c), the persistence layer needs to copy the cart lines INTO the order record.
**Implication:** ORCH-0704 spec must define the persisted order shape with explicit per-line snapshots, so 9c implementor doesn't lose the data. The shape: `OrderRecord.lines[].ticketNameAtPurchase`, `OrderRecord.lines[].unitPriceGbpAtPurchase`, `OrderRecord.lines[].isFreeAtPurchase`. Each is write-once at insertion to useOrderStore.
**Why contributing factor (not root cause):** The CartLine carries the right data; only the persistence layer hasn't been built yet. Spec must lock the shape so 9c builds it correctly first time.

### 🟡 HF-704-1 — Recurrence + multi-date schemas can produce ambiguous edits

**File:** `mingla-business/src/store/draftEventStore.ts:135-184`
**Concern:** Editing `whenMode` post-publish (e.g., switching `single` → `recurring`) breaks every existing buyer's mental model — they bought "an event on March 15" and now it's "every Friday." Editing `recurrenceRule` after publish creates ambiguity about which occurrences existing tickets belong to. Editing individual `multiDates[]` entries is fine if the buyer's purchase isn't tied to a specific date (today's checkout flow is event-level, not date-level).
**What ORCH-0704 must do:** LOCK `whenMode` post-publish. LOCK `recurrenceRule` post-publish (if any tickets sold; if zero sold, allow). For multi-date events, allow ADDING new dates freely; allow EDITING individual date times/venues; LOCK removing a date if any orders exist (deferred per-date order tracking is post-MVP — block all date removal once any sale exists, conservative).
**Why hidden flaw:** If implementor reflexively allows editing `whenMode` because the wizard supports it, the entire occurrence model collapses. Spec calls this out explicitly under "constrained" risk bucket.

### 🟡 HF-704-2 — `format` change is a material change, not a free edit

**File:** `mingla-business/src/store/liveEventStore.ts:57` `format: DraftEventFormat;`
**Concern:** Switching `in_person` → `online` (or vice versa) is genuinely common (event moved virtual due to weather; in-person added late). But it's a MATERIAL change — buyers expected to physically attend may now need a Zoom link. Buyers with a Zoom link may now need a physical address. The buyer's order detail page must surface this.
**What ORCH-0704 must do:** Classify `format` as 🟡 MATERIAL (push + notify), same as date/venue/address.
**Why hidden flaw:** If implementor lumps `format` into the silent-push bucket (just an attribute change), buyers get no signal that their attendance plan needs revision.

### 🟡 HF-704-3 — Step 5 (Tickets) needs price-lock UX for tiers with sales

**File:** `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (1874 LOC; TicketSheet edits each tier's price/capacity/etc.)
**Concern:** In edit-published mode, when operator opens TicketSheet for a tier with `soldCount > 0`:
- Price field MUST be disabled with helper text "Existing buyers locked at £X. Change applies to new buyers only."
- Capacity field MUST validate `>= soldCount` with inline error
- Delete button on tier card MUST be hidden/disabled with helper "X tickets sold — stop selling instead."
- Free toggle MUST be disabled (free → paid would create financial inconsistency)

Step 5 today doesn't accept any "edit-published" context. It needs a new optional prop on `StepBodyProps` (or a wrapper) carrying `editMode?: { soldCountByTier: Record<string, number> }`. Default undefined = create mode (no constraints).

**What ORCH-0704 must do:** Extend `StepBodyProps` interface with optional `editMode?: { soldCountByTier: Record<string, number> }`. ONLY Step 5 reads it (other steps' guard rails are implemented at the host screen level, not in step bodies). Document this as the API extension point in spec.
**Why hidden flaw:** If implementor builds full edit without this gate, operator can change tier price post-purchase, breaking buyer-protection invariant I-19.

### 🟡 HF-704-4 — `coverHue` accepts free-text number; design-package picker uses 6 hue tiles

**File:** `mingla-business/src/components/event/CreatorStep4Cover.tsx`
**Concern:** Step 4 is the canonical hue picker (6 tiles). The narrow 9b-2 EditPublishedScreen mirrors this. When we reuse Step 4 in the new sectioned screen, behavior is identical — minor consistency win.
**What ORCH-0704 must do:** Reuse Step 4 unchanged. (Just confirming no surprise.)

### 🟡 HF-704-5 — Material-change banner has no rendering surface today

**Concern:** Per orchestrator decision #1, a material-change banner is supposed to appear on the buyer's order detail page when `event.updatedAt > order.lastSeenEventUpdatedAt` AND any material field differs. But the buyer's order detail page does NOT EXIST today — `confirm.tsx` is one-shot in-memory. The persistent buyer order detail page is a forward-looking surface.
**What ORCH-0704 must do:** SPEC the banner detection algorithm + copy + acknowledge mechanism. DEFER the actual rendering to 9c (which builds `useOrderStore` and presumably an `app/order/[orderId].tsx` buyer-facing route).
**Why hidden flaw:** If implementor builds the banner and there's nowhere to render it, the work is wasted. If spec doesn't define the algorithm, 9c implementor will re-derive it.

### 🟡 HF-704-6 — `oklch()` rejection trap is permanent for all RN inline-style colors

**Memory rule:** `feedback_rn_color_formats.md` — codified after Cycle 7 FX2 cover-band invisibility bug.
**Implication for ORCH-0704:** All inline-style hue/color usage must use `hsl(hue, 60%, 45%)` per the wizard's `EventCover` pattern. The Step 4 picker already complies. Just flagging so the implementor doesn't introduce regressions.

### 🔵 OBS-704-5 — Event detail screen + manage menu wiring needs no change

**Files:**
- `mingla-business/app/event/[id]/index.tsx:handleEdit` — already pushes `/event/${id}/edit?mode=edit-published`
- `mingla-business/app/(tabs)/events.tsx:handleManageEdit` — already conditionally appends `?mode=edit-published` for non-drafts
- `mingla-business/app/event/[id]/edit.tsx` — already branches on `?mode=edit-published`
- `mingla-business/src/components/event/EventManageMenu.tsx` — already removed TRANSITIONAL toast

**Implication:** Routing is correct; ORCH-0704 only needs to swap the renderer at `edit.tsx` from the narrow `EditPublishedScreen` to the new sectioned one.

---

## 4 — Field-by-Field Risk Catalog (LiveEvent)

This is the master matrix. The spec encodes these rules as the canonical edit contract.

### 🟢 SAFE — push to all (edit freely; existing buyers see updated value live)

| Field | Type | Why safe |
|-------|------|----------|
| `name` | string | Material info but the order snapshot freezes ticket name; event name rename = "renamed event" not "different event." Buyer sees new name on confirmation/QR scan; not financially material. **(See note)** |
| `description` | string | Pure content; never material to financial obligation |
| `coverHue` | number (0-360) | Cosmetic only |
| `category` | string \| null | Content tag; no buyer-facing legal weight |
| `hideAddressUntilTicket` | boolean | Privacy preference; doesn't change underlying address |
| `requireApproval` | boolean | Affects FUTURE buyers only (existing approved orders stay) |
| `hideRemainingCount` | boolean | Cosmetic |

**Note on `name`:** the operator's steering decision was "full editing" with buyer protection where money is involved. Name doesn't move money. Spec keeps name in 🟢 SAFE bucket but RECOMMENDS a soft "you renamed your event" line on the buyer's order detail page (not blocking, just informational). Treat as non-material.

### 🟡 MATERIAL — push + notify (edit freely; banner appears on buyer's order detail page)

| Field | Type | Why material |
|-------|------|-------------|
| `format` | "in_person" \| "online" \| "hybrid" | Attendance plan changes (HF-704-2) |
| `whenMode` | WhenMode | Conceptual — but LOCKED post-publish (HF-704-1) — see Constrained bucket |
| `date` | string \| null | Buyer needs to know the new date |
| `doorsOpen` | string \| null | Buyer needs to know the new time |
| `endsAt` | string \| null | Buyer needs to know the new end time |
| `timezone` | string | Affects every displayed time |
| `multiDates` | MultiDateEntry[] \| null | Per-date times/venues changing affects buyer |
| `venueName` | string \| null | Buyer needs to know where to go |
| `address` | string \| null | Buyer needs to know where to go |
| `onlineUrl` | string \| null | Buyer needs to know where to join |
| `tickets[i].name` (existing tier) | string | Frozen on order snapshot; buyer sees old name on their order, new name on event page. Renaming doesn't break orders, but flagging as material because tier identity is contractual |
| `tickets[i].description` (existing tier) | string \| null | Material content — what they paid for |
| `tickets[i].saleStartAt` / `saleEndAt` | string \| null | Affects future buyers, not material to existing |

### 🟠 SENSITIVE — future-buyer only (edit allowed; existing orders lock)

| Field | Type | Rule |
|-------|------|------|
| `tickets[i].priceGbp` (existing tier with sales) | number \| null | DISABLED in TicketSheet when soldCountForTier > 0; helper text "Existing buyers locked at £X. Change applies to new buyers." Operator can ADD a NEW tier at any price freely (it has no sales yet). |
| `tickets[i].isFree` (existing tier with sales) | boolean | DISABLED when soldCountForTier > 0 (free→paid or paid→free creates inconsistency) |
| `tickets[i].minPurchaseQty` / `maxPurchaseQty` (existing tier with sales) | number / number\|null | EDITABLE — but only enforced for NEW buyers. Existing orders unaffected. |
| `tickets[i].approvalRequired` (existing tier with sales) | boolean | EDITABLE for future; existing orders' approval state preserved |
| `tickets[i].passwordProtected` / `password` | boolean / string\|null | EDITABLE freely (gates future buyers; existing orders already past the gate) |
| `tickets[i].waitlistEnabled` | boolean | EDITABLE freely |
| `tickets[i].allowTransfers` | boolean | EDITABLE freely (forward only) |
| `tickets[i].visibility` | "public" \| "hidden" \| "disabled" | EDITABLE freely; "disabled" = stop-selling (existing orders preserved) |
| `tickets[i].displayOrder` | number | Cosmetic; freely editable |
| `allowTransfers` (event-level) | boolean | EDITABLE freely (forward only) |
| `passwordProtected` (event-level) | boolean | EDITABLE freely (forward only) |
| `visibility` (event-level) | "public" \| "unlisted" \| "private" | EDITABLE freely; future buyers gated by new value, existing buyers unaffected |

### 🔴 CONSTRAINED — guard-railed (editable with hard blocks)

| Field | Type | Hard block |
|-------|------|-----------|
| `tickets[i].capacity` (existing tier) | number \| null | MUST be >= `soldCountForTier(eventId, ticket.id)`. Inline error: "Can't go below N tickets sold. Increase capacity or stop selling instead." |
| `tickets[i].isUnlimited` (existing tier with sales) | boolean | DISABLED when soldCountForTier > 0 (can't toggle unlimited→capped without setting a floor; can't toggle capped→unlimited if "stop selling" was the intent) — OK to allow; depends on UX choice, recommend disabled for safety |
| Tier delete (existing tier with sales) | — | DELETE button hidden/disabled when soldCountForTier > 0. Helper: "N tickets sold — stop selling this tier instead of deleting." |
| `whenMode` (post-publish, with sales) | WhenMode | LOCKED. Switching modes breaks the occurrence contract. If `soldCountForEvent === 0`, allow. |
| `recurrenceRule` (post-publish, with sales) | RecurrenceRule \| null | LOCKED. If `soldCountForEvent === 0`, allow. |
| `multiDates[]` array — REMOVE entry (post-publish, with sales) | — | LOCKED if any orders exist for the event (per-date sales tracking is deferred). ADD/EDIT entries allowed freely. |

### ⚫ FROZEN — never editable post-publish

| Field | Type | Why frozen |
|-------|------|-----------|
| `id` | string | Identity |
| `brandId` | string | Identity (cross-brand transfer is a different feature) |
| `brandSlug` | string | I-17 stability — public URLs depend on this |
| `eventSlug` | string | Public URL stability |
| `status` | LiveEventStatus | Lifecycle owned by separate mutations (`updateLifecycle`) |
| `publishedAt` | string | Immutable historical fact |
| `cancelledAt` | string \| null | Lifecycle-owned |
| `endedAt` | string \| null | Lifecycle-owned |
| `createdAt` | string | Immutable |
| `updatedAt` | string | Bumped automatically by mutation |
| `orders` | never[] | Forward-compat placeholder |
| `tickets[i].id` | string | Tier identity must be stable for order line references |

---

## 5 — Order Shape Gap Analysis

### 5.1 Current state (Cycle 8)

**`CartContext.tsx`** holds in-memory cart state. Per-line snapshots ARE captured at cart-layer:
- `CartLine.ticketName` ✅ snapshot at selection
- `CartLine.unitPriceGbp` ✅ snapshot (current implementation)
- `CartLine.isFree` ✅ snapshot

**`OrderResult`** is the post-purchase summary, in-memory only:
```ts
interface OrderResult {
  orderId: string;
  ticketIds: string[];
  paidAt: string;
  paymentMethod: CheckoutPaymentMethod;
  totalGbp: number;
}
```
Does NOT carry per-line snapshots itself — those still live in `CartContext.lines`.

### 5.2 Required forward-looking shape (built in Cycle 9c)

**`useOrderStore`** (new Zustand persisted store, eventId-keyed):

```ts
export type OrderStatus =
  | "paid"
  | "refunded_full"
  | "refunded_partial"
  | "cancelled";

export interface OrderLineRecord {
  // Identity
  ticketTypeId: string;          // references LiveEvent.tickets[].id (stable)
  // Snapshot at purchase (FROZEN, write-once)
  ticketNameAtPurchase: string;
  unitPriceGbpAtPurchase: number;
  isFreeAtPurchase: boolean;
  quantity: number;
  // Refund tracking (mutable post-refund)
  refundedQuantity: number;      // 0 ≤ refundedQuantity ≤ quantity
  refundedAmountGbp: number;     // sum across partial refunds for this line
}

export interface BuyerSnapshot {
  // FROZEN at purchase
  name: string;
  email: string;
  phone: string;       // empty string if not provided
  marketingOptIn: boolean;
}

export interface OrderRecord {
  // Identity
  id: string;                    // matches OrderResult.orderId
  eventId: string;               // FK to LiveEvent.id
  brandId: string;               // denormalized for fast brand-scoped queries
  // Snapshot at purchase (FROZEN, write-once for these fields)
  buyer: BuyerSnapshot;
  lines: OrderLineRecord[];
  totalGbpAtPurchase: number;
  currency: "GBP";               // locked at purchase per Const #10
  paymentMethod: CheckoutPaymentMethod;
  paidAt: string;
  // Mutable lifecycle
  status: OrderStatus;
  refundedAmountGbp: number;     // sum across all refunds
  refunds: RefundRecord[];       // append-only audit log
  cancelledAt: string | null;
  // Buyer-facing material-change tracking
  lastSeenEventUpdatedAt: string;  // ISO; advances when buyer views order detail
}

export interface RefundRecord {
  id: string;
  orderId: string;
  amountGbp: number;
  reason: string | null;
  refundedAt: string;
  // For partial refunds: which lines & quantities
  lines: { ticketTypeId: string; quantity: number; amountGbp: number }[];
}
```

### 5.3 Helpers (live in `useOrderStore` selectors)

```ts
// Returns sum of order line quantities for tier across all paid + refunded_partial orders
getSoldCountForTier(eventId: string, ticketTypeId: string): number;

// Returns total event sold count (all tiers)
getSoldCountForEvent(eventId: string): number;

// Returns full sold-count map for use in TicketSheet edit UI
getSoldCountByTier(eventId: string): Record<string, number>;

// Returns orders that should show material-change banner (for buyer order detail page)
// Material fields: format, date, doorsOpen, endsAt, timezone, venueName, address, onlineUrl,
//                  multiDates (any change), tickets[].name, tickets[].description
hasMaterialChangeForOrder(order: OrderRecord, event: LiveEvent): boolean;
```

### 5.4 Gap summary

| Concern | Status | ORCH-0704 action |
|---------|--------|-----------------|
| Per-line snapshot | ✅ already captured at cart layer (CartLine) | Spec the OrderRecord shape so 9c persists correctly |
| Persistent order store | ❌ doesn't exist | Spec the shape; implementor builds in 9c |
| `getSoldCountByTier` helper | ❌ doesn't exist | Spec; ORCH-0704 ships with TRANSITIONAL stub returning 0; 9c flips to live |
| Material-change detection | ❌ doesn't exist | Spec algorithm; 9c renders banner |
| `lastSeenEventUpdatedAt` per-order | ❌ doesn't exist | Spec; 9c implements |

---

## 6 — Material-Change Detection Algorithm

When the buyer views their order detail page (forward-looking, Cycle 9c surface), the page should show a banner if the operator has changed any material field since the buyer's last view.

**Material fields** (any change triggers banner):
- `format`, `date`, `doorsOpen`, `endsAt`, `timezone`
- `venueName`, `address`, `onlineUrl`
- `multiDates` (any add/edit/remove triggers a change)
- `tickets[i].name` where `i` is a tier the buyer's order purchased
- `tickets[i].description` where `i` is a tier the buyer's order purchased

**Non-material fields** (silent push, no banner):
- `name`, `description`, `coverHue`, `category`
- `requireApproval`, `hideRemainingCount`, `hideAddressUntilTicket`
- All ticket modifiers other than name/description for the buyer's tier
- Other tier changes (other tiers don't affect this buyer's order)

**Detection algorithm:**

```ts
function hasMaterialChangeForOrder(order: OrderRecord, event: LiveEvent): boolean {
  // No update since last seen → no banner
  if (event.updatedAt <= order.lastSeenEventUpdatedAt) return false;
  // Use a per-order snapshot of the material fields at purchase time?
  // CHEAPER: track `materialFieldsAtPurchaseHash` on the order; compare to current.
  // SIMPLER FOR NOW: just show banner whenever event.updatedAt advances; let buyer
  // see what changed via "View update history" link (deferred to 9c+).
  return true;  // TRANSITIONAL: optimistic banner; refine when 9c builds the surface
}
```

The simpler version (just `event.updatedAt > lastSeenEventUpdatedAt` triggers banner) is the recommended Cycle-9c-MVP. A non-material edit (description change) WILL trigger a banner, but the banner copy is friendly: "Event details changed — Tap to review." The buyer taps, sees the order page, taps "Got it" → `lastSeenEventUpdatedAt` advances.

A more sophisticated diff-against-snapshot model can land later if banner-fatigue becomes a problem. For MVP, optimistic banner with an acknowledge action is the right tradeoff.

**Banner copy (from operator decision #1, stub mode):**
- Title: "Event details changed"
- Body: "{Organiser brand name} updated this event on {date}. Tap to review."
- Action: "Got it" → mark `lastSeenEventUpdatedAt = event.updatedAt`

No email/push in 9c stub. Real notification waits for 9c notifications work or B-cycle.

---

## 7 — Wizard Reuse vs New Screen Decision

### 7.1 Options considered

**Option A — Refactor wizard root to support edit mode**
- Add `mode: 'create' | 'edit-draft' | 'edit-published'` prop to `EventCreatorWizard`
- Hide Publish CTA in edit-published mode; swap final-step "Continue → Publish" for "Save changes"
- Skip `setLastStep` calls in edit-published mode
- Bypass `publishDraft` → call `liveEventStore.updateLiveEventFields` instead
- Discard the shadow draft on exit (don't persist to draftEventStore)

**Pros:** Reuses chrome (back button, stepper progress, dock). Consistent UX for create + edit.
**Cons:**
- Wizard is 769 LOC, deeply integrated with draftEventStore. Adding a mode prop touches ~20 call sites.
- Wizard's UX is "guided sequential creation" — Continue gates, validation per step, lastStepReached resume. Edit-after-publish wants RANDOM ACCESS — jump to Tickets, fix one tier, save. Sequential gates are wrong UX.
- Stepper progress "Step 3 of 7" is meaningless in edit mode (you're not progressing through anything).

**Option B — Sectioned single-screen reusing step body components**
- New component `EditPublishedScreen` (full rewrite of narrow 9b-2 file)
- Sectioned layout: 6 collapsible cards (Basics, When, Where, Cover, Tickets, Settings) — Step 7 Preview is dropped (operator can use existing Preview button on Event Detail).
- Each section uses the corresponding `CreatorStepN` body component, passed local edit-state via the existing `StepBodyProps` contract
- Local state seeded from LiveEvent on mount (shadow-state via `useState`)
- Save button at bottom — diffs local state vs original LiveEvent → ChangeSummaryModal → `updateLiveEventFields(id, patch)`
- Step 5 receives `editMode: { soldCountByTier }` via extended StepBodyProps; renders price-lock UX

**Pros:**
- Reuses ALL input UX (date pickers, address, ticket builder, settings toggles)
- Random-access edit (correct UX for editing)
- No wizard refactor — existing 769 LOC untouched
- New component is ~400-600 LOC (one screen, not a state machine)
- Save flow is straightforward (diff + commit, no validation gates blocking save like the wizard)

**Cons:**
- Slight UX divergence: create-flow uses guided wizard, edit-flow uses sectioned screen. But this DIVERGENCE IS CORRECT — different mental models for different tasks.
- Need to extend StepBodyProps with optional `editMode` field (minor surface-area increase)

**Option C — Refactor each step body to be standalone routes**
- Make each `CreatorStepN` mountable at `/event/[id]/edit/<section>` independently
- Edit screen is a list of section links

**Pros:** Minimal screen size per route.
**Cons:** Many routes, lots of routing boilerplate, awkward navigation, save-per-section is cognitively heavier than save-all-at-once.

### 7.2 Decision: Option B (sectioned single-screen)

Recommended. Reasons:

1. **Right UX for the task.** Editing is random-access; wizard progression is wrong shape.
2. **Maximum reuse, minimum churn.** Existing step bodies work as-is; only Step 5 needs an optional prop addition. EventCreatorWizard.tsx (769 LOC) is untouched.
3. **Save flow is simple.** Single diff → ChangeSummaryModal → commit. No multi-step validation gates.
4. **Subtraction-friendly.** Replace narrow 9b-2's EditPublishedScreen with the sectioned version (same filename).

Spec encodes Option B as canonical.

---

## 8 — Subtract List (narrow Cycle 9b-2)

These files/changes ship in the working tree but are NOT committed. ORCH-0704 implementor must remove them before adding the new model (Const #8 — subtract before adding).

### 8.1 DELETE (full removal)

- `mingla-business/src/utils/liveEventToEditPatch.ts` — replaced by richer differ (ChangeSummaryModal handles full patch shape)

### 8.2 REPLACE (same path, total rewrite)

- `mingla-business/src/components/event/EditPublishedScreen.tsx` — narrow single-screen replaced by new sectioned screen (same filename for routing simplicity)

### 8.3 KEEP + EXPAND

- `mingla-business/src/components/event/EditAfterPublishBanner.tsx` — keep file; expand body copy to "Changes save immediately. Existing buyers stay protected — their tickets and prices won't change. Buyers will see updated details on their order page." (Replaces narrow banner copy referencing locked fields.)
- `mingla-business/src/components/event/ChangeSummaryModal.tsx` — keep file; enrich `FieldDiff` to handle every editable field type (string, number, date, currency, tier-array, recurrence rule, multi-dates). Spec defines the new differ output.

### 8.4 MOD (existing file changes)

- `mingla-business/src/store/liveEventStore.ts` — REPLACE `updateLiveEventEditableFields` with `updateLiveEventFields` accepting full editable patch. Frozen fields rejected via type narrowing + runtime guard. Validate guard rails (capacity floor, tier-delete-with-sales) BEFORE applying.
- `mingla-business/src/components/event/types.ts` — extend `StepBodyProps` with optional `editMode?: { soldCountByTier: Record<string, number> }`.
- `mingla-business/src/components/event/CreatorStep5Tickets.tsx` — read `props.editMode?.soldCountByTier`; render price-lock UX in TicketSheet when `soldCountForTier > 0`; hide/disable Delete on tier card when `soldCountForTier > 0`; validate capacity floor in TicketSheet validation.

### 8.5 NO CHANGE NEEDED

- `mingla-business/app/event/[id]/edit.tsx` — `?mode=edit-published` branching already correct; just renders the (replaced) EditPublishedScreen component
- `mingla-business/app/event/[id]/index.tsx` — `handleEdit` correctly appends `?mode=edit-published`
- `mingla-business/app/(tabs)/events.tsx` — `handleManageEdit` correctly appends `?mode=edit-published` for non-drafts
- `mingla-business/src/components/event/EventManageMenu.tsx` — TRANSITIONAL toast already removed; Edit details unconditional
- All other CreatorStepN files (1, 2, 3, 4, 6, 7) — unchanged

---

## 9 — Five-Layer Cross-Check

| Layer | State |
|-------|-------|
| **Docs** | Cycle 9 spec §3.B (J-E11 narrow scope) is now obsolete. Roadmap §Cycle 9 still says J-E11 = "Edit-after-publish" — the title is right, the scope was too narrow. Operator's 4 steering decisions (2026-05-02) override Q-9-5 conservative defaults. PRD has no explicit list. |
| **Schema (current)** | LiveEvent + DraftEvent + TicketStub shapes COMPLETE for full edit (OBS-704-2). No new fields needed on LiveEvent itself. |
| **Schema (forward-looking, 9c)** | OrderRecord + RefundRecord + BuyerSnapshot shapes spec'd here (§5.2). useOrderStore not built yet (RC-704-2). Stub helper `getSoldCountByTier` returns 0 in ORCH-0704; flips to live in 9c. |
| **Code (current)** | Narrow EditPublishedScreen + narrow `updateLiveEventEditableFields` (RC-704-1). Step bodies fully decoupled from store (OBS-704-1). Buyer-side already uses live-read for displayable info (OBS-704-4). |
| **Runtime** | Greenfield for full-edit; subtract narrow 9b-2 first, then add. |
| **Data** | `mingla-business.liveEvent.v1` AsyncStorage keeps LiveEvent post-edit. No new persistence keys in this cycle. |

No cross-layer contradictions. ORCH-0704 is greenfield-replace with clear paper trail.

---

## 10 — Blast Radius

| Surface | Impact | Action |
|---------|--------|--------|
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | Total rewrite (sectioned) | REPLACE |
| `mingla-business/src/components/event/EditAfterPublishBanner.tsx` | Copy update + reusability | MOD |
| `mingla-business/src/components/event/ChangeSummaryModal.tsx` | Differ enrichment for full editable surface | MOD |
| `mingla-business/src/utils/liveEventToEditPatch.ts` | Replaced by inline differ; file deleted | DELETE |
| `mingla-business/src/store/liveEventStore.ts` | `updateLiveEventEditableFields` → `updateLiveEventFields` (full editable patch + guard rails) | MOD |
| `mingla-business/src/components/event/types.ts` | Add optional `editMode?` to StepBodyProps | MOD |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | Read `editMode.soldCountByTier`; render lock UX | MOD |
| `mingla-business/app/event/[id]/edit.tsx` | NONE — routing correct | None |
| `mingla-business/app/event/[id]/index.tsx` | NONE — routing correct | None |
| `mingla-business/app/(tabs)/events.tsx` | NONE — routing correct | None |
| `mingla-business/src/components/event/EventManageMenu.tsx` | NONE — TRANSITIONAL already removed | None |
| Cycle 8 buyer flow | NONE — buyer-side reads live; price snapshot already in CartLine | None |
| Public event page (`/e/{brandSlug}/{eventSlug}`) | Auto-rerenders on edit (live subscription) | None |
| `useOrderStore` (forward-looking) | Spec'd here; built in 9c | Spec only |
| Buyer order detail page (forward-looking) | Spec'd here (banner algorithm); built in 9c | Spec only |

---

## 11 — Invariant Violations

### Currently violated (by narrow 9b-2)
None — narrow 9b-2 is too narrow but doesn't violate any registered invariant. It's a feature gap, not a contract breach.

### Proposed by ORCH-0704

**I-19 — Immutable order financials (NEW, propose in spec)**

> An order's `totalGbpAtPurchase`, `lines[i].unitPriceGbpAtPurchase`, `lines[i].ticketNameAtPurchase`, `lines[i].isFreeAtPurchase`, `currency`, and `buyer` snapshot are write-once at order insertion to `useOrderStore`. No subsequent operator action — including event edit, tier rename, tier reprice, refund, cancel — mutates these fields. Refund/cancel mutations create NEW records (RefundRecord) and update `status` + `refundedAmountGbp` aggregates; they never overwrite original snapshots.

CI gate (post-Stripe): SQL CHECK constraint or trigger preventing UPDATE to these columns once non-null.
Preservation in ORCH-0704: store layer for `useOrderStore` (built 9c) explicitly omits these from the partial-update mutation surface.

### Already preserved

| ID | How |
|----|-----|
| I-11 | All IDs remain opaque strings |
| I-12 | Host-bg cascade unchanged in EditPublishedScreen |
| I-13 | Overlay portal contract — ChangeSummaryModal uses Sheet primitive (DEC-085 portal-correct) |
| I-14 | Date display single source — wizard step bodies already use `formatDraftDateLine` |
| I-15 | Ticket display single source — Step 5 already routes through `ticketDisplay.ts` helpers |
| I-16 | Live-event ownership separation — `addLiveEvent` still only callable by `liveEventConverter` from `publishDraft`. ORCH-0704's new `updateLiveEventFields` is a MUTATE not an ADD; doesn't touch ownership transfer. |
| I-17 | Brand-slug stability — `brandSlug` + `eventSlug` in FROZEN bucket |
| I-18 (DRAFT) | Buyer→founder order persistence — preserved by spec (useOrderStore built 9c carries CartLine snapshot fields into OrderRecord) |

---

## 12 — Fix Strategy (direction only — spec lives next door)

**Phase 1 — Subtract narrow 9b-2** (Const #8 — subtract before adding):
- DELETE `liveEventToEditPatch.ts`
- DELETE old narrow `EditPublishedScreen.tsx` content (file replaced)
- MOD `liveEventStore.ts` — replace narrow mutation with full mutation (frozen-field guard + capacity floor + tier-delete block validation)
- MOD `types.ts` — extend StepBodyProps

**Phase 2 — Add full edit:**
- WRITE new sectioned `EditPublishedScreen.tsx` (~400-600 LOC) — collapsible cards reuse `CreatorStepN` bodies
- MOD `EditAfterPublishBanner.tsx` — expand copy
- MOD `ChangeSummaryModal.tsx` — enrich differ for all editable field types
- MOD `CreatorStep5Tickets.tsx` — render price-lock UX when `editMode.soldCountByTier[ticketId] > 0`

**Phase 3 — Forward-looking 9c contract:**
- Spec OrderRecord + RefundRecord + BuyerSnapshot shapes (built in 9c)
- Spec `getSoldCountByTier` selector (TRANSITIONAL stub returning 0 in ORCH-0704; live in 9c)
- Spec material-change banner detection (rendered in 9c)

**Phase 4 — Defer (separately registered):**
- ORCH-0705 — no-show + post-event ops + dispute paths + post-Stripe refund flows

---

## 13 — Regression Prevention

### What could break

1. **Cycle 3 wizard / draft creation** — edit.tsx default branch must stay unchanged. Step bodies must stay backward-compatible (the new optional `editMode` prop on StepBodyProps is opt-in; create-flow doesn't pass it).
2. **Cycle 8 checkout** — cart pricing reads from current LiveEvent at tier selection. After operator reprices, buyer adding to cart sees the NEW price. Existing in-flight cart sessions hold the OLD price snapshot in CartLine. Both correct.
3. **Cycle 9a manage menu** — Edit details routing unchanged.
4. **Cycle 9b-1 lifecycle** — End sales / Cancel / Delete-draft sheets unchanged.
5. **Cycle 6 public event page** — auto-rerenders on edit; verify after save flow.

### Structural safeguards

- **Frozen-field type narrowing.** `updateLiveEventFields` accepts only `Partial<EditableLiveEventFields>` where `EditableLiveEventFields` is an explicit subset omitting `id`, `brandId`, `brandSlug`, `eventSlug`, `status`, `publishedAt`, `cancelledAt`, `endedAt`, `createdAt`, `updatedAt`, `orders`. TypeScript prevents passing frozen fields at compile time; runtime guard re-validates as defense-in-depth.
- **Constrained-field validation.** Mutation throws (or returns error union) if capacity floor / tier-delete-with-sales / whenMode-with-sales rules are violated. UI catches and surfaces via inline error.
- **Optional `editMode` prop on StepBodyProps.** Default undefined; Step 5 only reads `props.editMode?.soldCountByTier` (optional chaining). Other steps ignore. Backward-compatible with create-flow.
- **TRANSITIONAL labels** on the stub helper `getSoldCountByTier` (returns 0 in ORCH-0704; flips live in 9c). Exit condition: ORCH-0704 implementor labels the stub explicitly so 9c implementor doesn't miss it.

---

## 14 — Discoveries for Orchestrator

### Open questions for operator decision

**Q-704-1 — `name` field bucket.** Spec recommends 🟢 SAFE (silent push, no banner) for event name renames. Operator decision needed: do you agree, or prefer 🟡 MATERIAL (banner on rename)? **Recommendation:** SAFE. Renames are common (typo fixes, rebrand) and don't affect attendance plan. Soft "renamed by organiser" line OK.

**Q-704-2 — `format` field banner severity.** Spec classifies `format` as 🟡 MATERIAL (banner). Decision needed: agreed, or treat as fully constrained (block once tickets sold)? **Recommendation:** MATERIAL with banner. Format pivots (in-person → online due to weather) are legitimate and common. Banner gives buyer the signal.

**Q-704-3 — `whenMode` lock rule.** Spec says LOCKED post-publish if any orders exist; allowed if zero. Decision needed: agreed, or always locked once published (even with zero orders)? **Recommendation:** locked-when-sold, free-when-zero. Operator might publish + immediately realize they meant recurring; if no one bought yet, no harm.

**Q-704-4 — Multi-date entry removal with sales.** Spec says LOCKED if any orders exist for the event. Per-date order tracking is post-MVP. Decision needed: agreed (block all multi-date entry removal once any sale)? **Recommendation:** agreed. Per-date tracking is a real feature for B-cycle; until then, conservative block is the right tradeoff.

**Q-704-5 — Material-change banner copy.** Spec proposes "Event details changed — {organiser} updated this on {date}. Tap to review." Decision needed: copy ok, or refine? **Recommendation:** ship as proposed.

**Q-704-6 — Stub mode behaviour for guard rails.** ORCH-0704 ships with `getSoldCountByTier` returning 0 (no orders persisted yet — 9c builds useOrderStore). This means ALL price/capacity/delete guards are inactive in stub mode. Decision needed: ok (operator can fully edit until 9c lands), or pre-seed fake orders for testing the locked UX? **Recommendation:** ok as-is. Pre-seeded fake orders violate Const #9. Operator + tester can verify lock UX manually after 9c lands by going through stub checkout, then editing.

### Side discoveries (register but don't act on)

**D-704-1 (Note severity)** — `tickets[i].id` is the stable tier identity; spec relies on this for sold-count joins. The ticket creation path (Step 5 → `generateTicketId`) already produces stable IDs. Just flagging for the implementor: tier IDs MUST not be regenerated during edit-mode tier modifications.

**D-704-2 (Note severity)** — When operator adds a NEW tier to a published event, that tier's `displayOrder` must be unique across the existing tier set. Current `nextDisplayOrder` helper handles this. No code change; just verify in implementor smoke.

**D-704-3 (Note severity)** — Step 7 Preview is dropped from the sectioned EditPublishedScreen. Operator can use the existing "Preview" button on Event Detail (Cycle 9a) to see the public event page after edits. No code path needs the wizard's Preview step in edit mode.

**D-704-4 (Low severity)** — Wizard's `validatePublish` checks Stripe connection for paid events. EditPublishedScreen does NOT need to re-check at edit time — Stripe was already validated at publish. Edit-saving doesn't change Stripe state. (If operator disconnects Stripe and edits, that's a separate problem managed by Cycle 2 brand payments flow.)

**D-704-5 (Low severity)** — Material-change banner is rendered on the buyer's order detail page. That page doesn't exist today. ORCH-0704 spec defines the algorithm + copy; 9c implementor builds the surface and renders. Spec is ready; implementation deferred.

**D-704-6 (Note severity)** — `lastSeenEventUpdatedAt` per-order tracking requires a write whenever the buyer views their order. This is a 9c concern (the page doesn't exist). Just flagging that the OrderRecord shape includes this field so 9c implementor doesn't omit it.

---

## 15 — Confidence

**HIGH.**

- Field catalog sourced directly from LiveEvent + TicketStub + DraftEvent type definitions in code (read in this investigation).
- Step body decoupling verified by reading types.ts + grepping `useDraftEventStore` inside step body files.
- Order shape forward-looking design grounded in Cycle 8 CartContext shape + PR #59 §B.4 schema.
- All 4 operator steering decisions have explicit accommodation in the field catalog + guard-rail rules.
- Subtract list grounded in actual narrow 9b-2 file inventory (read in this investigation).

The only uncertainty is buyer order detail page rendering surface — that page doesn't exist yet and ORCH-0704 specs the banner algorithm forward to 9c. Confidence is HIGH on the operator-side scope; the buyer-side banner is correctly deferred.

---

## 16 — Cross-references

- Spec: [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- Dispatch: [FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../prompts/FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- Supersedes: [IMPLEMENTATION_BIZ_CYCLE_9b2_EDIT_AFTER_PUBLISH.md](IMPLEMENTATION_BIZ_CYCLE_9b2_EDIT_AFTER_PUBLISH.md) (narrow 9b-2)
- Cycle 9 origin: [INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md), [SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](../specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
- Forward dependency: ORCH-0705 (no-show + post-event ops, post-Stripe)
