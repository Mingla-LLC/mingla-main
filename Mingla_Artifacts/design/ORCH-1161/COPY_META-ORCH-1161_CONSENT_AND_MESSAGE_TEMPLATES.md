# COPY — META-ORCH-1161 — Consent + T&C + Message Templates

**ORCH:** META-ORCH-1161 (multi-channel notification & messaging system)
**Phase:** mingla-product (COPY) — brand-voice + legally-grounded copy, NOT code
**Date:** 2026-06-19
**Owner:** mingla-product
**Authority for this phase:** DEC-186 (bundled-mandatory consent; TCPA risk ACCEPTED + SIGNED OFF by Seth 2026-06-19) · SPEC_META-ORCH-1161 §7 (Sub-C moments), §8 (compliance gate), §8.6 (consent capture UX) · INVESTIGATE_META-ORCH-1161_SMS_COMPLIANCE_RESEARCH §2–§3 (required disclosure elements)

---

## ⚠️ LEGAL CALLOUT — READ BEFORE SHIPPING ANY OF THIS COPY

1. **Counsel review is RECOMMENDED for the bundled-consent line (§1) and the full T&C/consent sheet (§2).** Seth has signed off on the **TCPA risk** of bundling SMS-marketing consent into a required-to-continue checkbox (DEC-186, 2026-06-19) — that unblocks the SMS-marketing legal gate item #8 on Seth's authority as the business owner accepting the risk. **Seth's risk sign-off is NOT a substitute for an attorney reviewing the actual wording** of the consent line and the T&C body for enforceability, completeness, and jurisdiction fit. The known TCPA exposure remains real ($500–$1,500/text + carrier filtering). Have counsel read §1 and §2 verbatim before SMS-marketing flips live, especially in the US.
2. **Every `[[FILL: …]]` placeholder below MUST be replaced with Mingla's real legal/operational values before any of this copy ships.** A consent record that references a non-existent entity or a dead policy URL is worthless as a burden-of-proof artifact. The full list is in §5.
3. **The §1 string is recorded VERBATIM into `consent_records.disclosure_text`** (both `scope='transactional'` and `scope='marketing'`) at every grant on both surfaces. It is the legal burden-of-proof artifact backing the risk-accepted bundling. Whatever ships is what gets recorded — do not let implementation paraphrase it.
4. **GSM-7 discipline (I-PROPOSED-1161-GSM7-SANITIZED-TEMPLATES):** every SMS body below uses ONLY GSM-7-safe characters — straight apostrophes `'`, hyphens `-` (never em/en-dash), no curly quotes, no ellipsis character. The dispatcher still runs the sanitizer, but these are authored clean so nothing degrades. Segment counts assume GSM-7 (160 chars/segment, 153/segment when concatenated). Brand/event placeholders are variable-length; the per-template note states the worst-case assumption.

---

## 1. THE BUNDLED CONSENT LINE + CHECKBOX LABEL (the single mandatory gate)

Used on BOTH:
- the **consumer-app OTP / signup consent screen** (`app-mobile` onboarding consent step), and
- the **anonymous buyer checkout page** (`mingla-business/app/checkout/[eventId]/buyer.tsx`).

ONE mandatory checkbox. Pay/Continue is greyed out until checked. The visible label carries the underlined **terms and conditions** link that opens the §2 sheet.

### 1a. Visible checkbox label (the short line shown next to the checkbox)

> **I agree to Mingla's [terms and conditions]** and to receive booking confirmations, reminders, account updates, and marketing from Mingla and the businesses I book with — by email, push, and text. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out of texts, HELP for help.

- `[terms and conditions]` renders as an underlined tappable link opening the §2 sheet.
- This label is always fully visible (not collapsed) so the disclosure is presented at the point of consent.

### 1b. EXACT disclosure string recorded into `consent_records.disclosure_text` (VERBATIM)

> *Record this exact string (resolve the `[[FILL]]` placeholders to real values first). Both scopes get the same string. No paraphrase. Implementation must store the resolved, shipped wording.*

