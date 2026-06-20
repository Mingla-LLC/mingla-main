/**
 * META-ORCH-1161 Sub-A.2 (consent-capture slice) — consent disclosure copy.
 *
 * SINGLE SOURCE OF TRUTH for the legally-binding consent strings on the
 * mingla-business buyer-checkout surface (S3). The §1b disclosure string is
 * recorded VERBATIM into `consent_records.disclosure_text` (both scopes) at
 * every grant — it is the legal burden-of-proof artifact backing the
 * risk-accepted bundled-mandatory consent (DEC-186). DO NOT paraphrase.
 *
 * Copy authority (verbatim):
 *   Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md
 *     §1a — visible checkbox label
 *     §1b — EXACT disclosure string (recorded)
 *     §2  — full Terms & Conditions / consent sheet body
 *
 * The app-mobile consumer surface (S2) carries a byte-identical copy in
 * `mingla-business/src/constants/consentDisclosure.ts` — the two cannot share a
 * module (separate apps), so any edit MUST be mirrored in both (and re-record
 * `disclosure_text`). DISCLOSURE_VERSION pins the wording for the audit trail.
 */

/**
 * Pins the exact wording for the legal record. Bump ONLY when the §1b string or
 * §2 body changes; the server stores both the version and the resolved text so
 * the burden-of-proof artifact cannot drift with a stale client (DESIGN §6 / OQ-4).
 */
export const DISCLOSURE_VERSION = "2026-06-19" as const;

/**
 * §1b — the EXACT disclosure string recorded VERBATIM into
 * `consent_records.disclosure_text` for BOTH scope='transactional' AND
 * scope='marketing'. No paraphrase. (COPY §1b, all placeholders FILLED.)
 */
export const CONSENT_DISCLOSURE_TEXT =
  "I agree to Mingla's Terms & Conditions and Privacy Policy, and I consent to receive from Mingla LLC and the businesses I book with: (1) transactional and account messages including booking and reservation confirmations, changes, cancellations, refunds, waitlist updates, and payment notices; (2) event and reservation reminders for this booking and for future events; and (3) marketing and promotional messages, including offers and announcements from venues and experience brands. These messages may be sent by email, in-app notification, push notification, and recurring automated text message (SMS) to the phone number I provide. Message frequency varies. Msg & data rates may apply. Consent to texts is not a condition of any purchase. Reply STOP to any text to opt out, or HELP for help; you can also unsubscribe from email via the link in any message or change your preferences in the Mingla app at any time. Full terms: https://www.usemingla.com/terms-of-service | Privacy: https://www.usemingla.com/privacy-policy | SMS terms: https://www.usemingla.com/sms-terms.";

/**
 * §2 — the full Terms & Conditions / consent sheet body (verbatim, FILLED).
 * Rendered in the T&C sheet opened from the underlined "all terms and
 * conditions" link. Plain-language product copy; the linked ToS/Privacy remain
 * the controlling documents.
 */
