# QA — ORCH-1036 [Launch-city gate override clobbered by final onboarding save]

- **Mode:** TARGETED (orchestrator-dispatched)
- **Date:** 2026-06-01
- **Tester:** mingla-tester (Claude)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1036-[gate-override-clobber]/` on branch `ORCH-1036-gate-override-clobber`
- **Commit under test:** `caeb5f261` (fix) + `935bf1558` (this QA's adversarial test)
- **Inputs:** `IMPLEMENTATION_ORCH-1036_GATE_OVERRIDE_CLOBBER.md`, `INVESTIGATION_ORCH-1036_GATE_OVERRIDE_CLOBBER.md`
- **Comms ledger:** read on entry. No `BLOCK`/`OPEN` row addressed to `mingla-tester`, `ORCH-1036`, or `ALL` requires action for this app-mobile-only frontend QA. COMMS-0002/0003/0004 are backend/external-API/intake concerns (N/A — no `supabase/functions`, no migration, no external API, not an INTAKE turn). COMMS-0017 (physical Samsung reservation) is RESOLVED. No new cross-ORCH discovery requiring a ledger write.

---

## VERDICT: CONDITIONAL PASS

The fix is **correct and complete at the code + unit/integration + DB-evidence layers**, and **BOTH clobber sites are fixed**. The single reason this is CONDITIONAL rather than full PASS is the live full-onboarding sim repro: it is **not cleanly feasible from this worktree without violating two hard constraints** (see §6). The unit/integration floor is fully met and the production DB evidence independently corroborates both the bug and the post-fix outcome. Orchestrator may accept the deferral, or run the optional live leg per §6 before CLOSE.

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 (empty/whitespace label not trimmed — not reachable via real onboarding state; pinned by test) |
| P4 | 2 (clean resolver isolation; DB↔cache now provably agree) |

---

## 1. BOTH clobber sites confirmed fixed (the dispatch's central question)

The dispatch flagged TWO clobber sites in `handleSavePreferences`. Mapping the anchor-WIP line numbers (1732 + 1758) to the actual code:

| Site | Anchor line (gate WIP) | What it is | Pre-fix | Post-fix (worktree) | Fixed? |
|---|---|---|---|---|---|
| **Site 1** | `OnboardingFlow.tsx:1732` | Persisted `PreferencesService.updateUserPreferences` upsert | `custom_location: data.manualLocation` (+ `as any`, OMITS coords) | `custom_location: resolvedCustomLocation` + explicit `custom_lat/lng` from resolver; `as any` removed | ✅ worktree line 1595 |
| **Site 2** | `OnboardingFlow.tsx:1758` | In-handler `queryClient.setQueryData(['userPreferences', user.id], …)` cache pre-seed | `custom_location: data.manualLocation`, coords from `data.coordinates` | `custom_location: resolvedCustomLocation`, coords from resolver | ✅ worktree line 1623 |

**The dispatch's "solo vs collab" guess was incorrect** — the two sites are **DB-write vs React-Query-cache-write**, both inside the single `handleSavePreferences`. Both nulled `custom_location` for a gate user because `data.manualLocation` is always null on the gate path. The implementor's investigation only named Site 1 explicitly (line 1732) but DID fix both; this QA independently confirms Site 2 (the cache write) was also clobbering and is now fixed.

**Crucially, both sites consume the SAME resolver result.** The fix destructures `resolveOnboardingLocationOverride(...)` ONCE into `resolvedCustomLocation`/`resolvedCustomLat`/`resolvedCustomLng` (worktree lines 1573-1582) and reuses those three vars in both the DB upsert (1595-1597) and the cache write (1623-1625). Therefore the persisted row and the in-session cache are guaranteed byte-identical on the location fields — this also closes the investigation's §6 "cache vs DB divergence" hidden flaw. Verified by reading the diff and by my adversarial two-writer-parity test.

Evidence — actual diff (worktree `caeb5f261` vs base `e944b0b20`):
```
- custom_location: data.manualLocation,                  →  custom_location: resolvedCustomLocation,   (DB)
+ custom_lat: resolvedCustomLat, custom_lng: resolvedCustomLng,  (now explicit at DB site)
- } as any),                                              →  }),                                        (cast removed)
- custom_location: data.manualLocation,                  →  custom_location: resolvedCustomLocation,   (cache)
- custom_lat: data.coordinates?.lat ?? null,             →  custom_lat: resolvedCustomLat,
- custom_lng: data.coordinates?.lng ?? null,             →  custom_lng: resolvedCustomLng,
```

If only one site had been fixed, this would be a FAIL. **Both are fixed.** PASS on the central question.

---

## 2. Implementor regression test — green + fails-on-revert (independently re-verified)

- **Path:** `app-mobile/src/utils/__tests__/onboardingLocationOverride.test.ts` (4 tests, Deno).
- **Run (fix in place):** `4 passed | 0 failed`.
- **Fails-on-revert (this QA re-ran it, not trusting the implementor's claim):** I reverted the resolver body to the pre-fix behavior (`custom_location: state.manualLocation` unconditionally) and re-ran → `1 passed | 3 failed`. The critical gate-survival test failed `custom_location` Actual=`null` vs Expected=`"Washington"`; the GPS-clean test and the resolver-unit test also failed. Restored the resolver → `4 passed`. Tree clean afterward (only a `deno.lock` cache touch, reverted).

Command (from `app-mobile/`): `/Users/sethogieva/.deno/bin/deno test --no-check src/utils/__tests__/onboardingLocationOverride.test.ts`

The test correctly models the PostgREST column-scoped upsert (provided keys incl. explicit null overwrite; omitted keys preserved), matching the investigation's proven mechanism and `preferencesService.ts:75` (`upsert(payload)` with no `onConflict`).

---

## 3. Tester adversarial regression test — distinct angle, green + fails-on-revert

- **Path:** `app-mobile/src/utils/__tests__/onboardingLocationOverride.adversarial.test.ts` (5 tests, Deno). Committed to the ORCH-1036 branch as `935bf1558` so it ships in the closing PR.
- **Distinct angles (NOT a renamed copy of the happy-path test):**
  1. **Two-writer DB↔cache parity** — asserts the persisted DB write AND the in-handler `setQueryData` cache write carry the IDENTICAL resolved override. The implementor's test only exercises a single upsert simulator; this attacks the cold-relaunch-vs-in-session divergence (investigation §6 hidden flaw) that the bug spanned across BOTH sites.
  2. **GPS → custom → GPS toggle** in one session — a user who picked a city then re-ran GPS; the resolver must NULL the stale override (the inverse failure mode). Models an existing override row being cleared.
  3. **Idempotency** — running the final save twice converges to the same row, no drift.
  4. **Non-GPS with no label at all** — resolver does not invent a label.
  5. **Empty/whitespace label boundary** — pins current behavior (P3, see §5).
- **Run (fix in place):** `5 passed | 0 failed`. Combined with the implementor's: `9 passed | 0 failed`.
- **Fails-on-revert:** against the pre-fix resolver → `1 passed | 4 failed` (parity, GPS-toggle, idempotency, and empty-label tests all break; only the all-null defensive case survives). Restored → green.

---

## 4. Both-path trace (Step 3 of dispatch)

- **Site 1 (DB) + Site 2 (cache) both apply the resolver** — confirmed §1.
- **Cache update matches persisted values** — both sites read the same three destructured vars; a true GPS user ends with `custom_location=null`/`custom_lat=null`/`custom_lng=null`/`use_gps_location=true` at BOTH sites (resolver GPS branch returns all-null; `use_gps_location: data.useGpsLocation` is `true`). Verified by code read + adversarial parity test + resolver probe (`useGpsLocation:true` → `{custom_location:null,custom_lat:null,custom_lng:null}` even with stale cityName/coords present).
- **Downstream consumers (cross-domain):**
  - `PreferencesSheet.tsx:433` — `if (!isGps && prefs.custom_location) setSearchLocation(prefs.custom_location)`. Pre-fix null → blank city box (the user-visible symptom). Post-fix "Washington" → label renders. **Symptom fixed.**
  - `PreferencesSheet.tsx:447` — coords from `custom_lat/lng` (survived even pre-fix; unchanged).
  - `useUserLocation.ts:140-143` — reads `custom_lat/lng/location` + `use_gps_location` from cached prefs; cache + DB now agree, so deck and label are consistent on cold relaunch.
- **No third location writer introduced.** Writers remain: gate (`handleLaunchGateConfirmCity`, anchor only), final save (now derives from the same state), Preferences sheet. The resolver is a pure derivation of existing onboarding state.

---

## 5. Findings

- **P3 — empty/whitespace `cityName` is not trimmed/empty-checked.** The resolver uses `??`, which only catches `null`/`undefined`. Probe: `cityName:""` → `custom_location:""` (not null); `"   "` → `"   "`. **Not a live bug:** the gate sources `cityName` from `seeding_cities.name` (always a real non-empty string, e.g. "Washington" — confirmed in DB) and the legacy path sources `manualLocation` from a geocoded address; neither can be empty via real onboarding. Even if `""` slipped through, `PreferencesSheet.tsx:433` gates on truthiness so `""` reads as "no custom location" (same as null) — no visible corruption. Pinned by an adversarial test so a future `trim()`/empty-check is deliberate, not a silent change. Optional hardening for a follow-up; not a blocker.
- **P4 — clean resolver isolation.** Extracting `resolveOnboardingLocationOverride` as a pure function is the right call: it makes the exact shipped logic unit-testable with fails-on-revert and keeps the gate as semantic owner (I-1028 honored).
- **P4 — DB↔cache now provably agree.** Single resolver call feeding both sites eliminates the divergence class entirely.
- **Out-of-scope note (already flagged by implementor §10):** the legacy `handleManualLocation` flow never sets `useGpsLocation=false`; if a legacy typed-city user retained `useGpsLocation=true`, the resolver's GPS branch would null their typed city. The gate path correctly sets `useGpsLocation=false`, so ORCH-1036's scope is unaffected. Latent legacy gap worth a follow-up ORCH if that path is still reachable — NOT a regression introduced by this fix.

---

## 6. Live full-onboarding repro — attempted, blocked, with strong DB-evidence substitute

**Result: live end-to-end sim repro NOT cleanly feasible from this worktree.** Stated explicitly per the dispatch.

**Why (two hard blockers, both honored rather than overridden):**
1. **The gate code and the fix live in different places.** The ORCH-1028 launch-city gate (`handleLaunchGateConfirmCity`/`launchGate`/`check-launch-city`) that *triggers* the bug exists ONLY as **uncommitted WIP on the anchor `~/Desktop/mingla-main` `OnboardingFlow.tsx`** (confirmed: anchor on `main`, file shows `M`, gate handler present at anchor lines ~1536-1548). This ORCH-1036 worktree branch is based on `e944b0b20`, which **predates the gate** — `grep` for the gate handler in the worktree returns nothing. So no single checkout currently has BOTH the gate AND the fix in one runnable bundle. (This is exactly the implementor's §10 discovery.)
2. **Metro :8109 is the operator's live test session and must not be disturbed.** `lsof` confirms node PID 43534 listening on :8109; the dispatch and the running-Metro state indicate Seth is actively testing the anchor WIP. Producing a clean repro would require either applying the fix onto the anchor's gate WIP and reloading (forbidden — `feedback_shared_anchor_checkout_staging_hazard.md`: never edit the shared anchor working tree where another session's uncommitted gate work lives; it would also mutate what Seth is testing mid-session) or killing/replacing Metro :8109 (explicitly forbidden by the dispatch).

**What was verified instead (the unit test is the floor; this is the ceiling available without the blockers):**
- **Production DB evidence — bug present (independent of the implementor's claims):** `SELECT … FROM preferences ORDER BY updated_at DESC` returns two rows written today (`4c500601` 07:26 UTC, `78d9913f` 07:04 UTC) with the exact clobber fingerprint — `use_gps_location=false`, `custom_location=NULL`, `custom_lat=38.9072873`, `custom_lng=-77.0369274` (the precise `seeding_cities` Washington center, the only `is_live_for_consumers=true` city). Coords survived, label nulled — the column-scoped-upsert signature.
- **Production DB evidence — the fix's target outcome is reachable:** legacy non-GPS rows (`ac7f00ee`, `84f1980e`) show `use_gps_location=false` WITH a non-null `custom_location` string AND coords — proving a non-GPS row CAN and SHOULD carry a label. A true GPS row (`c727d491`) shows `use_gps_location=true` + all custom_* null — the clean state the resolver preserves. The resolver, fed the gate user's state (`useGpsLocation=false, cityName="Washington", coords={38.907,-77.037}`), yields `custom_location="Washington"` + those coords at both sites — converting the `4c500601`/`78d9913f` NULL signature into a non-null "Washington" row. This is exactly what regression test #1 asserts.
- **No production data mutated.** Read-only queries only; the two repro rows left intact (no test-data cleanup needed since nothing was written).

**Confidence ladder:** the *runtime mechanism* is `proven` at the SQL/DB layer (matching production rows from today + deterministic resolver behavior), and the code-level fix is `proven` by diff + 9 passing tests with fails-on-revert. The *full Maestro-driven fresh-account onboarding* leg is `probable`-blocked (blocker named, not hand-wavable). Per the tester verdict gate, a UI/runtime change without a `proven` full-platform sim leg caps at CONDITIONAL PASS with explicit operator deferral — which is what this is.

**To convert to full PASS (optional, orchestrator's call), the cleanest path is at CLOSE time:** once ORCH-1028's gate is committed and ORCH-1036 is rebased/merged so a single bundle has BOTH, run one Maestro flow: fresh account → set sim GPS outside DC → pick Washington at the gate → complete onboarding → assert the new `preferences` row has `custom_location="Washington"`, `use_gps_location=false`, coords intact. The fix's old-strings are byte-identical to the anchor WIP's `handleSavePreferences` (verified: anchor 1722-1764 matches the worktree pre-fix body), so the merge is clean and the post-merge behavior is the tested behavior.

---

## 7. Platform parity

`OnboardingFlow.tsx` is shared consumer code → iOS + Android inherit the identical fix automatically (single file, no platform branches in the changed code). Web: no consumer onboarding flow (N/A). Business/Admin: separate apps, no consumer onboarding (N/A). The fix is pure TS state-derivation with no platform-specific API — parity is automatic by construction.

---

## 8. Constitution + invariants

- **Rule 2 (one owner per truth):** IMPROVED. The final save no longer introduces an independent null-valued writer of `custom_location`; it derives from the same onboarding state the gate populated. Gate remains semantic owner. **I-1028-ONE-LOCATION-OWNER honored.**
- **I-LOCATION-INVALIDATE-ON-LOCATION-ONLY:** PASS. No query-key shape changed; `useUserLocation` key untouched; no new `invalidateQueries`. The `setQueryData(['userPreferences', user.id], …)` write is an existing call, only its location field VALUES changed.
- **Rule 3 (no silent failures):** unchanged (existing try/catch + `setPrefsSaveError`).
- Rules 1, 4-14: N/A or unchanged — no taps, keys, auth, currency, datetime, or hydration logic touched.

---

## 9. Completion-condition checklist (`/goal`)

1. Independent tests green — ✅ `9 passed | 0 failed` (4 implementor + 5 adversarial), output captured §2-§3.
2. `tsc --noEmit` on app-mobile — ✅ no errors in the three touched files (`OnboardingFlow.tsx`, `onboardingLocationOverride.ts`, `preferencesService.ts`); pre-existing unrelated errors elsewhere only.
3. Both regression tests in `git diff origin/main --name-only` — ✅ all four files present (fix ×2 + both tests); adversarial attacks a different angle (DB↔cache parity / GPS-toggle / idempotency); implementor's fails-on-revert re-verified this turn at the pre-fix resolver state.
4. UI/runtime full-platform `proven` sim leg — ⚠️ NOT met for the full-onboarding Maestro leg (blocked per §6, blocker named and genuinely unresolvable without violating the anchor-edit / don't-kill-Metro constraints). DB-layer runtime mechanism IS `proven`. This is the one clause forcing CONDITIONAL rather than full PASS.
5. Zero open P0/P1 — ✅ (only 1×P3 + 2×P4).

Clauses 1-3 and 5 fully met; clause 4 is the explicit deferral.

---

## 10. Recommendation to orchestrator

**CONDITIONAL PASS — safe to CLOSE with the live-onboarding leg deferred to merge time.** Both clobber sites are fixed, both tests pass with fails-on-revert and ship in the PR, the DB evidence proves both the bug and the fix's target outcome, and all invariants hold. The only gap is the full Maestro onboarding repro, which is structurally blocked until ORCH-1028's gate and this fix coexist in one bundle (i.e. at merge). Recommended close path: ensure ORCH-1028 gate is committed, rebase/merge ORCH-1036 on top, then run the one-flow Maestro repro in §6 as the final pre-CLOSE confirmation (byte-identical old-strings guarantee a clean merge).