```
I agree to Mingla's Terms & Conditions and Privacy Policy, and I consent to receive from Mingla LLC and the businesses I book with: (1) transactional and account messages including booking and reservation confirmations, changes, cancellations, refunds, waitlist updates, and payment notices; (2) event and reservation reminders for this booking and for future events; and (3) marketing and promotional messages, including offers and announcements from venues and experience brands. These messages may be sent by email, in-app notification, push notification, and recurring automated text message (SMS) to the phone number I provide. Message frequency varies. Msg & data rates may apply. Consent to texts is not a condition of any purchase. Reply STOP to any text to opt out, or HELP for help; you can also unsubscribe from email via the link in any message or change your preferences in the Mingla app at any time. Full terms: https://www.usemingla.com/terms-of-service | Privacy: https://www.usemingla.com/privacy-policy | SMS terms: https://www.usemingla.com/sms-terms.
```

**Required-disclosure-element checklist (proves §8.6 + INVESTIGATE §3 are satisfied):**

| Required element (INVESTIGATE §3 [HARD]) | Where it appears in 1b |
|---|---|
| Brand / Mingla identity | "Mingla LLC and the businesses I book with" |
| Agreement to receive marketing texts | "marketing and promotional messages … by … recurring automated text message (SMS)" |
| Expected frequency | "Message frequency varies." |
| "Msg & data rates may apply" | present verbatim |
| STOP to opt out | "Reply STOP to any text to opt out" |
| HELP for help | "or HELP for help" |
| Terms & Conditions link | "[terms and conditions]" (1a) / "Full terms: https://www.usemingla.com/terms-of-service" (1b) |
| Transactional scope covered | "transactional and account messages including booking and reservation confirmations…" |
| Reminders (this + future events) | "reminders for this booking and for future events" |
| Email marketing covered | "marketing … may be sent by email" |
| "not a condition of purchase" (TCPA-mitigating language) | "Consent to texts is not a condition of any purchase." |
| Withdraw/opt-out cross-channel | "unsubscribe from email via the link … or change your preferences in the Mingla app at any time" |

> **Note on the "not a condition of purchase" sentence:** it is included deliberately. DEC-186 makes the checkbox required-to-continue (the accepted TCPA risk). Stating "consent to texts is not a condition of any purchase" is the standard TCPA-mitigating disclosure and is the single most useful sentence for counsel to keep. **Counsel may want to reconcile this sentence with the gated-checkbox behavior** — flag it explicitly in review. It is kept because it strengthens, not weakens, the record. (If counsel directs removal, that is a one-line edit + a re-record of `disclosure_text`.)

---

## 2. THE FULL TERMS & CONDITIONS / CONSENT SHEET BODY (opens from the §1 link)

> This is the body the underlined "terms and conditions" link opens, on BOTH surfaces. It reads correctly for signup AND for checkout/marketing context (it says "when you create an account or complete a booking"). It (a) protects + absolves Mingla and (b) enrolls the user in reminders for this event + future events + marketing (email + SMS) with opt-out instructions.
>
> **This is plain-language product copy, NOT a finished legal contract.** It is written to be readable and to surface the legally-required consent disclosures in the user's flow. Mingla's full, counsel-drafted Terms of Service and Privacy Policy (linked at the bottom) remain the controlling documents. Have counsel review or replace this body before launch.

---

### Mingla — Terms, Notifications & Consent

**Last updated: 2026-06-19**

By creating a Mingla account or completing a booking, you agree to these terms and to Mingla's full https://www.usemingla.com/terms-of-service and https://www.usemingla.com/privacy-policy, which are incorporated here by reference. If you do not agree, do not create an account or complete a booking.

**1. Who you're agreeing with.**
Mingla is operated by Mingla LLC, 700 Corporate Center Dr, Raleigh, NC 27607, USA ("Mingla," "we," "us"). Questions: support@usemingla.com · +1 888-250-5351.

