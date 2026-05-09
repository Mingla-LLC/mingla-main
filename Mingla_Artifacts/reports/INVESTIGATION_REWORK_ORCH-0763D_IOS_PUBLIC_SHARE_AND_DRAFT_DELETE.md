# Investigation Rework: ORCH-0763D iOS Public Share + Draft Delete

> Written: 2026-05-09  
> Runtime evidence captured: 2026-05-08  
> Mode: FORENSICS / REWORK SPEC INPUT  
> Verdict: confirmed two launch blockers remain

## Plain-English Summary

The public domain problem is mostly repaired. The correct public domain is:

`https://business.usemingla.com`

The app is no longer generating `mingla.com/e/...`, `business.mingla.com/...`, Expo links, or draft placeholder links in the repaired business-app share path.

Two different bugs remain:

1. Public web sharing gives Safari the right URL, but only in the `url` field. iOS's share-sheet Copy action copied the text field instead, so the clipboard ended up with `Test Event ` and no link.
2. Draft deletion is still using a direct Supabase `events.update(...)` table mutation. Supabase rejected it with `403`, and the UI kept the confirm modal open without a visible error.

## Evidence Read

- `Mingla_Artifacts/prompts/FORENSICS_SPEC_REWORK_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`
- `Mingla_Artifacts/reports/RETEST_ORCH-0763D_IOS_RUNTIME_SHARE_LINKS_RIGHT_SIMULATOR.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_REPAIR.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_REPAIR.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_BLAST_RADIUS.md`
- `README.md`
- `docs/MUTATION_CONTRACT.md`
- `docs/DOMAIN_ADRS.md`

## Runtime Facts From Retest

| Area | Status | Evidence |
|---|---:|---|
| Correct simulator | PASS | `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)` |
| Native app domain | PASS | App share modal showed `https://business.usemingla.com/e/leggothis/test-event` |
| Native app Copy link | PASS | iOS pasteboard contained the exact public URL |
| Native app Share via | PASS | Share sheet Copy produced text plus URL |
| Public URL reachability | PASS | `curl -I -L` returned `HTTP/2 200` |
| Public page Copy link | PASS | Public-page modal Copy wrote the URL |
| Public page Share via | FAIL | iOS share-sheet Copy wrote only `Test Event ` |
| Draft delete | FAIL | Confirm modal stayed open; logs showed `status 403`; draft remained visible |

## Finding 1: Public Web Share Payload Omits URL From Text

**Severity:** P1  
**User impact:** A host or guest can tap Share via on the public webpage, then Copy from the iOS share sheet, and paste text without any usable event link.

### Current Code Path

Public event page:

- `mingla-business/src/components/event/PublicEventPage.tsx`
- Page share button opens `ShareModal`.
- The modal receives:
  - `url={canonicalUrl(event)}`
  - `title={event.name}`
  - `description={event.description.slice(0, 200)}`

Reusable share modal:

- `mingla-business/src/components/ui/ShareModal.tsx`
- `handleNativeShare` calls:
  - `sharePublicUrl({ title, url, description })`

Share helper:

- `mingla-business/src/utils/sharePublicUrl.ts`
- Native app branch:
  - `Share.share({ title, message, url })`
  - `message` is `[title, description, url].join("\n")`
- Web/Safari branch:
  - `navigator.share({ title, url, text: description })`

### Root Cause

The native-app branch includes the URL inside the share `message`. The web branch does not include the URL inside `text`; it only passes the URL as a separate `url` field.

The retest proves why that matters on iOS Safari:

- The iOS share sheet preview saw `business.usemingla.com`, so the URL field existed.
- But the share sheet Copy action wrote only `Test Event ` to the pasteboard, matching the text/description path, not the URL path.

So this is not a domain-authority bug anymore. It is a share-payload completeness bug.

### Blast Radius

| Surface | File | Impact |
|---|---|---|
| Public event page | `src/components/event/PublicEventPage.tsx` | Confirmed failing in Safari |
| Public brand page | `src/components/brand/PublicBrandPage.tsx` | Uses the same `ShareModal`; likely same Safari Copy failure |
| Business app event list share modal on native | `app/(tabs)/events.tsx` | Repaired, because native branch includes URL in message |
| Business app event detail share modal on native | `app/event/[id]/index.tsx` | Repaired for same reason |
| Web build of business manage share | `ShareModal` on `Platform.OS === "web"` | Same payload risk if used from browser |
| Direct Copy link button | `copyPublicUrl` | Not impacted; retest passed |
| Twitter/WhatsApp/Email/SMS intent buttons | `src/utils/shareIntents.ts` via `ShareModal` | Not implicated by current evidence |

