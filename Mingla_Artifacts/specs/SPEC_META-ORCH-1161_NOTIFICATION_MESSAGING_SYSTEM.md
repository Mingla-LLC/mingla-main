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

## v2 changelog (2026-06-19)

This is a v2 revision of the v1 canonical spec, encoding two locked decisions: **DEC-185** (channel model) and **DEC-186** (consent gate). Where they conflict with v1, the decisions WIN. What changed:

1. **Channel model REWRITTEN (DEC-185).** Killed push-first/SMS-fallback (the old DC-2). The category's `default_channels` IS the policy: every listed channel sends **SIMULTANEOUSLY**, each independently gated by `can_send()` (consent + suppression + quiet-hours) and by the reach rule (push/in-app only for users with the consumer app / an account; email always; SMS only for policy-eligible categories). §5.4 is now a flat per-channel loop — no waterfall, no escalation timeout, no "SMS only if push undelivered." REMOVED: the `notify-escalate` worker, `reach_mode`/`escalate_on_no_engagement`, escalation timeout T, and §12 Q5/Q6 (marked MOOT).
2. **Category matrix REPLACED (DEC-185).** §5.2 seed rewritten to the confirmed Explorer + Business matrix. SMS-eligible set is now a closed, enumerated list (the seed). New invariant `I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES` replaces the old fallback-gate invariant.
3. **Business notifications gain email broadly + ONE SMS exception (DEC-185).** All business categories now `{push,inapp,email}` (was push-only); `payout_paid` is the SINGLE brand SMS (`{push,inapp,email,sms}`). New-reservation / reservation-change to the brand are NET-NEW.
4. **Marketing now also delivers via push + in-app (DEC-185).** §6 (Sub-B) gains a push+inapp marketing delivery path for consumer-app users, not just email/SMS.
5. **Consent BUNDLED into one mandatory gate; TCPA risk ACCEPTED (DEC-186).** §8 + §10 rewritten: the consumer-app OTP consent box and the anon checkout page gate continuation on ONE mandatory checkbox (T&Cs + transactional + reminders + email marketing + SMS marketing). New risk **R-8** + an §8 callout document the known TCPA violation (47 CFR 64.1200) that Seth accepted, with mitigations and an explicit **legal-sign-off go-live blocker** for SMS-marketing.
6. **Thin slice changed to `buyer_reservation_changed`** so the first ship exercises the SMS leg + STOP round-trip (the v1 `buyer_reservation_confirmed` is now a NO-text category).
7. **§12 mostly resolved** — answers recorded; only social-email scope and legal-sign-off owner/timing remain OPEN.

Authoritative decision text: `Mingla_Artifacts/DECISION_LOG.md` DEC-185 + DEC-186 (2026-06-19).

---

## 1. Executive summary

We are building Mingla's **one** notification + messaging system: free push/in-app/email everywhere, paid SMS only on a curated set of high-value categories, with a real consent/compliance spine so SMS is legal to send in the US and Nigeria.

**Plain English:** A buyer who books a table, buys a ticket, or has an upcoming event gets told across every channel the category's policy lists — a durable in-app inbox row, a free push (if they have the consumer app), an email (always), and an SMS (only for the categories Seth curated as text-worthy). **All listed channels fire at the same time** — SMS is NOT a last resort that waits for push to fail. Cost discipline comes from the *curated SMS-eligible set*, not from a waterfall. Brands can also send SMS marketing blasts (not just email). Every send is gated by a consent + suppression + quiet-hours check that lives in **one** place, so no flow can ever bypass it.

**The single biggest insight:** the SMS *plumbing already exists and is production-proven*. We hold a **Twilio-approved toll-free number (+1 888-250-5351)** behind `TWILIO_MESSAGING_SERVICE_SID`, a working send pattern (`send-venue-sms`), a status webhook (`twilio-message-status`), an opt-out ledger pattern (`venue_sms_opt_out`), a preferences+quiet-hours+idempotency dispatcher (`notify-dispatch`), and an entire SMS-shaped marketing schema with the SMS path literally one `throw` away. **The real, hard work is NOT "wire Twilio."** It is three things: (1) a **legal consent/compliance foundation** (separate transactional vs marketing scopes, durable consent records, suppression honored from any channel, quiet hours, sender identity, Nigeria path); (2) the **reservation notification gap** (reservations notify NOBODY today — fully net-new); and (3) **collapsing 3 ad-hoc senders into one unified dispatcher** with a `can_send()` gate that fires the category's policy channels simultaneously and reserves SMS for the curated eligible set (DEC-185).

---

## 2. Scope & non-goals

### In scope
- **Sub-A (foundation, lands first):** unified `notify-dispatch` v2 dispatcher + consent/preference/suppression/deliveries data model + `can_send(user, category, channel)` gate + channel adapters (push/email/sms) + **simultaneous per-channel send of the category's `default_channels` policy** (DEC-185 — no waterfall) + status webhooks (Twilio + Resend + OneSignal) + GSM-7 sanitizer + region routing + inbound STOP webhook → suppression sync. Markets: US + Nigeria.
- **Sub-B (SMS marketing blasts):** replace the `marketing-send` `sms` throw with the Sub-A `smsAdapter`; enable the SMS tab; display SMS reach; phone-keyed suppression in the audience resolver; **add a push + in-app marketing delivery path for consumer-app users** (DEC-185 — marketing now also reaches push+inapp, not just email/SMS); compliant **marketing** opt-in capture (now bundled into the mandatory consent gate per DEC-186, recorded as `scope='marketing'`); quiet hours + segment/cost guard + branded short links + throughput throttling + deliverability thresholds.
- **Sub-C (high-touch transactional):** the high-touch moments — (1) buyer purchase confirmation (event/trip/experience ticket — **NO text**, push+inapp+email), (2) buyer reservation confirmed (NO text) / changed / cancelled (NET-NEW), (3) buyer pre-event/trip/reservation reminder (NET-NEW scheduled job, 24h + ~2h), (4) waitlist ready/spot-open, refund issued, order cancelled, payment failed (NO text) — each dispatched through Sub-A using the category's policy channels SIMULTANEOUSLY (DEC-185), with transactional consent + idempotency. SMS fires only for the categories whose seed lists `sms`.

