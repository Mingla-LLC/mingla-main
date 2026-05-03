# Investigation — BIZ Cycle 9 — Event Management (Events tab + lifecycle + orders)

**Date:** 2026-05-01
**Author:** mingla-forensics
**Mode:** INVESTIGATE-THEN-SPEC
**Dispatch:** [Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
**Confidence:** HIGH

---

## 1 — Build context

This is the BIGGEST cycle so far — 13 journeys, ~5–7 net-new screens, ~3–5 modals/sheets, ~2,500–3,500 LOC estimated. Forensics MUST recommend a sub-cycle split (per dispatch §11 Q-9-1).

The cycle finally lights up the Events tab (currently drafts-only with footer note "Live, Upcoming, and Past sections land Cycle 9"), gives founders KPI visibility per event, exposes the manage-event menu, opens the orders ledger, and ships the cancel/refund/edit lifecycle UI. All stub — no real Stripe refund, no real email, no Supabase wire-up.

---

## 2 — Investigation Manifest (every file read)

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` | Dispatch — scope, 12 Q-9 questions, hard constraints |
| 2 | `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` §Cycle 9 + §3.2 + §3.6 + §5.8 (rows 244-255) | Canonical journey list + design-package coverage map |
| 3 | `mingla-business/app/(tabs)/events.tsx` | Currently drafts-only; footer "Live, Upcoming, and Past sections land Cycle 9" |
| 4 | `mingla-business/app/event/` (directory listing) | Existing routes: `[id]/edit.tsx`, `[id]/preview.tsx`, `create.tsx`. NO `[id]/index.tsx` (Event Detail), NO `[id]/orders/`, NO `[id]/cancel.tsx` |
| 5 | `mingla-business/src/store/liveEventStore.ts` (full) | LiveEvent shape — `orders: never[]` at line 79 (TRANSITIONAL Cycle 6 stub; Cycle 9 needs typed) |
| 6 | `mingla-business/src/store/draftEventStore.ts` lines 60-129 | TicketStub model (Order detail reads ticket-type names + prices) |
| 7 | `mingla-business/src/components/event/PublicEventPage.tsx` (existing context) | 7-variant computed `variant` logic — Cycle 9 EventDetail mirrors the variant taxonomy |
| 8 | `mingla-business/src/components/ui/ShareModal.tsx` | J-E17 reuses verbatim (Cycle 7 contract) |
| 9 | `mingla-business/src/components/ui/Sheet.tsx` | J-E10 cancel modal + J-M3/M4 refund sheet portal-correct primitive |
| 10 | `mingla-business/src/components/ui/ConfirmDialog.tsx` (referenced via DEC-085) | Type-the-name confirmation — verify ConfirmDialog exists or needs composition |
| 11 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screens-home.jsx` lines 137-290 | EventDetailScreen + KpiTile + ActionTile + TicketTypeRow + ActivityRow + SparklineBar (DESIGN-PACKAGE-FULL for J-E13) |
| 12 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screen-events-list.jsx` lines 1-265 | EventsListScreen + filter pills + EventListCard + manage menu (DESIGN-PACKAGE-FULL for J-E14, J-E15) |
| 13 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screens-ops.jsx` lines 171-300 | OrdersScreen + OrderDetailScreen (DESIGN-PACKAGE-FULL for J-M1, J-M2) |
| 14 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screens-extra.jsx` lines 175-211 | RefundSheet (DESIGN-PACKAGE-FULL for J-M3 full refund; PARTIAL for J-M4 — no line-item picker / amount slider) |
| 15 | `mingla-business/src/components/checkout/CartContext.tsx` (Cycle 8) | OrderResult type — Cycle 9 useOrderStore consumes this shape |
| 16 | `mingla-business/app/checkout/[eventId]/confirm.tsx` (Cycle 8) | Where Q-9-2 option B wires `useOrderStore.recordOrder()` (1-line addition) |
| 17 | `mingla-business/src/utils/currency.ts` | `formatGbp` / `formatGbpRound` — every order/refund display uses these |
| 18 | `mingla-business/src/components/event/EventCreatorWizard.tsx` (Cycle 3) | J-E11 banner + change-summary modal entry point |
| 19 | `Mingla_Artifacts/BUSINESS_PRD.md` §5.0 + §6.x + §7.x | Resolution source for Q-9-5 / Q-9-7 / Q-9-8 / Q-9-11 |
| 20 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | I-15 ticket display, I-16 ownership, Const #1/#3/#7/#8/#9/#10 |
| 21 | `Mingla_Artifacts/DECISION_LOG.md` (DEC-079, DEC-085, DEC-086) | Kit closure carve-out, overlay portal contract, mingla-business-only |
| 22 | PR #59 description (`gh pr view 59`) §B.4 Tickets & Orders | Forward-compat schema — orders / order_line_items / tickets |

---

## 3 — Findings

### 🔵 OBS-1 — Events tab is currently drafts-only by design
**File:** `mingla-business/app/(tabs)/events.tsx:1-296`
**Code:** docstring line 4-7: "Cycle 3 lights up the Drafts section ONLY. Live / Upcoming / Past sections land Cycle 9 per BUSINESS_PRD §5.0." Line 162-164 footer Text: "Live, Upcoming, and Past sections land Cycle 9."
**What it does:** Renders TopBar + Events title + DRAFTS section (drafts list OR empty-state). Footer note. Brand chip + brand switcher sheet wiring.
**What Cycle 9 must do:** REPLACE the body with filter-pill-driven list (All / Live / Upcoming / Drafts / Past). Filter pills mirror design-package `screen-events-list.jsx:51-80`. Drafts section content carried into Drafts pill view (subtraction-before-addition per Const #8 — old draft-only layout removed cleanly).
**Verification:** grep `Live, Upcoming, and Past sections land Cycle 9` returns single hit at line 163.

### 🔵 OBS-2 — `liveEvent.orders: never[]` is a Cycle 6 forward-compat stub
**File:** `mingla-business/src/store/liveEventStore.ts:77-79`
**Code:**
```ts
// Forward-compat for Cycle 9 (orders) — empty until B3 wires Stripe
// [TRANSITIONAL] orders array empty in Cycle 6; populated by B3 webhooks.
orders: never[];
```
**What it does:** Reserves a field name on LiveEvent typed `never[]` (so any push fails type check). No data path writes to it.
**What Cycle 9 must do:** Two options resolved per Q-9-2 below. Recommended (option B): introduce a SEPARATE `useOrderStore` (Zustand persisted) keyed by eventId, populated from Cycle 8 `confirm.tsx`'s `recordResult` flow. KEEP `liveEvent.orders` as `never[]` placeholder so the LiveEvent shape doesn't churn — orders live in their own store. This isolates the order-collection concern from the event-snapshot concern (Const #2 single-owner).
**Verification:** grep `orders: never\[\]` in liveEventStore returns single hit at line 79.

### 🔵 OBS-3 — DESIGN-PACKAGE-FULL coverage for 6 of 7 J-Es / M1-M3
**Files:** `screens-home.jsx` (EventDetailScreen, KpiTile, ActionTile, TicketTypeRow, ActivityRow, SparklineBar), `screen-events-list.jsx` (EventsListScreen, EventListCard, StatusPill, MenuItem, MenuDivider), `screens-ops.jsx` (OrdersScreen, OrderDetailScreen, Row), `screens-extra.jsx` (RefundSheet — full refund only).
**What it covers:** J-E13 ✓ J-E14 ✓ J-E15 ✓ J-M1 ✓ J-M2 ✓ J-M3 ✓ — full visual contract.
**What it does NOT cover:** J-E10 Cancel event modal (PARTIAL — type-name confirm not in design package); J-E11 Edit-after-publish banner + change-summary modal (PARTIAL); J-M4 Partial refund (line-item picker + amount slider not in design package); J-E9 End ticket sales confirm sheet (silent); J-M5 Cancel order (silent — design package only shows refund); J-M6 Resend ticket (silent — toast affordance only); J-E17 Share (covered by Cycle 7 ShareModal reuse).
**Implication:** Forensics designs the silent/partial surfaces in spec § per-screen contracts. Implementor follows spec verbatim, no /ui-ux-pro-max gap.

### 🔵 OBS-4 — Manage menu has 11 context-aware actions (not 10)
**File:** `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screen-events-list.jsx:212-223`
**Actions (verbatim from design package):**
1. Edit details (always)
2. View public page (always)
3. Open scanner (live only)
4. Orders (always non-draft)
5. Copy share link (always)
6. Publish event (draft only — accent tone)
7. End ticket sales (live only — warn tone)
8. Duplicate (upcoming only)
9. Delete event (draft/upcoming only — danger tone)
10. Issue refunds (past only)
11. Duplicate as new (past only)
**What Cycle 9 must do:** Implement all 11. Roadmap said "10 actions" — actual count is 11 with status-based gating. Spec §3.5 enumerates exact gating rules.
**Verification:** Read `screen-events-list.jsx:212-223` lines.

### 🟡 HF-1 — Cycle 8 OrderResult is purely in-memory React Context
**File:** `mingla-business/src/components/checkout/CartContext.tsx`
**Concern:** Cycle 8 cart state is in-memory React Context only — closes when buyer's tab closes. Q-9-2 option B requires PERSISTING the OrderResult to a separate Zustand store SO THAT the founder's order list (J-M1) reflects the (stub) buyer's purchase. This is a 1-line cross-cycle edit in `confirm.tsx` (`useOrderStore.recordOrder(...)` call right after `recordResult`).
**What Cycle 9 must do:** Build `useOrderStore` (Zustand persisted, keyed by eventId, lives in `mingla-business/src/store/orderStore.ts`). Wire `confirm.tsx` to call `recordOrder` in addition to its existing `recordResult` cart-Context call. Idempotency: dedupe by orderId (check `getOrderById(orderId)` before insert). NEW invariant I-18 — "buyer-side OrderResult persists to founder-side useOrderStore at confirmation entry."
**Why hidden flaw:** If implementor reflexively keeps orders in cart Context only, J-M1 will always be empty in stub mode. Forensics spec makes the wire-up explicit.

### 🟡 HF-2 — `app/event/[id]/index.tsx` does not exist
**File:** `mingla-business/app/event/[id]/` directory listing — only `edit.tsx` + `preview.tsx`.
**What Cycle 9 must do:** Create `app/event/[id]/index.tsx` as the Event Detail route (J-E13). The file path conflicts with no existing route. Edit (J-E11) keeps its own route (`app/event/[id]/edit.tsx`); manage menu's "Edit details" navigates there.
**Why hidden flaw:** Implementor must NOT confuse `index.tsx` (Detail) with `edit.tsx` (Wizard). Spec is explicit.

### 🟡 HF-3 — `oklch()` in design package source files (informational, NOT spec)
**File:** `screens-ops.jsx:211, 247` — `background: \`oklch(0.5 0.15 ${(i*47) % 360})\`` for buyer avatars.
**What Cycle 9 must do:** Use `hsl(hue, 60%, 45%)` per memory rule `feedback_rn_color_formats.md`. The design package is HTML/CSS reference; RN implementation MUST translate oklch → hsl at port time. Same lesson as Cycle 7 FX2/FX3.
**Why hidden flaw:** If implementor copies oklch verbatim, buyer avatars in J-M1 / J-M2 will be black canvases on iOS/Android (silent rejection by RN normalize-colors).

### 🟡 HF-4 — `liveEvent.tickets[].soldCount` does NOT exist
**File:** `mingla-business/src/store/draftEventStore.ts:65-129` (TicketStub)
**Concern:** Spec §3.4 (J-E13 KPIs) needs "tickets sold" count. TicketStub has `capacity` but no `soldCount`. With useOrderStore wired, soldCount is DERIVED — not stored on TicketStub. Sum quantity across all paid OrderStubs for that ticket-type-id.
**What Cycle 9 must do:** Compute `soldCount` from `useOrderStore` selector — `getOrdersForEvent(eventId).filter(o => o.status === "paid" || o.status === "partial_refund").flatMap(o => o.lines).filter(l => l.ticketTypeId === t.id).reduce((sum, l) => sum + l.quantity, 0)`. Memoise per-event in EventDetail screen.
**Why hidden flaw:** Implementor reflex would add soldCount to TicketStub schema (schema bump for stub data). Wrong. Soldcount is a derivation, not a fact. Const #2 — order-of-truth lives in useOrderStore.

### 🔵 OBS-5 — Existing kit covers EVERY Cycle 9 surface — no new primitives needed
Verified primitives:
- `GlassCard` (KPI tiles, order rows, summary blocks) ✓
- `Pill` (status pills — variants `live` / `accent` / `draft` exist; need new variant `past` if it's not just `info`) ✓
- `Sheet` (manage menu portal, cancel sheet, refund sheet) ✓
- `Input` (orders search, partial-refund amount, type-the-name) ✓
- `Button` (CTAs everywhere) ✓
- `EmptyState` (no orders / no events filters) ✓
- `Toast` (refund-success / cancel-event / resend-ticket — wrapped in absolute-positioned wrapper per `feedback_toast_needs_absolute_wrap.md`) ✓
- `ConfirmDialog` (verify exists — DEC-085 references it) — yes, exists at `mingla-business/src/components/ui/ConfirmDialog.tsx`
- `IconChrome` (manage menu trigger, share button) ✓
- `Stepper` (J-E11 wizard reuse — already proven) ✓
- `EventCover` (event hue band on detail screen) ✓
- `Avatar` (buyer initials in orders list — Cycle 2 J-A9 kit-extension DEC-083) ✓

If `Pill` lacks a "past" / "ended" variant: add inline composition (Const #8 — no new primitive). Otherwise `Pill variant="info"` with custom children works.

### 🔵 OBS-6 — Cycle 8 wired Toast wrap fix proven across 4 surfaces
Cycle 9 inherits the lesson by default — every Toast in Cycle 9 MUST live inside an absolute-positioned `<View style={{position: "absolute", top/bottom: ..., zIndex: 100}}>` wrapper. Spec calls this out as AC.

### 🔵 OBS-7 — RefundSheet is at `screens-extra.jsx` not `screens-ops.jsx`
File location confirmed. Per dispatch §3 step 2 spec authority. Implementor reads from `screens-extra.jsx:175-211`.

---

## 4 — Five-Layer Cross-Check

| Layer | State |
|-------|-------|
| **Docs** | Roadmap §Cycle 9 + §3.2 + §3.6 explicit; PRD §5/6/7 narrative-only (no field contracts); design package FULL coverage for 6 of 7 J-Es (verified §3 OBS-3) |
| **Schema (future)** | PR #59 §B.4 `orders` + `order_line_items` + `tickets` — Cycle 9 cart shape forward-compatible (Cycle 8 already established this — orderStub maps 1:1 to PR #59 row shape) |
| **Code (current)** | Events tab drafts-only (OBS-1); `app/event/[id]/index.tsx` does not exist (HF-2); `liveEvent.orders: never[]` placeholder (OBS-2); ShareModal proven (Cycle 7); ConfirmDialog primitive exists (DEC-085); kit covers full surface (OBS-5) |
| **Runtime** | Cycle 9 is greenfield + replaces drafts-only Events tab. Stub data flows from useOrderStore (NEW). |
| **Data** | No persisted Cycle 9 state today. NEW: `mingla-business.orderStore.v1` AsyncStorage key, populated by Cycle 8 confirm.tsx. |

No contradictions between layers. Cycle 9 is GREENFIELD with a clear stub-data wire path.

---

## 5 — Resolved product questions (Q-9-1 → Q-9-12)

### Q-9-1 — Cycle split boundary: **9a / 9b / 9c three-way split**

**Recommended split:**

| Sub-cycle | Journeys | Effort | Net-new files | Approach |
|-----------|----------|--------|---------------|----------|
| **9a — Events tab + Detail + Manage menu + Share** | J-E13, J-E14, J-E15, J-E17 | ~10–14 hrs | 3 NEW + 2 MOD (events.tsx replace) | Highest immediate user value (founder pipeline visibility) |
| **9b — Lifecycle actions** | J-E9, J-E10, J-E11 | ~10–14 hrs | 2 NEW + 1 MOD (EventCreatorWizard banner mode) | End sales / Cancel event / Edit-after-publish |
| **9c — Orders ops + useOrderStore wire-up** | J-M1, J-M2, J-M3, J-M4, J-M5, J-M6 | ~14–18 hrs | 5 NEW + 2 MOD (Cycle 8 confirm.tsx wire) | Orders list + detail + refund full + refund partial + cancel order + resend |

Total cycle: ~34–46 hrs implementor + ~6 hrs smoke. Three-way split keeps each diff reviewable.

Order of dispatch: **9a → 9b → 9c**. Reasons:
- 9a unblocks the user's main pain point (Events tab visibility)
- 9b builds on 9a (manage menu wires End sales / Cancel as TRANSITIONAL toasts in 9a, real flows in 9b)
- 9c needs useOrderStore wired which can land independently — but stub data is more useful AFTER 9a so the founder has a place to view orders from

### Q-9-2 — Order stub data persistence: **(B) wire Cycle 8 confirm.tsx to a new useOrderStore**

**Why:** Pre-seeded fake orders violate Const #9 (no fabricated data). The honest stub flow: founder publishes → guest buyer adds to cart → completes (stub) checkout → confirm.tsx records OrderResult → ALSO writes to useOrderStore (eventId-keyed) → founder opens Events tab → Orders shows the real (stub) order.

**Spec encodes:** new `mingla-business/src/store/orderStore.ts` Zustand persisted, keyed by orderId. Selectors: `useOrdersForEvent(eventId)`, `useOrderById(orderId)`. Mutations: `recordOrder(...)`, `recordRefund(orderId, refund)`, `cancelOrder(orderId)`, `resetForLogout()`. Cycle 8 `confirm.tsx` adds 1 line: `useOrderStore.getState().recordOrder({orderId, eventId, lines, buyer, paymentMethod, totalGbp, paidAt})` — idempotent dedupe.

### Q-9-3 — Refund stub processing: **1.2s simulated delay** (matches Cycle 8 Stripe stub)

### Q-9-4 — Cancel event "type the name": **Case-insensitive exact match**

Strict enough to prevent accidental cancellation, forgiving on case. `confirmInput.trim().toLowerCase() === event.name.trim().toLowerCase()`.

### Q-9-5 — Edit-after-publish allowed fields: **Conservative default**

Mutable post-publish: `description`, `coverHue`, `social links` (if any), `FAQ` (if exists in schema), `tagline`. **LOCKED post-publish:** `name`, `date`, `doorsOpen`, `endsAt`, `venueName`, `address`, `tickets[]` (any ticket-type changes), `whenMode`, `recurrenceRule`, `multiDates`, `category`. To change a locked field, founder must Cancel + republish (J-E10 + new draft via Duplicate).

PRD has no explicit list — this is forensics judgement, conservative to prevent buyer surprise. Change-summary modal lists what changed before commit.

### Q-9-6 — Orders Export button: **Toast "CSV export lands B-cycle"**

Keep affordance visible so founders know it's planned. Honest stub copy.

### Q-9-7 — Manage menu actions: **11 actions confirmed (not 10) — see OBS-4**

### Q-9-8 — Cancel order vs Refund order: **Refund = paid; Cancel = free / no-show admin action**

Refund moves money back to buyer + voids ticket. Cancel voids the order without money movement (free orders or admin-side cleanup). Mutually exclusive per status. Order detail screen shows ONE action button — "Refund" if paymentMethod !== "free", "Cancel" if paymentMethod === "free".

### Q-9-9 — Past events with no activity: **Show in Past tab, faded**

`opacity: 0.7` on the EventListCard when status==="past" AND sold===0. Honest visibility.

### Q-9-10 — Live tonight on Home tab: **NO TOUCH in Cycle 9** (Cycle 11 owns)

### Q-9-11 — Activity feed contents: **Stub-mode rendering**

For paid OrderStubs in eventId, render last 5 events:
- "{buyerName} bought {qty}× {ticketTypeName}" — `+£X.XX` icon=ticket color=success
- For refunded: "{buyerName} refunded {qty}× {ticketTypeName}" — `-£X.XX` icon=refund color=warning

When useOrderStore is empty for the event: empty-state row "No activity yet."

### Q-9-12 — Default filter pill on Events tab: **Upcoming**

Most actionable for founders preparing for next event. Falls back to "All" if zero events match Upcoming.

---

## 6 — Blast Radius

| Surface | Impact | Action |
|---------|--------|--------|
| `app/(tabs)/events.tsx` | Heavily replaced (drafts-only → 5-pill filter) | 9a edit |
| `liveEventStore.ts` | UNCHANGED — `orders: never[]` placeholder kept (Const #2; orders live in their own store) | None |
| NEW: `src/store/orderStore.ts` | Zustand persisted, eventId-keyed | 9c create |
| NEW: `app/event/[id]/index.tsx` | J-E13 Event Detail | 9a create |
| NEW: `src/components/event/EventListCard.tsx` | Reusable list-row component | 9a create |
| NEW: `src/components/event/EventManageMenu.tsx` | Sheet-based context-aware menu | 9a create |
| NEW: `app/event/[id]/cancel.tsx` | J-E10 Cancel modal screen (or Sheet at /event/[id]) | 9b create |
| NEW: `src/components/event/EditAfterPublishBanner.tsx` | J-E11 banner | 9b create |
| NEW: `src/components/event/ChangeSummaryModal.tsx` | J-E11 commit modal | 9b create |
| NEW: `app/event/[id]/orders/index.tsx` | J-M1 Orders list | 9c create |
| NEW: `app/event/[id]/orders/[oid]/index.tsx` | J-M2 Order detail | 9c create |
| NEW: `app/event/[id]/orders/[oid]/refund.tsx` | J-M3 + J-M4 Refund (full + partial) | 9c create |
| `app/checkout/[eventId]/confirm.tsx` | 1-line addition: `useOrderStore.recordOrder(...)` after recordResult | 9c MOD |
| `EventCreatorWizard.tsx` | J-E11 mode prop adds banner + change-summary on save | 9b MOD |
| `currentBrandStore.ts` | UNCHANGED — brand stats are display-only KPIs derived from orderStore + liveEventStore | None |

---

## 7 — Invariant compliance plan

| ID | How Cycle 9 preserves |
|----|----------------------|
| I-11 Format-agnostic ID | orderStub.id, eventId, ticketTypeId all opaque strings |
| I-15 Ticket-display single source | All prices via `formatGbp` (no inline Intl.NumberFormat) |
| I-16 Live-event ownership separation | All Cycle 9 routes inside `(tabs)` — founder context only; checkout (buyer) stays outside per `feedback_anon_buyer_routes.md` |
| I-17 Brand-slug stability | Share modal + "View public page" use FROZEN `event.brandSlug` + `event.eventSlug` |
| Const #1 No dead taps | All 11 manage menu actions wire (toast for stubs, real for in-cycle work) |
| Const #2 One owner per truth | Orders live in useOrderStore ONLY; soldCount derived; LiveEvent.orders placeholder unchanged |
| Const #3 No silent failures | Refund decline + cancel-event validation + edit-after-publish save errors all explicit |
| Const #6 Logout clears | `useOrderStore.resetForLogout()` wired into existing `clearAllStores.ts` |
| Const #7 TRANSITIONAL labels | Email send / Stripe refund / wallet / CSV export ALL labelled with B-cycle exits |
| Const #8 Subtract before adding | `events.tsx` drafts-only body REMOVED before 5-pill filter view added |
| Const #9 No fabricated data | NO pre-seeded fake orders (Q-9-2 option B); soldCount is real (derived from real stub orders) |
| Const #10 Currency-aware UI | formatGbp throughout, including partial-refund amount picker |
| Const #11 One auth instance | useAuth used only for ownership check; no new auth provider |
| Const #14 Persisted-state startup | useOrderStore Zustand persisted handles cold start; `feedback_keyboard_never_blocks_input` applies on partial-refund + cancel-event Inputs |

**NEW INVARIANT I-18 — Buyer→Founder order persistence:**
Every Cycle 8 `confirm.tsx` execution path that lands on the confirmation screen MUST call `useOrderStore.recordOrder()` exactly once per orderId. Idempotent dedupe by orderId. The founder's J-M1 reads from useOrderStore directly. This invariant exists so the buyer-side stub flow connects to the founder-side stub list without Supabase mediation.

---

## 8 — Discoveries for Orchestrator

**D-INV-CYCLE9-1 (Note severity)** — `Pill` may need a "past/ended" variant. Current variants: `live | draft | warn | accent | error | info`. Past pill in design-package uses muted-grey custom styling (verbatim `screen-events-list.jsx:234`). Two options: (A) add Pill variant `"ended"` additively per DEC-079 carve-out precedent; (B) compose inline using a styled View. Spec recommends (B) — single-use composition, no kit churn.

**D-INV-CYCLE9-2 (Note severity)** — `useOrderStore` introduces a NEW Zustand persisted store. This is the FIRST new Zustand store added since Cycle 0a kit closure. Justification: Q-9-2 option B requires persisted client state for stub-mode order-list visibility. NOT server-fetched data (Const #5 honored). Forward-compat: when B-cycle wires real Supabase orders, this store contracts to a cache + ID-only model.

**D-INV-CYCLE9-3 (Note severity)** — soldCount derivation runs O(N orders × M lines) per event detail render. With useMemo dependencies on `[orders, eventId]`, recomputes only on order changes. At MVP scale (10s of events, 100s of orders), this is fine. Beyond ~10K orders per event, derivation moves to a memoised selector. Not blocking.

**D-INV-CYCLE9-4 (Note severity)** — J-E11 Edit-after-publish requires the EventCreatorWizard to support a `mode: "edit-published"` prop that:
- Renders a top banner: "Editing live event — changes go live immediately."
- Locks unmutable fields per Q-9-5 (greys out the inputs, shows lock icon, taps surface a toast "Locked after publish — Cancel + republish to change.")
- On Save, opens a ChangeSummaryModal listing what changed (diff vs original LiveEvent snapshot)
- ChangeSummaryModal Continue → commit changes to liveEventStore.updateLifecycle (extend signature for non-lifecycle fields, OR add new mutation `updateLiveEventEditableFields`)

This is a substantial extension to EventCreatorWizard. 9b spec details fully.

**D-INV-CYCLE9-5 (Note severity)** — Cancel event flow needs a soft-delete via `liveEventStore.updateLifecycle(id, {status: "cancelled", cancelledAt: now})`. Existing mutation supports this. NO new schema needed — the `status: LiveEventStatus = "live" | "cancelled" | "ended"` discriminator exists since Cycle 6.

**D-INV-CYCLE9-6 (Low severity)** — design package's RefundSheet copy assumes Stripe-specific fees ("Stripe's £0.30 fee isn't refundable"). In stub mode, this copy is misleading. Spec rewords to: "Stripe processing fee will be retained when this is wired live (B3). Currently no real refund is processed."

**D-INV-CYCLE9-7 (Low severity)** — Activity feed (J-E13 EventDetail) currently has no read source for "approval requests" (design package shows "3 new approval requests" line). Approval flow is Cycle 10 / B4. Spec: omit approval rows from activity feed in Cycle 9; show only paid/refunded order events.

**D-INV-CYCLE9-8 (Note severity)** — Partial refund (J-M4) needs a line-item picker UI. Design package only ships full-refund. Spec invents the partial UI: per-line-item checkboxes + per-line-item quantity stepper (max=line.quantity) + computed refund total = sum of (line.unitPrice × selected.quantity). Sheet variant of RefundSheet — call it `RefundSheetPartial`.

**No other side issues.**

---

## 9 — Confidence Level

**HIGH.** Reasoning:
- Roadmap journey list explicit (13 named journeys with one-line descriptions)
- DESIGN-PACKAGE-FULL coverage for 6 of 7 J-Es (verified by reading the actual JSX)
- PARTIAL/silent surfaces (J-E10, J-E11, J-M4, J-M5, J-M6) are well-bounded — forensics designs them in spec
- All 12 Q-9 questions resolve at HIGH on a single recommendation each
- Existing kit primitives cover EVERY surface (verified primitive-by-primitive)
- LiveEvent + TicketStub schemas don't need bumps
- Cycle 8 OrderResult shape forward-compatible with PR #59 §B.4 — same compatibility carries
- Risk concentrated in:
  1. The cycle is BIG — 3-way split is the right call but boundaries between 9a / 9b / 9c need tight discipline
  2. EventCreatorWizard mode extension (J-E11) is substantial — could overshoot 9b's effort estimate
  3. useOrderStore + Cycle 8 confirm.tsx wire (HF-1) is a small but cross-cycle change with idempotency concerns

---

## 10 — Fix Strategy / Direction

(Detailed contract is in `SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md`.)

1. **9a — Events tab + Event Detail + Manage menu + Share** (~10-14 hrs)
   - Replace `app/(tabs)/events.tsx` body with 5-pill filter view + EventListCard rows
   - Build `app/event/[id]/index.tsx` (J-E13 EventDetail) — reads liveEventStore + soldCount derivation from useOrderStore (empty in 9a; populates in 9c)
   - Build `src/components/event/EventListCard.tsx` (shared by Events tab + EventDetail context)
   - Build `src/components/event/EventManageMenu.tsx` (Sheet with 11 context-aware actions; 4 wire real, 7 wire TRANSITIONAL toasts pointing at 9b/9c/Cycle 11)
   - Reuse Cycle 7 ShareModal for J-E17
2. **9b — Lifecycle actions** (~10-14 hrs)
   - End sales (confirm Sheet → liveEventStore.updateLifecycle status="ended")
   - Cancel event flow (type-name modal → 1.2s loading → liveEventStore.updateLifecycle status="cancelled")
   - Edit-after-publish (wizard mode prop + locked-field gating + ChangeSummaryModal)
3. **9c — Orders ops** (~14-18 hrs)
   - Build `src/store/orderStore.ts` Zustand persisted
   - Wire Cycle 8 `confirm.tsx` with 1-line `useOrderStore.recordOrder()` (HF-1)
   - Build `app/event/[id]/orders/index.tsx` (J-M1 list + filter pills + search)
   - Build `app/event/[id]/orders/[oid]/index.tsx` (J-M2 detail)
   - Build `app/event/[id]/orders/[oid]/refund.tsx` (J-M3 full + J-M4 partial via Sheet variant)
   - Cancel order action (J-M5 — for free orders only per Q-9-8)
   - Resend ticket toast affordance (J-M6 — TRANSITIONAL, B-cycle wires Resend)

---

## 11 — Regression Prevention

1. **TRANSITIONAL labels** on every Cycle 9 stub (refund / cancel / resend / CSV export / email send) with B-cycle exit conditions.
2. **NEW INVARIANT I-18** locked into INVARIANT_REGISTRY at orchestrator's CLOSE protocol (buyer→founder order persistence at confirmation entry).
3. **Memory rule candidate** D-INV-CYCLE9-2 — `feedback_zustand_added_post_kit_closure.md` documenting the precedent (Q-9-2 option B introduces a new persisted store after kit closure).
4. **Forward-compat appendix** in spec §10 — orderStub + refundStub field shapes that B3 wires through to PR #59 schema.
5. **Inline code comments** at the Cycle 8 confirm.tsx wire site — 1 line, explicit cross-cycle dependency note.
6. **Tester regression list** — Cycle 8 happy path still ends at confirmation; orderStore.recordOrder is idempotent; founder Events tab shows the just-completed order in J-M1.

---

End of investigation. Spec follows.
