# TEST REPORT — ORCH-0777 QR Pepper Session GUC Rework (Retest)

Date: 2026-05-10
Tester: Claude `mingla-tester` (canonical TEST owner, post-2026-05-10 reversal of META-ORCH-0755 / DEC-133)
Mode: RETEST (scoped — QR pepper runtime contract only)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Subject: implementor rework returned 2026-05-11 (`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`)
Verdict: **PASS — bounded service-role RPC argument contract is correct; B2 QR credential RLS remains preserved; operator-owned apply + redeploy is the only remaining gate before live-fire**

## One-Paragraph Layman Summary

The QR pepper rework cleanly removes ORCH-0777's dependence on project- or database-level Postgres configuration. The implementor chose the strictly safer of the two operator-offered routes — a bounded service-role RPC argument contract — because PostgREST connection pooling cannot honestly guarantee that a prior session `SET` and a later RPC run on the same backend connection. The new migration drops every old no-pepper QR signature (`biz_ticket_checkout_finalize(uuid, text, text, text)`, `biz_ticket_scan(uuid, text, uuid)`, `biz_ticket_checkout_qr_payload(uuid, text)`, `biz_ticket_checkout_token_hash(text)`) and recreates each one with an explicit `p_qr_token_pepper text` argument that is asserted non-null, ≥32 chars, trimmed, and never equal to the `local-ticket-pepper` sentinel before any hash is computed. Every runtime path that needed the pepper — free checkout finalization (`ticket-checkout-create`), paid webhook finalization (`stripeWebhookRouter` → `payment_intent.succeeded`), and scanner validation (`scan-ticket`) — now reads the secret via `Deno.env.get("app.qr_token_pepper")`, fails closed on missing/short/default values, and passes the trimmed value into the bounded service-role RPC. The buyer status fetch path (`ticket-checkout-status`) does not generate or validate signatures and therefore needs no pepper. B2 (migration `20260515000015`) is structurally preserved: the new migration touches function signatures only, not `tickets` column grants, so anon and authenticated still cannot directly read `qr_code` / `qr_token_hash`; the new 3-arg / 2-arg-with-pepper signatures default to `REVOKE ALL FROM PUBLIC` plus `GRANT EXECUTE TO service_role` and the old 2-arg / 1-arg signatures are fully dropped, so anon/authenticated cannot regenerate scanner-valid payloads through any helper. The repo gates (strict-grep, 4 Jest suites / 10 tests, `tsc --noEmit`, 6 Deno tests across two suites, deno check on five Edge Function entrypoints, `git diff --check`) all PASS. The new migration is local-only (`supabase migration list --linked` shows `20260515000016` without remote timestamp); operator must run `supabase db push --linked` and the orchestrator must redeploy `ticket-checkout-create`, `scan-ticket`, and `stripe-webhook` before the live-fire matrix can rerun. No pepper value was read, printed, logged, copied, artifacted, or set during this retest. No live-fire was run. No migration was applied via MCP.

## Counts

P0: 0 | P1: 0 | P2: 0 | P3: 2 | P4: 3

## Scope Boundary

This retest is scoped to the QR pepper runtime contract and B2 preservation. It verifies:

- `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` content and contract.
- `qrTokenPepper()` helper in `supabase/functions/_shared/ticketCheckout.ts`.
- Every QR-dependent runtime path passes `p_qr_token_pepper` into the new bounded RPC.
- No code path depends on `current_setting('app.qr_token_pepper', true)`, `ALTER DATABASE`, or `pg_reload_conf()`.
- B2 (`20260515000015`) column-level revokes and function-level revokes are not weakened or bypassed.
- Regression coverage (Jest migration-guards, strict-grep, Deno tests) fails before this rework and passes after.

Out of scope (covered by prior retests):
- B2 RLS tightening structural correctness — `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`.
- The broader production-checkout structural rework — `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`.
- The Stripe webhook router and restricted-key plumbing — covered in earlier retests.
- Live-fire execution and platform parity — owned by `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`, hard-gated by operator apply + redeploy after this PASS.

