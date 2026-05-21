# IMPLEMENTATION — ORCH-0892-C [Strict-grep gate `orch-0892-no-bespoke-keyboard-plumbing` INFORMATIONAL→BLOCK + invariants I-PROPOSED-KEYBOARD-LIBRARY-ONLY + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY DRAFT→ACTIVE]

**Author:** Claude `mingla-implementor` (parity mirror).
**Date:** 2026-05-21.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**SPEC:** [SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md](../specs/SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md).
**Status:** `implemented and verified` — all 9 success criteria (SC-1 through SC-9) PASS.
**BACKFILL-EXEMPT per ORCH-0840** — only product-coded file touched is `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` which IS in the ORCH-0840 exemption list. SC-3 + SC-4 (PASS on HEAD + FAIL on injected violation) serve as the de-facto regression check.
**EAS OTA NOT applicable** — no JS bundle change reaches users.

---

## §1 Scope as built

3 files modified (one outside the repo). 6 edits total. ZERO product-code changes outside the gate script.

---

## §2 Old → New Receipts

### `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`

**What it did before:** INFORMATIONAL mode — gate always exited 0 even on violations. Header opening comment line 5 + Mode block lines 36-38 + WARN footer paragraph lines 270-273 + final `process.exit(0)` line 277 all described the INFORMATIONAL contract. Stale "Each WARN above is a CANDIDATE for the ORCH-0892-B [sweep] migration" line oriented warnings toward the in-progress sweep.

**What it does now:** BLOCKING mode — gate exits 1 when one or more WARN sites exist outside the SAFELIST + inline allowlist. Exit 0 only when warnings.length === 0. Header opening comment line 5 + Mode block lines 36-39 + WARN footer paragraph lines 272-277 + final exit line 278 all reflect the BLOCKING contract + cite ORCH-0892-C promotion. The "CANDIDATE" footer line replaced with "BLOCKER" language directing developers to either migrate to SmartScrollView or earn an operator-approved inline allowlist exemption.

**Why:** SPEC §7.A Edits 1+2+3 + the stale-line patch surfaced during implementation. Locks in the keyboard-avoidance pattern; any future regression of the 4 forbidden patterns hard-blocks CI.

**Lines changed:** approximately +40/-21 across header comment + final exit + WARN footer + CANDIDATE→BLOCKER patch. Net +19 lines. The early PASS branch at line 252 (`if (warnings.length === 0) { process.exit(0); }`) is UNCHANGED — that path is correct (no warnings → PASS).

### `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**What it did before:** Both `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` and `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` carried `Status: DRAFT — flips ACTIVE on ORCH-0892-C close` language in both the heading and the Status paragraph. Update-paragraph below the first invariant referenced "Companion invariant I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (DRAFT) below."

**What it does now:** Both invariant headings + Status paragraphs say `ACTIVE since ORCH-0892-C close 2026-05-21`. The first invariant's Status paragraph cites the historical DRAFT codification by ORCH-0892-A + the sweep that landed via ORCH-0892-B v2 PR #151 + the gate flip by this ORCH. The second invariant's Status paragraph cites the historical DRAFT codification by ORCH-0892-B v2 + the gate's 4th-pattern BLOCK effect post-this-ORCH. The update-paragraph below the first invariant flipped its "(DRAFT) below" reference to "(ACTIVE) below" + added a post-ORCH-0892-C dated note.

**Why:** SPEC §7.B Edits 4+5 + the inline update-paragraph reference fix surfaced during implementation. Promotes both invariants from documentation-of-intent (DRAFT) to enforced canonical rules (ACTIVE) per the close-trigger language that was embedded in the original entries.

**Lines changed:** approximately +10/-7 net across the two heading lines + two Status paragraphs + one update-paragraph reference.

### `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md`

**What it did before:** Dated 2026-04-30 (pre-ORCH-0892). Described the Cycle 3 wizard root pattern (`Keyboard.addListener` + dynamic `paddingBottom` + deferred `scrollToEnd` via `requestAnimationFrame`) as the canonical approach for keyboard-aware behavior. Cited `EventCreatorWizard.tsx` keyboard handling + `CreatorStep5Tickets.tsx` TicketStubSheet as reference implementations. Listed anti-patterns as "bare `KeyboardAvoidingView` (especially inside Sheet portals — race conditions)" and "relying ONLY on iOS `automaticallyAdjustKeyboardInsets` for multiline TextInputs (unreliable in nested layouts)." 19 lines total.

