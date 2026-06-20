# TEST — META-ORCH-1161 Sub-C slice "b" (transactional moments)

**ORCH:** META-ORCH-1161 Sub-C (slice "b")
**Phase:** TEST (adversarial gatekeeper)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[txn-moments]/` on branch `ORCH-1161-txn-moments`
**Under-test HEAD:** `2de27008e` (impl `c443e18c6` + seed-correction `2de27008e`)
**Tester commit (adversarial test):** `d967b951e`
**Author:** mingla-tester (Claude)
**Date:** 2026-06-20
**Mode:** SPEC-COMPLIANCE + TARGETED (backend/SQL/edge-only → source-only exemption applies; migrations + seed verified against REAL Postgres `gqnoajqerqhnvulmnyvv`)

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2.

Regression gate: SATISFIED (implementor happy-path tests on-branch + tester adversarial on-branch, both fails-on-revert proven). Backend-only exemption from the live-fire sim gate (no UI/runtime surface touched; pure edge-fn/SQL additive wiring).

The single condition: **the seed-correction migration `20261112000002` and the two cron/RPC migrations are NOT yet applied to remote** (verified live — `pg_notify_reminders_enqueue` absent, `buyer_reservation_confirmed` still carries `sms`). This is by-design (operator applies migrations; tester Hard-Guard forbids applying). The CODE is correct; it must be DEPLOYED+APPLIED before close. SMS is text-dark so there is **zero live blast radius today**. CONDITIONAL on operator applying the three migrations + deploying the edge fns from merged main.

---

## 2. SC-by-SC matrix (runtime/live evidence)

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | Reminder cron: exactly ONE per `{category}:{entityId}:{leadBucket}` across overlapping ticks; none for past/cancelled; reservations only upcoming+confirmed | **PASS (proven vs schema)** | Live `notification_outbox_idempotency_idx` UNIQUE on `(idempotency_key)` EXISTS. Reminder key `buyer_event_reminder:{order_id}:{24h\|2h}` / `buyer_reservation_reminder:{reservation_id}:{24h\|2h}` is **time-invariant** (no timestamp) → re-enqueue on an overlapping 15-min tick hits `ON CONFLICT DO NOTHING` → ZERO dup rows. Events filtered `status IN ('scheduled','live')` + `deleted_at IS NULL` (excludes draft/ended/cancelled — confirmed `events_status_check` enum; live data has 3 `cancelled`, 150 `draft`, 23 `scheduled`). Reservations filtered `status='confirmed'` + future window. All read columns confirmed live. |
| SC-2 | ~15-min cron registered | **PASS (source; pending apply)** | `20261112000001` schedules `orch_1161_notify_reminders` at `*/15 * * * *` with in-migration probes that RAISE if jobname/schedule mismatch. Mirrors the proven `20261110000003` drain cron. Not yet in remote `cron.job` (migration unapplied). |
| SC-3 | Purchase finalize → buyer push+inapp, email single-owned (NO double-email), idempotent/order | **PASS (test-proven)** | `fireBuyerPurchaseConfirmationPush` dispatches `category_key=buyer_purchase_confirmation`, `contact:null` → v2 email channel records `skipped` (email owned by ticket-confirmation-dispatch). Idempotency `buyer_purchase_confirmation:{orderId}`. Live category = `{inapp,push,email}` NO sms. Test asserts exactly 1 POST, contact null. |
| SC-3-Paystack | Same push on Paystack finalize | **PASS (source)** | `paystack-webhook` fires `fireBuyerPurchaseConfirmationPush` after `dispatchTicketConfirmation`, only on fresh `finalizedOrderId`, contact:null, try/catch non-fatal. Pure addition (0 deletions). |
| SC-4 | Refund → buyer push+inapp(+sms), email single-owned, idempotent/refundId | **PASS (test-proven)** | `handleRefundEvent` (single allowlisted chokepoint) fires `fireBuyerOrderNotify` key `buyer_refund_issued:{refundId}`, contact=phone → email skips. Live category `{inapp,push,email,sms}`. `refund-order` is doc-only (no second dispatch → no double-push). |
| SC-5 | Order-cancelled → buyer push+inapp(+sms), email single-owned, idempotent/order | **PASS (test-proven)** | `cancel-order` fires `fireBuyerOrderNotify` key `buyer_order_cancelled:{orderId}:{client-idem}` ONLY after `biz_cancel_order` RPC succeeds (RPC is the real double-cancel gate). contact=phone → v2 email skips; legacy `ticket_order_notifications` email is the single email owner. |
| SC-6 | Reservation confirmed/cancelled end-to-end via trigger→outbox→drain→dispatch | **PASS (proven live)** | Live trigger `orch_1161_reservation_notify_trg` → `orch_1161_reservation_notify_outbox()` enqueues `buyer_reservation_confirmed` (requested→confirmed) AND `buyer_reservation_cancelled` (→cancelled_by_guest/venue) into outbox; drain cron forwards generically. No gap; foundation, untouched by this slice. |
| SC-7 | SMS text-dark; DEC-185 simultaneous send; no fallback | **PASS (proven)** | Zero raw Twilio/Resend/OneSignal sends in the entire diff. smsAdapter kill-switch (`SMS_LIVE_ENABLED_*`, default false) returns `status:'skipped'` WITHOUT any HTTP call (line 168). All new moments route through `notify-dispatch` v2 → smsAdapter (sole send path). 1161 SMS strict-grep gate PASS. |
| SC-8 | No raw provider sends outside adapters | **PASS** | grep of `git diff origin/main...HEAD` for twilio/resend/onesignal/sendSms/messages.create → empty. |
| Migrations | `...0000/001/002` monotonic above remote head `20261111000000`, apply against real PG | **PASS (verified)** | Live `list_migrations` head = `20261111000000_orch_1161_marketing_sms_segments`. New three are `20261112000000/001/002` — strictly above. GRANT/REVOKE after `$function$;` (line 145<150-152) → no migration-baseline CI trip. Seed correction is idempotent `array_remove`. |
| Money-seam | finalize/refund/cancel money logic unchanged | **PASS (proven)** | `--numstat`: cancel-order/paystack/refund-order = 0 deletions (pure additions); stripeWebhookRouter's only deletion is the 1-line import expanded to multi-line. No money/RPC/finalize logic altered. |

---

## 3. Findings

### P4-1 (NOTE) — cancel-order buyer-notify key includes the client `Idempotency-Key` header
`cancel-order/index.ts:150` keys the buyer push on `buyer_order_cancelled:{orderId}:{client-header}`. A client retrying cancel with a DIFFERENT header value would produce a different key. **Not a defect**: `fireBuyerOrderNotify` only runs after `biz_cancel_order` succeeds (early-return on `rpcError||!result` at L104), and the RPC rejects a second cancel of an already-cancelled order → the buyer push fires at most once per successful cancel regardless of header variance. The suffix is harmless belt-and-braces.
*Required fix:* none. *Retest:* n/a.

### P4-2 (NOTE) — doc imprecision on the cancel-order email owner
The report says the cancel email is owned by `dispatchTicketConfirmation`; the actual owner is the legacy `ticket_order_notifications` insert in `cancel-order` itself (template_key `buyer_order_cancelled`). The no-double-email guarantee still holds (v2 leg passes contact=phone → email skips). Cosmetic only.
*Required fix:* none (doc). *Retest:* n/a.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out under-test HEAD `2de27008e`. Ran all three implementor tests: **10 passed | 0 failed**.

Independently reproduced the mandated revert proof (true line-level mutation of product code, then restored):
- Inserted an early `return;` before the `fetch` dispatch in `fireBuyerPurchaseConfirmationPush` (`businessNotifyTriggers.ts`) → `meta_orch_1161_subc_purchase_push.test.ts` test (1) FAILED (`captured.length` 0 ≠ expected 1) — exact assertion `assertEquals(captured.length, 1)`. Restored → PASS. Verified at `2de27008e`.

---

## 5. Adversarial test added (different angle)

**Path:** `supabase/functions/_shared/__tests__/meta_orch_1161_subc_refund_cancel_collision_adversarial.test.ts`
**Commit:** `d967b951e` (on branch `ORCH-1161-txn-moments`, in `git diff origin/main...HEAD --name-only`).

Different angle than the implementor (who tested each path in isolation):
- **ANGLE 1 — refund-then-cancel on the SAME order must NOT collapse.** Fires both `buyer_refund_issued` and `buyer_order_cancelled` on one order; asserts 2 dispatches with DISTINCT, non-colliding idempotency keys (no namespace cross-contamination) → the v2 dedupe cannot silently swallow one moment.
- **ANGLE 2 — Stripe refund-webhook re-delivery must COLLAPSE.** Same `refundId` delivered twice → asserts identical idempotency_key both times (proves the key is a pure function of refundId, NOT a timestamp/nonce) → v2 dedupe collapses to one buyer row.

**fails-on-revert verified at `2de27008e`:** mutated `fireBuyerOrderNotify` to append `Date.now()+Math.random()` to the forwarded idempotency_key → ANGLE 2 FAILED (the two keys diverge). Restored → 2 passed. Both implementor tests AND this adversarial test appear in the closing diff.

Full suite (all 5 subc test files): **12 passed | 0 failed**.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no UI |
| 2 | One owner per truth | **PASS** | email single-owned (ticket-confirmation-dispatch / ticket_order_notifications); v2 leg adds push/inapp/sms only via contact-null/phone. Refund single chokepoint (handleRefundEvent); refund-order doc-only. |
| 3 | No silent failures | **PASS** | reminders return 207 on partial failure (no swallow); buyer-notify helpers `console.warn` non-fatal by design (best-effort relative to money), never silently mark success. |
| 4 | One query key per entity | N/A | no client query keys |
| 5 | Server state server-side | N/A | edge-only |
| 6 | Logout clears | N/A | |
| 7 | Label `[TRANSITIONAL]` | N/A | no transitional code |
| 8 | Subtract before adding | **PASS** | additive wiring onto existing v2 path; no parallel send path introduced. |
| 9 | No fabricated data | **PASS** | reminder/refund copy interpolates real payload; default template renders plain payload, never fakes amounts/dates. |
| 10 | Currency-aware | **PASS** | `fmtAmount` uses `payload.currency` via Intl, no hardcoded £/$, no GBP fallback. |
| 11 | One auth instance | N/A | service-role clients in edge only |
| 12 | Validate at right time | **PASS** | reminder window computed from `now()` server-side; lead times env-driven. |
| 13 | Exclusion consistency | **PASS** | RPC excludes deleted/cancelled events + non-confirmed reservations; SMS exclusion (no-text categories) enforced via seed channels. |
| 14 | Persisted-state startup | N/A | |

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS | N/A (backend-only) | buyers receive push/inapp via shared backend; no app build/sim run required (no UI change). |
| Consumer Android | N/A (backend-only) | same shared OneSignal path. |
| Buyer/anon Web | N/A | no UI; anon guests reached via email/SMS (text-dark). |
| Business iOS/Android | N/A | brand-side notify unchanged this slice. |
| Admin Web | N/A | out of scope. |
| Business Web preview | N/A | n/a. |

Live-fire sim gate EXEMPT: pure edge-fn/SQL additive wiring, zero UI/runtime/interaction surface. Migration + seed + trigger + index state verified against REAL Postgres (project `gqnoajqerqhnvulmnyvv`) — the runtime evidence substitute for a backend change.

Edge-fn live deploy state (read-only): the new `notify-reminders` fn + the three migrations are NOT yet deployed/applied (expected — operator owns deploy from merged main). `pg_notify_reminders_enqueue` confirmed absent; `buyer_reservation_confirmed` still carries `sms` live.

---

## 8. Discoveries for Orchestrator

1. **Seed correction not yet live (the CONDITIONAL).** Live `buyer_reservation_confirmed.default_channels = {inapp,push,email,sms}` — migration `20261112000002` removes `sms` but is unapplied. Zero blast radius today (SMS text-dark). MUST be applied before any SMS go-live, else a confirmed reservation texts the guest contrary to DEC-185.
2. **No-text set verified against DEC-185 (post-correction).** Live no-sms categories already correct: `buyer_purchase_confirmation`, `marketing`, `reminders`, `messages`, `friend_requests`, `collaboration_invites` (social). `payment_failed` is not a seeded category (absence = no sms, acceptable). After `...0002`, `buyer_reservation_confirmed` joins the no-text set → SMS-eligible set is the transactional+marketing+payout closed set (reminders, reservation changed/cancelled, refund, order cancelled, marketing_blast, payout_paid, waitlist_spot_open). Matches DEC-185.
3. **Allowlist §13 vs §7 (ACCEPTED per dispatch).** §13 omitted cancel-order/paystack-webhook; §7 body required them. Confirmed additive-only (0 money deletions). Per dispatch this is an orchestrator decision, not a defect.
4. **COMMS-0040/0041 (RSVP/experience public-page standardization, WARN/ALL):** read; no conflict — this slice touches only backend notify wiring, not public-page bodies. No new COMMS entry.

---

## 9. Accepted conditions (CONDITIONAL PASS)

- **C-1:** Operator must apply migrations `20261112000000`, `20261112000001`, `20261112000002` (via Management API per the 1161 posture — MCP read-only, CLI drift-wedged) and deploy edge fns (`notify-reminders` NEW + cancel-order/paystack-webhook/stripe-webhook router/ticket-checkout-confirm/notify-dispatch) from MERGED main. Until then the reminder cron + seed correction are not live. SMS text-dark means zero risk while pending. This is the standard backend deploy posture, not a code defect.

**CLEAR-TO-CLOSE:** YES, conditioned on C-1 (apply 3 migrations + deploy edge fns from merged main). Code is correct and proven; the only gap is the operator-owned apply/deploy step that the tester is Hard-Guarded from performing.
