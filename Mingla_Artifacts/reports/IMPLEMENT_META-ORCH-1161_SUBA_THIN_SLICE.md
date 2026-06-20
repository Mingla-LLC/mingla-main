# IMPLEMENTATION — META-ORCH-1161 Sub-A (THIN SLICE) — buyer_reservation_changed end-to-end

**ORCH:** META-ORCH-1161 Sub-A (thin slice)
**Phase:** IMPLEMENT (single pass; self-verified; NOT deployed/merged)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[notif-system]/` on branch `ORCH-1161-notif-system`
**Commit:** `a511b7944`
**Date:** 2026-06-19
**Status:** implemented and verified (source + Deno unit tests). Migration apply + edge deploy are operator-owned (NOT run here).

---

## 1. Summary

A reservation status/table/time change now reaches the buyer. An `AFTER UPDATE`
trigger on `reservations` writes a durable `notification_outbox` row mapped to
`buyer_reservation_changed`; a 1-minute pg_cron drains it into `notify-dispatch`
v2, which writes the in-app inbox row and fans out to **push + in-app + email
simultaneously** (per DEC-185 — there is NO push-first/SMS-fallback waterfall),
and fires **SMS** only when `SMS_LIVE_ENABLED_US=true` AND transactional consent
is present AND the recipient is not suppressed. A STOP inbound (`twilio-inbound-sms`,
new) writes a `channel_suppressions` row so the next SMS is skipped, and
`twilio-message-status` (extended) reconciles `notification_deliveries` status by
`provider_message_id`. Every outbound SMS carries the brand name + a "Reply STOP
to opt out" footer, is GSM-7-sanitized, and records its segment count.

**Key deviation from the written SPEC (documented, not silent):** SPEC §5.4
describes a push-first / SMS-fallback waterfall. The dispatch contract for this
slice supersedes that with **DEC-185 (simultaneous policy send)** — every channel
in `default_channels` that passes `can_send()` fires at once, no fallback ordering.
The implementation follows the dispatch contract (DEC-185). `reach_mode` is kept
on `notification_categories` for forward use but the thin-slice dispatcher does
not consult it.

---

## 2. SPEC success-criteria coverage

| Criterion (dispatch /goal) | How verified | Status | Commit |
|---|---|---|---|
| Reservation change → `notification_outbox` row | `AFTER UPDATE` trigger `orch_1161_reservation_notify_outbox` (migration 2) inserts on status/table/time change | ✓ source | `a511b7944` |
| Outbox → notify-dispatch v2 | `notify-outbox-drain` edge fn + 1-min cron (migration 3) | ✓ source | `a511b7944` |
| push + in-app + email fire simultaneously | `dispatchV2` writes inapp delivery always, then fans out per-channel via `can_send`; Deno test #3 asserts inapp=delivered + push + email all attempted | ✓ test | `a511b7944` |
| SMS fires only when kill-switch ON + consent + not suppressed | Deno test #4 (ON → sent) + smsAdapter kill-switch | ✓ test | `a511b7944` |
| SMS skipped without HTTP when kill-switch OFF | Deno test "kill-switch OFF returns skipped WITHOUT an HTTP call" + test #3 | ✓ test | `a511b7944` |
| brand-name + STOP footer + GSM-7 + segment count | `composeSmsBody` + `sanitizeGsm7` + `computeSegments`; Deno tests #1/#2 | ✓ test | `a511b7944` |
| STOP inbound suppresses next SMS | `twilio-inbound-sms` writes `channel_suppressions`; `can_send` denies; Deno test #5 | ✓ test (logic) | `a511b7944` |
| `notification_deliveries` reconciles from webhook | `twilio-message-status` extended (by `provider_message_id`, channel='sms') | ✓ source | `a511b7944` |
| consent recorded on the moment | `notify-dispatch` v2 writes `consent_records(scope='transactional', source='reservation')` if absent | ✓ source | `a511b7944` |
| legacy dispatch path byte-identical | v2 is an early additive branch on `category_key`; legacy `type` path untouched; `deno check` passes | ✓ | `a511b7944` |
| migrations monotonic + REVOKE on SECURITY DEFINER | versions `20261110000000-3` (> max `20261015000001`); `REVOKE PUBLIC+anon` on `can_send` + trigger fn | ✓ | `a511b7944` |

---

## 3. Files changed

**Migrations (new):**
- `supabase/migrations/20261110000000_orch_1161_notification_foundation_tables.sql` (+~210)
- `supabase/migrations/20261110000001_orch_1161_seed_notification_categories.sql` (+~70)
- `supabase/migrations/20261110000002_orch_1161_can_send_and_reservation_trigger.sql` (+~180)
- `supabase/migrations/20261110000003_orch_1161_outbox_drain_cron.sql` (+~95)

**Edge functions / shared (new):**
- `supabase/functions/_shared/adapters/smsAdapter.ts` (+~210)
- `supabase/functions/_shared/adapters/pushAdapter.ts` (+~55)
- `supabase/functions/_shared/adapters/emailAdapter.ts` (+~90)
- `supabase/functions/_shared/notifyV2.ts` (+~245)
- `supabase/functions/_shared/notifyTemplates.ts` (+~110)
- `supabase/functions/notify-outbox-drain/index.ts` (+~135)
- `supabase/functions/twilio-inbound-sms/index.ts` (+~130)

**Edge functions (modified):**
- `supabase/functions/notify-dispatch/index.ts` (+~60; additive v2 branch + consent write; legacy path byte-identical)
- `supabase/functions/twilio-message-status/index.ts` (+~30; additive deliveries reconcile + error codes)

**Config / gates / tests (new + modified):**
- `supabase/config.toml` (+10; entries for the 2 new fns)
- `.github/scripts/strict-grep/i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs` (new gate)
- `.github/workflows/strict-grep-mingla-business.yml` (+11; gate job)
- `supabase/functions/__tests__/orch_1161_notify_dispatch_v2.test.ts` (new; 8 tests)

---

## 4. Data-model changes applied (by migration — NOT yet applied to remote)

- `notification_categories` (PK key) — taxonomy read as data; RLS public-read.
- `notification_channel_prefs` (PK user_id,category_key,channel) — RLS owner.
- `channel_suppressions` (+ partial unique idx) — RLS read-own; service-role write.
- `consent_records` (append-only audit) — RLS read-own; service-role write.
- `notification_deliveries` (FK→notifications) — RLS read-own-via-notification.
- `notification_outbox` (unique idempotency_key) — service-role only (no policy).
- `can_send(uuid,text,text,text)` SECURITY DEFINER STABLE; REVOKE PUBLIC+anon, GRANT authenticated.
- `orch_1161_reservation_notify_outbox()` SECURITY DEFINER trigger fn; REVOKE PUBLIC+anon.
- `AFTER UPDATE ON reservations` trigger `orch_1161_reservation_notify_trg`.
- pg_cron job `orch_1161_notify_outbox_drain` (`* * * * *`).
- All 16 §5.2 category rows seeded (idempotent upsert).

---

## 5. Edge functions touched — verify_jwt to preserve

| Function | verify_jwt | Note |
|---|---|---|
| `notify-dispatch` | (no config entry → Supabase default) | unchanged; service-role bearer caller |
| `twilio-message-status` | `false` | unchanged (gated on `?secret=`) |
| `notify-outbox-drain` (new) | `false` | cron service-role bearer |
| `twilio-inbound-sms` (new) | `false` | Twilio webhook, gated on `?secret=` |

---

## 6. Regression tests added

- Path: `supabase/functions/__tests__/orch_1161_notify_dispatch_v2.test.ts` — 8 Deno tests.
- Run: `cd "~/Desktop/mingla-orchs/ORCH-1161-[notif-system]" && DENO_TESTING=1 /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --no-check supabase/functions/__tests__/orch_1161_notify_dispatch_v2.test.ts`
- Result: **8 passed | 0 failed**.
- **fails-on-revert verified at `a511b7944`** — true line-deletion of the kill-switch guard block (`if (!envTrue(killSwitch)) { ... }`) in `smsAdapter.ts` → 2 tests FAIL ("kill-switch OFF returns skipped WITHOUT an HTTP call" + "dispatchV2: kill-switch OFF … SMS skipped"); restoring the guard → 8 pass again.

---

## 7. Old → New receipts

### supabase/functions/notify-dispatch/index.ts
- **Before:** single legacy `{userId,type,title,body,...}` contract → in-app + push + optional email, with type→preference gating + quiet hours.
- **Now:** an early additive branch — when `category_key` is present, routes to `dispatchV2` (simultaneous fan-out via `can_send`) + writes a transactional `consent_records` row. A caller sending `type` (no `category_key`) hits the byte-identical legacy path.
- **Why:** DC-1 (unified dispatcher, sole send path) without breaking existing callers (§5.7 transitional).
- **Lines:** ~+60.

### supabase/functions/twilio-message-status/index.ts
- **Before:** reconciled `ticket_order_notifications` status only.
- **Now:** ALSO updates `notification_deliveries.status` by `provider_message_id` (channel='sms'); records 30034/30007/30032 into `failed_reason`. Original logic untouched.
- **Why:** §5.6 cross-channel delivery reconciliation.
- **Lines:** ~+30.

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS / Android | indirect | a consumer with `consumer_user_id` on a reservation gets a push + inbox row (no UI change shipped this slice). |
| Buyer/anon Web | no | no buyer-web file touched in this slice (checkout consent UX is OUT). |
| Business iOS / Android | no | brand push semantics untouched. |
| Backend (`supabase/`) | YES (all of it) | the whole slice. |
| Admin Web | no | OUT of META-ORCH-1161. |
| Business Web preview | no | n/a. |

Parity: backend-only; no manual cross-surface parity needed this slice.

---

## 9. Self-verify results

- `deno check` on all touched/new edge functions + the test file: **clean**.
- Deno tests: **8 passed**, fails-on-revert proven.
- strict-grep gate `i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs`: **pass**.
- No DO-NOT-TOUCH file modified (`send-otp`/`verify-otp`, `send-venue-sms` send path, `venue_sms_opt_out`/`venue_sms_log` write semantics, reservation lifecycle money RPCs, `stripeWebhookRouter` money seam — all untouched).
- Migration apply: **NOT run** (no local Postgres/Docker; operator applies — §11).

---

## 10. Known issues / deferred

- **[TRANSITIONAL]** `notify-dispatch` v2 branch + `notifyV2.ts` are labeled `META-ORCH-1161 transitional:` — exit condition: legacy `type` contract retired at CLOSE (§5.7).
- **Anon/guest reservations** (no `consumer_user_id`): the delivery ledger requires a `notifications.notification_id` FK (table is `user_id NOT NULL`), so a user-less reservation gets email/SMS but no `notification_deliveries` rows (handled in `dispatchAnon`). Surfaced for Sub-C hardening.
- **Consent disclosure_text** is NOT recorded in this slice's reservation-derived consent (the §1b verbatim string has unresolved `[[FILL]]` legal placeholders — see COPY §5). The consent row is written with `source='reservation'` and no `disclosure_text`; the checkout-grant path (with disclosure) is OUT of this slice.
- **The other §5.2 categories are seeded but only `buyer_reservation_changed` is wired** end-to-end (per dispatch scope). `confirmed`/`cancelled` mappings exist in the trigger but are proven only for `changed`.
- **Resend inbound webhook** (`resend-email-status`) is OUT of this slice (SPEC §5.6 / Sub-B).
- Deno tests are NOT in the CI `deno-tests` explicit file list — operator/orchestrator should add the path to `.github/workflows/supabase-migrations-and-stripe-deno.yml` DENO_TEST_FILES at CLOSE if CI coverage is desired (the migration-apply job already runs the new migrations).

---

## 11. Operator action required

**Apply migrations (after REVIEW, monotonic above `20261015000001`):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[notif-system]" && /Users/sethogieva/bin/supabase db push --linked
```
(Or via the Management API per the migration-apply hazard runbook if the CLI is drift-wedged. Migrations apply in order 000000→000003.)

