# SPEC ORCH-0763D Runtime Share, Date, and Lifecycle Repair

Date: 2026-05-08  
Mode: Forensics-authored implementation contract  
Status: Ready for implementor after user/orchestrator approval

## Goal

Repair the remaining free-event publish/share runtime blockers without reopening the already-fixed domain/slug work.

In plain terms: users should be able to publish a free event, copy/share a real public webpage URL, see the real date on every public buyer surface, and cancel/close sales for server-backed events through the UI.

## Non-Goals And Hard Guards

Do not:

- Change the canonical public domain away from `https://business.usemingla.com`.
- Reintroduce `mingla.com`, `business.mingla.com`, Expo URLs, current-route URLs, or `draft-*` public links.
- Run `supabase db push`.
- Deploy.
- Directly mutate Supabase data.
- Hard-delete live/public events.
- Broaden into Stripe, checkout payment processing, media providers, brand page redesign, or unrelated event management.
- Remove ORCH-0759 or ORCH-0763 regression guards.

If a Supabase migration is needed, use a filename greater than the current repo max migration: `20260515000005_*` or later.

## Root Causes To Fix

1. `ShareModal` has no native clipboard writer. Native `Copy link` only shows a workaround toast.
2. `EventManageMenu` labels a modal-opening action as `Copy share link`.
3. `publicEventsService` ignores `public_theme.business_event.when`, so public `LiveEvent.date` is null.
4. Server-backed lifecycle actions are hidden because only local lifecycle mutations exist.
5. Public read/view policy currently excludes `cancelled` and `ended`, making the existing cancelled/past page variants unreachable for server-backed public URLs.

## Implementation Tasks

### 1. Add One Share/Clipboard Helper

Targets:

- `mingla-business/package.json`
- lockfile, if present
- `mingla-business/src/utils/sharePublicUrl.ts` or similarly named utility
- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/event/EventManageMenu.tsx`
- Events tab and Event Detail only as needed for label/callback changes

Requirements:

- Add `expo-clipboard` compatible with Expo SDK 54.
- Create a helper that owns:
  - `copyPublicUrl(url): Promise<void>`
  - `sharePublicUrl({ title, url, description? }): Promise<void>`
  - platform-specific web/native behavior.
- Native copy must call `Clipboard.setStringAsync(url)`.
- Web copy must keep `navigator.clipboard.writeText(url)`.
- Share payload must always include the canonical `https://business.usemingla.com/...` URL.
- Success toast must only fire after copy resolves.
- Failure toast must say copy failed.
- Remove or delegate the unused `PublicEventPage.handleShare` so there is not a second share implementation.
- Rename `EventManageMenu` row from `Copy share link` to `Share event` or `Share link` unless it is changed to truly copy directly.

Native rebuild implication:

- Adding `expo-clipboard` requires a fresh native dependency install and likely a new dev-client/native build before iOS runtime verification. Tester must not trust an old simulator build for clipboard verification.

### 2. Repair Public Event Date Mapping

Targets:

- `mingla-business/src/services/publicEventsService.ts`
- optional shared mapper helper to avoid duplicating `businessEvents.ts` parsing
- `mingla-business/src/services/__tests__/publicEventsService.test.ts` or existing service test file

Requirements:

- Parse `row.public_theme.business_event`.
- Map these fields into public `LiveEvent`:
  - `whenMode`
  - `date`
  - `doorsOpen`
  - `endsAt`
  - `timezone`
  - `recurrenceRule`
  - `multiDates`
  - `format`
  - `category`
  - `location.venueName`
  - `location.address`
  - `settings.requireApproval`
  - `settings.allowTransfers`
  - `settings.hideRemainingCount`
  - `settings.passwordProtected`
  - `settings.privateGuestList`
  - `settings.inPersonPaymentsEnabled`
- Timezone precedence: `business_event.when.timezone` first, `row.timezone` second, `"UTC"` fallback only if both are missing.
- Missing/invalid date behavior: keep `Date TBD`, but only when the saved public payload truly lacks a valid date for that event mode.
- Do not invent top-level date fields unless a separate migration intentionally introduces them.

Regression acceptance:

- Given the runtime payload shape with `business_event.when.date = "2026-05-08"` and `doorsOpen = "21:00"`, public event, public brand card, and checkout mini-card mappers must expose `date = "2026-05-08"` and `doorsOpen = "21:00"`.

### 3. Add Server-Backed Cancel Event

Targets:

- New Supabase migration `20260515000005_orch_0763d_event_lifecycle_repair.sql` or later
- `mingla-business/src/services/businessEvents.ts`
- `mingla-business/src/hooks/useBusinessEvents.ts`
- `mingla-business/app/(tabs)/events.tsx`
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
- new lifecycle service tests

Requirements:

- Add a server-authoritative cancel path for published events.
- Only brand `event_manager` rank or above may cancel.
- Allowed input statuses: `scheduled` and `live`.
- Server mutation must:
  - lock the event row,
  - verify caller rank,
  - reject deleted/nonexistent/wrong-status events,
  - set `events.status = 'cancelled'`,
  - set `updated_at = now()`,
  - return the durable event row/brand/tickets in the same shape used by management reads.
- UI must show `Cancel event` for server-backed scheduled/live events when `canEditEvent` is true.
- On success, update/invalidate:
  - `businessEventKeys.detail(eventId)`
  - `businessEventKeys.list(brandId)`
  - relevant public event query keys if reachable from the same client.
- On failure, keep the dialog/action available and show a clear retry error.
- Do not hard-delete live/public events.

Public route requirement:

