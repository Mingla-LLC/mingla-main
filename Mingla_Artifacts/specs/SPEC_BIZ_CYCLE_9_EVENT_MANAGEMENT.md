# Spec — BIZ Cycle 9 — Event Management (Events tab + lifecycle + orders)

**Date:** 2026-05-01
**Author:** mingla-forensics
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
**Estimated effort:** 3 sub-cycles. ~34–46 hrs implementor + ~6 hrs smoke. Total ~12 net-new files + 4 edits across all sub-cycles.

---

## 1 — Cycle Split (BINDING)

13 journeys is too big for a single implementor pass. **MANDATORY 3-way split:**

| Sub-cycle | Journeys | Effort | Net-new | Goal |
|-----------|----------|--------|---------|------|
| **9a** — Events tab + Event Detail + Manage menu + Share | J-E13, J-E14, J-E15, J-E17 | ~10–14 hrs | 4 NEW + 1 MOD | Founder finally sees their pipeline |
| **9b** — Lifecycle actions | J-E9, J-E10, J-E11 | ~10–14 hrs | 3 NEW + 1 MOD | End sales / Cancel event / Edit-after-publish |
| **9c** — Orders ops + useOrderStore wire | J-M1, J-M2, J-M3, J-M4, J-M5, J-M6 | ~14–18 hrs | 5 NEW + 2 MOD | Founder views orders + refunds + resends |

**Dispatch order:** 9a → 9b → 9c (per investigation §10). Each sub-cycle smoke-tests independently before next dispatches.

**Bundled commit policy:** Per Cycle 8 precedent, sub-cycles commit individually OR bundle. Recommend INDIVIDUAL commits for Cycle 9 (each sub-cycle is large enough to warrant its own restore-point).

---

## 2 — Scope

This spec covers all 3 sub-cycles. Each sub-cycle has a self-contained §3.X / §4.X / §5.X / §6.X block below. Shared decisions (§3.0) apply to all three.

