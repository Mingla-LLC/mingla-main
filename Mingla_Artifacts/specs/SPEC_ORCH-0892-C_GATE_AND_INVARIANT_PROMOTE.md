# SPEC — ORCH-0892-C [Strict-grep gate `orch-0892-no-bespoke-keyboard-plumbing` INFORMATIONAL→BLOCK + invariants DRAFT→ACTIVE]

**Author:** Claude `mingla-forensics` (SPEC mode).
**Date:** 2026-05-21.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Pipeline next:** Claude `mingla-implementor`.
**Mode:** mechanical (no INVESTIGATE phase — scope is pure CI/invariant/memory hardening; the architectural pattern was proven by ORCH-0892-A and exhaustively swept by ORCH-0892-B v2).

---

## §0 Phase 0 ingestion (cited evidence)

**Prior ORCH-0892 artifacts (read):**
- [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md`](../reports/INVESTIGATION_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md) — original architecture analysis.
- [`Mingla_Artifacts/specs/SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md`](SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md) — codified `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` DRAFT.
- [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0892-B_v2_GLOBAL_SHIFTER.md`](../reports/INVESTIGATION_ORCH-0892-B_v2_GLOBAL_SHIFTER.md) — library capability assessment + SmartScrollView pattern.
- [`Mingla_Artifacts/specs/SPEC_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md`](SPEC_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md) — codified `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` DRAFT.
- [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md`](../reports/IMPLEMENTATION_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md) — 35-file sweep landed.
- [`Mingla_Artifacts/reports/QA_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE_REPORT.md`](../reports/QA_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE_REPORT.md) — QA verdict + operator 9/9 smoke.

**Live source verified at HEAD on branch `Seth` post-PR-151-merge:**
- `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`: confirmed two `process.exit(0)` sites — line 252 (early PASS branch when warnings.length === 0) which STAYS, and line 277 (final WARN branch) which FLIPS. Header comment at lines 36-38: `**Mode:** INFORMATIONAL (exit 0 always). Promotion to FAIL (exit 1) happens in ORCH-0892-C [gate promotion] after ORCH-0892-B [sweep] removes all current violations.` WARN footer at lines 270-273: `Promotion: this gate currently exits 0 (INFORMATIONAL). ORCH-0892-C [gate promotion] flips it to exit 1 on violation after the sweep clears all current WARN sites.`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` line 3557: `### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (DRAFT — flips ACTIVE on ORCH-0892-C close)` + Status line citing same DRAFT trigger. New `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` entry below it (added by ORCH-0892-B v2 close) with parallel DRAFT + ORCH-0892-C trigger language.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md`: dated 2026-04-30 (pre-ORCH-0892, 14 days stale per system reminder); describes the Cycle 3 wizard root pattern (Keyboard.addListener + dynamic paddingBottom + deferred scrollToEnd) as the canonical approach. This pattern is now FORBIDDEN by the gate's first three patterns and is what the ORCH-0892-B v2 sweep DELETED. Memory file must be rewritten to cite SmartScrollView as the canonical pattern and the now-ACTIVE invariants + BLOCKING gate.

**Gate current behavior (run by spec writer at 2026-05-21):** `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` Exit code 0. The post-sweep state is the only safe moment to flip the gate from INFORMATIONAL to BLOCK without an immediate CI-break.

---

## §1 Goal

Lock in the keyboard-avoidance architectural pattern permanently. Make the cursor-above-but-field-below bug class structurally impossible to reintroduce. Three small flips, no product code touched, no user-visible change.

---

## §2 Cross-Surface Impact (MANDATORY)

| Surface | Touched? | User-visible change | Files touched | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/`) | **NO** | None — CI gate only. | 0 | N/A |
| Consumer Android (`app-mobile/`) | **NO** | None — CI gate only. | 0 | N/A |
| Buyer/anonymous Web | **NO** | None. | 0 | N/A |
| Business iOS (`mingla-business/`) | **NO** | None — invariants are documentation-of-intent + CI enforcement; the actual code behavior was already shipped in ORCH-0892-B v2. | 0 | N/A |
| Business Android (`mingla-business/`) | **NO** | None. | 0 | N/A |
| Admin Web (`mingla-admin/`) | **NO** | None. | 0 | N/A |
| Business Web preview | **NO** | None. | 0 | N/A |

