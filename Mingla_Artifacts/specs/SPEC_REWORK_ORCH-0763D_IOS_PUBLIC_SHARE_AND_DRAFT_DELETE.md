# Spec Rework: ORCH-0763D iOS Public Share + Draft Delete

> Written: 2026-05-09  
> Owner lane: IMPLEMENTOR after forensic handoff  
> Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_REWORK_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`

## Goal

Close the two remaining ORCH-0763D runtime blockers:

1. Public webpage `Share via...` on iOS Safari must share/copy the SEO public URL, not just event text.
2. Draft delete must either delete the draft through a safe server-authoritative path or show a clear visible error.

## Non-Goals

- Do not change the canonical public domain. It remains `https://business.usemingla.com`.
- Do not touch payment, Stripe, checkout, ticket sales, or publish semantics except cache invalidation needed after draft delete.
- Do not directly clean the QA draft through SQL.
- Do not rebuild public routing or SEO metadata.
- Do not make a broad wizard UI redesign. Only add minimal testability hooks if needed.

## Hard Guards

- No `mingla.com/e/...`.
- No `business.mingla.com/...`.
- No Expo dev links in share payloads.
- No `localhost` share payloads in production tests.
- No `draft-*` public links.
- No direct client-side draft promotion.
- No silent user-initiated mutation failures.

## Workstream A: Public Web Share Payload

### Files

- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
- Optional, only if needed for runtime QA:
  - `mingla-business/src/components/ui/ShareModal.tsx`

### Required Behavior

Build one canonical share text helper used by both web and native branches.

Contract:

- Input: `{ title, url, description }`.
- Output must include the exact `url`.
- Output must not include `exp://`, `localhost`, `mingla.com/e`, or `business.mingla.com`.
- Description may be included, but URL is mandatory.
- URL should appear once unless the caller explicitly passes a description that already includes it.

Recommended shape:

```ts
const buildPublicShareText = ({ title, url, description }) =>
  [description?.trim() || title.trim(), url].filter(Boolean).join("\n");
```

Then:

- Web:
  - `navigator.share({ title, url, text: shareText })`
- Native:
  - `Share.share({ title, message: [title, shareText].join("\n"), url })`
  - Avoid duplicate title if the helper already includes title.

Implementation may choose a slightly different helper shape, but the exact URL must be present in web `text` and native `message`.

### Tests

Update `sharePublicUrl.test.ts`:

- Web share payload includes:
  - `title`
  - `url`
  - `text: expect.stringContaining(canonicalUrl)`
- Web share payload string does not contain:
  - `exp://`
  - `localhost`
  - `mingla.com/e`
  - `business.mingla.com`
- Native share still contains URL in `message`.
- Add a helper-level test, if exported:
  - description present,
  - description absent,
  - description already contains URL.

## Workstream B: Server-Authoritative Draft Discard

### Files

- New Supabase migration:
  - `supabase/migrations/<timestamp>_orch_0763d_draft_discard_rpc.sql`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- Optional dedicated service test if local patterns support it.

### Database RPC

Add:

```sql
public.business_discard_event_draft(p_event_id uuid) returns jsonb
```

RPC requirements:

- `LANGUAGE plpgsql`
- `SECURITY DEFINER`
- `SET search_path TO 'public', 'pg_temp'`
- `auth.uid()` must be non-null, else raise `not_authenticated`.
- Select the event row `FOR UPDATE`.
- If not found or `deleted_at IS NOT NULL`, raise `event_draft_not_found`.
- If `status <> 'draft'`, raise `event_draft_not_discardable`.
- Require:
  - `biz_brand_effective_rank(v_event.brand_id, v_user_id) >= biz_role_rank('event_manager')`
  - else raise `insufficient_event_permission`.
- Verify the brand still exists and is not deleted, else raise `brand_not_found`.
- Soft delete:
  - `deleted_at = now()`
  - `updated_at = now()`
- Return JSON with at least:
  - `event_id`
  - `brand_id`
  - `deleted_at`

Granting:

- Revoke from `PUBLIC`.
- Revoke from `anon`.
- Grant execute to `authenticated, service_role`.

Do not alter public event read policies for this workstream.

### Service Contract

Change `discardServerDraft` to call the RPC:

```ts
supabase.rpc("business_discard_event_draft", { p_event_id: draftId })
```

The service must:

- Throw on Supabase error.
- Throw if RPC returns null or malformed payload.
- Not perform direct `events.update(...)` for server-backed draft discard.

### Hook Contract

Update `useDiscardServerDraft`:

- Keep pessimistic behavior.
- Delete local draft only on RPC success.
- Remove draft detail query on success.
- Invalidate draft list query on success.
- Add `onError` that logs the error per `docs/MUTATION_CONTRACT.md`.
- Return at least:
  - `discardDraft`
  - `isPending`
  - `error` or enough state for callers to show a visible error.

Recommended low-risk broader cleanup:

- Add minimal `onError` logging to the ORCH-0763D lifecycle mutation hooks in `useBusinessEvents.ts`.
- Add minimal `onError` logging to `useServerDraftAutosave` and `useCreateServerDraft`.

## Workstream C: Delete Draft UI State And Local-Only Branch

### Files

