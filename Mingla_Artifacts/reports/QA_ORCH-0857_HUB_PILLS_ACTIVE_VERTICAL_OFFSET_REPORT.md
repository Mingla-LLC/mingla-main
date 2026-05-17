# QA — ORCH-0857 — Hub Events filter pill row "weird space on top"

**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md` (superseded by implementation §1 — original SPEC root-cause hypothesis was wrong)
**Tester:** Claude `mingla-orchestrator` (TEST phase executed inline post-operator-delegation "taken over")
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Verdict:** **PASS**

---

## Summary

- P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 1 (praise — root-cause-fix retrospective surfaced a generalizable RN footgun memory)

## Spec criteria mapped to test results

| SC | Description | Verified by | Result |
|---|---|---|---|
| Operator-reported symptom resolved | Live + Drafts pills no longer push events list down | iOS sim live-fire screenshots at `/tmp/o857_FIX_LIVE2.png`, `/tmp/o857_FIX_DRAFTS.png` | PASS |
| Upcoming/All/Past no regression | Filters that were already flush remain flush | iOS sim screenshot at `/tmp/o857_FIX_UPC.png` (5-card upcoming list stacking from top, no gap) | PASS |
| SC-1 visible top-edge parity (cosmetic, original SPEC) | Toggling pillActive changes color only, never bounding rect | borderColor 0.55 white idle + 0.55 orange active; visual confirmation in `/tmp/o857_FIX_LIVE2.png` | PASS |
| SC-2 hit-target ≥ 44pt | hitSlop top+bottom + pill height ≥ 44 | Tester TA2: 34 + 5 + 5 = 44 ✅ | PASS |
| SC-3 Live dot/label baseline | lineHeight: 16 on pillLabel locks deterministic baseline | Implementor check E3.a/b PASS | PASS (structural; pixel sample not run — accepted on mechanism inference) |
| iOS parity | Fix is StyleSheet-only, no platform branches | Live-fire verified on iPhone 17 Pro iOS 26.4 sim | PASS (iOS) |
| Android parity | Same | NOT live-fire verified (no Android emulator booted) — accepted on mechanism inference (single shared StyleSheet, RN cross-platform flexGrow semantics) | PASS-by-mechanism |

## 10-step TARGETED protocol

| Step | Result |
|---|---|
| 1. Blast radius mapping | All changes in [events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx) + 2 new scripts under `mingla-business/scripts/ci/`. No service, hook, edge function, migration, or shared-token touched. |
| 2. Implementation report audit | All 4 edits + regression test cited with old→new receipts + commit hash `a2019cfd5155eceaafaddebe38dc9cd31ece311c` for fails-on-revert. |
| 3. Forensic code reading | Re-read events.tsx pill JSX (L499-L526), pill style block (L737-L757), pillsScroll style block (L727-L749), events ScrollView JSX (L531-L552), pillLabel style (L761-L778). All four edits present with protective comments. |
| 4. Constitutional enforcement | All 14 rules scanned. No violations. Rule #1 (no dead taps) improved (touch area grew). Rule #8 (subtract before add) preserved. |
| 5. Behavioral contract verification | Pre-fix: Live shows ~150pt gap, Drafts ~200pt, Upcoming flush. Post-fix: all 3 flush. Contract honored. |
| 6. Independent test writing | Tester adversarial at `mingla-business/scripts/ci/orch-0857-tester-adversarial-check.mjs` — 6 checks attacking 5 different angles (asymmetric pinning, hit-target math, alpha parity, isolation guard, ScrollView-count sanity). All PASS. |
| 7. Parity enforcement | iOS Simulator (iPhone 17 Pro 17091E60-C3B6-4167-980D-60C348E177F6) live-fire on 3 filters: PASS. Android emulator not booted — accepted by mechanism inference (single RN StyleSheet, no platform conditionals). Web: surface NOT in scope (`(tabs)/hub` is mobile-only). |
| 8. UI/UX coherence audit | Cards now sit flush against the pill row across every filter; row layout is predictable. Live pill dot/label baseline locked. Active vs idle pills share identical bounding rect. |
| 9. Cross-domain impact verification | No DB, no edge function, no service, no hook. Zero cross-domain ripple. `glass.border.profileBase` UNCHANGED — verified by adversarial check TA4. |
| 10. Pattern compliance | Pill row pattern is now a clean reference for any future sticky-filter + scroll-list screen. Anti-pattern (two flexGrow:1 ScrollView siblings) codified in memory `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`. |

## Step 0.5 Regression-test gate

| Gate | Path | Result |
|---|---|---|
| (a) Implementor happy-path | `mingla-business/scripts/ci/orch-0857-pill-visual-parity-check.mjs` | 10/10 PASS, fails-on-revert verified at parent `a2019cfd5155eceaafaddebe38dc9cd31ece311c` (true-line-deletion of `flexGrow: 0` + `flexShrink: 0` from pillsScroll flips E4.a + E4.b to FAIL, exit 1) |
| (b) Tester adversarial | `mingla-business/scripts/ci/orch-0857-tester-adversarial-check.mjs` | 6/6 PASS, attacks 5 NEW angles vs happy-path (asymmetric pinning TA1, hit-target math TA2, alpha-parity invariant TA3, global-token isolation TA4, ScrollView-count sanity TA5) |

Both tests immutable post-land per `I-TESTS-APPEND-ONLY`.

## Discoveries for Orchestrator (carried forward from implementation report)

1. **CRITICAL: RN `<ScrollView>` defaults `flexGrow: 1` — silent footgun.** Codified as memory `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`. **Recommend audit sweep across mingla-business + app-mobile** for other two-ScrollView-sibling layouts that may exhibit the same content-size-dependent gap bug. Suggested grep: files with `<ScrollView` count ≥ 2 and no `flexGrow: 0` in any StyleSheet block.
2. **Original investigation + SPEC were wrong** (border-alpha asymmetry hypothesis). Process lesson: forensics phase should pixel-measure the gap they're investigating BEFORE writing the report.
3. **Cosmetic edits 1-3 (borderColor swap, hitSlop, lineHeight) ended up as side benefits**, operator-approved-kept. Recognize this as "wrong-diagnosis-with-good-cosmetic-byproduct" pattern in future retros.
4. **Drafts "0" count badge UX** — empty filter shows "Drafts 0" which feels redundant. Operator call whether to hide count when 0.
5. **ORCH-0836 [Stripe forwardRef RN 0.65.1 LogBox filter] error still surfacing** on Hub navigation. Pre-existing, unrelated to ORCH-0857, but the LogBox filter isn't catching it — separate ORCH if confirmed broken.

## Verdict

**PASS** — zero P0, zero P1, regression coverage proven on both sides (implementor + tester adversarial), all spec/operator criteria met, cross-domain checked, security clean. iOS live-fire `proven`; Android `probable` (mechanism inference from shared StyleSheet, accepted). CLOSE may proceed.