- Decide in the migration whether exact public event URLs for cancelled events remain readable.
- Because `PublicEventPage` already has a cancelled variant, the preferred contract is:
  - `business_public_events_view` allows exact public reads for `scheduled`, `live`, `ended`, and `cancelled`;
  - public brand "upcoming" lists may exclude `cancelled`;
  - checkout/purchase paths must reject or show unavailable for `cancelled`.
- If view-level filtering cannot distinguish exact event detail from brand listing, keep cancelled events in the public read model and filter them out in `PublicBrandPage`.

### 4. Add Server-Backed End Ticket Sales

Targets:

- same migration/service/hook area as cancel
- `PublicEventPage.tsx`
- `checkout/[eventId]/index.tsx` / `QuantityRow.tsx` only if needed
- ticket display tests

Requirements:

- `End ticket sales` must not mark the event itself as past/ended.
- It should close sellable tickets by updating server ticket sale state:
  - preferred: set `ticket_types.sale_end_at = now()` for non-hidden, non-deleted ticket types that are currently available online;
  - optionally also set `is_disabled = true` if product wants the public page to say `Sales paused`.
- Public event page ticket rows must respect sale-ended state, not only checkout rows.
- Existing tickets/orders remain valid.
- UI must show `End ticket sales` for live server-backed events when `canEditEvent` is true.
- Error handling must be loud and retryable.

### 5. Keep Permission Semantics Tight

Actors:

- Owner/admin/event manager: can edit, cancel scheduled/live events, end ticket sales on live events, delete drafts.
- Finance/scanner/lower ranks: must not see cancel/end/delete actions.

Statuses:

- Draft: `Delete draft`, `Publish event`.
- Scheduled/upcoming: `Cancel event`; no hard delete.
- Live: `End ticket sales` and `Cancel event`.
- Ended/past: no cancel/end-sales; orders/refunds remain reachable.
- Cancelled: no cancel/end-sales; show management/read-only state and relevant orders/refunds.

Server is authoritative. Client gating is UX only; RPCs must enforce rank and status.

## Tests Required

Add/update automated tests so the current bugs fail before the fix and pass after.

Minimum unit/static tests:

- Share helper:
  - native copy calls `expo-clipboard.setStringAsync` with the exact canonical URL.
  - web copy calls `navigator.clipboard.writeText`.
  - share payload contains `https://business.usemingla.com/...`, never Expo/current route.
- `ShareModal`:
  - success toast only after resolved copy.
  - failure toast on rejected copy.
- Event menu:
  - no action labelled `Copy share link` unless it directly copies.
- Public mapper:
  - maps `public_theme.business_event.when` into `date`, `doorsOpen`, `endsAt`, `timezone`.
  - public brand event rows and checkout detail receive the same mapped date.
  - multi-date and recurring payloads preserve `multiDates` and `recurrenceRule`.
- Lifecycle service:
  - cancel RPC adapter calls the correct RPC and maps returned event.
  - end-sales RPC adapter maps returned tickets with sale-ended/disabled state.
  - server-backed lifecycle guard test is rewritten; it must no longer assert "Server event cancellation is not available yet."
- Public lifecycle:
  - cancelled exact event detail can render cancelled state if the spec includes cancelled in public reads.
  - checkout cannot reserve/buy cancelled or sales-ended tickets.

Required commands from `mingla-business/`:

```bash
npm run test:orch-0763
npm run test:orch-0759
npm run test:orch-0756b
npx tsc --noEmit
```

Also run targeted lint on touched files, for example:

```bash
npx eslint src/components/ui/ShareModal.tsx src/services/publicEventsService.ts src/services/businessEvents.ts src/hooks/useBusinessEvents.ts
```

Repo-root:

```bash
git diff --check
```

## Runtime Retest Plan For Tester

Use the same correct simulator unless the dev-client rebuild changes device state:

`iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`

1. Install/rebuild the native app if `expo-clipboard` was added.
2. Log into Mingla Business and select `Test Stripe`.
3. Create a clean free-only event with a clear title, date, doors-open time, and venue.
4. Publish it.
5. Verify Step 7/post-publish and share modal show `business.usemingla.com`, not Expo, `mingla.com`, `business.mingla.com`, or `draft-*`.
6. Tap public page `Copy link`; verify simulator pasteboard equals the public URL.
7. Tap event-list menu share action; verify the label behavior is correct.
8. Tap `Share via...`; share to a reliable recipient target and verify delivered text contains the same public URL.
9. Open the URL in Safari; verify the public page shows the real event date/time.
10. Verify public brand page and checkout mini-card show the same date/time.
11. From Events tab and Event Detail, verify `Cancel event` is visible for the server-backed live/upcoming event.
12. Cancel the QA event through the UI.
13. Verify the event no longer sells tickets and either:
    - public URL shows a cancelled page, or
    - approved product behavior is documented and visible.

## Rollback And Cleanup

- If clipboard repair causes native build failure, rollback only the `expo-clipboard` dependency/helper usage and keep the date/lifecycle repairs separate.
- If lifecycle migration has to be rolled back, hide server-backed lifecycle actions again rather than allowing local false-success mutations.
- Existing QA event `b6122ef8-dc76-47d6-94a3-717450acff4f` should be cleaned up through the repaired UI cancel path. Operator-approved SQL cleanup is acceptable only outside this implementation/test pass.

## Definition Of Done

- Native copy writes the exact public URL on iOS.
- Share payload delivers the SEO public URL, not Expo/current route.
- Public event page no longer shows `DATE TBD` for events with saved `business_event.when`.
- Public brand and checkout date displays match the event date.
- Server-backed live/upcoming events expose real lifecycle actions to authorized brand users.
- Cancelling the QA event is possible without direct DB mutation.
- ORCH-0759 and ORCH-0763 domain/slug guards still pass.

