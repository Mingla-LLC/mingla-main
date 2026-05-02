# Implementation — BIZ Cycle 9b-2 — Edit-after-publish (focused single-screen)

**Status:** implemented, partially verified
**Verification:** tsc PASS · grep oklch PASS · runtime UNVERIFIED (awaits user smoke web + iOS)
**Scope:** 4 NEW + 4 MOD · ~+750 LOC delta · 0 schema bumps · 0 new deps · 0 new TRANSITIONALs (single explicit `// [TRANSITIONAL]` removed from EventManageMenu's Edit-details non-draft branch)
**Spec:** [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md) §3.B (J-E11 portion) — **APPROVED DEVIATION**
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
**Cycle 9b-1 delivered:** [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9b1_LIFECYCLE_ACTIONS_PARTIAL.md](Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9b1_LIFECYCLE_ACTIONS_PARTIAL.md)
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_9b2_EDIT_AFTER_PUBLISH.md](Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_9b2_EDIT_AFTER_PUBLISH.md)

---

## 1 — Spec deviation (orchestrator-approved 2026-05-02)

The dispatch specified wizard mode prop + shadow-draft pattern + per-field locked gating across 7 wizard steps. After pre-flight reading EventCreatorWizard (769 LOC, deeply coupled to draftEventStore) AND the actual LiveEvent schema, the implementor surfaced a real gap: **Q-9-5 listed mutable fields (`description`, `coverHue`, `social links`, `FAQ`, `tagline`) but only `description` and `coverHue` actually exist on LiveEvent today.** `tagline / FAQ / social links` are brand-level fields, not event-level.

Building a 7-step wizard for editing 2 fields (with 5 of 7 steps entirely locked) is hostile UX. Implementor proposed and orchestrator approved Option (A): **focused single-screen `EditPublishedScreen`** with description + cover hue + ChangeSummaryModal review.

**What stays the same:** ChangeSummaryModal pattern, Q-9-5 mutable/locked field philosophy, `updateLiveEventEditableFields` mutation, manage menu wiring, `?mode=edit-published` query param routing pattern.

**What changes:** No wizard mode prop. No shadow draft. No per-field locked gating across step bodies. The route handler renders `EditPublishedScreen` directly when `?mode=edit-published`.

**Future-proof:** when B-cycle adds `tagline / FAQ / social links` to LiveEvent schema, extend `EditableValues` in `liveEventToEditPatch.ts` and add new sections to `EditPublishedScreen`. Wizard reuse can be revisited then if the editable surface grows beyond a single screen.

---

## 2 — Mission summary

Founder taps **Edit details** on a live event from the manage menu → focused edit screen opens with:

1. **EditAfterPublishBanner** at top — orange-tinted GlassCard "You're editing a live event. Changes go live immediately when you save. Some fields are locked — Cancel + republish to change them."
2. **Description** — large multiline TextInput (max 2000 chars), live char count.
3. **Cover hue picker** — 6-tile grid mirroring CreatorStep4Cover pattern; live preview at 140px tall.
4. **Locked-fields explainer** — read-only GlassCard "Locked after publish: name, date, venue, ticket types, and settings can't be changed once an event is live..."
5. **Sticky bottom Save changes button** — disabled while submitting.
6. On Save: compute diffs vs original LiveEvent → if zero, toast "No changes to save." → if changes, open **ChangeSummaryModal** listing field-level diffs (old → new) with Save Changes / Cancel.
7. ChangeSummaryModal Confirm → 800ms processing → `liveEventStore.updateLiveEventEditableFields(id, patch)` → toast "Saved. Live now." → router.back() to /event/{id}.
8. Cancel anywhere = local edits discarded (state lives in screen-local `useState`, never persisted).

After 9b-2 lands, manage menu's "Edit details" non-draft toast is GONE — Edit details routes for real.

---

## 3 — Old → New Receipts

### `mingla-business/src/utils/liveEventToEditPatch.ts` (NEW, ~110 LOC)
- Exports `EditableValues` (description + coverHue), `FieldDiff` shape, `liveEventToEditableValues(event)`, `computeFieldDiffs(original, edited)`, `diffsToPatch(diffs, edited)`.
- Truncate helper for display values (80-char cap).
- Documented as the place to extend when B-cycle adds more editable fields.
- **Why:** Spec §3.B.2 ChangeSummaryModal contract + edit-state seed.

