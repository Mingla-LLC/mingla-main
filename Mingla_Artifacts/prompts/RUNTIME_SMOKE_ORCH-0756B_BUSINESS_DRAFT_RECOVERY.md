# Runtime Smoke Prompt - ORCH-0756B Business Draft Recovery

## Role

You are `$tester` or the credentialed runtime smoke operator for Mingla Business.

Do not implement product code. Do not run `supabase db push`. Do not mutate production-adjacent data except through the normal app flows below. Use read-only database inspection only when available and safe.

## Context

ORCH-0756B addresses the user-reported trust bug where a business event draft disappeared after sign-out/sign-in, and should also survive app deletion or local storage loss.

Evidence already returned:

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Tester report: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`
- Retest report: `Mingla_Artifacts/reports/RETEST_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md`

Tester retest verdict: `CONDITIONAL PASS`.

Retest found no P0/P1 and no implementor rework blocker. Static/code gates passed:

- `cd mingla-business && npm run test:orch-0756b`
- `cd mingla-business && npm run test:orch-0756a`
- `cd mingla-business && npm run test:orch-0754`
- `cd mingla-business && npx tsc --noEmit`
- touched-file ESLint

Broad `mingla-business npm run lint` still fails from unrelated existing repo debt; retest reported no ORCH-0756B/rework-touched file in that output.

The remaining close blocker is runtime proof of the actual user journey: create a draft, sign out, sign back in, clear local app/browser storage or reinstall, sign back in again, and confirm the draft returns from Supabase instead of local cache.

## Mission

Prove or disprove that ORCH-0756B fixes the real-world draft persistence problem across:

1. sign-out / sign-in,
2. local storage loss or app deletion simulation,
3. edit/resave after recovery,
4. discard,
5. publish, if safe to perform in the selected environment.

## Required Setup

Use a safe credentialed Mingla Business account that has at least one real brand.

Record account and brand identifiers only as safe redacted labels, for example:

- Account: `runtime-test-business-account`
- Brand: `brand ending ...abcd`

Do not expose passwords, auth tokens, API keys, or private customer data in the report.

Create a uniquely named test draft:

`ORCH-0756B Runtime Draft <YYYYMMDD-HHMMSS>`

Fill enough fields that the recovered draft is unmistakable:

- event name,
- date/time,
- location or venue,
- at least one ticket tier,
- one description/detail field,
- optional password-protected/private ticket setting if safely available.

If using a password-protected ticket, verify later that no plaintext ticket password is persisted in server JSON.

## Runtime Test Plan

### A. Create And Save Draft

1. Sign in to Mingla Business.
2. Confirm a brand is selected automatically or choose the intended brand.
3. Start a new event draft.
4. Fill the unique draft fields.
5. Wait for the app to indicate save/autosave stability, or wait long enough for the server draft write path to complete.
6. Navigate away and back if the app supports that naturally; confirm the draft is still visible.

### B. Read-Only Server Proof, If Available

If safe Supabase read-only access is available, inspect the matching `events` row and record:

- `status = 'draft'`
- `visibility = 'draft'`
- expected `brand_id`
- expected `created_by`
- `theme.business_draft` exists
- no plaintext ticket password appears in JSON/text fields
- `deleted_at IS NULL`

If DB inspection is unavailable, state that clearly and rely on UI runtime evidence.

### C. Sign-Out / Sign-In Recovery

1. Sign out normally.
2. Sign back into the same account.
3. Confirm the draft reappears from the Home/Events/draft list path.
4. Open the draft and confirm the distinguishing fields survived.

This is the exact user-reported failure path.

### D. Local Storage Loss / App Deletion Simulation

Perform the strongest safe local-data-loss simulation available:

- Native app: uninstall/reinstall the app, or clear app data, then reinstall/open.
- Web/dev client: clear local storage, IndexedDB, AsyncStorage-backed storage, and app cache for the business app origin, then reload.

Then:

1. Sign in again.
2. Confirm the same draft reappears.
3. Open it and confirm the distinguishing fields survived.

### E. Edit / Resave After Recovery

1. Change one safe field on the recovered draft, such as description text.
2. Wait for autosave/save stability.
3. Sign out and sign in again, or clear local storage and reload if practical.
4. Confirm the edited value persists.

If read-only DB access is available, confirm the server row reflects the edit.

### F. Discard Path

1. Discard/delete the recovered draft through the app.
2. Sign out and sign back in.
3. Clear local storage/app data again if practical.
4. Confirm the discarded draft does not reappear.

If read-only DB access is available, confirm the row is absent from active draft queries or has the expected deleted marker.

### G. Publish Path, If Safe

If the environment/account makes it safe to publish a test event:

1. Create a second uniquely named draft.
2. Save it.
3. Publish it through the normal app flow.
4. Confirm the published event does not remain stranded as a draft.
5. Sign out/sign in and confirm it appears only in the correct live/scheduled event surface.

If publishing is not safe, mark this section `BLOCKED - unsafe to publish in selected environment` and explain why.

### H. Wrong Actor / Anonymous Probe, If Feasible

If safely available:

1. Sign out and try to access the draft as anonymous or another business account.
2. Confirm it is not visible/editable.

If not feasible, mark this section `BLOCKED - no safe second actor`.

## Output Report

Write:

`Mingla_Artifacts/reports/RUNTIME_ORCH-0756B_BUSINESS_DRAFT_RECOVERY.md`

Include:

- verdict: `PASS`, `FAIL`, or `BLOCKED/UNVERIFIED`,
- exact environment tested,
- account/brand labels with secrets redacted,
- timestamped draft names used,
- steps completed,
- UI evidence summary,
- DB evidence summary if available,
- password-storage finding if tested,
- any failures with reproduction steps,
- whether ORCH-0756B is ready for orchestrator close.

## Verdict Rules

Return `PASS` only if the original bug is proven fixed in runtime: a server-backed draft survives sign-out/sign-in and local storage loss/app deletion simulation.

Return `FAIL` if the draft disappears, cannot be recovered, saves only locally, reappears after discard, or exposes private draft/password data.

Return `BLOCKED/UNVERIFIED` if safe credentials, app runtime access, or local storage/app deletion simulation are unavailable.
