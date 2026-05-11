# IMPLEMENTATION REWORK ORCH-0777 B2 - QR Credential RLS Tightening

Status: implemented, partially verified  
Date: 2026-05-10  
Owner: Codex `implementor-mingla`  
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)

## Summary

B2 tightening is implemented with a monotonic Supabase migration that removes
broad app-role SELECT access to scanner-valid ticket credential fields. Buyer QR
display, confirmation dispatch, and scanner validation still use the existing
service-role Edge Function paths, so the buyer/status-token and scanner
contracts are preserved without exposing `tickets.qr_code` to brand-team direct
table reads.

No production secrets were read, set, printed, or copied. I did not set
`STRIPE_RAK_TICKET_CHECKOUT`, did not set `app.qr_token_pepper`, and did not run
live-fire.

## Files Changed

| Path | Change |
| --- | --- |
| `supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` | New monotonic migration revoking broad `tickets` SELECT from `anon`/`authenticated`, granting only non-credential ticket columns back, and revoking authenticated execution of QR payload/hash helper functions. |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | Added repo-running B2 regression that fails without the new migration contract and passes when `qr_code` / `qr_token_hash` are excluded from app-role direct SELECT grants. |
| `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | Added B2 strict guards so `npm run test:orch-0777` fails if the tightening migration is missing or grants direct credential columns. |

## Design Choice

Chosen: **column privilege/RLS tightening plus helper-function execute
tightening**.

Why: existing buyer display, dispatch, and scan flows already go through
service-role Edge Functions. PostgreSQL RLS can decide which rows a brand-team
member may read, but it cannot hide only `tickets.qr_code` from a permitted row.
The smallest correct B2 change is therefore to revoke table-level SELECT from
`anon` and `authenticated`, grant back only non-credential columns, and keep QR
credential material behind service-role paths.

Rejected alternatives:

- Payload-off-row: stronger long-term posture, but larger than the scoped B2
  rework because it would redesign ticket issuance, buyer display, notification,
  and scanner verification together.
- RLS-only policy change: insufficient because the existing brand-team policy
  still needs operational ticket row visibility, and RLS does not provide
  column-level secrecy.

## Before / After Access Contract

Before:

- `tickets` had broad app-role table SELECT grants from the baseline.
- The `Buyer or brand team can select tickets` RLS policy allowed brand-team
  reads for event tickets.
- `tickets.qr_code` stored the scanner-accepted payload, so direct brand-team
  SELECT could retrieve scan credentials.
- QR helper functions had default public execute exposure unless later revoked.

After:

- `anon` and `authenticated` no longer have table-level SELECT on
  `public.tickets`.
- `anon` and `authenticated` get column-level SELECT only for non-credential
  ticket metadata. The grant intentionally excludes `qr_code` and
  `qr_token_hash`.
- `public.biz_ticket_checkout_qr_payload(uuid, text)` and
  `public.biz_ticket_checkout_token_hash(text)` are no longer executable by
  `PUBLIC`, `anon`, or `authenticated`; `service_role` retains execute.
- Buyer QR display still goes through `ticket-checkout-status`, which requires
  the buyer status token and uses the service role.
- `ticket-confirmation-dispatch` still uses service-role ticket reads for buyer
  notification delivery.
- `scan-ticket` still validates via service-role RPC `biz_ticket_scan`.

## Migration Discipline

Migration added:

`supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql`

Monotonicity proof:

- Local tail before this migration was `20260515000014_orch_0776d_event_cover_video_cancelled_at.sql`.
- `git ls-tree origin/main supabase/migrations/ | tail -8` showed origin/main tail at `20260515000007`, older than local ORCH migrations.
- `/Users/sethogieva/bin/supabase migration list --linked | tail -12` showed `20260515000014` populated in both Local and Remote columns and `20260515000015` present locally with an empty Remote column.

Operator deploy note: this requires `supabase db push` before the B2 runtime
contract is active. Do not deploy Edge Function changes from this report; none
were changed.

## Regression Test

Added/updated:

- `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`
- `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`

Why it fails before and passes after:

- Before the B2 migration, there is no `REVOKE SELECT ON TABLE public.tickets`
  for `authenticated`, and no column grant that excludes `qr_code` /
  `qr_token_hash`; the new Jest assertion fails.
- After the B2 migration, the assertion sees broad SELECT revoked, credential
  columns absent from app-role column grants, and QR helper execution revoked
  from `authenticated`.

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `/opt/homebrew/bin/npm run test:orch-0777` from `mingla-business` | PASS | Strict-grep passed; Jest passed 4 suites / 8 tests; `npx tsc --noEmit` completed with no stdout. |
| `/opt/homebrew/bin/npm exec -- tsc --noEmit` from `mingla-business` | PASS | No stdout. |
| `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-status/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/scan-ticket/index.ts` | PASS | Deno checked all three touched-by-contract Edge Function entrypoints. |
| `git diff --check` | PASS | No stdout. |
| `/Users/sethogieva/bin/supabase db lint --local` | BLOCKED | Local Postgres refused connection at `127.0.0.1:54322`; local Supabase stack is not running. |
| `/Users/sethogieva/bin/supabase status` | BLOCKED | Docker reported no local Supabase DB container for this project. |
| `/Users/sethogieva/bin/supabase migration list --linked \| tail -12` | PASS read-only | Confirmed `20260515000015` local-only, not remote-applied. |

## Runtime Gate Still Needed

Because local Supabase is not running, I could not honestly execute the
PostgREST/Supabase-client column privilege probe. Tester/operator should run
this after applying the migration to a local or staging database:

1. As a brand-team authenticated session for the event, call
   `supabase.from("tickets").select("id,status,qr_code,qr_token_hash").eq("event_id", EVENT_ID)`.
   Expected: the request cannot return `qr_code` or `qr_token_hash`.
2. As the same brand-team session, call
   `supabase.from("tickets").select("id,status,issued_at,qr_version").eq("event_id", EVENT_ID)`.
   Expected: non-credential metadata remains readable under the existing RLS row policy.
3. With the buyer status token, call `ticket-checkout-status`.
   Expected: buyer-authorized QR payloads still return.
4. Invoke `ticket-confirmation-dispatch` with service-role authorization.
   Expected: ticket lookup and notification dispatch still work.
5. Invoke `scan-ticket` for valid, duplicate, and wrong-event payloads.
   Expected: scanner validation behavior is unchanged.

## Risks And Notes

- This is intentionally scoped to B2. It does not change checkout UX, pricing,
  Stripe behavior, notification copy, refund/cancel behavior, organizer order
  projections, or live-fire gates.
- Existing broad app-role non-SELECT privileges on `tickets` are left untouched
  to avoid changing unrelated scanner/update behavior in this B2 pass.
- The production QR pepper remains an operator configuration gate. If
  `app.qr_token_pepper` is still missing, scanner payload generation has the
  previously documented fallback risk; this report does not modify that value.

## Downstream Routing

Route this report to Claude `mingla-forensics` TEST mode for independent B2
retest. After tester PASS and after operator config gates clear
(`STRIPE_RAK_TICKET_CHECKOUT` present and `app.qr_token_pepper` verified
non-default/min32), route to Codex `orchestrator-mingla` to rerun
`Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`.