### `mingla-business/src/components/event/EditAfterPublishBanner.tsx` (NEW, ~85 LOC)
- Orange-tinted GlassCard composed inline (accent.tint + accent.border).
- 32×32 icon badge (flag) + heading + body copy.
- No props; informational only. Render conditionally by parent (only EditPublishedScreen uses it today).
- **Why:** Spec §3.B.2 banner contract.

### `mingla-business/src/components/event/ChangeSummaryModal.tsx` (NEW, ~190 LOC)
- Sheet primitive (snap=half) with title + subhead + scrollable diff list + Save changes (primary) + Cancel (ghost).
- Each diff row: field label (uppercase accent.warm), old value (line-through tertiary), arrow icon, new value (primary).
- Empty state: "No changes to review." (defensive — parent guards but good fallback).
- Submitting state: Save button shows loading spinner + disabled; Cancel disabled.
- **Why:** Spec §3.B.2 ChangeSummaryModal.

### `mingla-business/src/components/event/EditPublishedScreen.tsx` (NEW, ~410 LOC)
- The single-screen edit surface (replaces wizard mode per approved deviation).
- Reads LiveEvent prop, seeds `EditableValues` via `liveEventToEditableValues`.
- Description multiline TextInput (composed inline since kit Input is single-line; max 2000 chars; placeholder color, web outline-zero).
- Cover hue 6-tile picker mirroring CreatorStep4Cover (HUE_TILES = [25, 100, 180, 220, 290, 320]). 140px live preview band.
- Locked-fields explainer GlassCard.
- Sticky bottom dock with "Save changes" Button (hidden when keyboard up).
- ChangeSummaryModal on save tap.
- Toast self-positions via Modal portal (no toastWrap — current memory rule).
- Keyboard handling: Cycle 3 wizard root pattern (Keyboard listeners + dynamic paddingBottom + scrollToEnd on focus).
- 800ms simulated processing on confirm save → updateLiveEventEditableFields → toast → 600ms delay → router.back.
- **Why:** Spec §3.B.2 J-E11 (deviation) + Q-9-5 mutable fields.

