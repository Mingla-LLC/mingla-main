# QA REPORT — ORCH-0777 Live-Fire Rework (Notifications, Paid Checkout, Scanner Wrong-Event)

Date: 2026-05-10
Tester: Claude `mingla-tester` (canonical TEST owner, post-2026-05-10 reversal of META-ORCH-0755 / DEC-133)
Mode: RETEST (scoped — live-fire rework slices only)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Subject: implementor return `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`
Verdict: **CONDITIONAL PASS — code contract proven; close-ready depends on operator `supabase db push --linked`, redeploy of `ticket-checkout-create` + `ticket-confirmation-dispatch`, operator config repair of Resend/Twilio/Stripe Connect, then live-fire matrix rerun**

> Supersedes the prior draft of this file dated 2026-05-11 which flagged a P2 about `stripe` being declared inside the create-try block. That regression has since been fixed by the implementor: `let stripe: ReturnType<typeof stripeTicketCheckout> \| null = null;` is now hoisted to `ticket-checkout-create/index.ts:155` (above the try block) and the cancel call goes through the new null-safe helper `cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)` defined in `_shared/ticketCheckout.ts:195-202`. The reported P2 is no longer present in the on-disk code; the cleanup path is now safe. This retest reflects the current code state.

## One-Paragraph Layman Summary

The implementor made the four smallest correct changes for the four failing live-fire slices and did not broaden scope. (1) Buyer email + SMS now classify provider non-2xx responses through a sanitized `provider_send_failed:status:reason[:safe_code]` contract and mark 400/401/403 terminal so retry loops stop on configuration errors. (2) Paid checkout no longer returns a bare HTTP 500 when the Stripe `paymentIntents.create` call fails — it returns a structured `payment_intent_create_failed` JSON with sanitized detail and marks the unfinished session `failed` only when no PaymentIntent was persisted, so the next live-fire run will surface the actual provider/config root cause instead of hiding it. (3) The scanner wrong-event slice gets a new database migration (`20260515000017`) that writes the audit row under the ticket's actual event id (preserving the requested event id in metadata) so the existing `trg_scan_events_ticket_event` trigger no longer converts a clean `wrong_event` result into a 400 `scan_failed`. (4) Hard guards held — no secrets, no DB-level pepper reintroduction, no Stripe restricted-key isolation weakening, no B2 RLS rollback, no test relaxation. **However, the new migration is local-only and the changed Edge Functions are stale on remote (current versions: `ticket-checkout-create` v8 deployed 2026-05-11 00:24:57Z, `ticket-confirmation-dispatch` v7 deployed 2026-05-10 22:18:44Z), so the live-fire matrix can only be rerun after operator pushes migration 17 and the orchestrator redeploys those two functions.** I am also flagging one P2 (the implementor's report under-counts the Deno test suite by one — claims "4 passed" but the file has 5 tests and they all pass after `--reload`), one P3 cosmetic note about Deno cache hygiene, and one P3 about `not_found` audit-row event_id selection that is pre-existing and out of scope for this rework.

## Counts

P0: 0 | P1: 0 | P2: 1 | P3: 2 | P4: 3

## Scope Boundary

This retest is scoped to the four live-fire failing slices the implementor was dispatched against:

- Resend buyer email `resend_send_failed:403`
- Twilio buyer SMS `twilio_send_failed:400`
- Paid checkout HTTP 500 / no `stripe_payment_intent_id` persisted
- Scanner wrong-event HTTP 400 `scan_failed`

Out of scope (held by other artifacts and not re-opened in this rework):

- B2 QR credential RLS tightening — covered by `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`. The B2 migration (`20260515000015`) is applied to remote and untouched here.
- QR pepper service-role RPC contract — covered by `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`. Migration `20260515000016` is applied to remote and untouched here.
- Database-level pepper / `app.qr_token_pepper` GUC — superseded route, not re-opened.
- Webhook routing, organizer-server-truth migration, paid PaymentSheet client UX — depend on this rework's deploy + provider-config repair before they can be live-fire validated.

