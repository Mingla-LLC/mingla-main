# Implementation Rework: ORCH-0763D iOS Public Share + Draft Delete

> Date: 2026-05-09  
> Mode: IMPLEMENTOR / REWORK  
> Status: implemented, partially verified  
> Dispatch: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`

## Plain-English Summary

The share-link path now puts the real public URL into the text Safari/iOS copies from the share sheet. That means `Share via... -> Copy` should no longer paste only the event description.

Draft deletion now has a server-owned RPC path instead of a direct client table update. The app also distinguishes old local-only drafts from server-backed drafts, shows a pending state while deleting, and renders an inline error inside the confirm modal if deletion fails.

## Files Changed

- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/hooks/useBusinessEvents.ts`
- `mingla-business/app/(tabs)/events.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/ui/ConfirmDialog.tsx`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- `supabase/migrations/20260515000006_orch_0763d_draft_discard_rpc.sql`

## What Changed

### Public Share Payload

- Added `buildPublicShareText(...)`.
- Web `navigator.share(...)` now sends the canonical public URL in both:
  - `url`
  - `text`
- Native `Share.share(...)` still sends the URL in the message and `url`.
- Added tests proving web/native share payloads include `https://business.usemingla.com/...` and reject Expo/current-route/wrong-domain payloads.

### Draft Discard Backend

- Added migration:
  - `20260515000006_orch_0763d_draft_discard_rpc.sql`
- New RPC:
  - `public.business_discard_event_draft(p_event_id uuid)`
- RPC behavior:
  - requires authenticated user,
  - locks event row `FOR UPDATE`,
  - only allows `status = 'draft'`,
  - requires `event_manager` rank or higher,
  - verifies brand still exists,
  - soft-deletes with `deleted_at` and `updated_at`,
  - returns `event_id`, `brand_id`, `deleted_at`.

### Service / Hooks

- `discardServerDraft` now calls `business_discard_event_draft`.
- It throws on Supabase error or malformed RPC response.
- `useDiscardServerDraft` now has mutation `onError` logging and exposes `error`.
- Added minimal `onError` logging to adjacent draft and event lifecycle mutations to satisfy the mutation contract.

### UI Behavior

- Events tab delete flow now:
  - deletes local-only drafts locally,
  - sends server-backed drafts through the RPC path,
  - shows loading on the destructive button,
  - prevents duplicate destructive taps while pending,
  - keeps the modal open on failure,
  - shows inline modal error text.
- `ConfirmDialog` now supports:
  - `confirmLoading`,
  - `confirmDisabled`,
  - `errorMessage`,
  - `closeDisabled`,
  - confirm/cancel test IDs.
- Wizard discard flow now follows the same local-only/server-backed branch.

## Migration Ordering

Checked:

- Local max before new migration: `20260515000005`
- Linked remote max before new migration: `20260515000005`

Created:

- `20260515000006_orch_0763d_draft_discard_rpc.sql`

Operator still must run:

```bash
supabase db push
```

Do not runtime-retest draft delete until that migration is applied remotely.

## Verification

Passed:

```bash
cd mingla-business
npx jest sharePublicUrl.test serverDraftLifecycleGuards.test publicUrls.test
```

Result: 3 suites passed, 26 tests passed.

```bash
cd mingla-business
npm run test:orch-0763
```

Result: 7 suites passed, 46 tests passed.

```bash
cd mingla-business
npm run test:orch-0759
```

Result: gate exited 0; real scan passed with 0 violations; 4 suites passed, 29 tests passed. Note: this gate intentionally prints a fake self-test violation against `active-bad.tsx` before confirming the scanner catches it.

```bash
cd mingla-business
npm run test:orch-0756b
```

Result: 2 suites passed, 24 tests passed.

```bash
cd mingla-business
npx tsc --noEmit
```

Result: passed.

```bash
cd mingla-business
npx eslint src/utils/sharePublicUrl.ts src/utils/__tests__/sharePublicUrl.test.ts src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts src/hooks/useBusinessEvents.ts 'app/(tabs)/events.tsx' src/components/event/EventCreatorWizard.tsx 'app/event/[id]/edit.tsx' src/components/ui/ConfirmDialog.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: passed with no warnings.

```bash
git diff --check
```

Result: passed.

## Runtime / Deployment Notes

- No native dependency was added.
- No native rebuild is required solely for this rework.
- A web deploy is required for Safari public-page share behavior.
- `supabase db push` is required before server-backed draft deletion can pass against remote.
- No edge function deploy is needed.
- I did not mutate live Supabase data and did not clean the QA draft directly.

## Remaining Gates

After operator runs `supabase db push`, dispatch `$tester` for right-simulator runtime retest:

- public event page `Copy link`,
- public event page `Share via... -> iOS Copy`,
- public brand page share parity,
- QA draft delete through UI,
- fresh free-event publish/share smoke,
- verify no Expo, localhost, `mingla.com/e`, `business.mingla.com`, or `draft-*` public links.
