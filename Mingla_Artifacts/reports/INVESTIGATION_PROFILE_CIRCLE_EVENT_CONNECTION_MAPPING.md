# Investigation: Profile Circle Event Connection Mapping

Date: 2026-05-23  
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
Mode: INVESTIGATE + SPEC DIRECTION  
Status: Ready for implementation spec

## Executive Verdict

Mingla already has the core event-attendance mapping needed for Profile `Your Circle`: the current `get_user_circle` RPC includes users who share a confirmed Mingla Business event or trip order with the viewer. The missing product/data contract is source context. The RPC collapses friend-of-friend and co-attendee rows into one `extended` tier and returns only `tier`, so the app cannot truthfully render labels like `Friend of Maya` or `Also going to Supper Club`.

The correct path is to extend `get_user_circle` with safe relationship-source metadata, not to create a new client-side query or expose raw order/ticket tables to the app. The app should display specific, non-generic labels generated from shared context, while continuing to hide buyer email, order IDs, ticket IDs, Stripe IDs, QR codes, and any event attendance that is not shared with the viewer.

## User Promise

When a consumer app user buys or claims a ticket to a Mingla Business event, free or paid, they become associated with that event. Other consumer app users who are associated with the same eligible event should be discoverable in Profile `Your Circle`, with a clear explanation of why they appear there.

Examples:

| Relationship source | UI label |
|---|---|
| Existing close pairing | `Close friend` |
| Existing accepted friend | `Friend` |
| Friend-of-friend | `Friend of Maya` |
| Shared future/live event | `Also going to Supper Club` |
| Shared past event | `Also attended Supper Club` |
| Shared trip | `Also on Lisbon Weekend` or `Also joined Lisbon Weekend` |

## Current Evidence

### Current Circle RPC already maps co-attendees

Authoritative latest Circle RPC: `supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql`.

- The RPC currently returns only `user_id`, `tier`, profile fields, `has_business_app`, and `sort_score`; it does not return source metadata or a label (`lines 12-20`).
- It hard-gates the caller so only `auth.uid() = p_viewer_user_id` can call it (`lines 27-32`).
- `viewer_events` selects event IDs from `orders` where `buyer_user_id = p_viewer_user_id`, `payment_status = 'paid'`, and the event is `event` or `trip` (`lines 81-88`).
- `tier_coattendee` selects other users with confirmed orders for the same event IDs, excludes the viewer, and excludes existing close/friend tiers (`lines 102-117`).
- `tier_extended` unions friend-of-friend and co-attendee users but keeps only `other_id` and recency (`lines 118-126`), which is where the “why” data is lost.
- The final filter keeps consumer users and excludes blocked users from the viewer’s side (`lines 155-166`).

Conclusion: the current backend behavior already supports “people who bought/attend similar events should see each other,” but the response contract discards the mapping context.

### Orders are the correct primary association

Baseline schema: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`.

- `orders` has `event_id`, `buyer_user_id`, buyer contact fields, totals, payment method, and payment status (`lines 8525-8545`).
- `tickets` has ticket-level fields including `order_id`, `event_id`, attendee contact, QR code, and status (`lines 9862-9882`).
- Buyer/order/ticket RLS is private: buyers and brand teams can read orders/tickets through specific policies (`lines 14200-14206`).
- `events` has `title`, `visibility`, `status`, and lifecycle fields (`lines 7792-7822`).
- Public event read policy only exposes public scheduled/live events (`lines 14450-14450`), so the Circle RPC must stay server-owned for private shared context.

Conclusion: `orders.buyer_user_id + orders.event_id` is the right user-event key for signed-in consumer purchases. Ticket rows are sensitive and should not be exposed to build social labels.

### Free and paid purchases converge after finalize

Latest relevant finalize function: `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql`.

- Finalize inserts an order with `event_id`, `buyer_user_id`, buyer fields, and `payment_status = 'paid'` (`lines 150-178`).
- Free orders use `payment_method = 'free'` when `total_cents = 0`, but still finalize as `payment_status = 'paid'` (`lines 140-145`, `line 163`).
- Tickets are issued after the order (`lines 211-242`).
- The buyer is added to event chat after finalize (`lines 254-259`).

Conclusion: the Circle mapping should treat confirmed free and paid tickets the same by using confirmed order state. It should not depend on Stripe PaymentIntent fields.

### Consumer app purchase flow does not currently refresh Circle

Mobile files:

- `app-mobile/src/payments/nativeCheckoutFlow.ts` sends `eventId` and buyer data to `ticket-checkout-create` (`lines 96-115`), returns success immediately for free finalized orders (`lines 132-135`), and returns a checkout session ID after paid PaymentSheet success while webhook/finalize creates the order asynchronously (`lines 240-245`).
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` invalidates only `["businessEventOrders", userId]` after successful purchase (`lines 257-279`).
- `app-mobile/src/hooks/useCalendarEntries.ts` subscribes to `orders` changes and invalidates only `["businessEventOrders", userId]` (`lines 77-104`).

