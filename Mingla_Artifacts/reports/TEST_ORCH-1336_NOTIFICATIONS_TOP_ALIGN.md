# TEST — ORCH-1336 [notifications-sheet-gap] — top-align notifications sheet

**Role:** mingla-tester (brutal last line of defense — implementation assumed BROKEN until independently proven).
**Branch:** `ORCH-1336-notifications-sheet-gap`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1336-[notifications-sheet-gap]/`
**Under test:** fix commit `8d0b201e4` + CI-enforcement commit `56f84c4a5`.
**Affected surfaces:** consumer-iOS + consumer-Android (`app-mobile` Explorer app, NotificationsSheet from the Home bell). Pure-JS RN layout fix.

**VERDICT: CONDITIONAL PASS** — structural correctness PROVEN (source-model reasoning across all 6 states + CI strict-grep guard live/self-test + adversarial fails-on-revert + happy-path guard). The single outstanding condition is the pixel eyeball, which requires a Seth-gated LIVE-prod authenticated login and is deferred to an on-device/sim confirmation.

---

## 1. Independent code read — fix mechanism

`app-mobile/src/components/NotificationsSheet.tsx` `renderBody()` + the `scrollProps`/`children`/`isPopulated` wiring, and `app-mobile/src/components/ui/BaseBottomSheet.tsx` sectionlist branch (lines 724–755).

**BaseBottomSheet sectionlist branch** renders a Fragment: `{header}{children}{hasSections ? <BottomSheetSectionList style={[styles.sectionList (flex:1), …]} …/> : null}`. The header + children are intrinsic-height siblings; the list carries `flex:1` and claims the bounded space below them → bounded viewport → scrolls.

**The bug (proven cold):** pre-fix the populated branch of `renderBody()` returned an EMPTY `<View style={styles.notificationsBody}>` where `notificationsBody = { flex:1, minHeight:0 }`. As `children`, it became a second `flex:1` sibling of the list. Two `flex:1` siblings split the bounded sheet height ~50/50 → empty band under the header, list shoved to the bottom half, lone card floated mid-sheet.

**The fix (verified via `git diff 8d0b201e4~1 8d0b201e4`):**
- Populated branch now: `if (!(isOffline && notifications.length > 0)) { return null; }` then returns the offline banner `<View style={styles.offlineBanner} testID="notifications-offline-banner-wrap">…</View>`.
- The dead `notificationsBody: { flex:1, minHeight:0 }` style is deleted.
- `isPopulated` (line 698–700), the `scrollProps` gate, and `BaseBottomSheet.tsx` are untouched (diff scoped to the populated branch + the deleted style only).

This makes the online-populated `children` contribute ZERO markup above the list, so the list's `flex:1` is the sole body-region flex owner and claims all height below the header → notifications hug the top. Mechanism confirmed independently.

---

## 2. Per-state analysis (all 6 states)

| # | State (guards) | renderBody result | isPopulated | Sheet children below header | Verdict |
|---|----------------|-------------------|-------------|------------------------------|---------|
| 1 | **loading** (`isLoading && length 0`) | `renderSkeleton()` — `skeletonContainer` flex:1, 3 skeleton cards | `false` (no sections) | skeleton only, no list | Unchanged by fix — OK |
| 2 | **error** (`isError`) | `centerState` (flex:1, minHeight 360, centered) + retry | `false` | centered error only, no list | Unchanged by fix — OK |
| 3 | **empty online** (`length 0 && !isOffline`) | `centerState` empty (icon circle + copy, centered) | `false` | centered empty only, no list | Unchanged by fix — OK |
| 4 | **populated online** (`length>0 && !isOffline`) | **`null`** (short-circuit) | `true` → `sections` fed | ONLY the `flex:1` `BottomSheetSectionList` → top-aligned under header | **THE FIX — OK** |
| 5 | **populated offline** (`length>0 && isOffline`) | offline banner `<View style={styles.offlineBanner}>` — intrinsic height, no flex:1 | `true` → `sections` fed | banner (intrinsic, top) then list — no gap | Parity preserved — OK |
| 6 | **offline + empty** (`length 0 && isOffline`) | `null` (empty-online guard is false because `!isOffline` false; populated guard `!(isOffline && length>0)` = `!(true && false)` = `!false` = true → `return null`) | `true` (all three negations true) → `sections = []` fed | header + empty `BottomSheetSectionList` (`hasSections` true for `[]`) | No crash, no gap, no banner (same as pre-fix — offline+empty never showed a banner) — OK |

**Edge #6 (offline+empty) traced explicitly:** `groupNotificationsByDate([]) → []`; `sectionProps.sections = []` is `!== undefined && !== null` → `hasSections = true` → empty list renders, nothing floats. No reintroduced gap, no crash. Behavior identical to pre-fix for this state (neither version renders an offline banner when the inbox is empty — pre-existing, out of scope).

**Collateral-regression check:** the diff touches ONLY the populated branch return + the deleted style. States 1/2/3 branches and their style owners (`centerState`, `skeletonContainer`, `emptyIconCircle`, `retryButton`) are byte-identical. No regression.

---

## 3. Adversarial regression test (independent, append-only, fails-on-revert)

- **Path:** `app-mobile/src/components/__tests__/NotificationsSheet.orch1336.tester-adversarial.test.tsx` (NEW — append-only; no existing test or guard modified).
- **Convention:** `node:assert/strict`, `require.main === module`, `FAILS_ON_REVERT_COMMIT = 8d0b201e47a96f41af78483c2ded318515fa6622` — matches the sibling `NotificationsSheet.tester-adversarial.test.tsx`. Comments stripped before matching so the fix's own explanatory comment can't fake/mask a check.
- **Different angle vs the implementor's happy-path guard** (`NotificationsSheet.orch1336.test.tsx`, C1 null-regex / C2 no-flex-style / C3 no-gap-JSX / C4 offline-testID / C5 offline-style+locale / C6 no-gorhom):
  - **A — offline-banner parity:** the offline banner IS the intrinsic wrapper itself — `style={styles.offlineBanner}` AND the testID co-located on the SAME `<View>` (proves it is NOT nested inside a flex:1 gap wrapper), AND `styles.offlineBanner` is enumerated OUT of the StyleSheet's flex:1 owner set (banner cannot grow to reopen the gap). Attacks the parity claim the happy-path guard only checks by testID presence.
  - **B — invariant boundary (exactly one flex:1 body owner):** enumerate every StyleSheet key declaring `flex:1`; assert `notificationsBody` is not among them AND is unreferenced by renderBody. Set-membership mechanism, not a single doesNotMatch.
  - **C — online short-circuit ORDER proof:** `return null;` sits AFTER the empty-online branch and BEFORE the offline banner (index ordering), proving online+populated emits nothing above the list — different mechanism than the happy-path anchored regex.
  - **D — no collateral regression:** the loading/error/empty-online branches and their center/skeleton style owners are structurally intact.
  - **E — the list still renders:** `isPopulated` still gates `sections` into `scrollProps`, `scrollMode="sectionlist"`, and `{renderBody()}` is still the children slot (the fix did not starve the list).
- **Run (on fix):** `PASS ORCH-1336 tester adversarial suite (A/B/C/D/E angles); fails-on-revert anchor 8d0b201e47a96f41af78483c2ded318515fa6622` (exit 0).

### Fails-on-revert proof (commit `8d0b201e4`)

```
# 1) FIX present:
$ node ./src/components/__tests__/NotificationsSheet.orch1336.tester-adversarial.test.tsx
PASS ORCH-1336 tester adversarial suite (A/B/C/D/E angles); fails-on-revert anchor 8d0b201e47a96f41af78483c2ded318515fa6622
EXIT=0