**Affected non-product surfaces:** GitHub Actions CI (gate exit code now blocks PRs); operator memory layer (`feedback_keyboard_never_blocks_input.md` updated so future skill invocations cite the now-canonical pattern); invariant registry (DRAFT → ACTIVE status flip on two entries).

**This SPEC is non-product BACKFILL-EXEMPT** per ORCH-0840 [Regression-test enforcement + append-only CI] — zero diffs in `mingla-business/src/`, `mingla-business/app/`, `app-mobile/`, `mingla-admin/src/`, `supabase/`, `packages/`. Close banner cites the exemption per ORCH-0840.

---

## §3 Database layer

**N/A.** Zero DB / migration / RLS changes.

---

## §4 Edge functions layer

**N/A.** Zero edge function changes.

---

## §5 Services layer

**N/A.** Zero service changes.

---

## §6 Hooks layer

**N/A.** Zero hook changes.

---

## §7 CI gate + invariant + memory layer (the only layer this SPEC touches)

### §7.A Gate script flip — `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`

**Three edits to this single file:**

**Edit 1: Header comment (lines 36-38).** Replace:
```
 * **Mode:** INFORMATIONAL (exit 0 always). Promotion to FAIL (exit 1)
 * happens in ORCH-0892-C [gate promotion] after ORCH-0892-B [sweep]
 * removes all current violations.
```
with:
```
 * **Mode:** BLOCKING (exit 1 on violation, exit 0 on PASS).
 * Promoted from INFORMATIONAL by ORCH-0892-C [gate promotion + invariant
 * promote] close 2026-05-21 after ORCH-0892-B [sweep] cleared all WARN
 * sites and SmartScrollView wrapper became the canonical pattern.
```

**Edit 2: WARN footer (lines 270-273).** Replace:
```
console.log(
  "Promotion: this gate currently exits 0 (INFORMATIONAL). ORCH-0892-C\n" +
    "[gate promotion] flips it to exit 1 on violation after the sweep\n" +
    "clears all current WARN sites.\n",
);
```
with:
```
console.log(
  "This gate is BLOCKING (exit 1). PR will fail CI until every WARN site\n" +
    "above is either (a) migrated to SmartScrollView / library primitives,\n" +
    "or (b) inline-allowlisted with `// orch-strict-grep-allow orch-0892 — <reason>`\n" +
    "within 3 lines of the offending pattern (per file).\n",
);
```

**Edit 3: Final exit (line 277).** Replace:
```js
// Informational only — never fails CI in ORCH-0892-A.
process.exit(0);
```
with:
```js
// BLOCKING — fails CI on any violation. Promoted from INFORMATIONAL by
// ORCH-0892-C close 2026-05-21. Per I-PROPOSED-KEYBOARD-LIBRARY-ONLY +
// I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (both ACTIVE).
process.exit(warnings.length > 0 ? 1 : 0);
```

Note the `if (warnings.length === 0) { ... process.exit(0); }` early-return branch at lines 250-253 STAYS UNCHANGED — that path is correct (no warnings → PASS → exit 0). Only the final fall-through path flips.

### §7.B Invariant promotions — `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**Edit 4 — `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` Status line (line 3557 + 3559):**

Replace heading (line 3557):
```
### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (DRAFT — flips ACTIVE on ORCH-0892-C close)
```
with:
```
### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)
```