**2. What Mingla is — and is not.**
Mingla helps you discover places, events, experiences, and trips and connects you with venues and experience brands ("Businesses"). **Mingla is a platform; the Businesses are independent third parties.** Events, reservations, menus, prices, availability, and experiences are created and controlled by the Businesses, not by Mingla. Mingla does not own, operate, host, or supervise any venue, event, or experience, and is not a party to your agreement with a Business.

**3. No guarantee; you assume the risks of real-world activity.**
We work to keep listings accurate, but **Mingla does not guarantee** the accuracy, availability, quality, safety, legality, or outcome of any listing, event, reservation, experience, or Business, or that any event will occur as described. You attend events and experiences and visit venues **at your own risk.** You are responsible for your own conduct and safety and for evaluating any Business before you go.

**4. Third-party responsibility.**
Any dispute about an event, reservation, experience, refund, service, injury, or loss is between you and the relevant Business. **Mingla is not responsible or liable for the acts, omissions, products, services, or content of any Business or other user.** Where Mingla processes a payment, it does so as a technical facilitator; the Business remains the merchant of record for what it sells unless stated otherwise at checkout.

**5. Limitation of liability; release.**
To the fullest extent permitted by law, Mingla and its officers, employees, and partners are **not liable** for any indirect, incidental, special, consequential, or punitive damages, or for any loss arising from your use of the app, any listing, any Business, or any event or experience. To the fullest extent permitted by law, **you release Mingla from claims arising out of disputes with Businesses or other users or from your participation in any real-world activity discovered through Mingla.** Mingla's total liability for any claim is limited to the greater of the amount you paid Mingla (not the Business) for the transaction at issue or [[COUNSEL: liability cap, e.g. US $100]]. Some jurisdictions do not allow certain limitations; where that applies, the limitation applies to the maximum extent permitted.

**6. Communications & consent — what you're signing up for.**
When you create an account or complete a booking and check the consent box, you agree to receive the following from Mingla and from the Businesses you book with:

- **Transactional & account messages** — booking and reservation confirmations, changes, cancellations, refunds, waitlist updates, payment notices, and account/security messages. These are required to use Mingla and are tied to your activity.
- **Reminders** — reminders for the event, experience, trip, or reservation you book, **and for future events** you may be interested in.
- **Marketing & promotional messages** — offers, announcements, new events, and promotions from Mingla and from venues and experience brands, including via marketing blasts.

These may be delivered by **email, in-app notification, push notification, and recurring automated text message (SMS)** to the contact details you provide. **Message frequency varies. Msg & data rates may apply.** Consent to receive marketing texts is not a condition of any purchase.

**7. How to opt out.**
- **Text (SMS):** reply **STOP** to any text to stop texts, or **HELP** for help. We also honor *quit, end, cancel, unsubscribe, revoke, and opt out*.
- **Email:** use the unsubscribe link in any marketing email.
- **In-app:** open the Mingla app and adjust your notification preferences at any time, per channel and per category.
- **Outside the US:** opt-out may also run through your local registry (for example, in Nigeria, the NCC DND service by texting STOP to 2442) and the in-app preference center.

We honor opt-out requests received by any reasonable means and process them promptly (within the timeframes required by law). **Opting out of marketing does not stop transactional or account messages**, which are required to deliver what you booked. You may still receive a single confirmation message after you opt out.

**8. Data handling.**
We collect and use the contact details and information you provide (including your name, email, phone number, and country) to operate Mingla, deliver the messages above, process bookings and payments, prevent fraud, and improve the service, as described in our https://www.usemingla.com/privacy-policy. We share necessary booking details with the Business you book with so it can fulfill your reservation or order. We do not sell your personal information except as described in the Privacy Policy. Where required, our lawful basis for marketing is your consent, which you may withdraw at any time as described in section 7. We record the date, time, exact text of this disclosure, and your country at the time you consent, as proof of your consent.