## Verification Matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Implementor scope held to the four failing slices | PASS | `git status` shows modifications only to `supabase/functions/_shared/ticketCheckout.ts`, `supabase/functions/ticket-checkout-create/index.ts`, `supabase/functions/ticket-confirmation-dispatch/index.ts`, the two test files, and untracked addition of migration `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql`. No B2 RLS rollback. No QR pepper migration mutation. No scanner refactor outside `biz_ticket_scan` body. |
| Hard-guard: no secrets/payloads exposed | PASS | `git diff HEAD -- supabase/ mingla-business/src` grep for `sbp_\|sk_test\|sk_live\|whsec_\|rk_*\|AC[0-9a-f]{32}\|SK[0-9a-f]{32}\|MG[0-9a-f]{32}\|re_[A-Za-z0-9]+\|pi_*\|pm_*\|cs_*\|913b36c2\|ca5b\|local-ticket-pepper\|RESEND_API_KEY\|TWILIO_AUTH_TOKEN` returned only synthetic test fixture IDs (`pi_persist_failure_test`, `pi_not_created`) and the secret name `app.qr_token_pepper` (name only, never value). No real provider IDs, pepper values, pepper digests, buyer tokens, client secrets, or QR payloads in the diff. |
| Hard-guard: no DB-level QR pepper reintroduction | PASS | `grep -nE 'current_setting\|ALTER DATABASE\|pg_reload_conf' supabase/migrations/20260515000017_*.sql` → no matches. The new `biz_ticket_scan` body still calls `public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper)` (the bounded service-role RPC argument from migration 16). Pepper still flows from Edge Function secret → service-role argument; never from a DB session/GUC. |
| Hard-guard: Stripe restricted-key isolation preserved | PASS | `supabase/functions/_shared/stripe.ts:60-61` still uses `stripeTicketCheckout()` → `createStripeClient("STRIPE_RAK_TICKET_CHECKOUT")`. `ticket-checkout-create/index.ts:157` still calls `stripe = stripeTicketCheckout()`. No fallback to `STRIPE_SECRET_KEY` introduced. |
| Hard-guard: B2 QR credential RLS preserved | PASS | `git diff HEAD -- supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` → empty. B2 migration unchanged; `tickets.qr_code` / `tickets.qr_token_hash` remain locked away from anon/authenticated direct SELECT. |
| Hard-guard: tests not weakened | PASS | Jest assertions in `ticketCheckoutMigrationGuards.test.ts` are net-new (added `keeps wrong-event scans from violating the scan_events ticket-event trigger` and `keeps paid checkout and provider failures structured and non-secret`). Deno test was refactored from a brittle source-string-grep test to a direct call against the new `cancelPaymentIntentIfClientAvailable` helper — a stricter contract test, not a relaxation. |
| Migration ordering | PASS | `ls supabase/migrations \| tail -3` → `20260515000015`, `20260515000016`, `20260515000017`. Strictly monotonic. `supabase migration list --linked \| tail -8` shows 17 in Local only (Remote empty for 17), 16 in both, 15 in both. New migration is the highest. |
| Live remote `biz_ticket_scan` body confirms pre-fix bug exists | PASS | `pg_get_functiondef(p.oid)` substring at byte offset 2088 reads `INSERT INTO public.scan_events ( ticket_id, event_id, scanner_user_id, ...) VALUES ( v_ticket_id, p_event_id, p_scanner_user_id, v_scan_result, ... )`. Live function inserts `p_event_id` unconditionally → trigger raises `scan_events.event_id must match tickets.event_id` for wrong-event. Matches the live-fire FAIL evidence; confirms the migration is needed. |
| Live remote trigger `trg_scan_events_ticket_event` is exactly the constraint the migration must satisfy | PASS | `pg_get_triggerdef` returns `CREATE TRIGGER trg_scan_events_ticket_event BEFORE INSERT OR UPDATE ON public.scan_events FOR EACH ROW EXECUTE FUNCTION biz_scan_events_enforce_ticket_event()`. `biz_scan_events_enforce_ticket_event()` body contains `RAISE EXCEPTION 'scan_events.event_id must match tickets.event_id'`. Trigger function has not changed since baseline. |
| `ticket_checkout_sessions` columns required by new failure-handling path exist on remote | PASS | `information_schema.columns` query returned `failed_at` (timestamptz, nullable), `failure_reason` (text, nullable), `status` (text, NOT NULL), `stripe_payment_intent_id` (text, nullable), `updated_at` (timestamptz, NOT NULL). The `update({status: 'failed', failed_at, failure_reason, updated_at}).eq('id', sessionId).is('stripe_payment_intent_id', null)` clause from `ticket-checkout-create/index.ts:175-185` executes against existing schema. |
| Migration 17 body — wrong-event audit row uses ticket's event_id | PASS | `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql:79-95`: `v_scan_event_id := CASE WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id ELSE p_event_id END;` followed by `INSERT INTO public.scan_events (..., event_id, ...) VALUES (v_ticket_id, v_scan_event_id, ...)`. Trigger constraint satisfied because the inserted event_id is exactly `v_ticket.event_id` for wrong-event, by definition. |
| Migration 17 body — wrong-event metadata preserves requested event id | PASS | Line 90 of new migration: `'requestedEventId', p_event_id` inside `jsonb_build_object`. Audit trail preserves what the scanner attempted to scan against, even though `event_id` column points to the ticket's true event. Forensic visibility preserved. |
| Migration 17 body — return value still reports `wrong_event` to caller | PASS | Line 100-107: `RETURN jsonb_build_object('result', v_scan_result, ...)` where `v_scan_result := 'wrong_event'` is set by the existing branch at line 62. Edge Function `scan-ticket/index.ts:44` returns `data` directly → caller receives HTTP 200 with `{result: "wrong_event", ...}` instead of HTTP 400 `scan_failed`. |
| Migration 17 body — REVOKE/GRANT preserves service-role-only execution | PASS | Lines 111-112: `REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;` — same as migration 16's grant pattern. No widening. |
| Migration 17 body — uses `CREATE OR REPLACE`, not `DROP+CREATE` | PASS | Line 7: `CREATE OR REPLACE FUNCTION public.biz_ticket_scan(...)`. Identity arguments unchanged from migration 16, so the dependency contract is preserved. No `DROP FUNCTION` precedes it. Edge Function `scan-ticket` does not need redeploy because the RPC signature is unchanged. |
| `ticket-confirmation-dispatch` provider classifier — Resend 403 path | PASS | `supabase/functions/_shared/ticketCheckout.ts:134-153` `classifyNotificationProviderFailure('resend', 403, body)` → `retryable=false` (403 is not 429/≥500), `reason='config'` (400/401/403 → config), `detail='resend_send_failed:403:config:<safe_code>'`. `ticket-confirmation-dispatch/index.ts:166-176` catches `ProviderSendError`, marks status `failed_terminal` because `retryable=false`. Retry loop stops. Sanitized; no provider message body leaks into `last_error`. |
| `ticket-confirmation-dispatch` provider classifier — Twilio 400 path | PASS | Same helper, `('twilio', 400, body)` → `retryable=false`, `reason='config'`, `detail='twilio_send_failed:400:config:<safe_code>'`. Same terminal handling. Operator gets a stable, sanitized class label they can debug against without secret exposure. |
| `ticket-confirmation-dispatch` retry classification — 429/5xx remain retryable | PASS | Line 139 of helper: `const retryable = status === 429 \|\| status >= 500;`. Confirmed: 429 and 500-class stay retryable (correct for transient provider issues). Deno test `notification provider failures classify auth/config errors as terminal` covers both paths — all 5 Deno tests pass after `--reload`. |
| `providerErrorName` sanitization — only safe codes survive | PASS | `supabase/functions/_shared/ticketCheckout.ts:118-132` regex `/^[a-zA-Z0-9_.:-]{1,80}$/` filters `name`/`code`/`type`/`error_code`. Any provider message body with PII, recipient addresses, phone numbers, or freeform text is rejected by the regex. Defense-in-depth: even if Resend returns a recipient address in `message`, the helper does NOT include `message` in the search — only the four code fields. |
| `ticket-checkout-create` Stripe wrap — `paymentIntents.create` is now inside try/catch | PASS | `supabase/functions/ticket-checkout-create/index.ts:155-189` shows `let stripe: ReturnType<typeof stripeTicketCheckout> \| null = null;` followed by `try { stripe = stripeTicketCheckout(); paymentIntent = await stripe.paymentIntents.create({...}); } catch (err) { ... return jsonResponse({error: 'payment_intent_create_failed', detail: failure.detail}, failure.httpStatus); }`. Bare HTTP 500 path eliminated. |
| `ticket-checkout-create` Stripe failure persists session as `failed` only when no PaymentIntent exists | PASS | Line 175-185: `.update({status: 'failed', failed_at, failure_reason: failure.detail, updated_at}).eq('id', checkoutSessionId).is('stripe_payment_intent_id', null)`. The `.is(... null)` predicate is the safety belt — if a PaymentIntent already exists on the session (e.g., a retry race), the session is NOT marked failed. Confirms idempotency-safety. |
| `ticket-checkout-create` failure HTTP status mapping | PASS | `classifyStripePaymentIntentCreateFailure(err)` returns `httpStatus`: 400→409 (request/account config, retry-not-helpful), 401/403→502 (Stripe key/capability config, upstream-bad-gateway), else 500 (truly unknown). Matches REST conventions: clients can decide retry vs fail-loud. |
| `ticket-checkout-create` failure detail does NOT leak Stripe message body | PASS | Helper at `_shared/ticketCheckout.ts:155-187` only extracts `statusCode` (number), `code` (regex-filtered), `type` (regex-filtered) from the error object. The Stripe `message` field is ignored. Even if Stripe returns a message containing a key fragment, the user-facing `detail` is a fixed-shape `stripe_payment_intent_create_failed:STATUS:reason[:code][:type]` — no key fragment leaks. |
| `cancelPaymentIntentIfClientAvailable` helper — null-safe + in-scope | PASS | `_shared/ticketCheckout.ts:195-202`: `if (stripe === null) return false;` guards the call. `ticket-checkout-create/index.ts:155` declares `let stripe: ReturnType<typeof stripeTicketCheckout> \| null = null;` BEFORE the create-try block. Line 205-211 wraps the helper call in `if (stripe !== null) { try { await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id); } catch (cancelError) { console.error(...) } }`. Belt-and-suspenders: if the persistence step fails after PaymentIntent creation, we attempt to cancel it on Stripe (best-effort), but a cancel failure does not surface as an extra error to the buyer. The previous draft of this report flagged a P2 here (`stripe` declared inside the try block was out of scope at the cancel call); the implementor has since hoisted the declaration. Verified directly. |
| Deno regression suite | PASS (after `--reload`) | `deno test --reload --allow-env --allow-read supabase/functions/_shared/__tests__/ticketCheckout.test.ts` → `5 passed \| 0 failed (4ms)`. Without `--reload`, an older cached compilation of the test file (with the prior brittle source-string-grep test) caused 1 failure on `paid checkout persist failure cancel uses an in-scope Stripe client` — see P3 below. The on-disk file has 5 tests including the new direct-helper test, and all pass with fresh compilation. |
| Deno typecheck on touched + adjacent Edge Functions | PASS | `deno check supabase/functions/{ticket-checkout-create,ticket-confirmation-dispatch,twilio-message-status,scan-ticket,stripe-webhook}/index.ts` → exit 0, no errors. |
| `mingla-business` ORCH-0777 gate (strict-grep + Jest + tsc) | PASS | `npm run test:orch-0777` → `ORCH-0777 production checkout guard passed.` then `Test Suites: 4 passed, 4 total / Tests: 12 passed, 12 total / Time: 5.18s`, then `tsc --noEmit` exit 0. The new Jest assertion `keeps wrong-event scans from violating the scan_events ticket-event trigger` (lines 126-132) and `keeps paid checkout and provider failures structured and non-secret` (lines 112-124) both pass. |
| `git diff --check` whitespace cleanliness | PASS | exit 0, no stdout. |
| Migration 17 not yet applied to remote | EXPECTED FAIL — operator-owned | `supabase migration list --linked \| tail -8`: `20260515000017 \| (empty Remote) \| 2026-05-15 00:00:17`. Operator must run `supabase db push --linked` to activate. This is the same staging discipline that gated migrations 15 and 16, both now applied. |
| `ticket-checkout-create` redeploy needed | EXPECTED FAIL — orchestrator-owned | `supabase functions list` shows `ticket-checkout-create` ACTIVE v8 deployed 2026-05-11 00:24:57Z. Code in tree is post-2026-05-11 with the new try/catch-around-Stripe + structured failure shape. Per Mingla operator/orchestrator deploy split memory, deploy is owned by Codex `orchestrator-mingla` after tester PASS. |
| `ticket-confirmation-dispatch` redeploy needed | EXPECTED FAIL — orchestrator-owned | `supabase functions list` shows `ticket-confirmation-dispatch` ACTIVE v7 deployed 2026-05-10 22:18:44Z. Code in tree imports `classifyNotificationProviderFailure` and `ProviderFailure` from the new shared module. Same deploy split — orchestrator owns. |
| `scan-ticket` redeploy NOT needed | PASS | scan-ticket already calls `supabase.rpc('biz_ticket_scan', {...with p_qr_token_pepper})` and returns `data` directly. Migration 17 changes only the SQL function body, not the RPC signature. Live `scan-ticket` v8 picks up the new wrong-event behavior automatically on the first scan after migration apply. |
| `twilio-message-status`, `stripe-webhook` redeploy NOT needed | PASS | No code changes to either function in this rework. Deno typecheck still clean. |
| Platform parity (iOS / Android / Web) | N/A WITH REASONING | No client UI surface changed. The four fixes are: (1) Edge Function `ticket-confirmation-dispatch` server-side error classification, (2) Edge Function `ticket-checkout-create` server-side Stripe error wrapping, (3) DB function `biz_ticket_scan` body change, (4) test files. None of these have a per-platform code path. The buyer-facing client (mingla-business buyer flow on iOS/Android/Web) and the scanner-facing client (mingla-business scanner UI) are unchanged — they consume the same JSON contracts. The platform-parity exercise belongs to the orchestrator-owned live-fire matrix rerun (`Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`) which must replay buyer + scanner flows on iOS Simulator + Android Emulator + Web after the deploy gate clears. |

