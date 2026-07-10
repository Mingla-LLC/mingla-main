# IMPLEMENTATION — ORCH-1336 [notifications-sheet-gap] — top-align notifications sheet

**Status:** implemented and verified (source-static + gates + CI-enforced). Runtime device confirmation deferred to tester (RN layout; app-mobile has no headless render harness).
**Branch:** `ORCH-1336-notifications-sheet-gap`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1336-[notifications-sheet-gap]/`
**Fix commit:** `8d0b201e4`
**CI-enforcement commit:** see the "CI enforcement" section below.
**Approach:** (A) — populated branch returns `null` when online (recommended in the dispatch for an unambiguous fails-on-revert).

---

## 0. CI enforcement (added at REVIEW — NEEDS WORK rework)

REVIEW confirmed the fix (`8d0b201e4`) but flagged that the node-assert `.test.tsx` is not run in any CI workflow, so it did not satisfy the regression-protection HARD MUST. Added the repo's real CI-enforcement mechanism for app-mobile structural regressions — a strict-grep `.mjs` guard wired as a job in `strict-grep-mingla-business.yml` (mirroring how `orch-0975-notifications-sheet.mjs` enforces the ORCH-0975 sheet invariant). The node-assert happy-path test is kept as-is (local guard).

- **Guard:** `.github/scripts/strict-grep/orch-1336-notifications-top-align.mjs` (ESM, comment-stripped, `fail()`/`ok()`, `process.exit(1)` on any failure). Reads `app-mobile/src/components/NotificationsSheet.tsx` and asserts: **C1** populated branch returns null when online (`if (!(isOffline && notifications.length > 0)) { return null;`) · **C2** no `notificationsBody:` style block with `flex: 1` · **C3** no `style={styles.notificationsBody}` JSX · **C4** offline banner preserved (`testID="notifications-offline-banner-wrap"` + `style={styles.offlineBanner}` + `notifications:offline.banner`) · **C5** no direct `@gorhom/bottom-sheet` import.
- **Self-test:** inline `--self-test` → **PASS 10/10** cases (compliant fix; synthetic pre-fix wrapper; C1-removed; C2-re-added; C3-re-added; C4-testID-removed; C4-style-removed; C4-locale-removed; C5-gorhom-import; commented-tokens-stripped).
- **CI job:** `orch-1336-notifications-top-align` in `.github/workflows/strict-grep-mingla-business.yml` (checkout + setup-node 20 + self-test step + live gate step, mirroring the `orch-1321` block).
- **Invariant:** `I-PROPOSED-1336-NOTIFICATIONS-TOP-ALIGN` pre-staged **DRAFT** in `Mingla_Artifacts/INVARIANT_REGISTRY.md` (flips ACTIVE at CLOSE).
- **Guard fails-on-revert (real tree):** ran the live guard against the actual pre-fix parent source (`git show 8d0b201e4~1:…NotificationsSheet.tsx`) → **exit 1** with C1+C2+C3+C4 FAIL; restored fix → **exit 0**. Guard also self-fires internally on the synthetic pre-fix fixture (self-test case 2).

Files in the CI-enforcement commit: `orch-1336-notifications-top-align.mjs` (new, incl. self-test) + `strict-grep-mingla-business.yml` (job added) + `INVARIANT_REGISTRY.md` (DRAFT stanza) + this report. The already-committed fix (`8d0b201e4`) and `BaseBottomSheet.tsx` are untouched.

---

## 1. Summary

In the Explorer app's notifications sheet, when only a few notifications existed (e.g. one), a large empty band sat between the header and the first item and the single card floated mid-sheet instead of hugging the top. Root cause (proven cold, per dispatch): the populated + online branch of `renderBody()` returned an **empty** `<View style={styles.notificationsBody}>` whose style was `{ flex: 1, minHeight: 0 }`. `BaseBottomSheet` (scrollMode="sectionlist") renders `{header}{children}{BottomSheetSectionList (flex:1)}` as sibling children, so two `flex:1` siblings (the empty wrapper + the list) split the bounded sheet height ~50/50 — the empty wrapper ate the top half (the gap) and the list was shoved into the bottom half, floating its single card mid-sheet.

Fix (consumer-side, pure-JS RN layout, OTA-able): the populated branch now **returns `null` when online**, contributing no flex space above the list, so the `BottomSheetSectionList` (flex:1 inside BaseBottomSheet) claims **all** remaining height below the header and the notifications hug the top. When offline, the offline banner still renders **above** the list, in its own intrinsic-height `View` (no flex:1), so it sits at the top without reopening the gap. The now-dead `notificationsBody` (flex:1) style was removed (subtract before adding). `BaseBottomSheet.tsx` untouched; `styles.sectionList { flex:1 }` there untouched; sole-gorhom-consumer invariant preserved.

---

## 2. SPEC success-criteria coverage

| Criterion | How verified | Result | Commit |
|-----------|--------------|--------|--------|
| Populated + online body contributes NO flex space above the list (notifications hug the top) | Branch returns `null` when `!(isOffline && notifications.length>0)`; the flex:1 `notificationsBody` wrapper deleted; regression guard G1+G2+G3 | ✓ | `8d0b201e4` |
| Offline banner still renders ABOVE the list when offline | Offline branch returns the `offlineBanner` View (intrinsic height) with the localized copy; guard G4+G5 | ✓ | `8d0b201e4` |
| BaseBottomSheet.tsx NOT modified; `styles.sectionList { flex:1 }` there preserved | `git status` shows only NotificationsSheet.tsx + new test; META-ORCH-0991 guard + self-test pass | ✓ | `8d0b201e4` |
| Loading/empty/error branches untouched (still centered) | Diff touches only the populated branch + the removed style; loading/error/empty branches unchanged | ✓ | `8d0b201e4` |
| Sole-gorhom-consumer invariant preserved (no `@gorhom/bottom-sheet` import in NotificationsSheet) | META-ORCH-0991 strict-grep normal + self-test pass; guard G6 | ✓ | `8d0b201e4` |
| Existing testIDs / a11y / card+action behavior preserved | Only the offline-wrapper JSX and one dead style changed; ORCH-0975 + tester-adversarial suites still green | ✓ | `8d0b201e4` |

---

## 3. Files changed

| File | Change | +/− |
|------|--------|-----|
| `app-mobile/src/components/NotificationsSheet.tsx` | populated branch returns null when online + offline banner rendered intrinsic with testID; removed dead `notificationsBody` flex:1 style | +21 / −16 |
| `app-mobile/src/components/__tests__/NotificationsSheet.orch1336.test.tsx` | NEW source-static regression guard (6 assertions) | +115 / −0 |

`git diff --cached --stat`: 2 files changed, 136 insertions(+), 16 deletions(-). No other file touched.

---

## 4. Data-model changes applied

None. Pure client-side RN layout change. No migrations, no schema, no RLS.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **Path:** `app-mobile/src/components/__tests__/NotificationsSheet.orch1336.test.tsx` (NEW file — append-only gate satisfied; no existing test modified).
- **Style:** source-static Node `assert` script — matches this repo's established convention (app-mobile has NO jest and NO `@testing-library/react-native`; the sibling `NotificationsSheet.test.tsx` and `NotificationsSheet.tester-adversarial.test.tsx` are the same style, and the sheet cannot be rendered headlessly because `BaseBottomSheet` pulls native gorhom). Deterministic, no layout engine.
- **Run:** `cd app-mobile && node ./src/components/__tests__/NotificationsSheet.orch1336.test.tsx`
- **6 assertions:** G1 populated branch returns null when online · G2 flex:1 `notificationsBody` style deleted · G3 no JSX renders the flex:1 wrapper above the list · G4 offline-banner wrapper carries `testID="notifications-offline-banner-wrap"` · G5 offline banner + localized copy still render (parity) · G6 no `@gorhom/bottom-sheet` import (sole-consumer invariant).

**fails-on-revert verified at `8d0b201e4`.** Method = true line-deletion of the fix via `git checkout -- app-mobile/src/components/NotificationsSheet.tsx` (restores the buggy origin/main version: the empty `flex:1 notificationsBody` wrapper returns).

```
# FIX present:
$ node ./src/components/__tests__/NotificationsSheet.orch1336.test.tsx
PASS ORCH-1336 notifications-sheet top-align regression guard (6 assertions)
exit=0

# FIX reverted (git checkout -- NotificationsSheet.tsx → empty flex:1 wrapper back):
$ node ./src/components/__tests__/NotificationsSheet.orch1336.test.tsx
AssertionError [ERR_ASSERTION]: G1 ORCH-1336: populated branch must return null when online ...
REVERT_EXIT=1

# FIX restored:
$ node ./src/components/__tests__/NotificationsSheet.orch1336.test.tsx
PASS ORCH-1336 notifications-sheet top-align regression guard (6 assertions)
RESTORE_EXIT=0
```

Existing suites re-run against the fix — both green:
```
PASS ORCH-0975 NotificationsSheet structural regression suite; fails-on-revert anchor 818b5f8b746e
PASS ORCH-0975 tester adversarial suite; fails-on-revert anchor d2fca61b37c8e328e31340281b05fed59e1fd86b
```

---

## 7. Old → New receipt

### app-mobile/src/components/NotificationsSheet.tsx
- **What it did before:** the populated branch of `renderBody()` always returned `<View style={styles.notificationsBody}>{isOffline && notifications.length>0 && <offline banner/>}</View>`; `styles.notificationsBody` was `{ flex: 1, minHeight: 0 }`. When online the View was empty but still `flex:1`, competing with the section list's `flex:1` and opening the mid-sheet gap.
- **What it does now:** the populated branch returns `null` when `!(isOffline && notifications.length>0)` (i.e. when online), so it contributes zero flex height above the list. When offline it returns the `offlineBanner` View (intrinsic height, no flex:1) with `testID="notifications-offline-banner-wrap"`. The dead `notificationsBody` style is removed.
- **Why:** the online path must contribute no flex space so `BaseBottomSheet`'s `flex:1` `BottomSheetSectionList` claims all height below the header and notifications hug the top (ORCH-1336 root cause).
- **Lines changed:** ~37 (21 added incl. explanatory comment, 16 removed).

---

## 8. Cross-surface impact

| Surface | Affected | What changes / reason |
|---------|----------|-----------------------|
| Consumer iOS | YES | Notifications sheet hugs the top; parity automatic (shared `app-mobile/src`). |
| Consumer Android | YES | Same fix, same file; parity automatic (shared `app-mobile/src`). |
| Buyer / anonymous Web | NO | Different codebase (`mingla-business`); NotificationsSheet is consumer-only. |
| Business iOS | NO | Different app. |
| Business Android | NO | Different app. |
| Admin Web (adjacent) | NO | Different app. |
| Business Web preview (adjacent) | NO | Different app. |

Parity across the two affected surfaces (iOS + Android) is **automatic** — one shared file, no per-platform branch touched. No manual parity risk.

---

## 9. Smoke result

- Source-static regression guard: PASS (6/6) on fix; FAIL on revert (exit 1); PASS on restore.
- Existing ORCH-0975 + tester-adversarial suites: PASS.
- TypeScript (`npx tsc --noEmit`, app-mobile): **zero errors in the touched file** (grep for `NotificationsSheet` in tsc output = none). The 876 project-wide `error TS` lines are pre-existing debt entirely in unrelated `packages/*` (brand-rendering / offering-rendering / phone-input) shared modules — none in files this ORCH touched.
- Strict-grep guards: ORCH-0975 notifications-sheet PASS; META-ORCH-0991 sole-gorhom-consumer PASS (normal scan: BaseBottomSheet still the sole importer; self-test PASS); META-ORCH-1002 android glass PASS.
- **Not run headlessly:** on-device visual confirmation of the top-alignment (single notification hugs the top, no gap). app-mobile has no jest/RTL render harness and `BaseBottomSheet` requires native gorhom, so pixel confirmation is a device/sim task for the tester (open Home → bell → one notification present, online).

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- `styles.sectionList { flex:1 }` inside NotificationsSheet.tsx (line ~933) appears unused (the effective flex:1 list style lives in BaseBottomSheet). It is **pre-existing** and out of scope for ORCH-1336 — left untouched. Noted for the orchestrator (Discoveries).

---

## 11. Operator action required

- **Migration `db push`:** none (no migration).
- **Edge-function deploy:** none.
- **CI regression-guard registration:** DONE (see §0 "CI enforcement"). Strict-grep guard `orch-1336-notifications-top-align.mjs` wired as job `orch-1336-notifications-top-align` in `strict-grep-mingla-business.yml` (self-test + live steps); invariant `I-PROPOSED-1336-NOTIFICATIONS-TOP-ALIGN` pre-staged DRAFT. Orchestrator flips it ACTIVE at CLOSE.
- **Ship path:** consumer-side pure-JS change → OTA-able via `eas update` (per-platform, never `--platform all`) once merged from main. No native rebuild needed.

---

## 12. Discoveries for Orchestrator

1. **Pre-existing dead style:** `styles.sectionList { flex:1 }` in `NotificationsSheet.tsx` looks unused (the live flex:1 list style is in BaseBottomSheet). Not this ORCH's scope; register as a trivial cleanup if desired.
2. **CI wiring — RESOLVED at REVIEW:** the regression guard is now CI-enforced via the strict-grep `.mjs` job (§0), not a node npm-script. (The node-assert `.test.tsx` stays as the local happy-path guard.)
3. **app-mobile has no jest / RTL:** the dispatch suggested `npx jest` / `render(...)`/`queryByTestId`, but app-mobile has no jest config and no `@testing-library/react-native`; tests here are `node`-run source-static assert scripts. I followed the actual repo convention. (The `testID="notifications-offline-banner-wrap"` is still added so a future render harness — or the tester — can assert presence/absence directly.)
4. **README gate-table (optional doc follow-up):** `.github/scripts/strict-grep/README.md` has an "Active gates registered" table; it is NOT CI-enforced (no meta-check validates it), and the REVIEW dispatch scoped the commit to the guard + workflow + invariant registry, so I did not edit it. The orchestrator may add an `orch-1336-notifications-top-align` row at CLOSE for completeness.

---

**Commit hash:** `8d0b201e4`
