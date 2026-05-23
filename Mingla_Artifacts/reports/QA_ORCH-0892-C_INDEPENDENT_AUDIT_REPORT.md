# QA — ORCH-0892-C [Strict-grep gate INFORMATIONAL→BLOCK + invariants DRAFT→ACTIVE] — INDEPENDENT AUDIT

**Author:** Claude `mingla-tester` (canonical TEST owner; SECOND-OPINION audit on operator request).
**Date:** 2026-05-21.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`, HEAD = `8d290874 Close ORCH-0892-C: Strict-grep gate INFORMATIONAL→BLOCK + invariants DRAFT→ACTIVE` (cherry-picked from `orch-0892-c-close`).
**SPEC:** [SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md](../specs/SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md).
**Implementation:** [IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md](IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md).
**Prior QA:** [QA_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE_REPORT.md](QA_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE_REPORT.md) (PASS, 0 P0/P1/P2/P3, 1 P4).
**Mode:** TARGETED (independent re-verification on top of prior PASS — operator wanted a second opinion).
**Verdict:** **PASS — concurs with prior QA.** All 9 SCs re-verified by direct command execution at HEAD `8d290874`. BACKFILL-EXEMPT confirmed.

---

## Verdict Summary

- **P0 — CRITICAL:** 0
- **P1 — HIGH:** 0
- **P2 — MEDIUM:** 0
- **P3 — LOW:** 0
- **P4 — NOTE:** 2 (1 inherited from prior QA — clean arc closure; 1 new discovery — cosmetic stale string in gate output header, see §6)

**Verdict gate (NON-NEGOTIABLE):**
- Phase 0.A live-fire sim gate → **EXEMPT** per backend-only/CI/build-config clause. ORCH-0892-C is pure CI / invariant registry / out-of-repo memory hardening with zero UI/runtime surface change. SPEC §2 Cross-Surface table marks all 7 surfaces as NOT touched.
- Regression-test gate (ORCH-0840) → **BACKFILL-EXEMPT** confirmed. The single product-coded file touched is `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` which IS explicitly enumerated in the ORCH-0840 exemption list. SC-3 (PASS at HEAD) + SC-4 (FAIL on injected violation + post-cleanup PASS) serve as the de-facto regression check. This audit's independent SC-4 injection used 3 distinct forbidden patterns in one file (KeyboardAvoidingView from RN + automaticallyAdjustKeyboardInsets={true} + bare ScrollView in TextInput file), more adversarial than the prior tester's single-pattern injection — confirms the gate's BLOCKING semantics are not coincidental.

---

## §1 Why a second audit was performed

Operator invoked `/mingla-tester take over` after the implementor + prior tester pass for ORCH-0892-C had already completed and closed (commit `8d290874` cherry-picked onto Seth). Canonical tester behavior is "treat all prior claims — implementor AND prior tester — as hypotheses to attack." This audit re-runs every SC verification with fresh commands at HEAD, uses a different injection filename + pattern set than the prior tester to maximize adversarial coverage, and produces an independent verdict.

The result concurs with the prior QA verdict (PASS). All evidence captured here was generated this turn, not copied from the prior report.

---

## §2 Phase 0.A live-fire sim gate — EXEMPT

ORCH-0892-C touches `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` + `Mingla_Artifacts/INVARIANT_REGISTRY.md` + an out-of-repo operator-memory file. Zero UI/runtime surface change. Per the Phase 0.A exemption clause: "backend-only / SQL-only / RLS / edge-function-only / CI / build-config / lint / type-only / pure refactor with zero behavior change." CI gate edits qualify. No iOS Simulator, Android Emulator, or web preview required.

---

## §3 Spec Traceability — all 9 SCs PASS (independent re-verification)

| SC | Criterion | This audit's verification | Status |
|----|-----------|---------------------------|--------|
| SC-1 | Gate `process.exit(0)` line flipped to `process.exit(warnings.length > 0 ? 1 : 0)`; early PASS branch unchanged | `grep -n "process.exit" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → 2 sites: **line 254** `process.exit(0);` (early PASS branch) + **line 285** `process.exit(warnings.length > 0 ? 1 : 0);` (final BLOCKING) | **PASS** |
| SC-2 | No "INFORMATIONAL"/"exit 0 always"/"currently exits 0" contract claims | `grep -n "INFORMATIONAL\|exit 0 always\|currently exits 0" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → 2 matches, both in clearly historical context ("Promoted from INFORMATIONAL by ORCH-0892-C" at line 38 and line 282); ZERO matches for "exit 0 always" or "currently exits 0" | **PASS** |
| SC-3 | Gate exits 0 on HEAD | Independent re-run: `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs; echo "exit=$?"` → `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` + `exit=0` | **PASS** |
| SC-4 | Gate exits 1 on injected violation, exit 0 after cleanup | **Independent injection** at NEW filename `mingla-business/src/components/event/__qa_independent_audit_orch_0892_c.tsx` (different from implementor's `__orch_0892_c_test_inject.tsx` AND prior tester's `__qa_tester_orch_0892_c_inject.tsx`). Injection used 3 forbidden patterns simultaneously: `import { ScrollView } from 'react-native'` + `import { KeyboardAvoidingView } from 'react-native'` + `automaticallyAdjustKeyboardInsets={true}`. Gate exit=1 with 3 distinct WARN entries citing each pattern + correct line numbers. Cleanup: `rm <inject>`. Post-cleanup re-run: `PASS` + `exit=0` | **PASS** |
| SC-5 | I-PROPOSED-KEYBOARD-LIBRARY-ONLY heading + Status ACTIVE | `grep -A5 "^### I-PROPOSED-KEYBOARD-LIBRARY-ONLY" Mingla_Artifacts/INVARIANT_REGISTRY.md` → heading reads `### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)`. Status paragraph cites full arc history (DRAFT codification by ORCH-0892-A → sweep by ORCH-0892-B v2 → gate flip by ORCH-0892-C) | **PASS** |
| SC-6 | I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY heading + Status ACTIVE | `grep -A5 "^### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY" Mingla_Artifacts/INVARIANT_REGISTRY.md` → heading reads `### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — SCROLLVIEW-VIA-SMART-WRAPPER-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)`. Status paragraph confirms gate's 4th pattern now BLOCKS CI | **PASS** |
| SC-7 | Memory file rewritten; SmartScrollView ≥3 refs; Cycle 3 only in Deprecated section | `grep -c SmartScrollView ~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md` → **9** (≥3 required). `grep -c 'Cycle 3 wizard root'` → **1**. Context check confirms the single mention appears under `**Deprecated reference implementations (no longer canonical — DO NOT cite as patterns):**` header | **PASS** |
| SC-8 | Zero product-code diff in this ORCH's scope | `git diff-tree --no-commit-id --name-only -r 8d290874 \| grep -vE "^(\.github/scripts/strict-grep/\|Mingla_Artifacts/)"` → **zero matches**. Commit `8d290874` file list: 1 strict-grep gate (exemption-listed) + 4 Mingla_Artifacts docs/indexes + 2 ORCH-0892-C artifacts. ZERO touches to `mingla-business/src`, `mingla-business/app`, `app-mobile/`, `mingla-admin/src/`, `supabase/`, `packages/` | **PASS** |
| SC-9 | KeyboardRoot test suites still PASS (no regression) | `cd mingla-business && npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx` → **Test Suites: 3 passed, 3 total** / **Tests: 85 passed, 85 total** in 8.871s | **PASS** |

