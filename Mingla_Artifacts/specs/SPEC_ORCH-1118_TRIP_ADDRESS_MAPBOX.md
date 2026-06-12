# SPEC — ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]

**Skill:** mingla-forensics (SPEC mode)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1118-[trip-address-mapbox-validation]/`
**Branch:** `ORCH-1118-trip-address-mapbox-validation` (rebased onto origin/main — 0 behind at SPEC time)
**Date:** 2026-06-11
**Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1118_TRIP_ADDRESS_MAPBOX.md` (PROVEN; this SPEC builds on it and does NOT re-investigate).
**Comms ledger:** read on entry. No BLOCK entries for ORCH-1118 / mingla-forensics / ALL. COMMS-0021 (WARN/ALL, provider-neutral seller-payout copy) factored — it does NOT touch any trip address file and no new copy in this SPEC names a payment provider. COMMS-0023 (WARN, scoped to ORCH-1110) not addressed to this ORCH. Migration-version collision scan run (see §4.1).

---

## 1. Executive summary

A trip's **Departing from** and **Destination** fields currently accept arbitrary free-typed text that was never confirmed against a Mapbox suggestion, persisting a city string with **null coordinates** (proven: 5/5 production trips with a destination have null `placeId`/`lat`/`lng`). This SPEC makes both fields behave exactly like experience-stop address fields: **typing without picking a suggestion clears the structured fields (placeId/lat/lng), and a trip cannot be PUBLISHED (create wizard) or SAVED (published-edit screen) while either field holds typed-but-unvalidated text.** It does this on the two — and only two — trip authoring UIs, factors one shared `tripLocationValidated` predicate mirroring the proven `stopHasValidatedLocation`, replaces the published-edit screen's two plain `TextInput`s with the same `MapboxAddressInput` already used on the create wizard, and one-time backfills the 5 existing dirty rows via a confidence-gated geocode (never guessing on ambiguity). Pure host-side fix: no change to the shared picker, the edge function, or `biz_update_live_trip`.

---

## 2. Scope & non-goals

