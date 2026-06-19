# INVESTIGATE — META-ORCH-1161 — Code Recon (what exists today)

**ORCH:** META-ORCH-1161
**Phase:** INVESTIGATE (internal code recon, 3 parallel Explore agents)
**Date:** 2026-06-18
**Purpose:** the "exists vs net-new" ground truth for `SPEC_META-ORCH-1161_*`. forensics MUST read the cited files to pin exact contracts (signatures, column names, request/response shapes) before writing the spec.

---

## A. Marketing blast system — EXISTS, email-only (ORCH-0815 Phase B)

**Dispatcher:** `supabase/functions/marketing-send/index.ts` (~843 lines).
- Triggers: pg_cron (every minute, service-role) OR composer "Send now" (`{campaign_id}` + user JWT).
- Channel routing `dispatchByKind()` (~line 250): `email` → `sendEmail()` (Resend, per-brand `<slug>@usemingla.com`, HTML+text, click-rewrite, unsubscribe token); **`sms` → `throw new Error("sms_not_yet_enabled")` (~line 261); `rcs` → throw (~line 263).** ← the one wire to cut for Sub-B.
- Live gate: `MARKETING_SEND_LIVE_ENABLED` (default false → writes `status='preview_skipped'`, zero Resend calls).
- Audience resolved via `_shared/marketingAudience.ts` `resolveAudience(query_definition)` (queries `orders` paid/partial_refund, joins events/brands, left-joins `marketing_unsubscribes`). Per-contact consent flags `email_marketing_ok` / `sms_marketing_ok` computed; loop currently skips non-email.
- Email render: `_shared/marketingEmailRender.ts`. Click tracking: `marketing-track-click` (`/m/{tracking_id}`, first-click, UTM). Unsubscribe: `marketing-unsubscribe` (`/unsubscribe/{signed_token}`, HS256, scope brand|global, idempotent; **already supports `channel` incl sms + `contact_phone`**).

**Schema:** `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql` — ALL already SMS-shaped:
- `marketing_audiences` (query_definition jsonb: brand_buyers|event_buyers|brand_followers|custom_segment).
- `marketing_templates` (channel CHECK email|sms|rcs; subject NULL for sms).
- `marketing_campaigns` (channel + channel_payload, CHECK payload.kind=channel).
- `marketing_messages` (recipient_email, **recipient_phone**, channel, provider_message_id, status incl bounced/delivered/unsubscribed/preview_skipped, click_count).
- `marketing_clicks` (tracking_id UNIQUE, ip_hash).
- `marketing_unsubscribes` (contact_email XOR contact_phone, channel email|sms|rcs|all, scope account|brand|global; phone + email unique indexes per channel/scope).

**UI (business app):** `mingla-business/app/brand/[id]/blasts.tsx` (buyer list + "Blast these N" CTA); composer steps Who/What/When/Compliance; **`mingla-business/src/components/marketing/ChannelTabs.tsx` — `{kind:'sms', enabled:false, caption:'pending'}` and rcs same** ← enable for Sub-B. Types `mingla-business/src/types/marketing.ts` (`ChannelPayloadSms{kind,body,short_url_token?}`, `AudienceReachSummary{total,reachable_email,reachable_sms}` — sms reach computed, NOT displayed). Services `marketingCampaignService.ts`, `marketingAudienceService.ts`.

**Gap for SMS blasts (Sub-B):** wire a Twilio sender into the dispatcher (replace the throw, ideally via the Sub-A `smsAdapter`), enable the tab, display SMS reach, ensure audience resolver checks phone-keyed suppression, capture compliant **marketing** consent (separate from transactional), quiet-hours + segment/cost guard + branded short links + throttling.

---

## B. Twilio — ALREADY live + production-proven (5 sites; generalize, don't invent)

- **`supabase/functions/send-venue-sms/index.ts` (META-ORCH-1148 2.1b)** — THE pattern to generalize: **Twilio-APPROVED toll-free Messaging Service (+1 888-250-5351)**, E.164, `venue_sms_opt_out` ledger + `venue_sms_log` audit, STOP via Twilio Advanced Opt-Out, locked copy. Env: `TWILIO_ACCOUNT_SID/_AUTH_TOKEN/_MESSAGING_SERVICE_SID` (+ status callback secret). DRAFT invariants sms-from-approved-tollfree-only / sms-opt-out-honored.
- **`ticket-confirmation-dispatch/index.ts`** — buyer ticket SMS (`sendTwilioMessage()`) + email (Resend, PDF+ics); status callbacks via `twilio-message-status`. Idempotent on `ticket_order_notifications.idempotency_key`; retry via `notification-retry-sweeper` (5-min cron, max 3, exp backoff).
- **`send-otp` / `verify-otp`** — Twilio **Verify** (SMS/WhatsApp/call). Keep OTP here (A2P-exempt).
- **`send-phone-invite`**, **`send-pair-request`** — Twilio Messaging Service / from-number SMS.

## C. Transactional / lifecycle notifications — map + gaps

