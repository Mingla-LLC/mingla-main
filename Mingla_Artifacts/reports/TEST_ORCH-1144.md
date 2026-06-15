# QA — ORCH-1144 Universal Experience-Create Chooser

**Skill:** mingla-tester · **Phase:** TEST · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1144-[universal-experience-chooser]`
**Branch:** `orch-1144-universal-experience-chooser`
**Commits under test:** `beac378e4` (code) · `c75eb633e` (report/artifacts) · `036e4d2be` (tester adversarial test, added this pass)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md`
**IMPLEMENT:** `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1144.md`

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 1 (CI merge-blocker, trivial fix) · P2: 0 · P3: 0 · P4: 2 (praise) · Discoveries: 2.

Tier 1 (code/static) is fully GREEN: typecheck/lint clean on all touched files, every load-bearing
strict-grep gate passes (i37/i38/i39 + ve5/ve6 jwt + no-brand-kind + topsheet + creator-instant +
sibling-scrollview), the contract test passes with an independently-reproduced fails-on-revert, my
own adversarial test (different angle) passes with its own fails-on-revert, the full jest suite shows
**zero new regressions** vs origin/main, and **SC-13-Web PASSES** — the web `expo export` succeeds and
the ORCH-1083 `__common` budget gate is GREEN (`__common` = **1,955,795 bytes / 1.87 MB**, under the
2.25 MB cap; initial payload 2.96 MB under the 9.4 MB ceiling).

The single P1 is a **CI append-only gate failure** caused by the override token living in the code
commit `beac378e4` but the branch HEAD being the later report commit `c75eb633e` (the gate reads
`git log -1`). The fix is mechanical (re-assert the token on HEAD / in the squash-merge body); the
test mutations themselves are legitimate and correct.

Tier 2 (on-device Android) is **BLOCKED → "suspected"** for the runtime UI claims: the physical
Samsung's business dev build red-boxes at boot on current-main JS with `Cannot find native module
'ExpoImageManipulator'` (ORCH-1119 `expo-image-manipulator` native module absent from the device's
dev binary). This is **NOT an ORCH-1144 defect** (it's in untouched trip/image files and reproduces
on origin/main), but it prevents reaching the chooser, so the on-device chooser/sheet/bleed/buttons
checks could not be runtime-proven. They are verified statically only.

Because the one P1 is documented and trivially fixable and the only thing capping a full PASS is an
**environment** blocker (not a product defect), this is a CONDITIONAL PASS with two conditions (§9).

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|---|---|---|---|
| SC-1 | +→Create experience opens the 3-option chooser (not manual wizard) | PASS (static+export) / suspected (device) | `UniversalCreatorSheet.tsx:77` route=`/experience/choose`; `choose.tsx` mounts chooser `visible`; my adversarial test angle C asserts it + fails-on-revert. Device boot-blocked. |
| SC-2 | Chooser shows exactly 3 rows, flat, every brand (any/null category) | PASS (static) | `ExperienceCreateChooser.tsx:61-89` `OPTIONS` = fixed 3-row const, no conditional render, no `venueCategory` read. Contract test asserts 3 testIDs. |
| SC-3 | "Snap a food menu" → Ve5, parseMode="menu", sheet auto-opens | PASS (static) | `OPTIONS[0].route="/experience/snap?mode=menu"`; `snap.tsx:94-98` coerces mode→menu + `MenuSnapInput`; `snapSheetVisible` default true (`:107`). |
| SC-4 | "Snap an activities menu" → Ve6, parseMode="activities" | PASS (static) | `OPTIONS[1].route="?mode=activities"`; `snap.tsx:96-98` → `activities` + `ActivitiesSnapInput`. |
| SC-5 | "Build it yourself" → /experience/create unchanged | PASS (static) | `OPTIONS[2].route="/experience/create"`; `create.tsx` UNTOUCHED (not in diff). |
| SC-6 | Tab: NO banner; 4 pills + bucketed rows matching Trips | PASS (static) / suspected (device) | `experiences.tsx` rebuilt to trips skeleton; pills All/Upcoming/Past/Drafts (`:215-223`); banner gone; contract test asserts no "Snap your menu" banner. |
| SC-7 | Empty state COPY §4 + CTA opens chooser | PASS (static) | `experiences.tsx:306-329` empty `GlassCard`; "New experience" → `router.push("/experience/choose")`. |
| SC-8 | creative_and_arts/null brand reaches BOTH parsers (was stranded) | PASS (static) | NO category gate in chooser or snap route; my adversarial test angle B asserts snap parseMode is URL-param-derived only, never `.venueCategory`. |
| SC-9 | Long-press multi-select + bulk delete of drafts still works | suspected (device) | Multi-select half kept verbatim (`experiences.tsx:178-206,332-378`, `useDraftMultiSelect`/`useDiscardOfferingDrafts`/`DraftSelectBar`/`ConfirmDialog`). Static parity confirmed; runtime drive boot-blocked. |
| SC-10 | No dead taps — each row routes to a real destination | PASS (static) | My adversarial test (angle A) statically resolves all 3 route literals to real route files on disk (`choose.tsx`/`snap.tsx`/`create.tsx` exist). |
| SC-11 | Prices remain currency-aware | PASS (static) | Rendered via unchanged `ExperienceListCard` → `formatCurrency`; no new price surface in the diff. |
| SC-12-Android | Chooser opaque Android fill, overflow:'hidden', no Android shadow | PASS (static) / suspected (visual) | `ExperienceCreateChooser.tsx:160-174` opaque hex Android fills (`#23262b`/`#2c2f35`, no rgba), `:207` `overflow:'hidden'`, ZERO `shadowColor`/`elevation`. Visual confirm device-blocked. |
| SC-13-Web | expo export succeeds + under __common budget; chooser+snap render | **PASS (runtime)** | `npm run web:export` EXIT=0; `orch-1083-initial-bundle-budget.mjs` PASS — initial 2,959,941 B (ceiling 9,405,478), 135 chunks, 0 deferred leaks, `__common` 1,955,795 B < 2,250,000 cap. `choose`/`snap` emitted as separate route chunks. |

