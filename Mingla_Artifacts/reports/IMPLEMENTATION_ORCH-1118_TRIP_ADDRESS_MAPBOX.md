# IMPLEMENTATION — ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]

**Skill:** mingla-implementor (business side)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1118-[trip-address-mapbox-validation]/`
**Branch:** `ORCH-1118-trip-address-mapbox-validation` (rebased onto origin/main at start)
**Date:** 2026-06-12
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1118_TRIP_ADDRESS_MAPBOX.md` (binding; [DECISION-REVISED 2026-06-12] departure HARD-REQUIRED honored)
**Implementation commit:** `4134676e2`

---

## 1. Summary

A trip's **Departing from** and **Destination** fields previously accepted free-typed
text with no coordinates on both authoring surfaces (create wizard + published-edit
screen). This change makes both fields behave like experience-stop addresses: typing
nulls the structured fields (placeId/lat/lng), and a trip cannot be **published**
(create) or **saved** (edit) unless BOTH departure AND destination are confirmed Mapbox
picks. Per Seth's override of ORCH-1016, an EMPTY departure is INVALID (hard-required,
identical to destination). The published-edit screen's two plain `TextInput`s are swapped
for the same `MapboxAddressInput` already used on the create wizard. A one-time,
confidence-gated backfill script (dry-run-validated; live write operator-gated) is
delivered for the 5 existing dirty rows. Pure host-side fix: no DB migration, no
edge-function change, no `biz_update_live_trip` change.

**Departure hard-required gate CONFIRMED implemented:** `departureLocationValidated`
returns `false` for empty text (`tripPlacePicked(placeId,lat,lng)` only; no text-empty
escape branch). Both the create publish gate and the edit save gate block on an empty OR
dirty departure. Proven by `tripLocationValidated.test.ts` T-3 (empty → false) and the
fails-on-revert deletion (loosening departure to "empty valid" makes T-3 fail).

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Satisfied by (commit `4134676e2`) |
|----|-------------|--------|-----------------------------------|
| SC-1 | Create: type-without-pick clears coords (both fields) | ✓ | `TripCreatorStep1Basics.tsx` both `onChangeText` null placeId/lat/lng; T-4 |
| SC-2 | Create: publish blocked on unvalidated destination (jump + inline + toast + disabled) | ✓ | `TripCreatorWizard.tsx` `handlePublishTap` belt + disabled suspenders; T-5 |
| SC-3 | Create: publish blocked on dirty OR EMPTY departure (hard-required) | ✓ | `departureLocationValidated` (empty=invalid) + `tripLocationValid` memo; T-3/T-5 |
| SC-4 | Create: valid path (both picked) publishes | ✓ | gate passes only when both `*Validated` true; confirm dialog unchanged |
| SC-5 | Edit: fields are MapboxAddressInput (dropdown, not text box) | ✓ | `EditPublishedTripScreen.tsx` two `<MapboxAddressInput`; T-6 |
| SC-6 | Edit: type-without-pick clears coords | ✓ | edit `onChangeText` null placeId/lat/lng; T-8 |
| SC-7 | Edit: save blocked on unvalidated (dest + empty/dirty departure) | ✓ | `handleSavePress` gate + `setShowEditAddressErrors`; T-7 |
| SC-8 | Edit: valid path saves (diff-builder emits structured keys unchanged) | ✓ | `buildLiveTripPatch` already emits `destination*`/`departure*`; gate passes |
| SC-9 | Refund behavior unchanged | ✓ | `classifyTripSeverity` untouched; only input method changed |
| SC-10 | Backfill safety + idempotency | ✓ | `scripts/orch-1118-backfill-trip-coords.ts` confidence gate + skip-on-coords; T-9/T-10 |
| SC-11 | No shared-field change (git diff empty for do-not-touch) | ✓ | verified empty (§8) |

Parity is automatic (shared RN code) → iOS/Android/Web share each SC; no per-surface rows.

---

## 3. Files changed (commit `4134676e2`)

| File | Type | ~lines |
|------|------|--------|
| `mingla-business/src/components/trip/tripLocationValidated.ts` | NEW | +66 |
| `mingla-business/src/components/trip/__tests__/tripLocationValidated.test.ts` | NEW | +78 |
| `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` | MOD | +60 / -6 |
| `mingla-business/src/components/trip/TripCreatorWizard.tsx` | MOD | +48 / -3 |
| `mingla-business/src/components/trip/__tests__/TripCreatorStep1Basics.mapbox.test.ts` | EXTEND | +63 |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | MOD | +96 / -28 |
| `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.mapbox.test.ts` | NEW | +97 |
| `mingla-business/src/components/trip/__tests__/orch1118Backfill.dryrun.test.ts` | NEW | +130 |
| `scripts/orch-1118-backfill-trip-coords.ts` | NEW | +355 |
| `Mingla_Artifacts/reports/ORCH-1118_BACKFILL_FLAGGED.md` | NEW | +35 |