Replace Status paragraph (line 3559):
```
**Status:** DRAFT — codified by ORCH-0892-A [`react-native-keyboard-controller` install + root `.web.tsx` passthrough + 3-screen pilot on mingla-business] close 2026-05-20. Flips ACTIVE on ORCH-0892-C [gate promotion] close after ORCH-0892-B [sweep] removes all remaining bespoke keyboard-plumbing sites.
```
with:
```
**Status:** ACTIVE since ORCH-0892-C [gate promotion + invariant promote] close 2026-05-21. Codified by ORCH-0892-A [`react-native-keyboard-controller` install + root `.web.tsx` passthrough + 3-screen pilot on mingla-business] close 2026-05-20 as DRAFT. Sweep landed via ORCH-0892-B v2 [App-wide keyboard avoidance via SmartScrollView wrapper + Sheet primitive rewrite] close 2026-05-21 (PR #151) clearing all WARN sites. Gate flipped from INFORMATIONAL (exit 0) to BLOCKING (exit 1) by ORCH-0892-C this close — any future PR introducing one of the 4 forbidden patterns outside the SAFELIST + inline allowlist will fail CI.
```

**Edit 5 — `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` Status line (the entry added below the first invariant by ORCH-0892-B v2 close):**

Find the entry's heading:
```
### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — SCROLLVIEW-VIA-SMART-WRAPPER-ONLY (DRAFT — flips ACTIVE on ORCH-0892-C close)
```
Replace with:
```
### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — SCROLLVIEW-VIA-SMART-WRAPPER-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)
```

Find the entry's Status paragraph:
```
**Status:** DRAFT — codified by ORCH-0892-B v2 [App-wide keyboard avoidance via SmartScrollView wrapper + Sheet primitive rewrite] close 2026-05-21. Flips ACTIVE on ORCH-0892-C [gate INFORMATIONAL→BLOCK + invariant promote] close.
```
Replace with:
```
**Status:** ACTIVE since ORCH-0892-C [gate promotion + invariant promote] close 2026-05-21. Codified by ORCH-0892-B v2 close 2026-05-21 as DRAFT (PR #151). Gate's 4th pattern (`ScrollView` from `'react-native'` in TextInput-bearing file) now BLOCKS CI — any future PR introducing a bare `ScrollView` import in a form-screen file will fail until the file migrates to `SmartScrollView` wrapper or earns an inline allowlist exemption.
```

### §7.C Memory file rewrite — `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md`

The current file (dated 2026-04-30) describes the Cycle 3 wizard root pattern (`Keyboard.addListener` + dynamic `paddingBottom` + deferred `scrollToEnd`) as the canonical approach + cites `EventCreatorWizard.tsx` keyboard handling as reference. **That pattern is now FORBIDDEN by the now-BLOCKING gate.** `EventCreatorWizard.tsx` no longer has the listener — ORCH-0892-B v2 swept it out.

**Edit 6 — replace the file contents in full** with the following (preserves frontmatter + name + description but rewrites the body to reflect post-ORCH-0892 reality):

