# IMPLEMENTATION REWORK ORCH-0777 - Production Ticket Checkout Rework

Status: implemented, partially verified  
Date: 2026-05-10  
Owner: Codex implementor-mingla

## Summary

This rework fixes the checkout selling-state predicate, changes paid checkout success into a finalization flow instead of an error, moves the listed organizer sales surfaces off local `useOrderStore`, adds buyer status-token protection to checkout status, hardens QR token storage away from the old plaintext bearer shape, and checks the PaymentIntent session-persist failure path. The migration was amended in place because `20260515000013_orch_0777_ticket_checkout_core.sql` is still local/unapplied per the tester and state reports. Local app and Deno gates pass. Local Supabase reset/lint could not run because the local Supabase stack/Postgres is not running, so this must not be treated as deployed or production-verified.

## File-By-File Change List

| Path | Lines changed | Why |
| --- | ---: | --- |
| `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | ~45 | Added guards against the old processing throw, `<> ANY` scheduled/live predicate, local `useOrderStore` reads in the seven organizer surfaces, and anonymous-style QR status regressions. |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | ~43 | Added post-PaymentSheet finalizing state, bounded polling through `pollTicketCheckoutStatus`, success-framed timeout copy, and removed the old webhook-latency error path. |
| `mingla-business/app/event/[id]/index.tsx` | ~25 | Replaced event sold/revenue/activity order source with server-backed `useEventOrders`. |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | ~80 | Replaced local order detail lookup with `useEventOrderById`, wired resend to `ticket-confirmation-dispatch`, and disabled local refund/cancel flows. |
| `mingla-business/app/event/[id]/guests/index.tsx` | ~8 | Replaced guest-list order source with server-backed `useEventGuestList`. |
| `mingla-business/app/event/[id]/guests/[guestId].tsx` | ~9 | Replaced guest detail/order history order source with server-backed hooks. |
| `mingla-business/app/event/[id]/reconciliation.tsx` | ~4 | Replaced reconciliation order source with server-backed `useEventReconciliation`. |
| `mingla-business/src/components/event/EventListCard.tsx` | ~27 | Replaced sold/revenue card math with server-backed event orders. |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | ~17 | Replaced web-purchase guard with `useEventHasWebPurchases`. |
| `mingla-business/src/hooks/useEventOrders.ts` | new/~132 | Added React Query hooks for order detail, revenue, activity, guest list/detail, reconciliation, sold counts, and web-purchase guard. |
| `mingla-business/src/services/eventOrdersService.ts` | new/~237 | Extended server order projection and added pure adapters for detail, revenue, sold counts, activity, guests, and web-purchase detection. |
| `mingla-business/src/services/ticketCheckoutService.ts` | ~37 | Added buyer status token to status calls, `pollTicketCheckoutStatus`, and `resendTicketConfirmation`. |
| `mingla-business/src/services/__tests__/eventOrdersService.test.ts` | new/~84 | Regression coverage for server-order adapters across sold count, revenue, activity, detail, and web-purchase guard. |
| `mingla-business/src/services/__tests__/ticketCheckoutService.test.ts` | new/~61 | Regression coverage for delayed status polling and bounded success-framed timeout behavior. |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | new/~36 | Static regression coverage for SQL predicate, SHA-256 QR hardening, unique hash index, and schema/spec defaults. |
| `mingla-business/package.json` | 1 | Extended `test:orch-0777` to run the new rework regressions. |
| `supabase/functions/_shared/ticketCheckout.ts` | ~11 | Added buyer status-token generation and SHA-256 hashing helper. |
| `supabase/functions/ticket-checkout-create/index.ts` | ~35 | Persists buyer status-token hash, returns token to buyer client, hashes client secret, checks PaymentIntent session update error, and cancels PI on persist failure. |
| `supabase/functions/ticket-checkout-status/index.ts` | ~18 | Requires buyer status token, verifies SHA-256 hash before returning order/ticket payloads. |
| `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` | ~75 | Fixed selling predicate, aligned schema defaults/columns, added QR token SHA-256 helpers and unique index, changed QR payload shape, and updated scanner verification. |

## Rework Delta Map

| Finding | Fixed | Evidence |
| --- | --- | --- |
| P0a selling-state predicate rejects scheduled/live | Yes | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`: `NOT (v_event.status = ANY (...))`; test `ticketCheckoutMigrationGuards.test.ts`. |
| P0a scheduled/live/non-selling regression | Partial | Static migration regression added. Local DB RPC execution blocked by local Supabase not running. |
| P0b successful card payment shown as error | Yes | `payment.tsx` finalizing state and `pollTicketCheckoutStatus`; test `ticketCheckoutService.test.ts`. |
| P0c local migration apply/reset | Blocked | `supabase db reset --local` reports `supabase start is not running`. No remote push attempted. |
| P1a event detail sold/revenue/activity | Yes | `app/event/[id]/index.tsx` uses `useEventOrders`; strict grep forbids `useOrderStore`. |
| P1a order detail + resend/refund/cancel | Partial | Detail uses `useEventOrderById`; resend calls `ticket-confirmation-dispatch`; local refund/cancel flows disabled. Real refund/cancel backend remains follow-up. |
| P1a guest list | Yes | `guests/index.tsx` uses `useEventGuestList`; strict grep. |
| P1a guest detail | Partial | Detail uses server-backed current-event order source. Cross-event buyer history is limited to current event until a brand-scoped order endpoint exists. |
| P1a reconciliation | Yes | `reconciliation.tsx` uses `useEventReconciliation`; strict grep. |
| P1a EventListCard tile | Yes | `EventListCard.tsx` uses `useEventOrders`; strict grep. |
| P1a EditPublishedScreen web-purchase guard | Yes | `EditPublishedScreen.tsx` uses `useEventHasWebPurchases`; strict grep. |
| P1b QR bearer plaintext/status anonymous | Partial | `qr_code` no longer stores old raw `mingla:ticket:<id>:token:<raw>` shape; QR hash uses SHA-256; status requires buyer token. A signed payload is still stored in `tickets.qr_code`, so tester should re-review whether this satisfies the preferred privacy fork. |
| P1c PaymentIntent update error ignored | Yes | `ticket-checkout-create/index.ts` checks update result and cancels PI on `payment_session_persist_failed`. |
| P2 schema/spec reconciliation | Partial | Added missing defaults/columns/hash index/session fields named in prompt. Full SQL execution is blocked until local/remote migration gate runs. |

