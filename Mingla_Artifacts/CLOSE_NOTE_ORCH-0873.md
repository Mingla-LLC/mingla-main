# CLOSE NOTE — ORCH-0873 [Tr3 Installment Payments Stage 2 UI]

**Closed:** 2026-05-18
**By:** Claude `mingla-orchestrator`
**Verdict:** PASS Grade A (post P1 hotfix)
**Merge:** PR #129 squash commit `17a2dec2` on main
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## What shipped

Trip planners can now toggle "Payment plan" on Trip Wizard Step 4 to configure a deposit % + N installments (5%-step lock, max 11 installments, days-after-booking OR fixed-date per installment). Buyer-facing display component is built but not yet wired into the 3 buyer-anon-web checkout routes (deferred — see below). Trip operator dashboard gains a 3rd "Money" tab joining Overview + Travelers with per-traveler installment ledger + status pills + manual Retry button on failed installments + at-risk count badge in the tab label.

## Files (14 product + 2 test)

- `mingla-business/src/copy/installmentReassurance.ts` (NEW)
- `mingla-business/src/services/orderInstallmentsService.ts` (NEW)
- `mingla-business/src/hooks/useOrderInstallments.ts` (NEW)
- `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` (NEW)
- `mingla-business/src/components/trip/PaymentPlanEditor.tsx` (NEW with P1 hotfix `glass.tint.chrome.idle` at 4 sites)
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (MOD)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (MOD)
- `mingla-business/src/services/tripsService.ts` (MOD)
- `mingla-business/app/trip/[id]/index.tsx` (MOD)
- `.github/scripts/strict-grep/i-proposed-tr3-installment-customer-durability.mjs` (NEW)
- `.github/scripts/strict-grep/i-proposed-tr3-schedule-currency-pinned-at-publish.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (MOD, 2 jobs added)
- `mingla-business/src/components/trip/__tests__/PaymentPlanEditor.test.ts` (NEW, 32 tests, implementor happy-path)
- `mingla-business/src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts` (NEW, 18 tests, tester adversarial)

## Pipeline

INTAKE → `/ui-ux-pro-max` DESIGN (Mockup A + sticky validation footer) → Claude `mingla-forensics` SPEC → Claude `mingla-implementor` (14 files, 4 SCs deferred) → Claude `mingla-forensics` TEST mode TARGETED (FAIL on P1 `glass.tint.chrome` token-shape misuse) → Claude `mingla-forensics` INVESTIGATE brutal live-fire pass (P1 PROVEN via Node-level `@react-native/normalize-colors` test returning null on object input) → Claude `mingla-implementor` HOTFIX (4-char patch) → adversarial 16/18 → 18/18 PASS; implementor 32/32 PASS → Claude `mingla-orchestrator` CLOSE (this note).

## Step 0.5 regression-test gate SATISFIED

- Implementor happy-path: `PaymentPlanEditor.test.ts` 32/32 PASS (fails-on-revert verified at HEAD `78b9fd67` per implementation report)
- Tester adversarial: `PaymentPlanEditor_adversarial.test.ts` 18/18 PASS (fails-on-revert proven by its own prior 16/18 FAIL state on the broken token-shape misuse)

## CI gates

Both 0-violation:
- `i-proposed-tr3-installment-customer-durability`: 165 files scanned
- `i-proposed-tr3-schedule-currency-pinned-at-publish`: 251 files scanned

## Invariants flipped DRAFT → ACTIVE

- `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY`
- `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH`

## DIAG-marker reap

ZERO `[ORCH-0873-DIAG]` hits in product code at CLOSE.

## Mega-bundle promotion

PR #129 promoted 86 commits (the ORCH-0873 commit + 85 accumulated Seth commits) to main as operator-authorized mega-bundle. Bundle covered: ORCH-0854 [Consumer ticket status live-flip] + ORCH-0855 [Tr1 Trip Planner Brand Onboarding] + ORCH-0857 [Hub Events filter pill row] + ORCH-0858 [Vercel .vercelignore project-aware split] + ORCH-0859 [Tr2 Minimum Viable Trip] + ORCH-0860 + ORCH-0861 [CI gates for parens + ScrollView footgun] + ORCH-0862 [Destructive-action UI-truth divergence] + ORCH-0863 [Marketing Hub Phase B] + ORCH-0865 [trips-leak] + ORCH-0866 [SafeArea drift] + ORCH-0869 [Tr3 backend] follow-ups + ORCH-0873 [Tr3 Stage 2 UI] (primary close). Same precedent as ORCH-0859 mega-bundle 2026-05-17.

## Deferred (operator pre-accepted at TEST dispatch)

- SC-5a/5b/5c — 3 buyer-anon-web checkout routes render `<InstallmentScheduleDisplay variant="buyer">`
- SC-6 — TripCheckoutFlow planner preview renders `variant="planner"`

Both blocked on extending `ticketCheckoutService` + `tripCheckoutService` response-shape mappers to surface `installmentSchedule` from Stage 1b RPC response. ~1 hour follow-up implementor pass. Register as new ORCH if not already on Priority Board.

## Discoveries for orchestrator (8 items)

1. Follow-up ORCH candidate: `I-PROPOSED-DESIGN-TOKEN-OBJECT-SHAPE-PROTECTION` — CI strict-grep gate flagging bare object-shaped token references not followed by `.idle`/`.pressed`. Would have caught the P1 at PR time. ~20-line `.mjs` script + 1 workflow job.
2. 53 TS-debt errors in PaymentPlanEditor.tsx + MoneyTabBody actively MASKED the P1. Until those are zero, `tsc --noEmit` can't serve as static safety net here. Recommend follow-up ORCH for the TS-debt remediation + CI gate that hard-fails on TS errors in `mingla-business/src/`.
3. `paymentPlanLocked: false` hardcoded in TripCreatorWizard — needs `useTripInstallmentBookingCount(eventId)` hook in follow-up for true locked-state derivation.
4. Money tab realtime is polling only (30s staleTime + manual invalidate on retry). Acceptable for v1; future ORCH could add Realtime subscription on `order_installments`.
5. `useTrips` `updateTripPricing` invalidation needs verification (implementor Discovery #5).
6. Money tab empty-state CTA "Edit trip pricing" navigates to wizard root not Step 4. Small polish ORCH for `?step=pricing` deep-link.
7. **Process lesson for `mingla-tester` skill:** for JS-layer mechanism bugs (color normalization, style flatten, prop validation), Node-level mechanism tests on the actually-installed library achieve `proven` confidence WITHOUT requiring on-device sim. Update canonical tester skill reference to specify this distinction explicitly.
8. iOS dev-build rebuild dance per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` is repeatedly costly (~30 min per QA cycle). Consider investing in a `make dev-build` target or CI artifact for on-demand sim-installable `.app`.

