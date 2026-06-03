# INVESTIGATION — ORCH-1036 [Launch-city gate override clobbered by final onboarding save]

- **Mode:** INVESTIGATE (investigation only — no fix)
- **Date:** 2026-06-01
- **Author:** mingla-forensics (Claude)
- **Confidence:** ROOT CAUSE PROVEN (six-field evidence + deterministic DB replay + matching production rows + live deck render)
- **Anchor:** `/Users/sethogieva/Desktop/mingla-main` (running Metro :8109, iPhone 17 Pro sim `17091E60…`)
- **Comms ledger:** read on entry. No `BLOCK`/`OPEN` row addressed to `mingla-forensics` or `ORCH-1036`/`ALL` requiring action this turn (COMMS-0003 external-API and COMMS-0017 device-reservation are FYI/WARN, not applicable — no external API touched, physical Samsung not used). No new cross-ORCH discovery requiring a ledger write.

---

## 1. Symptom Summary

| | |
|---|---|
| **Expected** | A new user outside a live city picks a live city (DC) at the ORCH-1028 launch-city gate. That choice persists as their custom location: the preferences sheet shows "Washington" and the deck uses DC. |
| **Actual** | After completing the rest of onboarding, the picked city's **label disappears**: `preferences.custom_location` is `NULL`. The preferences sheet shows a blank city (looks like GPS / no custom location). The coordinates DO survive, so the deck still pulls DC cards — but the user-visible custom-location state is half-erased. |
| **Repro** | Operator reproduced twice today (incl. after delete+recreate). Confirmed by 2 production `preferences` rows written 2026-06-01 07:04 and 07:26 UTC. |
| **When it started** | ORCH-1028 launch-city gate (just shipped; gate code is the uncommitted WIP on the anchor `OnboardingFlow.tsx`, which is exactly what Metro :8109 is serving). |

---