---

## §4 Constitution check (14 rules)

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No interactive UI in scope |
| 2 | One owner per truth | **PASS — STRENGTHENED** | Gate flip + 4th pattern make SmartScrollView the CI-enforced single ScrollView authority on form-screens. Independent injection confirmed the gate catches violations of this ownership rule |
| 3 | No silent failures | N/A | No runtime code paths |
| 4 | One key per entity | N/A | No React Query |
| 5 | Server state server-side | N/A | No state |
| 6 | Logout clears everything | N/A | No auth surface |
| 7 | Label temporary | **PASS — HONORED** | Both invariants' DRAFT exit conditions fired on this close as documented in their Status paragraphs (codification trigger → DRAFT → ACTIVE); zero orphan DRAFT tags remain on these invariants |
| 8 | Subtract before adding | **PASS — HONORED** | No new mechanism added; existing gate's exit-code semantics flipped, existing invariants' status flipped. The pre-ORCH-0892-C INFORMATIONAL exit path was REPLACED with the BLOCKING exit, not layered on top |
| 9 | No fabricated data | N/A | No user-facing data |
| 10 | Currency-aware | N/A | No money |
| 11 | One auth instance | N/A | No auth |
| 12 | Validate at right time | N/A | No validation |
| 13 | Exclusion consistency | N/A | No serving/exclusion logic |
| 14 | Persisted-state startup | N/A | No persisted state |

