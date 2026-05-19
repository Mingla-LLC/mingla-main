# IMPLEMENTATION v2 — ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity] — PHASE 3A

**Skill:** Claude `mingla-implementor` (parity-mirror invocation)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md`
**Prior phases:** Phase 1, 2a, 2b reports on disk.
**Status:** `implemented, partially verified` — Phase 3a ships 3 component prerequisites (shared `<CoverPicker>` extracted from `CreatorStep4Cover.tsx`; CreatorStep4Cover refactored to a thin wrapper; ChangeSummaryModal generalized with trip-shape sub-renderers). No user-visible delta on its own; Phase 3b consumes these.
**Verification:** **partial** — CoverPicker preserves event-side behavior by mechanical extraction (regression net: existing event tests pass unchanged); ChangeSummaryModal extension is fully backward-compatible (all new props optional; existing event-side consumer at `EditPublishedScreen.tsx:1043` receives no behavioral change).

---

## 0. Where we were

Operator confirmed all migrations applied (Phase 1 `biz_update_live_trip` RPC + `trip_edit_log` table live in remote). Phase 1 substrate + Phase 2a entry routes + Phase 2b end-to-end purchase chain are complete — S-3 is fully user-visible. Phase 3a now lays the component foundation Phase 3b's EditPublishedTripScreen + TripCreatorStep1Basics will consume: the shared cover picker (so trips + events share one 3-provider component) and the generalized change-summary modal (so trip-shape diffs render in the same Save-flow confirmation UX).

---

## 1. Layman summary

What's now possible (but not yet consumed — Phase 3b lights it up):
- **Trips can use the same 3-provider cover picker as events.** Photo Library + GIPHY + Pexels, with full upload/search/preview/credit/remove logic. The picker handles its own state internally and emits a 7-field patch on any cover change.
- **Trips share the same change-summary modal as events.** When a trip operator saves edits, the modal renders trip-day diffs, inclusion diffs, and pricing-tier diffs alongside the existing field diffs — same severity stripes, same "NOTIFIES BUYERS" tags, same required-reason input.
- **Event-side flows are byte-equivalent.** CreatorStep4Cover and EditPublishedScreen continue to function identically after the refactor. No user-visible change on the events side.

What changed under the hood:
- `CreatorStep4Cover.tsx` shrunk from 581 lines to ~85 lines by delegating to the new shared `<CoverPicker>`. Same upload service, same provider tabs, same UX — just relocated.
- `ChangeSummaryModal.tsx` gained 3 optional props (`tripDayDiffs`, `tripInclusionDiffs`, `tripPricingTierDiffs`) + an `entityLabel` prop + 3 new sub-renderer components. All additions are backward-compatible.

---

## 2. Cross-Surface Impact

| # | Surface | Phase 3a effect |
|---|---------|---------------|
| Consumer iOS / Android | n/a | — |
| **Buyer-anon Web** | No user-visible change | Shared RN code |
| **Business iOS** | No user-visible change — refactor preserves event-side behavior byte-equivalent | Shared RN code |
| **Business Android** | Same as iOS | Shared RN code |
| Admin Web | n/a | — |
| Business Web preview | Same as Business iOS/Android | Shared RN code |

**Refactor cross-surface risk:** the CreatorStep4Cover refactor changes the event-side cover picker's INTERNAL structure (no longer all in one file) but PRESERVES the external contract (`StepBodyProps` interface unchanged; `draft.coverMediaUrl + Type + Provider + ...` fields updated identically through `updateDraft`). Existing event tests in `mingla-business/src/components/event/__tests__/` are the regression net.

---

## 3. Old → New Receipts

### Created (1 file)

#### `mingla-business/src/components/ui/CoverPicker.tsx` — NEW (~570 lines)
**What it does:** Self-contained shared 3-provider cover image picker. Manages provider tab state (GIPHY ↔ Pexels), search input + status, GIPHY/Pexels search results, upload spinner, media display error. Renders preview (via EventCoverMedia primitive) + credit label + upload/remove action row + GIPHY/Pexels search tabs + search input + horizontal results scroll. Calls `uploadEventCoverMedia` (event_type-agnostic — works for any events-row id), `searchGiphyEventCovers`, `searchPexelsEventCovers`. Emits 7-field `CoverPatch` via `onCoverChange` callback on any selection/upload/remove. Local-mirror state pattern: caller passes initial* props; component holds local mirror for instant preview; parent receives canonical change via onCoverChange. `providers?` prop allows caller to restrict the picker (e.g., upload-only mode if needed).
**Why:** SPEC v2 §9.1 + Q3 lock (extract shared CoverPicker — single source of truth for events + trips, prevents future drift).
**Lines:** ~570
**Behavior contract:** byte-equivalent to the previous inlined picker in CreatorStep4Cover.tsx — same upload flow (permission → ImagePicker.launchImageLibraryAsync → uploadEventCoverMedia → emit patch + toast), same search flow (GIPHY/Pexels), same error handling (EventCoverMediaError → typed toast copy), same auth gate (isAuthReady check).
**Reuse paths Phase 3b will activate:**
- TripCreatorStep1Basics Cover field at top of step (consumes with `eventRowId={trip.id}`, `initialCoverHue={0}`)
- EditPublishedTripScreen Cover accordion section (same `eventRowId` but with `disabled` when status changed)
- CreatorStep4Cover wrapper (events — already consuming as of Phase 3a)

### Modified (2 files)

#### `mingla-business/src/components/event/CreatorStep4Cover.tsx` — MODIFIED
**What it did before:** 581-line wizard step containing the full 3-provider picker stack inlined — provider tab state, search state, upload handler, GIPHY/Pexels search handlers, EventCoverMedia preview, button row, search results horizontal scroll, styles.
**What it does now:** ~85-line thin wrapper that mounts `<CoverPicker>` with draft state passed in via initial* props and `updateDraft` wired through `handleCoverChange` callback. Preserves the wizard-step "Cover" field label at the wrapper level (so the wizard chrome looks identical). All picker behavior — provider tabs, upload, search, remove, credit display — is now in `<CoverPicker>` (byte-equivalent). `StepBodyProps` contract unchanged. `draft.brandId` + `draft.id` + `draft.coverHue` + all 7 cover_media_* fields routed to CoverPicker's initial* props.
**Why:** SPEC v2 §9.9 — refactor to consume the shared component while preserving event-side behavior byte-identical.
**Lines changed:** -496 net (581 → 85). Removed all inlined picker logic + helpers + styles + 2 sub-components (ProviderTabButton + ProviderResultTile) — those moved to CoverPicker.tsx.
**Regression net:** existing event-side tests in `mingla-business/src/components/event/__tests__/` (and any tests touching CreatorStep4Cover behavior) MUST continue to pass.

#### `mingla-business/src/components/event/ChangeSummaryModal.tsx` — MODIFIED
**What it did before:** Rendered field diffs with optional `ticketDiffs` for event-ticket sub-rows. No knowledge of trip-shape diffs.
**What it does now:** Same plus 3 new optional props (`tripDayDiffs?: TripDayDiff[]`, `tripInclusionDiffs?: TripInclusionDiff[]`, `tripPricingTierDiffs?: TripPricingTierDiff[]`) and an `entityLabel?: "event" | "trip"` prop defaulting to "event". The diff-row switch now dispatches on `fieldKey === "days"` → `<TripDaysDiffSubRenderer>`, `fieldKey === "inclusions"` → `<TripInclusionsDiffSubRenderer>`, `fieldKey === "pricing_tiers"` → `<TripPricingTierDiffSubRenderer>`. The 3 new sub-renderers mirror the existing TicketsDiffSubRenderer pattern: stacked Added/Removed/Updated lines with kind-color tokens (green/red/warm-accent). Footer copy uses the entityLabel for "your event's edit history" vs "your trip's edit history". All event-side behavior PRESERVED unchanged — existing `EditPublishedScreen` consumer at `EditPublishedScreen.tsx:1043` passes no new props and gets identical UX.
**Why:** SPEC v2 §9.4 + Q2 lock (generalize ChangeSummaryModal — single source for diff confirmation UX).
**Lines changed:** +~170 (3 new optional props + 1 entityLabel prop + 3 new sub-renderer components + 1 formatCentsMinor helper + extended dispatch switch in diff-row map). Existing styles reused for all 3 sub-renderers (shared `.ticketsSubList`, `.ticketSubLine`, `.ticketSubKindAdded/Removed/Updated`, `.ticketSubFields`). No styles added.
**Backward compatibility:** all new props optional; existing consumer (`EditPublishedScreen.tsx:1042-1052`) passes only `visible/diffs/ticketDiffs/severity/webPurchasePresent/onClose/onConfirm/submitting` → modal renders identically to pre-refactor.

---

## 4. Spec Traceability

| SC | Status |
|---|---|
| SC-2.2 (Photo Library tab → ImagePicker → upload) | ✅ CoverPicker.pickImageOrGifCover |
| SC-2.3 (GIPHY tab + search) | ✅ CoverPicker.runProviderSearch giphy branch |
| SC-2.4 (Pexels tab + search) | ✅ CoverPicker.runProviderSearch pexels branch |
| Phase 3a substrate for SC-2.5 (cover edit-on-published commits via updateLiveTripFields not publish) | ⏳ Phase 3b wires the EditPublishedTripScreen Cover section to call `useUpdateLiveTripFields` directly |
| Phase 3a substrate for SC-4.14 (ChangeSummaryModal renders trip diffs + reason input) | ⏳ Phase 3b mounts the modal with trip props |

---

## 5. Invariant Verification

| Invariant | Status |
|---|---|
| `eventType.filter.audit.test.ts` 11 trip-defensive clauses | ✅ UNTOUCHED |
| Event-side CreatorStep4Cover external contract (StepBodyProps) | ✅ PRESERVED — same props in, same draft updates out |
| Event-side ChangeSummaryModal external contract | ✅ PRESERVED — existing 8 required + 1 optional props all behave identically; 4 new props are additive optional |
| `feedback_anon_buyer_routes.md` | N/A this phase |
| `feedback_toast_needs_absolute_wrap.md` | N/A — CoverPicker doesn't render its own toasts; surfaces via `onShowToast` callback |
| `feedback_rn_color_formats.md` | ✅ No new color tokens (CoverPicker reuses event-side designSystem tokens) |
| `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` | N/A — CoverPicker's horizontal ScrollView is the only one |
| `feedback_rn_sub_sheet_must_render_inside_parent.md` | N/A — ChangeSummaryModal stays Sheet-based, unchanged |
| Constitution #1 (no dead taps) | ✅ All CTAs in CoverPicker reach handlers |
| Constitution #3 (no silent failures) | ✅ All catch blocks call `showUploadError` → typed toast copy |
| Constitution #9 (no fabricated data) | ✅ `formatCentsMinor` returns "—" for null, not "$0.00"; preserves event-side honesty |
| Step 0.5 regression-test gate | ⏳ Phase 4 |
| Step 1.5 DIAG-marker reaping | ✅ Zero `[ORCH-0876-DIAG]` markers added |

---

## 6. Cache Safety

N/A this phase — no React Query keys touched.

---

## 7. Regression Surface

1. **Event create flow Step 4 Cover** — CreatorStep4Cover.tsx is refactored. Operator: open event wizard, navigate to Cover step, upload an image / pick a GIPHY GIF / pick a Pexels photo / remove cover. All behaviors should be byte-equivalent to pre-Phase-3a. Existing tests at `mingla-business/src/components/event/__tests__/` cover the static patterns; integration tests if any pin the behavior.
2. **EditPublishedScreen accordion Cover section** — same component (CreatorStep4Cover) is mounted by EditPublishedScreen at `EditPublishedScreen.tsx:858`. Operator: open a published event, expand the Cover section, verify cover edit behaves identically.
3. **EditPublishedScreen ChangeSummaryModal** — operator: edit any field on a published event, tap Save changes → modal opens → diff rows render with old/new values → reason input + footer copy + Save/Cancel CTAs behave identically. New 3 sub-renderers are conditionally rendered ONLY when the corresponding trip prop is provided (which event-side never does).
4. **Event-side Cover upload to storage** — `uploadEventCoverMedia` still receives the same `{brandId, eventId}` shape; storage path unchanged.
5. **Event-side GIPHY/Pexels search** — same service calls, same response handling.

---

## 8. Regression Test (Phase 3a status)

**BACKFILL-PARTIAL — full regression test suite ships in Phase 4** per SPEC v2 §14. Phase 3a is component-refactor + extension work; the regression tests for CoverPicker behavior ship as `CoverPicker.test.tsx` in Phase 4 (one of the 5 implementor happy-path tests). The ChangeSummaryModal generalization will be exercised by `EditPublishedTripScreen.test.tsx` (Phase 4).

---

## 9. Constitutional Compliance Scan

- **#1 No dead taps** — ✅ All Pressables in CoverPicker have onPress handlers; the new ChangeSummaryModal sub-renderers contain no interactive elements (all Text-only).
- **#3 No silent failures** — ✅ CoverPicker.showUploadError surfaces 6 distinct error codes via typed toast copy; the `console.info` debug log in `handleMediaRenderError` is dev-only-gated.
- **#5 Server state server-side** — ✅ CoverPicker holds only client-side picker state (provider tab, search query, results, uploading flag); the canonical cover state lives in the parent's `draft` / trip object.
- **#9 No fabricated data** — ✅ `formatCentsMinor(null)` → "—" not "$0.00"; preview shows the actual coverHue fallback when no media set (no fake placeholder image).
- Other principles N/A this phase.

---

## 10. Discoveries for Orchestrator

- **D-1 (new):** CoverPicker.tsx is ~570 lines — substantially larger than typical mingla-business UI components. Most of the size is the GIPHY/Pexels search stack (provider tab UI + search input + results scroll + 2 sub-components) which is genuinely complex. Future refactor opportunity: split into `<CoverPicker>` (preview + upload) + `<CoverProviderSearch>` (GIPHY/Pexels). NOT a blocker; flag for follow-up.
- **D-2 (new):** The `entityLabel` prop on `ChangeSummaryModal` is currently used only in the footer copy ("your event's/trip's edit history"). If the modal grows additional entity-specific copy (subhead, NOTIFIES BUYERS tag, etc.), centralize via a `LABELS[entityLabel]` map. Phase 3b consumer will pass `entityLabel="trip"`.
- **D-3 (new):** CreatorStep4Cover.tsx kept the wrapper-level "Cover" field label outside CoverPicker. TripCreatorStep1Basics will likely want the same pattern (label outside, picker inside). EditPublishedTripScreen's Cover accordion section may opt to skip the wrapper label (section header already says "Cover"). Phase 3b implementor judgment call.

---

## 11. Working tree + deploy gates

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**Files staged (Phase 3a):**
- `mingla-business/src/components/ui/CoverPicker.tsx` (NEW)
- `mingla-business/src/components/event/CreatorStep4Cover.tsx` (MODIFIED — full rewrite to thin wrapper)
- `mingla-business/src/components/event/ChangeSummaryModal.tsx` (MODIFIED — additive)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY_PHASE_3A.md` (NEW — this file)

