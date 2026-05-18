# IMPLEMENTATION — ORCH-0873 [Tr3 Stage 2 UI] P1 `glass.tint.chrome` HOTFIX

**Skill:** Claude `mingla-implementor` (parity mirror; canonical IMPLEMENT owner is Codex `implementor-mingla`)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatched by:** prior Claude `mingla-forensics` (INVESTIGATE mode) handoff after PROVEN verdict at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0873_P1_GLASS_TINT_CHROME_LIVEFIRE.md`.
**Status:** `implemented and verified`.

---

## Layman summary

4-character mechanical patch to `mingla-business/src/components/trip/PaymentPlanEditor.tsx` at 4 sites (lines 765, 822, 859, 877): changed `backgroundColor: glass.tint.chrome,` → `backgroundColor: glass.tint.chrome.idle,`. The bare object reference was misuse — `glass.tint.chrome` is `{idle, pressed}` (object), and `@react-native/normalize-colors` returns `null` for object input, which RN paints as transparent. The `.idle` suffix selects the correct color string (`rgba(12,14,18,0.48)` per `designSystem.ts:200-203`). Stepper +/- buttons, segmented control (Days / Fixed date), days input, and date picker trigger now render with their intended dark glass chrome backdrop. Forensics adversarial test goes 16/18 → 18/18; implementor's 32-test suite stays 32/32.

---

## Old → New receipt

### `mingla-business/src/components/trip/PaymentPlanEditor.tsx`
- **What it did before:** Passed `glass.tint.chrome` (an object `{idle, pressed}`) as `backgroundColor` at 4 sites — `stepperBtn` (line 765), `segmentedHost` (line 822), `daysInput` (line 859), `dateInputRow` (line 877). `@react-native/normalize-colors` returns `null` for object input → backgroundColor renders transparent → stepper buttons, segmented control, days input, and date picker trigger appear as borderless-with-text areas blending into the lighter card glass instead of standing out as dark chrome chips.
- **What it does now:** Passes `glass.tint.chrome.idle` (the string `rgba(12,14,18,0.48)` per `designSystem.ts:200-203`) at all 4 sites. `normalizeColor` returns a valid 32-bit color int → backgroundColor renders as the intended dark glass chrome backdrop.
- **Why:** P1 PROVEN by prior forensics INVESTIGATE-mode session at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0873_P1_GLASS_TINT_CHROME_LIVEFIRE.md` (line-1 verdict; runtime mechanism test on `@react-native/normalize-colors` proves the deterministic null-on-object behavior; comprehensive grep shows every other consumer in the codebase (BottomNav, GlassChrome, IconChrome, QuantityRow, BlastCustomersCta, MarketingSubNav, SelectionFormattingTooltip, EventListCard, __styleguide) uses the correct `.idle` or `.pressed` path).
- **Lines changed:** 4 (single-character `.idle` suffix appended to each occurrence).

No other files touched. No other lines in PaymentPlanEditor.tsx touched.

---

## Verification

### Patch evidence
```
$ grep -n 'glass\.tint\.chrome' mingla-business/src/components/trip/PaymentPlanEditor.tsx
765:    backgroundColor: glass.tint.chrome.idle,
822:    backgroundColor: glass.tint.chrome.idle,
859:    backgroundColor: glass.tint.chrome.idle,
877:    backgroundColor: glass.tint.chrome.idle,
```

All 4 sites now end in `.idle,` — no bare `chrome,` remains.

### Test suite — adversarial (the test that catches THIS bug)
```
$ cd mingla-business && npx jest src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
Time:        2.82 s
```

A-01 (token-shape contract) now green — both sub-tests pass:
- `PaymentPlanEditor.tsx must NOT use glass.tint.chrome as a backgroundColor (must use .idle or .pressed)` ✓
- `no production source file under src/ + app/ may use glass.tint.chrome as a bare backgroundColor` ✓

The codebase-wide walk in A-01's second sub-test serves as the live grep confirmation: zero file hits across all `.ts`/`.tsx` under `mingla-business/src/` + `mingla-business/app/`.

### Test suite — implementor regression (sanity check, no regression)
```
$ cd mingla-business && npx jest src/components/trip/__tests__/PaymentPlanEditor.test.ts
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
Time:        3.282 s
```

All 32 source-assertion tests still pass. None reference the broken pattern (they pin SPEC constants + literal copy + presence of specific code patterns), so the patch was orthogonal to their coverage as expected.

### Regression test gate (ORCH-0840)

**Implementor happy-path:** `mingla-business/src/components/trip/__tests__/PaymentPlanEditor.test.ts` (32/32 PASS) — pre-existing from the ORCH-0873 implementor session; covers SC-locked constants and presence patterns. Confirms no regression from this hotfix.

**Tester adversarial:** `mingla-business/src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts` (18/18 PASS) — pre-existing from the prior forensics TEST-mode session; A-01 specifically pins the corrected token-shape pattern. This test was authored BEFORE the patch and was FAILING (2/18 on A-01) on the broken state — that is the canonical "fails-on-revert" proof. After the patch lands, it passes 18/18. Reverting the patch (`sed -i '' 's/backgroundColor: glass\.tint\.chrome\.idle,/backgroundColor: glass.tint.chrome,/g' PaymentPlanEditor.tsx`) reintroduces the bug and A-01 fails again. This satisfies the "fails-on-revert verified" requirement of the ORCH-0840 gate without needing a new test file.

**No additional implementor regression test written for this hotfix** — the existing adversarial test catches the bug class precisely (codebase-wide bare-pattern scan + this-file-specific bare-pattern scan), and adding a third redundant test would only add maintenance burden. The gate's spirit ("a test that fails on broken state and passes on fixed state ships in the closing PR") is fully satisfied by the existing pair.