## Verification Matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Migration drops old no-pepper signatures | PASS | `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql:6-9` — `DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text)`, `biz_ticket_scan(uuid, text, uuid)`, `biz_ticket_checkout_qr_payload(uuid, text)`, `biz_ticket_checkout_token_hash(text)`. Legacy no-pepper call sites cannot resolve after apply. |
| Migration creates bounded pepper-argument signatures | PASS | `20260515000016:11-27` defines `biz_ticket_checkout_assert_qr_pepper(text)` returning the trimmed pepper after rejecting NULL, empty, `< 32` chars, or `local-ticket-pepper`. `:29-41` defines `biz_ticket_checkout_token_hash(text, text)`; `:43-56` defines `biz_ticket_checkout_qr_payload(uuid, text, text)`; `:58-239` defines `biz_ticket_checkout_finalize(uuid, text, text, text, text)`; `:241-332` defines `biz_ticket_scan(uuid, text, uuid, text)`. Each top-level callable invokes the assert helper before any hashing/signing. |
| Migration forbids database-level GUC primitives | PASS | `20260515000016` source contains no `current_setting('app.qr_token_pepper')`, no `ALTER DATABASE`, no `pg_reload_conf()` (confirmed by strict-grep at `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs:146-150` and Jest `ticketCheckoutMigrationGuards.test.ts:90-92`). |
| Migration grants only service-role | PASS | `20260515000016:334-344` — `REVOKE ALL ... FROM PUBLIC` for all five functions, `GRANT EXECUTE ... TO service_role` for all five. No grant to PUBLIC, anon, or authenticated. |
| Migration monotonicity | PASS | `ls supabase/migrations/` tail is `20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` after `20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql`. `supabase migration list --linked` shows `20260515000016` with empty Remote timestamp — local-only, not pushed. |
| Edge Function pepper helper reads secret by name | PASS | `supabase/functions/_shared/ticketCheckout.ts:29-38` defines `qrTokenPepper()` which reads `Deno.env.get("app.qr_token_pepper")`, trims, rejects `< 32` chars or `local-ticket-pepper`, returns the trimmed string. No log, no console, no artifact. |
| Free checkout passes pepper into RPC | PASS | `supabase/functions/ticket-checkout-create/index.ts:108-124` — for `totalCents === 0`, calls `qrTokenPepper()`, catches and returns `qr_token_pepper_missing` 500 on failure, then `supabase.rpc("biz_ticket_checkout_finalize", { ..., p_qr_token_pepper: qrPepper })`. |
| Paid webhook passes pepper into RPC | PASS | `supabase/functions/_shared/stripeWebhookRouter.ts:472-481` — `handleTicketCheckoutPaymentIntent` calls `qrTokenPepper()` inline as `p_qr_token_pepper: qrTokenPepper()` inside the `payment_intent.succeeded` branch. Import at `:11`. |
| Scanner validation passes pepper into RPC | PASS | `supabase/functions/scan-ticket/index.ts:26-38` — calls `qrTokenPepper()`, catches and returns `qr_token_pepper_missing` 500, then `supabase.rpc("biz_ticket_scan", { ..., p_qr_token_pepper: qrPepper })`. |
| Buyer status fetch path needs no pepper | PASS | `supabase/functions/ticket-checkout-status/index.ts:41-54` reads `tickets.qr_code` via service-role; it does not generate, validate, or sign QR payloads. No pepper dependency. |
| Confirmation dispatch needs no pepper | PASS | `grep` of `supabase/functions/ticket-confirmation-dispatch/index.ts` returns no `biz_ticket_checkout_finalize`, `biz_ticket_scan`, `biz_ticket_checkout_qr_payload`, `biz_ticket_checkout_token_hash`, or `qrTokenPepper` references. Confirmation reads already-issued `qr_code` rows for the order. |
| All QR-helper consumers accounted for | PASS | `grep -rn "qrTokenPepper\\|biz_ticket_checkout_finalize\\|biz_ticket_scan\\|biz_ticket_checkout_qr_payload\\|biz_ticket_checkout_token_hash" supabase/` returns only: the two migrations (13 + 16) defining the functions, the three Edge Function callers above (with pepper passed), the new migration-guard test, and the new Deno tests. No silent consumer missed. |
| B2 column-level revoke preserved | PASS | Migration `20260515000016` does not touch `tickets` table grants. `20260515000015:5-48` REVOKEs broad SELECT and regrants explicit non-credential columns; `qr_code` and `qr_token_hash` are absent from both anon and authenticated grant lists. Live (pre-apply for `15`) DB still has anon/authenticated SELECT on credentials per `TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md` — operator must push both migrations. Once `15` applies, B2 column lock holds; `16` never re-grants. |
| B2 function-level revoke preserved | PASS | Old `biz_ticket_checkout_qr_payload(uuid, text)` and `biz_ticket_checkout_token_hash(text)` signatures are dropped by `20260515000016:8-9`, which moots `20260515000015:50-58` REVOKE/GRANT lines but does not re-grant anything to anon/authenticated. The new pepper-argument signatures default to `REVOKE ALL FROM PUBLIC` (`16:335-338`) and grant `service_role` only (`16:340-344`); anon/authenticated have no implicit EXECUTE. |
| SECURITY DEFINER preserved for callable RPCs | PASS | `20260515000016:65-66` and `:248-249` keep `biz_ticket_checkout_finalize` and `biz_ticket_scan` as `SECURITY DEFINER` with `SET search_path = public, auth`. Helper `biz_ticket_checkout_assert_qr_pepper` is `STABLE` with `SET search_path = public`; SQL helpers `biz_ticket_checkout_token_hash` / `biz_ticket_checkout_qr_payload` are `STABLE` with `SET search_path = public`. Search-path injection vectors are closed. |
| `npm run test:orch-0777` | PASS | Strict-grep passed; Jest 4 suites / 10 tests passed (`phone.test`, `eventOrdersService.test`, `ticketCheckoutService.test`, `ticketCheckoutMigrationGuards.test`); `tsc --noEmit` returned no stdout. Watchman emitted a local recrawl notice unrelated to ORCH-0777. |
| `deno check` on five affected Edge Function entrypoints | PASS | `deno check supabase/functions/{ticket-checkout-create,ticket-checkout-status,ticket-confirmation-dispatch,scan-ticket,stripe-webhook}/index.ts` exited 0. |
| `deno test` on regression suites | PASS | `deno test --allow-env supabase/functions/_shared/__tests__/{ticketCheckout,stripeWebhookRouter}.test.ts` — 2 tests in `ticketCheckout.test.ts`, 4 tests in `stripeWebhookRouter.test.ts` — 6 passed, 0 failed. |
| `git diff --check` | PASS | No stdout, exit 0. |
| Superseded historical docs marked | PASS | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_QR_TOKEN_PEPPER_CONFIG_GATE.md:8` and `Mingla_Artifacts/reports/DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md:7` both begin with `Superseded note (2026-05-10):`. Operator live-fire prompt `Mingla_Artifacts/prompts/OPERATOR_ORCH-0777_PRODUCTION_CONFIG_B2_AND_LIVE_FIRE_GATE.md:50` states `Do not clear QR pepper through database-level Postgres configuration.` |
| Live-fire matrix preconditions updated | PASS | `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md:7-12` rewrites the QR pepper precondition to require the bounded service-role RPC contract; no longer references `ALTER DATABASE` or `pg_reload_conf()`. |
| Buyer-side has no direct credential reads | PASS | `grep -rn "qr_code\\|qr_token_hash" mingla-business/src mingla-business/app` returns only the migration-guard test file. Buyer confirmation UI reads `qrPayload` from server response (`TicketQrCarousel.tsx`). |

## Static-Only Verification (And Why That Is Sufficient Here)

The B2 retest used `BEGIN; <migration body>; <probes>; ROLLBACK;` against the live production DB to prove the post-apply privilege state of `tickets` column grants and helper EXECUTE. That technique is essential for RLS / GRANT contracts because the authoritative surface is `information_schema.column_privileges` + `pg_proc.proacl` at runtime — code review alone cannot prove what privilege rows the DB ends up with.

This QR pepper rework is a different contract: it is a **function-signature and argument-passing contract**, fully expressible in static code. Specifically:

- The migration source either contains the bounded `assert_qr_pepper` invocation in every QR-dependent body or it does not. Reading lines `83`, `172-177`, `260`, `292` shows it does.
- The migration either drops every old no-pepper signature or it does not. Lines `6-9` show it does.
- The migration either contains a database-level GUC primitive or it does not. Strict-grep (`.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs:146-150`) and Jest (`ticketCheckoutMigrationGuards.test.ts:90-92`) prove it does not.
- Edge Function consumers either call `qrTokenPepper()` and pass `p_qr_token_pepper` or they do not. Strict-grep gates (`mjs:156-170`) and Jest gates (`ticketCheckoutMigrationGuards.test.ts:95-105`) cover every consumer; the static `grep` above proves there are no other consumers.

A `BEGIN; ... ROLLBACK;` simulation would only re-verify that the `GRANT/REVOKE` lines at `20260515000016:334-344` produce the expected `pg_proc.proacl` shape for the new signatures — but that is also fully covered by the static reading plus the strict-grep gate that pins the exact `GRANT EXECUTE ... TO service_role` lines. Under the explicit dispatch hard guard "do not apply migrations from MCP," I declined to run the simulation in this retest. The contract is fully proven without it.

If the orchestrator wants additional runtime evidence before CLOSE, the natural place to gather it is the live-fire matrix rerun after operator apply — that exercises every helper end-to-end with a real pepper, real ticket creation, and real scanner validation, which is stronger than any rollback simulation.

## Implementor-Report Claim Re-Verification

| Implementor Claim | Independent Verdict | Evidence |
| --- | --- | --- |
| Chose bounded service-role RPC argument over session `SET` due to PostgREST pooling | PASS | Architecturally correct — PostgREST cannot guarantee per-session state across separate RPC invocations. The bounded-argument contract removes the assumption entirely. The implementor cites this reasoning in `IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md:11-16, 39-45`. |
| Drops every old no-pepper signature in one monotonic migration | PASS | `20260515000016:6-9` drops finalize/scan/qr_payload/token_hash old signatures before creating new ones. |
| Re-creates pepper-argument helper, finalize, and scan | PASS | `20260515000016:11-345`. |
| Rejects missing / short / `local-ticket-pepper` in code | PASS | TS `qrTokenPepper()` at `_shared/ticketCheckout.ts:29-38` and SQL `biz_ticket_checkout_assert_qr_pepper` at migration `:11-27`. Both apply trim and `< 32` length check; both reject the `local-ticket-pepper` sentinel. |
| Free checkout, paid webhook, scanner pass pepper into RPC | PASS | `ticket-checkout-create/index.ts:108-124`, `stripeWebhookRouter.ts:472-481`, `scan-ticket/index.ts:26-38`. |
| Buyer status fetch needs no pepper because it reads already-issued `qr_code` | PASS | `ticket-checkout-status/index.ts:41-54` reads `qr_code` directly via service-role. No signing or validation occurs. |
| B2 credential RLS preserved | PASS | New migration only touches function signatures and grants; does not weaken or re-grant `tickets` column SELECT; does not re-grant any old or new helper EXECUTE to anon/authenticated. |
| Repo regression added that would fail before and pass after | PASS | `ticketCheckoutMigrationGuards.test.ts:81-105` — added two new `it(...)` blocks asserting the new migration file string contents and the Edge Function call sites. Existing strict-grep file `orch-0777-ticket-checkout-production.mjs` adds 9 new assertions (`:126-185`) covering the same surface. Both would fail with the prior database-level-config migration absent the new file. |
| `npm run test:orch-0777` PASS | PASS | Re-ran — strict-grep clean, 4 Jest suites / 10 tests pass, `tsc --noEmit` clean. |
| Deno check on five Edge Function entrypoints PASS | PASS | Re-ran — exit 0, no errors. |
| `deno test` on shared regression suites PASS | PASS | Re-ran — 6 tests pass across 2 suites. |
| `git diff --check` PASS | PASS | Re-ran — no stdout. |
| Local migration is not yet remote-applied | PASS | `supabase migration list --linked` confirms `20260515000016` has empty Remote timestamp (line in tail: `20260515000016 |                | 2026-05-15 00:00:16`). |
| No pepper value read, printed, logged, or artifacted | NOT FALSIFIABLE FROM REPO, BUT CONSISTENT | The diff contains no secret literal; the strict-grep / Jest gates reject any committed pepper value; the deploy + report files reference the secret name only. I did not select, read, print, or copy the production pepper value during this retest. |
| No live-fire run | CONSISTENT | The implementor report explicitly states none was run. I did not run live-fire either. |

## Constitutional Sweep (post-pepper-rework)

| Rule | Status | Evidence |
| --- | --- | --- |
| 1. No dead taps | N/A | No UI surfaces changed. |
| 2. One owner per truth | PASS | QR signing material owned by service-role RPC + Edge Function secret only. |
| 3. No silent failures | PASS | TS `qrTokenPepper()` throws on missing/short/default; each consumer wraps in try/catch and returns a `500 qr_token_pepper_missing` response (paid webhook propagates the exception to Stripe so the webhook retries — correct fail-loud behavior under bounded RLS). SQL `biz_ticket_checkout_assert_qr_pepper` `RAISE EXCEPTION 'qr_token_pepper_missing'` — propagates as RPC error. |
| 4. One key per entity | N/A | No React Query keys changed. |
| 5. Server state server-side | PASS | Pepper lives only in Edge Function secrets and is passed only into service-role RPC arguments; never reaches the client. |
| 6. Logout clears everything | N/A | No client persistence changed. |
| 7. Label temporary | N/A | Migration is permanent. |
| 8. Subtract before adding | PASS | Old no-pepper signatures dropped before new pepper-argument signatures created. |
| 9. No fabricated data | PASS | Hashes and signatures are deterministic functions of `gen_random_uuid()` token material + the pepper. No fabricated buyer-facing data. |
| 10. Currency-aware | N/A | Not currency-related. |
| 11. One auth instance | N/A | Auth flow unchanged. |
| 12. Validate at right time | PASS | Pepper validated synchronously at the start of each RPC body (after argument bind, before any hashing). |
| 13. Exclusion consistency | PASS | TS-side and SQL-side reject identical bad inputs (NULL/empty/short/`local-ticket-pepper`). |
| 14. Persisted-state startup | N/A | No persisted-state surface. |

## Platform Parity (Required Per Operator Directive)

This change is server-side: migration DDL + Edge Function logic. There is no client UI, simulator-runnable surface, or platform-specific behavior to exercise in this retest. Mandatory platform parity is reported as N/A with reasoning:

- iOS Simulator: N/A — no client code touched. Buyer QR display path (`mingla-business/src/components/checkout/TicketQrCarousel.tsx`) reads `qrPayload` from the server response; payload shape is unchanged (`'mingla:v1:ticket:' || uuid || ':sig:' || hex64`). Behavior identical pre/post migration when both run with the same pepper.
- Android Emulator: N/A — same reasoning.
- Web (mingla-business buyer flow): N/A — same reasoning. Buyer status endpoint authoritatively returns `qrPayload`; mobile/web both receive the same shape.

The end-to-end iOS-Simulator + Android-Emulator + Web matrix (free checkout → buyer email/SMS → buyer renders QR → cross-device scanner) is owned by the upcoming live-fire rerun in `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`, hard-gated on operator `supabase db push --linked` and orchestrator redeploy of the three changed Edge Functions.

## Net-New Findings

### P3 — Free-checkout pepper-missing surfaces as buyer-facing 500 while paid-webhook propagates server-side

Evidence:
- `supabase/functions/ticket-checkout-create/index.ts:108-114` catches the TS exception and returns `{ error: "qr_token_pepper_missing" }` 500 to the buyer.
- `supabase/functions/_shared/stripeWebhookRouter.ts:472-481` does NOT wrap `qrTokenPepper()` in a try/catch — if the pepper is missing during a `payment_intent.succeeded` event, the throw bubbles up to the webhook entrypoint and Stripe will retry with exponential backoff.
- `supabase/functions/scan-ticket/index.ts:26-31` mirrors the free-checkout shape — catches and returns 500.

Behavior is correct in each path (free + scan return user-visible failure; webhook fails loud so Stripe retries when the secret is fixed), but the asymmetry is worth noting. In particular, a buyer who hits "Pay" between Edge-Function deploy and secret-set would see a generic 500 rather than a "we're getting this ready" message. If the operator follows the deploy order (set secret → push migration → redeploy functions), this window is zero. Worth one sentence in operator handoff.

Real-world impact: low — the operator order in the implementor report makes this unreachable in normal flow.

Recommendation (follow-up, not blocker): consider rendering a buyer-facing "ticket issuance is currently unavailable; please try again shortly" message instead of raw 500 for the free-checkout path. Not blocking PASS.

### P3 — Strict-grep pin on exact 5-arg finalize signature is fragile to future additive arguments

Evidence: `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs:136-140` asserts literal:
```
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text, text) TO service_role
```

If a future ORCH adds a sixth argument (e.g., `p_locale`), the strict-grep fires before the legitimate update lands, even when the new signature is correct. Same shape for `biz_ticket_scan(uuid, text, uuid, text)` at `:142-145`.

Real-world impact: low — strict-grep is meant to fail when the contract changes. A future signature change is a deliberate contract change and should be paired with a strict-grep update.

Recommendation (follow-up, not blocker): when a future arity change is needed, update both the migration and the strict-grep in the same PR. No code change needed today.

### P4 — Praise: implementor chose the strictly safer of the two operator-offered routes and documented why

The operator prompt offered two acceptable routes: per-session `SET` after the service-role client connects, or per-transaction `SET LOCAL` inside the same transaction. The implementor's report (`IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md:11-16, 39-45`) instead chose a bounded RPC argument and explained that the Supabase JS client (which goes through PostgREST) cannot honestly guarantee per-session GUC continuity across separate RPC invocations under connection pooling. This is the correct call and the implementor honored the prompt's escape hatch ("If the Supabase JS client cannot guarantee per-session `SET` behavior because of PostgREST connection pooling, do not fake it. … implement the safest bounded alternative, such as a SECURITY DEFINER RPC/transaction that … performs the dependent QR operation within the same transaction"). The bounded-argument variant is even tighter than a `SET LOCAL` transaction because the pepper never appears in any session state at all — it lives only in the function-call argument stack.

### P4 — Praise: search-path hardening on every new function

Every new function in `20260515000016` (assert helper, token hash, qr payload, finalize, scan) sets `search_path` explicitly (`public` or `public, auth`). This closes the search-path injection vector that ORCH-0700 / META-ORCH-0755 standardized for SECURITY DEFINER functions. Consistent with the rest of the ticket checkout migrations.

### P4 — Praise: trim-and-min32 contract is matched on both sides

The Edge Function `qrTokenPepper()` and the SQL `biz_ticket_checkout_assert_qr_pepper` both:
- Apply trim/`btrim`.
- Reject `< 32` length after trim.
- Reject the literal `local-ticket-pepper` sentinel.

Defense in depth: even if a future Edge Function bug somehow passes through a short value, the SQL helper closes the gap. The Deno tests pin the TS contract; the Jest migration-guard test pins the SQL contract.

## Live-Fire Matrix Readiness Update

| Gate | Status (after QR pepper retest) |
| --- | --- |
| Edge Functions deployed (5 of 6 + stripe-webhook) | PASS for prior versions per `DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md` — but **`ticket-checkout-create`, `scan-ticket`, and `stripe-webhook` must be redeployed** to pick up the new pepper-argument call sites. Owner: orchestrator post-apply. |
| Stripe webhook events include `payment_intent.*` | PASS — `STRIPE_ROUTED_EVENT_TYPES` includes all three; deploy report unchanged. |
| `STRIPE_RAK_TICKET_CHECKOUT` set | PASS by name presence (per live-fire matrix latest entry). |
| `app.qr_token_pepper` Edge Function secret set to non-default min32 | PASS by name presence (per live-fire matrix latest entry). Operator must verify the secret value is `≥ 32` chars and not `local-ticket-pepper` before redeploy. |
| B2 RLS tightening migration `20260515000015` applied | PASS — present in remote migration list. |
| QR pepper rework migration `20260515000016` applied | **STILL FAIL** — local-only. Operator owns `supabase db push --linked`. |
| Edge Functions redeployed with new pepper call sites | **STILL FAIL** — orchestrator owns `supabase functions deploy ticket-checkout-create`, `scan-ticket`, `stripe-webhook` post-apply. |
| Live-fire matrix | NOT RUN — blocked by the two remaining gates above. |

After operator applies `20260515000016` and orchestrator redeploys the three functions, the live-fire matrix can rerun and replace the `NOT RUN` entries with concrete free-checkout, paid-checkout, webhook-replay, Resend, Twilio, organizer-truth, and cross-device-scanner evidence.

## Discoveries for Orchestrator

- No new artifacts are required from the orchestrator side for this retest. The QR pepper contract is locked in code; the strict-grep + Jest gates will fail any future regression that removes the pepper argument or reintroduces a database-level GUC primitive.
- The two P3 findings above are hardening recommendations and do not block CLOSE.
- B1 loading-state honesty P2 from earlier retests remains a follow-up unrelated to this ORCH.

## Verification Command Outputs

### `cd mingla-business && npm run test:orch-0777`

```
> mingla-business@1.0.0 test:orch-0777
> node ../.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs && npx jest phone.test eventOrdersService.test ticketCheckoutService.test ticketCheckoutMigrationGuards.test && npx tsc --noEmit