**Zero constitutional violations.** Three principles (#2, #7, #8) STRENGTHENED or HONORED by this close.

---

## §5 Regression-test gate (per ORCH-0840) — BACKFILL-EXEMPT

Confirmed exempt per the ORCH-0840 [Regression-test enforcement + append-only CI] exemption clause: only product-coded path touched is `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`, which IS explicitly enumerated in the exemption file list. No tester adversarial test file required.

SC-3 (PASS on HEAD) + SC-4 (FAIL on independent injection at a new filename + post-cleanup PASS) serve as the de-facto regression check. This audit's SC-4 used a MORE adversarial injection than the prior tester (3 patterns vs 1), proving the gate's BLOCKING semantics generalize across forbidden patterns.

**CLOSE banner already cites the exemption** in commit `8d290874`'s body. Confirmed by `git log -1 --format="%B" 8d290874 | grep -i backfill` (operator may verify directly).

---

## §6 Discoveries for Orchestrator

| ID | Discovery | Severity | Recommended action |
|---|---|---|---|
| **D-COSMETIC-INFORMATIONAL-STRING** | Line 246 of `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` contains the literal output string `console.log("\nORCH-0892 no-bespoke-keyboard-plumbing informational gate");` — the word "informational" in the gate's printed header is stale post-promotion. Every CI run + every dev run prints this title even though the gate is now BLOCKING. Cosmetic only (does not affect exit code or contract); flagged as P4 cleanup opportunity. Detected this audit. Prior QA did not catch. | **P4 — NOTE** | One-line edit in a follow-up: change `informational gate` → `BLOCKING gate` (or `strict-grep gate`). Trivial. Operator may opt to schedule alongside the existing ORCH-0892-Bx [`IOS_DEV_BUILD_REBUILD_RUNBOOK.md` updates] follow-up rather than open a new ORCH. |
| **(inherited)** | ORCH-0892 arc (0892-A install/pilot → 0892-B v2 sweep + Sheet rewrite → 0892-C lock-in) is now COMPLETE. Cursor-above-but-field-below bug class is structurally impossible to reintroduce. Model "architectural fix shipped in 3 sub-ORCHs over 2 days" pattern worth replicating. | **P4 — NOTE** | Informational. Prior QA flagged this. |
| **(inherited)** | 6 follow-ups already cataloged in ORCH-0892-B v2 close banner remain queued: ORCH-0892-Bx (runbook updates), ORCH-0892-Bz (`useKeyboardHeightJs()` for BusinessWelcomeScreen), ORCH-0896 (Stripe `forwardRef` RedBox), janitorial orphan-styles cleanup, janitorial bare-prop cleanup on 11 sheet-embedded files, ORCH-0892-E (consumer port). | informational | Inherited, not re-discovered. |

---

## §7 Verbatim test run outputs (captured this audit)

### SC-1 + SC-2 — gate script grep results

```
=== process.exit lines ===
254:  process.exit(0);
285:process.exit(warnings.length > 0 ? 1 : 0);

=== INFORMATIONAL / exit 0 always / currently exits 0 matches ===
38: * Promoted from INFORMATIONAL by ORCH-0892-C [gate promotion + invariant
282:// BLOCKING — fails CI on any violation. Promoted from INFORMATIONAL by
```

Both INFORMATIONAL matches are in clearly historical context ("Promoted from INFORMATIONAL"), not current-mode claims.

### SC-3 — gate at HEAD

```
ORCH-0892 no-bespoke-keyboard-plumbing informational gate
Scanned 539 .ts/.tsx files under mingla-business/.

  7 file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)

PASS — zero bespoke keyboard-plumbing violations outside the safelist.

exit=0
```

### SC-4 — independent injection (3 forbidden patterns in one file)

Injection file: `mingla-business/src/components/event/__qa_independent_audit_orch_0892_c.tsx`

```tsx
import { ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native';
export const Test = () => (
  <KeyboardAvoidingView>
    <ScrollView automaticallyAdjustKeyboardInsets={true}>
      <TextInput />
    </ScrollView>
  </KeyboardAvoidingView>
);
```

Gate run with injection:

```
ORCH-0892 no-bespoke-keyboard-plumbing informational gate
Scanned 540 .ts/.tsx files under mingla-business/.

  7 file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)

WARN — 3 file(s) using bespoke keyboard plumbing instead of react-native-keyboard-controller:

  mingla-business/src/components/event/__qa_independent_audit_orch_0892_c.tsx:2
    pattern: KeyboardAvoidingView imported from 'react-native'
    fix:     Import KeyboardAvoidingView from 'react-native-keyboard-controller' instead — drop-in replacement with frame-perfect native animation.

  mingla-business/src/components/event/__qa_independent_audit_orch_0892_c.tsx:5
    pattern: automaticallyAdjustKeyboardInsets={true}
    fix:     Wrap parent in <KeyboardAwareScrollView from 'react-native-keyboard-controller'> — automaticallyAdjustKeyboardInsets is iOS-only and fragile in nested layouts.

  mingla-business/src/components/event/__qa_independent_audit_orch_0892_c.tsx:1
    pattern: ScrollView imported from 'react-native' in a file containing TextInput
    fix:     Import ScrollView from '@/wrappers/SmartScrollView' (correct relative path per file depth) — wrapper resolves to KeyboardAwareScrollView on native (focused TextInput auto-scrolls above keyboard) and plain ScrollView on web (passthrough).

Each WARN above is a BLOCKER (this gate exits 1 post-ORCH-0892-C).
[…BLOCKING footer…]

exit=1
```

Cleanup (`rm`) + post-cleanup gate run:

```
ORCH-0892 no-bespoke-keyboard-plumbing informational gate
Scanned 539 .ts/.tsx files under mingla-business/.

  7 file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)

PASS — zero bespoke keyboard-plumbing violations outside the safelist.

exit=0
```

**Note on "informational" in the title** — see D-COSMETIC-INFORMATIONAL-STRING (§6 P4). The exit code is correct (1 on violation, 0 on PASS) — only the title string is stale.

### SC-5 — I-PROPOSED-KEYBOARD-LIBRARY-ONLY heading + Status

```
### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)

**Status:** ACTIVE since ORCH-0892-C [gate promotion + invariant promote] close 2026-05-21. Codified by ORCH-0892-A […] close 2026-05-20 as DRAFT. Sweep landed via ORCH-0892-B v2 […] close 2026-05-21 (PR #151) clearing all WARN sites. Gate flipped from INFORMATIONAL (exit 0) to BLOCKING (exit 1) by ORCH-0892-C this close — any future PR introducing one of the 4 forbidden patterns outside the SAFELIST + inline allowlist will fail CI.
```

### SC-6 — I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY heading + Status

```
### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — SCROLLVIEW-VIA-SMART-WRAPPER-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)

**Status:** ACTIVE since ORCH-0892-C [gate promotion + invariant promote] close 2026-05-21. Codified by ORCH-0892-B v2 close 2026-05-21 as DRAFT (PR #151). Gate's 4th pattern (`ScrollView` from `'react-native'` in TextInput-bearing file) now BLOCKS CI — any future PR introducing a bare `ScrollView` import in a form-screen file will fail until the file migrates to `SmartScrollView` wrapper or earns an inline allowlist exemption.
```

### SC-7 — memory file counts

```
SmartScrollView count: 9
Cycle 3 wizard root count: 1
```

Cycle 3 mention located in:
```
**Deprecated reference implementations (no longer canonical — DO NOT cite as patterns):**
- The 2026-04-30 Cycle 3 wizard root pattern (Keyboard.addListener + dynamic paddingBottom + deferred scrollToEnd via requestAnimationFrame) — DELETED across mingla-business by ORCH-0892-B v2 sweep. If you see this pattern in code review, the file needs migration to SmartScrollView.
```

Confirmed: single mention, under deprecated section, with explicit "DO NOT cite as patterns" framing.

### SC-8 — commit file scope check

```
$ git diff-tree --no-commit-id --name-only -r 8d290874 | grep -vE "^(\.github/scripts/strict-grep/|Mingla_Artifacts/)"
(no matches)

$ git show --stat 8d290874 | tail -10
 .../orch-0892-no-bespoke-keyboard-plumbing.mjs     |  40 ++-
 Mingla_Artifacts/INVARIANT_REGISTRY.md             |  10 +-
 Mingla_Artifacts/MASTER_BUG_LIST.md                |   2 +
 Mingla_Artifacts/WORLD_MAP.md                      |   2 +
 ...ATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md | 261 +++++++++++++++
 ...RCH-0892-C_GATE_AND_INVARIANT_PROMOTE_REPORT.md | 163 ++++++++++
 .../SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md | 360 +++++++++++++++++++++
 7 files changed, 817 insertions(+), 21 deletions(-)
```

Zero touches to `mingla-business/src/`, `mingla-business/app/`, `app-mobile/`, `mingla-admin/src/`, `supabase/`, `packages/`. The single product-coded file (`.github/scripts/strict-grep/`) is in the ORCH-0840 exemption list.

### SC-9 — KeyboardRoot test suites

```
PASS src/wrappers/__tests__/KeyboardRoot.test.tsx (7.448 s)
PASS src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx (7.57 s)
PASS src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx (7.698 s)

Test Suites: 3 passed, 3 total
Tests:       85 passed, 85 total
Snapshots:   0 total
Time:        8.871 s
```

No regression. Same 85/85 result as prior QA.

---

## §8 Where this audit differs from the prior QA

The prior QA verdict is correct. This audit makes three additions:

1. **More adversarial SC-4 injection.** Prior tester injected a file with 1 forbidden pattern (ScrollView from RN + TextInput). This audit injected a file with 3 simultaneous forbidden patterns (KeyboardAvoidingView from RN + automaticallyAdjustKeyboardInsets + bare ScrollView in TextInput file). The gate caught all 3 distinct WARN sites in one run, proving the BLOCKING semantics generalize across the forbidden-pattern matrix — not just the one pattern the prior tester exercised.

2. **New discovery D-COSMETIC-INFORMATIONAL-STRING.** The gate's printed title at script line 246 still says `"informational gate"` — stale post-promotion. Cosmetic only, P4. Prior QA did not catch.

3. **Direct commit-scope verification.** This audit ran `git diff-tree --no-commit-id --name-only -r 8d290874 | grep -vE "..."` to prove zero product-code paths in `8d290874`'s file list. Prior QA verified via inspection of `git diff HEAD` (which mixes ORCH-0892-C's diff with parallel-session ORCH-0898/0903 work that was on Seth before the cherry-pick). Both approaches reach the same conclusion (SC-8 PASS), but the commit-scope grep is the cleaner proof.

