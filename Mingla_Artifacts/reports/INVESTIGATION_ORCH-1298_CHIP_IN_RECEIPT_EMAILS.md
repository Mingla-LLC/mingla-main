# INVESTIGATION — ORCH-1298 [chip-in-receipt-emails]

Child of the chip-in program (ORCH-1291/1295/1296/1297 SHIPPED + LIVE). Seth wants a receipt when a
voluntary chip-in gift clears, for BOTH the guest (a gift-framed thank-you) and the host (a positive
"you received a gift" moment). Today a paid chip-in sends NOTHING.

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1298-[chip-in-receipt-emails]/` on branch `ORCH-1298-chip-in-receipt-emails` (rebased on origin/main; has all chip-in work).
- **Mode:** INVESTIGATE (backend/SQL/edge — exempt from sim live-fire per Prime Directive 7).
- **Confidence:** `proven` (source-conclusive; no runtime needed — the gap is the total ABSENCE of enqueue code, which is a static fact).
- **COMMS ledger:** scanned. No BLOCK+OPEN row targets forensics / ORCH-1298 / ALL. Relevant WARN/FYI: COMMS-0046 (META-ORCH-1161 notif decisions renumbered DEC-187/188), COMMS-0063/0052 (business OTA bricks — N/A, this is backend+email, no OTA), COMMS-0066 (OneSignal optIn stale-cache — app-side, not the backend enqueue).

---

## Symptom summary (expected vs actual)

| | Behaviour |
|---|---|
| **Expected** | When a chip-in contribution flips to `paid`, the guest receives a gift-framed email receipt ("thanks for your $X gift to {event}") and the host is told "someone chipped in $X to {event}". |
| **Actual** | A paid contribution flips `event_rsvp_contributions.status='paid'` and does nothing else. No email, no push, no in-app row — for either party. The dispatch confirms 0 rows in `notification_deliveries` for the live test contribution; the code proof below shows WHY (there is no enqueue anywhere on the contribution finalize path). |

---

## Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `supabase/migrations/20261220000000_orch_1291_rsvp_contributions.sql` | The finalize RPC + contribution table shape (the enqueue point). |
| 2 | `supabase/functions/_shared/stripeWebhookRouter.ts` | Stripe rail → contribution finalize. |
| 3 | `supabase/functions/rsvp-contribution-create/index.ts` | How the pending row is written (guest_email/user_id capture; anon path). |
| 4 | `supabase/functions/_shared/paystackWebhookRouter.ts` | Paystack rail → contribution finalize (dual-rail proof). |
| 5 | `supabase/functions/paystack-webhook/index.ts` | Paystack webhook entry + finalize invocation. |
| 6 | `supabase/migrations/20261110000000_orch_1161_notification_foundation_tables.sql` | The 6 notification tables (outbox, deliveries, categories, …). |
| 7 | `supabase/migrations/20261110000001_orch_1161_seed_notification_categories.sql` | Category taxonomy + channels (where a new category is seeded). |
| 8 | `supabase/migrations/20261110000002_orch_1161_can_send_and_reservation_trigger.sql` | The `can_send` consent gate + the reservation→outbox trigger (the SQL-enqueue mirror). |
| 9 | `supabase/migrations/20261110000003_orch_1161_outbox_drain_cron.sql` | The 1-min pg_cron that drains the outbox. |
| 10 | `supabase/migrations/20261110000004_orch_1161_atomic_claim_and_guest_ledger.sql` | `claim_notification_outbox` (SKIP LOCKED) + guest `notification_deliveries.contact/idempotency_key`. |
| 11 | `supabase/functions/notify-outbox-drain/index.ts` | Outbox → notify-dispatch v2 mapping (passes `contact` through). |
| 12 | `supabase/functions/notify-dispatch/index.ts` | The v2 (`category_key`) vs legacy (`type`) split; email/push send. |
| 13 | `supabase/functions/_shared/notifyV2.ts` | `dispatchV2` + `dispatchAnon` (anon-email path). |
| 14 | `supabase/functions/_shared/notifyTemplates.ts` | `renderCategoryMessage` — where a category_key becomes copy. |
| 15 | `supabase/functions/_shared/adapters/pushAdapter.ts` + `_shared/push-utils.ts` | OneSignal app routing (`business.*` → business app). |
| 16 | `supabase/functions/_shared/adapters/emailAdapter.ts` | Resend branded `generic_notification` send. |
| 17 | `supabase/functions/ticket-confirmation-dispatch/index.ts` | The ticket BUYER-email mirror (`ticket_order_notifications` + `template_key` + Resend). |
| 18 | `supabase/functions/_shared/businessNotifyTriggers.ts` + `_shared/stripeEdgeAuth.ts` | The ticket HOST-notification mirror (`notifyBrandRoles` → `dispatchNotification` → business-app push + in-app). |

---

## Q-scorecard

### Q1 — What fires on a paid chip-in TODAY?
**Verdict: NOTHING — for either party. `proven` (static-conclusive).** The finalize RPC and both webhook
handlers flip the row to `paid` and return; there is zero notification enqueue on the contribution path.
See **F-1**.

### Q2 — What is the notification pipeline, and how does a template/category become an email?
**Verdict: TWO live mechanisms.** (a) The **v2 outbox path** (META-ORCH-1161): a SQL INSERT into
`notification_outbox` → 1-min cron `notify-outbox-drain` → `notify-dispatch` (v2 branch) → `dispatchV2`
→ `renderCategoryMessage(category_key,payload)` → adapters (email=Resend branded, push=OneSignal,
sms=Twilio). (b) The **legacy type path** (`dispatchNotification`) and the **ticket-order path**
(`ticket_order_notifications` + `template_key` → `ticket-confirmation-dispatch` → Resend w/ PDF).
See **F-2**, **F-3**.

### Q3 — What is the ticket buyer-confirmation mirror, and the RSVP-notification pattern?
**Verdict:** the ticket BUYER **email** rides `ticket_order_notifications.payload.template_key` drained
by `ticket-confirmation-dispatch`; the ticket HOST alert (`business.order_paid`, "New sale 🎉") rides
`notifyBrandRoles → dispatchNotification` = **business-app push + in-app, NO email**. The RSVP/reservation
pattern (ORCH-1161/1195) enqueues an outbox row in SQL and drains it to email including **anon guests by
raw contact**. See **F-3**, **F-6**.

### Q4 — Can the guest be reached (anon has only guest_email/guest_name)?
**Verdict: YES, `proven`.** `dispatchAnon` (notifyV2.ts) sends to a raw `contact` email with NO account,
and `notify-outbox-drain` passes `contact` straight through. A logged-in guest resolves via `user_id`
(and `auth.users.email` if `guest_email` is null). **No scope change — NOTIFY-LIST NOT triggered.** See **F-4**.

### Q5 — Can the host be reached, and on which channels?
**Verdict: YES.** Host = brand team via `brand_team_members` (roles owner/admin/finance). Business-app
push is delivered ONLY when the notification `type`/category key is `business.*`/`stripe.*`
(`resolveOneSignalApp`). The existing ticket-sale host notification is **push + in-app ONLY (no email)** —
so Seth's "host = email + push/in-app" is a superset of current parity; the email leg is a NET-NEW
addition (flagged in the SPEC's Open Questions). See **F-5**, **F-6**.

### Q6 — Single idempotent enqueue point covering BOTH rails?
**Verdict: YES — `finalize_rsvp_contribution`'s non-replay branch.** BOTH the Stripe router and the
Paystack router call this ONE RPC; it early-returns on an already-`paid` row (idempotent replay) and
serializes concurrent webhooks via `SELECT … FOR UPDATE`. Enqueue there = write ONCE, both rails, exactly
once per paid contribution. See **F-1**, **F-7**.

---

## Findings (six-field evidence)

### F-1 — `finalize_rsvp_contribution` has ZERO enqueue; both rails call it and neither notifies. *(CONFIRMED ROOT CAUSE)*
- **Symptom:** a paid chip-in produces no email/push/in-app for guest or host.
- **Layer:** schema (RPC) + code (edge routers).
- **Probe:** read `20261220000000_orch_1291_rsvp_contributions.sql` §5 + `stripeWebhookRouter.ts` `handleRsvpContributionEvent` + `paystackWebhookRouter.ts` contribution branch.
- **Evidence:**
  - RPC body (`20261220000000_orch_1291_rsvp_contributions.sql:226-280`) does exactly: `SELECT … FOR UPDATE` → idempotent early-return if `status='paid'` → `UPDATE … SET status='paid', paid_at=now(), …` → `RETURN jsonb_build_object('ok',true,'idempotent_replay',false,…)`. **No INSERT into any notification table. No enqueue.**
  - Stripe handler `stripeWebhookRouter.ts:180-195`: `await supabase.rpc("finalize_rsvp_contribution", …)`; then reads `brand_id` and returns it. **No notification call.** (The RPC's `idempotent_replay` field is not even read.)
  - Paystack handler `paystackWebhookRouter.ts:126-135`: `await supabase.rpc("finalize_rsvp_contribution", …)`; `return { status: "finalized" }`. **No notification call.**
- **Mechanism:** because no code path enqueues a guest or host notification when a contribution flips to `paid`, the delivery ledger stays empty (0 rows) → nobody is told. This is the whole ORCH.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — The v2 outbox pipeline is complete and live; a pure-SQL INSERT reaches email + push. *(the enqueue mechanism)*
- **Symptom:** need a mechanism an SQL RPC can drive.
- **Layer:** schema + code.
- **Probe:** trace `notification_outbox` → cron → `notify-outbox-drain` → `notify-dispatch` → `dispatchV2`.
- **Evidence:**
  - `notification_outbox` (`20261110000000_orch_1161_…:135-157`): columns `category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status`; `UNIQUE(idempotency_key)`; partial index on `status='pending'`.
  - Cron `20261110000003_…`: job `orch_1161_notify_outbox_drain`, `* * * * *`, POSTs `/functions/v1/notify-outbox-drain`.
  - `notify-outbox-drain/index.ts:51,88-101`: `claim_notification_outbox` (atomic claim) → POST `notify-dispatch` with `{category_key, user_id, contact, payload(+brand_name), idempotency_key, country_code}`; on failure re-queues (attempts<3) else `failed` (no silent drop).
  - `notify-dispatch/index.ts:252-303`: a `category_key` payload takes the **v2 branch** → `dispatchV2`.
  - `notifyV2.ts:78-217`: loads the category, `renderCategoryMessage`, inserts the inbox row (23505-idempotent on `notifications.idempotency_key`), writes inapp delivery, then for each `default_channels` channel passes `can_send` and fires the adapter.
- **Mechanism:** an INSERT into `notification_outbox` from inside the finalize RPC is drained within ≤60s and fanned out across the category's channels — a fully SQL-drivable, durable, idempotent send path.
- **Severity:** (mechanism, not a defect).

### F-3 — How a category/template becomes real content; the ticket buyer-email mirror. *(the render + mirror)*
- **Layer:** code.
- **Probe:** read `notifyTemplates.ts`, `emailAdapter.ts`, `ticket-confirmation-dispatch/index.ts`.
- **Evidence:**
  - `notifyTemplates.ts:58-231` `renderCategoryMessage(categoryKey, payload)` is a `switch` returning `{push:{title,body}, email:{subject,body}, sms}`; unknown keys hit the `default` (renders `payload.title`/`payload.body`). Currency-aware `fmtAmount(payload)` (lines 24-39) formats `amount_cents`+`currency` via `Intl.NumberFormat`.
  - `emailAdapter.ts:34-70`: renders `renderTransactionalEmail({variant:'generic_notification', …})` → Resend HTTP (branded HTML+text). This is the guest-email render path for a v2 category.
  - Ticket buyer email mirror: `ticket-confirmation-dispatch/index.ts:1064-1103` selects `ticket_order_notifications` rows `WHERE order_id=…` and routes by `payload.template_key` (default `buyer_ticket_confirmation`); `sendResendEmailWithAttachment` (lines 88-123) sends via Resend with the ticket PDF + `.ics`. **This dispatcher is order-centric** (`.eq("order_id", orderId)`) — a contribution has no order, so it is NOT directly reusable without new plumbing (its order-less `notificationId` path only handles `waitlist_spot_open`).
- **Mechanism:** the gift receipt is a simple branded email — the v2 category render (`generic_notification`) is the right shape; the rich ticket dispatcher is a poorer fit (order-scoped, PDF-oriented).
- **Severity:** (mechanism).

### F-4 — Guest reachability is proven for BOTH anon and logged-in. *(reachability — NOTIFY-LIST cleared)*
- **Layer:** code + data.
- **Probe:** read `dispatchAnon` + `rsvp-contribution-create` row writes + the drain contact passthrough.
- **Evidence:**
  - `rsvp-contribution-create/index.ts:119-124`: anon buyers MUST give a valid `guestEmail` (400 `guest_email_required` otherwise); it is persisted to `event_rsvp_contributions.guest_email` (lines 267-283 Paystack / 381-396 Stripe) alongside `user_id` (null for anon).
  - `notifyV2.ts:227-289` `dispatchAnon`: when `user_id` is null it skips inapp/push and sends **email/sms to the raw `contact`** (here `guest_email`), writing a durable contact-keyed `notification_deliveries` row with `(idempotency_key, channel)` dedupe.
  - `notify-outbox-drain/index.ts:98` forwards `contact: row.contact ?? null` — so an outbox row with `contact=guest_email` reaches `dispatchAnon`.
- **Mechanism:** the system can email a raw address with no account (this is exactly the reservation-guest email pattern). A logged-in guest resolves via `user_id`; if `guest_email` is null the RPC can COALESCE `auth.users.email`. **No new dependency/secret — NOTIFY-LIST NOT triggered.**
- **Severity:** (reachability confirmation).

### F-5 — Host reachability + the business-app push routing rule. *(reachability)*
- **Layer:** code.
- **Probe:** read `getBrandTeamUserIdsByRoles`, `resolveOneSignalApp`, `pushAdapter`.
- **Evidence:**
  - `stripeEdgeAuth.ts:92-110` `getBrandTeamUserIdsByRoles(brandId, roles)` → `brand_team_members` where `removed_at IS NULL AND accepted_at IS NOT NULL AND role IN (…)`. `BRAND_PAYMENTS_ROLES = [brand_owner, brand_admin, finance_manager]`.
  - `push-utils.ts:52-57` `resolveOneSignalApp(type)`: `business.*`/`stripe.*` → **business app**; else consumer. Business creds absence never falls back to consumer (SC-A2).
  - `pushAdapter.ts:25-33`: v2 push calls `sendPush({ app: resolveOneSignalApp(input.routingType) })` where `routingType = category_key`. **⇒ a `business.`-prefixed category key routes the host push to the business app through the v2 path.**
  - In-app inbox: `dispatchV2` inserts `notifications.type = category_key`; the business client prefix-filters `business.*` (I-PROPOSED-W) so it lands in the business inbox.
- **Mechanism:** to deliver a host push to the business app via the v2 outbox path, the host category key must be `business.`-prefixed (e.g. `business.rsvp_contribution_received`). Fan-out = one outbox row per team member (v2 push targets a single `user_id`).
- **Severity:** (reachability confirmation).

### F-6 — The ticket-sale host notification is push + in-app ONLY (no email). *(parity truth — answers "if the host already gets a generic push, say so")*
- **Layer:** code.
- **Probe:** read `fireOrderFinalizeNotifications` / `notifyBrandRoles`.
- **Evidence:** `businessNotifyTriggers.ts:343-380` — on a paid ticket order, `business.order_paid` ("New sale 🎉", body `"{event}: {amount} just came in."`) is dispatched via `notifyBrandRoles → dispatchNotification` to owner/admin/finance. `dispatchNotification` (`stripeEdgeAuth.ts:158-194`) writes the in-app row + fires push; **it sends email only if `emailTo` is passed — and this call site passes none.** So the host today gets **push + in-app, NO email** on a sale.
- **Mechanism:** "match the ticket-sale host notification" = push + in-app. Seth's "host email" is therefore an intentional ADDITION for the gift moment, not existing parity. (Delivered cleanly via a brand-contact-email leg; flagged as an Open Question.)
- **Severity:** SUSPECTED CONTRIBUTOR (scope-shaping, not a defect).

### F-7 — Idempotency is airtight at the RPC + reinforced at every downstream layer. *(idempotency proof)*
- **Layer:** schema + code.
- **Evidence:**
  - RPC: `SELECT … FOR UPDATE` serializes concurrent webhooks; the first flips `pending→paid` and returns `idempotent_replay:false`; the second sees `status='paid'` and returns `idempotent_replay:true` (`20261220000000_…:239-278`). ⇒ the non-replay branch runs **exactly once** per contribution.
  - Enqueue-once: `notification_outbox.idempotency_key` is UNIQUE (`…:153`) → `ON CONFLICT DO NOTHING` collapses any duplicate.
  - Drain-once: `claim_notification_outbox` uses `FOR UPDATE SKIP LOCKED` (`20261110000004_…`) so two cron ticks never claim the same row.
  - Send-once: `dispatchV2` dedupes on `notifications.idempotency_key` (23505) for the user path; `dispatchAnon` dedupes on `notification_deliveries (idempotency_key, channel)` for the anon path.
- **Mechanism:** four independent guards mean a replayed webhook re-sends NOTHING.
- **Severity:** (idempotency confirmation).

### F-8 — DUAL RAIL confirmed: one RPC, both providers. *(dual-rail proof)*
- **Evidence:** Stripe `stripeWebhookRouter.ts:180` and Paystack `paystackWebhookRouter.ts:126` both `rpc("finalize_rsvp_contribution", …)`. `grep finalize_rsvp_contribution supabase/` returns exactly these two callers (+ the migration + its test). ⇒ enqueuing inside the RPC covers Stripe AND Paystack with ONE write.
- **Severity:** (dual-rail confirmation).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| **Docs** | ORCH-1291 SPEC framed the contribution as a gift (no tax/invoice). Notifications were out of ORCH-1291 scope. | none — this ORCH fills the intentional gap. |
| **Schema** | `finalize_rsvp_contribution` flips `paid` only; `notification_outbox`/`_categories`/`_deliveries` fully built by ORCH-1161. | none. |
| **Code** | Neither webhook router notifies on a contribution. The v2 pipeline exists but no producer targets contributions. | The gap IS the bug (F-1). |
| **Runtime** | Not exercised (backend). Static proof is conclusive; the dispatch's "0 rows in notification_deliveries" corroborates. | none. |
| **Data** | Live test contribution reached `paid` with 0 delivery rows. | consistent with F-1. |

---

## Repro evidence

Backend/SQL investigation — no simulator repro required (Prime Directive 7 exemption for
pure-backend/edge/RPC). The "repro" is static-conclusive: the finalize path contains no enqueue
statement of any kind (F-1), which is why the live test contribution produced 0 `notification_deliveries`
rows. This is a total-absence defect, not a timing/state bug.

---

## Blast radius / cross-surface map

- **In scope (backend-only + email/push, NO app-screen UI):** `finalize_rsvp_contribution` (the enqueue), the notification seed/categories, `renderCategoryMessage` copy, the guest email (Resend), the host push (OneSignal business app) + in-app. Covers BOTH rails (Stripe + Paystack) via the single RPC.
- **Out of scope:** Consumer/Business iOS/Android app UI (no screen change — the receipts are email/push/inbox), Admin Web, Buyer web UI. Refund/cancellation receipts (fast-follow). SMS (categories carry no `sms` channel → DC-3 preserved).
- **Not a recurring pattern** — this is the first notification producer for contributions.

## Invariant impact (flagged, not pre-decided)

- **I-PROPOSED-W (notifications-app-type-prefix)** — PRESERVED and RELIED ON: the host category `business.rsvp_contribution_received` routes push to the business app precisely because it is `business.`-prefixed. Gate `i-proposed-w-notifications-app-type-prefix.mjs`.
- **DC-3 (closed SMS set / I-PROPOSED-1161)** — PRESERVED: new categories have NO `sms` in `default_channels`, so they can never reach SMS. Gate `i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs`.
- **I-PROPOSED-BA (ORCH-0788 template-key dispatched)** — UNAFFECTED: this design uses `category_key` (v2), not `ticket_order_notifications.template_key`, so the ticket dispatcher is not touched.
- **I-PROPOSED-V (stripe-notification-via-shared)** — UNAFFECTED: the enqueue lives in the RPC, not the stripe webhook, so no new notification code is added to `stripeWebhookRouter.ts`.
- Money math / paid-flip / chip-in UI — UNTOUCHED (hard guard).

## Discoveries for Orchestrator

- **D-1 (latent, pre-existing):** the seeded `payout_paid` category (channels `{inapp,push,sms}`) is NOT `business.`-prefixed, so IF its push were ever dispatched via the v2 path it would target the CONSUMER app. Today the live payout push uses the legacy `business.payout_paid` type path, so it is correct — but the seed row is a trap for a future v2 migration. Not in ORCH-1298 scope; register for META-ORCH-1161 hygiene.
- **D-2:** the guest email currency is formatted in `renderCategoryMessage.fmtAmount` with a hardcoded `en-US` locale (currency itself is honoured). Acceptable for v1; a per-locale follow-up could pass the buyer locale. Not blocking.

## Confidence

`proven` — the defect is the total absence of enqueue code on the finalize path (a static fact), and
every downstream mechanism the fix will use (outbox → cron → dispatchV2 → adapters; anon-email;
business-app push; four idempotency guards) was read line-by-line and confirmed live.

## Recommended next phase + scope (direction only)

SPEC (this pass) → IMPLEMENT (mingla-implementor) → orchestrator applies migration + deploys the two
edge fns → TEST (live-fire a real chip-in on both rails; confirm guest email + host push/in-app arrive
exactly once) → CLOSE. Scope: ADD a two-notification enqueue to `finalize_rsvp_contribution`'s non-replay
branch (pure SQL, both rails), two new seeded categories, two `renderCategoryMessage` cases, and the
gift-framed copy. Do NOT touch money math, the paid-flip, or the chip-in UI.
