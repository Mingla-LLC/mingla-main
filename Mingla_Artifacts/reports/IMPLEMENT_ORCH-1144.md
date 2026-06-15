# IMPLEMENTATION — ORCH-1144 Universal Experience-Create Chooser

**Skill:** mingla-implementor · **Phase:** IMPLEMENT · **Date:** 2026-06-15
**Branch:** `orch-1144-universal-experience-chooser`
**Worktree:** `~/Desktop/mingla-orchs/orch-1144-[universal-experience-chooser]`
**Commit:** `beac378e4`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md`
**Status:** implemented and verified (web `expo export` budget = implemented, unverified — CI/tester step).

---

## 1. Summary

Restructured experience creation in the Mingla **business** app. The top-bar **+** → **Create experience**
now opens a **3-option chooser** — *Snap a food menu* (Ve5), *Snap an activities menu* (Ve6), *Build it
yourself* (manual wizard) — shown **flat, equal, and unconditionally to every brand** (no `venueCategory`
gating, no verification gating). `parseMode` is chosen explicitly by the user's pick, never inferred from
the brand. The category router + the `canGenerateExperiences*` predicates are deleted, so brands previously
stranded (`creative_and_arts` / null category) now reach BOTH parsers. The Hub Experiences tab is rebuilt to
full parity with the Trips tab (4 filter pills + All/Upcoming/Past/Drafts buckets + per-filter empty states),
the "Snap your menu" banner is gone, and the dead `coming-soon.tsx` route is deleted. Pure-JS RN → OTA-shippable.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Result | Commit |
|---|---|---|---|---|
| SC-1 | +→Create experience opens the 3-option chooser (not the manual wizard directly) | UniversalCreatorSheet experience row route `/experience/create` → `/experience/choose`; choose route mounts the chooser | ✓ implemented | beac378e4 |
| SC-2 | Chooser shows exactly 3 rows, flat order, for EVERY brand (any/null category, any verification) | `OPTIONS` is a fixed 3-row const, no conditional render, no `venueCategory` read (grep ZERO) | ✓ implemented; contract test asserts 3 testIDs | beac378e4 |
| SC-3 | "Snap a food menu" → Ve5 menu snap, `parseMode="menu"`, sheet auto-opens, review via ExperienceReviewCards | Row routes `/experience/snap?mode=menu`; snap.tsx coerces mode→`menu`, `snapSheetVisible` defaults true, MenuSnapInput + ExperienceReviewCards | ✓ implemented | beac378e4 |
| SC-4 | "Snap an activities menu" → Ve6, `parseMode="activities"`, same review path | Row routes `?mode=activities`; snap.tsx → `activities` + ActivitiesSnapInput | ✓ implemented | beac378e4 |
| SC-5 | "Build it yourself" → `/experience/create` (manual wizard) unchanged | Row routes `/experience/create`; create.tsx untouched (DO-NOT-TOUCH respected) | ✓ implemented | beac378e4 |
| SC-6 | Tab renders NO banner; 4 pills (All/Upcoming/Past/Drafts) + bucketed rows, matching Trips | Rebuilt to trips.tsx skeleton; desktopWebLayoutContracts "four-column grids" test passes | ✓ implemented | beac378e4 |
| SC-7 | Empty state COPY §4 headline+body; CTA opens the chooser | `No experiences yet` + COPY §4 body; "New experience" → `/experience/choose` | ✓ implemented | beac378e4 |
| SC-8 | `creative_and_arts`/null brand reaches BOTH parsers (was stranded) | No category gate anywhere in the create surface (grep ZERO); chooser unconditional | ✓ implemented (adversarial: tester to drive on device) | beac378e4 |
| SC-9 | Long-press multi-select + bulk delete of DRAFT experiences still works | Multi-select/manage half kept verbatim (useDraftMultiSelect/useDiscardOfferingDrafts/DraftSelectBar/ConfirmDialog) | ✓ implemented (runtime drive = tester) | beac378e4 |
| SC-10 | No dead taps — each of the 3 rows routes to a real destination | snap?mode=menu / snap?mode=activities / create — all real routes | ✓ implemented | beac378e4 |
| SC-11 | Prices remain currency-aware | Rendered via unchanged ExperienceListCard → formatCurrency; no new price surface | ✓ implemented | beac378e4 |
| SC-12-Android | Chooser sheet + rows use opaque Android glass fallback (no translucent fill, overflow:'hidden', no Android shadow) | Rows use `Platform.select` opaque Android fills (`#23262b`/`#2c2f35`), `overflow:'hidden'`, no shadow; TopSheet itself already opaque-fallback via `shouldUseRealBlur` | ✓ implemented (visual confirm on Android emulator = tester) | beac378e4 |
| SC-13-Web | `expo export` (web) succeeds under ORCH-1083 `__common` budget; chooser+snap render in business web preview | No new deps / no barrel imports (grep ZERO `import * as`/lucide/tiptap); ESLint clean | implemented, **unverified** — full `expo export` web build + budget gate must run in CI/tester | beac378e4 |