Source-only SCs are capped at the evidence stated. SC-13-Web is the only UI-adjacent SC with full
runtime proof (via the export artifact). SC-1/6/9/12 device-runtime proof is blocked (§7).

---

## 3. Findings

### P1-1 — Append-only CI gate FAILS in the merge state (override token not on HEAD)

- **Evidence:** `GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` → exit 1, 3
  violations (`hubExperiences.contract.test.ts` −14 lines, `canGenerateExperiencesFromActivities.test.ts`
  −42, `canGenerateExperiencesFromMenu.test.ts` −42). The gate reads the override token via
  `git log -1` (test-append-only-check.js:153-156 `latestCommitBody`). Branch HEAD is `c75eb633e`
  (report/artifacts commit) whose body has NO `[TEST-MOD-APPROVED ORCH-1144]`; the token lives one
  commit down in `beac378e4`. The implementor's report §6 claim "Append-only gate: PASSES" was true
  at `beac378e4` but became false once the report commit landed on top without the token.
- **Impact:** the `tests-append-only.yml` CI job will be RED on the PR → blocks merge. (On a real PR
  the gate diffs `origin/main...HEAD` and still uses `git log -1` for the token — HEAD lacks it.)
- **Required fix:** ensure the override token `[TEST-MOD-APPROVED ORCH-1144]` plus the bracketed label
  `ORCH-1144 [universal experience-create chooser]` appear in the HEAD commit body at merge time —
  either (a) amend/reword the report commit `c75eb633e` to carry the token, or (b) the closer ensures
  the squash-merge PR title/body carries it (squash uses the PR body as the commit body). No source
  change needed. NB: my newly-added adversarial test commit `036e4d2be` is now HEAD — its body also
  lacks the token, so this must be handled on whatever lands as the final HEAD/squash body.
- **Retest:** `GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` → exit 0.

