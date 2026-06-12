# INVESTIGATE — ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]

**Skill:** mingla-forensics (INVESTIGATE)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1118-[trip-address-mapbox-validation]/`
**Branch:** `ORCH-1118-trip-address-mapbox-validation` (rebased onto origin/main — 0 commits behind at investigation time)
**Date:** 2026-06-11
**Comms ledger:** read on entry. No BLOCK entries for ORCH-1118 / mingla-forensics / ALL. COMMS-0020 (FYI, RESOLVED — mapbox-geocode source IS on main) and COMMS-0021 (WARN, OPEN, ALL — provider-neutral seller-payout copy rename) factored; neither touches trip address fields.

---

## Symptom summary (expected vs actual)

**Expected:** A trip's "Departing from" and "Destination" fields accept ONLY a real Mapbox-validated address — a structured place picked from the suggestion list, carrying `{ placeId, formattedAddress, lat, lng, city, region, countryCode }`. Raw free-typed text that was never confirmed against a suggestion must NOT be persisted as the trip's location. This must hold on BOTH the create wizard and the published-trip edit screen.

**Actual:** Both authoring surfaces persist arbitrary free-typed text with NO coordinates:
- **Create wizard** (`TripCreatorStep1Basics`): uses `MapboxAddressInput`, but its `onChangeText` writes raw keystroke text straight into `departureLocationText` / `destinationLocationText` while leaving `*PlaceId` / `*Lat` / `*Lng` untouched. There is no publish/step-advance gate requiring a confirmed pick. Free-text falls through and is saved.
- **Edit screen** (`EditPublishedTripScreen`): both fields are plain `TextInput`s that write ONLY `*LocationText` and never set placeId/lat/lng. Editing the destination text on a live trip leaves the OLD coordinates stale (text says one city, lat/lng point at another) or — for trips that were never validated — null.

**Live-data proof (production DB, read-only):** of 45 trip rows, 5 carry a `destination_text`; ALL 5 have `destinationPlaceId`, `destinationLat`, AND `destinationLng` = NULL — across both `draft` and `scheduled` status. 100% of trips with a destination today are coordinate-less free text. See Finding F-5.

---

## Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | mandatory entry scan |
| 2 | `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` | creation Step 1 — the picker wiring |
| 3 | `mingla-business/src/components/location/MapboxAddressInput.tsx` | business thin wrapper (token bundle + invoke) |
| 4 | `packages/location-input/src/MapboxAddressInput.tsx` | shared field — does it enforce a pick? |
| 5 | `packages/location-input/src/types.ts` + `mapboxGeocodeService.ts` (greps) | PlaceDetails contract |
| 6 | `mingla-business/src/components/trip/TripCreatorWizard.tsx` | autosave + step-advance gate |
| 7 | `mingla-business/src/services/tripsService.ts` | persistence (`updateTripBasics`, theme.business_trip, mapTrip) |
| 8 | `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | published-edit fields + diff-builder |
| 9 | `mingla-business/app/trip/[id]/edit.tsx` + `app/trip/create.tsx` | status-based dispatcher (path enumeration) |
| 10 | `supabase/migrations/20260803000000_orch_1016_events_departure_text.sql` | canonical departure_text/geo trigger |
| 11 | `supabase/migrations/20260803000001_orch_1016_pg_published_trips_public.sql` | discovery RPC — geo vs ILIKE |
| 12 | `app-mobile/src/{hooks,services}/...` (greps) | downstream consumers of departure_text/destination_text/geo |
| 13 | `mingla-business/src/components/experience/ExperienceStopCard.tsx` + `experienceWizardTypes.ts` + `ExperienceCreatorWizard.tsx` | **reference contract to mirror** (enforced "must pick") |
| 14 | `mingla-business/src/components/trip/__tests__/TripCreatorStep1Basics.mapbox.test.ts` | existing test coverage / gap |
| 15 | live DB (`mcp__supabase__execute_sql`, read-only) | dirty-data quantification |

---

## Q-scorecard

### Q1 — Does CREATION (`TripCreatorStep1Basics`) have a free-text fall-through?
**Verdict: YES — PROVEN.** The shared field fires `onChangeText` on every keystroke (no pick required); the trip wizard's `onChangeText` handler persists that raw text into `*LocationText` and does NOT null the structured fields, and neither the wizard's `handleNext` nor `autosaveStep1` gates on a confirmed pick. Free text is saved on Continue/Back/Close. (F-1, F-2, F-3) Live DB shows 2 `draft` trips with destination text + null coords (F-5).

