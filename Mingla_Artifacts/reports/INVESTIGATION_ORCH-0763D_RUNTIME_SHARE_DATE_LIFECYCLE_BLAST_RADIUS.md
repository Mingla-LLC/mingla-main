# ORCH-0763D Runtime Share, Date, and Lifecycle Blast Radius

Date: 2026-05-08  
Mode: Forensics / investigate-then-spec  
Verdict: FAIL - publish URL authority is mostly repaired, but share copy, public date mapping, and server-backed lifecycle cleanup are not release-safe.

## Executive Summary

The original wrong-domain/draft-link issue did not reproduce in the latest device sweep. The tested event used the canonical public URL:

`https://business.usemingla.com/e/teststripe/friday-free-sunset-mixer-qaga-free-golden-hour-rooftop-style-mixer-for-mingla-qa-with-easygoing-music-mocktails-and-room-to-meet-new-people`

That URL opened in Safari and returned HTTP 200. The remaining problem is not the canonical URL builder. It is three separate contract failures downstream:

1. Native `Copy link` is a dead tap. `ShareModal` never writes to the native clipboard, and `expo-clipboard` is not installed.
2. Public buyer reads drop the saved event date/time. The organiser management mapper reads `theme.business_event.when`; the public mapper sets `date`, `doorsOpen`, and `endsAt` to `null`, so public pages and checkout can show `Date TBD`.
3. Server-backed live events cannot be cleaned up through the UI. The menu intentionally hides cancel/end actions for server-backed events because only local lifecycle mutations exist.

There is also a larger lifecycle blast radius: server public views/RLS currently exclude `cancelled` and `ended` events, even though `PublicEventPage` has cancelled/past UI variants. If cancellation is implemented by setting `events.status = 'cancelled'`, the public URL will likely disappear instead of showing a cancelled event page unless the public read contract is amended.

No product code or data was changed in this forensics pass.

## Scope And Evidence

Seed runtime report:

- `Mingla_Artifacts/reports/RUNTIME_ORCH-0763_FREE_EVENT_SHARE_DEVICE_SWEEP.md`
- Correct simulator: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`
- QA event id: `b6122ef8-dc76-47d6-94a3-717450acff4f`
- Brand slug: `teststripe`
- Saved date payload: `theme.business_event.when.date = "2026-05-08"`, `doorsOpen = "21:00"`, `endsAt = "03:00"`, timezone `America/New_York`

Historical context:

- `INVESTIGATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md` proved old organiser events were local-authority and publish was non-atomic.
- `INVESTIGATION_ORCH-0763A_PUBLISH_DRAFT_SLUG_AND_SHARE_LINK_AUDIT.md` proved draft slugs were leaking into public links.
- `20260515000004_orch_0763_event_system_regression_repair.sql` repaired publish authority with `business_publish_event_draft`, management reads, and title-based slug finalization.

Current code/schema inspected:

- Share/copy: `ShareModal.tsx`, `PublicEventPage.tsx`, `PublicBrandPage.tsx`, `EventManageMenu.tsx`, Events tab, Event Detail, public URL constants, package dependencies.
- Date mapping: `publicEventsService.ts`, `businessEvents.ts`, `serverDraftEventMapper.ts`, `eventDateDisplay.ts`, public routes, brand page, checkout, home/events cards, migrations.
- Lifecycle: `EventManageMenu.tsx`, Events tab, Event Detail, `useManagedEventRoute.ts`, `business_management_events_view`, `business_public_events_view`, `events`/`ticket_types` schema and RLS.

## Findings

### F1 - Native `Copy link` is a confirmed dead tap

Classification: confirmed bug / invariant violation (`No dead taps`, `No silent failures`)  
Severity: P1

Evidence:

- Runtime QA set the iOS pasteboard to a sentinel, tapped `Copy link`, and the pasteboard stayed unchanged.
- `mingla-business/src/components/ui/ShareModal.tsx:115-139` copies only on web through `navigator.clipboard.writeText`. On native it only shows `Tap Share via to copy on iOS / Android.`
- `mingla-business/package.json:26-78` has no `expo-clipboard` dependency. Repo search found no native clipboard implementation.

Current behavior:

The button says `Copy link`, but native users get no copied URL. Depending on toast visibility, this looks like either a silent failure or a misleading workaround.

Expected behavior:

Every copy button that says `Copy link` must write the canonical URL to the clipboard and only show success after the write resolves. Failure must show an error.

Causal chain:

`ShareModal` is reused by public event pages, event management share modals, and public brand pages. Because the primitive lacks native clipboard support, every native copy entry point using it is broken.

Verification step:

After repair, set simulator pasteboard to a sentinel, tap each native copy path, then verify `xcrun simctl pbpaste` equals the exact `https://business.usemingla.com/...` URL.