**9. Payments, refunds & cancellations.**
Prices, fees, taxes, refund eligibility, and cancellation terms are set by the Business and shown at checkout. Refunds, where offered, are handled under the Business's policy and applicable law. Mingla is not obligated to issue refunds for a Business's products or services.

**10. Eligibility & acceptable use.**
You must be the age of majority in your location (and at least 18) to enter into these terms and to receive marketing messages. You agree to provide accurate information, to use Mingla lawfully, and not to misuse the platform or other users.

**11. Changes; governing law; contact.**
We may update these terms; material changes will be notified in-app or by email, and continued use means acceptance. These terms are governed by the laws of the State of North Carolina, USA [[COUNSEL: confirm choice-of-law/venue]]. Disputes are resolved per the full https://www.usemingla.com/terms-of-service (including any arbitration or venue clause stated there). Contact us at support@usemingla.com or 700 Corporate Center Dr, Raleigh, NC 27607, USA.

**Full Terms of Service: https://www.usemingla.com/terms-of-service · Privacy Policy: https://www.usemingla.com/privacy-policy · SMS Terms: https://www.usemingla.com/sms-terms**

---

## 3. TRANSACTIONAL SMS BODY TEMPLATES (GSM-7-safe, ≤1 segment target)

**Conventions:**
- `{Brand}` = the Business's display name. `{Mingla}` not used in body (the Business name is the sender identity per CTIA brand-name-in-body rule; Mingla is the platform-of-record disclosed at opt-in).
- All transactional bodies are **PURE transactional** — zero promotional content (TCPA §2: mixing promo turns a transactional text into marketing). Do not add "see our other events" to any of these.
- "Reply STOP to opt out" included on every SMS-eligible transactional body per CTIA + the closed SMS-eligible set. STOP is auto-handled by Twilio; the inline reminder satisfies the carrier expectation and reinforces opt-out.
- Segment counts below = **fixed text only**; the brand name + interpolated values consume the rest of the segment. Worst-case guidance is given per template so implementation keeps each to 1 segment by truncating long brand names (recommend truncating `{Brand}` to ~20 chars in the SMS leg).

> The matching push title/body (free, no STOP needed) is given for each so the simultaneous-send (DEC-185) copy is complete. Push has no STOP line and no segment limit but should stay short.

### 3.1 `buyer_reservation_changed` (SMS)
```
{Brand}: Your reservation changed - now {date} {time}, party of {party}. Reply STOP to opt out.
```
- Fixed text ~75 chars. 1 segment with `{Brand}`≤20, short date/time. **Push:** title `Reservation updated` / body `{Brand}: now {date} {time}, party of {party}.`

### 3.2 `buyer_reservation_cancelled` (SMS)
```
{Brand}: Your reservation for {date} was cancelled. Questions? Contact the venue. Reply STOP to opt out.
```
- Fixed text ~84 chars. 1 segment with `{Brand}`≤20. **Push:** title `Reservation cancelled` / body `{Brand}: your {date} reservation was cancelled.`

### 3.3 `buyer_event_reminder_24h` (SMS)
```
{Brand}: {Event} is tomorrow at {time}. See you there! Reply STOP to opt out.
```
- Fixed text ~58 chars; `{Event}` variable. Keep `{Brand}`+`{Event}` combined ≤95 chars for 1 segment. **Push:** title `Tomorrow: {Event}` / body `{Brand}: starts {time}. See you there!`

### 3.4 `buyer_event_reminder_2h` (SMS)
```
{Brand}: {Event} starts in 2 hours at {time}. See you soon! Reply STOP to opt out.
```
- Fixed text ~63 chars; keep combined ≤95 for 1 segment. **Push:** title `Starting soon: {Event}` / body `{Brand}: starts in 2h at {time}.`

### 3.5 `buyer_reservation_reminder_24h` (SMS)
```
{Brand}: Reminder - your reservation is tomorrow at {time}, party of {party}. Reply STOP to opt out.
```
- Fixed text ~80 chars. 1 segment with `{Brand}`≤20. **Push:** title `Reservation tomorrow` / body `{Brand}: {time}, party of {party}.`

