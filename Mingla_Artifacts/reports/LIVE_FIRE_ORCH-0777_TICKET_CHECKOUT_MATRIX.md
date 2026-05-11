# LIVE-FIRE ORCH-0777 - Ticket Checkout Matrix

Date: 2026-05-10  
Owner: Codex `orchestrator-mingla`  
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)  
Verdict: **BLOCKED - B2 migration and Stripe RAK presence PASS, QR pepper implementation rework required before live-fire**

2026-05-10 rework note: the database-level QR pepper GUC route is superseded.
Before live-fire, apply and redeploy the bounded service-role RPC argument
contract from
`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`,
then run targeted TEST mode.

## Plain-English Status

ORCH-0777 is still not close-ready, but the blocker has narrowed again. B2 is no longer an open implementation/test question: the QR credential RLS tightening migration is contract-correct, regression-covered, independently retested against the live production database by transaction-rollback simulation, and now present in the linked remote migration list. The ticket-checkout Stripe restricted-key secret name is also present in Supabase Edge Function secrets.

The remaining blocker is now implementation-owned, not operator-owned. A Supabase Edge Function secret named `app.qr_token_pepper` is present, and the active path must use that secret through the bounded service-role RPC argument contract before QR-dependent SQL runs. Operator direction supersedes the prior database-level Postgres configuration route: do not use database-level GUC setup or `pg_reload_conf()` for ORCH-0777.

No production secret values were read, written, printed, or exposed in this report. `STRIPE_RAK_TICKET_CHECKOUT` was set from local `stripe-values.md` outside this artifact without printing the value; the verification recorded here is name presence only. No live-fire was run in this gate.

2026-05-10 fresh status-only verification: the live DB still returns `qr_token_pepper_status=missing` and `value_length=0`. No pepper value was selected, printed, or artifacted.

## Inputs Reviewed

- `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` (prior blocked matrix)
- `Mingla_Artifacts/prompts/OPERATOR_ORCH-0777_PRODUCTION_CONFIG_B2_AND_LIVE_FIRE_GATE.md`
- `Mingla_Artifacts/reports/DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md`
- `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`

## Gate Results

| Gate | Result | Evidence |
| --- | --- | --- |
| Edge Functions deployed | PASS | Prior live-fire gate recorded `ticket-checkout-create`, `ticket-checkout-status`, `ticket-confirmation-dispatch`, `twilio-message-status`, `scan-ticket`, and `stripe-webhook` ACTIVE on project `gqnoajqerqhnvulmnyvv`. This must be rechecked during the final live-fire rerun. |
| Stripe webhook events | PASS | Prior live-fire gate recorded endpoint `we_1TUJaAPjlZyAYA40JfrGOZzW` enabled in test mode with `payment_intent.succeeded`, `payment_intent.payment_failed`, and `payment_intent.canceled`, preserving `application_fee.created` and `application_fee.refunded`. This must be rechecked during the final live-fire rerun. |
| B2 QR credential RLS migration content | PASS | `TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md` verifies migration `20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` revokes broad app-role SELECT on `tickets`, regrants only non-credential columns, excludes `qr_code` / `qr_token_hash`, and limits QR helper EXECUTE to `service_role` + `postgres`. |
| B2 post-apply privilege state | PASS by transaction-rollback simulation | Tester executed `BEGIN; <migration body>; <probes>; ROLLBACK;` against live production DB `gqnoajqerqhnvulmnyvv`. Post-apply simulated state returned zero anon/authenticated SELECT grants on `qr_code` / `qr_token_hash`, preserved non-credential app-role reads, preserved service-role credential reads, and preserved SECURITY DEFINER helper execution through owner privileges. |
| Live DB unchanged by B2 simulation | PASS | Tester re-probed after rollback and verified the live DB was unchanged by the simulation at that time. A later migration-list check in this gate now shows `20260515000015` present remotely, so the B2 apply gate is cleared. |
| B2 repo gates | PASS | `npm run test:orch-0777` passed, covering strict-grep, 4 Jest suites / 8 tests, and `tsc --noEmit`; Deno checks on `ticket-checkout-status`, `ticket-confirmation-dispatch`, and `scan-ticket` passed; `git diff --check` passed. |
| B2 migration applied remotely | PASS | `/Users/sethogieva/bin/supabase migration list --linked \| rg '20260515000015\|Local\|Remote'` showed `20260515000015` present in both Local and Remote for project `gqnoajqerqhnvulmnyvv`. |
| `STRIPE_RAK_TICKET_CHECKOUT` set | PASS - NAME PRESENCE ONLY | `/Users/sethogieva/bin/supabase secrets list --project-ref gqnoajqerqhnvulmnyvv \| rg 'STRIPE_RAK_TICKET_CHECKOUT'` returned the secret name. The restricted key value was not requested, printed, copied, or recorded. |
| `app.qr_token_pepper` runtime contract | BLOCKED - IMPLEMENTATION REWORK REQUIRED | Supabase Edge Function secrets now include a secret named `app.qr_token_pepper` by name-only verification. Operator direction supersedes the prior database-level route: apply and redeploy the bounded service-role SQL path from `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`, and never print the value. |
| Live-fire matrix | NOT RUN | Hard guards forbid live-fire until the QR pepper runtime contract is implemented, independently retested, redeployed where needed, and verified. |