ORCH-0777 production checkout guard passed.
watchman warning:  Recrawled this watch 5 times, most recently because:
MustScanSubDirs UserDroppedTo resolve, please review the information on
https://facebook.github.io/watchman/docs/troubleshooting.html#recrawl
...
PASS src/utils/__tests__/phone.test.ts
PASS src/services/__tests__/ticketCheckoutMigrationGuards.test.ts
PASS src/services/__tests__/ticketCheckoutService.test.ts
PASS src/services/__tests__/eventOrdersService.test.ts

Test Suites: 4 passed, 4 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        4.533 s, estimated 5 s
```

### `deno check` on five affected Edge Function entrypoints (from repo root)

```
deno check supabase/functions/ticket-checkout-create/index.ts \
            supabase/functions/ticket-checkout-status/index.ts \
            supabase/functions/ticket-confirmation-dispatch/index.ts \
            supabase/functions/scan-ticket/index.ts \
            supabase/functions/stripe-webhook/index.ts
EXIT=0
```

(No errors. Type-check successful.)

### `deno test` on shared regression suites

```
deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts \
                       supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts

running 2 tests from ./supabase/functions/_shared/__tests__/ticketCheckout.test.ts
qrTokenPepper rejects missing, fallback, and short values ... ok
qrTokenPepper returns a trimmed non-default secret without logging it ... ok
running 4 tests from ./supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts
router exposes 19 subscribed events and excludes fake requirements event ... ok
payment_intent.succeeded finalizes checkout with bounded QR pepper RPC argument ... ok
account.updated updates connect row and clears KYC stall marker when enabled ... ok
payout.failed upserts payout and dispatches remediation notification ... ok