### P4-1 (praise) — Fails-on-revert genuinely holds on a real source revert
Re-introducing the deleted `venueCategory` router into `experiences.tsx` flips the contract test red
on the exact assertion (`not.toMatch(/venueCategory === "restaurant"/)`); restoring → green. The
implementor's claim was reproduced 1:1.

### P4-2 (praise) — Surgical shared-component change
The `UniversalCreatorSheet` change is a single route literal (`/experience/create` → `/experience/choose`);
the event and trip rows are untouched; the parity references `trips.tsx`/`events.tsx` are not in the
diff. Clean A1 wiring per SPEC §4.4 — zero per-consumer churn across the ~5 `+`-sheet mount points.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- **PASS on current code** (`c75eb633e`): `npx jest hubExperiences.contract` → 4 passed / 4.
- **Revert** (temporary source edit re-introducing `__revertProbeParseModeForBrand` with
  `b.venueCategory === "restaurant" ? "menu" : b.venueCategory === "play" ? "activities" : "none"`
  into `experiences.tsx`, NOT the test): `npx jest hubExperiences.contract` → **1 failed / 3 passed**;
  failing assertion = `expect(source).not.toMatch(/venueCategory === "restaurant"/)` at line 33.
- **Restore**: probe removed, working tree clean (`grep -c __revertProbe` = 0) → 4 passed / 4.