---

## 3. Files changed

| Status | Path | Δ |
|---|---|---|
| A | `mingla-business/src/components/experience/ExperienceCreateChooser.tsx` | +257 (new) |
| A | `mingla-business/app/experience/choose.tsx` | +56 (new) |
| A | `mingla-business/app/experience/snap.tsx` | +296 (new) |
| M | `mingla-business/app/(tabs)/hub/experiences.tsx` | rebuilt (672 → ~540 lines; banner + category router + predicates removed, Trips pill/bucket skeleton added) |
| M | `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` | +9/−2 (experience route → `/experience/choose` + docblock) |
| M | `mingla-business/app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts` | rewritten to fails-on-revert guard |
| M | `mingla-business/src/utils/__tests__/canGenerateExperiencesFromMenu.test.ts` | rewritten to "predicate util is gone" existence guard |
| M | `mingla-business/src/utils/__tests__/canGenerateExperiencesFromActivities.test.ts` | rewritten to "predicate util is gone" existence guard |
| D | `mingla-business/src/utils/canGenerateExperiencesFromMenu.ts` | deleted (one-line `venueCategory==="restaurant"` gate) |
| D | `mingla-business/src/utils/canGenerateExperiencesFromActivities.ts` | deleted (one-line `venueCategory==="play"` gate) |
| D | `mingla-business/app/experience/coming-soon.tsx` | deleted (dead route, no live nav; Seth-approved) |

Net: 11 files, +971 / −577.

---

## 4. Data-model changes applied

None. Front-end-only change. No migrations, no schema, no RLS, no edge functions.

---

## 5. Edge functions touched

None. `parse-restaurant-menu` and `parse-play-activities` are DO-NOT-TOUCH and were not edited (their
`verify_jwt` values are preserved by non-action). The Ve5/Ve6 user-JWT strict-grep gates still pass.

---

## 6. Regression tests added / rewritten

**Happy-path regression (implementor-owned):** `mingla-business/app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts`
— rewritten from the deleted-branch assertion into the inverse fails-on-revert guard:
- create surface has NO `venueCategory === "restaurant"/"play"` branch and NO `canGenerateExperiencesFrom` import;
- the tab is a pilled list (`flexGrow: 0`, `pillsScroll`, no "Snap your menu to generate experiences" banner);
- the chooser exposes all 3 options unconditionally (`?mode=menu`, `?mode=activities`, the 3 testIDs) and never branches on `venueCategory`.

Plus two predicate existence guards (`canGenerateExperiencesFrom*.test.ts`) asserting the deleted utils stay gone.

**fails-on-revert verified at `beac378e4`.** Method = true line-addition of the deleted category router into
`experiences.tsx` (a temporary `[ORCH-1144-DIAG]` probe re-introducing `b.venueCategory === "restaurant" ? "menu" : b.venueCategory === "play" ? "activities" : "none"`):
- with the probe present → `hubExperiences.contract.test.ts` **FAILED** (1 failed / 3 passed; `expect(source).not.toMatch(/venueCategory === "restaurant"/)` at line 33 fired).
- probe removed → **PASSED** (3 suites / 6 tests green).

All 6 tests pass on the committed code.

**Append-only gate:** PASSES (`GITHUB_BASE_REF=main node .github/scripts/test-append-only-check.js` → 3 modified
test files with the `[TEST-MOD-APPROVED ORCH-1144]` override token; ZERO test-file deletions — the deleted
predicate utils are NOT test files).

---

## 7. Old → New receipts