### 3.6 `buyer_reservation_reminder_2h` (SMS)
```
{Brand}: Your reservation is in 2 hours at {time}, party of {party}. Reply STOP to opt out.
```
- Fixed text ~74 chars. 1 segment with `{Brand}`≤20. **Push:** title `Reservation soon` / body `{Brand}: in 2h at {time}, party of {party}.`

### 3.7 `waitlist_table_ready` (SMS) — reservations
```
{Brand}: Your table is ready! Please check in within {minutes} min. Reply STOP to opt out.
```
- Fixed text ~73 chars. 1 segment with `{Brand}`≤20. **Push:** title `Your table is ready` / body `{Brand}: check in within {minutes} min.`

### 3.8 `waitlist_spot_open` (SMS) — purchases (ticket/spot opens up)
```
{Brand}: A spot just opened for {Event}. Grab it in the Mingla app before it's gone. Reply STOP to opt out.
```
- Fixed text ~88 chars; `{Event}` variable. Keep combined ≤110 for 1 segment (this one is tight — truncate `{Event}` if long, or accept 2 segments). **Push:** title `Spot open: {Event}` / body `{Brand}: a spot opened. Tap to claim it.`
- *Note: "grab it before it's gone" is urgency about the thing they waitlisted for - transactional, not a new promo. Counsel may prefer the more neutral push body; SMS kept action-oriented because the user explicitly asked to be told.*

### 3.9 `buyer_refund_issued` (SMS)
```
{Brand}: Your refund of {amount} has been issued and should appear in 5-10 days. Reply STOP to opt out.
```
- Fixed text ~80 chars. 1 segment with `{Brand}`≤20. **Push:** title `Refund issued` / body `{Brand}: {amount} refunded, 5-10 days to appear.`

### 3.10 `buyer_order_cancelled` (SMS)
```
{Brand}: Your order for {Event} was cancelled. Any payment will be refunded. Reply STOP to opt out.
```
- Fixed text ~79 chars; `{Event}` variable. Keep combined ≤100 for 1 segment. **Push:** title `Order cancelled` / body `{Brand}: your {Event} order was cancelled; payment refunded.`

### 3.11 `buyer_purchase_confirmation` — NO SMS (DEC-185). Push + email copy only.
- **Push:** title `You're in for {Event}` / body `{Brand}: {date} at {time} - your tickets are in the Mingla app.`
- **Email subject:** `Your {Brand} tickets for {Event}`
- **Email preheader:** `{date} at {time} - tickets, ticket details, and calendar file attached.`
- **Email opening line:** `You're confirmed for {Event}. Your ticket and calendar invite are attached, and everything lives in the Mingla app.`
- *(The email is the system-of-record and carries the PDF + .ics per §7.1. No STOP line on a pure transactional email, but the CAN-SPAM footer with physical address must still render — see §4.)*

### 3.12 `payout_paid` — the single BUSINESS SMS (DEC-185)
```
Mingla: Your payout of {amount} is on its way to your bank, arriving in {N} business days. Reply STOP to opt out.
```
- Fixed text ~92 chars. 1 segment with short `{amount}`/`{N}`. Sender identity here is **Mingla** (this is a Mingla-to-brand platform message, not a Business-to-buyer message). **Push:** title `Payout sent` / body `Mingla: {amount} is on its way to your bank, {N} business days.`

---

## 4. EMAIL FOOTER REQUIREMENT (applies to every email leg, especially marketing)

Every marketing email (and recommended on transactional too) MUST render the CAN-SPAM footer:

```
Mingla LLC, 700 Corporate Center Dr, Raleigh, NC 27607, USA.
You're receiving this because you agreed to messages from Mingla when you signed up or booked.
Unsubscribe: https://www.usemingla.com/unsubscribe | Manage preferences: https://www.usemingla.com/unsubscribe
```
- Physical postal address is **legally required** (CAN-SPAM [HARD]). Unsubscribe must work ≥30 days and be honored ≤10 business days.

