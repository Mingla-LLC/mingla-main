# Investigation ORCH-0773 Draft Autosave PGRST116 Missing Server Row

Date: 2026-05-09
Mode: FORENSICS INVESTIGATE
Prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md`

## Verdict

**Root cause proven for the active runtime fixture.**

The app still has a local persisted `DraftEvent` for event id `98e880f3-43ef-47ab-a530-deaa117b21a7`, but the remote/public server row with the same id is already `status = scheduled` and `visibility = public`. Autosave is therefore trying to save a stale local draft object against a row that is no longer a draft.

The specific failing query for this proven fixture is the **autosave update `.single()`** in `mingla-business/src/services/eventDrafts.ts:229-236`, not the initial context read. The first context read at `eventDrafts.ts:202-207` can still find the row because it only filters by `id` and `deleted_at`, not by draft status. The second query then updates with `eq("status", "draft")`; because the row is already scheduled, zero rows are updated, and `.single()` turns that zero-row update into `PGRST116` / `Cannot coerce the result to a single JSON object`.

A second class remains possible but not proven by the current fixture: if a local draft points to a deleted/missing/RLS-invisible row, the initial context `.single()` at `eventDrafts.ts:202-207` can also emit the same `PGRST116`. The implementation should cover both states deliberately.

## Plain-English Impact

An organiser can be looking at something that the app still thinks is a draft, while the server already thinks it is a published event. The UI may let them upload or edit cover media, but autosave is writing to the wrong lifecycle state. That causes repeated red logs and can make edits look like they worked locally while they do not persist to the server.

This is exactly the kind of dirty signal that can make ORCH-0770 video testing look broken even when the media processor itself is not the failing layer.

## Investigation Manifest

Read and checked:

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0773_DRAFT_AUTOSAVE_PGRST116_MISSING_SERVER_ROW.md`
- `Mingla_Artifacts/reports/REVIEW_RUNTIME_ORCH-0770_OPERATOR_LOG_NATIVE_PLAYER_AND_AUTOSAVE_PGRST116.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0769B_DRAFT_AUTOSAVE_CURRENCY_NOT_NULL.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/app/event/[id]/preview.tsx`
- `mingla-business/src/hooks/useBusinessEvents.ts`
- `mingla-business/src/services/businessEvents.ts`
- `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql`
- `supabase/migrations/20260515000006_orch_0763d_draft_discard_rpc.sql`
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`
- `supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql`
- Current simulator AsyncStorage and read-only public REST evidence.

Verification commands run:

```bash
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" \
  npx jest --runInBand \
  src/services/__tests__/eventDraftsCurrency.test.ts \
  src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS, 2 suites, 24 tests.

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result: remote includes through `20260515000012`, including ORCH-0763/0769/0770 migrations.

Read-only public REST check for `98e880f3-43ef-47ab-a530-deaa117b21a7` returned `status: "scheduled"`, `visibility: "public"`, `currency: "USD"`, and a public cover image URL.

## Evidence Chain

### 1. Autosave logs all failures from the mutation, but does not identify which service query failed

`mingla-business/src/hooks/useServerDraftEvents.ts:159-184` wires `useServerDraftAutosave` to `autosaveServerDraft` and logs all mutation errors as `[useServerDraftAutosave] Operation failed:`. That is why the operator stack points at the hook rather than the exact Supabase query.

### 2. Autosave has two `.single()` calls with different lifecycle filters

In `mingla-business/src/services/eventDrafts.ts:199-215`, `fetchExistingDraftSaveContext` does:

```ts
.from("events")
.select("theme,currency")
.eq("id", draftId)
.is("deleted_at", null)
.single()
```

It does **not** require `status = draft`.

Then `autosaveServerDraft` performs the actual update in `eventDrafts.ts:229-236`:

```ts
.from("events")
.update(updatePayload)
.eq("id", draft.id)
.eq("status", "draft")
.is("deleted_at", null)
.select(EVENT_DRAFT_SELECT)
.single()
```

For a scheduled/published row, the first query can read the row but the second query updates zero rows. With `.single()`, zero updated rows becomes `PGRST116`.

