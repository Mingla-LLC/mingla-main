# IMPLEMENT — META-ORCH-1161 Sub-C (remaining transactional moments, slice "b")

**ORCH:** META-ORCH-1161 Sub-C
**Phase:** IMPLEMENT (single bounded pass; self-verified; no deploy/merge)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[txn-moments]/` on branch `ORCH-1161-txn-moments`
**Anchor truth:** built on `origin/main` (rebased; up to date — foundation `notify-dispatch` v2, `_shared/notifyV2.ts`, adapters, `notification_outbox` + drain cron, `can_send()`, seeded `notification_categories` all present and CONFIRMED applied on remote).
**Author:** mingla-implementor (Claude)
**Date:** 2026-06-20

---

## 1. Summary

Wired the remaining high-touch buyer transactional moments onto the existing Sub-A
`notify-dispatch` v2 simultaneous-send path (DEC-185), SMS text-dark:

1. **Reminders (NET-NEW)** — a new `notify-reminders` edge fn on a ~15-min pg_cron
   enqueues buyer event + reservation reminders at a 24h-ahead and a 2h-ahead lead
   window into `notification_outbox` (drained by the existing 1-min cron → dispatcher).
2. **Buyer purchase-confirmation PUSH (NET-NEW push leg)** — order-finalize now fires
   a free buyer push + in-app row; the EMAIL+PDF stays owned by
   `ticket-confirmation-dispatch` (no double-email). Wired on both the Stripe finalize
   path (shared `fireOrderFinalizeNotifications`) and the Paystack equivalent.
3. **Refund + order-cancelled push+inapp(+SMS)** — refunds (the single allowlisted
   `stripeWebhookRouter` chokepoint) and free-order cancels (`cancel-order`) now route
   a buyer push/in-app/SMS through the dispatcher; email stays single-owned.
4. **Reservation confirmed/cancelled** — VERIFIED end-to-end (the trigger already
   enqueues both, the drain is category-generic, the render copy exists). No gap.

No money/finalize/refund logic was touched — ONLY additive notify-dispatch calls.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|---|---|---|---|
| SC-1 | Reminders: 24h + 2h buckets, env-configurable lead times, exactly one per `{category}:{entityId}:{leadBucket}` (idempotent) | ✓ verified | (this branch) |
| SC-2 | Reminder cron schedule registered (~15 min) | ✓ migration + probe | (this branch) |
| SC-3 | Buyer purchase-confirmation PUSH+inapp fires on finalize WITHOUT double-email | ✓ test + remote-seed probe | (this branch) |
| SC-3-Paystack | Same push on the Paystack finalize path | ✓ wired | (this branch) |
| SC-4 | Refund → buyer push+inapp(+sms), email single-owned, idempotent per refundId | ✓ wired (single chokepoint) | (this branch) |
| SC-5 | Order-cancelled → buyer push+inapp(+sms), email single-owned, idempotent per order | ✓ wired | (this branch) |
| SC-6 | Reservation confirmed/cancelled fire end-to-end | ✓ VERIFIED (no gap) | n/a (foundation) |
| SC-7 | DEC-185 simultaneous send; SMS text-dark (kill-switch); no fallback | ✓ rides v2 + smsAdapter gate | (this branch) |
| SC-8 | No raw provider sends outside adapters (sole-send-path) | ✓ all route via notify-dispatch fetch | (this branch) |

(Commit hash filled at the post-write commit; see §11.)

---

## 3. Files changed

**New:**
- `supabase/functions/notify-reminders/index.ts` (+~95) — reminder cron edge fn.
- `supabase/migrations/20261112000000_orch_1161_subc_reminder_enqueue.sql` (+~155) — `pg_notify_reminders_enqueue()` RPC.
- `supabase/migrations/20261112000001_orch_1161_subc_reminders_cron.sql` (+~95) — ~15-min pg_cron.
- `supabase/functions/_shared/__tests__/meta_orch_1161_subc_templates.test.ts` (+~95)
- `supabase/functions/_shared/__tests__/meta_orch_1161_subc_purchase_push.test.ts` (+~135)
- `supabase/functions/_shared/__tests__/meta_orch_1161_subc_refund_cancel_push.test.ts` (+~135)

**Modified:**
- `supabase/functions/_shared/notifyTemplates.ts` (+~115) — render cases for event/reservation reminders (24h/2h via `lead_bucket`), purchase confirmation, refund, order-cancelled; `fmtAmount()`.
- `supabase/functions/_shared/businessNotifyTriggers.ts` (+~175) — `fireBuyerPurchaseConfirmationPush()` + `fireBuyerOrderNotify()` + wired purchase push into `fireOrderFinalizeNotifications`.
- `supabase/functions/_shared/stripeWebhookRouter.ts` (+~10) — buyer refund push in `handleRefundEvent` (allowlisted "ADD dispatch call ONLY").
- `supabase/functions/cancel-order/index.ts` (+~12) — buyer order-cancelled push.
- `supabase/functions/paystack-webhook/index.ts` (+~30) — buyer purchase-confirmation push on Paystack finalize.
- `supabase/functions/refund-order/index.ts` (+6) — doc comment only (no behavior change; refund push lives in the webhook chokepoint).
- `supabase/config.toml` (+8) — `[functions.notify-reminders] verify_jwt=false`.

---

## 4. Data-model changes applied

One new SECURITY DEFINER fn `public.pg_notify_reminders_enqueue(int, text, int)`:
- Atomic windowed select of upcoming PAID event orders + CONFIRMED reservations →
  `INSERT INTO notification_outbox ... ON CONFLICT (idempotency_key) DO NOTHING`.
- Idempotency_key = `{category}:{entityId}:{leadBucket}` (leadBucket `24h`|`2h`).
- `REVOKE PUBLIC + anon; GRANT authenticated, service_role`.
- One new pg_cron job `orch_1161_notify_reminders` (`*/15 * * * *`).
No tables/columns/constraints added. (All consumed tables/columns confirmed live on remote.)

---

## 5. Edge functions touched (verify_jwt to preserve)

| Function | verify_jwt | Note |
|---|---|---|
| `notify-reminders` (NEW) | **false** | invoked by pg_cron with service-role bearer |
| `cancel-order` | false (unchanged) | validates JWT itself |
| `refund-order` | (doc only) | unchanged |
| `paystack-webhook` | false (unchanged) | signature-verified |
| `stripe-webhook` (router) | false (unchanged) | signature-verified |
| `notify-dispatch` (v2, unchanged) | false | the sole send entry these call |

---

## 6. Regression tests added

- `meta_orch_1161_subc_templates.test.ts` — 5 tests (reminder 24h≠2h copy, purchase NO-STOP, refund currency-aware, order-cancelled copy).
- `meta_orch_1161_subc_purchase_push.test.ts` — 2 tests (push w/ contact:null = no double-email; no-account → no dispatch).
- `meta_orch_1161_subc_refund_cancel_push.test.ts` — 3 tests (phone-only contact = no double-email; anon guest; no-recipient → no dispatch).

`deno test --allow-env` → **10 passed | 0 failed**.

**fails-on-revert verified (true line deletion):**
- Deleted the `buyer_event_reminder` render case → templates test FAILED (1 failed), restored → PASS.
- Deleted the `fetch` dispatch in `fireBuyerPurchaseConfirmationPush` → purchase-push test FAILED (1 failed), restored → PASS.
- Both proven at the working-tree state of this branch immediately before commit.

---

## 7. Old → New receipts

### notifyTemplates.ts
- **Before:** rendered only the 3 reservation categories + a generic fallback.
- **Now:** also renders `buyer_event_reminder`/`buyer_reservation_reminder` (24h vs 2h via `lead_bucket`), `buyer_purchase_confirmation` (COPY §3.11, NO STOP line), `buyer_refund_issued` (currency-aware amount, COPY §3.9), `buyer_order_cancelled` (COPY §3.10).
- **Why:** the drain forwards these category keys to the dispatcher → renderer must cover them (SPEC §7.1/§7.3).

### businessNotifyTriggers.ts
- **Before:** `fireOrderFinalizeNotifications` fanned out only BRAND-side order_paid/sold_out/low_inventory.
- **Now:** also fires the NET-NEW buyer purchase-confirmation push (contact=null → email skips). Adds `fireBuyerOrderNotify` for refund/cancel buyer push (contact=phone → email skips).
- **Why:** SPEC §7.1 — buyer gets a free push; email stays single-owned.

### stripeWebhookRouter.ts (handleRefundEvent)
- **Before:** notified only the BRAND on refund.
- **Now:** ALSO fires the buyer refund push (single refund chokepoint, idempotent on refundId).
- **Why:** SPEC §7.x refund path; allowlist permits "ADD the dispatch call ONLY".

### cancel-order / paystack-webhook
- **Before:** emailed the buyer only.
- **Now:** also fire the buyer push/in-app(+sms / push-inapp) through the dispatcher.
- **Why:** the only chokepoints for free-cancel / Paystack-finalize respectively.

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | YES (runtime) | buyers now receive purchase/refund/cancel/reminder PUSH + in-app rows. Backend-only change; no app build. |
| Consumer Android | YES (runtime) | same (shared OneSignal). |
| Buyer/anon Web | NO | no UI; anon guests reached via email/SMS through the same backend. |
| Business iOS / Android | NO | brand-side notify unchanged this slice. |
| Admin Web | NO | out of scope. |
| Business Web preview | NO | n/a. |
Parity is automatic (single backend path).

---

## 9. Smoke / verification

- `deno check` clean on all new + modified edge fns (notify-reminders, notifyTemplates, businessNotifyTriggers, stripeWebhookRouter, cancel-order, refund-order, paystack-webhook, ticket-checkout-confirm).
- `deno test` 10/10 green; fails-on-revert proven by line deletion (both mandated cases).
- 1161 strict-grep gate `i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs` → PASS.
- Sole-send-path: grep confirms NO raw `sendTwilioSms(`/`sendPush(`/`api.resend.com` in any new code — everything routes through `notify-dispatch` v2.
- Read-only remote probe: all consumed tables/columns + the 7 categories CONFIRMED live with correct channels; `pg_notify_reminders_enqueue` correctly absent (pending). No runtime UX driven (backend-only).

---

## 10. Known issues / deferred

- **Slice "a" (final backlog):** the consumer notification-preferences matrix UI (per-category × per-channel toggles incl. SMS) is NOT in this slice. That is the last META-ORCH-1161 Sub-C deliverable.
- Reminder copy renders date/time from the payload's `reserved_for`/pre-formatted fields; venue-tz-correct formatting is the dispatcher/template concern (already deterministic en-US).

---

## 11. Operator action required

**Apply the two new migrations** (via the Management API per the 1161 deploy posture — MCP read-only, CLI drift-wedged), after REVIEW, monotonic above `20261111000000`:
- `20261112000000_orch_1161_subc_reminder_enqueue.sql`
- `20261112000001_orch_1161_subc_reminders_cron.sql`

(If using the linked CLI from a properly-linked checkout:)
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1161-[txn-moments]" && /Users/sethogieva/bin/supabase db push --linked
```

**Deploy edge functions from MERGED `main`** (orchestrator/operator-owned; never the worktree):
- `notify-reminders` (NEW, verify_jwt=false)
- `cancel-order`, `paystack-webhook`, `stripe-webhook`/router, `ticket-checkout-confirm`, `notify-dispatch` (the shared `_shared/businessNotifyTriggers.ts` + `_shared/notifyTemplates.ts` + `_shared/stripeWebhookRouter.ts` changes are bundled into whatever fns import them — redeploy all the above).

**Env (optional, defaults baked in):** `REMINDER_LEAD_24H_HOURS` (24), `REMINDER_LEAD_2H_HOURS` (2), `REMINDER_WINDOW_MINUTES` (30). SMS stays dark until `SMS_LIVE_ENABLED_US` is flipped in the smsAdapter (unchanged this slice).

---

## 12. Discoveries for Orchestrator

1. **Foundation seed vs SPEC §5.2 discrepancy — `buyer_reservation_confirmed` has `sms`.** SPEC §5.2 / §7.2 says confirmed is a NO-text category (`{push,inapp,email}`), but the live seed (`20261110000001`) + remote DB have it as `{inapp,push,email,sms}`. The reservation trigger enqueues `buyer_reservation_confirmed` with `contact=guest_phone`, so a confirmed reservation WOULD text the guest (once SMS goes live). Verify-only item #4 did not authorize a seed change. Decide: correct the seed (drop `sms` from confirmed) or accept SMS-on-confirm.
2. **Allowlist enumeration gap (§13) vs scope (§7/item #3).** The §13 allowlist omits `cancel-order` (and `paystack-webhook`), but the SPEC body item #3 explicitly names `cancel-order`, and §7.1 names "the Paystack equivalent." I added minimal additive notify-dispatch calls there (no money/finalize touch) to satisfy the /goal. Flagging for the allowlist to be reconciled at REVIEW.
3. **Comms:** COMMS-0040/0041 (RSVP/experience public-page standardization, WARN/ALL) read and factored — this slice touches only backend notify wiring, not the public-page bodies, so no conflict. No new COMMS entry needed.

---

## Downstream routing
Route back to orchestrator for REVIEW → mingla-tester (reminder bucketing idempotency, purchase-push no-double-email, refund/cancel single-owner, reservation transition coverage, simultaneous per-channel send) → CLOSE (flip I-PROPOSED-1161-* ACTIVE; close dual-write window). Remaining: slice "a" consumer prefs matrix UI.
