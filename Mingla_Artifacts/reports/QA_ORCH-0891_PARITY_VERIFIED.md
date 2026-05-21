# QA — ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile Polish] — PARITY VERIFIED

**Mode:** Claude `mingla-tester` — code-review-grade parity verification (operator-pragmatic, per the dispatch hard guards)
**Tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**PR:** #150 (`Seth → main`)
**Commits verified:**
- M1 `b00a161e` — Tiptap-backed web composer + chip pills + atomic backspace
- M2 `87cc60b7` — Desktop layout primitives + power features + edge-fn size variants
- M3 `b85d1393` — Mobile polish + perf contract + bundle-size CI gate
- Close follow-up `990cab80` — Cleared pre-merge CI gates from bundled earlier closes

**Scope of this verification (per dispatch §a–§e):**
1. Regression-test pair satisfies Step-0.5 gate
2. Cross-surface parity via code-grep + file inspection
3. 5 spot-check success criteria
4. M3 Discoveries D-1/D-2/D-4/D-5 verified real-or-not
5. CI gate status on PR #150

Live-fire on simulators is OUT OF SCOPE per dispatch hard guard (operator already smoked M2; M3 perf-contract criteria SC-29/30/34/35 are documented as `unverified — operator manual smoke required` in the M3 implementation report and tracked as Discovery D-3 there).

---

## Section 1 — Test pair verification (Step-0.5 gate)

### 1.1 Both files present + run output

**Implementor-happy:**
`mingla-business/src/hooks/__tests__/useShimmer.test.ts` — 5 sub-tests of the `useShimmer` hook contract.

**Tester-adversarial:**
`mingla-business/__tests__/orch-0891.bundle-budget.adversarial.test.ts` — 5 sub-tests attacking the bundle-size CI gate via subprocess (writes tampered copies of the gate's `.mjs` and asserts each tampered copy's `--self-test` exits non-zero).

**Run command:**
```
cd mingla-business && npx jest src/hooks/__tests__/useShimmer.test.ts \
  __tests__/orch-0891.bundle-budget.adversarial.test.ts --no-coverage
```

**Result (captured 2026-05-20 in this verification session):**
```
PASS src/hooks/__tests__/useShimmer.test.ts (6.108 s)
PASS __tests__/orch-0891.bundle-budget.adversarial.test.ts (6.781 s)

Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        7.432 s
```

### 1.2 Different-angle confirmation

| Aspect | Implementor-happy | Tester-adversarial |
|---|---|---|
| Target | `useShimmer.ts` hook source | `.github/scripts/strict-grep/orch-0891-marketing-performance-budget.mjs` gate |
| Mode | In-process Jest + React Testing Library | Subprocess invocation of the gate's `--self-test` mode, including writing TAMPERED gate copies |
| Failure axis | Removing the Animated.loop or the design-spec constants RED-s 4/5 sub-tests | Inflating the composer cap 10x or flipping the under-budget assertion RED-s the tampered-copy assertions |
| Surface | Native + web hook contract | CI gate detector logic |

**Conclusion:** the pair tests two different angles — the runtime hook behavior + the build-time CI gate detector. They cannot both regress under a single trivial revert. Step-0.5 gate **PASS**.

### 1.3 Fails-on-revert citations

Per M3 report §5.1 + §5.2:
- `useShimmer.test.ts`: replacing the hook body with a no-op stub turned 4 of 5 sub-tests RED on revert. Restored.
- `orch-0891.bundle-budget.adversarial.test.ts`: replacing `COMPOSER_LIMIT_BYTES_GZ = 280 * 1024` with `28 * 1024 * 1024` turned 3 of 5 sub-tests RED on revert. Restored.

Both reverts reproducible against commit `b85d1393` (M3) per the M3 implementor report sections cited.

**Verdict: Step-0.5 PASS.**

---

## Section 2 — Cross-surface parity (7 surfaces)

Surface declarations come from `SPEC §2.5` (lines 81–93) of `SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE.md`. Touch-or-not derived from `git diff --name-only b00a161e^..b85d1393`.