## Verification Command Outputs

### `cd mingla-business && npm run test:orch-0777`

Result: PASS

```text
> mingla-business@1.0.0 test:orch-0777
> node ../.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs && npx jest phone.test eventOrdersService.test ticketCheckoutService.test ticketCheckoutMigrationGuards.test && npx tsc --noEmit

ORCH-0777 production checkout guard passed.
watchman warning:  Recrawled this watch 5 times, most recently because:
MustScanSubDirs UserDroppedTo resolve, please review the information on
https://facebook.github.io/watchman/docs/troubleshooting.html#recrawl
To clear this warning, run:
`watchman watch-del '/Users/sethogieva/Desktop/mingla-main' ; watchman watch-project '/Users/sethogieva/Desktop/mingla-main'`

PASS src/utils/__tests__/phone.test.ts
PASS src/services/__tests__/ticketCheckoutMigrationGuards.test.ts
PASS src/services/__tests__/eventOrdersService.test.ts
PASS src/services/__tests__/ticketCheckoutService.test.ts

Test Suites: 4 passed, 4 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        3.82 s, estimated 4 s
Ran all test suites matching /phone.test|eventOrdersService.test|ticketCheckoutService.test|ticketCheckoutMigrationGuards.test/i.
```

### `cd mingla-business && npx tsc --noEmit`

Result: PASS

```text
<no stdout>
```

### `cd mingla-business && npx jest src/utils/__tests__/phone.test.ts`

Result: PASS

```text
watchman warning:  Recrawled this watch 5 times, most recently because:
MustScanSubDirs UserDroppedTo resolve, please review the information on
https://facebook.github.io/watchman/docs/troubleshooting.html#recrawl
To clear this warning, run:
`watchman watch-del '/Users/sethogieva/Desktop/mingla-main' ; watchman watch-project '/Users/sethogieva/Desktop/mingla-main'`

PASS src/utils/__tests__/phone.test.ts
  phone validation
    ✓ requires an E.164-compatible phone number (7 ms)

Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
Snapshots: 0 total
Time: 3.959 s
Ran all test suites matching /src\/utils\/__tests__\/phone.test.ts/i.
```

### New rework tests

Command:

```bash
cd mingla-business && npx jest src/services/__tests__/eventOrdersService.test.ts src/services/__tests__/ticketCheckoutService.test.ts src/services/__tests__/ticketCheckoutMigrationGuards.test.ts
```

Result: PASS