### Non-goals (explicit, with reason)
- **Brand-side SMS alerts** — OUT *except `payout_paid`* (DEC-185 explicit). Every other brand category (new_sale/sold_out/low_inventory, refund_processed, new_reservation, reservation_change, payout_failed, stripe_account/bank_problem) is `{push,inapp,email}` — NO text — but gains EMAIL broadly (today push-only). `payout_paid` is the SINGLE brand SMS (`{push,inapp,email,sms}`). `businessNotifyTriggers.ts` push paths route through the dispatcher and now also fan out email; only `payout_paid` adds SMS. New-reservation / reservation-change to the brand are NET-NEW (today reservations notify the brand of nothing).
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
2. **DC-2 (REVISED per DEC-185) — curated per-category POLICY + SIMULTANEOUS send, NOT push-first/SMS-fallback.** The category's `default_channels` IS the policy. For every channel in that list, the dispatcher independently calls `can_send()` and, if it passes, sends — **all channels fire together, in one pass, with no waterfall, no escalation, no "SMS only if push undelivered."** No caller decides "send SMS"; a caller decides a *category* and a *payload*, and the dispatcher fires the category's policy channels. Cost discipline = the curated SMS-eligible set (the §5.2 seed), not a fallback. Each channel is additionally constrained by reach: push/in-app only for users who have the consumer app / an account; email always; SMS only for policy-eligible categories. Enforced by I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES (+ the consent/suppression/quiet-hours invariants).
3. **DC-3 — SMS-eligible categories are a CLOSED set** — exactly the §5.2 seed rows whose `default_channels` contains `sms`. No other category may ever reach SMS. Adding a new SMS category = a new/edited seed row + a spec amendment. Enforced by the `can_send()` gate (channel ∈ `default_channels`) + a strict-grep gate on the category seed. (The closed SMS-eligible set is the seed itself — see §5.2.)
4. **DC-4 — consent + carrier compliance is a BLOCKING prerequisite per market.** SMS sending for a market is OFF until that market's go/no-go gate (§8) fully passes. The kill-switch is per-market env (`SMS_LIVE_ENABLED_US`, `SMS_LIVE_ENABLED_NG`), defaulting false, mirroring `MARKETING_SEND_LIVE_ENABLED`. Per DEC-186, **explicit legal sign-off accepting the bundled-consent TCPA risk is an additional go-live gate item for SMS-MARKETING** (see §8).

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
- **No GSM-7 sanitizer / Smart Encoding / segment guard.**
- **No buyer purchase-confirmation PUSH** — buyer gets email but never a free push or in-app row (recon §C). (Purchase confirmation is a NO-text category per DEC-185 — push+inapp+email.)
- **No broad business-side email** — brand alerts are push-only today; DEC-185 adds `{push,inapp,email}` to every brand category and `sms` to `payout_paid`.
- **No pre-event/trip/reservation reminder scheduled job.**

---

## 5. Target architecture — Sub-A foundation

Sub-A = the unified dispatcher (`notify-dispatch` upgraded to v2 — same fn name, same route, extended contract) + its data model + `can_send()` + adapters + **simultaneous per-channel policy send** (DEC-185 — no waterfall, no escalation worker) + webhooks. **Existing senders migrate onto it transitionally (§5.7) so nothing breaks mid-migration.**

### 5.1 Data model (new tables, additive; `1161` migration series, version ≥ the current max on origin/main + monotonic)

```
notification_categories(
  key text PK,                       -- e.g. 'buyer_purchase_confirmation'
  section text NOT NULL,             -- grouping for the prefs UI
  is_transactional boolean NOT NULL, -- true = on-by-default, non-marketing
  urgency text NOT NULL CHECK (urgency IN ('low','normal','high')), -- prefs ordering/labels only; NOT an SMS gate (DEC-185)
  default_channels text[] NOT NULL,  -- subset of {inapp,push,email,sms} = THE POLICY
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
)
-- SEED is data, not code (the dispatcher reads default_channels = the policy and
-- fires every listed channel SIMULTANEOUSLY, DEC-185). Only rows whose
-- default_channels CONTAINS 'sms' can EVER reach SMS (DC-3). See §5.2 seed.
-- NOTE (DEC-185): the v1 `reach_mode` column is REMOVED — there is no escalation;
-- urgency is now metadata only (prefs UI ordering), not a send gate.

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
-- THE delivery ledger. Webhooks reconcile final status. One row per channel
-- attempt (all of a category's policy channels are attempted in one dispatch pass).
```

**Reuse, do NOT duplicate:** `notifications` (existing in-app inbox, `idempotency_key` UNIQUE) stays the dedupe backstop — add a `dedupe_key text UNIQUE` only if a distinct key from `idempotency_key` is needed; otherwise reuse `idempotency_key` (it is already UNIQUE-backed per L341 `23505` handling). `venue_sms_opt_out`/`venue_sms_log` (venue scope) and `marketing_unsubscribes` (marketing scope) stay; the inbound-STOP webhook (§5.6) writes BOTH the new `channel_suppressions` AND, for backward-compat, the venue ledger via `biz_sms_record_global_opt_out`.

### 5.2 Category taxonomy seed (SOURCE OF TRUTH — the closed SMS-eligible set, DC-3 / DEC-185)

This seed IS the policy. The dispatcher fires every channel in `default_channels` simultaneously (DEC-185); `sms` appears ONLY in the rows below where the confirmed matrix lists it. The closed SMS-eligible set = exactly the rows whose `default_channels` contains `sms`.

**EXPLORER (buyer).** Reach rules per channel: `push` only if the user has the consumer app / an active push token; `inapp` only if the user has an account; `email` always; `sms` per policy (the rows below).