## 2. Root Cause (🔴 — six fields)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/OnboardingFlow.tsx:1722` (the `handleSavePreferences` upsert), specifically the `custom_location: data.manualLocation` key at **line 1732**. |
| **Exact code** | `await withTimeout(PreferencesService.updateUserPreferences(user.id, { intents…, categories…, travel_mode…, …, use_gps_location: data.useGpsLocation, custom_location: data.manualLocation, intent_toggle: true, category_toggle: true } as any), 8000, 'saveOnboardingPreferences')` |
| **What it does** | Fires at the Step-4 `travel_time → Step-5` transition (AFTER the Step-3 `location` gate). It upserts the `preferences` row including `custom_location: data.manualLocation`. The launch-city gate (`handleLaunchGateConfirmCity`, line 1536) set `data.cityName` and `data.coordinates`, but **never set `data.manualLocation`** — so for a gate user `data.manualLocation` is `null`. The upsert therefore overwrites the gate's `custom_location: 'Washington'` with `null`. (It OMITS `custom_lat`/`custom_lng`, so those survive — see below.) |
| **What it should do** | The final save must preserve the gate's override: either carry `custom_location` = the gate's `data.cityName` (and `custom_lat/custom_lng` = the gate's coords) when `use_gps_location === false`, or omit `custom_location` from this payload entirely when the gate already wrote it (so the upsert leaves it untouched, exactly as it already does for `custom_lat/custom_lng`). |
| **Causal chain** | (1) Step-3 gate: user picks DC → `handleLaunchGateConfirmCity` upserts `{custom_lat:38.907, custom_lng:-77.037, custom_location:'Washington', use_gps_location:false}` ✅. It sets local `data.useGpsLocation=false`, `data.coordinates`, `data.cityName='Washington'` — **but not `data.manualLocation`** (line 1559-1564). (2) User continues to Step-4 (categories→transport→travel_time). (3) `handleSavePreferences` upserts a fresh preferences object with `custom_location: data.manualLocation` (= `null`) and OMITS `custom_lat/custom_lng`. (4) supabase-js `.upsert()` → PostgREST `INSERT … ON CONFLICT (profile_id) DO UPDATE SET <only provided columns>`: `custom_location` is provided as `null` → **clobbered to null**; `custom_lat/custom_lng` are NOT provided → **preserved**. (5) Net DB state: `use_gps_location=false, custom_location=null, custom_lat=38.907, custom_lng=-77.037`. (6) Preferences sheet load (`PreferencesSheet.tsx:433`) gates the city-label on `!isGps && prefs.custom_location` — false because `custom_location` is null → search box renders blank, looks like "no custom location". |
| **Verification step** | (a) Deterministic replay of the two upserts in onboarding order against a temp mirror of `preferences` → `custom_location` goes `'Washington'`→`null`, `custom_lat/lng` preserved (see §4). (b) Two production rows from today match this exact signature byte-for-byte. (c) Live deck on the sim renders a DC restaurant card (coords survived). |

**Service mechanism:** `PreferencesService.updateUserPreferences` (`app-mobile/src/services/preferencesService.ts:65-81`) does `supabase.from("preferences").upsert({profile_id:userId, ...preferences, updated_at})` with **no `onConflict`**. PK is `preferences_pkey PRIMARY KEY (profile_id)`, so the conflict target is `profile_id`. PostgREST builds the `DO UPDATE SET` column list from the payload keys only — **omitted columns are preserved, provided columns (including explicit `null`) are written.** This is why `custom_lat/lng` survive but `custom_location` is nulled. supabase-js `2.74.0`.

---

## 3. Candidate causes considered & disproven (Prime Directive 1)

1. **🔴 CONFIRMED — `handleSavePreferences` clobbers `custom_location` with `data.manualLocation` (null).** Proven (§2/§4).
2. **DISPROVEN — supabase-js upsert nulls ALL omitted columns ("replace" semantics), clobbering `custom_lat/lng` too.** Replay (§4) and production rows show `custom_lat/lng` SURVIVE. PostgREST upsert is column-scoped, not row-replace. So the deck (coords-first) still works.
3. **DISPROVEN — a locale / GPS side-effect re-runs after the gate and resets `use_gps_location` to true.** `captureLocation` sets `useGpsLocation=true` (line 1402) but runs BEFORE the gate; the locale writes at lines 1442/1466 (and the `handleManualLocation` writes at 1655/1690) touch only `profiles.currency`/`measurement_system`, never `preferences` and never location. `handleSavePreferences` writes `use_gps_location: data.useGpsLocation` which the gate set to `false` — and the production rows confirm `use_gps_location` stayed `false`. No GPS reset occurs.
4. **DISPROVEN — the upsert inserts a NEW row (missing PK) instead of updating.** PK is `profile_id`, which the payload always includes; the two writes target the same row (confirmed by single-row result in replay and single row per profile in prod).
5. **DISPROVEN — pure display bug with intact data.** `custom_location` is genuinely `null` in the DB (data integrity loss), not merely mis-rendered. The display blank is a *downstream consequence* of the data clobber.

---

## 4. Live-fire repro & deterministic proof

### 4a. Production rows (operator's two live full-onboarding repros today)

`SELECT profile_id, use_gps_location, custom_location, custom_lat, custom_lng, updated_at FROM preferences ORDER BY updated_at DESC` (Management API, project `gqnoajqerqhnvulmnyvv`):

```
4c500601-…  use_gps_location=false  custom_location=NULL  custom_lat=38.9072873  custom_lng=-77.0369274  2026-06-01 07:26:05Z
78d9913f-…  use_gps_location=false  custom_location=NULL  custom_lat=38.9072873  custom_lng=-77.0369274  2026-06-01 07:04:53Z
```

`38.9072873, -77.0369274` is the exact `seeding_cities` center for **Washington** (the only `is_live_for_consumers=true` city). Contrast with older manual-location rows (e.g. `ac7f00ee-…`) which carry BOTH a full `custom_location` string AND coords. The two fresh rows have coords with a **null label** — the precise set-then-clear signature.

### 4b. Deterministic two-write replay (isolates the clobber mechanism)

Replayed the exact onboarding write order against a temp table mirroring `preferences` (PK `profile_id`), inside a transaction, rolled back:

- **After STEP A (gate write — `handleLaunchGateConfirmCity`):**
  `use_gps_location=false, custom_location='Washington', custom_lat=38.9072873, custom_lng=-77.0369274` ✅ override correct.
- **After STEP B (`handleSavePreferences` — `custom_location:null`, omits `custom_lat/lng`):**
  `use_gps_location=false, custom_location=NULL, custom_lat=38.9072873, custom_lng=-77.0369274, categories=[…]` ← **`custom_location` clobbered to null; coords preserved.**

This matches the production rows exactly and proves the column-scoped upsert behavior.

### 4c. Live deck render (coords survive → deck DOES use the override)

Sim screenshot `Mingla_Artifacts/reports/orch-1036-evidence/sim_current_state.png` (iPhone 17 Pro, Metro :8109): post-onboarding deck rendering **"Pisco y Nazca Ceviche Gastrobar"** — a Washington DC venue. The deck is pulling DC cards because `useUserLocation` Priority-1 reads `custom_lat/custom_lng` (which survived). Confirms the deck side is NOT broken by the clobber.

---

## 5. Outcome & journey step-back (isolation)

**User goal:** "I'm outside a live city; let me browse DC instead, and have the app remember that."

| Journey node | Reality |
|---|---|
| Pick DC at gate | ✅ gate writes coords + label + `use_gps_location:false` |
| Finish onboarding | ❌ `handleSavePreferences` nulls the **label** (`custom_location`); coords kept |
| Deck loads | ✅ uses DC (coords-first in `useUserLocation.ts:55`) |
| Open Preferences sheet | ❌ `PreferencesSheet.tsx:433` needs `custom_location` to show the city → blank; user perceives "my city didn't save" |
| Apply prefs without retyping | ⚠️ recoverable — sheet restored `selectedCoords` from `custom_lat/lng` (line 447) and re-saves them (line 938), but label stays null unless re-typed |

**Conclusion:** this is a **persistence clobber** (real `custom_location` data loss in the DB), whose most visible symptom is the **preferences-sheet blank-city display**. The deck continues to work because coords survive. Fixing the single write at line 1732 (and ideally carrying coords from the gate too, for robustness) restores the full outcome. No upstream/downstream node other than this write needs to change to deliver the outcome — but see §6 hidden flaws.

---

## 6. Blast radius & hidden flaws

- **🟠 Contributing — `handleSavePreferences` builds a fresh "save-all" preferences object that does not carry the gate's override fields.** Any field the gate owns but this save also writes will be clobbered. Today only `custom_location` collides (gate writes it, save writes it as `data.manualLocation`). `custom_lat/lng` escape only by luck (omitted). If a future edit adds `custom_lat/lng` to this save payload sourced from `data.coordinates`, note `data.coordinates` IS set by the gate (line 1562) so that would actually be fine — but `data.manualLocation` is the mismatch.
- **🟡 Hidden flaw — cache vs DB divergence.** The same handler's `queryClient.setQueryData(['userPreferences'], …)` at line 1749 writes the FULL correct object (including `custom_lat/lng` from `data.coordinates` and `custom_location: data.manualLocation` = null). So in-session cache has correct coords but null label; on cold relaunch the DB row (null label, intact coords) is fetched. Both paths agree on "null label, valid coords" — consistent, but consistently wrong on the label.
- **🟡 Hidden flaw — `as any` on the save payload (line 1735)** suppresses type-checking that could have caught the `custom_location` field-shape mismatch.
- **🔵 Observation — `I-1028-ONE-LOCATION-OWNER`** (cited at gate line 1542) is violated in spirit: the gate claims to be the one owner of the four `custom_*`/`use_gps_location` fields, but `handleSavePreferences` is a second writer of `custom_location` + `use_gps_location` that runs later and wins.
- **Cross-surface:** consumer iOS + Android share `OnboardingFlow.tsx` → both affected. No business/admin/web analog (onboarding is consumer-app only).

---

## 7. Fix strategy (direction only — NOT a spec)

Make `handleSavePreferences` preserve the gate's override. Minimal options:
1. **Omit `custom_location` (and `use_gps_location`) from the `handleSavePreferences` upsert** so the gate's values are left untouched (mirrors how `custom_lat/lng` already survive), OR
2. **Source them from the same state the gate set:** when `data.useGpsLocation === false`, write `custom_location: data.cityName ?? data.manualLocation` and `custom_lat/custom_lng: data.coordinates?.lat/lng`. Keep `custom_location: null` only when `data.useGpsLocation === true`.

Either restores `custom_location='Washington'` end-to-end. Confirm the in-handler `setQueryData` (line 1749) writes the same non-null label.

## 8. Regression prevention (direction)
- A test that runs gate-confirm → save-preferences and asserts the persisted `preferences` row keeps `custom_location` non-null when `use_gps_location=false`.
- Consider giving `updateUserPreferences` an explicit single owner for the four location fields, or drop the `as any` so the payload is type-checked.

---

## 9. Confidence

**ROOT CAUSE PROVEN.** Six-field evidence complete; clobber mechanism deterministically replayed; matches two production full-onboarding repros from today; live deck confirms coords survive (display-side isolation). The only un-exercised path is a Maestro-driven fresh-account onboarding from scratch — not required, because the operator's own two completed onboardings today produced the exact DB signature and the mechanism is proven at the SQL layer.