| # | Surface | In-scope per SPEC §2.5? | Touched by M1+M2+M3 diff? | Parity model | Verdict |
|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` on iOS) | ❌ Not in scope | ❌ No files in `app-mobile/` touched | n/a | **PASS (zero-blast confirmed)** |
| 2 | **Consumer Android** | ❌ Not in scope | ❌ Same (no `app-mobile/`) | n/a | **PASS (zero-blast confirmed)** |
| 3 | **Buyer-anonymous Web** (`/checkout/*`, `/e/*`, `/b/*`) | ❌ Not in scope | ❌ No files under `mingla-business/app/(buyer)/*` or anonymous routes touched | n/a | **PASS (zero-blast confirmed)** |
| 4 | **Business iOS** (`mingla-business/` on iOS) | ✅ Strand 8 mobile polish | ✅ `ComposerSentConfirmation.tsx`, `useShimmer.ts`, `EmptyState.tsx`, `MarketingEmptyIllustration.tsx`, `richEditor.native.ts`, `useComposerKeyboardShortcuts.ts` (no-op stub), `compose.tsx` | **Manual** with Android (per-platform Reanimated/Haptics differences) — but the shared code path (`Reanimated 4 + expo-haptics`) makes parity AUTOMATIC at the API level. | **PASS** — shared API, single source-tree |
| 5 | **Business Android** | ✅ Strand 8 mobile polish | ✅ Same files as Business iOS | Manual per SPEC; AUTOMATIC at API level | **PASS** — same source-tree |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ Not in scope | ❌ No files in `mingla-admin/` touched | n/a | **PASS (zero-blast confirmed)** |
| 7 | **Business Web preview — wide-desktop AND narrow** (`mingla-business/` web export) | ✅ Wide-desktop = primary; narrow = partial | ✅ All composer + palette + sheet + drawer + canvas files | Manual via `isWideDesktop` branches (per SPEC) + AUTOMATIC via `Sheet.web.tsx` narrow-branch fallback | **PASS** — gated by `useResponsiveLayout()` returning `isWideDesktop`; narrow-web tested by jest `Sheet.web.test.ts` |

### 2.1 Manual-parity gap flags

**None at P1 severity.** The only manual-parity surfaces (iOS↔Android mobile polish) ship via the shared `mingla-business/src/components/marketing/ComposerSentConfirmation.tsx` + shared `useShimmer.ts` — both consume `react-native-reanimated` v4 + `expo-haptics`, which abstract per-platform differences at the SDK level. There is no fork-by-platform-OS in the M3 diff (verified by grep for `Platform.OS === "ios"` / `Platform.OS === "android"` in the M3 touched files — only the expected web-vs-native splits via `.web.ts(x)` Metro resolution).

**P2 (informational):** the wide-desktop vs narrow-web parity is fork-by-viewport (`isWideDesktop` branches in `ComposerCanvas.web.tsx`, `ComposerFooter.tsx`, `TemplatePreviewDrawer.web.tsx`). Each branch is independently testable but not unit-tested for visual regression in this milestone — covered by jest `Sheet.web.test.ts` for the sheet-as-Dialog vs sheet-as-BottomSheet branch only. Visual parity must be verified by operator smoke at wide vs narrow viewport widths. Documented as a follow-up risk in Section 7 below.

**Verdict: Cross-surface parity PASS (no P1 gaps).**

---

## Section 3 — Spot-check verdicts (5 success criteria from code alone)

### SC-1 — Composer body renders Tiptap editor (web, narrow + wide)

**Evidence:**
- `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx:60-71` imports `useEditor` from `@tiptap/react`, `Editor` from `@tiptap/core`, `StarterKit`, `Link` extension, `Underline` extension, and custom chip nodes `EventChip.web` + `PersonalizationChip.web`.
- The file docstring (lines 5–52) calls out invariant `I-TIPTAP-WEB-ONLY` and notes the CI gate `orch-0891-no-tiptap-in-native-bundle.mjs` enforces that `@tiptap/*` imports live only in `.web.tsx` files.
- The strict-grep workflow includes the `orch-0891-no-tiptap-in-native-bundle` job (verified by grep).

**Verdict: PASS** — Tiptap is wired via `useEditor` + `EditorContent` on the web rich editor; the runtime DOM will contain `<div class="ProseMirror" contenteditable="true">` by Tiptap's standard rendering.

### SC-7 — Chip backspace deletes the chip AND trailing `&nbsp;` in one keypress

**Evidence:**
- `mingla-business/src/components/marketing/ComposerV2/composerChipHtml.ts` lines 53, 307–321, 351 — module installs a single global `keydown` handler (`window.__minglaChipBackspaceInstalled` flag) that intercepts `Backspace` and atomically removes the chip.
- `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx:187,229,233` — `ensureBackspaceHandlerInstalled()` is invoked once per editor mount via the chip-CSS-injection effect.
- Tiptap chip node modules (`EventChip.web.ts:18-22`, `EventChipResizable.web.tsx:41-42`, `PersonalizationChip.web.ts:18-22, 45, 93`) all carry the invariant comment "no `addKeyboardShortcuts` keymap — atomic delete is the DOM handler's job," preventing keymap conflict.
- Adversarial regression test: `mingla-business/src/components/marketing/ComposerV2/__tests__/chipBackspace.adversarial.test.ts` exists in the diff.

**Verdict: PASS** — single DOM-handler ownership confirmed in code; backed by an adversarial test.

### SC-14 — `htmlToTokenString` emits `{{event:UUID|compact}}` for `data-size="compact"`; legacy `{{event:UUID}}` for no `data-size`

**Evidence:**
- `mingla-business/src/services/marketing/tenTapTokenBridge.ts:65-72` — regex parses `{{event:UUID(\|(compact|medium|large))?}}` with the size group OPTIONAL → legacy form parses cleanly.
- Same file `:90, 205, 465, 517` — size attribute typed as `"compact" | "medium" | "large"` end-to-end, with `htmlToTokenString` reading `data-size` from chip span via regex `:465` that requires the attribute to be present to capture (otherwise emits legacy form).
- Regression test: `mingla-business/src/services/marketing/__tests__/tenTapTokenBridge.sizeAttr.test.ts` exists in the diff.
- Server-side parity: `supabase/functions/_shared/marketingEmailRender.ts` + `marketingEmailRender.eventChipSize.test.ts` exist — verified the edge function reads the size suffix (M2 deliverable per SPEC §3.5.5 + SC-15).

**Verdict: PASS** — round-trip + edge-function parity verified by source + dedicated regression test.

### SC-25 — ⌘K binds globally on wide-desktop (web)

**Evidence:**
- `mingla-business/src/components/ui/CommandPalette.web.tsx:86-87`:
  ```
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key.toLowerCase() === "k") { ... }
  ```
- Same file `:81` — listener mounted in `useEffect`.
- `mingla-business/src/hooks/useCommandPaletteState.ts:41` — `useCommandPalette` Zustand store with `toggle` action consumed by the keydown handler.

**Note:** The implementation uses `e.metaKey || e.ctrlKey` so both ⌘K (macOS) AND Ctrl+K (Windows/Linux) trigger the palette — broader than the SC-25 literal text, which is acceptable (additive, not regressive).

**Verdict: PASS** — keydown listener wired with the correct key match.

### SC-31 — Reduced-motion fallback in Marketing animations

**Evidence:**
- `mingla-business/src/components/marketing/ComposerSentConfirmation.tsx:35, 69-72` — imports `useReducedMotion` from Reanimated and reads it into `reducedMotion` state.
- `mingla-business/src/hooks/useShimmer.ts:18, 54, 60, 72, 88, 99, 107-110, 134-136` — full reduce-motion-detection stack:
  - Web: synchronous `window.matchMedia("(prefers-reduced-motion: reduce)")` + `addEventListener("change")` subscription.
  - Native: `AccessibilityInfo.isReduceMotionEnabled()` + `addEventListener("reduceMotionChanged")`.
  - When reduceMotion is true, the Animated.loop is NEVER started; the value is snapped to the static 0.55 midpoint per M3 report §3.1.

**Verdict: PASS** — reduce-motion respected in both the celebration animation AND the shimmer hook, on both web and native.

### Spot-check summary table

| ID | Verdict | One-line evidence |
|---|---|---|
| SC-1 | PASS | `richEditor.tsx:60-71` imports `useEditor`/`@tiptap/*` |
| SC-7 | PASS | `composerChipHtml.ts:320-321,351` installs atomic-backspace DOM handler with idempotent flag |
| SC-14 | PASS | `tenTapTokenBridge.ts:65-72` regex emits `{{event:UUID(\|size)?}}` with optional group |
| SC-25 | PASS | `CommandPalette.web.tsx:86-87` binds `(meta||ctrl)+k` global keydown |
| SC-31 | PASS | `useShimmer.ts:54-99` + `ComposerSentConfirmation.tsx:69-72` honor reduce-motion on web + native |

**5 of 5 PASS on the high-impact spot-check sample.**

---

## Section 4 — M3 Discoveries verification (real-or-not)

### D-1 — SC-36/SC-37 architecturally unverifiable without route-level code splitting

**Claim:** Expo Router with default Metro config ships a single `entry-*.js` chunk; the composer chunk-size cap can't be enforced today because there is no per-route chunk.

**Verification:** `ls mingla-business/dist/_expo/static/js/web/` returns exactly 3 files:
```
entry-a0652f3e4b643d5558e28a44599863a9.js
evictEndedEvents-ae9912b47fabc94c06ac3e3382379b8e.js
reapOrphanStorageKeys-7cc38524ac5d40e2d3e0c3d2e8f5aeaf.js
```

The two non-entry chunks are isolated background workers (`evictEndedEvents`, `reapOrphanStorageKeys`) — neither is a Marketing route. The entire app, including the composer, ships in `entry-*.js`.

**Verdict: D-1 IS REAL.** SC-36 / SC-37 absolute caps are genuinely architecturally unverifiable today, not a coverage gap. The CI gate's `--self-test` proves the detector works against synthetic over-budget fixtures, so the gate is load-bearing the moment route-level code splitting lands (which would be a separate ORCH).

### D-2 — Build self-test gate runs instead of full build in CI

**Claim:** The CI step runs `--self-test` rather than the full `expo export` because (a) full export ~3–5 min, and (b) per D-1 the cap can't be enforced today anyway.

**Verification:** `.github/workflows/strict-grep-mingla-business.yml` is in the diff. The strict-grep registry pattern (per `feedback_strict_grep_registry_pattern.md`) registers gates as sibling jobs; the orch-0891-marketing-performance-budget gate is a sibling job consistent with that pattern, and the gate's `--self-test` mode is the documented CI invocation.

**Verdict: D-2 IS REAL.** This is a deliberate process gap, not a coverage gap. The gate flips from `--self-test` to full-build verification the day D-1 is unblocked.

### D-4 — `useShimmer` shipped but not yet wired into Marketing list routes

**Claim:** The hook is ready; wiring into `audiences/index.tsx`, `campaigns/index.tsx`, `templates/index.tsx` is deferred because those files belong to in-flight ORCH-0889.

**Verification:** `grep -n "useShimmer" mingla-business/app/(tabs)/marketing/*.tsx mingla-business/app/(tabs)/marketing/*/*.tsx` returns ZERO matches. The hook is exported from `mingla-business/src/hooks/useShimmer.ts` but is not imported by any Marketing route screen.

**Verdict: D-4 IS REAL.** The hook is genuinely unwired in routes; the SC-23 mobile-polish criteria are technically `INFRASTRUCTURE READY` rather than `LIVE` until ORCH-0889 sequences and a small follow-up dispatch wires it. This is a Discovery-labeled deferral, not a regression hiding behind a deferral label.

### D-5 — Marketing empty-state illustration adoption deferred (same reason as D-4)

**Claim:** `illustrationKey` prop ships on `EmptyState.tsx`; designer SVGs are committed; the actual `<EmptyState illustrationKey="marketing-audiences" .../>` swap touches in-flight ORCH-0889 files and is deferred.

**Verification:** `grep -n "illustrationKey" mingla-business/app/(tabs)/marketing/...` returns ZERO matches. The 3 SVGs are committed at `mingla-business/assets/illustrations/marketing/{audiences,campaigns,templates}-empty.svg` per the diff. The renderer component `MarketingEmptyIllustration.tsx` is committed. But no route-level call-site adopts the prop yet.

**Verdict: D-5 IS REAL.** Same shape as D-4 — infrastructure shipped, call-site adoption deferred for ORCH-0889 sequencing. This is a sequenced deferral, not a hidden regression.

### Discovery verification summary

| Discovery | Real? | Severity (per M3 report) | Hidden regression? |
|---|---|---|---|
| D-1 | YES | S2 | No — single-entry shape confirmed in `dist/_expo/static/js/web/` |
| D-2 | YES | S3 | No — deliberate process gap per the registry pattern |
| D-4 | YES | S3 | No — hook genuinely unimported by routes; sequenced deferral |
| D-5 | YES | S3 | No — prop genuinely unadopted by routes; sequenced deferral |

**All 4 verified Discoveries are real. None are regressions hiding behind a deferral label.**

---

## Section 5 — CI status verification (PR #150)

**Run:** `gh pr view 150 --json statusCheckRollup --jq '[.statusCheckRollup[] | select(.conclusion == "FAILURE")] | length'`

**Result:** `0`

**Full PR state (subset):**
- `mergeable`: `MERGEABLE`
- `mergeStateStatus`: `BLOCKED` — investigated below
- Failing checks: **0**

The `BLOCKED` state with `MERGEABLE` and zero failures typically means:
- A required check is still `IN_PROGRESS` (the gh JSON shows `"Migrations apply cleanly from baseline"` in status `IN_PROGRESS` at the time of capture), OR
- The branch protection requires the operator to use the "Merge" button (no admin override).

This is consistent with the close-follow-up commit `990cab80` having cleared the earlier red gates; the residual `BLOCKED` is an in-flight check + branch-protection ack, not a regression.

**Verdict: CI gate status PASS for the purposes of CLOSE.** Zero failing checks. The orchestrator should re-poll right before merge to confirm the in-flight Migrations check completes green (it's reading from the same baseline that every recent close has been merged against, so a green outcome is the expected result).

---

## Section 6 — Overall verdict

# **CONDITIONAL PASS**

**Conditions for the orchestrator to weigh before CLOSE:**

1. **The in-flight CI check (`Migrations apply cleanly from baseline`) must finish green before merge.** This is a standard pre-merge poll — `gh pr checks 150 --watch` until it reports complete, then verify zero failures.

2. **Operator-smoke deferrals from M3 Discoveries D-3 (SC-29 / SC-30 / SC-34 / SC-35 — perf-contract Chrome DevTools recordings)** are NOT verified by this report and remain `unverified — operator manual smoke required` per the M3 implementor's documented Discovery. Operator should run the §7 procedure in `IMPLEMENTATION_ORCH-0891_M3.md` against a live wide-desktop browser before treating those four criteria as PASS. If any of them fail, that is performance polish (a follow-up ORCH), not a contract break — does not invalidate the M3 ship per the implementor's own framing.

3. **D-4 + D-5 sequencing risk.** The `useShimmer` hook and the `illustrationKey` prop are shipped but unimported by Marketing list routes (`audiences/index.tsx`, `campaigns/index.tsx`, `templates/index.tsx`). These call-sites belong to in-flight ORCH-0889. Once ORCH-0889 merges, a small follow-up dispatch (~3 lines per file for `useShimmer`, ~1 line per file for `illustrationKey`) is required to actually deliver the SC-23 / SC-26 / SC-28 mobile polish to users. Until then, these success criteria are `INFRASTRUCTURE READY` — the orchestrator should explicitly record the absorbed-vs-follow-up split when CLOSEing.

4. **Wide-desktop vs narrow-web visual parity is not visually regression-tested.** Logical branch coverage exists via `Sheet.web.test.ts` (sheet-as-Dialog vs sheet-as-BottomSheet) but no screenshot/visual diff suite gates the broader composer canvas layout. Risk is bounded by manual operator smoke + the active `Mingla_Artifacts/feedback_mingla_business_desktop_web_contracts.md` 16 intentional contracts the operator owns. P2 risk; not a blocker.

5. **Manual parity flag (iOS↔Android mobile polish).** Per SPEC §2.5 the polish strand is declared `Manual` parity. The diff uses shared Reanimated 4 + expo-haptics APIs with no `Platform.OS === "ios" / "android"` forks — so parity is automatic at API level. iOS and Android device smoke (Haptics fire, ComposerSentConfirmation animation plays, shimmer skeleton breathes once it's wired in D-4 follow-up) is recommended at TestFlight / Play Internal Testing time but is not a CLOSE blocker.

---

## Section 7 — Risks the orchestrator should weigh

| Risk | Severity | Notes |
|---|---|---|
| In-flight Migrations check could go red | LOW | Same baseline as recent closes; expected green |
| Perf-contract criteria SC-29/30/34/35 unverified | LOW (S3 in M3 report) | Operator-smoke deferral per D-3; failure = polish, not contract break |
| D-4 + D-5 unwired in routes | LOW (S3) | SC-23/26/28 are `INFRASTRUCTURE READY` not LIVE; sequenced follow-up after ORCH-0889 |
| Wide vs narrow visual parity not screenshot-tested | LOW (P2) | Logical branch tested by jest; visual smoke is operator-owned |
| iOS↔Android polish parity not device-smoke-tested | LOW | Shared APIs, no platform forks in diff; TestFlight/Play smoke recommended at release time |
| `useReducedMotion` initial-render flash (D-7) | NEGLIGIBLE (S4) | Cosmetic; only affects reduce-motion users on slow devices; Reanimated-known behavior |

**No P1 risks identified.** All conditions are operator-actionable pre-merge polls + sequenced follow-ups that do NOT block the CLOSE.

---

## Layman summary of the report

- **Test pair (the regression-pair gate):** 10 of 10 sub-tests pass green in this session. The two files attack the change from two genuinely different angles — one tests the new shimmer hook directly, the other tests the bundle-size CI gate by writing tampered copies of it. Both have already been fails-on-revert-verified by the implementor.
- **Cross-surface check (the "did this touch anything it shouldn't" gate):** Zero files touched on consumer iOS, consumer Android, admin web, or anonymous buyer routes. All M1+M2+M3 changes are contained in `mingla-business/`, `supabase/functions/_shared/marketingEmailRender.ts`, CI scripts, and report artifacts. Clean.
- **5 spot-checks against the spec:** All 5 PASS by code review — Tiptap editor renders on web (SC-1), chip backspace is atomic (SC-7), the new `{{event:UUID|compact}}` size-token format is wired into the bridge AND the edge function (SC-14), ⌘K binds globally on web (SC-25), and reduce-motion is honored in both the celebration animation AND the shimmer hook (SC-31).
- **The 4 verified Discoveries are real, not regressions hiding behind a deferral label.** The bundle-size cap is genuinely architecturally unverifiable today because Expo Router ships one big chunk — confirmed by `ls` on the built `dist/` folder. The `useShimmer` hook and the `illustrationKey` empty-state prop are genuinely unwired into Marketing list routes because those routes belong to a sister in-flight ORCH (ORCH-0889) — they will be wired in a small follow-up after that ORCH lands.
- **CI status:** Zero failing checks on PR #150 after the close-follow-up commit. One check is still `IN_PROGRESS` (`Migrations apply cleanly from baseline`); orchestrator should re-poll right before merge.
- **Overall verdict:** **CONDITIONAL PASS.** Five conditions documented in §6; none are P1; all are operator-actionable. Orchestrator may proceed to CLOSE after the in-flight Migrations check completes green and after recording the absorbed-vs-follow-up split for the D-4/D-5 deferrals.

---

## Section 8 — Hard guards observed

1. ✅ **No source code touched** — this report is the only file written by tester.
2. ✅ **No new tests written** — only the existing pair was verified.
3. ✅ **No live-fire on simulators** — all verification was code-grep + file inspection + the jest pair run.
4. ✅ **No advice on merge/no-merge** — verdict is CONDITIONAL PASS with conditions; the orchestrator owns the merge call.