| key | section | is_transactional | urgency | text? | default_channels | Sub |
|---|---|---|---|---|---|---|
| `buyer_purchase_confirmation` | Purchases | true | high | NO | `{push,inapp,email}` | C |
| `buyer_reservation_confirmed` | Reservations | true | high | NO | `{push,inapp,email}` | C |
| `buyer_reservation_changed` | Reservations | true | high | YES | `{push,inapp,email,sms}` | C |
| `buyer_reservation_cancelled` | Reservations | true | high | YES | `{push,inapp,email,sms}` | C |
| `buyer_event_reminder_24h` | Reminders | true | high | YES | `{push,inapp,email,sms}` | C |
| `buyer_event_reminder_2h` | Reminders | true | high | YES | `{push,inapp,email,sms}` | C |
| `buyer_reservation_reminder_24h` | Reminders | true | high | YES | `{push,inapp,email,sms}` | C |
| `buyer_reservation_reminder_2h` | Reminders | true | high | YES | `{push,inapp,email,sms}` | C |
| `waitlist_spot_open` | Purchases | true | high | YES | `{push,inapp,email,sms}` | (existing→migrate) |
| `waitlist_table_ready` | Reservations | true | high | YES | `{push,inapp,email,sms}` | C |
| `buyer_refund_issued` | Purchases | true | normal | YES | `{push,inapp,email,sms}` | (existing→migrate) |
| `buyer_order_cancelled` | Purchases | true | normal | YES | `{push,inapp,email,sms}` | (existing→migrate) |
| `buyer_payment_failed` | Purchases | true | high | NO | `{push,inapp,email}` | (existing→migrate) |
| `marketing_blast` | Marketing | false | low | YES | `{push,inapp,email,sms}` (per-campaign channel select) | B |
| `social_friend_request` | Social | false | normal | NO | `{push,inapp,email}` ← email ONLY for these two | (map, §5.7) |
| `social_collab_invite` | Social | false | normal | NO | `{push,inapp,email}` ← email ONLY for these two | (map, §5.7) |
| `social_message` / `social_rsvp` / `social_other` | Social | false | low | NO | `{push,inapp}` ← NO email per chat message (deliverability) | (map, §5.7) |

> **Social-email scope (OPEN, §12a):** the orchestrator default is `{push,inapp,email}` for `social_friend_request` + `social_collab_invite` and `{push,inapp}` (NO email) for `social_message`/`social_rsvp`/`social_other` — never email per chat message (deliverability). Seth may override to add or drop email for friend-requests/collab-invites.

**BUSINESS user (business app).** Reach: `push` to the business app; `inapp`; `email`. SMS only on `payout_paid`.

| key | section | is_transactional | urgency | text? | default_channels |
|---|---|---|---|---|---|
| `biz_new_sale` | Sales | true | normal | NO | `{push,inapp,email}` |
| `biz_sold_out` | Sales | true | normal | NO | `{push,inapp,email}` |
| `biz_low_inventory` | Sales | true | normal | NO | `{push,inapp,email}` |
| `biz_refund_processed` | Sales | true | normal | NO | `{push,inapp,email}` |
| `biz_new_reservation` (NET-NEW) | Reservations | true | high | NO | `{push,inapp,email}` |
| `biz_reservation_change` (NET-NEW) | Reservations | true | high | NO | `{push,inapp,email}` |
| `biz_payout_failed` | Payouts | true | high | NO | `{push,inapp,email}` |
| `biz_stripe_account_problem` | Payouts | true | high | NO | `{push,inapp,email}` |
| `biz_bank_problem` | Payouts | true | high | NO | `{push,inapp,email}` |
| `payout_paid` | Payouts | true | high | YES | `{push,inapp,email,sms}` ← the SINGLE brand SMS (DEC-185) |

**The complete closed SMS-eligible set** (DC-3): `buyer_reservation_changed`, `buyer_reservation_cancelled`, `buyer_event_reminder_24h`, `buyer_event_reminder_2h`, `buyer_reservation_reminder_24h`, `buyer_reservation_reminder_2h`, `waitlist_spot_open`, `waitlist_table_ready`, `buyer_refund_issued`, `buyer_order_cancelled`, `marketing_blast`, `payout_paid`. **No other category may ever send SMS.** Any addition = a seed edit + a spec amendment (enforced by the strict-grep gate on the seed + `can_send()`).

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
- **No fallback logic here (DEC-185).** `can_send()` is a pure per-channel yes/no. The dispatcher (§5.4) calls it once per channel in `default_channels` and sends every channel that passes — there is no "only if push failed" condition anywhere in the gate or the dispatcher.

### 5.4 Simultaneous policy-send algorithm (pseudocode — lives in `notify-dispatch` v2) — DEC-185

There is NO waterfall, NO escalation, NO "SMS only if push undelivered." The dispatcher loops the category's `default_channels` and sends every channel that `can_send()` admits — all in one pass.

```
dispatch({user_id|contact, category_key, payload, idempotency_key, country_code?}):
  1. cat = load notification_categories[category_key]; assert active.
  2. INSERT notifications(idempotency_key,…) ON CONFLICT(idempotency_key) DO NOTHING.
     if conflict → return {duplicate:true}.                 -- idempotency (reuse existing 23505 path)
  3. for channel in cat.default_channels:                   -- the POLICY, fired simultaneously
        if NOT can_send(user, cat, channel, contact):       -- consent + suppression + quiet-hours
              deliveries row(channel, status='suppressed'); continue.
        switch channel:
           'inapp': requires an account → deliveries row(status='delivered').   -- free, durable
           'push' : requires an active push token (consumer app for buyer cats /
                    business app for biz cats); else deliveries row(status='skipped').
                    ok = pushAdapter.send(user, payload)  → deliveries row(sent/failed).
           'email': always reachable if a contact email exists.
                    emailAdapter.send(contact, render(cat,payload)) → deliveries row.
                    (For confirmations the email carries the PDF/ics artifact — §7.1.)
           'sms'  : ONLY if 'sms' ∈ cat.default_channels (guaranteed by the loop) AND
                    SMS_LIVE_ENABLED_<market> AND a contact phone exists.
                    smsAdapter.send(contact, sanitize(render(cat,payload))) → deliveries row(segments).
  4. webhooks (§5.6) reconcile each delivery's final status asynchronously. DONE — no next hop.
```
- **Every passing channel sends now.** A user who has the consumer app AND consented to SMS on a text-eligible category gets BOTH the push and the SMS — by design (DEC-185), not a bug.
- **Cost discipline** = the curated SMS-eligible seed (§5.2), the per-market kill-switch, and consent/suppression/quiet-hours — NOT a fallback condition.
- **No `reach_mode`, no escalation timeout T, no `notify-escalate` worker** (all removed per DEC-185).

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

## 6. Sub-B — marketing blasts (now push + in-app + email + SMS)

**Goal:** brands send compliant blasts across email, SMS, **and (NEW, DEC-185) push + in-app to consumer-app users**, with cost + deliverability discipline. The `marketing_blast` category is `{push,inapp,email,sms}` (§5.2): an opted-in consumer-app explorer can receive a blast as a free push + durable in-app row in addition to email/SMS.

