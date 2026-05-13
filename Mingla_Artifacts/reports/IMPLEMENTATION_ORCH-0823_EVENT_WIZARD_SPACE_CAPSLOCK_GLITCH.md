# IMPLEMENTATION — ORCH-0823 — Event Wizard `Big␣P` Autocorrect Glitch Fix

**Skill:** Claude `mingla-implementor` (parity-mirror execution; canonical IMPLEMENT owner is Codex `implementor-mingla` — operator redirected to Claude for this run).
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH.md`
**Evidence (pre-implementation, live-fire on broken build):** `Mingla_Artifacts/evidence/ORCH-0823/`
**Status:** implemented, partially verified — code gates PASS (tsc, lint, jest 24/24, SC-6 sanity), live-fire on patched build is OUTSTANDING and is the TEST-mode job.

---

## Layman summary

Three files changed: `Input.tsx` (refactored to import VARIANT_BEHAVIOUR from a new pure-data sibling), `Input.variants.ts` (new sibling — holds the variant table with explicit `autoCorrect: false` for every variant and explicit `autoCapitalize` per variant), and `CreatorStep1Basics.tsx` (Description raw `<TextInput>` now declares the same flags explicitly). One new test file (`Input.variantBehaviour.test.tsx`) plus a `test:orch-0823` package.json script enforce that no variant ever silently reverts to inheriting iOS defaults. All 26 `<Input variant="text">` call-sites across mingla-business inherit the fix without per-site edits. Code gates pass; live-fire on the patched dev build is the next step.

---

## Pre-flight verification

- Spec read, all 9 success criteria captured.
- Investigation read; confidence label `proven`; mechanism Path B (autocorrect) confirmed by operator's live-fire reproduction with `r-4-after-P.png` + `r-6-no-capslock.png` evidence already in the repo.
- Repo test convention confirmed: `__tests__/` co-located, `@jest/globals` imports, `npm run test:orch-XXXX` per-ORCH script convention.
- Repo lint/typecheck convention: `npm run lint` (`expo lint`), `npx tsc --noEmit`.
- Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` confirmed via `git status`.
- No DB / edge function / RLS / migration impact; spec hard guards observed.

---

## Old → New Receipts

### `mingla-business/src/components/ui/Input.variants.ts` (NEW)

**What it did before:** Did not exist.
**What it does now:** Exports `InputVariant` (string-literal union), `VariantBehaviour` (Pick from `TextInputProps`), and `VARIANT_BEHAVIOUR` (the variant table). Every variant declares both `autoCorrect: false` and `autoCapitalize` explicitly. Documentation comment cites ORCH-0823 and the regression-test path.
**Why:** Spec component-layer change #1. Variant table extracted so the ORCH-0823 regression test can import the data from the node test environment without pulling JSX into the module graph (ts-jest with `jsx: "react-native"` preserves JSX rather than transforming it).
**Lines:** 60 new (single-purpose file).

### `mingla-business/src/components/ui/Input.tsx`

**What it did before:**
- Declared `InputVariant`, `VariantBehaviour`, and `VARIANT_BEHAVIOUR` inline (lines 342-377).
- `VARIANT_BEHAVIOUR.text` was `{}`, inheriting RN platform defaults (`autoCorrect=true`, `autoCapitalize="sentences"` on iOS).
- Several other variants (`phone`, `number`, `password`) had partial declarations; for example `phone` set `keyboardType` and `autoComplete` but no `autoCapitalize` / `autoCorrect`.

**What it does now:**
- Imports `VARIANT_BEHAVIOUR`, `InputVariant`, and `VariantBehaviour` from the new `./Input.variants` sibling (top-level import).
- Re-exports the same three names for backwards compatibility with any call-site that imported them from `"./Input"`.
- No JSX or rendering-logic changes; the component still spreads `{...behaviour}` onto the inner `<TextInput>` at line 654 (now shifted by the import diff but functionally identical).

**Why:** Spec component-layer change #2. Centralises the fix and makes the data testable. Re-exports preserve backwards compatibility (no call-site updates required).
**Lines:** ~33 lines removed (inline declarations), ~12 lines added (import + re-export block).

### `mingla-business/src/components/event/CreatorStep1Basics.tsx`

**What it did before:** The Description multi-line `<TextInput>` (lines 191-206 pre-edit) declared `value`, `onChangeText`, `onFocus`, `placeholder`, `placeholderTextColor`, `multiline`, `numberOfLines`, `textAlignVertical`, `style`, `accessibilityLabel` — no `autoCorrect` / `autoCapitalize` overrides. iOS platform defaults applied.

