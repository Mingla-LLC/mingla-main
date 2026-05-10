# Review Spec ORCH-0773 Draft Autosave Stale Local Draft Lifecycle

Date: 2026-05-09
Mode: ORCHESTRATOR REVIEW
Reviewed spec: `Mingla_Artifacts/specs/SPEC_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`
Decision: APPROVED FOR IMPLEMENTATION
Next prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

## Plain-English Outcome

The spec is ready. The fix is not about Cloudinary, video playback, Stripe, or currency. It is about stopping the app from treating an old local copy of a draft as editable after the server has already moved that event out of draft status.

For organisers, the intended outcome is simple: if the draft is no longer a real server draft, Mingla should stop autosaving it, clean up the stale local copy, and send the organiser to an honest recovery path. It should not show a fake editable wizard or spam `PGRST116`.

## Evidence Accepted

The spec correctly preserves the proven root cause:

- Stale local fixture id `98e880f3-43ef-47ab-a530-deaa117b21a7` exists locally as draft state.
- The server/public row for the same id is already scheduled/public.
- `eventDrafts.ts` context read is broader than the update write path.
- The update path updates zero rows and `.single()` emits `PGRST116`.
- Edit and preview routes can currently let local persisted state beat server lifecycle state.

## Review Findings

### Approved: narrow scope

The spec is correctly scoped to:

- `mingla-business` draft autosave lifecycle.
- Service/hook/store/route recovery.
- Publish/discard cleanup.
- Regression tests and manual stale-fixture gate.

It explicitly excludes Cloudinary, Giphy/Pexels, public video audio, Stripe, checkout, admin, and consumer app work.

### Approved: no migration expected

The spec correctly treats this as an app-side lifecycle contract. Existing schema already has the lifecycle fields needed: draft rows are identified by `events.status = 'draft'` and `deleted_at IS NULL`.

No Supabase migration should be introduced unless implementor proves a hard blocker.

### Approved: test contract

The spec requires tests that would catch the current bug:

- missing/non-draft autosave targets become typed lifecycle, not raw `PGRST116`;
- context/update lifecycle filters align;
- fresh draft cover media autosave still works;
- publish/discard cleanup removes stale local draft eligibility;
- route/preview stale local drafts cannot keep autosaving.

## Required Implementor Guardrails

Implementor must not:

- silently swallow unknown Supabase/auth/network errors;
- delete legitimate local-only `d_` drafts because a server query returned null;
- recreate a new server draft from a stale published id;
- weaken ORCH-0769B currency fallback;
- expand into ORCH-0770 media processing or ORCH-0771/0772 playback lifecycle.

## Lifecycle Decision

ORCH-0773 moves to **IMPLEMENTOR REWORK READY**.

After implementation returns, orchestrator should review:

1. typed lifecycle service behavior;
2. stale local draft retirement;
3. edit/preview route guard;
4. publish/discard cleanup;
5. regression tests and command output;
6. manual stale-fixture QA notes.

Then dispatch tester for independent verification.