### 3. The current device has a stale local draft for an already scheduled server event

Read-only simulator inspection found the persisted draft store still contains:

- id: `98e880f3-43ef-47ab-a530-deaa117b21a7`
- `status: "draft"`
- `serverSlug: "draft-rga9"`
- `coverMediaUrl`: old MP4 under the same id
- `tickets: []`
- `clientRevision: 150`
- `currency: null`

The same simulator cache also contains the server/business event row for that exact id as:

- `status: "scheduled"`
- `visibility: "public"`
- slug: `runtime-share-test-freeta-throwaway-free-ticket-qa-event-for-testing-public-links-and-share-buttons`
- `published_at: 2026-05-09T10:46:13.962852+00:00`
- `cover_media_type: "image"`
- `currency: "USD"`
- `management_theme.business_event.clientRevision: 155`

A live read-only public REST check against `business_public_events_view` confirmed the server currently exposes that id as scheduled/public. This proves the local device state is stale relative to the server lifecycle.

### 4. Published lifecycle intentionally moves the same row out of draft status

`mingla-business/src/services/businessEvents.ts:414-426` calls the `business_publish_event_draft` RPC with `p_event_id = draft.id`.

The latest publish RPC in `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql:384-411` updates the same `events` row and sets:

- `status = 'scheduled'`
- `visibility = v_visibility`
- `published_at = v_now`

while requiring `WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL`.

So the same id legitimately changes from draft to scheduled. After that moment, direct draft autosave must stop targeting it as a draft.

### 5. The local cleanup contract is incomplete for stale persisted/query-state cases

`EventCreatorWizard` clears the pending 700ms autosave timer before publish and deletes the draft after publish success at `mingla-business/src/components/event/EventCreatorWizard.tsx:538-543`. `usePublishBusinessEventDraft` also removes the React Query detail and invalidates the draft list at `mingla-business/src/hooks/useBusinessEvents.ts:151-154`.

But the stale device evidence proves those mechanisms are not sufficient. A stale draft can remain in persisted Zustand after server publish. The route then still passes `onAutosaveDraft={autosave.saveDraft}` for any non-`d_` id at `mingla-business/app/event/[id]/edit.tsx:318`, even if the server detail query would now return null because `fetchDraftById` correctly filters `status = draft` at `eventDrafts.ts:182-188`.

There is no local guard saying: "if the server draft query returns null for this non-local id, delete/retire the local draft or disable autosave." The route only redirects when local `draft === null` and server loading is finished (`edit.tsx:170-179`). If the stale local draft exists, the wizard still renders and autosaves.

## Findings

### P1 Confirmed Bug: stale local draft can autosave against a published event row

- **Classification:** confirmed bug / invariant violation / persistence integrity.
- **User symptom:** repeated `[useServerDraftAutosave]` `PGRST116`; media/edit changes appear local but do not persist as draft changes.
- **Broken journey:** organiser publishes or otherwise has a server draft promoted to scheduled, but local persisted draft state still contains the same id and remains editable/autosaving.
- **Evidence:** local AsyncStorage contains id `98e880f3-...` as `status: draft`; remote/public read returns the same id as `status: scheduled`.
- **Exact failing query for this fixture:** `eventDrafts.ts:229-236` update with `eq("status", "draft")` followed by `.single()`.
- **Expected behavior:** once a server draft is missing from the draft query because it is published/deleted/not draft, local draft editing/autosave should stop and the app should route to the correct published-event surface or remove the stale local draft cache.

Six-field root cause proof:

1. **File/line:** `mingla-business/src/services/eventDrafts.ts:229-236`.
2. **Exact code/schema:** autosave update requires `id`, `status = draft`, and `deleted_at IS NULL`, then calls `.single()`.
3. **Current behavior:** local stale draft id is submitted to autosave after the server row is `status = scheduled`; update affects zero rows; `.single()` throws `PGRST116`.
4. **Expected behavior:** non-draft/missing draft state is a known lifecycle condition, not an unclassified autosave failure loop.
5. **Causal chain:** publish promotes row -> local persisted draft survives -> edit route renders local stale draft -> autosave sends stale id -> update cannot match draft row -> PostgREST returns zero rows -> red error repeats.
6. **Verification step:** use a persisted local draft id that is scheduled in `business_public_events_view`, call `autosaveServerDraft`, and assert the service handles the missing/non-draft row without `PGRST116` log storms or stale draft retention.