```markdown
---
name: Keyboard never blocks an input field — global rule
description: Every text/number input across mingla-business and app-mobile must remain visible above the keyboard when focused. Enforced app-wide by SmartScrollView wrapper + CI gate.
type: feedback
originSessionId: 066ea350-9827-46f7-a4e9-9854daf8ac05
---
Every focusable input field — TextInput, Input primitive, multiline textarea, anything that raises the keyboard — must keep the field's bottom edge above the keyboard's top edge while the keyboard is open. The user must never have to dismiss the keyboard to see what they're typing.

**Why:** Cycle 3 had this bug repeatedly. ORCH-0892 closed the bug class architecturally — single mechanism app-wide, CI-enforced, structurally impossible to reintroduce. Founder explicitly codified the rule 2026-04-30: "every time there is an input field. The keyboard should be aware of it and never block the screen. This is a rule we must put in memory."

**How to apply (post-ORCH-0892):**

- **mingla-business:** every form-screen ScrollView is imported from `mingla-business/src/wrappers/SmartScrollView`. On native (iOS + Android), the wrapper resolves to the library's `KeyboardAwareScrollView` (`react-native-keyboard-controller@1.18.5`) which automatically scrolls the focused TextInput exactly 12pt above the keyboard via Reanimated worklets. On web, the wrapper passes through to `react-native`'s plain ScrollView (web has no soft keyboard; no behavior change). Reference: `mingla-business/src/wrappers/SmartScrollView.{tsx,native.tsx}` + `mingla-business/src/components/brand/BrandEditView.tsx` (canonical post-sweep example).
- **Sheets (mingla-business):** the `Sheet` primitive at `mingla-business/src/components/ui/Sheet.tsx` no longer owns any keyboard logic (ORCH-0892-B v2 rewrite). Sheet consumers with a TextInput own their own keyboard avoidance via SmartScrollView inside the Sheet body. Reference: `mingla-business/src/components/brand/BrandDeleteSheet.tsx`.
- **`useKeyboardIsVisible()` wrapper hook** at `mingla-business/src/wrappers/useKeyboardIsVisible.{ts,native.ts}` for screens that need to hide a dock when keyboard appears (e.g. wizard "Continue" button hidden during typing). Web returns `false` (no soft keyboard); native delegates to library's `useKeyboardState().isVisible`.
- **app-mobile:** consumer app sweep is deferred (ORCH-0892-E). Until that ships, app-mobile continues to use whatever per-screen pattern exists.

**Anti-patterns FORBIDDEN by the strict-grep gate `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` (BLOCKING since ORCH-0892-C 2026-05-21):**

1. `Keyboard.addListener` on `keyboardWillShow` / `keyboardDidShow` / `keyboardWillHide` / `keyboardDidHide` events for layout-affecting purposes (driving `paddingBottom`, `translateY`, etc.). `Keyboard.dismiss()` remains permitted (non-listener API).
2. Import of `KeyboardAvoidingView` from `'react-native'` — SmartScrollView replaces this.
3. `automaticallyAdjustKeyboardInsets={true}` prop on any ScrollView or fork.
4. Import of `ScrollView` from `'react-native'` in a file containing a `TextInput` identifier — must come from `@/wrappers/SmartScrollView`.

**SAFELIST (5 mingla-business files + 3 wrapper natives = 8 carve-outs):**
- `src/components/ui/Sheet.tsx`, `src/components/marketing/ComposerV2/ComposerV2Editor.tsx`, `src/components/marketing/ComposerV2/richEditor.{tsx,native.ts}` (CO-1 through CO-3 — own their own keyboard logic for architectural reasons documented in `INVARIANT_REGISTRY.md`).
- `src/wrappers/KeyboardRoot.native.tsx`, `src/wrappers/SmartScrollView.native.tsx`, `src/wrappers/useKeyboardIsVisible.native.ts` (legitimate library mounts/re-exports).

**Per-file inline exemption** (Layer 2 allowlist):
```
// orch-strict-grep-allow orch-0892 — <one-line reason>
```
within 3 lines of the offending pattern. Currently approved inline-allowlisted files: `mingla-business/src/components/ui/Input.tsx` (picker dropdown ScrollView, not form content) + `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` (anchored sign-in layout has no ScrollView; uses JS-side keyboardPad — will be replaced when ORCH-0892-Bz [`useKeyboardHeightJs()` wrapper hook] ships).

**Invariants ACTIVE:**
- `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (ACTIVE since 2026-05-21) — codified in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
- `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` (ACTIVE since 2026-05-21) — codified same file.

**Pipeline enforcement:**
- Every new form-screen on `mingla-business/` must import ScrollView from the SmartScrollView wrapper before merge — CI gate BLOCKS any PR violating one of the 4 forbidden patterns.
- Implementor + forensics must verify SmartScrollView usage as a checkpoint in every spec/dispatch that adds an input.
- Tester must include "focused field clears keyboard" smoke on any new input-bearing screen (per `feedback_tester_canonical_and_platform_parity.md`).