```text
watchman warning:  Recrawled this watch 5 times, most recently because:
MustScanSubDirs UserDroppedTo resolve, please review the information on
https://facebook.github.io/watchman/docs/troubleshooting.html#recrawl
To clear this warning, run:
`watchman watch-del '/Users/sethogieva/Desktop/mingla-main' ; watchman watch-project '/Users/sethogieva/Desktop/mingla-main'`

PASS src/services/__tests__/ticketCheckoutService.test.ts
PASS src/services/__tests__/eventOrdersService.test.ts
PASS src/services/__tests__/ticketCheckoutMigrationGuards.test.ts

Test Suites: 3 passed, 3 total
Tests: 6 passed, 6 total
Snapshots: 0 total
Time: 4.852 s
Ran all test suites matching /src\/services\/__tests__\/eventOrdersService.test.ts|src\/services\/__tests__\/ticketCheckoutService.test.ts|src\/services\/__tests__\/ticketCheckoutMigrationGuards.test.ts/i.
```

### Deno check

Command:

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/ticket-checkout-create/index.ts \
  supabase/functions/ticket-checkout-status/index.ts \
  supabase/functions/ticket-confirmation-dispatch/index.ts \
  supabase/functions/twilio-message-status/index.ts \
  supabase/functions/scan-ticket/index.ts \
  supabase/functions/stripe-webhook/index.ts
```

Result: PASS

```text
Check supabase/functions/ticket-checkout-create/index.ts
Check supabase/functions/ticket-checkout-status/index.ts
Check supabase/functions/ticket-confirmation-dispatch/index.ts
Check supabase/functions/twilio-message-status/index.ts
Check supabase/functions/scan-ticket/index.ts
Check supabase/functions/stripe-webhook/index.ts
```

### Local DB reset

Command:

```bash
/Users/sethogieva/bin/supabase db reset --local
```

Result: BLOCKED

```text
supabase start is not running.
Try rerunning the command with --debug to troubleshoot the error.
```

### Local DB lint

Command:

```bash
/Users/sethogieva/bin/supabase db lint --local
```

Result: BLOCKED

```text
Connecting to local database...
failed to connect to postgres: failed to connect to `host=127.0.0.1 user=postgres database=postgres`: dial error (dial tcp 127.0.0.1:54322: connect: connection refused)
Make sure your local IP is allowed in Network Restrictions and Network Bans.
https://supabase.com/dashboard/project/_/database/settings
```

### `git diff --check`

Result: PASS

```text
<no stdout>
```

## Migration Discipline

The migration was edited in place: `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`. This follows the rework prompt because the tester/state report confirmed this migration has not been applied remotely. No remote `supabase db push`, no linked migration mutation, and no edge deploy were performed.

## Strict-Grep Gate Additions

- Forbid the exact `"Payment succeeded. Ticket issuance is still processing"` throw in `payment.tsx`.
- Forbid `v_event.status <> ANY (ARRAY['scheduled'::text, 'live'::text])`.
- Regex guard against future `<> ANY (ARRAY['scheduled', 'live']...)` variants.
- Forbid `useOrderStore` in the seven organizer surfaces named by the prompt.
- Guard checkout status against the old anonymous exact QR select shape.

## Known Follow-Ups

- Local Supabase must be started and the amended migration must pass `db reset` or `migration up` plus `db lint`; this was blocked here.
- QR/privacy hardening should receive independent tester/security review. This pass removes the old plaintext raw bearer token and adds buyer status-token ownership, but the signed QR payload is still stored on `tickets.qr_code`.
- Order refund/cancel actions are disabled rather than production-wired. A real refund/cancel backend remains a separate scoped implementation.
- Guest detail cross-event buyer history now only has current-event server orders because no brand-scoped server order history endpoint exists in this rework.

## Operator Deploy Gate Checklist

1. Review this report and the diff.
2. Start local Supabase and run `supabase db reset --local` or `supabase migration up --local`.
3. Run `supabase db lint --local`.
4. Do not push remotely until orchestrator/tester review accepts the rework.
5. After review, operator applies migration `20260515000013_orch_0777_ticket_checkout_core.sql`.
6. Deploy edge functions only after DB migration is confirmed:
   - `ticket-checkout-create`
   - `ticket-checkout-status`
   - `ticket-confirmation-dispatch`
   - `twilio-message-status`
   - `scan-ticket`
   - `stripe-webhook`
7. Confirm required secrets exist without exposing values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_RAK_TICKET_CHECKOUT`
   - `STRIPE_RAK_WEBHOOK`
   - `RESEND_API_KEY`
   - `RESEND_TICKET_FROM`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_MESSAGING_SERVICE_SID`
   - `TWILIO_STATUS_CALLBACK_SECRET`
   - `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` or `STRIPE_PUBLISHABLE_KEY`
8. Run operator-assisted live-fire after independent retest: free checkout, paid checkout, webhook replay/idempotency, Resend, Twilio, organizer surfaces, and cross-device scanner.

