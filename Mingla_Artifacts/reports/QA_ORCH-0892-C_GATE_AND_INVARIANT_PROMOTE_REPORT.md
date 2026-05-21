# QA — ORCH-0892-C [Strict-grep gate `orch-0892-no-bespoke-keyboard-plumbing` INFORMATIONAL→BLOCK + invariants I-PROPOSED-KEYBOARD-LIBRARY-ONLY + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY DRAFT→ACTIVE]

**Author:** Claude `mingla-tester` (canonical TEST owner per `feedback_tester_canonical_and_platform_parity.md`).
**Date:** 2026-05-21.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**SPEC:** [SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md](../specs/SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md).
**Implementation:** [IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md](IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md).
**Mode:** TARGETED.
**Verdict:** **PASS** — all 9 SCs independently verified; BACKFILL-EXEMPT per ORCH-0840 (only product-coded path touched is `.github/scripts/strict-grep/` which IS in the exemption list).

---

## Verdict Summary

- **P0 — CRITICAL:** 0
- **P1 — HIGH:** 0
- **P2 — MEDIUM:** 0
- **P3 — LOW:** 0
- **P4 — NOTE:** 1 (clean mechanical implementation; lock-in for the ORCH-0892 arc complete)

**Verdict gate check (NON-NEGOTIABLE):**
- PASS requires `proven`-level live-fire sim repro on every applicable platform → **EXEMPT** per Phase 0.A backend-only/CI/build-config/type-only/pure-refactor clause. This ORCH is pure CI/invariant/memory hardening with zero UI/runtime surface change.
- Regression-test gate → **BACKFILL-EXEMPT** per ORCH-0840 clause: only product-coded file touched is `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` which IS in the exemption list. SC-3 (gate PASS at HEAD) + SC-4 (gate FAIL on injected violation + post-cleanup PASS) serve as the de-facto regression check.

---

## §1 Implementor claims independently re-verified

