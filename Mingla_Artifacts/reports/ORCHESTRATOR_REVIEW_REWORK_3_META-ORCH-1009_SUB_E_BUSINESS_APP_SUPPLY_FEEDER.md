# ORCHESTRATOR REVIEW REWORK 3 - META-ORCH-1009 Sub-E Business-App Supply Feeder

Date: 2026-05-31
Reviewer: orchestrator+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

CONDITIONAL PASS - promote to independent runtime smoke/testing.

The rework fixes the proven phone-smoke loop at the shared owner: `CoverPicker` now emits the video-ready patch at most once per processed URL. The focused automated evidence is green. The remaining gate is runtime: reproduce the iPhone hero-video upload flow and verify the original `Maximum update depth exceeded` loop is gone.

## Evidence Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_3_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Rework prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_3_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Changed source: `mingla-business/src/components/ui/CoverPicker.tsx`
- New regression test: `mingla-business/src/components/ui/__tests__/CoverPicker.videoReadyIdempotency.test.ts`

## Code Review

| Check | Result |
|---|---|
| Root cause alignment | PASS. The fix targets the ready-effect duplicate emission caused by parent callback identity churn. |
| Shared ownership | PASS. The guard lives in shared `CoverPicker`, so brand, event, and trip cover flows inherit it. |
| Behavior preservation | PASS. The existing patch payload, upload-provider metadata, preview path, and success toast remain unchanged for the first emission of a processed URL. |
| Regression coverage | PASS. The new Jest source-contract test would fail on the pre-rework source because the ref and duplicate URL guard were absent. |
| Scope control | PASS. Rework #3 touched only CoverPicker, the new test, and the implementation report. No backend or migration behavior changed. |

## Independent Verification

Reran the focused suite from the worktree:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts src/components/ui/__tests__/CoverPicker.videoReadyIdempotency.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts app/venue/__tests__/create.ve2.test.ts --runInBand
```

Result:

```text
Test Suites: 7 passed, 7 total
Tests: 16 passed, 16 total
```

## Remaining Gate

The exact failure was observed in the iPhone dev build after `video_cover_upload_ready`, not in Jest. Before Sub-E can move to final tester PASS or CLOSE, tester/Seth must smoke:

1. Open Mingla Business in the dev build against this worktree.
2. Enter the brand/venue cover flow and upload/trim a hero video through CoverPicker.
3. Confirm exactly one `Video cover updated.` toast.
4. Confirm the app remains responsive and Metro does not log repeated `Maximum update depth exceeded` from `CoverPicker.tsx`.

## Deployment / COMMS Notes

- Rework #3 introduced no new migration and no edge-function changes.
- Carry forward the broader Sub-E migration and edge deploy gates from `IMPLEMENTATION_REWORK_2_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`.
- COMMS-0015 is relevant for close: edge deploys must happen from merged source, not an orphaned worktree.
- COMMS-0016 remains relevant for Sub-F: brand-authored experience checkout must route through `ticket-checkout-create`, not a parallel money path.

## Next Step

Dispatch tester for an independent retest with the phone hero-video smoke as the first hard gate, then the existing Sub-E deck-readiness and backend gates from prior reports.
