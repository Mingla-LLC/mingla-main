# SPEC — META-ORCH-1161 — Multi-Channel Notification & Messaging System

**ORCH:** META-ORCH-1161 (META with 3 sub-bodies: Sub-A foundation, Sub-B SMS marketing, Sub-C high-touch transactional)
**Phase:** SPEC (canonical build contract — for Seth REVIEW, then per-sub DESIGN/IMPLEMENT/TEST/CLOSE)
**Owner-driver:** Seth
**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-06-18
**Anchor truth:** read against `origin/main` (anchor checkout local `main` is STALE — see §13 R-1). All file/line anchors below are `origin/main` truth as of `a58f46ffa`.
**Inputs (canonical, do not re-derive):**
- `Mingla_Artifacts/investigations/INVESTIGATE_META-ORCH-1161_CODE_RECON.md`
- `Mingla_Artifacts/investigations/INVESTIGATE_META-ORCH-1161_SMS_COMPLIANCE_RESEARCH.md`
- `Mingla_Artifacts/investigations/INVESTIGATE_META-ORCH-1161_NOTIFICATION_ARCHITECTURE_RESEARCH.md`
- `WORLD_MAP.md` META-ORCH-1161 registration (the 4 LOCKED decisions)

**Comms-ledger compliance:** COMMS-0003 (WARN, ALL) honored — every external-API requirement below cites a provider-doc URL inline (Twilio A2P/toll-free, FCC/TCPA, NCC DND, CAN-SPAM, Resend). COMMS-0002 (ORCH-0863 strict-grep gate on backend PRs) factored into §9. COMMS-0015/0018/0027 (edge-deploy/OTA clobber hazards) factored into §11.

---

## 1. Executive summary

We are building Mingla's **one** notification + messaging system: free push/in-app/email everywhere, paid SMS only on a few high-value moments, with a real consent/compliance spine so SMS is legal to send in the US and Nigeria.

**Plain English:** A buyer who books a table, buys a ticket, or has an upcoming event gets told — first by free push (and a durable in-app inbox row), then cheap email, and only as a last resort by SMS (and only for the moments Seth picked). Brands can also send SMS marketing blasts (not just email). Every SMS is gated by a consent + suppression + quiet-hours check that lives in **one** place, so no flow can ever bypass it.

**The single biggest insight:** the SMS *plumbing already exists and is production-proven*. We hold a **Twilio-approved toll-free number (+1 888-250-5351)** behind `TWILIO_MESSAGING_SERVICE_SID`, a working send pattern (`send-venue-sms`), a status webhook (`twilio-message-status`), an opt-out ledger pattern (`venue_sms_opt_out`), a preferences+quiet-hours+idempotency dispatcher (`notify-dispatch`), and an entire SMS-shaped marketing schema with the SMS path literally one `throw` away. **The real, hard work is NOT "wire Twilio."** It is three things: (1) a **legal consent/compliance foundation** (separate transactional vs marketing scopes, durable consent records, suppression honored from any channel, quiet hours, sender identity, Nigeria path); (2) the **reservation notification gap** (reservations notify NOBODY today — fully net-new); and (3) **collapsing 3 ad-hoc senders into one unified dispatcher** with a `can_send()` gate and a push-first/SMS-fallback waterfall that structurally minimizes Twilio spend.

---

## 2. Scope & non-goals

### In scope
- **Sub-A (foundation, lands first):** unified `notify-dispatch` v2 dispatcher + consent/preference/suppression/deliveries data model + `can_send(user, category, channel)` gate + channel adapters (push/email/sms) + push-first/SMS-fallback waterfall + status webhooks (Twilio + Resend + OneSignal) + escalation worker + GSM-7 sanitizer + region routing + inbound STOP webhook → suppression sync. Markets: US + Nigeria.
- **Sub-B (SMS marketing blasts):** replace the `marketing-send` `sms` throw with the Sub-A `smsAdapter`; enable the SMS tab; display SMS reach; phone-keyed suppression in the audience resolver; compliant **marketing** opt-in capture (separate scope, unchecked-by-default, full disclosure); quiet hours + segment/cost guard + branded short links + throughput throttling + deliverability thresholds.
- **Sub-C (high-touch transactional):** the 3 SMS-eligible moments — (1) buyer purchase confirmation (event/trip/experience ticket), (2) buyer reservation confirmed/changed/cancelled (NET-NEW), (3) buyer pre-event/trip/reservation reminder (NET-NEW scheduled job) — each routed push-first/SMS-fallback through Sub-A with transactional consent + idempotency.