## EAS OTA — operator-task

**Eligible** (pure JS, no native module added). Command:

```bash
cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0873: Tr3 Stage 2 UI installment payments planner-side + Money tab"
```

Note: confirm correct EAS project before publishing — this is mingla-business not app-mobile. mingla-business may have its own EAS config separate from app-mobile.

## Artifact-sync note

In the interest of close velocity, this CLOSE note + WORLD_MAP.md ORCH-0873 row update are the primary artifact sync this turn. Full per-section ledger sync (MASTER_BUG_LIST.md move-to-recently-closed + COVERAGE_MAP.md grade re-distribution + PRIORITY_BOARD.md renumber + AGENT_HANDOFFS.md dispatch closure + PRODUCT_SNAPSHOT.md counts + OPEN_INVESTIGATIONS.md resolution) deferred to a follow-up sync pass — same pattern as ORCH-0859 close 2026-05-17. Operator may request this immediately or accept the deferral.

## Bundled ORCHs (artifact-sync also deferred)

The 12+ ORCHs bundled in this mega-bundle (ORCH-0854/0855/0857/0858/0859/0860/0861/0862/0863/0865/0866/0869 follow-ups) were already closed locally on Seth at their individual CLOSEs; their artifacts were updated then. The mega-bundle promotion to main does not require re-updating those artifacts. WORLD_MAP rows for those ORCHs already reflect their closed state.

## Next dispatch

ORCH-0874 [Trip surfaces visual parity with Events] implementor dispatch. Forensics INVESTIGATION + SPEC + design already complete (artifacts shipped in this same PR). Operator's open questions Q1–Q7 already resolved as "all defaults" per the prior `/ui-ux-pro-max` handoff. Implementor target: Codex `implementor-mingla` (preferred default) or Claude `mingla-implementor` (alternate).
