# IMPLEMENTATION REWORK ORCH-0777 - QR Pepper Session GUC

Status: implemented, partially verified  
Date: 2026-05-11  
Owner: Codex `implementor-mingla`  
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)

## Summary

ORCH-0777 no longer depends on project/database-level Postgres configuration for
QR signing. I chose the bounded service-role RPC argument path instead of a
Supabase JS session `SET`, because PostgREST connection pooling cannot honestly
guarantee that a prior session-level `SET` and a later RPC execute on the same
backend connection. Free checkout finalization, paid webhook finalization, and
scanner validation now pass the Supabase Edge Function secret into service-role
RPCs that generate or validate QR payloads inside the same SQL operation.

No pepper value was read, printed, logged, pasted, committed, or artifacted. No
live-fire was run. ORCH-0777 is not close-ready until tester PASS, operator DB
push/redeploy, and the full live-fire matrix PASS.

## Files Changed

| Path | Change |
| --- | --- |
| `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` | New monotonic migration that drops no-pepper QR helper/finalize/scan signatures, adds pepper-argument helper/finalize/scan signatures, rejects missing/short/default fallback pepper, and grants only service-role execution. |
| `supabase/functions/_shared/ticketCheckout.ts` | Added `qrTokenPepper()` to read the Edge Function secret by name, trim it, reject missing/short/default fallback values, and return it without logging. |
| `supabase/functions/ticket-checkout-create/index.ts` | Free checkout finalization validates the secret and passes `p_qr_token_pepper` into `biz_ticket_checkout_finalize`. |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | Paid `payment_intent.succeeded` finalization validates the secret and passes `p_qr_token_pepper` into `biz_ticket_checkout_finalize`. |
| `supabase/functions/scan-ticket/index.ts` | Scanner validation validates the secret and passes `p_qr_token_pepper` into `biz_ticket_scan`. |
| `supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | Added Deno regression tests for missing/default/short/valid pepper handling. |
| `supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts` | Added Deno regression proving paid checkout webhook finalization calls the bounded RPC with `p_qr_token_pepper`; updated routed event count to include `payment_intent.*`. |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | Added repo-running migration/function-source assertions for the bounded service-role pepper contract and no database-level setup. |
| `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | Added strict guards for bounded RPC signatures, Edge Function pepper passing, no `current_setting`/`ALTER DATABASE`/`pg_reload_conf` in the new migration, and superseded historical docs. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_QR_TOKEN_PEPPER_CONFIG_GATE.md` | Marked as superseded historical evidence for the rejected database-level route. |
| `Mingla_Artifacts/reports/DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md` | Marked as superseded historical evidence for the rejected database-level route. |
| `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` | Updated the pre-live-fire QR pepper gate to require the bounded service-role RPC contract, not database-level GUC setup. |

## Runtime Contract Chosen

Chosen contract: **bounded service-role RPC argument**, not session GUC.

Reason: Supabase JS RPCs go through PostgREST; a session-level `SET` before a
separate RPC cannot be proven to share one backend DB session under pooling. The
new migration therefore makes the QR pepper an explicit argument to the
service-role-only SQL operations that need it:

- `biz_ticket_checkout_token_hash(text, text)`
- `biz_ticket_checkout_qr_payload(uuid, text, text)`
- `biz_ticket_checkout_finalize(uuid, text, text, text, text)`
- `biz_ticket_scan(uuid, text, uuid, text)`

The legacy no-pepper signatures are dropped so callers cannot silently fall back
to the old `current_setting(..., 'local-ticket-pepper')` behavior. The new
migration does not use `current_setting('app.qr_token_pepper', true)`,
`ALTER DATABASE`, or `pg_reload_conf()`.

## Runtime Path Trace

| Runtime path | QR dependency | New behavior |
| --- | --- | --- |
| Free checkout | Generates ticket hashes and QR payloads during finalization. | `ticket-checkout-create` calls `qrTokenPepper()` and passes `p_qr_token_pepper` to `biz_ticket_checkout_finalize`. |
| Paid checkout/webhook finalization | Generates ticket hashes and QR payloads after verified `payment_intent.succeeded`. | `stripeWebhookRouter` calls `qrTokenPepper()` and passes `p_qr_token_pepper` to `biz_ticket_checkout_finalize`. |
| Buyer QR fetch/status | Reads already-issued `tickets.qr_code`; it does not generate or validate QR signatures. | B2 RLS remains preserved because the status endpoint uses service role plus buyer status token. No pepper operation is needed on this fetch path. |
| Scan validation | Recomputes expected QR payload for comparison. | `scan-ticket` calls `qrTokenPepper()` and passes `p_qr_token_pepper` to `biz_ticket_scan`. |

## Secret Handling Proof

- Code reads the secret through `Deno.env.get("app.qr_token_pepper")`.
- Code rejects missing, short, or `local-ticket-pepper` values before calling QR-dependent RPCs.
- No command in this rework selected, printed, logged, or wrote the production pepper value.
- Tests use synthetic non-secret strings only.
- The implementation report and docs record only the secret name, never a value.

## B2 RLS Preservation

B2 QR credential RLS is preserved. This rework does not re-grant app-role direct
SELECT on `tickets.qr_code` or `tickets.qr_token_hash`; it does not weaken the
B2 migration; and the strict/Jest gates continue to assert that anon and
authenticated direct credential reads remain closed.

## Regression Tests And Gates

| Command | Result | Output summary |
| --- | --- | --- |
| `cd mingla-business && npm run test:orch-0777` | PASS | Strict-grep passed; Jest passed 4 suites / 10 tests; `tsc --noEmit` completed with no stdout. Watchman emitted a local recrawl warning only. |
| `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/ticket-checkout-status/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/scan-ticket/index.ts supabase/functions/stripe-webhook/index.ts` | PASS | Deno check completed with no errors. |
| `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts` | PASS | 6 tests passed, 0 failed. |
| `/Users/sethogieva/.deno/bin/deno test supabase/functions/ticket-checkout-create/ supabase/functions/ticket-checkout-status/ supabase/functions/ticket-confirmation-dispatch/ supabase/functions/scan-ticket/ supabase/functions/stripe-webhook/` | NO TEST MODULES | Deno returned `error: No test modules found`; those function folders do not contain Deno test files. |
| `git diff --check` | PASS | No stdout. |
| `git ls-tree origin/main supabase/migrations/ \| tail -5` | PASS read-only | `origin/main` tail is `20260515000007`; local worktree has later ORCH migrations. |
| `/Users/sethogieva/bin/supabase migration list --linked \| tail -12` | PASS read-only | Remote has `20260515000015`; new local `20260515000016` is not yet remote-applied. |

Regression coverage that would fail before this rework:

- Jest/strict-grep now require migration `20260515000016` and the bounded pepper-argument RPC signatures.
- Jest/strict-grep now fail if the new migration uses `current_setting('app.qr_token_pepper')`, `ALTER DATABASE`, or `pg_reload_conf()`.
- Jest/strict-grep now require free checkout, paid webhook finalization, and scanner validation to pass `p_qr_token_pepper`.
- Deno tests now prove missing/default/short pepper values fail and paid webhook finalization includes the bounded RPC argument.

## Deployment Notes

Required operator/CLOSE-path deployment after tester PASS:

1. Apply migration `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` with `supabase db push --linked` from main.
2. Redeploy Edge Functions that changed or consume the changed shared module:
   `ticket-checkout-create`, `scan-ticket`, and `stripe-webhook`.
3. Confirm the Edge Function secret named `app.qr_token_pepper` is present by
   name only; do not print or copy the value.
4. Do not run live-fire until targeted tester PASS and deployment are complete.

No Edge Function deploy was performed in this implementation turn. No live
production mutation was performed other than the read-only linked migration-list
check.

## Remaining Live-Fire Instructions

After targeted QA PASS and deployment, rerun
`Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`.
Replace the current `NOT RUN` rows with concrete evidence for free checkout,
paid checkout, webhook latency, webhook replay, Resend, Twilio, organizer order
surfaces, and cross-device scanner validation. PASS routes to Codex
`orchestrator-mingla` for CLOSE; any failing live-fire slice routes back to
Codex `implementor-mingla` for narrow rework.

## Residual Risks

- The new migration is not remote-applied yet; remote runtime remains on the old
  QR helper contract until operator DB push.
- Changed Edge Functions are not redeployed yet; deployed runtime remains stale
  until the deploy step above.
- Live-fire remains intentionally unrun under the hard guard.
