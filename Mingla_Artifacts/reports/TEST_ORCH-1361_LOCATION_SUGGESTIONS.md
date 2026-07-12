# TEST / QA — ORCH-1361 [location-suggestions]

Consumer Preferences custom-location field → shared multi-row Mapbox suggest→retrieve list + optional device-proximity/country bias (additive edge fn). OQ-4 CityPicker bias.

- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1361_LOCATION_SUGGESTIONS.md`
- **Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1361_LOCATION_SUGGESTIONS.md`
- **Worktree:** `~/Desktop/mingla-orchs/1361-[location-suggestions]/` on branch `1361-location-suggestions`
- **Tester HEAD:** `c2d35f203` (adversarial test + CI reg). Fix commit `f80cbf729`. Impl report `3494e68db`.
- **Runtime evidence:** `Mingla_Artifacts/evidence/ORCH-1361/captures/` (6 iOS screenshots) + `evidence/ORCH-1361/live_edge_fn_probes.txt` (forensics).

---

## 1. VERDICT — **PASS** (with required CLOSE deploy + post-deploy ranking smoke)

**Finding counts:** P0 = 0 · P1 = 0 · P2 = 0 · P3 = 1 · P4 = 2.

Zero P0/P1. All NEW behavior runtime-proven on iOS. No-regression (SC-6/SC-7) proven at the Deno + shared-service runtime layers + confirmed the LIVE fn is unchanged (v132). The **proximity-bias RANKING improvement is a post-deploy operator condition** — the biased `mapbox-geocode` is NOT yet deployed (live = v132, old no-bias code), so it CANNOT be exercised pre-merge; this is stated as a CLOSE-gated smoke, and per dispatch it does NOT block PASS. Regression gate satisfied: implementor happy-path (fails-on-revert re-run by me) + tester adversarial (different angle, on-branch, in-diff, own fails-on-revert).

Routes to **CLOSE**. CLOSE must (a) deploy `mapbox-geocode` (verify_jwt=true) + curl-verify, (b) run the post-deploy ranking smoke in §5, (c) flip `I-PROPOSED-1361-…` ACTIVE.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence (confidence) |
|----|-----------|---------|-----------------------|
| **SC-1** iOS | ≥4 chars → **multi-row** list (not single row) | **PASS — runtime-proven** | Typed "lekki" on iPhone 17 Pro (dev build, worktree Metro 8091). List rendered 4+ rows: "Lekki Phase 2 / Lagos, Lagos, Nigeria", "Lekki Dubai", "Lekki Phase 1 / Lagos, Lagos, Nigeria", "Lekki STYL Catering…". `captures/03_multirow_list_lekki.png`. Old field showed ONE London row; new field shows a real Lagos-bearing list. |
| **SC-1** Android | same (shared RN) | **PASS — parity by shared code** | Diff is 100% platform-agnostic shared RN (field/wrapper/service/host — zero iOS/Android forks). Not independently driven (no emulator booted). |
| **SC-2** | Lagos "lekki" surfaces Lekki Lagos NG; pick stores Lekki coords (NOT London) | **PASS (not-London) — runtime-proven; ranking-to-#1 = post-deploy CONDITION** | Picked "Lekki Phase 2" → chip "Lekki Phase 2, Lagos, Lagos, Nigeria"; stored coords are the Lagos feature (retrieve returned structured region "Lagos, Lagos, Nigeria"), NOT London. `captures/04_picked_chip_lagos.png`. The device-anchor-ranks-Lagos-#1 half needs the deployed biased fn (see §5). |
| **SC-3** | pick → chip w/ working clear; clear → editable field | **PASS — runtime-proven** | Pick → orange chip w/ X (`04`). Tapped X → returned to editable "Search for a starting spot…" field (`captures/05_cleared_back_to_field.png`). |
| **SC-4** | no device location → field still works, proximity omitted | **PASS — runtime-proven** | Cleared sim location (`simctl location clear`), typed "victoria island" → multi-row list rendered, no crash (`captures/06_gps_denied_multirow_no_crash.png`). Nigerian "Victoria Island, Lagos" ranked #3 behind two Canadian ones — un-biased fallback confirmed. |
| **SC-5** | FREE user still hits Mingla+ paywall (I-1315); field hidden for locked | **PASS — preservation-verified** | Lock/paywall wiring byte-identical (`overlay={paywall}`, `presentInline`, `canAccess('custom_starting_point')`, `isLocked`, `onLockedTap`, GPS-row `TouchableOpacity`/labels) — NOT in diff, present in host (lines 1211-1212, 1454-1542). `orch-1315-preferences-custom-location-paywall.test.tsx` re-run PASS post-change. Swap sits strictly INSIDE `!useGpsLocation && !isLocked`. Not re-driven at runtime (test account is Mingla+; flipping the entitlement needs a RevenueCat/prod change I must not make). ORCH-1315 device-proved this exact gating code on iOS (COMMS-0084). |
| **SC-6** | omitted params → byte-identical edge request; business + CityPicker unchanged | **PASS — proven (Deno + runtime service capture + live-fn version)** | (a) Edge Deno: `buildSuggestUrl/buildForwardUrl` == exact pre-1361 string when unbiased. (b) Shared-service **runtime invoke-body capture**: no-bias → `{action,query,session_token}`; falsy-bias object → same, no leaked keys (my adversarial A1-A3). (c) `mingla-business/**` fully untouched (0 files in diff). (d) LIVE fn = v132 (unchanged) so no pre-deploy behavior shift. |
| **SC-7** | bias off by default; CityPicker not regressed | **PASS — proven** | New props all optional; absent → service merges nothing (runtime-captured). CityPicker only ADDS proximity/country (OQ-4), passes no `types`/`suggestLimit` → suggest limit stays edge-default 5 (byte-identical). |

