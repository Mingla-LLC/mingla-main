# QA Report — ORCH-0743 (cold-start polish + ORCH-0742 fallout cleanup)

**Date:** 2026-05-06
**Tester:** mingla-tester
**Mode:** TARGETED + SPEC-COMPLIANCE
**Commit under test:** `e67e4e26feat(mingla-business): ORCH-0743 cold-start polish + ORCH-0742 fallout cleanup` (HEAD on `Seth`, pushed to `origin/Seth`)
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH_0743_CURRENT_BRAND_COLD_START_POLISH.md`](../specs/SPEC_ORCH_0743_CURRENT_BRAND_COLD_START_POLISH.md)
**Implementor report:** [`reports/IMPLEMENTATION_ORCH_0743_REPORT.md`](IMPLEMENTATION_ORCH_0743_REPORT.md)

---

## 1. Verdict — **PASS**

| Severity | Count |
|----------|-------|
| P0 — CRITICAL | **0** |
| P1 — HIGH | **0** |
| P2 — MEDIUM | **0** |
| P3 — LOW | **2** (both cosmetic-doc stale; non-blocking) |
| P4 — NOTE | **3** (positive notes + 1 stylistic observation) |

**Layman summary:** Genuinely clean implementation. All 8 sub-deliverables shipped per SPEC contracts. All 19 success criteria pass or pass-code-verified. All 14 constitutional rules pass. The require-cycle is structurally broken (verified by direct file read — `currentBrandStore.ts` no longer imports/re-exports `useCurrentBrand`; `types/brand.ts` is a true leaf with zero imports). The latent destruction risk (RC-2) is patched + locked by a 5-test jest suite. Note A was correctly escalated by the implementor pre-flight and resolved per Option (a) — `creatorAccount.ts` now throws on error, both AuthContext callsites wrap with `console.warn` matching the existing `getSession` pattern verbatim. CF-3 mass-delete preserved every live error-handling path I checked (rollback logic in useCreateBrand/useUpdateBrand, throw-propagation in useSoftDeleteBrand, SlugCollisionError handling in BrandSwitcherSheet, throw-on-error in brandsService softDeleteBrand step 2 + creatorAccount).

**Verdict drivers:** zero P0/P1/P2 findings. The 2 P3 findings are stale doc strings (cosmetic) — not blocking. Recommend: ship and fold the 2 P3 items into a future cleanup OR ignore.

---

## 2. SPEC Success Criteria — Verification Matrix

| ID | Criterion | Tester Result | Evidence |
|----|-----------|---------------|----------|
| SC-1 | Cold-start no flash on networks ≤500ms (≤2s on slow nets) | ✅ PASS code-verified | `_layout.tsx:80-116` dual-gate splash with 4-disjunction `brandReady` covers all states (null brandId, fetched, idle fetchStatus, 2s timeout). Live cold-start smoke deferred to operator (needs real device). |
| SC-2 | `event/create.tsx` cold-start + deep-link does NOT redirect to home | ✅ PASS | `event/create.tsx:43-53` uses `useCurrentBrandId()` — synchronous Zustand read; no fetch race possible. |
| SC-3 | event/create migrates to `useCurrentBrandId()`; home/events stay on `useCurrentBrand()` | ✅ PASS | grep confirms: `event/create.tsx:33` imports `useCurrentBrandId` only; `home.tsx:44-50` + `events.tsx:47-50` keep `useCurrentBrand` from new direct hook path. |
| SC-4 | TopBar + other full-Brand consumers stay on `useCurrentBrand()` | ✅ PASS | `TopBar.tsx:35` imports `useCurrentBrand` from `../../hooks/useCurrentBrand` (direct, post-RC-1). |
| SC-5 | `liveEventConverter.ts:46` says "cache" not "store" | ✅ PASS | grep confirms: `Cannot publish: brand ${draft.brandId} not found in cache.` |
| SC-6 | `tsc --noEmit` exit 0 | ✅ PASS | Independent re-run by tester: exit 0. |
| SC-7 | `expo export -p web` exit 0; full route table | ✅ PASS | Independent re-run: exit 0; **44 routes** (note: implementor report cited 52 — see P3-1). |
| SC-8 | All 4 strict-grep CI gates pass; no `setBrands(`; I-PROPOSED-C/J preserved | ✅ PASS | grep `setBrands(` mingla-business/ → 0 hits. I-PROPOSED-J persist contract preserved (currentBrand.v14 still ID-only). |
| SC-9 | No regression in 15 ORCH-0742 consumers | ✅ PASS code-verified | grep `(s) => s.currentBrand)` mingla-business/ → 0 hits (ORCH-0742 cleanup intact); 5 `getBrandFromCache(` callers verified at exact ORCH-0742 sites. |
| SC-10 | Zero `Require cycle: ...currentBrandStore...useCurrentBrand...` warnings | ✅ PASS structurally | `currentBrandStore.ts` references `useCurrentBrand` only in comments (lines 81, 172-173, 196-200) — zero `import` / `export {}`. `useCurrentBrand.ts:31-32` imports `useCurrentBrandStore` (value) from store + `Brand` type from `../types/brand` (leaf — verified zero imports). Cycle direction broken at the source. Live `expo start` Metro log capture deferred to operator (sandbox cannot run interactive Metro). |
| SC-11 | Brand type at `src/types/brand.ts`; ~25 consumer sites unchanged via re-export | ✅ PASS | New file at `src/types/brand.ts:1-286` (12 type exports); `currentBrandStore.ts:86-99` re-exports the 12 types; tsc=0 confirms ~25 consumer sites compile cleanly. |
| SC-12 | `reapOrphanStorageKeys.ts` whitelist contains v14 (not v12) | ✅ PASS | grep confirms `"mingla-business.currentBrand.v14"` at line 25; 0 hits on v12 across mingla-business. |
| SC-13 | Unit test passes — planted v14 blob NOT reported orphan | ✅ PASS | Independent jest run: 5/5 PASS including the RC-2 regression test (line 44-51). |
| SC-14 | `event/[id]/index.tsx:824-826` uses `Platform.select` shape | ✅ PASS | `index.tsx:830-836` uses spread `Platform.select` with web=textShadow shorthand and default=RN-native triple, exactly per SPEC §3.6. |
| SC-15 | `expo export -p web` produces zero `shadow*` deprecation warnings | ✅ PASS | Independent grep on captured stderr: 0 matches for "shadow* style props are deprecated" + 0 for "textshadow". |
| SC-16 | Zero `[ORCH-XXXX-DIAG]` markers in `mingla-business/src/` + `app/` | ✅ PASS | Independent grep: 0 hits across both directories. |
| SC-17 | Live error-handling preserved per §3.7 | ✅ PASS | Forensically verified each preservation site: `useCreateBrand` rollback (lines 188-196), `useUpdateBrand` rollback (lines 266-271), `useSoftDeleteBrand` mutationFn → softDeleteBrand throws on error (line 303), `creatorAccount.ts` throws per Note A (line 36-37), `BrandSwitcherSheet` SlugCollisionError handling (lines 135-141), `brandsService` rowcount-verification throws (line 235-241). |
| SC-18 | `BrandSwitcherSheet.tsx` no longer imports `Constants` | ✅ PASS | grep confirms: 0 hits on `Constants` import; 0 hits on `supabase` import in the file. |
| SC-19 | All 8 sub-deliverables in single coherent commit | ✅ PASS | Commit `e67e4e26` includes all 17 ORCH-0743 code/test/spec/report files cleanly; no partial states; pushed to origin/Seth. |

**19/19 SC PASS or PASS-code-verified.**

---

## 3. Constitutional 14-rule audit

| # | Principle | Result | Evidence |
|---|-----------|--------|----------|
| 1 | No dead taps | ✅ N/A | No UI changes. |
| 2 | One owner per truth | ✅ Preserved | No new state owners. |
| 3 | No silent failures | ✅ STRENGTHENED | Note A: `creatorAccount.ts:36` throws on error. AuthContext callsites surface via `console.warn` (lines 132, 162). `useSoftDeleteBrand.onError` is empty `() => {}` but the comment correctly notes "Caller's mutateAsync still receives the throw — pessimistic pattern" — this is React Query's documented pessimistic-rejection contract, not a silent failure. |
| 4 | One key per entity | ✅ Preserved | All React Query keys via `brandKeys` factory; no hardcoded strings in changed code. |
| 5 | Server state via React Query | ✅ Preserved | No persist shape changes. |
| 6 | Logout clears everything | ✅ Preserved | `clearAllStores` untouched; signOut path unchanged. |
| 7 | Label temporary | ✅ Preserved | No new TRANSITIONAL markers introduced; existing markers preserved. |
| 8 | Subtract before adding | ✅ STRENGTHENED | Net code delta: ~−460 LOC (DIAG markers + Brand types extracted + `useCurrentBrand` re-export dropped). |
| 9 | No fabricated data | ✅ N/A | No data display changes. |
| 10 | Currency-aware | ✅ N/A | No currency surfaces. |
| 11 | One auth instance | ✅ Preserved | AuthContext's existing single Supabase auth instance untouched in identity sense; only error-handling wrapped around `ensureCreatorAccount`. |
| 12 | Validate at right time | ✅ N/A | No validation surfaces touched. |
| 13 | Exclusion consistency | ✅ N/A | No filter logic. |
| 14 | Persisted-state startup | ✅ **ELEVATED PARTIAL → PASS** | C1 splash gate now structurally waits on the brand fetch (with 2s timeout fallback). Cold-start renders with the brand resolved or the timeout-released graceful-degradation path. |
| I-PROPOSED-J | Zustand persist no server snapshots | ✅ Preserved | No Zustand persist shape changes. |
| I-PROPOSED-C | Server state via React Query | ✅ Preserved | grep `setBrands(` mingla-business/ → 0 hits. |
| I-32 | BrandRole rank parity | ✅ Preserved | Orthogonal. |
| I-PROPOSED-H/I | RLS-RETURNING-OWNER-GAP / MUTATION-ROWCOUNT | ✅ Preserved | Orthogonal. `brandsService.softDeleteBrand` rowcount-verification preserved (lines 233-241). |

**14 PASS / 0 FAIL / 6 N/A. Const #3, #8 STRENGTHENED. Const #14 ELEVATED PARTIAL→PASS.**

---

## 4. Independent build + grep verification

| Check | Command | Result |
|------|---------|--------|
| TypeScript clean | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 ✅ |
| Web bundle clean | `EXPO_PUBLIC_SUPABASE_URL=stub EXPO_PUBLIC_SUPABASE_ANON_KEY=stub node node_modules/expo/bin/cli export -p web` | exit 0; **44 routes** ✅ |
| Web shadow deprecation | `grep -ci "shadow.* style props are deprecated" expo-export.log` | 0 matches ✅ |
| Web textShadow deprecation | `grep -ci "textshadow" expo-export.log` | 0 matches ✅ |
| Web `Property 'document'` | `grep -ci "Property 'document' doesn't exist" expo-export.log` | 0 matches ✅ |
| RC-2 unit test | `node node_modules/jest/bin/jest.js src/utils/__tests__/reapOrphanStorageKeys.test.ts` | **5/5 PASS** ✅ |
| Zero DIAG markers | `grep -rn "\[ORCH-[0-9]*-DIAG\]" mingla-business/src/ mingla-business/app/` | 0 hits ✅ |
| Zero v12 references | `grep -rn "currentBrand\.v12" mingla-business/` | 0 hits ✅ |
| v14 references in code | `grep -rn "currentBrand\.v14" mingla-business/src/` | 4 hits (store + whitelist + 2 test) ✅ |
| Zero `setBrands(` callers | `grep -rn "setBrands(" mingla-business/` | 0 hits ✅ |
| Cycle structural — store doesn't import useCurrentBrand | `grep -nE "^import.*useCurrentBrand\|^export \{.*useCurrentBrand" src/store/currentBrandStore.ts` | 0 hits (comments only) ✅ |
| `types/brand.ts` true leaf | `grep -nE "^import" src/types/brand.ts` | 0 imports ✅ |
| Cross-domain spillover | `grep -rln "useCurrentBrand\|currentBrandId\|src/types/brand" mingla-admin/ supabase/ app-mobile/` | 0 files ✅ |
| ORCH-0742 cascade preserved | `grep -rn "(s) => s\.currentBrand)" mingla-business/` | 0 hits ✅ |
| `getBrandFromCache(` callers | `grep -rn "getBrandFromCache(" mingla-business/` | 5 hits (RefundSheet + CancelOrderDialog + order detail + liveEventStore + liveEventConverter — exact ORCH-0742 cascade preserved) ✅ |

---

## 5. Forensic per-file verification (CF-3 live-behavior preservation)

The CF-3 mass-delete is the highest-risk part of the change because it removes 15 console.error blocks scattered across 4 files where each block is interleaved with live error-handling logic. Verified preservation site-by-site:

| File | Site | Preserved? | Evidence |
|---|---|---|---|
| `BrandSwitcherSheet.tsx` | AUTH-NOT-READY guard (line 117-119) | ✅ | `if (user === null \|\| user.id === undefined) { return; }` intact; only the 3-line console.error + comment + eslint-disable was removed |
| `BrandSwitcherSheet.tsx` | SlugCollisionError handling (line 135-141) | ✅ | `if (error instanceof SlugCollisionError) { setSlugError(...) }` intact; inline error fallback preserved |
| `BrandSwitcherSheet.tsx` | finally clause (line 147-149) | ✅ | `finally { setSubmitting(false); }` intact |
| `useBrands.ts` | useCreateBrand.onError rollback (line 185-197) | ✅ | `_error` rename clean (TS strict unused-vars satisfied); rollback to snapshot at lines 188-196 intact; clear-optimistic-only fallback at line 193-195 intact |
| `useBrands.ts` | useUpdateBrand.onError rollback (line 263-272) | ✅ | `_error` rename clean; detailSnap rollback at line 266-268 intact; listSnap rollback at line 269-271 intact |
| `useBrands.ts` | useSoftDeleteBrand.mutationFn (line 302-305) | ✅ | Clean delegation: `await softDeleteBrand(brandId); return result;` — throws propagate per pessimistic pattern |
| `useBrands.ts` | useSoftDeleteBrand.onSuccess (line 306-321) | ✅ | All 4 cache cleanup ops intact: invalidate list, remove detail, remove role, remove cascade-preview |
| `useBrands.ts` | useSoftDeleteBrand.onError (line 322-325) | ✅ | Empty `() => {}` body — but the comment correctly notes the pessimistic-pattern throw propagation. Const #3 PASS via mutateAsync rejection. (P4 stylistic note — see §6.) |
| `brandsService.ts` | softDeleteBrand step 2 (line 220-241) | ✅ | UPDATE chain with `.select("id")` rowcount verification preserved; `if (data === null \|\| data.length === 0) throw...` intact |
| `creatorAccount.ts` | ensureCreatorAccount (line 30-37) | ✅ | Note A: `if (error) { throw error; }` per SPEC default — matches expected callers wrap |
| `AuthContext.tsx` | Bootstrap callsite wrap (line 125-136) | ✅ | `try/catch` with `console.warn("[auth] ensureCreatorAccount failed: ...")` — matches existing `getSession` pattern at line 119 verbatim |
| `AuthContext.tsx` | onAuthStateChange callsite wrap (line 156-166) | ✅ | Identical try/catch + console.warn pattern |

**12/12 preservation sites verified clean. Zero behavior regressions in CF-3 mass-delete.**

---

## 6. Findings

### P3-1 — Stale `event/create.tsx` docstring at line 4 (cosmetic)

**Site:** `mingla-business/app/event/create.tsx:4`
**Code:** `* Reads currentBrand at mount. If null → bounces to /(tabs)/home.`
**Issue:** post-C2/C3 migration, the route now reads `currentBrandId`, not `currentBrand`. Docstring is stale by 1 word.
**Severity:** P3 (cosmetic; non-functional).
**Recommended fix:** change "currentBrand" → "currentBrandId" in line 4. 1-LOC.
**Triage:** fold into next minor cleanup OR ignore — non-blocking.

### P3-2 — Implementor report cites 52 routes; actual count is 44 (cosmetic)

**Site:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0743_REPORT.md` §1 Layman summary + §3 SC-7
**Issue:** report says "52 routes, 2008 modules" — actual `expo export -p web` output produces 44 routes (verified independently). Module count of 2008 is plausible. The 52-routes figure appears to be copy-pasted from prior ORCH-0742 verification context.
**Severity:** P3 (cosmetic; metric inaccuracy in report; functional bundle is identical regardless of count).
**Recommended fix:** none in code; orchestrator may correct in CLOSE artifacts if desired.
**Triage:** no action; documented here for evidence trail.

### P4-1 — `useSoftDeleteBrand.onError = () => {}` (stylistic)

**Site:** `mingla-business/src/hooks/useBrands.ts:322-325`
**Code:**
```ts
onError: () => {
  // Caller's mutateAsync still receives the throw — pessimistic pattern.
  // Caller (BrandDeleteSheet) renders the error in the modal via setSubmitError.
},
```
**Note:** technically reads as an empty handler `() => {}`. But the comment correctly identifies that React Query's pessimistic-mutation contract throws on `mutateAsync` rejection regardless of `onError` body — caller (`BrandDeleteSheet`) handles via `await mutateAsync()` catch. NOT a Const #3 violation.
**Severity:** P4 (stylistic only — passes Const #3, passes all SC).
**Note for future cleanup:** could be removed entirely (omitting `onError` is functionally identical) but keeping it with the explanatory comment is a clearer pattern for the next maintainer reading the file. Defer; documented for awareness.

### P4-2 — Implementor's escalation handling (positive)

The SPEC §3.7.4 explicitly anticipated that `ensureCreatorAccount` callers might not be wrapped in try/catch and instructed: "If caller doesn't catch → escalate to orchestrator before proceeding (don't ship a silent change in error semantics)."

The implementor:
1. Did the pre-flight verification BEFORE writing any code
2. Discovered the gap (callsites at AuthContext.tsx:126, :147 not wrapped)
3. Announced clearly with a recommended Option (a) wrap matching the existing `getSession` pattern
4. Awaited operator authorization before proceeding
5. Implemented exactly the wrap as recommended

**This is exactly how Note A was supposed to be resolved.** Worth noting as a positive pattern for future SPEC escalation discipline.

### P4-3 — Architectural cleanliness (positive)

The require-cycle break via `src/types/brand.ts` extraction is the **right** architectural fix (SPEC §3.4 Option (a)). The implementor:
- Created a true leaf module (zero imports — verified)
- Preserved backwards-compat for ~25 consumer sites via `currentBrandStore.ts` re-export
- Updated the 4 import sites that previously consumed `useCurrentBrand` via the dropped re-export
- Updated the stale `useCurrentBrandId` docblock comment that referenced the dropped re-export (D-0743-IMPL-3 fixed in same commit)

This is the exemplary outcome for a "fix the SPEC tried to prevent" cycle.

---

## 7. Cross-domain blast — clean

| Domain | grep result | Status |
|---|---|---|
| `mingla-admin/src/` for `useCurrentBrand` / `currentBrandId` / `src/types/brand` | 0 files | ✅ no spillover |
| `supabase/` for same | 0 files | ✅ no spillover |
| `app-mobile/src/` for same | 0 files | ✅ no spillover |

Phase 2 is correctly scoped to mingla-business only. No DB / RLS / edge-function impact. No admin dashboard impact. No app-mobile (consumer-side) impact.

---

## 8. Regression surface — operator manual smoke recommendations

For post-deploy verification (live-runtime checks deferred to operator with real device):

1. **Cold-start manual smoke** — fresh install, sign in, pick brand, force-quit, relaunch on iOS + Android. Observe TopBar, home, events for any flash longer than 100ms on local network. Splash should hold an extra ~100-500ms (typical) before releasing.
2. **Slow-network cold-start** — simulate 3G via Network Link Conditioner (iOS Settings → Developer) or Chrome DevTools (web). Splash should hold for ≤2s then release; flash falls back to ORCH-0742 baseline gracefully.
3. **AsyncStorage v14 reaper smoke** — on a real device cold-start, dev console should NOT report `mingla-business.currentBrand.v14` in the `[reapOrphanStorageKeys] Found N orphan AsyncStorage key(s)` log line. v13 leftover legitimately reported is expected.
4. **Cross-device delete + rename E2E** — Phone → Tablet propagation per ORCH-0742 SC-4/SC-5 (no regression).
5. **`event/create.tsx` deep-link** — cold-start + simulate push notification (or Expo dev URL) directly to `/event/create` with persisted brand. Verify draft is created without bouncing to home.
6. **Web hero text shadow** — open `/event/{id}` on `expo export -p web` build; verify hero title has visible drop shadow.
7. **Brand-create flow** — open BrandSwitcherSheet → create new brand → verify mutation succeeds, brand is set as current, sheet closes, no DIAG noise in console. Test SlugCollisionError path on duplicate slug — verify inline error still surfaces.
8. **Auth bootstrap with creator_accounts upsert failure** — sign in while creator_accounts table is unavailable (simulate by forcing 5xx via dev tools). Verify console.warn surfaces "[auth] ensureCreatorAccount failed: ..." but auth bootstrap completes; user can navigate the app. This is the Note A behavior.
9. **Live `expo start` Metro require-cycle log** — operator runs `cd mingla-business && npx expo start --clear` and greps Metro output for `Require cycle:` lines containing `currentBrandStore` AND `useCurrentBrand`. Expected: zero matches. (4 pre-existing AuthContext cycles MAY remain — those are CF-1 from ORCH-0744, out of ORCH-0743 scope.)

---

## 9. Discoveries for orchestrator

| ID | Type | Description |
|----|------|-------------|
| D-0743-QA-1 | 🔵 cosmetic | `event/create.tsx:4` docstring still references `currentBrand` (should be `currentBrandId`). 1-LOC fix; non-blocking. |
| D-0743-QA-2 | 🔵 cosmetic | Implementor report's route count (52) is inaccurate; actual is 44. Likely copy-paste from ORCH-0742 verification context. |
| D-0743-QA-3 | 🔵 stylistic | `useSoftDeleteBrand.onError` is `() => {}` with explanatory comment. Functionally correct (pessimistic-throw via mutateAsync) but reads as empty handler. Consider removing `onError` field entirely in a future cleanup OR keeping the comment for maintainer clarity. Document of awareness. |
| D-0743-QA-4 | 🔵 deferred | Live `expo start` Metro require-cycle log capture not feasible in tester sandbox (sandboxed Bash can't run interactive Metro). Structural verification (currentBrandStore doesn't import/re-export useCurrentBrand; types/brand.ts is a leaf) is sufficient per SPEC §1.6 + SC-10. Operator can run live capture on dev box if desired. |
| D-0743-QA-5 | 🟢 positive | Implementor handled SPEC §3.7.4 Note A escalation per protocol — pre-flight verification before any code, clear announcement with recommended fix, awaited operator approval, implemented exactly as approved. Exemplary discipline. Worth noting as a pattern for future SPEC escalation handling. |
| D-0743-QA-6 | 🟢 positive | RC-1 architectural fix via `src/types/brand.ts` extraction is the correct long-term answer (Option a per SPEC §3.4). Cleaner type ownership; backwards-compat preserved via store re-export; cycle structurally cannot recur. |

---

## 10. Recommended next actions (orchestrator-side)

1. **Accept PASS verdict.** Run the full CLOSE protocol — standard 4-step (NO DEPRECATION extension because no DROP COLUMN/TABLE/feature retirement work).
2. CLOSE Step 1 — update the 7 orchestrator-owned artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS).
3. CLOSE Step 2 — provide commit message (already in implementor report § 11).
4. CLOSE Step 3 — EAS Update commands for iOS + Android.
5. CLOSE Step 4 — announce next dispatch. Recommended next: **META-ORCH-0744-PROCESS** (the 5 missing CLOSE-protocol + CI gates from ORCH-0744 forensics meta-findings — highest leverage, prevents recurrence of the classes ORCH-0743 just fixed).
6. **Optional cleanups (non-blocking):** D-0743-QA-1 (event/create docstring) + D-0743-QA-3 (useSoftDeleteBrand.onError stylistic) can be folded into a future micro-PR or ignored.

---

**End of QA report.** Verdict: **PASS** (0 P0 / 0 P1 / 0 P2 / 2 P3 cosmetic / 3 P4). Hand back to orchestrator for CLOSE protocol.