### Exact changes
1. **`marketing-send/index.ts`** — replace the `sms` throw (L261) with a real SMS dispatch through the Sub-A `smsAdapter` (marketing Messaging Service SID per §12 Q2). Write `marketing_messages(recipient_phone, channel='sms', status, provider_message_id, segments)`. Keep the `MARKETING_SEND_LIVE_ENABLED` gate AND add the per-market kill-switch (`SMS_LIVE_ENABLED_US`/`_NG`). Leave the `rcs` throw (L263) in place.
1b. **NEW push + in-app marketing leg (DEC-185)** — for audience contacts resolvable to a `user_id` with the consumer app, ALSO dispatch the blast via the Sub-A `pushAdapter` + an in-app `notification_deliveries(channel='inapp')` row, gated by `can_send(user,'marketing_blast',channel,_)` (marketing scope, off-by-default consent). This delivers blasts to opted-in explorers in-app/push at zero marginal cost; SMS/email remain the contact-keyed paths for non-app or no-account recipients. Idempotent per (campaign, recipient).
2. **`_shared/marketingAudience.ts`** — **fix the phone-keyed suppression gap.** Today suppression is email-keyed only; `smsOk` is computed but never actually checks a phone suppression. Add a phone-keyed lookup against `marketing_unsubscribes(contact_phone)` AND `channel_suppressions(channel='sms', scope ∈ {marketing,all})`. `reach.reachable_sms` becomes truthful. (I-PROPOSED-1161-SMS-OPT-OUT-HONORED-ANY-CHANNEL.)
3. **`ChannelTabs.tsx`** L42 — flip `{kind:"sms", enabled:true, caption:""}`. Keep RCS disabled.
4. **`blasts.tsx`** L85/191 + composer — display `reachable_sms` when the SMS channel is selected; show **estimated segment count + cost preview** (GSM-7 vs UCS-2) before send (cost guard). Pass `reachable_sms` to the CTA.
5. **MARKETING opt-in capture (bundled-mandatory grant, separate suppression scope)** — per DEC-186 marketing consent is now captured INSIDE the single mandatory consent gate (the consumer-app OTP consent box + the anon checkout T&C checkbox — §8/§10): checking it grants marketing along with transactional+reminders, recorded as a `scope='marketing'` row in `consent_records` (with the EXACT bundled disclosure text). Marketing remains a SEPARATE *suppression* scope from transactional in `channel_suppressions`: a marketing STOP/unsubscribe writes `scope='marketing'` (or `'all'` only on explicit all-channels opt-out) — never killing transactional confirmations. (The grant is bundled; the opt-out scopes stay separate so a marketing STOP can never silence a booking confirmation — I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED.)
6. **Quiet hours (marketing only)** — block marketing SMS outside 8 AM–9 PM recipient-local (US) / 8 AM–8 PM WAT (NG). Derive TZ from country_code/area code; if unknown, conservative deny outside the window. (FCC quiet hours — see §8.2.)
7. **Branded short links** — marketing SMS click links use the existing `/m/{tracking_id}` Mingla-hosted redirect (NOT bit.ly). Reuse `marketing-track-click`.
8. **Throughput throttling** — batch + throttle SMS sends (mirror the email `BATCH_LIMIT=10` + backoff) to a predictable rate (no burst-blast); respect toll-free/10DLC throughput tier.
9. **Deliverability thresholds** — wire the Resend webhook (email) + Twilio status (SMS) into a per-campaign bounce/complaint/undelivered counter; auto-suppress hard bounces/complainers immediately (§8.5).

### Compliance gating
Sub-B SMS sending stays OFF until the §8 marketing gate passes per market. Email blasts are unaffected (already live).

---

## 7. Sub-C — high-touch transactional

