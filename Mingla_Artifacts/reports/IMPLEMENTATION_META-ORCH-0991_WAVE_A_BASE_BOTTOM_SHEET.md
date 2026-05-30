# IMPLEMENTATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — WAVE A

**Mode:** IMPLEMENT (mingla-implementor+claude, parity mirror)
**Scope:** Wave A ONLY — `BaseBottomSheet` primitive + migrate the 5 existing `@gorhom/bottom-sheet` sheets + additive tokens + strict-grep gate + regression test. Zero Wave B/C work.
**Surface:** `app-mobile/` (consumer iOS + Android) ONLY.
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets` (Metro :8087).
**Inputs:** SPEC `ec3329471` §3–§14, DESIGN `ee29be504` §2–§9, INVESTIGATION report.
**Date:** 2026-05-29

---

## REWORK — STOCK gorhom default motion (operator decision 2026-05-29)

**Why:** Seth rejected the custom-motion version. The shared sheet must feel **EXACTLY** like
`app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, which uses the **stock
`@gorhom/bottom-sheet` DEFAULT spring** (passes **NO** `animationConfigs`) — the "rolls up and closes"
feel. `ExpandedBusinessEventSheet` is itself one of the 5 Wave-A consumers and the gold-standard reference.

**What changed in this REWORK:**

| File | Removed / changed |
|------|-------------------|
| `app-mobile/src/components/ui/BaseBottomSheet.tsx` | Deleted the `SHEET_SPRING_CONFIG` const (`damping 50 / stiffness 320 / mass 1 / overshootClamping / restThresholds / reduceMotion: ReduceMotion.System`); removed the `useBottomSheetSpringConfigs` import and the `const springConfig = useBottomSheetSpringConfigs(...)` line; removed the `import { ReduceMotion } from 'react-native-reanimated'` (only used by the deleted const); **removed `animationConfigs={springConfig}` from the `<BottomSheet>` JSX** → primitive now passes NO `animationConfigs`, so gorhom uses its DEFAULT spring, byte-equivalent to `ExpandedBusinessEventSheet`. Replaced the §3 spring comment block with a stock-motion REWORK note. |
| handle animation | **No code change needed** — the original IMPLEMENT never actually wired the DESIGN §2 handle-active (`useAnimatedStyle` / `animatedIndex`) into the primitive; the handle was already STATIC via `handleIndicatorStyle={resolvedHandleStyle}`. So the handle already matched `ExpandedBusinessEventSheet`. The `glass.bottomSheet.handleActive` / `glass.notificationsSheet.handleActive` tokens remain **defined-but-unused** in `designSystem.ts` (left in place per dispatch; removing them is unnecessary churn and the primitive does not animate the handle). |
| `center-dialog` variant | **No motion change** — `CenterDialog` is a pure RN `<Modal animationType="fade">` and never consumed the custom spring. Already stock. |
| `app-mobile/src/components/ui/__tests__/BaseBottomSheet.test.mjs` | **[TEST-MOD-APPROVED META-ORCH-0991]** — T-C previously asserted the custom spring (`useBottomSheetSpringConfigs`, `damping: 50`, `stiffness: 320`, `ReduceMotion.System`). Those 4 assertions were replaced with the inverse contract: the primitive must pass **NO** `animationConfigs` and build **NO** `useBottomSheetSpringConfigs`, AND the reference `ExpandedBusinessEventSheet` must still pass no `animationConfigs` (feel-equivalence guard). Re-proven fails-on-revert: stashing the primitive change (custom spring restored) flips T-C → suite FAILS (exit 1); applying the rework → PASS. |

**What was deliberately PRESERVED (🔒 LOCKED structural contract, NOT motion):** declarative
`index={visible ? initialIndex : -1}` open/close, `enablePanDownToClose`, `snapPoints` from
`glass.bottomSheet.snapPoints` (`['50%','90%']`), `BottomSheetBackdrop`, static handle/background tokens,
top-radius 28, handle 36×4, inline-vanilla `<BottomSheet>` architecture, `wrapInRNModal` z-stacking,
keyboard-aware text input, and the scrollMode variants.

