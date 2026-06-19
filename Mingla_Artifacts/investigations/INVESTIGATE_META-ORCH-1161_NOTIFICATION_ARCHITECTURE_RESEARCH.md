# INVESTIGATE — META-ORCH-1161 — Multi-Channel Notification Architecture Research

**ORCH:** META-ORCH-1161
**Phase:** INVESTIGATE (external research input #2 of 2)
**Date:** 2026-06-18
**Source:** deep internet research (2024–2026), notification-infra vendors (Courier, Knock, SuprSend, OneSignal, Fyno, Twilio). Each claim carries a source. Tags: **[BP]** best practice.
**Purpose:** architecture input to `SPEC_META-ORCH-1161_*`. Stack target: Supabase edge functions + Postgres, Twilio (SMS), Resend (email), OneSignal (push).

---

## 1. Push-first / SMS-fallback orchestration (the cost lever)

- **[BP] Channel waterfall with escalation timeouts**, not blind fan-out: push first → if undelivered/unread after N min → email → SMS only as last resort for urgent items. (Courier: payment failure escalates to SMS only when urgent.)
- **[BP] Routing rules as DATA, not code** (a preferences table the dispatcher reads) — policy changes more often than the engine. (Knock/Courier.)
- **[BP] Delivery status drives the next hop**: push `not-delivered/not-subscribed` → fall through; push `delivered` + reach-once category → STOP. "Send SMS only if push not delivered/not subscribed" is the single biggest SMS-cost lever. (Courier.)
- **[BP] Two modes**: *reach-once* (stop on first confirmed delivery — most transactional) vs *escalate-on-no-engagement* (continue if delivered-but-unopened — reserve for high-urgency, e.g. reservation in 1h).
- **[BP] Dedup across channels via one logical `notification_id`/`dedupe_key`** so one event can't double-fire across channels/retries. (Fyno.)

**Decision rule (push-first, SMS-fallback):** resolve eligible channels from prefs → send push if active token → wait for delivery webhook up to timeout (e.g. 5 min); if delivered + reach-once → STOP; if undelivered/not-subscribed/timeout → email (cheap) → SMS **only if category=high_urgency AND time-sensitive (e.g. reservation < lead-time)**.

## 2. Notification taxonomy & preference model

- **[BP] Section → Category → per-channel toggles** (push/email/SMS/in-app). Users think in topics, not channels.
- **[BP] Transactional = on-by-default + non-toggleable; marketing = off-by-default + explicit consent.** Legal requirement (CTIA/GDPR/CAN-SPAM).
- **[BP] 5–10 categories grouped in 2–4 sections** (avoid decision fatigue).
- **[BP] Enforce preferences at the dispatcher layer, not per-flow** — one chokepoint guarantees no flow bypasses consent.
- **[BP] Single `can_send(user, category, channel)` gate** = (category transactional OR pref enabled) AND not suppressed (STOP/bounce/complaint/unsubscribe) AND within quiet-hours/rate-limit. Suppression is SEPARATE from preference (a STOP overrides everything). Keep a consent audit trail.

**Schema sketch:**
```
notification_categories(key PK, section, is_transactional bool, urgency enum, default_channels text[])
notification_preferences(user_id, category_key, channel, enabled bool, updated_at) UNIQUE(user_id,category_key,channel)
channel_suppressions(user_id|contact, channel, reason enum, created_at)   -- STOP/bounce/complaint/unsubscribe; overrides all
consent_audit(id, user_id|contact, category_key, channel, action, source, at)
notifications(id PK, user_id, category_key, dedupe_key UNIQUE, payload jsonb, created_at)  -- UNIQUE = idempotency backstop
notification_deliveries(id PK, notification_id FK, channel, status, provider_msg_id, attempt_at, delivered_at, failed_reason)
```

## 3. Transactional SMS best practices

- **[BP]** Sender identity + "Reply STOP/HELP"; process opt-outs ~instantly.
- **[BP]** Keep transactional on a **separate sender/program** so a marketing STOP doesn't kill confirmations.
- **[BP]** **Branded short links only** — US carriers filter bit.ly/tinyurl (top cause of undelivered SMS).
- **[BP]** **Segment limits = cost**: GSM-7 160/seg (153 multi); UCS-2 70/seg (67 multi). Each segment bills.
- **[BP]** **Idempotency keys** to prevent duplicate SMS on retried invocations.
- **[BP]** Retry transient failures (UNREACHABLE/EXPIRED/CARRIER_UNREACHABLE) w/ backoff; do NOT retry hard rejects (invalid/STOP).
- **[BP]** **Delivery-status reconciliation via webhooks** — API 2xx ≠ delivered; webhook confirms reach AND gates fallback.
- **[BP]** Quiet hours 10 AM–8 PM local best; reminders generic (no sensitive detail).
- **[BP]** **Reminder lead times** — practical pattern: **24h-ahead + a same-day/T-2h nudge**; exact window is a PRODUCT DECISION (not vendor-prescribed).

## 4. Marketing blast best practices

- **[BP/HARD-ish] Deliverability thresholds now enforced** (Gmail/Yahoo/MS bulk rules): spam complaints <0.3% (target <0.1%); bounces <2% → permanent 5xx rejection (Gmail Nov 2025; MS `550 5.7.515` since May 2025). Cross these → you stop reaching the inbox.
- **[BP]** List hygiene + warm-up (ramp new domains 5–10/day over 4–6 wks) + steady volume; suppress hard bounces/complainers immediately.
- **[BP]** Throughput throttling (predictable volume, no burst-blast).
- **[BP]** Send-time optimization (+15–20% opens). A/B subject testing.
- **[BP]** Branded short links for SMS click tracking; dedicated campaign numbers (separate marketing reputation from transactional).

## 5. Unified notification service — VERDICT: build ONE dispatcher

- **[BP]** A single connective layer: validate+dedupe → resolve template (type/channel/language) → evaluate preferences (opt-outs/quiet-hours/rate-limits) → orchestrate delivery. Consent + idempotency are only provably correct if every send funnels through one gate.
- **[BP] Two-layer idempotency**: API-boundary cache `SET NX` (24h TTL) PLUS a DB unique index as durable backstop.
- **[BP] Channel adapters** behind a uniform `send() → {status, provider_msg_id}` interface (hide provider quirks; support partial success + per-channel retry; swap providers without touching the engine).
- **[BP]** Retries w/ backoff + jitter, idempotency-protected. Observability: delivery rate by channel, bounce/failure, provider latency, open/CTR — these metrics ARE the fallback inputs + cost alarms.
- **Per-flow senders are an anti-pattern** — duplicate consent/idempotency/retry → drift, missed opt-outs, double-sends. Mingla ALREADY has 3 ad-hoc senders → the duplication tax is already real.

## 6. Twilio cost-control tactics (startup)

- **[BP] GSM-7 vs UCS-2 is the #1 lever** — one emoji/smart-quote/em-dash flips to UCS-2 (70/seg), ~3x cost. Consistent GSM-7 can cut cost ~70%.
- **[BP] Enable Twilio Smart Encoding + sanitize templates** (strip smart quotes → ', em-dash → -) before send. Verify segment count with the Segment Calculator pre-ship.
- **[BP] Fallback gating = biggest structural saving** (every SMS avoided by a successful push is pure margin).
- **[BP] Audience minimization** (don't SMS the whole list when push covers 90%).
- **[BP] Monitoring + anomaly alerting** (Twilio Messaging Insights + Intelligent Alerts) to catch runaway loops/cost spikes in minutes.
- **[BP] Region-aware routing** (US toll-free/10DLC vs NG sender ID) — wrong route inflates cost + tanks deliverability.

## 7. Recommended target architecture — Mingla Unified Notification Dispatcher

**Components:** (1) `notify-dispatch` edge fn = the SINGLE chokepoint (`{user_id, category_key, payload, dedupe_key, urgency}`); (2) taxonomy+preference+suppression+consent tables; (3) `can_send()` Postgres fn; (4) channel adapters: `pushAdapter` (OneSignal — reuse `_shared/push-utils.ts`), `emailAdapter` (Resend), `smsAdapter` (Twilio — **generalize `send-venue-sms`**: GSM-7 sanitizer + Smart Encoding + region routing + STOP/HELP footer + branded short link); (5) `notification_deliveries` ledger; (6) status-webhook receivers (generalize `twilio-message-status`; add Resend + OneSignal); (7) `notify-escalate` scheduled worker (promotes undelivered/unopened push after the per-category timeout).

**Channel-selection algorithm (push-first, SMS-fallback):**
```
1. INSERT notifications ON CONFLICT(dedupe_key) DO NOTHING.   // idempotency — exit if already handled
2. channels = can_send(user, category, [push,email,sms,inapp])   // consent + suppression + quiet-hours
3. Always write in-app (free, durable).
4. If push in channels AND active token: send push.
   If category.urgency != HIGH AND push later delivered → STOP (reach-once).
5. On push webhook = undelivered/not-subscribed (or timeout ~5 min): if email in channels → send email.
6. SMS ONLY IF: sms in channels AND urgency==HIGH AND time-sensitive AND (push undelivered OR no token).
   smsAdapter: sanitize→GSM-7, branded link, STOP/HELP footer, region route.
7. Every adapter writes a notification_deliveries row; webhooks reconcile final status.
```
**Why:** one `can_send` gate = provably correct consent + quiet-hours/rate-limit home; `dedupe_key` UNIQUE + ON CONFLICT = cheap durable idempotency on Postgres (no Redis at Mingla scale); SMS behind a triple gate (consent ∧ high-urgency ∧ push-failed) structurally minimizes Twilio spend; adapters+ledger+webhooks = swap providers, observe delivery, drive fallback off real state.

**Open product decisions to surface in the spec:** exact reminder lead times (24h + T-2h suggested); which categories are `urgency=HIGH` (the only ones that can EVER reach SMS); push-delivered escalation timeout (5 min default); separate Twilio sender/program for transactional vs marketing.

**Key sources:** Courier multi-channel-routing & push-fallbacks; Knock notification-infra; SuprSend preference-center; OneSignal preference-centers; Fyno idempotency; Synthetic-Horizons unified-architecture; Twilio getting-most-money / scaling-SMS; Omnisend & FirstSales email-deliverability-2026.
