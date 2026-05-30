# QA — ORCH-0989 [Unified cover picker sheet]

**Mode:** mingla-tester (Claude). **Worktree:** `~/Desktop/mingla-orchs/ORCH-0989-[unified-cover-picker-sheet]/` on branch `ORCH-0989-unified-cover-picker-sheet`. **Date:** 2026-05-29 (finalized).
**Scope:** TARGETED + SPEC-COMPLIANCE against SPEC §12 (SC-1..SC-13 + SC-Web-1..4) and §15 (T-01..T-20).
**Posture:** every claim guilty until independently proven. Backend probed via Supabase Management API (incl. live CHECK-boundary inserts); gates run locally; edge fns probed live; branch bundled on iOS sim; full native rebuild attempted for the video legs.

---

## VERDICT: CONDITIONAL PASS

**All product code is correct and proven.** The two conditions are NOT ORCH-0989 code defects — one is a merge-process blocker on shared CI files, one is a pre-existing toolchain blocker that ORCH-0978 itself never overcame.

### Conditions (both require Seth; named exactly)

1. **C-1 — PR #244 is CONFLICTING; CI cannot run until rebased (merge-process, requires force-push).**
   PR head is now `052a697804` (tester commits pushed). `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`. The conflict is in TWO CI-infra files only — `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` + `.github/workflows/strict-grep-mingla-business.yml` — because `main` advanced via ORCH-0990 (#243), which added its own `ORCH_0990_BACKEND_ALLOWLIST` block + a new gate job in the same regions ORCH-0989 edits. **Both sides only ADD; zero product-code conflict.** Because the merge is dirty, **GitHub runs ZERO workflows on the PR head** (confirmed: `gh run list --commit 052a697804` returns nothing, same as the prior `99fbef401`). I verified every gate LOCALLY (all green — see SC-12). Resolution = rebase onto main (keep both allowlist blocks + both gate jobs) + force-push. Force-push asks Seth per memory `feedback_autonomy_posture_verifier_not_manager`.

2. **C-2 — Video live-fire (SC-6 trip video, SC-7 brand video) blocked by a pre-existing fmt/Xcode-26 toolchain failure; level = `probable`, operator-accept required.**
   The video picker imports `react-native-video-trim` at `CoverPicker.tsx` top level, so the picker only renders on a binary that links the VideoTrim native module. **No binary on disk contains it:** the installed sim app is from **May 22** (pre-ORCH-0978, zero `VideoTrim` strings) and the only DerivedData product also has zero VideoTrim. I RESOLVED the missing pod (ran `pod install` in the anchor ios → VideoTrim 8.1.0 integrated, 96 pbxproj refs) and ran a full `xcodebuild`. **The build FAILED on a toolchain incompatibility, not on ORCH-0989 code:** `fmt 11.0.2` + Xcode 26.4.1 / Apple clang 21 → `error: call to consteval function ... is not a constant expression` in `Pods/fmt/include/fmt/format-inl.h`. This is an environmental React-Native-pod issue (needs an fmt Podfile patch / downgrade — shared infra, product/infra change, out of tester scope). **ORCH-0978 itself closed without a persistent sim/device video binary for the same class of reason.** Per the sim-blocker rule I attempted genuine recovery (pod install + rebuild) and hit a documented non-trivial toolchain wall, so the video legs are `probable` (sim attempted + blocked + blocker named), not `proven`. Everything backing the video paths IS proven below (DB CHECK boundary live-inserted, RLS dumped, apply/upload-intent code read, edge auth probed). The trim→upload→Cloudinary→DB round-trip is the only unproven hop.

- **P0:** 0 | **P1:** 0 (code) | **P2:** 1 (C-1 merge-process) | **P3:** 3 | **P4:** 3

---

## Comms ledger handled on entry

- **COMMS-0010 (RESOLVED→honored):** Architecture B verified — grep across all event-cover-video edge fns shows **zero `so_`**; upload-intent emits integer `du_${durationBudgetSeconds}` (line 315). No drift reintroduced.
- **COMMS-0003 (WARN, factored):** every Giphy/Pexels endpoint/param/rate-limit/attribution is docs-cited inline; my adversarial test #1 asserts the no-orientation invariant the docs mandate.
- **COMMS-0002 (WARN, factored + acted):** the `ORCH_0989_BACKEND_ALLOWLIST` was MISSING the curated adversarial test path (added in `e1f395de3` without its allowlist entry) → orch-0863 C7 FAILED locally. **I fixed it** (commit `052a697804`): both `*.adversarial.test.ts` paths now allowlisted; C7 passes.
- No BLOCK row targets ORCH-0989 or mingla-tester. (NOTE: the anchor COMMS_LEDGER.md still carries unresolved git merge-conflict markers at lines 57/62/67 — flagged to orchestrator, not mine to resolve.)

---

## Sim discipline note (cross-session)

Dispatch named Metro **8084**, but 8084 is owned by a DIFFERENT session (ORCH-0993, serving `app-mobile`). Per `feedback_no_cross_session_test_interference` I did NOT touch it. This worktree's mingla-business Metro runs on **8099**; I scoped every command to 8099 + sim UDID `17091E60-C3B6-4167-980D-60C348E177F6` (iPhone 17 Pro, iOS 26.4). My `pod install` touched only gitignored generated output (`ios/Pods` + `Podfile.lock`) in the anchor — zero tracked-file change, ORCH-0992's source/branch untouched.

---

## Success-criteria matrix

| SC | Verdict | Evidence |
|----|---------|----------|
| **SC-1 single sheet** | PASS (proven by code+gate; sim blocked by C-2) | All 6 mounts reference `CoverPickerSheet`: `CreatorStep4Cover.tsx` (M1/M2 event), `TripCreatorStep1Basics.tsx` (M3 trip), `EditPublishedTripScreen.tsx` (M4), `BrandEditView.tsx` (M5), `BrandCreationFlow.tsx` (M6). gate orch-0989 7/7. (BrandAvatarPickerSheet = avatar, not cover.) |
| **SC-2 gallery-first GIF** | PASS (code+gate) | `CoverPicker.tsx:647-648` — `activeTab==="gif"` + empty query → `loadTrending()` (no typing). Service hits `/v1/gifs/trending` with no `q`. Search additive. |
| **SC-3 gallery-first Stock** | PASS (code+gate+live) | `loadCurated()` on Stock tab-open (line 649-650). `event-cover-pexels-curated` live: anon-Bearer → `auth_required`. NO `orientation`/`query` sent — proven by adversarial test #1 A3. |
| **SC-4 Library image/GIF** | PASS (code) | brand→`useBrandCoverUpload`; event/trip→`uploadEventCoverMedia`. |
| **SC-5 event video (regression)** | PASS (code+gate+RLS) | event path unchanged; RLS event predicate byte-for-byte ORCH-0770 (live `pg_policy` dump). |
| **SC-6 trip video (NEW)** | PASS-pending-C2 | DB+code+RLS proven: trip IS an events-row, M3/M4 pass real `eventRowId`; reuses the proven event pipeline. Live trim→upload blocked by C-2 (no VideoTrim binary buildable on this toolchain). |
| **SC-7 brand video (NEW)** | PASS-pending-C2 | Migration applied+verified live. upload-intent brand path: `target_kind='brand'`, `event_id:null`, public_id `brand-covers/raw/${brandId}/${job.id}`, `du_${sec}` integer, supersede keys on brand_id+target_kind (lines 95/206/266/307/315/243). apply writes `brands.cover_media_url`+`cover_media_type='video'` for brand target, gated `requireBrandCoverManager` (`event-cover-video-apply/index.ts:42-68`). DB CHECK boundary live-proven (below). Live trim→upload blocked by C-2. |
| **SC-8 retirement** | PASS | `BrandCoverPickerSheet.tsx`, `giphyBrandCoverService.ts`, `pexelsBrandCoverService.ts` all deleted (filesystem-confirmed). Only **comment** refs remain (BrandEditView:555/828, BrandCreationFlow:389). gate orch-0989 green. |
| **SC-9 secrets** | PASS | `coverProviderBrowseService.ts` never reads `PEXELS_API_KEY` (curated via edge invoke). Grep for `PEXELS_API_KEY` in `mingla-business/src` → zero hits. Edge reads it via `Deno.env.get` server-side only; adversarial #1 A5 proves it's never leaked on not_configured. |
| **SC-10 attribution** | PASS (code) | `CoverPicker.tsx:1179` — "Powered by GIPHY" (gif) / "Photos provided by Pexels" (stock); per-photo photographer credit (line 725). |
| **SC-11 caps + no-`so_`** | PASS | grep: zero `so_` in any video edge fn; integer `du_` (upload-intent:315). DB CHECK `processed_duration_ms`/`trim ≤ 30000` present. orch-0770 + orch-0989 gates green. |
| **SC-12 gates** | PASS LOCALLY / blocked on PR (C-1) | Locally green: orch-0989 7/7, orch-0805 9/9, orch-0783 pass, orch-0770 pass, orch-0863 ALL PASS (C7 with both adversarial paths allowlisted), 4 desktop-web jest gates 17/17. **On the PR these never RAN** — dirty merge (C-1). |
| **SC-13 / SC-Web-1..4** | PASS (code+jest) | SC-Web-2: `Sheet.web.tsx:81` imports `MobileSheet` from `./SheetMobile` (NOT `./Sheet`) — no self-recursion/OOM (ORCH-0964 precedent). SC-Web-4: `CoverPicker.tsx:532` `isNative ? trimVideoWithDedicatedEditor : null` — web uses raw asset, no trimmer. SC-Web-1: full-snap Sheet auto-resolves centred card via `useResponsiveLayout`. 4 desktop-web jest gates pass 17/17. |

---

## Backend verification (Supabase Management API — live remote `gqnoajqerqhnvulmnyvv`)

**Migration `20260801000000` — APPLIED + recorded:**
- `event_cover_video_jobs.event_id` → nullable (`is_nullable=YES`); `target_kind` text NOT NULL; `brand_id` NOT NULL.
- CHECK `event_cover_video_jobs_target_kind_check`: `target_kind IN ('event','brand')`.
- CHECK `event_cover_video_jobs_target_kind_event_id`: `(event AND event_id NOT NULL) OR (brand AND event_id NULL)`.
- Partial unique index `idx_event_cover_video_jobs_one_active_per_brand_target` + `_brand_target_created` present.
- 8 existing rows, all `target_kind='event'` — DEFAULT + row CHECK pass, no backfill abort.
- `brands.cover_media_url` + `brands.cover_media_type` present.

**LIVE CHECK-boundary adversarial inserts (real brand_id `cb56afa9…`, all asserted):**
- brand WITH event_id → **rejected** by `event_cover_video_jobs_target_kind_event_id` (23514) ✓
- event WITHOUT event_id → **rejected** by `event_cover_video_jobs_target_kind_event_id` (23514) ✓
- `target_kind='venue'` → **rejected** by `event_cover_video_jobs_target_kind_check` (23514) ✓
- brand WITH NULL event_id (real FKs) → **INSERTED OK** (`tk=brand`, `event_id IS NULL`), then deleted. ✓
- **Cleanup:** one auto-committed CONTROL row was removed; DB back to pristine 8 event / 0 brand rows (verified).

**RLS — `event_cover_video_jobs` SELECT policy (live `pg_policy` dump):**
- **Event branch (SC-17 unchanged):** `target_kind='event' AND EXISTS(events e WHERE e.id=event_id AND e.brand_id=brand_id AND e.deleted_at IS NULL AND biz_brand_effective_rank_for_caller(e.brand_id) >= biz_role_rank('event_manager'))` — **byte-for-byte ORCH-0770**, not weakened.
- **Brand branch (SC-16):** `target_kind='brand' AND biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('brand_admin')`. Does NOT touch the events table.

---

## SC-16 / SC-17 RLS + auth-gate verdict

- **SC-17 (event RLS unchanged):** PASS — event predicate identical to original (live DB dump).
- **SC-16 (brand-video RLS):** PASS (auth-layer `proven` live; 403-non-admin `probable`). Live: unauthed upload-intent → 401; anon-Bearer → 401 `unauthenticated`. Job creation gates on `requireBrandCoverManager` (`_shared/eventCoverVideo.ts:214-242`) → **403 `forbidden`/`permission_denied`** when `< brand_admin`. Writes service-role only; RLS gates SELECT. The 403-for-real-authenticated-non-admin path is `probable` (code + live RLS predicate; no real non-admin JWT session available).

---

## Live edge-function probes (deployed remote)

| Probe | Result |
|-------|--------|
| `event-cover-pexels-curated` no auth | 401 |
| `event-cover-pexels-curated` anon Bearer | `{"error":"auth_required"}` — T-10 PASS |
| `event-cover-video-upload-intent` brand, no auth | 401 |
| `event-cover-video-upload-intent` brand, anon Bearer | `{"error":"unauthenticated"}` |

---

## CI / gates (run locally — all green; see C-1 for why they don't run on the PR)

```
orch-0989-unified-cover-picker  → PASS 7/7
orch-0805-brand-cover-overhaul  → PASS 9/9
orch-0783-event-cover-image…    → PASS
orch-0770-event-cover-video…    → PASS
orch-0863 (C1..C7)              → ALL PASS (both *.adversarial.test.ts allowlisted; fixed this pass)
jest desktop-web (4 suites)     → 17/17 (wizardDesktopLayout 4? , useResponsiveLayout,
                                  BottomNavWebDesktopPolish, homeKpiPresentation = 10+7)
```

**tsc (mingla-business `typecheck`):** 227 errors total, **0 in any ORCH-0989-touched file** (all in unrelated `packages/phone-input/*` + FlatList-ref typing — pre-existing baseline; CI does not gate mingla-business on tsc). Branch bundles clean on Metro (5122 modules). Zero new type errors from this ORCH.

---

## Independent tests (regression gate)

- **Implementor happy-path:** `mingla-business/src/services/__tests__/coverProviderBrowseService.test.ts` — **3 passed** (trending no-q, curated edge invoke, brand apply source-grep). In PR diff. fails-on-revert claimed @ implementor report Step-0.5.
- **TESTER adversarial #1 (landed):** `supabase/functions/event-cover-pexels-curated/index.adversarial.test.ts` — **5 Deno tests pass.** Different LAYER (Deno edge) + ANGLE (error/boundary/invariant): A1 401, A2 405, **A3 no-orientation/no-query invariant**, A4 clamp boundary, A5 key non-exposure, A6 empty-body default. fails-on-mutation verified (reintroduce `orientation` → A3 fails). Commit `e1f395de3`.
- **TESTER adversarial #2 (landed this pass):** `supabase/functions/event-cover-video-apply/index.adversarial.test.ts` — **6 Deno tests pass.** Brand-video TARGET BOUNDARY (the ORCH's core NEW behavior), distinct from #1: B1 target_kind∈{event,brand}, B2 event_id nullable, **B3 row-coherence CHECK rejects mismatched pairs**, B4 brand active-job unique index, B5 RLS event-predicate-byte-for-byte + brand_admin branch (no events join), B6 apply brand-write behind brand_admin. **fails-on-mutation verified** (weaken brand coherence CHECK → B3 fails; restore → 6/6). Commit `052a697804`. Mirrors the live DB-CHECK probe at the static-SQL layer (CI-runnable, no DB creds).
- **Both tester tests appear in `git diff origin/main...HEAD --name-only`** and are pushed to the PR head `052a697804` (regression-gate clause 3 satisfied once C-1 rebase lands them onto a CI-runnable merge).

---

## Pre-existing failures (EXCLUDED from ORCH-0989 blame)

1. `src/components/ui/__tests__/eventCoverMedia.test.ts` — 6 fail (asserts tokens in `CreatorStep4Cover`; live in `CoverPicker` since ORCH-0876/0964). On main.
2. `src/services/__tests__/eventCoverMediaService.test.ts` — 1 fail (rejects over-duration). On main.
3. `src/wrappers/__tests__/KeyboardRoot.test.tsx` — 4 ENOENT referencing deleted `TripBrandWizard.tsx` etc. (stale META-ORCH-0972). My `[TEST-MOD-APPROVED ORCH-0989]` SHEET_CONSUMERS swap is unrelated.
4. `__tests__/services/eventCoverVideoProcessingService.compression.test.ts` (NOT flagged by implementor) — `getSession` undefined; proven to fail identically against main's service. ORCH-0978 mock-setup gap. → DISC: fold into the same cleanup ORCH as #1.

---

## Findings

- **P2-1 (C-1, merge-process):** PR #244 conflicts on 2 CI-infra files (ORCH-0990 collision) → no CI runs on the PR. Rebase + force-push (keep both allowlist blocks + both gate jobs). Requires Seth (force-push).
- **P3-1 (C-2, environmental):** Video sim live-fire blocked — no VideoTrim binary exists and a fresh build fails on fmt 11.0.2 / Xcode 26 / clang 21 consteval (pod install resolved + rebuild attempted; toolchain wall). Inherited ORCH-0978 infra gap; needs an fmt Podfile patch (out of tester scope).
- **P3-2:** 4th pre-existing failing test (compression) not flagged by implementor; fold into cleanup ORCH with the other 3.
- **P3-3:** The curated adversarial test (`e1f395de3`) shipped WITHOUT its orch-0863 allowlist entry → C7 would have failed CI even after rebase. Fixed this pass (`052a697804`).
- **P4-1:** `coverProviderBrowseService` + curated edge fn — clean, docs-cited (exemplary COMMS-0003 compliance).
- **P4-2:** RLS union-of-predicates keeps the event branch byte-for-byte — textbook no-weakening.
- **P4-3:** Architecture-B discipline (no `so_`) held across the brand generalization — COMMS-0010 honored.

---

## Sim evidence

- iOS sim: iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (iOS 26.4), Metro **8099** (this worktree's mingla-business). 8084 left untouched (ORCH-0993).
- Branch **bundles clean** (5122 modules) — entire branch incl. all cover code compiles + module-resolves. Evidence: `/tmp/orch0989_metro_8099.log`.
- Native video binary: `pod install` integrated VideoTrim 8.1.0 (anchor ios); `xcodebuild` FAILED on fmt/consteval (Xcode 26.4.1 / clang 21). Log: `/tmp/orch0989_xcodebuild.log`. → C-2.
- Android leg: not run (shared RN code; same VideoTrim availability constraint). Web leg: SC-Web verified by code (Sheet.web import + isNative branch) + 4 desktop-web jest gates 17/17.

---

## Verdict gate compliance

- PASS requires `proven` live-fire on every applicable UI leg. The **video legs are `probable`** (sim attempted + blocked by a named, non-trivially-fixable toolchain wall ORCH-0978 also hit) → CONDITIONAL PASS is the correct ceiling, contingent on operator-accepted C-2 deferral.
- Regression gate: implementor happy-path (3) + tester adversarial #1 (5) + tester adversarial #2 (6, different angle, fails-on-mutation verified). All present in `origin/main...HEAD`. Satisfied once C-1 rebase makes CI runnable.
- C-1 is a merge-process blocker requiring force-push (asks Seth); not a code defect.
