# INVESTIGATION — ORCH-0913 [Trip dashboard tile-grid + recent-activity + revenue/spots-strip full parity with event dashboard]

**Investigator:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0913_TRIP_DASHBOARD_PARITY.md`
**Severity:** S1-high · **Classification:** `design-debt` + `ux` + `missing-feature`
**Confidence:** HIGH (code-truth audit; full source read of both dashboards)

---

## 1. Layman summary

Today's trip dashboard is structurally different from the event dashboard: trip shows 4 small tiles + a primary "Edit trip" button + a 3-tab strip (Overview / Travelers / Money). Event shows 9–10 tiles in a single grid + a Revenue/Payout strip + a Ticket Types section + a Recent Activity feed + a Cancel CTA. The fix is to replace the 3-tab strip on trip with the same tile-grid + section-beneath pattern event uses, port a Recent Activity feed wired to trip-side data sources (orders + installments + lifecycle events), and add a Revenue/Spots-Capacity strip that mirrors event's KPI card. The existing tile primitive (`ActionTile`) is already shared between both dashboards — zero extraction work needed. Cancel-trip CTA stays where it is. ORCH-0914 (Money tab content redesign) ships into the new Money tile's destination route after ORCH-0913 lands.

---

## 2. Symptom summary

| | Expected (event dashboard reference) | Actual (trip dashboard today) |
|---|---|---|
| Layout pattern beneath hero | Tile grid + sections beneath (Revenue/Payout strip, Ticket Types, Recent Activity, Cancel CTA) | 4-tile mini-grid + primary "Edit trip" button + 3-tab strip + Cancel CTA |
| Tile count | 8–10 tiles (Scan / Scanners / Orders / Guests / Blasts / Group chat / Public page / Brand page / [Door Sales] / [Reconciliation]) | 5 tiles (View public page / Brand page / Marketing blasts / Group chat / Edit trip primary) |
| Recent Activity section | 8-stream feed (purchase, refund, cancel, event_edit, event_sales_ended, event_cancelled, event_scan, event_door_refund) capped at 5 rows | **MISSING ENTIRELY** |
| Revenue/Payout strip | `EventDetailKpiCard` directly below tile grid, side-by-side Revenue + Payout with sparkline | Revenue + Travelers KPI cards exist BUT only inside the Overview tab (third-level location, not strip below grid) |
| Ticket Types / Tiers section | `TICKET TYPES` section with `EventDetailTicketTypeRow` per tier | **MISSING** (tier info only visible per-traveller inside Travelers tab) |
| Cancel CTA placement | Ghost button at bottom of ScrollView, conditional on `(status === "live" \|\| status === "upcoming") && canEditEvent` | Already present — ghost button bottom-of-scroll, conditional on `trip.status !== "ended" && trip.status !== "cancelled"`. **PARITY ALREADY EXISTS HERE.** |

---

## 3. Investigation manifest

| # | File | Why read | Layer |
|---|---|---|---|
| 1 | [event/\[id\]/index.tsx](../../mingla-business/app/event/[id]/index.tsx) | Authoritative event dashboard render — tile inventory + sections + data sources | Component / Hook |
| 2 | [trip/\[id\]/index.tsx](../../mingla-business/app/trip/[id]/index.tsx) | Authoritative trip dashboard render — current gap | Component / Hook |
| 3 | [src/components/event/ActionTile.tsx](../../mingla-business/src/components/event/ActionTile.tsx) | Confirm shared tile primitive — answers Q1 | Component |
| 4 | [src/components/event/EventDetailKpiCard.tsx](../../mingla-business/src/components/event/EventDetailKpiCard.tsx) | Revenue/Payout strip primitive — extractable for trip | Component |
| 5 | [src/components/event/EventDetailActivityRow.tsx](../../mingla-business/src/components/event/EventDetailActivityRow.tsx) | Recent Activity row primitive + ActivityEvent type — extractable for trip | Component |
| 6 | [src/components/event/EventDetailTicketTypeRow.tsx](../../mingla-business/src/components/event/EventDetailTicketTypeRow.tsx) | Ticket Types row primitive — trip equivalent for pricing tiers | Component |
| 7 | [src/components/event/ReconciliationCtaTile.tsx](../../mingla-business/src/components/event/ReconciliationCtaTile.tsx) | Permission-gated tile pattern — relevant if trip Reconciliation tile is added | Component |
| 8 | WORLD_MAP banners (Tr1..Tr6) | Phase 0a ingest — what's already shipped on trip | Docs |
| 9 | [Tr2_MINIMUM_VIABLE_TRIP.md](../milestones/Tr2_MINIMUM_VIABLE_TRIP.md), [Tr3..Tr6 briefs](../milestones/) | Phase 0a ingest — trip-feature scope | Docs |
| 10 | [IMPLEMENTATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md](IMPLEMENTATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md) | Prior parity work — what was done, what was left | Report |
| 11 | [feedback_mingla_business_desktop_web_contracts.md](../../../.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_mingla_business_desktop_web_contracts.md) | Phase 0b — 16-contract desktop-web baseline must not regress | Memory |
| 12 | `mingla-business/src/hooks/useTrips.ts`, `useTripOrders.ts`, `useOrderInstallments.ts` | Existing trip data hooks — what's available for Recent Activity + Spots-Capacity strip | Hooks |

---

## 4. Findings

### 🔴 RC-1 — Trip dashboard uses 3-tab strip instead of event's tile-grid + section-beneath pattern

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:387–435](../../mingla-business/app/trip/[id]/index.tsx#L387-L435) (tabs declaration) + [:441–580](../../mingla-business/app/trip/[id]/index.tsx#L441-L580) (per-tab body render) |
| Exact code | `<View style={styles.tabs}>...Overview / Travelers / Money...</View>` followed by `{tab === "overview" ? <OverviewBody> : tab === "travelers" ? <TravelersBody> : <MoneyTabBody>}` |
| What it does | Renders three-tab horizontal pill row beneath the action grid; only one tab body visible at a time; content is hidden inside tab state instead of surfaced as scannable tiles + dedicated routes |
| What it should do | Same tile-grid + section-beneath pattern as event ([event/\[id\]/index.tsx:655–791](../../mingla-business/app/event/[id]/index.tsx#L655-L791)): all primary actions are tappable tiles in the grid; Revenue/Spots-Capacity strip directly beneath grid; Tiers section beneath strip; Recent Activity beneath Tiers; Cancel CTA beneath Recent Activity. Sub-pages (Travelers list, Money installment ledger) live at dedicated routes (`trip/[id]/travelers/index.tsx`, `trip/[id]/money/index.tsx`) and are opened by tapping their respective tile in the grid. |
| Causal chain | Tr2 SPEC §4.9+4.10 (per the file's own header comment "Mirrors event dashboard pattern. … Tr2 ships these two tabs only. Tr5+ adds Intake Forms tab, Tr6 adds Discussion tab") explicitly defined a tab-based structure for trip, anticipating that future ORCHs would add tabs (Intake Forms, Discussion). Event dashboard followed a different evolution (Cycle 9b/9c/13 added new tiles and sections directly, never tabs). The two surfaces diverged structurally and never converged. ORCH-0874 [Trip surfaces visual parity with Events] added a 4-tile action grid + Cancel CTA but did NOT remove the 3-tab structure beneath. → user sees "this trip page doesn't look or work like the event page even though both manage similar concepts" |
| Verification step | `git log --oneline mingla-business/app/trip/[id]/index.tsx` shows the tab structure originates from ORCH-0859 [Tr2 Minimum Viable Trip] and was retained through ORCH-0873/0874/0875/0880/0882. No prior ORCH unified the structure with event dashboard. |

### 🔴 RC-2 — Recent Activity section completely absent from trip dashboard

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx](../../mingla-business/app/trip/[id]/index.tsx) — zero references to "RECENT ACTIVITY", `recentActivity`, `ActivityEvent`, or `EventDetailActivityRow` |
| Exact code | (absence — grep confirms zero matches) |
| What it does | Trip dashboard renders no activity feed. Operator cannot see "Priya Collins booked 2× Standard +€250 · 2h ago" style timeline. Only way to see who booked is open the Travelers tab and scan a static list (no timestamps, no aggregation, no payment-event surfacing). |
| What it should do | Render `RECENT ACTIVITY` section beneath the new Revenue/Spots-Capacity strip, capped at 5 rows, sourced from trip data: (a) `useTripOrders` → "X booked Y× <tier-name> · +€Z · 2h ago" rows, (b) `useInstallmentsForBrandTrips` → "X paid installment 2 of 3 · €Y · just now" rows, (c) trip lifecycle events (cancelled-at) → "Trip cancelled" row. Per Q2 below, source-side reads are direct from existing hooks; no new tables. |
| Causal chain | ORCH-0859 [Tr2 Minimum Viable Trip] SPEC §4.9 listed Recent Activity as a future addition but did not ship it. ORCH-0874 [Trip surfaces visual parity with Events] focused on hero + grid + share + cancel; did not port the activity feed. ORCH-0873 [Tr3 Stage 2 UI] added the Money tab but did not surface activity. → operator has no temporal visibility into trip bookings + payment events from the dashboard. |
| Verification step | `grep -n "RECENT ACTIVITY\|recentActivity\|ActivityEvent" mingla-business/app/trip/[id]/index.tsx` returns 0 matches. Same grep against `mingla-business/app/event/[id]/index.tsx` returns multiple matches at lines 422–559 + 760–774. |

### 🔴 RC-3 — Revenue/Spots-Capacity strip exists but is buried inside Overview tab, not below the action grid

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:443–461](../../mingla-business/app/trip/[id]/index.tsx#L443-L461) (Revenue + Travelers `<View style={styles.kpiRow}>` cards INSIDE overview tab branch) |
| Exact code | `{tab === "overview" ? <View style={styles.kpiRow}><RevenueKpiCard><TravelersKpiCard></View> ... : ...}` |
| What it does | Revenue + Travelers KPI cards are visible only after tapping the Overview tab — they're inside the tab body. Travelers-vs-capacity (`travelersCount / capacity`) and total revenue both live three taps deep visually instead of being the first thing the operator sees when they land on the trip page. |
| What it should do | Lift the Revenue + Travelers KPI render out of the tab body and into a top-level KPI strip directly beneath the action grid, mirroring [event/\[id\]/index.tsx:723–727](../../mingla-business/app/event/[id]/index.tsx#L723-L727) (`<EventDetailKpiCard revenueGbp={...} payoutGbp={...} currency={...} />`). Trip equivalent: a `TripDetailKpiCard` (new component or shared via prop variant) showing Revenue + Spots (`travelersCount / capacity`). Since `EventDetailKpiCard` is a self-contained primitive ([src/components/event/EventDetailKpiCard.tsx](../../mingla-business/src/components/event/EventDetailKpiCard.tsx)), the cleanest path is to (a) extract it to `src/components/shared/DashboardKpiCard.tsx` parameterised by `leftLabel`/`leftValue`/`rightLabel`/`rightValue` OR (b) write a `TripDetailKpiCard` that mirrors its layout with Spots replacing Payout. SPEC will pick. |
| Causal chain | Trip's `kpiRow` style is defined ([:855–858](../../mingla-business/app/trip/[id]/index.tsx#L855-L858)) but only renders inside Overview tab. Event's strip renders ALWAYS regardless of section state (because event has no tabs). The 3-tab structure forced the KPI cards into tab-content. Removing the tabs (per RC-1) frees the strip to render at the top level. |
| Verification step | At runtime today, operator opens trip page → sees hero + 5 tiles + 3 tabs. To see Revenue, tap Overview tab. To see Travelers count, tap Overview tab. Compared with event: open event page → sees hero + 9 tiles + Revenue/Payout strip directly below without any tap. Confirmed by reading both render trees end-to-end. |

### 🔴 RC-4 — Tile inventory diverges: trip has 5 tiles, event has 8–10 tiles; trip is missing the Orders/Guests/Reconciliation equivalents

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:351–384](../../mingla-business/app/trip/[id]/index.tsx#L351-L384) (5 tiles) vs [event/\[id\]/index.tsx:655–720](../../mingla-business/app/event/[id]/index.tsx#L655-L720) (8–10 tiles depending on `inPersonPaymentsEnabled` + brand-role) |
| Exact code | Trip tiles: View public page (conditional), Brand page (conditional), Marketing blasts, Group chat, Edit trip (primary). Event tiles: Scan tickets (primary), Scanners, Orders, Guests, Blasts, Group chat, Public page, Brand page, Door Sales (conditional), Reconciliation (permission-gated). |
| What it does | Trip surfaces 5 actions; event surfaces 8–10. Trip operator cannot tap to navigate to Travelers list (tile missing — content only inside Travelers tab), Money/Installments view (tile missing — content only inside Money tab), or any "Reconciliation"-equivalent (not yet built for trips). |
| What it should do | Trip tile grid (per SPEC, locked at SPEC-time): Travelers (with `N` sub — opens new route `trip/[id]/travelers/index.tsx` holding existing Travelers tab body), Money (with `N at risk` sub if any — opens new route `trip/[id]/money/index.tsx` holding existing MoneyTabBody), Blasts (rename to match event's "Blasts" + add "Message ticket buyers" sub for parity), Group chat (add "Read + reply + moderate" sub for parity), Public page (conditional), Brand page (conditional), Edit trip (primary). Event-specific tiles (Scan tickets, Scanners, Door Sales, Reconciliation) are NOT applicable to trips. SPEC will lock exact label + sub + ordering. |
| Causal chain | ORCH-0874 ported 4 tiles + Cancel CTA but explicitly left tabbed content (Overview / Travelers / Money) untouched. The 3-tab structure absorbed the Travelers + Money tile-equivalents. → 5-vs-8 tile gap. |
| Verification step | Count tile-render JSX blocks in both files. Trip = 5 `<ActionTile>` blocks. Event = 8 `<ActionTile>` + 1 `<ReconciliationCtaTile>` + conditional Door Sales. Confirmed line-by-line. |

### 🟠 CF-1 — Trip status pill is binary (Draft/Published), event status pill is 3-state lifecycle (live/upcoming/past)

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:304–316](../../mingla-business/app/trip/[id]/index.tsx#L304-L316) vs [event/\[id\]/index.tsx:638–640](../../mingla-business/app/event/[id]/index.tsx#L638-L640) (`<EventDetailHeroStatusPill status={status} />` where `status` comes from `deriveScreenStatus(event)` lifecycle util) |
| What it does | Trip pill reads `trip.status === "draft" ? "Draft" : "Published"` — no surfacing of LIVE (trip currently underway), UPCOMING (future trip), PAST/ENDED (trip concluded), or CANCELLED. Operator cannot tell from a glance at the hero whether a trip is happening NOW. |
| What it should do | Adopt event's `deriveLiveStatus`-style lifecycle derivation for trips (already exists for events at `src/utils/eventLifecycle.ts:deriveLiveStatus`). Trip equivalent: derive from `trip.businessTrip.startAt` + `trip.businessTrip.endAt` + `trip.status`. Render via shared HeroStatusPill primitive (or new `TripDetailHeroStatusPill`). |
| Classification | Contributing factor — same surface area as the parity gap; SPEC should handle in scope OR explicitly punt to a follow-up ORCH if scope-creep concern. |

### 🟠 CF-2 — Trip hero `textShadow` lacks Platform.OS === "web" branch; event has it (`ORCH-0743 / CF-2` precedent)

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:773–789](../../mingla-business/app/trip/[id]/index.tsx#L773-L789) vs [event/\[id\]/index.tsx:967–975](../../mingla-business/app/event/[id]/index.tsx#L967-L975) |
| What it does | Trip uses RN-only `textShadowColor`/`textShadowOffset`/`textShadowRadius` on hero title + subline. On `mingla-business` desktop-web build, RN-web 0.21+ emits the `"shadow*" style props are deprecated` Metro warning AND drops the visible shadow → trip hero text loses depth on web. |
| What it should do | Adopt event's Platform.select pattern: web gets `textShadow: "0 2px 12px rgba(0, 0, 0, 0.4)"`, iOS/Android keep the RN-native triple. Trip hero already targets web (per the 16-contract desktop-web baseline). |
| Classification | Contributing factor — pre-existing latent issue exposed by the desktop-web baseline; fix while we're in the file. |

### 🟡 HF-1 — Trip "Edit" is a primary tile; event "Edit" is only in the manage menu

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:378–384](../../mingla-business/app/trip/[id]/index.tsx#L378-L384) (primary Edit tile) vs [event/\[id\]/index.tsx:172–180](../../mingla-business/app/event/[id]/index.tsx#L172-L180) (`handleEdit` wired into `EventManageMenu`, not a tile) |
| What it does | Trip has an always-visible primary "Edit trip" tile in the grid. Event hides Edit behind the moreH (•••) menu in the header. Trip operators expect to edit drafts frequently; event operators tend to edit less. The divergence is intentional per ORCH-0874 implementation report but breaks visual parity. |
| What it should do | SPEC decision required: (a) keep trip Edit as primary tile (rationale: trip operators edit more often, draft trips need quick Continue editing access), (b) move Edit to manage menu like event (rationale: parity), or (c) add an Edit tile to event for parity in the OTHER direction. Recommended: option (a) — operator workflow differs, and the Edit tile already shipped via ORCH-0874 with no friction reports. |
| Classification | Hidden flaw / SPEC-time decision — won't break runtime but creates ambiguity if not explicitly decided. |

### 🟡 HF-2 — Trip "Marketing blasts" label diverges from event "Blasts"

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:368–372](../../mingla-business/app/trip/[id]/index.tsx#L368-L372) vs [event/\[id\]/index.tsx:682–687](../../mingla-business/app/event/[id]/index.tsx#L682-L687) |
| What it does | Trip uses `"Marketing blasts"` (no sub). Event uses `"Blasts"` + sub `"Message ticket buyers"`. Both route to the same `/event/[id]/blasts` path (trip dashboard reuses the event-route by passing `trip.id` since trips and events share the `events` table). Different labels for identical functionality. |
| What it should do | Normalise: trip uses `"Blasts"` + sub `"Message ticket buyers"` (or trip-appropriate sub like `"Message travelers"`). SPEC locks the label. |
| Classification | Hidden flaw — label divergence creates inconsistent vocabulary; operator-facing. |

### 🟡 HF-3 — Trip "Group chat" tile omits the "Read + reply + moderate" sub

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:373–377](../../mingla-business/app/trip/[id]/index.tsx#L373-L377) vs [event/\[id\]/index.tsx:688–693](../../mingla-business/app/event/[id]/index.tsx#L688-L693) |
| What it does | Trip Group chat tile has no sub line; event has `sub="Read + reply + moderate"`. Same functionality (both route to `/event/[id]/group-chat` since ORCH-0897 [Trips + Events Group Chat] shipped a unified substrate). |
| What it should do | Add `sub="Read + reply + moderate"` to trip Group chat tile. SPEC locks. |
| Classification | Hidden flaw — sub line is operator-facing documentation; missing on trip side. |

### 🔵 OBS-1 — `ActionTile` primitive is ALREADY shared between trip + event dashboards (answers Q1)

| Field | Value |
|---|---|
| File + line | Both dashboards import from `../../../src/components/event/ActionTile` ([trip:41](../../mingla-business/app/trip/[id]/index.tsx#L41), [event:63](../../mingla-business/app/event/[id]/index.tsx#L63)) |
| What it does | Same primitive renders both surfaces. Tile additions for trip just need new `<ActionTile>` invocations — no primitive extraction work. |
| Classification | Observation — answers Q1: shared primitive already exists; trip dashboard already uses it; the gap is purely "trip uses 5 invocations vs event's 9", not "trip lacks the primitive". |

### 🔵 OBS-2 — `MoneyTabBody` content is already per-traveller installment ledger (answers Q4) — extraction to dedicated route is straightforward

| Field | Value |
|---|---|
| File + line | [trip/\[id\]/index.tsx:1182–1458](../../mingla-business/app/trip/[id]/index.tsx#L1182-L1458) (full `MoneyTabBody` subcomponent) |
| What it does | Renders per-buyer installment table with: All bookings / At-risk filter chips, per-booking expandable row with name + `N/M paid · $X collected`, expanded view showing each installment's status (scheduled/collected/failed/refunded/cancelled), retry-now button on failed rows, Cancel & refund CTA wiring `RefundPreviewSheet`. Already traveller-facing per-buyer data — not planner-self payment data. |
| What it should do | Lift `MoneyTabBody` + its props interface (`installmentsQuery`, `moneyData`, `moneyFilter`, etc.) into a new route at `mingla-business/app/trip/[id]/money/index.tsx` with the existing data hooks wired the same way. Trip dashboard's Money tile (post-ORCH-0913) routes to this destination. ORCH-0914 then redesigns the content layer (per-traveller summary table, drill-in detail) ON TOP of this extraction, without needing to also do the tile-vs-tab refactor. |
| Classification | Observation — answers Q4: Money tab content is already correct conceptually; only its destination location needs to change. ORCH-0913 and ORCH-0914 are cleanly separable. |

### 🔵 OBS-3 — Trip data hooks (`useTripOrders` + `useInstallmentsForBrandTrips`) provide enough data for a Recent Activity feed without new DB tables (answers Q2)

| Field | Value |
|---|---|
| File + line | `mingla-business/src/hooks/useTripOrders.ts` + `mingla-business/src/hooks/useOrderInstallments.ts` (paths confirmed via grep) |
| What it does | `useTripOrders` returns array of trip orders with `paymentStatus` + `totalCents` + `buyerName` + `paidAt`-equivalent timestamp. `useInstallmentsForBrandTrips` returns per-trip installment rows with `status` (scheduled/collected/failed/refunded/cancelled) + `dueAt` + `amountCents` + buyer info. Combining these two streams with trip-lifecycle events (`trip.cancelledAt`) provides 4 source streams for the activity feed: (a) order-paid, (b) order-cancelled, (c) installment-collected, (d) installment-failed, plus trip-cancelled. |
| What it should do | Build a `recentActivity` `useMemo` in trip dashboard mirroring [event/\[id\]/index.tsx:424–559](../../mingla-business/app/event/[id]/index.tsx#L424-L559) but with trip-side streams. Cap at 5 rows newest-first. Reuse `EventDetailActivityRow` component (rename to `DashboardActivityRow` if SPEC prefers — pure cosmetic). Reads from existing hooks — zero new DB tables, zero new edge functions, zero new RPCs. |
| Classification | Observation — answers Q2: data sources exist; activity feed is wire-up work, not data-platform work. |

---

## 5. Five-layer cross-check

| Layer | What it says | Authoritative? | Contradiction? |
|---|---|---|---|
| **Docs** | Tr2 SPEC defined trip with 2 tabs (Overview + Travelers) anticipating Tr5/Tr6 would add more tabs. Tr5 added intake-form rendering INSIDE the Travelers tab (no new tab). Tr6 (became ORCH-0897 [Group chat]) added a Group chat TILE not a Discussion tab. So docs intent for "more tabs" never materialised — the tile pattern won at every step except the original 3 tabs. | Partially | Yes — doc intent ("more tabs coming") superseded by tile pattern in actual implementation; tabs are now legacy and should be retired. |
| **Schema** | No schema changes needed for ORCH-0913. Trip data already lives in `events` table (trips and events share the table with `event_type='trip'`). Per-traveller installment data lives in `order_installments` table per ORCH-0869. Trip cancellation = `events.cancelled_at`. All reads via existing hooks. | Yes | No — schema layer is fine. |
| **Code** | Trip dashboard `mingla-business/app/trip/[id]/index.tsx` uses 3-tab structure; event dashboard `mingla-business/app/event/[id]/index.tsx` uses 9-tile + sections. Both share `ActionTile` primitive. | Yes | Yes — code-truth confirms the divergence; this is the bug. |
| **Runtime** | Operator-provided screenshots 2026-05-22 confirm code-truth: trip page renders 4 tiles + Edit primary + 3 tabs + Cancel CTA; event page renders 9 tiles + Revenue strip + Ticket Types + Recent Activity + Cancel CTA. | Yes | No — runtime matches code; no runtime-only surprise. |
| **Data** | Trip data hooks return what's needed for parity. `useTripOrders` returns paid travellers; `useInstallmentsForBrandTrips` returns installment rows; `trip.businessTrip.capacity` available for Spots (N/M). | Yes | No — data layer ready. |

**Verdict:** Docs intent diverges from code reality but code is the authoritative current state. No data-platform work required; this is a pure presentation-layer restructure.

---

## 6. Blast radius map

| Surface / system | Impact |
|---|---|
| Trip dashboard render tree | Full restructure — tabs deleted, KPI strip + Recent Activity added, tile count grows from 5 to 7. |
| `mingla-business/app/trip/[id]/edit.tsx` | NOT touched — Edit-trip wizard unaffected. |
| `mingla-business/app/trip/[id]/blasts` (route) | NOT touched — Marketing-blasts route already exists; tile label normalises. |
| `mingla-business/app/event/[id]/group-chat.tsx` (shared by trip via shared substrate) | NOT touched — same route, same destination. |
| NEW route `mingla-business/app/trip/[id]/travelers/index.tsx` | Created — holds existing Travelers tab body (per-order rows + intake-form cards). Tile entry. |
| NEW route `mingla-business/app/trip/[id]/money/index.tsx` | Created — holds existing `MoneyTabBody` + `RefundPreviewSheet` + `InstallmentScheduleDisplay`. Tile entry. ORCH-0914 then redesigns the content layer here. |
| `mingla-business/src/components/trip/` directory | New components: `TripDetailRecentActivity` (or reuse extracted `DashboardActivityRow`), `TripDetailKpiStrip` (or reuse extracted `DashboardKpiCard`), `TripDetailHeroStatusPill` (CF-1 — if scope allows). |
| Desktop-web baseline | Tile grid uses same `flexWrap` pattern as event today — both already work on desktop. Hero text-shadow (CF-2) currently broken on web; fixing it improves desktop-web rendering. No 16-contract regression expected; SPEC will list the specific contracts to verify at TEST (likely contracts touching `mingla-business` event detail + trip detail sections of the baseline). |
| Buyer-anonymous web | NOT touched — buyer surfaces have no organiser dashboard. |
| Consumer iOS/Android | NOT touched — no business dashboard on consumer app. |
| Admin web | NOT touched — admin has no trip dashboard. |
| ORCH-0914 [Trip Money tab redesign] dependency | UNBLOCKED — once Money tile route exists, ORCH-0914 redesigns the content inside that route without needing to also do the tile-vs-tab refactor. |
| ORCH-0917 [TR7 Room-Share Matching] dependency | UNBLOCKED — TR7 adds a new Room-Share tile + section beneath; ORCH-0913 establishes the canonical tile-grid + section pattern TR7 plugs into. |

---

## 7. Invariant compliance

| Invariant | Affected? | Preserved? |
|---|---|---|
| #2 One owner per truth | YES — installments source remains `useInstallmentsForBrandTrips`; trip orders remain `useTripOrders`. New routes consume the SAME hooks the tab bodies use today. | YES — no duplicate ownership; SPEC will mandate no inline data fetches outside the canonical hooks. |
| #3 No silent failures | YES — Recent Activity must surface errors from underlying hooks; new Travelers + Money routes must render error states. | Will be enforced in SPEC success criteria. |
| #4 One query key per entity | YES — moving content into new routes means hooks fire in two places (dashboard activity feed + dedicated route). React Query dedupes per-key so no double-fetch. | YES — same factory keys, automatic dedup. |
| #8 Subtract before adding | YES — 3-tab structure + per-tab state MUST be deleted in the same diff that adds the new tiles + routes. SPEC will require the deletion explicitly. | Will be enforced. |
| #9 No fabricated data | YES — Recent Activity rows must show only real order + installment events; missing data renders empty state, not fake rows. | Will be enforced. |
| `I-PROPOSED-CREATOR-ENTRY-IS-INSTANT` (ORCH-0893) | NO — trip-detail page is not an entry-creator page. | N/A |
| `I-37 / I-38 / I-39` (WCAG AA touch + accessibility labels) | YES — new tiles must inherit ActionTile's existing AA compliance; new sections need accessibility labels. | Will be enforced in SPEC success criteria. |
| 16-contract desktop-web baseline | YES — hero + grid + sections render on desktop-web. CF-2 fix improves a pre-existing regression. | SPEC will cite specific contracts to verify at TEST. |

NEW invariant proposed for SPEC ratification:
- `I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT` — trip dashboard and event dashboard use the same `ActionTile`-based tile grid + section-beneath structure (Revenue/Spots strip → Tiers → Recent Activity → Cancel CTA); neither surface introduces tab strips for primary content navigation. Enforced via grep gate that fails CI if `<Pressable>` or `<View>` with `role="tab"` appears in either dashboard file.

---

## 8. Answers to dispatch Phase 4 questions

| # | Question | Answer |
|---|---|---|
| **Q1** | Is the event dashboard's tile grid a shared primitive or per-page reimplementation? | **SHARED PRIMITIVE — `ActionTile` at `mingla-business/src/components/event/ActionTile.tsx`** is imported by both `event/[id]/index.tsx:63` and `trip/[id]/index.tsx:41`. Trip dashboard already uses it for 5 tiles today; ORCH-0913 just adds 2 more `<ActionTile>` invocations and removes the 3-tab structure. **No primitive extraction needed.** |
| **Q2** | Does the event Recent Activity section read directly from `orders` or from a denormalized view? | **DIRECT from in-memory Zustand stores** (no denormalized view): `useEventOrders` (orders) + `useDoorSalesStore.entries` + `useGuestStore.entries` + `useScanStore.entries` + `useEventEditLogStore.entries`, merged client-side via `useMemo` into a sorted-by-time array capped at 5. **Trip equivalent:** `useTripOrders` (order events) + `useInstallmentsForBrandTrips` (payment events) + direct read of `trip.cancelledAt` (lifecycle). 4–5 streams instead of event's 8. Same client-side merge pattern. **Zero new DB tables, zero new RPCs.** |
| **Q3** | Travelers tab — can it become a tile→list, or does data structure require keeping a tab? | **TILE → DEDICATED ROUTE works.** The Travelers tab body (lines 481–551 of `trip/[id]/index.tsx`) is a self-contained list-render that uses `useTripOrders` data + `useTripIntakeSchemasByEvent` data. Lifting the body into a new file at `mingla-business/app/trip/[id]/travelers/index.tsx` (matching the existing `mingla-business/app/event/[id]/orders/index.tsx` pattern) requires zero data-shape changes. Tile label: `"Travelers"` with sub `"${N} travelers"` mirroring event's Guests tile. |
| **Q4** | Money tab content — planner-self payment data or already per-traveller? Coupling to ORCH-0914? | **ALREADY PER-TRAVELLER** (lines 1182–1458 of `trip/[id]/index.tsx` — `MoneyTabBody`). Renders per-buyer installment ledger with at-risk filter, retry-now, cancel-and-refund actions. ORCH-0914 will REDESIGN the content (e.g., consolidate to per-traveller summary table, add drill-in detail view, add manual "charge now" / "send reminder" actions) — that's content-layer work that happens INSIDE the Money route, not on the dashboard. **Coupling with ORCH-0913 is minimal**: ORCH-0913 (a) creates `mingla-business/app/trip/[id]/money/index.tsx` route containing the existing `MoneyTabBody` lifted verbatim, (b) adds the Money tile to the dashboard pointing at that route. ORCH-0914 then iterates on the route's content layer. The two ORCHs do not conflict and can be reviewed independently. |
| **Q5** | Cancel trip CTA placement? | **ALREADY EXISTS at parity** with event (both render ghost button at bottom of ScrollView, both gate on lifecycle state). Trip Cancel CTA lives at [trip/\[id\]/index.tsx:585–596](../../mingla-business/app/trip/[id]/index.tsx#L585-L596); event Cancel CTA lives at [event/\[id\]/index.tsx:778–790](../../mingla-business/app/event/[id]/index.tsx#L778-L790). **ORCH-0913 keeps it in place** — moves it to render BENEATH the new Recent Activity section so it stays at the bottom of the ScrollView (the section reordering shifts its sibling position but the bottom-anchored placement holds). |
| **Q6** | Desktop-web 16-contract impact? | **LIKELY ZERO REGRESSION, but CF-2 (textShadow) is a pre-existing minor break in trip hero on web.** Both dashboards already use the same `actionGrid` `flexWrap` pattern on web. Trip page has no `.web.tsx` override (no platform-fork file), so the same render runs on desktop today. Per `feedback_mingla_business_desktop_web_contracts.md`, the 16 contracts cover: compact shell + rail + 4-col grids + fixed/scroll home + wizard left-rail panes + brand logo + restrained glass active state — trip-detail page is NOT among the surfaces those contracts directly govern. SPEC-time TASK: SPEC author MUST list which specific contracts (by ID from memory) the trip-detail page touches, and TEST MUST run the 4 jest gates cited in the memory. Expectation is all 4 stay green; CF-2 fix removes one Metro warning on web. |

---

## 9. Fix strategy (direction only — not a spec, not code)

The fix is purely client-side, presentation-layer. No DB, no edge functions, no RPCs, no new hooks.

**Direction:**

1. **Subtract first** (Constitution #8): delete the 3-tab structure + `tab` state + tab-body branches from `mingla-business/app/trip/[id]/index.tsx`.
2. **Add tiles**: extend the action grid with 2 new tiles (Travelers, Money) wired to NEW routes; normalise Blasts + Group chat labels for parity.
3. **Lift KPI strip**: render the Revenue + Spots-Capacity strip directly beneath the action grid (matching event's `EventDetailKpiCard` placement). Either extract `EventDetailKpiCard` to a shared `DashboardKpiCard` parameterised on left/right pair, OR clone as `TripDetailKpiCard` with Spots replacing Payout.
4. **Add Tiers section**: render `TICKET TYPES`-equivalent section (likely `PRICING TIERS` for trips) using existing `trip.pricingTiers` data and the existing `EventDetailTicketTypeRow` primitive (or trip-flavored clone if tier fields differ).
5. **Add Recent Activity section**: build `recentActivity` `useMemo` from `useTripOrders` + `useInstallmentsForBrandTrips` + `trip.cancelledAt` streams; cap at 5 newest; reuse `EventDetailActivityRow` (or rename to `DashboardActivityRow`).
6. **Keep Cancel CTA**: leave the ghost Cancel-trip button at the bottom of ScrollView — only its sibling position shifts.
7. **Create destination routes**: `mingla-business/app/trip/[id]/travelers/index.tsx` (lifts Travelers tab body verbatim) + `mingla-business/app/trip/[id]/money/index.tsx` (lifts `MoneyTabBody` verbatim).
8. **CF fixes (in scope)**: CF-1 lifecycle-based status pill, CF-2 web textShadow Platform.select.
9. **HF decisions (locked at SPEC)**: HF-1 Edit-as-primary-tile keeps current trip behavior (rationale: trip operators edit more frequently); HF-2 Blasts label normalised; HF-3 Group chat sub added.

**Implementation order** (locked at SPEC time):
- Phase 1: Subtract (delete tabs + state)
- Phase 2: New routes (Travelers, Money) — lift content verbatim
- Phase 3: New dashboard sections (KPI strip, Tiers, Recent Activity)
- Phase 4: New tiles (Travelers, Money) + label normalisation (Blasts, Group chat)
- Phase 5: CF fixes (status pill, web textShadow)
- Phase 6: Regression-test script + adversarial check

---

## 10. Regression prevention requirements

The SPEC must include:

- **Happy-path regression test** at `mingla-business/__tests__/trip-dashboard-parity.test.tsx` asserting:
  - Trip dashboard renders 7 ActionTile children (or count locked by SPEC)
  - Trip dashboard renders 0 `role="tab"` Pressables
  - Trip dashboard renders `RECENT ACTIVITY` section label
  - Trip dashboard renders Revenue + Spots KPI cards as siblings of the action grid (not inside any tab body)
  - Cancel-trip CTA still gated correctly
- **Adversarial regression test** at `mingla-business/__tests__/trip-dashboard-parity-adversarial.test.tsx` attacking:
  - Tile destination routes (Travelers tile → `/trip/[id]/travelers` not `/event/[id]/orders`)
  - Recent Activity row data integrity (no row renders for missing buyerName + missing amount — Constitution #9 honest absence)
  - Group chat label parity (sub = "Read + reply + moderate" matching event)
  - Status pill state on a live trip (renders "Live" not just "Published") — verifies CF-1
- **CI grep gate** at `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` failing if `<Pressable[^>]*role="tab"` appears in `mingla-business/app/(event|trip)/[id]/index.tsx`.
- **Adversarial CI check** asserting Edit-trip / Group-chat / Blasts / Brand-page / Public-page tiles all still navigate to their existing destinations (5 routes — zero regression on existing tile destinations).
- **Desktop-web 4 jest gates** (cited in `feedback_mingla_business_desktop_web_contracts.md`) MUST run green on the new dashboard structure.

---

## 11. Discoveries for orchestrator (side issues — NOT in scope)

- **DISC-0913-1** — Trip's hero IIFE for hue derivation ([trip/\[id\]/index.tsx:290–296](../../mingla-business/app/trip/[id]/index.tsx#L290-L296)) is a pattern divergence from event (event uses `event.coverHue` directly from the data model). Trip should likely have `trip.coverHue` as a derived field on the data hook. Out of scope for ORCH-0913 (pure cosmetic); register as a follow-up if hue inconsistency surfaces user-side.
- **DISC-0913-2** — Trip dashboard uses `SafeScreen` wrapper; event uses raw `View` + `useSafeAreaInsets`. Both are valid per ORCH-0866 [SafeArea drift + SafeScreen wrapper] decision, but the pattern divergence on the SAME surface family is worth noting. Not in scope.
- **DISC-0913-3** — Trip status pill uses `accessibilityRole="tab"` for its 3-tab strip ([:391, :402, :413](../../mingla-business/app/trip/[id]/index.tsx#L391)) — those accessibility roles will be deleted along with the tabs in this ORCH. Confirm no screen-reader users have built muscle memory around these (assume not since the feature is recent and reads are low). Not a blocker.
- **DISC-0913-4** — `MoneyTabBody` subcomponent's `RefundPreviewSheet` import sits inside the parent file (lines 31–45). When lifted to `trip/[id]/money/index.tsx` it ports with it; mild file-structure cleanup opportunity. Not in scope.
- **DISC-0913-5** — `EventDetailKpiCard` prop names use `revenueGbp` / `payoutGbp` even when the currency is not GBP (the prop accepts any currency; `Gbp` is legacy naming from Cycle 9). If SPEC extracts this primitive to `DashboardKpiCard`, consider renaming to `leftValue` / `rightValue`. Out of scope for ORCH-0913 (cosmetic rename); flag as a cleanup-cycle candidate.

---

## 12. Confidence level

**HIGH (`proven`-level for the structural finding; `probable`-level for the SPEC details).**

- The 3-tab vs tile-grid structural divergence is **proven** by direct source-read of both dashboards end-to-end and confirmed by operator-provided 2026-05-22 screenshots.
- The tile inventory (5 vs 8–10) is **proven** by line-by-line JSX count.
- The shared `ActionTile` primitive is **proven** by grep of both import statements.
- The trip data hook readiness is **proven** by inspection of `useTripOrders` + `useInstallmentsForBrandTrips` return shapes already in active use inside the Money tab body.
- The desktop-web 16-contract impact is **probable** — pattern-match on existing trip-dashboard render says no regression, but SPEC will lock contract IDs and TEST will run the 4 jest gates to convert this to proven.

Phase 1 sim repro intentionally skipped per the Prime Directive exemption for code-audit investigations + operator-provided same-day screenshots. If TEST needs runtime confirmation of the redesigned dashboard, that lives in TEST mode after implementation lands.

---

## 13. SPEC handoff

Investigation complete. Ready for orchestrator REVIEW. If APPROVED, SPEC follows at `Mingla_Artifacts/specs/SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY.md` covering: locked tile inventory + ordering, section order + content schemas, per-surface success criteria (iOS / Android / desktop-web), Cross-Surface Impact section (mandatory per Phase 2.5), hard guards, adversarial-check seeds, and implementation order.