> The dry-run test (`orch1118Backfill.dryrun.test.ts`) is the implementor's committed
> proof of the backfill confidence gate + idempotency (T-9/T-10), which the SPEC §7
> assigns to the implementor. It is append-only and outside the touched product files.

---

## 4. Data-model changes applied

**None.** No migration, no schema/constraint/index/RLS change. Coordinates remain
nullable (drafts hold partial state; enforcement is app-side, matching experiences).
The backfill is a runtime geocode + per-row UPDATE (operator-gated), not a migration.

---

## 5. Edge functions touched

**None.** `supabase/functions/mapbox-geocode` is consumed unchanged (the backfill script
calls Mapbox Search Box `/forward?limit=5` directly to read `match_code`/`feature_type`
which the edge fn strips). `verify_jwt` values unchanged across the board.

---

## 6. Regression tests added (fails-on-revert proof)

All proofs are TRUE line-deletion of the fix from commit `4134676e2`, re-run (FAIL),
restore, re-run (PASS).

| Test file | Cases | Fails-on-revert proof |
|-----------|-------|------------------------|
| `tripLocationValidated.test.ts` | T-1..T-3 (9) | Loosened `departureLocationValidated` to "empty=valid" → **T-3 FAILED** (`null` departure expected false, got true). Restored → PASS. `fails-on-revert verified at 4134676e2`. |
| `TripCreatorStep1Basics.mapbox.test.ts` | T-4/T-5 (+ORCH-1079) (8) | Reverted departure `onChangeText` to text-only → **T-4 FAILED**. Restored → PASS. Removed `handlePublishTap` `!tripLocationValid` guard → **T-5 FAILED**. Restored → PASS. `fails-on-revert verified at 4134676e2`. |
| `EditPublishedTripScreen.mapbox.test.ts` | T-6/T-7/T-8 (5) | Removed save gate → **T-7 FAILED**. Restored → PASS. Reverted destination field to `TextInput` → **T-6 FAILED** (MapboxAddressInput count 1 ≠ 2). Restored → PASS. `fails-on-revert verified at 4134676e2`. |
| `orch1118Backfill.dryrun.test.ts` | T-9/T-10 (9) | Pure-function gate/idempotency proof (no network); 9/9 PASS. |

Final full-suite run at committed state: **31/31 PASS** across the 4 files.

---

## 7. Old → New receipts

### tripLocationValidated.ts (NEW)
**Before:** no shared predicate; each screen handled its own (or no) validation.
**Now:** `tripPlacePicked` + `destinationLocationValidated` + `departureLocationValidated`
(both hard-required; empty=INVALID, dirty=INVALID) + `TRIP_*_PICK_ERROR` copy constants.
**Why:** SC-1..SC-8 single-source-of-truth; mirrors `stopHasValidatedLocation`.

### TripCreatorStep1Basics.tsx
**Before:** both `onChangeText` wrote only `*LocationText` (coords lingered/null); no error.
**Now:** both `onChangeText` also null placeId/lat/lng; new `showAddressErrors` prop drives
inline `error` on each `MapboxAddressInput` via the field-level predicates.
**Why:** SC-1 + SC-2/SC-3 inline-error surface.

### TripCreatorWizard.tsx
**Before:** publish gated only on Stripe; no location requirement.
**Now:** `tripLocationValid` memo (both fields) + `showStep1AddressErrors` state; belt in
`handlePublishTap` (block + `setStep(1)` + reveal errors + toast before the confirm dialog)
+ suspenders on the disabled Publish button + prop passthrough.
**Why:** SC-2/SC-3/SC-4.

### EditPublishedTripScreen.tsx
**Before:** departure + destination were plain `TextInput`s writing only `*LocationText`;
save had no location gate.
**Now:** both swapped for `MapboxAddressInput` (null-on-type, `onPick` writes full pick,
inline `error`); testIDs moved onto the wrapping `View`s (the wrapper takes no testID prop —
do-not-touch); `handleSavePress` gate blocks an unvalidated/empty departure or destination
(reveal errors + expand basics + toast) before `setModal`.
**Why:** SC-5/SC-6/SC-7/SC-8. The diff-builder already emitted the structured keys → no
plumbing change, refund classifier (SC-9) untouched.

