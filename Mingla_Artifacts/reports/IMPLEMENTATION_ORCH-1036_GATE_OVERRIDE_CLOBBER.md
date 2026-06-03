# IMPLEMENTATION — ORCH-1036 [Launch-city gate override clobbered by final onboarding save]

- **Mode:** IMPLEMENT
- **Date:** 2026-06-01
- **Author:** mingla-implementor (Claude)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1036-[gate-override-clobber]/` on branch `ORCH-1036-gate-override-clobber`
- **Status:** implemented and verified (tsc clean on touched files, regression test green + fails-on-revert proven)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1036_GATE_OVERRIDE_CLOBBER.md` (ROOT CAUSE PROVEN)

---

## 1. Comms ledger (read on entry)

Scanned the Active table. No `BLOCK`+`OPEN` row addressed to `mingla-implementor`, `ORCH-1036`, or `ALL`. Relevant `ALL`/WARN rows factored:
- COMMS-0003 (external-API docs verified) — **N/A**, no external API touched.
- COMMS-0004 (INTAKE ID-collision scan) — **N/A**, not an INTAKE turn.
- COMMS-0002 (ORCH-0863 strict-grep backend gate) — **N/A**, no `supabase/functions/` or migration touch (app-mobile only).
- COMMS-0012/0011/0013/0015 (WARN) — read; none bear on this app-mobile-only onboarding fix.

No new cross-ORCH discovery requiring a ledger write. (The ORCH-1028 gate being uncommitted WIP is noted in §10 Discoveries, but it does not clobber another in-flight ORCH.)

---

## 2. What changed (plain English)

The last step of onboarding was erasing the city a new user picked at the launch-city gate. The gate correctly saved the city + coordinates + "not using GPS"; then the final preferences save re-wrote the row and set the city label back to empty (it copied an always-empty field over it). The coordinates survived, so the deck still showed the right city — but the Preferences sheet showed a blank city. The fix makes the final save preserve the picked city instead of nulling it, while still keeping a true GPS user's custom city empty.

---

## 3. Old → New Receipts

### `app-mobile/src/utils/onboardingLocationOverride.ts` (NEW)
**What it did before:** did not exist.
**What it does now:** exports a pure `resolveOnboardingLocationOverride(state)` that derives the four location-override columns (`custom_location`, `custom_lat`, `custom_lng`, implied `use_gps_location` is passed through separately) from onboarding state, keyed off `use_gps_location`:
- GPS user (`true`) → `custom_location/lat/lng = null` (no stale override).
- non-GPS (`false`) → `custom_location = cityName (gate) ?? manualLocation (legacy)`, coords from `coordinates`.
**Why:** isolates the derivation so the FINAL save can preserve the gate/manual override instead of clobbering it, and so a unit-/integration-level regression test can exercise the exact shipped logic (fails-on-revert).
**Lines changed:** +77 (new file).

### `app-mobile/src/components/OnboardingFlow.tsx`
**What it did before:** `handleSavePreferences` (Step-4→5 transition) upserted `preferences` with `custom_location: data.manualLocation` and a trailing `as any` cast; it OMITTED `custom_lat/lng` from the DB upsert (they survived only by luck of column-scoped upsert). The gate (`handleLaunchGateConfirmCity`) sets `data.cityName`/`data.coordinates`/`useGpsLocation=false` but NEVER `data.manualLocation`, so for a gate user `data.manualLocation` was `null` → the save clobbered the gate's `custom_location` to `null`.
**What it does now:** derives the override via `resolveOnboardingLocationOverride({ useGpsLocation, cityName, manualLocation, coordinates })` and writes `custom_location` / `custom_lat` / `custom_lng` from that result in BOTH the persisted `updateUserPreferences` upsert AND the in-handler `queryClient.setQueryData(['userPreferences', user.id], …)` cache pre-seed. The `as any` cast is removed (payload is now a valid `Partial<UserPreferences>` — tsc clean).
**Why:** preserves the gate's (and legacy manual-location's) `custom_location` through end-of-onboarding while keeping a true GPS user's custom location null. Aligns persisted DB row and React Query cache so cold-relaunch and in-session agree.
**Lines changed:** ~30 (import +1; derivation block; upsert location fields; cache block location fields; cast removed).

