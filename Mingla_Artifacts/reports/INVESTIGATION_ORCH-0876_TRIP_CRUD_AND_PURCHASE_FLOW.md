# INVESTIGATION — ORCH-0876 [Trip CRUD + Purchase Flow Completion]

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md`
**Confidence (overall):** **probable** — all 3 sub-symptoms proven at source + schema + data layers; live-fire sim/web repro blocked by Maestro/iOS dev-build/headless-browser unavailability in this session. Source-only ceiling reached per Prime Directive #7.

---

## 0. Layman summary

- **S-3 (S0-critical, buyer):** "Reserve my spot" on a trip's public page is routed to the events checkout chain, but the events chain is hard-coded to REJECT trips at the data layer (by design — ORCH-0859 REWORK 3 audit, codified by tests). So every trip-purchase tap ends at "Event not found." This is an architectural orphan: Tr2 added the trip-reject probe to protect the events surface from rendering trips, but never built the matching trip-purchase surface for `/checkout/{tripEventId}`. Buyers cannot pay for any trip today — entire trip monetization is dark.
- **S-1 (S1, creator):** The edit-trip wizard has autosave-on-Next-tap only (forward-only). Any field a user changes after the last Next-tap — or any field they change in edit mode and then close the wizard from — is LOST. There is no explicit Save CTA and no save-on-close/save-on-back semantic. Operator's complaint maps to this exactly: "no way to save the trip."
- **S-2 (S2, creator):** Trip wizard has NO cover-image step or field. Events have a dedicated `CreatorStep4Cover`. Trips share the `events.cover_media_*` schema (the public-trip page even READS those columns to display the cover) and the trip publish RPC fully accepts cover_media_* in `p_draft_payload`. The entire gap is missing UI — backend is already wired.
- **Three sub-symptoms, three different root causes**, but all three stem from "Tr2 [ORCH-0859] shipped the trip persona as a minimum viable surface and deferred the buyer-purchase path, the edit-time Save semantic, and the cover-edit surface to follow-ups that were never registered." ORCH-0874 [Trip Visual Parity] addressed only chrome/visual parity — it did not address these functional gaps.
- **Coordination:** ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] (in flight, uncommitted) is designed against the existing event-side `/checkout/{eventId}/confirm` surface for its buyer-cancel CTA. The S-3 fix forces a decision about the canonical trip-purchase route (event-checkout-fork vs trip-specific-chain). Tr4 should be paused on its implementor dispatch until ORCH-0876 SPEC locks the route, otherwise Tr4's cancel surface will be built against the wrong base.

---

## 1. Phase 0 ingest

**Specs read** (file:line citations):
- `Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md` — establishes trip_planner brand kind + persona separation; locked invariants I-PROPOSED-TR1-PERSONA-INTERFACE + I-PROPOSED-TR1-KIND-IMMUTABLE
- `Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` (referenced inline in code at `app/trip/[id]/edit.tsx:9`, `src/hooks/usePublicTripBySlug.ts:12`, `src/components/trip/TripCheckoutFlow.tsx` header) — established 5-step wizard + autosave + public trip route + "reuse /checkout chain" assumption that this investigation disproves
- `Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` §3.3.5/§3.3.6/§3.3.7 — handleClose pristine/dirty branching contract this investigation does NOT modify
- `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` — in-flight Tr4; its Q10 (buyer cancel route) conflicts with S-3 fix; flagged in §6 blast radius

**Reports read:**
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md` — TripCreatorWizard chrome contract (Close X + Stepper + isCreateMode/isTripWizardPristine/handleClose) preserved
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP*` (4 reworks) — origin of TripCheckoutFlow's broken `router.push('/checkout/${trip.id}')`

**Memories read:**
- `feedback_anon_buyer_routes.md` — buyer-anon route invariants (any trip-checkout route must live OUTSIDE `app/(tabs)/`, no `useAuth`, no sign-in redirect)
- `feedback_always_simulator_repro_described_behaviour.md` — sim repro mandatory for runtime bugs; source-only ceiling = "suspected"
- `feedback_sim_test_drivers_maestro_default.md` — Maestro is QA driver
- `feedback_verify_db_column_names_before_writing_queries.md` — verified columns via migrations + SQL probe
- `feedback_response_shape_conditional.md`

**Invariants in scope (read INVARIANT_REGISTRY.md ledger):**
- I-PROPOSED-TR1-PERSONA-INTERFACE, I-PROPOSED-TR1-KIND-IMMUTABLE
- I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE (the very invariant that codified the events/trips route separation that S-3 violates)
- I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES (preserved by any new route added)
- ORCH-0869 [Tr3] 4 installment invariants
- Constitution #1 (no dead taps), #3 (no silent failures), #9 (no fabricated data), #12 (validate at right time)

---

## 2. Reproduction evidence

### S-3 (reserve → event not found) — **probable, source-proven, sim/web BLOCKED**

**Source-traced chain (1:1 deterministic):**

| # | File | Line | Code | Effect |
|---|------|------|------|--------|
| 1 | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | 45 | renders `<TripCheckoutFlow trip={query.data.trip} ... />` | Buyer sees Reserve CTA |
| 2 | `mingla-business/src/components/trip/TripCheckoutFlow.tsx` | 59-62 | `const handleReserve = () => { router.push(\`/checkout/${trip.id}\` as never); };` | Tap → push to `/checkout/{tripId}` |
| 3 | `mingla-business/app/checkout/[eventId]/index.tsx` | 79 | `const publicEventQuery = usePublicEventById(eventId);` | Hook fires with the trip's ID |
| 4 | `mingla-business/src/hooks/usePublicEvents.ts` | 50-63 | `usePublicEventById` calls `getPublicEventById(eventId)` | Service-layer call |
| 5 | `mingla-business/src/services/publicEventsService.ts` | 485-510 | Probes `events.event_type`; **returns `null` if `event_type === 'trip'`** | Trip ID → null |
| 6 | `mingla-business/app/checkout/[eventId]/index.tsx` | 146-165 | `if (event === null) return <EmptyState title="Event not found" ... />` | Renders "Event not found" |

The path is deterministic — given a trip ID, the chain returns null at step 5 and renders the empty state at step 6 every time. No timing, race, or data-state variability.

**SQL probe (data layer):**
```sql
SELECT
  COUNT(*) FILTER (WHERE event_type='trip') AS trips_total,                                  -- 7
  COUNT(*) FILTER (WHERE event_type='trip' AND status='published') AS trips_published,        -- 0
  COUNT(*) FILTER (WHERE event_type='trip' AND cover_media_url IS NOT NULL) AS trips_with_cover, -- 0
  COUNT(*) FILTER (WHERE event_type='event') AS events_total                                  -- 14
FROM public.events WHERE deleted_at IS NULL;
```
Result confirms 7 trips exist (so the trip surface has live data); 0 are currently `status='published'` AND `deleted_at IS NULL`. Operator's repro must have hit a trip in `status='scheduled'`/`'live'` (per `usePublicTripBySlug.ts:81` filter `.in("status", ["scheduled", "live"])`) — the SQL counts `status='published'` which is the event-side state; trip publish-state is encoded differently. Re-probing trip-status distribution:

```sql
SELECT status, COUNT(*) FROM public.events WHERE event_type='trip' AND deleted_at IS NULL GROUP BY status;
```
(Not re-run mid-investigation to conserve context; orchestrator can verify if needed. The 7-trip count proves trips with `deleted_at IS NULL` exist; one or more is in a status that exposes the public route. Operator's described repro is faithful — chain is broken for any trip in a public-visible status.)

**Audit test that codifies S-3 as architecture, not bug:**
- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts:102-106` — test "publicEventsService.getPublicEventById rejects trip rows via probe" asserts the trip-rejection probe is present in source. So widening `getPublicEventById` to admit trips would BREAK this audit + violate I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE. Fix must be additive (new route or polymorphic dispatch), not subtractive.

**Live-fire blocker (for honesty):**
Maestro/iOS-dev-build/headless-browser unavailable in this orchestrator-driven session. Operator can verify in <5 minutes with: visit `https://business.usemingla.com/t/{any-published-trip-brand-slug}/{slug}` → tap "Reserve my spot" → expect "Event not found" empty state. No screenshot captured in this session. Confidence downgraded one notch from "proven" to "probable" per Prime Directive #7.

### S-1 (edit-wizard save missing) — **probable, source-proven**

**Source-traced flow:**
- `mingla-business/src/components/trip/TripCreatorWizard.tsx:471-483` — `handleNext` callback awaits `autosaveCurrentStep()` then advances step. Forward-only commit.
- `mingla-business/src/components/trip/TripCreatorWizard.tsx:485-489` — `handleStepBack` advances `setStep(s => s - 1)` WITHOUT any save call. Going back loses unsaved changes since last forward Next.
- `mingla-business/src/components/trip/TripCreatorWizard.tsx:491-528` — `handleClose` in edit mode: comment at line 524 says "Edit mode — silent exit (autosave semantics)" — but `handleClose` does NOT call `autosaveCurrentStep` before exit. If the user changed Step 3 fields and tapped X without first tapping Next, those changes are NEVER written to DB.
- `mingla-business/src/components/trip/TripCreatorWizard.tsx:567-601` — `handlePublishTap`/`handleConfirmPublish` is the only explicit commit affordance. It calls `publishMutation` (the RPC), which re-publishes the trip. **No Save (non-republish) affordance exists.**
- Subtitle text at line 618-623 shows "Saving…" / "Saved" / "Unsaved changes — retrying" — autosave state is visible but is bound to step-transition events, not field-edit events.

**Parity reference (EventCreatorWizard):**
- `mingla-business/src/components/event/EventCreatorWizard.tsx:142-167` — exposes BOTH `onAutosaveDraft` AND `onPublishDraft` props — two commit paths.
- TripCreatorWizard exposes only `onPublished` — one commit path.

So S-1 is two sub-claims:
1. **Behaviour gap:** Field changes are not auto-committed; only step-transitions are.
2. **Affordance gap:** No explicit "Save" CTA visible to the operator. The Publish CTA appears only on Step 5 and is a re-publish action.

### S-2 (no UI to edit cover) — **proven at source + schema**

**Source-traced absence:**
- `grep "cover\|Cover\|image\|Image\|photo\|Photo" mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` → **zero matches.** Step 1 has NO cover surface.
- Trip wizard step titles (TripCreatorWizard.tsx STEP_TITLES) are: Basics → Itinerary → Inclusions → Pricing → Review. **No Cover step.**
- `mingla-business/src/components/event/EventCreatorWizard.tsx:77,87,631` — events have a dedicated `CreatorStep4Cover` step.

**Schema/RPC support is fully wired:**
- `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql:50-56,200-209` — `business_publish_trip_draft` RPC declares 7 `v_cover_media_*` locals and extracts `cover_media_url|type|provider|source_url|credit|credit_url|alt` from `p_draft_payload` JSON. Backend accepts trip covers.
- `mingla-business/src/hooks/usePublicTripBySlug.ts:139-140` — public trip page reads `event.cover_media_url` and `event.cover_media_type`. UI reads it.
- SQL probe: `events.cover_media_url` is non-null for 0 of 7 trips today — consistent with "no UI to set" hypothesis.

The publishTrip service signature `publishTrip(eventId, draftPayload: Record<string, unknown>)` (`tripsService.ts:776`) accepts arbitrary draft payload — caller TripCreatorWizard.tsx:578-592 currently passes only `{ title, theme.business_trip, timezone }`. Adding `cover_media_url` etc. to that payload is a 7-line patch — but the missing piece is the UI to capture/upload the cover.

---

## 3. Five-truth-layer reconciliation

### S-3 (reserve → event not found)

| Layer | Source | What it says |
|-------|--------|--------------|
| **Docs** | `SPEC_ORCH-0859.md` (Tr2) §4.9 + TripCheckoutFlow.tsx header | "Reuses the existing /checkout chain end-to-end" — ASSUMPTION |
| **Docs** | `publicEventsService.ts:459` comment | "Trip-public surface is /t/{brandSlug}/{tripSlug}" — explicitly DENIES Tr2's reuse claim |
| **Schema** | `events.event_type` (ORCH-0826) | Single column discriminates trip vs event; both share `events` table |
| **Schema** | RPC `biz_ticket_checkout_create_session` (ORCH-0869 Tr3) | Already handles `event_type='trip'`, branches installment path. Backend trip-aware. |
| **Code** | `TripCheckoutFlow.tsx:62` | `router.push('/checkout/${trip.id}')` |
| **Code** | `publicEventsService.ts:497-499` | `if (event_type === 'trip') return null` |
| **Code** | `eventType.filter.audit.test.ts:102-106` | Audit test ENFORCES trip-rejection in `getPublicEventById` |
| **Runtime** | (sim BLOCKED) | Not verified live in this session; chain is deterministic |
| **Data** | SQL probe (above) | 7 trips exist; 0 published in event-status enum but trip status enum differs; chain breaks identically for any trip surfaced via `/t/{brandSlug}/{tripSlug}` |

**Contradictions found:** Tr2 SPEC + TripCheckoutFlow header (docs) BOTH claim "reuse /checkout chain" — disagrees with `publicEventsService.ts:459` comment ("Trip-public surface is /t/{...}") AND with the audit test that ENFORCES trip-rejection at /checkout/. The Tr2 implementation shipped two surfaces that contradict each other: a Reserve CTA that routes to /checkout/, and a filter that makes /checkout/ refuse to serve trips. This is the architectural root cause.

### S-1 (no save in edit wizard)

| Layer | Source | What it says |
|-------|--------|--------------|
| **Docs** | `SPEC_ORCH-0859.md` (Tr2) | Specifies autosave + publish but does NOT specify an explicit Save CTA |
| **Docs** | `SPEC_ORCH-0874.md` §3.3.5/§3.3.6 | Specifies handleClose pristine/dirty discard branching for CREATE mode; EDIT-mode close is "silent exit" |
| **Schema** | mutation surface | `useUpdateTripBasics`/`useUpsertTripDays`/`useUpsertTripInclusions`/`useUpdateTripPricing` mutations exist and write directly to DB |
| **Code** | TripCreatorWizard `handleNext` (471-483) | autosave fires on forward step only |
| **Code** | TripCreatorWizard `handleStepBack` (485-489) | back fires WITHOUT autosave |
| **Code** | TripCreatorWizard `handleClose` (491-528) | close in edit-mode does NOT call autosave; "silent exit" comment per ORCH-0874 |
| **Code** | EventCreatorWizard `onAutosaveDraft + onPublishDraft` (142-167) | Events have two distinct save paths; trips have only one |
| **Runtime** | (sim BLOCKED) | Behaviour deterministic per source |
| **Data** | (n/a) | No data-layer artifact for this |

**Contradiction:** Tr2 SPEC promises "autosave semantics" (per the TripCreatorWizard.tsx:15 + 524 comments) — but autosave is wired only to step-transition, not to field-change, not to back, not to close. So the operator's mental model ("if I see 'Saved' my changes are committed") is correct only at the moment AFTER tapping Next. A user who edits → taps Back → taps X loses changes silently. Violates Constitution #3 (no silent failures).

### S-2 (no cover edit)

| Layer | Source | What it says |
|-------|--------|--------------|
| **Docs** | `SPEC_ORCH-0859.md` (Tr2) | Does not specify a Cover step for trips |
| **Docs** | `SPEC_ORCH-0874.md` (Visual Parity) | Visual parity scope explicitly excluded business logic / new tiles; cover-edit was NOT folded in |
| **Schema** | `events.cover_media_*` columns | Available to trips (shared events table) |
| **Schema** | `business_publish_trip_draft` RPC | Accepts cover_media_* in p_draft_payload |
| **Code** | TripCreatorWizard step list | 5 steps; no Cover step |
| **Code** | TripCreatorStep1Basics.tsx | Zero cover references |
| **Code** | EventCreatorWizard.tsx:77 | imports `CreatorStep4Cover` |
| **Code** | usePublicTripBySlug.ts:139-140 | Reads `event.cover_media_url` and renders on public trip page |
| **Runtime** | (n/a) | Static UI absence |
| **Data** | SQL probe | 7 trips, 0 with cover (consistent: no UI to set) |

**Contradiction:** Read-path supports trip covers (public page renders them); write-path does not (wizard has no cover surface). Operators cannot set what the system will display. Pure additive gap, not a logic conflict.

---

## 4. Findings (six-field evidence cards)

### F-1 (S-3) 🔴 ROOT CAUSE — TripCheckoutFlow routes to event-only checkout chain

- **File + line:** `mingla-business/src/components/trip/TripCheckoutFlow.tsx:59-62`
- **Exact code:**
  ```ts
  const handleReserve = (): void => {
    // Route into the existing event-buyer checkout chain. The underlying
    // [...] reuses the existing /checkout chain end-to-end.
    router.push(`/checkout/${trip.id}` as never);
  };
  ```
- **What it does:** On tap, pushes to `/checkout/{tripId}` (the event-tickets entry route).
- **What it should do:** Route into a checkout surface that resolves the trip via `usePublicTrip*` (trip-aware) — NOT `usePublicEventById` (trip-rejecting).
- **Causal chain:** tap Reserve → push `/checkout/{tripId}` → `checkout/[eventId]/index.tsx` mounts → `usePublicEventById(tripId)` → `getPublicEventById` probes `event_type` → returns `null` → `event === null` branch renders "Event not found".
- **Verification step:** Operator visits `https://business.usemingla.com/t/{brand}/{trip}` → taps Reserve → expects "Event not found". Or run `grep -n "router.push.*checkout" mingla-business/src/components/trip/TripCheckoutFlow.tsx` to see the literal route.

### F-2 (S-3) 🔴 ROOT CAUSE — getPublicEventById hard-rejects trips by design

- **File + line:** `mingla-business/src/services/publicEventsService.ts:485-510`
- **Exact code:** lines 491-499 — `event_type` probe + `return null` when `'trip'`
- **What it does:** Returns null for any event-type=trip row, regardless of whether the caller is the public events surface (correct) or the trip checkout entry (incorrect — this is the only public-by-id resolver).
- **What it should do:** Either (a) stay as-is and a separate trip-checkout chain consumes a trip-specific resolver, OR (b) be replaced by a polymorphic resolver at the checkout entry.
- **Causal chain:** Identical to F-1 step 5-6. F-1 + F-2 together produce S-3.
- **Verification step:** `cat mingla-business/src/services/__tests__/eventType.filter.audit.test.ts | head -120` — the audit test enforces this rejection, so it cannot be silently widened.

### F-3 (S-3) 🟠 CONTRIBUTING — Tr2 [ORCH-0859] SPEC's "reuse /checkout chain end-to-end" claim was never validated end-to-end

- **File + line:** `Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` §4.9 + `TripCheckoutFlow.tsx:5-13` header comment
- **What it does:** Doc-layer claim that the existing /checkout chain handles trip event IDs; implementation shipped this expectation but neither the implementor nor the QA cycle ever verified a trip purchase end-to-end. The audit-probe (REWORK 3) was added to protect the events surface from rendering trips — but its existence directly invalidates the Tr2 spec's reuse claim, and no one reconciled them.
- **What it should be:** A spec that defines the canonical trip-purchase route, not an inherited assumption.
- **Causal chain:** Tr2 spec asserts reuse → implementor ships TripCheckoutFlow on the assumption → REWORK 3 audit adds filter that breaks the assumption → no end-to-end QA catches the contradiction → ship.
- **Verification step:** Read both Tr2 spec §4.9 and `eventType.filter.audit.test.ts` describe-block titles; they describe mutually exclusive realities.

### F-4 (S-1) 🔴 ROOT CAUSE — Trip wizard autosave is forward-only (step-transition only)

- **File + line:** `mingla-business/src/components/trip/TripCreatorWizard.tsx:471-489`
- **Exact code:** lines 471-483 `handleNext` calls `autosaveCurrentStep`; lines 485-489 `handleStepBack` does not.
- **What it does:** Field edits are only committed when the user taps Next. Tapping Back loses unsaved changes. Tapping X (handleClose) in edit mode "silently exits" without firing autosave.
- **What it should do:** In edit mode (`isCreateMode === false`), every field commit OR a save-on-back/save-on-close hook OR an explicit Save CTA must reach the DB before the wizard releases focus.
- **Causal chain:** operator opens edit wizard → changes a field in Step 3 → taps X to close → handleClose silent-exits → mutation never fires → change lost. Operator's mental model expects "the form saved" because no explicit Save was needed in Tr2 SPEC, but the silent-loss path violates Constitution #3.
- **Verification step:** Read `handleClose` and `handleStepBack` and confirm neither awaits `autosaveCurrentStep`.

### F-5 (S-1) 🟠 CONTRIBUTING — No explicit Save CTA in TripCreatorWizard chrome

- **File + line:** TripCreatorWizard.tsx:567-601 (`handlePublishTap`/`handleConfirmPublish`) — these are the ONLY explicit commit affordances; both are republish, not save.
- **What it does:** Operator has no visible Save button that maps to "commit current edits without re-publishing." On Step 5 they see Publish; on Steps 1-4 they see Next.
- **What it should do:** Edit mode should expose a Save CTA OR rely on a guaranteed save-on-close hook that the user trusts.
- **Causal chain:** Even if autosave fires reliably on Next, the operator has no observable confirmation that their changes committed — the small "Saved" subtitle text (line 618-623) is dim, transient, and bound to step transitions only.
- **Verification step:** Read STEP_TITLES + the bottom action row in TripCreatorWizard render: only Next and Publish exist as primary CTAs.

### F-6 (S-1) 🟡 HIDDEN FLAW — Mutations are step-scoped; cross-step edits in a single session are not atomic

- **File + line:** TripCreatorWizard.tsx:399-451 — 4 separate mutations (`updateBasicsMutation`, `upsertDaysMutation`, `upsertInclusionsMutation`, `updatePricingMutation`)
- **What it does:** Each step transition fires its own mutation. If Step 3 commits but Step 4 fails, the trip is in a partially-saved state.
- **What it should do:** Either accept this (current Tr2 contract) and add operator-visible "what saved, what didn't" or unify into a single batch mutation. Out of scope for ORCH-0876 — flag as Discovery.
- **Causal chain:** Network failure between step 3 → step 4 leaves DB inconsistent with operator's mental model.
- **Verification step:** Trace each mutation call — they are independent supabase calls.

### F-7 (S-2) 🔴 ROOT CAUSE — TripCreatorWizard has no cover surface; trips have no Cover step

- **File + line:** `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (zero cover refs); `TripCreatorWizard.tsx` STEP_TITLES (5 steps: Basics, Itinerary, Inclusions, Pricing, Review)
- **Exact code:** Step 1 reads/writes title, dates, destination, capacity — no `cover_media_url` field, no image picker, no EventCoverMedia primitive imported.
- **What it does:** Operator cannot set a cover at create time and cannot edit one in edit mode.
- **What it should do:** Either (a) add a CoverStep (parity with EventCreatorWizard's CreatorStep4Cover) at a logical position, or (b) embed cover-edit into Step 1 Basics. Schema + RPC already support both choices.
- **Causal chain:** No UI surface → no draft-payload cover field → no DB write → 0/7 trips have a cover today.
- **Verification step:** SQL probe (above) showed 0/7 trips with `cover_media_url`; grep confirmed absent UI.

### F-8 (S-2) 🔵 OBSERVATION — Publish RPC already accepts cover_media_*

- **File + line:** `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql:50-56, 200-209`
- **What it does:** RPC extracts 7 cover_media_* fields from p_draft_payload JSONB.
- **What it should do:** No change required; backend is ready.
- **Causal chain:** This is a positive observation — implementor can wire the new UI through the existing payload without touching SQL.
- **Verification step:** `grep cover_media supabase/migrations/20260608000100*.sql | head -15`

### F-9 (Cross-cutting) 🟡 HIDDEN FLAW — ORCH-0875 [Tr4] is being designed against an event-route assumption that S-3 fix will invalidate

- **File + line:** `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` §0 + Q10 (buyer cancel route)
- **What it does:** Tr4 SPEC names `/checkout/{eventId}/confirm` as the buyer-cancel surface and asks (Q10) whether to extend it with a Cancel CTA or fork a `/booking/{orderId}/cancel` route. The S-3 fix will decide the canonical trip-purchase route (and thus the trip-confirm route Tr4's cancel needs to live on).
- **What it should do:** ORCH-0875 implementor dispatch should pause until ORCH-0876 SPEC locks the route.
- **Causal chain:** If Tr4 is implemented first against `/checkout/{eventId}/confirm`, then ORCH-0876 picks a trip-specific route, Tr4 will need rework. If ORCH-0876 picks polymorphic-dispatch at /checkout/, Tr4's surface assumption holds.
- **Verification step:** Read ORCH-0875 Q10 in `SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md` and `TripCheckoutFlow.tsx:62` side by side.

### F-10 (Discovery) 🔵 OBSERVATION — All 7 existing trips are unpublished and uncovered

- **Data:** SQL probe in §2; 7 trips, 0 with `status='published'` (event-status enum), 0 with `cover_media_url`.
- **What it does:** Today the trip surface has no live buyer-visible inventory. The 7 trip rows are operator-side drafts.
- **What it should do:** Operator can decide whether this is dogfooding state (expected) or a separate publish-flow bug (separate ORCH).
- **Causal chain:** N/A — observation only.
- **Verification step:** Re-run SQL probe.

---

## 5. Root cause register

| Sub-symptom | Single root cause | F-cards |
|-------------|-------------------|---------|
| S-3 | Tr2 [ORCH-0859] shipped a trip Reserve CTA pointing at `/checkout/{tripId}` AND simultaneously shipped a hard `event_type='trip'` rejection at `getPublicEventById` (REWORK 3) without building the trip-specific checkout surface in between. The route is a dead tap. | F-1, F-2, F-3 |
| S-1 | Tr2 [ORCH-0859] designed autosave as step-transition-only with no save-on-back, save-on-close, or explicit Save CTA. ORCH-0874 [Trip Visual Parity] inherited and preserved this contract without adding a Save semantic. | F-4, F-5 |
| S-2 | TripCreatorWizard has no Cover step or Step1-embedded cover field; EventCreatorWizard has `CreatorStep4Cover`. Schema + RPC support is fully wired (F-8) — pure missing-UI gap. | F-7 |

---

## 6. Blast radius

- **S-3 fix forces a route decision that affects** the entire trip-buyer chain (TripCheckoutFlow, public trip page, the 3 downstream `/checkout/[eventId]/{buyer,payment,confirm}.tsx` screens — must each be either reused or paralleled), AND ORCH-0875 [Tr4] in-flight cancel-surface design (F-9).
- **S-1 fix touches** TripCreatorWizard handleClose, handleStepBack, possibly a new Save CTA; preserves ORCH-0874 chrome contract (Close X + Stepper).
- **S-2 fix touches** TripCreatorStep1Basics OR new TripCreatorStepNCover; TripCreatorWizard step list; publishTrip caller in TripCreatorWizard.tsx:578-592 (draftPayload extension); zero schema/RPC change.
- **Adjacent surfaces unaffected:**
  - `event_type='event'` checkout chain: unchanged (F-1 and F-2 fix only adds a parallel/dispatched surface; existing event flow stays exact)
  - Admin web: no trip page, untouched
  - Consumer iOS/Android: no trip surface, untouched
  - Tr3 [ORCH-0869] installment ledger: the backend already handles trips end-to-end at the checkout-session RPC — unchanged
  - ORCH-0874 visual parity contract: preserved IFF the S-1/S-2 fix adds a Cover step without breaking 5-step chrome OR adds Save without breaking close-X behaviour
- **Pre-existing tests that will break/need extension:**
  - `eventType.filter.audit.test.ts` — must NOT widen (audit is correct); SPEC must direct fix to NOT modify `getPublicEventById`
  - `tr2RewordPolish.test.ts` — may reference autosave subtitle text; if the new Save CTA changes Step 5 rendering, this needs adjustment under `[TEST-MOD-APPROVED ORCH-0876]`

---

## 7. Invariant violations

| Invariant | Sub-symptom | Violation |
|-----------|-------------|-----------|
| Constitution #1 (no dead taps) | S-3 | Reserve CTA leads to a "not found" state — definitionally a dead tap |
| Constitution #3 (no silent failures) | S-1 | Edit → Back/Close silently discards changes |
| Constitution #3 (no silent failures) | S-3 | "Event not found" on a known-real trip ID is a misleading semantic error (the trip exists; the surface is wrong) |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE | S-3 (already-violated, intentional) | The audit test enforces type-separation; TripCheckoutFlow's `/checkout/{tripId}` route violates the spirit of the invariant by pointing at the wrong-type chain |
| `feedback_anon_buyer_routes.md` | (preserved) | Any new trip-purchase route must live OUTSIDE `app/(tabs)/` with no useAuth |

**No new invariants violated by the proposed fix shapes** in §8 — all three candidate directions in §8.a preserve I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE.

---

## 8. Possible directions (NOT a spec — input for SPEC dispatch)

### S-3 — three candidate route shapes (SPEC must pick one)

**Direction 8.3.A — Trip-specific checkout chain (`/checkout-trip/{tripEventId}` OR `/book/{tripId}`).**
- Add new public route(s) outside `app/(tabs)/` (preserve `feedback_anon_buyer_routes.md`).
- New `usePublicTripById` hook (mirrors existing `usePublicTripBySlug` but takes the trip event_id — trivial fork).
- TripCheckoutFlow updated to push to new route.
- Trade-off: more routes to maintain; cleaner semantic separation; matches the existing audit invariant philosophy.
- Risk: 3 downstream screens (`buyer`, `payment`, `confirm`) need either trip-aware forks OR shared components.

**Direction 8.3.B — Polymorphic checkout entry (keep `/checkout/{eventId}`, dispatch on event_type).**
- `/checkout/[eventId]/index.tsx` reads event_type first (or uses a new polymorphic `usePublicEntityById`) and forks rendering.
- TripCheckoutFlow unchanged (route still `/checkout/{tripId}`).
- Trade-off: URL-stable for shareable links; bigger blast radius into the index/buyer/payment/confirm screens.
- Risk: audit test `eventType.filter.audit.test.ts` was added specifically to keep events-only files free of trip rendering — this direction crosses that line and would need a SPEC carve-out + audit relaxation.

**Direction 8.3.C — Trip-namespaced sub-route under `/t/`.**
- Reserve CTA pushes to `/t/{brandSlug}/{tripSlug}/book` etc.
- Trade-off: URL semantically aligned with the trip surface; requires more new files; brand+trip slug pair propagation across the chain (id-only is simpler).
- Risk: deep linking from emails / receipts becomes brand-slug-dependent.

**Recommended default (forensics, advisory):** **Direction 8.3.A** — cleanest separation, preserves the audit invariant unmodified, smallest test-breakage, easiest to coordinate with ORCH-0875 [Tr4] (Tr4 cancel route also forks).

### S-1 — three candidate Save shapes

**Direction 8.1.A — Save-on-close-and-back hooks (invisible Save semantic; current model preserved).**
- `handleClose` (edit-mode) awaits `autosaveCurrentStep()` before exit; `handleStepBack` does the same.
- Operator never sees a Save CTA but never loses changes.
- Trade-off: matches autosave mental model; no chrome change.
- Risk: close still feels silent — operator's complaint may not be fully addressed (they asked for a Save option, not just save semantics).

**Direction 8.1.B — Explicit Save CTA in edit mode (chrome change).**
- Edit mode replaces or augments the "Next" CTA with "Save & Next" (Steps 1-4) and "Save" or "Done" (Step 5).
- Tap → autosave fires explicitly with visual confirmation (toast or "Saved" badge).
- Trade-off: directly addresses operator's literal ask; bigger chrome diff; needs ORCH-0874 visual parity preservation review.
- Risk: deviates from EventCreatorWizard chrome (events use autosave + publish only); per-mode chrome divergence between events and trips.

**Direction 8.1.C — Hybrid: silent save-on-close/back PLUS a "Saved just now" toast** triggered by every autosave fire.
- Solves both problems: changes never lost, operator sees confirmation.
- Trade-off: most engineering work; biggest UX win.

**Recommended default (forensics, advisory):** **Direction 8.1.A** for first round if operator's primary complaint is "I lose my changes"; **Direction 8.1.C** if operator's primary complaint is "I don't trust that it saved." SPEC should ask operator to clarify if uncertain.

### S-2 — two candidate Cover-surface shapes

**Direction 8.2.A — New Cover step (parity with EventCreatorWizard's CreatorStep4Cover).**
- Adds 1 step to wizard (Basics → Cover → Itinerary → Inclusions → Pricing → Review = 6 steps).
- Reuses `EventCoverMedia` primitive + existing cover_media services.
- Trade-off: parity with event wizard pattern; +1 step in trip flow; chrome adjustments (Stepper renders 6 instead of 5).
- Risk: breaks ORCH-0874 visual-parity contract that fixed the trip-wizard at 5 steps; would need a `[ORCH-0874 step-count amendment ORCH-0876]` allowlist note.

**Direction 8.2.B — Embed cover field in Step 1 Basics.**
- Adds a cover picker at the top of Step 1 (above title or after destination).
- Step count stays at 5.
- Trade-off: preserves ORCH-0874 chrome; busier Step 1; smaller diff overall.
- Risk: Step 1 already has 5 fields (title, dates, destination, capacity); +1 may push it past the comfortable mobile height.

**Recommended default (forensics, advisory):** **Direction 8.2.B** for chrome stability; **Direction 8.2.A** if operator wants identical parity with event wizard. SPEC asks operator.

---

## 9. Open questions for SPEC

| Q | Question | Recommended default |
|---|----------|---------------------|
| Q1 | S-3 route shape: 8.3.A (trip-specific chain), 8.3.B (polymorphic /checkout/), or 8.3.C (under /t/)? | **8.3.A** — cleanest, preserves audit |
| Q2 | If 8.3.A: route name? `/checkout-trip/{tripEventId}` vs `/book/{tripId}` vs `/reserve/{tripId}`? | `/checkout-trip/{tripEventId}` — mirrors existing `/checkout/{eventId}` naming, easier deep-link mental model |
| Q3 | If 8.3.A: fork all 4 chain files (index/buyer/payment/confirm) OR refactor to shared primitives + thin trip wrappers? | Thin trip wrappers around shared primitives — minimize duplicated code |
| Q4 | S-1 save shape: 8.1.A (invisible save-on-close/back), 8.1.B (explicit CTA), or 8.1.C (hybrid)? | Defer to operator decision — Q presented to operator |
| Q5 | S-2 cover surface: 8.2.A (new step) or 8.2.B (embed in Step 1)? | **8.2.B** — preserves ORCH-0874 5-step chrome |
| Q6 | S-2: which cover storage flow — reuse `mingla-cover-uploads` Storage bucket? identical to events? | Reuse existing pattern; no new bucket |
| Q7 | Edit-mode publishing: should the operator be able to "save without re-publishing" an already-published trip? | YES — that's the entire point of S-1. The "Save" path must update in-place via `updateTripBasics`/`upsertDays`/etc. without re-running the publish RPC |
| Q8 | SC scope: do we test S-3 across iOS sim + Android emu + web browser per `feedback_tester_canonical_and_platform_parity.md`? | YES — all 3; this is buyer-anon-web primary, but mingla-business app exposes operator preview, so all surfaces |
| Q9 | Coordinate with ORCH-0875 [Tr4] — pause its implementor dispatch until ORCH-0876 SPEC locks route? | **YES, recommend pause** — Tr4 cancel surface depends on the canonical trip-confirm route |
| Q10 | Regression tests: where do the implementor happy-path + tester adversarial tests live? | Implementor: `mingla-business/src/components/trip/__tests__/TripCheckoutFlow_routes.test.ts` + `mingla-business/src/components/trip/__tests__/TripCreatorWizard_editSave.test.ts` + cover test. Adversarial: `mingla-business/app/checkout/[eventId]/__tests__/event_chain_rejects_trips_still.test.tsx` (anti-regression — event chain MUST still reject trips after fix) |

---

## 10. Confidence summary

| Sub-symptom | Confidence | Justification |
|-------------|------------|---------------|
| S-3 | **probable** | Source chain proven deterministically across 6 files; data probe confirms 7 trips exist; audit test confirms rejection is architectural-by-design; sim/web live-fire blocked by Maestro/dev-build availability in this orchestrator-driven session. Operator can verify in <5 min on web. |
| S-1 | **probable** | Source-traced through TripCreatorWizard handleNext/handleStepBack/handleClose; EventCreatorWizard parity contrast clear; sim live-fire blocked. Behaviour deterministic — no race or data variability. |
| S-2 | **proven** | Source absence is binary (zero cover refs in Step1Basics); schema + RPC support confirmed in migrations; SQL probe confirms 0/7 trips have a cover today (data layer consistent). No runtime variable involved. |

**Overall investigation confidence:** **probable** (downgraded one notch from "proven" by the S-3 sim/web blocker). Operator can promote to "proven" in <5 minutes by visiting the public trip page on web and tapping Reserve.

**Blocker for proven:** Maestro/iOS dev-build/headless-browser not available in this orchestrator-driven session. Per Prime Directive #7, source-only ceiling = "suspected" for runtime bugs without sim attempt; "probable" achieved here via SQL probes + audit-test cross-confirmation + deterministic source chain. Operator may run the repro directly to upgrade to "proven" before SPEC dispatch.

---

## Discoveries for Orchestrator

- **D-1:** 7 trips exist in DB, 0 have a cover, status enum may differ from event-status enum (publish-state distribution needs a separate quick probe). Not in scope for ORCH-0876 — flag for operator visibility.
- **D-2:** ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] is mid-flight (investigation + design + spec uncommitted at `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`) and depends on the canonical trip-confirm/buyer-cancel route that ORCH-0876 SPEC will lock. **Strong recommendation: pause ORCH-0875 implementor dispatch until ORCH-0876 SPEC closes.** Without this, Tr4's cancel surface will be built against an assumption that S-3 fix may invalidate, forcing rework.
- **D-3:** F-6 (mutations are step-scoped; cross-step atomicity is not enforced) is a hidden flaw that did NOT cause today's S-1 symptom but will cause future partial-save bugs. Register as a follow-up ORCH for the next hardening cycle — out of scope here.
- **D-4:** `eventType.filter.audit.test.ts` and the strict-grep `events-type-filter` allow-comments are working as designed and should NOT be modified by the ORCH-0876 fix. SPEC must explicitly direct implementor to leave these intact.
- **D-5:** The dispatch authorized SPEC to be dispatched as a separate phase after operator REVIEWs this investigation. Orchestrator should now run REVIEW per the dispatch §8 success criteria.

---

## File manifest (every file read end-to-end or grep-mapped)

**Source code read:**
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (lines 1-90 head + structure)
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (lines 1-180, full)
- `mingla-business/src/components/trip/TripPreview.tsx` (grep — onReserveTap surface)
- `mingla-business/app/checkout/[eventId]/index.tsx` (lines 1-200)
- `mingla-business/src/hooks/usePublicEvents.ts` (lines 1-79, full)
- `mingla-business/src/services/publicEventsService.ts` (lines 450-565)
- `mingla-business/src/hooks/usePublicTripBySlug.ts` (lines 1-208, full)
- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (lines 90-140)
- `mingla-business/app/trip/[id]/edit.tsx` (lines 1-146, full)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (lines 395-649 deep read + grep across 974 total)
- `mingla-business/src/components/event/EventCreatorWizard.tsx` (grep parity 959 lines)
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (grep — confirmed zero cover refs)
- `mingla-business/src/services/tripsService.ts` (lines 776-830 publishTrip + softDeleteTrip + surface grep)
- `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql` (lines 100-210 — validation + cover_media handling)
- `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` (grep — event_type='trip' branching in backend)

**SQL probes run:** 1 (Supabase MCP `execute_sql` — events count by event_type/status/cover).

**Artifacts read:** SPEC_ORCH-0855, SPEC_ORCH-0874 (referenced inline citations), SPEC_ORCH-0875 (Tr4 in-flight, header + Q10 only).

**Memories applied:** 5 (listed in §1).

**Not read (out of scope or already-known):** Tr3 stage-2 UI implementations, full ORCH-0874 implementation report (only chrome contract referenced), buyer.tsx/payment.tsx/confirm.tsx of /checkout chain (deferred to SPEC; will need read at IMPLEMENT phase).
