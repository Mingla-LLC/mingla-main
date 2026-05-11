# Review Retest ORCH-0773B Draft Autosave Stale Local Draft Lifecycle

Date: 2026-05-09
Reviewer: Codex `$orchestrator`
Verdict: **CONDITIONAL PASS ACCEPTED - RUNTIME RETEST STILL REQUIRED BEFORE CLOSE**

## Plain-English Impact

The code-level fix is credible: stale draft autosave should now retire stale server-backed drafts instead of spamming raw `PGRST116`, and the route recovery bug from the first implementation review is fixed.

But this is not close-ready. The tester could not prove the real user behavior because the visible simulator had no auth token and no local stale draft. In plain terms: the code looks fixed, but we have not yet watched the app handle the actual stale-draft situation.

## Evidence Reviewed

- Tester report: `reports/RETEST_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`
- Implementation report: `reports/IMPLEMENTATION_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`
- Implementation review: `reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0773B_STALE_DRAFT_RECOVERY_ROUTE_AND_TEST_ASSERTION.md`
- Original investigation: `reports/INVESTIGATION_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md`
- Spec: `specs/SPEC_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

## Accepted Tester Findings

Accepted:

- Jest passed: `eventDraftsCurrency.test.ts` and `serverDraftLifecycleGuards.test.ts`, 30 tests.
- TypeScript passed.
- Targeted ESLint passed with warnings only.
- `git diff --check` passed.
- Static/code evidence confirms:
  - typed lifecycle errors exist;
  - draft reads/updates use draft-only `maybeSingle()` behavior;
  - autosave retires stale server-backed drafts without generic `hasError`;
  - stale edit/preview route recovery uses `staleRecoveryDraftIdRef`;
  - stale route recovery no longer uses `setTimeout` / `clearTimeout`;
  - the old missing-draft fallback is guarded during stale recovery.

Unverified:

- Runtime stale fixture behavior.
- Fresh server-backed draft autosave behavior in an authenticated session.

Reason accepted:

- Tester found the visible iOS simulator data container had `sb-gqnoajqerqhnvulmnyvv-auth-token: null`.
- `mingla-business.draftEvent.v1` had `"drafts":[]`.
- Stale id `98e880f3-43ef-47ab-a530-deaa117b21a7` existed only in cached server/public data as `status:"scheduled"`, not as a stale local draft.

## Lifecycle Decision

Do **not** close ORCH-0773.

Next gate: operator-assisted runtime retest with:

`prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

Close can proceed only after runtime proof shows:

1. stale edit route does not keep rendering/autosaving a draft wizard;
2. stale preview route does not keep rendering/autosaving preview state;
3. route recovery is honest;
4. repeated `PGRST116` autosave loop does not return;
5. fresh draft autosave still works.