### app/(tabs)/hub/experiences.tsx
**Before:** `HubExperiencesRoute` branched on `currentBrand.venueCategory` — `restaurant`→Ve5 (`canGenerateExperiencesFromMenu` gated the snap banner), `play`→Ve6, `creative_and_arts`/else→a placeholder with only a manual "Create experience" button (no snap path at all). Hosted the banner CTA + the whole parse/review machinery (`ExperienceGenerationSurface`) inline; flat single ScrollView, no filter pills.
**Now:** One unconditional component. No `venueCategory` branch, no `canGenerate*` predicate, no banner. Trips-style 4-pill (All/Upcoming/Past/Drafts) + bucketed list + per-filter empty states; empty CTA "New experience" → `/experience/choose`. The multi-select/manage/share/list half is kept verbatim. The parse/review machinery moved to the new `/experience/snap` route.
**Why:** SC-2/SC-6/SC-7/SC-8; I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC; banner removal.
**Lines:** ~540 (rebuilt from 672).

### src/components/experience/ExperienceCreateChooser.tsx (NEW)
**Before:** did not exist.
**Now:** TopSheet `heightMode="compact"` modeled on `UniversalCreatorSheet`; 3 fixed `Pressable` rows (food/activities/manual) with icons (`flash`/`list`/`sparkle`), title+helper, `chevR`, `accessibilityRole/Label/Hint`, 44×44 icon wrap, testIDs `experience-chooser-{food,activities,manual}`. handleSelect → onClose + setTimeout(50) → route. Title "Create An Experience" (Seth override); COPY §1/§2 recommended-primary strings.
**Why:** SC-1/SC-2/SC-10/SC-12-Android.
**Lines:** +257.

### app/experience/choose.tsx (NEW)
**Before:** did not exist.
**Now:** host route (A1) — mounts `ExperienceCreateChooser` `visible` true, `onClose` = `router.back()` (falls back to `/(tabs)/hub/experiences`). Single navigable destination for both entry points.
**Why:** SPEC §4.4 A1; SC-1.
**Lines:** +56.

### app/experience/snap.tsx (NEW)
**Before:** did not exist (parse/review lived inline in experiences.tsx).
**Now:** reads `useLocalSearchParams<{ mode?: string }>()`, coerces to explicit `parseMode` (`activities` else `menu`), selects MenuSnapInput/ActivitiesSnapInput + COPY §3 food/play headers + toasts; auto-opens the snap sheet on mount; parse spinner + ExperienceReviewCards; confirm of the last proposal → back to `/(tabs)/hub/experiences`; cancel-before-pick with nothing under review → back.
**Why:** SC-3/SC-4; SPEC §4.2 relocation contract.
**Lines:** +296.

### src/components/ui/UniversalCreatorSheet.tsx
**Before:** experience option `route: "/experience/create"` (straight to manual wizard).
**Now:** `route: "/experience/choose"` + docblock updated.
**Why:** the single-point hook (SPEC §4.4 A1) — covers every `+` surface at once.
**Lines:** +9/−2.

### Predicate utils + their tests
**Before:** `canGenerateExperiencesFromMenu/Activities.ts` were one-line `venueCategory ===` category gates; their unit tests asserted category equality.
**Now:** source utils deleted; tests rewritten to assert the util files no longer exist (fails-on-revert if re-added).
**Why:** SPEC §8 step 6; the gate was a pure category router, not a money/trust gate (investigation Q5).

### app/experience/coming-soon.tsx
**Before:** dead placeholder route (no live nav; markets an unshipped flow).
**Now:** deleted.
**Why:** Open Question #1 → DELETE (Seth-approved); Constitution #8 subtract. Verified ZERO live `push/replace` references.

---

## 8. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS (`app-mobile/`) | NO | unchanged | — (parsers business-only) |
| Consumer Android | NO | unchanged | — |
| Buyer/anon Web | NO | unchanged | — (founder-only create flow) |
| Business iOS | YES | +→Create experience opens 3-option chooser; both parsers reachable; tab is a pilled list, no banner | shared RN |
| Business Android | YES | same as iOS; chooser rows use opaque Android glass fallback | shared RN, **manual** glass delta (implemented; visual confirm = tester) |
| Admin Web | NO | unchanged | — |
| Business Web preview (adjacent) | YES | same RN-web path; chooser + snap render via RN-web; snap uses web-aware browserFilePicker | shared RN-web, **manual** export verify (CI/tester) |