- `mingla-business/app/(tabs)/events.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/src/components/ui/ConfirmDialog.tsx`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`

### Events Tab Behavior

When the user confirms `Delete draft`:

1. Find the draft.
2. If draft is local-only:
   - `draft.id.startsWith("d_") || draft.serverSlug === null`
   - delete it from Zustand locally,
   - close the modal,
   - show `Draft deleted.`
   - do not call Supabase.
3. If draft is server-backed:
   - call `useDiscardServerDraft().discardDraft(draft)`.
   - close the modal only after success.
   - show `Draft deleted.` after success.
   - on failure, keep modal open and show a visible inline error.

Suggested error copy:

- Generic: `Could not delete this draft. Try again.`
- Permission-specific if mapped from RPC message:
  - `You do not have permission to delete this draft for this brand.`

### Pending State

The confirm modal must prevent duplicate destructive taps while pending.

Acceptable implementation:

- Extend `ConfirmDialog` props:
  - `confirmLoading?: boolean`
  - `confirmDisabled?: boolean`
  - `errorMessage?: string | null`
  - optionally `closeDisabled?: boolean`
- Wire `Button loading={confirmLoading}` and `disabled={confirmDisabled}`.
- Render `errorMessage` inside the modal body under the description.
- Disable close/cancel while pending only for destructive server mutations.

Alternative:

- Keep `ConfirmDialog` unchanged and create a local draft-delete-specific modal.

Preferred path is extending `ConfirmDialog` because `Button` already supports `loading`, `disabled`, `accessibilityState.busy`, and `testID`.

### Wizard Discard Behavior

`EventCreatorWizard` and `app/event/[id]/edit.tsx` should not route local-only drafts into server discard.

Implement one of:

- Parent wrapper passes a `handleDiscardDraft` that branches local-only vs server-backed, or
- Wizard branches before calling `onDiscardServerDraft`.

Required:

- Server-backed drafts use the RPC path.
- Local-only drafts use local `deleteDraft`.
- Errors are visible, not swallowed.

## Workstream D: Minimal Runtime QA Hooks

### Files

- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/components/ui/ConfirmDialog.tsx`
- `mingla-business/src/components/event/CreatorStep1Basics.tsx` only if tester still cannot target labels

### Required

Only add test IDs where labels were insufficient in runtime QA:

- `share-modal-copy-link`
- `share-modal-share-via`
- `delete-draft-confirm`
- `delete-draft-confirm-button`
- `delete-draft-cancel-button`

Do not alter visual design for this workstream.

## Regression Tests

### Required Unit/Static Tests

Run and update as needed:

```bash
cd mingla-business
npx jest sharePublicUrl.test serverDraftLifecycleGuards.test publicUrls.test
```

Expected new assertions:

- Web share text contains canonical URL.
- Native share message still contains canonical URL.
- Server draft discard service references `business_discard_event_draft`.
- Server draft discard service does not contain direct `.from("events").update({ deleted_at`.
- Events tab has local-only draft delete branch.
- Events tab shows inline delete failure state or passes `errorMessage` to `ConfirmDialog`.
- `ConfirmDialog` supports pending/error state if extended.
- `useDiscardServerDraft` has `onError`.

### Required Broader Gates

Run existing ORCH gates:

```bash
cd mingla-business
npm run test:orch-0763
npm run test:orch-0759
npm run test:orch-0756b
npx tsc --noEmit
```

If lint target exists for touched files, run it as well.

## Runtime Verification Plan

Target the same right simulator:

- Device: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`
- App id: `com.sethogieva.minglabusiness`
- Signed-in brand expected: `Leggo This`

### Public Share Retest

1. Open known public event:
   - `https://business.usemingla.com/e/leggothis/test-event`
2. Tap public-page share button.
3. Tap `Copy link`.
4. Verify:
   - `xcrun simctl pbpaste` equals the exact URL.
5. Reset pasteboard to sentinel.
6. Tap `Share via...`.
7. In iOS native sheet, tap Copy.
8. Verify:
   - pasteboard contains `https://business.usemingla.com/e/leggothis/test-event`.
   - pasteboard does not contain Expo, localhost, `mingla.com/e`, or `business.mingla.com`.

### Brand Share Retest

1. Open public brand page for the same brand.
2. Repeat `Copy link` and `Share via...` Copy.
3. Verify pasteboard contains the canonical brand URL.

### Draft Delete Retest

1. Use the visible QA draft whose title begins `Runtime Share Test...`.
2. Open manage menu.
3. Tap `Delete draft`.
4. Confirm `Delete draft`.
5. Expected success path:
   - confirm button shows pending state,
   - modal closes,
   - toast says `Draft deleted.`,
   - draft disappears from Events tab.
6. Expected permission-failure path, if server legitimately denies:
   - modal remains open,
   - inline error is visible,
   - draft remains visible,
   - no infinite spinner,
   - no invisible-only toast.

### Fresh Free Event Smoke

1. Create a new free-ticket event.
2. Publish it.
3. Confirm Step 7 does not show a draft placeholder link.
4. Confirm public URL opens in Safari.
5. Confirm all share buttons produce canonical public URLs.
6. Delete/cancel cleanup through approved UI path only.

## Deployment And Build Implications

- No native dependency is added in this spec.
- A native rebuild should not be required for the share payload or draft discard logic.
- Supabase migration is required for `business_discard_event_draft`.
- Web deployment is required for Safari public-page share behavior.
- App update/reload is required for native business app logic if tested through the simulator build.

## Acceptance Criteria

This work is done when:

- Public Safari `Share via... -> Copy` puts the SEO public URL on the pasteboard.
- Public page `Copy link` still works.
- Native app `Copy link` and `Share via...` still work.
- Draft delete succeeds through the UI for authorized server-backed drafts.
- Legitimate draft delete failure shows an inline error in the modal.
- Local-only drafts do not call Supabase.
- `business_discard_event_draft` owns server-backed draft discard.
- Required tests and gates pass.
- Tester retest returns PASS.