**What it does now:** Same field, now also declares `autoCorrect={false}` and `autoCapitalize="sentences"` with an inline rationale comment citing ORCH-0823. No other props changed; multi-line layout and scroll-to-bottom behaviour preserved.
**Why:** Spec component-layer change #3. The Description field is a raw `<TextInput>`, not an `<Input variant="text">` consumer, so it does not inherit the centralised fix and must declare flags directly. Same Path B autocorrect mechanism would apply if a user typed `Big␣P` in the description.
**Lines:** 5 lines added (2 props + 3-line comment), 0 removed.

### `mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx` (NEW)

**What it did before:** Did not exist.
**What it does now:** 24 assertions across 6 variants (`text`, `email`, `phone`, `number`, `password`, `search`). For each variant, asserts: (a) entry exists, (b) `autoCorrect` declared explicitly with a boolean value, (c) `autoCapitalize` declared explicitly with one of the four valid values, (d) `autoCorrect === false`. Imports from `./Input.variants` (pure-data file) so the test runs in the node Jest environment without a React Native renderer.
**Why:** Spec component-layer change #4 — regression prevention. Fails if any variant regresses to `{}` or omits either flag.
**Lines:** 70 new.

### `mingla-business/package.json`

**What it did before:** Had per-ORCH test scripts up to `test:orch-0786`.
**What it does now:** Adds `"test:orch-0823": "npx jest Input.variantBehaviour.test"` after `test:orch-0786`. Matches existing repo convention (per-ORCH script names, `npx jest <pattern>` invocations).
**Why:** Implementation-order step #5 — provides the standard invocation the operator and tester will use to verify SC-5 (regression test passes) and SC-6 (regression test catches revert).
**Lines:** 1 line added.

---

## Spec traceability — success criteria

| SC | Description | Status | Verification |
|----|-------------|--------|--------------|
| SC-1 | Operator's `Big␣⇪P` reproducer produces `Big P` with space preserved, no autocorrect bubble | UNVERIFIED — needs TEST-mode live-fire on patched build | Code-level: `autoCorrect: false` is set on `text` variant; mechanism (Path B) is fully gated by this flag per investigation. |
| SC-2 | No-caps-lock control `Big␣P` produces same correct result | UNVERIFIED — needs TEST-mode live-fire | Same gating as SC-1. |
| SC-3 | Description field passes the same test | UNVERIFIED — needs TEST-mode live-fire | Code-level: explicit `autoCorrect={false}` set on Description raw `<TextInput>`. |
| SC-4 | Step 3 venue field passes | UNVERIFIED — needs TEST-mode live-fire | Step 3 fields are `<Input variant="text">` consumers; inherit centralised fix. |
| SC-5 | `VARIANT_BEHAVIOUR` regression test passes | **PASS** | `npm run test:orch-0823` → 24/24 tests pass. Output captured below. |
| SC-6 | Regression test FAILS when `text` variant is reverted to `{}` | **PASS** | Sanity-check executed: temporarily reverted `text: { autoCorrect: false, autoCapitalize: "sentences" }` to `text: {}` via perl in-place edit, ran the test, observed 3 tests fail (autoCorrect-declared, autoCapitalize-declared, autoCorrect-is-false), restored the fix, re-ran test → 24/24 pass. |
| SC-7 | TypeScript compiles clean | **PASS** | `npx tsc --noEmit` → zero new errors. |
| SC-8 | No new lint errors | **PASS** | `npm run lint` → zero new errors. One new warning at `Input.tsx:52` (same `import/first` class as four pre-existing baseline warnings at lines 36, 46, 47, 48). No new errors. |
| SC-9 | First-letter auto-capitalize still works on Event name | UNVERIFIED — needs TEST-mode live-fire | Code-level: `autoCapitalize: "sentences"` is preserved on `text` variant. |

Summary: SC-5, SC-6, SC-7, SC-8 verified at code-gate level by the implementor. SC-1, SC-2, SC-3, SC-4, SC-9 require simulator live-fire and are the TEST-mode job — the patched dev build needs to be rebuilt + reinstalled (see "Test first" in chat output).

### Test output (SC-5)