Confirmed: the implementor's happy-path contract test fails-on-revert. Verified at `c75eb633e`.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/app/experience/__tests__/orch1144Chooser.tester.adversarial.test.ts`
- **Commit:** `036e4d2be` (on-branch; in `git diff origin/main...HEAD --name-only`).
- **Angle (vs implementor's source-grep contract):**
  - (A) **Dead-tap resolution** — parses each `route:` literal out of the chooser `OPTIONS` and stats
    the destination route file on disk (a typo'd/unregistered route would pass the implementor's
    testID grep but white-screen at runtime).
  - (B) **Category-agnostic parse mode** — asserts `snap.tsx` derives `parseMode` SOLELY from the URL
    `mode` param and never from `.venueCategory` (the stranded-brand SC-8 invariant, at the snap route
    rather than the tab).
  - (C) **Entry-point wiring** — asserts `UniversalCreatorSheet` routes the experience row to
    `/experience/choose`, not the pre-1144 `/experience/create`.
- **Result:** 8 passed / 8.
- **fails-on-revert verified at `036e4d2be`:** reverting `UniversalCreatorSheet` route back to
  `/experience/create` flips angle C red (`1 failed / 7 passed`); restore → 8/8.
- Both the implementor's happy-path test AND this adversarial test appear in the closing diff.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | All 3 chooser routes resolve to real route files (adversarial angle A); empty-CTA → `/experience/choose` (real). |
| 2 | One owner per truth | PASS | `parseMode` owned solely by the URL param at the snap route; no competing brand-derived writer. |
| 3 | No silent failures | PASS | `snap.tsx:122-141` parse error/empty → sets toast + resets phase (no swallowed catch); bulk-delete keeps the ORCH-1123 toast tally. |
| 4 | One query key per entity | N/A | No new query keys; reuses `useExperiencesByBrand`/`usePendingExperiences`. |
| 5 | Server state stays server-side | PASS | No Zustand server-state added; local `useState` only for UI phase/toast/visibility. |
| 6 | Logout clears everything | N/A | No new persisted/auth state. |
| 7 | Label [TRANSITIONAL] + exit | PASS | No transitional code; revert probe removed before commit (grep 0). |
| 8 | Subtract before adding | PASS | Deleted 2 predicate utils + the banner + category router + `coming-soon.tsx`. |
| 9 | No fabricated data | PASS | Counts/buckets derived from real `useExperiencesByBrand` data; empty states honest. |
| 10 | Currency-aware | PASS | Prices via unchanged `ExperienceListCard`/`formatCurrency`. |
| 11 | One auth instance | N/A | No auth surface touched (chooser is founder-only behind existing gate). |
| 12 | Validate at the right time | N/A | No datetime validation in scope. |
| 13 | Exclusion consistency | PASS | Bucket logic mirrors `deriveTripFilterBucket`; draft/past/upcoming consistent. |
| 14 | Persisted-state startup gate | N/A | No new persisted state. |

Zero constitutional violations.

---

## 7. Device / parity matrix

| Surface | Result | Notes |
|---|---|---|
| Consumer iOS (`app-mobile/`) | N/A | Not shipped here (parsers business-only); zero files. |
| Consumer Android | N/A | Same. |
| Buyer/anon Web | N/A | Founder-only create flow; not shipped here. |
| Business iOS | suspected | Shared RN code; no iOS device driven this pass (Android device was the dispatch target). Static + web-export evidence applies. |
| Business Android (physical Samsung SM-A725F, R58R54YV7JT) | **BLOCKED → suspected** | App red-boxes at boot: `Cannot find native module 'ExpoImageManipulator'` (`normalizeTripDayImage.ts:34` → trip wizard → `edit.tsx:40`, eager route-tree registration). Pre-existing ORCH-1119 native/JS drift; reproduces on origin/main; NOT an ORCH-1144 file. Could not reach the chooser to runtime-verify sheets/bleed/buttons/loading. Evidence: screenshots 01-08 in `Mingla_Artifacts/evidence/ORCH-1144/`. |
| Admin Web | N/A | Unchanged. |
| Business Web preview (adjacent) | **PASS (export)** | `expo export -p web` EXIT=0 + ORCH-1083 budget GREEN; `choose`/`snap` route chunks emitted. SC-13-Web. |

**On-device drive log (Samsung SM-A725F):**
1. `adb devices` → `R58R54YV7JT device` (SM-A725F, samsung, screen awake). Business dev build
   `com.sethogieva.minglabusiness` installed (versionCode 4, 2026-06-15 18:04).
2. Started Metro from the worktree on :8085 (`npx expo start --dev-client --port 8085`,
   isolated `TMPDIR`); `packager-status:running` confirmed; `adb reverse tcp:8085 tcp:8085`.
3. Launched dev build via `exp+mingla-business://expo-development-client/?url=http://localhost:8085`
   (corrected scheme after `exp+minglabusiness` failed) → Status: ok, MainActivity, bundle 4777 modules.
4. Screens 01-03: dev menu → Mingla Business splash → **sign-in screen** (not signed in on device) with
   a red toast `Cannot find native module 'ExpoImage…'`.
5. Relaunch → screen 06: **hard red-box Uncaught Error `Cannot find native module 'ExpoImageManipulator'`**,
   unrecoverable (re-throws on every render via eager route registration). Dismiss/Minimize do not clear it.
6. No newer dev-build APK available locally to sideload.

**Tester HITL note:** the chooser sits behind the sign-in gate AND behind the native-drift boot crash.
Even with sign-in credentials, the boot red-box blocks the app on current-main JS until the business
dev client is natively rebuilt (`eas build`) to include `expo-image-manipulator`. This needs Seth.

---

## 8. Tier-1 command log (cited)

- **Babel install (CI parity):** `npm install --no-save @babel/parser @babel/traverse` at worktree repo
  root (CI installs the same; the worktree repo-root had no node_modules).
- **tsc:** `npx tsc --noEmit` → 323 errors, **0 in any ORCH-1144 touched file** (all in untouched
  `packages/*` + checkout buyer screens — matches origin/main baseline).
- **eslint:** `npx eslint <5 touched files>` → exit 0.
- **Strict-grep (all exit 0):** `i37-topbar-cluster`, `i38-icon-chrome-touch-target`, `i39-pressable-label`
  (4 INFO in untouched `VenueStep4Hours.tsx`), `orch-0861-sibling-scrollview-flexgrow-zero` (my new
  files NOT flagged), `meta-orch-0972-no-brand-kind-reads`, `meta-orch-0972-data-driven-tabs`,
  `i-ve5-parse-menu-user-jwt-only`, `i-ve6-parse-play-user-jwt-only`, `i-proposed-topsheet-web-viewport-anchor`,
  `i-proposed-creator-entry-is-instant`. (No ORCH-1144-specific strict-grep gate exists — the
  fails-on-revert contract test is the structural guard.)
- **jest (targeted):** `hubExperiences.contract` 4/4, `canGenerateExperiencesFromMenu`/`...Activities`
  guards pass, `globalSearch` (3 suites) pass.
- **jest (full suite):** branch = **85 failed suites / 156 failed tests** ; origin/main baseline (temp
  worktree) = **85 failed suites / 156 failed tests** ; clean (timing-stripped) suite-list diff =
  **ZERO new failing suites on the branch**. All 85 failures are pre-existing repo rot (missing
  `@testing-library/react-native`, `@mingla/payments-native`, `packages/*` react types).
- **web export:** `npm run web:export` EXIT=0 (after installing the stale-node_modules deps
  `lucide-react@0.577.0` [ORCH-1137] + `expo-image-manipulator` [ORCH-1119], both declared in
  package.json but absent from the shared anchor node_modules — environment, not ORCH-1144).
- **budget gate:** `node scripts/ci/orch-1083-initial-bundle-budget.mjs` → PASS; `__common` = **1,955,795 B**.

---

## 9. Accepted conditions (CONDITIONAL PASS)

1. **P1-1 append-only token on HEAD** — the closer MUST ensure `[TEST-MOD-APPROVED ORCH-1144]` +
   `ORCH-1144 [universal experience-create chooser]` are in the final HEAD/squash-merge commit body,
   then confirm `GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` exits 0.
2. **Tier-2 device runtime** — the on-device chooser/sheet/bleed/buttons/loading + multi-select
   (SC-1/6/9/12 device proof) remain **suspected**, blocked by the ORCH-1119 `expo-image-manipulator`
   native-drift boot crash. Either (a) Seth/closer natively rebuilds the business dev client and drives
   the chooser once, or (b) accept the static + web-export evidence and verify on the OTA dev channel
   post-merge. Track the native-drift crash separately (Discovery 1) — it blocks ALL current-main
   on-device business QA, not just ORCH-1144.

---

## 10. Discoveries for Orchestrator (NOT fixed here)

1. **ORCH-1119 native/JS drift — `expo-image-manipulator` missing from the device dev build AND from
   the shared anchor `node_modules`.** `normalizeTripDayImage.ts:34` does `import * as ImageManipulator
   from "expo-image-manipulator"` (eager, top-level) reached via the trip wizard / `app/trip/[id]/edit.tsx`
   route registration. The dep IS declared in `mingla-business/package.json` (`~14.0.8`) but was absent
   from the installed node_modules (had to be installed to make the web export succeed), and the native
   module is absent from the physical device's dev binary → **hard red-box at boot on current-main JS**.
   This blocks ALL on-device business-app QA until the dev client is natively rebuilt. Same story for
   `lucide-react@0.577.0` (ORCH-1137) missing from node_modules. Likely the shared anchor node_modules
   is stale / iCloud-churned. Recommend: refresh anchor `npm ci` + rebuild the business dev client.
2. **Pre-existing jest failures (85 suites / 156 tests) on origin/main** — missing test-time modules
   (`@testing-library/react-native`, `@mingla/payments-native`) and `packages/*` react types. Includes
   4 `eventType.filter.audit.test.ts` failures (publicEventsService/tripsService/ExperienceCheckoutFlow)
   confirmed identical on origin/main. Unrelated to ORCH-1144 but pollutes every QA run.

---

## 11. Routing

CONDITIONAL PASS with two documented conditions (§9). Because condition 1 (the append-only token) is
unaccepted-by-dispatch, per the gate this surfaces to Seth/closer rather than auto-routing to CLOSE:
fix the token on HEAD (mechanical), then this is a clean PASS pending the Tier-2 device run (or its
explicit deferral to the OTA dev channel). No product-code REWORK required.