### Non-goals (explicit, with reason)
- **Brand-side SMS alerts** — OUT. Brand new-sale/refund/inventory alerts stay PUSH-only (Decision 3; Seth explicitly did NOT select brand SMS). `businessNotifyTriggers.ts` push paths are untouched except to route through the dispatcher.
- **RCS** — OUT for now. The schema already carries `rcs` enums; leave the `rcs` throw in place. Revisit only if trivially free post-1161.
- **OTP / Twilio Verify** — UNCHANGED. `send-otp`/`verify-otp` stay on Twilio Verify (A2P-exempt — https://www.twilio.com/docs/verify). Do NOT route OTP through the dispatcher or the A2P sender.
- **Admin-web** (`mingla-admin`) — OUT (no compose/receive surface; moderation deferred).
- **`brand_followers` / `custom_segment` audiences** — OUT (still `audience_kind_not_yet_enabled` in `marketingAudience.ts`; not a 1161 deliverable).
- **Stripe no-show fee capture on reservation cancel** — OUT (that is META-ORCH-1148's 2.2 money seam, not a notification concern).
- **Buyer-phone OTP verification gate** — DEFERRED unless §12 Q4 resolves YES. v1 ships transactional SMS to the checkout-captured E.164 without an OTP round-trip (it is consent-derived from the booking action).

### Assumptions
- A1. Sub-C reservation work **depends on META-ORCH-1148 2.1b (PR #508) being on `main`** — it is, on `origin/main` (`reservations` 8-state, `venue_waitlist`, `biz_reservation_transition`, `send-venue-sms`). Confirmed present. (§13 R-1.)
- A2. The approved toll-free is verified for **both transactional AND marketing** in the US, OR a marketing-specific sender is provisioned per §12 Q2.
- A3. Nigeria SMS may be **v1 or phased** per §12 Q3 (this spec defaults Nigeria to **phased** — transactional first, marketing later — and builds the region-routing seam now).

---

## 3. The 4 LOCKED decisions, restated as design constraints

1. **DC-1 — META with 3 sub-bodies; Sub-A first.** Sub-A is the only thing that ships before B and C. B and C **must call** Sub-A; they may not duplicate consent/idempotency/retry/quiet-hours logic. Enforced by I-PROPOSED-1161-UNIFIED-DISPATCHER-SOLE-SEND-PATH.
2. **DC-2 — push-first, SMS fallback is a LAW of the dispatcher, not a per-flow choice.** The channel-selection waterfall lives inside `notify-dispatch` v2's `can_send()` + the escalation algorithm (§5.4). No caller decides "send SMS"; a caller decides a *category* and a *payload*, and the dispatcher decides channels. Enforced by I-PROPOSED-1161-SMS-BEHIND-CONSENT-AND-FALLBACK-GATE.
3. **DC-3 — SMS-eligible moments are a CLOSED set** (the 3 in §7). They are exactly the categories with `urgency='high'` AND `sms` in `default_channels`. No other category may ever reach SMS. Adding a new SMS moment = a new category row + a spec amendment. Enforced by the `can_send()` gate (only high-urgency time-sensitive categories pass the SMS leg) + a strict-grep gate on the category seed.
4. **DC-4 — consent + carrier compliance is a BLOCKING prerequisite per market.** SMS sending for a market is OFF until that market's go/no-go gate (§8) fully passes. The kill-switch is per-market env (`SMS_LIVE_ENABLED_US`, `SMS_LIVE_ENABLED_NG`), defaulting false, mirroring `MARKETING_SEND_LIVE_ENABLED`.

---

## 4. Current-state truth (exists vs net-new) + reuse map

Cited from `INVESTIGATE_META-ORCH-1161_CODE_RECON.md` §A–E; pinned to exact code below.

### EXISTS (reuse, do not reinvent)
| Capability | Where (origin/main) | Exact contract pinned |
|---|---|---|
| Push send + dual-app routing | `supabase/functions/_shared/push-utils.ts` | `sendPush(payload)→Promise<boolean>`; `resolveOneSignalApp(type)` (`business.*`/`stripe.*`→business). |
| Push/in-app dispatch + prefs + quiet hours + idempotency | `supabase/functions/notify-dispatch/index.ts` | Reads `notification_preferences` boolean columns (L405-438), `isQuietHours()` 10PM-8AM (L207-217), idempotency on `notifications.idempotency_key` (L269-284), rate-limit ≤10/type/5min (L288-307), branded email via `sendResendBrandedEmail` (L84-138). Helper `dispatchNotification()` in `_shared/stripeEdgeAuth.ts` (fire-and-forget POST). |
| SMS send + opt-out + STOP + audit | `supabase/functions/send-venue-sms/index.ts` | `sendTwilioSms(to, body)→{ok,sid,error,blacklisted}` via `TWILIO_MESSAGING_SERVICE_SID` (toll-free), `StatusCallback` wired to `twilio-message-status?secret=…`; opt-out gate on `venue_sms_opt_out` (global `brand_id IS NULL` OR per-brand); append-only `venue_sms_log`; 21610-blacklist defensive opt-out via `biz_sms_record_global_opt_out(p_phone_e164, p_reason)`. |
| SMS opt-out ledger schema | migration `20261010000000_orch_1148_sms_consent_and_log.sql` | `venue_sms_opt_out(phone_e164, brand_id NULL=global, reason CHECK('stop_keyword','manual','twilio_blacklist'))` w/ partial unique idx; `venue_sms_log(brand_id, waitlist_id, to_phone_e164, template, status, twilio_message_sid, error, triggered_by)`. |
| Partial-index-safe global opt-out | migration `20261011000001_orch_1148_2_1b_sms_optout_rpc.sql` | `biz_sms_record_global_opt_out` SECURITY DEFINER, `ON CONFLICT (phone_e164) WHERE brand_id IS NULL DO NOTHING`. |
| SMS/email status callbacks | `supabase/functions/twilio-message-status/index.ts` | POST form webhook; reads `MessageSid`+`MessageStatus`; updates `ticket_order_notifications` (delivered→`delivered`, failed/undelivered→`failed_terminal`); logs to `twilio_message_status_events`. **Handles status only — NOT inbound STOP keywords (gap, §5.6).** |
| Transactional email/SMS + idempotency + retry | `supabase/functions/ticket-confirmation-dispatch/index.ts` | `sendTwilioMessage({to,body})→{sid}` via Messaging Service; `sendResendEmailWithAttachment(...)` (PDF+ics, `EMAIL_SENDERS.tickets`); `ticket_order_notifications(channel,recipient,status,attempt_count,payload,idempotency_key,provider,provider_message_id)`, status enum `pending|sending|sent|failed_retryable|failed_terminal|skipped`. |
| Retry sweeper | `supabase/functions/notification-retry-sweeper/index.ts` | pg_cron 5-min; `MAX_ATTEMPTS=3`, backoff `2^attempt × 60s`, orphan-pending >300s; re-invokes `dispatchTicketConfirmation`. |
| Marketing blast engine (email-only) | `supabase/functions/marketing-send/index.ts` | cron OR `{campaign_id}`+JWT; `dispatchByKind()` — **`sms`→`throw "sms_not_yet_enabled"` (L261)**, **`rcs`→throw (L263)**; `MARKETING_SEND_LIVE_ENABLED` gate → `preview_skipped`; `signUnsubscribeToken(...)`+`/functions/v1/marketing-unsubscribe`; `marketing_messages(recipient_email,recipient_phone,channel,status,provider_message_id)`. **No quiet-hours/throttling beyond Resend 429 backoff.** |
| Audience resolver | `supabase/functions/_shared/marketingAudience.ts` | `resolveAudience(client, query)→{rows:ResolvedContact[], brand_id, reach:{total,reachable_email,reachable_sms}}`; `ResolvedContact` carries `raw_email,raw_phone,email_marketing_ok,sms_marketing_ok`. **Suppression is EMAIL-KEYED ONLY** — `smsOk` is computed but SMS suppression silently never applies if the contact has no email (recon §A; the load-bearing gap for Sub-B). |
| Marketing schema (SMS-shaped) | migration `20260602000003_orch_0815_marketing_hub_phase_a.sql` | `marketing_campaigns(channel CHECK email|sms|rcs, channel_payload kind=channel)`; `marketing_messages(recipient_phone)`; `marketing_unsubscribes(contact_email XOR contact_phone, channel email|sms|rcs|all, scope account|brand|global)` w/ partial unique idx per channel/scope. |
| Marketing UI (SMS tab disabled) | `mingla-business/src/components/marketing/ChannelTabs.tsx` L42-43 (`{kind:"sms",enabled:false,caption:"pending"}`), `src/types/marketing.ts` (`ChannelPayloadSms`, `AudienceReachSummary.reachable_sms`, `BuyerConsentSummary`), `app/brand/[id]/blasts.tsx` L85/191 (displays `reachable_email` only). |
| Consumer prefs UI | `app-mobile/src/components/profile/AccountSettings.tsx` L150-159 + L694-806 — toggles `push_enabled, friend_requests, link_requests, messages, collaboration_invites, marketing, dm_bypass_quiet_hours`; upsert on `notification_preferences` conflict `user_id`. **No per-channel SMS toggles, no transactional categories, no reminder/reservation category.** |
| Checkout consent | migration `20260515000013_orch_0777_ticket_checkout_core.sql` (`ticket_checkout_sessions.buyer_phone_e164 NOT NULL`, `marketing_opt_in boolean DEFAULT false`); buyer form `mingla-business/app/checkout/[eventId]/buyer.tsx` L550-574 — single email opt-in checkbox copy **"Email me about this organiser's future events"**; persisted into **`orders.metadata->>'marketing_opt_in'`** (JSONB blob, via finalize RPC `20260724000000`/`20260802000002` L168/L188) — **NOT a first-class `orders` column, no SMS scope, no disclosure text recorded.** |
| Reservation data model | migrations `20261003000005_orch_1148_reservations.sql` (8-state CHECK `requested,confirmed,seated,completed,no_show,cancelled_by_guest,cancelled_by_venue,waitlisted`; `guest_name,guest_phone_e164,guest_email,consumer_user_id,reserved_for`), `biz_reservation_transition(p_reservation_id,p_to_status,p_table_id,p_reason)` + `biz_reservation_create(...)` (`20261010000001`); guest fields + `created_via='guest'` + `guest_cancel_token` (`20261012000001`). |
| `notification_preferences` schema | baseline `20260505000000_baseline_squash_orch_0729.sql` L8460-8478 — single row/user; booleans `push_enabled(true), email_enabled(true), friend_requests, link_requests, messages, collaboration_invites, marketing(false), reminders(true), dm_bypass_quiet_hours(false)`. |

### NET-NEW (Sub-A builds it; B and C consume it)
- **Reservations notify nobody** (recon §C row "Venue reservation" = NONE/NONE). Buyer reservation confirmed/changed/cancelled + reminder = build-from-scratch.
- **No unified dispatcher** — 3 ad-hoc senders (`notify-dispatch`, `ticket-confirmation-dispatch`, `marketing-send`).
- **No durable, scoped consent model** — `marketing_opt_in` lives only in `orders.metadata`; no transactional-vs-marketing separation; no disclosure-text/IP/timestamp audit; no buyer **country** capture.
- **No app-side suppression honored from any channel** — only `venue_sms_opt_out` (venue scope) + `marketing_unsubscribes` (marketing scope), email-keyed for audience.
- **No inbound STOP webhook** — `twilio-message-status` reads status only.
- **No escalation worker** — nothing promotes an undelivered push to email/SMS.
- **No GSM-7 sanitizer / Smart Encoding / segment guard.**
- **No buyer purchase-confirmation PUSH** — buyer gets email (±SMS) but never a free push (recon §C).
- **No pre-event/trip/reservation reminder scheduled job.**

---

## 5. Target architecture — Sub-A foundation

Sub-A = the unified dispatcher (`notify-dispatch` upgraded to v2 — same fn name, same route, extended contract) + its data model + `can_send()` + adapters + waterfall + webhooks + escalation worker. **Existing senders migrate onto it transitionally (§5.7) so nothing breaks mid-migration.**

### 5.1 Data model (new tables, additive; `1161` migration series, version ≥ the current max on origin/main + monotonic)

```
notification_categories(
  key text PK,                       -- e.g. 'buyer_purchase_confirmation'
  section text NOT NULL,             -- grouping for the prefs UI
  is_transactional boolean NOT NULL, -- true = on-by-default, non-marketing
  urgency text NOT NULL CHECK (urgency IN ('low','normal','high')),
  default_channels text[] NOT NULL,  -- subset of {inapp,push,email,sms}
  reach_mode text NOT NULL DEFAULT 'reach_once'
    CHECK (reach_mode IN ('reach_once','escalate_on_no_engagement')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
)
-- SEED is data, not code (the waterfall reads it). Only HIGH-urgency rows with
-- 'sms' in default_channels can EVER reach SMS (DC-3). See §5.2 seed.

notification_channel_prefs(
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_key text NOT NULL REFERENCES notification_categories(key),
  channel text NOT NULL CHECK (channel IN ('inapp','push','email','sms')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_key, channel)
)
-- Per-category × per-channel toggle. ABSENT ROW = category.default_channels
-- decides (transactional default-on; marketing default-off). RLS: user owns own.
-- This SUPERSEDES the flat boolean notification_preferences for granular control;
-- notification_preferences stays as the global push_enabled / email_enabled
-- master + legacy category booleans (transitional, §5.7).

channel_suppressions(
  id uuid PK DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for anon-by-contact
  contact text NULL,                 -- E.164 phone OR lowercased email (when user_id unknown)
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  scope text NOT NULL CHECK (scope IN ('transactional','marketing','all')),
  reason text NOT NULL CHECK (reason IN
    ('stop_keyword','manual','bounce','complaint','unsubscribe','twilio_blacklist')),
  brand_id uuid NULL REFERENCES brands(id) ON DELETE CASCADE, -- NULL = global
  created_at timestamptz NOT NULL DEFAULT now()
)
-- OVERRIDES preferences (a STOP beats any toggle). Separate from prefs by design.
-- Partial unique idx on (COALESCE(user_id::text,contact), channel, scope, COALESCE(brand_id::text,'global')).

consent_records(
  id uuid PK DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  contact text NOT NULL,             -- E.164 phone OR lowercased email
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  scope text NOT NULL CHECK (scope IN ('transactional','marketing')),
  action text NOT NULL CHECK (action IN ('granted','revoked')),
  source text NOT NULL,              -- 'checkout' | 'prefs_ui' | 'stop_keyword' | 'unsubscribe_link' | 'reservation'
  disclosure_text text NULL,         -- EXACT copy shown at grant (legal burden of proof)
  ip_hash text NULL,                 -- hashed source IP (web)
  country_code text NULL,            -- ISO-2 buyer country at grant
  created_at timestamptz NOT NULL DEFAULT now()
)
-- Append-only audit trail. The legal record of WHO consented to WHAT, WHEN, with
-- the EXACT disclosure shown. service-role write; user reads own.

notification_deliveries(
  id uuid PK DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('inapp','push','email','sms')),
  status text NOT NULL CHECK (status IN
    ('queued','sent','delivered','undelivered','failed','suppressed','skipped')),
  provider text NULL,                -- 'onesignal'|'resend'|'twilio'
  provider_message_id text NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz NULL,
  failed_reason text NULL,
  segments int NULL                  -- SMS segment count (cost observability)
)
-- THE delivery ledger. Webhooks reconcile final status; the escalation worker
-- reads it to decide the next hop. One row per channel attempt.
```

**Reuse, do NOT duplicate:** `notifications` (existing in-app inbox, `idempotency_key` UNIQUE) stays the dedupe backstop — add a `dedupe_key text UNIQUE` only if a distinct key from `idempotency_key` is needed; otherwise reuse `idempotency_key` (it is already UNIQUE-backed per L341 `23505` handling). `venue_sms_opt_out`/`venue_sms_log` (venue scope) and `marketing_unsubscribes` (marketing scope) stay; the inbound-STOP webhook (§5.6) writes BOTH the new `channel_suppressions` AND, for backward-compat, the venue ledger via `biz_sms_record_global_opt_out`.

### 5.2 Category taxonomy seed (the closed SMS set — DC-3)

| key | section | is_transactional | urgency | default_channels | reach_mode | Sub |
|---|---|---|---|---|---|---|
| `buyer_purchase_confirmation` | Purchases | true | high* | `{inapp,push,email,sms}` | reach_once | C |
| `buyer_reservation_confirmed` | Reservations | true | high | `{inapp,push,email,sms}` | reach_once | C |
| `buyer_reservation_changed` | Reservations | true | high | `{inapp,push,email,sms}` | reach_once | C |
| `buyer_reservation_cancelled` | Reservations | true | high | `{inapp,push,email,sms}` | reach_once | C |
| `buyer_event_reminder` | Reminders | true | high | `{inapp,push,email,sms}` | escalate_on_no_engagement | C |
| `buyer_reservation_reminder` | Reminders | true | high | `{inapp,push,email,sms}` | escalate_on_no_engagement | C |
| `buyer_refund_issued` | Purchases | true | normal | `{inapp,push,email}` | reach_once | (existing→migrate) |
| `buyer_order_cancelled` | Purchases | true | normal | `{inapp,push,email}` | reach_once | (existing→migrate) |
| `waitlist_spot_open` | Purchases | true | high | `{inapp,push,email,sms}` | reach_once | (existing→migrate) |
| `marketing_blast` | Marketing | false | low | `{email,sms}` (per-campaign channel) | n/a | B |
| (existing consumer-social categories: friend_requests, messages, collaboration_invites, reminders, marketing) | — | mixed | low/normal | `{inapp,push}` (+email for marketing) | reach_once | (map, §5.7) |

\* §12 Q1/Q6 decides whether `buyer_purchase_confirmation` is `urgency='high'` (SMS-eligible as push-fallback) vs always-on SMS. The seed above sets it high (SMS as push-fallback). **Only the rows with `sms` in `default_channels` AND `urgency='high'` can ever reach SMS.**

### 5.3 `can_send(p_user_id, p_category_key, p_channel, p_contact)` — Postgres SECURITY DEFINER fn

Returns `boolean`. The SINGLE consent chokepoint. Logic:
```
can_send(user, category, channel, contact) =
   category.active
   AND channel ∈ category.default_channels
   AND (category.is_transactional
        OR coalesce(pref(user,category,channel).enabled, false))   -- marketing off-by-default
   AND coalesce(pref(user,category,channel).enabled, true)         -- transactional on-by-default unless explicitly off (but non-toggleable categories ignore this — see note)
   AND NOT exists suppression(user|contact, channel, scope ∈ {category_scope, 'all'})
   AND within_quiet_hours_policy(channel, category, contact_country)  -- marketing only; transactional exempt but conservative (§8)
```
- **Transactional categories** ignore the user pref for SMS *eligibility* of the high-value moment BUT still honor: a global `push_enabled=false` (suppresses push only, not email/SMS), an explicit per-(category,channel) opt-out row, and ALL suppressions. (Transactional confirmations are legally permitted but Mingla still lets a user turn off the SMS channel for a category via prefs — that writes an `enabled=false` row.)
- **Suppression always wins** (a STOP/bounce/complaint beats any pref).
- **Scope mapping:** transactional categories check suppression scope ∈ {`transactional`,`all`}; `marketing_blast` checks {`marketing`,`all`}. This is why a marketing STOP must NOT kill confirmations (I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED).

### 5.4 Push-first / SMS-fallback algorithm (pseudocode — lives in `notify-dispatch` v2)

```
dispatch({user_id|contact, category_key, payload, idempotency_key, country_code?}):
  1. cat = load notification_categories[category_key]; assert active.
  2. INSERT notifications(idempotency_key,…) ON CONFLICT(idempotency_key) DO NOTHING.
     if conflict → return {duplicate:true}.                 -- idempotency (reuse existing 23505 path)
  3. ALWAYS write in-app: notification_deliveries(channel='inapp', status='delivered').  -- free, durable
  4. if can_send(user, cat, 'push', _) AND has-active-push-token(user):
        ok = pushAdapter.send(user, payload)  → deliveries row (sent/failed)
        if cat.reach_mode='reach_once' AND ok: mark notification awaiting-push-webhook(timeout T).
  5. EMAIL leg (cheap, parallel-safe):
        if can_send(user, cat, 'email', contact):
           - reach_once + push-not-yet-failed → DEFER email to escalation only on push fail/timeout
             EXCEPT confirmations where email is the system-of-record artifact (ticket PDF/ics) → send email NOW regardless (§7.1).
        emailAdapter.send(contact, render(cat,payload)) → deliveries row.
  6. SMS leg — TRIPLE GATE (the cost law, DC-2/DC-3):
        send SMS ONLY IF:
           cat.urgency='high'
           AND 'sms' ∈ cat.default_channels
           AND can_send(user, cat, 'sms', contact)        -- consent + suppression + quiet-hours
           AND (push undelivered/not-subscribed/timeout  OR  no active push token)
           AND time-sensitive(cat, payload)               -- e.g. reminder within lead-time; confirmation always time-sensitive
        then smsAdapter.send(contact, sanitize(render(cat,payload))) → deliveries row(segments).
  7. escalation worker (§5.5) reconciles webhook statuses and fires the next hop after timeout T.
```
- **Escalation timeout T** = per-category param (default 5 min; §12 Q5).
- `escalate_on_no_engagement` (reminders) continues even if push delivered-but-unopened; `reach_once` stops at first confirmed delivery.

### 5.5 Channel adapters — uniform interface

All three expose: `send(target, rendered) → { ok: boolean, providerMessageId: string|null, segments?: number, blacklisted?: boolean, error?: string }`. They hide provider quirks; the dispatcher never touches Twilio/Resend/OneSignal HTTP directly.

- **`pushAdapter`** (new `_shared/adapters/pushAdapter.ts`) — wraps existing `_shared/push-utils.ts` `sendPush()`; resolves consumer-vs-business app via `resolveOneSignalApp(category→type)`.
- **`emailAdapter`** (new `_shared/adapters/emailAdapter.ts`) — wraps Resend; transactional path reuses `EMAIL_SENDERS.tickets`/`.system` + `renderTransactionalEmail` (existing `_shared/email/index.ts`); marketing path stays in `marketing-send` via `marketingEmailRender`. CAN-SPAM footer (physical address, unsubscribe ≥30d) is the marketing render's responsibility (§8).
- **`smsAdapter`** (new `_shared/adapters/smsAdapter.ts`) — **generalized from `send-venue-sms`'s `sendTwilioSms`** (DO NOT introduce a new provider — hard guard). Responsibilities:
  - Send via `TWILIO_MESSAGING_SERVICE_SID` (the approved toll-free) — NEVER a raw From number (mirrors I-PROPOSED-1148-SMS-FROM-APPROVED-TOLLFREE-ONLY). Marketing may use a SEPARATE Messaging Service SID per §12 Q2 (`TWILIO_MARKETING_MESSAGING_SERVICE_SID`).
  - `StatusCallback` wired to `twilio-message-status?secret=…` (reuse existing).
  - **GSM-7 sanitizer**: strip smart quotes → `'`, em-dash → `-`, ellipsis → `...`, etc., before send; flag UCS-2 fall-through; compute + record segment count (`deliveries.segments`). (Twilio Smart Encoding + sanitize — https://www.twilio.com/docs/messaging/services/smart-encoding.)
  - **Region routing**: country_code → US route (toll-free/10DLC) vs Nigeria route (alphanumeric Sender ID — §8.4). Wrong route inflates cost + tanks deliverability.
  - **Sender identity** (brand name) + `Reply STOP to opt out` footer in EVERY body (CTIA). Branded short links only (US carriers filter bit.ly).
  - 21610-blacklist → defensive global `channel_suppressions` row (mirror `biz_sms_record_global_opt_out`).

### 5.6 Status + inbound webhooks

- **`twilio-message-status`** (extend existing): keep status reconciliation; ALSO write `notification_deliveries.status` (delivered/undelivered/failed) keyed by `provider_message_id`. Handle error codes 30034 (unregistered 10DLC), 30007 (filtered / NG DND), 30032 (toll-free not verified) → record `failed_reason`, surface to a cost/deliverability alarm. (Twilio errors — https://www.twilio.com/docs/api/errors/30034 / /30007 / /30032.)
- **NEW `twilio-inbound-sms`** webhook (the STOP gap) — the inbound message webhook (Twilio "A MESSAGE COMES IN") parsing `Body`/`OptOutType` (Twilio Advanced Opt-Out — https://www.twilio.com/docs/messaging/services/advanced-opt-out). On STOP/QUIT/UNSUBSCRIBE/CANCEL/END/REVOKE/OPTOUT (+ the 7 FCC keywords) → write `channel_suppressions(channel='sms', scope='all', reason='stop_keyword')` AND the venue ledger for back-compat. On HELP → reply identity+support. Note Twilio auto-handles STOP at the carrier level too; this webhook is for app-side suppression sync (FCC requires honoring opt-out from any channel).
- **NEW Resend webhook receiver** (`resend-email-status`) — bounce/complaint events → `channel_suppressions(channel='email', reason='bounce'|'complaint')` + `notification_deliveries` reconcile. (Resend webhooks — https://resend.com/docs/dashboard/webhooks/introduction.) Required for the deliverability thresholds in §8.5.

### 5.7 Migration of existing senders onto Sub-A (transitional — nothing breaks mid-flight)

This is the critical risk. Sequence:
1. **Ship Sub-A v2 dispatcher + tables + `can_send()` ADDITIVELY.** `notify-dispatch` v2 accepts BOTH the legacy contract (current callers via `dispatchNotification()`) AND the new `{category_key,…}` contract. Legacy callers keep working byte-identically (legacy path maps `type`→category via the existing `typeToPreference` map + a `typeToCategory` extension).
2. **Map existing categories.** Seed `notification_categories` for every existing `type` (friend_requests, messages, etc.) so the v2 gate is a no-op-equivalent for them (same channels they use today: `{inapp,push}`).
3. **Route ticket confirmation/refund/cancel buyer notifications through the dispatcher** for the PUSH+in-app leg (new — buyer gets a free push), while `ticket-confirmation-dispatch` keeps owning the EMAIL artifact (PDF/ics) and the SMS leg moves behind the dispatcher's `can_send` gate. The `ticket_order_notifications` ledger is preserved as the email/SMS retry backbone; `notification_deliveries` is the new cross-channel ledger (dual-write during transition, single-owner after).
4. **Marketing stays in `marketing-send`** but its SMS leg calls `smsAdapter` (Sub-B), and its suppression check moves to `channel_suppressions` (marketing scope) + the existing `marketing_unsubscribes`.
5. **Label all transitional code** with `META-ORCH-1161 transitional:` comments + a removal ticket. The dual-write window closes in a CLOSE-time cleanup sub-task.

**Single-owner-per-truth (constitution):** after migration, `notify-dispatch` v2 is the SOLE send entry for push+in-app+the transactional SMS/email *decision*; adapters are the sole provider-HTTP owners; `notification_deliveries` is the sole cross-channel delivery truth. I-PROPOSED-1161-UNIFIED-DISPATCHER-SOLE-SEND-PATH forbids any new direct `sendPush`/`sendTwilioSms`/Resend call outside an adapter.

---

## 6. Sub-B — SMS marketing blasts

**Goal:** brands send compliant SMS blasts alongside email, with cost + deliverability discipline.

### Exact changes
1. **`marketing-send/index.ts`** — replace the `sms` throw (L261) with a real SMS dispatch through the Sub-A `smsAdapter` (marketing Messaging Service SID per §12 Q2). Write `marketing_messages(recipient_phone, channel='sms', status, provider_message_id, segments)`. Keep the `MARKETING_SEND_LIVE_ENABLED` gate AND add the per-market kill-switch (`SMS_LIVE_ENABLED_US`/`_NG`). Leave the `rcs` throw (L263) in place.
2. **`_shared/marketingAudience.ts`** — **fix the phone-keyed suppression gap.** Today suppression is email-keyed only; `smsOk` is computed but never actually checks a phone suppression. Add a phone-keyed lookup against `marketing_unsubscribes(contact_phone)` AND `channel_suppressions(channel='sms', scope ∈ {marketing,all})`. `reach.reachable_sms` becomes truthful. (I-PROPOSED-1161-SMS-OPT-OUT-HONORED-ANY-CHANNEL.)
3. **`ChannelTabs.tsx`** L42 — flip `{kind:"sms", enabled:true, caption:""}`. Keep RCS disabled.
4. **`blasts.tsx`** L85/191 + composer — display `reachable_sms` when the SMS channel is selected; show **estimated segment count + cost preview** (GSM-7 vs UCS-2) before send (cost guard). Pass `reachable_sms` to the CTA.
5. **Compliant MARKETING opt-in capture (separate scope)** — marketing consent is `scope='marketing'` in `consent_records` + `channel_suppressions`; it is SEPARATE from transactional. The checkout checkbox (§7/§8) and the consumer prefs UI write marketing consent; a marketing STOP/unsubscribe writes `scope='marketing'` (or `'all'` only on explicit all-channels opt-out) — never killing transactional.
6. **Quiet hours (marketing only)** — block marketing SMS outside 8 AM–9 PM recipient-local (US) / 8 AM–8 PM WAT (NG). Derive TZ from country_code/area code; if unknown, conservative deny outside the window. (FCC quiet hours — see §8.2.)
7. **Branded short links** — marketing SMS click links use the existing `/m/{tracking_id}` Mingla-hosted redirect (NOT bit.ly). Reuse `marketing-track-click`.
8. **Throughput throttling** — batch + throttle SMS sends (mirror the email `BATCH_LIMIT=10` + backoff) to a predictable rate (no burst-blast); respect toll-free/10DLC throughput tier.
9. **Deliverability thresholds** — wire the Resend webhook (email) + Twilio status (SMS) into a per-campaign bounce/complaint/undelivered counter; auto-suppress hard bounces/complainers immediately (§8.5).

### Compliance gating
Sub-B SMS sending stays OFF until the §8 marketing gate passes per market. Email blasts are unaffected (already live).

---

## 7. Sub-C — high-touch transactional

Three moments. Each: trigger source → channels (push-first/SMS-fallback via Sub-A) → buyer copy contract → transactional consent → idempotency.

### 7.1 Buyer purchase confirmation (event/trip/experience ticket)
- **Trigger source:** `stripeWebhookRouter.ts` order finalize (`fireOrderFinalizeNotifications`, the `business.order_paid` brand path at ~L1189) — ADD a buyer-side dispatch call to `notify-dispatch` v2 with `category_key='buyer_purchase_confirmation'`. (Today the buyer gets EMAIL via `ticket-confirmation-dispatch` but NO push — recon §C.)
- **Channels:** in-app + push (NEW, free) immediately; **email is sent NOW regardless** (it carries the ticket PDF+ics artifact — the system-of-record; reach_once does not defer it); SMS only as push-fallback per the §5.4 triple gate.
- **Buyer copy (SMS, GSM-7, ≤1 segment target):** `"{Brand}: You're in for {Event} on {date}. Tickets in the Mingla app. Reply STOP to opt out."` (no promotional content — pure transactional; sender identity present).
- **Consent:** transactional — derived from the purchase action; recorded as `consent_records(scope='transactional', source='checkout', action='granted', disclosure_text=<the checkout SMS-notice copy>, country_code, ip_hash)`. Buyer phone = `orders.buyer_phone_e164`.
- **Idempotency:** `idempotency_key='buyer_purchase_confirmation:{orderId}'`. Email/SMS retry rides the existing `ticket_order_notifications` backbone; cross-channel truth in `notification_deliveries`.

### 7.2 Buyer reservation confirmed / changed / cancelled (NET-NEW)
- **Trigger source:** `biz_reservation_transition(p_reservation_id, p_to_status, …)` (`20261010000001_orch_1148_reservation_lifecycle_rpcs.sql`) is `SECURITY DEFINER` plpgsql — **it cannot make HTTP calls.** Two viable wirings:
  - **(Recommended) Edge-layer fan-out:** the callers of the transition (the business-app reservation hooks + the guest/consumer reserve RPC paths) ALSO invoke `notify-dispatch` v2 after a successful transition. Map: `confirmed`→`buyer_reservation_confirmed`; `seated`/table reassignment/time change→`buyer_reservation_changed`; `cancelled_by_guest`/`cancelled_by_venue`→`buyer_reservation_cancelled`.
  - **(Alt) DB-trigger + outbox:** an `AFTER UPDATE` trigger on `reservations.status` writes a `notification_outbox` row; a 1-min cron drains it to the dispatcher. Use this if edge-layer fan-out cannot cover all transition entry points (operator, consumer, guest-web). **Decision deferred to IMPLEMENT/DESIGN — recommend the outbox** for completeness (the transition RPC is the single chokepoint; an edge fan-out risks missing a path). Surfaced in §12 Q7.
- **Channels:** in-app + push (if `consumer_user_id` present) → email (`guest_email`) → SMS fallback (`guest_phone_e164`) per the triple gate. For an anon `created_via='guest'` reservation there is no push token → email + SMS fallback only.
- **Buyer copy:**
  - confirmed: `"{Brand}: Table for {party} confirmed {date} {time}. Reply STOP to opt out."`
  - changed: `"{Brand}: Your reservation changed — now {date} {time}, party {party}. Reply STOP to opt out."`
  - cancelled: `"{Brand}: Your reservation for {date} was cancelled. Reply STOP to opt out."`
- **Consent:** transactional; recorded with `source='reservation'`. Phone = `reservations.guest_phone_e164`.
- **Idempotency:** `idempotency_key='buyer_reservation_{status}:{reservationId}:{transitionAt}'` (transition timestamp distinguishes repeated changes).

### 7.3 Buyer pre-event/trip/reservation reminder (NET-NEW scheduled job)
- **Trigger source:** NEW edge fn `notify-reminders` on a pg_cron schedule (reuse the `cron.schedule(... net.http_post(... '/functions/v1/notify-reminders'))` pattern from `20260603000000_orch_0815_b_marketing_send_cron.sql`). Runs every ~15 min; selects upcoming events/trips/experiences (from `events`/event_dates) and reservations (`reservations.reserved_for`) within a lead-time window, de-duped by `idempotency_key`.
- **Lead-time params (§12 Q1):** default **24h-ahead reminder + a T-2h same-day nudge** (the architecture-research practical pattern). Configurable via env or a `reminder_lead_times` config.
- **Channels:** `escalate_on_no_engagement` reach_mode — in-app + push; if push not delivered/unopened by the escalation timeout → email → SMS only for the high-urgency time-sensitive window (e.g. the T-2h nudge). The 24h reminder may be push+email only; the T-2h nudge is the SMS-eligible one (cost discipline).
- **Buyer copy:** `"{Brand}: {Event/Reservation} starts in {N}h — {time}. See you there! Reply STOP to opt out."` (generic — no sensitive detail).
- **Consent:** transactional; `category_key='buyer_event_reminder'` / `'buyer_reservation_reminder'`.
- **Idempotency:** `idempotency_key='{category}:{entityId}:{leadBucket}'` (leadBucket = `24h`|`2h`) — guarantees exactly one per bucket even across cron overlaps.

---

## 8. Compliance gate (BLOCKING) — every [HARD] item → a build requirement + go/no-go

SMS for a market is OFF (`SMS_LIVE_ENABLED_<MKT>=false`) until ALL of that market's gate items pass. This maps `INVESTIGATE_..._SMS_COMPLIANCE_RESEARCH.md` §6 checklist 1-on-1.

### 8.1 Consent data model [HARD]
- `consent_records` (§5.1) per (user/contact, channel, scope) with opt-in timestamp + EXACT disclosure_text + source/ip_hash + country_code. Marketing = unchecked-by-default checkbox + full disclosure; transactional = derived-from-action but RECORDED. ✅ build req: §5.1 + §7 record-on-grant.

### 8.2 US TCPA/CTIA/FCC [HARD]
- Marketing → prior express **WRITTEN** consent (affirmative checkbox + disclosure). Transactional → prior express consent, **NO promotional content mixed in** (every Sub-C copy in §7 is pure transactional). ✅
- Revocation by **any reasonable means** + the **7 FCC keywords** (stop, quit, revoke, opt out, cancel, unsubscribe, end) honored within **10 business days** → `channel_suppressions` written by the inbound-STOP webhook (§5.6), the unsubscribe link, AND the prefs UI. Build for **cross-channel revocation** (one opt-out = all) by supporting `scope='all'`. ✅
- STOP + HELP supported (Twilio auto + app-side sync); HELP returns sender identity + support. ✅
- **Brand name (sender ID) in every message body.** ✅ (smsAdapter requirement.)
- **"Msg & data rates may apply"** disclosed at opt-in. ✅ (consent UX copy, §8.6.)
- **Quiet hours**: marketing 8 AM–9 PM recipient-local; transactional conservative. ✅ (§6.6.)

### 8.3 US 10DLC vs toll-free [HARD] — EXPLICIT DECISION (§12 Q2)
- **Transactional:** RECOMMEND reuse the **already-approved toll-free** (+1 888-250-5351, `TWILIO_MESSAGING_SERVICE_SID`). Toll-free verification is a valid US A2P path separate from 10DLC; it is live and approved today (`send-venue-sms`). Trade-off: toll-free throughput is lower than high-volume 10DLC but ample for transactional volume at current scale. (Twilio toll-free verification — https://www.twilio.com/docs/messaging/compliance/toll-free-verification.)
- **Marketing:** RECOMMEND a **separate Messaging Service** (separate reputation; a marketing STOP must not touch transactional). Decide toll-free-second-number vs 10DLC registration. **10DLC campaign vetting takes ~10–15 days** (build lead time). Unregistered 10DLC = error 30034 = zero delivery since Feb 2025. (https://www.twilio.com/docs/messaging/compliance/a2p-10dlc.)
- Gate item: the chosen sender(s) verified/registered + StatusCallback live + a test send delivered.

### 8.4 Nigeria [HARD] (§12 Q3 — default PHASED)
- Alphanumeric **Sender ID pre-registered** with carriers (4 NOCs for >30k/mo: MTN, Globacom, 9mobile, Airtel). One-way → **STOP-reply does NOT work**; opt-out via DND 2442 + app preference center (`channel_suppressions` from the prefs UI). Promo respects DND + **8 AM–8 PM WAT**; transactional bypasses DND on a corporate/transactional route (no marketing smuggling). Handle error 30007 (filtered/DND). NDPA 2023 consent (explicit, withdrawable). (NCC DND / NDPA — cite in the SUB-PROMPT at build time.)
- **Default:** Nigeria SMS PHASED — region-routing seam built now in `smsAdapter`; transactional NG SMS in a v1.x phase, marketing NG SMS later. `SMS_LIVE_ENABLED_NG=false` until the NG gate passes.

### 8.5 Email CAN-SPAM + NDPA + deliverability [HARD]
- Accurate headers, non-deceptive subject, identify-as-ad (marketing), **valid physical postal address**, clear opt-out working ≥30 days, honor ≤10 business days. ✅ (marketing render footer + `marketing-unsubscribe`.)
- Deliverability: spam complaints <0.3% (target <0.1%), bounces <2% → suppress hard bounces/complainers immediately via the Resend webhook (§5.6). ✅
- Penalty exposure noted (CAN-SPAM ~$53k/email).

### 8.6 Consent capture UX [HARD] (per-surface in §10)
- Marketing checkbox **unchecked by default**, SEPARATE from ToS/booking, disclosure shows: brand name + "agree to receive marketing texts" + expected frequency + "Msg & data rates may apply" + STOP/HELP. The EXACT disclosure string is recorded into `consent_records.disclosure_text`.
- Transactional: a short notice at checkout ("We'll text you booking updates at this number. Reply STOP to opt out.") whose copy is recorded as the transactional grant's disclosure.

### Go/No-Go gate (per market) — ALL must be GREEN before `SMS_LIVE_ENABLED_<MKT>=true`
1. Sender registered/verified (toll-free or 10DLC for US; Sender ID + NOCs for NG).
2. `consent_records` writing on every grant path; disclosure text recorded.
3. `channel_suppressions` honored in `can_send()`; inbound-STOP webhook live + tested (US); DND/app-pref path live (NG).
4. Quiet hours enforced for marketing (verified by a quiet-hours test).
5. StatusCallback + inbound webhook + Resend webhook live; 30034/30007/30032 alarms wired.
6. A live test SMS to a staff number delivered + a STOP round-trip suppresses.
7. Separate transactional vs marketing sender confirmed (a marketing STOP does not block a transactional send — proven).

---

## 9. DRAFT invariants (`I-PROPOSED-1161-*`, flip ACTIVE at CLOSE — orchestrator owns the flip)

| ID | Rule | Enforcement | Regression test (fails-on-revert) |
|---|---|---|---|
| **I-PROPOSED-1161-UNIFIED-DISPATCHER-SOLE-SEND-PATH** | No push/email/SMS send originates outside `notify-dispatch` v2 or its adapters. No new direct `sendPush`/`sendTwilioSms`/`api.resend.com` call in product code outside `_shared/adapters/*` (+ the labeled transitional `marketing-send`/`ticket-confirmation-dispatch` owners). | strict-grep gate `.github/scripts/strict-grep/i-proposed-1161-unified-dispatcher-sole-send-path.mjs` (ORCH-0863-style; COMMS-0002) | Adding a raw `sendTwilioSms(` outside an adapter → grep FAILS. |
| **I-PROPOSED-1161-SMS-BEHIND-CONSENT-AND-FALLBACK-GATE** | An SMS is sent ONLY when `can_send(...,'sms',...)` is true AND push is undelivered/absent AND category urgency=high AND time-sensitive. | test (dispatcher unit) | Test: push-delivered reach_once category → SMS NOT sent; push-failed high-urgency → SMS sent. Reverting the gate → test fails. |
| **I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED** | A `scope='marketing'` suppression/opt-out NEVER blocks a transactional send, and vice-versa (except explicit `scope='all'`). | test + migration (CHECK on `consent_records.scope`/`channel_suppressions.scope`) | Test: insert marketing STOP → `can_send(transactional,'sms')` still true. Revert scope-mapping → fails. |
| **I-PROPOSED-1161-SMS-OPT-OUT-HONORED-ANY-CHANNEL** | An opt-out captured via SMS reply, web unsubscribe, OR the prefs UI suppresses subsequent SMS regardless of capture channel; the audience resolver checks phone-keyed suppression. | test + migration | Test: web-unsubscribe a phone → audience `reachable_sms` excludes it AND `can_send` denies. Revert the marketingAudience phone-suppression fix → fails. |
| **I-PROPOSED-1161-QUIET-HOURS-ENFORCED-FOR-MARKETING** | Marketing SMS/email is not sent outside 8 AM–9 PM recipient-local (US) / 8 AM–8 PM WAT (NG). | test | Test: marketing send at recipient-local 10 PM → deferred/blocked. Revert quiet-hours check → fails. |
| **I-PROPOSED-1161-GSM7-SANITIZED-TEMPLATES** | Every outbound SMS body is GSM-7-sanitized (smart quotes/em-dash/ellipsis normalized) before send; segment count recorded. | test + strict-grep (no raw smart-punctuation in SMS template constants) | Test: a template with `'`/`—` → sanitized to `'`/`-`; segment count computed. Revert sanitizer → fails. |
| **I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY** (extends 1148) | SMS sends ONLY via a configured Messaging Service SID (toll-free/marketing), never a raw From number. | strict-grep | A raw `From:` number in an SMS send → grep FAILS. |
| **I-PROPOSED-1161-SMS-MARKET-KILL-SWITCH** | SMS for a market is gated by `SMS_LIVE_ENABLED_<MKT>`; default false. | test | Test: env false → smsAdapter returns `skipped` without an HTTP call. Revert gate → fails. |

---

## 10. Per-surface scope (the 6 in-scope surfaces; admin-web OUT)

| Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---|---|---|---|
| **1. Consumer iOS** (`app-mobile`) | YES | Receives buyer push for purchase/reservation/reminder (NEW); per-category × per-channel notification prefs incl. SMS toggles + transactional categories + reminder/reservation categories; marketing SMS opt-in toggle. | `app-mobile/src/components/profile/AccountSettings.tsx` (extend L694-806 prefs section); a new prefs hook/service writing `notification_channel_prefs` + `consent_records`; OneSignal already wired. | Shared RN code → auto Android parity. |
| **2. Consumer Android** (`app-mobile`) | YES | Same as iOS. | Same files. | Auto (shared). |
| **3. Buyer/anon Web** (`mingla-business` checkout + public pages) | YES | Compliant marketing opt-in capture (separate, unchecked, full disclosure) + a transactional-SMS notice; buyer **country** capture at checkout; unsubscribe/STOP landing (reuse `marketing-unsubscribe`). | `mingla-business/app/checkout/[eventId]/buyer.tsx` (L550-574 checkbox → split into transactional notice + marketing checkbox + country field); finalize RPC writes `consent_records` + `country_code`; `marketing-unsubscribe` (already supports phone+sms). | Web-specific (manual parity vs native checkout). |
| **4. Business iOS** (`mingla-business`) | YES | Marketing Hub blast composer SMS tab ENABLED; SMS reach + segment/cost preview; (brand alerts stay push-only — unchanged). | `mingla-business/src/components/marketing/ChannelTabs.tsx` (L42 enable), `app/brand/[id]/blasts.tsx` (L85/191 reach), composer compose route, `src/services/marketing/*`, `src/types/marketing.ts`. | Shared RN → auto Android. |
| **5. Business Android** (`mingla-business`) | YES | Same as Business iOS. | Same. | Auto (shared). |
| **6. Backend** (`supabase/`) | YES (heaviest) | `notify-dispatch` v2 + tables + `can_send()` + adapters + webhooks + escalation worker + `notify-reminders` cron + reservation notify wiring + `marketing-send` SMS leg + audience phone-suppression fix. | `supabase/functions/notify-dispatch`, `_shared/adapters/*`, `twilio-message-status`, NEW `twilio-inbound-sms`, NEW `resend-email-status`, NEW `notify-reminders`, NEW `notify-escalate`, `marketing-send`, `_shared/marketingAudience.ts`, `1161` migrations. | N/A. |
| Admin Web (`mingla-admin`) | **NO** | reason: no compose/receive surface. | — | — |
| Business Web preview (adjacent) | **NO** | reason: blast composer is native-first; web preview not a 1161 deliverable. | — | — |

---

## 11. Phased rollout / sequencing

### Sub-A FIRST (hard gate — DC-1). Recommended thin first END-TO-END ship (the "thin booking loop" analog):
**THIN SLICE = one moment, end-to-end, push-first/SMS-fallback, US-only, real consent.** Recommend **buyer reservation confirmed** (`buyer_reservation_confirmed`) as the thin slice: it is the clearest net-new gap, exercises the full stack (category seed → `can_send` → push adapter → email adapter → smsAdapter fallback → status webhook → suppression), reuses the live toll-free, and proves the reservation-notify wiring — without needing the marketing sender or the reminder cron. Ship that one moment to staff devices, prove the waterfall + a STOP round-trip, THEN fan out the other Sub-C moments + Sub-B.

### Per-sub pipeline
- **Sub-A:** DESIGN (consumer prefs-UI redesign via `mingla-designer` — per-category×channel matrix; checkout consent UX) → IMPLEMENT (tables + dispatcher v2 + adapters + webhooks + transitional migration) → TEST (mingla-tester: `can_send` matrix, waterfall, idempotency, STOP round-trip, transactional-vs-marketing isolation) → CLOSE (flip invariants; close the dual-write window).
- **Sub-B:** DESIGN (composer SMS tab + cost/segment preview + marketing consent copy) → IMPLEMENT (marketing-send SMS leg + audience phone-suppression fix + quiet hours + throttling) → TEST → CLOSE. **BLOCKED on §8 US marketing gate.**
- **Sub-C:** DESIGN (buyer copy + reminder lead-time config) → IMPLEMENT (purchase-confirm push + reservation notify wiring/outbox + `notify-reminders` cron + `notify-escalate`) → TEST (reminder bucketing, reservation transition coverage, escalation timeout) → CLOSE.

### Edge-deploy / OTA hazards (COMMS-0015/0018/0027)
- Deploy edge fns from MERGED `main` only (clobber risk) — never from a stale worktree.
- Apply `1161` migrations via the Supabase Management API after REVIEW (MCP read-only; CLI drift-wedged) — version monotonic above the current max on origin/main.
- Consumer/business OTA per-platform via `npx -y eas-cli@latest update` (the EAS gotcha); buyer-web deploys only from `main` with the `[deploy]` tag (RSVP-close trap: a non-`[deploy]` commit after yours cancels the build).
- Set Twilio/Resend/OneSignal secrets via Supabase secrets at deploy; never hardcode.

---

## 12. OPEN PRODUCT DECISIONS FOR SETH (genuine forks — my recommendation each)

1. **Reminder lead times.** Q: exactly when do pre-event/reservation reminders fire? **REC: 24h-ahead (push+email) + a T-2h same-day nudge (SMS-eligible).** Make it env-configurable so you can tune without a deploy.
2. **US marketing sender: toll-free vs 10DLC.** Q: marketing SMS on a second toll-free or register 10DLC? **REC: separate Messaging Service for marketing (reputation isolation); start with a toll-free second number (fast, already a proven path) and register 10DLC only if marketing volume outgrows toll-free throughput. Transactional stays on the existing approved toll-free.** Note 10DLC vetting is ~10–15 days lead time.
3. **Nigeria SMS: v1 or phased?** **REC: PHASED — build the region-routing seam now, ship US first; NG transactional in v1.x, NG marketing later** (alphanumeric Sender ID + 4 NOCs + DND is real lead time and one-way opt-out complexity).
4. **Buyer phone OTP verification before transactional SMS?** Q: require an OTP round-trip on the checkout phone before we'll SMS it? **REC: NO for v1 — transactional consent is derived from the booking action and the number is the buyer's own; an OTP gate adds checkout friction. Add it only if delivery-error rates on bad numbers prove costly.** (OTP stays on Verify regardless.)
5. **Escalation timeout (push→email/SMS).** Q: how long to wait on a push delivery webhook before falling through? **REC: 5 min default per category; 0 min (immediate) for confirmations' email artifact (sent now), and tighter for the T-2h reminder.**
6. **Purchase-confirmation SMS: push-fallback-only or always-on?** Q: this is the highest-value moment — always text it, or only when push fails? **REC: push-fallback-only (consistent with the cost law) BUT send the email always (PDF/ics artifact). If you want guaranteed SMS receipt for purchases, flip `buyer_purchase_confirmation` to always-on SMS — at a known per-SMS cost. Defaulting to fallback-only.**
7. **Reservation notify wiring: edge fan-out vs DB-trigger outbox.** Q: how do reservation transitions reach the dispatcher (the transition RPC can't call HTTP)? **REC: DB-trigger → `notification_outbox` → 1-min cron drain.** It guarantees coverage of ALL transition entry points (operator, consumer, guest-web) from the single RPC chokepoint; edge fan-out risks missing a path. (This is an architecture pick I'm recommending, not silently deciding — it has a small latency cost.)

---

## 13. Risks & blast radius

- **R-1 — STALE LOCAL ANCHOR (process risk).** The anchor checkout local `main` is BEHIND `origin/main` (HEAD `84d583e87` vs origin `a58f46ffa`); META-ORCH-1148 2.1b (#508) + ORCH-1157 are on `origin/main` but NOT local `main`. **Every Sub-C reservation dependency (`reservations`, `biz_reservation_transition`, `send-venue-sms`, `venue_sms_opt_out`) exists on `origin/main` and this spec is written against it.** The implementor's worktree MUST `git fetch origin && git rebase origin/main` before any work, or it will build against phantom-absent dependencies.
- **R-2 — Twilio cost runaway.** A loop/misconfigured fallback could blast SMS. Mitigation: the triple gate + per-market kill-switch + Twilio Messaging Insights/Intelligent Alerts + a deliveries-table cost dashboard + segment-count recording.
- **R-3 — Transactional kill from a marketing STOP.** If scopes leak, a marketing opt-out could silence booking confirmations (legal + UX disaster). Mitigation: I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED + separate senders + the §8 gate item #7 proof.
- **R-4 — Mid-migration double-send / silent drop.** Routing existing senders onto v2 while keeping them live risks duplicate or lost notifications. Mitigation: dual-write + idempotency_key + the transitional labeling + a TEST pass on every existing notification type before closing the dual-write window.
- **R-5 — Unregistered/unverified sender → zero delivery (30034/30032).** Mitigation: the §8 go/no-go gate blocks `SMS_LIVE_ENABLED` until the sender is verified + a live test send delivered.
- **R-6 — Inbound STOP webhook is net-new** (today only status callbacks exist). If it's not live, app-side suppression drifts from Twilio's carrier-level STOP → we keep texting opted-out users (TCPA exposure). Mitigation: gate item #3.
- **R-7 — Anon/guest reservations have no push token + may lack email.** Email+SMS fallback only; ensure `can_send` handles `user_id IS NULL` (contact-keyed) paths.
- **Cross-ORCH:** sibling META-ORCH-1160 (Growth OS = measurement/analytics) is complementary (no channel-delivery overlap). META-ORCH-1148 (venue suite) is the upstream provider of the reservation model + the approved toll-free pattern — coordinate any change to `venue_sms_opt_out`/`twilio-message-status` (this spec EXTENDS, not replaces, both).

### Allowlist (implementor may touch) / DO-NOT-TOUCH
**Allowlist:** `supabase/functions/notify-dispatch/**`, `supabase/functions/_shared/adapters/**` (new), `supabase/functions/twilio-message-status/**`, `supabase/functions/twilio-inbound-sms/**` (new), `supabase/functions/resend-email-status/**` (new), `supabase/functions/notify-reminders/**` (new), `supabase/functions/notify-escalate/**` (new), `supabase/functions/marketing-send/**`, `supabase/functions/_shared/marketingAudience.ts`, `supabase/migrations/2026111*_orch_1161_*.sql` (new), `mingla-business/src/components/marketing/ChannelTabs.tsx`, `mingla-business/app/brand/[id]/blasts.tsx`, `mingla-business/src/services/marketing/*`, `mingla-business/src/types/marketing.ts`, `mingla-business/app/checkout/[eventId]/buyer.tsx` + the finalize RPC consent write, `app-mobile/src/components/profile/AccountSettings.tsx` + new prefs hook/service, `.github/scripts/strict-grep/i-proposed-1161-*.mjs` (new).
**DO-NOT-TOUCH:** `send-otp`/`verify-otp` (Twilio Verify — A2P-exempt), `send-venue-sms`/`venue_sms_opt_out`/`venue_sms_log` semantics (EXTEND via the inbound webhook only; do not change the venue send path), the Stripe webhook money seam in `stripeWebhookRouter.ts` (add ONLY the buyer-notify dispatch call; do not touch finalize/refund money logic), the reservation lifecycle RPC money/transition logic (add notify via outbox/trigger only), `businessNotifyTriggers.ts` brand-push semantics (route through the dispatcher but keep push-only — no brand SMS). Any change outside the allowlist → stop-and-amend (`SPEC_AMENDMENT_META-ORCH-1161_*.md`).

---

## Downstream routing

Next = **Seth REVIEW** of this canonical spec (especially §12). On approval → per-sub DESIGN (mingla-designer for the consumer prefs matrix + checkout consent UX + composer SMS tab) → mingla-implementor (Sub-A first, thin slice = buyer_reservation_confirmed) → mingla-tester → orchestrator CLOSE (flip I-PROPOSED-1161-* ACTIVE, close dual-write window). Each sub runs in its own per-ORCH worktree off `origin/main`.
