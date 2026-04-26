# QA Report — ORCH-0675 Wave 1 — Android Performance Surgical Fixes

**ORCH-ID:** ORCH-0675 Wave 1
**Tester:** mingla-tester (Claude Code session, shell + file access only — NO device, NO instrumentation harness)
**Date:** 2026-04-25
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0675_WAVE1_ANDROID_PERF.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0675_WAVE1_REPORT.md`
**Tester dispatch:** `Mingla_Artifacts/prompts/TESTER_ORCH-0675_WAVE1_ANDROID_PERF.md`

---

## 1. Verdict

**CONDITIONAL PASS** — with explicit conditions accepted only if founder/QA executes the 14 device-dependent tests on real hardware before commit.

| Severity | Count | Notes |
|----------|-------|-------|
| P0 — CRITICAL | 0 | No constitution violations, no security defects, no crash paths, no data fabrication |
| P1 — HIGH | 0 | No contract breaks, no broken features in static-verifiable scope |
| P2 — MEDIUM | 0 | No pattern deviations |
| P3 — LOW | 1 | Module-scoped `pendingWrites` Map is shared if a second Zustand store ever exists (defense-in-depth nit, not a defect today) |
| P4 — NOTE | 4 | Praise — see §10 |

**Static-verifiable SCs:** 8 of 12 PASS.
**Live-fire-required SCs:** 4 of 12 UNVERIFIED (SC-7 bundle byte-size %, SC-8 language-switch timing, SC-10 write-rate %, SC-11 background-flush survival) — these can ONLY be verified on real Android device + instrumentation that this tester does NOT have.

**Recommendation:** orchestrator should treat as PASS for static + CI gate dimensions; require founder to execute device tests T-01 through T-14, T-18 through T-21 on real hardware (Samsung A-series + iOS) BEFORE commit + OTA. If founder accepts that as a substitute for live-fire SC-7/8/10/11, this becomes Grade A close. Otherwise it's a `LIVE-FIRE PENDING` hold.

---

## 2. Pre-Flight Re-Verification (Independent)

Per dispatch §A. Tester re-ran every grep independently — did NOT trust implementor counts.

| # | Counted | Expected | Actual | Verdict |
|---|---------|----------|--------|---------|
| 1 | SwipeableCards `useNativeDriver: false` in PanResponder body 1216-1380 | 0 | **0** | ✅ |
| 2 | SwipeableCards `positionX`/`positionY` references | ≥30 | **32** | ✅ |
| 3 | SwipeableCards remaining `position\.` references (CSS strings excluded) | 0 | **0** | ✅ |
| 4 | DiscoverScreen `useNativeDriver: false` in skeleton 575-620 | 0 | **0** | ✅ |
| 5a | i18n static `en` imports | 23 | **23** | ✅ |
| 5b | i18n lazy loader entries | 28 | **28** | ✅ |
| 5c | i18n total static locale imports (must = 5a, no non-en static) | 23 | **23** | ✅ |
| 6a | appStore `debouncedAsyncStorage` references | ≥3 | **3** | ✅ |
| 6b | appStore raw `createJSONStorage(() => AsyncStorage)` | 0 | **0** | ✅ |
| 6c | appStore `(AppState\|RNAppState).addEventListener('change'` | ≥1 | **1** | ✅ |

**All 9 counts match expected.** Implementor's claims independently verified.

---

## 3. CI Gates on Current Code (Independent Run)

```
$ bash app-mobile/scripts/ci/check-no-native-driver-false.sh
I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS  [exit 0]

$ bash app-mobile/scripts/ci/check-i18n-lazy-load.sh
I-LOCALES-LAZY-LOAD: PASS (23 static en imports, 28 lazy loaders)  [exit 0]

$ bash app-mobile/scripts/ci/check-zustand-persist-debounced.sh
I-ZUSTAND-PERSIST-DEBOUNCED: PASS  [exit 0]
```

All 3 gates PASS exit 0 on current state.

---

## 4. Negative-Control Re-Verification (T-15, T-16, T-17 — Independent)

Tester independently injected violations + reverted, did NOT trust implementor logs.

### T-15 — I-ANIMATIONS-NATIVE-DRIVER-DEFAULT
| Step | Action | Result |
|------|--------|--------|
| A | `awk` injected `useNativeDriver: false` at line 1259 (inside PanResponder region 1216-1380) | Line modified |
| B | Run gate | **Exit 1** with `I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation in SwipeableCards swipe handler` and offending line cited ✅ |
| C | Restore from `/tmp/sc_tester_backup.tsx` | Reverted |
| D | Re-run gate | **Exit 0** with `PASS` ✅ |
| **Verdict** | **PASS** — gate structurally fires + recovers | |

### T-16 — I-LOCALES-LAZY-LOAD
| Step | Action | Result |
|------|--------|--------|
| A | `sed` injected `import fr_common from './locales/fr/common.json'` at line 24 | Line injected |
| B | Run gate | **Exit 1** with `I-LOCALES-LAZY-LOAD violation: 1 non-en static locale import(s)` + offending line cited ✅ |
| C | Restore | Reverted |
| D | Re-run gate | **Exit 0** with `PASS (23 static en imports, 28 lazy loaders)` ✅ |
| **Verdict** | **PASS** | |

### T-17 — I-ZUSTAND-PERSIST-DEBOUNCED
| Step | Action | Result |
|------|--------|--------|
| A | `sed` replaced `createJSONStorage(() => debouncedAsyncStorage)` with raw `AsyncStorage` | Reverted to raw adapter |
| B | Run gate | **Exit 1** with TWO violations: `createJSONStorage must reference debouncedAsyncStorage` AND `raw AsyncStorage adapter still present (bypasses debounce)` ✅ |
| C | Restore | Reverted |
| D | Re-run gate | **Exit 0** with `PASS` ✅ |
| **Verdict** | **PASS** | |

**All 3 gates structurally prevent regression.** Each fires loudly with named invariant when violated. Each passes cleanly on intact code.

---

## 5. TypeScript Check on Wave 1 Files

```
$ npx tsc --noEmit 2>&1 | grep -E "SwipeableCards.tsx|DiscoverScreen.tsx|i18n/index.ts|store/appStore.ts"
(zero output)
```

**Zero TypeScript errors in any of the 4 modified Wave 1 files.** Tsc exit code 1 indicates pre-existing baseline errors elsewhere in the codebase (unrelated parallel-stream work — per memory rule, baseline noise is not Wave 1's concern).

---

## 6. Forensic Code Reading

Tester read all 4 modified files end-to-end with hunting eye, beyond just CI gate checks.

### 6.1 `app-mobile/src/store/appStore.ts` — Zustand persist debounce wrapper (lines 14-80)

| Hunt | Finding |
|------|---------|
| What does this code actually do? | Coalesces rapid `setItem` calls into a single trailing `multiSet` every 250ms; provides a synchronous-ish flush via AppState background listener |
| What happens when this fails? | `flushPendingWrites` catch block surfaces `console.error` (Constitution #3) and re-queues failed entries (only if no newer pending value exists for same key) |
| What data could be null? | `pendingWrites.get(key)` returns `undefined` if key absent — handled via `?? null` at line 55 |
| Is this the only place data is modified? | YES. `pendingWrites` Map is module-scoped private. Only `setItem`/`removeItem`/`flushPendingWrites` touch it. Single owner. ✅ Constitution #2 |
| What happens if this runs twice? | `flushPendingWrites` clears timer first (line 35), then drains entries via snapshot+clear before await — prevents double-flush race. ✅ |
| What happens with stale data? | `getItem` reads pending in-flight value before falling through to AsyncStorage — prevents read-write race during hydration. ✅ |
| What happens on cold start? | Hydration calls `getItem`. `pendingWrites` is empty before any setItem fires. Reads pass through to AsyncStorage. ✅ Constitution #14 (persisted-state startup) preserved |
| Idempotency | `setItem(k, v)` overwrites existing pending entry for same key. Map.set is idempotent. ✅ |
| Hidden race | Re-queue logic at line 47: `if (!pendingWrites.has(k)) pendingWrites.set(k, v)` — newer write wins. ✅ |

**Verdict on Zustand wrapper:** clean implementation. One P3 nit (§9 below).

### 6.2 `app-mobile/src/i18n/index.ts` — lazy-load init (tail block)

| Hunt | Finding |
|------|---------|
| Sequence of language-load calls on cold start | `initialLang` resolves device default; if non-en, lazy-loads via `ensureLanguageLoaded` then changeLanguage; separately, persisted preference loads from AsyncStorage and may override |
| Race risk between initialLang and persisted | Both fire-and-forget; persisted's `getPersistedLanguage()` is async and likely lands AFTER initialLang resolves. Last writer wins. **Brief flash possible** if user's persisted ≠ device default — UI may show device-lang briefly before flipping to persisted. Acceptable for Wave 1; documented trade-off. |
| Failure path on lazy-load | `ensureLanguageLoaded` catches errors, logs via `console.error` (Constitution #3), falls back to `en` (configured fallbackLng). UI keeps rendering. ✅ |
| Exhaustiveness of 28 lazy loaders | Verified via grep: `localeLoaders` map keys = es, bin, ha, ig, yo, fr, nl, de, pt, ar, bn, zh, hi, id, ja, ko, ms, el, he, it, pl, ro, ru, sv, th, tr, uk, vi (28). Locale dirs minus `en` = 28. **Match.** ✅ |
| `useSuspense: false` preserved | Line ~tail: `react: { useSuspense: false }` ✅ — would block first paint if true |
| `compatibilityJSON: 'v4'` preserved (S-3) | Line ~tail confirms `'v4'` over spec's mistaken `'v3'`. ✅ |

**Verdict on i18n refactor:** clean. Brief flash trade-off accepted per spec.

### 6.3 `app-mobile/src/components/SwipeableCards.tsx` — PanResponder body (1218-1360)

| Hunt | Finding |
|------|---------|
| Closure invariant preserved | Comment at top (lines 1218-1223) preserved verbatim. PanResponder created via `useRef`, never recreated. All external values via refs. ✅ |
| All 5 spring/timing call sites converted | 5 sites: swipe-up snap-back, no-card snap-back, paywall snap-back, success timing (with start callback), default snap-back. All wrapped in `Animated.parallel([positionX, positionY])` with both `useNativeDriver: true`. **No mixing.** ✅ |
| `Animated.parallel.start(callback)` semantics | Per RN docs: callback fires when ALL child animations complete. With identical 250ms duration on both axes, equivalent to single ValueXY callback. ✅ |
| Haptics preserved | Lines confirm `cardLike`, `cardDislike`, `medium` at original decision branches. ✅ SC-3 |
| Curated paywall gate preserved | Logic at line ~1297 confirms: direction === 'right' AND cardType === 'curated' AND !canAccessRef.current('curated_cards') → setPaywallFeature + setShowPaywall + spring back. ✅ SC-5 |
| `removedCards.add()` chain | Inside `start(() => { ... })` callback at line ~1320: `setRemovedCards`, `setCurrentCardIndex(0)`, `handleSwipeRef.current?.(direction, cardToRemove)?.catch(...)`. Order preserved. ✅ SC-4 |
| `requestAnimationFrame` flicker-prevention chain | Double-nested rAF preserved at line ~1339; per-axis `setValue(0)` inside inner rAF. ✅ |
| `_value` access at lines 1336-1337 carryover | `(positionX as any)._value` / `(positionY as any)._value` for tap detection. Same brittleness as before (D-1 carryover). Out of Wave 1 scope. |

**Verdict on SwipeableCards mutation:** clean. All 5 call sites converted symmetrically. Zero scope creep. Pre-existing flicker-prevention preserved.

### 6.4 `app-mobile/src/components/DiscoverScreen.tsx` — skeleton (lines 583, 590)

| Hunt | Finding |
|------|---------|
| Animation property eligibility | The `pulse` Animated.Value is interpolated to `opacity` (range 0.04-0.08) at line 601. Opacity is GPU-eligible for native driver. ✅ |
| Other properties in same animated style | `RNAnimated.View` at line ~605 has style `{ backgroundColor: 'rgba(255,255,255,0.04)', opacity, borderRadius: d.card.radius }` — backgroundColor and borderRadius are STATIC LITERALS, not animated. Only `opacity` is interpolated. ✅ Native driver valid. |
| Both timing calls flipped | Lines 583 + 590 both `useNativeDriver: true`. ✅ |

**Verdict on DiscoverScreen:** trivial change, correctly applied.

---

## 7. Constitution Compliance Scan (14 rules)

| # | Principle | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | No dead taps | ✅ PASS | No interactive elements added/removed; SwipeableCards swipe gestures + tap detection preserved |
| 2 | One owner per truth | ✅ PASS | `pendingWrites` Map module-scoped, only Zustand wrapper touches it; SwipeableCards still sole owner of swipe state |
| 3 | No silent failures | ✅ PASS | `flushPendingWrites` console.errors on multiSet failure (line 44); `ensureLanguageLoaded` console.errors on dynamic-import failure |
| 4 | One key per entity | ✅ N/A | No React Query keys touched |
| 5 | Server state stays server-side | ✅ N/A | No server data moved into Zustand |
| 6 | Logout clears everything | ✅ PASS | `clearUserData()` unchanged; `removeItem` is sync (not debounced) so logout deletions land immediately |
| 7 | Label temporary fixes | ✅ PASS | Zero `[TRANSITIONAL]` markers; all 4 surfaces have `ORCH-0675 Wave 1` comments referencing invariants — these are PERMANENT fixes |
| 8 | Subtract before adding | ✅ PASS | i18n: 644 static imports REMOVED before lazy loaders added. SwipeableCards: ValueXY REMOVED before per-axis added. Zustand: raw adapter REPLACED. |
| 9 | No fabricated data | ✅ N/A | No display data touched |
| 10 | Currency-aware UI | ✅ N/A | No currency code touched |
| 11 | One auth instance | ✅ N/A | No auth code touched |
| 12 | Validate at right time | ✅ N/A | No date-validation code touched |
| 13 | Exclusion consistency | ✅ N/A | No exclusion logic touched |
| 14 | Persisted-state startup | ✅ PASS | `debouncedAsyncStorage.getItem` reads through to AsyncStorage when no pending value (always at hydration time); `_hasHydrated` gate at line tail of appStore unchanged |

**Zero violations. Zero P0.**

---

## 8. Surprise Verification

Each implementor-documented surprise (S-1 through S-4) independently verified to NOT conceal a regression.

### S-1 — Spec line numbers drifted ~2 lines
- Spec said spring/timing at 1249/1270/1286/1296/1327; actual at 1247/1268/1284/1292/1325
- **Risk verification:** CI gate is region-scoped (1216-1380), NOT line-pinned. Tester independently injected at line 1259 (T-15) and gate fired correctly. ✅ No impact.

### S-2 — TS2440 collision RN AppState vs local AppState interface
- Fixed via `import { AppState as RNAppState, ... }` alias.
- **Risk verification:** read appStore.ts line 4 (`import { AppState as RNAppState, type AppStateStatus } from "react-native"`) and line 76 (`RNAppState.addEventListener("change", ...)`). CI gate accepts both `(AppState|RNAppState)` patterns via regex. Tsc clean. ✅ No regression.

### S-3 — Spec `compatibilityJSON: 'v3'` vs live `'v4'`
- Implementor preserved live `'v4'` setting per spec discipline.
- **Risk verification:** read i18n init block, confirmed `compatibilityJSON: 'v4'` in current code. v4 is the current i18next pluralization format. Reverting to v3 would risk pluralization bugs across non-English locales. ✅ Correct preservation.

### S-4 — Negative-control cycle 1 needed sed→awk retargeting
- Initial sed matched line 278 (outside gate region); awk retargeting hit line 1259 (inside region).
- **Risk verification:** tester independently re-ran cycle 1 in §4 above using awk targeting — gate fired correctly with named invariant. The "behavior" is the gate is region-scoped on purpose. ✅ Documented for future testers; not a defect.

---

## 9. Tester-Discovered Findings

### P3-1 — Module-scoped `pendingWrites` Map shared across hypothetical second Zustand store

[appStore.ts:30](app-mobile/src/store/appStore.ts#L30): `const pendingWrites = new Map<string, string>();` is module-level.

**Risk:** Mingla currently has ONE Zustand store. If a future change adds a second persisted Zustand store (or any other consumer wraps in `debouncedAsyncStorage`), the two stores would share the same pending queue. Failed writes from one could re-queue against newer writes from the other, causing key collisions.

**Severity:** P3 (LOW). Not a defect today (single store). Defense-in-depth nit.

**Recommended fix:** future hardening — wrap `pendingWrites` + `flushTimer` + `flushPendingWrites` + AppState listener in a factory function so each Zustand store gets its own private state. Out of Wave 1 scope.

---

## 10. P4 Praise

| Praise | Evidence |
|--------|----------|
| **Correctness over speed.** | Implementor caught TS2440 collision mid-build (S-2) via `tsc --noEmit` and fixed cleanly with alias rather than escalating. |
| **Honesty over coverage.** | Implementor flagged S-1 (line drift), S-3 (compat version mismatch), S-4 (negative-control retargeting) honestly in report rather than papering over. |
| **Spec discipline.** | S-3 — implementor preserved live `compatibilityJSON: 'v4'` over spec's mistaken `'v3'` — exactly the right call (don't silently change unrelated config). |
| **Symmetric application.** | All 5 SwipeableCards spring/timing call sites converted with identical `Animated.parallel([positionX, positionY])` pattern + identical `useNativeDriver: true` on both axes. No mixing (which would runtime-throw). No partial conversions. |

---

## 11. Spec Traceability — 12 Success Criteria

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| **SC-1** | Swipe gesture animation runs on UI thread | ✅ STATIC PASS | 0 `useNativeDriver: false` in PanResponder body 1216-1380 (verified §2). All 5 spring/timing calls wrapped in `Animated.parallel` with both axes `useNativeDriver: true`. CI gate PASS. |
| **SC-2** | PanResponder updates 1:1 with finger movement | ✅ STATIC PASS | Per-axis `setValue(gestureState.dx/dy)` at lines 1239-1240 preserves 1:1 mapping. Existing PanResponder thresholds untouched. |
| **SC-3** | Swipe-right `cardLike`, swipe-left `cardDislike`, swipe-up `medium` | ✅ STATIC PASS | All HapticFeedback calls preserved at original decision branches. Forensic read confirmed §6.3. |
| **SC-4** | `removedCards` Set updates after `.start()` callback | ✅ STATIC PASS | `Animated.parallel(...).start(() => { setRemovedCards(prev => new Set([...prev, cardToRemove.id])); ... })` chain preserved verbatim. |
| **SC-5** | Curated card swipe-right paywall gate fires | ✅ STATIC PASS | Gate at line ~1297 preserved verbatim. `setPaywallFeature` + `setShowPaywall` + per-axis spring-back to center. |
| **SC-6** | Only active language's 23 namespaces statically imported | ✅ STATIC PASS | CI gate confirms 23 static en imports + 28 lazy loaders. Total static locale imports = 23 (zero non-en). |
| **SC-7** | i18n bundle size ≥80% reduction | ⚠️ UNVERIFIED — needs `expo export` byte measurement | Static: 644 of 667 import statements removed (96.5% line reduction). Tester cannot run `expo export` from this environment to measure actual bundle byte-size diff. |
| **SC-8** | Language switch <500ms | ⚠️ UNVERIFIED — needs device + stopwatch | Pattern is correct: `ensureLanguageLoaded(lang).then(() => i18n.changeLanguage(lang))`. Actual timing depends on Metro chunk size + device CPU. Real-device measurement required. |
| **SC-9** | DiscoverScreen LoadingGridSkeleton runs on UI thread | ✅ STATIC PASS | Both `useNativeDriver: false → true` flipped at lines 583 + 590. Only opacity animated (GPU-eligible). CI gate PASS. |
| **SC-10** | Zustand persist write rate ≥80% reduction | ⚠️ UNVERIFIED — needs instrumented runtime | Pattern is correct: 250ms trailing debounce coalesces N rapid writes into 1 multiSet. Real-device counter instrumentation required. |
| **SC-11** | Pending writes flush on AppState background | ⚠️ UNVERIFIED — needs device + cold-start verification | Pattern is correct: `RNAppState.addEventListener('change', state => state === 'background' \|\| state === 'inactive' && flushPendingWrites())` wired at line 76. Real-device verification (swipe → background → kill → cold-start → verify swipe history) required. |
| **SC-12** | 3 invariants registered with CI gates + negative-control reproductions | ✅ PASS | INVARIANT_REGISTRY.md +112 lines (804→916). 3 CI gates active. 3 negative-control cycles re-verified by tester independently in §4. |

**Verified: 8 of 12 SCs static-PASS. 4 of 12 SCs UNVERIFIED — strictly require device + instrumentation that this Claude Code session does not have.**

---

## 12. Test Matrix Results

### Tests tester CAN execute (independently verified)

| Test | Verdict | Evidence |
|------|---------|----------|
| **T-15** Inject useNativeDriver:false at SwipeableCards line 1259 | ✅ PASS | Independent injection at line 1259 + revert; gate fires + recovers (§4) |
| **T-16** Inject non-en static import in i18n | ✅ PASS | Independent injection at line 24 + revert; gate fires + recovers (§4) |
| **T-17** Replace debouncedAsyncStorage with raw AsyncStorage | ✅ PASS | Independent injection at line 307 + revert; gate fires + recovers (§4) |

### Tests requiring real Android device — **UNVERIFIED, NEEDS FOUNDER LIVE-FIRE**

| Test | Verdict | Reason |
|------|---------|--------|
| T-01 Swipe right on Discover card | UNVERIFIED | No real Android device |
| T-02 Swipe left on Discover card | UNVERIFIED | No real Android device |
| T-03 Swipe up to expand | UNVERIFIED | No real Android device |
| T-04 Drag <120px and release | UNVERIFIED | No real Android device |
| T-05 Curated card paywall gate | UNVERIFIED | No real Android device + non-Mingla+ test account |
| T-06 Vertical-then-horizontal gesture | UNVERIFIED | No real Android device |
| T-07-EN Cold-start English | UNVERIFIED | No real Android device |
| T-08-NEN Cold-start non-English | UNVERIFIED | No real Android device |
| T-09-SWITCH Language switch flow | UNVERIFIED | No real Android device + stopwatch |
| T-10-OFFLINE Language switch with airplane mode | UNVERIFIED | No real Android device |
| T-11-FPS Skeleton fps + gesture responsiveness | UNVERIFIED | No fps profiler + no device |
| T-12-WRITES Zustand write rate measurement | UNVERIFIED | No instrumentation harness |
| T-13-BG App backgrounded mid-debounce | UNVERIFIED | No real Android device |
| T-14-KILL App force-killed mid-debounce | UNVERIFIED | No real Android device |
| T-18 Solo + collab parity | UNVERIFIED | No real Android device |
| T-19 iOS regression smoke | UNVERIFIED | No iOS device |
| T-20 Real low-tier Android subjective | UNVERIFIED | No Samsung A-series / Snapdragon 6xx-class device |
| T-21-OPT Onboarding regression smoke | UNVERIFIED | No real Android device |

**14 device-dependent tests UNVERIFIED.** Founder/QA MUST execute these on real hardware before commit.

---

## 13. Cross-Domain Impact Analysis

| Domain | Wave 1 touches? | Verification |
|--------|-----------------|--------------|
| `app-mobile/src/components/SwipeableCards.tsx` | YES | Verified §6.3 |
| `app-mobile/src/components/DiscoverScreen.tsx` | YES | Verified §6.4 |
| `app-mobile/src/i18n/index.ts` | YES | Verified §6.2 |
| `app-mobile/src/store/appStore.ts` | YES | Verified §6.1 |
| `app-mobile/scripts/ci/*.sh` | NEW (3 files) | All 3 PASS, all 3 negative-control PASS |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | YES (+112 lines) | 3 entries appended at end (lines 810/847/881) |
| `supabase/migrations/` | NO | Verified via grep — zero Wave 1 changes |
| `supabase/functions/` | NO | Verified via grep — zero Wave 1 changes |
| `mingla-admin/` | NO | Verified via grep — zero Wave 1 changes |
| Edge functions / RPCs / RLS | NO | Verified — Wave 1 is mobile-only OTA-eligible |
| Other React Query hooks | NO | Verified — no query keys touched |
| Other Zustand stores | NO | Single Zustand store in Mingla; no other stores affected |

**Cross-domain impact: ZERO.** Wave 1 is mobile-only OTA. Parallel chat's ORCH-0671 + ORCH-0678 work (admin + supabase + edge fn) does NOT overlap with Wave 1.

---

## 14. Regression Surface Inspection

Per implementor's IMPLEMENTATION_REPORT §9, 5 adjacent surfaces flagged for tester regression check:

| Surface | Tester verification |
|---------|---------------------|
| Discover swipe deck — gesture math, haptics, paywall, removedCards | ⚠️ UNVERIFIED static-only — pattern correct in code; needs device live-fire |
| Discover loading state — skeleton pulse + gesture responsiveness during loading | ⚠️ UNVERIFIED — needs device |
| Cold-start UX — first-paint time + i18n bundle resolution | ⚠️ UNVERIFIED — needs device |
| Heavy swipe sessions on Android — write rate + SQLite contention + flush | ⚠️ UNVERIFIED — needs device + instrumentation |
| Language switch flow — Settings → change language → all visible UI re-renders | ⚠️ UNVERIFIED — needs device + stopwatch |

---

## 15. Recommendations for Orchestrator

1. **CONDITIONAL PASS verdict.** Static + CI gate dimensions are clean; 4 SCs and 14 tests are honestly UNVERIFIED due to environment constraints (no device).
2. **Founder live-fire is the gate.** Before commit + OTA, founder/QA must execute T-01 through T-14, T-18 through T-21 on real hardware:
   - Samsung A-series (or equivalent Snapdragon 6xx-class Android) for swipe smoothness, cold-start timing, write-rate observation, background-flush survival
   - iPhone (any model) for iOS regression smoke
   - Stopwatch for SC-8 language-switch timing
   - Optional: instrument the `multiSet` call in `flushPendingWrites` with `global.__waveTracker++` for SC-10 measurement
3. **Optional `expo export` for SC-7.** Founder runs `cd app-mobile && npx expo export --platform ios --output-dir /tmp/wave1-bundle` and compares i18n chunk size to a pre-Wave-1 snapshot.
4. **Tester P3-1 finding** (module-scoped pendingWrites Map) — flag for future hardening but DO NOT BLOCK Wave 1. Defense-in-depth nit.
5. **D-1 carryover** (`(value as any)._value` brittleness at SwipeableCards.tsx:1336-1337) remains as documented separate ORCH — out of Wave 1 scope.
6. **D-3 (SC-7 byte measurement)** is a tester gap, not a defect.

**If founder accepts the 14 device-tests-pending posture as a pre-commit gate, this report converts to PASS Grade A.** Otherwise hold as `CONDITIONAL PASS / LIVE-FIRE PENDING` until device tests complete.

---

## 16. Discoveries for Orchestrator

| ID | Description | Severity |
|----|-------------|----------|
| **D-T-1** | Module-scoped `pendingWrites` Map in appStore.ts will be shared if a future second Zustand store ever wraps `debouncedAsyncStorage`. Defense-in-depth nit; not a defect today. Future hardening = factory pattern. | P3 |
| **D-T-2** | (carryover from implementor) `(positionX as any)._value` / `(positionY as any)._value` reads at SwipeableCards.tsx:1336-1337 are brittle across RN versions — separate ORCH. | P3 |
| **D-T-3** | (carryover from implementor) DiscoverScreen.tsx pulse opacity has no `inputRange` clamping — defensive nit. | P3 |
| **D-T-4** | (carryover from implementor) SC-7 bundle byte-size requires `expo export` measurement — tester recommended in §15. | n/a |
| **D-T-5** | (carryover from cycle-1 SPEC D-WAVE1-3) Wave 1 debounce SUPERSEDES Wave 2 Option C — orchestrator should remove Option C from Wave 2 SPEC at REVIEW time. | n/a |

---

## 17. Evidence Index

| Evidence | Source |
|----------|--------|
| 9 pre-flight grep counts | §2 — all match expected |
| 3 CI gate runs on current code | §3 — all exit 0 |
| 3 negative-control cycles (independent) | §4 — all gates fire on inject + recover on revert |
| Tsc check on Wave 1 files | §5 — zero matches in grep filter (clean) |
| Forensic reads of 4 source files | §6 — all clean, 1 P3 nit found |
| Constitution scan (14 rules) | §7 — zero violations |
| Surprise verification (S-1 through S-4) | §8 — all surprises verified non-regressive |
| Spec traceability matrix | §11 — 8/12 SCs static-PASS, 4/12 UNVERIFIED |

---

**End of Report.**