**Deploy edge functions FROM MERGED main (orchestrator/operator-owned, never the worktree):**
- `notify-dispatch` (v2 branch added; preserve default verify_jwt)
- `notify-outbox-drain` (NEW; verify_jwt=false)
- `twilio-inbound-sms` (NEW; verify_jwt=false)
- `twilio-message-status` (extended; verify_jwt=false)

**Secrets (Supabase secrets — already set for SMS today, plus the new kill-switch):**
- `SMS_LIVE_ENABLED_US` — **set to `true` only after the §8 US go/no-go gate passes.** Default false → SMS skips with no HTTP call. `SMS_LIVE_ENABLED_NG` reserved for the NG phase.
- Existing: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_STATUS_CALLBACK_SECRET`, `RESEND_API_KEY`, `MINGLA_LOGO_URL`, `MINGLA_FOOTER_ADDRESS`, OneSignal keys.

**Twilio console:** point the Messaging Service "A MESSAGE COMES IN" inbound webhook at `/functions/v1/twilio-inbound-sms?secret=<TWILIO_STATUS_CALLBACK_SECRET>` for app-side STOP sync.

---

## 12. Discoveries for Orchestrator

- **COMMS-0038 (I-PROPOSED-BV realtime-publication gate) is RED on origin/main** (META-ORCH-1148's `reservations`/`venue_waitlist` subscriptions unpaired). This slice adds NO realtime subscriptions and does NOT add tables to the publication, so it does not worsen that gate — but any PR for this branch will still inherit the red gate until META-ORCH-1148 fixes it. Factored, not owned by 1161.
- **DEC-185 in the local `DECISION_LOG.md` is a DIFFERENT decision** (ORCH-1146 experience parser) than the "simultaneous policy send" DEC-185 the dispatch references. The notification DEC-185/186 are recorded in the COPY file header but not yet in `DECISION_LOG.md` — orchestrator should log the notification DEC-185 (simultaneous send) / DEC-186 (bundled consent) to avoid the ID-collision confusion.
- The COPY file `COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md` lives in the **anchor** (`mingla-main`), not the worktree or origin/main — it was read from the anchor. Orchestrator may want it committed to main for durability.
- The `[[FILL]]` legal placeholders in the consent disclosure string are a real blocker for the consent-capture leg (Sub-B/checkout) — counsel + real entity/URL values needed before any consent `disclosure_text` ships.

---

## REWORK 2026-06-20 — NEEDS-REWORK loop (fix tester P2-1 + P2-2 + CI registration)

**Trigger:** `TEST_META-ORCH-1161_SUBA_THIN_SLICE.md` CONDITIONAL PASS → REWORK for the two P2 anon/guest defects + the CI housekeeping item. Built on top of code `a511b7944` / tester adversarial test `577de017b`. NOT deployed/merged.

### Fixes

**P2-1 — guest double-fire / non-atomic outbox claim → CLOSED.**
- The drain claimed pending rows with a non-atomic `select status='pending'` then per-row `update status='processing'` — two overlapping cron runs could both claim the same row (the guest/no-`user_id` path has no `notifications` UNIQUE backstop → double SMS/email).
- New migration `20261110000004_orch_1161_atomic_claim_and_guest_ledger.sql` adds `claim_notification_outbox(p_limit int)` — a SECURITY DEFINER function doing a single `UPDATE … WHERE id IN (SELECT id … WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT N) RETURNING *`. The drain (`notify-outbox-drain/index.ts`) now calls this RPC instead of select-then-update, and the redundant per-row mark-processing UPDATE is removed.
- **Second line of defense (dispatcher idempotency for guests):** the guest delivery ledger now carries `idempotency_key`, and a partial `UNIQUE(idempotency_key, channel) WHERE idempotency_key IS NOT NULL AND notification_id IS NULL` makes a second dispatch of the same key a 23505 → `dispatchAnon` skips the provider HTTP. This mirrors, for guests, the `notifications` UNIQUE backstop the `user_id` path already had.

**P2-2 — guest sends not written to the delivery ledger → CLOSED.**
- `notification_deliveries.notification_id` relaxed to NULLABLE; added `contact` + `idempotency_key` columns; added `CHECK (notification_id IS NOT NULL OR contact IS NOT NULL)` (no orphan rows).
- `dispatchAnon` (`_shared/notifyV2.ts`) now writes a CONTACT-KEYED delivery row per guest send (email + SMS; push n/a for guest), claimed `queued` then reconciled to the provider result (`sent`/`failed` + `provider_message_id` + `segments`).
- The Twilio status webhook (`twilio-message-status`) already reconciles by `provider_message_id` + `channel='sms'` with NO `notification_id` filter — so guest rows reconcile automatically; no webhook change needed.

**CI registration → DONE.** Added `supabase/functions/__tests__/**` to the workflow trigger `paths` (push + pull_request) and a new `notification-deno-tests` job in `.github/workflows/supabase-migrations-and-stripe-deno.yml` that enumerates ALL THREE 1161 Deno test files (happy-path + tester adversarial + this rework's). Batch-run verified locally (CI parity): 13 passed | 0 failed.

### Files changed (rework)
| File | Change |
|---|---|
| `supabase/migrations/20261110000004_orch_1161_atomic_claim_and_guest_ledger.sql` | NEW (+~115) — atomic claim fn + guest ledger schema |
| `supabase/functions/notify-outbox-drain/index.ts` | atomic `claim_notification_outbox` RPC; removed non-atomic select + per-row mark-processing (~−12/+12) |
| `supabase/functions/_shared/notifyV2.ts` | `dispatchAnon` writes contact-keyed ledger + per-channel dedupe; `MinimalClient.update`; `insertGuestDelivery`/`updateGuestDelivery` helpers (~+70) |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | trigger paths + `notification-deno-tests` job (~+40) |
| `supabase/functions/__tests__/orch_1161_guest_ledger_and_dedupe.test.ts` | NEW (2 tests) — proves the fixes; fails-on-revert |

### How atomicity is guaranteed
`claim_notification_outbox` flips `pending → processing` inside ONE statement whose inner `SELECT … FOR UPDATE SKIP LOCKED` row-locks the chosen rows; a concurrent drain invocation cannot lock the same rows and SKIPs them. Runtime-proven against real Postgres `supabase/postgres:17.4.1.075`: two concurrent claims (session A holding locks on c6–c10, session B claiming live) returned **disjoint** sets (A={c6..c10}, B={c1..c5}, overlap NONE). The dispatcher-level guest dedupe (partial UNIQUE) is the backstop if a single logical notification is ever re-enqueued.

### Guest-ledger proof (runtime, real Postgres 17)
- `notification_id` nullable: YES.
- Guest insert (`notification_id NULL`, `contact` set) OK; duplicate `(idempotency_key, channel)` rejected with 23505; same `idempotency_key` + different `channel` allowed.
- Orphan row (no `notification_id`, no `contact`) rejected by the CHECK.
- `claim_notification_outbox(2)` over 3 pending rows claimed the 2 oldest and flipped exactly those to `processing` (third stayed `pending`).
- `has_function_privilege` for `anon` and `authenticated` on `claim_notification_outbox(int)` = **false** (SECURITY DEFINER auto-grant gotcha closed).

### Regression test (rework)
- Path: `supabase/functions/__tests__/orch_1161_guest_ledger_and_dedupe.test.ts` (2 tests: G1 guest ledger write, G2 guest dedupe).
- Run: 2 passed | 0 failed. Combined 1161 suite (3 files): **13 passed | 0 failed**.
- **fails-on-revert verified at `577de017b`** (branch HEAD before the rework commit): deleting the `if (claim.duplicate) { … continue; }` dedupe guard in `dispatchAnon` → G2 FAILS (twilio===2 not 1); restored → pass. Neutering `insertGuestDelivery` (true line-deletion of the ledger write) → BOTH G1 and G2 FAIL; restored → pass.

### CI registration confirmation
All three files present and enumerated; CI-parity batch run (`deno test … orch_1161_notify_dispatch_v2.test.ts orch_1161_anon_guest_path.test.ts orch_1161_guest_ledger_and_dedupe.test.ts`) → 13 passed. `git diff origin/main --name-status` shows all three test files as `A` (added) — append-only satisfied; the tester's A3 (`twilio===2`) is UNCHANGED (its fake client never simulates the DB UNIQUE conflict, so it still passes — the dedupe is a real-DB constraint, proven separately in `orch_1161_guest_ledger_and_dedupe.test.ts` + the Postgres runtime probe).

### Guards held (rework)
- Legacy `notify-dispatch` `type` path: BYTE-IDENTICAL (untouched this rework).
- `SMS_LIVE_ENABLED_US` default false: unchanged.
- Migration monotonic: `20261110000004` > all local + sibling-worktree prefixes.
- `claim_notification_outbox` REVOKE PUBLIC + anon + authenticated (service-role only).
- DO-NOT-TOUCH (send-otp/verify-otp, venue send path, Stripe money seam, reservation lifecycle money RPCs): untouched.
- strict-grep `i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs`: PASS. `deno check` on all 4 touched edge fns: clean.

### Operator action required (rework — additive to §11)
- **Apply the new migration** (in order, after REVIEW): `20261110000004_orch_1161_atomic_claim_and_guest_ledger.sql` is part of the same `db push` chain in §11 (applies after `…000003`).
- **No new edge fn** to deploy beyond §11's list; `notify-outbox-drain` and `notify-dispatch` (v2 core) are re-deployed from MERGED main with the rework changes.
- **Cron migration `…000003` (vault/net) unchanged** — the cron now POSTs the drain which calls the new claim RPC.