---

## 9. Gates run (real output)

- **TypeScript (`npx tsc --noEmit`):** ZERO errors in any ORCH-1144-touched file (grep of the touched filenames against the error stream = empty). The 323 pre-existing repo errors are all in untouched files (checkout buyer screens, marketing ComposerV2, missing `@testing-library/react-native` / `@mingla/payments-native` modules, packages/brand-rendering missing react types) — not introduced by this ORCH.
- **ESLint (`npx eslint <touched files>`):** exit 0, clean.
- **Jest — contract + predicate tests:** 3 suites / 6 tests PASS.
- **Jest — desktopWebLayoutContracts "four-column desktop grids" (reads experiences.tsx):** PASS (rebuilt tab keeps the desktop grid contract).
- **Strict-grep gates run locally:** `orch-0861-sibling-scrollview-flexgrow-zero` (informational; my files NOT flagged — `flexGrow: 0` present), `i-ve5/i-ve6 parse user-jwt-only` OK, `meta-orch-0972-no-brand-kind-reads` OK, `i-proposed-creator-entry-is-instant` OK (4 create.tsx scanned, 0 violations), `i-proposed-topsheet-web-viewport-anchor` OK.
- **Append-only gate:** PASS (3 modified test files w/ token; 0 deletions).

**Unrun gates (state for orchestrator/CI):**
- `i38-icon-chrome-touch-target.mjs` / `i39-pressable-label.mjs` — could not run locally (`ERR_MODULE_NOT_FOUND: @babel/parser` not installed in this worktree root; CI installs it). My rows/pills all carry `accessibilityRole` + `accessibilityLabel` and ≥44pt targets by construction, so they pass by inspection — CI must confirm.
- `expo export` (web) + the ORCH-1083 `__common` 2.25MB budget gate (SC-13-Web) — heavy build; not run locally. No new deps / no barrel imports introduced, so impact is a few KB. Must run in CI/tester.

---

## 10. Smoke result

No simulator/device drive performed in this pass (source + jest + grep verification only). Runtime drive
(iOS sim + Android emulator + business web export) is the tester's job. All routes are real and wired
(grep-proven no dead taps); the parse/review machinery is the same code that shipped under META-ORCH-1059,
relocated unchanged.

---

## 11. Known issues / deferred

- **SC-13-Web unverified** — full `expo export` web build + budget gate must run in CI/tester (no new deps; low risk).
- **Android glass + multi-select runtime** — implemented to policy/spec; visual + interaction confirmation on a physical Android device is the tester's adversarial step.
- No `[TRANSITIONAL]` code introduced. The temporary fails-on-revert probe was removed before commit (grep ZERO `ORCH-1144-DIAG`/`__revertProbe`).

---

## 12. Operator action required

- **Migration `db push`:** none (no migrations).
- **Edge-fn deploy:** none.
- **OTA (at CLOSE, post-merge):** this is pure-JS RN → OTA the business `development`/`production` channels per the EAS OTA gotchas. Heed COMMS-0027 (cache poisoning): clean detached checkout, isolated `TMPDIR`, per-platform, `--clear-cache`. Runtime biz 1.0.0.
- **CI must run** the `i38`/`i39` strict-grep gates and the `expo export` web budget gate (could not run locally — see §9).

---

## 13. Discoveries for Orchestrator

1. **SPEC §8 step 6 (DELETE the two predicate unit tests) conflicts with the hard `tests-append-only.yml` gate**, which forbids ALL test-file deletions with NO override token. Reconciled WITHOUT deviating from SPEC intent: kept the two predicate `.test.ts` files and **rewrote** them (modification-with-deletions, covered by `[TEST-MOD-APPROVED ORCH-1144]`) into existence-guards that assert the deleted predicate source utils stay gone. The predicate **source** utils (not test files) were deleted as the SPEC directs. Append-only gate verified green. Flagging so the SPEC's "delete the tests" wording can be reconciled at CLOSE.
2. **`I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC`** is DRAFT — orchestrator flips it ACTIVE at CLOSE.
3. **COMMS-0027 / COMMS-0028** (OTA cache poisoning / GIPHY key in OTA) are open `ALL`-WARN entries relevant at the OTA/deploy stage — carry to the closer.
4. **No comms-ledger entry written** — no cross-ORCH discovery during this implementation.
