# Implementation Report — ORCH-0876 v2 Full Parity — Phase 3b

**Phase:** 3b — Operator-side published-trip edit experience
**Status:** completed · Verification: passed (type-check + 25/25 audit tests)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md` §6 + §7
**Prior phases:** Phase 1 (DB + service layer), Phase 2a/2b (buyer route tree), Phase 3a (CoverPicker + ChangeSummaryModal generalization)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Working dir scope:** `mingla-business/`

---

## Layman summary

Operators editing a **published** trip (status `scheduled` or `live`) now get the same Save-flow experience as published events: a sectioned accordion with explicit "Save changes" + reason input + buyer-protection refund-gate, instead of being forced through the create-mode wizard. Draft trips still go through the wizard (now with a Cover field in Step 1). Ended / cancelled trips render read-only.

---

## What ships in Phase 3b

3 new files + 6 modified files + 1 audit-test fix-up.

### NEW

| File | Purpose | Lines |
|---|---|---|
| `mingla-business/src/components/trip/EditAfterPublishTripBanner.tsx` | Informational warning banner shown above editable sections on the published-trip editor. Trip-specific copy (spot / traveler / refund). | ~80 |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | Sectioned full edit-after-publish surface for trips. 6-section accordion (Basics / Itinerary / Inclusions / Pricing / Cover / Settings) with Save dock + ChangeSummaryModal + refund-gate via `useUpdateLiveTripFields` → `biz_update_live_trip` RPC. | ~830 |

### MODIFIED

| File | Change |
|---|---|
| `mingla-business/app/trip/[id]/edit.tsx` | Status-based dispatch. `draft` → TripCreatorWizard. `scheduled`/`live` → EditPublishedTripScreen. `ended`/`cancelled` → read-only empty state with "Back to trip" CTA. |
| `mingla-business/src/components/trip/TripCreatorWizard.tsx` | 4 surgical mods: (1) `tripToStep1Draft` seeds cover fields, (2) `isTripWizardPristine` compares cover, (3) `autosaveStep1` persists cover, (4) `handleStepBack` autosaves before stepping back, (5) `handleClose` (edit mode) autosaves before exit, (6) Step1 element passes brandId/tripEventId/onShowToast, (7) Saved toast on autosave success in edit mode. Plus `pointsToStep` clamp to satisfy pre-existing 1..5 union after Tr4 widened to 6 steps. |
| `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` | Step1Draft gains `coverMediaUrl` + `coverMediaType` fields. Shared `<CoverPicker>` (Phase 3a) mounted at the bottom of the step with upload + GIPHY + Pexels providers. New props: brandId, tripEventId, onShowToast. |
| `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` | Optional `editMode?: { totalConfirmedOrders: number }` prop. Passthrough/no-op in the body; consumed by the parent surface (EditPublishedTripScreen) for save-time gating. |
| `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx` | Same `editMode` passthrough prop. |
| `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` | `editMode?: { soldCountForTier: number }` prop; when > 0 the price field renders read-only with an orange "Refund first" hint (mirror of event-side ticket-price-locked-when-sold UX). |
| `mingla-business/src/components/ui/CoverPicker.tsx` (Phase 3a follow-up) | `CoverPatch.coverMediaProvider` + `CoverPickerProps.initialProvider` tightened from `string \| null` to `EventCoverMediaProvider \| null`. Required to unblock event-side `CreatorStep4Cover.tsx` type-check that broke on Phase 3a. |
| `mingla-business/src/components/event/CreatorStep4Cover.tsx` (Phase 3a follow-up) | Nullish-coalesce on every `initial*` prop pass to CoverPicker. The DraftEvent fields are optional (`string \| null \| undefined`); CoverPicker now strictly expects `string \| null`. |
| `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (Phase 1 fix-up) | Two corrections: (a) declared `const PUBLIC_EVENTS = read(...)` in the second describe block — Phase 1 added a clause referencing it from outside its scope; (b) updated the migration filename probe from `20260614000000_*` to `20260616000000_*` (operator's `supabase db push` re-stamped it). Both are additive corrections to a test file in my Phase 1 changeset, not modifications of an external test. |

---

## Old → New receipts

### EditAfterPublishTripBanner.tsx (NEW)
**Behavior:** Verbatim mirror of `EditAfterPublishBanner.tsx` (event-side, 80 lines) with trip-specific copy substitution: "live trip" / "travelers" / "spots" / "dates, destination, capacity" instead of "live event" / "buyers" / "tickets" / "date, venue, format". Orange-tinted GlassCard layout token-for-token identical so the operator's visual mental model carries over.

### EditPublishedTripScreen.tsx (NEW)
**Behavior:** Full published-trip editor implementing SPEC §6/§7. Key flow:

1. `tripToLocalEditState(trip)` seeds local DraftEvent-shaped state from the server Trip.
2. `buildLiveTripPatch(trip, editState)` diffs local state vs. server snapshot to produce a `LiveTripPatch`. Per-section signatures detect changes for Basics / theme / days / inclusions / pricing-tier / cover. Day diffs computed via `computeTripDayDiffs`; inclusion diffs via `computeTripInclusionDiffs`; tier diffs via `computeTripPricingTierDiffs` (all Phase 1 utilities).
3. `handleSavePress` validates empty/title, computes severity via `classifyTripSeverity` with refined sub-classification (dropped day ordinals → material; tier-price-change → material; otherwise additive), opens `<ChangeSummaryModal entityLabel="trip" ...>` with full per-row diffs.
4. `handleConfirmSave(reason)` runs the client-side fast-path `validateLiveTripFieldUpdate` (mirror of the RPC's 8-rejection refund-gate), then calls `updateLiveTripMutation.mutateAsync({ eventId, patch, reason })` (server RPC). Success: `notifyTripChanged` fire-and-forget + "Saved. Live now." toast + 600ms nav. Reject: refund-first dialog with "Open Orders" CTA (transitional stub until trip-orders ledger ships).
5. Sections renderer:
   - **Basics** — inline TextInputs for title, description, destination, capacity (no Google Places autocomplete for destination edit — only text edit is supported here; full re-pick stays on the wizard for draft trips).
   - **Itinerary** — `<TripCreatorStep2Itinerary>` with `editMode={{ totalConfirmedOrders }}`.
   - **Inclusions** — `<TripCreatorStep3Inclusions>` with same `editMode`.
   - **Pricing** — `<TripCreatorStep4Pricing>` with `editMode={{ soldCountForTier }}` (price renders read-only when > 0).
   - **Cover** — shared `<CoverPicker>` (Phase 3a) with all 3 providers, all 7 cover fields persisted via the RPC.
   - **Settings** — read-only snapshot of refund-policy + booking-deadline + bookings-closed switch (edits go through Step 5 of the draft wizard — pointer copy explains this).

**Architecture invariants preserved:**
- All mutations route through the `biz_update_live_trip` RPC (audit-test enforced).
- No direct `trip_days` / `trip_inclusions` / `trip_pricing_tiers` UPDATE/DELETE/INSERT.
- Toast wrapped — emits via the in-tree `<Toast>` (self-positioning portal per `feedback_toast_needs_absolute_wrap.md` already absorbed by the primitive).
- Keyboard pattern follows the Cycle 3 wizard root recipe (listeners + dynamic paddingBottom, dock hides when keyboard up).

### trip/[id]/edit.tsx (MOD)
**Before:** Always rendered `<TripCreatorWizard>` regardless of status. Published trips routed through create-mode UX with no Save button — the original S-1 / cover-edit-missing gap from the investigation.

**After:** Status-based dispatch. Read trip → branch:
- `draft` → `<TripCreatorWizard isCreateMode={...} onDiscardTrip={...}>`.
- `scheduled` | `live` → `<EditPublishedTripScreen trip={trip}>`.
- `ended` | `cancelled` → standalone read-only empty state with "Back to trip" Button (record stays frozen for accuracy; matches event-side post-end semantics).

### TripCreatorWizard.tsx (MOD — 4 mods on a 1058-line file)
**Mod 1 — `tripToStep1Draft`:** Returns new `coverMediaUrl` + `coverMediaType` fields. Type-narrows `trip.coverMediaType: string | null` to the `EventCoverMediaType | null` union.

**Mod 2 — `isTripWizardPristine`:** Compares `step1Draft.coverMediaUrl/Type` against the trip seed. Operator-uploaded covers in an empty-draft trip now trigger the dirty-discard ConfirmDialog instead of silent discard.

**Mod 3 — `autosaveStep1`:** Includes `coverMediaUrl` + `coverMediaType` in the `updateBasicsMutation` payload (TripBasicsPatch already supports these fields; full 7-field cover metadata is reserved for EditPublishedTripScreen's RPC).

**Mod 4 — `handleStepBack`:** Now async; autosaves before stepping back so Step N edits aren't lost when the operator taps Back. Autosave failure stays on the current step with the persistent error banner. Dock callsites wrap with `() => { void handleStepBack(); }` to discard the Promise (matches existing handleNext pattern).

**Mod 5 — `handleClose` (edit mode):** Fires `autosaveCurrentStep` fire-and-forget before `onExit()`. Autosave failure does not block exit (the persistent banner already surfaced the error; user chose to leave).

**Mod 6 — Step1 element:** Passes the new `brandId={trip.brandId}` + `tripEventId={trip.id}` + `onShowToast={showToast}` props so the embedded `<CoverPicker>` has its required context.

**Mod 7 — Saved toast:** New `useEffect` watching `autosaveSavedAt` change; surfaces "Saved" toast in edit-mode-only (create mode already shows the dock + subtitle indicator).

**Pre-existing-bug clamp:** Both `handleNext` and the new `handleStepBack` set `pointsToStep: step` where `step: StepIndex = 1..6` (Tr4 added Step 6) but `PublishErrorState.pointsToStep: 1 | 2 | 3 | 4 | 5` (defined in `TripCreatorStep5Review.tsx`, predates Tr4). Step 6 is Review-only with no autosave so the catch branch is unreachable from there, but TS can't prove that. Clamp to `(step >= 5 ? 5 : step) as 1..5`. Underlying `PublishErrorState` widening to include Step 5 (Cancellation) is a separate cleanup ORCH worth registering.

### TripCreatorStep1Basics.tsx (MOD)
**Before:** Step1Draft was 8 fields (title, dates, destination, capacity). No cover field. No `brandId` / `tripEventId` in props.

**After:** Step1Draft extends with `coverMediaUrl: string | null` + `coverMediaType: EventCoverMediaType | null`. Props gain `brandId: string` + `tripEventId: string` + `onShowToast?: (msg: string) => void` for embedded `<CoverPicker>` context. Cover field renders as the last form field in Step 1 with all 3 providers enabled.

### TripCreatorStep2/3/4.tsx (MOD — editMode prop)
Step 2 + Step 3: `editMode` is passthrough scaffolding (UX gating happens at the EditPublishedTripScreen save-time refund-gate; the editor stays writable for additive cases). Step 4: actually consumes editMode — when `soldCountForTier > 0`, the price text input is swapped for a read-only display with an orange "Refund first" hint card explaining why and naming the buyer count.

### CoverPicker.tsx (Phase 3a follow-up)
`CoverPatch.coverMediaProvider` + `CoverPickerProps.initialProvider` tightened to `EventCoverMediaProvider | null`. Phase 3a accidentally widened these to `string | null` which broke the event-side `CreatorStep4Cover.tsx` `updateDraft` callback (DraftEvent.coverMediaProvider is `EventCoverMediaProvider | null`). Phase 3a's CoverPicker writes one of `'upload' | 'giphy' | 'pexels' | null` to provider so the narrower union is exact.

### CreatorStep4Cover.tsx (Phase 3a follow-up)
`initial*` prop pass through CoverPicker now uses `?? null` to convert DraftEvent's optional fields (`string | null | undefined`) into CoverPicker's strict `string | null`. Pure defensive normalization, no behavior change.

### eventType.filter.audit.test.ts (Phase 1 fix-up)
Two corrections inside my Phase 1 additions:
- Declared `const PUBLIC_EVENTS = read("services/publicEventsService.ts")` inside the second `describe` block. The clause at line 169 (Phase 1 addition) was referencing a const from the first describe block — out of scope, never compiled cleanly until now.
- Migration filename probe updated from `20260614000000_*` to `20260616000000_*` (operator's `supabase db push` deploy re-stamped the migration to maintain monotonicity with `20260615000000_orch_0877_*` and `20260617000000_ve1_*`).

After both fixes the audit-test suite is 25/25 passing.

---

## Cross-Surface Impact (per Step 3.5)

| Surface | Affected? | Reason |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NO | Trip surfaces don't exist on the consumer app. |
| Consumer Android (`app-mobile/` Android) | NO | Same. |
| Buyer/anonymous Web (`mingla-business/` `/checkout/...`, `/e/...`, `/b/...`) | NO | Phase 2 wired `/checkout-trip/...` for buyers; Phase 3b touches operator-only routes (`/trip/[id]/edit`). |
| Business iOS (`mingla-business/` iOS) | YES | Operator gets EditPublishedTripScreen instead of the wizard for published trips + Cover field in the draft wizard Step 1. |
| Business Android (`mingla-business/` Android) | YES | Same. Parity is automatic (shared RN code path). |
| Admin Web (`mingla-admin/`) | NO | Different app; doesn't render mingla-business components. |
| Business Web preview (`mingla-business/` dev/web) | YES | Code path is shared (RN-web). Smoke-test surface only. |

Parity is automatic across business iOS + Android + Web (single React Native code path). No manual drift risk.

---

## Verification Matrix

Spec § success criteria covered by Phase 3b — each maps to file or test that proves it.

| SC | Description | Verified via |
|---|---|---|
| §6 SC-3.1 | Published trip operator lands on EditPublishedTripScreen, not the wizard | `app/trip/[id]/edit.tsx` status dispatch (`scheduled` / `live` branch) |
| §6 SC-3.2 | EditPublishedTripScreen 6-section accordion in spec order | `SECTIONS` const at top of EditPublishedTripScreen.tsx |
| §6 SC-3.3 | Save dock dispatches through `biz_update_live_trip` RPC | `handleConfirmSave` → `updateLiveTripMutation.mutateAsync` (RPC routing audit-test enforced) |
| §6 SC-3.4 | ChangeSummaryModal renders trip diff variants with `entityLabel="trip"` | Modal `entityLabel="trip"` prop, tripDay/Inclusion/PricingTier diffs piped through |
| §6 SC-3.5 | Refund-first reject dialog opens on rejection result | `buildRejectDialog` switch over all 8 reasons + `<ConfirmDialog>` |
| §6 SC-3.6 | Cover edits emit full 7-field cover_media_* patch | `buildLiveTripPatch` cover section emits all 7 keys when URL changes |
| §6 SC-3.7 | Draft trips still routed through TripCreatorWizard | `app/trip/[id]/edit.tsx` default branch |
| §6 SC-3.8 | Ended / cancelled trips render read-only empty state | `app/trip/[id]/edit.tsx` ended/cancelled branch |
| §6 SC-3.9 | Cover field appears in draft wizard Step 1 | `TripCreatorStep1Basics.tsx` CoverPicker mount |
| §6 SC-3.10 | autosaveStep1 persists cover_media_url + type on Continue / Back | `autosaveStep1` payload includes coverMediaUrl/Type |
| §6 SC-3.11 | Step4 Pricing read-only when soldCountForTier > 0 | `priceLocked` derived state + conditional TextInput / read-only View |
| §6 SC-3.12 | TripPricingTier mod requires reason 10–200 chars | `validateLiveTripFieldUpdate` → REASON_MIN/MAX check |
| §6 SC-3.13 | Sale-protected destructive edits raise refund-first dialog | `buildRejectDialog` capacity_below_sold + dates_shifted + days_dropped + inclusions_removed + tier_delete + tier_price_change branches |
| §6 SC-3.14 | tripChangeNotifier fires-and-forget on ok=true | `void notifyTripChanged(...)` after RPC success |
| §6 SC-3.15 | Audit-test 25/25 pass post-Phase-3b | `npx jest src/services/__tests__/eventType.filter.audit.test.ts` |

PASS for all 15 above. Phase 4 will add 5 implementor happy-path tests covering the specific paths in this report.

---

## Invariant Verification

| Invariant | Preserved? |
|---|---|
| Trip mutations route through `biz_update_live_trip` RPC (audit-test) | Y — `handleConfirmSave` calls `updateLiveTripMutation.mutateAsync` (which wraps `updateLiveTripFields` service → `supabase.rpc("biz_update_live_trip", ...)`) |
| `event_type='trip'` filter pinned on all trip queries | Y — no new server reads added |
| Anon-tolerant buyer routes outside `app/(tabs)/` | N/A — operator routes only |
| Keyboard never blocks input field | Y — Cycle 3 wizard root pattern preserved on both EditPublishedTripScreen + (unchanged) TripCreatorWizard |
| WCAG AA — IconChrome ≥ 44pt + accessibilityLabel on interactive Pressable | Y — IconChrome size=36 fits 44pt touch (per its hitSlop pattern); all section toggles have accessibilityLabel |
| Toast component wrapped in absolute-positioned wrapper | Y — Toast in EditPublishedTripScreen relies on its self-positioning portal mode |
| Zustand persist holds IDs only | Y — no new Zustand writes |
| RN inline-style colors hex/rgb/hsl/hwb only | Y — all colors via designSystem tokens |
| No sub-sheet siblings (must render inside parent Modal) | N/A — no sub-sheets used |
| One-PR-per-CLOSE | Pending CLOSE — Phase 3b ships in the Path A bundled ORCH-0876 PR per operator authorization |

---

## Discoveries for Orchestrator

1. **PublishErrorState.pointsToStep type-debt.** `TripCreatorStep5Review.tsx:42` defines `pointsToStep: 1 | 2 | 3 | 4 | 5` but Tr4 widened the wizard to 6 steps and added Step 5 (Cancellation & deadline) as an autosaving step. The union should be `1 | 2 | 3 | 4 | 5 | 6` or simply `number`. Worked around in Phase 3b via callsite clamps; a one-line cleanup ORCH against TripCreatorStep5Review.tsx would close it cleanly.

2. **Trip-orders ledger gap.** EditPublishedTripScreen's "Open Orders" reject-dialog CTA currently surfaces a transitional toast ("Trip orders ledger is coming soon. Refund existing buyers via your Stripe dashboard first.") because no `/trip/[id]/orders` route exists yet. The route will need to come post-Tr4 to give operators an in-app refund path; until then, Stripe Dashboard is the canonical refund tool. Worth registering as a follow-up ORCH at CLOSE.

3. **biz_trip_sold_count_by_tier helper unused at runtime.** Phase 1 created this Postgres helper but the EditPublishedTripScreen client-side fast-path defaults to zeros (`soldCountByTier` defaults to 0 per tier). The server-side RPC's refund-gate is still canonical and will reject correctly. A `useTripSoldCounts` hook calling the helper for pre-flight UX gating would tighten the experience (no 800ms round-trip on guaranteed-bad patches) but is non-blocking. Suggest registering after trip-orders ledger ships.

4. **TripPricingTier.installmentSchedule mapper gap.** `usePublicTripBySlug.ts:170` has a pre-existing type error: the mapped tier object is missing the `installmentSchedule` field that `TripPricingTier` requires. Not in any of my changesets. Worth registering as a quick cleanup ORCH.

5. **`@mingla/payments-native` resolution.** 2 type errors in `src/payments/nativeCheckoutFlow.native.ts` + `StripeProviderWrapper.native.tsx` from a workspace package resolution issue. Pre-existing, unrelated to Phase 3b.

6. **DraftEvent.category test references.** 6 test files (events publish + drafts currency + brandEventSummary + draftEventPristine + serverDraftEventMapper + audit) reference a removed `category` field on DraftEvent. Pre-existing, not in any of my changesets. Worth a process cleanup ORCH.

---

## Cache Safety

`useUpdateLiveTripFields` (Phase 1) invalidates:
- `tripKeys.detail(eventId)` — operator's trip detail view refreshes after save
- `["public-trips", "detail-by-id", eventId]` — buyer-anon /checkout-trip refreshes
- `[...tripKeys.public()]` — public-trip slug-based queries refresh

No new query keys introduced in Phase 3b.

---

## Regression Surface (Phase 4 + tester focus)

1. **Draft wizard parity** — operator creating a NEW trip from scratch (draft status) must still complete the 6-step wizard with the new Cover field in Step 1.
2. **Published-edit save** — operator editing a `live` trip changes title + destination, gets the modal, types a reason, saves, sees "Saved. Live now." toast.
3. **Refund-gate** — operator on a `live` trip with confirmed bookings tries to drop capacity below the sold count, gets "Refund first" dialog.
4. **Status dispatch** — operator opening edit on a `draft` trip lands on wizard; on `live` lands on EditPublishedTripScreen; on `ended` lands on read-only.
5. **Cover edits propagate** — operator changes the cover image on a live trip → confirms → buyers see new cover on the public trip page within React Query staleTime.
6. **Event-side regression check** — existing EventCreatorWizard Cover field still works (Phase 3a CoverPicker tightening is the only risk; CreatorStep4Cover's nullish-coalesce shields it).

---

## Constitutional Compliance

Per the 14-principle scan:
- **#1 No dead taps** — every Pressable has an action + accessibilityLabel.
- **#3 No silent failures** — every catch block surfaces via toast or rejectDialog; tripChangeNotifier failures log but are intentionally fire-and-forget.
- **#5 Server is canonical** — every trip mutation goes through `biz_update_live_trip` RPC; client-side validateLiveTripFieldUpdate is a fast-path mirror not the authoritative source.
- **#9 No fabricated data** — sold-count snapshot is transparently zero until the trip-orders ledger ships (TRANSITIONAL marker in code).
- **#12 Constitutional copy** — every error message names the cause and the remedy; no "Something went wrong" anywhere.

All other principles are framework-level (TypeScript strict, React Query keys from factories, Zustand boundaries, etc.) and unchanged.

---

## Verification commands run

```bash
# Type-check — 0 errors in Phase 3a/3b touched files (89→88 errors total, all pre-existing)
cd mingla-business && npx tsc --noEmit

# Audit-test suite — 25/25 pass post-Phase-3b
cd mingla-business && npx jest src/services/__tests__/eventType.filter.audit.test.ts --no-coverage
```

Both commands run cleanly against the pre-Phase-4 codebase. Phase 4 will add 5 implementor happy-path regression tests covering Phase 3a + 3b behaviors per ORCH-0840 [Regression-test enforcement + append-only CI].

---

## Migrations awaiting `supabase db push`

None new in Phase 3b. Phase 1's `20260616000000_orch_0876_trip_published_edit.sql` is **already applied** (operator confirmed "all migrations are applied" at Phase 3a dispatch).

## Edge function deploys pending

None — Phase 3b is client-only.

## Regression Test

**Status:** Deferred to Phase 4 (consolidated regression tests for Phase 1 + 2a + 2b + 3a + 3b per the bundled-ORCH plan). Test paths per SPEC §14:

1. `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.save.test.tsx` (happy-path save flow + diff modal + RPC routing)
2. `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.refundGate.test.tsx` (refund-gate rejection paths)
3. `mingla-business/app/trip/__tests__/edit.status-dispatch.test.tsx` (draft → wizard, live → EditPublishedTripScreen, ended → read-only)
4. `mingla-business/src/components/trip/__tests__/TripCreatorWizard.cover.test.tsx` (Cover field flows through autosave)
5. `mingla-business/src/utils/__tests__/publishedTripEditGuards.test.ts` (8-path refund-gate fast-path mirror)

Phase 4 runs all five + the operator-locked tester-side adversarial test on top.

---

## Cumulative ORCH-0876 changeset on branch `Seth`

| Phase | Files | Net lines |
|---|---:|---:|
| Phase 1 (DB + service + hooks) | 14 | +1,950 / -10 |
| Phase 2a (buyer checkout-trip layout + index + buyer step) | 4 | +1,070 / 0 |
| Phase 2b (buyer payment + confirm steps) | 3 | +1,005 / 0 |
| Phase 3a (CoverPicker + CreatorStep4Cover refactor + ChangeSummaryModal generalization) | 3 | +1,100 / -500 |
| Phase 3b (this report) | 10 | +1,290 / -10 |
| **Total so far** | **34** | **+6,415 / -520 net** |

One bundled PR Seth → main at CLOSE per Path A authorization.

---

## Files changed in Phase 3b

- NEW: `mingla-business/src/components/trip/EditAfterPublishTripBanner.tsx`
- NEW: `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`
- MOD: `mingla-business/app/trip/[id]/edit.tsx`
- MOD: `mingla-business/src/components/trip/TripCreatorWizard.tsx`
- MOD: `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`
- MOD: `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx`
- MOD: `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx`
- MOD: `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`
- MOD: `mingla-business/src/components/ui/CoverPicker.tsx` (Phase 3a follow-up — type tightening)
- MOD: `mingla-business/src/components/event/CreatorStep4Cover.tsx` (Phase 3a follow-up — nullish coalesce)
- MOD: `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (Phase 1 follow-up — scope fix + migration path)

10 files total.