### `mingla-business/src/store/liveEventStore.ts` (MOD)
- **Before:** Mutations `addLiveEvent`, `getLiveEvent`, `getLiveEventBySlug`, `getLiveEventsForBrand`, `updateLifecycle`, `reset`.
- **After:** Added `updateLiveEventEditableFields(id, patch)` accepting `Partial<Pick<LiveEvent, "description" | "coverHue">>`. Defense-in-depth: silently drops keys not in the Q-9-5 mutable allowlist (even if caller passes locked-field keys, they're filtered out before set). Bumps updatedAt. Returns early if patch is empty.
- **Why:** Spec §3.B.1 + Q-9-5.
- **Lines changed:** ~+25 / -0.

### `mingla-business/app/event/[id]/edit.tsx` (MOD)
- **Before:** Single-path route handler — read draft via `useDraftById`, render EventCreatorWizard. Bounce to /(tabs)/home if draft null.
- **After:** Branches on `?mode=edit-published` query param.
  - **Edit-published path:** read LiveEvent via `useLiveEventStore.getState().events.find` (selector), render `<EditPublishedScreen liveEvent={liveEvent} />`. Bounce to /(tabs)/events if liveEvent null.
  - **Default path:** existing draft flow (unchanged behavior).
- Brand resolution updated to use liveEvent.brandId (edit-published) or draft.brandId (create) depending on mode.
- **Why:** Spec §3.B.2 mode routing.
- **Lines changed:** ~+45 / -10 net.

### `mingla-business/src/components/event/EventManageMenu.tsx` (MOD)
- **Before:** Edit details branch — drafts → onEdit() (route to wizard); non-drafts → onTransitionalToast("Edit-after-publish lands Cycle 9b-2.").
- **After:** Edit details unconditional → onEdit(). The route construction (with or without `?mode=edit-published` query param) lives in the parent's onEdit handler.
- **Why:** Spec §3.B.1 — TRANSITIONAL toast removed.
- **Lines changed:** ~-7 net (subtraction-before-addition per Const #8 — the "Cycle 9b-2 lands later" branch GONE).

### `mingla-business/app/event/[id]/index.tsx` (MOD — handleEdit)
- **Before:** `router.push(\`/event/${id}/edit\`)` — would bounce live events to home.
- **After:** `router.push(\`/event/${id}/edit?mode=edit-published\`)` — EventDetail is live-only (drafts redirect before reaching here), so always edit-published.
- **Why:** Spec §3.B routing.
- **Lines changed:** ~+5 / -1 net.

### `mingla-business/app/(tabs)/events.tsx` (MOD — handleManageEdit)
- **Before:** `router.push(\`/event/${manageCtx.event.id}/edit\`)` — silent bounce for non-drafts.
- **After:** Append `?mode=edit-published` when `manageCtx.kind !== "draft"`. Drafts route unchanged.
- **Why:** Spec §3.B routing.
- **Lines changed:** ~+5 / -1 net.

---

## 4 — Spec traceability

| AC | Adapted to deviation | Status |
|----|---------------------|--------|
| 9b2-AC#1 — Manage menu (live) → Edit details → /event/{id}/edit?mode=edit-published | EventManageMenu + handleManageEdit + handleEdit | UNVERIFIED — needs runtime smoke |
| 9b2-AC#2 — EditAfterPublishBanner renders | EditPublishedScreen renders banner unconditionally | PASS by construction |
| 9b2-AC#3 — Locked fields render with disabled style + lock icon | DEVIATION — single-screen has no locked inputs to gate (only mutable ones rendered). Locked-fields-explainer GlassCard substitutes the visual cue. | PASS (deviation) |
| 9b2-AC#4 — Tap locked field → toast | DEVIATION — locked fields aren't shown, so no tap path exists | N/A (deviation) |
| 9b2-AC#5 — Editable description accepts edits | Multiline TextInput | UNVERIFIED — needs runtime smoke |
| 9b2-AC#6 — Cover hue swatch picker accepts changes | 6-tile picker with EventCover preview | UNVERIFIED — needs runtime smoke |
| 9b2-AC#7 — CTA reads "Save changes" | Sticky bottom Button label "Save changes" | PASS by construction |
| 9b2-AC#8 — No changes → toast "No changes." | handleSavePress branches on diffs.length===0 | UNVERIFIED — needs runtime smoke |
| 9b2-AC#9 — Save with changes → ChangeSummaryModal opens with diffs | computeFieldDiffs + ChangeSummaryModal | UNVERIFIED — needs runtime smoke |
| 9b2-AC#10 — Confirm save → updateLiveEventEditableFields fires + toast + router.back | handleReviewConfirm | UNVERIFIED — needs runtime smoke |
| 9b2-AC#11 — Public event page reflects edits | LiveEvent mutated; PublicEventPage re-reads from store on focus | PASS by construction |
| 9b2-AC#12 — Cancel ChangeSummaryModal → returns to editor | handleReviewClose | PASS by construction |
| 9b2-AC#13 — Discard wizard → no leak | Local state only; useState unmounts cleanly. No persisted shadow draft. | PASS by construction |
| 9b2-AC#14 — Re-open same event → fresh state | initialValues memo seeds from LiveEvent on mount | PASS by construction |
| 9b2-AC#15 — TypeScript strict EXIT=0 | tsc --noEmit | **PASS** |
| 9b2-AC#16 — NO regression on existing draft flow (Cycle 3 wizard) | edit.tsx default branch unchanged | UNVERIFIED — needs smoke |
| 9b2-AC#17 — NO regression on Cycle 9a/9b-1 | Surgical changes only — manage menu Edit unchanged in shape, just removes TRANSITIONAL toast | UNVERIFIED — needs smoke |

---

## 5 — Verification output

### tsc strict
```
$ cd mingla-business && npx tsc --noEmit; echo "EXIT=$?"
EXIT=0
```

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src/components/event mingla-business/app/event
(no matches)
```

### grep useOrderStore (still 0 imports — 9c scope)
```
$ grep -rE "^import.*useOrderStore|from.*orderStore" mingla-business
(no matches)
```

---

## 6 — Invariant Verification

| ID | Status |
|----|--------|
| I-11..I-17 | All preserved — no schema changes; LiveEvent shape unchanged |
| Const #1 No dead taps | PRESERVED — all controls wire (back / save / hue tiles / Confirm / Cancel) |
| Const #2 One owner per truth | PRESERVED — LiveEvent stays the canonical store; edits flow through new mutation |
| Const #3 No silent failures | PRESERVED — no-changes toast surfaces; submit error path absent (no real backend yet) |
| Const #6 Logout clears | PRESERVED — local state, lives only on screen mount |
| Const #7 TRANSITIONAL labels | HONORED — TRANSITIONAL removed (the "Cycle 9b-2 lands later" toast is GONE) |
| Const #8 Subtract before adding | HONORED — manage menu's TRANSITIONAL toast REMOVED before real wire-up added |
| Const #9 No fabricated data | PRESERVED — diffs reflect real before/after values; coverHue renders the actual selected hue |
| Const #10 Currency-aware UI | N/A this cycle |
| Const #14 Persisted-state startup | PRESERVED — local state doesn't persist; cold start opens fresh edit screen with current LiveEvent values |

---

## 7 — Cache Safety

No query keys touched. `useLiveEventStore` selector reads `events.find` directly (no caching layer). Mutation immediately updates the persisted Zustand store; downstream consumers (PublicEventPage, EventDetail, EventListCard) re-render on store change automatically.

Defense-in-depth at store layer: `updateLiveEventEditableFields` filters patch keys to only `description`/`coverHue` even if caller sends extras.

---

## 8 — Regression Surface (tester verify)

5 features most likely to break:

1. **Cycle 3 wizard / draft creation flow** — edit.tsx default branch must work identically. Open a draft from Drafts pill → wizard opens normally.
2. **Cycle 9a EventDetail** — handleEdit now appends `?mode=edit-published`. Verify EventDetail's manage menu's Edit details opens the new EditPublishedScreen.
3. **Cycle 9a Events tab** — manage menu Edit details on a draft (kind="draft") still routes to wizard without the mode query param. Verify both paths.
4. **Cycle 9b-1 lifecycle actions** — End sales / Cancel / Delete still work (no shared code touched).
5. **Cycle 6 PublicEventPage** — after saving an edit (description or coverHue change), confirm the public event page reflects the new value (it reads LiveEvent from store).

---

## 9 — Discoveries for Orchestrator

**D-IMPL-CYCLE9b2-1 (Note severity)** — Spec deviation (single-screen vs wizard mode) was approved by orchestrator before implementation. Documented in §1. Future B-cycle work that adds tagline/FAQ/social links to LiveEvent schema will extend `EditableValues` + EditPublishedScreen sections; if the editable surface grows beyond ~5 fields, wizard reuse can be revisited then.

**D-IMPL-CYCLE9b2-2 (Note severity)** — `EditPublishedScreen` uses bare RN TextInput for the description field (multiline) rather than the kit Input primitive (single-line). This mirrors how step bodies in the wizard use bare TextInput for multiline fields (Step 1 description). If the kit eventually adds a multiline Input variant, EditPublishedScreen migrates cleanly.

**D-IMPL-CYCLE9b2-3 (Note severity)** — `updateLiveEventEditableFields` defensively filters patch keys (only description + coverHue allowed). If a future caller accidentally passes `name` or `date`, it's silently dropped. This is intentional defense-in-depth per spec §3.B.1; the EditPublishedScreen UI is the primary guard.

**D-IMPL-CYCLE9b2-4 (Low severity)** — Save flow uses 800ms simulated processing (matches Q-9-3 timing convention for stub mutations). When B-cycle wires real Supabase, replace the sleep with the actual API call + error handling. Existing TRANSITIONAL convention applies.

**D-IMPL-CYCLE9b2-5 (Low severity)** — Toast from EditPublishedScreen self-positions via Modal portal (per the revised memory rule). No toastWrap. Behavior consistent with all other Cycle 9 toasts.

**D-IMPL-CYCLE9b2-6 (Note severity)** — `EditPublishedScreen` discards local edits on unmount via React's natural useState lifecycle. NO confirmation dialog if user has unsaved edits and hits back. This is intentional for stub mode — adding a "discard changes?" guard would require lift to React Navigation's beforeRemove pattern (similar to Cycle 8 Confirmation back-block but with disarm flag for save flow). Could be added in a polish dispatch if user smoke surfaces accidental discard concerns.

**No other side issues.**

---

## 10 — Files Touched

| File | Type | LOC |
|------|------|-----|
| `mingla-business/src/utils/liveEventToEditPatch.ts` | NEW | ~110 |
| `mingla-business/src/components/event/EditAfterPublishBanner.tsx` | NEW | ~85 |
| `mingla-business/src/components/event/ChangeSummaryModal.tsx` | NEW | ~190 |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | NEW | ~410 |
| `mingla-business/src/store/liveEventStore.ts` | MOD | ~+25 |
| `mingla-business/app/event/[id]/edit.tsx` | MOD | ~+45 / -10 |
| `mingla-business/src/components/event/EventManageMenu.tsx` | MOD | ~-7 net (subtraction) |
| `mingla-business/app/event/[id]/index.tsx` | MOD | ~+5 / -1 |
| `mingla-business/app/(tabs)/events.tsx` | MOD | ~+5 / -1 |

4 NEW + 5 MOD (the dispatch said 4 MOD; events.tsx/event/[id]/index.tsx/edit.tsx + EventManageMenu + liveEventStore = 5 MOD). ~+870 / -20 (net ~+850).

(Forensics estimated 500–700 LOC for full wizard-mode approach + shadow draft. Single-screen deviation lands at ~870 LOC because EditPublishedScreen is more complete than expected — banner + description + hue picker + locked explainer + ChangeSummaryModal integration + sticky dock + keyboard handling. Still well under the original wizard-mode estimate's combined complexity.)

---

## 11 — Cycle 9c handoff notes

Cycle 9b is now FULLY closed (9b-1 + 9b-2). 5 of 8 Cycle 9 journeys delivered:
- ✅ J-E13 (Event Detail) — 9a
- ✅ J-E14 (Events list filter pills) — 9a
- ✅ J-E15 (Manage menu) — 9a + 9b-1 + 9b-2
- ✅ J-E17 (Share) — 9a (Cycle 7 ShareModal reuse)
- ✅ J-E9 (End ticket sales) — 9b-1
- ✅ J-E10 (Cancel event) — 9b-1
- ✅ J-E11 (Edit-after-publish) — 9b-2 (single-screen deviation)
- ✅ Delete draft — 9b-1

Remaining 6 of 8 — all Cycle 9c (Orders ops):
- J-M1 Orders list
- J-M2 Order detail
- J-M3 Refund full
- J-M4 Refund partial
- J-M5 Cancel order
- J-M6 Resend ticket

9c also wires the cross-cycle dependency: useOrderStore (NEW) ← Cycle 8 confirm.tsx (1-line addition). After that wires, EventListCard's soldCount + EventDetail's revenue + activity feed all populate from real (stub) buyer purchases.

---

## 12 — Smoke priorities (what user should test first)

1. **Web Chrome — Edit live event happy path** — Live event card → ⋯ → Edit details → EditPublishedScreen opens with description prefilled + coverHue selected → change description → tap a different cover hue tile → tap "Save changes" → ChangeSummaryModal lists 2 diffs → Confirm → 800ms → toast "Saved. Live now." → back to /event/{id} → verify hero status pill + EventDetail render new values.
2. **No-changes path** — Open Edit screen → don't change anything → tap Save changes → toast "No changes to save." Stay on edit screen.
3. **Cancel flow** — Open Edit → change description → tap back arrow → no save dialog → returns to /event/{id} → verify original description preserved.
4. **ChangeSummaryModal Cancel** — Edit something → Save → modal opens → tap Cancel → returns to editor with pending edits intact.
5. **Public event page reflects edit** — After saving a description change, navigate to /e/{brandSlug}/{eventSlug} → confirm new description shows.
6. **iOS sim** — Same flows + keyboard handling on description Input (must scroll above keyboard).
7. **Regression — Cycle 3 wizard / drafts** — Open a draft from Drafts pill → wizard opens normally (no edit-published mode).
8. **Regression — Cycle 9b-1 lifecycle** — End sales + Cancel event + Delete draft all still work.