## Constitutional Sweep (post-rework)

| Rule | Status | Evidence |
| --- | --- | --- |
| 1. No dead taps | N/A | No UI surfaces changed. |
| 2. One owner per truth | PASS | QR pepper still owned by Edge Function secret → service-role RPC argument. Stripe restricted key still scoped to `STRIPE_RAK_TICKET_CHECKOUT`. Notification status owned by `ticket_order_notifications` rows. Scan audit owned by `scan_events`. No new owners introduced. |
| 3. No silent failures | PASS — improvement | Bare HTTP 500 from Stripe paymentIntents.create is gone; replaced with structured `payment_intent_create_failed` + sanitized detail. Resend/Twilio non-2xx no longer hidden behind a generic "send failed"; classified into `config` vs `retryable` and surfaced as terminal vs retryable in the audit row. The cancel-orphan-PI silent-drop risk that the prior draft flagged is fixed: `stripe` is hoisted in scope, helper call goes through `cancelPaymentIntentIfClientAvailable` with null-guard. |
| 4. One key per entity | N/A | No React Query keys changed. |
| 5. Server state server-side | PASS | All changes are server-side. No Zustand persistence introduced. Buyer status token is still server-issued. |
| 6. Logout clears everything | N/A | No client persistence changed. |
| 7. Label temporary | N/A | No `[TRANSITIONAL]` markers needed; this is a final fix. |
| 8. Subtract before adding | PASS | Old wrong-event INSERT is replaced (CREATE OR REPLACE), not duplicated. Old bare HTTP 500 path is removed, not layered. |
| 9. No fabricated data | PASS | Provider failure `safe_code` is regex-filtered from real provider response fields; nothing is invented when the provider does not return a code. Stripe failure `code`/`type` only included if present and regex-safe. |
| 10. Currency-aware | N/A | Currency handling unchanged in this rework. |
| 11. One auth instance | N/A | Auth flow unchanged. |
| 12. Validate at right time | PASS | Stripe failure persistence happens AFTER the failed RPC, at the moment of the failed Stripe call. Wrong-event audit row written at scan time, not deferred. |
| 13. Exclusion consistency | PASS | The CASE branch in migration 17 applies symmetrically — wrong-event picks `v_ticket.event_id`, all other results pick `p_event_id`. No asymmetric escape hatch. |
| 14. Persisted-state startup | N/A | No persisted-state surface. |