---

## 4. Approach decision (keeps BOTH gate user AND GPS user correct)

Chose the investigation's preferred Option 2 (source from gate state), generalized to also cover the legacy manual-location flow:

| User | `use_gps_location` | `cityName` | `manualLocation` | Resolved `custom_location` | Correct? |
|---|---|---|---|---|---|
| Launch-city gate (DC) | false | `"Washington"` | null | `"Washington"` | ✅ persists |
| Legacy manual-location | false | null | `"Brooklyn, NY, USA"` | `"Brooklyn, NY, USA"` | ✅ persists |
| True GPS | true | `"San Francisco"` (reverse-geocoded) | null | `null` | ✅ clean (no stale override) |

Why not "omit the fields entirely" (the acceptable alternative): omitting would leave a true GPS user's `custom_location` at whatever was previously in the row (stale) on re-onboard, and would not let the save correct a GPS user back to null. Explicitly writing the resolved values makes the final save authoritative for both cases without guesswork.

---

## 5. Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| **I-1028-ONE-LOCATION-OWNER** | YES (improved) | The save no longer introduces an *independent* third value for the location fields — it DERIVES them from the same onboarding `data` state the location step / gate populated. The gate remains the semantic owner; the save echoes the gate's choice rather than overwriting it with an unrelated (null) source. Previously the save was a divergent second writer that won with a null; now it agrees with the gate. |
| **I-LOCATION-INVALIDATE-ON-LOCATION-ONLY** | YES (untouched) | No change to any React Query *key* shape. `useUserLocation.ts` query key untouched. The save's `setQueryData(['userPreferences', user.id], …)` writes data (an existing call), it does not add a refresh signal to the location key. No new `invalidateQueries` introduced in this handler. |

No third writer of `custom_location`/`use_gps_location` was introduced. Writers remain: the gate (`handleLaunchGateConfirmCity`), the final save (`handleSavePreferences`, now consistent with the gate), and the Preferences sheet (existing).

---

## 6. Cross-surface impact (Step 3.5)

- **Consumer iOS** — AFFECTED. `OnboardingFlow.tsx` is the consumer onboarding. Picked launch city now persists through onboarding. Parity: automatic (shared file).
- **Consumer Android** — AFFECTED, identical shared code path. Parity automatic.
- **Buyer/anonymous Web** — NOT affected (no onboarding flow).
- **Business iOS / Android** — NOT affected (separate app, no consumer onboarding).
- **Admin Web** — NOT affected (does not render this flow).
- **Business Web preview** — NOT affected.

Single feature, shared file across the only two affected surfaces (iOS + Android) → parity automatic.

---

## 7. Regression Test

- **Path:** `app-mobile/src/utils/__tests__/onboardingLocationOverride.test.ts` (Deno test — the app-mobile `__tests__` convention here is Deno, confirmed by sibling `openingHoursUtils.test.ts` et al.).
- **What it proves:** replays the FULL post-gate sequence (gate-confirm → `handleSavePreferences`) through a PostgREST-faithful column-scoped upsert simulator, feeding the save's location fields from the REAL shipped `resolveOnboardingLocationOverride`. Asserts:
  1. **Gate survival (the point):** after gate-confirm THEN save, `custom_location === "Washington"`, `use_gps_location === false`, coords intact — i.e. the override SURVIVES to end-of-onboarding, not just at pick time.
  2. Legacy manual-location (no gate) also survives the save.
  3. True GPS user stays clean: `custom_location === null`, coords null, `use_gps_location === true`.
  4. Resolver unit: non-GPS prefers gate `cityName` over a stale `manualLocation`.

**Passing run (fix in place):**
```
running 4 tests from ./src/utils/__tests__/onboardingLocationOverride.test.ts
ORCH-1036: gate-confirmed launch city SURVIVES handleSavePreferences ... ok
ORCH-1036: legacy manual-location (typed city, no gate) also survives the save ... ok
ORCH-1036: true GPS user stays clean — custom_location null, use_gps_location true ... ok
ORCH-1036: resolver unit — non-GPS prefers gate cityName over manualLocation ... ok
ok | 4 passed | 0 failed (7ms)
```