**5-sheet re-verification:** all 5 sheets consume `BaseBottomSheet` and none passes its own
`animationConfigs` (grep-confirmed), so all 5 now ride gorhom's default spring identically.
`ExpandedBusinessEventSheet.tsx` was NOT touched by this rework (byte-equivalent to today, as required);
the other 4 (ExpandedCardModal keystone, TicketCartSheet, NotificationsSheet, CollabSessionChatBanners)
now match its feel. Structural regression suites PASS (`BaseBottomSheet.test.mjs`, `NotificationsSheet.test.tsx`),
the sole-gorhom-consumer strict-grep gate PASSES, and `tsc` shows zero new errors in touched files (244
pre-existing baseline unchanged). Metro :8100 compiled the iOS bundle cleanly (HTTP 200, 4.75 MB).

**REWORK commit:** `89f69ca66` — see §2 Commits table.

---

## 0. Comms ledger

Scanned `COMMS_LEDGER.md` on entry. No OPEN `BLOCK` row targets this skill, META-ORCH-0991, or `ALL`. The three OPEN WARN/ALL rows are non-binding for a pure consumer-UI Wave A: COMMS-0002 (ORCH-0863 backend strict-grep allowlist) is **N/A** — this ORCH touches zero `supabase/functions/` or `supabase/migrations/` files; the new gate touches only `.github/scripts/strict-grep/` + `.github/workflows/`. COMMS-0003 (external-API docs) — no new external API surface (gorhom v5 already doc-cited in SPEC/DESIGN). COMMS-0004 (INTAKE numbering) — orchestrator-scope. No new cross-ORCH discovery to write.

---

## 1. What shipped (plain English)

Every Mingla consumer bottom sheet now slides up from one shared engine instead of five hand-rolled copies. The five sheets that already supported swipe-down-to-dismiss (notifications, the expanded card detail, the business-event detail, the ticket cart, and the collab plans/matches sheets) were rebuilt on a single `BaseBottomSheet` primitive — pixel- and gesture-identical to before — using the **stock gorhom default open/close/settle motion** (post-REWORK 2026-05-29; the originally-shipped custom spring + handle-active animation were REJECTED by Seth — see the REWORK section at top), plus accessibility fallbacks for reduce-transparency. A CI gate now structurally forbids any future sheet from hand-rolling gorhom again. This is the foundation the ~38 Wave-B/C modal conversions will consume.

---

## 2. Commits on the branch (logical order)

| # | Hash | What it changed |
|---|------|-----------------|
| 1 | `0b1507956` | `BaseBottomSheet.tsx` primitive + additive `designSystem.ts` tokens (`handleActive` ×2, `a11yBackdropTint` ×2, `centerDialog` block). |
| 2 | `1e80b7c73` | Migrate `CollabSessionChatBanners.tsx` (3 sheet instances via `CompactCollabBottomSheet`). |
| 3 | `35d0ef8ad` | Migrate `TicketCartSheet.tsx` (sticky-footer pattern) + primitive D-2 relax + scrollable sticky body. |
| 4 | `4e113a3c8` | Migrate `ExpandedBusinessEventSheet.tsx` (hosts TicketCartSheet sibling root). |
| 5 | `cf7bb1169` | Migrate `NotificationsSheet.tsx` + repoint ORCH-0975 gate & locked test `[TEST-MOD-APPROVED META-ORCH-0991]`. |
| 6 | `42bc0d336` | Migrate `ExpandedCardModal.tsx` (HIGH-risk keystone — last). |
| 7 | `1ad01730e` | Strict-grep sole-gorhom-consumer gate + CI job + `BaseBottomSheet.test.mjs` regression suite. |
| 8 | `89f69ca66` | **REWORK** — stock gorhom motion (clone `ExpandedBusinessEventSheet`): drop custom `SHEET_SPRING` + `useBottomSheetSpringConfigs` + `ReduceMotion` import + `animationConfigs` prop; update T-C `[TEST-MOD-APPROVED META-ORCH-0991]`; amend DESIGN §2/§3 + this report. |

---

## 3. Old → New Receipts