Conclusion: after implementation, purchase success and order realtime should also invalidate `circleKeys.all`, otherwise newly shared event connections can remain stale until Profile refetches naturally.

### Current app UI cannot render truthful labels

Mobile files:

- `app-mobile/src/types/circle.ts` only defines `tier`, profile fields, business-app flag, and sort score (`lines 1-11`).
- `app-mobile/src/services/circleService.ts` maps only the current RPC fields (`lines 4-12`, `lines 24-40`).
- `app-mobile/src/components/profile/circle/CircleAvatarTile.tsx` currently maps `extended` to the generic label `Mingla connection` (`lines 45-49`).

Conclusion: the generic label is a client fallback caused by missing backend data. It should be removed as part of a backend-first source contract.

## Recommended Mapping Contract

Extend `public.get_user_circle(p_viewer_user_id, p_limit, p_offset)` to return these additional safe fields:

| Field | Type | Meaning |
|---|---|---|
| `relationship_source` | `text` | One of `paired`, `friend`, `friend_of_friend`, `co_attendee`, `mixed`. |
| `relationship_label` | `text` | Precomputed display label, e.g. `Friend of Maya`, `Also going to Supper Club`. |
| `relationship_context_type` | `text nullable` | `user`, `event`, `trip`, or null. |
| `relationship_context_id` | `uuid nullable` | Mutual friend user ID or shared event ID. |
| `relationship_context_title` | `text nullable` | Mutual friend display name or event title. |
| `relationship_source_count` | `int` | Count of matching mutual friends or shared events for future `+2 more` UI. |

Do not return:

- `order_id`
- `ticket_id`
- `buyer_email`
- `buyer_name`
- `buyer_phone`
- `stripe_payment_intent_id`
- QR payloads
- attendee email/name/phone

## SQL Shape

Keep one authoritative RPC. Do not move this logic into the mobile client.

Implementation shape:

1. Keep the existing auth gate and limit checks.
2. Keep `consumer_users`, `dual_app_users`, `event_recency`, direct close, and direct friend CTEs.
3. Replace current lossy `tier_fof` with `tier_fof_candidates`:
   - carry `other_id`
   - carry `mutual_friend_id`
   - join `profiles` for mutual friend display name
   - count mutual friends per `other_id`
   - choose deterministic best mutual friend by recency, name, and UUID
4. Replace current lossy `tier_coattendee` with `tier_coattendee_candidates`:
   - carry `other_id`
   - carry `event_id`
   - join `events` for title, event type, status, visibility
   - join `event_dates`/recency for future vs past label
   - count shared eligible events per `other_id`
   - choose deterministic best event by upcoming/live first, then recent, then title, then UUID
5. Build `tier_extended` from source candidates while preserving source metadata.
6. Use deterministic source priority when the same user is both friend-of-friend and co-attendee.

Recommended display priority:

1. `paired`: always `Close friend`
2. `friend`: always `Friend`
3. `co_attendee`: prefer event context because it explains the Mingla purchase path the user asked about
4. `friend_of_friend`: fallback when no shared event context exists

This means an `extended` user who is both a friend-of-friend and a co-attendee should display the event reason, such as `Also going to Supper Club`, while still sorting within the extended tier.

## Eligibility Rules

Use these rules for co-attendee mapping:

| Rule | Recommendation |
|---|---|
| Signed-in buyer | Require `orders.buyer_user_id IS NOT NULL`. Anonymous buyer emails should not appear until linked or claimed. |
| Confirmed order | Include `payment_status = 'paid'`. Consider `partial_refund` only if product decides partially refunded buyers still retain attendance rights. |
| Free tickets | Include automatically because finalized free tickets have `payment_status = 'paid'` and `total_cents = 0`. |
| Event type | Keep `events.event_type IN ('event', 'trip')`. |
| User app surface | Keep consumer-app user filter. |
| Direct relationships | Keep close/friend tiers above extended and dedupe. |
| Blocking | Preserve viewer-blocked exclusion; investigate reverse-block exclusion before ship. |
| Deleted/cancelled events | Exclude `deleted_at IS NOT NULL`; decide whether cancelled events should still appear as past shared context. |
| Event title visibility | If event is public/scheduled/live, label with title. If private/hidden but both users bought the same event, product must choose between showing title or generic `Shared private event`. |

