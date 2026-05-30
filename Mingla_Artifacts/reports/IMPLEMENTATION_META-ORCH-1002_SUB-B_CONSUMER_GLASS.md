# IMPLEMENTATION — META-ORCH-1002 Sub-B [Consumer app Android glass Symptom-A sweep]

**Date:** 2026-05-29
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-b-consumer-glass-sweep]/` on branch `META-ORCH-1002-sub-b-consumer-glass-sweep`.
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md`
**Inputs:** investigation `INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md` §3.2; first-strike SPEC §3; first-strike IMPLEMENTATION report.
**External APIs touched:** NONE (pure React Native style / `Platform.select`). COMMS-0003 docs-citation N/A. No backend/migration/edge/dependency change.
**Status:** implemented, partially verified (source/Platform.select gates GREEN + fails-on-revert; on-device pixel verification is the tester's live-fire job).

---

## 1. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`OPEN` row targets `mingla-implementor`, this ORCH-ID, or `ALL` requiring action. COMMS-0002 (backend strict-grep), COMMS-0003 (external API), COMMS-0004 (INTAKE) are N/A — this is consumer-app style-only, no backend, no external API, no INTAKE. COMMS-0011 is an unrelated ID double-booking. No new ledger entry written (no cross-ORCH discovery).

---

## 2. Layman summary

On Android, 14 more consumer "glass" surfaces now render with their fill reaching the rounded corners instead of showing a taupe/sand ring. Four light-canvas cards/panels (the pair-request + pairing-info modals, the multi-day calendar, the add-friend panel) become solid frosted; four opaque-white cards (paired-people, account-settings, billing x2) get clipped to the corner; six intentional dark-glass surfaces (onboarding CTA, start-swiping pill, calendar/saved empty-states, calendar accordion, chat-list rows) keep their translucent glass look but no longer ring or draw a hard Android shadow rectangle. iOS is byte-identical — every change is behind `Platform.select` or a corner-clip that doesn't affect iOS shadows.

#### How to smoke-test on the app

1. Launch the Android emulator/device build, sign in.
2. Open Connections — the chat-list rows + the "Start swiping" header pill should have crisp rounded corners with no ring; the Add-friend panel should be a solid frosted white card.
3. Trigger a pair-request modal (or pairing-info) — the white card fill reaches all four corners, no taupe ring, no hard shadow box.
4. Open Profile → Account Settings + Billing — each card clips cleanly to its rounded corner.
5. Open the Activity/Calendar + Saved tabs with an empty state — the orange empty-state chips + the accordion header clip cleanly, glass look preserved, no Android shadow rectangle.
6. On iOS, all of the above look exactly as before (translucent frost + shadows unchanged).

---

## 3. Old → New receipts (every file changed)

### A bucket — light-canvas (opaque-ify + clip + Android elevation 0)

#### `app-mobile/src/components/IncomingPairRequestCard.tsx` (A1)
**Before:** `card` = `rgba(255,255,255,0.95)` fill + `rgba(255,255,255,0.5)` border + `...shadows.lg` (elevation:8), NO `overflow:'hidden'`; no `Platform` import.
**Now:** imports `Platform`; `card` fill `Platform.select({ ios:'rgba(255,255,255,0.95)', android:'#FFFFFF', default:… })` + `overflow:'hidden'` + `elevation: Platform.select({ ios:shadows.lg.elevation, android:0, default:… })`.
**Why:** SPEC §2.A A1 — kill the inset ring (clip), opaque corner on Android, no hard Android shadow rectangle. iOS byte-identical. **Lines:** ~+10.

#### `app-mobile/src/components/PairingInfoCard.tsx` (A2)
**Before/Now:** identical block to A1 (same `card` style). Same treatment. **Why:** SPEC §2.A A2. **Lines:** ~+10.

#### `app-mobile/src/components/ui/MultiDayCalendar.tsx` (A3)
**Before:** `container` = `rgba(255,255,255,0.60)` frosted-white + border + `shadowColor`-shadow + `elevation:6`, no clip; no `Platform` import.
**Now:** imports `Platform`; fill `Platform.select({ ios:'rgba(255,255,255,0.60)', android:'#FFFFFF', default:… })` + `overflow:'hidden'` + `elevation: Platform.select({ ios:6, android:0, default:6 })`.
**Why:** SPEC §2.A A3 — frosted-white intent rendered solid on Android. iOS keeps frost + shadow. **Lines:** ~+10.

#### `app-mobile/src/components/connections/AddFriendView.tsx` (A4)
**Before:** `glassCard` = `rgba(255,255,255,0.70)` frosted-white + border + `shadowColor`-shadow + `elevation:6`, no clip; no `Platform` import.
**Now:** imports `Platform`; fill `Platform.select({ ios:'rgba(255,255,255,0.70)', android:'#FFFFFF', default:… })` + `overflow:'hidden'` + `elevation: Platform.select({ ios:6, android:0, default:6 })`.
**Why:** SPEC §2.A A4. **Lines:** ~+10.

### B bucket — MED opaque-white (clip only; fill already opaque; iOS shadow unaffected)

#### `app-mobile/src/components/PairedPeopleRow.tsx` (B1)
**Before:** `card` = `"white"` + border `rgba(0,0,0,0.04)` + `elevation:3`, no clip.
**Now:** + `overflow:'hidden'`. **Why:** SPEC §2.B B1 — clip kills the corner ring; fill already opaque. **Lines:** ~+3.

#### `app-mobile/src/components/profile/AccountSettings.tsx` (B2)
**Before:** `card` = `#ffffff` + border `#e5e7eb` + `elevation:2`, no clip.
**Now:** + `overflow:'hidden'`. **Why:** SPEC §2.B B2. **Lines:** ~+3.

#### `app-mobile/src/components/profile/BillingSheet.tsx` (B3, B4)
**Before:** `currentCard` (`#ffffff` + `#eb7825` border + `elevation:2`) and `tierCard` (`#ffffff` + `#e5e7eb` border + `elevation:2`), no clip.
**Now:** both + `overflow:'hidden'`. **Why:** SPEC §2.B B3/B4. **Lines:** ~+6.

### C bucket — dark-canvas (clip + elevation-safety; KEEP translucent fill)

#### `app-mobile/src/components/onboarding/OnboardingShell.tsx` (C1)
**Before:** `secondaryCta` = `rgba(255,255,255,0.45)` + border, no shadow/elevation, no clip.
**Now:** + `overflow:'hidden'`. Fill PRESERVED. **Why:** SPEC §2.C C1 — clip the ring; dark-canvas glass kept. **Lines:** ~+3.

#### `app-mobile/src/components/connections/StartSwipingHeaderButton.tsx` (C2)
**Before:** `button` = `rgba(235,120,37,0.18)` orange glass + border, no clip.
**Now:** + `overflow:'hidden'`. Fill PRESERVED. **Why:** SPEC §2.C C2. **Lines:** ~+3.

#### `app-mobile/src/components/activity/CalendarTab.tsx` (C3, C4)
**Before:** `emptyState` = `rgba(235,120,37,0.08)` + cream border, no clip; `accordionHeader` = `rgba(255,255,255,0.06)` + near-white border + `elevation:1` + shadow, no clip. No `Platform` import.
**Now:** imports `Platform`; `emptyState` + `overflow:'hidden'`; `accordionHeader` + `overflow:'hidden'` + `elevation: Platform.select({ ios:1, android:0, default:1 })`. Both fills PRESERVED.
**Why:** SPEC §2.C C3/C4 — clip the ring; zero Android elevation rectangle on the accordion; glass kept. **Lines:** ~+8.

#### `app-mobile/src/components/activity/SavedTab.tsx` (C5)
**Before:** `emptyState` mirror of C3, no clip (`Platform` already imported).
**Now:** + `overflow:'hidden'`. Fill PRESERVED. **Why:** SPEC §2.C C5. **Lines:** ~+3.

#### `app-mobile/src/components/connections/ChatListItem.tsx` (C6)
**Before:** `container` = dark glass `rgba(255,255,255,0.075)` (Android branch 0.09) + border + Android `elevation:2`, no clip (`Platform` already imported, already Platform-branched).
**Now:** + `overflow:'hidden'`; Android branch `elevation: 2 → 0`. Fill PRESERVED.
**Why:** SPEC §2.C C6 — clip the ring + zero the Android elevation rectangle; dark glass kept. Verified the two absolute-positioned children (`groupAvatarSegment`, `onlineDot`) sit inside the avatar sub-container well within `container` bounds → `overflow:'hidden'` crops nothing; `Swipeable` action views are siblings, not children, so they are unaffected. **Lines:** ~+5.

### `app-mobile/package.json`
Added `"test:meta-orch-1002-sub-b"` script. No dependency change.

### NEW test
`app-mobile/scripts/ci/meta-orch-1002-sub-b-consumer-glass-check.mjs` — consumer node source-reader mirroring the Sub-1 `meta-orch-1002-android-glass-check.mjs` (32 assertions: T-A ×12, T-B ×4, T-C ×14, T-iOS ×2).

---

## 4. Spec traceability (success criteria)

| SC | Criterion | Implemented | Verification |
|---|---|---|---|
| SC-A | A1–A4 opaque fill to corners; no ring; no Android shadow rectangle | overflow:hidden + Android opaque + Android elevation 0 ×4 | T-A GREEN (12/12); on-device = tester |
| SC-A-iOS | A1–A4 iOS byte-identical | `Platform.select` ios/default kept translucent + iOS elevation | T-iOS GREEN; tsc clean |
| SC-B | B1–B4 clip fill+border to radius | overflow:hidden ×4 | T-B GREEN (4/4); on-device = tester |
| SC-C | C1–C6 clip + no Android elevation rectangle; glass fill KEPT | overflow:hidden ×6; Android elevation 0 on C4/C6; fill preserved | T-C GREEN (14/14); on-device = tester |
| SC-iOS-frozen | no `Platform.select` lost ios/default; no dark fill opaque-ified | iOS branches intact; C fills preserved | T-iOS + T-C keep-fill assertions GREEN |
| SC-scope | only `app-mobile/` source; no Sub-1 re-touch; no `packages/`/business/admin/backend/dep | diff = 12 source files + 1 test + package.json | `git diff` GREEN (§7) |

---

## 5. Regression test (mandatory gate)

**Test:** `app-mobile/scripts/ci/meta-orch-1002-sub-b-consumer-glass-check.mjs`
(`npm run -w app-mobile test:meta-orch-1002-sub-b` / `node ./scripts/ci/meta-orch-1002-sub-b-consumer-glass-check.mjs`).

- **Passing run:** `Summary: 32/32 PASS`.
- **fails-on-revert verified at commit `f3e3e404a25d3bf2b06003d5e4f63e88c892efba`** (A bucket committed, B+C reverted via `git stash`): `Summary: 20/32 PASS (12 FAIL)`, exit 1 — every reverted B/C surface's `overflow:'hidden'` + C4/C6 Android-elevation assertions FAILED. After `git stash pop`: back to `32/32 PASS`.

The test asserts the dark-canvas fills are NOT opaque-ified (the keep-fill assertions), so an over-eager future "flatten" of the glass also fails the gate. The tester writes a second adversarial test (e.g. clip-without-crop on-device) — not in this implementor scope.

---

## 6. Typecheck + lint (touched package)

**tsc (`npx tsc --noEmit`, consumer):** 249 errors WITH my changes; identical 249 baseline (Sub-1 report documents the same 249). ZERO in any touched file. All 249 are `packages/phone-input/*` worktree node_modules/path-alias resolution + pre-existing strictness debt. **0 new errors.**

**lint (`npx eslint <touched>`):** 2 errors + 100 warnings, ALL pre-existing baseline — the 2 errors are `import/no-unresolved` on `@/src/...` path aliases in CalendarTab/SavedTab (confirmed present with my changes stashed → count unchanged at 2). My style-only edits (added `overflow`, `Platform.select`, and a used `Platform` import) add **zero new lint findings**. New test file: clean.

---

## 7. Cross-surface impact (Phase 2.5)

Affected = Consumer Android (target, A/B/C buckets). No-op = Consumer iOS (every change behind `Platform.select` or iOS-shadow-safe `overflow:'hidden'`). Untouched: Buyer/anon Web + Business Web preview (web glass path = `GlassBlur.tsx`, deferred Sub-C); Business iOS/Android (`mingla-business` not touched); Admin Web (renders none of these). Parity automatic on iOS (shared code, iOS branch unchanged). No Sub-1 file re-touched (8 chrome files, NotificationsSheet, MessageInterface, the shared gate export, `cardUnreadBg` all untouched).

```
git diff --stat (this branch vs the Sub-1 base):
 app-mobile/package.json
 app-mobile/scripts/ci/meta-orch-1002-sub-b-consumer-glass-check.mjs   (new)
 app-mobile/src/components/IncomingPairRequestCard.tsx
 app-mobile/src/components/PairingInfoCard.tsx
 app-mobile/src/components/PairedPeopleRow.tsx
 app-mobile/src/components/ui/MultiDayCalendar.tsx
 app-mobile/src/components/connections/AddFriendView.tsx
 app-mobile/src/components/connections/StartSwipingHeaderButton.tsx
 app-mobile/src/components/connections/ChatListItem.tsx
 app-mobile/src/components/onboarding/OnboardingShell.tsx
 app-mobile/src/components/activity/CalendarTab.tsx
 app-mobile/src/components/activity/SavedTab.tsx
 app-mobile/src/components/profile/AccountSettings.tsx
 app-mobile/src/components/profile/BillingSheet.tsx
 Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md     (new)
 Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md (new)
```

No `mingla-business/`, `packages/`, `mingla-admin/`, backend, or dependency change.

---

## 8. Invariants

- **I-7 (visible degradation, no null):** every changed surface renders a visible View. PRESERVED.
- **I-MOR-0827-PACKAGE-ISOLATION:** no `packages/` touch. PRESERVED.
- **iOS-render-frozen:** every change behind `Platform.select` or iOS-shadow-safe `overflow:'hidden'`. PRESERVED (T-iOS + tsc clean).
- **I-ANDROID-ROUNDED-FILL-CLIPPED (DRAFT, extended from S1/S6 to A/B/C surfaces):** every swept rounded surface carries `overflow:'hidden'`. Asserted by T-A/T-B/T-C.
- **I-ANDROID-GLASS-OPAQUE-FALLBACK (DRAFT):** light-canvas A surfaces render opaque on Android; dark-canvas C surfaces intentionally KEEP translucent glass per SPEC §1.2 judgment (the invariant scopes "chrome"; dark-canvas content glass is exempted by design).

---

## 9. DONE vs REMAINING (no silent skips)

### DONE — 14 surfaces across 11 files (full quality)

| Bucket | Surfaces |
|---|---|
| A (light-canvas) | A1 IncomingPairRequestCard.card · A2 PairingInfoCard.card · A3 MultiDayCalendar.container · A4 AddFriendView.glassCard |
| B (MED opaque-white) | B1 PairedPeopleRow.card · B2 AccountSettings.card · B3 BillingSheet.currentCard · B4 BillingSheet.tierCard |
| C (dark-canvas) | C1 OnboardingShell.secondaryCta · C2 StartSwipingHeaderButton.button · C3 CalendarTab.emptyState · C4 CalendarTab.accordionHeader · C5 SavedTab.emptyState · C6 ChatListItem.container |

### REMAINING — deferred long-tail (for a follow-up pass)

The investigation §3.2 cites broader counts (~95 HIGH translucent, ~15 MED, ~50 dark-canvas) that include lower-visibility siblings NOT in the named exemplar list. Per the dispatch's "quality over coverage" + explicit phasing, these are deferred, not silently skipped:

- **Light/MED siblings:** other rounded+border+translucent cards across profile, connections, board, and activity surfaces beyond the named exemplars (the long tail of the ~95 HIGH / ~15 MED).
- **Dark-canvas glass siblings:** PreferencesSheet panels, MessageInterface chips, ExpandedCard chips, CalendarTab/SavedTab share-sheets, and the remainder of the ~50 dark-canvas group — each needs the same `overflow:'hidden'` + elevation-safety + keep-fill treatment, but each is an on-device judgment call (verify the ring actually shows before touching), so they were left for a focused pass rather than a blind sweep.
- A future Sub-B-continuation (or the tester's on-device pass) can enumerate the exact long-tail file:line list from the §3.2 agent catalogs (`/tmp/high.txt`, `/tmp/med.txt` referenced in investigation §7) and apply the identical recipe.

This is the SPEC §7 accounting: representative exemplar-grade + MED + dark-canvas surfaces treated at full quality; long-tail siblings listed REMAINING.

---

## 10. Discoveries for orchestrator

- **Pre-existing worktree lint/tsc debt** (249 consumer tsc errors from `packages/phone-input/*` resolution + 2 `import/no-unresolved` path-alias lint errors in CalendarTab/SavedTab) is unrelated to this sweep — flagged for awareness, not fixed (scope discipline). Identical to the Sub-1 report's baseline note.
- **Long-tail Symptom-A siblings remain** (§9 REMAINING) — recommend a follow-up dispatch that pulls the exact file:line list from the §3.2 forensic catalogs for a complete consumer sweep, since each dark-canvas sibling needs an on-device ring-visibility judgment.

---

## 11. Spec deviations

None. Shipped the exact recipe (overflow:hidden + Android opaque fill for light-canvas + Android-zero elevation under rounded fills); applied the SPEC §1.2 dark-canvas judgment (keep translucent fill, clip + elevation-safety only). Light-canvas opaque equivalents use `#FFFFFF` (the frosted-white intent rendered solid) per policy.