---

## 3. Findings

### P3-1 — Save-path re-geocode fallback left un-biased (deliberate scope; low impact)
- **Evidence:** `PreferencesSheet.handleApplyPreferences` still calls `geocodingService.autocomplete(searchLocation)` (no bias) for a typed-but-unpicked string. `geocodingService.ts` is NOT in the SPEC allowlist; SPEC §4.6 marked biasing it "OPTIONAL / non-blocking".
- **Impact:** With the multi-row field a pick ALWAYS sets `selectedCoords`, so this fallback rarely fires; when it does it behaves exactly as pre-1361 (no regression). Only a user who types a string and applies WITHOUT picking a row loses the bias.
- **Fix (follow-on, not this ORCH):** add an optional `bias` arg to `geocodingService.autocomplete` and pass `{proximity,country}` (Discovery #2).
- **Retest:** type-without-pick + apply, assert the resolved coord is user-biased once the fn is deployed.

### P4-1 (praise) — Subtract-before-add executed cleanly (Constitution #8)
The hand-rolled `BottomSheetScrollView` dropdown + `onSuggestionSelect`/`handleSuggestionSelect`/`handleInputBlur` + `showSuggestions`/`isLoadingSuggestions`/`isInputFocused`/`isSelectingSuggestion` state + 9 dead styles + 2 dead imports were DELETED, not left alongside the new shared field. No dual-owner path.

### P4-2 (praise) — Additive edge contract with a pure, unit-tested URL builder
`buildSuggestUrl`/`buildForwardUrl`/`clampSuggestLimit` extracted as pure exported fns → byte-identical-when-unbiased is machine-checkable (SC-6) and both directions fail-on-revert.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

Re-ran on tester HEAD (worktree). All reverts by **true line deletion**, restored via `git checkout`; tree clean after each.

1. **Edge (implementor happy-path).** Deleted the `if (opts.proximity/country/types) url +=` appends + reverted the suggest limit to hardcoded `&limit=5` in `buildSuggestUrl` → `deno test … mapboxGeocodeBias.orch1361.test.ts` = **RED (4 passed / 3 failed)** — exact failing assertions: "proximity + country + types appended when present", "limit … clamped to [1,10]", "bias params are url-encoded". Restored → **7/7 green**.
2. **App-mobile source-structure (implementor happy-path).** Deleted `types="…"` + `suggestLimit={8}` from `LocationInputSection` → **RED (10 passed / 1 failed)** — failing test `P-1c: OQ rulings … types filter (OQ-3), suggestLimit 8 (OQ-2)`. Restored → **11/11 green**.
3. **Full registered CI command** (`deno test --allow-read --no-check` on all three files) → **26 passed / 0 failed**.
4. **ORCH-1315 paywall backstop** (`npx tsx orch-1315-preferences-custom-location-paywall.test.tsx`) → **PASS** post-change.

Implementor claim (edge 4-fail / app-mobile P-1c-fail) **independently reproduced**.

---

## 5. Post-deploy ranking condition (CLOSE-gated operator smoke — NOT a blocker)

The biased ranking (device in Lagos → "lekki" ranks Lekki Lagos #1 via the biased request) needs the deployed fn + `MAPBOX_ACCESS_TOKEN`. Live `mapbox-geocode` is **v132 (old, no-bias)** — verified read-only via Supabase MCP `get_edge_function`; `handleSuggest` hardcodes `&limit=5`, no proximity/country/types. So this is provable ONLY post-deploy.

**Exact operator live-fire (run after `supabase functions deploy mapbox-geocode`):**

```bash
BASE=https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/mapbox-geocode
JWT=<anon or user access token>   # verify_jwt=true

# A) BIASED — expect Lekki Phase 1/2 (Lagos, Nigeria) at the top; Dubai/Poland/UK dropped (country=ng)
curl -s -X POST "$BASE" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"action":"suggest","query":"lekki","session_token":"smoke-biased","proximity":"3.4,6.45","country":"ng","limit":8}' | jq '.suggestions[] | {displayName,fullAddress}'

# B) UNBIASED control — expect the current global-noise order (Phase 2, Dubai, Phase 1, Poland, UK)
curl -s -X POST "$BASE" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"action":"suggest","query":"lekki","session_token":"smoke-unbiased"}' | jq '.suggestions[] | {displayName,fullAddress}'

# C) NO-REGRESSION — B must be byte-identical to the pre-deploy response (business pickers unchanged)
```

**Device confirm:** `xcrun simctl location <UDID> set 6.45,3.4` (Lagos lat,lng) → open Preferences → toggle GPS off → type "lekki" → both Lagos entries should now sit at the top (vs the #1/#3 interleaving seen against v132).

---

## 6. Adversarial regression test (tester-owned)

- **Path:** `supabase/functions/mapbox-geocode/__tests__/mapboxGeocodeBias.orch1361.adversarial.test.ts` (NEW, append-only). Committed `c2d35f203`; in `git diff origin/main...HEAD --name-only`. CI-registered in the `orch-1361-location-suggestions-deno-tests` job (added to `DENO_TEST_FILES`; path already covered by the `supabase/functions/mapbox-geocode/**` filter).
- **Angle (different from implementor):** the implementor tested pure edge URL builders with an EMPTY `{}` opts + simple clamps. This suite attacks (1) the **SERVICE-LAYER invoke body** (never touched by the implementor) under a **populated-but-FALSY bias object** — `{proximity:undefined, country:"", types:undefined, limit:0}`, the exact GPS-denied host shape — asserting it merges to a byte-identical `{action,query,session_token}` with NO leaked keys; (2) **clamp boundary** hardening — negative → 1, NaN/±Infinity → 5, fractional truncation (8.9→8, 10.9→10, 1.999→1); (3) **injection defense** — a proximity carrying `&access_token=EVIL&limit=999` must be url-encoded to one param, not smuggle a second access_token/limit into the upstream URL.
- **Result:** 8/8 green.
- **fails-on-revert verified at `c2d35f203`:** reverted the service `...(bias?.country ? {country} : {})` merge guards to an unconditional spread (`country: bias?.country`) → adversarial suite **RED (5 passed / 3 failed)** — A1/A2/A3 leaked empty keys into the body. Restored via `git checkout` → 8/8 green. (Also guards clampSuggestLimit + the edge append guards.)

---

## 7. Constitution 14-rule matrix (independent, vs the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | Suggestion row FIRED at runtime (tap "Lekki Phase 2" → retrieve → chip). Locked GPS row remains a pressable (`onLockedTap`). |
| 2 | One owner per truth | **PASS** | `custom_lat/lng` ← `selectedCoords`, set only in `handlePickLocation`. Old dual (`handleSuggestionSelect`+forward) deleted. |
| 3 | No silent failures | **PASS** | Shared field surfaces no_results/offline/pick_error. Host's country reverse-geocode catch omits a REFINEMENT (proximity still works) — documented, not user-facing silence. |
| 4 | One query key per entity | **N/A** | No query-key change; `useUserLocation` untouched. |
| 5 | Server state stays server-side | **PASS** | `proximity`/`country` are local `useState`, not Zustand. |
| 6 | Logout clears everything | **N/A** | No new persisted state. |
| 7 | Label temporary `[TRANSITIONAL]` | **N/A** | None. |
| 8 | Subtract before adding | **PASS** | Dead dropdown + state + styles + imports removed (P4-1). |
| 9 | No fabricated data | **PASS** | proximity from real device coords; country from real `reverseGeocode`; no fabrication. |
| 10 | Currency-aware | **N/A** | Location, not currency. |
| 11 | One auth instance | **N/A** | No auth change. |
| 12 | Validate at the right time | **PASS** | `handlePickLocation` validates `|lat|≤90, |lng|≤180` before storing. |
| 13 | Exclusion consistency | **N/A** | — |
| 14 | Persisted-state startup gate | **N/A** | proximity resolved on `visible`; no new persisted state. |

Zero violations.

---

## 8. Device / parity matrix

| Surface | Ships? | Verdict | Notes |
|---------|--------|---------|-------|
| Consumer iOS | YES | **PASS — proven** | iPhone 17 Pro (iOS 26.4) dev build vs worktree Metro 8091. SC-1/2(not-London)/3/4 + Constitution #1 driven; 6 screenshots. |
| Consumer Android | YES | **PASS — parity by shared code** | 100% shared RN, zero platform forks in diff. No emulator booted → not independently driven (honest scope; spec §5 says iOS↔Android parity automatic). |
| Buyer/anon Web | NO | N/A | No edge-fn caller (no buyer-web address autocomplete). |
| Business iOS | NO (no-regression) | **PASS — SC-6** | `mingla-business/**` 0 files in diff; unbiased callers byte-identical (Deno + service capture). Not driven (nothing changed). |
| Business Android | NO (no-regression) | **PASS — SC-6** | Same. |
| Admin Web | NO | N/A | No caller. |
| Business Web preview | NO (no-regression) | **PASS — SC-6** | Same business pickers. |
| Physical iPhone (HITL) | — | **Not requested** | Sim proof sufficient for these SCs; no hardware-keyboard-config bug in scope (query typing only). |
| Edge-fn live deploy | — | **v132 old (NOT deployed)** | Verified read-only (Supabase MCP). Biased ranking = post-deploy (§5). |

**Static gates (independently re-run):**
- ORCH-1361 Deno suites (edge happy-path + app-mobile source-structure + tester adversarial) = **26 passed / 0 failed** (CI command).
- ORCH-1315 paywall test = **PASS** post-change.
- app-mobile `tsc --noEmit` = 906 errors total but **0 on any of the 4 touched app-mobile SOURCE files**; the 18 `packages/location-input` errors are the pre-existing "Cannot find module 'react'" structural class (1 react error → 17 cascading implicit-any binding elements; +4 vs baseline = the 4 new optional props on an already-broken file). Not a real type defect.
- eslint on the 4 touched files = 21 problems (2 errors, 19 warnings); **both errors are pre-existing untouched lines** (`PreferencesSheet.tsx:1160` participant banner `react/no-unescaped-entities`; `location/MapboxAddressInput.tsx:27` pre-existing `@mingla/location-input` import `import/no-unresolved`). **Zero NEW lint problems.**

---

## 9. Discoveries for Orchestrator

1. **OQ-5 / F-7 OnboardingFlow** (`OnboardingFlow.tsx:~991`) — identical forward/limit=1 + no-bias single-row bug with its own hand-rolled dropdown. OUT of 1361 scope; implementor tracked it as ORCH-1362. Same multi-row + bias treatment recommended.
2. **geocodingService.autocomplete bias follow-on** (P3-1) — to bias the Preferences save-path fallback + any other `geocodingService.autocomplete` caller, add an optional `bias` arg (not in the 1361 allowlist). Small, low-risk.
3. **Invariant flip owed at CLOSE:** `I-PROPOSED-1361-CONSUMER-LOCATION-PROXIMITY-BIASED` → ACTIVE (orchestrator owns). Now holds for Preferences + CityPicker; OnboardingFlow is the one consumer location surface not yet biased (ORCH-1362).
4. **Notification re-prompt loop (unrelated):** the consumer dev build re-fires the native "Open Settings / notifications turned off" alert on every foreground (the OneSignal optIn stale-cache pattern, COMMS-0066 lineage). Not this ORCH; blocked sim driving momentarily — noted for hygiene.

---

## 10. CLOSE-readiness

**READY for CLOSE** — PASS, zero P0/P1, regression gate satisfied, both tests on-branch/in-diff with independently-reproduced fails-on-revert. CLOSE steps: (1) deploy `mapbox-geocode` (preserve `verify_jwt=true`) + curl-verify §5-C no-regression; (2) run §5-A/B post-deploy ranking smoke (operator/Seth) — a CONDITION, not a re-open trigger; (3) flip `I-PROPOSED-1361-…` ACTIVE; (4) register OQ-5 (ORCH-1362) + P3-1 follow-on.