### F2 - Event-list `Copy share link` is mislabeled and does not copy

Classification: UX gap / confirmed bug  
Severity: P2

Evidence:

- Runtime QA tapped `Copy share link` from the live event menu. It opened the share modal and left the pasteboard unchanged.
- `EventManageMenu.tsx:180-190` labels the row `Copy share link`, but calls `onShare()`.
- Events tab wiring at `app/(tabs)/events.tsx:381-385` sets `shareEvent`, which renders `ShareModal` at `:685-697`.
- Event Detail uses the same `EventManageMenu` label and opens the same modal at `app/event/[id]/index.tsx:702-741`.

Current behavior:

The menu label promises direct copy. The action opens a share sheet modal instead.

Expected behavior:

The label must match the behavior. Either the row must copy directly, or it must be renamed to `Share event` / `Open share options`. The lower-risk fix is to rename the row and make the modal's own `Copy link` real.

### F3 - Native `Share via...` no longer proves the Expo-link symptom, but the share contract is duplicated

Classification: likely historical/stale-build bug + production-hardening gap  
Severity: P2

Evidence:

- Runtime QA on the correct simulator showed native share sheet displayed `business.usemingla.com`, not Expo.
- Current code found no `Linking.createURL`, `exp://`, or `expo://` share URL source in Mingla Business.
- Canonical URL construction is centralized in `eventPublicUrl` / `brandPublicUrl` using `MINGLA_BUSINESS_WEB_URL` from `platformUrl.ts:1-35` and `publicUrls.ts:30-58`.
- But share payload construction is duplicated:
  - `ShareModal.tsx:141-174` sends `Share.share({ message: `${title}\n${url}`, url })`.
  - `PublicEventPage.tsx:218-252` has an unused direct `handleShare` with its own native share payload.

Current behavior:

The tested runtime no longer emitted Expo links, but there is no single helper enforcing share payload shape across copy/share surfaces.

Expected behavior:

One helper should own native/web share payloads and clipboard payloads. All callers should pass canonical URLs built by `eventPublicUrl` or `brandPublicUrl`.

### F4 - Public event date display drops persisted `business_event.when`

Classification: confirmed bug / one-owner-per-truth violation  
Severity: P1

Evidence:

- Runtime public page rendered `DATE TBD` for event `b6122ef8-dc76-47d6-94a3-717450acff4f`.
- Runtime payload had the date under `theme.business_event.when`.
- Publish RPC writes the public event schedule into `events.theme.business_event`:
  - `supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql:228-233`
- The schema has no top-level `events.date`, `events.doors_open`, `events.ends_at`, or `events.starts_at` columns:
  - `20260505000000_baseline_squash_orch_0729.sql:7792-7823`
- Organiser management reads correctly parse `theme.business_event.when`:
  - `businessEvents.ts:241-270`
- Public reads do not:
  - `publicEventsService.ts:170-218` sets `date: null`, `doorsOpen: null`, `endsAt: null`, and only keeps `timezone: row.timezone`.
- `PublicEventPage.tsx:407-409` calls `formatDraftDateLine(event)`, and `eventDateDisplay.ts:142-153` returns `Date TBD` when `event.date === null`.

Current behavior:

Organiser surfaces that use `businessEvents.ts` can show `Fri 8 May · 21:00`. Public surfaces that use `publicEventsService.ts` receive `date = null`, so they show `Date TBD`.

Expected behavior:

The public mapper must parse the same `theme.business_event.when` contract as the management mapper. The canonical public date source for Mingla Business events is `events.theme.business_event.when`, with `events.timezone` as fallback for timezone only.

Causal chain:

Wizard saves date/time into `theme.business_draft.when`; publish moves that object into `theme.business_event`; management mapper reads it; public mapper ignores it; public date display sees null and prints the fallback.

Verification step:

A unit test should feed a `business_public_events_view` row with `public_theme.business_event.when` and assert the mapped public `LiveEvent` has `date`, `doorsOpen`, `endsAt`, `timezone`, `whenMode`, and `multiDates/recurrenceRule` as expected.

### F5 - Date blast radius includes public brand, checkout, order detail, and buyer lifecycle classification

Classification: confirmed blast radius  
Severity: P1/P2 depending on surface

Evidence:

- Public brand route uses `usePublicBrandBySlug` and events from `publicEventsService.ts` (`app/b/[brandSlug]/index.tsx:21-57`).
- Public brand event cards call `formatDraftDateLine(event)` at `PublicBrandPage.tsx:657-700`.
- Checkout uses `usePublicEventById` and prints `formatDraftDateLine(event)` at `app/checkout/[eventId]/index.tsx:76-78` and `:231-238`.
- Order detail imports and uses `formatDraftDateLine` from public event data (`app/o/[orderId].tsx:54`, `:275`).
- Public buyer classification also depends on `event.date`; checkout `computeIsPast` returns false when `date === null` (`checkout/[eventId]/index.tsx:60-68`).

Impact:

The same mapping bug can make the public page, brand page, checkout mini-card, order page, and buyer sale/past logic treat dated events as undated.

### F6 - Server-backed lifecycle actions are intentionally hidden

Classification: confirmed bug / production-hardening gap  
Severity: P1 for QA cleanup and launch trust

Evidence:

- Runtime menu for the server-backed live QA event exposed `Edit details`, `View public page`, `Open scanner`, `Orders`, `Copy share link`, but not `End ticket sales`, `Cancel event`, or `Delete`.
- `EventManageMenu.tsx:211-243` only adds `End ticket sales` and `Cancel event` when `canUseLifecycleActions` is true.
- Events tab passes `canUseLifecycleActions={manageCtx.kind !== "live" || !serverBackedEventIds.has(manageCtx.event.id)}` at `app/(tabs)/events.tsx:622-626`.
- Event Detail passes `canUseLifecycleActions={!isServerBackedEvent}` at `app/event/[id]/index.tsx:739-740`.
- If these actions were somehow triggered, both parents short-circuit server-backed events with toasts:
  - Events tab cancel: `Server event cancellation is not available yet.` at `app/(tabs)/events.tsx:417-425`
  - Event Detail cancel: same at `app/event/[id]/index.tsx:250-255`

Current behavior:

The UI honestly avoids false-success local mutations for server-backed events, but that means published server events have no owner-facing cancel/end-sales cleanup path.

Expected behavior:

For an owner/admin/event manager on a server-backed published event, cancellation and end-sales must be real server mutations with cache invalidation, not hidden actions and not local-only patches.

### F7 - Current cancel semantics would make public cancelled pages unreachable

Classification: likely bug / lifecycle blast-radius risk  
Severity: P1 before server cancel ships

Evidence:

- `PublicEventPage` has a cancelled variant at `PublicEventPage.tsx:115-149` and renders it at `:316-318`.
- `business_public_events_view` filters to `e.status IN ('scheduled', 'live')` at `20260515000003_orch_0759_public_event_contract.sql:32-36`.
- Public RLS also limits event reads to `status IN ('scheduled', 'live')` at baseline `:14450-14456`.
- `business_management_events_view` includes `ended` and `cancelled` at `20260515000004...sql:65-68`, but that view is authenticated organiser-only.

Impact:

If a future server cancel mutation simply sets `events.status = 'cancelled'`, the public event URL will not show a cancelled page through the current public view. It will likely look not found. That contradicts the existing cancelled UI and weakens buyer communication.

Fix direction:

The lifecycle spec must decide whether public exact event URLs remain readable for `cancelled`/`ended`. The evidence supports including cancelled and ended in exact public event reads, while buyer purchase actions remain disabled.