```
PASS  src/components/ui/__tests__/Input.variantBehaviour.test.tsx
  Input VARIANT_BEHAVIOUR — ORCH-0823 regression
    variant: text
      ✓ entry exists
      ✓ declares autoCorrect explicitly
      ✓ declares autoCapitalize explicitly
      ✓ autoCorrect is false (Mingla policy — no near-miss substitutions)
    variant: email
      ✓ entry exists
      ✓ declares autoCorrect explicitly
      ✓ declares autoCapitalize explicitly
      ✓ autoCorrect is false (Mingla policy — no near-miss substitutions)
    variant: phone
      ✓ entry exists
      ✓ declares autoCorrect explicitly
      ✓ declares autoCapitalize explicitly
      ✓ autoCorrect is false (Mingla policy — no near-miss substitutions)
    variant: number
      ✓ entry exists
      ✓ declares autoCorrect explicitly
      ✓ declares autoCapitalize explicitly
      ✓ autoCorrect is false (Mingla policy — no near-miss substitutions)
    variant: password
      ✓ entry exists
      ✓ declares autoCorrect explicitly
      ✓ declares autoCapitalize explicitly
      ✓ autoCorrect is false (Mingla policy — no near-miss substitutions)
    variant: search
      ✓ entry exists
      ✓ declares autoCorrect explicitly
      ✓ declares autoCapitalize explicitly
      ✓ autoCorrect is false (Mingla policy — no near-miss substitutions)

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

### Sanity-check output (SC-6) — when text variant is reverted to `{}`

```
FAIL  src/components/ui/__tests__/Input.variantBehaviour.test.tsx
  Input VARIANT_BEHAVIOUR — ORCH-0823 regression
    variant: text
      ✓ entry exists
      ✕ declares autoCorrect explicitly
      ✕ declares autoCapitalize explicitly
      ✕ autoCorrect is false (Mingla policy — no near-miss substitutions)
    [other variants pass]

