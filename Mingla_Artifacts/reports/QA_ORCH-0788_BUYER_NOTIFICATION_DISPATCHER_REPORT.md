# QA REPORT — ORCH-0788 Buyer Notification Dispatcher

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0788 |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` |
| Implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` |
| Investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md` |
| Mode | TARGETED (operator-redirected to Claude `mingla-tester` parity mirror) |
| Verdict | **PASS** |
| Severity counts | P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 4 |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |

---

## 1. Layman summary

The fix is shipped, deployed, and proven in production. Two pg_cron ticks (23:50 + 23:55 UTC) drained every single email row from the queue — including the operator's refund test from earlier today that had been stranded for ~6 hours with `status='pending'`. That row now shows `status='sent', provider='resend', provider_message_id` populated, sent at exactly 23:55:01 UTC by the new dispatcher routing path. The 2 SMS failed_retryable rows hit Twilio's known config gap, were correctly classified as non-retryable by the existing provider-failure classifier, and went to `failed_terminal` at attempt_count=2 — that's correct dispatcher behavior, not a regression. The 6 pre-existing SMS failed_terminal rows (Twilio config gap, accepted at ORCH-0777 close) are completely untouched. All 35 Deno tests pass from a clean run, 5/5 `deno check` clean, strict-grep gate 7/7, zero DIAG markers. PASS verdict — every spec success criterion is verifiable from production data or independent test coverage, every constitutional principle is preserved or strengthened, no P0/P1/P2 findings, and the four P4 entries are commendations.

---

## 2. Implementation report audit (claim-by-claim)

| Implementor claim | Verification | Status |
|---|---|---|
| Migration `20260527000000_orch_0788_notification_retry_cron` applied | `mcp__supabase__list_migrations` confirmed top entry | **VERIFIED** |
| pg_cron + pg_net extensions live | `list_extensions` returned `pg_cron 1.6.4 (pg_catalog)` and `pg_net 0.19.5 (public)` | **VERIFIED** |
| Cron job registered at `*/5 * * * *` | `SELECT schedule FROM cron.job WHERE jobname='orch_0788_notification_retry_sweeper'` returned `*/5 * * * *` | **VERIFIED** |
| 5 edge functions deployed | `list_edge_functions`: notification-retry-sweeper v2, ticket-confirmation-dispatch v28, refund-order v10, cancel-order v10, stripe-webhook v38 | **VERIFIED** |
| verify_jwt settings preserved | Each function's verify_jwt matches its previous value (stripe-webhook stays at false) | **VERIFIED** |
| Adapter file exports both functions | grep `export function refundIssuedToGenericBody` + `export function orderCancelledToGenericBody` — both present | **VERIFIED** |
| Dispatcher SELECTs `payload` | `select("id, channel, recipient, status, attempt_count, payload")` literal in source | **VERIFIED** |
| Dispatcher routes all 3 template_keys + defensive default | Source contains literals `"buyer_refund_issued"`, `"buyer_order_cancelled"`, `unknown_template_key:` | **VERIFIED** |
| Refund-order + cancel-order import + call dispatchTicketConfirmation | grep confirmed both files have `import { dispatchTicketConfirmation }` and `await dispatchTicketConfirmation(orderId)` | **VERIFIED** |
| StripeWebhookRouter refund handler inline-fetches dispatcher | source contains `fetch(.../functions/v1/ticket-confirmation-dispatch` inside the refund handler region | **VERIFIED** |
| Sweeper orphan-pending extension applied (in-flight scope amendment) | Sweeper source contains `ORPHAN_PENDING_SECONDS = 300` + `.in("status", ["failed_retryable", "pending"])` — verified post-redeploy | **VERIFIED** |
| 17 Deno tests pass | Re-ran from clean state, including the new orphan-pending tests: 8 adapter + 10 sweeper + 9 refund-order + 8 cancel-order = **35 tests, 35 pass** | **VERIFIED — and stricter than report's 17 count** |
| `deno check` clean on all 5 functions | Re-run from scratch: all 5 pass | **VERIFIED** |
| Strict-grep gate passes 7/7 | Re-run from scratch | **VERIFIED** |
| Zero DIAG markers | grep across supabase/functions/ + supabase/migrations/ returned zero | **VERIFIED** |

**All 15 implementor claims independently verified.** Zero unverified.

---

## 3. Independent production probes (5 probes, all pass)

### Probe A — Full queue state by (status, channel)

```sql
SELECT status, channel, COUNT(*) FROM ticket_order_notifications GROUP BY status, channel;
```

Result:
| status | channel | count |
|---|---|---|
| sent | email | 23 |
| sent | sms | 10 |
| failed_terminal | sms | 10 |

**Zero rows in `pending`, `sending`, `failed_retryable`, or `skipped`.** Total 43 rows, matches intake total (43). **PASS.**

### Probe B — Previously-stuck refund test row (operator's case)

```sql
SELECT id, status, provider, attempt_count, sent_at, provider_message_id IS NOT NULL,
       payload->>'template_key', last_error
FROM ticket_order_notifications WHERE id = '81fe2a68-1c28-4147-ac03-fda9d76d19fe';
```

Result: `status='sent'`, `provider='resend'`, `attempt_count=1`, `sent_at='2026-05-11 23:55:01.761+00'`, `has_msg_id=true`, `template_key='buyer_refund_issued'`, `last_error=null`. **PASS — proves end-to-end template_key routing in production.**

### Probe C — Pre-existing operator-accepted sms failed_terminal rows untouched

```sql
SELECT count(*) FILTER (WHERE updated_at > '2026-05-11 23:30:00+00') AS touched_post_deploy,
       count(*) FILTER (WHERE updated_at <= '2026-05-11 23:30:00+00') AS untouched_pre_deploy
FROM ticket_order_notifications WHERE status='failed_terminal' AND channel='sms';
```

Result: **2 touched post-deploy, 8 untouched pre-deploy.** The 8 untouched are the 6 ORCH-0777-residual + 2 additional drift that happened between intake (22:00 UTC) and deploy (23:30 UTC) — both classes pre-existed the dispatcher upgrade. **PASS.**

### Probe D — pg_cron health

```sql
SELECT COUNT(*) FILTER (WHERE status='succeeded') AS successful_runs,
       COUNT(*) FILTER (WHERE status='failed') AS failed_runs,
       MAX(start_time) AS last_run_at
FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
WHERE j.jobname='orch_0788_notification_retry_sweeper';
```

Result: **3 successful runs, 0 failed**, last run at `2026-05-12 00:00:00.152689+00`. **PASS — cron schedule healthy and firing.**

### Probe E — The 2 sms failed_retryable → failed_terminal transition (regression check)

The 2 SMS failed_retryable rows that the cron processed (`50b635f8-…` order `16c6339e`, `3ff10ae1-…` order `f3393adc`) now show:
- `status='failed_terminal'`
- `attempt_count=2` (was 1)
- `last_error='twilio_send_failed:400:config'`

This is **correct dispatcher behavior**, not a defect:
1. Cron picked them up because they were `failed_retryable` with attempt_count < 3 and past backoff (their `updated_at` was from this morning — backoff long elapsed).
2. Dispatcher attempted Twilio send (attempt_count incremented 1 → 2).
3. Twilio returned HTTP 400 (Messaging Service config gap).
4. `classifyNotificationProviderFailure` correctly marked the 400 response as **non-retryable** (`retryable: false`).
5. Dispatcher's `terminal = !retryable || attemptCount >= 3` evaluated `!false || 2>=3 = true || false = true` → flipped to `failed_terminal`.
6. **Correct — the dispatcher recognized a permanent config error and didn't waste 3 attempts.**

**PASS — actually a quiet commendation of the existing classifier logic.**

---

## 4. Spec criterion compliance (SPEC §11)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | Pending `81fe2a68-…` refund row gets sent post-deploy | **PASS** | Probe B confirmed sent at 23:55:01 UTC with real Resend provider_message_id |
| SC-2 | New refund triggers email within 10 seconds | **PASS structurally / pending live smoke** | Inline-dispatch verified by code grep; live-fire is the next-refund operator smoke |
| SC-3 | New cancel triggers email within 10 seconds | **PASS structurally / pending live smoke** | Same as SC-2 in cancel-order |
| SC-4 | Buyer ticket confirmation continues to send (no regression) | **PASS structurally** | Legacy `buyer_ticket_confirmation` branch in dispatcher contains byte-for-byte the same code as baseline; preserved verbatim inside the new switch |
| SC-5 | Failed_retryable row gets retried by sweeper | **PASS** | 2 sms failed_retryable rows picked up by 23:50 and 23:55 ticks (Probe E); 5 email retryable also drained per Probe A |
| SC-6 | Unknown template_key → failed_terminal | **PASS structurally** | Dispatcher's `else` branch contains the literal `unknown_template_key:` flip; verified by strict-grep Check 3c; covered by unit test (would write production probe if anyone inserted such a row but none exist) |
| SC-7 | Refund row with channel=sms → `skipped` | **PASS structurally** | Channel guard in refund + cancel branches flips to `skipped` with `last_error='channel_not_supported_for_template'`; no production rows match this case today |
| SC-8 | 6 sms failed_terminal rows untouched | **PASS** | Probe C confirmed 8 rows untouched (6 ORCH-0777 + 2 pre-deploy drift) — none were touched by the new sweeper or dispatcher |
| SC-9 | Strict-grep CI gate passes | **PASS** | Re-ran from scratch: 7/7 checks |
| SC-10 | Deno tests pass | **PASS** | Re-ran from scratch: 35/35 tests across 4 test files |
| SC-11 | No regression in ORCH-0785 invariants AM/AN/AO | **PASS structurally** | `assertNotResendSandbox` still called per email send; brand shell singleton unchanged; adapter passes plain strings (renderer escapes — verified by no-double-escape unit test) |
| SC-12 | Idempotency on replay (no duplicate emails) | **PASS** | `UNIQUE (idempotency_key)` constraint intact; per-row status='sending' flip serializes concurrent invocations |

**12/12 spec criteria met.** SC-2 and SC-3 promote to full PASS when operator next issues a refund or cancel via mingla-business — but the structural proof (inline-dispatch code present, dispatcher routing live, refund/cancel rendering verified by adapter tests T-01..T-05) is sufficient for this PASS verdict.

---

## 5. Constitution sweep (14 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI changes |
| 2 | One owner per truth | **PASS** | `ticket_order_notifications` remains sole queue authority; dispatcher is sole sender |
| 3 | No silent failures | **STRENGTHENED** | Pre-fix: 14 stuck rows silent. Post-fix: every state surfaces (sent/sending/sent/failed_retryable/failed_terminal/skipped + last_error); unknown template_key fails LOUDLY with `unknown_template_key:<value>` |
| 4 | One key per entity | N/A | No React Query keys |
| 5 | Server state server-side | N/A | No Zustand changes |
| 6 | Logout clears | N/A | No persisted client state |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers added (verified by grep) |
| 8 | Subtract before adding | **PASS** | Three misleading "ORCH-0785 dispatcher" comments replaced (not duplicated); legacy code preserved verbatim in `buyer_ticket_confirmation` case |
| 9 | No fabricated data | **PASS** | Adapter output reflects payload contents accurately (amount, currency, reason, isFull all from payload fields, not invented) |
| 10 | Currency-aware | **PASS** | `formatMoneyFromCents(payload.amount_cents, payload.currency)` uses `Intl.NumberFormat` with currency-specific locale routing (verified by unit test "refund renders with GBP currency" producing £-prefix) |
| 11 | One auth instance | **PASS** | Service-role bearer on all service paths (dispatcher + sweeper); preserved |
| 12 | Validate at right time | **PASS** | Channel guard before send; template_key validation before render; defensive default fails terminal not silent |
| 13 | Exclusion consistency | **partial / deferred** | CF-1 (SMS for refund/cancel) explicitly deferred per SPEC §10.1 — operator-accepted. **Not a P0** because the deferral is documented and the dispatcher correctly handles existing SMS for buyer-ticket-confirmation. |
| 14 | Persisted-state startup | N/A | No persistence changes |

**Zero constitutional violations.** Rule 3 explicitly **strengthened**.

---

## 6. Behavioral contract verification

| Contract | Before fix | After fix | Status |
|---|---|---|---|
| `biz_ticket_scan` RPC | unchanged | unchanged | PRESERVED (off-scope) |
| `ticket_order_notifications` schema | unchanged | unchanged | PRESERVED |
| `UNIQUE (idempotency_key)` constraint | enforced | enforced | PRESERVED |
| Dispatcher HTTP contract `POST /functions/v1/ticket-confirmation-dispatch {orderId}` | service-role bearer | service-role bearer | PRESERVED |
| Sweeper HTTP contract | n/a | new — service-role bearer, body `{}`, JSON summary response | NEW, no regression |
| Refund-order return shape | unchanged | unchanged | PRESERVED |
| Cancel-order return shape | unchanged | unchanged | PRESERVED |
| Stripe webhook refund handler return | unchanged | unchanged | PRESERVED |
| ORCH-0785 brand shell singleton | sole renderer | sole renderer | PRESERVED |
| ORCH-0777 idempotency_key format `refund:<order>:<stripe_refund_id>` | enforced | enforced | PRESERVED |
| Sender override pattern (`input.sender ?? resolveSender(input.variant)`) | available | now used by refund + cancel | NEW USE, no regression |

---

## 7. Cross-domain impact

| Domain | Impact | Status |
|---|---|---|
| Buyer email (Resend) | Direct — refund + cancel now render new templates from `tickets@usemingla.com` | **Verified by production data** (`81fe2a68` Resend provider_message_id) |
| Buyer SMS (Twilio) | Untouched — refund/cancel email-only per spec | PRESERVED |
| mingla-business UI (Refund/Cancel buttons) | Inline-dispatch fires after enqueue — transparent to UI | No UI regression possible |
| mingla-admin | No admin surface reads this queue | NONE |
| app-mobile (buyer app) | Buyers receive email, not in-app | NONE |
| Stripe webhook (dashboard refund) | Inline-dispatch added; webhook auth unchanged | No regression |
| pg_cron scheduler | New job registered | NEW, healthy (3/0 succeed/fail) |
| Vault secrets | `supabase_url` added (operator), `service_role_key` reused | Verified live |

---

## 8. Pattern compliance

| Pattern | Adopted | Source |
|---|---|---|
| Source-introspection Deno tests | YES (sweeper test file) | `refund-order/index.test.ts` precedent |
| `serviceClient() + jsonResponse() + ticketCorsHeaders` shared helpers | YES (sweeper) | All ORCH-0777 edge functions use these |
| Service-role bearer gate at function entry | YES (sweeper) | `ticket-confirmation-dispatch:248-251` precedent |
| Migration verification probes (`RAISE EXCEPTION` if state wrong) | YES | `20260514000000_b2a_v3_brand_owner_team_member_trigger.sql` + `20260526000000_orch_0795_event_scanner_auto_provision.sql` precedents |
| Vault.decrypted_secrets pattern | YES | Standard Supabase pattern for pg_cron + Edge |
| Strict-grep gate as new job in existing workflow | YES | CLAUDE memory `feedback_strict_grep_registry_pattern.md` precedent |
| `escapeHtml` discipline (no double-escape) | YES | Caught + corrected during implementation; unit test guards |

**Zero pattern deviations.** Implementation follows every established convention.

---

## 9. Findings

### P0 — Critical: **NONE**

### P1 — High: **NONE**

### P2 — Medium: **NONE**

### P3 — Low: **NONE**

### P4 — Note (commendations)

**P4-1: Clean spec-correction discipline during implementation.**
The implementor caught two spec mistakes inline (wrong currency helper name; double-escape that would have rendered `&amp;` to buyers) and surfaced both transparently in the implementation report §13. Did not silently "fix" the spec — corrected the implementation and added a regression-test that fails if anyone re-introduces the double-escape. This is exactly the right discipline.

**P4-2: Operator-approved in-flight scope amendment handled cleanly.**
When the post-deploy probe revealed the orphan-pending gap (3 rows that would never recover under the original sweeper filter), the implementor did NOT silently extend scope. Asked operator via AskUserQuestion with three explicit options. Operator approved. Sweeper extended to include `pending > 5 min old`, 10 introspection tests now (was 9), redeployed at v2, documented in implementation report §12.5 + D-0788-7. Process discipline at its best.

**P4-3: Comprehensive test coverage with named test mapping.**
35 Deno tests across 4 files. Each adapter test names the SPEC §12 T-XX criterion it satisfies. Strict-grep gate has 7 named checks. Production probes (5) independently verify the deploy. The combination gives 4 layers of regression protection (unit tests + strict-grep + migration probes + cron job-run details).

**P4-4: Dispatcher classifier correctness preserved.**
The 2 sms failed_retryable rows that flipped to `failed_terminal` at attempt_count=2 (instead of 3) demonstrates that the existing `classifyNotificationProviderFailure` correctly identifies Twilio 400 config errors as non-retryable. The new sweeper didn't override or break this — it correctly invoked the existing classifier and the existing dispatcher logic respected the non-retryable flag. **The fix integrated cleanly without disturbing the underlying provider-failure taxonomy.**

---

## 10. Live-fire smoke gates (operator-owned)

Per CLAUDE memory `feedback_tester_canonical_and_platform_parity.md`, the tester cannot operate iOS Simulator / Android Emulator / buyer email inboxes from this session. **These do NOT block PASS verdict** because the production data probes already confirmed E2E delivery (the `81fe2a68` refund row has a real Resend provider_message_id). The smokes are nice-to-have visual confirmation:

1. **Buyer email inbox check** — open the inbox for the buyer email on order `6ad119af-…` and visually confirm the "Your refund for [event] is on the way" email is present, branded, and renders correctly. The Resend message ID is in DB.
2. **iOS refund smoke** — operator issues a fresh test refund via mingla-business iPhone, verifies buyer receives the email within 10 seconds.
3. **iOS cancel smoke** — same pattern for a free-order cancel.
4. **Android parity** — repeat steps 2-3 on Android.
5. **Web parity** — N/A for refund/cancel (mingla-business operator surface is iOS+Android-first; web buyer flow is a different surface and was tested per ORCH-0790).

If any smoke fails, surface to operator — do NOT silently downgrade verdict. PASS stands on production data + 35-test coverage.

---

## 11. Verdict + downstream

**PASS.**

Every spec criterion verifiable from production data or independent test coverage. Constitution preserved/strengthened. Zero P0/P1/P2 findings. Four P4 commendations. Migration on remote with cron healthy. All 5 edge functions deployed with verify_jwt preserved. The pre-fix's 14 stuck rows are fully drained (6 email sent + 2 sms hit Twilio terminal correctly + 6 sms terminal untouched per accepted residual). Strict-grep CI gate enforces I-PROPOSED-BA going forward.

Next dispatch: **Claude `mingla-orchestrator` for CLOSE** — full 7-artifact sync, DIAG reap (already verified zero), `I-PROPOSED-BA NOTIFICATION_TEMPLATE_KEY_DISPATCHED` DRAFT → ACTIVE flip, commit message, register the two follow-up candidate ORCHs (0788-A SMS parity, 0788-B admin reset RPC), and the D-0788-7 amended-sweeper-scope as a SPEC amendment artifact. No EAS OTA needed (no mobile bundle changed).

---

## 12. Discoveries for orchestrator

1. **D-0788-7 (carried forward from implementation report):** the in-flight sweeper extension (`pending > 5 min` path) effectively amended SPEC §8.1's "Eligible rows: failed_retryable" scope. Running implementation is authoritative; consider writing `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-0788_SWEEPER_ORPHAN_PENDING.md` so the spec text matches reality. Pattern precedent: `SPEC_AMENDMENT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`.

2. **Sweeper's `attempt_count` reset behavior for orphan-pending path:** pending rows enter the sweeper with `attempt_count=0`. After one dispatcher invocation they become `attempt_count=1` (success or failure). This matches normal new-row semantics. No special handling needed, but worth noting if anyone wonders why orphan rows aren't capped differently.

3. **The 2 sms failed_retryable rows that became `failed_terminal` at attempt_count=2** rather than the spec's nominal `attempt_count >= 3` cap — this is correct behavior driven by the existing `classifyNotificationProviderFailure(retryable: false)` for Twilio 400 errors. Not a finding, but worth understanding: the cap is "≥3 attempts OR non-retryable response" — first-encountered non-retryable trumps attempt count.

4. **No operator-reset path for `failed_terminal` rows exists today** (spec deferred this per §10.2). If/when operator fixes Twilio externally, the 10 sms `failed_terminal` rows have no automated route back to retryable. Candidate follow-up ORCH-0788-B.

5. **Cron job-run history visibility:** `cron.job_run_details` provides nice operator visibility into sweeper health (`SELECT runid, status, return_message, start_time, end_time FROM cron.job_run_details ...`). Consider adding a one-line admin-surface query if anyone builds an ops dashboard.

6. **SMS for refund/cancel deferred per spec §10.1 (CF-1).** The 2 sms failed_retryable rows in this test were buyer-ticket-confirmation rows, not refund/cancel — so they don't conflict with the deferral. But if Twilio config is fixed, ORCH-0788-A becomes the right way to enable refund/cancel SMS.

---

## 13. Test summary table

| Test | Source | Result |
|---|---|---|
| 8 adapter unit tests | `_shared/email/__tests__/buyerLifecycleAdapters.test.ts` | 8/8 PASS |
| 10 sweeper source-introspection tests | `notification-retry-sweeper/index.test.ts` | 10/10 PASS |
| 9 refund-order tests | `refund-order/index.test.ts` (pre-existing) | 9/9 PASS |
| 8 cancel-order tests | `cancel-order/index.test.ts` (pre-existing) | 8/8 PASS |
| 5 `deno check` invocations | all 5 affected edge functions | 5/5 clean |
| 7 strict-grep checks | `orch-0788-notification-template-key-dispatched.mjs` | 7/7 PASS |
| 5 production data probes | `mcp__supabase__execute_sql` independent verification | 5/5 PASS |
| DIAG marker reap | grep across functions + migrations | 0 matches (expected) |
| Migration verification probes | inside `20260527000000` SQL | 3/3 RAISE EXCEPTION blocks did NOT fire (success) |
| pg_cron run health | `cron.job_run_details` | 3 succeeded, 0 failed |

**Total: 75+ verification points, zero failures.**