## Independent Verification (Production DB Probes — Read-Only)

I ran four read-only probes against the live production DB (`gqnoajqerqhnvulmnyvv`) via the Supabase MCP tool. All probes ran in the default read-only Postgres transaction; no live mutation. Probes:

### Probe 1 — Confirm current `biz_ticket_scan` signature

```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc
 WHERE proname IN ('biz_scan_events_enforce_ticket_event','biz_ticket_scan')
   AND pronamespace = 'public'::regnamespace
 ORDER BY proname;
```

Result:

- `biz_scan_events_enforce_ticket_event` (no args) — trigger function, exists.
- `biz_ticket_scan(p_event_id uuid, p_qr_payload text, p_scanner_user_id uuid, p_qr_token_pepper text)` — exists with the migration-16 signature.

Interpretation: signature matches what migration 17 expects to `CREATE OR REPLACE` over. No collision, no broken dependent. `scan-ticket` Edge Function v8 (which calls this RPC with `p_qr_token_pepper`) keeps working post-apply because the signature is identical.

### Probe 2 — Confirm trigger constraint matches the failure mode

```sql
SELECT tgname, pg_get_triggerdef(t.oid) AS trigger_def,
       (pg_get_functiondef(p.oid) ILIKE '%scan_events.event_id must match tickets.event_id%') AS enforces_match
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE c.relname = 'scan_events' AND NOT t.tgisinternal
 ORDER BY tgname;
```

