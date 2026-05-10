# REVIEW IMPLEMENTATION ORCH-0766F - Event Cover Real-Device MOV Storage MIME Fix

> Date: 2026-05-09  
> Mode: Orchestrator Review  
> Reviewed implementation: `reports/IMPLEMENTATION_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md`  
> Verdict: APPROVED for DB push and runtime retest. Not close-ready.

## Plain-English Decision

The implementation does the right narrow thing.

The app already accepts real iPhone MOV videos, but Supabase Storage rejected their `video/quicktime` MIME type. The fix adds a new monotonic migration to allow `video/quicktime` on `event_covers`, plus a guard so app/storage MIME support cannot drift again.

Do not broaden this into another media rewrite. The next gate is deployment plus the same real-device MOV retest.

## Findings

No P0/P1 implementation blockers found in the reviewed ORCH-0766F scope.

## Evidence Accepted

Changed files in scope:

- `supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql`
- `.github/scripts/strict-grep/orch-0766f-event-cover-quicktime-storage.mjs`
- `mingla-business/package.json`
- `reports/IMPLEMENTATION_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md`

Migration review:

- Prefix `20260515000010` is monotonic after local/remote head `20260515000009`.
- Migration targets only `storage.buckets WHERE id = 'event_covers'`.
- Migration adds/preserves `video/quicktime`.
- Migration preserves `public = true` and `file_size_limit = 31457280`.
- Migration does not alter storage RLS policies or path shape.
- Migration uses a deduplicating `SELECT DISTINCT mime` update.

Guard review:

- `test:orch-0766f` checks migration, app media rules, and service-test MOV coverage.
- Guard specifically ties `video/quicktime` support across storage and app code.

Reported verification accepted:

```text
npm run test:orch-0766f
PASS
```

```text
npm run test:orch-0758a -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
PASS
```

```text
npm run test:orch-0763 -- --runInBand --testNamePattern='cover|video|MOV|QuickTime'
PASS
```

```text
npx tsc --noEmit
PASS
```

```text
npx eslint src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts
PASS
```

```text
git diff --check
PASS
```

## Worktree Note

The worktree is dirty with unrelated ORCH-0766/0769 changes. The ORCH-0766F implementation report correctly scopes its owned changes and did not revert unrelated work.

One package-file caveat: `mingla-business/package.json` currently also contains adjacent uncommitted ORCH-0769/script/dependency changes. That does not block ORCH-0766F review, but any eventual commit must stage only the intended scoped files for that close.

## Required Next Gate

The operator must apply the migration:

```bash
/Users/sethogieva/bin/supabase db push
```

Then dispatch tester with:

```text
Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0766F_EVENT_COVER_REAL_DEVICE_MOV_STORAGE_MIME_FIX.md
```

## Runtime Pass Criteria

The real-device retest must prove:

- phone-shot <=15s MOV logs `mimeType: "video/quicktime"`;
- upload reaches `[eventCoverMedia] upload-verified`;
- public URL `HEAD`/range proof is non-empty video;
- Step 4 renders the cover;
- draft reload still shows the cover;
- no schema-cache/autosave error blocks durable save.

## Status

Approved for DB push and runtime retest.

Not close-ready until the remote migration is applied and the real-device MOV path passes.