---

## §9 Layman summary

**What I re-tested.** ORCH-0892-C is the third and final sub-ORCH of the ORCH-0892 [App-wide keyboard avoidance] arc — pure lock-in work. It (1) flips the CI gate from "warn-only" to "block any PR that uses the OLD keyboard-avoidance code", (2) promotes two architectural invariants from DRAFT to ACTIVE in the canonical registry, and (3) rewrites the operator-memory file so future Claude/Codex skill sessions cite the new SmartScrollView pattern as canonical instead of the deprecated Cycle 3 pattern.

The prior tester verdict was PASS. Operator asked for a second opinion. I re-ran every verification independently. My injection test used 3 different forbidden patterns in one file (more adversarial than the prior tester's 1-pattern injection); the gate caught all 3 with correct line numbers + exit code 1. After cleanup, the gate returns to exit 0 cleanly. All 85 existing KeyboardRoot tests still PASS. Both invariants now read ACTIVE in the registry. The memory file mentions SmartScrollView 9 times and quarantines the deprecated Cycle 3 pattern under a "DO NOT cite as patterns" section. Zero product-code touch in ORCH-0892-C's commit scope.

**What's new.** One cosmetic-only finding: the gate's printed title line still says "informational gate" — stale post-promotion. The exit code is correct (1 on violation, 0 on PASS); only the title string is stale. P4 cleanup opportunity; doesn't affect anything else.

**No user-visible change.** This ORCH ships zero user-facing behavior. The fix shipped in PR #151 (ORCH-0892-B v2) + the EAS OTA. ORCH-0892-C is the lock-in step that makes the bug class structurally impossible to reintroduce.

**Verdict: PASS — concurs with prior QA.** Orchestrator may proceed to CLOSE (or, given the cherry-pick has already happened, CLOSE is effectively done — see §10).

---

## §10 What's next

ORCH-0892-C was already closed when this audit ran (commit `8d290874` cherry-picked onto Seth). The ORCH-0892 arc is COMPLETE.

This audit produces no new dispatch. If you want the P4 cosmetic finding addressed, the smallest path is to either (a) bundle into the existing ORCH-0892-Bx [`IOS_DEV_BUILD_REBUILD_RUNBOOK.md` updates] follow-up so a runbook-edit cycle also touches the gate's title string, or (b) leave it indefinitely (the stale title is harmless and the rest of the gate's contract is correct).

---

**End of independent audit.**