# 2) REVERT product source to pre-fix:
$ git checkout 8d0b201e4~1 -- app-mobile/src/components/NotificationsSheet.tsx
$ node ./src/components/__tests__/NotificationsSheet.orch1336.tester-adversarial.test.tsx
AssertionError [ERR_ASSERTION]: A1: offline banner must be the intrinsic offlineBanner View itself
  (style + testID co-located), NOT nested in a flex:1 wrapper
  expected: /<View\s+style=\{styles\.offlineBanner\}\s+testID="notifications-offline-banner-wrap">/
REVERT_EXIT=1

# 3) RESTORE fix:
$ git checkout 8d0b201e4 -- app-mobile/src/components/NotificationsSheet.tsx
$ node ./src/components/__tests__/NotificationsSheet.orch1336.tester-adversarial.test.tsx
PASS ORCH-1336 tester adversarial suite (A/B/C/D/E angles); fails-on-revert anchor 8d0b201e47a96f41af78483c2ded318515fa6622
RESTORE_EXIT=0
```

On revert, A1 fires first; B1 (notificationsBody re-enters the flex:1 owner set), B2 (renderBody references `styles.notificationsBody`), and C1 (no bare `return null;`) also fail. **Fails-on-revert proven at `8d0b201e4`.**

---

## 4. CI machinery verification

| Check | Command | Result |
|-------|---------|--------|
| Strict-grep guard (live) | `node .github/scripts/strict-grep/orch-1336-notifications-top-align.mjs` | **exit 0** — C1–C5 all OK |
| Guard self-test | `… --self-test` | **PASS (10/10 cases)** |
| Implementor happy-path guard | `node app-mobile/src/components/__tests__/NotificationsSheet.orch1336.test.tsx` | **PASS (6 assertions), exit 0** |
| CI job wired | `orch-1336-notifications-top-align` in `.github/workflows/strict-grep-mingla-business.yml` (lines 4278–4289) | present — checkout + setup-node 20 + self-test step + live gate step |
| Tree cleanliness | `git status --short` | only the new untracked adversarial test (+ this report) — no product/existing-test/guard file touched |

---

## 5. Simulator visual check — attempted, honestly capped

- iOS simulator **iPhone 17 Pro Max (iOS 26.4) is booted**; `app-mobile` is Expo `~54.0.34` (needs a dev build — native gorhom, not Expo Go).
- **Blocker (Seth-gated):** the NotificationsSheet is only reachable behind an authenticated **LIVE-prod** consumer session with notifications present (Home → bell). Account login on LIVE prod is a Seth-gated step not completable autonomously in this session. Starting a long-running Metro on 8094 would only reach a login wall (no evidence value) and risks the shared-Metro-cache hazard.
- Per the honest-cap norm I did **NOT fabricate a visual pass.** With the OLD code the first section header sat mid-sheet at ANY notification count; with the fix it hugs the top under the "Mark all as read / Clear all" row — so a Seth eyeball at any populated state distinguishes old vs new.
- **Cap:** source-model reasoning + CI guard + fails-on-revert raise the STRUCTURAL claim to **PROVEN**; the PIXEL claim stays at **deferred/CONFIRM-on-device** pending a Seth login.

---

## 6. Verdict

**CONDITIONAL PASS** — conditions: (1) the layout fix is structurally proven correct across all 6 states by source-model reasoning + the CI strict-grep guard (live exit 0 + self-test 10/10) + this adversarial test's fails-on-revert + the implementor's happy-path guard; (2) the only unmet item is the on-device/sim pixel eyeball confirming the first section header hugs the top under the action row, which requires a Seth-gated LIVE-prod authenticated login — recommend a single Seth on-device glance (Home → bell, any populated state) at merge/OTA time to lift the pixel claim to CONFIRMED. No defects found. No product code, existing tests, or the implementor's guard were modified.