**Deprecated reference implementations (no longer canonical — DO NOT cite as patterns):**
- The 2026-04-30 Cycle 3 wizard root pattern (Keyboard.addListener + dynamic paddingBottom + deferred scrollToEnd via requestAnimationFrame) — DELETED across mingla-business by ORCH-0892-B v2 sweep. If you see this pattern in code review, the file needs migration to SmartScrollView.
```

The frontmatter `originSessionId` is preserved; the description is updated to reflect post-ORCH-0892 enforcement.

---

## §8 Realtime layer

**N/A.** Zero realtime changes.

---

## §9 Success criteria

| SC | Criterion | Verification |
|----|-----------|--------------|
| SC-1 | Gate script's final `process.exit(0)` line (line 277) replaced with `process.exit(warnings.length > 0 ? 1 : 0)`. Early PASS branch at line 252 unchanged. | `grep -n "process.exit" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` shows exactly 2 sites: line 252 (`process.exit(0);` in PASS branch) + line 277 (`process.exit(warnings.length > 0 ? 1 : 0);` in final). |
| SC-2 | Gate header comment at lines 36-38 + WARN footer at lines 270-273 reflect BLOCKING mode (no more "INFORMATIONAL" / "exit 0 always" / "Promotion: this gate currently exits 0" language). | `grep -n "INFORMATIONAL\|exit 0 always" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` returns 0 matches. |
| SC-3 | Gate exits 0 on HEAD at this commit (no current violations to trip the BLOCK). | `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs; echo "exit=$?"` prints `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` + `exit=0`. |
| SC-4 | Gate exits 1 when an artificial violation is injected. | Inject a one-line test: `echo "import { ScrollView } from 'react-native'; const TextInput = null;" > /tmp/inject-test.tsx`; copy to a non-SAFELIST path under `mingla-business/src/components/`; run the gate; observe `exit=1`. Then DELETE the test file. The implementor must perform this injection + cleanup in the implementation report. |
| SC-5 | `INVARIANT_REGISTRY.md`: I-PROPOSED-KEYBOARD-LIBRARY-ONLY heading + Status line both say "ACTIVE since ORCH-0892-C close 2026-05-21" instead of "DRAFT — flips ACTIVE on ORCH-0892-C close". | `grep -A1 "I-PROPOSED-KEYBOARD-LIBRARY-ONLY" Mingla_Artifacts/INVARIANT_REGISTRY.md \| head -10` shows ACTIVE language. |
| SC-6 | `INVARIANT_REGISTRY.md`: I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY heading + Status line both say ACTIVE. | Same grep pattern as SC-5 on the second invariant. |
| SC-7 | Memory file `feedback_keyboard_never_blocks_input.md` rewritten per §7.C. References SmartScrollView wrapper + ACTIVE invariants + BLOCKING gate. Does NOT cite the deprecated Cycle 3 wizard root pattern as canonical. | `grep -c "SmartScrollView" ~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md` ≥ 3; `grep -c "Cycle 3 wizard root" ~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md` shows the term appears ONLY under "Deprecated reference implementations" section. |
| SC-8 | No product-code diffs. | `git diff origin/main..HEAD -- mingla-business/src mingla-business/app app-mobile mingla-admin/src supabase packages` returns empty. |
| SC-9 | tsc / jest gates remain unchanged behavior (no new failures introduced by this SPEC's edits — they're CI/doc/memory only). | Optional: `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx` STILL PASS (no regression in existing test suite). |

---

## §10 Invariants

**Promoted in this ORCH (DRAFT → ACTIVE):**
- `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (from ORCH-0892-A) → ACTIVE.
- `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` (from ORCH-0892-B v2) → ACTIVE.

**Preserved (no edits):**
- All other invariants in `INVARIANT_REGISTRY.md`.

**No NEW invariants** codified by this SPEC.

---

## §11 Test cases

**No regression-test gate per ORCH-0840 — BACKFILL-EXEMPT (zero product-code touch).** Per the ORCH-0840 exemption clause:

> if the close is a pure docs / artifact / orchestration / process close with ZERO product-code touch (no diff in `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/`, `supabase/functions/`, `packages/`, `.github/scripts/strict-grep/`), state `BACKFILL-EXEMPT — reason: <one sentence>` in the CLOSE banner. The gate passes.

Wait — `.github/scripts/strict-grep/` IS in the exemption list, which is the only product-coded file this SPEC touches. So technically this SPEC qualifies for BACKFILL-EXEMPT given the gate exclusion list. But the gate edit IS functional (changes CI behavior), so the implementor MUST satisfy SC-3 + SC-4 (verify the gate exits correctly on PASS and on injected violation) as the de-facto regression check. This serves the same purpose as a regression test would.

