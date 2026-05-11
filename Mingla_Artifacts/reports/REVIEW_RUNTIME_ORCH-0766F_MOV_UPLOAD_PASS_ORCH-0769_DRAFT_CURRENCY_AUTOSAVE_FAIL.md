# Review: Runtime MOV Upload Pass + Draft Currency Autosave Failure

Date: 2026-05-09  
Reviewer: Codex `$orchestrator`  
Verdict: ORCH-0766F runtime upload gate passed; ORCH-0769 draft autosave rework required

## Plain-English Impact

The video upload problem is no longer the active blocker. The real iPhone `.MOV` file now uploads, Supabase returns a public URL, and the Step 4 cover state queues the video URL.

The new red error is a separate save failure: after the video upload, the app tries to autosave the draft event, but it sends `currency = null`. The database now requires every event to have a currency because of the ORCH-0769 app-wide currency work, so Postgres rejects the autosave. To the organiser this can look like "the cover upload worked, but the event is still unstable / not saved."

## Runtime Evidence From Operator

Real device picked a valid iPhone MOV:

```text
[CreatorStep4Cover] picked cover asset {"duration":7665,"fileName":"IMG_0154.MOV","fileSize":26448972,"mimeType":"video/quicktime","type":"video"}
```

Upload started with the correct storage content type:

```text
[eventCoverMedia] upload-start {"contentType":"video/quicktime","durationMs":7665,"fileSize":26448972,"mediaType":"video","storagePath":".../moy7i0dk-xx1sf2qa.mov"}
```

Upload/public verification passed:

```text
[eventCoverMedia] upload-verified {"mediaType":"video","publicUrl":"https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/.../moy7i0dk-xx1sf2qa.mov"}
```

Draft cover state queued:

```text
[CreatorStep4Cover] cover media draft update queued {"coverMediaType":"video","coverMediaUrl":"https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/.../moy7i0dk-xx1sf2qa.mov"}
```

Autosave then failed:

```text
[useServerDraftAutosave] Operation failed:
{"code":"23502","message":"null value in column \"currency\" of relation \"events\" violates not-null constraint"}
```

## Code Evidence

`mingla-business/src/services/eventDrafts.ts` autosaves drafts through `draftToServerUpdate(...)` and then updates `events`:

```ts
const updatePayload = draftToServerUpdate(...)
supabase.from("events").update(updatePayload)
```

`mingla-business/src/utils/serverDraftEventMapper.ts` currently maps draft currency directly into the server payload:

```ts
currency: draft.currency,
```

This appears in both:

- `draftToServerInsert`
- `draftToServerUpdate`

ORCH-0769 migration `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` made `events.currency` mandatory:

```sql
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'GBP';
```

Important nuance: the database default helps when a column is omitted, but not when the client explicitly sends `currency: null`.

## Root Cause

The active failure is an ORCH-0769 compatibility gap:

- ORCH-0769 made `events.currency` NOT NULL.
- Some legacy or locally hydrated drafts can still have `draft.currency === null`.
- The autosave mapper sends that null directly to `events.currency`.
- Postgres correctly rejects the update with `23502`.

This is not a Supabase Storage MIME failure anymore. The media path has passed through `upload-verified`.

## Lifecycle Decision

Do not re-open broad ORCH-0766 media forensics for this error. The correct next step is a bounded `$implementor` rework under ORCH-0769 focused on draft create/autosave currency normalization.

Required prompt:

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0769B_DRAFT_AUTOSAVE_CURRENCY_NOT_NULL.md`

## Scope Guard

The rework must not change:

- Supabase Storage `event_covers` behavior.
- Event cover picker/video validation.
- Giphy/Pexels/provider picker work.
- Stripe onboarding flows.
- Revenue/reconciliation formatting beyond what is necessary for draft currency persistence.

## User-Visible Acceptance

After rework, a user should be able to:

1. Open a legacy or null-currency draft.
2. Upload a valid image/GIF/video cover.
3. See the cover upload verify.
4. See no `events.currency` null autosave error.
5. Navigate away/reload and still see the saved cover.

