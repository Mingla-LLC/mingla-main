# ORCH-0822 — Twilio Toll-Free Verification Rejection & Resubmit

- Opened: 2026-05-13
- Owner: orchestrator (Claude)
- Phone: `+18882505351`
- Phone SID: `PN932653656902e1231cd5ef3e6dba2c01`
- Verification SID: `HH09152453d554fc707570f31994ddda0f`
- Status (initial): `TWILIO_REJECTED` (date_updated 2026-05-13T14:34:21Z)
- Status (post-patch): `PENDING_REVIEW` (date_updated 2026-05-13)
- Edit window: open until `2026-05-21T00:00:00Z`

## Twilio rejection reasons (verbatim)

| Code | Reason |
|---|---|
| 30482 | Business Email Address Must Use an Official Domain |
| 30496 | Use Case and Use Case Summary Inconsistent |
| 30507 | Opt-In Does Not Match the Use Case |

## Root cause per reason

1. **30482** — `business_contact_email` was `sethogieva@gmail.com`. Twilio requires the business contact email to live on the business's own domain. `notification_email` was already `developer@usemingla.com`, but the contact email field was never updated to match.

2. **30496** — `use_case_categories` declared three categories (`TWO_FACTOR_AUTHENTICATION`, `ACCOUNT_NOTIFICATIONS`, `EVENTS`), but the `use_case_summary` only described the opt-in consent flow ("users who enter their phone number and check the SMS consent box"). The summary did not enumerate the actual message types behind each category, so Twilio's reviewer could not confirm the summary covered all three.

3. **30507** — `opt_in_image_urls` pointed at a Google Drive **folder share** (`https://drive.google.com/drive/folders/1n56M345EgzsCjU1HAz2axT-A1nsdlup4?usp=sharing`). Drive folder/file shares return an HTML viewer page, not raw image bytes; Twilio reviewers regularly cannot access them. The actual opt-in is an in-app consent checkbox + phone field, which is compatible with `opt_in_type=WEB_FORM`, but without a publicly-fetchable screenshot the reviewer had no evidence to verify.

## Fix applied (single PATCH to existing submission)

`POST https://messaging.twilio.com/v1/Tollfree/Verifications/HH09152453d554fc707570f31994ddda0f`

| Field | Before | After |
|---|---|---|
| `business_contact_email` | `sethogieva@gmail.com` | `seth@usemingla.com` |
| `use_case_summary` | "Mingla uses this toll-free number to send opt-in, non-promotional SMS to users who enter their phone number and check the SMS consent box in the Mingla app." | "Mingla sends transactional SMS to users who opt in inside the Mingla mobile app by entering their phone number and tapping the consent checkbox shown in the opt-in proof image. Messages include: (a) one-time verification codes for phone-number sign-in (2FA), (b) account notifications such as friend pair-up invitations and confirmations, and (c) event reminders and material updates for experiences the user has saved or booked. No promotional or marketing messages are sent on this number." |
| `opt_in_image_urls[0]` | `https://drive.google.com/drive/folders/1n56M345EgzsCjU1HAz2axT-A1nsdlup4?usp=sharing` (Drive folder share — HTML viewer) | `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/marketing-assets/twilio-tfv/sms-opt-in-proof.png` (Supabase public bucket — direct `image/png` bytes, 175,731 B) |
| `opt_in_type` | `WEB_FORM` | unchanged (in-app form is the correct match) |

## Opt-in proof image

Source provided by operator: `https://drive.google.com/file/d/1f_vkSPInN9fSVr4AssL7REu_MDKkabBp/view?usp=share_link`

Downloaded via `https://drive.google.com/uc?export=download&id={file_id}`, re-hosted in Supabase public bucket `marketing-assets/twilio-tfv/sms-opt-in-proof.png` so the URL returns `Content-Type: image/png` directly (verified `HTTP 200`).

Image content: Mingla "What's your number?" screen showing phone input, consent checkbox with text "I agree to receive texts from Mingla, including verification codes, friend invitations, and experience reminders. Msg & data rates may apply. Reply STOP to opt out or HELP for help.", and links to Terms of Service + Privacy Policy. The checkbox text covers all three declared use-case categories.

## Post-patch Twilio response (key fields)

```
status: PENDING_REVIEW
error_code: null
rejection_reason: null
rejection_reasons: null
edit_allowed: true
edit_expiration: 2026-05-21T00:00:00Z
```

## What happens next

Twilio re-reviews. Typical turnaround is 3–5 business days. The orchestrator should poll on `2026-05-16` and again on `2026-05-20` (before edit expiration) via:

```
curl -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  https://messaging.twilio.com/v1/Tollfree/Verifications/HH09152453d554fc707570f31994ddda0f
```

Outcomes:
- `TWILIO_APPROVED` → close ORCH-0822, update `twilio-values.md` with approval date, ready for production SMS volume.
- `TWILIO_REJECTED` again → read new `rejection_reasons`, patch again (edit window still open), resubmit.
- Edit window expires before approval → submission would need to be re-created from scratch; avoid this by polling.

## Risk that this re-submission still fails

Low–medium. The three rejection reasons are now addressed with verifiable evidence (official-domain email confirmable via WHOIS/MX, explicit summary, direct-fetchable PNG showing the consent UI). The remaining unknowns are reviewer-judgement items Twilio sometimes flags on a second pass: (a) whether `seth@usemingla.com` actually receives mail (Twilio sometimes test-emails the contact), (b) whether the privacy policy at `https://www.usemingla.com/privacy-policy/` explicitly mentions SMS use, (c) whether the terms page at `https://www.usemingla.com/terms-of-service/` mentions SMS consent.

## Action items (operator)

1. Confirm `seth@usemingla.com` MX/inbox is live and monitored.
2. Skim `/privacy-policy/` and `/terms-of-service/` on `usemingla.com` — ensure both mention SMS, opt-in, STOP, and frequency. If absent, add a short SMS section to each (pre-emptive fix for a potential third-pass rejection).
3. Wait for Twilio review. Re-poll on 2026-05-16.
