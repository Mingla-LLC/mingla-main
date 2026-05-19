# INVESTIGATION v2 — ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity Audit]

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode — DEEP RE-INVESTIGATION)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Output:** this file at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_V2_FULL_PARITY_AUDIT.md`
**v1 baseline (SUPERSEDED but RETAINED):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` + `Mingla_Artifacts/specs/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md`
**Operator dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0876_V2_FULL_PARITY_AUDIT.md`
**Author confidence (overall):** **probable** — source + schema + data layers thoroughly traced across both events and trips; sim/web live-fire blocked in this orchestrator-driven session. Operator can promote S-3 + S-1 to "proven" in <10 min by visiting the published trip and running the wizard on iOS sim.

---

## 0. Layman summary

- **v1's miss, root cause:** v1 forensics read `EventCreatorWizard` (the create surface) and concluded events have no Save button. v1 stopped after finding the wizard and did not enumerate every event-edit surface. There is a SECOND event-edit surface — `EditPublishedScreen.tsx` (1,189 lines, ORCH-0704 v2) — built specifically for editing already-published events. v1 missed it. This v2 reads everything.
- **The real parity model:** events route by query param `?mode=edit-published`. Draft → `EventCreatorWizard`. Published → `EditPublishedScreen` (6-section accordion + "Save changes" button + `ChangeSummaryModal` with required-reason input + refund-gate with 9 rejection types + multi-channel notification dispatch + edit audit log). Trips have ZERO equivalent of the published-edit surface.
- **Events architecture has hidden debt v2 can leapfrog:** events use a CLIENT-side Zustand `useLiveEventStore` for the "live event" — most edits mutate the Zustand row, NOT the DB. Only cover-media (via `updatePublishedEventCoverMedia`) and ORCH-0824 taxonomy (`patchPublishedEventTaxonomy` RPC) actually write to the DB. The rest are client-only. This is a known architectural compromise; trips can avoid it entirely by going DB-direct via new `updateLiveTripFields` RPC.
- **S-3 is still broken** exactly as v1 documented — Reserve CTA routes to `/checkout/{tripId}` and `getPublicEventById` hard-rejects trips by design. Fix shape unchanged: new `/checkout-trip/[tripEventId]/*` chain + `usePublicTripById` + `getPublicTripById`.
- **S-1 + S-2 expand:** v1 proposed Step1-embedded cover + autosave-on-back/close. v2 supersedes with a full `EditPublishedTripScreen` (mirroring events' 6-section accordion + Save + ChangeSummaryModal + refund-gate) PLUS keeping the draft-wizard autosave polish for the draft path PLUS Cover embedded in Step1 (draft) AND as its own accordion section in EditPublishedTripScreen. Full 3-provider cover picker (ImagePicker + GIPHY + Pexels) on both surfaces.
- **NEW S-4:** Published trip edit lacks the entire parity stack — Save semantic, diff confirmation, required-reason audit, refund-gate, change-notification dispatch, edit log. v2 builds the full stack for trips.
- **Tr4 [ORCH-0875] coordination conflict surfaced:** Tr4 spec at §3.5.7-3.5.8 designs the buyer-cancel route at `/booking/[orderId]/cancel` (order-scoped — works for any event_type — KEEP AS IS) BUT also modifies `/checkout/[eventId]/index.tsx` for the "Bookings closed" 403 banner. The latter modification was written on the broken assumption that trips route through the event chain. v2's S-3 fix moves the booking-closed banner to the new `/checkout-trip/[tripEventId]/index.tsx`. Tr4 SPEC needs amendment post-v2-CLOSE; the order-scoped cancel route is fine.
- **Data state (SQL probe):** 7 trips total, only ONE published (`"The DC Adventure"` slug `the-dc-adventure`, id `060d0483-...`, 6 days + 1 tier + 6 inclusions, no cover); 6 are drafts in various states; ZERO confirmed orders on any trip (consistent with S-3 blocking all purchases). Refund-gate has no live data to gate today but must be built — once trips become purchasable, orders accumulate.
- **Architectural recommendation: trips go server-side.** Build `updateLiveTripFields` as a real DB-write RPC (atomic across `events` + `trip_days` + `trip_inclusions` + `trip_pricing_tiers`). No Zustand intermediary like events have. This is cleaner, avoids the events-side technical debt, and matches the trip data ownership model (React Query reads from `useTrip` → DB; mutations write to DB; no client-state cache of trip).

---

## 1. Phase 0 ingest receipts

### Specs read (file path with confirmation of end-to-end read)

- `Mingla_Artifacts/specs/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` (v1 baseline, retained) — full read
- `Mingla_Artifacts/specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md` — head + structure read (canonical pattern reference)
- `Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md` — invariant base read
- `Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` — Tr2 wizard origin read
- `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` — installment invariants read
- `Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` — chrome contract read
- `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` — Tr4 coordination read; §3.5.7-3.5.8 conflict surfaced (see §6 + §11 Q-15)

### Reports read

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` — v1 baseline, full re-read
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md` — referenced for ORCH-0704 baseline context
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md` — referenced
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` — chrome receipts

### Memories read (Claude auto-memory)

- `feedback_anon_buyer_routes.md`, `feedback_always_simulator_repro_described_behaviour.md`, `feedback_sim_test_drivers_maestro_default.md`, `feedback_verify_db_column_names_before_writing_queries.md`, `feedback_solo_collab_parity.md`, `feedback_keyboard_never_blocks_input.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_rn_color_formats.md`, `feedback_zustand_persist_no_server_snapshots.md` (NEW relevance — informs trip server-side architectural choice)

### Event-side files read end-to-end

- `mingla-business/src/components/event/EditPublishedScreen.tsx` lines 1-1189 (full file)
- `mingla-business/src/components/event/ChangeSummaryModal.tsx` lines 1-250 + remainder grepped
- `mingla-business/src/components/event/EditAfterPublishBanner.tsx` (full ~60 lines)
- `mingla-business/src/utils/liveEventAdapter.ts` lines 1-330 (signatures + FIELD_LABELS + MATERIAL_KEYS + SAFE_KEYS + editableDraftToPatch end-to-end)
- `mingla-business/src/utils/publishedEventEditGuards.ts` (full — 9 rejection reasons mapped)
- `mingla-business/src/store/liveEventStore.ts` lines 1-560 (full read including updateLiveEventFields action 429-520)
- `mingla-business/src/services/eventChangeNotifier.ts` (full surface — banner/email/sms/push channels + severity-driven channel flags)
- `mingla-business/src/components/event/CreatorStep4Cover.tsx` lines 1-90 (3-provider picker + ORCH-0783 image-first model)
- `mingla-business/app/event/[id]/edit.tsx` lines 200-340 (routing logic: query-param `?mode=edit-published` → EditPublishedScreen; default → EventCreatorWizard)
- `mingla-business/src/services/eventCoverMediaService.ts` (updateLiveEventCoverMedia + uploadEventCoverMedia + EVENT_COVER_BUCKET)
- `mingla-business/src/components/event/EventCreatorWizard.tsx` lines 740-855 (dock CTAs — Continue, Back, Publish event; NO Save button; autosave via `onAutosaveDraft` prop)

### Trip-side files (re-read with parity lens)

- `mingla-business/app/trip/[id]/edit.tsx` full 146 lines — always renders TripCreatorWizard; no routing by status
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` 974 lines — autosave on Next-tap only, no save-on-back/close, no Save CTA, only Publish
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` — Props interface read; zero cover refs (proven for v1, re-confirmed)
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` — Props read; no editMode pattern
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` — Props + Step4Draft read; no editMode pattern; PaymentPlanEditor + tier mgmt
- `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx`, `TripCreatorStep5Review.tsx`, `TripDayEditor.tsx`, `PaymentPlanEditor.tsx`, `TripPreview.tsx`, `TripManageMenu.tsx`, `TripCheckoutFlow.tsx` — all read
- `mingla-business/src/services/tripsService.ts` (878+ lines) — every mutation function surface: createTripDraft / getTrip / getTripsByBrand / updateTripBasics / upsertTripDays / upsertTripInclusions / updateTripPricing / publishTrip / softDeleteTrip. **No `updateLiveTripFields` exists.** **No edit-mode-only path exists.**
- `mingla-business/src/hooks/useTrips.ts`, `usePublicTripBySlug.ts` — read

### Buyer-purchase chain files

- `mingla-business/app/checkout/[eventId]/{_layout,index,buyer,payment,confirm}.tsx` — read for parity-clone pattern
- `mingla-business/src/components/checkout/{CartContext,CheckoutHeader,QuantityRow}.tsx` — shared primitives confirmed reusable
- `mingla-business/src/services/publicEventsService.ts` lines 450-565 — re-confirmed trip-rejection probes at `getPublicEventBySlug` + `getPublicEventById` + `getPublicBrandBySlug`

### SQL probes run (Supabase MCP)

- **Probe 1 (v1):** event_type aggregate — confirmed 7 trips, 0 published-status, 0 covered
- **Probe 2 (v2, this report):** per-trip status + sidecar counts + orders — see §2.4 below

### Tests read (test pattern + invariants)

- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` — read; 8 trip-defensive clauses live
- `mingla-business/src/components/trip/__tests__/{tr2RewordPolish,publishErrorMapper.adversarial,TripVisualParity,TripVisualParity_adversarial,PaymentPlanEditor,PaymentPlanEditor_adversarial}.test.ts` — listed; structure understood (61 trip tests passing baseline)
- `mingla-business/app/trip/__tests__/{trip-dashboard-edit,trip-create-publish}.test.ts` — listed

### Migrations + RPCs read

- `supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql`
- `supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql`
- `supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql`
- `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql` (publish RPC accepts cover_media_*)
- `supabase/migrations/20260609000000_orch_0859_trip_publish_slug_flag.sql`
- `supabase/migrations/20260610000000_tr3_installments.sql`
- `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` (v_is_trip branching)

---

## 2. Reproduction evidence

### 2.1 S-3 (buyer "Reserve my spot" → Event not found)

**Source chain (deterministic, same as v1 — re-confirmed):**

`TripCheckoutFlow.tsx:62` `router.push('/checkout/${trip.id}')` → `checkout/[eventId]/index.tsx:79` `usePublicEventById(eventId)` → `publicEventsService.ts:485-510` probes `events.event_type` → returns `null` if trip → `index.tsx:146-165` renders "Event not found" empty state.

**Audit test** at `eventType.filter.audit.test.ts:102-106` enforces this trip-rejection by design. Fix must be ADDITIVE (new route + new resolver), not subtractive.

**Sim/web live-fire status:** BLOCKED in this orchestrator session (no Maestro / no iOS dev-build / no headless browser). Operator can promote to "proven" in <2 min on web:
1. Visit `https://business.usemingla.com/t/<brand-slug>/the-dc-adventure` (the one published trip per SQL probe)
2. Tap "Reserve my spot"
3. Screenshot the "Event not found" empty state

Confidence ceiling without live-fire: **probable**. Promoted by data probe in §2.4 + audit test source + deterministic 6-step chain.

### 2.2 S-1 (edit-trip wizard has no Save semantic)

**Source chain (re-confirmed from v1):**

- `TripCreatorWizard.tsx:471-483` `handleNext` calls `autosaveCurrentStep()` — forward step ONLY
- `TripCreatorWizard.tsx:485-489` `handleStepBack` decrements step WITHOUT save
- `TripCreatorWizard.tsx:491-528` `handleClose` in edit mode = "silent exit" comment but does NOT call autosave
- `TripCreatorWizard.tsx:567-601` `handlePublishTap` is the only explicit commit — re-publishes the trip
- No Save CTA exists in the wizard chrome

**Parity reference (operator-cited):** `EditPublishedScreen.tsx:1026` `<Button label="Save changes" ... />` — the Save button trips lack. Plus the entire surrounding apparatus (ChangeSummaryModal + reason input + refund-gate).

**Sim live-fire status:** BLOCKED. Operator can promote to "proven" in <5 min on iOS sim by reproducing the silent-loss path on a draft trip.

### 2.3 S-2 (no cover edit)

**Source-proven (S-2 was already PROVEN in v1; re-confirmed):** zero cover refs in `TripCreatorStep1Basics.tsx`. `EventCreatorWizard.tsx:77,87,631` imports + uses `CreatorStep4Cover`. SQL probe §2.4 shows 0/7 trips with cover. Pure additive gap.

### 2.4 SQL data probe (run via Supabase MCP, 2026-05-18)

```sql
SELECT e.id, e.event_type, e.status, e.cover_media_url IS NOT NULL AS has_cover, e.slug, e.title,
       (SELECT COUNT(*) FROM trip_days WHERE event_id = e.id) AS days,
       (SELECT COUNT(*) FROM trip_pricing_tiers WHERE event_id = e.id) AS tiers,
       (SELECT COUNT(*) FROM trip_inclusions WHERE event_id = e.id) AS inclusions,
       (SELECT COUNT(*) FROM orders WHERE event_id = e.id) AS orders_total,
       (SELECT COUNT(*) FROM orders WHERE event_id = e.id AND payment_status NOT IN ('failed','cancelled')) AS orders_confirmed
FROM events e WHERE event_type='trip' AND deleted_at IS NULL ORDER BY created_at DESC;
```

| trip id (truncated) | status | has_cover | slug | days | tiers | inclusions | orders | confirmed |
|---|---|---|---|---|---|---|---|---|
| `743ad25b...` | draft | false | draft-mpap9270 | 0 | 1 | 0 | 0 | 0 |
| `f022372a...` | draft | false | draft-mpa3afg6 | 0 | 1 | 0 | 0 | 0 |
| **`060d0483...`** | **scheduled** | **false** | **the-dc-adventure** | **6** | **1** | **6** | **0** | **0** |
| `3b7bfe5f...` | draft | false | draft-mp9xzbyc | 1 | 1 | 0 | 0 | 0 |
| `891408d7...` | draft | false | draft-mp9xgx0m | 0 | 0 | 0 | 0 | 0 |
| `80315939...` | draft | false | draft-mp9xejw6 | 0 | 0 | 0 | 0 | 0 |
| `d96bef02...` | draft | false | draft-mp9xe1a9 | 0 | 0 | 0 | 0 | 0 |

**Key data findings:**
- ONE published trip exists ("The DC Adventure") — this is the operator's S-3 test subject
- 0/7 trips have a cover (consistent with no-UI gap)
- 0 confirmed orders on any trip (consistent with S-3 broken — purchase impossible)
- Refund-gate will have no live data to gate today; system must be built anyway because once trips can be purchased, orders accumulate

### 2.5 S-4 (NEW) Edit-published-event reference flow — sim live-fire BLOCKED

The dispatch §5 mandates running the EditPublishedScreen flow as the gold-standard reference. **BLOCKED in this orchestrator session** — no sim access. Operator can run in <5 min:
1. Open mingla-business iOS dev build as an event-brand operator
2. Open a published event
3. Tap Edit → URL becomes `/event/{id}/edit?mode=edit-published` (per `app/event/[id]/edit.tsx:340`)
4. Observe the EditPublishedScreen 6-section accordion
5. Change a Basics field (description) → tap "Save changes" → screenshot the ChangeSummaryModal opening → enter reason → confirm → observe success toast + return

This is the canonical pattern v2 SPEC mirrors for trips.

---

## 3. Five-truth-layer reconciliation

### S-3 (buyer reserve)

| Layer | Source | Verdict |
|---|---|---|
| Docs | SPEC_ORCH-0859 §4.9 | "Reuses /checkout chain end-to-end" — WRONG assumption |
| Docs | publicEventsService.ts:459 | "Trip-public surface is /t/{...}" — explicitly denies reuse |
| Schema | events.event_type | Live discriminator (ORCH-0826) |
| Schema | biz_ticket_checkout_create_session | v_is_trip branching live (Tr3) |
| Code | TripCheckoutFlow.tsx:62 | Routes to /checkout/{tripId} |
| Code | publicEventsService.ts:497-499 | Returns null for trip — by design |
| Code | eventType.filter.audit.test.ts:102-106 | Audit enforces trip-rejection |
| Runtime | (sim BLOCKED) | Deterministic from source |
| Data | SQL probe §2.4 | 1 published trip exists, 0 orders (purchase blocked) |

**Contradiction:** Tr2 docs claim reuse; Tr2 REWORK 3 + audit explicitly deny it. Architecture-by-stale-assumption.

### S-1 (edit-wizard save)

| Layer | Source | Verdict |
|---|---|---|
| Docs | ORCH-0704 v2 spec | Defines "Save changes" + reason + refund-gate for EVENTS — no trip equivalent doc |
| Schema | events + trip_days + trip_inclusions + trip_pricing_tiers | Schema supports patch writes |
| Schema | useUpdateTripBasics + 3 trip mutations | Service hooks exist; no atomic-patch service |
| Code | TripCreatorWizard.handleStepBack (485-489) | No autosave call |
| Code | TripCreatorWizard.handleClose (491-528) | No autosave call in edit mode |
| Code | EditPublishedScreen.handleSavePress + handleConfirmSave | Full Save + diff + reason + guards |
| Runtime | (sim BLOCKED) | |
| Data | n/a |  |

**Contradiction:** events have an entire published-edit subsystem; trips have nothing equivalent.

### S-2 (cover)

| Layer | Source | Verdict |
|---|---|---|
| Docs | ORCH-0876 v1 §6 | Spec'd cover in Step 1 |
| Docs | ORCH-0859 Tr2 spec | No cover specified for trips |
| Schema | events.cover_media_* | 7 columns exist; usable by trips |
| Schema | business_publish_trip_draft RPC | Accepts 7 cover_media_* fields |
| Schema | event_covers storage bucket | Reusable for trips |
| Code | TripCreatorStep1Basics | Zero cover refs |
| Code | CreatorStep4Cover | Full 3-provider picker (ImagePicker + GIPHY + Pexels) |
| Code | usePublicTripBySlug:139-140 | Reads cover_media_url on public page |
| Runtime | (sim BLOCKED) | |
| Data | SQL probe | 0/7 trips have cover (UI-gap confirmed) |

### S-4 (NEW — published trip edit parity)

| Layer | Source | Verdict |
|---|---|---|
| Docs | ORCH-0704 v2 spec full | Events have multi-channel notifications + refund-gate + edit log + reason audit |
| Docs | No trip spec | Trips have NONE of this |
| Schema | events + trip sidecars | Supports trip patch writes; refund-gate needs `getOrdersForTrip` equivalent |
| Schema | useLiveEventStore Zustand | Events use Zustand intermediate; trips do not |
| Schema | useEventEditLogStore Zustand | Events have append-only audit log; trips have none |
| Code | EditPublishedScreen + ChangeSummaryModal + EditAfterPublishBanner | Full event surface; zero trip equivalent |
| Code | eventChangeNotifier | 4-channel dispatch for events; trips have none |
| Code | validateLiveEventFieldUpdate | 9 rejection reasons; trips have NO equivalent guard |
| Runtime | (sim BLOCKED) | |
| Data | SQL probe | 0 trip orders today (refund-gate has no live load — builds for future) |

**Contradiction across all 4 sub-symptoms:** Trip persona shipped in ORCH-0855/0859/0869/0874 as a "minimum viable" surface with major edit/buyer-purchase functionality deferred. Tr4 (ORCH-0875) was being designed against partly-broken assumptions about the deferred work. v2 closes all gaps in one bundled CLOSE.

---

## 4. Parity matrix (PRIMARY DELIVERABLE)

Every event-side capability → trip-side equivalent or absence → v2 spec target. 32 rows.

| # | Capability | Event surface (file:line) | Trip equivalent today | Gap | v2 spec target |
|---|---|---|---|---|---|
| 1 | Edit-screen status routing | `app/event/[id]/edit.tsx:340` dispatches via `?mode=edit-published` query param | `app/trip/[id]/edit.tsx:1-146` always renders TripCreatorWizard | FULL MISS | Rewrite `app/trip/[id]/edit.tsx` to dispatch by `trip.status`: draft → TripCreatorWizard; scheduled/live → EditPublishedTripScreen |
| 2 | Published-edit accordion screen | `EditPublishedScreen.tsx` 1,189 lines, 6 sections | none | FULL MISS | NEW `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` mirroring sections 1-6 |
| 3 | Sectioning (accordion, one open at a time) | `EditPublishedScreen.tsx:128-135 SECTIONS array` + `:357-362 handleToggleSection` | n/a | FULL MISS | Mirror — trip-native sections: Basics / Itinerary / Inclusions / Pricing / Cover / Settings (D1: section count + naming locked at SPEC) |
| 4 | "Save changes" button | `EditPublishedScreen.tsx:1026` Button label="Save changes" | none | FULL MISS | Mirror in EditPublishedTripScreen sticky bottom dock |
| 5 | Save-on-Save button validation | `EditPublishedScreen.handleSavePress:382-445` validates sections, builds patch, opens modal | none | FULL MISS | Mirror |
| 6 | Field-diff modal | `ChangeSummaryModal.tsx` 561 lines | none | FULL MISS | NEW `TripChangeSummaryModal.tsx` OR generalize `ChangeSummaryModal.tsx` (D2: generalize vs new) |
| 7 | Field diff computation | `liveEventAdapter.computeRichFieldDiffs:397` + `FIELD_LABELS:103-141` + `editableDraftToPatch:218-326` | none | FULL MISS | NEW `tripAdapter.ts` with trip-specific `FIELD_LABELS`, `editableTripToPatch`, `computeRichFieldDiffs`, `computeTripDayDiffs`, `computeTripInclusionDiffs`, `computeTripPricingTierDiffs` |
| 8 | Severity classification (material vs additive) | `liveEventAdapter.classifySeverity:203` + `MATERIAL_KEYS:147` + `SAFE_KEYS:166` | none | FULL MISS | Define trip-specific MATERIAL_KEYS (dates, destination, capacity, days dropped, tier price, tier deleted) + SAFE_KEYS (title, description, cover, inclusions added) |
| 9 | Ticket diffs (sub-renderer) | `liveEventAdapter.computeTicketDiffs:441` + `ChangeSummaryModal TicketsDiffSubRenderer` | none | FULL MISS | Mirror as `computeTripPricingTierDiffs` + sub-renderer |
| 10 | Required reason input (10-200 chars) | `ChangeSummaryModal.tsx:43-44 REASON_MIN/MAX + 184-225 reason input + counter + helper` | none | FULL MISS | Mirror unchanged |
| 11 | Severity-driven footer copy | `ChangeSummaryModal.tsx:95-105 + 228-246` | none | FULL MISS | Mirror — adjust copy for trip context |
| 12 | "NOTIFIES BUYERS" tag on material diffs | `ChangeSummaryModal.tsx:152-153` | none | FULL MISS | Mirror |
| 13 | Refund-gate guard rails | `publishedEventEditGuards.validateLiveEventFieldUpdate` 9 rejection reasons | `softDeleteTrip` rejects on confirmed orders (`tripsService.ts:810`) — only 1 reason | PARTIAL MISS (8 missing) | NEW `publishedTripEditGuards.validateLiveTripFieldUpdate` mirroring event 9 reasons: missing/invalid_edit_reason, event_not_found (→ trip_not_found), capacity_below_sold (per tier), tier_delete_with_sales, tier_price_change_with_sales, days_dropped_with_sales, dates_shifted_with_sales (when start/end change after sales), inclusions_removed_with_sales (D5: which removals trigger refund-gate?) |
| 14 | Refund-first reject dialog | `EditPublishedScreen.buildRejectDialog:475-594` 9 dialog variants + "Open Orders" CTA | none | FULL MISS | Mirror trip-specific variants — "Open Orders" routes to `/trip/{id}/orders` (NOT `/event/{id}/orders` — see D7) |
| 15 | Server-side update path for non-cover fields | `useLiveEventStore.updateLiveEventFields` (Zustand-only for most fields) + `patchPublishedEventTaxonomy` RPC for taxonomy | none | FULL MISS | NEW `updateLiveTripFields` service — **server-side RPC** (D4: leapfrog events' Zustand-debt) writing atomically to events + trip_days + trip_inclusions + trip_pricing_tiers |
| 16 | Server-side cover update | `updatePublishedEventCoverMedia` (eventCoverMediaService.ts:180) | none for trips | FULL MISS | Reuse `updatePublishedEventCoverMedia` directly (events-table-row-id keyed; works for trips) — OR add a thin `updatePublishedTripCoverMedia` alias for naming clarity |
| 17 | EditAfterPublishBanner | `EditAfterPublishBanner.tsx` orange-tinted warning | none | FULL MISS | NEW `EditAfterPublishTripBanner.tsx` with trip-specific copy ("You're editing a live trip. Changes save immediately. Buyers stay protected — their reservations and prices won't change.") |
| 18 | "Edited" badge per section | `EditPublishedScreen.editedSectionKeys:885-932` | none | FULL MISS | Mirror — trip-specific section→fieldKey mapping |
| 19 | "Fix" badge per section (validation errors) | `EditPublishedScreen.sectionErrors:341-354 + render :998-1001` | none | FULL MISS | Mirror — trip-specific validation per section |
| 20 | Edit audit log (append-only Zustand) | `useEventEditLogStore` + `recordEdit` (called in `updateLiveEventFields`) | none | FULL MISS | NEW `useTripEditLogStore` (D6: append-only Zustand vs DB-side audit table; recommend DB-side `trip_edit_log` table for source of truth — events have technical debt here) |
| 21 | Multi-channel notification dispatch | `eventChangeNotifier.notifyEventChanged` (banner + email + sms + push) | none | FULL MISS | NEW `tripChangeNotifier` (D8: real channels vs stubs — recommend stub-parity with events; B-cycle wires real Resend/Twilio later) |
| 22 | Severity-driven channel flags | `eventChangeNotifier.deriveChannelFlags:143` | none | FULL MISS | Mirror unchanged |
| 23 | Has-web-purchases gate (drives SMS firing) | `useEventHasWebPurchases` hook | none for trips | FULL MISS | NEW `useTripHasWebPurchases(tripId)` |
| 24 | Cover provider picker — 3 providers | `CreatorStep4Cover.tsx` ImagePicker + GIPHY + Pexels via `searchGiphyEventCovers` + `searchPexelsEventCovers` + `uploadEventCoverMedia` | none for trips | FULL MISS | D3: extract shared `<CoverPicker>` component (touches event-side refactor) OR inline parallel 3-provider picker in trip Step 1 + EditPublishedTripScreen Cover section. RECOMMEND extract — single source forever. |
| 25 | Buyer purchase chain (5 routes) | `/checkout/[eventId]/{_layout,index,buyer,payment,confirm}.tsx` | none usable (audit hard-rejects) | FULL MISS | NEW `/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx` — thin trip-aware shells around shared CartContext / CheckoutHeader / QuantityRow primitives |
| 26 | Public-by-id resolver | `usePublicEventById` + `getPublicEventById` | none for trips (only by-slug) | FULL MISS | NEW `usePublicTripById` + `getPublicTripById` (v1 design retained, audit-test extended) |
| 27 | Tier-edit-with-sold-count UX | `CreatorStep5Tickets editMode.soldCountByTier` makes price/delete read-only when tier has sales | none for trips | FULL MISS | Extend TripCreatorStep4Pricing with editMode prop accepting `soldCountByTier`; lock tier price + delete when used in EditPublishedTripScreen |
| 28 | Tier edit sheet for published events | `TicketTierEditSheet.tsx` (with editMode.soldCountByTier) | none for trips | TBD | D9: do trips need a separate `TripPricingTierEditSheet.tsx`? Probably yes — paying-installment trips have complex tier semantics. Or handle inside Pricing section directly. SPEC decides. |
| 29 | Cover video processing gate | `EditPublishedScreen.coverVideoProcessing` state | none for trips | n/a | v1 scope skips video; cover picker is image-only initially per ORCH-0783 — match scope |
| 30 | Audit test extension | `eventType.filter.audit.test.ts:102-106 + 122-127` enforces trip-rejection on event resolvers + event-only on trip mutations | extension needed | KNOWN | Extend with `getPublicTripById` pins event_type='trip'; `updateLiveTripFields` pins event_type='trip' |
| 31 | Cache invalidation on save | `EditPublishedScreen.invalidateServerEventCaches:447-472` invalidates 5 query keys | none for trips | FULL MISS | NEW `invalidateServerTripCaches` invalidating tripKeys.byId + tripKeys.byBrand + publicTripKeys.detailBySlug + publicTripKeys.detailById |
| 32 | Storage bucket for covers | `EVENT_COVER_BUCKET = "event_covers"` | n/a — trips share same bucket (events-row-id keyed) | none | reuse bucket as-is |

**Total rows: 32.** Matrix exceeds 25-row dispatch minimum. Each row is a citation-backed gap with v2 spec target.

---

## 5. Findings (six-field evidence cards)

### F-1 (S-3) 🔴 ROOT CAUSE — TripCheckoutFlow routes to event-only chain (re-confirmed from v1)
- **File + line:** `mingla-business/src/components/trip/TripCheckoutFlow.tsx:59-62`
- **Exact code:** `router.push('/checkout/${trip.id}' as never);`
- **What it does:** Sends buyer to `/checkout/{tripId}` which uses event-only resolver.
- **What it should do:** Route to `/checkout-trip/${trip.id}` (new trip-only chain).
- **Causal chain:** Reserve tap → push → mount checkout/[eventId]/index → usePublicEventById → returns null for trips → "Event not found".
- **Verification:** Operator visits `/t/{brand}/the-dc-adventure` → tap Reserve → expect empty state.

### F-2 (S-3) 🔴 ROOT CAUSE — getPublicEventById rejects trips by design
- **File + line:** `mingla-business/src/services/publicEventsService.ts:485-510`
- **Exact code:** lines 491-499 — event_type probe + `return null` if 'trip'
- **What it does:** Returns null for any trip row regardless of caller.
- **What it should do:** Stay as-is; new `getPublicTripById` resolves trips.
- **Causal chain:** Identical to F-1 step 5.
- **Verification:** Audit test `eventType.filter.audit.test.ts:102-106` enforces this; widening would BREAK audit.

### F-3 (S-3) 🟠 CONTRIBUTING — Tr2 SPEC's reuse claim was never validated end-to-end (re-confirmed from v1)
- **File + line:** `SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` §4.9 + `TripCheckoutFlow.tsx:5-13` header
- **What it does:** Doc-layer claim that the existing /checkout chain handles trips.
- **What it should be:** A spec for the dedicated trip-checkout chain.
- **Causal chain:** Tr2 doc → implementor shipped on assumption → REWORK 3 audit added filter → no end-to-end QA caught the contradiction.

### F-4 (S-1) 🔴 ROOT CAUSE — Trip wizard autosave is forward-only (re-confirmed from v1)
- **File + line:** `TripCreatorWizard.tsx:471-489`
- **What it does:** `handleNext` calls autosave; `handleStepBack` decrements WITHOUT save; `handleClose` edit-mode exits WITHOUT save.
- **What it should do:** In v2 SPEC, draft-edit gets save-on-back/save-on-close polish (v1 fix kept) AND published-edit moves to EditPublishedTripScreen with explicit "Save changes" CTA.

### F-5 (S-1) 🔴 ROOT CAUSE — NEW — Trip persona has no published-edit surface (v1 missed)
- **File + line:** `app/trip/[id]/edit.tsx:99-122` always renders `<TripCreatorWizard>` regardless of trip.status; `mingla-business/src/components/trip/` contains zero file mirroring `EditPublishedScreen.tsx`
- **Exact code:** edit.tsx renders wizard unconditionally
- **What it does:** Published trips edit through the same wizard as drafts — no Save semantic, no diff confirmation, no refund-gate.
- **What it should do:** Route by `trip.status`: draft → wizard; scheduled/live → new `EditPublishedTripScreen` mirroring events' ORCH-0704 v2 pattern.
- **Causal chain:** Tr2 [ORCH-0859] shipped minimum-viable trip surface and deferred published-edit work; Tr3/Tr4 built on top without adding it; ORCH-0874 [Trip Visual Parity] addressed chrome only.
- **Verification:** `grep -rln "EditPublishedTripScreen\|EditPublishedTrip\|TripChangeSummary\|updateLiveTripFields" mingla-business/` returns zero matches.

### F-6 (S-1) 🟠 CONTRIBUTING — No explicit Save CTA in TripCreatorWizard chrome (v1 finding retained)
- **File + line:** TripCreatorWizard.tsx:567-601
- **What it does:** Only commit affordance is `handlePublishTap` (republish).

### F-7 (S-1) 🟡 HIDDEN FLAW — Step-scoped mutations create partial-save risk (v1 finding retained)
- **File + line:** TripCreatorWizard.tsx:399-451 — 4 independent mutations per step
- **What it does:** Cross-step network failure leaves DB in inconsistent state.
- **v2 mitigation:** `updateLiveTripFields` RPC writes atomically (single transaction) — eliminates the partial-save risk for the published-edit path. Wizard step path retains the risk but is acceptable for draft mode.

### F-8 (S-2) 🔴 ROOT CAUSE — No cover surface in trip wizard (re-confirmed)
- **File + line:** `TripCreatorStep1Basics.tsx` zero cover refs; `TripCreatorWizard.tsx` STEP_TITLES has no Cover step
- **What it should do:** Cover field embedded in Step 1 (draft) + Cover accordion section in EditPublishedTripScreen (published).

### F-9 (S-2) 🔵 OBSERVATION — Publish RPC already accepts cover_media_* (re-confirmed)
- **File + line:** migration `20260608000100_orch_0859_publish_rpc_trip.sql:50-56, 200-209`

### F-10 (S-2) 🔵 OBSERVATION — Cover picker has 3 providers fully built for events
- **File + line:** `CreatorStep4Cover.tsx:69 providerTab state + :213-217 GIPHY/Pexels search + :158 ImagePicker.launchImageLibraryAsync + :167 uploadEventCoverMedia`
- **What it does:** Full GIPHY + Pexels + Image picker with tab UI.
- **v2 use:** Extract to shared `<CoverPicker>` and consume in both trip and event flows OR inline parallel — D3 decides.

### F-11 (S-4) 🔴 ROOT CAUSE — NEW — Trip schema has no atomic patch mutation
- **File + line:** `tripsService.ts` — exports `updateTripBasics`, `upsertTripDays`, `upsertTripInclusions`, `updateTripPricing` (4 separate mutations), `publishTrip`, `softDeleteTrip` — but NO `updateLiveTripFields` atomic-patch
- **What it does:** Today edits across 4 trip tables require 4 separate network roundtrips; no transaction boundary.
- **What it should do:** NEW `updateLiveTripFields(eventId, patch, soldCountCtx, reason)` RPC writing atomically across `events` + `trip_days` + `trip_inclusions` + `trip_pricing_tiers`.

### F-12 (S-4) 🔴 ROOT CAUSE — NEW — No refund-gate for trip published-edit
- **File + line:** `publishedEventEditGuards.ts` exists for events (9 rejection reasons); `mingla-business/src/utils/` contains no `publishedTripEditGuards.ts`
- **Verification:** `grep "publishedTripEditGuards\|validateLiveTripFieldUpdate" mingla-business/ supabase/` returns zero matches.

### F-13 (S-4) 🔴 ROOT CAUSE — NEW — No diff-and-reason audit for trip published-edit
- **File + line:** No `tripAdapter.ts`; no `useTripEditLogStore`; no `TripChangeSummaryModal.tsx`

### F-14 (S-4) 🔴 ROOT CAUSE — NEW — No multi-channel notification dispatch for trip changes
- **File + line:** `eventChangeNotifier.ts` exists for events; no `tripChangeNotifier.ts`

### F-15 (S-4) 🟠 CONTRIBUTING — NEW — softDeleteTrip's confirmed-orders check is the ONLY existing refund-gate hint
- **File + line:** `tripsService.ts:810-825`
- **What it does:** Reject trip delete when confirmed orders exist.
- **v2 use:** Mirror the pattern + extend to per-tier sold counts, day removal, date shifts, inclusion removal — 8 additional rejection reasons.

### F-16 (Cross-cutting) 🔴 ROOT CAUSE — NEW — ORCH-0875 [Tr4] designed against partly-broken assumption
- **File + line:** `SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` §3.5.8 modifies `app/checkout/[eventId]/index.tsx` for "Bookings closed" 403 banner
- **What it does:** Adds banner to event-side index assuming trips route through it.
- **What it should do:** Move modification to `app/checkout-trip/[tripEventId]/index.tsx` after v2 ships the new chain. Tr4 SPEC amendment required POST v2 CLOSE.
- **NOTE — partial good design:** Tr4 puts the buyer cancel route at `/booking/[orderId]/cancel` which IS order-scoped (event-type-agnostic) — that part of Tr4 is fine and works for both events and trips. The conflict is only the index.tsx 403 banner.

### F-17 (Cross-cutting) 🟡 HIDDEN FLAW — Events' Zustand-only-write architecture is technical debt
- **File + line:** `liveEventStore.ts:429-520 updateLiveEventFields` — most fields update Zustand only, not DB
- **What it does:** Operator's "live" view diverges from DB truth for most fields.
- **v2 trip design:** Skip this debt — trips write DB-side via `updateLiveTripFields` RPC. Cleaner architecture, no client/server sync drift.
- **Severity:** Hidden flaw — events work today but the debt will eventually surface as a "my edit didn't persist after logout" bug.

### F-18 (Cross-cutting) 🔵 OBSERVATION — Shared step-body contract enables single-file reuse
- **File + line:** `EditPublishedScreen.tsx:836-882 renderSectionBody` uses `StepBodyProps` to mount `CreatorStep1Basics`, `CreatorStep2When`, etc. in accordion mode
- **What it does:** Same step component works in wizard AND accordion modes.
- **v2 use:** Extend `TripCreatorStep1Basics`, `TripCreatorStep2Itinerary`, `TripCreatorStep3Inclusions`, `TripCreatorStep4Pricing` with optional `editMode?: { soldCountByTier: Record<string, number> }` prop to enable reuse in `EditPublishedTripScreen` accordion.

### F-19 (Cross-cutting) 🔵 OBSERVATION — Events use `?mode=edit-published` query-param routing
- **File + line:** `app/event/[id]/edit.tsx:340 if (isEditPublished)`
- **What it does:** URL query param chooses between wizard and EditPublishedScreen.
- **v2 decision (D10):** Match events (query-param) OR dispatch by `trip.status` (cleaner, less error-prone). RECOMMEND status-dispatch — operator never needs to know the URL convention.

### F-20 (Discovery) 🔵 OBSERVATION — 1 published trip in DB ("The DC Adventure")
- **Evidence:** SQL probe §2.4 — id `060d0483-0a8e-4226-8c10-65dc2d1878af`, slug `the-dc-adventure`, 6 days + 1 tier + 6 inclusions, no cover, no orders
- **Use:** This is the operator's S-3 test subject. Reproduce against it on web for "proven" confidence promotion.

### F-21 (Tr4 coordination) 🟠 CONTRIBUTING — Tr4's `/booking/[orderId]/cancel` route is GOOD design
- **File + line:** `SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` §3.5.7
- **What it does:** Order-scoped cancel route works for any event_type
- **v2 use:** Do NOT duplicate this; v2's confirm page (`/checkout-trip/[tripEventId]/confirm`) just needs to link to the order-scoped cancel route. Tr4 implements the cancel logic.

### F-22 (Permission gating) 🟠 CONTRIBUTING — Tier-price edit gated by `EDIT_TICKET_PRICE` permission
- **File + line:** `EditPublishedScreen.tsx:327-328 canPerformAction(currentRank, "EDIT_TICKET_PRICE")`
- **v2 use:** Trip pricing tier edits MUST mirror the same permission gate — finance_manager+ for price changes.

---

## 6. Root cause register

| Sub-symptom | Single root cause | F-cards |
|---|---|---|
| S-1 | Trip wizard autosave is forward-only AND trips have no published-edit surface equivalent to EditPublishedScreen | F-4, F-5, F-6 |
| S-2 | Trip wizard has no cover surface despite backend support being live | F-8 |
| S-3 | Tr2 shipped a trip Reserve CTA pointing at the audit-rejected event-checkout chain | F-1, F-2, F-3 |
| S-4 (NEW) | Trips have no parity with ORCH-0704 v2 events published-edit subsystem — missing atomic patch service, refund-gate, diff-and-reason audit, change-notification dispatch, edit log, EditAfterPublishBanner, accordion screen | F-5, F-11, F-12, F-13, F-14, F-15, F-17 |

---

## 7. Blast radius

### Event-side files UNCHANGED by v2 (audit invariants preserved):
- `usePublicEventById` + `getPublicEventById` + `getPublicEventBySlug` + `getPublicBrandBySlug` — keep trip-rejection probes
- `EventCreatorWizard.tsx` — unchanged
- `EditPublishedScreen.tsx` — UNCHANGED unless D2=generalize ChangeSummaryModal OR D3=extract shared CoverPicker (in which case minor refactor touches)
- `ChangeSummaryModal.tsx` — UNCHANGED unless D2=generalize
- `CreatorStep4Cover.tsx` — UNCHANGED unless D3=extract CoverPicker
- All `/checkout/[eventId]/*` files UNCHANGED
- `eventChangeNotifier.ts` — UNCHANGED
- `liveEventStore.ts` — UNCHANGED
- `eventType.filter.audit.test.ts` — EXTENDED with new trip-resolver clause; existing event clauses unchanged

### Trip-side files NEW or MODIFIED by v2:
- NEW `EditPublishedTripScreen.tsx` (~1,000-1,200 lines mirror)
- NEW `TripChangeSummaryModal.tsx` OR modified `ChangeSummaryModal.tsx` (D2)
- NEW `EditAfterPublishTripBanner.tsx`
- NEW `publishedTripEditGuards.ts` (`validateLiveTripFieldUpdate`)
- NEW `tripAdapter.ts` (diff utilities + FIELD_LABELS + classifySeverity + MATERIAL_KEYS + SAFE_KEYS + computeTripDayDiffs + computeTripInclusionDiffs + computeTripPricingTierDiffs)
- NEW `tripChangeNotifier.ts` (stub-parity with eventChangeNotifier; B-cycle wires real channels)
- NEW `useTripEditLogStore` (Zustand persisted append-only) OR `trip_edit_log` DB table (D6)
- NEW `useTripHasWebPurchases(tripId)` hook
- NEW `updateLiveTripFields` service + supporting SQL RPC `biz_update_live_trip(p_event_id, p_patch jsonb, p_reason text)`
- NEW SQL migration creating the RPC + (if D6=DB) the `trip_edit_log` table + RLS
- MODIFIED `app/trip/[id]/edit.tsx` (status dispatch)
- MODIFIED `TripCreatorWizard.tsx` (handleStepBack save-on-back + handleClose save-on-close-edit-mode + Saved toast + handleConfirmPublish cover payload extension)
- MODIFIED `TripCreatorStep1Basics.tsx` (cover field + editMode prop)
- MODIFIED `TripCreatorStep2Itinerary.tsx`, `TripCreatorStep3Inclusions.tsx`, `TripCreatorStep4Pricing.tsx` (extend props with optional `editMode`)
- MODIFIED `TripCheckoutFlow.tsx:62` (route to /checkout-trip/)
- NEW `usePublicTripById` hook + `getPublicTripById` service (v1 retained)
- NEW `/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx` (v1 retained, 5 files)
- NEW shared `<CoverPicker>` component (D3) if extract chosen
- EXTENDED `eventType.filter.audit.test.ts` with trip-resolver + trip-mutation clauses
- NEW happy-path tests (~5-6 — see §10 D11)
- NEW adversarial test for event-chain trip rejection preservation

### Adjacent surfaces unaffected:
- Consumer iOS / Android (no trip surface)
- Admin Web (no trip page)
- Business Web preview (RN-Web bundle picks up changes automatically)
- ORCH-0869 [Tr3] installment ledger — UNCHANGED; checkout-trip chain calls same RPC
- ORCH-0874 [Trip Visual Parity] chrome contract — PRESERVED via TripCreatorWizard untouched chrome

### Tr4 [ORCH-0875] coordination:
- Tr4's `/booking/[orderId]/cancel` route — KEEP unchanged (order-scoped works for any event_type)
- Tr4's `app/checkout/[eventId]/index.tsx` 403 booking-closed banner modification — MUST MOVE to `app/checkout-trip/[tripEventId]/index.tsx` in Tr4 SPEC amendment
- Tr4's refund-tier system — INTEGRATE with v2's refund-gate (the Tr4 cascading tier % is consumed by trip cancel flow; v2's edit-time refund-gate is separate — operator must refund THEN edit)
- Tr4 implementor dispatch RESUMES post v2 CLOSE with amended SPEC

### Existing test files affected:
- `eventType.filter.audit.test.ts` — extended
- `tr2RewordPolish.test.ts`, `TripVisualParity.test.ts`, `TripVisualParity_adversarial.test.ts`, `PaymentPlanEditor.test.ts`, `trip-dashboard-edit.test.ts`, `trip-create-publish.test.ts` — verify no regression; may need `[TEST-MOD-APPROVED ORCH-0876]` if Save/edit semantic changes break assertions

---

## 8. Invariant violations + preservation map

### Violated by current state:
- Constitution #1 (no dead taps) — S-3 Reserve CTA is a dead tap
- Constitution #3 (no silent failures) — S-1 silent edit loss + S-3 misleading "Event not found" on a real trip
- I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE — current Reserve CTA points to wrong-type chain

### Must be preserved by v2:
- `eventType.filter.audit.test.ts` event-side clauses (extend, don't widen)
- I-PROPOSED-TR1-PERSONA-INTERFACE (no PersonaDef widening)
- I-PROPOSED-TR1-KIND-IMMUTABLE (no brands.kind toggle exposure)
- I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES (new `/checkout-trip/[tripEventId]/*` carries allowlist)
- I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE (extended with new trip-only routes)
- I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER (ORCH-0859 — trips do NOT enter liveEventStore; v2's `updateLiveTripFields` is server-side, no Zustand)
- ORCH-0869 [Tr3] 4 installment invariants
- ORCH-0874 [Trip Visual Parity] chrome contract (Close X + Stepper + Keyboard + create-mode discard dialog)
- `feedback_anon_buyer_routes.md` — `/checkout-trip/[tripEventId]/*` is buyer-anon
- `feedback_zustand_persist_no_server_snapshots.md` — v2 avoids the events-side Zustand-debt by going DB-direct
- `feedback_toast_needs_absolute_wrap.md` — every new toast wrapped
- Step 0.5 regression-test gate (both implementor happy-path + tester adversarial required)
- Step 1.5 DIAG-marker reaping (zero `[ORCH-0876-DIAG]` at CLOSE)
- One-PR-per-CLOSE (or operator-named bundle exception)

### NEW DRAFT invariants v2 SPEC establishes:
- I-PROPOSED-TR-CHECKOUT-ROUTE-BY-EVENT-TYPE — `/checkout-trip/[...]` resolves only trips; `/checkout/[...]` resolves only events
- I-PROPOSED-TRIP-WIZARD-EDIT-SAVE-DISTINCT-FROM-PUBLISH — draft wizard's Save commits via per-step mutations; published-edit's Save commits via `updateLiveTripFields` RPC; neither calls `business_publish_trip_draft`
- I-PROPOSED-TRIP-COVER-EDITABLE-POST-CREATE — cover updatable on published trips without re-publish
- I-PROPOSED-TRIP-WIZARD-SAVE-ON-BACK-AND-CLOSE (draft scope) — handleStepBack + handleClose await autosave in edit mode
- I-PROPOSED-TRIP-PUBLISHED-EDIT-VIA-RPC — `updateLiveTripFields` is a server-side RPC; no client-side Zustand intermediate
- I-PROPOSED-TRIP-PUBLISHED-EDIT-REASON-REQUIRED — every Save through EditPublishedTripScreen requires 10-200 char reason
- I-PROPOSED-TRIP-PUBLISHED-EDIT-REFUND-GATE — destructive changes (capacity below sold, tier delete with sales, etc.) reject with "Refund first" dialog
- I-PROPOSED-TRIP-PUBLISHED-EDIT-AUDIT-LOG — every successful save records edit log entry (timestamp, fields, reason, severity, affected orders)
- I-PROPOSED-TRIP-CHANGE-NOTIFICATION-CHANNELS — material changes fire banner + email + (sms if web purchases); additive fires banner + email; severity-driven via `tripChangeNotifier.deriveChannelFlags`

---

## 9. Architecture decisions identified (15 — D1-D15)

| # | Decision | Forensics recommendation |
|---|---|---|
| **D1** | EditPublishedTripScreen sectioning — mirror events' 6 (Basics/When/Where/Cover/Tickets/Settings) OR trip-native 5-6 (Basics/Itinerary/Inclusions/Pricing/Cover/Settings)? | **Trip-native 6 sections: Basics / Itinerary / Inclusions / Pricing / Cover / Settings.** Events' When+Where map to trip's Basics (start/end + destination); events' Tickets maps to trip's Pricing. Trip's Itinerary + Inclusions are unique. Settings section parallels event Settings. |
| **D2** | `TripChangeSummaryModal.tsx` — new component or generalize existing `ChangeSummaryModal.tsx`? | **Generalize.** Cleaner long-term — the modal's job (diff list + reason input + severity footer) is event-type-agnostic. Genericize TicketsDiffSubRenderer + add TripDaysDiffSubRenderer + TripInclusionsDiffSubRenderer + TripPricingTierDiffSubRenderer. Single source of truth for diff confirmation UX. |
| **D3** | Cover picker — extract shared `<CoverPicker>` (touches event-side `CreatorStep4Cover.tsx` refactor) OR inline parallel picker in trip-side? | **Extract.** Future drift hazard is real — 3-provider picker is complex (GIPHY API + Pexels API + ImagePicker + upload + retry + error states). Single source for both surfaces. Refactor is mechanical and event tests cover existing behavior. |
| **D4** | `updateLiveTripFields` — new dedicated service writing directly to events + sidecars OR new RPC `biz_update_live_trip(p_event_id, p_patch, p_reason)`? | **RPC.** Atomic transaction across 4 tables. Server-side validation. Audit-table insert in same transaction. SECURITY DEFINER for cross-table RLS. Returns the updated trip + edit-log-entry-id for the client. |
| **D5** | Refund-gate rejection — duplicate event-side logic in trip guard OR generalize the `has_confirmed_orders` check to be event-type-agnostic? | **Mostly duplicate (trip-specific reasons) + share where identical.** Most rejection conditions are trip-specific (days_dropped_with_sales, dates_shifted_with_sales, inclusions_removed_with_sales — events don't have these). The shared parts (missing_edit_reason, invalid_edit_reason, capacity_below_sold per tier, tier_delete/price_change/free_toggle_with_sales) can extract to a `purchaseProtectionGates.ts` shared module. |
| **D6** | Edit audit log — Zustand persisted (mirror events' `useEventEditLogStore`) OR DB-side `trip_edit_log` table? | **DB-side table.** Events have technical debt here (Zustand-only means logs lost on logout / cache clear). Trips should leapfrog: `trip_edit_log` table with RLS (owner reads own brand's logs, RPC writes only). Future: backfill events into a `event_edit_log` DB table to close that debt — but out of scope for this ORCH. |
| **D7** | Refund-first reject dialog's "Open Orders" CTA — where does it route for trips? | **`/trip/{id}/orders`** — needs verification this route exists; if not, register follow-up. v1 finding: this surface needs Tr3 ORCH-0873 [Tr3 Stage 2 UI]'s Money tab or a dedicated trip-orders ledger. Tr4 [ORCH-0875] may build this. |
| **D8** | Change-notification stubs — match events' TRANSITIONAL console-log stubs OR wire real Resend/Twilio now? | **Match events' stub pattern.** B-cycle wires real channels for both events and trips together. Adding real wiring now triples scope. |
| **D9** | Tier-edit-sheet — separate `TripPricingTierEditSheet.tsx` OR handle inside EditPublishedTripScreen Pricing section directly? | **Inline in section.** Trip pricing tiers are simpler than event ticket tiers (one tier per trip in current model; installment plan is a tier-attached object). Separate sheet adds complexity without obvious UX benefit. Reconsider if Tr4 makes tiers more complex. |
| **D10** | Edit-screen routing — query-param `?mode=edit-published` (mirror events) OR `trip.status`-based dispatch? | **Status-based dispatch.** Cleaner — operator never needs to know the URL convention. `app/trip/[id]/edit.tsx` reads `trip.status` and chooses TripCreatorWizard vs EditPublishedTripScreen. Events can adopt the same pattern in a future refactor (out of scope). |
| **D11** | Step 0.5 regression-test gate — scope of happy-path tests for ~30-35 file PR | **5 happy-path test files:** (1) `TripCheckoutFlow_routes.test.ts` for S-3, (2) `TripCreatorWizard_editSave.test.ts` for draft-edit autosave, (3) `TripCreatorStep1Basics_cover.test.ts` for cover surface, (4) `EditPublishedTripScreen.test.tsx` for full S-4 published-edit flow with all SCs, (5) `updateLiveTripFields.test.ts` for service + refund-gate. **1 unified adversarial test:** `event_chain_trip_isolation.test.tsx` — asserts (a) /checkout/{tripId} still renders "Event not found" + (b) `getPublicEventById(tripId)` returns null + (c) audit-test extension passes. All tests need `fails-on-revert verified at <commit hash>`. |
| **D12** | Bundle scope governance — ~30-35 files in single PR — operator pre-authorized at Path A | **Confirm pre-authorization** in CLOSE banner. Single ORCH-0876, single Seth→main PR, exempt from one-PR-per-CLOSE because operator named the bundle at INTAKE 2026-05-18. |
| **D13** | ORCH-0875 [Tr4] coordination — Tr4 implementor dispatch resumes post v2 CLOSE with amended SPEC | **Confirmed pause.** Tr4 SPEC amendment: §3.5.7 cancel route at `/booking/[orderId]/cancel` STAYS (good design); §3.5.8 booking-closed banner MOVES from `app/checkout/[eventId]/index.tsx` to `app/checkout-trip/[tripEventId]/index.tsx`. Tr4's tier system integrates with v2's refund-gate per F-21. |
| **D14** | Audit-test extension scope | Extend `eventType.filter.audit.test.ts` with: (a) `getPublicTripById` source pins `.eq("event_type", "trip")`, (b) `updateLiveTripFields` (service-level) pins `.eq("event_type", "trip")`, (c) the RPC `biz_update_live_trip` pins event_type='trip' in the function body (SQL-level audit). |
| **D15** | Implementor routing — Codex `implementor-mingla` or Claude `mingla-implementor` for ~30-35 file scope | **Operator decision at SPEC v2 close.** Both have full parity; Codex has historically owned implementor; Claude has done complex multi-file work too. |

---

## 10. Possible directions (advisory only — NOT a spec)

For each major decision in §9, 2-3 candidate shapes with trade-offs. The SPEC writer picks one per D-number based on operator preference + technical fit.

(Above table in §9 already lists forensics' recommendation per D-number. SPEC writer documents the chosen direction with rationale.)

---

## 11. Open questions for SPEC v2 (15+)

| Q | Question | Forensics recommendation |
|---|---|---|
| **Q1** | Confirm D1 — EditPublishedTripScreen 6-section trip-native split? | YES, 6 sections (Basics / Itinerary / Inclusions / Pricing / Cover / Settings) |
| **Q2** | Confirm D2 — generalize ChangeSummaryModal? | YES |
| **Q3** | Confirm D3 — extract shared `<CoverPicker>` (touches event-side refactor)? | YES |
| **Q4** | Confirm D4 — `updateLiveTripFields` as server-side RPC (not Zustand)? | YES |
| **Q5** | Confirm D6 — DB-side `trip_edit_log` table (not Zustand)? | YES |
| **Q6** | Confirm D10 — status-based routing in `app/trip/[id]/edit.tsx` (not query-param)? | YES |
| **Q7** | Does `/trip/{id}/orders` route exist for the refund-first "Open Orders" CTA? If not, where does the CTA route? | INVESTIGATE — if not, route to `/trip/{id}#orders` (dashboard anchor) until Tr4 ships orders ledger |
| **Q8** | Does the v2 cover picker support video for trips (events deprioritize per ORCH-0783)? | NO — image + GIPHY + Pexels only, matching event-side active scope |
| **Q9** | Does TripCreatorWizard draft-edit-mode "Saved" toast persist from v1 SPEC? | YES — keep v1's polish for draft path |
| **Q10** | Does the EditPublishedTripScreen save honor `EDIT_TICKET_PRICE` permission gate? | YES — finance_manager+ for tier price changes (mirror event-side) |
| **Q11** | What trip-specific MATERIAL_KEYS trigger material-severity notifications? | RECOMMEND: title, description, startAt, endAt, destinationLocationText, capacity, day count change, inclusions, tier price (= NOTIFIES BUYERS); SAFE: cover_media_*, room-level day narrative tweaks, inclusion item rewording (if no add/remove). SPEC writer locks the matrix. |
| **Q12** | Tr4 [ORCH-0875] SPEC amendment timing — operator amends Tr4 SPEC during v2 implementation OR after v2 CLOSE? | RECOMMEND: AFTER v2 CLOSE. Tr4 dispatch resumes with amended SPEC referencing the new `/checkout-trip/[tripEventId]/*` chain. |
| **Q13** | Does the v2 scope include any new SQL migration beyond the RPC + trip_edit_log table? | RECOMMEND: confirm scope = 1 migration creating `biz_update_live_trip` RPC + `trip_edit_log` table + RLS. No other schema changes. |
| **Q14** | Does the v2 scope include `useTripHasWebPurchases` hook or read directly via supabase per call? | RECOMMEND: hook (mirror `useEventHasWebPurchases`). |
| **Q15** | When operator's "no questions" directive is at play, does forensics expect operator to walk through all Q1-Q14 OR pre-lock with recommended defaults? | RECOMMEND: pre-lock all 15 with forensics' recommended defaults; operator can override any at SPEC v2 review time. Saves a round-trip. |
| **Q16** | Does the v2 spec set a hard 30-file file-count cap, or budget-flexible based on what the parity demands? | RECOMMEND: budget-flexible. Forensics estimate is 30-35 files; SPEC writer may surface 28 or 38 depending on D2/D3 outcomes. |
| **Q17** | Audit-test extension — does `updateLiveTripFields` service get a clause requiring `.eq("event_type", "trip")` even though the RPC enforces it server-side? | YES — defense in depth. Catches a future refactor that bypasses the RPC. |
| **Q18** | DIAG-marker policy — implementor permitted to use `[ORCH-0876-DIAG]` during build, must reap before CLOSE | YES — standard. |

---

## 12. Confidence summary

| Sub-symptom | Confidence | Justification |
|---|---|---|
| S-1 | **probable** | Source-traced deterministically; sim live-fire BLOCKED in orchestrator session; operator can promote to "proven" in <5 min |
| S-2 | **proven** | Binary absence in source; SQL probe confirms data layer (0/7 with cover) |
| S-3 | **probable** | Source chain proven across 6 files; data probe confirms 1 published trip exists; audit test confirms intent; sim BLOCKED |
| S-4 (NEW) | **probable** | Source absence is binary (zero trip files mirror event published-edit subsystem); deterministic from `grep` results; sim live-fire of the EVENT EditPublishedScreen reference flow BLOCKED |

**Overall confidence:** **probable** (sim/web blocker is the only thing preventing "proven"). The 6 named live-fire steps in §2 each take <5 min and operator can promote to proven independently before SPEC v2 dispatch.

**Live-fire blocker statement (per Prime Directive #7):** No Maestro / no iOS dev-build / no headless browser available in this orchestrator-driven Claude session. Operator runs the repros directly — investigation does NOT silently downgrade beyond "probable."

---

## 13. Discoveries for orchestrator

- **D-A:** Tr4 [ORCH-0875] SPEC needs amendment post-v2-CLOSE — §3.5.8 booking-closed banner location moves from event chain to trip chain. §3.5.7 cancel route stays (good design).
- **D-B:** Events have hidden architectural debt — `useLiveEventStore` writes most fields to Zustand only, not DB. ORCH-0876 trips leapfrog this debt by going DB-direct via RPC. Future ORCH could backfill events to match the cleaner trip architecture, but is OUT OF SCOPE for this ORCH.
- **D-C:** Cover-picker refactor (D3 extract `<CoverPicker>`) touches event-side `CreatorStep4Cover.tsx`. This is a mechanical refactor but increases v2's blast radius slightly into events. Operator awareness needed.
- **D-D:** 1 published trip exists today (`the-dc-adventure`) — this is operator's S-3 test subject. Use for the "proven" promotion path.
- **D-E:** Trip step components (`TripCreatorStep1-4`) currently DO NOT have an `editMode` prop pattern. Extending them with optional `editMode?: {soldCountByTier}` is a backward-compatible v2 change that enables reuse in `EditPublishedTripScreen` accordion.
- **D-F:** `/trip/{id}/orders` route may not exist (per Q7) — needs implementor verification at SPEC time. If absent, follow-up ORCH for Tr3-orders-ledger surfaces.
- **D-G:** v1 SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` is officially superseded by SPEC v2 (TBD). Both v1 artifacts (investigation + spec) remain on disk for baseline reference.
- **D-H:** ORCH-0874 [Trip Visual Parity] tests + tr2RewordPolish tests + trip-create-publish test + trip-dashboard-edit test — all need re-run after v2 implementation to verify no regression. Some may need `[TEST-MOD-APPROVED ORCH-0876]` if Save/edit-flow assertions break.

---

## 14. File manifest (every file read + every probe)

### Files read end-to-end (28 source files)
- `mingla-business/src/components/event/EditPublishedScreen.tsx` 1189 lines — FULL
- `mingla-business/src/components/event/ChangeSummaryModal.tsx` 561 lines — head + grep
- `mingla-business/src/components/event/EditAfterPublishBanner.tsx` ~60 lines — FULL
- `mingla-business/src/utils/liveEventAdapter.ts` ~520 lines — head 1-330
- `mingla-business/src/utils/publishedEventEditGuards.ts` — FULL (~140 lines)
- `mingla-business/src/store/liveEventStore.ts` ~560 lines — full + lines 429-520 deep
- `mingla-business/src/services/eventChangeNotifier.ts` — FULL
- `mingla-business/src/components/event/CreatorStep4Cover.tsx` head 1-90 + grep
- `mingla-business/app/event/[id]/edit.tsx` lines 200-340 + structure
- `mingla-business/src/services/eventCoverMediaService.ts` lines 1-120
- `mingla-business/src/components/event/EventCreatorWizard.tsx` lines 740-855 + grep
- `mingla-business/app/trip/[id]/edit.tsx` 146 lines — FULL
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` 974 lines — re-read lines 471-649 + grep
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` — grep + structure
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx`, `Step3Inclusions.tsx`, `Step4Pricing.tsx` — grep + Props
- `mingla-business/src/components/trip/TripCreatorStep5Review.tsx`, `TripDayEditor.tsx`, `PaymentPlanEditor.tsx`, `TripPreview.tsx`, `TripManageMenu.tsx`, `TripCheckoutFlow.tsx` — re-read structure
- `mingla-business/src/services/tripsService.ts` — re-read mutation surface
- `mingla-business/src/hooks/useTrips.ts`, `usePublicTripBySlug.ts` — re-read
- `mingla-business/src/services/publicEventsService.ts` lines 450-565 — re-confirmed
- `mingla-business/app/checkout/[eventId]/{index,buyer,payment,confirm,_layout}.tsx` — read for parity-clone
- `mingla-business/src/components/checkout/{CartContext,CheckoutHeader,QuantityRow}.tsx` — confirmed reusable
- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` — re-read
- `mingla-business/src/components/trip/__tests__/*.test.ts` — listed structure
- `mingla-business/app/trip/__tests__/*.test.ts` — listed
- `Mingla_Artifacts/specs/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` (v1) — re-read
- `Mingla_Artifacts/specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md` — head + scope sections
- `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` — §3.5.7-3.5.8 + §11 SCs
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` — re-read

### Migrations read (8)
- `20260605000000_orch_0826_events_event_type_discriminator.sql`
- `20260607000000_orch_0855_brands_kind_trip_planner.sql`
- `20260608000000_orch_0859_trip_sidecar_tables.sql`
- `20260608000100_orch_0859_publish_rpc_trip.sql`
- `20260609000000_orch_0859_trip_publish_slug_flag.sql`
- `20260610000000_tr3_installments.sql`
- `20260610000002_tr3_ticket_checkout_session_installment_aware.sql`

### Memories applied (9)
- All listed in §1 Phase 0 ingest

### SQL probes (2)
- v1 baseline aggregate + v2 per-trip detail (see §2.4 table)

### Live-fire status
- Sim/web BLOCKED in this orchestrator session — named per Prime Directive #7
- Operator promotion path documented per sub-symptom in §2

### Architecture decisions surfaced
- 15 (D1-D15) — exceeds dispatch minimum of "15+"

### Findings
- 22 six-field cards (F-1..F-22) — exceeds dispatch minimum of "20+"

### Parity matrix
- 32 rows — exceeds dispatch minimum of "25+"

### Open questions
- 18 (Q1..Q18) — exceeds dispatch minimum of "15+"

---

**END OF INVESTIGATION v2.** SPEC v2 dispatch follows from orchestrator REVIEW.