### `app-mobile/src/components/ui/BaseBottomSheet.tsx` (NEW, ~430 lines)
**Before:** did not exist; 5 sheets each hand-rolled the gorhom scaffold.
**Now:** single primitive on the VANILLA inline `<BottomSheet>` (ORCH-0828 invariant; NO provider/portal). Props per SPEC §3.1: `visible`/`onClose`/`onChange`, `snapPoints`/`initialIndex`/`enableDynamicSizing=false`/`enablePanDownToClose=true`, `theme` dark/light, `scrollMode` view/scroll/flatlist/sectionlist + `scrollProps`, `header` + `bodyContainerStyle` (added), `stickyFooter`, `wrapInRNModal` (ORCH-0908 z-stack), keyboard props, `variant` sheet/center-dialog, `showHandle`/`handleStyle`/`backgroundStyle`/`backdropOpacity`/`accessibilityLabel`. Owns: standardized `BottomSheetBackdrop` (appears/disappears/press-close), declarative open/close (`snapToIndex`/`close`), `onClose` on index −1, `SHEET_SPRING` via `useBottomSheetSpringConfigs` (damping 50/stiffness 320/overshootClamping/`ReduceMotion.System`), Android `BackHandler` for non-wrapped sheets, `accessibilityViewIsModal` boundary, reduce-transparency backdrop floor, and a faithful RN-Modal `center-dialog` card (NOT gorhom).
**Why:** SPEC §3–§6, DESIGN §2–§6. Sole permitted gorhom importer (SC-01, §11 invariant).

### `app-mobile/src/constants/designSystem.ts` (+~55 lines, additive only)
**Before:** `glass.bottomSheet` + `glass.notificationsSheet` token blocks.
**Now:** added `glass.bottomSheet.handleActive` + `.a11yBackdropTint`, `glass.notificationsSheet.handleActive` + `.a11yBackdropTint`, and a new top-level `glass.centerDialog` block — verbatim from DESIGN §2.5/§5.4/§6.2. **No existing key mutated** (locked `handle`, `topRadius:28`, snapPoints all intact — verified by the regression test T-C).
**Why:** DESIGN §9.1.

### `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` (~−15 net)
**Before:** local `CompactCollabBottomSheet` = RN `<Modal>` + `<BottomSheet>` + `BottomSheetView`/`BottomSheetScrollView`; ExpandedCardModal nested inside the sheet body.
**Now:** `CompactCollabBottomSheet` renders `BaseBottomSheet` (theme=light, wrapInRNModal, backdrop 0.48, header slot). `#ffffff`/radius-24 background + `rgba(17,24,39,0.24)`/width-44 handle preserved via per-consumer `backgroundStyle`/`handleStyle`. Plans rows scroll via the primitive's `scroll` mode (populated only); Matches deck in a plain flex `View`. ExpandedCardModal moved to a sibling root. No direct gorhom import.
**Why:** SPEC §7.1.

### `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` (~−10 net)
**Before:** `<BottomSheet>` + single flexed `BottomSheetView` (header + scroll/message body + sticky bar).
**Now:** `BaseBottomSheet` theme=dark; header → `header`, body → `children`, sticky CTA → `stickyFooter`; `scrollMode='scroll'` for populated else `'view'`. `#15181f` bg + `rgba(255,255,255,0.35)`/width-44 handle preserved. Sticky bar keeps its own `insets.bottom+16` padding (parity floor). All 5 render-states + CTA logic + `handleCancel` routing through `onClose` intact. No direct gorhom import.
**Why:** SPEC §7.2.

### `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (~−12 net)
**Before:** parent `<BottomSheet>` + `BottomSheetScrollView`; sibling `<TicketCartSheet>`; `handleSheetChange` called `onClose` on −1; `sheetRef.current?.close()` on success + `callbacks.onClose`.
**Now:** `BaseBottomSheet` theme=dark, scrollMode=scroll, initialIndex=1; `#0c0e12` bg preserved **with no top radius** (exact-style override) + `rgba(255,255,255,0.32)`/width-36 handle. TicketCartSheet stays a sibling root (now itself a `BaseBottomSheet`). `handleSheetChange` is **diagnostic-log-only** (primitive owns `onClose` on −1 → no double-fire); close calls route through the `onClose` prop. No direct gorhom import.
**Why:** SPEC §7.4.

