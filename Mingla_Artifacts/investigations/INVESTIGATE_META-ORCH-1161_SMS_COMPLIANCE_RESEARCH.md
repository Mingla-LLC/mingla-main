# INVESTIGATE — META-ORCH-1161 — SMS + Email Compliance Research (US + Nigeria)

**ORCH:** META-ORCH-1161 (multi-channel notification & messaging system)
**Phase:** INVESTIGATE (external research input #1 of 2)
**Date:** 2026-06-18
**Source:** deep internet research, current as of June 2026. Tags: **[HARD]** = legal/carrier mandate (non-compliance = blocked traffic or legal liability); **[BP]** = best practice.
**Purpose:** canonical compliance input to `SPEC_META-ORCH-1161_*`. Every SMS/email send path MUST satisfy the [HARD] items below.

---

## 0. Headline for the spec

- We already hold a **Twilio-APPROVED toll-free number (+1 888-250-5351)** used by `send-venue-sms` (META-ORCH-1148 2.1b). **Toll-free verification is a separate, valid US A2P path from 10DLC** — it likely lets us send transactional AND marketing SMS in the US WITHOUT 10DLC brand/campaign registration. The spec must make an explicit decision: **reuse the verified toll-free sender vs. register 10DLC.** Toll-free has its own throughput limits and verification (error 30032 = toll-free not verified); 10DLC error 30034 = unregistered.
- **OTP stays on Twilio Verify** (exempt from A2P registration). Everything else (confirmations/reminders/marketing) = Programmable Messaging and MUST sit on a registered/verified sender.
- **Marketing consent ≠ transactional consent.** They are legally distinct, must be captured separately, and ideally sent from separate senders/programs so a marketing STOP does not kill booking confirmations.

---

## 1. US SMS — A2P 10DLC

- **[HARD]** Any business SMS from a US 10DLC number requires TWO registrations with The Campaign Registry (via Twilio as CSP): (1) **Brand** (legal name, EIN, address), (2) **Campaign** (use case, sample messages, opt-in/opt-out flow, support info), then numbers attach via a Messaging Service.
- **[HARD]** Tiers/throughput: Sole Proprietor (no EIN, ~3k SMS/day, 1 campaign) · Low-Volume Standard (EIN, ~6k seg/day, ≤5 campaigns) · Standard/High-Volume (EIN, Trust-Score-governed up to ~600k seg/day).
- **[HARD]** Use-case categories (marketing, account notifications/2FA, customer care, delivery notifications, …) each carry their own monthly fee + throughput.
- **[HARD/$$]** Fees (TCR raised Aug 1 2025): one-time brand ~$46; campaign vetting ~$15; monthly per use case (SP ~$2, Standard ~$10, Low-Vol-Mixed ~$1.50); carrier pass-through per segment (AT&T/T-Mo/VZ ~$0.003) on top of Twilio ~$0.0079/SMS.
- **[HARD]** **Since Feb 2025 all major US carriers FULLY BLOCK unregistered 10DLC** → error **30034**. No registration = zero delivery.
- **[BP/planning]** Brand registration ~instant–days; **campaign vetting ~10–15 days**. Build lead time into launch.
- Sources: twilio.com/docs/messaging/compliance/a2p-10dlc; twilio.com/docs/api/errors/30034; twilio changelog full-blocking; apten.ai/blog/a2p-dlc-compliance-2025.

## 2. US SMS — TCPA + CTIA (carrier + legal)

- **[HARD]** Consent splits by message type: **marketing/promotional → prior express WRITTEN consent** (affirmative checkbox + disclosure); **transactional/informational (order/reservation confirmations, reminders, OTP, alerts) → prior express consent** (lower bar, derived from the action) **provided NO promotional content**.
- **[HARD]** The line is drawn broadly against you: a confirmation that also says "see our other events!" becomes marketing requiring written consent. **Keep transactional and promotional content strictly separate.**
- **[HARD]** Transactional still needs *some* consent (the user gave you the number for that purpose) and it must be recorded.
- **[HARD — FCC 2024/2025]** **Revocation by "any reasonable means"** (eff. Apr 11 2025): honor opt-out via ANY channel (SMS reply, email, web, in-app, phone). FCC named **7 keywords that MUST opt out: stop, quit, revoke, opt out, cancel, unsubscribe, end.** Process within **10 business days** (down from 30). One opt-out confirmation text allowed if no promo content. **1:1 consent rule scrapped (Jan 2025).** **Cross-channel revocation (one opt-out = ALL message types) DELAYED to Apr 11 2026** — build for it now.
- **[HARD — CTIA, carrier-enforced]** Support STOP + HELP (+ de-minimis/natural-language variants); HELP returns sender identity + support; disclose program terms incl. "**Msg & Data rates may apply**" at opt-in; **brand name (sender ID) in message body**.
- **[HARD]** **Quiet hours**: marketing texts only **8 AM–9 PM recipient-local** (derive TZ from number/area code). Active class-action area in 2025. Transactional generally exempt — but be conservative.
- **Penalties**: TCPA $500–$1,500 per message per violation.

## 3. Consent capture mechanics

- **[HARD] SMS marketing opt-in must show**: brand name; statement of agreement to receive marketing texts; expected frequency; "Msg & data rates may apply"; STOP/HELP instructions.
- **[HARD] Mechanics**: checkbox **unchecked by default** (affirmative consent); **separate** marketing vs transactional consent (do NOT bundle into ToS or the booking flow); **record-keeping** = timestamp + exact disclosure text shown + IP/source + phone + scope (burden of proof on sender).
- **[HARD] Email CAN-SPAM (FTC)**: accurate headers; non-deceptive subject; identify as ad; **valid physical postal address**; clear opt-out (no fee/extra info); opt-out works ≥30 days; **honor within 10 business days**; liable for third-party senders. Penalty up to ~$53,088/email (Verkada fined $2.95M, 2024).

## 4. Nigeria — SMS & email

- **[HARD]** **NCC DND 2442** (eff. Jul 1 2016): subscribers text STOP to 2442 for Full DND or category codes for partial. **Promotional SMS respects DND + needs consent + delivers only 8 AM–8 PM WAT; transactional (OTP/alerts) bypasses DND, delivers 24/7** but must be on a corporate/transactional route (no smuggling marketing). DND filter block = Twilio error **30007**.
- **[HARD]** **Alphanumeric Sender ID must be pre-registered** with Nigerian carriers; >30k promo/banking SMS/month needs **4 No-Objection Certificates (one per operator: MTN, Globacom, 9mobile, Airtel)**. **Alphanumeric sender IDs are ONE-WAY → STOP-reply opt-out does NOT work in Nigeria; opt-out runs via DND 2442 + app preference center.**
- **[HARD]** **NDPA 2023** (governs SMS AND email): consent must be explicit, freely given, specific, informed, unambiguous; not buried in T&Cs; as easy to withdraw as to give; objection to direct marketing stops it immediately.
- **[BP]** Scrub against DND registry regularly; log consent date/method.

## 5. Twilio specifics

- **[BP]** Group numbers in a **Messaging Service / Sender Pool**; attach the A2P campaign to it.
- **[HARD]** Twilio **auto-handles STOP/START/HELP and cannot disable it** (blocks number + sends confirmation). Default opt-out: STOP, UNSUBSCRIBE, END, QUIT, STOPALL, REVOKE, OPTOUT, CANCEL. **Advanced Opt-Out** customizes keywords AND **POSTs opt-out/HELP/opt-in events to your webhook** (`OptOutType`) → use it to sync the app suppression list. Footgun: Advanced Opt-Out applies to ALL senders in a pool.
- **[BP/HARD]** Maintain your OWN app-side suppression list (FCC requires honoring opt-out from any channel, not just SMS reply).
- **[HARD ops]** Set `StatusCallback` (Messaging Service or per-message). Statuses: accepted→queued→sending→sent→delivered/undelivered/failed. `ErrorCode` only on failed/undelivered. Callbacks retry 3× (15s timeout); **poll API if no terminal status in 12h.**
- **Error codes to handle**: 30034 (unregistered 10DLC), 30007 (filtered / NG DND), 30032 (toll-free not verified).
- **Cost (rough)**: US ~$0.011/segment all-in + A2P fees. Nigeria higher, operator-dependent + Sender ID overhead (verify in Twilio console at build).
- **[HARD architecture]** **Twilio Verify (OTP) is exempt from A2P 10DLC**; Programmable Messaging (confirmations/reminders/marketing) requires registration/verification. Keep OTP on Verify.

## 6. Implications the SPEC MUST encode (checklist)

1. **Consent data model**: per (user/contact, channel, scope=transactional|marketing) with opt-in timestamp + exact disclosure text + source/IP + state. Marketing = unchecked-by-default checkbox w/ full disclosure; transactional derived-from-action but recorded.
2. **Suppression engine**: app-side list honoring opt-out from ANY channel; sync Twilio Advanced Opt-Out webhooks; honor 7 FCC keywords + variants; process ≤10 business days; build for cross-channel revocation (Apr 11 2026).
3. **Routing**: OTP→Verify; confirmations/reminders/marketing→Programmable Messaging on a registered/verified sender; **decide toll-free (already approved) vs 10DLC**; separate transactional vs marketing campaigns/senders.
4. **Quiet hours**: block marketing outside 8 AM–9 PM recipient-local (US) / 8 AM–8 PM WAT (NG promo); derive TZ.
5. **Sender identity** (brand name) in every body; HELP returns identity + support; "Msg & data rates may apply" at opt-in.
6. **Nigeria**: alphanumeric Sender ID registration (4 NOCs); one-way → opt-out via DND/app pref; promo respects DND + WAT window; transactional 24/7 separate route; NDPA consent. Handle 30007.
7. **Email**: CAN-SPAM (physical address, unsubscribe ≥30 days, honor ≤10 days) + NDPA.
8. **Observability**: StatusCallback wired, log ErrorCode, poll after 12h, alert on 30034/30007/30032 spikes.

**Changed 2024–2026:** full US blocking of unregistered 10DLC (Feb 2025); FCC any-means revocation + 10-business-day (Apr 11 2025); 1:1 consent scrapped (Jan 2025); cross-channel revocation → Apr 11 2026; TCR fee hikes (Aug 1 2025); Nigeria NDPA 2023 now governing. TCPA quiet-hours class-action wave through 2025.