**Push:** OneSignal via `_shared/push-utils.ts` `sendPush()`/`sendPushToMany()` — **dual-app routing** (type prefix `business.*`/`stripe.*` → business app; else consumer app); external_id = auth.users.id. Client: `app-mobile/src/services/oneSignalService.ts`, `mingla-business/...`.
**Preferences/dispatch (push+in-app only):** `notify-dispatch/index.ts` — `notification_preferences` table (push_enabled + per-category bools), `typeToPreference` map, quiet hours 10 PM–8 AM user-TZ, session-mute. Helper `_shared/stripeEdgeAuth.ts` `dispatchNotification()` (fire-and-forget).

| Event | Buyer | Brand | Source |
|---|---|---|---|
| Ticket purchase (event/trip/experience) paid | **EMAIL (PDF+ics) + optional SMS** | PUSH (business.order_paid / sold_out / low_inventory) | `stripeWebhookRouter.ts` finalize ~1061; `businessNotifyTriggers.ts` |
| Refund issued | EMAIL (generic) | PUSH (business.refund_processed) | `stripeWebhookRouter.ts` ~898 |
| Order cancelled | EMAIL (generic) | none | `cancel-order` |
| **Venue reservation create/confirm/change/cancel** | **NONE** | **NONE** | **no impl — NET-NEW (Sub-C)** |
| Booking deadline expired | none (audit only) | none | `process-booking-deadlines` |
| Board-card RSVP (collab) | push + in-app | — | `notify-dispatch` |
| Waitlist spot open | email + SMS | — | `ticket-confirmation-dispatch` |
| Waitlist table-ready (venue) | **SMS** (send-venue-sms) | — | `send-venue-sms` |

**No unified dispatcher** — 3 ad-hoc senders: `notify-dispatch` (push/in-app), `ticket-confirmation-dispatch` (email/SMS), `marketing-send` (email). Brand-side is push-only (no email/SMS). Buyer gets no push on purchase. **Reservations notify no one** (data model exists: `reservations` 8-state + `venue_waitlist`, META-ORCH-1148 2.0/2.1).

**Gap for Sub-C:** purchase confirmation → route through Sub-A dispatcher (push-first); **reservation confirmed/changed/cancelled → NET-NEW across channels**; **pre-event/trip/reservation reminder → NET-NEW scheduled job**. All push-first/SMS-fallback, transactional consent.

---

## D. Contact data + consent — inventory & gaps

| Data | Captured? | Where | Required | Validated | Verified | Consent |
|---|---|---|---|---|---|---|
| Buyer email | ✓ | `orders.buyer_email` | yes | regex | no | session opt-in only |
| Buyer phone | ✓ | `orders.buyer_phone` + **`buyer_phone_e164`**, `ticket_checkout_sessions.buyer_phone_e164 NOT NULL` | yes | E.164 (`^\+[1-9]\d{1,14}$`) | **NO (format only)** | session opt-in only |
| Buyer country | ✗ | — (inferred from `events.venue_tax_address`) | — | — | — | — |
| Consumer phone | ✓ | `profiles.phone` | onboarding | E.164 | **✓ Twilio Verify** | — |
| Consumer country | ✓ | `profiles.country` (ISO-2) | optional | — | — | — |
| Marketing opt-in | partial | `ticket_checkout_sessions.marketing_opt_in` (default false) — **NOT persisted to `orders`** | no | — | — | session only |
| `marketing_consent` (Phase-0 foundation) | ✗ | NOT SHIPPED (planned in `MARKETING_HUB_INFRASTRUCTURE_GAP_ANALYSIS.md`) | — | — | — | — |
| Unsubscribe/suppression | ✓ | `marketing_unsubscribes` (email/phone, channel, scope) | — | — | — | row presence |

**Gaps for Sub-A (consent foundation):** persist marketing opt-in durably (not session-only); capture **buyer country** at checkout (drives SMS region/quiet-hours/compliance); build the **`marketing_consent`/consent-audit** model (separate transactional vs marketing scope); buyer phone is NOT OTP-verified (decide if needed for SMS); audience resolver must check **phone-keyed** suppression for SMS.

---

## E. Reuse map (so the spec doesn't reinvent)

| Need | Reuse |
|---|---|
| SMS send + opt-out ledger + STOP | `send-venue-sms` (toll-free, approved) → generalize to shared `smsAdapter` |
| SMS delivery status webhook | `twilio-message-status` → generalize |
| Push send + dual-app routing | `_shared/push-utils.ts` |
| Email send/render | Resend via `ticket-confirmation-dispatch` + `_shared/email/*` (transactional), `marketing-send`/`marketingEmailRender` (marketing) |
| Preferences + quiet hours + idempotency + retry | `notify-dispatch`, `notification_preferences`, `ticket_order_notifications`, `notification-retry-sweeper` |
| Blast audiences / unsubscribe / click | `marketing_*` tables + `marketing-send`/`-track-click`/`-unsubscribe` |
| Reservation data model | `reservations` (8-state) + `venue_waitlist` (META-ORCH-1148) |
| OTP (keep separate, A2P-exempt) | `send-otp`/`verify-otp` (Twilio Verify) |
