# IMPLEMENTATION ORCH-0756B - Business Server-Backed Event Drafts

Status: implemented, partially verified
Date: 2026-05-08
Owner: implementor

## Plain-English Summary

Business event drafts are no longer created only in local Zustand. Starting a new draft now creates a Supabase `events` row with `status='draft'`, the wizard autosaves draft state back to that row, and Home/Events/edit/preview hydrate draft cache from the server. Local Zustand remains as the immediate UI cache and legacy migration source, but Supabase is now the durable copy that can survive sign-out and app deletion after a successful server save.

## Files Changed

- `mingla-business/src/utils/serverDraftEventMapper.ts` - maps `DraftEvent` to/from Supabase `events.theme.business_draft`.
- `mingla-business/src/services/eventDrafts.ts` - create/fetch/autosave/discard/publish-resolution service.
- `mingla-business/src/hooks/useServerDraftEvents.ts` - React Query hooks, cache sync, and legacy local draft migration.
- `mingla-business/src/store/draftEventStore.ts` - adds cache upsert/replace actions and `passwordConfigured`.
- `mingla-business/app/event/create.tsx` - creates server draft before navigation.
- `mingla-business/app/event/[id]/edit.tsx` - hydrates server drafts, migrates legacy `d_...` drafts, wires autosave/discard/publish resolution.
- `mingla-business/app/event/[id]/preview.tsx` - hydrates server drafts and autosaves preview multi-date overrides.
- `mingla-business/app/(tabs)/home.tsx` and `app/(tabs)/events.tsx` - hydrate server drafts for the active brand.
- `mingla-business/src/components/event/EventCreatorWizard.tsx` - calls autosave on edits/step changes, blocks local publish until server publish resolution succeeds, shows save state.
- `mingla-business/src/components/event/TicketTierEditSheet.tsx` and `src/utils/draftEventValidation.ts` - support recovered password-protected tickets without exposing plaintext.
- `mingla-business/src/hooks/useBrands.ts` - fixes DB status vocabulary drift in cascade preview queries (`scheduled`/`ended`/`cancelled`, not `upcoming`/`past`).
- `mingla-business/src/utils/__tests__/serverDraftEventMapper.test.ts` - regression coverage.
- `mingla-business/package.json` - adds `test:orch-0756b`.
- `supabase/migrations/20260515000001_orch_0756b_event_draft_persistence.sql` - monotonic migration documenting the draft JSON contract and status vocabulary.

## Spec Traceability

- Server source of truth: implemented via `events.status='draft'`, `events.visibility='draft'`, server UUID ids, and `theme.business_draft`.
- Create route: waits for `createServerDraft` before navigating to `/event/{serverEventId}/edit?step=0`.
- Edit/preview hydration: routes fetch server draft before redirecting away.
- Autosave: wizard writes local cache immediately and triggers server autosave; save state shows `Saving`, `Saved`, or `Unsaved changes - retrying`.
- Sign-out/app-delete recovery: once the server save exists, Home/Events/edit/preview refetch drafts from Supabase after local cache is gone.
- Legacy local drafts: `d_...` drafts are migrated to server on active-brand draft hydration or direct edit/preview route, then replaced with the server UUID.
- Discard: server draft is soft-deleted before local cache removal.
- Publish resolution: server draft is promoted out of `draft` before local publish deletes the draft cache, so it should not reappear as a draft after publish.
- Password safety: plaintext ticket passwords are stripped from server JSON. Recovered tickets use `passwordConfigured: true` and `password: null`.
- Status drift: brand cascade preview now queries DB statuses that exist.

## Migration Notes

Migration added:

`supabase/migrations/20260515000001_orch_0756b_event_draft_persistence.sql`

Monotonic proof:

- Local max before this change: `20260515000000_orch_0757_place_intel_retry_lineage.sql`
- Remote max from `supabase migration list --linked`: `20260515000000`
- New migration: `20260515000001`, strictly greater than both.

No `supabase db push` was run. Operator owns that deployment gate.

## Verification

PASS:

```bash
cd mingla-business && npm run test:orch-0756b
```

Result: 6/6 mapper/password/status tests passed.

PASS:

```bash
cd mingla-business && npm run test:orch-0756a
```

Result: active-brand recovery strict guard passed; resolver Jest 6/6 passed.

PASS:

```bash
cd mingla-business && npm run test:orch-0754
```

Result: Home fake-data strict guard passed; brandEventSummary Jest 5/5 passed.

PASS:

```bash
cd mingla-business && npx tsc --noEmit
```

PASS with warnings only:

```bash
cd mingla-business && npx eslint app/event/create.tsx 'app/event/[id]/edit.tsx' 'app/event/[id]/preview.tsx' 'app/(tabs)/home.tsx' 'app/(tabs)/events.tsx' src/components/event/EventCreatorWizard.tsx src/components/event/TicketTierEditSheet.tsx src/hooks/useServerDraftEvents.ts src/services/eventDrafts.ts src/store/draftEventStore.ts src/utils/draftEventValidation.ts src/utils/serverDraftEventMapper.ts src/utils/__tests__/serverDraftEventMapper.test.ts src/hooks/useBrands.ts
```

Result: 0 errors, 0 warnings after final cleanup.

PASS:

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result: remote migration head is `20260515000000`; local `20260515000001` is pending.

PASS:

```bash
/Users/sethogieva/bin/supabase db push --dry-run
```

Result: would push only `20260515000001_orch_0756b_event_draft_persistence.sql`; no database mutation performed.

BLOCKED:

```bash
/Users/sethogieva/bin/supabase db reset
```

Result: `supabase start is not running.` Local reset could not run without starting the local Supabase stack.

KNOWN EXISTING DEBT:

```bash
cd mingla-business && npm run lint
```

Result: still fails from broad pre-existing repo lint debt across unrelated files. Touched-file ESLint is clean.

## Caveats / Tester Focus

- Runtime sign-out/sign-in and app deletion recovery still need credentialed app smoke after the operator applies the migration with `supabase db push`.
- This implementation does not materialize canonical `event_dates` or `ticket_types` on publish. It resolves the draft lifecycle by promoting the server draft out of `draft`; full live-event/order/checkout durability remains outside ORCH-0756B.
- Plaintext ticket passwords are intentionally not recoverable from server drafts. A recovered password-protected ticket remains configured and validation accepts it, but the original secret is not displayed.
- Offline retry is represented as visible autosave error/retry state; deeper durable offline queueing is not fully implemented in this pass.

## Security Notes

- Public draft exposure stays blocked by existing public event policy, which only reads `visibility='public'` and `status IN ('scheduled','live')`.
- Server draft JSON strips `ticket.password`.
- RLS relies on existing event-manager-plus event policies for `events` draft create/update/select through brand-team access.

## Next Gate

Dispatch `$tester` for independent QA after the operator runs `supabase db push`.
