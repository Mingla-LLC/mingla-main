# Mingla Journey And Invariants

## Journey Map

Locate every issue on the user/business/admin journey before ranking it.

### Consumer Mobile

`Install -> Auth -> Onboard -> Explore -> Save -> Schedule -> Invite -> Collaborate -> Go -> Review -> Return`

Critical steps:

- Auth: welcome, Google/Apple sign-in, session creation, token persistence, token refresh, sign-out.
- Onboarding: name, phone OTP, gender/details, intent, location, preferences, travel mode/time, friends/pairing, consent, deck ready.
- Discovery: home deck, expanded card, save/pass, batch loading, exhaustion, preference changes.
- Map: pins, bottom sheet, privacy/go dark, people visibility.
- Save/organize: saved tab, boards, board share, RSVP.
- Schedule: card scheduling, calendar tab, device calendar sync, proposals.
- Social/collab: friend requests, pair requests, DMs, sessions, voting, results.
- Retention: reminders, push, holiday/re-engagement, subscription upgrade.

### Business App

Critical organiser path:

`Login -> Brand/account -> Event create/edit -> Ticket types -> Publish -> Checkout/order -> Orders ops -> Guest list -> Door sales/QR -> Finance/reconciliation -> Permissions/team`

Check Stripe Connect, web/public event parity, edit-after-publish constraints, orders state, refunds/3DS, QR scanner, guest list, permissions, and reports.

### Admin

Critical admin path:

`Admin auth -> Dashboard -> Content/moderation -> AI validation/labels -> Users/ops -> Integrations -> Observability -> Support actions`

Admin bugs can be launch blockers when user-facing features depend on admin review, seeding, moderation, or operational recovery.

## Architecture Constitution

Every change must respect the current `README.md`. The recurring non-negotiables are:

- No dead taps.
- One owner per truth.
- No silent failures.
- One query key per entity.
- Server state stays server-side.
- Logout clears everything.
- Label temporary fixes with `[TRANSITIONAL]` and track them.
- Subtract before adding.
- No fabricated data.
- Currency-aware everywhere.
- One auth instance.
- Validate at the right time.
- Exclusions consistent across card-serving paths.
- Prefer persisted state for instant startup.

When `README.md` differs from this reference, `README.md` wins.

## Invariant Families

Data:

- Cards have real photos, city/country, active place references, canonical category slugs, consistent exclusions, real displayed price/rating/time data.
- Phone numbers and money/currency data use canonical formats.
- Block/friend/pair visibility is bidirectional and RLS-backed.

State:

- React Query owns server state.
- Zustand owns client-only state unless a documented offline contract exists.
- Mutation invalidation uses query-key factories.
- Optimistic updates rollback on failure.
- Persisted state is versioned and hydrated safely.

Auth/RLS:

- One auth authority.
- Token refresh centralized and race-free.
- Edge functions validate auth.
- User-data tables have RLS and actor-appropriate policies.

UI:

- Loading, error, empty, populated, success, and rollback states are truthful.
- No fake numbers or fake success.
- Validation happens at the user-relevant moment.

Realtime/notifications:

- Subscriptions clean up.
- Notification preferences and quiet hours are respected.
- Deleted content and stale deep links do not crash.

Pipeline:

- Card serving uses approved pool data and consistent quality gates.
- Child venue/name safety nets remain in generation and serving paths.

## Recurring Failure Patterns

- Lying UI: stale data, fake empty state, or success after failed mutation.
- Silent crash: null access, `.single()` on empty results, unhandled rejection.
- Race condition: rapid taps, background/foreground, realtime conflict, optimistic/server mismatch.
- Stale cache: mutation misses the correct query key.
- Auth gap: missing auth check, stale token, service-role assumption, RLS mismatch.
- Masked error: `catch` returns fallback success/empty data.
- Zombie state: expired auth with partial data after long session or cold start.
- Ownership conflict: Zustand/context/React Query all claim the same truth.
- Cold-start surprise: persisted store/query cache shape changed.
- Parity drift: solo works but collab fails, mobile works but business/admin/web path fails.
- Fabricated comfort: default ratings, prices, travel times, badges, or status text look real.
- Dangling subscription: realtime callback survives unmount.
- Temporal confusion: wrong timezone, UTC/local mismatch, DST or selected-time bug.
- Query-key drift: duplicate hardcoded keys or missing parameters.

## Quick Audit Questions

- What does the user believe should happen?
- Which actor owns the next state transition?
- What is the single source of truth?
- Where is the network/server/schema/RLS boundary?
- What happens on loading, empty, error, success, retry, rollback, cold start, and stale cache?
- Does the UI tell the truth?
- Does the business/admin surface contradict the mobile or backend contract?
- What evidence proves it?