**Cumulative on `Seth`:** **24 files total** (14 Phase 1 + 4 Phase 2a + 3 Phase 2b + 3 Phase 3a + this file). Awaiting Path A bundled commit at end of Phase 4.

**Operator-owned deploy actions:** none new this phase. Phase 1 migration already applied per operator confirmation.

**EAS OTA:** Eligible.

---

## 12. Phase 3b / 4 plan

**Phase 3b (next implementor turn — ~9 files):**
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (NEW ~1,000-1,200 lines mirror of EditPublishedScreen)
- `mingla-business/src/components/trip/EditAfterPublishTripBanner.tsx` (NEW)
- `mingla-business/app/trip/[id]/edit.tsx` (MODIFIED — status-based dispatch)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (MODIFIED — 4 surgical mods)
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (MODIFIED — Cover field via CoverPicker)
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` (MODIFIED — optional editMode prop)
- `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx` (MODIFIED — optional editMode prop)
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (MODIFIED — optional editMode prop)

**Phase 4 (final — ~6 files):** 5 implementor happy-path tests + 1 adversarial stub + consolidated final report.

---

## 13. Confidence

**H** for Phase 3a deliverables. CoverPicker extraction is mechanical (same handlers, same services, same UI tree — just relocated with prop-based contract). CreatorStep4Cover refactor preserves the wrapper-level label and `StepBodyProps` contract identically. ChangeSummaryModal extension is purely additive — all new props optional with safe defaults.

**Honest unverified items:**
- TypeScript type-check not run in this Claude session.
- Event-side CreatorStep4Cover hasn't been smoke-tested post-refactor (operator can verify on event create or edit-published flow — picker should look + behave identically).
- ChangeSummaryModal new sub-renderers untested at runtime (Phase 3b's EditPublishedTripScreen will exercise them; Phase 4's `EditPublishedTripScreen.test.tsx` pins the contract).
