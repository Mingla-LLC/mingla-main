# ORCH-1388 runtime + data evidence — captured 2026-07-17/18 UTC (read-only)

All probes read-only. SQL via Supabase MCP `execute_sql` on prod `gqnoajqerqhnvulmnyvv`.
Stripe via live secret key, GET-only, `Stripe-Account: acct_1Tml2YI4pBxuXrhh` header.
Raw PI JSONs (client_secret redacted) sit beside this file.

## 1. Cron registration (pg_cron)

`SELECT jobid, jobname, schedule, active FROM cron.job` →

| jobid | jobname | schedule | active |
|---|---|---|---|
| 28 | orch_1187_reconcile_stuck_checkouts | */15 * * * * | true |

## 2. Cron run history (pg_cron job_run_details, jobid 28, latest 8)

Every run `succeeded` / `1 row` (pg_net async enqueue), 15-minute cadence, e.g.:

```
runid 342674  succeeded  2026-07-18 03:00:00.616+00
runid 342609  succeeded  2026-07-18 02:45:00.404+00
runid 342551  succeeded  2026-07-18 02:30:00.498+00
runid 342490  succeeded  2026-07-18 02:15:00.444+00
(… continues every 15 min)
```

## 3. Actual edge-fn HTTP responses (net._http_response, filtered `%reconciled%`)

Latest 4 retained runs (03:00, 02:45, 02:30, 02:15 UTC 2026-07-18) — ALL byte-identical
in shape: **status_code 200**, body:

```json
{
  "reconciled": 0,
  "skipped": 5,
  "errors": 0,
  "results": [
    { "sessionId": "4fb46905-81d6-49b1-8d26-0313da745ea2", "piId": "pi_3TmqbHI4pBxuXrhh0Zw4v0Fq", "skip": "pi_status_requires_payment_method" },
    { "sessionId": "37572cf8-f063-4110-ac02-f802cb4bb097", "piId": "pi_3TmqfRI4pBxuXrhh0cXZ2vyi", "skip": "pi_status_requires_payment_method" },
    { "sessionId": "96949032-49cd-4c9f-92a3-54dfefa929b7", "piId": "pi_3Tmr3kI4pBxuXrhh1AlyasBC", "skip": "pi_status_requires_payment_method" },
    { "sessionId": "c9bac9dd-8e97-4121-8e52-e78d09d5715d", "piId": "pi_3ToXuJI4pBxuXrhh0OaFDbwh", "skip": "pi_status_requires_payment_method" },
    { "sessionId": "9bfcaaf8-bece-4d5e-bd57-c0aed21a8a1d", "piId": "pi_3TooOQI4pBxuXrhh0cZrpJqL", "skip": "pi_status_requires_payment_method" }
  ]
}
```

Reading: the reconciler RUNS on schedule, AUTHENTICATES, LISTS all 5 stuck rows,
RETRIEVES every PI from Stripe successfully (connected-account header works — no
404/permission errors, `errors: 0`), sees `requires_payment_method`, and skips by
design. Predicate gap proven at the runtime layer; schedule/error/visibility
hypotheses ruled out by the same artifact.

Corroboration — edge-function log (MCP get_logs, service=edge-function):
`POST | 200 | …/functions/v1/reconcile-stuck-checkouts` execution_time_ms 3020,
version 234 (deployed fn matches repo code intent).

## 4. DB enumeration — ALL 9 all-time ticket_checkout_sessions (buyer emails md5-truncated)

| # | id | status | cents | ccy | created (UTC) | expires_at | PI / ref | acct | tombstoned | order |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | c1e3fc8f… | failed | 1000 | USD | 06-27 03:11:41 | 03:26:41 | (null — PI create 400) | acct_1Tml2Y… | yes | — |
| 2 | 7499b8c2… | paid_completed | 1000 | USD | 06-27 03:14:27 | 03:29:27 | pi_3TmmhmI4pBxuXrhh14ee7ZCG (web CS) | acct_1Tml2Y… | no | 3fa3b8bf… |
| 3 | 1a69d793… | expired | 1000 | USD | 06-27 07:23:19 | 07:38:19 | pi_3TmqaCI4pBxuXrhh1Gs48EcL | acct_1Tml2Y… | yes | — |
| 4 | 4fb46905… | **processing_payment** | 6500 | USD | 06-27 07:24:26 | 07:39:26 | pi_3TmqbHI4pBxuXrhh0Zw4v0Fq | acct_1Tml2Y… | no | — |
| 5 | 37572cf8… | **processing_payment** | 2000 | USD | 06-27 07:28:45 | 07:43:45 | pi_3TmqfRI4pBxuXrhh0cXZ2vyi | acct_1Tml2Y… | no | — |
| 6 | f9281048… | paid_completed | 1000 | USD | 06-27 07:45:14 | 08:00:14 | pi_3TmqvPI4pBxuXrhh0DmzFd9k | acct_1Tml2Y… | yes | 7f577d38… |
| 7 | 96949032… | **processing_payment** | 1000 | USD | 06-27 07:53:52 | 08:08:52 | pi_3Tmr3kI4pBxuXrhh1AlyasBC | acct_1Tml2Y… | no | — |
| 8 | c9bac9dd… | **processing_payment** | 1000 | USD | 07-01 23:51:04 | 00:06:04 | pi_3ToXuJI4pBxuXrhh0OaFDbwh | acct_1Tml2Y… | no | — |
| 9 | 9bfcaaf8… | **processing_payment** | 2000 | USD | 07-02 17:27:14 | 17:42:14 | pi_3TooOQI4pBxuXrhh0cZrpJqL | acct_1Tml2Y… | no | — |

All 5 stuck rows: `failure_reason` NULL, `failed_at` NULL, `order_id` NULL,
`stripe_checkout_session_id` NULL (native arm), `stripe_account_id` populated,
`expires_at` = created + 15 min (long past). `updated_at` within seconds of
`created_at` — the reconciler never touches the rows.

Rows 3/6 prove the ORCH-0829-B lazy tombstone WORKS when triggered: same buyer
(hash 0cf818ab) re-created with an IDENTICAL cart → prior row tombstoned +
`expired` + `failed_at` set. Rows 4/5/7 (same buyer, different cart totals →
different deterministic idempotency keys) never matched, so the lazy path never
fired — proof the lazy mechanism cannot be the safety net.

## 5. Stripe truth — all 5 stuck PIs (GET /v1/payment_intents/{id}, Stripe-Account header)

| PI | status | amount | created (UTC) | latest_charge | last_payment_error | canceled_at |
|---|---|---|---|---|---|---|
| pi_3TmqbHI4pBxuXrhh0Zw4v0Fq | requires_payment_method | 6500 usd | 2026-06-27 07:24:27 | none | none | none |
| pi_3TmqfRI4pBxuXrhh0cXZ2vyi | requires_payment_method | 2000 usd | 2026-06-27 07:28:45 | none | none | none |
| pi_3Tmr3kI4pBxuXrhh1AlyasBC | requires_payment_method | 1000 usd | 2026-06-27 07:53:53 | none | none | none |
| pi_3ToXuJI4pBxuXrhh0OaFDbwh | requires_payment_method | 1000 usd | 2026-07-01 23:51:07 | none | none | none |
| pi_3TooOQI4pBxuXrhh0cZrpJqL | requires_payment_method | 2000 usd | 2026-07-02 17:27:18 | none | none | none |

ZERO charges ever created on any of the five. Nobody was charged. No refunds owed.
Amounts match the DB rows exactly. Confirms + extends the orchestrator's 2026-07-17
read-only probe (which covered the last two) to all five.
