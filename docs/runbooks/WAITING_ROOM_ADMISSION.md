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

## Ops before arming Ilashe

1. Apply slice 2 migration in prod (done 2026-10-17 — see #2879 release record).
2. Deploy `ticket-checkout-create` + `ticket-checkout-status` after slice 3 merges; version+bundle readback.
3. Fill Gate 0 on #2879: expected concurrent demand, arming threshold, max concurrent live holds, Paystack Initialize limits.
4. Do **not** arm any Ilashe tier until Gate 0 numbers replace placeholders (default threshold 250 / rate 20 are placeholders only).

## Load certification (mocked providers first)

Harness: `scripts/load-cert/issue_2879_waiting_room_drills.mjs`

Target: 150k inventory / 100k reservation attempts; drills for retry storm, 429 pause, late success, event ordering, capacity cut, identity loss, operator arm/disarm. Finish with small real-money canary after Gate 0.

## Dashboard signals (minimum)

Queue depth, admission rate, remaining inventory, Initialize/Verify failures, provider 429/5xx, p95 finalization, stuck holds, paid-without-ticket, support interventions.