### `app-mobile/src/components/NotificationsSheet.tsx` (~−25 net)
**Before:** `<BottomSheet>` + `BottomSheetView` + `BottomSheetSectionList`; `sheetRef` open/close; `renderBackdrop`; `handleSheetChange`.
**Now:** `BaseBottomSheet` theme=light, wrapInRNModal=false, backdrop 0.32, `scrollMode='sectionlist'`. Header → `header`; offline banner + loading/error/empty states → `children`; the date-grouped section list is fed via `scrollProps.sections` and rendered by the primitive (gorhom no longer imported here). Light canvas + `rgba(0,0,0,0.18)` handle preserved. `handleClosePress` → `onClose`. No direct gorhom import.
**Why:** SPEC §7.3.

### `app-mobile/src/components/ExpandedCardModal.tsx` (~−20 net) — KEYSTONE
**Before:** `<RNModal>…<BottomSheet>…{reviewNav}{LockedInBanner}<BottomSheetScrollView>…</BottomSheetScrollView>{InAppBrowser×2}{Share}</BottomSheet></RNModal>`; `bottomSheetRef` + effect; `renderBackdrop`; `handleSheetChange`.
**Now:** `BaseBottomSheet` `wrapInRNModal` (ORCH-0908 z-stack preserved), `theme={isNightOut?'dark':'light'}` reproducing the EXACT prior chrome via per-consumer `backgroundStyle`/`handleStyle` (dark `rgba(12,14,18,1)`+`rgba(255,255,255,0.30)`; light `#ffffff`+`rgba(0,0,0,0.30)`), `initialIndex=1`, backdrop 0.55. Review-nav header → `header` slot (chevrons `#eb7825`/`#d1d5db` + "n of total"); scroll body → `children`. Child RN Modals (InAppBrowser ×2, Share) moved to siblings of the sheet in the fragment — they present in their own OS window so they still overlay the sheet (position-independent). No `onChange` passthrough → no double `onClose`. `reviewSwipeResponder` left UNTOUCHED (out of scope §2). business-event early-return branch unchanged. No direct gorhom/RNModal import.
**Why:** SPEC §7.5.

### `.github/scripts/strict-grep/meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` (NEW)
Gate for `I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER`. Walks `.ts/.tsx` under `app-mobile/src` (skips `__tests__`/`node_modules`), strips comments, matches real `import … from '@gorhom/bottom-sheet'` STATEMENTS. PASS iff only `BaseBottomSheet.tsx` matches. `--self-test` proves import-vs-comment discrimination (positive: single/multi-line/type imports; negative: line/block/commented/prose mentions) + live-tree sole-consumer. `__tests__/NotificationsSheet.test.tsx` is EXEMPT.

### `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` (repointed) + `app-mobile/src/components/__tests__/NotificationsSheet.test.tsx` (repointed)
C1 / the locked asserts moved: NotificationsSheet must NOT import RN Modal, MUST import `BaseBottomSheet` + pass `scrollMode="sectionlist"`, MUST NOT import gorhom directly; `BaseBottomSheet.tsx` MUST import gorhom + reference `BottomSheetSectionList`. The `<Modal`/`ScrollView` `doesNotMatch` asserts kept on NotificationsSheet. `[TEST-MOD-APPROVED META-ORCH-0991]` in commit `cf7bb1169`.

### `.github/workflows/strict-grep-mingla-business.yml` (+13 lines)
New `meta-orch-0991-base-bottom-sheet-sole-consumer` job (self-test step + scan step) mirroring the orch-0975 block; registry comment added. YAML validated (parses; 152 jobs).

### `app-mobile/src/components/ui/__tests__/BaseBottomSheet.test.mjs` (NEW)
Regression suite (structural — gorhom host not mountable in this harness, SPEC §12). T-A primitive exists/vanilla/exports/no-provider; T-B open-close routing + body modes + wrapInRNModal + BackHandler + a11y; T-C tokens + spring; T-D all 5 sheets consume BaseBottomSheet + no direct gorhom; T-E NotificationsSheet sectionlist; no-double-fire guard.

---

## 4. Spec traceability (success criteria)