export const CONSENT_TERMS_BODY = `Mingla — Terms, Notifications & Consent

Last updated: 2026-06-19

By creating a Mingla account or completing a booking, you agree to these terms and to Mingla's full Terms of Service and Privacy Policy, which are incorporated here by reference. If you do not agree, do not create an account or complete a booking.

1. Who you're agreeing with.
Mingla is operated by Mingla LLC, 700 Corporate Center Dr, Raleigh, NC 27607, USA ("Mingla," "we," "us"). Questions: support@usemingla.com · +1 888-250-5351.

2. What Mingla is — and is not.
Mingla helps you discover places, events, experiences, and trips and connects you with venues and experience brands ("Businesses"). Mingla is a platform; the Businesses are independent third parties. Events, reservations, menus, prices, availability, and experiences are created and controlled by the Businesses, not by Mingla. Mingla does not own, operate, host, or supervise any venue, event, or experience, and is not a party to your agreement with a Business.

3. No guarantee; you assume the risks of real-world activity.
We work to keep listings accurate, but Mingla does not guarantee the accuracy, availability, quality, safety, legality, or outcome of any listing, event, reservation, experience, or Business, or that any event will occur as described. You attend events and experiences and visit venues at your own risk. You are responsible for your own conduct and safety and for evaluating any Business before you go.

4. Third-party responsibility.
Any dispute about an event, reservation, experience, refund, service, injury, or loss is between you and the relevant Business. Mingla is not responsible or liable for the acts, omissions, products, services, or content of any Business or other user. Where Mingla processes a payment, it does so as a technical facilitator; the Business remains the merchant of record for what it sells unless stated otherwise at checkout.

5. Limitation of liability; release.
To the fullest extent permitted by law, Mingla and its officers, employees, and partners are not liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss arising from your use of the app, any listing, any Business, or any event or experience. To the fullest extent permitted by law, you release Mingla from claims arising out of disputes with Businesses or other users or from your participation in any real-world activity discovered through Mingla. Mingla's total liability for any claim is limited to the greater of the amount you paid Mingla (not the Business) for the transaction at issue or the amount permitted by applicable law. Some jurisdictions do not allow certain limitations; where that applies, the limitation applies to the maximum extent permitted.

6. Communications & consent — what you're signing up for.
When you create an account or complete a booking and check the consent box, you agree to receive the following from Mingla and from the Businesses you book with:

- Transactional & account messages — booking and reservation confirmations, changes, cancellations, refunds, waitlist updates, payment notices, and account/security messages. These are required to use Mingla and are tied to your activity.
- Reminders — reminders for the event, experience, trip, or reservation you book, and for future events you may be interested in.
- Marketing & promotional messages — offers, announcements, new events, and promotions from Mingla and from venues and experience brands, including via marketing blasts.

These may be delivered by email, in-app notification, push notification, and recurring automated text message (SMS) to the contact details you provide. Message frequency varies. Msg & data rates may apply. Consent to receive marketing texts is not a condition of any purchase.

7. How to opt out.
- Text (SMS): reply STOP to any text to stop texts, or HELP for help. We also honor quit, end, cancel, unsubscribe, revoke, and opt out.
- Email: use the unsubscribe link in any marketing email.
- In-app: open the Mingla app and adjust your notification preferences at any time, per channel and per category.
- Outside the US: opt-out may also run through your local registry (for example, in Nigeria, the NCC DND service by texting STOP to 2442) and the in-app preference center.

We honor opt-out requests received by any reasonable means and process them promptly (within the timeframes required by law). Opting out of marketing does not stop transactional or account messages, which are required to deliver what you booked. You may still receive a single confirmation message after you opt out.

8. Data handling.
We collect and use the contact details and information you provide (including your name, email, phone number, and country) to operate Mingla, deliver the messages above, process bookings and payments, prevent fraud, and improve the service, as described in our Privacy Policy. We share necessary booking details with the Business you book with so it can fulfill your reservation or order. We do not sell your personal information except as described in the Privacy Policy. Where required, our lawful basis for marketing is your consent, which you may withdraw at any time as described in section 7. We record the date, time, exact text of this disclosure, and your country at the time you consent, as proof of your consent.

9. Payments, refunds & cancellations.
Prices, fees, taxes, refund eligibility, and cancellation terms are set by the Business and shown at checkout. Refunds, where offered, are handled under the Business's policy and applicable law. Mingla is not obligated to issue refunds for a Business's products or services.

10. Eligibility & acceptable use.
You must be the age of majority in your location (and at least 18) to enter into these terms and to receive marketing messages. You agree to provide accurate information, to use Mingla lawfully, and not to misuse the platform or other users.

11. Changes; governing law; contact.
We may update these terms; material changes will be notified in-app or by email, and continued use means acceptance. These terms are governed by the laws of the State of North Carolina, USA. Disputes are resolved per the full Terms of Service (including any arbitration or venue clause stated there). Contact us at support@usemingla.com or 700 Corporate Center Dr, Raleigh, NC 27607, USA.

Full Terms of Service: https://www.usemingla.com/terms-of-service · Privacy Policy: https://www.usemingla.com/privacy-policy · SMS Terms: https://www.usemingla.com/sms-terms`;

/**
 * §1a — the short visible label rendered next to the checkbox. The
 * "[terms and conditions]" token is replaced by an underlined tappable link in
 * the component; the surrounding text is rendered verbatim.
 */
export const CONSENT_VISIBLE_LABEL_PREFIX = "I agree to Mingla's ";
export const CONSENT_VISIBLE_LABEL_LINK = "terms and conditions";
export const CONSENT_VISIBLE_LABEL_SUFFIX =
  " and to receive booking confirmations, reminders, account updates, and marketing from Mingla and the businesses I book with — by email, push, and text. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out of texts, HELP for help.";
