# Close Report: Place Intelligence Failed Retry And City Coverage (ORCH-0757)

**Verdict:** CLOSED PASS

**Closed:** 2026-05-08

## Plain-English Outcome

Admins can now see how much of a city has been analyzed/scored, see how many places failed in the latest city run, and rerun only the failed retryable places instead of paying for another full-city pass.

For Raleigh specifically, the failed-only retry path was live-proven: the operator confirmed the UI works and started the failed retry; a read-only database check confirmed 252 linked retry children were created from the original failed rows.

## Evidence Trail

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Tester report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Migration: `supabase/migrations/20260515000000_orch_0757_place_intel_retry_lineage.sql`
- Edge function: `run-place-intelligence-trial`

## Close Evidence

- Operator ran `supabase db push`; migration `20260515000000_orch_0757_place_intel_retry_lineage.sql` is applied remotely.
- Codex deployed `run-place-intelligence-trial` to project `gqnoajqerqhnvulmnyvv`.
- Deploy verification showed `run-place-intelligence-trial` ACTIVE version `33`, updated `2026-05-08 07:54:55 UTC`.
- Operator confirmed "everything works" and started the Raleigh failed-run retry from the admin flow.
- Read-only DB confirmation for source run `e37f5543-0f34-4175-b06a-7ffa4f852a51` returned:
  - `retry_children = 252`
  - `pending = 210`
  - `running = 6`
  - `completed = 36`
  - `failed = 0`
  - `total = 252`

## Accepted Conditions

- The Raleigh retry was still running at close time; close is based on successful creation, lineage, and active processing of the failed-only retry set, not final completion of every retried row.
- Full admin lint remains unrelated repo-wide debt; ORCH-0757 touched admin file lint and admin build passed in implementation/testing.
- A parallel parent-status read hit Supabase temporary-role/circuit-breaker authentication errors after the successful retry-child query. No additional DB write was attempted.

## Lock-In

- Source failed rows are not mutated; retry rows are new child rows linked by `source_trial_run_id`.
- Retry runs are auditable through `mode = 'retry_failed'`, source parent lineage, selected retry count, and retry filter fields.
- Future city recovery should use the failed-only retry action when the source run is terminal and failures are classified retryable.
