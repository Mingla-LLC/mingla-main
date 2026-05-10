# Production Verification

Use when code reading is insufficient: data flow, cache, auth, payments, notifications, realtime, or persisted state can fail despite correct-looking code.

## Database / RLS

Read-only checks when configured:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '[table]'
ORDER BY ordinal_position;

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = '[table]';

SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = '[table]';
```

Also reason about:

- NULLs in newly required columns.
- Orphaned FKs.
- Duplicate rows before unique constraints.
- Old enum/status values.
- Missing seed/admin setup.

Do not apply migrations as part of testing unless the user explicitly asks and the environment is safe.

## Edge Functions

Test or design cases:

- Success with valid auth/input.
- Missing auth -> 401.
- Wrong actor -> 403/404.
- Malformed input -> 400/422.
- Conflict state -> 409.
- Upstream timeout/failure -> structured 502/504 or safe fallback.

Verify response shape matches service/client expectations and no sensitive fields leak.

## Cache / State

Trace:

- Initial query key and fetched data.
- Mutation invalidation/update.
- Navigation away/back.
- Background/foreground.
- Cold start from persisted state.
- Sign-out and sign-in as another user.
- Offline mutation behavior.

## Auth

Check:

- Token refresh.
- 401 handling.
- Long background pause.
- Expired token during mutation.
- Logout clears private data.
- Wrong user cannot see prior data.

## Realtime / Notifications

Check:

- Subscription mount/unmount cleanup.
- Wrong-user event filtering.
- Reconnect behavior.
- Duplicate event idempotency.
- Notification preferences and quiet hours.
- Deep link to deleted/stale content.
- Badge count correctness.

## Payments / Orders / Tickets

Check:

- Stripe/RevenueCat/webhook signature/idempotency.
- Payment success, failure, 3DS, refund, restriction/disabled account.
- Order/ticket status transitions.
- QR/door sales reconciliation.
- Finance/reporting visibility.
- Admin/business/public/mobile parity.

## Reporting

Use:

`Check | Method | Result | Evidence | Remaining manual test`