**Tester adversarial:** none required (BACKFILL-EXEMPT). Tester verifies the 9 success criteria above directly.

---

## §12 Implementation order

1. **Phase 0 sanity** — confirm gate at HEAD exits 0 with zero WARN. `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs; echo "exit=$?"` → `PASS`, `exit=0`.
2. **Edit 1** — gate header comment lines 36-38 (mode language flip).
3. **Edit 2** — gate WARN footer lines 270-273 (mode language flip).
4. **Edit 3** — gate final exit line 277 (`process.exit(0)` → `process.exit(warnings.length > 0 ? 1 : 0)`).
5. **Verify SC-3** — re-run gate. Expect `PASS` + exit 0 unchanged.
6. **Verify SC-4** — inject artificial violation: create `/tmp/inject-test.tsx` with `import { ScrollView } from 'react-native'; const x: TextInput = null;`, copy to e.g. `mingla-business/src/components/event/__orch_0892_c_test_inject.tsx`, re-run gate, observe exit=1. **DELETE** the inject file immediately after observing. Cite both runs (PASS + FAIL on inject) in the implementation report.
7. **Edit 4 + 5** — invariant promotions in `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §7.B.
8. **Verify SC-5 + SC-6** — grep for ACTIVE language on both invariants.
9. **Edit 6** — rewrite memory file `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md` per §7.C in full.
10. **Verify SC-7** — grep for SmartScrollView mentions (≥3) and that "Cycle 3 wizard root" appears only under deprecated section.
11. **Verify SC-8** — `git diff origin/main..HEAD -- mingla-business/src mingla-business/app app-mobile mingla-admin/src supabase packages` returns empty.
12. **Verify SC-9** — re-run the existing KeyboardRoot test suites (no regression).
13. **Implementor report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md` with old→new receipts per file + gate run output (PASS @ HEAD + injected FAIL + cleanup) + diff stats confirming SC-8.

---

## §13 Regression prevention

This SPEC IS the regression prevention. Mechanism:

1. Gate flip from INFORMATIONAL to BLOCKING means any future PR introducing one of the 4 forbidden keyboard-plumbing patterns outside the SAFELIST + inline allowlist will FAIL CI at the strict-grep workflow step. Authors cannot merge until they migrate to SmartScrollView OR earn an explicit allowlist exemption with operator approval.
2. Invariant promotions DRAFT → ACTIVE codify the architectural decision in the canonical registry. Future code reviews + forensics investigations cite ACTIVE invariants as binding rules.
3. Memory file rewrite means future Claude/Codex skill invocations that touch keyboard handling will read SmartScrollView as the canonical pattern, not the deprecated Cycle 3 wizard root pattern. Prevents skill-driven regressions where a sub-agent recreates the old pattern based on stale memory.

---

## §14 Hard guards

1. **NO product-code changes.** Zero diffs in `mingla-business/src/`, `mingla-business/app/`, `app-mobile/`, `mingla-admin/src/`, `supabase/`, `packages/`. Verified by SC-8.
2. **NO SAFELIST changes.** SAFELIST stays exactly as ORCH-0892-B v2 left it (5 mingla-business files + 3 wrapper natives = 8 entries). Adding/removing entries is its own ORCH.
3. **NO new dependencies.** No `npm install`, no `pod install`, no `eas build`.
4. **NO EAS OTA.** No JS bundle change reaches users.
5. **NO migration / edge function / Supabase touches.**
6. **NO test file modifications.** Existing `KeyboardRoot.test.tsx`, `KeyboardRoot.adversarial.test.tsx`, `KeyboardRoot.sweep.v2.adversarial.test.tsx` stay UNCHANGED. The append-only test contract from ORCH-0840 holds.
7. **NO premature ORCH-0892-Bz dependency.** `BusinessWelcomeScreen.tsx` keeps its inline-allowlisted JS-side keyboardPad pattern — replacing it is ORCH-0892-Bz scope, not this ORCH.
8. **NO `app-mobile/` keyboard touches.** Consumer app sweep is ORCH-0892-E scope.
9. **CLEAN UP injected test file before commit.** SC-4's artificial violation file MUST be deleted before staging.
10. **BACKFILL-EXEMPT close banner** required per ORCH-0840 — orchestrator's CLOSE banner cites `BACKFILL-EXEMPT — reason: pure CI/invariant/memory hardening, zero product-code touch; SC-3 + SC-4 verification serve as the de-facto regression check.`