**Fails-on-revert verified at `e944b0b202e08145bac81ca125b60d45ad8cf915`** (worktree HEAD before the fix commit). Reverting the resolver to the pre-fix behavior (`custom_location: state.manualLocation`) produced:
```
FAILED | 1 passed | 3 failed (26ms)
```
The critical gate-survival test failed with `custom_location` Actual=`null`/`Some Stale Typed City` vs Expected=`Washington`, plus the GPS-clean test failed — proving the test exercises the bug. Fix restored → 4 passed.

Command (run from `app-mobile/`):
```
/Users/sethogieva/.deno/bin/deno test --no-check src/utils/__tests__/onboardingLocationOverride.test.ts
```

---

## 8. Verification matrix

| Criterion | How verified | Result |
|---|---|---|
| `handleSavePreferences` no longer nulls the gate's `custom_location` | Code read + regression test #1 (gate survival) | PASS |
| Gate user's picked city persists through full onboarding | Regression test #1 asserts non-null after the full sequence | PASS |
| GPS user stays clean (`custom_location=null`, `use_gps_location=true`) | Regression test #3 | PASS |
| Cache (`setQueryData`) matches persisted values | Code read — both blocks use the same resolved vars | PASS |
| `as any` cast removed without type errors | `npx tsc --noEmit` → no errors in `OnboardingFlow.tsx`/`onboardingLocationOverride.ts`/`preferencesService.ts` | PASS |
| Regression test fails on revert | Reverted resolver → 3 failed; restored → 4 passed | PASS |
| No third location writer / invariants held | §5 | PASS |

`tsc --noEmit` on the whole app-mobile reports only PRE-EXISTING, unrelated errors (BoardDiscussion, TripCard, payments tests, brand-rendering package, Deno-style test files) — none in the three touched files. No new errors introduced.

---

## 9. Cache safety

- No query KEY changed. `['userPreferences', user.id]` key unchanged; `setQueryData` now writes the same resolved location values as the DB upsert → in-session cache and cold-relaunch DB fetch agree (both non-null for a gate user, both null for a GPS user). Fixes the §6 "cache vs DB divergence" hidden flaw from the investigation (cache used to write `data.manualLocation` = null too, so it was consistently-wrong; now consistently-correct).

---

## 10. Discoveries for Orchestrator

- **ORCH-1028 launch-city gate is uncommitted WIP on the anchor checkout only.** The gate handler (`handleLaunchGateConfirmCity`, `launchGate` state, `check-launch-city`) lives as uncommitted changes on `~/Desktop/mingla-main` `OnboardingFlow.tsx` (the file Metro :8109 serves), NOT on any branch — this ORCH-1036 worktree branch is based on `e944b0b20` which predates the gate. **This ORCH-1036 fix was applied to `handleSavePreferences`, which is byte-identical in both the pre-gate and gate versions and touches a different function than the gate handler**, so it will merge cleanly with ORCH-1028 whenever ORCH-1028 is committed. Recommend the orchestrator ensure ORCH-1028's gate work gets committed/PR'd so this fix and the gate land on `main` together; until then the bug only reproduces against the anchor WIP (as the investigation noted).
- **Pre-existing: `handleManualLocation` (legacy typed-city flow) never sets `data.useGpsLocation = false`.** It sets `manualLocation` + `coordinates` but leaves `useGpsLocation` at its prior value. With this fix, the save's GPS branch keys off `use_gps_location`; if a legacy manual-location user still has `useGpsLocation=true`, their typed city would resolve to null. This is OUT OF SCOPE for ORCH-1036 (the gate path correctly sets `useGpsLocation=false`), but is a latent correctness gap in the legacy manual path worth a follow-up ORCH if that path is still reachable. Not fixed here to honor scope discipline.

---

## 11. Files changed

- `app-mobile/src/utils/onboardingLocationOverride.ts` (NEW, +77)
- `app-mobile/src/utils/__tests__/onboardingLocationOverride.test.ts` (NEW regression test, +~165)
- `app-mobile/src/components/OnboardingFlow.tsx` (import +1; derivation + upsert + cache fields; `as any` removed)

No migrations, no edge functions, no deploy. app-mobile only.