**Non-goals (entire cycle):**
- ❌ NO real Stripe refund API call (B3)
- ❌ NO real email send (B-cycle Resend)
- ❌ NO real CSV export (B-cycle)
- ❌ NO new Supabase tables (PR #59 lands separately)
- ❌ NO new kit primitive without DEC-079 carve-out
- ❌ NO Home tab modifications (Cycle 11 owns "Live tonight")
- ❌ NO touch on checkout / public surfaces (Cycles 6/7/8 own)
- ❌ NO `oklch` / `lab` / `lch` (memory rule)
- ❌ NO multi-currency (GBP only)
- ❌ NO seat selection / venue map (deferred)
- ❌ NO promo codes (deferred)

---

## 3.0 — Shared decisions (apply to ALL sub-cycles)

### 3.0.1 — Q-9 resolutions (BINDING)

| Q | Decision |
|---|----------|
| Q-9-2 | Orders persist via NEW `useOrderStore` (Zustand persisted, eventId-keyed). Cycle 8 `confirm.tsx` adds `useOrderStore.getState().recordOrder(...)` AFTER existing `recordResult` call. Idempotent dedupe by orderId. |
| Q-9-3 | Refund stub processing = 1.2s simulated (matches Cycle 8 Stripe stub). |
| Q-9-4 | Cancel event "type the name" = case-insensitive exact match (`confirm.trim().toLowerCase() === event.name.trim().toLowerCase()`). |
| Q-9-5 | Edit-after-publish mutable: `description, coverHue, social links, FAQ (if exists), tagline`. LOCKED: `name, date, doorsOpen, endsAt, venueName, address, tickets[], whenMode, recurrenceRule, multiDates, category`. Cancel + republish to change locked fields. |
| Q-9-6 | Orders Export = Toast "CSV export lands B-cycle." Affordance visible. |
| Q-9-7 | Manage menu = 11 actions (per investigation OBS-4). Status-gated. |
| Q-9-8 | Refund (paid) vs Cancel order (free / no-show) — mutually exclusive per status. |
| Q-9-9 | Past events with no activity render in Past tab, faded `opacity: 0.7`. |
| Q-9-10 | NO TOUCH on Home tab (Cycle 11). |
| Q-9-11 | Activity feed shows last 5 paid+refunded order events. Empty: "No activity yet." NO approval rows in Cycle 9 (Cycle 10 owns). |
| Q-9-12 | Default filter pill = "Upcoming" (fallback "All" if zero upcoming). |

### 3.0.2 — OrderStub data shape (forward-compat with PR #59 §B.4)

```ts
// mingla-business/src/store/orderStore.ts — exported alongside store

export type OrderStubStatus = "paid" | "refunded" | "partial_refund" | "cancelled";
export type OrderStubPaymentMethod = "card" | "apple_pay" | "google_pay" | "free";

export interface OrderStubLine {
  ticketTypeId: string;
  ticketName: string;     // snapshot for display stability
  quantity: number;
  unitPriceGbp: number;   // 0 for free
  isFree: boolean;
}

export interface OrderStubRefund {
  id: string;             // ref_<ts36>_<rand4>
  orderId: string;
  amountGbp: number;
  scope: "full" | "partial";
  /** For partial: which lines + how many of each were refunded. */
  refundedLines?: Array<{ ticketTypeId: string; quantity: number }>;
  refundedAt: string;     // ISO 8601
  /** TRANSITIONAL — B3 wires Stripe refund API + populates real txn ID. */
  stripeRefundId: null;
}

export interface OrderStub {
  id: string;             // ord_<ts36>_<rand4> from Cycle 8 stubOrderId
  eventId: string;
  brandId: string;        // denormalised for cross-event listings (future)
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  marketingOptIn: boolean;
  lines: OrderStubLine[];
  totalGbp: number;
  paymentMethod: OrderStubPaymentMethod;
  status: OrderStubStatus;
  refunds: OrderStubRefund[];
  ticketIds: string[];    // tkt_<order-suffix>_<line>_<seat> from Cycle 8 stubOrderId
  paidAt: string;         // ISO 8601 (creation timestamp)
  cancelledAt: string | null;
}
```

PR #59 §B.4 forward-compat (1:1 maps at B3 wire boundary):

| OrderStub field | PR #59 column | Conversion |
|-----------------|---------------|------------|
| `id` | `orders.id` | replaced — B3 issues real ID |
| `eventId` | `orders.event_id` | 1:1 |
| `brandId` | derived from event.brand_id (FK chain) | derived |
| `buyer*` | `orders.buyer_name` / `buyer_email` / `buyer_phone_e164` | 1:1 with E.164 normalisation |
| `lines[].unitPriceGbp` | `order_line_items.unit_price_gbp_pence` | × 100 (whole-units → pence) |
| `totalGbp` | `orders.total_gbp_pence` | × 100 |
| `status` | `orders.status` | 1:1 |
| `refunds[]` | `refunds` table rows | 1 OrderStubRefund → 1 refund row |
| `ticketIds` | `tickets` table rows (one per ticketId) | 1:1 |

### 3.0.3 — useOrderStore contract

```ts
// mingla-business/src/store/orderStore.ts

export interface OrderState {
  orders: OrderStub[];
  recordOrder: (input: Omit<OrderStub, "status" | "refunds" | "cancelledAt"> & { status?: OrderStubStatus }) => void; // idempotent — dedupes by id
  recordRefund: (orderId: string, refund: Omit<OrderStubRefund, "id" | "orderId" | "stripeRefundId" | "refundedAt">) => void;
  cancelOrder: (orderId: string) => void;
  reset: () => void; // wired into clearAllStores per Const #6
}

export const useOrderStore = create<OrderState>()(persist(...));
export const useOrdersForEvent = (eventId: string | null): OrderStub[] => ...;
export const useOrderById = (orderId: string | null): OrderStub | null => ...;
export const useSoldCountForTicketType = (eventId: string, ticketTypeId: string): number => ...; // derived selector
```

Persist name: `mingla-business.orderStore.v1`.

`recordOrder` is idempotent: if `orders.find(o => o.id === input.id)` exists, no-op. Default status="paid" if not provided.

### 3.0.4 — Memory rules apply across ALL sub-cycles

- `feedback_keyboard_never_blocks_input.md` — applies to orders search Input (J-M1), partial-refund amount Input (J-M4), type-the-name Input (J-E10).
- `feedback_rn_color_formats.md` — only hex/rgb/hsl/hwb. Buyer avatar hue → `hsl(hue, 60%, 45%)`.
- `feedback_toast_needs_absolute_wrap.md` — every Toast in absolute-positioned wrap with zIndex 100.
- `feedback_back_listener_disarm_pattern.md` — if Cycle 9 adds back-blocking, use ref-flag.
- `feedback_anon_buyer_routes.md` — Cycle 9 routes ALL go INSIDE `(tabs)` (founder context). Don't accidentally make manage routes anon-tolerant.
- `feedback_implementor_uses_ui_ux_pro_max.md` — UI-heavy cycle; `/ui-ux-pro-max` pre-flight required at each sub-cycle's implementor dispatch.

---

## 3.A — Sub-cycle 9a — Events tab + Event Detail + Manage menu + Share

### 3a.1 — Files affected

| File | Type | Purpose |
|------|------|---------|
| `mingla-business/app/(tabs)/events.tsx` | MOD | Replace drafts-only body with 5-pill filter view |
| `mingla-business/src/components/event/EventListCard.tsx` | NEW | Reusable list-row (cover + status pill + title + date+venue + progress bar + revenue + manage IconChrome) |
| `mingla-business/src/components/event/EventManageMenu.tsx` | NEW | Sheet primitive with 11 context-aware actions |
| `mingla-business/app/event/[id]/index.tsx` | NEW | J-E13 Event Detail — KPIs + ticket types + recent activity |
| `mingla-business/src/components/event/EventDetailKpiCard.tsx` | NEW | Revenue + payout glass card (sparkline placeholder until B-cycle analytics) |

### 3a.2 — Component contracts

#### `events.tsx` (MOD)

State:
```tsx
const [filter, setFilter] = useState<EventFilter>("upcoming"); // Q-9-12 default
type EventFilter = "all" | "live" | "upcoming" | "draft" | "past";
```

Body replaces drafts-only with:
- Filter pills row (5 pills: All / Live / Upcoming / Drafts / Past) — pills use existing `Pill` component composition; "Live" pill has live-pulse dot when count > 0
- Pill counts derived from `useDraftsForBrand(brandId)` + `useLiveEventsForBrand(brandId)` + computed status (live/upcoming/past from event.date + event.status)
- For each event in filtered list: `<EventListCard event={event} brand={brand} onOpen={...} onManageOpen={...} />`
- Empty filter: GlassCard "No events here. Tap the + button to start a new event."
- Footer: REMOVED (no more "Cycle 9 lands later" message — this IS Cycle 9)

Status derivation per event:
```ts
function deriveStatus(event: LiveEvent): "live" | "upcoming" | "past" {
  if (event.status === "cancelled") return "past"; // cancelled events show in Past
  if (event.endedAt !== null) return "past";
  if (event.date === null) return "upcoming"; // no date = upcoming-undated
  const eventTime = new Date(event.date).getTime();
  const liveWindowStart = eventTime - 4 * 60 * 60 * 1000; // 4h before
  const liveWindowEnd = eventTime + 24 * 60 * 60 * 1000; // 24h after start
  const now = Date.now();
  if (now >= liveWindowStart && now < liveWindowEnd) return "live";
  if (now < liveWindowStart) return "upcoming";
  return "past";
}
```

Drafts unify with the same component but use `Draft` type from draftEventStore — EventListCard accepts `kind: "live" | "draft"` discriminator OR two parallel components. Implementor judgment.

#### `EventListCard.tsx` (NEW)

Props:
```tsx
interface EventListCardProps {
  event: LiveEvent | DraftEvent;
  brand: Brand;
  status: "live" | "upcoming" | "draft" | "past";
  onOpen: () => void;          // opens /event/{id}/ (live) or /event/{id}/edit (draft)
  onManageOpen: () => void;    // opens EventManageMenu
}
```

Render:
- 76×92 cover (EventCover hue from event.coverHue) + DRAFT overlay if status="draft"
- Body: status pill + title (bold, ellipsised) + date+venue line (tertiary, ellipsised) + progress bar (sold/cap pct) OR "Series template" sub-text for draft series
- Right rail: manage IconChrome (icon="moreH"); for non-draft: revenue + soldDelta footer
- Past status: opacity 0.7 if soldCount === 0 (Q-9-9)
- Tap card body → onOpen
- Tap manage IconChrome → onManageOpen

Computed:
- `soldCount` for live/upcoming/past: derived via `useSoldCountForEvent(event.id)` selector (sums all paid+partial-refund order line quantities). Empty in 9a until 9c wires useOrderStore. Show "0 / cap" or "—" gracefully.
- `revenueGbp` derived: `useRevenueForEvent(event.id)` (sums totalGbp for paid + partial_refund orders). Empty in 9a.

#### `EventManageMenu.tsx` (NEW)

Props:
```tsx
interface EventManageMenuProps {
  visible: boolean;
  onClose: () => void;
  event: LiveEvent | DraftEvent;
  status: "live" | "upcoming" | "draft" | "past";
  brand: Brand;
}
```

Implementation: Sheet primitive (snap="peek" or numeric content-fit per DEC-084). Body is a vertical list of 11 actions, status-gated:

| Action | Always | Live | Upcoming | Draft | Past | Action |
|--------|--------|------|----------|-------|------|--------|
| Edit details | ✓ | ✓ | ✓ | ✓ | ✓ (limited) | router.push to /event/{id}/edit |
| View public page | ✓ | ✓ | ✓ | — (draft has no public) | ✓ | router.push to /b/{brand.slug}/{event.eventSlug} |
| Open scanner | — | ✓ | — | — | — | Toast "Scanner lands Cycle 11" |
| Orders | — | ✓ | ✓ | — | ✓ | router.push to /event/{id}/orders (9c live) — until 9c lands: Toast "Orders lands Cycle 9c" |
| Copy share link | ✓ | ✓ | ✓ | — | ✓ | reuse Cycle 7 ShareModal — opens it |
| Publish event | — | — | — | ✓ | — | router.push to /event/{id}/edit (publish flow at last step) |
| End ticket sales | — | ✓ | — | — | — | Toast "End sales lands Cycle 9b" — until 9b: TRANSITIONAL |
| Duplicate | — | — | ✓ | — | — | Toast "Duplicate lands future polish dispatch" |
| Delete event | — | — | — | ✓ | — | Toast "Delete lands Cycle 9b" — until 9b: TRANSITIONAL |
| Issue refunds | — | — | — | — | ✓ | router.push to /event/{id}/orders (9c) — until 9c: Toast |
| Duplicate as new | — | — | — | — | ✓ | Toast "Duplicate as new lands future polish" |

Sheet snap = numeric content-fit (DEC-084) — auto-sized to action count.

Each action row: `<Pressable>` with leading icon (size 18, color varies by tone) + label + trailing chevron-right OR none. Tones: default (text.secondary), accent (orange), warn (amber), danger (error red).

Cancel event NOT in this menu — lives only on Event Detail screen primary actions OR via "End ticket sales" → secondary "Cancel event" path. Per design package and to avoid double-action confusion.

#### `app/event/[id]/index.tsx` (NEW — J-E13)

Route: `/event/{id}` (id = LiveEvent.id `le_<ts36>` OR DraftEvent.id `de_<ts36>`)

Behavior:
- Read id from useLocalSearchParams
- Try liveEventStore.getLiveEvent(id) first; fall back to draftEventStore.useDraftById(id) if null
- If both null: EmptyState "Event not found" + "Back" CTA
- If draft: redirect to /event/{id}/edit (drafts have no Detail screen)
- If live: render EventDetail (specified below)

Header: TopBar with leftKind="back" + title="Event" + right=[ShareIconChrome, manage IconChrome (opens EventManageMenu)]

Body:
1. Hero: 200×full-width EventCover (event.coverHue) overlay + status pill + event name (h1) + date+venue subline
2. Action grid 2-col: Scan tickets (primary, accent — Toast "Cycle 11"), Orders (sub="X sold" — router.push 9c, Toast 9a), Guests (sub="X pending" — Toast "Cycle 10 + B4"), Public page (router.push), Brand page (router.push)
3. Revenue card: revenue + payout (payout = revenue × 0.96 stub — TRANSITIONAL: "Stripe fee math wires in B3"). Empty in 9a until orderStore populates.
4. Ticket types section: header label + list of `<TicketTypeRow>` (per TicketStub from event.tickets[]). Shows name + price + sold/cap + sold-out badge. soldCount derived from orderStore (empty in 9a).
5. Recent activity section: header label + glass-card list of last 5 activity rows. Empty: "No activity yet."
6. Bottom safe-area spacer.

Cancel event button: NOT in 9a (lands in 9b). 9a renders EventDetail without cancel CTA.

#### `EventDetailKpiCard.tsx` (NEW)

Reusable revenue + payout card. Sparkline placeholder (simple horizontal bars or empty state until B-cycle analytics).

Props: `{ revenueGbp: number; payoutGbp: number; recentActivityChartData?: number[] }`. Uses formatGbp. SparklineBar is a stub `<View>` row of 12 height-varied bars rendered in glass.tint.profileBase.

### 3a.3 — Acceptance criteria (9a only)

| AC | Criterion |
|----|-----------|
| 9a-AC#1 | Open Events tab → 5 filter pills render with correct counts |
| 9a-AC#2 | Default filter = "Upcoming" (Q-9-12); fallback "All" if zero upcoming |
| 9a-AC#3 | Tapping a pill filters the list; live pill shows live-pulse dot when count > 0 |
| 9a-AC#4 | EventListCard renders cover + status pill + title + date+venue + progress bar + revenue (when applicable) |
| 9a-AC#5 | Past events with soldCount=0 render at opacity 0.7 |
| 9a-AC#6 | Tap card → /event/{id}/index.tsx (live) or /event/{id}/edit.tsx (draft) |
| 9a-AC#7 | Tap manage IconChrome → EventManageMenu Sheet opens |
| 9a-AC#8 | Manage menu shows correct subset of 11 actions per status |
| 9a-AC#9 | Tap Edit details → /event/{id}/edit.tsx |
| 9a-AC#10 | Tap View public page → /b/{brand.slug}/{event.eventSlug} (frozen slugs per I-17) |
| 9a-AC#11 | Tap Copy share link → opens Cycle 7 ShareModal |
| 9a-AC#12 | Tap Open scanner / End ticket sales / Delete event → TRANSITIONAL toasts |
| 9a-AC#13 | Tap Orders / Issue refunds → TRANSITIONAL toast (until 9c lands) |
| 9a-AC#14 | EventDetail (J-E13) renders hero + action grid + revenue card + ticket types + activity feed |
| 9a-AC#15 | Action grid CTAs all wire (some toasts, some real navigation) |
| 9a-AC#16 | Activity feed shows "No activity yet" until 9c populates orderStore |
| 9a-AC#17 | Empty filter renders "No events here." GlassCard with copy |
| 9a-AC#18 | TypeScript strict EXIT=0 |
| 9a-AC#19 | grep `oklch(` in `mingla-business/src/components/event` returns 0 |
| 9a-AC#20 | NO regression on Cycle 6/7/8 |

### 3a.4 — Test cases (9a)

| Test | Scenario |
|------|----------|
| T-9a-01 | Web Chrome — Events tab opens to Upcoming pill default |
| T-9a-02 | iOS sim — same |
| T-9a-03 | Filter pill counts match real events (verify by manually counting) |
| T-9a-04 | Tap Live pill — only live events render |
| T-9a-05 | Tap a draft card → /event/{id}/edit |
| T-9a-06 | Tap a live card → /event/{id} (Detail) |
| T-9a-07 | Tap manage IconChrome on a live event → menu shows 8 actions (excludes Publish, Duplicate-upcoming, Issue refunds, Duplicate as new) |
| T-9a-08 | Tap manage IconChrome on a past event → menu shows 7 actions (excludes Publish, End sales, Duplicate-upcoming, Delete) |
| T-9a-09 | Tap Copy share link → ShareModal opens with correct URL |
| T-9a-10 | Tap End ticket sales → Toast "End sales lands Cycle 9b" (positioned correctly per Toast wrap rule) |
| T-9a-11 | EventDetail renders all 5 sections (hero, action grid, revenue, ticket types, activity) |
| T-9a-12 | Past event with 0 sold renders faded |
| T-9a-13 | tsc strict EXIT=0 |
| T-9a-14 | Regression — Cycle 6 PublicEventPage 7 variants still work |
| T-9a-15 | Regression — Cycle 7 brand page + share modal still work |
| T-9a-16 | Regression — Cycle 8 checkout flow still works end-to-end |

### 3a.5 — Hard constraints (9a)

- ❌ NO orderStore wire-up in 9a (lands in 9c). 9a renders empty activity feed + "—" revenue.
- ❌ NO real End sales / Cancel / Delete logic — TRANSITIONAL toasts only.
- ❌ NO touch on /event/[id]/edit.tsx (already wired by Cycle 3).
- ✅ Reuse Cycle 7 ShareModal for J-E17 verbatim.
- ✅ Mirror Cycle 6/7/8 dark-glass visual language.
- ✅ Toast wraps absolute-positioned per memory rule.

---

## 3.B — Sub-cycle 9b — Lifecycle actions

### 3b.1 — Files affected

| File | Type | Purpose |
|------|------|---------|
| `mingla-business/src/components/event/EndSalesSheet.tsx` | NEW | J-E9 confirm sheet → liveEventStore status="ended" |
| `mingla-business/app/event/[id]/cancel.tsx` | NEW | J-E10 Cancel event flow (type-name modal) |
| `mingla-business/src/components/event/EditAfterPublishBanner.tsx` | NEW | J-E11 banner + ChangeSummaryModal |
| `mingla-business/src/components/event/EventCreatorWizard.tsx` | MOD | J-E11 mode prop adds banner + locked-field gating + change-summary on save |
| `mingla-business/src/store/liveEventStore.ts` | MOD | Extend `updateLifecycle` to also accept editable-field patches OR new mutation `updateLiveEventEditableFields` (implementor judgment per I-16 ownership) |
| `mingla-business/src/components/event/EventManageMenu.tsx` | MOD | Wire End sales / Cancel event / Delete to real handlers (replace 9a TRANSITIONAL toasts) |
| `mingla-business/app/event/[id]/index.tsx` | MOD | Add "Cancel event" CTA in primary action area |

### 3b.2 — Component contracts

#### J-E9 — EndSalesSheet

Sheet primitive, snap="half". Body: title "End ticket sales?" + body "Buyers can no longer purchase. Existing tickets remain valid. You can still scan tickets at the door." + Confirm Button (variant=destructive) + Cancel Button (ghost).

On Confirm: 800ms processing → liveEventStore.updateLifecycle(id, {status: "ended"}) → Toast "Ticket sales ended" → close sheet.

Status mapping: `"ended"` here is a Cycle 9 semantic (sales closed) — distinct from the time-based "past" derivation. To distinguish: add a new status value? OR use existing `endedAt` field with explicit timestamp? Recommended: set `endedAt: new Date().toISOString()` on the LiveEvent — this triggers the existing `past` derivation in EventListCard's `deriveStatus`. NO new field. Const #2.

#### J-E10 — Cancel event flow (`app/event/[id]/cancel.tsx` route)

Full-screen modal (router.push → modal-style screen with no tab bar via stack option `presentation: "modal"`).

Body:
- Header: "Cancel event"
- Body: "This is a serious action. Buyers will be notified by email and refunded automatically. You can't undo this."
- Type confirmation Input: "Type the event name to confirm" + placeholder shows actual event name
- Confirm Button (destructive, full-width, disabled until match) — label "Cancel event"
- Cancel Button (ghost) — label "Keep event live" → router.back()

On Confirm:
- 1.2s simulated processing
- liveEventStore.updateLifecycle(id, {status: "cancelled", cancelledAt: now})
- TRANSITIONAL: email cascade is no-op stub. Code comment: `// [TRANSITIONAL] Buyer email cascade wires in B-cycle (Resend integration). Currently no email sent.`
- Toast "Event cancelled. Buyers will be refunded when emails wire up (B-cycle)."
- router.replace to /(tabs)/events

#### J-E11 — Edit-after-publish

Mode prop on EventCreatorWizard: `mode: "create" | "edit-published"`.

When mode === "edit-published":
1. Render EditAfterPublishBanner at top: orange-tinted GlassCard "You're editing a live event — changes go live immediately when you save."
2. Locked-field gating: per Q-9-5, fields like name/date/venueName/tickets are disabled. Tap on locked field → Toast "Locked after publish — Cancel + republish to change."
3. Save flow: instead of publishDraft, call new mutation that diffs current LiveEvent vs wizard form values. If diff is empty: Toast "No changes." If diff has entries: open ChangeSummaryModal.
4. ChangeSummaryModal: list each changed field with old → new ("Description: 'old text...' → 'new text...'"). Confirm Button → liveEventStore.updateLiveEventEditableFields + Toast "Saved. Live now." → router.back to /event/{id}. Cancel → close modal, no save.

This is the most substantial 9b component. Implementor estimates ~6-8 hrs alone.

### 3b.3 — Acceptance criteria (9b)

| AC | Criterion |
|----|-----------|
| 9b-AC#1 | Manage menu (live event) → tap End sales → EndSalesSheet opens |
| 9b-AC#2 | Confirm End sales → 800ms → status="ended" → live pill becomes Past pill on Events tab |
| 9b-AC#3 | EventDetail (live) → Cancel event CTA tap → /event/{id}/cancel route opens |
| 9b-AC#4 | Cancel event Confirm disabled until typed name matches case-insensitive |
| 9b-AC#5 | Confirm Cancel → 1.2s → status="cancelled" → router.replace to events tab → event in Past pill |
| 9b-AC#6 | Manage menu (draft) → tap Delete event → ConfirmDialog → confirm → draft removed from store |
| 9b-AC#7 | Edit a live event → wizard renders EditAfterPublishBanner |
| 9b-AC#8 | Tap a locked field (e.g., date picker) → Toast "Locked after publish — Cancel + republish to change." |
| 9b-AC#9 | Tap an editable field (description) → can edit normally |
| 9b-AC#10 | Save with no changes → Toast "No changes" |
| 9b-AC#11 | Save with changes → ChangeSummaryModal lists each diff |
| 9b-AC#12 | Confirm save → Toast "Saved. Live now." → liveEvent reflects updates |
| 9b-AC#13 | TypeScript strict EXIT=0 |
| 9b-AC#14 | NO regression on 9a or earlier cycles |

### 3b.4 — Hard constraints (9b)

- ❌ NO real email send (TRANSITIONAL).
- ❌ NO new schema fields on LiveEvent (use existing status + endedAt + cancelledAt).
- ❌ NO multi-undo for Cancel event (it's irreversible per design).
- ✅ ChangeSummaryModal uses ConfirmDialog primitive OR Sheet with custom body (implementor judgment).
- ✅ EditAfterPublishBanner is composed (no new primitive).

---

## 3.C — Sub-cycle 9c — Orders ops + useOrderStore wire

### 3c.1 — Files affected

| File | Type | Purpose |
|------|------|---------|
| `mingla-business/src/store/orderStore.ts` | NEW | useOrderStore Zustand persisted (per §3.0.3) |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | MOD | 1-line `useOrderStore.getState().recordOrder(...)` after recordResult |
| `mingla-business/app/event/[id]/orders/index.tsx` | NEW | J-M1 Orders list |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | NEW | J-M2 Order detail |
| `mingla-business/app/event/[id]/orders/[oid]/refund.tsx` | NEW | J-M3 + J-M4 Refund (full + partial via Sheet) |
| `mingla-business/src/components/event/RefundSheet.tsx` | NEW | Full + partial refund Sheet |
| `mingla-business/src/components/event/EventManageMenu.tsx` | MOD | Wire Orders / Issue refunds to real router.push (replace 9a TRANSITIONAL toasts) |
| `mingla-business/app/event/[id]/index.tsx` | MOD | Wire Orders ActionTile to real router.push; recent activity reads from useOrderStore |
| `mingla-business/src/components/event/EventListCard.tsx` | MOD | Wire soldCount + revenue derivations to useOrderStore |
| `mingla-business/src/store/clearAllStores.ts` (if exists) | MOD | Wire useOrderStore.reset() into logout sequence |

### 3c.2 — Component contracts

#### Cycle 8 confirm.tsx wire (CRITICAL — HF-1)

Add ONE line after the existing `recordResult` call in the success / 3DS-success / free-skip paths. The exact line:

```tsx
useOrderStore.getState().recordOrder({
  id: orderResult.orderId,
  eventId,
  brandId: event.brandId,
  buyerName: buyer.name,
  buyerEmail: buyer.email,
  buyerPhone: buyer.phone,
  marketingOptIn: buyer.marketingOptIn,
  lines: lines.map(l => ({...l})),
  totalGbp: orderResult.totalGbp,
  paymentMethod: orderResult.paymentMethod,
  ticketIds: orderResult.ticketIds,
  paidAt: orderResult.paidAt,
});
```

Idempotent — recordOrder dedupes by id. If buyer reloads /confirm, no duplicate creation.

Inline comment: `// [Cycle 9] Mirror OrderResult into useOrderStore so founder J-M1 reflects real (stub) purchases. Idempotent. See I-18.`

#### J-M1 — `app/event/[id]/orders/index.tsx`

Reads `useOrdersForEvent(eventId)`. Filter pills: All / Paid / Refunded / Pending (Pending = approval-required orders, Cycle 10 — show 0 in 9c). Search Input filters by buyerName / buyerEmail / order ID substring (case-insensitive).

Order row: Avatar (initials, hue from `hsl(orderId.charCodeAt(4) * 7 % 360, 60%, 45%)` — derived hue, no oklch), buyerName + orderId·tickets·timeAgo, totalGbp right-aligned, status badge for refunded/cancelled.

Top-right IconChrome "settings" → opens action sheet with "Export CSV" → Toast "CSV export lands B-cycle".

Empty state: "No orders yet" / "No orders match your search" / "No refunded orders."

#### J-M2 — `app/event/[id]/orders/[oid]/index.tsx`

Reads `useOrderById(oid)`. Renders header (avatar + buyerName + buyerEmail), status banner (paid green / refunded red / partial-refund amber / cancelled grey), order summary GlassCard (Order ID, ticketTypes line, subtotal, service fee — stub at 4%, total, payment method).

Primary CTA: "Refund order" if status==="paid" AND paymentMethod !== "free"; "Cancel order" if status==="paid" AND paymentMethod === "free"; greyed/hidden if already refunded/cancelled.

Secondary CTA: "Resend ticket email" → 800ms processing → Toast "Ticket re-sent to {email}" (TRANSITIONAL — no real email).

Top-right IconChrome "moreH" opens action sheet with "Cancel order" (alternate path), "Mark as no-show" (Cycle 11 future — Toast).

#### J-M3 + J-M4 — Refund (full + partial)

Two-step Sheet (RefundSheet.tsx).

Step 1: scope picker. "Refund all £X.XX" Button (Q-9-3 default) + "Refund partial..." Button (advances to step 2).

Step 2: per-line-item picker. For each OrderStubLine: row with checkbox + ticket name + Stepper (0..line.quantity, default=line.quantity if checked). Total computed live: `sum of (line.unitPriceGbp × selectedQty)`. "Refund £X.XX" Button at bottom (disabled when 0).

On Confirm (either step): 1.2s processing → useOrderStore.recordRefund(orderId, refund) → status updates to refunded (full) or partial_refund (partial) → close Sheet → Toast "Refund sent. Buyer will see it on their card in 3-5 days." (TRANSITIONAL — no real Stripe call).

Inline comment in handleConfirm: `// [TRANSITIONAL] Real Stripe refund API call wires in B3. Currently no money moves.`

#### J-M5 — Cancel order (free orders only per Q-9-8)

ConfirmDialog: "Cancel this free reservation? The buyer will lose their ticket." Confirm → useOrderStore.cancelOrder(orderId) → status="cancelled" → Toast "Order cancelled."

#### J-M6 — Resend ticket

Button on Order detail. 800ms simulated processing → Toast "Ticket re-sent to {email}." Code comment: `// [TRANSITIONAL] Resend integration in B-cycle.`

### 3c.3 — Acceptance criteria (9c)

| AC | Criterion |
|----|-----------|
| 9c-AC#1 | Cycle 8 happy path → confirm.tsx → useOrderStore.recordOrder fires once |
| 9c-AC#2 | Reload confirm.tsx → recordOrder is idempotent (no duplicate) |
| 9c-AC#3 | Founder J-M1 → opens via manage menu Orders OR EventDetail Orders ActionTile |
| 9c-AC#4 | J-M1 renders all orders for the event with correct counts in filter pills |
| 9c-AC#5 | Search Input filters live (debounced if needed) |
| 9c-AC#6 | Tap Export → Toast "CSV export lands B-cycle" |
| 9c-AC#7 | Tap order row → /event/{id}/orders/{oid} J-M2 |
| 9c-AC#8 | J-M2 renders buyer + order summary + status banner + correct CTA per status |
| 9c-AC#9 | Tap Refund order (paid) → /event/{id}/orders/{oid}/refund opens RefundSheet |
| 9c-AC#10 | RefundSheet step 1 → tap "Refund all" → 1.2s → status=refunded → Toast |
| 9c-AC#11 | RefundSheet step 2 → partial line picker → checkbox + Stepper work correctly → total updates live |
| 9c-AC#12 | Confirm partial refund → 1.2s → status=partial_refund → Toast |
| 9c-AC#13 | Tap Cancel order (free) → ConfirmDialog → status=cancelled |
| 9c-AC#14 | Tap Resend ticket email → 800ms → Toast "Ticket re-sent" |
| 9c-AC#15 | Activity feed on EventDetail populates from useOrderStore (last 5 events) |
| 9c-AC#16 | EventListCard soldCount + revenue display correctly from orderStore |
| 9c-AC#17 | Logout clears useOrderStore (Const #6) |
| 9c-AC#18 | TypeScript strict EXIT=0 |
| 9c-AC#19 | grep `oklch(` in `mingla-business/app/event` returns 0 |
| 9c-AC#20 | NO regression on Cycle 8 happy path (cart still records via Cart Context) |

### 3c.4 — Hard constraints (9c)

- ❌ NO real Stripe refund API
- ❌ NO real CSV export (Toast stub)
- ❌ NO real Resend email (Toast stub)
- ❌ Refund partial-refund total MUST round to pence (use formatGbp)
- ✅ recordOrder idempotency by orderId
- ✅ Buyer avatar hue uses hsl(), NOT oklch (memory rule)
- ✅ Toast wraps absolute-positioned per memory rule

---

## 4 — Invariants

| ID | Status |
|----|--------|
| I-11..I-17 | All preserved per investigation §7 |
| **NEW I-18** — Buyer→Founder order persistence | Cycle 8 confirm.tsx must call useOrderStore.recordOrder exactly once per orderId. Idempotent. Tester verifies with reload + dedupe check. |
| Const #1..#14 | All preserved per investigation §7 |

I-18 added to INVARIANT_REGISTRY.md at orchestrator's CLOSE protocol after 9c smokes.

---

## 5 — Tester regression list (across all sub-cycles)

1. Cycle 6 PublicEventPage 7 variants
2. Cycle 7 PublicBrandPage + share modal
3. Cycle 8 full checkout happy path (Card / Free / 3DS / Decline)
4. Cycle 8 confirmation native back-block + "Back to event" CTA disarm
5. Logout clears all stores including new useOrderStore (after 9c)
6. Cold start (AsyncStorage clear) — orderStore re-hydrates correctly OR is empty
7. Edit existing draft (Cycle 3 wizard) — unaffected by 9b's mode prop addition
8. Founder Account tab → brand profile → "View public page" still works (Cycle 7 FX1 wiring)

---

## 6 — Discovered during spec writing

**D-INV-CYCLE9-9 (Note severity)** — End ticket sales mutation reuses existing `liveEventStore.updateLifecycle` with `endedAt: now`. This collapses two semantically distinct states ("sales closed but event hasn't happened" vs "event has ended naturally") into the same `endedAt` field. For Cycle 9 stub mode this is acceptable. Future polish: add `salesEndedAt` separate from `endedAt`. Not blocking.

**D-INV-CYCLE9-10 (Note severity)** — Service fee math on Order detail (`Subtotal £X.XX, Service fee £Y.YY, Total £Z.ZZ`) — Cycle 8 cart shape doesn't track service fee separately. Cycle 9 stub: render serviceFee = 0 in stub mode (`Subtotal = Total`). Code comment: `// [TRANSITIONAL] Stripe fee math wires in B3. Stub renders 0 service fee.`

**D-INV-CYCLE9-11 (Low severity)** — Sub-cycle 9b's EventCreatorWizard mode extension is the most complex single component change in Cycle 9. Implementor may want to recommend a 9b-1 / 9b-2 split if the wizard mode work overshoots its 10-14 hr estimate. Document for orchestrator visibility.

**D-INV-CYCLE9-12 (Low severity)** — Implementor must verify ConfirmDialog primitive exists at `mingla-business/src/components/ui/ConfirmDialog.tsx` per DEC-085. If not, implementor surfaces the gap; Cycle 9b's Cancel event flow uses a custom Sheet body instead.

---

## 7 — Estimated scope summary

| Cycle | NEW files | MOD files | LOC | Wall hours |
|-------|-----------|-----------|-----|------------|
| 9a | 4 | 1 | ~700-900 | ~10-14 |
| 9b | 3 | 3 | ~700-900 | ~10-14 (with wizard mode extension risk) |
| 9c | 5 | 4 | ~1,000-1,300 | ~14-18 |
| **TOTAL** | **12** | **8** | **~2,400-3,100** | **~34-46** |

(Tester smoke ~2 hours per sub-cycle = ~6 hours total.)

---

## 8 — Dispatch order

1. Orchestrator reviews this spec + investigation
2. User confirms Q-9 resolutions + 9a/9b/9c split
3. Orchestrator writes IMPLEMENTOR dispatch for 9a → user dispatches → smoke → CLOSE protocol
4. Orchestrator writes IMPLEMENTOR dispatch for 9b → smoke → CLOSE
5. Orchestrator writes IMPLEMENTOR dispatch for 9c → smoke → CLOSE → Cycle 9 fully closed → Cycle 10 dispatches

---

End of spec.