---

## §15 Required output (implementor)

Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md` with:
- Old→new receipts for the 3 files (gate script + INVARIANT_REGISTRY + memory file).
- Gate run output cited verbatim:
  - HEAD run: `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` + `exit=0`.
  - Injected violation run: `WARN — N file(s) using bespoke keyboard plumbing` + `exit=1`.
  - Post-cleanup run: `PASS` + `exit=0`.
- `git diff --stat origin/main..HEAD` showing zero product-code files in scope.
- Confirmation that existing test suites still PASS.
- BACKFILL-EXEMPT acknowledgement for ORCH-0840 (no implementor regression test required; SC-3+SC-4 cover de-facto).
- "EAS OTA not applicable" note (no JS bundle change).

---

## §16 Pipeline next

After SPEC return + orchestrator REVIEW APPROVED:

1. Claude `mingla-implementor` executes Edits 1-6 + verifications SC-1 through SC-9 per §12 implementation order.
2. Claude `mingla-tester` verdict cycle — TARGETED sub-mode against the 9 SCs. BACKFILL-EXEMPT close, but tester still verifies SC-1 through SC-9 independently. Tester reads the implementor's gate-run output, re-runs the gate at HEAD, verifies exit code 0, attempts a parallel injection to confirm exit 1, confirms invariant + memory edits via grep, confirms SC-8 zero product-code diff.
3. Claude `mingla-orchestrator` CLOSE with `BACKFILL-EXEMPT` banner. Opens PR `orch-0892-c-close → main` per One-PR-per-CLOSE rule. Standard pre-merge gate (all required checks green + MERGEABLE + reviews + not BEHIND + operator confirmation).
4. ORCH-0892 arc CLOSED. Memory of the bug class becomes structurally permanent.

Working tree for ALL phases: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## §17 Layman summary

The ORCH-0892 arc shipped a fix for the cursor-above-but-field-below keyboard bug across mingla-business in two prior closes (0892-A install + pilots, 0892-B v2 sweep + Sheet rewrite). The third and final sub-ORCH is this one: lock the fix in permanently by making 3 small flips.

**What changes:**
1. The CI guardrail that currently prints a warning if someone uses the OLD keyboard code (`Keyboard.addListener` for layout, `KeyboardAvoidingView` from RN, `automaticallyAdjustKeyboardInsets={true}`, or bare `ScrollView` from RN in a form-screen file) becomes a **hard block**. Any PR that introduces those patterns will fail CI and cannot merge until the author migrates to `SmartScrollView` or earns an explicit operator-approved allowlist exemption.
2. Two architectural invariants in `INVARIANT_REGISTRY.md` get promoted from DRAFT to ACTIVE — codifying the rule in the canonical registry where future code reviews + forensics investigations look.
3. The operator-memory file describing the keyboard rule gets rewritten — the 2026-04-30 version describes the OLD Cycle 3 wizard root pattern as canonical, which is now FORBIDDEN. The rewrite cites SmartScrollView as the canonical pattern + the now-ACTIVE invariants + the now-BLOCKING gate, so future Claude/Codex skill sessions don't accidentally recreate the OLD pattern based on stale memory.

**Scope:** 3 file edits. Zero product-code touch (no `mingla-business/src/` or `app-mobile/` or anything user-facing changes). BACKFILL-EXEMPT close per ORCH-0840 (pure CI/invariant/memory work). Not EAS-OTA-eligible (no JS bundle change reaches users). Estimated 20-30 min from implementor dispatch through CLOSE + PR merge.

**Outcome for users:** No user-visible change. The fix shipped in ORCH-0892-B v2 PR #151 + EAS OTA. This ORCH is the lock-in step preventing the bug class from ever returning to the codebase.