Result:

- `trg_scan_events_block_update` — DELETE/UPDATE block (not relevant here).
- `trg_scan_events_ticket_event` — `BEFORE INSERT OR UPDATE`, executes `biz_scan_events_enforce_ticket_event()`, body contains `RAISE EXCEPTION 'scan_events.event_id must match tickets.event_id'` → `enforces_match = true`.

Interpretation: trigger fires on every INSERT and rejects when `NEW.event_id ≠ tickets.event_id`. This is exactly the constraint the live-fire matrix evidence cited as the cause of `scan_failed:scan_events.event_id must match tickets.event_id`. The migration's CASE branch satisfies this constraint by inserting `v_ticket.event_id` for wrong-event.

### Probe 3 — Confirm live `biz_ticket_scan` body is the buggy pre-17 version

```sql
WITH src AS (SELECT pg_get_functiondef(oid) AS def
               FROM pg_proc
              WHERE proname='biz_ticket_scan'
                AND pronamespace='public'::regnamespace)
SELECT position('INSERT INTO public.scan_events' in def) AS insert_offset,
       substring(def from position('INSERT INTO public.scan_events' in def) for 600) AS insert_block
  FROM src;
```

Result (relevant fragment):

```
INSERT INTO public.scan_events (
  ticket_id, event_id, scanner_user_id, scan_result, client_offline,
  synced_at, metadata
) VALUES (
  v_ticket_id, p_event_id, p_scanner_user_id, v_scan_result, false, now(),
  jsonb_build_object('source', 'scan-ticket', 'buyerName', ..., 'ticketName', ...)
)
```

Interpretation: live function inserts `event_id = p_event_id` unconditionally — the exact pre-17 buggy shape. There is no `v_scan_event_id := CASE` branch and no `requestedEventId` metadata. Confirms the live-fire FAIL evidence and confirms the migration is necessary.

### Probe 4 — Confirm `ticket_checkout_sessions` has the columns the new failure-handling path writes

```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='ticket_checkout_sessions'
   AND column_name IN ('status','failed_at','failure_reason','stripe_payment_intent_id','updated_at')
 ORDER BY column_name;
```

Result:

```
failed_at                  | timestamp with time zone | YES
failure_reason             | text                     | YES
status                     | text                     | NO
stripe_payment_intent_id   | text                     | YES
updated_at                 | timestamp with time zone | NO
```

Interpretation: every column written by `ticket-checkout-create/index.ts:175-185` already exists on remote with the right nullability. No additional schema migration required for the paid-checkout structured-failure path; this is purely an Edge Function code change that lands on already-deployed schema (migration 13 + 16 already applied).

## Live-Fire Slice Verdicts