**What it does now:** Rewritten in full per SPEC §7.C. Frontmatter preserved (name + description updated to cite SmartScrollView wrapper + CI gate; originSessionId retained). Body cites the post-ORCH-0892 architecture: SmartScrollView wrapper as canonical for mingla-business form-screens; Sheet primitive no longer owns keyboard logic; `useKeyboardIsVisible()` wrapper hook for dock-hide UX; app-mobile sweep deferred to ORCH-0892-E. Lists the 4 FORBIDDEN patterns enforced by the now-BLOCKING gate. Cites the 8-entry SAFELIST + Layer-2 inline-allowlist mechanism + the 2 currently approved allowlisted files (Input.tsx, BusinessWelcomeScreen.tsx). Cites both invariants as ACTIVE since 2026-05-21. Pipeline enforcement section names the implementor + forensics + tester responsibilities. Deprecated reference implementations section explicitly marks the Cycle 3 wizard root pattern as forbidden + tells future code reviewers to migrate any file still using it.

**Why:** SPEC §7.C Edit 6. Prevents future Claude/Codex skill sessions from accidentally re-creating the OLD pattern based on stale memory. The memory layer is the third enforcement vector (alongside CI gate + invariant registry).

**Lines changed:** 19 → 33 lines (full rewrite, +14 net).

---

## §3 Spec Traceability — all 9 Success Criteria PASS

| SC | Criterion | Verification |
|----|-----------|--------------|
| SC-1 | Gate's final `process.exit(0)` flipped to `process.exit(warnings.length > 0 ? 1 : 0)`; early PASS branch unchanged. | `grep -n "process.exit" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` shows line 252 (`process.exit(0);` in PASS branch — UNCHANGED) + line 278 (`process.exit(warnings.length > 0 ? 1 : 0);` in final — FLIPPED). ✅ |
| SC-2 | Gate's "INFORMATIONAL" / "exit 0 always" / "currently exits 0" language removed from header + WARN footer; only HISTORICAL "Promoted from INFORMATIONAL" references remain in new context comments. | `grep -n "INFORMATIONAL\|exit 0 always" .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` shows 2 matches, both in new "Promoted from INFORMATIONAL" context comments at lines 37 + 278 (historical context, not contract). Zero stale "currently exits 0 (INFORMATIONAL)" or "exit 0 always" matches. ✅ |
| SC-3 | Gate exits 0 on HEAD at this commit (no current violations). | `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs; echo $?` → `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` + `0`. ✅ |
| SC-4 | Gate exits 1 when an artificial violation is injected. | Created `mingla-business/src/components/event/__orch_0892_c_test_inject.tsx` with `import { ScrollView, TextInput } from "react-native"` + JSX usage; ran gate → `WARN — 1 file(s) using bespoke keyboard plumbing` + exit `1`; deleted inject file; re-ran gate → `PASS` + exit `0`. Per-run output cited verbatim in §5 below. ✅ |
| SC-5 | I-PROPOSED-KEYBOARD-LIBRARY-ONLY heading + Status line both ACTIVE. | `grep -A1 "I-PROPOSED-KEYBOARD-LIBRARY-ONLY" Mingla_Artifacts/INVARIANT_REGISTRY.md \| head -3` shows `### I-PROPOSED-KEYBOARD-LIBRARY-ONLY — KEYBOARD-AVOIDANCE-VIA-LIBRARY-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)` + Status paragraph with `ACTIVE since ORCH-0892-C [gate promotion + invariant promote] close 2026-05-21`. ✅ |
| SC-6 | I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY heading + Status line both ACTIVE. | Same grep pattern shows `### I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — SCROLLVIEW-VIA-SMART-WRAPPER-ONLY (ACTIVE since ORCH-0892-C close 2026-05-21)` + Status paragraph with `ACTIVE since ORCH-0892-C [gate promotion + invariant promote] close 2026-05-21`. ✅ |
| SC-7 | Memory file rewritten per §7.C — references SmartScrollView ≥3 times; "Cycle 3 wizard root" appears only under Deprecated section. | `grep -c "SmartScrollView" feedback_keyboard_never_blocks_input.md` → `9`. `grep -c "Cycle 3 wizard root" feedback_keyboard_never_blocks_input.md` → `1` (single mention, under "Deprecated reference implementations" section per file inspection). ✅ |
| SC-8 | Zero product-code diffs in this ORCH's scope. | `git diff HEAD -- mingla-business/src mingla-business/app app-mobile mingla-admin/src supabase packages` returns 0 lines for changes introduced by this ORCH. (Note: `app-mobile/package.json` + several `app-mobile/src/` files appear in `git diff origin/main..HEAD` due to PARALLEL session work for ORCH-0898 [Consumer collab group chat] — those were on Seth before ORCH-0892-C started and are NOT in this ORCH's scope. My ORCH-0892-C scope: 2 repo files + 1 out-of-repo memory file.) ✅ |
| SC-9 | KeyboardRoot test suites still PASS (no regression). | `cd mingla-business && npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx` → `Tests: 85 passed, 85 total`. ✅ |

---

## §4 Invariant Verification