Both test files are present in the working tree, untracked (`??`) per ORCH-0873's pending-close state. They ship together with this patch in the single ORCH-0873 closing PR per one-PR-per-CLOSE rule.

---

## Pre-flight Step 3.5 — Cross-surface impact

This hotfix is a single string change in a single React Native component file consumed by:

| Surface | Affected? | User-visible change | Parity |
|---|---|---|---|
| Consumer iOS | NO | n/a — no trip surface on consumer app | n/a |
| Consumer Android | NO | n/a — same | n/a |
| Buyer/anon Web (`mingla-business/` /checkout, /t, /e, /b) | NO | n/a — PaymentPlanEditor is planner-only | n/a |
| Business iOS | YES | Stepper buttons + segmented control + days input + date picker trigger on Trip Wizard Step 4 (with Payment plan toggled ON) now render with dark glass chrome backdrop. | Automatic — single RN code path |
| Business Android | YES | Same. | Automatic — same RN file |
| Admin Web | NO | n/a — no admin trip wizard | n/a |
| Business Web preview | YES (follows along) | Same; RN-Web also processes through `@react-native/normalize-colors`. | Automatic |

Parity automatic across all 3 covered surfaces because the affected file is a single shared component.

---

## Invariant preservation

- `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (ACTIVE): no backend touch; preserved.
- `I-38` (44pt touch target): preserved — stepper buttons stay 44×44, no size change.
- `I-39` (accessibilityLabel on interactive Pressables): preserved — no Pressable touched.
- Constitution #1–14: zero violations. The fix removes a runtime visual bug; it does not introduce new behavior, dead taps, silent failures, fabricated data, currency issues, or any constitutional concern.

---

## Discoveries for orchestrator

1. **Follow-up ORCH already proposed by the prior forensics session:** `I-PROPOSED-DESIGN-TOKEN-OBJECT-SHAPE-PROTECTION` — a CI strict-grep gate that flags bare references to object-shaped tokens (`glass.tint.chrome` / `glass.tint.badge`) not followed by `.idle` or `.pressed`. Would prevent this exact bug class at PR time. ~20-line `.mjs` script + 1 workflow job. Register as a separate small ORCH after ORCH-0873 closes.
2. **TS-debt cleanup ORCH still pending:** the 53 TS errors in PaymentPlanEditor.tsx + MoneyTabBody (style-array union narrowing) actively masked this real runtime bug. Until those are zero, `tsc --noEmit` can't serve as a static safety net here. Per ORCH-0874 [Trip surfaces visual parity with Events] spec §1.2 hard guard, these TS-debt errors are explicitly out of scope for ORCH-0874. They need their own follow-up ORCH.
3. **Process finding (tester skill update candidate):** the prior TEST-mode session stopped at `probable` confidence because it conflated "live-fire" with "iOS sim screenshot". For JS-layer mechanism bugs (color normalization, style flatten, prop validation), Node-level mechanism tests on the actually-installed library achieve `proven` confidence WITHOUT requiring on-device sim. Recommend updating the canonical `mingla-tester` reference to specify this distinction explicitly. The prior forensics INVESTIGATE-mode session at `INVESTIGATION_ORCH-0873_P1_GLASS_TINT_CHROME_LIVEFIRE.md` §3 documents the lesson in full.

---

## Files in working tree (untracked, awaiting close-time commit)

All ORCH-0873 implementor files + the prior forensics session's adversarial test + this hotfix all remain untracked. The single ORCH-0873 closing PR must `git add` the following per one-PR-per-CLOSE rule:

**Pre-existing from ORCH-0873 implementor session (14 files):**
- `mingla-business/src/copy/installmentReassurance.ts`
- `mingla-business/src/services/orderInstallmentsService.ts`
- `mingla-business/src/hooks/useOrderInstallments.ts`
- `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`
- `mingla-business/src/components/trip/PaymentPlanEditor.tsx` (with this hotfix applied)
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`
- `mingla-business/src/components/trip/TripCreatorWizard.tsx`
- `mingla-business/src/services/tripsService.ts`
- `mingla-business/app/trip/[id]/index.tsx`
- `.github/scripts/strict-grep/i-proposed-tr3-installment-customer-durability.mjs`
- `.github/scripts/strict-grep/i-proposed-tr3-schedule-currency-pinned-at-publish.mjs`
- `.github/workflows/strict-grep-mingla-business.yml`
- `mingla-business/src/components/trip/__tests__/PaymentPlanEditor.test.ts`

**From prior forensics TEST-mode session:**
- `mingla-business/src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts`

**From prior forensics INVESTIGATE-mode session + this hotfix (artifact + report files):**
- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0873_P1_GLASS_TINT_CHROME_LIVEFIRE.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0873_P1_GLASS_TINT_CHROME_LIVEFIRE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0873_TR3_STAGE_2_UI_REPORT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0873_TR3_STAGE_2_UI.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0873_P1_GLASS_TINT_CHROME_HOTFIX.md` (this file)

---

## DIAG-marker reap

`grep -rn '\[ORCH-0873-DIAG\]'` across product code returns zero. Nothing to reap.

---

## Next dispatch

Operator runs orchestrator CLOSE for ORCH-0873. Verdict from this hotfix elevates the prior `QA_ORCH-0873_TR3_STAGE_2_UI_REPORT.md` from FAIL to PASS — the 4 deferred SCs (SC-5a/5b/5c + SC-6) remain operator-pre-accepted as deferred to a follow-up implementor pass on `ticketCheckoutService`/`tripCheckoutService` response-shape extension. After CLOSE merges the single ORCH-0873 PR (Seth → main), ORCH-0874 [Trip surfaces visual parity with Events] implementor dispatch can proceed.

End of implementation report.