## Live-Fire Matrix

| Scenario | Status | Evidence / Blocker |
| --- | --- | --- |
| Free checkout: buyer details, reserve, confirmation with server tickets, email + SMS | NOT RUN | Blocked until QR pepper session/transaction GUC rework passes targeted retest. Replace this row with event ID, buyer/session/order/ticket IDs, email evidence, SMS evidence, and server-ticket confirmation evidence after rerun. |
| Paid checkout: PaymentSheet success, finalization, confirmation QR | NOT RUN | Blocked until QR pepper session/transaction GUC rework passes targeted retest. Replace this row with Stripe PaymentIntent/session/order/ticket evidence after rerun. |
| Webhook latency: 5-15s delay, no false failure | NOT RUN | Blocked by pre-live-fire gates. Replace with observed polling/finalization behavior, timestamps, and absence of false buyer error after rerun. |
| Webhook replay: re-deliver `payment_intent.succeeded`, no duplicate tickets | NOT RUN | Blocked by pre-live-fire gates. Replace with Stripe replay ID, before/after order/ticket counts, and idempotency proof after rerun. |
| Resend delivery: branded ticket email | NOT RUN | Blocked by pre-live-fire gates. Replace with delivery/message ID and buyer-facing content/recipient proof without exposing secrets after rerun. |
| Twilio delivery and status callback row update | NOT RUN | Blocked by pre-live-fire gates. Replace with message SID/status callback row evidence without exposing secrets or private phone details after rerun. |
| Organizer Orders: sold count, revenue, activity, guest list within 15s | NOT RUN | Blocked by pre-live-fire gates. Replace with organizer-truth evidence across orders, sold count, revenue, activity, guest list/detail, and timing after rerun. |
| Cross-device scanner: first scan succeeds, duplicate second scan, wrong-event returns `wrong_event` | NOT RUN | Blocked until QR pepper session/transaction GUC rework passes targeted retest. Replace with scanner evidence across iOS Simulator, Android Emulator, and web/business scanner where applicable after rerun. |

## B2 Decision Rationale

Decision: **tighten before live-fire**. The decision is now implemented, retest-passed, and present in the remote migration list.

Facts:

- Tester verified the `tickets` policy `Buyer or brand team can select tickets`.
- Tester verified `tickets.qr_code` is the signed display payload accepted by the scanner path.
- Existing buyer confirmation/status flow and scanner validation already go through Edge Functions.
- B2 retest proved the post-apply privilege contract closes direct app-role reads of `qr_code` and `qr_token_hash` while preserving buyer QR display, confirmation dispatch, and scanner validation through service-role / SECURITY DEFINER paths.

Assumption:

- Brand-team members need operational ticket metadata and order visibility, but not universal direct read access to scanner credentials unless they are acting through the scanner path.

Risk that was avoided by applying before live-fire:

- Running live-fire before the B2 migration applied would have left app-role direct SELECT on scanner credential columns in place, allowing a brand-team reader to collect valid scan payloads before the RLS tightening took effect.

## Required Operator Actions

1. Dispatch Codex `implementor-mingla` with `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`.
2. After targeted tester PASS and any required Edge Function redeploy, rerun this live-fire matrix and replace every `NOT RUN` entry with concrete free-checkout, paid-checkout, webhook-replay, Resend, Twilio, organizer-truth, and cross-device-scanner evidence.

## Close Guard

ORCH-0777 is **not close-ready**. Do not route to CLOSE until:

- QR pepper no longer depends on database-level Postgres configuration; targeted retest proves the bounded service-role equivalent;
- the full live-fire matrix returns PASS with concrete evidence replacing all `NOT RUN` rows.

Downstream routing: if live-fire FAILS, route the failing scenario back to Codex `implementor-mingla` for the smallest correct fix tied to the failing scenario. If live-fire PASSES, route to Codex `orchestrator-mingla` for CLOSE ORCH-0777.