### In scope
1. **Create wizard** (`TripCreatorStep1Basics.tsx` + `TripCreatorWizard.tsx`): harden both `onChangeText` handlers to null the structured fields on keystroke; show inline "pick from suggestions" errors when a field is dirty-unvalidated and errors are revealed; gate **publish** on both departure AND destination being confirmed Mapbox picks.
2. **Published-edit screen** (`EditPublishedTripScreen.tsx`): replace the two plain `TextInput`s with `MapboxAddressInput` wired into the existing structured-field diff-builder; gate **Save** on the same predicate; inline errors.
3. **Shared predicate** (`tripLocationValidated.ts`, NEW): one helper mirroring `stopHasValidatedLocation`, consumed by both screens + tests.
4. **One-time backfill** of the ≤5 existing dirty rows (decision #2): confidence-gated forward-geocode; ambiguous rows left null and flagged for manual review.
5. **Regression tests:** extend `TripCreatorStep1Basics.mapbox.test.ts` (typed-but-unpicked ⇒ invalid ⇒ publish blocked) + NEW `EditPublishedTripScreen` test (uses MapboxAddressInput + null-coords-on-type + save gate) + NEW unit test for the shared predicate.

### Non-goals (explicit)
- **NOT** changing whether destination is editable on a live trip — it is editable today and stays editable (decision #3). No new refund/notify behavior; the `EditPublishedTripScreen` refund-severity classifier (`classifyTripSeverity`) is untouched. This ORCH changes only the **input method** (free-text → validated pick).
- **NOT** modifying the shared `packages/location-input/*` field, the business `MapboxAddressInput` wrapper, `ExperienceStopCard`, the ORCH-1016 trigger, or the `biz_update_live_trip` RPC (consume, do not modify — see §Allowlist).
- **NOT** adding a DB-level NOT NULL constraint on coordinates (drafts legitimately hold partial state; the schema cannot enforce a pick — enforcement is app-side, matching experiences).
- **[DECISION-REVISED 2026-06-12]** Departure is now **HARD-REQUIRED** (Seth, overriding ORCH-1016's optional-departure design): a trip CANNOT publish (create) or save (edit) with a blank OR unvalidated departure — both departure AND destination must be confirmed Mapbox picks. An EMPTY departure is INVALID and blocks publish/save, same as a dirty (typed-but-unpicked) one. Existing scheduled trips with no departure stay live as-is, but cannot be re-published/re-saved until a real departure is picked. (This supersedes the earlier "empty departure valid" reconciliation throughout this SPEC.)
- **NOT** changing consumer discovery / proximity (downstream beneficiary only; no consumer code touched).

### Assumptions
- The shared `MapboxAddressInput` `error?: string` prop renders an inline error (proven: `ExperienceStopCard` passes `error={addrError}`). The business wrapper forwards it (`MapboxAddressInput.tsx:45,123,134`).
- `LocalTripEditState` already carries `departure*`/`destination*` placeId/lat/lng (proven: `EditPublishedTripScreen.tsx:179-187`), and `buildLiveTripPatch` already emits all of them (lines 316-348) — so the picker swap needs no new diff-builder plumbing.

---

## 3. Cross-Surface Impact Declaration (per-surface)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | Read-only beneficiary; data quality improves (coords land). | none | — |
| 2 | Consumer Android | NO | Same. | none | — |
| 3 | Buyer/anon Web | NO | No trip address authoring. | none | — |
| 4 | **Business iOS** | **YES** | Create + edit trip: typing a city without picking shows "Pick the … from the suggestions."; can't publish/save until picked. | `TripCreatorStep1Basics.tsx`, `TripCreatorWizard.tsx`, `EditPublishedTripScreen.tsx`, `tripLocationValidated.ts` (new) | shared RN code |
| 5 | **Business Android** | **YES** | Identical to iOS (same RN components; Android opaque-glass policy already satisfied by the existing wrapper tokens — no glass change here). | same as #4 | automatic (shared code) |
| 6 | Admin Web | NO | No trip address authoring. | none | — |
| 7 | Business Web preview (adjacent) | **YES (automatic)** | Same RN components render under Expo Web; the validated-pick gate is platform-agnostic (no `Platform.OS` branch in the new logic). The Mapbox dropdown already works on web. | same as #4 (no web-specific file) | automatic (shared code) |

**Not-covered reasons:** consumer/admin/buyer-web surfaces have no trip departure/destination authoring path (investigation F-7 enumerated exactly two authoring UIs, both business).

**DESIGN phase needed? NO.** This reuses the already-shipped `MapboxAddressInput` pattern (create wizard ORCH-1079; experience stops META-ORCH-1059) verbatim — the inline-error copy and the disabled-CTA pattern are both already present in the experience wizard. No net-new visual design, no new tokens, no new motion. The only visual delta on the edit screen is swapping a `TextInput` for a `MapboxAddressInput` that already renders in this exact dark-glass token bundle. (If the implementor believes a design pass is needed, that is a stop-and-amend, not a silent addition.)

---

## 4. Layered specification

This is a UI/client-only change plus a one-time data backfill. No new DB objects, no edge-function change, no new hook, no new service. Layers below: **Shared predicate → Create wizard → Edit screen → Backfill**.

### 4.0 Shared predicate (NEW FILE)

**File:** `mingla-business/src/components/trip/tripLocationValidated.ts` (NEW)

Mirror `experienceWizardTypes.ts:72-73` exactly. Export two predicates plus the canonical inline-error copy constants so both screens and tests import one source of truth:

```ts
// A trip location field is "validated" when it carries a confirmed Mapbox pick.
// [REVISED 2026-06-12] BOTH departure and destination are hard-required: empty is
// INVALID for both at the publish/save gate. tripPlacePicked is the single truth.
export const tripPlacePicked = (
  placeId: string | null, lat: number | null, lng: number | null,
): boolean => placeId !== null && lat !== null && lng !== null;
```

The two field-level helpers (each takes the four `*LocationText`/`*PlaceId`/`*Lat`/`*Lng` values) encode the **empty-vs-dirty** rule (§4.6):

- `destinationLocationValidated(text, placeId, lat, lng)`:
  - destination is **REQUIRED** for publish (decision #1) → valid IFF `tripPlacePicked(placeId,lat,lng)` is true. (Empty destination is INVALID for publish; empty is allowed only as transient draft state, which never reaches the publish gate.)
- `departureLocationValidated(text, placeId, lat, lng)`:
  - **[DECISION-REVISED 2026-06-12]** departure is **HARD-REQUIRED + VALIDATED** (Seth overrode ORCH-1016's optional design). Valid IFF `tripPlacePicked(placeId,lat,lng)` is true. Both an EMPTY departure AND a non-empty-but-unvalidated (dirty) departure are INVALID and block publish/save. The `text`-only branch is removed — emptiness no longer passes.

> **[DECISION-REVISED 2026-06-12] Departure hard-required (supersedes the empty-vs-dirty reconciliation below):** Seth confirmed BOTH departure and destination must be confirmed Mapbox picks before publish/save, explicitly overriding ORCH-1016's "departure optional" design. An empty departure is INVALID. Existing departure-less live trips stay live but cannot be re-published/re-saved until a departure is picked. Treat departure and destination identically in the predicate, the gate, the matrix, and the tests. (The original reconciliation rationale is retained below for history only — it is NO LONGER the contract.)
>
> ~~**Empty-vs-dirty rationale (decision #1 reconciliation with ORCH-1016 "departure never gates publish"):** decision #1 says BOTH fields must be validated picks before publish. ORCH-1016 made departure *optional*. These reconcile cleanly as: departure is not *required*, but if the planner typed something into it, that something must be a real pick. An untouched/empty departure does not block publish.~~ (SUPERSEDED — see the revision above. Destination IS required; departure is now ALSO required.)

Inline-error copy constants (export from this file; reuse on both screens — single source):
```ts
export const TRIP_DESTINATION_PICK_ERROR = "Pick the destination from the suggestions.";
export const TRIP_DEPARTURE_PICK_ERROR  = "Pick the departure city from the suggestions.";
```
(Provider-neutral; no payment-provider names. COMMS-0021 satisfied trivially.)

### 4.1 Migration / DB

**No schema migration.** The bug is app-side; coordinates are already nullable and that is correct (drafts hold partial state). The backfill (§4.5) is a runtime geocode + per-row UPDATE, NOT a migration (a SQL migration cannot call Mapbox).

**Migration-version note (for the record / collision scan):** if the implementor disagrees and proposes any SQL, the next free monotonic version in this worktree is `20260928000000` — `20260926000000` is the latest local and `20260927000000` is already taken by sibling worktree `ORCH-1116-[booking-gate-rls]`. But the contract is: **no migration.**

### 4.2 Create wizard — `TripCreatorStep1Basics.tsx`

Two changes to the two `MapboxAddressInput` blocks (departure 364-384, destination 390-410):

**(a) Null structured fields on type** — mirror `ExperienceStopCard.tsx:161-171`. Replace each `onChangeText`:

```tsx
// Departing from
onChangeText={(v) =>
  onChange({
    departureLocationText: v,
    departurePlaceId: null,
    departureLat: null,
    departureLng: null,
  })
}
// Destination — identical shape with destination* keys
```

`onPick` and `onClear` stay exactly as-is (they already write/null the full set).

**(b) Inline error wiring.** Add a prop `showAddressErrors?: boolean` to `TripCreatorStep1BasicsProps` (default false). Compute and pass `error` to each field:
```tsx
const departureError = showAddressErrors && !departureLocationValidated(
  draft.departureLocationText, draft.departurePlaceId, draft.departureLat, draft.departureLng,
) ? TRIP_DEPARTURE_PICK_ERROR : undefined;
const destinationError = showAddressErrors && !destinationLocationValidated(
  draft.destinationLocationText, draft.destinationPlaceId, draft.destinationLat, draft.destinationLng,
) ? TRIP_DESTINATION_PICK_ERROR : undefined;
```
Pass `error={departureError}` / `error={destinationError}` to the respective `MapboxAddressInput`.

### 4.3 Create wizard gate — `TripCreatorWizard.tsx`

**Publish is the gate (decision #1: "before the trip can be PUBLISHED").** Step-1 Continue is NOT hard-blocked (drafts may hold partial state per decision #1); errors reveal at the publish attempt. Wiring:

1. Add a memo mirroring `tripNeedsStripe` (line 408):
```tsx
const tripLocationValid = useMemo(
  () =>
    destinationLocationValidated(step1Draft.destinationLocationText, step1Draft.destinationPlaceId, step1Draft.destinationLat, step1Draft.destinationLng) &&
    departureLocationValidated(step1Draft.departureLocationText, step1Draft.departurePlaceId, step1Draft.departureLat, step1Draft.departureLng),
  [step1Draft.destinationLocationText, step1Draft.destinationPlaceId, step1Draft.destinationLat, step1Draft.destinationLng,
   step1Draft.departureLocationText, step1Draft.departurePlaceId, step1Draft.departureLat, step1Draft.departureLng],
);
```
2. Add state `const [showStep1AddressErrors, setShowStep1AddressErrors] = useState(false)` and pass `showAddressErrors={showStep1AddressErrors}` to `TripCreatorStep1Basics` (mount line 1159).
3. **Belt** — in `handlePublishTap` (line 848), BEFORE the existing `tripNeedsStripe` check, insert:
```tsx
if (!tripLocationValid) {
  setShowStep1AddressErrors(true);
  setStep(1);                                   // jump back to the field
  showToast("Pick the trip's departure and destination from the suggestions.");
  return;                                        // do NOT open the confirm dialog
}
```
4. **Suspenders** — the Step-7 Publish button `disabled` (line 1298) becomes `disabled={submitting || tripNeedsStripe || !tripLocationValid}`.

> The Step-7 review screen already shows a Stripe-needed hint; an address-needed hint there is optional polish and OUT of this ORCH's required scope (the toast + jump-to-Step-1 + revealed inline errors are the contract). Do not add Step-7 copy unless trivially mirroring the Stripe hint; if you do, keep it provider-neutral.

### 4.4 Published-edit screen — `EditPublishedTripScreen.tsx`

**(a) Import** the business `MapboxAddressInput` + the shared predicate/copy:
```tsx
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import { departureLocationValidated, destinationLocationValidated,
  TRIP_DEPARTURE_PICK_ERROR, TRIP_DESTINATION_PICK_ERROR } from "./tripLocationValidated";
```

**(b) Replace the two plain `TextInput`s** (departure 1101-1113; destination 1117-1129) with `MapboxAddressInput`, wired into `updateBasics` (which already merges any `Partial<LocalTripEditState>`):

```tsx
{/* Departing from */}
<MapboxAddressInput
  value={editState.departureLocationText ?? ""}
  accessibilityLabel="Departing from"
  placeholder="e.g. Washington, DC, USA"
  onChangeText={(v) => updateBasics({ departureLocationText: v.trim().length === 0 ? null : v, departurePlaceId: null, departureLat: null, departureLng: null })}
  onPick={(d) => updateBasics({ departureLocationText: d.formattedAddress, departurePlaceId: d.placeId, departureLat: d.location.lat, departureLng: d.location.lng })}
  onClear={() => updateBasics({ departureLocationText: null, departurePlaceId: null, departureLat: null, departureLng: null })}
  error={showEditAddressErrors && !departureLocationValidated(editState.departureLocationText, editState.departurePlaceId, editState.departureLat, editState.departureLng) ? TRIP_DEPARTURE_PICK_ERROR : undefined}
/>
{/* Destination — identical shape, destination* keys, TRIP_DESTINATION_PICK_ERROR */}
```

Keep the surrounding `<View style={styles.fieldGroup}><Text style={styles.fieldLabel}>…</Text>` wrappers and the existing testIDs by passing them through — **preserve `testID="edit-trip-departure"` / `edit-trip-destination`** (the wrapper forwards `accessibilityLabel`; testID is not a wrapper prop, so move the testID onto the surrounding `View` or add `testID` passthrough — see §Implementation note T-ID below).

**(c) Save gate** — add `const [showEditAddressErrors, setShowEditAddressErrors] = useState(false)`. In `handleSavePress` (line 733), AFTER the empty-patch + title checks and BEFORE building the `ChangeSummaryModal` (`setModal(...)` line 756), insert:
```tsx
if (!destinationLocationValidated(editState.destinationLocationText, editState.destinationPlaceId, editState.destinationLat, editState.destinationLng) ||
    !departureLocationValidated(editState.departureLocationText, editState.departurePlaceId, editState.departureLat, editState.departureLng)) {
  setShowEditAddressErrors(true);
  setOpenSection("basics");                       // expand the section holding the fields
  showToast("Pick the trip's departure and destination from the suggestions.");
  return;
}
```

> **Destination-required-on-edit caveat (decision #1 "BOTH screens"):** the gate requires a validated destination to SAVE. Live trips today have a destination already (the 5 dirty rows will be backfilled in §4.5; any that remain null are flagged for manual re-edit). A planner editing a live trip cannot save while the destination is unvalidated free text — this is the intended hardening. **[DECISION-REVISED 2026-06-12]** Departure is treated IDENTICALLY: the save gate also blocks an empty OR unvalidated departure. An existing live trip with no departure cannot be saved until a real departure is picked (Seth-accepted consequence of hard-requiring departure).

**T-ID implementation note:** the business `MapboxAddressInput` wrapper does NOT accept a `testID` prop today. To keep the existing edit-screen testIDs working WITHOUT modifying the do-not-touch wrapper, wrap each field in a `<View testID="edit-trip-departure">` / `<View testID="edit-trip-destination">` (RN testID on a View is queryable). The create-wizard fields have no testID today and need none added. Do not add a testID prop to the wrapper.

### 4.5 One-time backfill (decision #2)

**Mechanism:** a one-time operator-run **Node script** (NOT a migration, NOT an admin UI). It lives at `scripts/orch-1118-backfill-trip-coords.ts` (new; `scripts/` is the established home for one-shots). It is idempotent, read-then-conditional-write, and confidence-gated.

**Why a script, not a migration:** geocoding requires a network call to Mapbox; a SQL migration cannot do that. Per `[[reference_supabase_db_write_paths]]`, the actual row writes go via the Supabase **Management API** (browser UA), or the script may invoke the existing `mapbox-geocode` edge function's `forward` action for geocoding and then issue the UPDATEs. The script is operator-run AFTER merge; it is NOT part of the deploy and does NOT run in CI.

**Per-row algorithm (idempotent):**
1. SELECT trips where `event_type='trip' AND deleted_at IS NULL` AND (`destination_text IS NOT NULL` with null `theme→business_trip→destinationLat`) OR (`departure_text IS NOT NULL` with null departure lat). (Today: 5 destination rows, 0 departure rows.) **Skip any row that already has coords** (idempotency — re-running is safe and writes nothing new).
2. For each dirty text value, call Mapbox **forward geocode** (via the edge fn `forward` action OR Mapbox Search Box `/forward?q=&limit=5`).
3. **Confidence rule (CRITICAL SAFETY — do NOT guess):** accept the geocode result ONLY when it is unambiguous:
   - Mapbox returns a top feature whose `properties.feature_type` is `place`/`region`/`locality`/`country` (a settlement/area, matching what these fields hold), **AND**
   - the top result's `properties.match_code.confidence` is `"exact"` or `"high"` (Mapbox Search Box forward returns `match_code`), **AND**
   - if `limit=5` is used, the SECOND result (if any) must be a clearly different place (different `place` context / >25km away) — i.e. no near-tie. If results tie or confidence is `"medium"`/`"low"`/absent, treat as ambiguous.
   - If the text was originally a real city string (e.g. "Tulum, Quintana Roo, Mexico") this passes; if it is gibberish or a partial that geocodes ambiguously, it FAILS the gate.
4. **On confident match:** UPDATE that row's `theme.business_trip.{destination|departure}{PlaceId,Lat,Lng}` (and normalize `*LocationText` to the canonical `formattedAddress`) AND, for departure, let the ORCH-1016 trigger sync `events.departure_text/geo` (the trigger fires on the theme write — do NOT hand-write `events.departure_geo`). For destination, the canonical `destination_text` is already populated; the script writes coords into `theme.business_trip` only (consumer discovery reads `destination_text` + future proximity reads coords).
5. **On ambiguous / no-match / low-confidence:** **DO NOT WRITE.** Append the row id + text + reason to a report file `Mingla_Artifacts/reports/ORCH-1118_BACKFILL_FLAGGED.md` (the implementor creates this as the script's output) for manual review. Leave coords null. A null-coord row continues to display its text (no regression) and will be fixed when the planner next re-edits (now gated by §4.4).
6. The script prints a summary: N scanned, N already-had-coords (skipped), N backfilled, N flagged.

**Idempotency proof requirement:** running the script twice MUST backfill nothing on the second run (step 1's "skip rows that already have coords"). The implementor records both runs' summaries in the implementation report.

> The backfill is OPERATOR-GATED: the implementor writes + dry-run-validates the script and reports the dry-run output (which rows WOULD be written vs flagged), but the **live write run is Seth's call** (it mutates production). Decision #2 authorizes the backfill; the orchestrator/Seth executes the live run.

### 4.6 The empty-vs-dirty rule (normative, both screens)

| Field | Empty (no text) | Non-empty + picked | Non-empty + NOT picked |
|-------|-----------------|--------------------|------------------------|
| Destination | INVALID for publish/save (required) | VALID | INVALID (inline error) |
| Departure | INVALID for publish/save (required) **[REVISED 2026-06-12]** | VALID | INVALID (inline error) |

"Picked" = `tripPlacePicked(placeId, lat, lng)` true. "Non-empty" = `text` trimmed length > 0. **[DECISION-REVISED 2026-06-12]** Departure and destination now behave IDENTICALLY — empty is INVALID for both (Seth hard-required departure, overriding ORCH-1016). The "empty-vs-dirty" distinction now applies only to transient draft state, never to the publish/save gate.

---

## 5. Success criteria (per-surface where parity is manual; here parity is automatic so iOS/Android/Web share each SC)

- **SC-1 (create, type-without-pick clears coords):** In the create wizard, typing into Destination after having picked a place nulls `destinationPlaceId/Lat/Lng` immediately (same for Departing from). *Observable:* draft state shows null coords after a keystroke post-pick.
- **SC-2 (create, publish blocked on unvalidated destination):** With Destination = typed free text (no pick), tapping Publish on Step 7 does NOT open the confirm dialog; the wizard jumps to Step 1, shows inline `TRIP_DESTINATION_PICK_ERROR` under the field, and toasts "Pick the trip's departure and destination from the suggestions." The Publish button is also `disabled`.
- **SC-3 (create, publish blocked on dirty OR empty departure) [REVISED 2026-06-12]:** With Destination validly picked but Departing from = typed free text (no pick), Publish is blocked with `TRIP_DEPARTURE_PICK_ERROR`. With Departing from EMPTY, Publish is ALSO blocked by departure (departure is now hard-required).
- **SC-4 (create, valid path publishes) [REVISED 2026-06-12]:** BOTH fields picked (departure must be a real pick too — empty no longer publishes) → Publish opens the confirm dialog as before; nothing else about publish changed.
- **SC-5 (edit, fields are MapboxAddressInput):** On a published/scheduled trip's edit screen, Departing from and Destination render the Mapbox autocomplete (suggestion dropdown), not a plain text box.
- **SC-6 (edit, type-without-pick clears coords):** Typing into the edit-screen Destination after a pick nulls its placeId/lat/lng (same for departure).
- **SC-7 (edit, save blocked on unvalidated):** With edit-screen Destination = typed free text (no pick), tapping Save changes does NOT open the ChangeSummaryModal; the basics section expands, inline error shows, toast fires. **[REVISED 2026-06-12]** Departure is treated identically — an empty OR dirty departure also blocks save (departure hard-required).
- **SC-8 (edit, valid path saves) [REVISED 2026-06-12]:** Picking a real destination AND a real departure (both now required) lets Save proceed to the ChangeSummaryModal exactly as before; `buildLiveTripPatch` emits the structured `destination*`/`departure*` keys (already does — no plumbing change); `biz_update_live_trip` is called unchanged.
- **SC-9 (refund behavior unchanged):** Editing the destination to a new validated place produces the SAME `classifyTripSeverity` outcome it would have produced via the old text field (the diff-builder already emitted destination keys; severity classification is unchanged). No new refund/notify path.
- **SC-10 (backfill safety):** The backfill script writes coords ONLY for confident geocodes; ambiguous/low-confidence rows are left null and listed in `ORCH-1118_BACKFILL_FLAGGED.md`. Re-running writes nothing new (idempotent).
- **SC-11 (no shared-field change):** `packages/location-input/*`, the business `MapboxAddressInput` wrapper, `ExperienceStopCard`, the ORCH-1016 trigger, and `biz_update_live_trip` are byte-unchanged (git diff empty for those paths).

---

## 6. Invariants

### Preserved
- **ORCH-1016 trigger** (`tg_events_sync_departure_from_theme`): departure coords still flow through `theme.business_trip.departureLocationText/Lat/Lng` → `events.departure_text/geo`. The fix writes the same theme keys; the trigger is untouched. *Verified by:* SC-11 git-diff-empty on the migration + the existing ORCH-1016 trigger tests.
- **`biz_update_live_trip` contract:** consumed unchanged; the edit-screen diff-builder already emits the structured keys. *Verified by:* SC-8 + SC-11.
- **I-BRAND-UNIVERSAL-AUTHORING:** unaffected (no kind gating touched).

### NEW (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip)
**`I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED`** (DRAFT)
- **Rule [REVISED 2026-06-12]:** BOTH a trip's destination AND its departure must be confirmed Mapbox picks (`placeId` + `lat` + `lng` all non-null) before the trip can be PUBLISHED (create wizard) or SAVED (published-edit screen). An empty departure is INVALID (Seth hard-required departure, overriding ORCH-1016's optional design). Typing into either field clears its structured fields. Enforced host-side on BOTH and ONLY the two trip authoring UIs (`TripCreatorWizard` Step 1 + `EditPublishedTripScreen`), via the shared `tripLocationValidated` predicate — mirroring the experiences family (`stopHasValidatedLocation` / `stop_address_unvalidated`).
- **Enforcement:** `tripLocationValidated.ts` predicate + create-wizard publish gate (belt in `handlePublishTap`, suspenders on the disabled Publish button) + edit-screen save gate in `handleSavePress`; both fields use `MapboxAddressInput` with null-coords-on-type.
- **Regression test (fails-on-revert):** `TripCreatorStep1Basics.mapbox.test.ts` (extended) + `EditPublishedTripScreen.mapbox.test.ts` (new) + `tripLocationValidated.test.ts` (new) — see §7 / §9.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy) | Predicate accepts a full pick | `tripPlacePicked("mb.1", 21.1, -87.4)` | `true` | unit |
| T-2 (error) | Predicate rejects text-without-coords | `destinationLocationValidated("Tulum", null, null, null)` | `false` | unit |
| T-3 (edge) **[REVISED 2026-06-12]** | Empty departure is INVALID (hard-required); dirty departure invalid; only a full pick is valid | `departureLocationValidated("", null,null,null)`=`false`; `departureLocationValidated("DC", null,null,null)`=`false`; `departureLocationValidated("DC","mb.1",38.9,-77.0)`=`true` | unit |
| T-4 (happy) | Create field nulls coords on type | source: each create `onChangeText` includes `…PlaceId: null`, `…Lat: null`, `…Lng: null` | both blocks present | source-char (extends `.mapbox.test.ts`) |
| T-5 (error) | Create publish gate exists | source: `handlePublishTap` references `tripLocationValid` and returns before `setPublishConfirmVisible`; Publish `disabled` includes `!tripLocationValid` | both present | source-char |
| T-6 (happy) | Edit fields are MapboxAddressInput x2 | source: `EditPublishedTripScreen.tsx` matches `<MapboxAddressInput` exactly twice and no longer has `testID="edit-trip-destination"` on a `TextInput` | true | source-char (new test) |
| T-7 (error) | Edit save gate exists | source: `handleSavePress` references `destinationLocationValidated` and `return`s before `setModal` | true | source-char |
| T-8 (edge) | Edit nulls coords on type | source: each edit `onChangeText` nulls placeId/lat/lng | true | source-char |
| T-9 (backfill safety) | Ambiguous text not written | dry-run the script against a fixture with a gibberish destination | row flagged, no UPDATE emitted | script dry-run (implementor) |
| T-10 (backfill idempotency) | Second run no-ops | run script twice on a row with coords | 0 backfilled on run 2 | script dry-run (implementor) |

> **Test-harness note:** the existing `.mapbox.test.ts` is a node-env source-characterization harness (no RN renderer) — `T-4`/`T-5`/`T-6`/`T-7`/`T-8` extend that pattern (regex/`.toContain` over file source), which is the established, fails-on-revert style for these files. `T-1..T-3` are real unit tests on the pure predicate. Do NOT introduce an RN renderer harness for this ORCH.

**Adversarial angle RESERVED for the tester (do NOT pre-build):** drive the actual **edit screen on a physical/sim device** and prove the runtime dead-tap class — that the swapped `MapboxAddressInput` actually mounts, the dropdown actually appears, a real pick actually persists coords through `biz_update_live_trip` to the DB, AND that the Save gate fires at RUNTIME (not just in source) when text is typed without a pick — per `[[feedback_interactive_elements_must_fire_runtime_proof]]`. The implementor's source-char tests prove wiring; the tester proves the control fires.

---

## 8. Implementation order

1. **Shared predicate** — create `mingla-business/src/components/trip/tripLocationValidated.ts` (predicates + copy constants) + `tripLocationValidated.test.ts` (T-1..T-3). Run; green.
2. **Create wizard field** — `TripCreatorStep1Basics.tsx`: null-on-type in both `onChangeText`; add `showAddressErrors` prop + `error` wiring.
3. **Create wizard gate** — `TripCreatorWizard.tsx`: `tripLocationValid` memo + `showStep1AddressErrors` state + pass-through prop + `handlePublishTap` belt + Publish `disabled` suspenders.
4. **Extend** `TripCreatorStep1Basics.mapbox.test.ts` (T-4) + add create-gate assertions if co-located, else fold T-5 into a wizard source-char test.
5. **Edit screen** — `EditPublishedTripScreen.tsx`: import picker + predicate; swap both `TextInput`→`MapboxAddressInput` (with View-testID preservation); `showEditAddressErrors` state + `handleSavePress` gate.
6. **New test** — `EditPublishedTripScreen.mapbox.test.ts` (T-6..T-8).
7. **Backfill script** — `scripts/orch-1118-backfill-trip-coords.ts` + dry-run; record output + flagged report (T-9/T-10). Live run is operator-gated.
8. Run the four business jest gates (per `[[feedback_mingla_business_desktop_web_contracts]]`) + the new/extended tests; typecheck.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the shared `tripLocationValidated` predicate is the single enforcement point; both screens import it. Reverting either screen's gate breaks a named test.
- **Exact tests that FAIL on revert / PASS on restore:**
  - `tripLocationValidated.test.ts` T-2 fails if the predicate is loosened to accept text-without-coords.
  - `TripCreatorStep1Basics.mapbox.test.ts` T-4 fails if either `onChangeText` stops nulling coords (revert to today's text-only handler).
  - The create-wizard source-char assertion (T-5) fails if `handlePublishTap` loses the `tripLocationValid` guard or the Publish button drops `!tripLocationValid`.
  - `EditPublishedTripScreen.mapbox.test.ts` T-6/T-7/T-8 fail if the edit screen reverts to plain `TextInput` (the `<MapboxAddressInput` count drops below 2) or `handleSavePress` loses the gate.
- **Protective comments:** each gate carries a `// ORCH-1118 — trip location must be a confirmed Mapbox pick before publish/save (I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED). Do not loosen.` comment explaining the why, mirroring the experiences comment "placeId stays null so the brand must confirm a real Mapbox pick."

---

## 10. Open questions

**None.** The three previously-open questions are resolved by Seth and encoded as hard contract:
1. BOTH departure AND destination are hard-required — each must be a confirmed Mapbox pick before publish/save; empty is INVALID for both **[REVISED 2026-06-12, Seth overrode ORCH-1016 optional-departure]** — §4.0/§4.6.
2. One-time confidence-gated backfill of the 5 dirty rows; ambiguous rows left null + flagged; operator-gated live run — §4.5.
3. Destination-edit refund-gate interaction OUT of scope; editability + `biz_update_live_trip` preserved — §2 non-goals + SC-9.

(If the implementor finds the business `MapboxAddressInput` wrapper genuinely cannot forward the inline `error` for the edit-screen layout, that is the only foreseeable stop-and-amend — but the wrapper already accepts and forwards `error`, proven §4.4, so none is expected.)

---

## 11. Downstream routing

**Next phase: IMPLEMENT** (mingla-implementor). Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1118-[trip-address-mapbox-validation]/` on branch `ORCH-1118-trip-address-mapbox-validation`. Build §4.0→§4.5 in the §8 order; allowlist + do-not-touch in the next block are binding; the backfill live run is operator-gated (dry-run + flagged report only at IMPLEMENT). Then → **mingla-tester** (runtime dead-tap + DB-persist proof on the edit screen, the reserved adversarial angle in §7) → **orchestrator CLOSE** (flip `I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED` ACTIVE; run the operator-gated backfill live write; OTA per `[[project_ota_deferred_until_new_build]]` — pure-JS RN change, no native build needed).

---

## Scoped allowlist (implementor MAY change)

- `mingla-business/src/components/trip/tripLocationValidated.ts` (NEW)
- `mingla-business/src/components/trip/__tests__/tripLocationValidated.test.ts` (NEW)
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`
- `mingla-business/src/components/trip/TripCreatorWizard.tsx`
- `mingla-business/src/components/trip/__tests__/TripCreatorStep1Basics.mapbox.test.ts` (EXTEND)
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`
- `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.mapbox.test.ts` (NEW)
- `scripts/orch-1118-backfill-trip-coords.ts` (NEW)
- `Mingla_Artifacts/reports/ORCH-1118_BACKFILL_FLAGGED.md` (NEW — script output)

## DO-NOT-TOUCH (stop-and-amend before changing)

- `packages/location-input/*` (shared field + service + types)
- `mingla-business/src/components/location/MapboxAddressInput.tsx` (business wrapper)
- `mingla-business/src/components/experience/ExperienceStopCard.tsx`, `experienceWizardTypes.ts`, `ExperienceCreatorWizard.tsx` (reference only — mirror, don't edit)
- `supabase/functions/mapbox-geocode/index.ts` (consume `forward`/`suggest`; do not modify)
- `supabase/migrations/20260803000000_orch_1016_events_departure_text.sql` (ORCH-1016 trigger)
- `biz_update_live_trip` RPC + its migration (consume, don't modify)
- `EditPublishedTripScreen.tsx`'s `classifyTripSeverity` / refund-severity logic (untouched — decision #3)
- No new DB migration; no edge deploy; no schema change.

---

*SPEC complete. No code written (SPEC hard guard). Ready for IMPLEMENT dispatch.*
