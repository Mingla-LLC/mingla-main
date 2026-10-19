# Waiting room / admission (#2879 / #2947)

## Slice 2 shipped (eng)

- Tables: `ticket_queue_admission_settings`, `ticket_queue_arming`, `ticket_queue_entries`
- Carrier for queued hold: `expires_at = 'infinity'` (not NULL)
- SECURITY DEFINER service_role RPCs: arm, join, state, admit_batch, admit_due, release_newest_holds
- `cron.job` `issue_2947_queue_admission_driver` wired in the same migration as the driver
- Governor: `LEAST(token_bucket, max_concurrent_live_holds − live_holds)`
- Quiet path invisible below arming threshold; capacity cut releases newest first

## Slice 3 (eng) — create four-outcome + buyer web UI

- Opt-in: `queueContract:"queue_v1"` + `queueDeviceToken` (256-bit hex). Server stores `sha256hex(token)` only.
- Outcomes: through (unchanged) | refused (unchanged) | `kind:"queued"` | `kind:"waitlist_offered"`.
- Absent contract ⇒ quiet path (byte-identical; never emits the new kinds). Web opts in; native does not until a store release.
- Status poll: additive `queuePosition` / `aheadOfYou` / `gettingOne` / `holdSecondsRemaining` when device token presented. No `expires_at` on the wire.
- Buyer screens: `/checkout/{id}/queue`, `/checkout/{id}/waitlist`.

## Slice 7 (eng) — pre-sale join path

- `issue_1930_ticket_checkout_create_session_base` allows an **armed** tier to mint an infinity hold before `sale_start_at`. Finite-expiry creates still raise `ticket_sales_not_started`.
- Ordering among pre-sale joiners remains `md5(order_seed ‖ id)` from slice 2.
- Finalize (`issue_1930_ticket_session_authorized`) is unchanged — sale must be open to complete.

## Queue monitors (eng)

- Write-driven totals + `issue_2947_queue_monitor_observe` / `issue_2947_queue_verdict`.
- Event denominator: `queueWindowsObserved`. Verdict is `insufficient_evidence` / `stalled` / `orphaned` / `clean` — never `clean` when the event denominator is 0.
- Observe runs on the same `issue_2947_queue_admit_due` tick after admission.

## Ops before arming Ilashe

1. Apply slice 2 migration in prod (done 2026-10-17 — see #2879 release record).
2. Deploy `ticket-checkout-create` + `ticket-checkout-status` after slice 3 merges; version+bundle readback.
3. Fill Gate 0 on #2879: expected concurrent demand, arming threshold, max concurrent live holds, Paystack Initialize limits.
4. Do **not** arm any Ilashe tier until Gate 0 numbers replace placeholders (default threshold 250 / rate 20 are placeholders only).

## Load certification (mocked providers first)

Harness: `scripts/load-cert/issue_2879_waiting_room_drills.mjs`

Target: 150k inventory / 100k reservation attempts; drills for retry storm, 429 pause, late success, event ordering, capacity cut, identity loss, operator arm/disarm. Finish with small real-money canary after Gate 0.

## Dashboard signals (minimum)

Admin surface: mingla-admin `#/queue-health` (RPC `admin_get_queue_health`).

**Wired now (read-only over monitor + finder data):**
- Queue depth / eligible waiting / armed tiers / orphan infinity
- 72h joins / admissions / releases / waitlist invites + verdict badge
- Paid-without-ticket count (#3645 finder predicate)
- Recent observe-run table

**Still Gate 0 / no eng store yet (must not invent):**
- Remaining inventory, Initialize/Verify failures, provider 429/5xx, p95 finalization, support interventions
