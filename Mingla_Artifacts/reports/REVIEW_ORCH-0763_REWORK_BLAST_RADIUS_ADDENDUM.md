# ORCHESTRATOR REVIEW - ORCH-0763 Rework Blast-Radius Addendum

Date: 2026-05-08
Mode: Orchestrator review
Verdict: APPROVED ADDENDUM - IMPLEMENTOR REWORK PROMPT SUPERSEDED

## Plain-English Decision

Do not send the old rework prompt as-is.

Forensics found the same trust bug in a new place: the main event detail page can now load a real server-published event, but its management buttons can still send the organiser to old local-only screens that say "Event not found."

The implementor rework remains the correct next lifecycle gate, but the handoff must include this added blast-radius requirement.

## Evidence Accepted

- Tester FAIL: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- Forensic addendum: `Mingla_Artifacts/reports/FORENSIC_REVIEW_ORCH-0763_REWORK_READINESS_AND_BLAST_RADIUS.md`
- Prior approved spec: `Mingla_Artifacts/specs/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

## Required Rework Scope

The implementor rework now includes five hard lanes:

1. Autosave/clientRevision/stale-response protection.
2. Server-loaded lifecycle action honesty.
3. Legacy `le_...` route recovery.
4. Server-backed event management subroute resolution or honest disabling.
5. Behavioral regression tests proving the old bugs fail before and pass after.

## Superseded Prompt

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md` has been updated to include the forensic addendum.

## Next Lifecycle Gate

Dispatch `$implementor` with the updated rework prompt.

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

Hard guards remain:

- No `supabase db push` from implementor.
- No production data mutation.
- No deploy.
- No provider media/GTM expansion.
- No close until tester retest, operator DB push, deploy/runtime smoke, and orchestrator close protocol are complete.