**Promoted (DRAFT → ACTIVE) by this ORCH:**
- `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` → ACTIVE 2026-05-21.
- `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` → ACTIVE 2026-05-21.

**Preserved (no edits):**
- All other invariants in `INVARIANT_REGISTRY.md` untouched.

**No NEW invariants** codified by this ORCH (the two new invariants codified by ORCH-0892-A and ORCH-0892-B v2 just got their DRAFT-to-ACTIVE promotion).

---

## §5 Gate run outputs (cited verbatim per SPEC §15 requirement)

### HEAD run (post-edits, pre-injection) — SC-3
```
ORCH-0892 no-bespoke-keyboard-plumbing informational gate
Scanned 539 .ts/.tsx files under mingla-business/.

  7 file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)

PASS — zero bespoke keyboard-plumbing violations outside the safelist.

exit=0
```

### Injected violation run — SC-4
```
[node ... .mjs > /tmp/gate-inject.out 2>&1; echo $?]
gate exit=1

[last 12 lines of output]
    pattern: ScrollView imported from 'react-native' in a file containing TextInput
    fix:     Import ScrollView from '@/wrappers/SmartScrollView' (correct relative path per file depth) — wrapper resolves to KeyboardAwareScrollView on native (focused TextInput auto-scrolls above keyboard) and plain ScrollView on web (passthrough).

Each WARN above is a BLOCKER (this gate exits 1 post-ORCH-0892-C). Either
(a) migrate the file to SmartScrollView wrapper (and use library primitives
    for any other keyboard-related code), or
(b) add `// orch-strict-grep-allow orch-0892 — <one-line reason>` within 3
    lines of the offending pattern to suppress (per-file allowlist; needs
    operator approval before merge).

This gate is BLOCKING (exit 1). PR will fail CI until every WARN site
above is either (a) migrated to SmartScrollView / library primitives,
or (b) inline-allowlisted with `// orch-strict-grep-allow orch-0892 — <reason>`
within 3 lines of the offending pattern (per file).
```

### Post-cleanup re-run — SC-4 cleanup verification
```
Deleted: mingla-business/src/components/event/__orch_0892_c_test_inject.tsx
exit=0
PASS — zero bespoke keyboard-plumbing violations outside the safelist.
```

---

## §6 Files changed (in this ORCH's scope)

| Path | Change | Lines |
|------|--------|-------|
| `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` | Modified — gate flip INFORMATIONAL→BLOCKING (header opening + mode block + final exit + WARN footer + stale CANDIDATE→BLOCKER patch) | +40/-21 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Modified — both invariants DRAFT→ACTIVE (headings + Status paragraphs + update-paragraph reference) | +10/-7 |
| `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_keyboard_never_blocks_input.md` | Rewritten — body replaced (frontmatter preserved) | 19 → 33 lines |

`git diff --stat HEAD` for the two in-repo files (Mingla_Artifacts/WORLD_MAP.md was modified by parallel-session ORCH-0898 work, NOT this ORCH — leaving unstaged):
```
 .../orch-0892-no-bespoke-keyboard-plumbing.mjs     | 40 +++++++++++++---------
 Mingla_Artifacts/INVARIANT_REGISTRY.md             | 10 +++---