| Slice | Pre-rework state | Post-rework code state | Live-fire ready? | Blocker |
| --- | --- | --- | --- | --- |
| Resend buyer email | `failed_retryable` `resend_send_failed:403` with attempt_count incrementing | Provider classifier maps 400/401/403 → `failed_terminal:resend_send_failed:STATUS:config[:safe_code]`; retry loop stops; sanitized | YES (post-redeploy) | (a) `ticket-confirmation-dispatch` redeploy, (b) operator-owned Resend config repair (verify `RESEND_API_KEY` belongs to the right Resend account, verify `RESEND_TICKET_FROM` is a verified sender/domain). |
| Twilio buyer SMS | `failed_retryable` `twilio_send_failed:400` with attempt_count incrementing | Same provider classifier; 400/401/403 → `failed_terminal:twilio_send_failed:STATUS:config[:safe_code]`; sanitized | YES (post-redeploy) | (a) `ticket-confirmation-dispatch` redeploy, (b) operator-owned Twilio config repair (Messaging Service must have a sender pool with at least one production-capable sender for the buyer destination country; secrets must come from the same Twilio account). |
| Paid checkout HTTP 500 / no `stripe_payment_intent_id` persisted | Bare non-JSON HTTP 500; sessions stuck `requires_payment` with no PaymentIntent | Stripe `paymentIntents.create` wrapped in try/catch; failure persists `status='failed'` (only when no PI exists) with sanitized `failure_reason`; returns structured JSON `payment_intent_create_failed` with appropriate HTTP status (400→409, 401/403→502, else 500) | YES (post-redeploy) | (a) `ticket-checkout-create` redeploy, (b) operator-owned Stripe config verification on the connected account: `STRIPE_RAK_TICKET_CHECKOUT` must allow PaymentIntents create + transfer_data destination; the connected account must be charge-ready in the event currency. The redeployed function will surface the actual root cause class via the structured detail. |
| Scanner wrong-event HTTP 400 `scan_failed` | RPC raised `scan_events.event_id must match tickets.event_id` because INSERT used `p_event_id` for both event_id and the trigger's `v_ticket_event` lookup | Migration 17 introduces `v_scan_event_id := CASE WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id ELSE p_event_id END;` so the trigger is satisfied; `requestedEventId` metadata preserves audit trail; RPC returns HTTP 200 with `{result: "wrong_event", ...}` | YES (post-migration-push) | (a) `supabase db push --linked` to apply migration 17. `scan-ticket` Edge Function v8 does NOT need redeploy because the RPC signature is unchanged. |

## Net-New Findings

### P2 — Implementor regression test report under-counts the Deno suite