---

## 5. PLACEHOLDERS — RESOLVED 2026-06-19 (Seth)

All operational placeholders are now filled with real Mingla values (below). Two values are deferred to COUNSEL (liability cap, governing-law confirmation), and TWO marketing-site pages must be CREATED before the referenced URLs resolve (see §5.1).

| Value | Resolved to | Status |
|---|---|---|
| Legal entity | **Mingla LLC** | ✅ filled |
| Registered postal address | **700 Corporate Center Dr, Raleigh, NC 27607, USA** | ✅ filled (CAN-SPAM) |
| Terms of Service URL | **https://www.usemingla.com/terms-of-service** | ✅ live page |
| Privacy Policy URL | **https://www.usemingla.com/privacy-policy** | ✅ live page |
| SMS Terms URL | **https://www.usemingla.com/sms-terms** | ⚠️ PAGE TO CREATE (§5.1) |
| Unsubscribe / prefs URL | **https://www.usemingla.com/unsubscribe** | ⚠️ PAGE TO CREATE (§5.1) |
| Support email | **support@usemingla.com** | ✅ live (/support page) |
| Support / HELP phone | **+1 888-250-5351** (the approved toll-free) | ✅ filled |
| Effective ("Last updated") date | **2026-06-19** (draft; counsel may restamp) | ✅ filled |
| Liability cap | `[[COUNSEL: liability cap, e.g. US $100]]` | ⏳ counsel |
| Governing law / jurisdiction | North Carolina, USA `[[COUNSEL: confirm]]` | ⏳ counsel |

### 5.1 Marketing-site pages to CREATE (Seth directive 2026-06-19) — folded into the Sub-A consent slice

The marketing site (`mingla-marketing`, Next.js app router, https://www.usemingla.com) has `/terms-of-service`, `/privacy-policy`, `/support` but **NO `/unsubscribe` and NO `/sms-terms`**. Both must be built so the consent copy's URLs resolve:
- **`/unsubscribe`** — a self-serve opt-out page (enter email and/or phone → records an opt-out). Must write to the META-ORCH-1161 suppression model (`channel_suppressions`) once Sub-A lands it (and the existing `marketing_unsubscribes`/`marketing-unsubscribe` edge fn for tokenized one-click). NOT static — it must actually suppress. CAN-SPAM: must work ≥30 days, honored ≤10 business days.
- **`/sms-terms`** — a static SMS program-terms page (program description, message types, frequency, "Msg & data rates may apply", STOP/HELP, support contact, links to Terms + Privacy). Often required for carrier/toll-free verification.
- **Sequencing:** built in the Sub-A consent slice (the `/unsubscribe` opt-out write depends on `channel_suppressions` existing). Deferred behind the in-flight thin-slice implementor to avoid concurrent-agent conflict in the ORCH-1161 worktree.

---

## 6. PROVENANCE & HANDOFF NOTES

- Brand voice: warm, plain-English, "show up for real life" (Canonical Voice) — but consent/legal copy is intentionally clear-and-flat where the law demands precision; warmth lives in the reminder/confirmation bodies ("See you there!", "You're in for {Event}"), not in the liability clauses.
- The §1b string is the artifact recorded into `consent_records.disclosure_text` for BOTH `scope='transactional'` and `scope='marketing'` per §8.1 — single source of truth; do not let two surfaces drift to two different strings.
- Reality-anchor: this is copy for an in-build system (META-ORCH-1161 is mid-flight, SMS kill-switches default false). Nothing here is marketed externally; it is in-product/legal copy. No grade-gated marketing claim is made.
- COMMS context: COMMS-0040/0041 (RSVP public-page standardization) are FYI for this turn — the §1 consent line will appear on checkout-adjacent buyer-web surfaces; the copy is surface-agnostic text and does not constrain that refactor, but whoever standardizes the public RSVP page should reuse the SAME §1b string rather than authoring a variant.