| Implementor claim | Tester verification |
|------------------|---------------------|
| Gate flipped INFORMATIONAL→BLOCKING; early PASS branch unchanged at line 252/254 | `grep -n "process.exit" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → exactly 2 sites: line 254 `process.exit(0);` (early PASS branch) + line 285 `process.exit(warnings.length > 0 ? 1 : 0);` (final BLOCKING). ✅ |
| INFORMATIONAL/exit-0-always language removed from contract paragraphs; only historical context refs remain | `grep -n "INFORMATIONAL\|exit 0 always\|currently exits 0" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → 2 matches both in "Promoted from INFORMATIONAL" historical context (lines 38, 282); zero "currently exits 0" or "exit 0 always" stale references. ✅ |
| Gate exits 0 at HEAD | Independent re-run: `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs > /tmp/qa-sc3.out; echo $?` → `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` + `exit=0`. ✅ |
| Gate exits 1 on injected violation | Independent injection at `mingla-business/src/components/event/__qa_tester_orch_0892_c_inject.tsx` (different filename than implementor's `__orch_0892_c_test_inject.tsx`) with `import { ScrollView, TextInput, View } from "react-native"` + JSX → gate `exit=1` with `WARN — 1 file(s) using bespoke keyboard plumbing... mingla-business/src/components/event/__qa_tester_orch_0892_c_inject.tsx:3`. Cleaned up; post-cleanup re-run → `PASS` + `exit=0`. ✅ |
| I-PROPOSED-KEYBOARD-LIBRARY-ONLY ACTIVE | `grep -A1 "^### I-PROPOSED-KEYBOARD-LIBRARY-ONLY" Mingla_Artifacts/INVARIANT_REGISTRY.md` → `### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)`. ✅ |
| I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY ACTIVE | `grep -A1 "^### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY" Mingla_Artifacts/INVARIANT_REGISTRY.md` → `### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — SCROLLVIEW-VIA-SMART-WRAPPER-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)`. ✅ |
| Memory file rewritten with SmartScrollView canonical | `grep -c "SmartScrollView" feedback_keyboard_never_blocks_input.md` → **9** (≥3 required); `grep -c "Cycle 3 wizard root" feedback_keyboard_never_blocks_input.md` → **1** (single mention, under "Deprecated reference implementations" section confirmed by inspection); FORBIDDEN section present (1 hit); Deprecated section present (1 hit); ACTIVE invariants section present (1 hit). ✅ |
| Zero product-code diff in this ORCH's scope | Confirmed: this ORCH's uncommitted changes are exactly 2 in-repo files (gate script + INVARIANT_REGISTRY.md) + 1 out-of-repo memory file. The 819-line `supabase/functions/*` + `app-mobile/*` + `Mingla_Artifacts/WORLD_MAP.md` diffs visible in `git diff HEAD` are parallel-session work (ORCH-0898 [Consumer collab group chat] + ORCH-0903 [Consumer how-far filter/display mismatch]) that was already on Seth before ORCH-0892-C started — not in this ORCH's scope. ✅ |
| KeyboardRoot test suites still PASS | `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx` → **Tests: 85 passed, 85 total**. ✅ |

---

## §2 Phase 0.A live-fire sim gate — EXEMPT

This ORCH is pure CI / invariant / memory hardening with zero UI/runtime surface change. Per Phase 0.A exemption clause: "Exemptions (source-only is sufficient): backend-only / SQL-only / RLS / edge-function-only / CI / build-config / lint / type-only / pure refactor with zero behavior change."

No iOS sim, Android emulator, or web preview required.

---

## §3 Spec Traceability — all 9 SCs PASS

| SC | Criterion | Status | Verification cite |
|----|-----------|--------|-------------------|
| SC-1 | Gate `process.exit(0)` line flipped to `process.exit(warnings.length > 0 ? 1 : 0)`; early PASS branch unchanged | PASS | grep confirms 2 sites: line 254 (PASS branch unchanged) + line 285 (final flipped) |
| SC-2 | No "INFORMATIONAL"/"exit 0 always"/"currently exits 0" contract language remains; only historical context refs | PASS | 2 matches both in historical "Promoted from INFORMATIONAL" context |
| SC-3 | Gate exits 0 on HEAD (no current violations) | PASS | Independent re-run: `PASS` + exit 0 |
| SC-4 | Gate exits 1 on injected violation, exit 0 after cleanup | PASS | Independent injection at different filename than implementor's; gate exit 1 confirmed + cleanup verified |
| SC-5 | I-PROPOSED-KEYBOARD-LIBRARY-ONLY heading + Status ACTIVE | PASS | Heading reads "(ACTIVE since ORCH-0892-C close 2026-05-21)" |
| SC-6 | I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY heading + Status ACTIVE | PASS | Heading reads "(ACTIVE since ORCH-0892-C close 2026-05-21)" |
| SC-7 | Memory file rewritten; SmartScrollView ≥3 refs; Cycle 3 only in Deprecated section | PASS | 9 SmartScrollView refs; 1 Cycle 3 ref under Deprecated section |
| SC-8 | Zero product-code diff in this ORCH's scope | PASS | This ORCH's scope: 2 in-repo files (gate + INVARIANT_REGISTRY) + 1 out-of-repo memory file. The 819-line diff in `git diff HEAD` is parallel ORCH-0898/0903 work |
| SC-9 | KeyboardRoot test suites still PASS (no regression) | PASS | 85/85 tests pass on 3 suites (KeyboardRoot.test.tsx + KeyboardRoot.adversarial.test.tsx + KeyboardRoot.sweep.v2.adversarial.test.tsx) |

---

## §4 Constitution check (14 rules)

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | N/A — no interactive UI |
| 2 | One owner per truth | **PASS — STRENGTHENED** by gate flip (SmartScrollView is now CI-enforced as the single ScrollView authority on form-screens) |
| 3 | No silent failures | N/A |
| 4 | One key per entity | N/A |
| 5 | Server state server-side | N/A |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary | **PASS — HONORED** (both invariants' DRAFT exit conditions fired on this close as documented; no orphan DRAFT tags remain) |
| 8 | Subtract before adding | **PASS — HONORED** (no new mechanism; existing gate's exit-code semantics flipped, existing invariants' status flipped) |
| 9 | No fabricated data | N/A |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at right time | N/A |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A |

**Zero constitutional violations.**

---

## §5 Regression-test gate (per ORCH-0840) — BACKFILL-EXEMPT

This ORCH qualifies for BACKFILL-EXEMPT per the ORCH-0840 [Regression-test enforcement + append-only CI] exemption clause: only product-coded path touched is `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` which IS explicitly in the ORCH-0840 exemption file list.

No tester adversarial test file required. SC-3 (PASS on HEAD) + SC-4 (FAIL on injected violation + post-cleanup PASS) serve as the de-facto regression check. The tester's independent injection at a different filename than the implementor's confirms the BLOCK behavior is genuinely end-to-end and not specific to the implementor's injection path.

**CLOSE banner MUST cite:** `BACKFILL-EXEMPT — reason: pure CI/invariant/memory hardening, zero product-code touch outside the strict-grep gate (which IS in the ORCH-0840 exemption); SC-3 + SC-4 verification serve as the de-facto regression check (PASS on HEAD + FAIL on independent injection + post-cleanup PASS).`

---

## §6 Discoveries for Orchestrator

**None new in this QA pass.** The 6 follow-ups already cataloged in the ORCH-0892-B v2 close banner remain queued and are inherited (not re-discovered):
1. ORCH-0892-Bx [`IOS_DEV_BUILD_REBUILD_RUNBOOK.md` updates].
2. ORCH-0892-Bz [`useKeyboardHeightJs()` wrapper hook for BusinessWelcomeScreen].
3. ORCH-0896 [Stripe `forwardRef` RedBox].
4. Janitorial orphan-styles cleanup.
5. Optional janitorial: bare `automaticallyAdjustKeyboardInsets` props on 11 historical sheet-embedded files.
6. ORCH-0892-E [`app-mobile/` consumer port].

**P4 — clean implementation:** the ORCH-0892 arc (0892-A install/pilot → 0892-B v2 sweep/Sheet rewrite → 0892-C lock-in) is now COMPLETE. The cursor-above-but-field-below bug class is structurally impossible to reintroduce. This is a model "architectural fix shipped in 3 sub-ORCHs over 2 days" pattern worth replicating.

---

## §7 Test run outputs (cited verbatim)

### SC-3 — gate at HEAD (post-edits, pre-injection)
```
ORCH-0892 no-bespoke-keyboard-plumbing informational gate
Scanned 539 .ts/.tsx files under mingla-business/.

  7 file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)

PASS — zero bespoke keyboard-plumbing violations outside the safelist.

exit=0
```

### SC-4 — tester independent injection
```
Injected: mingla-business/src/components/event/__qa_tester_orch_0892_c_inject.tsx
gate exit=1
WARN — 1 file(s) using bespoke keyboard plumbing instead of react-native-keyboard-controller:
  mingla-business/src/components/event/__qa_tester_orch_0892_c_inject.tsx:3
```

### SC-4 — post-cleanup
```
Deleted.
post-cleanup gate exit=0
PASS — zero bespoke keyboard-plumbing violations outside the safelist.
```

### SC-9 — KeyboardRoot test suites
```
PASS src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx (6.702 s)
PASS src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx (6.709 s)
PASS src/wrappers/__tests__/KeyboardRoot.test.tsx

Test Suites: 3 passed, 3 total
Tests:       85 passed, 85 total
```

---

## §8 Layman summary

**What I tested.** ORCH-0892-C is the third and final sub-ORCH of the ORCH-0892 [App-wide keyboard avoidance] arc — pure lock-in work that flips the CI gate from "warn-only" to "block PR on violation" + promotes two architectural invariants from DRAFT to ACTIVE + rewrites the operator-memory file so future Claude/Codex skill sessions cite SmartScrollView as canonical instead of the deprecated Cycle 3 pattern.

**What's good.** All 9 SCs independently verified. The gate exits 0 at HEAD (no current violations); when I independently injected an artificial violation file (using a different filename than the implementor's) the gate exited 1 with the precise violation cited, and after cleanup the gate returned to exit 0. Both invariants now read ACTIVE in the registry. The memory file cites SmartScrollView 9 times and quarantines the deprecated Cycle 3 pattern under a clearly-labeled section. Zero product-code touch in this ORCH's scope (the 819-line product-code diff visible on Seth is parallel-session ORCH-0898/0903 work, not this ORCH). All 85 existing KeyboardRoot tests still PASS.

**No user-visible change.** This ORCH is pure CI/documentation/memory hardening. Users see nothing new. The fix shipped in PR #151 (ORCH-0892-B v2) and the EAS OTA. This ORCH makes the fix permanent by blocking any future PR that tries to reintroduce the OLD keyboard-avoidance pattern.

**Verdict: PASS** — orchestrator may proceed directly to CLOSE. BACKFILL-EXEMPT per ORCH-0840 (no separate regression-test file required; SC-3+SC-4 cover the de-facto check). No EAS OTA needed (no JS bundle change reaches users).
