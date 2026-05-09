# Implementation Report: ORCH-0763 Business Event System Regression Repair

Date: 2026-05-08
Skill: `$implementor`
Status: implemented and verified locally; DB push/deploy/runtime smoke still required

## Summary

Implemented the ORCH-0763 P0 repair path for Mingla Business event publish and organiser event authority.

The key behavior change: publishing no longer promotes a draft through scattered client `ticket_types` writes plus a local `liveEventStore` conversion. The app now calls an atomic Supabase RPC, uses the returned server event id/brand slug/final event slug as public truth, and lists/opens published organiser events from server-backed React Query reads.

## Files Changed

- `supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql`
- `mingla-business/src/services/businessEvents.ts`
- `mingla-business/src/hooks/useBusinessEvents.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/event/CreatorStep7Preview.tsx`
- `mingla-business/src/components/event/EditPublishedScreen.tsx`
- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/(tabs)/events.tsx`
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/src/store/liveEventStore.ts`
- `mingla-business/src/services/__tests__/businessEventsPublish.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- `mingla-business/package.json`

## Migration

Added monotonic migration:

`supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql`

Local and linked remote migration heads were both `20260515000003`, so `20260515000004` is greater than both.

Migration contents:

- Replaces `biz_prevent_event_slug_change` with lifecycle-aware immutability.
- Allows slug change only for draft -> scheduled/live when `published_at` becomes non-null and the RPC sets `mingla.business_publish_event_draft = on`.
- Adds `business_management_events_view` for authenticated organiser published-event reads.
- Adds `business_publish_event_draft(uuid, jsonb, integer)` as the atomic publish path.
- Grants RPC execute to `authenticated` and `service_role`; revokes anon.

No `supabase db push` was run.

## Behavior Changes

### ORCH-0763A `draft-*` Slug Bug

Fixed by moving final slug ownership to the RPC:

- Drafts may still have internal placeholder slugs.
- Published events get a title-derived slug inside `business_publish_event_draft`.
- The RPC rejects/fixes slug bases that would become `draft-*`.
- The client rejects any RPC response that still returns `draft-*`.
- Step 7 no longer renders `draft.serverSlug` as a future public URL.

### Atomic Publish

Client publish now calls `publishBusinessEventDraft()`, which invokes:

`business_publish_event_draft`

The old `markServerDraftPublished()` client multi-table promotion path now throws and tells callers to use the RPC.

### Organiser Server Authority

Added `useBusinessEventsForBrand`, `useBusinessEventById`, and `businessEventKeys`.

Updated Home, Events, Event Detail, and Edit Published to hydrate published organiser events from Supabase/React Query. `liveEventStore` remains as legacy fallback/cache compatibility, not the primary source.

### Link UX

- Step 7 now says: `Your public link will be created after publish.`
- It does not show a `draft-*` URL before publish.
- Share modal now shows the full URL as an actionable link in addition to Copy/Share/QR/platform actions.
- Public event URL builders still use `https://business.usemingla.com`.

### Autosave Hardening

Wizard field changes are now local-first with a 700ms debounced server autosave. Publish cancels any pending debounce and publishes the latest local draft snapshot.

### Published Edit

Edit Published can now open from a server-loaded event even when local `liveEventStore` is empty. Full non-cover save mutations remain disabled with honest messaging when the event came only from the server because a general published-event update RPC is outside this spec.

## Verification

Commands run:

```text
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0763
PASS: 4 suites, 24 tests
```

```text
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0759
PASS: 4 suites, 24 tests
```

```text
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0756b
PASS: 2 suites, 19 tests
```

```text
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npm run test:orch-0758a
PASS: 6 suites, 30 tests
```

```text
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
PASS
```

```text
cd mingla-business && PATH="/opt/homebrew/bin:$PATH" npx eslint [touched files]
PASS
```

```text
git diff --check
PASS
```

Supabase:

```text
/Users/sethogieva/bin/supabase migration list --linked
PASS: local/remote heads end at 20260515000003 before new migration
```

```text
/Users/sethogieva/bin/supabase db lint --linked
EXIT 0, but existing unrelated schema lint issues remain in older functions such as admin_list_stale_places, execute_undo_action, admin_clear_expired_caches, and anonymize_user_audit_log. No ORCH-0763 function was reported.
```

No edge function changed; no Deno gate required.

## Production Recovery Recommendation

Do not mutate production automatically.

Known affected row:

```text
event id: ecb4839f-1448-47e2-ba27-094fff6a9a61
brand_slug: leggothis
title: Visa
slug: draft-nlhj
status: scheduled
visibility: public
```

After the migration is pushed and the fixed client is deployed, operator should decide whether to repair this existing row. Recommended runbook:

1. Confirm no shared buyer-facing traffic depends on `/e/leggothis/draft-nlhj`.
2. If safe, update slug to a title-derived value such as `visa` inside an operator-approved SQL transaction, or create an alias/redirect strategy if the draft URL may have been shared.
3. Verify `business_public_events_view` resolves the corrected slug and ticket row.
4. Keep a rollback note with old slug `draft-nlhj`.

## Remaining Gates

- Operator runs `supabase db push`.
- Deploy Mingla Business web/native bundle containing this patch.
- Tester runs runtime smoke: create free event, publish, verify final non-draft URL, open/copy/share link, clear local storage, confirm Home/Events/Detail/Edit Published still load from server.
- Existing production `draft-nlhj` row requires explicit recovery decision.

## Side Discoveries

- Full post-publish editing beyond cover media still needs a dedicated server mutation/RPC spec.
- `supabase db lint --linked` reports unrelated legacy schema issues outside this ORCH-0763 slice.