### P1 Confirmed Bug: draft detail hydration does not retire stale local drafts

- **Classification:** confirmed bug / state-cache lifecycle gap.
- **Evidence:** `fetchDraftById` uses `maybeSingle()` with `status = draft` and returns null for non-draft rows (`eventDrafts.ts:179-192`), but `app/event/[id]/edit.tsx:170-179` only redirects when the local draft is already null. If stale local state exists, route renders it anyway.
- **Impact:** the server is already telling the client "this is not a draft," but the local store remains authoritative enough to keep the wizard alive.
- **Expected behavior:** a non-local id whose server draft query finishes as null should cause local stale-draft retirement or route recovery, especially when the id belongs to a server-backed row.

### P2 Confirmed Bug: `fetchExistingDraftSaveContext` lifecycle filter is too broad

- **Classification:** confirmed bug / service contract mismatch.
- **Evidence:** `fetchExistingDraftSaveContext` reads `theme,currency` by id/deleted only (`eventDrafts.ts:202-207`), while the update only applies to draft rows (`eventDrafts.ts:229-234`).
- **Impact:** for published public rows, autosave can read scheduled event context and then fail on update. This makes the actual error later and less diagnosable.
- **Expected behavior:** draft autosave context should either require `status = draft` too, or use `maybeSingle()` to return a typed `not_draft_or_missing` state before building an update payload. Adding `status = draft` alone would move the `PGRST116` from the update query to the context query unless missing-row handling is also fixed.

### P2 Production-Hardening Gap: tests encode happy-path currency behavior but not missing/non-draft lifecycle

- **Classification:** production-hardening gap.
- **Evidence:** `eventDraftsCurrency.test.ts` covers currency selection and cover media update payloads, but `queueAutosave` always makes the context query and update query succeed. `serverDraftLifecycleGuards.test.ts` statically checks that autosave targets draft rows, but does not test what happens when the target row is already scheduled/deleted/missing.
- **Expected behavior:** service tests must simulate `PGRST116`/zero-row update and prove the app handles it as lifecycle state rather than a log storm.

## Relationship To Other ORCH Items

### ORCH-0763

This is an extension of the ORCH-0763 event-system repair area. ORCH-0763 moved publish to a server RPC and added revision-aware autosave protections. The missing piece is lifecycle invalidation/retirement when the server row is no longer a draft but local Zustand still has a draft object.

### ORCH-0769B

This is **not** the ORCH-0769B currency null bug. ORCH-0769B fixed `23502` by normalizing draft currency writes. Current tests for that pass. ORCH-0773 happens even when currency is not the DB constraint failure; the row lifecycle itself no longer matches `status = draft`.

One related clue: the stale local draft still has `currency: null`, while the published server row has `currency: USD`. That stale currency proves local state is old, but it is not the direct error here.

### ORCH-0770

ORCH-0770 runtime cannot be cleanly closed using this stale draft fixture. Media processing can still be tested in isolation on a fresh draft/job, but the full user promise `upload/process/apply/save/public playback` should wait for ORCH-0773 rework or use a guaranteed fresh server draft and verify no stale local draft remains.

## RLS / Schema Assessment

RLS is not the primary root cause for the proven fixture.

- Baseline policy allows brand-team select on non-deleted events (`baseline_squash:14180`).
- Public policy allows scheduled/live public event select (`baseline_squash:14450`).
- Update policy allows event_manager+ update generally (`baseline_squash:14258`), but the client update query itself adds `status = draft`, so a scheduled row will update zero rows even for an authorized manager.
- Publish RPC intentionally changes status to scheduled (`20260515000009:384-411`).
- Discard RPC intentionally soft-deletes draft rows and rejects non-drafts (`20260515000006:26-64`).