### Test Gap

`mingla-business/src/utils/__tests__/sharePublicUrl.test.ts` checks that web share payload includes `url`, but it does not require `text` to contain the exact canonical URL.

That allowed the Safari Copy failure through:

```ts
expect(webShare).toHaveBeenCalledWith(
  expect.objectContaining({
    title: "Great Free Event",
    url: canonicalUrl,
  }),
);
```

The test needs to assert both:

- `url` is the SEO URL.
- `text` also contains the SEO URL.

## Finding 2: Draft Delete Uses Direct RLS-Gated Table Update

**Severity:** P1  
**User impact:** A host can get stuck with an undeletable draft and no visible explanation.

### Current Code Path

Events tab:

- `mingla-business/app/(tabs)/events.tsx`
- `handleManageDeleteDraft` opens `ConfirmDialog`.
- `handleDeleteDraftConfirm` finds the local draft and calls:
  - `discardServerDraft.discardDraft(draft)`

Hook:

- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `useDiscardServerDraft` uses `useMutation`.
- Mutation calls:
  - `discardServerDraft(draft.id)`
- On success:
  - local Zustand draft is deleted
  - draft query cache is invalidated
- There is no `onError`.

Service:

- `mingla-business/src/services/eventDrafts.ts`
- `discardServerDraft` performs:

```ts
supabase
  .from("events")
  .update({ deleted_at: new Date().toISOString() })
  .eq("id", draftId)
  .eq("status", "draft")
  .is("deleted_at", null)
```

### Permission Contract In Database

Events table update policy:

- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`
- Policy: `"Event manager plus can update events"`
- Requirement:
  - `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager')`

Rank function:

- `biz_role_rank('event_manager')` returns `40`.
- `biz_brand_effective_rank(...)` checks brand owner/team membership.

### Root Cause

The immediate failing request is a direct RLS-gated table update against `public.events`.

The observed `403` means Supabase rejected the caller for that update. For this specific runtime draft, the exact data-side reason could be one of:

- the signed-in user does not have server-effective `event_manager` rank for that draft's brand,
- the draft belongs to a stale or different brand context,
- the event row status/id no longer matches the local draft,
- RLS sees a different auth/session state than the UI gate expects.

But the code-level defect is already proven: draft discard is the only lifecycle path here that did not move to a server-authoritative RPC. Publish, cancel, and end-sales now use SECURITY DEFINER RPCs with explicit rank checks and named errors; draft discard still depends on direct table RLS behavior and has poor failure handling.

### Why The UI Gets Stuck

`ConfirmDialog` can accept an async `onConfirm`, but `events.tsx` does not return/await the mutation. It starts a fire-and-forget promise:

```ts
void discardServerDraft.discardDraft(draft).then(...).catch(...)
```

The modal closes only on success. On failure:

- the modal remains open,
- a toast is set,
- the toast is likely hidden behind the modal or not visually obvious,
- no inline error appears in the dialog,
- no pending/busy state prevents repeat taps.

This violates `docs/MUTATION_CONTRACT.md`, which requires `onError` for every `useMutation` and visible feedback for user-initiated mutations.

## Finding 3: Local/Legacy Drafts Can Be Routed To Server Discard

**Severity:** P2, launch-adjacent  
**User impact:** Older local-only drafts can fail deletion or produce confusing errors.

### Evidence

Draft model:

- `mingla-business/src/store/draftEventStore.ts`
- `DraftEvent.serverSlug` is nullable.
- Comment says it is `Null only for legacy local drafts`.
- Local IDs can start with `d_`.

Server draft migration:

- `useServerDraftsForBrand` tries to migrate `d_` drafts in the background.
- The edit route also migrates legacy `d_` drafts before editing.

Events tab delete:

- Does not branch on `draft.id.startsWith("d_")`.
- Does not branch on `draft.serverSlug === null`.
- Always calls server discard.

### Root Cause