Each moment: trigger source → channels (the category's `default_channels` fired SIMULTANEOUSLY via Sub-A, DEC-185) → buyer copy contract → transactional consent → idempotency.

### 7.1 Buyer purchase confirmation (event/trip/experience ticket) — NO text (DEC-185)
- **Trigger source:** `stripeWebhookRouter.ts` order finalize (`fireOrderFinalizeNotifications`, the `business.order_paid` brand path at ~L1189) — ADD a buyer-side dispatch call to `notify-dispatch` v2 with `category_key='buyer_purchase_confirmation'`. (Today the buyer gets EMAIL via `ticket-confirmation-dispatch` but NO push — recon §C.)
- **Channels:** `{push,inapp,email}` — NO SMS (DEC-185 confirmed matrix). All three fire simultaneously: in-app + push (NEW, free) AND email (carries the ticket PDF+ics artifact — the system-of-record). No SMS leg for this category.
- **Buyer copy:** in-app/push title + body only (no SMS body needed). E.g. push: `"{Brand}: You're in for {Event} on {date} — tickets in the Mingla app."`
- **Consent:** transactional — derived from the purchase action; recorded as `consent_records(scope='transactional', source='checkout', action='granted', disclosure_text=<the bundled T&C/consent copy, §8>, country_code, ip_hash)`. (Buyer phone is still captured at checkout — `orders.buyer_phone_e164` — for the text-eligible reservation/reminder/refund categories.)
- **Idempotency:** `idempotency_key='buyer_purchase_confirmation:{orderId}'`. Email retry rides the existing `ticket_order_notifications` backbone; cross-channel truth in `notification_deliveries`.

### 7.2 Buyer reservation confirmed (NO text) / changed / cancelled (text) (NET-NEW)
- **Trigger source:** `biz_reservation_transition(p_reservation_id, p_to_status, …)` (`20261010000001_orch_1148_reservation_lifecycle_rpcs.sql`) is `SECURITY DEFINER` plpgsql — **it cannot make HTTP calls.** Wiring (DEC-185 resolved §12 Q7 → **DB-trigger + queue/outbox**):
  - **DB-trigger + outbox (DECIDED):** an `AFTER UPDATE` trigger on `reservations.status` writes a `notification_outbox` row; a 1-min cron drains it to the dispatcher. The transition RPC is the single chokepoint, so the trigger guarantees coverage of ALL entry points (operator, consumer, guest-web). Map: `confirmed`→`buyer_reservation_confirmed`; `seated`/table reassignment/time change→`buyer_reservation_changed`; `cancelled_by_guest`/`cancelled_by_venue`→`buyer_reservation_cancelled`. Also fan out the NET-NEW brand-side `biz_new_reservation`/`biz_reservation_change` from the same outbox row. (Edge-layer fan-out is the rejected alternative — it risked missing a path.)
- **Channels (DEC-185 confirmed matrix):**
  - `buyer_reservation_confirmed` = `{push,inapp,email}` — **NO SMS.**
  - `buyer_reservation_changed` / `buyer_reservation_cancelled` = `{push,inapp,email,sms}` — all fire simultaneously. push only if `consumer_user_id` present; email to `guest_email`; SMS to `guest_phone_e164`. For an anon `created_via='guest'` reservation there is no push token → in-app skipped/no-account, email + SMS only.
- **Buyer copy (text categories, GSM-7, ≤1 segment target):**
  - confirmed (push/inapp only): `"{Brand}: Table for {party} confirmed {date} {time}."`
  - changed (SMS): `"{Brand}: Your reservation changed — now {date} {time}, party {party}. Reply STOP to opt out."`
  - cancelled (SMS): `"{Brand}: Your reservation for {date} was cancelled. Reply STOP to opt out."`
- **Consent:** transactional; recorded with `source='reservation'`. Phone = `reservations.guest_phone_e164`.
- **Idempotency:** `idempotency_key='buyer_reservation_{status}:{reservationId}:{transitionAt}'` (transition timestamp distinguishes repeated changes).

### 7.3 Buyer pre-event/trip/reservation reminder (NET-NEW scheduled job) — text-eligible
- **Trigger source:** NEW edge fn `notify-reminders` on a pg_cron schedule (reuse the `cron.schedule(... net.http_post(... '/functions/v1/notify-reminders'))` pattern from `20260603000000_orch_0815_b_marketing_send_cron.sql`). Runs every ~15 min; selects upcoming events/trips/experiences (from `events`/event_dates) and reservations (`reservations.reserved_for`) within a lead-time window, de-duped by `idempotency_key`.
- **Lead-time params (§12 Q1 RESOLVED):** **24h-ahead reminder + a T-2h same-day nudge** (both buckets). Configurable via env or a `reminder_lead_times` config.
- **Channels (DEC-185 confirmed matrix):** BOTH the 24h and 2h buckets are text-eligible — categories `buyer_event_reminder_24h`/`_2h` and `buyer_reservation_reminder_24h`/`_2h` are each `{push,inapp,email,sms}`. All listed channels fire simultaneously per bucket (no escalation, no "SMS only if push failed"). Cost discipline = the per-market kill-switch + consent/suppression/quiet-hours, not a fallback.
- **Buyer copy:** `"{Brand}: {Event/Reservation} starts in {N}h — {time}. See you there! Reply STOP to opt out."` (generic — no sensitive detail).
- **Consent:** transactional; `category_key='buyer_event_reminder_{24h|2h}'` / `'buyer_reservation_reminder_{24h|2h}'`.
- **Idempotency:** `idempotency_key='{category}:{entityId}:{leadBucket}'` (leadBucket = `24h`|`2h`) — guarantees exactly one per bucket even across cron overlaps.

---

## 8. Compliance gate (BLOCKING) — every [HARD] item → a build requirement + go/no-go

SMS for a market is OFF (`SMS_LIVE_ENABLED_<MKT>=false`) until ALL of that market's gate items pass. This maps `INVESTIGATE_..._SMS_COMPLIANCE_RESEARCH.md` §6 checklist 1-on-1.

> ### ⚠️ CALLOUT — bundled-consent TCPA risk ACCEPTED (DEC-186), legal sign-off is a GO-LIVE BLOCKER
> Per DEC-186 (Seth, 2026-06-19, AskUserQuestion = "Bundle everything as mandatory"), the consumer-app OTP consent box and the anon checkout T&C checkbox each gate continuation on **ONE mandatory checkbox** covering T&Cs + transactional + reminders + EMAIL marketing + **SMS marketing**. Every signup/checkout auto-enrolls in marketing.
>
> **This is a known TCPA violation on the SMS-marketing portion.** US TCPA / 47 CFR 64.1200 bars making PROMOTIONAL-text consent a *condition of purchase/signup* — promotional-text consent must be "freely given" and "not required as a condition of purchase." Bundling SMS-marketing consent into a required-to-continue checkbox violates this (email marketing = CAN-SPAM opt-out, fine to bundle; transactional + reminders fine to require). Exposure: ~$500–$1,500 per text + carrier filtering. The orchestrator-recommended-but-not-taken alternative was a "compliant split" (gate on T&C+transactional+reminders+email; SMS-marketing a SEPARATE non-blocking opt-in). **Seth accepted the risk.**
>
> **Mitigations REQUIRED in the build (mostly already in this spec):** record EXACT disclosure text + timestamp + ip_hash + country into `consent_records` at every grant; instant STOP from any channel; separate transactional vs marketing senders; quiet hours; per-market kill-switch stays false until the §8 gate passes.
>
> **GO-LIVE BLOCKER:** explicit **legal sign-off accepting the TCPA risk before SMS-MARKETING flips live** (US especially). `mingla-product` owns the T&C + disclosure copy; counsel review recommended. See risk **R-8** (§13) and the Go/No-Go gate item #8 below.

### 8.1 Consent data model [HARD] — now bundled-mandatory grant (DEC-186)
- `consent_records` (§5.1) per (user/contact, channel, scope) with opt-in timestamp + EXACT disclosure_text + source/ip_hash + country_code. Per DEC-186, marketing is **bundled into the single mandatory consent checkbox** (NOT unchecked-by-default) alongside transactional + reminders + email-marketing; the grant writes BOTH a `scope='transactional'` and a `scope='marketing'` record with the EXACT bundled disclosure text. Transactional = also recorded. ✅ build req: §5.1 + §7 + §10 record-on-grant. (Suppression scopes stay SEPARATE — a marketing STOP never kills transactional.)

### 8.2 US TCPA/CTIA/FCC [HARD] — risk-accepted bundling (DEC-186)
- Marketing → TCPA requires prior express **WRITTEN, freely-given** consent that is NOT a condition of purchase. **DEC-186 knowingly bundles SMS-marketing consent into the required checkbox — a known violation, risk ACCEPTED by Seth, gated on legal sign-off (callout above + R-8).** Transactional → prior express consent, **NO promotional content mixed in** (every Sub-C transactional copy in §7 is pure transactional). ✅
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

### 8.6 Consent capture UX [HARD] (per-surface in §10) — bundled-mandatory (DEC-186)
- Per DEC-186 the marketing opt-in is NO LONGER an unchecked-by-default separate checkbox; it is **bundled into the single mandatory "I agree to all terms and conditions" gate**. The bundled disclosure (opened via a sheet/expander) MUST still surface the SMS-marketing-specific elements for the legal record: brand/Mingla identity + "agree to receive marketing texts + reminders + transactional updates" + expected frequency + "Msg & data rates may apply" + STOP/HELP + a link to full T&Cs. The EXACT disclosure string shown is recorded into `consent_records.disclosure_text` (both scopes).
- Pay/Continue is GREYED OUT until the box is checked (§10). The recorded disclosure is the legal burden-of-proof artifact backing the risk-accepted bundling.

### Go/No-Go gate (per market) — ALL must be GREEN before `SMS_LIVE_ENABLED_<MKT>=true`
1. Sender registered/verified (toll-free or 10DLC for US; Sender ID + NOCs for NG).
2. `consent_records` writing on every grant path; disclosure text recorded.
3. `channel_suppressions` honored in `can_send()`; inbound-STOP webhook live + tested (US); DND/app-pref path live (NG).
4. Quiet hours enforced for marketing (verified by a quiet-hours test).
5. StatusCallback + inbound webhook + Resend webhook live; 30034/30007/30032 alarms wired.
6. A live test SMS to a staff number delivered + a STOP round-trip suppresses.
7. Separate transactional vs marketing sender confirmed (a marketing STOP does not block a transactional send — proven).
8. **(SMS-MARKETING ONLY, DEC-186) Explicit legal sign-off obtained accepting the bundled-consent TCPA risk** — recorded before `SMS_LIVE_ENABLED_<MKT>=true` is flipped for any MARKETING SMS in that market (US especially). Transactional SMS does not require this item; marketing SMS is blocked until it's GREEN. mingla-product owns the T&C/disclosure copy; counsel review recommended.

---

## 9. DRAFT invariants (`I-PROPOSED-1161-*`, flip ACTIVE at CLOSE — orchestrator owns the flip)

| ID | Rule | Enforcement | Regression test (fails-on-revert) |
|---|---|---|---|
| **I-PROPOSED-1161-UNIFIED-DISPATCHER-SOLE-SEND-PATH** | No push/email/SMS send originates outside `notify-dispatch` v2 or its adapters. No new direct `sendPush`/`sendTwilioSms`/`api.resend.com` call in product code outside `_shared/adapters/*` (+ the labeled transitional `marketing-send`/`ticket-confirmation-dispatch` owners). | strict-grep gate `.github/scripts/strict-grep/i-proposed-1161-unified-dispatcher-sole-send-path.mjs` (ORCH-0863-style; COMMS-0002) | Adding a raw `sendTwilioSms(` outside an adapter → grep FAILS. |
| **I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES** (DEC-185) | An SMS sends ONLY for a category whose §5.2 seed lists `sms` in `default_channels` AND only after `can_send(...,'sms',...)` passes (consent + suppression + quiet-hours + per-market kill-switch). There is NO fallback/escalation condition — SMS fires simultaneously with the other policy channels. The closed SMS-eligible set IS the seed. | test (dispatcher unit) + strict-grep on the seed | Test: dispatch a category with `sms` in its policy + consent → SMS sent alongside push/email; dispatch a NO-text category (e.g. `buyer_purchase_confirmation`) → SMS NEVER attempted regardless of push status. Adding `sms` to a non-eligible seed row, or sending SMS for a row without `sms`, → fails. |
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
| **1. Consumer iOS** (`app-mobile`) | YES | Receives buyer push for purchase/reservation/reminder (NEW) + push/in-app marketing blasts (NEW, DEC-185); per-category × per-channel notification prefs incl. SMS toggles + transactional categories + reminder/reservation categories. **OTP/consent screen: the consent box copy is UPDATED (DEC-186)** to include agreement to T&Cs + transactional + reminders + email marketing + SMS marketing — every signup auto-enrolls in marketing. | `app-mobile` OTP/consent onboarding step (find the consent step in onboarding — see note below) for the bundled copy; `app-mobile/src/components/profile/AccountSettings.tsx` (extend L694-806 prefs section, incl. a marketing opt-OUT toggle since enrollment is now automatic); a new prefs hook/service writing `notification_channel_prefs` + `consent_records` (both scopes, with disclosure_text); OneSignal already wired. | Shared RN code → auto Android parity. |
| **2. Consumer Android** (`app-mobile`) | YES | Same as iOS. | Same files. | Auto (shared). |
| **3. Buyer/anon Web** (`mingla-business` checkout + public pages) | YES | **Bundled-mandatory consent gate (DEC-186):** name + email + phone become REQUIRED; the old "Email me about this organiser's future events" checkbox becomes an underlined **"I agree to all terms and conditions"** that opens a sheet with full T&Cs (protect + absolve Mingla; enroll in reminders for this event + future events + marketing blasts; copy phrased to also cover marketing). **Pay/Continue is GREYED OUT until checked.** Buyer **country** capture at checkout; unsubscribe/STOP landing (reuse `marketing-unsubscribe`). | `mingla-business/app/checkout/[eventId]/buyer.tsx` (L550-574 checkbox → required name/email/phone + the underlined T&C checkbox → T&C sheet + country field + Pay-button disabled-until-checked); finalize RPC writes `consent_records` (both scopes + disclosure_text + ip_hash + `country_code`); `marketing-unsubscribe` (already supports phone+sms). | Web-specific (manual parity vs native checkout). |
| **4. Business iOS** (`mingla-business`) | YES | Marketing Hub blast composer SMS tab ENABLED; SMS reach + segment/cost preview; **brand alerts now ALSO deliver via email** (DEC-185 — `{push,inapp,email}` on all brand categories; NET-NEW `biz_new_reservation`/`biz_reservation_change`), and **`payout_paid` is the single brand SMS**. | `mingla-business/src/components/marketing/ChannelTabs.tsx` (L42 enable), `app/brand/[id]/blasts.tsx` (L85/191 reach), composer compose route, `src/services/marketing/*`, `src/types/marketing.ts`; brand-alert email+payout-SMS via `_shared/businessNotifyTriggers.ts` re-route (backend). | Shared RN → auto Android. |
| **5. Business Android** (`mingla-business`) | YES | Same as Business iOS. | Same. | Auto (shared). |
| **6. Backend** (`supabase/`) | YES (heaviest) | `notify-dispatch` v2 (simultaneous policy send) + tables + `can_send()` + adapters + webhooks + `notify-reminders` cron + reservation notify wiring (DB-trigger + outbox) + `marketing-send` SMS + push/inapp legs + audience phone-suppression fix. (No escalation worker — DEC-185.) | `supabase/functions/notify-dispatch`, `_shared/adapters/*`, `twilio-message-status`, NEW `twilio-inbound-sms`, NEW `resend-email-status`, NEW `notify-reminders`, `marketing-send`, `_shared/marketingAudience.ts`, reservation `notification_outbox` trigger + drain cron, `1161` migrations. | N/A. |
| Admin Web (`mingla-admin`) | **NO** | reason: no compose/receive surface. | — | — |
| Business Web preview (adjacent) | **NO** | reason: blast composer is native-first; web preview not a 1161 deliverable. | — | — |

---

## 11. Phased rollout / sequencing

### Sub-A FIRST (hard gate — DC-1). Recommended thin first END-TO-END ship (the "thin booking loop" analog):
**THIN SLICE = one moment, end-to-end, simultaneous policy send, US-only, real consent.** Recommend **buyer reservation CHANGED** (`buyer_reservation_changed`) as the thin slice (DEC-185-revised — the v1 pick `buyer_reservation_confirmed` is now a NO-text category, so it would NOT exercise SMS). `buyer_reservation_changed` is `{push,inapp,email,sms}`, so it exercises the FULL stack end-to-end including the SMS leg: category seed → `can_send` per channel → push adapter + email adapter + smsAdapter firing simultaneously → status webhook → inbound STOP round-trip → suppression. It reuses the live toll-free and proves the reservation-notify wiring (DB-trigger + outbox) — without needing the marketing sender or the reminder cron. Ship that one moment to staff devices, prove simultaneous delivery + a STOP round-trip suppresses the next SMS, THEN fan out the other Sub-C categories + Sub-B. (Pair it with `buyer_reservation_confirmed` if you want the NO-text path proven in the same slice.)

### Per-sub pipeline
- **Sub-A:** DESIGN (consumer prefs-UI redesign via `mingla-designer` — per-category×channel matrix; bundled-consent UX for the OTP screen + checkout T&C sheet) → IMPLEMENT (tables + dispatcher v2 simultaneous policy send + adapters + webhooks + transitional migration) → TEST (mingla-tester: `can_send` per-channel matrix, simultaneous-send, idempotency, STOP round-trip, transactional-vs-marketing isolation) → CLOSE (flip invariants; close the dual-write window).
- **Sub-B:** DESIGN (composer SMS tab + cost/segment preview + marketing consent copy) → IMPLEMENT (marketing-send SMS leg + audience phone-suppression fix + quiet hours + throttling) → TEST → CLOSE. **BLOCKED on §8 US marketing gate.**
- **Sub-C:** DESIGN (buyer copy + reminder lead-time config) → IMPLEMENT (purchase-confirm push+inapp + reservation notify wiring via DB-trigger+outbox + `notify-reminders` cron, 24h+2h buckets) → TEST (reminder bucketing, reservation transition coverage, simultaneous per-channel send) → CLOSE.

### Edge-deploy / OTA hazards (COMMS-0015/0018/0027)
- Deploy edge fns from MERGED `main` only (clobber risk) — never from a stale worktree.
- Apply `1161` migrations via the Supabase Management API after REVIEW (MCP read-only; CLI drift-wedged) — version monotonic above the current max on origin/main.
- Consumer/business OTA per-platform via `npx -y eas-cli@latest update` (the EAS gotcha); buyer-web deploys only from `main` with the `[deploy]` tag (RSVP-close trap: a non-`[deploy]` commit after yours cancels the build).
- Set Twilio/Resend/OneSignal secrets via Supabase secrets at deploy; never hardcode.

---

## 12. PRODUCT DECISIONS — mostly RESOLVED (DEC-185/DEC-186); 2 remain OPEN

### RESOLVED (recorded answers — no longer open)
1. **Reminder lead times — RESOLVED:** 24h-ahead + a T-2h same-day nudge (both buckets text-eligible per the DEC-185 matrix). Env-configurable via `reminder_lead_times`.
2. **US marketing sender — RESOLVED:** SEPARATE marketing Messaging Service (reputation isolation); start with a toll-free second number, register 10DLC only if volume outgrows it. Transactional stays on the existing approved toll-free.
3. **Nigeria SMS — RESOLVED:** PHASED — region-routing seam now, US first; NG transactional in v1.x, NG marketing later. `SMS_LIVE_ENABLED_NG=false` until the NG gate passes.
4. **Buyer phone OTP before transactional SMS — RESOLVED:** NO. Consent is derived from the booking action; no OTP round-trip gate (OTP stays on Verify for auth).
5. **Escalation timeout (push→email/SMS) — MOOT (DEC-185).** There is no escalation/waterfall; all policy channels fire simultaneously. No timeout exists.
6. **Purchase-confirmation SMS fallback-only vs always-on — MOOT (DEC-185).** `buyer_purchase_confirmation` is a NO-text category (`{push,inapp,email}`); there is no SMS leg for it at all, so the fork no longer exists.
7. **Reservation notify wiring — RESOLVED:** DB-trigger → `notification_outbox` → 1-min cron drain (guarantees coverage of all transition entry points from the single RPC chokepoint).
- **Consent model — RESOLVED (DEC-186):** bundled into a single mandatory gate; TCPA risk ACCEPTED (see §8 callout + R-8).

### STILL OPEN (genuine forks for Seth)
- **(a) Social-email scope.** For `social_friend_request` + `social_collab_invite`: keep email (orchestrator default `{push,inapp,email}`) or drop it to `{push,inapp}` only? `social_message`/`social_rsvp`/`social_other` are firmly `{push,inapp}` (NEVER email per chat message — deliverability). **Default = add email for friend-requests + collab-invites; Seth may override.**
- **(b) Legal sign-off owner + timing for the TCPA risk** before SMS-MARKETING go-live (DEC-186). WHO signs off (counsel? Seth on counsel advice?) and WHEN relative to the US marketing-SMS flip. This is a Go/No-Go gate item (§8 #8) and a go-live BLOCKER for marketing SMS; mingla-product owns the T&C/disclosure copy.

---

## 13. Risks & blast radius

- **R-1 — STALE LOCAL ANCHOR (process risk).** The anchor checkout local `main` is BEHIND `origin/main` (HEAD `84d583e87` vs origin `a58f46ffa`); META-ORCH-1148 2.1b (#508) + ORCH-1157 are on `origin/main` but NOT local `main`. **Every Sub-C reservation dependency (`reservations`, `biz_reservation_transition`, `send-venue-sms`, `venue_sms_opt_out`) exists on `origin/main` and this spec is written against it.** The implementor's worktree MUST `git fetch origin && git rebase origin/main` before any work, or it will build against phantom-absent dependencies.
- **R-2 — Twilio cost runaway.** A loop or a mis-seeded category (`sms` added to a high-volume row) could blast SMS — and since all policy channels fire simultaneously (DEC-185, no fallback), an SMS-eligible category texts EVERY consented recipient on every send. Mitigation: the curated closed SMS-eligible seed (§5.2) + the seed strict-grep gate + per-market kill-switch + Twilio Messaging Insights/Intelligent Alerts + a deliveries-table cost dashboard + segment-count recording + idempotency.
- **R-3 — Transactional kill from a marketing STOP.** If scopes leak, a marketing opt-out could silence booking confirmations (legal + UX disaster). Mitigation: I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED + separate senders + the §8 gate item #7 proof.
- **R-4 — Mid-migration double-send / silent drop.** Routing existing senders onto v2 while keeping them live risks duplicate or lost notifications. Mitigation: dual-write + idempotency_key + the transitional labeling + a TEST pass on every existing notification type before closing the dual-write window.
- **R-5 — Unregistered/unverified sender → zero delivery (30034/30032).** Mitigation: the §8 go/no-go gate blocks `SMS_LIVE_ENABLED` until the sender is verified + a live test send delivered.
- **R-6 — Inbound STOP webhook is net-new** (today only status callbacks exist). If it's not live, app-side suppression drifts from Twilio's carrier-level STOP → we keep texting opted-out users (TCPA exposure). Mitigation: gate item #3.
- **R-7 — Anon/guest reservations have no push token + may lack email.** push/inapp skipped (no token/no account) → only the email + SMS channels in the category policy reach them; ensure `can_send` handles `user_id IS NULL` (contact-keyed) paths.
- **R-8 — Bundled-consent TCPA violation (DEC-186, risk ACCEPTED).** Bundling SMS-marketing consent into a required-to-continue checkbox (consumer-app OTP box + anon checkout T&C gate) violates US TCPA / 47 CFR 64.1200 — promotional-text consent cannot be a condition of purchase/signup and must be freely given. Exposure: ~$500–$1,500/text + carrier filtering. **Seth accepted the risk.** Mitigations (required, mostly in-spec): record EXACT disclosure text + timestamp + ip_hash + country into `consent_records`; instant STOP from any channel; separate transactional vs marketing senders; quiet hours; per-market kill-switch. **GO-LIVE BLOCKER: explicit legal sign-off accepting the TCPA risk before SMS-MARKETING flips live (US especially)** — §8 Go/No-Go gate item #8; mingla-product owns the T&C/disclosure copy; counsel review recommended. The orchestrator-recommended-but-not-taken alternative was a "compliant split" (SMS-marketing as a separate non-blocking opt-in).
- **Cross-ORCH:** sibling META-ORCH-1160 (Growth OS = measurement/analytics) is complementary (no channel-delivery overlap). META-ORCH-1148 (venue suite) is the upstream provider of the reservation model + the approved toll-free pattern — coordinate any change to `venue_sms_opt_out`/`twilio-message-status` (this spec EXTENDS, not replaces, both).

### Allowlist (implementor may touch) / DO-NOT-TOUCH
**Allowlist:** `supabase/functions/notify-dispatch/**`, `supabase/functions/_shared/adapters/**` (new), `supabase/functions/twilio-message-status/**`, `supabase/functions/twilio-inbound-sms/**` (new), `supabase/functions/resend-email-status/**` (new), `supabase/functions/notify-reminders/**` (new), `supabase/functions/marketing-send/**`, `supabase/functions/_shared/marketingAudience.ts`, `supabase/migrations/2026111*_orch_1161_*.sql` (new), `mingla-business/src/components/marketing/ChannelTabs.tsx`, `mingla-business/app/brand/[id]/blasts.tsx`, `mingla-business/src/services/marketing/*`, `mingla-business/src/types/marketing.ts`, `mingla-business/app/checkout/[eventId]/buyer.tsx` + the finalize RPC consent write, `app-mobile/src/components/profile/AccountSettings.tsx` + new prefs hook/service, the `app-mobile` OTP/consent onboarding step (DEC-186 bundled copy), `supabase/functions/_shared/businessNotifyTriggers.ts` (re-route brand notifs through the dispatcher: add `{push,inapp,email}` fan-out + `payout_paid` SMS per DEC-185), the reservation `notification_outbox` trigger + drain cron (new migration), `stripeWebhookRouter.ts` (ADD the buyer-notify dispatch call ONLY), `.github/scripts/strict-grep/i-proposed-1161-*.mjs` (new).
**DO-NOT-TOUCH:** `send-otp`/`verify-otp` (Twilio Verify — A2P-exempt), `send-venue-sms`/`venue_sms_opt_out`/`venue_sms_log` semantics (EXTEND via the inbound webhook only; do not change the venue send path), the Stripe webhook money seam in `stripeWebhookRouter.ts` (add ONLY the buyer-notify dispatch call; do not touch finalize/refund money logic), the reservation lifecycle RPC money/transition logic (add notify via outbox/trigger only), `businessNotifyTriggers.ts` brand-push *delivery* semantics (route through the dispatcher; per DEC-185 add the `{push,inapp,email}` fan-out to all brand categories and `sms` to `payout_paid` ONLY — no other brand SMS; `businessNotifyTriggers.ts` itself is in the allowlist for this re-routing). Any change outside the allowlist → stop-and-amend (`SPEC_AMENDMENT_META-ORCH-1161_*.md`).

---

## Downstream routing

Next = **Seth REVIEW** of this v2 canonical spec (especially the 2 remaining §12 OPEN items: social-email scope + legal-sign-off owner/timing). On approval → per-sub DESIGN (mingla-designer for the consumer prefs matrix + bundled-consent UX (OTP box + checkout T&C sheet) + composer SMS tab) → mingla-implementor (Sub-A first, thin slice = `buyer_reservation_changed` so the SMS leg + STOP round-trip are proven end-to-end) → mingla-tester → orchestrator CLOSE (flip I-PROPOSED-1161-* ACTIVE incl. the renamed SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES invariant, close dual-write window). Each sub runs in its own per-ORCH worktree off `origin/main`. The legal sign-off (DEC-186) gates SMS-MARKETING go-live only.
