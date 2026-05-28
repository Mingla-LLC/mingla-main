# IMPLEMENTATION_ORCH-0978_IMPLEMENT_2

Status: implemented and verified locally, pending orchestrator REVIEW, operator DB migration apply, edge deploy v95, and tester live-fire.

Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`

## 1. Three-commit landing summary

| Commit | Scope | Diff stat |
|---|---|---|
| `2c1282daa` | Item 2a diagnostic instrumentation, already deployed as edge v94 | 2 files, 88 insertions, 3 deletions |
| `18d4fa327` | Items 1+2b+3+4+5+7+8 behavior fixes | 6 files, 257 insertions, 22 deletions |
| `4e14e38c1` | Item 9 regression tests, strict-grep CI gate, ORCH_0978 backend allowlist | 6 files, 362 insertions |

## 2. Item 2a diagnostic captured reason

Captured reason supplied in the IMPLEMENT-2 dispatch after v94 live-fire: `x-orch-0978-auth-failure-reason: token_invalid_signature`.

Evidence source: orchestrator anon-key probe verified the header on edge function v94; Maestro live-fire on iOS sim at `2026-05-27T11:34:21Z` saw the 577ms failure path consistent with `userClient.auth.getUser(token)`.

## 3. Item 2b fix path chosen

Chosen path: client-wiring fix in `mingla-business/src/services/eventCoverVideoProcessingService.ts`.

The service now resolves the authenticated app Supabase client (`./supabase` with persisted auth session), calls `supabase.auth.getSession()`, and forwards `Authorization: Bearer <session.access_token>` on `supabase.functions.invoke("event-cover-video-upload-intent", ...)`. This follows the Supabase docs pattern that signed-in client Edge Function calls carry the user session JWT in `Authorization`: https://supabase.com/docs/reference/javascript/functions-invoke and https://supabase.com/docs/guides/functions/auth-headers.

## 4. Item 4 dual-constant verification

Command:

```bash
rg -n "EVENT_COVER_MAX_VIDEO_DURATION_MS = 30" mingla-business/src/ || true
```

Output: no matches.

Updated surfaces:

- `CoverPicker.tsx`: `videoMaxDuration: 29`, trim rejection copy says `29 seconds`, and `[ORCH-0978-TRIM]` logs duration/cap/overshoot.
- `eventCoverVideoProcessingService.ts`: `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` and processing copy says `29 seconds`.
- `eventCoverMediaRules.ts`: `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`.

## 5. Item 6 zero-diff verification

Command:

```bash
git diff HEAD -- mingla-business/src/components/event/EditPublishedScreen.tsx
```

Output: no diff.

The Save gate was not widened.

## 6. Item 9 fails-on-revert evidence

Hook regression:

- PASS on fixed code: `npx jest src/hooks/__tests__/useEventCoverVideoUpload.test.ts --runInBand` passed.
- Revert probe against `18d4fa327` working tree: temporarily deleted `setLocalPreviewUri(null);`.
- FAIL output: `expect(received).toBeNull()` received `"file:///cover.mp4"`.
- Restore PASS: same Jest command passed again.

Edge boundary regression:

- PASS on fixed code: `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` passed.
- Revert probe against `18d4fa327` working tree: temporarily deleted the `EFFECTIVE_TRIM_CEILING_MS` validation block.
- FAIL output: `Expected 422 above boundary, received 200`.
- Restore PASS: same Deno command passed again.

## 7. Cross-surface verification

Command:

```bash
git diff 2c1282daa..HEAD --name-only | sort
```

Touched files are limited to business app source/tests, the upload-intent edge function/test, the migration, and strict-grep CI files. No `app-mobile/` or `mingla-admin/` file is present in the committed diff.

Note: the worktree still has pre-existing unrelated dirty/untracked `app-mobile/`, `mingla-admin/`, and `tsconfig` files from prior sessions; none were staged or committed.

## 8. Migration timestamp re-verification

Local worktree scan:

```bash
ls -1 ~/Desktop/mingla-orchs/*/supabase/migrations/ 2>/dev/null | sort | tail -10
```

Highest relevant migration before this work remained `20260729000002_orch_0964_brand_event_theme_columns.sql`; `20260730000000_orch_0978_video_cap_29s_constraints.sql` is clear.

Remote migration-list check:

```bash
cd "/Users/sethogieva/Desktop/mingla-main" && /Users/sethogieva/bin/supabase migration list --linked
```

Result: local and remote columns matched through `20260729000002`; no remote-only rows were present. The per-ORCH worktree itself is not linked, so the linked anchor was used for this read-only check.

Remote invariant data probe:

```sql
SELECT count(*)::int AS offending_count
FROM public.event_cover_video_jobs
WHERE (trim_end_ms - trim_start_ms) > 29000
   OR (processed_duration_ms IS NOT NULL AND processed_duration_ms > 29000);
```

Result: `offending_count = 0`.

## 9. Operator instructions

After orchestrator REVIEW approves this implementation, apply the migration with:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase db push --linked
```

Orchestrator owns edge deploy v95 after REVIEW and migration sequencing:

```bash
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
```

## 10. Discoveries for Orchestrator

No new cross-ORCH discovery was found.

Verification run summary:

- PASS: `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts`
- PASS: `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts`
- PASS: `npx jest src/hooks/__tests__/useEventCoverVideoUpload.test.ts src/services/__tests__/eventCoverVideoProcessingService.test.ts --runInBand`
- PASS: `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- PASS: `git diff --check`
- PARTIAL: `npx tsc --noEmit --pretty false` still fails on pre-existing unrelated repo errors in `home.tsx`, checkout buyer screens, marketing ComposerV2, package rendering modules, and historical tests. No errors were reported for the files touched by IMPLEMENT-2.
