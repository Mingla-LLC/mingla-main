# Review Investigation ORCH-0773 Draft Autosave PGRST116 Missing Server Row

Date: 2026-05-09
Mode: ORCHESTRATOR REVIEW
Reviewed report: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md`
Decision: APPROVED FOR SPEC

## Plain-English Outcome

The investigation proves the current autosave error is not another Cloudinary/video problem and not the old currency-null bug. The app has a stale local draft for an event id that the server already considers scheduled/public. Autosave keeps treating that stale local object as a draft, so the server update matches zero draft rows and PostgREST returns `PGRST116`.

This is launch-relevant because an organiser can think cover/video edits are being saved while the server is rejecting them. It also contaminates ORCH-0770 video runtime testing: the media pipeline cannot be judged cleanly when the draft underneath it is already out of lifecycle sync.

## Evidence Accepted

The investigation establishes:

- Active stale local fixture id: `98e880f3-43ef-47ab-a530-deaa117b21a7`.
- Local persisted state still has that id as `status: "draft"` with stale draft fields.
- Server/public evidence shows the same id is already `status: "scheduled"` and `visibility: "public"`.
- `fetchExistingDraftSaveContext` can still read the row because it filters only by `id` and `deleted_at`.
- `autosaveServerDraft` then updates with `eq("status", "draft")`; because the row is scheduled, zero rows update.
- The trailing `.single()` converts the zero-row update into `PGRST116` / `Cannot coerce the result to a single JSON object`.
- RLS can create similar symptoms, but it is not needed to explain the active fixture.
- Existing tests pass but do not cover missing/non-draft server-row lifecycle.

Accepted root cause:

`publish promotes row -> local persisted draft survives -> edit route renders stale local draft -> autosave sends stale id -> update cannot match status=draft -> .single() emits PGRST116`.

## Findings

### P1 Confirmed: stale local draft can autosave against a published server row

This is the core blocker. Local Zustand can remain authoritative enough to render/autosave a server-backed draft even after the server row is no longer a draft.

### P1 Confirmed: draft detail hydration does not retire stale local drafts

`fetchDraftById` correctly returns null for non-draft server rows, but the edit route can still render a stale local draft with the same id instead of retiring it or routing to the published-event surface.

### P2 Confirmed: autosave context read and update lifecycle filters are misaligned

The context read can accept a scheduled row; the update can only update draft rows. That makes the failure later and less diagnosable.

### P2 Confirmed: tests miss missing/non-draft lifecycle

Current test coverage guards happy-path currency and draft-row update shape, not lifecycle mismatch or stale local draft retirement.

## Lifecycle Decision

Approve investigation and move to a bounded SPEC prompt.

Next handoff:

`Mingla_Artifacts/prompts/SPEC_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

Expected output:

`Mingla_Artifacts/specs/SPEC_ORCH-0773_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

Do not dispatch implementor yet. The spec must turn the proven findings into a precise implementation contract, including typed lifecycle handling, stale local draft retirement, cache cleanup, regression tests, and manual retest gates.

## Scope Guard

ORCH-0773 is draft autosave/server-row lifecycle only.

Do not include:

- Cloudinary processing or webhook changes.
- Event-cover transcode/compression provider work.
- Giphy/Pexels/provider media.
- Public event video playback/audio lifecycle.
- Stripe, checkout, admin, or consumer app scope.

## Program Impact

ORCH-0770 full runtime proof should not use the stale fixture. It can proceed only with a fresh server draft whose remote status is verified as `draft` before upload, but close-quality ORCH-0770 proof is cleaner after ORCH-0773 is fixed or explicitly isolated.