Test Suites: 1 failed, 1 total
Tests:       3 failed, 21 passed, 24 total
```

Fix was immediately restored after capturing this output; current state is 24/24 pass.

---

## Spec deviations

One deliberate deviation, all other points exact-match:

**Deviation: VARIANT_BEHAVIOUR was extracted to a new sibling file `Input.variants.ts`** instead of being kept inline in `Input.tsx` with an `export` keyword added.

- **Spec said:** Implementor adds `export` to the `VARIANT_BEHAVIOUR` const in `Input.tsx` so the test can import it.
- **Why deviated:** ts-jest's `jsx: "react-native"` config option **preserves** JSX (does not transform it). The repo's existing test suite runs in `testEnvironment: "node"` (per `jest.config.cjs`), which cannot evaluate JSX. Importing `VARIANT_BEHAVIOUR` from a JSX-containing `Input.tsx` triggered `SyntaxError: Unexpected token '<'` from the preserved JSX in the transpiled output (e.g. `<react_native_1.View style={[...`). Mocking the React Native module did not help because the JSX exists at the call-site, not in the imports.
- **Resolution:** Created `Input.variants.ts` (pure-data, type-only RN dependency) as the canonical home for `VARIANT_BEHAVIOUR` / `InputVariant` / `VariantBehaviour`. `Input.tsx` imports from there and re-exports the same names so any existing call-site that imports from `"./Input"` continues to work unchanged. Test imports from `./Input.variants` directly.
- **Spec impact:** Zero functional impact — the variant table contents match the spec exactly; the regression-test contract is satisfied. The file split is a structural detail that keeps the test runnable in the existing repo Jest config.
- **Future implication:** Any future variant addition should go into `Input.variants.ts`, not `Input.tsx`. The leading comment in both files calls this out.

No other deviations.

---

## Invariant verification

| Invariant | Touched? | Preserved? | Notes |
|-----------|----------|-----------|-------|
| I-PROPOSED-J — Zustand persist no server snapshots | N | Y | No state changes. |
| I-38 — IconChrome touch ≥ 44pt | N | Y | No touch-target changes. |
| I-39 — Explicit accessibilityLabel on interactive Pressable | N | Y | Both `Input` and Description `TextInput` already declare `accessibilityLabel` (preserved unchanged). |
| Constitution #1 — No dead taps | N | Y | No tap-handler changes. |
| Constitution #3 — No silent failures | N | Y | No error paths touched. |
| Constitution #8 — Subtract before adding | N/A | Y | The broken empty `{}` for `text` variant was REMOVED before the corrected entries were added. |
| Constitution #9 — No fabricated data | Y | **Strengthened** | Before this fix, iOS autocorrect could substitute "Bigot" for user-typed "Big P", which is data fabrication at the input layer. The fix eliminates that. |
| I-PROPOSED-AD — INPUT-VARIANT-EXPLICIT-FLAGS (new) | Y | N/A (this change ESTABLISHES it) | Backed by `Input.variantBehaviour.test.tsx`. Orchestrator graduates into the registry at CLOSE per spec §"Invariants". |

---

## Parity check

- **Mobile vs business:** Spec explicitly limits scope to `mingla-business/`. `app-mobile/` is out-of-scope; the consumer app's own `Input` primitive (if any) is a sibling-ORCH candidate flagged in Discoveries.
- **Solo vs collab:** Not applicable — this is a generic UI primitive, not a mode-specific feature.
- **iOS vs Android:** The investigation noted iOS as the primary platform where the bug surfaces (autocorrect smart-replacement is iOS-specific). Android does not have the same smart-replacement pipeline, but `autoCorrect=false` + `autoCapitalize="sentences"` are valid and beneficial values on Android too — proper-noun-laden event names should not be autocorrected on either platform. No Android-specific code was added; the fix is platform-neutral.
- **Component primitive vs consumers:** 26 `<Input variant="text">` consumers across 11 files inherit the centralised fix automatically. No per-site edits performed (spec hard guard).

---

## Cache safety

- No React Query keys changed.
- No Zustand store shape changed.
- No persisted-state shape changed (the wizard's `draftEventStore` still holds `name: string` / `description: string | null` — the fix is purely at the input layer, not state).
- No AsyncStorage migration needed.

---

## Regression surface

The 3-5 adjacent surfaces most likely to break from this change:

1. **Other `<Input variant="text">` call-sites that DEPEND on autocorrect being on.** Audit the 26 consumers for any that ARE prose-style fields where the user expects autocorrect (e.g. a freeform "comment" field). None identified in the enumeration — all 26 are proper-noun fields (event name, venue, address, brand fields, etc.) where autocorrect-off is desirable. Cross-check during TEST mode.
2. **Email / phone / password / number / search variants** — they all gained `autoCorrect: false` explicitly. None of them previously DECLARED `autoCorrect: true`; they inherited the platform default for everything else. Spot-check during TEST mode: sign-in form (email + password), and any search bar (e.g. the country-picker `PickerSearchInput` was already `autoCorrect: false` independently, so it's unchanged).
3. **First-letter auto-capitalize on Event name** — must still work for `slow burn vol. 4` → `Slow burn vol. 4`. Investigation control test was not run for this case; SC-9 covers it in TEST mode.
4. **Description multi-line scroll-to-bottom on focus** — unchanged (`onFocus={scrollToBottom}` preserved). Verify the auto-cap and autocorrect-off behaviour does not interfere with the existing scroll behaviour.
5. **Style-guide page** (`app/__styleguide.tsx`) — uses `<Input variant="text">` in 4 places for visual previews. They'll now have autocorrect off; not a regression, but a visible change. Not user-facing in production.

---

## Constitutional compliance

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| 1 | No dead taps | N/A | No tap handlers touched. |
| 2 | One owner per truth | PASS | `VARIANT_BEHAVIOUR` has one canonical location (`Input.variants.ts`). Re-export from `Input.tsx` is import sugar, not duplication. |
| 3 | No silent failures | PASS | No error paths touched. |
| 4 | One key per entity | N/A | No React Query changes. |
| 5 | Server state server-side | PASS | Zustand untouched; no server data introduced. |
| 6 | Logout clears everything | N/A | No auth changes. |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers added or removed. |
| 8 | Subtract before adding | PASS | Empty `{}` and partial entries replaced with complete entries; old code removed. |
| 9 | No fabricated data | STRENGTHENED | Eliminated iOS autocorrect's near-miss substitution path. |
| 10 | Currency-aware | N/A | No money fields touched. |
| 11 | One auth instance | N/A | No auth changes. |
| 12 | Validate at right time | N/A | No datetime fields touched. |
| 13 | Exclusion consistency | N/A | No serve/generate logic changes. |
| 14 | Persisted-state startup | N/A | No persisted state changes. |

Zero violations.

---

## Lint output summary

Pre-existing baseline (without this change): 5 warnings in `Input.tsx`, all `import/first` or `Unused eslint-disable directive` — both classes triggered by pre-existing code structure (type declarations between import groups, leftover disable directives).

Post-change: 6 warnings in `Input.tsx` (5 pre-existing same lines + 1 new `import/first` at line 52 — my new top-level import block, same root cause as the pre-existing four). Zero new errors. Spec criterion SC-8 ("no new errors") satisfied.

Optional follow-up: refactor `Input.tsx` to move the `type TextInputFocusHandler` / `type TextInputFocusEvent` declarations BELOW all imports — that would eliminate all 5 `import/first` warnings. Out of scope for ORCH-0823 (spec hard guard: only the three named files); flag as a code-hygiene side note for the orchestrator if desired.

---

## tsc output summary

`npx tsc --noEmit` exit code 0, zero errors.

Specifically verified:
- `Input.tsx:370` `variant?: InputVariant` resolves (imported from `./Input.variants`).
- `Input.tsx:509` `const behaviour = VARIANT_BEHAVIOUR[variant];` resolves (imported from `./Input.variants`).
- Re-exports at the type-shape level (`type InputVariant`, `type VariantBehaviour`) pass `tsc --noEmit` cleanly.

---

## Deno gates

N/A. This implementation is pure-client TypeScript. No Supabase edge function code was touched. No Deno gates apply.

---

## Migrations awaiting `supabase db push`

None.

---

## Edge function deploys awaiting authorization

None.

---

## Discoveries for orchestrator (carryover from investigation + new during implementation)

Carryover (from investigation):

1. **Step 3 Where fields share the defect.** Covered by the centralised fix in this implementation.
2. **Potential `app-mobile/` parity.** Operator decides whether to spawn a sibling ORCH.
3. **Cycle 3 spec template gap** — "TextInput contract" checklist should be added to future spec templates.
4. **Tooling: expo run:ios + Xcode 26 devicectl mismatch** — sibling dev-tooling ORCH candidate.
5. **Stale Metro module-graph cache** — onboarding doc note.
6. **Stale dev-build crash class** — OneSignal native module missing on older bundles — onboarding doc note.

New during implementation:

7. **Pre-existing `import/first` lint warnings in `Input.tsx`** (lines 36, 46, 47, 48). Caused by two `type` declarations on lines 33-34 sitting between import groups. ESLint's `import/first` rule wants all imports before any other statements. My new import respects the existing pattern (added at the top imports block) but inherits the same warning. Five-warning total; trivial to clean up by moving the two `type` declarations below all imports. Out of scope for ORCH-0823; flag as a minor code-hygiene side issue.

8. **Pre-existing `Unused eslint-disable directive` warning in `Input.tsx`** (was line 330 in baseline, now line 338 after my changes). Pre-existing leftover; not my code. Quick cleanup candidate.

9. **No repo-wide `test` aggregate script.** Repo uses per-ORCH `test:orch-XXXX` scripts but has no overall `npm test` aggregate. Tester / orchestrator should know to run individual scripts. Not a defect; just an onboarding note.

---

## Transition items

None. The implementation introduces no `[TRANSITIONAL]` markers.

---

## Files modified

```
mingla-business/src/components/ui/Input.tsx                                 (modified)
mingla-business/src/components/ui/Input.variants.ts                         (new)
mingla-business/src/components/ui/__tests__/Input.variantBehaviour.test.tsx (new)
mingla-business/src/components/event/CreatorStep1Basics.tsx                 (modified)
mingla-business/package.json                                                (modified — added test:orch-0823 script)
```

No other files touched. No commits made. No pushes. No PRs. No deploys.

---

## Verification matrix summary

- Code gates: tsc PASS, lint PASS (no new errors), jest 24/24 PASS, SC-6 sanity PASS.
- Live-fire gates: SC-1, SC-2, SC-3, SC-4, SC-9 are TEST-mode responsibilities — patched dev build must be rebuilt + installed on iPhone 17 Pro simulator (UDID `17091E60-C3B6-4167-980D-60C348E177F6`) and the operator's reproducer + controls + Step 3 + Description must be exercised live.
- Per spec §Test cases: T-09 (regression test passes), T-10 (regression test catches revert), T-11 (TS passes) are VERIFIED. T-01 through T-08 and T-12 through T-14 are UNVERIFIED pending TEST-mode live-fire.

**Status: implemented, partially verified.** Code-level gates pass; runtime live-fire is the next dispatch.
