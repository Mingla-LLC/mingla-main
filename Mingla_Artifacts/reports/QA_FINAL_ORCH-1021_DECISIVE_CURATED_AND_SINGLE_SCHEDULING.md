# QA Final Receipt: ORCH-1021 Decisive Curated + Single-Card Scheduling

Date: 2026-05-30
Mode: FINAL SMOKE RECEIPT / RETEST CLOSEOUT
Verdict: PASS
Findings: P0:0 P1:0 P2:0 P3:1 P4:3
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1021-[curated-stop-timezone-false-open]`
Branch: `ORCH-1021-curated-stop-timezone-false-open`

## 1. Final Verdict

PASS.

The prior conditional gate in `Mingla_Artifacts/reports/QA_RETEST2_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md` is satisfied by Seth's manual app smoke receipt on 2026-05-30: "works great now."

This confirms the user-visible scheduling behavior now matches the intended contract after the deterministic code/test retest already proved:

- Curated cards reach the all-stops validator before any single-card helper.
- Nasher-style omitted-meridiem hours are not treated as false-open after close.
- Closed and unknown curated stops block scheduling.
- Closed and unknown single cards block scheduling.
- Weak "maybe" / "Schedule Anyway" scheduling escape copy is removed from scoped paths.

## 2. Evidence Chain

| Evidence | Result |
|---|---|
| `QA_RETEST2_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md` | CONDITIONAL PASS: no P0/P1 blockers; only missing manual tap-through smoke. |
| Seth manual smoke receipt, 2026-05-30 | PASS: "works great now." |
| ORCH-1021 focused Deno tests | PASS: 14 passed, 0 failed. |
| Curated stop Deno tests | PASS: 8 passed, 0 failed. |
| Curated generator UTC-offset test | PASS: 2 passed, 0 failed. |
| `deno check` for `generate-curated-experiences` and `discover-cards` | PASS. |
| Canonical reader strict grep | PASS: scanned 423 files. |
| `git diff --check` | PASS. |
| Scoped app-mobile TypeScript grep | PASS: no ORCH-touched/dependent errors. |

## 3. Remaining Process Item

P3-001 remains: a PR still needs to be opened for `ORCH-1021-curated-stop-timezone-false-open` so required GitHub checks can run before merge.

After merge through PR, redeploy `discover-cards` from merged `main` so new single-card payloads include `utcOffsetMinutes`. Also redeploy `generate-curated-experiences` from merged `main` if the curated offset passthrough is not already live.