RLS can create a similar PGRST116 if auth is missing or membership is lost, but current evidence does not require that explanation.

## Required Implementation Scope

Do not touch Cloudinary, video processing, Giphy/Pexels, Stripe, checkout, public page playback, or broad event editing.

Required narrow rework:

1. Add a typed lifecycle/missing-row result for autosave.
   - `autosaveServerDraft` must distinguish missing/deleted/non-draft/no-longer-readable from unknown Supabase failures.
   - Missing/non-draft should not be logged as an unclassified red autosave error forever.

2. Align context read with update semantics.
   - Either include `status = draft` in `fetchExistingDraftSaveContext` plus `maybeSingle()` handling, or replace the two-step read/update with a single update/select path that returns a typed zero-row lifecycle result.
   - Do not simply add `status = draft` while keeping `.single()`; that only moves the same PGRST116 earlier.

3. Retire stale local drafts when server draft detail resolves to null for a non-local id.
   - If `useServerDraftById(id)` finishes with `data === null` and a local draft exists with that same server id, the route/store must not keep autosaving it as a draft.
   - Correct recovery could route to published event detail when the id is now a business event, delete/retire the local draft, or show honest stale-draft recovery copy. The implementor/spec should choose the narrowest UX consistent with current patterns.

4. Cancel or ignore pending autosave after publish/discard/lifecycle resolution.
   - The wizard already clears its local timer before publish, but the broader route/store/service boundary must ignore stale in-flight responses and prevent future autosave calls for retired ids.

5. Clean React Query/Zustand cache coherently.
   - Publish success should not leave the local persisted draft store with the published id.
   - Draft list/detail invalidation should be paired with local stale-draft removal where server says no draft exists.

## Required Tests

Automated tests should ship with the implementation.

Minimum required tests:

1. `eventDrafts` service test: when context/update returns a zero-row/non-draft/missing-row condition, autosave returns/throws a typed lifecycle error rather than raw `PGRST116` leaking as a generic log storm.
2. `eventDrafts` service test: context read and update use aligned draft lifecycle semantics (`status = draft` or equivalent typed handling).
3. route/store guard test: if a non-`d_` local draft exists but `useServerDraftById` resolves null, the stale draft is retired or autosave disabled and the route recovers honestly.
4. publish lifecycle regression: after publish success, the persisted local draft for that server id is removed and cannot be autosaved again.
5. discard lifecycle regression: after discard success or `event_draft_not_found`, local draft state is removed or recovered without repeated autosave attempts.
6. ORCH-0770 media-adjacent regression: uploading/updating cover media on a fresh draft still autosaves cover fields when the server row is genuinely `status = draft`.

Existing tests to extend:

- `mingla-business/src/services/__tests__/eventDraftsCurrency.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- Add a focused hook/route/state test if the repo already has an accepted pattern; otherwise add a static guard only as a fallback and require manual tester runtime proof.

Manual tester gate after implementation:

1. Open the current stale fixture id `98e880f3-43ef-47ab-a530-deaa117b21a7` if still present locally.
2. Confirm the wizard does not keep autosaving it as a draft.
3. Confirm no `[useServerDraftAutosave]` `PGRST116` repeats.
4. Create a fresh draft, upload/edit cover media, and confirm autosave still succeeds.
5. Publish the fresh draft, then revisit the old edit route and confirm it routes to published/recovery state rather than stale draft editing.

## Can ORCH-0770 Runtime Proceed?

**Not safely on the current stale fixture.** The current local state is contaminated by a published row pretending to be a draft locally.

ORCH-0770 can only proceed in parallel if the tester uses a brand-new server draft and first proves:

- the draft id exists remotely as `status = draft`,
- local AsyncStorage does not contain a stale published copy for that id,
- autosave logs are clean before the video upload begins.

For close-quality ORCH-0770 runtime proof, fixing ORCH-0773 first is the better path.

## Confidence

High for the active fixture root cause. The local-vs-remote id mismatch is directly observed.

Medium for the full blast radius because I did not mutate data or run a live authenticated update probe, by design. The code path and read-only data are sufficient to specify the rework.