### scripts/orch-1118-backfill-trip-coords.ts (NEW)
**Before:** 5 live trips carry destination text with null coords; no remediation.
**Now:** idempotent, confidence-gated forward-geocode (settlement feature_type + match_code
exact/high + >25km tie-break); writes coords ONLY on a confident match; flags ambiguous rows
to `ORCH-1118_BACKFILL_FLAGGED.md`; **DRY-RUN by default** (no writes), `--live` operator-gated.
**Why:** SC-10 (decision #2).

---

## 8. Cross-surface impact

| Surface | Affected | Note | Parity |
|---------|----------|------|--------|
| Consumer iOS | NO | read-only beneficiary (coords land) | — |
| Consumer Android | NO | same | — |
| Buyer/anon Web | NO | no trip address authoring | — |
| Business iOS | YES | both authoring UIs gated | shared RN code |
| Business Android | YES | identical (shared components) | automatic |
| Admin Web | NO | no trip address authoring | — |
| Business Web preview (adjacent) | YES | same RN components, no `Platform.OS` branch in new logic | automatic |

**Do-not-touch git-diff-empty confirmation (verified):**
`git diff origin/main --name-only` over `packages/location-input/`,
`mingla-business/src/components/location/MapboxAddressInput.tsx`,
`mingla-business/src/components/experience/*` (ExperienceStopCard / experienceWizardTypes /
ExperienceCreatorWizard), `supabase/functions/mapbox-geocode/`, and `supabase/migrations/`
returned **EMPTY**. The 4 business desktop-web contract gates (`test:orch-0885-a`,
`BottomNavWebDesktopPolish`, `wizardDesktopLayout`, `homeKpiPresentation`,
`useResponsiveLayout`) all PASS — no desktop-contract regression.

---

## 9. Smoke / verification result

- **Jest:** 4 ORCH-1118 suites 31/31 PASS; 4 desktop-web contract gates PASS.
- **Typecheck:** `npx tsc --noEmit` produces ZERO errors in any ORCH-1118 touched file.
  Pre-existing baseline errors remain in unrelated files (checkout buyer pages, marketing
  composer, `packages/phone-input`, event `category` tests) — present on origin/main, NOT
  introduced here.
- **Runtime dead-tap + DB-persist:** NOT run by the implementor (RESERVED for the tester per
  SPEC §7 — drive the edit screen on device, confirm the dropdown mounts, a real pick persists
  coords through `biz_update_live_trip`, and the save gate fires at runtime). Source-char tests
  prove wiring; tester proves the control fires.

---

## 10. Known issues / deferred

- **Backfill live run is OPERATOR-GATED.** The implementor delivered + dry-run-validated the
  confidence gate + idempotency via fixtures (no live secrets in session). The actual
  production read/write (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `MAPBOX_ACCESS_TOKEN`)
  is Seth's call: run dry-run first, inspect `ORCH-1118_BACKFILL_FLAGGED.md`, then `--live`.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

1. **No migration, no edge deploy.** Pure-JS RN change → OTA per `[[project_ota_deferred_until_new_build]]` (no native build needed) after merge.
2. **Backfill (after merge, operator-gated):**
   ```bash
   cd "/path/to/merged/main" && \
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… MAPBOX_ACCESS_TOKEN=… \
   npx tsx scripts/orch-1118-backfill-trip-coords.ts          # dry-run (no writes)
   # inspect Mingla_Artifacts/reports/ORCH-1118_BACKFILL_FLAGGED.md, then:
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… MAPBOX_ACCESS_TOKEN=… \
   npx tsx scripts/orch-1118-backfill-trip-coords.ts --live   # operator-approved write
   ```
   (Use `node` with a TS loader if `tsx` is unavailable.)

---

## 12. Discoveries for Orchestrator

- **D-1:** `mingla-business` has a pre-existing tsc baseline of unrelated errors (checkout
  buyer pages `next/nextIso/name` implicit-any, marketing ComposerV2, `packages/phone-input`
  + `packages/brand-rendering` cannot resolve `react`, event `category` test fixtures). None
  blocks this ORCH; flagged for a future hygiene pass — the business package does not enforce a
  clean `tsc --noEmit` gate today.
- **D-2:** The backfill could not be live-dry-run in-session (no secrets); the flagged report is
  a placeholder the script overwrites on the operator's first run. Confidence-gate + idempotency
  logic is proven via fixtures.
- **No comms-ledger entry written** (no cross-ORCH discovery). COMMS-0024 (ID collision) noted —
  ORCH-1118 is this session's assigned ID per the dispatch; no renumber needed here.

---

*Implementation complete. Routed back to orchestrator for REVIEW → tester (runtime dead-tap + DB-persist proof). No deploy / merge / close performed.*

---

## REWORK — 2026-06-12 (P1-EDIT-STALE-ERROR, tester runtime render-proof)

### Defect (tester)

`mingla-business/src/components/trip/EditPublishedTripScreen.tsx` — the basics render
reads `showEditAddressErrors` to drive each `MapboxAddressInput`'s `error` prop (departure
~L1172, destination ~L1215), but `renderSectionBody`'s `useCallback` dependency array
(L1441–1453) **omitted `showEditAddressErrors`**. After `handleSavePress` called
`setShowEditAddressErrors(true)`, the memoized section body retained the stale `false`, so
the SPEC-required inline per-field "Pick the … from the suggestions." errors (SC-6 / SC-7)
**never rendered**. The save-block + toast already worked; only the inline field hint was
missing. Caught by the tester's runtime react-native-testing-library render-proof
(`EditPublishedTripScreen.render.test.tsx`, case `(b1-inline-error)` RED).