## Privacy Position

Recommended language is attendance-based, not purchase-based.

Use:

- `Also going to {event}`
- `Also attended {event}`
- `Also joined {trip}`

Avoid:

- `Bought {event}`
- `Purchased {event}`
- `Paid for {event}`

Reason: the viewer needs to understand the social connection, not the other user’s payment behavior. Purchase language can reveal unnecessary commercial information, especially for comped/free tickets, refunds, or installment plans.

## Mobile App Contract

Update the mobile type and service contract:

- Add `RelationshipSource` and the new relationship fields to `CirclePerson`.
- Map snake_case RPC fields in `circleService.ts`.
- Reject or safely hide extended rows without `relationship_label` after the migration ships; do not fall back to `Mingla connection`.
- Render `person.relationshipLabel` in `CircleAvatarTile`.
- Keep accessibility labels specific: `View Ava's profile, also going to Supper Club`.

Update cache invalidation:

- Import `circleKeys` where needed.
- In `ExpandedBusinessEventSheet` purchase success, invalidate `circleKeys.all` alongside `["businessEventOrders", userId]`.
- In `useOrdersRealtimeSubscription`, invalidate `circleKeys.all` on relevant order INSERT/UPDATE/DELETE.
- Keep `useUserCircle` stale settings unless product wants more aggressive refetching; invalidation is the important fix.

## Regression Tests Required

These tests must ship in the same scoped commit as the implementation.

| Layer | Test |
|---|---|
| SQL static regression | Assert the latest `get_user_circle` migration returns `relationship_source`, `relationship_label`, context fields, and does not return buyer/order/ticket/private payment fields. |
| SQL behavior regression | Seed or inspect migration logic for two users with paid/free orders on the same event and assert the co-attendee row has `relationship_source = 'co_attendee'` and an event label. |
| SQL privacy regression | Assert wrong actor still gets SQLSTATE `42501`; anonymous `buyer_user_id IS NULL` orders do not produce Circle rows. |
| SQL dedupe regression | Assert a user who is both friend-of-friend and co-attendee appears once with deterministic label priority. |
| Service regression | Assert `circleService` maps relationship fields and does not synthesize generic extended labels. |
| UI regression | Assert `CircleAvatarTile` renders the backend-provided relationship label beside the avatar. |
| Cache regression | Assert purchase success invalidates `circleKeys.all`. |
| Realtime regression | Assert order realtime invalidates both calendar orders and circle queries. |

Existing live-edit UI tests that already passed during the Profile Circle visual iteration:

- `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx`
- `node app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`
- Scoped ESLint over Profile Circle components

Full `app-mobile` typecheck was not clean due to unrelated pre-existing TypeScript errors outside this feature slice, so implementation verification should use scoped tests plus any available Circle-specific service tests unless the broader branch is cleaned first.

## Implementation Order

1. Add a monotonic Supabase migration replacing `get_user_circle` with the extended return contract.
2. Add SQL/static regression tests for the RPC contract and privacy exclusions.
3. Update `app-mobile/src/types/circle.ts`.
4. Update `app-mobile/src/services/circleService.ts`.
5. Update `CircleAvatarTile` to consume `person.relationshipLabel` and remove generic `Mingla connection`.
6. Update purchase success and order realtime invalidation to include `circleKeys.all`.
7. Add service, UI, purchase-invalidation, and realtime-invalidation tests.
8. Run scoped verification and document evidence in the final implementation report after the user confirms live edits are done.

## Open Product Decisions

| Decision | Recommendation |
|---|---|
| Private event title labels | Default to `Shared private event` unless product explicitly accepts showing private event titles between confirmed co-attendees. |
| Partial refunds | Treat `partial_refund` as eligible only if the user still has at least one valid/used ticket for the event. Otherwise keep v1 to `paid`. |
| Reverse block | Add reverse-block exclusion so a user who blocked the viewer is not exposed in the viewer’s Circle. |
| Label for multiple shared events | v1 should pick the strongest event label and carry `relationship_source_count`; v2 can render `+2 more`. |
| Ticket transfers | Out of scope unless transferred tickets update/claim `buyer_user_id` or add a new attendee-user link. |

## Bottom Line

Build the next version as a backend-owned relationship-source contract. `orders.event_id + orders.buyer_user_id` already gives Mingla the core event mapping for confirmed free and paid tickets, but the RPC must preserve the source context and the app must render that context directly. This produces the user-facing result Seth asked for: not “Mingla connection,” but a concrete explanation like `Friend of Maya` or `Also going to Supper Club`.