### F8 - `End ticket sales` is semantically unsafe if copied from local behavior

Classification: likely bug / spec risk  
Severity: P2

Evidence:

- Current local end-sales path writes `endedAt` on the `LiveEvent` (`app/event/[id]/index.tsx:233-244`, Events tab `:394-409`).
- `deriveLiveStatus` treats `endedAt !== null` as `past` (`eventLifecycle.ts:37-49`).
- Buyer checkout respects `ticket.saleEndAt` (`QuantityRow.tsx:78-84`), but public ticket rows do not currently compute sale-ended state and mostly rely on `ticket.visibility === "disabled"` / page variant (`PublicEventPage.tsx:647-686`).

Impact:

Reusing the local "set endedAt" model would incorrectly mark the whole event as past, not merely close ticket sales. Reusing only `sale_end_at` would block checkout, but the public event page could still show an active `Get free ticket` button unless buyer row logic is updated.

Fix direction:

Server-backed end-sales should update ticket sale state, not event lifecycle state. Public and checkout surfaces must both render sales-ended state consistently.

## Blast Radius Map

| Surface | File / authority | Current behavior | Risk |
|---|---|---|---|
| Public event share modal | `PublicEventPage.tsx`, `ShareModal.tsx` | URL is canonical; native copy does not copy | P1 dead tap |
| Event Detail share icon | `app/event/[id]/index.tsx`, `ShareModal.tsx` | URL canonical; native copy broken | P1 dead tap |
| Events tab menu share | `app/(tabs)/events.tsx`, `EventManageMenu.tsx` | Row says copy, opens modal | P2 mislabeled action |
| Public brand share | `PublicBrandPage.tsx`, `ShareModal.tsx` | Brand URL canonical; native copy broken | P2 same primitive |
| Step 7 pre-publish card | `CreatorStep7Preview.tsx:145-204` | No draft URL shown; says link created after publish | PASS |
| URL builder | `platformUrl.ts`, `publicUrls.ts` | Uses `business.usemingla.com` env source | PASS |
| Public event page date | `publicEventsService.ts`, `PublicEventPage.tsx` | Date fields null -> `Date TBD` | P1 |
| Public brand event cards | `PublicBrandPage.tsx` | Same public mapper -> `Date TBD` / bad sorting | P1/P2 |
| Checkout event mini-card | `checkout/[eventId]/index.tsx` | Same public mapper -> `Date TBD`; past detection weakened | P1/P2 |
| Organiser Events list | `businessEvents.ts`, `EventListCard.tsx` | Reads `business_event.when`, date works | PASS |
| Organiser Home hero | `home.tsx`, `businessEvents.ts` | Reads management mapper, date works | PASS |
| Lifecycle menu | `EventManageMenu.tsx` | Correctly hides actions when parent says no lifecycle | PASS as component, FAIL as product |
| Server-backed lifecycle | Events tab / Event Detail | No real server mutation; actions hidden | P1 |
| Public cancelled/ended URL | `business_public_events_view`, RLS | Excluded from public reads | P1 risk before cancel ships |

## Existing QA Event Handling

Event `b6122ef8-dc76-47d6-94a3-717450acff4f` should not be hard-deleted by forensics.

Recommended safe path:

1. Wait for the lifecycle repair to add an owner-visible server-backed `Cancel event` path.
2. Use the UI to cancel the QA event under `Test Stripe`.
3. If cleanup must happen sooner, use an operator-approved admin/SQL action outside this forensics pass. Do not hard-delete live/public data from implementation or testing agents.

## Test Gap Summary

Existing ORCH-0763 tests prove atomic publish and slug finalization, but they do not cover:

- native clipboard writes,
- event-list share action semantics,
- public mapper reading `theme.business_event.when`,
- public brand/checkout date regression,
- server-backed cancel/end-sales visibility and mutation,
- public cancelled/ended route behavior.

The current `serverDraftLifecycleGuards.test.ts` explicitly asserts the old honest-unavailable server lifecycle behavior. That test must be updated when lifecycle repair lands.