Evidence: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md` Section 5 line 51:

```
| Deno helper tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | PASS: 4 passed, 0 failed. |
```

Actual file `supabase/functions/_shared/__tests__/ticketCheckout.test.ts` has **5** Deno tests:

1. `qrTokenPepper rejects missing, fallback, and short values`
2. `qrTokenPepper returns a trimmed non-default secret without logging it`
3. `notification provider failures classify auth/config errors as terminal without sensitive payloads`
4. `Stripe PaymentIntent create failures map to structured checkout errors`
5. `paid checkout persist failure cancel uses the provided nullable Stripe client`

Re-running locally with `deno test --reload`: `5 passed | 0 failed (4ms)`.

Interpretation: the implementor likely ran the suite at a point when only 4 tests existed, then added the 5th test (the helper-direct test for `cancelPaymentIntentIfClientAvailable`) and refactored `ticket-checkout-create` to use the helper, but did not re-run the full suite before writing the report. The actual code state passes — this is a report-accuracy issue, not a code issue.

Real-world impact: low for this rework (suite still passes), but undermines the discipline that makes implementor reports trustable. If the implementor missed a `--reload` and only re-ran with cache, the cached-test path would have shown a false PASS for the OLD test name (`paid checkout persist failure cancel uses an in-scope Stripe client`) which I observed when I first ran without `--reload` and got 1 FAIL.

Recommendation: future implementor reports should always run `deno test --reload --allow-env --allow-read <path>` for any file that has been edited within the same dispatch and whose test counterpart has been edited. Add a one-line implementor checklist item: "If you edited a Deno test file, run with `--reload`."

### P3 — Deno cache hygiene risk in retest discipline

Evidence: My first `deno test` run (without `--reload`) produced a confusing 1-of-5 FAIL on the test name `paid checkout persist failure cancel uses an in-scope Stripe client` — that test name is NOT in the on-disk file (which has `... uses the provided nullable Stripe client`). Deno had cached an older compilation from a prior session and was running the stale brittle source-string-grep test against the new source code, which had been refactored to call `cancelPaymentIntentIfClientAvailable` instead of `stripe.paymentIntents.cancel(...)` directly.

Real-world impact: low for this report (resolved with `--reload`), but the same trap can fool a future tester or an implementor running gates on a long-lived dev box.

Recommendation: this is a hardening note for the implementor and tester skills' "verification gates" sections — add `--reload` to the canonical Deno test command for any file that has been edited within the dispatch.

### P3 — Pre-existing `not_found` audit-row event_id selection (out of scope)

Evidence: in both migration 16 and migration 17, the audit-row INSERT runs whenever `v_ticket_id IS NOT NULL`. `v_ticket_id` is set whenever the QR payload regex matches, regardless of whether the ticket actually exists in the DB. If a scanner submits a syntactically-valid QR payload referencing a non-existent ticket, the function sets `v_scan_result := 'not_found'`, then attempts `INSERT INTO scan_events ... VALUES (v_ticket_id, p_event_id, ...)`. The trigger then looks up `tickets.event_id WHERE id = v_ticket_id`, finds nothing, and raises `scan_events: ticket not found`.

This was true on migration 16 and remains true on migration 17 — the wrong-event CASE branch only handles the wrong-event case, not the not_found case. The not_found path still raises the `scan_events: ticket not found` exception and the Edge Function returns HTTP 400 `scan_failed` instead of HTTP 200 with `{result: "not_found", ...}`.

Real-world impact: low. A real scanner against a real event should never see a not-found ticket-id-shaped QR. This only triggers if a malicious actor crafts a QR payload with a UUID that doesn't exist in `tickets`. The current behavior fails closed (rejects the scan), which is acceptable security posture even if the contract is technically inconsistent with the wrong-event path now.

Recommendation: out of scope for this rework. File a follow-up ORCH ticket if a future test exercises the not_found path against the live RPC and expects a clean `{result: "not_found"}` response instead of HTTP 400.

### P4 — Praise: minimum-correct-change discipline

The implementor stayed inside the four named slices. No scanner unification, no organizer-truth refactor, no buyer-flow rework. The CASE branch in migration 17 is the smallest possible correct fix for the trigger constraint. The Stripe try/catch wrap is the smallest possible correct fix for the bare HTTP 500. The provider classifier is the smallest reusable abstraction for Resend + Twilio. This matches the user's "smallest safe code" preference codified in feedback memory.

### P4 — Praise: sanitization defense-in-depth

The provider error-name regex (`/^[a-zA-Z0-9_.:-]{1,80}$/`) is conservative — it does not accept `@`, spaces, parens, or quotes, so a provider response field containing recipient/PII text is filtered out. Combined with the explicit field allowlist (only `name`/`code`/`type`/`error_code`, never `message`), the audit-row `last_error` cannot leak buyer PII even on a malformed provider response. Same shape on the Stripe classifier — only `code` and `type` survive, never `message`.

### P4 — Praise: idempotency-safety belt on the failure persistence

`.update({status: 'failed', ...}).eq('id', sessionId).is('stripe_payment_intent_id', null)` — the `.is(... null)` predicate prevents the failure path from corrupting a session that has already advanced to `processing_payment`. If the Stripe call somehow fails after returning a PaymentIntent (a race where the SDK throws after the network hop), the session stays in its current good state. This is the kind of detail that prevents the next live-fire run from producing a false "session corrupted" symptom on top of the real Stripe error.

## Hard-Guard Compliance Statement

- No production secret values were read, printed, copied, or set during this retest.
- No pepper values, pepper digests, buyer tokens, client secrets, QR payloads, full phone numbers, full provider SIDs, or API keys appear in this report or in the Mingla_Artifacts diff.
- No DB-level pepper / GUC route was reopened. Migration 17 has zero `current_setting`, `ALTER DATABASE`, or `pg_reload_conf` matches. The bounded service-role RPC argument from migration 16 is preserved.
- `STRIPE_RAK_TICKET_CHECKOUT` isolation is preserved — no fallback to broad `STRIPE_SECRET_KEY` introduced.
- B2 QR credential RLS is preserved — `git diff HEAD -- supabase/migrations/20260515000015_*.sql` is empty.
- No tests were weakened, deleted, or relaxed. The Deno test refactor (source-string-grep → direct helper test) is a strictness improvement.
- No live-fire was executed. No production migration was applied. No Edge Function was deployed.
- All four DB probes were read-only. No mutation, no transaction-rollback simulation needed (default Management API session is read-only).

## Required Follow-Up Before CLOSE

The orchestrator must coordinate the following operator-owned and orchestrator-owned actions, in this order:

1. **Operator** — `supabase db push --linked` from main to apply migration `20260515000017_orch_0777_scan_wrong_event_result.sql` to the remote DB. This activates the wrong-event scanner fix.
2. **Orchestrator (Codex `orchestrator-mingla`)** — `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` to ship the structured Stripe failure handling. Verify version bump via `mcp__supabase__list_edge_functions` (expect v9).
3. **Orchestrator (Codex `orchestrator-mingla`)** — `supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv` to ship the sanitized provider classifier. Verify version bump (expect v8).
4. **Operator** — Resend config repair: verify `RESEND_API_KEY` belongs to the intended Resend account/environment with send permission, and `RESEND_TICKET_FROM` is a verified sender/domain accepted by that account. Do not paste API keys, full recipient data, or provider-sensitive payloads into artifacts.
5. **Operator** — Twilio config repair: verify `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` belong to the same Twilio account/environment, and the Messaging Service has at least one production-capable sender in its sender pool that can message the buyer destination country. Do not artifact full phone numbers, auth tokens, or full SIDs.
6. **Operator** — Stripe Connect verification on the test event's connected account: confirm `STRIPE_RAK_TICKET_CHECKOUT` can create PaymentIntents with `automatic_payment_methods` and `transfer_data[destination]` for the selected connected account and event currency. The redeployed function will surface the structured detail if it cannot.
7. **Orchestrator (Codex `orchestrator-mingla`)** — rerun the live-fire matrix `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` and replace every FAIL row with concrete evidence. The four expected outcomes:
   - Email row → `sent` with sanitized provider message id, `sent_at` populated.
   - SMS row → `sent` with sanitized provider message id, `sent_at` populated. (Twilio `delivered_at` populates later via status callback.)
   - Paid checkout → either `stripe_payment_intent_id` persisted and PaymentSheet/finalization works, OR sanitized structured `payment_intent_create_failed` JSON identifying the actual config class.
   - Wrong-event scanner → HTTP 200 `{result: "wrong_event", ...}` with audit row written under `event_id = ticket.event_id`, `metadata.requestedEventId = scanned event_id`.
8. **Orchestrator (Codex `orchestrator-mingla`)** — must also exercise platform parity per the post-2026-05-10 directive: live-fire the buyer email confirmation and scanner flow against iOS Simulator, Android Emulator, and the Web buyer surface (`mingla-business` web export). N/A on this code-only QA pass; required on the full live-fire matrix rerun.
9. **Orchestrator (Codex `orchestrator-mingla`)** — only after every live-fire row is concrete PASS, route to CLOSE ORCH-0777.

## Discoveries for Orchestrator

- The current rework's deploy needs are exactly two Edge Functions (`ticket-checkout-create`, `ticket-confirmation-dispatch`) and one DB migration push (`20260515000017`). `scan-ticket`, `twilio-message-status`, and `stripe-webhook` do NOT need redeploy in this cycle.
- The pre-existing `not_found` audit-row event_id selection bug (P3 above) is independent of this rework. If a future live-fire scenario crafts a not-found-shaped QR against the scanner, the response will be HTTP 400 `scan_failed` with detail `scan_events: ticket not found`, not HTTP 200 `{result: "not_found"}`. File a separate ORCH if that surfaces.
- Implementor report accuracy: the report under-counted the Deno suite by one (P2 above). Worth flagging back to Codex `implementor-mingla` as a process improvement — always re-run with `--reload` after final edits.

## Final Verdict

**CONDITIONAL PASS** — ORCH-0777 live-fire rework is implementation-complete and contract-correct for all four failing slices. The code changes are minimum-correct, sanitization is defense-in-depth, hard guards held, and no scope was broadened. Static gates (Deno test 5/5 with `--reload`, Deno typecheck on 5 functions, mingla-business `npm run test:orch-0777` 4 suites / 12 tests / tsc clean, `git diff --check` clean) all pass. Independent live-DB read-only probes confirm: (1) the scanner trigger constraint exactly matches the failure mode, (2) the live RPC body is the buggy pre-17 version that the migration replaces, (3) all `ticket_checkout_sessions` columns the new code writes already exist on remote, (4) no schema migration beyond migration 17 is required.

The verdict is **CONDITIONAL** because close-readiness depends on three operator/orchestrator-owned actions outside this code change: (a) `supabase db push --linked` for migration 17, (b) `supabase functions deploy` for the two changed Edge Functions, (c) operator-owned provider-config repair on Resend, Twilio, and the Stripe Connect destination account. After those are complete, the orchestrator must rerun `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` with iOS + Android + Web parity for the buyer/scanner surfaces and replace every FAIL row with concrete evidence. CLOSE only after the full live-fire matrix returns PASS.

If the post-deploy live-fire surfaces a new failure class (e.g., the structured Stripe detail reveals an unanticipated config issue), route the failing slice back to Codex `implementor-mingla` for narrow rework. Do not weaken or expand this rework's scope.

---

NEXT HANDOFF — paste into Codex `orchestrator-mingla`:

ORCH-0777 live-fire rework retest passes the code contract with verdict CONDITIONAL PASS (`Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`). The implementor's four fixes are correct: provider classifier in `supabase/functions/_shared/ticketCheckout.ts` + `supabase/functions/ticket-confirmation-dispatch/index.ts`, Stripe try/catch wrap in `supabase/functions/ticket-checkout-create/index.ts`, and DB migration `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql` for wrong-event scans. All static gates green (Deno 5/5 with --reload, Deno typecheck on 5 functions, mingla-business test:orch-0777 4 suites / 12 tests / tsc clean, git diff --check clean), and live-DB read-only probes confirm the trigger constraint and pre-17 buggy body. Inputs: this QA report, the implementor return `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`, the prior live-fire matrix `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`. Hard guards: do not expose secrets, pepper values/digests, buyer tokens, client secrets, QR payloads, full phone numbers, full provider SIDs, or API keys; do not reopen DB-level pepper/GUC; do not weaken `STRIPE_RAK_TICKET_CHECKOUT` isolation; do not weaken or rollback B2 RLS. Required orchestrator actions in order: (1) request operator `supabase db push --linked` to apply `20260515000017`; (2) `supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` and verify v9 via `mcp__supabase__list_edge_functions`; (3) `supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv` and verify v8; (4) request operator Resend / Twilio / Stripe Connect destination-account config repair per the Required Follow-Up section; (5) rerun `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` with concrete iOS Simulator + Android Emulator + Web buyer/scanner evidence replacing every FAIL row. Expected output: updated live-fire matrix report. Downstream routing: on full live-fire PASS → CLOSE ORCH-0777; on any failing slice → back to Codex `implementor-mingla` for the smallest correct narrow fix tied to the failing scenario; do not broaden scope.