ok | 6 passed | 0 failed (78ms)
EXIT=0
```

### `git diff --check`

```
EXIT=0
```

(No stdout. Whitespace clean.)

### `supabase migration list --linked` (tail)

```
20260515000013 | 20260515000013 | 2026-05-15 00:00:13
20260515000014 | 20260515000014 | 2026-05-15 00:00:14
20260515000015 | 20260515000015 | 2026-05-15 00:00:15
20260515000016 |                | 2026-05-15 00:00:16
```

The QR pepper rework migration is local-only. Operator must `supabase db push --linked` to activate. B2 (`20260515000015`) is present in both Local and Remote per the prior retest.

## Hard-Guard Compliance Statement

- No production secret values (`app.qr_token_pepper`, `STRIPE_RAK_TICKET_CHECKOUT`, `SUPABASE_SERVICE_ROLE_KEY`, Stripe webhook signing keys, Resend keys, Twilio credentials, OneSignal keys) were read, printed, copied, logged, or set during this retest.
- No live-fire was executed. No real free checkout, paid checkout, webhook replay, Resend dispatch, Twilio dispatch, organizer-truth update, or cross-device scan was triggered.
- No migration was applied via MCP. The Supabase Management API was not used to mutate the production DB during this retest. The single remote read was `supabase migration list --linked` via local CLI, which is a read-only metadata query.
- No tests were weakened, deleted, or relaxed. The two P3 findings above are hardening recommendations only.
- B2 QR credential RLS contract was not weakened. The new migration only adds bounded service-role RPC signatures; it does not re-grant any old or new helper EXECUTE to anon/authenticated; it does not re-grant `qr_code` / `qr_token_hash` direct SELECT on `tickets` to any app role.
- The pepper value was not selected from Supabase secrets, environment, or any other source. The tests in `ticketCheckout.test.ts` and `stripeWebhookRouter.test.ts` use a synthetic 32-character literal as the test value, not the production pepper.

## Final Verdict

**PASS** — ORCH-0777 QR pepper rework is implementation-complete and contract-correct. The bounded service-role RPC argument route removes ORCH-0777's dependence on project- or database-level Postgres configuration; every QR-dependent runtime path now passes the pepper explicitly, asserts non-default/non-short/non-missing inside the SQL boundary before hashing, and locks helper EXECUTE to `service_role` only. Old no-pepper signatures are dropped so legacy callers cannot silently fall back. B2 QR credential RLS contract is preserved at both column and function layers. Repo gates are all green. Operator must `supabase db push --linked` to apply migration `20260515000016` and the orchestrator must redeploy `ticket-checkout-create`, `scan-ticket`, and `stripe-webhook`; after that, the live-fire matrix can rerun, replace the `NOT RUN` rows with concrete evidence, and route to CLOSE on PASS.

---

NEXT HANDOFF — paste into operator:

ORCH-0777 QR pepper retest PASSES. The bounded service-role RPC argument contract in `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` is structurally correct: every old no-pepper signature is dropped, every new signature requires `p_qr_token_pepper` and asserts non-NULL / ≥32 / not `local-ticket-pepper` inside SQL before any hashing, EXECUTE is granted to `service_role` only, and the three Edge Function consumers (`ticket-checkout-create`, `stripeWebhookRouter` for paid webhook, `scan-ticket`) read the secret via `Deno.env.get("app.qr_token_pepper")` and pass `p_qr_token_pepper` into every RPC call. B2 column-level revoke of `tickets.qr_code` / `tickets.qr_token_hash` and B2 function-level revoke of QR helpers from anon/authenticated remain preserved — the new migration only touches function signatures. Repo gates all green: `npm run test:orch-0777` (strict-grep + 4 Jest suites / 10 tests + tsc), `deno check` on five Edge Function entrypoints, `deno test` on `ticketCheckout.test.ts` + `stripeWebhookRouter.test.ts` (6 tests), `git diff --check`. `supabase migration list --linked` shows `20260515000016` local-only — please run `supabase db push --linked` to apply it, then ask Codex `orchestrator-mingla` to redeploy `ticket-checkout-create`, `scan-ticket`, and `stripe-webhook` and to rerun `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` replacing every `NOT RUN` row with concrete evidence. Hard guards remain: do not print the pepper value; do not run live-fire until after apply + redeploy; live-fire PASS routes to Codex `orchestrator-mingla` for CLOSE ORCH-0777; any failing live-fire slice routes back to Codex `implementor-mingla` for narrow rework. Full retest evidence: `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_QR_PEPPER_SESSION_GUC.md`.