### Q2 — Is the EDIT screen text-only, and WHY?
**Verdict: text-only CONFIRMED — PROVEN; reason = pre-Mapbox PARITY GAP, NOT a location-immutability guard.** Both fields are plain `TextInput`s writing only `*LocationText`. Git blame: these fields were born plain-text in ORCH-0876 (PR #137, commit `3189a6b10`) — the file's very first commit — which PREDATES ORCH-1079's Mapbox migration (which only touched the create wizard). The edit screen's own diff-builder ALREADY accepts `destinationPlaceId/Lat/Lng` + `departurePlaceId/Lat/Lng` in the patch (the save path / `biz_update_live_trip` handles structured fields); only the UI never sets them. Destination is explicitly in the editable patch → NOT immutable. (F-4, F-6)

### Q3 — How many trip authoring paths write departure/destination? Is there a third raw-input path?
**Verdict: exactly TWO UIs — PROVEN.** `app/trip/[id]/edit.tsx` is a status dispatcher: `draft` → `TripCreatorWizard` (same component as `create.tsx`); `scheduled`/`live` → `EditPublishedTripScreen`; `ended`/`cancelled` → read-only (no edit). So "draft-edit" reuses the wizard — it is NOT a third component. No other component writes these fields. (F-7)

### Q4 — Data model + downstream impact of text-without-coords?
**Verdict: PROVEN (impact: PROBABLE bounded).** Authoring writes `theme.business_trip.{departure,destination}{LocationText,PlaceId,Lat,Lng}`; a trigger mirrors `theme.business_trip.departureLocationText/Lat/Lng` → canonical `events.departure_text`/`departure_geo`; destination_text is synced by a bespoke block in `biz_update_live_trip`. Downstream: consumer trip discovery (`pg_published_trips_public`) filters destination/departure by **ILIKE on the text**, not geo — so non-canonical free text ("Washington DC, USA" vs the canonical Mapbox string) degrades text-search matching; and `*_geo` stays null/stale, starving the documented "future proximity sort". No hard crash. (F-8)

### Q5 — What is the `MapboxAddressInput` "must pick" contract to adopt (mirror experiences)?
**Verdict: PROVEN.** `onChangeText` nulls placeId/lat/lng on every keystroke; `onPick` writes the full `PlaceDetails`; a `stopHasValidatedLocation(s) = placeId!=null && lat!=null && lng!=null` predicate drives an inline `addrError` ("Pick this stop's address from the suggestions.") and a wizard publish gate (`stop_address_unvalidated`). (F-9)

---

## Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE — creation `onChangeText` persists raw text, never nulls coords
1. **Symptom:** typing a city without tapping a suggestion saves the typed string as the destination with null lat/lng.
2. **Layer:** code.
3. **Probe:** read `TripCreatorStep1Basics.tsx:362-411`.
4. **Evidence (verbatim):**
```tsx
<MapboxAddressInput
  value={draft.departureLocationText ?? ""}
  onChangeText={(v) => onChange({ departureLocationText: v })}   // ← only text; coords untouched
  onPick={(place) => { onChange({ departurePlaceId: place.placeId, departureLocationText: place.formattedAddress, departureLat: place.location.lat, departureLng: place.location.lng }); }}
  onClear={() => { onChange({ departurePlaceId: null, departureLocationText: null, departureLat: null, departureLng: null }); }}
  ...
/>
```
Destination block (388-411) is identical in shape.
5. **Mechanism:** `onChangeText` updates only `*LocationText`; a stale prior pick's `*PlaceId/Lat/Lng` linger (or stay null), so the field's displayed text and its coordinates can diverge with no signal.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — SECONDARY ROOT CAUSE — shared field does not (and cannot) enforce a pick; the parent must
1. **Symptom:** the picker happily accepts free text.
2. **Layer:** code.
3. **Probe:** read `packages/location-input/src/MapboxAddressInput.tsx:185-237`.
4. **Evidence (verbatim):** `handleChangeText` (185) → `onChangeText(next)` on every keystroke; `handlePickSuggestion` (215) → `onPick(details)` only after `retrieveMapboxPlace` resolves. The component holds NO "current value is a confirmed pick" state and exposes no such flag.
5. **Mechanism:** by design (THE TOKEN RULE) the field is host-validated: the PARENT owns the address+geo state and the `error` prop. Enforcement is a host responsibility the trip wizard never implemented.
6. **Severity:** SECONDARY ROOT CAUSE (correct design; the gap is the missing host-side gate).

### F-3 — CONFIRMED ROOT CAUSE — no step-advance / publish gate on a confirmed pick (creation)
1. **Symptom:** free-typed trips advance and autosave with no warning.
2. **Layer:** code.
3. **Probe:** read `TripCreatorWizard.tsx:552-594` (`autosaveStep1`) + `717-733` (`handleNext`).
4. **Evidence (verbatim):** `autosaveStep1` writes `businessTrip: { ...destination*, ...departure* }` straight from draft state; `handleNext` = `await autosaveCurrentStep(); setStep(s+1)` with NO field validation. Destination/departure are absent from `isTripWizardPristine`'s required-field logic; there is no `canAdvance`/required check anywhere in the wizard for these fields.
5. **Mechanism:** nothing blocks advancing past Step 1 (or publishing) when the destination is unvalidated free text.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-4 — CONFIRMED ROOT CAUSE — edit screen uses plain TextInput (no coords) for both fields
1. **Symptom:** editing a published trip's destination/departure stores text only; coords go stale/null.
2. **Layer:** code.
3. **Probe:** read `EditPublishedTripScreen.tsx:1095-1130`.
4. **Evidence (verbatim):**
```tsx
{/* ORCH-1016 — ... Text-only edit (mirrors the destination edit field's plain TextInput). */}
<TextInput value={editState.departureLocationText ?? ""}
  onChangeText={(v) => updateBasics({ departureLocationText: v.trim().length === 0 ? null : v })} ... testID="edit-trip-departure" />
...
<TextInput value={editState.destinationLocationText ?? ""}
  onChangeText={(v) => updateBasics({ destinationLocationText: v.trim().length === 0 ? null : v })} ... testID="edit-trip-destination" />
```
5. **Mechanism:** `updateBasics` mutates only `*LocationText`; placeId/lat/lng are never reached, so edited destinations carry stale or null coordinates.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-5 — CONFIRMED ROOT CAUSE (data) — 100% of trips with a destination have null coordinates today
1. **Symptom:** production trips have destination text but no geo.
2. **Layer:** data.
3. **Probe (read-only):**
```sql
SELECT id,status,destination_text,
  theme->'business_trip'->>'destinationPlaceId' AS pid,
  theme->'business_trip'->>'destinationLat' AS lat,
  theme->'business_trip'->>'destinationLng' AS lng
FROM public.events WHERE event_type='trip' AND deleted_at IS NULL AND destination_text IS NOT NULL;
```
4. **Evidence (verbatim rows):** 5 rows — `Raleigh, NC, USA` (draft), `Tulum, Quintana Roo, Mexico` (scheduled ×2), `Washington DC, USA` (scheduled), `Brussels, Belgium` (draft); **every row has pid=null, lat=null, lng=null.** Aggregate: 45 trips total, 0 with departure_text, 5 with destination_text, 5/5 missing coords.
5. **Mechanism:** the live manifestation of F-1/F-3 (draft rows) and F-4 (scheduled rows) — both authoring paths produce coordinate-less locations.
6. **Severity:** CONFIRMED ROOT CAUSE (the bug is live, not hypothetical). Implies a backfill consideration for SPEC (5 rows; small).

### F-6 — RULED OUT — edit text-only is an intentional location-immutability guard
1. **Symptom:** hypothesis that destination was frozen on purpose post-sale.
2. **Layer:** code + history.
3. **Probe:** `git log -L 1116,1130` on the destination field; read `EditPublishedTripScreen.tsx:300-352` (diff-builder).
4. **Evidence:** field introduced in ORCH-0876 (`3189a6b10`, PR #137) as plain TextInput in the file's FIRST commit — before ORCH-1079 added the Mapbox picker (create-wizard only). The diff-builder already emits `destinationPlaceId/Lat/Lng` + `departurePlaceId/Lat/Lng` into the patch (lines 304-348) → the field IS editable, the picker was simply never backported. The ORCH-1016 comment "Text-only edit (mirrors the destination edit field's plain TextInput)" confirms departure was cloned from an already-text-only destination, i.e. the gap propagated.
5. **Mechanism:** parity gap (pre-Mapbox legacy), not a deliberate immutability guard.
6. **Severity:** RULED OUT (refutes the immutability hypothesis).

### F-7 — PROVEN (path enumeration) — exactly two authoring UIs; no hidden third path
1. **Symptom:** need the full set of write paths.
2. **Layer:** code.
3. **Probe:** read `app/trip/[id]/edit.tsx:149-219` + `app/trip/create.tsx`.
4. **Evidence (verbatim):** dispatcher — `if (status==='scheduled'||'live') return <EditPublishedTripScreen/>; if ('ended'||'cancelled') return <read-only>; default draft → <TripCreatorWizard isCreateMode.../>`. `create.tsx` mounts the same `TripCreatorWizard`. Grep across the business app finds no other component writing `departure*`/`destination*`.
5. **Mechanism:** create + draft-edit share ONE component (the wizard / Step 1); published-edit is the second. Fix must cover both.
6. **Severity:** PROVEN (scope-defining).

### F-8 — SUSPECTED CONTRIBUTOR — downstream discovery + proximity impact of null/stale coords
1. **Symptom:** trips with non-canonical text may mis-match consumer discovery filters; proximity sort has no data.
2. **Layer:** schema + code.
3. **Probe:** read `20260803000001_orch_1016_pg_published_trips_public.sql:16-17`; grep app-mobile consumers.
4. **Evidence (verbatim):** RPC params `p_destination_query` / `p_departure_query` are documented as `ILIKE on destination_text` / `ILIKE on departure_text`. `app-mobile/src/services/tripsDiscoveryService.ts` + `useConsumerTripDetail.ts` read `destination_text`/`departure_text` for display only. No geo filter/sort on trip rows today; `departure_geo` exists for a documented "future proximity sort".
5. **Mechanism:** free, non-canonical text degrades ILIKE matching; null `*_geo` blocks future proximity features. Display still works (it shows whatever text was typed).
6. **Severity:** SUSPECTED CONTRIBUTOR (bounded; reinforces "why validation matters", not a separate crash).

### F-9 — PROVEN (reference contract) — experiences already enforce "must pick"; mirror it
1. **Symptom:** need the canonical pattern.
2. **Layer:** code.
3. **Probe:** read `ExperienceStopCard.tsx:82-194`, `experienceWizardTypes.ts:71-73`, `ExperienceCreatorWizard.tsx:155,269`.
4. **Evidence (verbatim):** `onChangeText` nulls `placeId,city,region,countryCode,lat,lng` on every keystroke (164-169); `onPick` writes full `PlaceDetails` (172-181); `stopHasValidatedLocation = s.placeId!==null && s.lat!==null && s.lng!==null`; `addrError = showErrors && showAddress && !stopHasValidatedLocation(stop) ? "Pick this stop's address from the suggestions." : undefined`; wizard gate `stop_address_unvalidated: "Pick each stop's address from the suggestions."`; comment "placeId stays null so the brand must confirm a real Mapbox pick."
5. **Mechanism:** the proven enforcement model — null-on-type + a `hasValidatedLocation` predicate + inline error + publish gate — is the exact thing the trip paths lack.
6. **Severity:** PROVEN (reference for SPEC).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| **Docs** | ORCH-1079 comment claims the trip wizard is a "drop-in" Mapbox picker storing the same keys. | TRUE for `onPick`/`onClear` but SILENT on `onChangeText` — masks F-1. |
| **Schema** | `theme.business_trip.*` + canonical `events.departure_text/geo` (+ destination_text via RPC). Trigger syncs departure; coords nullable. | No DB-level NOT NULL on coords → schema cannot enforce a pick; enforcement must be app-side. |
| **Code** | Create wizard + edit screen both write text without requiring coords; no gate. | **Primary contradiction**: code accepts what the product intent forbids. Experiences code (sibling) DOES enforce → trip is the deviation (pattern-compliance finding). |
| **Runtime** | Not separately sim-driven (see Repro). | — |
| **Data** | 5/5 trips with a destination have null coords. | Confirms code path is live; refutes any "already validated in practice" assumption. |

The load-bearing gap is **Code vs Docs/Intent**: free-text fall-through on create + text-only on edit, both contradicted by the data layer showing 100% coordinate-less destinations.

---

## Repro evidence

- **Source trace:** PROVEN end-to-end for both paths (F-1..F-4, F-7).
- **Data live-fire (read-only DB):** PROVEN — 5/5 destination trips have null placeId/lat/lng across draft + scheduled (F-5). This is stronger than a sim repro: it is the production artifact of the bug.
- **Sim repro of "type free text → it saves":** NOT separately run (source + live-data already prove it; a Maestro run would only re-demonstrate F-1). Recommended as a bonus during TEST, not required to seal this investigation. Confidence is therefore PROVEN on data+source grounds, not capped at suspected, because the conclusion rests on live DB rows, not only source reasoning.

---

## Blast radius / cross-surface map

| Surface | In scope | Note |
|---------|----------|------|
| Business iOS / Android | **YES** | Both authoring UIs (`TripCreatorStep1Basics`, `EditPublishedTripScreen`) — native. |
| Business Web preview (adjacent) | **YES (automatic)** | Same RN components render on Expo Web; the web date `<input>` branch is unrelated. |
| Consumer iOS/Android/Web | NO (read-only beneficiary) | They display + ILIKE-filter `destination_text`/`departure_text`; quality improves when coords land but no consumer code changes. |
| Admin Web | NO | No trip address authoring. |
| Experiences authoring | NO (reference only) | `ExperienceStopCard` is the pattern to mirror; do NOT modify it. |

Shared `packages/location-input/MapboxAddressInput.tsx` and the business wrapper are CORRECT as-is — **do not modify them**; the fix is host-side (trip wizard + edit screen + a shared trip-location-validated predicate).

---

## Invariant impact (flagged, not pre-decided)

- Mirrors the experiences invariant family (`stopHasValidatedLocation`, `stop_address_unvalidated`). A new trip-side analogue (e.g. `I-PROPOSED-TRIP-LOCATION-VALIDATED` — destination/departure persisted only with a confirmed pick) is a candidate for SPEC to DRAFT.
- The ORCH-1016 trigger (`tg_events_sync_departure_from_theme`) and `biz_update_live_trip`'s destination block are load-bearing; the fix should keep flowing through them unchanged (UI-layer fix only). FLAG: do not re-surgery the RPC.
- Note: departure is "additive, no refund gate" (ORCH-1016); destination on a live trip is part of the refund-relevant change set in `EditPublishedTripScreen` — SPEC must check whether swapping the destination input changes refund-gate behavior (the diff-builder already emits destination keys, so likely no change, but flag for SPEC).

---

## Discoveries for Orchestrator

1. **D-1 (data hygiene):** 5 live trips have free-text destinations with null coords (2 draft, 3 scheduled). SPEC should decide: backfill via reverse/forward geocode, or leave for re-edit. Small (5 rows). Out of strict scope but cheap.
2. **D-2 (test gap):** `TripCreatorStep1Basics.mapbox.test.ts` asserts the picker is wired but does NOT test free-text rejection. The fails-on-revert regression test for this ORCH belongs here + an edit-screen equivalent.
3. **D-3 (copy):** COMMS-0021 provider-neutral rename does not touch these files; no conflict.

---

## Confidence

**PROVEN** for the scope split (creation free-text fall-through = YES; edit text-only = confirmed; reason = parity gap not guard; two authoring paths) — resting on verbatim source at every layer PLUS live production DB rows (F-5). Downstream impact (F-8) is SUSPECTED CONTRIBUTOR (bounded). No sim repro was required because the live data IS the repro.

---

## Recommended next phase + scope (direction only — NOT a fix)

**Next phase: SPEC.** Recommended scope (honor exactly, do not widen):
1. **Creation** (`TripCreatorStep1Basics`): harden both `onChangeText` handlers to null the structured fields on keystroke (mirror `ExperienceStopCard`), add a trip-side `hasValidatedLocation` predicate + inline error, and a Step-1 / publish gate so an unvalidated free-text destination/departure cannot advance/publish. (Decide whether departure stays optional-but-validated-if-present, given ORCH-1016 "never gates publish" — open question for SPEC.)
2. **Edit** (`EditPublishedTripScreen`): replace both plain `TextInput`s with `MapboxAddressInput`, wiring `onPick`/`onClear`/`onChangeText` into the existing diff-builder that ALREADY accepts placeId/lat/lng. Confirm refund-gate behavior unchanged for destination edits.
3. **Shared predicate:** factor a single trip-location-validated helper (mirror `stopHasValidatedLocation`) used by both paths + tests.
4. **Regression tests:** extend `TripCreatorStep1Basics.mapbox.test.ts` + add an edit-screen test that FAIL on revert (free text without pick must be rejected / must null coords).
5. **DO NOT TOUCH:** `packages/location-input/*`, the business `MapboxAddressInput` wrapper, `ExperienceStopCard`, the ORCH-1016 trigger, `biz_update_live_trip` RPC. (D-1 backfill is optional, operator-gated.)

**Open questions for SPEC:** (a) departure optional vs required (ORCH-1016 says never gates publish); (b) backfill the 5 dirty rows or leave; (c) destination-edit refund-gate interaction on live trips.

---

*Investigation complete. No fix proposed (INVESTIGATE hard guard). All probes read-only.*