The Events tab assumes every visible draft is server-backed. That is usually true after ORCH-0756B, but not guaranteed during migration, failed migration, or stale persisted Zustand state.

If a local-only draft is deleted before migration finishes, the app can send a local `d_...` ID into a Supabase `events.id = uuid` update path. That is a separate failure path from the observed `403`, but it is in the same destructive action and should be closed in the same repair.

## Finding 4: Mutation Error Contract Is Broader Than Draft Delete

**Severity:** P2  
**User impact:** Similar lifecycle actions can fail with incomplete diagnostics even when callers catch `mutateAsync`.

### Evidence

The following hooks use `useMutation` without `onError`:

- `useDiscardServerDraft` in `src/hooks/useServerDraftEvents.ts`
- `useServerDraftAutosave` in `src/hooks/useServerDraftEvents.ts`
- `useCreateServerDraft` in `src/hooks/useServerDraftEvents.ts`
- `usePublishBusinessEventDraft` in `src/hooks/useBusinessEvents.ts`
- `useCancelBusinessEvent` in `src/hooks/useBusinessEvents.ts`
- `useEndBusinessEventTicketSales` in `src/hooks/useBusinessEvents.ts`

The current launch blocker is draft delete. The blast-radius issue is that the newly repaired lifecycle family does not yet satisfy the repository mutation contract.

## Finding 5: Runtime QA Testability Is Mostly Present, But Needs A Small Guard

**Severity:** P2 for automation reliability  
**User impact:** Not proven as a normal-user bug.

### Evidence

Key controls already expose labels:

- `CreatorStep1Basics` has `accessibilityLabel="Event name"`.
- `CreatorStep1Basics` has `accessibilityLabel="Event description"`.
- Category picker exposes `Pick a category` or `Category: <value>`.
- `ShareModal` buttons default to `Copy link` and `Share via...`.
- `EventManageMenu` exposes action labels including `Delete draft`.
- `ConfirmDialog` buttons default to their labels.

The tester's automation still mis-focused the event name/description flow. That points more to script brittleness than a proven product defect. However, adding stable `testID`s to the share modal and destructive draft-delete controls would reduce future runtime test flake with low risk.

## Correct Domain Contract

| Contract | Evidence |
|---|---|
| Canonical public web origin | `https://business.usemingla.com` |
| Source of truth | `mingla-business/src/constants/platformUrl.ts` |
| URL builders | `mingla-business/src/constants/publicUrls.ts` |
| Expo config default | `mingla-business/app.config.ts` |
| Associated domains | `mingla-business/app.json` includes `applinks:business.usemingla.com` |
| Guardrail | `publicUrls.test.ts` asserts canonical public URLs |

Do not reintroduce:

- `mingla.com/e/...`
- `business.mingla.com/...`
- `exp://...`
- `localhost`
- `draft-*` public links
- current-route URLs as share URLs

## Cleanup Constraint For QA Draft

Do not clean the visible QA draft directly through SQL in forensics.

Safe cleanup path after implementation:

1. Use the app UI delete flow.
2. Confirm the new server discard RPC succeeds.
3. Confirm the draft disappears from the Events tab.
4. Confirm the draft query cache and local Zustand cache are clear.
5. If the RPC returns a legitimate permission error, show that error in the modal and leave the draft visible.

## Required Fix Direction

1. Make web share text include the exact canonical public URL, while keeping the `url` field.
2. Move draft discard to a server-authoritative RPC with explicit auth, row lock, rank check, status check, soft delete, and a clear return payload.
3. Branch local-only draft deletion away from server discard.
4. Add visible pending/error handling to the delete confirmation.
5. Add `onError` to the affected mutation hooks, at least the draft discard path and preferably the ORCH-0763D lifecycle family.
6. Add tests that fail before the repair:
   - web share `text` must contain the canonical URL,
   - server draft discard must use the RPC, not direct `events.update`,
   - local-only drafts are deleted locally,
   - delete draft confirm shows pending/error and closes only on success,
   - mutation hook has `onError`.

## Closure Readiness

ORCH-0763D is not closeable yet.

Close criteria:

- Implement the rework spec.
- Run unit/static gates.
- Run the right-simulator runtime retest.
- Verify pasteboard after public Safari share-sheet Copy contains the full URL.
- Verify QA draft deletion succeeds through the UI or shows an honest permission error.
- Independent tester returns PASS.
