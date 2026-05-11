# UI/UX ORCH-0785 — Premium Transactional Email Branding Direction

Date: 2026-05-11
Owner: Codex `orchestrator-mingla` using `ui-ux-mingla` design layer
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Status: Design direction for investigation/spec. No product code changed.

## Plain-English Goal

Mingla's buyer and customer-facing emails should feel like a premium, trusted purchase experience, not a bare system receipt. A buyer should immediately know the email came from Mingla, know the event they purchased, see the event cover/name clearly, and have their usable ticket PDFs attached with QR codes.

## Seed Email Inventory From Current Repo Scan

This is seed evidence for forensics, not the final complete inventory.

| Surface | Current path | What it appears to send today | Design/fulfillment concern |
|---|---|---|---|
| Buyer ticket confirmation | `supabase/functions/ticket-confirmation-dispatch/index.ts` | Resend HTML email and Twilio SMS after ticket order notification rows are created | Email HTML is plain paragraphs, no Mingla logo, no event cover, no attachment payload, and tells buyer to open the Mingla confirmation screen for QR codes |
| Generic notification email fallback | `supabase/functions/notify-dispatch/index.ts` | Resend text email when `emailTo` is supplied, alongside in-app/push notification flow | Plain text only, default sender can be `Mingla Business <onboarding@resend.dev>`, no shared brand shell |
| Admin individual/bulk email | `supabase/functions/admin-send-email/index.ts` + `mingla-admin/src/pages/EmailPage.jsx` | Resend text emails from admin compose/templates | Plain text only, no enforced Mingla shell, no customer-facing brand QA gate |
| Supabase auth email/OTP | Business/mobile auth UI calls Supabase Auth resend/sign-in flows | Exact email template source is outside repo code and must be inspected/configured separately | Auth emails may be unbranded or inconsistent if Supabase templates are untouched |
| Message/invite edge functions with email-like names | `supabase/functions/send-message-email/index.ts`, `supabase/functions/send-friend-request-email/index.ts` | Current code routes push/notify-dispatch rather than direct email send in the inspected paths | Names are misleading; forensics should prove whether any runtime email path still exists through `notify-dispatch` |
| Business invite comments/stores | `mingla-business/src/store/brandTeamStore.ts`, `scannerInvitationsStore.ts`, `InviteBrandMemberSheet.tsx` | Comments say future/incomplete Resend invite functions are planned | Should be tracked as pending customer-facing email surfaces if implemented later |

## Premium Email Design Contract

The approved direction for the eventual spec:

| Area | Requirement |
|---|---|
| Brand identity | Use Mingla's official logo at the top, `usemingla.com` sender/domain where applicable, and a consistent footer with support/trust copy |
| Event identity | Buyer ticket emails must include the event name, event cover image, date/time, venue/location when available, organiser/brand name, and order summary |
| Ticket fulfillment | Buyer ticket emails must attach ticket PDFs; each PDF must include a scannable QR code generated from the same server-owned ticket credential path as scanner validation |
| Email shell | Responsive 600px email layout, high-contrast light theme, warm Mingla orange accent, dark text on white/off-white, no decorative noise, no one-off random visual language |
| Trust and clarity | Subject/preheader must make the purchase and event clear; body copy must distinguish confirmed tickets, pending/payment processing, failed/refunded/cancelled states when applicable |
| Accessibility | Alt text for logo/event cover, readable text size, no QR-only instructions without text fallback, clear attachment naming, keyboard/screen-reader friendly link labels |
| Safety | No secrets, raw QR tokens, provider IDs, or unnecessary PII in logs/artifacts; PDFs and HTML must not expose more credential material than scanner validation requires |
| Reuse | Prefer a shared transactional email renderer/module and shared test fixtures over one-off HTML strings in each function |

## Visual Direction

Use a premium but restrained ticket-purchase look: Mingla logo header, event cover as the first visual anchor, large event name, compact order details, and a clean ticket block that mirrors the attached PDFs. The design should feel closer to a high-end event ticket receipt than a marketing newsletter. Avoid heavy gradients, stock-looking imagery, novelty effects, and unsupported email CSS.

## Required States For Spec

- Successful free order with one ticket.
- Successful paid order with one ticket.
- Multi-ticket order with one PDF per ticket or one combined PDF, as forensics/spec proves safest.
- Event cover missing: branded fallback without looking broken.
- Buyer email missing/invalid: no silent success.
- Resend from organiser order detail: email reflects resend without duplicating tickets incorrectly.
- Provider failure: order remains confirmed, notification ledger explains failure safely.
- Cancelled/refunded/voided ticket handling: PDFs must not imply invalid tickets are usable.

## Verification Expectations

The eventual implementation must include repo-running automated regression tests that fail against today's plain email/no-PDF behavior and pass after the change. Minimum gates should cover email inventory, branded HTML render, logo/event cover presence, attachment creation, QR inclusion per ticket, privacy redaction, and Resend payload shape. Manual/provider gates should include a sandbox/live Resend send with screenshots or exported MIME evidence that proves HTML and PDFs arrive intact.
