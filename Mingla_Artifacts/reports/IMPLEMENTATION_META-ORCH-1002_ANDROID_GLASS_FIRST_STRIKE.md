# IMPLEMENTATION — META-ORCH-1002 [Android glass hardening] Sub-1 (Fast First Strike)

**Date:** 2026-05-29
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[android-glass-hardening]/` on branch `META-ORCH-1002-android-glass-hardening`. Metro port 8087.
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md`
**External APIs touched:** NONE (pure React Native style/Platform.select). COMMS-0003 docs-citation N/A. No backend/migration/edge/dependency change.
**Status:** implemented, partially verified (source/Platform.select gates verified GREEN + fails-on-revert; on-device pixel verification is the tester's live-fire job per SPEC §8.3).

---

## 1. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`OPEN` row targets `mingla-implementor`, this ORCH-ID, or `ALL` requiring action. COMMS-0002/0003/0004 (`ALL`, WARN) are N/A: no backend/`supabase/functions` touch (COMMS-0002 strict-grep), no external API (COMMS-0003), no INTAKE (COMMS-0004). No new ledger entry written (no cross-ORCH discovery).

---

## 2. Layman summary

On Android, the six highest-visibility "glass" surfaces now render as solid frosted panels instead of see-through film. The notification card's cream fill reaches the rounded corners (no taupe ring), the chat-input bar and bottom nav read solid over busy chat, the business trip tab-bars no longer draw a hard rectangular shadow, and the event/trip list cards have an opaque fill that reaches the corner. iOS is byte-identical — every change is behind `Platform.select` or the shared Android gate.

---

## 3. Old → New receipts (every file changed)

### consumer `app-mobile/src/constants/designSystem.ts`
**Before:** no `Platform` import; no shared Android-glass gate; `cardUnreadBg` was a flat `'rgba(255, 247, 237, 0.6)'`.
**Now:** imports `Platform` from `react-native` (line 4); exports `ANDROID_GLASS_USES_OPAQUE_FALLBACK = Platform.OS === 'android'` (line 12); `cardUnreadBg` is `Platform.select({ ios:'rgba(255,247,237,0.6)', android:'#FFFAF4', default:'rgba(255,247,237,0.6)' })` (line 332).
**Why:** SPEC §3.3 (S2 root gate) + §4 S1 (opaque unread cream). **Lines:** ~+15.

### consumer `app-mobile/src/components/NotificationsSheet.tsx`
**Before:** `notificationCard` (now ~960) and `skeletonCard` (now ~1192) had `borderRadius:20` + border + fill, NO `overflow:'hidden'`.
**Now:** `overflow:'hidden'` added to `notificationCard` (line 966) and `skeletonCard` (line 1199).
**Why:** SPEC §4 S1 — clip fill+border to the radius so the fill reaches the rounded corner (kills the inset taupe ring). **Lines:** ~+6.

### consumer 8 chrome files (S2/S4) — `GlassTopBar.tsx` (82), `GlassBottomNav.tsx` (67), `DiscoverScreen.tsx` (97), `LikesPage.tsx` (34), `ConnectionsPage.tsx` (375), `ui/GlassCard.tsx` (43), `ui/GlassBadge.tsx` (55), `ui/GlassIconButton.tsx` (56)
**Before:** each had its own inline `const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;` — opaque fallback fired only on Android ≤ 11.
**Now:** each imports `ANDROID_GLASS_USES_OPAQUE_FALLBACK` from `…/constants/designSystem` and sets `const isAndroidPreBlur = ANDROID_GLASS_USES_OPAQUE_FALLBACK;` (kept the local alias per SPEC §3.3 🎨 OPEN). All downstream reads (`useGlass`, `useBackdropGlass`, `useOrangeFallback`) unchanged → 1:1 substitution. No file retains a live `Platform.Version < 31` glass gate.
**Why:** SPEC §3.3 + §4 S2 — single shared gate authority; routes all Android (incl. 12+) to the existing ≥0.92 `fallbackSolid` tokens. GlassBottomNav (S4) is fixed automatically by this substitution. **Lines:** ~+2/file.

### consumer `app-mobile/src/components/MessageInterface.tsx` (S3)
**Before:** chat-input capsule (~1911) rendered `<BlurView … experimentalBlurMethod=dimezisBlurView>` + a `rgba(12,14,18,0.48)` tint floor View **unconditionally** (no platform guard).
**Now:** imports `ANDROID_GLASS_USES_OPAQUE_FALLBACK`; the capsule renders `ANDROID_GLASS_USES_OPAQUE_FALLBACK ? <opaque View bg=glass.chrome.fallback.solid> : <><BlurView/><tint floor/></>` (line 1914). On Android = solid `rgba(22,24,28,0.94)`; on iOS the exact pre-change BlurView + tint floor.
**Why:** SPEC §4 S3 — worst offender; route Android to opaque, keep iOS identical. **Lines:** ~+12.

### business `trip/EditPublishedTripIntakeAccordion.tsx` (S5) + `trip/TripCreatorStep6Intake.tsx` (S5)
**Before:** `tabActive` had raw `elevation: 8` (bypassed `androidSafeElevation`) under a rounded translucent pill → hard rectangular Android shadow.
**Now:** `Platform` added to the `react-native` import; `elevation: Platform.select({ ios:8, android:0, default:8 })` (EditPublished line 530, TripCreatorStep6 line 304). iOS glow shadow + elevation:8 unchanged; Android elevation = 0.
**Why:** SPEC §4 S5 — mirror `androidSafeElevation()`; kill the photographed rectangle. **Lines:** ~+4/file.

### business `event/EventListCard.tsx` (S6) + `trip/TripListCard.tsx` (S6)
**Before:** `host` had `backgroundColor: glass.tint.profileBase` (`rgba(255,255,255,0.04)`) + border + `overflow:'visible'`.
**Now:** `Platform` added to the `react-native` import; `host` `backgroundColor: Platform.select({ ios:glass.tint.profileBase, android:'rgba(20,22,26,0.92)', default:glass.tint.profileBase })` (EventListCard line 283, TripListCard line 255) + `overflow:'hidden'` (EventListCard line 289, TripListCard line 261).
**Why:** SPEC §4 S6 — opaque kit-consistent fill + clip to radius. Verified all `host` children (draftOverlay full-bleed `0,0,0,0`; rightRail/revenueStrip positioned inside bounds with positive spacing) are inside `host`, so clip-on-host is safe (no intentional overflow). **Lines:** ~+8/file.

### `app-mobile/package.json` + `mingla-business/package.json`
Added `"test:meta-orch-1002"` scripts pointing at the two new tests. No dependency change.

### NEW tests
- `app-mobile/scripts/ci/meta-orch-1002-android-glass-check.mjs` — consumer node source-reader (T-01, T-02, T-03, T-04, T-07 consumer; 26 assertions).
- `mingla-business/src/components/__tests__/metaOrch1002AndroidGlass.test.ts` — business ts-jest source-reader (T-05 ×2, T-06 ×2, T-07 business; 12 tests).

---

## 4. Spec traceability (success criteria)

| SC | Criterion | Implemented | Verification |
|---|---|---|---|
| SC-1 (S1 Android) | unread card opaque `#FFFAF4` to corners; clipped | `cardUnreadBg` android `#FFFAF4` + `overflow:'hidden'` | T-03 GREEN; on-device = tester |
| SC-1-iOS | card pixel-identical | `Platform.select` ios kept `rgba(255,247,237,0.6)` | T-07 GREEN |
| SC-2/SC-2a–f (S2/S4) | chrome solid frosted on Android 12+ | shared gate flips 8 files to existing `fallbackSolid` | T-01/T-02 GREEN; on-device = tester |
| SC-2-iOS | 8 chrome render BlurView on iOS; Android ≤ 11 unchanged | gate is `false` on iOS; `true` on all Android (≤11 unchanged) | T-02 (gate value) GREEN |
| SC-2-grep | no live `Platform.Version < 31` glass gate | all 8 read shared boolean | T-02 (revert-canary) GREEN |
| SC-3 (S3) | chat capsule solid `rgba(22,24,28,0.94)` on Android | gated opaque-fallback branch | T-04 GREEN; on-device = tester |
| SC-3-iOS | capsule BlurView + tint floor on iOS | iOS branch byte-identical | T-04/T-07 GREEN |
| SC-5a/SC-5b (S5) | both trip tab-bars no Android shadow; iOS glow kept | `elevation` android 0 ×2 | T-05 GREEN; on-device = tester |
| SC-6a/SC-6b (S6) | both list cards solid frosted to corners on Android; iOS unchanged | opaque android fill + clip ×2 | T-06 GREEN; on-device = tester |
| SC-7 (global) | zero out-of-scope touch | diff = only §2.1 files + 2 tests + 2 package.json | `git status` GREEN |

---

## 5. Regression test (mandatory gate)

**Consumer test:** `app-mobile/scripts/ci/meta-orch-1002-android-glass-check.mjs` (`npm run -w app-mobile test:meta-orch-1002` / `node ./scripts/ci/meta-orch-1002-android-glass-check.mjs`).
Passing run: `Summary: 26/26 PASS`.

**Business test:** `mingla-business/src/components/__tests__/metaOrch1002AndroidGlass.test.ts` (`npx jest metaOrch1002AndroidGlass.test --runInBand`).
Passing run: `Test Suites: 1 passed; Tests: 12 passed, 12 total`.

**fails-on-revert verified at commit `bf0accc253a949d9fb6bb58496511926d68c8c4b`:**
- Consumer: reverting the `ANDROID_GLASS_USES_OPAQUE_FALLBACK` export + `cardUnreadBg` Platform.select + the two `overflow:'hidden'` lines → `Summary: 22/26 PASS (4 FAIL)`, exit 1 (T-01 gate, T-03 skeleton clip, T-03 cardUnreadBg, T-07 iOS-cream all FAILED).
- Business: reverting the `EventListCard` host `overflow:'hidden'` + Platform.select fill → `Tests: 3 failed, 9 passed`, suite FAILED (overflow, opaque-android-fill, iOS-default-profileBase).
- After restore both return GREEN (26/26 and 12/12). Backups removed.

The tester writes a second adversarial test (SPEC §8.2) — not in this implementor scope.

---

## 6. Typecheck + lint (touched packages)

**tsc (`tsc --noEmit`):**
- Consumer: 249 baseline errors WITH and WITHOUT my changes (verified via `git stash`) → **0 new errors**; none in any touched file. All baseline errors are pre-existing repo strictness debt + worktree node_modules resolution.
- Business: 234 baseline errors WITH and WITHOUT my changes (verified via `git stash`) → **0 new errors**; none in any touched file (234 are `packages/phone-input/*` worktree resolution + pre-existing app strictness debt).

**lint (`expo lint` / `eslint`):**
- Consumer touched files: `0 errors` (28 pre-existing warnings, none on my added lines — all imports I added are used).
- Business touched files: the `EventListCard` `react-hooks/rules-of-hooks` errors + `TripListCard` `accent` unused warning are **pre-existing baseline** (confirmed present with my changes stashed). My edits (StyleSheet `host` block + `Platform` import, which is used) add zero new lint findings. New test file: clean.

---

## 7. Cross-surface impact (Phase 2.5)

Per SPEC §5: affected = Consumer Android (target, S1–S4), Business Android (target, S5–S6). No-op = Consumer iOS, Business iOS (every change behind `Platform.select`/gate). Untouched = Buyer/anon Web + Business Web preview (web glass path = `GlassBlur.tsx`, deferred Sub-C), Admin Web (renders none of these). S5/S6 each edited BOTH files (no skip-one). Parity automatic on iOS (shared code, iOS branch unchanged).

---

## 8. Invariants

- **I-7 (visible degradation, no null):** every changed branch renders a visible opaque View. PRESERVED.
- **I-MOR-0827-PACKAGE-ISOLATION:** `packages/event-rendering/designTokens.ts` NOT edited; no `packages/` touch. PRESERVED.
- **iOS-render-frozen:** every change gated; iOS branch byte-identical. PRESERVED (T-07).
- **I-ANDROID-GLASS-OPAQUE-FALLBACK (DRAFT):** 8 chrome + chat capsule route to opaque on Android. Asserted by T-01/T-02/T-04.
- **I-ANDROID-ROUNDED-FILL-CLIPPED (DRAFT, scoped S1/S6):** rounded surfaces carry `overflow:'hidden'`. Asserted by T-03/T-06.

---

## 9. Discoveries for orchestrator

- **Token triplication (noted, NOT edited):** consumer `designSystem.ts` and business `designSystem.ts` were edited independently (already-separate sources). The third token file `packages/event-rendering/designTokens.ts` stays untouched (no scoped file imports it for these surfaces). When the later sweep fixes `GlassBlur.tsx` / public pages (Sub-C), the third token file participates. Per SPEC §9 hard guard + §2.2.
- **Pre-existing lint/tsc debt in the worktree** (249 consumer + 234 business baseline tsc errors; `EventListCard` conditional-hooks lint error) is unrelated to this strike — flagged for awareness, not fixed (scope discipline).
- The remaining ~310-instance sweep (Sub-B…Sub-F in investigation §6) is explicitly deferred.

---

## 10. Spec deviations

None. Shipped the exact 🔒 LOCKED hex values and mechanisms; took the SPEC-recommended 🎨 OPEN choices (`#FFFAF4` unread, `rgba(20,22,26,0.92)` business fill, kept iOS `elevation:8`, inline `Platform.select` for S5 over exported helper, kept the `isAndroidPreBlur` local alias).
