# IMPLEMENTATION — META-ORCH-1002 [Android glass hardening] Sub-C (shared package + public pages)

**Date:** 2026-05-29
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-c-shared-glassblur-public]/` on branch `META-ORCH-1002-sub-c-shared-glassblur-public`.
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-C_SHARED_GLASS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md` §4.3, §5
**External APIs touched:** NONE (pure `Platform.OS` branch). COMMS-0003 docs-citation N/A. No backend/migration/edge/dependency change.
**Status:** implemented, partially verified (source/Platform-branch gates GREEN + fails-on-revert + 0-new-tsc; on-device pixel verification of the public pages is the tester's live-fire job).

---

## 1. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`OPEN` row targets `mingla-implementor`, this ORCH, or `ALL` requiring action. COMMS-0002 (strict-grep backend) N/A — no `supabase/functions` touch. COMMS-0003 (external-API docs) N/A — no external API. COMMS-0004 (intake) N/A — not an INTAKE. No new ledger entry written (no cross-ORCH discovery: the public-page panels needed no per-instance patch, so no collision with Sub-B/Sub-D worktrees).

---

## 2. Layman summary

On Android, the public event page and public brand page now render their "glass" panels as solid frosted surfaces instead of a thin see-through film. This was a single fix to the one shared blur primitive (`GlassBlur`) that powers all ten panels (1 event + 9 brand) across both Mingla apps — the highest-leverage track. iOS and web rendering are byte-identical.

---

## 3. Old → New receipts

### `packages/event-rendering/GlassBlur.tsx`
**What it did before:** branched only on `Platform.OS === 'web'` (mobile-web blur-skip). On every native platform — including Android — it returned the raw `<BlurView {...props} />`. With no `experimentalBlurMethod`, Android rendered expo-blur's thin semi-transparent fallback film (Symptom B) on the public-page panels.
**What it does now:** adds an `else`-of-web Android branch above the iOS return. On Android it destructures the blur-only props (`intensity`, `tint`, `experimentalBlurMethod`, `blurReductionFactor`) out, then renders a plain `<View>` carrying the original `style` + `children` plus an opaque `backgroundColor` chosen by `androidOpaqueFillForTint(tint)`:
- dark / default / `system*Dark` / unrecognized tint → `rgba(20, 22, 26, 0.92)` (the kit-consistent, on-device-validated business `GlassChrome` dark fallback)
- `*Light` tint → `rgba(248, 249, 251, 0.94)`
iOS still returns `<BlurView {...props} />`; the mobile-web blur-skip branch is unchanged.
**Why:** SPEC §3 (Symptom-B recipe) — route Android to an opaque ≥ 0.92 fallback, no reliance on expo-blur for opacity. **Lines:** ~+35 (imports unchanged; added two fill consts + `androidOpaqueFillForTint` helper + the Android branch).

### `packages/event-rendering/PublicEventPage.tsx` (C2) — VERIFIED, NOT CHANGED
The single GlassBlur (~552) passes only `tint`/`intensity`/`pointerEvents`/`style={bodyGlassLayer}` (`absoluteFillObject`), no own backgroundColor; its parent `bodyContent` carries `borderRadius` + `overflow:'hidden'`. The C1 fix makes it solid frosted on Android with the opaque fill clipped to the corners. No per-instance edit needed.

### `packages/brand-rendering/PublicBrandPage.tsx` (C3) — VERIFIED, NOT CHANGED
All 9 GlassBlur usages (549,629,901,980,1078,1235,1320,1392,1418) pass only `tint`/`intensity`/`style={glassLayer}` (`absoluteFillObject`), no own backgroundColor; each is the FIRST child of a parent panel (`identityCentered`, `tabsRow`, `nextTeaser`, `eventCard`, `aboutBlock`) that carries `borderRadius` + `overflow:'hidden'`. The C1 fix routes all 9 to solid frosted on Android, clipped, behind content. No per-instance edit needed.

### `packages/event-rendering/EventCoverMedia.tsx` + `EventCover.tsx` (C4) — VERIFIED, NOT CHANGED
Both retain `overflow:'hidden'` (lines 579 / 125). Symptom-A already mitigated (investigation §3.4). Untouched.

### NEW test
`packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-check.mjs` — node source-reader (T-01…T-05, 9 assertions), mirroring `app-mobile/scripts/ci/meta-orch-1002-android-glass-check.mjs`.

---

## 4. Spec traceability

| SC | Criterion | Implemented | Verification |
|---|---|---|---|
| SC-C1 (Android) | opaque ≥ 0.92 View fill, tint-keyed, not BlurView | Android branch + `androidOpaqueFillForTint` | T-01/T-02 GREEN |
| SC-C1-iOS | iOS keeps real `<BlurView {...props} />` | branch guarded above iOS return | T-03 GREEN |
| SC-C1-web | mobile-web blur-skip + desktop BlurView byte-identical | web branch untouched | T-03 GREEN |
| SC-C2/C3 (Android) | all 10 panels solid frosted, no ring | C1 fix + parents clip (verified read) | source verify; on-device = tester |
| SC-C4 | cover cards keep `overflow:'hidden'` | unchanged | T-04 GREEN |
| SC-C5 (isolation) | no app imports; only `packages/*` touched | local consts, no token-file edit | T-05 GREEN + `git status` |

---

## 5. Regression test (mandatory gate)

**Test:** `packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-check.mjs`
Run: `node ./packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-check.mjs`
**Passing run:** `Summary: 9/9 PASS`.

**fails-on-revert verified at commit `53e28e7128b03f123b3af383894a37979414e288`:**
reverting `GlassBlur.tsx` to `HEAD:` (removing the Android branch + fill consts) → `Summary: 5/9 PASS (4 FAIL)`, exit 1 (T-01 android-branch, T-01 tint-keyed helper, T-02 dark fill, T-02 light fill all FAILED). After restore → `9/9 PASS`, exit 0. The 4 FAILs prove the test exercises the actual fix.

The tester writes a second adversarial test (SPEC §7) — not in this implementor scope.

---

## 6. Typecheck + lint

**tsc (`mingla-business` tsconfig, the real consumer of the package):**
- WITH fix: 234 total `error TS`; GlassBlur.tsx shows 2 errors — `(1,19) Cannot find module 'react'` + the cascaded `(67,3) props implicitly any`.
- WITHOUT fix (GlassBlur reverted to HEAD): 234 total; GlassBlur.tsx shows the same 2 errors (`(1,19)` + `(40,3) props any`).
- **→ 0 new TS errors.** Both GlassBlur errors are pre-existing worktree node_modules resolution noise (`react` types unresolved → `React.ComponentProps` collapses `props` to `any`), identical with and without the change. Matches the documented business baseline (234) in the first-strike report. My destructure of the blur props introduces zero new errors.

**lint:** the `packages/*` tree has no dedicated ESLint config (lint-covered only when consumed); the business eslint reports the file as "ignored because outside of base path" — the pre-existing posture for shared packages. The change uses standard idioms (object-rest destructure + array style), no unused imports (the previously-considered `StyleSheet` import was removed), so no new findings are possible at the consumer level.

---

## 7. Cross-surface impact (Phase 2.5)

Per SPEC §4: TARGET = Business Android (all 10 public-page panels). No-op = Business iOS, Buyer/anon Web, Business Web preview (web + iOS GlassBlur branches byte-identical). N/A = Consumer iOS/Android (app-mobile does not render these public pages), Admin Web. Single shared code path → parity automatic; no manual cross-path drift.

---

## 8. Invariants

- **I-MOR-0827-PACKAGE-ISOLATION:** PRESERVED. GlassBlur imports only `react`/`react-native`/`expo-blur`; opaque fills are local consts — `packages/event-rendering/designTokens.ts` was NOT edited. (T-05.)
- **iOS-render-frozen:** PRESERVED. Android branch guarded above the iOS return; iOS path byte-identical. (T-03.)
- **I-7 (visible degradation, no null):** PRESERVED. Android branch renders a visible opaque View.
- **I-ANDROID-GLASS-OPAQUE-FALLBACK (DRAFT):** extended to the shared `GlassBlur` primitive — Android renders opaque ≥ 0.92, never BlurView. (T-01/T-02.)

---

## 9. Package-isolation note (requested)

The `packages/event-rendering/designTokens.ts` duplicate was **NOT edited.** The two Android opaque fills are defined as local module consts inside `GlassBlur.tsx` (`ANDROID_OPAQUE_DARK_FILL`, `ANDROID_OPAQUE_LIGHT_FILL`), because (a) the dark value `rgba(20,22,26,0.92)` is the same on-device-validated business `GlassChrome` fallback used by Sub-1's S6 — a kit constant, not a new token; (b) keeping them local to the one file that uses them avoids expanding the duplicated token surface; (c) it keeps the diff minimal and isolated. If a future token-consolidation track (Sub-F / `@mingla/design-tokens`) stands up, these two fills should migrate into the shared glass-fallback token alongside the consumer/business equivalents.

---

## 10. Discoveries for orchestrator

- **No public-page per-instance patch was required.** All 10 GlassBlur consumers are decorative `absoluteFill` first-child layers with no own translucent surface; their parent panels already clip (`overflow:'hidden'` + radius). The C1 primitive fix is fully sufficient — confirmed by reading every call site + parent style. No cross-ORCH collision with Sub-B/Sub-D (those touch app source; this touches only `packages/*`).
- **Token triplication persists** (consumer / business / package `designSystem`+`designTokens`). Sub-C did not consolidate (out of scope); the two opaque fills are local to GlassBlur. Deferred to Sub-F.
- **Pre-existing worktree tsc noise** (234 business baseline errors, GlassBlur `Cannot find module 'react'`) is unrelated worktree node_modules resolution — flagged, not fixed (scope discipline).

---

## 11. Spec deviations

None. Shipped the exact 🔒 LOCKED mechanism (Android opaque View branch, iOS BlurView frozen, web preserved); took the SPEC-recommended 🎨 OPEN values (`rgba(20,22,26,0.92)` dark, `rgba(248,249,251,0.94)` light).