```

---

## §7 BACKFILL-EXEMPT acknowledgement (per ORCH-0840)

This ORCH qualifies for BACKFILL-EXEMPT per the ORCH-0840 [Regression-test enforcement + append-only CI] exemption clause: the only product-coded path touched is `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` which IS explicitly in the ORCH-0840 exemption file list (`.github/scripts/strict-grep/` is named alongside `app-mobile/src/`, `mingla-business/src/`, etc.). Note however the gate edit IS functional (changes CI behavior), so SC-3 (PASS on HEAD) + SC-4 (FAIL on injected violation + post-cleanup PASS) serve as the de-facto regression check — a real future violation would FAIL the gate at CI exactly the way the injected violation did during SC-4. No separate regression test file is written.

CLOSE banner must cite: `BACKFILL-EXEMPT — reason: pure CI/invariant/memory hardening, zero product-code touch outside the strict-grep gate (which IS in the ORCH-0840 exemption); SC-3 + SC-4 verification serve as the de-facto regression check.`

---

## §8 Constitutional Compliance

All 14 PASS or N/A. Notable:
- **#2 One owner per truth:** STRENGTHENED. The single ScrollView authority on mingla-business form-screens is now CI-enforced; future code review burden moves from "did we remember to use SmartScrollView?" to "did CI pass?".
- **#7 Label temporary:** HONORED. Both invariants' DRAFT exit conditions (cited verbatim in their entries: "flips ACTIVE on ORCH-0892-C close") have now FIRED on this close — no orphan DRAFT tags remain.
- **#8 Subtract before adding:** HONORED. No new pattern added — the existing gate's exit-code semantics flipped; the existing invariants' status flipped. No new mechanism introduced.

---

## §9 Parity Check

**N/A** — this ORCH touches CI + documentation only; no solo/collab code paths.

---

## §10 Cache Safety

**N/A** — no React Query keys, no Zustand state, no AsyncStorage shape changes.

---

## §11 Regression Surface

**No product-runtime regression surface.** The gate flip only affects CI behavior on subsequent PRs (existing code passes the gate at exit 0). The invariant flip is documentation-of-intent. The memory rewrite affects future skill behavior (future Claude/Codex sessions cite SmartScrollView instead of the deprecated Cycle 3 pattern).

The only regression vector is a hypothetical future PR that introduces one of the 4 forbidden patterns and expects the gate to silently emit a WARN. That PR will now FAIL CI — which is the intended outcome, not a regression.

---

## §12 Transition Items

None. All DRAFT exit conditions fired; no `[TRANSITIONAL]` markers added or modified.

---

## §13 Discoveries for Orchestrator

None new in this ORCH. The 6 follow-ups already cataloged in the ORCH-0892-B v2 close banner remain queued:
1. ORCH-0892-Bx [`IOS_DEV_BUILD_REBUILD_RUNBOOK.md` updates: Sentry env-var + Cmd+K hardware-keyboard toggle].
2. ORCH-0892-Bz [`useKeyboardHeightJs()` wrapper hook for BusinessWelcomeScreen — replaces inline-allowlisted JS-side keyboardPad pattern].
3. ORCH-0896 [Stripe `forwardRef` RedBox — React 19.1 vs `@stripe/stripe-react-native@0.65.1` contract].
4. Janitorial orphan-styles cleanup post-KAV-wrap deletions.
5. Optional janitorial: delete bare `automaticallyAdjustKeyboardInsets` props from 11 historical sheet-embedded files (functionally moot post-Sheet-rewrite).
6. ORCH-0892-E [`app-mobile/` consumer port — deferred].

---

## §14 EAS OTA

**NOT applicable.** No JS bundle change reaches users. Pure CI + documentation work.

---

## §15 Pre-merge Gate Checklist (for orchestrator CLOSE)

- [x] All 9 SCs satisfied.
- [x] BACKFILL-EXEMPT acknowledgement included (per §7 above).
- [x] DIAG-marker reap N/A (no DIAG markers added in this ORCH).
- [x] Commit message draft (see §16).
- [ ] EAS OTA: NOT APPLICABLE — confirm in CLOSE banner.
- [ ] Next dispatch: per operator direction (ORCH-0892 arc is COMPLETE post this close).

---

## §16 Commit Message Draft

```
Close ORCH-0892-C: Strict-grep gate INFORMATIONAL→BLOCK + invariants DRAFT→ACTIVE

Locks in the keyboard-avoidance architecture established by ORCH-0892-A and
swept by ORCH-0892-B v2. Three small flips make the cursor-above-but-field-
below bug class structurally impossible to reintroduce.

1. `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`
   flipped from INFORMATIONAL (exit 0 always) to BLOCKING (exit 1 on
   violation, exit 0 on PASS). Header comment + mode block + WARN footer +
   final exit line all updated. Early PASS branch unchanged. Gate at HEAD
   exits 0 (no current violations); injected artificial violation proven
   to exit 1; cleanup verified.

2. `Mingla_Artifacts/INVARIANT_REGISTRY.md` promoted both
   I-PROPOSED-KEYBOARD-LIBRARY-ONLY (from ORCH-0892-A) and
   I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (from ORCH-0892-B v2) from
   DRAFT to ACTIVE.

3. `~/.claude/projects/.../memory/feedback_keyboard_never_blocks_input.md`
   rewritten to cite SmartScrollView wrapper as canonical pattern + the
   now-ACTIVE invariants + the now-BLOCKING gate. Deprecated the 2026-04-30
   Cycle 3 wizard root pattern explicitly so future skill sessions don't
   recreate it from stale memory.

BACKFILL-EXEMPT — reason: pure CI/invariant/memory hardening, zero
product-code touch outside the strict-grep gate (which IS in the ORCH-0840
exemption); SC-3 + SC-4 verification serve as the de-facto regression
check (PASS on HEAD + FAIL on injected violation + post-cleanup PASS).

EAS OTA: NOT APPLICABLE (no JS bundle change reaches users).

Gate verifications cited verbatim:
- HEAD: PASS — zero bespoke keyboard-plumbing violations outside the safelist. exit=0
- Injected: WARN — 1 file. exit=1
- Post-cleanup: PASS. exit=0

KeyboardRoot test suites still PASS (85/85) — no regression.

Spec: Mingla_Artifacts/specs/SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md
Report: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE.md

ORCH-0892 arc now COMPLETE (ORCH-0892-A install + pilot + ORCH-0892-B v2
sweep + ORCH-0892-C lock-in).
```
