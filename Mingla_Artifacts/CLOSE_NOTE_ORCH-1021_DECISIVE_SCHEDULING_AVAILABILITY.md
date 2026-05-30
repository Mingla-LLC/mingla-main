# Close Note: ORCH-1021 Decisive Scheduling Availability

Date: 2026-05-30
Verdict: PASS
Grade: A
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1021-[curated-stop-timezone-false-open]`
Branch: `ORCH-1021-curated-stop-timezone-false-open`

## Outcome

Scheduling availability is now decisive for both curated cards and single cards.

- Curated cards validate every stop through `checkAllCuratedStopsOpen`.
- Expanded-card curated scheduling reaches that stop validator before any single-card helper.
- Single cards use `checkSingleCardSchedulingAvailability`.
- `closed` and `unknown` are not safe to schedule.
- Weak "maybe" language and `Schedule Anyway` escape paths are removed from scoped scheduling paths.
- `utcOffsetMinutes` flows through `discover-cards` and `generate-curated-experiences` payloads so venue-local schedule checks can use Google Places timezone offsets.

## Evidence

- `Mingla_Artifacts/reports/QA_FINAL_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`
- `Mingla_Artifacts/reports/QA_RETEST2_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`

Local gates recorded by QA:

- ORCH-1021 focused Deno tests: 14 passed, 0 failed.
- Curated stop Deno tests: 8 passed, 0 failed.
- UTC-offset edge test: 2 passed, 0 failed.
- `deno check` passed for `generate-curated-experiences` and `discover-cards`.
- Canonical-reader strict grep passed.
- `git diff --check` passed.
- Scoped app-mobile TypeScript grep found no ORCH-touched/dependent errors.
- Seth app smoke: "works great now."

## Close Checklist

- DIAG markers: zero `[ORCH-1021-DIAG]` matches.
- Migration: none.
- Backend allowlist: ORCH-1021 paths added to ORCH-0863 C7 allowlist.
- Test deletions: none requiring `[TEST-MOD-APPROVED ORCH-1021]`.
- Worktree registry: no ORCH-1021 row existed in `WORKTREE_REGISTRY.md`; no row removal required.
- Mobile OTA: deferred to next native build per current project policy.
- Post-merge deploy: redeploy `discover-cards`; redeploy `generate-curated-experiences` if the curated `utcOffsetMinutes` passthrough is not already live.

## Commit Message

`Close ORCH-1021: decisive scheduling availability`