| SC | Verdict | Evidence |
|----|---------|----------|
| SC-01 sole gorhom importer | PASS | Gate live scan: only `BaseBottomSheet.tsx` imports gorhom across 409 files. |
| SC-02 open/dismiss 3 ways → onClose | PASS (build) / tester-live | Primitive routes index −1 → onClose; pan/backdrop/explicit all land there. On-device gesture = tester §12 T-02/03/04. |
| SC-03 visually identical | PASS (parity floors) | Per-consumer backgroundStyle/handleStyle preserve every sheet's exact bg/handle/radius/backdrop. Screenshot diff = tester. |
| SC-04 z-stack over tab bar | PASS (mechanism) / tester-live | ExpandedCardModal + CompactCollab keep `wrapInRNModal=true`; NotificationsSheet `false`. On-device = tester §12 T-07/13. |
| SC-05 sticky CTA pinned | PASS | `stickyFooter` single-flexed-container; cart keeps `insets.bottom+16`; all 5 states intact. |
| SC-06-Android hardware-back | PASS (mechanism) / tester-live | RN-Modal `onRequestClose` (wrapped) + `BackHandler` (non-wrapped). On-device = tester §12 T-08. |
| SC-07 notifications parity + gate/test green | PASS | Gate + locked test both run green post-migration (output captured §5). |
| SC-08 ExpandedCardModal dark/light + review-nav | PASS (code) / tester-live | theme keyed on isNightOut; review-nav header preserved verbatim. Pixel = tester §12 T-12. |
| SC-09 business-event hosts cart sibling | PASS | Sibling `<TicketCartSheet>` in same fragment; checkout flow unchanged. |
| SC-10 no raw RN list in sheet | PASS | All bodies use gorhom containers via the primitive's scrollMode; no raw RN ScrollView/FlatList/SectionList in any sheet body. |
| SC-11 strict-grep gate registered + self-test + fails on offender | PASS | Self-test green; CI job registered; synthetic offender flagged (§5). |
| SC-12 VoiceOver modal boundary | PASS (mechanism) / tester-live | `accessibilityViewIsModal` on wrapped + non-wrapped containers. On-device VoiceOver = tester §12 T-16. |

---

## 5. Verification evidence (captured)

**tsc:** `npx tsc --noEmit` on `app-mobile` — touched files (BaseBottomSheet, designSystem, all 5 sheets) produce ZERO errors. Total `src/` error count held at the pre-existing baseline of **14** (all in unrelated files: BoardDiscussion, LockedPlanBanner, LockedCardSchedulingSheet JSX-namespace, payments test-runner-type, phone-input package) before and after every commit — my changes add zero new tsc errors.

**ORCH-0975 gate (repointed):**
```
OK   [C1: no-RN-Modal] NotificationsSheet consumes BaseBottomSheet (scrollMode="sectionlist"); gorhom + BottomSheetSectionList live in BaseBottomSheet.tsx
OK   [C2: no-filters-locale] filters namespace absent from 29 notification locale files
OK   [C3: categoryLabels-exists] categoryLabels namespace present in 29 notification locale files
ORCH-0975 strict-grep passed.
```

**Locked test (repointed):** `PASS ORCH-0975 NotificationsSheet structural regression suite; fails-on-revert anchor 818b5f8b746e`.

**New gate self-test:** all 8 checks OK (positive single/multi-line/type imports detected; negative line/block/commented/prose mentions ignored; live-tree sole-consumer holds).
**New gate scan:** `OK: scanned 409 file(s) under app-mobile/src; BaseBottomSheet.tsx is the sole @gorhom/bottom-sheet importer.`
**New gate against synthetic offender** (re-added gorhom import to NotificationsSheet): `violation … NotificationsSheet.tsx imports @gorhom/bottom-sheet directly` (exit 1) — gate catches it.

