# INVESTIGATE — ORCH-1143 [business Home live-card: scan-ticket parity + accordion + multi-live carousel]

**Skill:** mingla-forensics+claude · **Phase:** INVESTIGATE (read-only) · **Date:** 2026-06-15
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1143-[live-card-scan-accordion]/` on branch `ORCH-1143-live-card-scan-accordion` (rebased onto origin/main `2bcf4e847`).
**App:** Mingla BUSINESS (`mingla-business/`).

---

## Symptom summary (expected vs actual)

**Seth's request (verbatim):** "Every live experience, event or trip should have a scan ticket button. This card should also be an accordion you ca collapse to save space on the home page. Also if multiple live expereinces exist, the cards should be a horizontally scrollable section so users can scan tickets from multiple experiences."

**Actual today (business Home):**
- The "LIVE NOW" hero renders for the SINGLE `primaryLiveItem` and only when it is an `event`- or `experience`-kind row (`primaryLiveEvent`, `home.tsx:277-280`).
- A "Scan QR codes" button appears ONLY when `primaryLiveItem.kind === "event"` (`home.tsx:357-358` `showScanAction`). Experiences and trips that are live get NO scan button.
- The card is static (no collapse).
- When several offerings are live concurrently, only the first (`primaryLiveItem`) is shown as a hero; the rest are demoted into the "Upcoming" list rows.

**Expected:** scan button on every live offering regardless of kind; the live card collapsible; multiple live offerings rendered as a horizontally-scrollable carousel of cards, each with its own scan button.

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `supabase/functions/scan-ticket/index.ts` | edge | What the scan keys off; any event_type assumption |
| 2 | `supabase/migrations/20260821000000_orch_1051_scanner_invite_flow.sql` (§5, lines 420-595) | schema | LATEST `biz_ticket_scan` body — authoritative current definition |
| 3 | `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` | schema | Prior `biz_ticket_scan` body (superseded by #2) |
| 4 | `supabase/migrations/20260802000002_orch_1006_finalize_copy_pricing_breakdown.sql` (lines 240-273) | schema | LATEST `biz_ticket_checkout_finalize` — where tickets + qr_token_hash are minted |
| 5 | `supabase/functions/ticket-checkout-create/index.ts` (lines 335-394, 980-990) | edge | Whether trips/experiences sell through the same engine |
| 6 | `mingla-business/app/event/[id]/scanner/index.tsx` | component | Scanner SCREEN data path; event_type gating |
| 7 | `mingla-business/app/event/[id]/scanner/index.web.tsx` | component | Web scanner behavior (camera gate) |
| 8 | `mingla-business/src/store/scanStore.ts` | state | What the scanner expects/records |
| 9 | `mingla-business/src/hooks/useManagedEventRoute.ts` | hook | Whether `/event/[id]/scanner` resolves experience + trip ids |
| 10 | `mingla-business/src/services/businessEvents.ts` (`fetchBusinessEventById`, lines 548-587) | service | Event-type filtering on the detail read |
| 11 | `mingla-business/src/utils/tripToLiveEvent.ts` | util | Trip → LiveEvent adapter shape (tickets/capacity/currency) |
| 12 | `mingla-business/src/utils/upcomingBuilder.ts` | util | How "live" is computed; how to enumerate ALL live items |
| 13 | `mingla-business/src/hooks/useUpcomingForBrand.ts` | hook | Live-state hook return shape |
| 14 | `mingla-business/app/(tabs)/home.tsx` (lines 276-363, 460-570) | component | Current hero render + scan gate + metrics |
| 15 | `mingla-business/src/hooks/useEventOrders.ts` (`useEventSalesSummaries`, lines 128-158) | hook | Per-card metrics; works for any kind? |
| 16 | `mingla-business/src/components/home/BusinessTodoToggle.tsx` | component | Accordion precedent |
| 17 | `mingla-business/src/store/currentBrandStore.ts` (lines 112,148,177-178) | state | Canonical `hasHydrated` persisted-store gate (Constitution #14) |
| 18 | `mingla-business/src/components/offering/ExperienceStopsGalleryTile.tsx` (lines 108-114) | component | Horizontal-scroll house style |

---

## Q-scorecard

### Q1 — Does `supabase/functions/scan-ticket` work generically for ANY `events.id` regardless of `event_type`, or is it event-only?
**Verdict: FULLY GENERIC. Proven.** The edge fn (F-1) and the RPC it calls (F-2) contain ZERO `event_type` references. The scan validates by ticket→order→ticket_type joins, scanner authorization, payment status, ticket status, and the `event_dates` time-window — all keyed on `event_id`/`brand_id`, which are event-type-agnostic. Passing an experience's or trip's `events.id` is validated identically.

### Q2 — Do experience and trip tickets carry a scannable QR token at purchase, the same way event tickets do?
**Verdict: YES for both. Proven.** Tickets are minted by `biz_ticket_checkout_finalize` (F-3) with a `qr_token_hash` + signed `qr_code` for EVERY checkout session, with no `event_type` branch. `ticket-checkout-create` (F-4) explicitly handles `event_type === "trip"` (booking-deadline + intake gates) — proving trips sell through the same ticket engine. Experiences ship full ticketed checkout per META-ORCH-1059 (memory). A trip ticket and an experience ticket are scannable artifacts identical in shape to an event ticket.

### Q3 — Would passing an experience's or trip's `events.id` into the scanner SCREEN "just work"?
**Verdict: YES. Proven.** The scanner screen at `app/event/[id]/scanner/index.tsx` (F-5) reads the offering via `useManagedEventRoute(eventId)` (F-6), which ALREADY resolves event, experience, AND trip ids (META-ORCH-1059 Pass 2: trips get a dedicated `useTrip → tripToLiveEvent` fallback). The screen is already kind-aware in copy (`offeringKindFromEventType`, `kindCfg.noun` → "experience"/"trip"/"event"). It calls `scanTicket(event.id, scan.data)` → the generic edge fn. There is NO `event_type` gate in the screen. The route `/event/[id]/scanner` is a SHARED route, not an event-only route.

### Q4 — Does the ORCH-0965 comment ("experiences route to a coming-soon stub … trips have no scanner today", `home.tsx:354-356`) reflect a genuine backend gap or just an untaken UI path?
**Verdict: STALE COMMENT — untaken UI path only, NOT a backend gap. Proven.** The comment predates META-ORCH-1059 (experiences full lifecycle) and the trip-ticketing engine. The backend + the scanner screen + the route already support all three kinds. The only thing missing is the home-screen UI gate (`showScanAction` restricting to `kind === "event"`) and the `handleScanPress` guard (`home.tsx:359-363`). This is UI-only work.

### Q5 — How is "live" computed, and how do we enumerate ALL currently-live offerings (not just the primary)?
**Verdict: Trivially available in `upcomingBuilder`. Proven.** `buildUpcomingItems` (F-7) returns `items` (sorted live-first by start ascending), `counts.live`, and `primaryLiveItem` (`items.find(status==="live")`). To enumerate ALL live: `items.filter(i => i.status === "live")`. Each `UpcomingItem` carries `kind` ("event"|"experience"|"trip") and `source` (`LiveEvent | Trip`). Recommend exposing a `liveItems: UpcomingItem[]` field on the builder return (one-owner-per-truth) rather than filtering ad-hoc at the call site.

### Q6 — What lifts from the current hero into a reusable per-card component, and does per-card metrics work for all kinds?
**Verdict: Hero block (`home.tsx:469-535`) lifts cleanly; metrics work for all kinds via the existing trip adapter. Proven.** `liveHeroMetrics` / `finiteTicketCapacity` / `useEventSalesSummaries` all key off `LiveEvent.tickets` + `event.id`. `tripToLiveEvent` (F-8) already maps `trip.pricingTiers → tickets` stubs with currency, so a trip normalizes to a `LiveEvent`-shaped view for the card. `useEventSalesSummaries` queries `fetchEventOrders(event.id)` (event-type-agnostic), so per-card revenue/sold works for trips too.

### Q7 — Accordion + horizontal-carousel precedents + persisted collapse state?
**Verdict: All precedents exist in-app. Proven.** Accordion: `BusinessTodoToggle.tsx` (`LayoutAnimation` + chevU/chevD header). Horizontal scroll house style: `ScrollView horizontal showsHorizontalScrollIndicator={false}` (`ExperienceStopsGalleryTile.tsx:108-114`). Persisted-state hydration gate (Constitution #14): `currentBrandStore.ts` — `hasHydrated` flag NOT persisted, flipped in `onRehydrateStorage` (lines 112,148,177-178). The collapse store must follow this exact pattern.

### Q8 — Web scan-button behavior (camera-gated per ORCH-1099)?
**Verdict: Keep the button; route to `/event/[id]/scanner`; the existing web override handles it gracefully. NOT a dead tap. Proven.** `index.web.tsx` (F-9) already renders a coherent "Scan tickets in the app" EmptyState (kind-aware) instead of a dead camera screen, and honors the replacement-event redirect. So the scan button on web is NOT a dead tap — it routes to a meaningful web end-state. No special-casing needed on web beyond what already exists.

---

## Findings (six-field evidence)

### F-1 — `scan-ticket` edge fn is event-type-agnostic
1. **Symptom:** Backend feasibility unknown for experience/trip scan.
2. **Layer:** edge (code).
3. **Probe:** `Read supabase/functions/scan-ticket/index.ts`.
4. **Evidence:** lines 21-38: `const eventId = ...body.eventId...; const qrPayload = ...body.qrPayload...; ... await supabase.rpc("biz_ticket_scan", { p_event_id: eventId, p_qr_payload: qrPayload, p_scanner_user_id: userData.user.id, p_qr_token_pepper: qrPepper })`. No `event_type` read, no events-table fetch, no kind branch anywhere in the 45-line file.
5. **Mechanism:** The edge fn forwards `eventId` + `qrPayload` straight to the RPC; whatever kind the events row is, the call shape is identical.
6. **Severity:** RULED OUT (as a blocker) — proves no backend gap at the edge layer.

### F-2 — LATEST `biz_ticket_scan` RPC has no event_type check (authoritative)
1. **Symptom:** Need authoritative current RPC behavior (migration-chain rule).
2. **Layer:** schema.
3. **Probe:** `grep -rln biz_ticket_scan supabase/migrations` → latest is `20260821000000_orch_1051_scanner_invite_flow.sql`; `Read` lines 420-595.
4. **Evidence:** The §5 `CREATE OR REPLACE FUNCTION public.biz_ticket_scan(...)` validates: scanner authorization via `event_scanners` OR `brand_team_members.role='scanner'` on `e.brand_id` (lines 455-476); QR signature regex + `biz_ticket_checkout_qr_payload` (lines 478-497); `v_ticket.event_id <> p_event_id` → `wrong_event` (line 499); payment/status (501-506); `event_dates` window (512-544). NO `events.event_type` reference. The orch_1051 in-migration probe (lines 643-655) asserts the body retains `event_dates` + `event_scanners` + `brand_team_members` — confirming this is the live definition, superseding orch_0793.
5. **Mechanism:** Every gate keys on `event_id`/`brand_id`. An experience or trip events row with tickets + an authorized scanner scans identically to an event.
6. **Severity:** RULED OUT (as a blocker) — proves no backend gap at the RPC layer.

### F-3 — Tickets + qr_token_hash minted for ALL kinds (no event_type branch)
1. **Symptom:** Do experience/trip tickets carry a scannable QR?
2. **Layer:** schema.
3. **Probe:** `grep qr_token_hash supabase/migrations` → finalize RPC `20260802000002_orch_1006_*`; `Read` lines 240-273.
4. **Evidence:** lines 246-263: per checkout-session item, `v_token := gen_random_uuid()... ; v_token_hash := biz_ticket_checkout_token_hash(...); v_qr := biz_ticket_checkout_qr_payload(...); INSERT INTO public.tickets (..., qr_code, qr_token_hash, status, ...) VALUES (..., v_qr, v_token_hash, 'valid', ...)`. Loops over `ticket_checkout_session_items` for `v_session.event_id` — no `event_type` branch.
5. **Mechanism:** Any paid checkout (event/experience/trip) produces tickets with a signed scannable QR keyed on the events row id.
6. **Severity:** RULED OUT (as a blocker) — proves the scannable artifact exists for all kinds.

### F-4 — `ticket-checkout-create` explicitly handles trips (proves trips sell tickets)
1. **Symptom:** Do trips genuinely sell scannable tickets, or use a different booking model?
2. **Layer:** edge.
3. **Probe:** `grep -n event_type ticket-checkout-create/index.ts`; `Read` lines 335-394.
4. **Evidence:** line 344 `.select("event_type, bookings_closed, booking_deadline")`; line 358 `tripGateRow?.event_type === "trip"` (bookings-closed gate); line 384 `if (tripGateRow?.event_type === "trip")` (intake gate); line 983 `const isTrip = tripGateRow?.event_type === "trip"` (buyer-web URL branch). The trip-specific code LAYERS gates onto the same shared checkout that feeds `biz_ticket_checkout_finalize`.
5. **Mechanism:** Trips use the identical ticket engine (with trip-only pre-checkout gates), so trip tickets are minted via F-3 → scannable via F-1/F-2.
6. **Severity:** RULED OUT (as a blocker) — confirms trips are genuinely ticketed + scannable.

### F-5 — Scanner SCREEN has no event_type gate; already kind-aware
1. **Symptom:** Would the scanner screen render/scan for an experience/trip id?
2. **Layer:** component.
3. **Probe:** `Read app/event/[id]/scanner/index.tsx` (185-205, 331-446).
4. **Evidence:** line 190 `useManagedEventRoute(eventId)`; line 195-196 `offeringKindConfig(offeringKindFromEventType(event?.event_type))` (kind-aware copy); line 363 `await scanTicket(event.id, scan.data)`; line 390 `Different ${kindCfg.noun}`; lines 427-428 `not authorized to scan this ${kindCfg.noun}`. No branch refusing non-event kinds.
5. **Mechanism:** The screen reads a generic event, scans via the generic edge fn, and uses kind-aware copy — works for all three kinds unchanged.
6. **Severity:** RULED OUT (as a blocker) — the UI screen is already kind-generic.

### F-6 — `useManagedEventRoute` resolves event + experience + trip ids
1. **Symptom:** Does `/event/[id]/scanner` resolve a trip/experience id?
2. **Layer:** hook.
3. **Probe:** `Read src/hooks/useManagedEventRoute.ts`; `Read businessEvents.ts:548-566`.
4. **Evidence:** `useManagedEventRoute` resolves `serverDetail?.event` (events + experiences via `fetchBusinessEventById`) ?? `localEvent` ?? `tripFallbackEvent` (lines 65-66). `fetchBusinessEventById` rejects ONLY trips (`businessEvents.ts:564-565` `if (...event_type === "trip") return null`), and trips are caught by the `useTrip → tripToLiveEvent` fallback (lines 46-55). Experiences pass through the primary read.
5. **Mechanism:** All three kinds resolve to a `LiveEvent`-shaped `event` for the shared sub-screens (scanner/scanners/orders/guests/recon).
6. **Severity:** RULED OUT (as a blocker) — the route already accepts all kinds; NO new `/experience/[id]/scanner` or `/trip/[id]/scanner` route is needed.

### F-7 — Live enumeration is available; only `primaryLiveItem` is consumed today
1. **Symptom:** Only one live card renders; need all live items.
2. **Layer:** util/hook.
3. **Probe:** `Read upcomingBuilder.ts` + `useUpcomingForBrand.ts`.
4. **Evidence:** `buildUpcomingItems` returns `{ items, counts, primaryLiveItem }` (line 190,218). `items` is sorted live-first by start ascending (`compareUpcomingItems` lines 154-163). `primaryLiveItem = nonPast.find(i => i.status === "live")` (line 217). `counts.live` (line 212). Each item carries `kind` + `source`. The hook (`useUpcomingForBrand.ts:68-71`) passes these through. `home.tsx:276` consumes ONLY `primaryLiveItem`.
5. **Mechanism:** All live items already exist in the sorted `items`; the home screen simply doesn't surface beyond the first. `items.filter(i => i.status==="live")` gives the carousel set.
6. **Severity:** CONFIRMED ROOT CAUSE (of "only one live card") — UI consumes only the primary.

### F-8 — Trip adapter already produces a LiveEvent for per-card metrics
1. **Symptom:** Can a trip card show revenue/sold/capacity like an event card?
2. **Layer:** util.
3. **Probe:** `Read tripToLiveEvent.ts:85-130`.
4. **Evidence:** line 122-124 `tickets: trip.pricingTiers.map((tier, index) => tierToTicketStub(tier, index))`; line 121 `currency: trip.pricingTiers[0]?.currency ?? trip.revenueCurrency ?? "USD"`. Produces a `LiveEvent` with tickets + currency.
5. **Mechanism:** `useEventSalesSummaries` + `finiteTicketCapacity` consume `LiveEvent.tickets` + `event.id`; with the trip adapter, a trip card renders the same metrics. `useEventSalesSummaries` queries `fetchEventOrders(event.id)` which is event-type-agnostic.
6. **Severity:** RULED OUT (as a blocker) — per-card metrics work for trips via the existing adapter.

### F-9 — Home scan gate + primaryLiveEvent restriction are the only blockers (UI-only)
1. **Symptom:** No scan button on experience/trip live cards; only one card.
2. **Layer:** component.
3. **Probe:** `Read home.tsx:276-363, 469-535`.
4. **Evidence:** line 277-280 `primaryLiveEvent` set ONLY for `kind === "event" || kind === "experience"` (TRIPS EXCLUDED → trip never even renders a hero today); line 357-358 `showScanAction = primaryLiveItem !== null && primaryLiveItem.kind === "event"`; line 359-363 `handleScanPress` guards `kind !== "event"` then `router.push('/event/{id}/scanner')`. Stale comment lines 354-356.
5. **Mechanism:** Three UI gates (trip exclusion from hero; event-only scan visibility; event-only scan handler) suppress the feature for experiences/trips and beyond the primary. Removing/generalizing these gates + adding a carousel + accordion delivers the feature with zero backend change.
6. **Severity:** CONFIRMED ROOT CAUSE — the entire ask is UI-only on the home screen + a small persisted collapse store.

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | ORCH-0965 comment (`home.tsx:354-356`) says experiences are a coming-soon stub and trips have no scanner. | **CONTRADICTS Code/Schema.** The comment is STALE (pre-META-ORCH-1059). The backend + screen + route all support all kinds. The comment must be deleted in IMPLEMENT. Truth-holder: Code/Schema. |
| **Schema** | `biz_ticket_scan` (orch_1051) + `biz_ticket_checkout_finalize` (orch_1006) are event-type-agnostic; tickets minted with qr for all kinds. | No internal contradiction; aligned with Code. |
| **Code** | scan-ticket edge fn, scanner screen, `useManagedEventRoute`, `useEventSalesSummaries` all event-type-generic. Home screen is the only event-only gate. | Aligned with Schema; contradicts the stale Docs comment only. |
| **Runtime** | Not live-fired this pass (see "Repro evidence"). Static trace is conclusive: any live experience/trip with tickets + an authorized scanner scans through the existing path. | Suspected-ceiling on the runtime layer; see below. |
| **Data** | Not queried (read-only investigation; no prod data needed for a UI-gate feasibility verdict). The screenshot offering "Raleigh Wine and Dine Crawl" (20 capacity, 0 sold) demonstrates a live offering with a finite capacity. | n/a |

---

## Repro evidence

This is a **feature-gap investigation**, not a runtime-bug reproducer. The gating question ("does the backend scan experiences/trips?") is answered by the migration chain + edge-fn + screen source, which is conclusive at the schema/code layers (Prime Directive 7 exemption: backend/SQL/migration feasibility). No simulator repro was required to PROVE the backend is event-type-agnostic — the proof is the absence of any `event_type` gate across `scan-ticket`, `biz_ticket_scan`, `biz_ticket_checkout_finalize`, the scanner screen, and `useManagedEventRoute`, each read verbatim.

**Runtime-layer honesty:** an end-to-end "scan a real experience/trip ticket" live-fire (sim + a seeded paid experience/trip ticket + an authorized scanner) was NOT performed this pass; that is the **tester's** verification at TEST. The feasibility verdict (UI-only, no backend build) is **proven** at the schema/code layers; the end-to-end happy path is **probable** pending the tester's live-fire.

---

## Blast radius / cross-surface map

| Surface | In scope | Why / behavior |
|---------|----------|----------------|
| Business iOS (`mingla-business` iOS) | YES | Primary. Home live card → accordion + carousel + per-kind scan button. Native camera scan via `/event/[id]/scanner/index.tsx`. |
| Business Android | YES | Same `home.tsx` + scanner route. Android glass opaque-fallback policy applies to any new glass cards (carousel cards reuse `GlassCard`). |
| Business Web preview (adjacent) | YES (card UI) / camera N/A | `home.tsx` renders on web; the accordion + carousel + scan BUTTON render on web. The button routes to `/event/[id]/scanner` whose `.web.tsx` shows the kind-aware "Scan in the app" EmptyState (ORCH-1099) — coherent, NOT a dead tap. No live camera scan on web (unchanged). |
| Consumer iOS/Android (`app-mobile`) | NO | No business Home / scanner exists. |
| Buyer/anonymous Web | NO | Buyer surface; no operator scan. |
| Admin Web (`mingla-admin`) | NO | No business Home. |

**Shared-code parity:** iOS + Android share `home.tsx` + the scanner route → automatic parity. Web shares `home.tsx` but resolves `scanner/index.web.tsx` → manual but already-built parity. The carousel/accordion are pure RN components → automatic iOS/Android/web-RN parity.

---

## Invariant impact (flagged, not pre-decided)

- **Constitution #1 (no dead taps):** a scan button MUST scan or not exist. On native it scans; on web it routes to a coherent EmptyState. SPEC must NOT emit a scan button for any kind/state that cannot reach a working scanner. (All three kinds CAN — see verdicts.)
- **Constitution #9 (no fabricated data):** the "Scanned" tile shows "—" today (no client/server scanned-count source wired into the card). This is CORRECT honest-empty and must NOT be faked. (Note: `scanStore` holds session scans but is not a reliable per-offering historical count; leaving "—" is honest.)
- **Constitution #14 (persisted-state startup gate):** the new collapse store MUST be `hasHydrated`-gated like `currentBrandStore` (`onRehydrateStorage` → `setHasHydrated(true)`, flag NOT persisted) to avoid a flash of the wrong open/closed state on cold start.
- **Constitution #2 (one owner per truth):** live-state is owned by `upcomingBuilder` / `useUpcomingForBrand`. The carousel must read live items from there, not re-derive. Recommend adding a `liveItems` field to the builder return (single owner) rather than ad-hoc filtering in `home.tsx`.
- **Currency-aware revenue:** per-card revenue must use `event.currency ?? brand.defaultCurrency` (existing `liveHeroMetrics` pattern). The `?? "GBP"` fallback inside `useEventSalesSummaries`/`tripToLiveEvent` is the known deferred ORCH-1034 client-GBP-fallback — OUT of scope here; do not "fix" it in this ORCH.
- **I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY:** the scan time-window reads `event_dates`. Trips with no `event_dates` rows fall through to `success` (orch_0793 Decision-3) — acceptable; not this ORCH's concern.

---

## Discoveries for Orchestrator (side issues)

- **DISC-1143-A (stale comment):** `home.tsx:354-356` ORCH-0965 comment is factually wrong post-META-ORCH-1059 ("experiences route to a coming-soon stub … trips have no scanner today"). Must be corrected in IMPLEMENT (in-scope).
- **DISC-1143-B (trips never appear as a live hero today):** `primaryLiveEvent` (`home.tsx:277-280`) excludes trips entirely, so a live trip currently shows NO hero card at all (only an Upcoming row). This ORCH fixes it as part of the carousel. Flagging that it is a pre-existing gap, not a regression.
- **DISC-1143-C (no per-offering historical scanned count):** the "Scanned" tile is "—" because there is no per-offering scanned-count source wired into the card (`scanStore` is session-scoped + device-local). Surfacing a real scanned count would need a new aggregate read — OUT of scope for ORCH-1143; keep "—" (honest). Register as a potential future enhancement.

---

## Per-kind scannability verdict (THE GATING DELIVERABLE)

| Kind | Class | Verdict | Evidence |
|------|-------|---------|----------|
| **event** | **(A) FULLY SCANNABLE today** | Backend + screen + route + home button all already work for events. | F-1..F-9 |
| **experience** | **(A) FULLY SCANNABLE today** | Same backend (F-1,F-2,F-3), screen kind-aware (F-5), route resolves via `fetchBusinessEventById` (F-6), metrics work (F-8). ONLY the home `showScanAction` gate (`kind === "event"`) suppresses it. UI-only. | F-1,F-2,F-3,F-5,F-6,F-8,F-9 |
| **trip** | **(A) FULLY SCANNABLE today** | Trips sell scannable tickets (F-4 + F-3), scan RPC is generic (F-2), route resolves trips via the `tripToLiveEvent` fallback (F-6), per-card metrics work via the same adapter (F-8). ONLY the home gates (trip excluded from hero + event-only scan) suppress it. UI-only. | F-1,F-2,F-3,F-4,F-6,F-8,F-9 |

**No kind requires a backend build. No `/experience/[id]/scanner` or `/trip/[id]/scanner` route is needed — `/event/[id]/scanner` is the shared scan route for all kinds. NO SCOPE EXPANSION. The entire ORCH-1143 ask is UI work on `home.tsx` + a new persisted collapse store + a lifted per-card live component.**

---

## Confidence level

**proven** (schema + code layers, feasibility + UI-gate root cause). The end-to-end "scan a live experience/trip ticket on device" happy path is **probable** pending the tester's live-fire (no contradicting evidence; all five gates trace clean).

## Recommended next phase + scope (direction only)

Proceed to **SPEC** (this same dispatch) then DESIGN → IMPLEMENT → TEST → CLOSE. Scope is strictly the three asks, all UI-only:
1. Generalize the home scan button to every live offering kind (event/experience/trip), routing all to `/event/[id]/scanner`.
2. Make the live card a collapsible accordion with a `hasHydrated`-gated persisted collapse store.
3. Render all concurrently-live offerings as a horizontal carousel, each card with its own scan button, by consuming `liveItems` (filter the existing sorted `items`).
DO NOT design any backend; there is none to build.
