# Implementation Report: ORCH-0777 Persist-Failure Cancel Scope Rework

> Date: 2026-05-11  
> Owner: Codex `implementor-mingla`  
> Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)  
> Status: **implemented and verified**  
> Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`

## 1. Layman Summary

The previous ORCH-0777 rework fixed buyer-facing paid-checkout error JSON, but the cleanup path for a rare database persist failure could lose its Stripe client reference before trying to cancel the newly created PaymentIntent. This patch keeps the Stripe client in nullable outer scope, only attempts cancellation when that client exists, and adds regression coverage so the same scope bug cannot silently return.

No deploy, live-fire, provider config, secret mutation, QR pepper database route, B2 RLS edit, or broad checkout rewrite was performed.

## 2. Files Changed

| File | Change |
| --- | --- |
| `supabase/functions/ticket-checkout-create/index.ts` | Hoisted `let stripe: ReturnType<typeof stripeTicketCheckout> \| null = null` next to `paymentIntent`, assigned it inside the PaymentIntent-create `try`, and gated persist-failure cancellation behind `if (stripe !== null)`. |
| `supabase/functions/_shared/ticketCheckout.ts` | Added `cancelPaymentIntentIfClientAvailable(...)`, a small helper that cancels through the provided nullable client and returns whether a cancel attempt was made. |
| `supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | Added Deno coverage proving the cancel helper attempts cancellation with the created PaymentIntent id and skips cleanly when the client is `null`. |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` | Extended the ORCH-0777 guard to assert the nullable Stripe binding, assignment, `stripe !== null` gate, cancel helper call, and `payment_session_persist_failed` response contract. |

Pre-existing ORCH-0777 rework files remain in the working tree and were not reverted.

## 3. Old-To-New Receipts

| Area | Before | After |
| --- | --- | --- |
| Stripe client scope | The failed QA path showed `stripe` could be block-scoped to the PaymentIntent-create `try`, leaving the persist-failure cancel path at risk of `ReferenceError: stripe is not defined`. | `stripe` is declared before the create `try` as `ReturnType<typeof stripeTicketCheckout> \| null` and assigned inside the try, so the later persist-failure path can safely inspect it. |
| Persist-failure cancel | The cleanup path could attempt `stripe.paymentIntents.cancel(paymentIntent.id)` without a lexically available client. | Cleanup now runs only inside `if (stripe !== null)` and calls `cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)`. |
| Buyer-facing persist failure | Required contract was `{ error: "payment_session_persist_failed", detail: ... }` with status 500. | Contract preserved in `ticket-checkout-create/index.ts` and asserted by the ORCH-0777 business guard. |
| PaymentIntent create failure contract | Previous rework added `payment_intent_create_failed`, sanitized `stripe_payment_intent_create_failed:<status>:<reason>:<code>:<type>`, and `.is("stripe_payment_intent_id", null)`. | Preserved unchanged. |

## 4. Regression Test Evidence

| Coverage | Command | Result |
| --- | --- | --- |
| Deno behavioral helper test | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | PASS: 5 passed, 0 failed. New test: `paid checkout persist failure cancel uses the provided nullable Stripe client`. |
| ORCH static guard | `cd mingla-business && PATH="/opt/homebrew/Cellar/node/25.9.0_3/bin:$PATH" /opt/homebrew/bin/npm run test:orch-0777` | PASS: strict grep passed; Jest 4 suites / 12 tests passed; `tsc --noEmit` passed. |

The Deno regression proves the cancel side effect is attempted with the supplied created PaymentIntent id and skipped when the client is null. The ORCH guard proves the edge function keeps the nullable binding, assignment, explicit `stripe !== null` gate, helper call, and structured persist-failure response in the same repo-running gate.

An initial source-reading test was rejected by the mandated Deno command because it would require `--allow-read`. It was replaced with the permission-safe behavioral helper test above so the required command remains exactly runnable with `--allow-env`.

## 5. Verification Command Outputs

| Gate | Exact command | Result |
| --- | --- | --- |
| Deno test | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | PASS: `ok \| 5 passed \| 0 failed (6ms)`. |
| Business ORCH gate | `cd mingla-business && PATH="/opt/homebrew/Cellar/node/25.9.0_3/bin:$PATH" /opt/homebrew/bin/npm run test:orch-0777` | PASS: `ORCH-0777 production checkout guard passed`; Jest `4 passed, 12 tests passed`; `tsc --noEmit` exited 0. Watchman emitted the existing recrawl warning only. |
| Edge Function typecheck | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/twilio-message-status/index.ts supabase/functions/scan-ticket/index.ts supabase/functions/stripe-webhook/index.ts` | PASS: exit 0. |
| Whitespace | `git diff --check` | PASS: exit 0, no output. |

## 6. Hard-Guard Compliance

No Supabase Edge Function was deployed. No live-fire was run. No Supabase secrets, Stripe Dashboard settings, Resend configuration, Twilio configuration, provider credentials, QR pepper, QR payload, buyer token, Stripe client secret, full phone number, or full provider SID was read, printed, mutated, or artifacted.

The database-level QR pepper GUC route and `pg_reload_conf()` were not reopened. B2 RLS migration `20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` was not modified. The checkout patch was limited to the paid persist-failure cancel scope and tests; no scanner wrong-event, provider config, Stripe restricted-key reshaping, buyer UI, organizer UI, migration, or broad checkout rewrite was performed.

## 7. Deploy Note

After independent focused TEST PASS, Codex `orchestrator-mingla` should redeploy only `ticket-checkout-create` and `ticket-confirmation-dispatch` under the existing ORCH-0777 deploy split. Then the operator clears Resend/Twilio provider configuration, the live-fire matrix in `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` reruns end to end, and ORCH-0777 closes only after every FAIL and NOT RUN row has concrete PASS evidence.

## 8. Downstream Route

Route next to Claude `mingla-forensics` TEST mode for focused verification of P2-1 plus unchanged structured provider and paid-error contracts. Expected QA output: `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`.