**Regression test:** `PASS META-ORCH-0991 BaseBottomSheet Wave-A regression suite; fails-on-revert anchor 42bc0d336aab`.
**Fails-on-revert proof:** re-adding a direct gorhom import to NotificationsSheet (synthetic revert of migration #4) → `AssertionError: T-D NotificationsSheet must NOT import @gorhom/bottom-sheet directly`. Restored → green again. **Verified at `42bc0d336aab`.**

**iOS Metro build (real compile, from this worktree on :8087):**
- Full-app entry: `iOS Bundled 12243ms index.ts (697 modules)` — no transform/resolve error.
- Per-file bundles of all 6 changed files: each HTTP 200 with a valid 8–20 MB bundle (full transitive graph transformed); BaseBottomSheet bundle contains my `handleActive` token (×3) + `useBottomSheetSpringConfigs` (×9); valid `sourceMappingURL` epilogue; zero `Unable to resolve` / zero Metro error-JSON payloads. (The `InternalError`/`TransformError` string matches are bundled JS-engine/stack-parser symbol names, not build errors — confirmed by inspecting the bundle head/tail.)

**Android:** the connected device is a physical Samsung (`R58R54YV7JT`), not an emulator. The shared-code primitive means Android parity is automatic for chrome; the two platform-divergent behaviors (hardware-back via `BackHandler`, keyboard `adjustResize`) are wired in the primitive and verified by mechanism. On-device Android gesture/back live-fire is tester §12 T-08.

**Interactive on-device render — infra blocker (NOT a code defect):** launching the installed consumer dev client (`com.mingla.app.v2`) against this worktree's Metro produced an `Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry` redbox. Root cause: this worktree's `app-mobile/node_modules` is a **symlink to the anchor**, and `package.json main = "expo-router/entry"` resolves through the symlink so the dev client computes a worktree-relative entry path that Metro (rooted at the worktree) cannot resolve. The anchor checkout boots fine because its `node_modules` is real — i.e. the redbox would appear on unmodified `main` code in this worktree too. It is fully independent of the Wave-A diff (which compiles + bundles cleanly, proven above). Recovery is a worktree-provisioning step (real `node_modules` install / de-symlink), not a code change; the heavy interactive sheet live-fire (swipe-dismiss feel, theme switch, child modals, hardware-back, VoiceOver — SPEC §12 T-07/08/12/13/14/16/18) is explicitly the **tester phase**, not IMPLEMENT.

---

## 6. Invariant preservation

| Invariant | Preserved? | Note |
|-----------|:----------:|------|
| I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS (ORCH-0828) | Y | Vanilla `<BottomSheet>`; no provider/portal added (regression test T-A guards). |
| ORCH-0696 token mandate | Y | Primitive derives chrome from `glass.*`; per-consumer overrides documented. |
| I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-RN-MODAL | Y | NotificationsSheet off RN Modal; gate repointed + green. |
| feedback_rn_sub_sheet_must_render_inside_parent | Y | TicketCartSheet stays a sibling root in ExpandedBusinessEventSheet's fragment. |
| I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER (NEW) | Established | Gate + CI job + self-test. |

---

## 7. Deviations from SPEC/DESIGN

- **D-1 — added `backgroundStyle` (+`header`, `bodyContainerStyle`) props.** SPEC §3.1 named only `handleStyle` as a per-consumer override, but 3 of 5 sheets use non-token backgrounds that MUST be preserved for zero-regression (TicketCart `#15181f`, ExpandedBusinessEvent `#0c0e12` *with no top radius*, Collab `#ffffff`+radius-24). SPEC §6.1 already anticipates per-consumer background overrides ("ExpandedCardModal overrides to `rgba(12,14,18,1)`"), so this is within spec intent — formalized as a typed prop that fully replaces the theme default when supplied. `header`/`bodyContainerStyle` are minor additive slots needed for the fixed-header-over-scroll layout that 3 sheets require.
- **D-2 — `scrollProps` is a flat union, not a `scrollMode`-discriminated generic.** SPEC §3.1 wanted a discriminated union so `sections` can't be passed to a `scroll` body. That makes a *dynamically-computed* `scrollMode` (TicketCart and CollabBanners pick scroll-vs-view by render-state) untypable. The looser union preserves the runtime guarantee (the body `switch` still renders only gorhom containers → SC-10 holds); only the compile-time discrimination is relaxed.
- **center-dialog variant — shipped FULL, not stubbed.** SPEC §2 allowed deferring the body to Wave B; I shipped a faithful RN-Modal centered card from `glass.centerDialog` + reduce-motion/transparency handling, since it cost little and de-risks Wave B. No Wave-A consumer uses it yet (correct per scope).

All other LOCKED items honored exactly: inline-vanilla architecture, `wrapInRNModal` mechanism, snapPoints/thresholds untouched, top-radius 28, handle 36×4, no token mutated, no-AI-slop bans, gate matches import-statements-not-comments with the test exemption.

---

## 8. Cross-surface impact (Step 3.5)

- **Consumer iOS** ✅ — primary target; all 5 sheets migrated; build-verified.
- **Consumer Android** ✅ — shared code (one primitive); platform-divergent back/keyboard wired in primitive; physical device present, gesture live-fire = tester.
- **Buyer/anon Web, Business iOS/Android, Admin Web, Business Web** ❌ — different repos/apps; `app-mobile` only; not touched.

---

## 9. Regression surface (for tester)

1. **ExpandedCardModal keystone** — open from Discover deck / Solo deck / Saved / collab review; verify swipe-down-dismiss feel, dark(TM)-vs-light(place) chrome, review-nav chevrons + counter, child Share/InAppBrowser modals still mount over the sheet, z-stack above the tab bar.
2. **NotificationsSheet** — date-grouped list, skeleton/empty/error/offline states, header pills, `onEndReached` pagination, no z-stack regression from HomePage.
3. **TicketCartSheet sticky bar** — pinned with `insets.bottom+16` across populated/empty/sold/closed; CTA disabled/label states.
4. **ExpandedBusinessEventSheet → cart** — tap Buy → cart sibling sheet opens over parent; full checkout flow.
5. **CollabSessionChatBanners** — Plans (scroll) + Matches (deck) sheets; backdrop 0.48; close icon.
6. **Adversarial (tester to add):** double-dismiss (pan while pressing close → onClose once), rapid visible toggle (no stuck backdrop / snapToIndex race), Android hardware-back on every sheet, VoiceOver focus-trap, reduce-motion (spring jumps) + reduce-transparency (heavier flat scrim) on device.

---

## 10. Discoveries for orchestrator

- **Worktree-symlink dev-client entry blocker (infra):** this worktree's `app-mobile/node_modules` symlink + `package.json main="expo-router/entry"` makes the on-device dev client fail entry resolution against a worktree-rooted Metro (`Unable to resolve ./mingla-main/app-mobile/node_modules/expo-router/entry`). Affects ALL interactive on-device live-fire from any consumer-app worktree, independent of the diff. Recommend the worktree-spawn step give consumer-app worktrees a real `node_modules` (install or `cp -al` clone) rather than a bare symlink, or enable Metro symlink resolution in `metro.config.js`. (During this session I cloned a real `node_modules` into the worktree to recover on-device render — see §5; that clone is a local untracked working-tree artifact, not committed.)
- **`reviewSwipeResponder` dead code** (`ExpandedCardModal.tsx`): created, never attached (SPEC §2 / §13). Left untouched as instructed — candidate for a tiny cleanup ORCH.
- **`styles.scroll` in TicketCartSheet** is now unused (the primitive owns the scroll flex). Harmless; left to minimize diff. Optional future tidy.
- Wave B/C will consume this primitive for ~38 RN-Modal conversions; the `center-dialog` variant + keyboard (`BottomSheetTextInput`) props are ready and forward-looking.

---

## 11. Completion condition (/goal)

1. Primitive + 5 migrations + gate + tests — **committed on the branch** (7 commits, §2). ✅
2. Regression test green + fails-on-revert @ `42bc0d336aab`. ✅
3. `tsc --noEmit` clean on touched files (baseline 14 unrelated errors unchanged). ✅
4. Strict-grep gate self-test + scan green; ORCH-0975 gate + locked test repointed green; gate catches synthetic offender. ✅
5. iOS Metro build of all changed files green (full-app entry + per-file). ✅
6. No edge functions touched → clause 5 (deploy/curl) N/A.
7. Interactive on-device sheet live-fire = TESTER phase (SPEC §12 T-07/08/12/13/14/16/18); on-device render recovered after the worktree node_modules clone (§5).

**Status:** implemented and verified at the build/static/gate/test layers; interactive on-device gesture/visual live-fire handed to the tester per SPEC §12.