### Fix (one line — minimal, no logic/gate/refactor change)

Added `showEditAddressErrors` to the `renderSectionBody` `useCallback` dependency array.

**Dep array — before (L1441–1453):**

```
    [
      editState,
      updateBasics,
      handleDaysChange,
      handleInclusionsChange,
      handlePricingChange,
      handleCoverChange,
      submitting,
      totalConfirmedOrders,
      soldCountByTier,
      trip,
      showToast,
    ],
```

**Dep array — after:**

```
    [
      editState,
      showEditAddressErrors,
      updateBasics,
      handleDaysChange,
      handleInclusionsChange,
      handlePricingChange,
      handleCoverChange,
      submitting,
      totalConfirmedOrders,
      soldCountByTier,
      trip,
      showToast,
    ],
```

Diff is exactly one inserted line (`git diff origin/main` over the source file = `+      showEditAddressErrors,`).

### Other-stale-read audit (same callback)

Inspected every state read inside `renderSectionBody`. The only ORCH-1118-relevant state
read missing from the dep array was `showEditAddressErrors`. One UNRELATED pre-existing
omission exists — `coverPickerVisible` (read in the `cover` case at ~L1352) is also absent
from the dep array — but it is OUTSIDE ORCH-1118 scope (cover-picker visibility, not address
validation) and pre-dates this ORCH on origin/main, so it was deliberately NOT touched.
Flagged below as a discovery for the orchestrator.

### Verification

- **Render-proof** (`npx jest --config jest.orch1118.render.cjs --runInBand`):
  **5 passed, 5 total** — `(b1-inline-error)` flipped GREEN; the other 4 cases stayed green.
- **Fails-on-revert proof:** deleted the `showEditAddressErrors,` line (true line deletion)
  → re-ran render-proof → `(b1-inline-error)` FAILS (`1 failed, 4 passed, 5 total`) while the
  other 4 stay green → restored the line → all 5 green again. The render-proof exercises the
  exact bug.
- **Standard ORCH-1118 suites** (`jest.config.cjs`, 5 files: tripLocationValidated /
  tripLocationGate.adversarial / TripCreatorStep1Basics.mapbox /
  EditPublishedTripScreen.mapbox / orch1118Backfill.dryrun): **5 passed, 36 total** — green.
- **4 desktop-web contract gates:** `test:orch-0885-a` (strict-grep + useResponsiveLayout)
  PASS · `BottomNavWebDesktopPolish` PASS · `wizardDesktopLayout` PASS ·
  `homeKpiPresentation` PASS — no desktop-contract regression.

### Hard-guard compliance

DO-NOT-TOUCH list untouched (`packages/location-input`, business `MapboxAddressInput`
wrapper, `ExperienceStopCard`, the ORCH-1016 trigger, `biz_update_live_trip`, migrations,
edge functions). No scope widening. No deploy / merge / OTA.

### REWORK discoveries for orchestrator

- **D-3 (pre-existing, out of ORCH-1118 scope):** `renderSectionBody`'s dep array also omits
  `coverPickerVisible` (cover case ~L1352). Same class of stale-memo bug, but unrelated to
  address validation and present on origin/main. NOT fixed here to honor the minimal-change
  REWORK guard. Recommend a future hygiene ORCH (or an `eslint-plugin-react-hooks`
  exhaustive-deps gate) to catch this whole class.
- **D-4 (env, not introduced here):** `src/components/__tests__/desktopWebLayoutContracts.test.ts`
  has a failing case (`keeps Home desktop KPIs fixed … scrollEnabled={!isWideDesktop}`) that
  fails identically on a clean origin/main checkout — the expected substring is absent from
  `app/(tabs)/home.tsx` on origin/main (grep count 0). It is NOT one of the report's named
  4 contract gates and is unrelated to this fix; flagged as pre-existing.

*REWORK complete. Routed back to orchestrator for RETEST → CLOSE.*
