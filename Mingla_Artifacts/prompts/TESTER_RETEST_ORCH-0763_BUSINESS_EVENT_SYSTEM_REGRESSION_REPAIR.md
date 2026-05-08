# TESTER RETEST PROMPT: ORCH-0763 Business Event System Regression Repair

You are `$tester` for Mingla. Retest the ORCH-0763 rework after the implementor pass.

## Required Output

Write:

`Mingla_Artifacts/reports/RETEST_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

Return one verdict:

- PASS
- CONDITIONAL PASS
- FAIL
- BLOCKED/UNVERIFIED

## Context

The original user-visible bug:

- After publishing a free event, links still behaved like drafts.
- Step 7 previously showed wrong or guessed public links.
- Share/public links could point at dead domains or non-clickable text.
- A published event could still depend on old local-only event state.

The first implementation was tested and failed because it did not fully repair:

- autosave race protection,
- server-backed lifecycle action honesty,
- legacy `le_...` route recovery,
- server-backed Event Detail management subroutes,
- regression coverage depth.

The rework implementation report is:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

2026-05-08 runtime update:

- Operator confirmed the visible public event link works when copied manually.
- **Copy link** currently copies nothing.
- **Share via...** currently opens the phone sheet but shares an Expo/dev link instead of the SEO public webpage.
- Do not use this prompt for final close evidence until `IMPLEMENTOR_REWORK_ORCH-0763C_SHARE_COPY_NATIVE_URL_REPAIR.md` has been implemented and returned, unless the operator explicitly asks for a failure-confirming tester report.

## Evidence To Read

Read these before judging:

- `Mingla_Artifacts/specs/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/reports/FORENSIC_REVIEW_ORCH-0763_REWORK_READINESS_AND_BLAST_RADIUS.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0763_REWORK_BLAST_RADIUS_ADDENDUM.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0763C_SHARE_COPY_NATIVE_URL_REPAIR.md`
- If present: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763C_SHARE_COPY_NATIVE_URL_REPAIR.md`

## Retest Scope

Verify these five hard lanes:

1. Autosave/clientRevision/stale-response protection
   - Newer local edits must not be overwritten by older autosave responses.
   - Server list/detail hydration must not overwrite an active dirty draft.
   - Publish must send client revision data.

2. Server-loaded lifecycle action honesty
   - End sales / cancel for server-backed events must not mutate local-only state while showing fake success.
   - Either a real server mutation exists or the UI honestly says the action is unavailable.

3. Legacy `le_...` route recovery
   - Local cached events with `serverEventId` must recover/redirect to the durable server event route.

4. Server-backed management subroutes
   - Event Detail visible actions for Orders, Guests, Scanner, Scanners, Door Sales, Door Sale Detail, and Reconciliation must not route a real server event into false local-only "Event not found" pages.
   - Loading states are acceptable while server event resolution is pending.

5. Regression tests
   - Tests must cover the previous failure classes, not only adapter happy paths.
   - If any required behavior is only static/source-checked, judge whether that is sufficient or whether a behavioral test is still required.

## Commands To Run

From `mingla-business/`:

```bash
npm run test:orch-0763
npm run test:orch-0759
npm run test:orch-0756b
npx tsc --noEmit
```

Run targeted ESLint on files touched by the ORCH-0763 rework. If warnings remain, distinguish existing warnings from new errors.

From repo root:

```bash
git diff --check
/Users/sethogieva/bin/supabase migration list --linked
```

## DB / Runtime Gate

Do not run `supabase db push`.

DB push status as of 2026-05-08: operator reported `supabase db push`; orchestrator verified `/Users/sethogieva/bin/supabase migration list --linked` shows `20260515000004` present on both Local and Remote.

Perform or specify the safest runtime smoke:

1. Create a disposable free-ticket business event.
2. Publish it.
3. Confirm Step 7 does not expose a guessed `draft-*` public link before publish.
4. Confirm the post-publish organiser link uses the durable server event ID.
5. Confirm public share URL is `https://business.usemingla.com/e/{brandSlug}/{eventSlug}`.
6. Confirm the public event page loads from a cold browser.
7. Confirm share/open URL is clickable.
8. Confirm Orders/Guests/Scanner/Scanners/Door/Reconciliation no longer false-404 for that server event.
9. Confirm **Copy link** actually writes the canonical URL to clipboard on the target device.
10. Confirm **Share via...** shares the canonical public web URL, not an Expo/dev/app link.

## Required Report Structure

Include:

1. Verdict.
2. Layman summary.
3. Evidence reviewed.
4. Command results.
5. Finding table with P0/P1/P2/P3/P4 severity.
6. Retest of the five hard lanes.
7. Remote migration status.
8. Runtime/manual smoke status.
9. What remains before orchestrator close.

## Close Criteria

ORCH-0763 can only move to orchestrator close after:

- tester retest has no P0/P1 implementation blockers,
- `20260515000004` remains visible on remote migration status,
- a safe runtime publish/share smoke passes or is explicitly accepted as a documented conditional deferral,
- artifacts are synced,
- close-out is committed and pushed by orchestrator.
