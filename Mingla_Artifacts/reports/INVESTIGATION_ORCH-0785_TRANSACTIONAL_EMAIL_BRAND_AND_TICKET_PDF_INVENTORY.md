# INVESTIGATION ORCH-0785 — Transactional Email Brand Inventory + Buyer Ticket PDF/QR Contract

Date: 2026-05-11
Owner: Claude `mingla-forensics` (INVESTIGATE mode)
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Dispatch: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md`
Design direction: `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`
Verdict: **ROOT CONTRACT PROVEN — every customer-facing email Mingla sends today is an unbranded plain-text or plain-HTML shell; ZERO emails carry attachments; the buyer ticket email actively tells the buyer to "open the Mingla confirmation screen for QR codes" instead of delivering scannable PDFs. Severity P1 launch-quality.**

## Executive Summary

In plain English: when a buyer pays for or claims a free ticket today, the email Mingla sends is four lines of grey HTML paragraphs with the order UUID printed in it. There is no Mingla logo, no event cover, no event date/venue, no organiser name, no ticket-tier breakdown, and — most critically — no PDF, no QR code image, and no scannable artifact the buyer can present at the door. The email tells the buyer to open the Mingla app to see their QR. Admin bulk/individual email is plain `text:` from `noreply@usemingla.com` with `{name}` substitution and the same naked shell. The generic notification fallback (`notify-dispatch`) also sends plain `text:`, and falls back to `Mingla Business <onboarding@resend.dev>` if `RESEND_FROM_EMAIL` is unset — a Resend sandbox sender, not a Mingla domain. There is no shared transactional-email renderer in the repo. There is no PDF library in the edge function bundle. There is no QR-image embed path. Supabase Auth email templates are not customised in `supabase/config.toml` and live entirely in the Supabase dashboard project settings (outside the repo).

This is exactly what the dispatch + UI/UX direction asked us to prove. The investigation classifies all findings and bounds them so the SPEC can write a single shared transactional-email + ticket-PDF contract without reopening ORCH-0777 or absorbing ORCH-0782's resend-CTA/rollup scope.

## Phase 0 Ingestion Receipts

Read in full before any code inspection:

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md`
- `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0777.md` (CLOSED PASS 2026-05-11; residuals: two non-operator Twilio SMS terminal rows accepted as external config)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_FREE_EMAIL_FAILURE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` §8.1 (email content contract) + §6.4 (`ticket-confirmation-dispatch` invocation modes)
- `Mingla_Artifacts/reports/QA_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0782_ORGANIZER_RESEND_TICKET_CTA_AND_NOTIFICATION_ROLLUP.md` (deferred follow-up; not absorbed here)

Migration chain (per Migration Chain Rule):

- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` — defines `events` (incl. `cover_media_type`, `cover_media_url`-class columns at line ~7819) and admin email log shape.
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` — authoritative current definition of `ticket_order_notifications` (channel CHECK = `{email, sms}` only; status CHECK includes `pending|sending|sent|delivered|failed_retryable|failed_terminal|skipped`; payload jsonb default `{}`); RPC `biz_ticket_checkout_finalize` inserts the two ledger rows but the `payload` is just `{checkoutSessionId}` — it carries no event/brand metadata for renderers downstream. No later migration supersedes this. No `attachments` column exists.

Memory rules respected: no DB mutation; no provider mutation; no secret echoed; no PII printed; ORCH-0782 scope not absorbed (organiser resend CTA + rollup recompute remain a separate dispatch).

## Investigation Manifest

Read in order:

| File | Layer | Why |
|---|---|---|
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | Edge | Authoritative buyer-ticket email path |
| `supabase/functions/_shared/ticketCheckout.ts` | Shared | Provider failure classifier + `dispatchTicketConfirmation` helper |
| `supabase/functions/notify-dispatch/index.ts` | Edge | Generic Resend email fallback for any caller passing `emailTo` |
| `supabase/functions/admin-send-email/index.ts` | Edge | Admin compose / bulk Resend send |
| `mingla-admin/src/pages/EmailPage.jsx` | Admin UI | Admin sender, default from-address, templates table |
| `mingla-business/src/services/ticketCheckoutService.ts` | Mobile service | Buyer checkout invocations + `resendTicketConfirmation` |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Mobile UI | Buyer post-purchase screen + on-screen QR carousel |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | Mobile UI | Organiser "Resend ticket" CTA |
| `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` | Schema | Ledger + RPC ground truth |
| `supabase/config.toml` | Provider config | Supabase Auth template overrides (none present) |
| `supabase/functions/send-message-email/index.ts` | Edge | Misleadingly named — proves it's push-only |
| `supabase/functions/send-friend-request-email/index.ts` | Edge | Misleadingly named — proves it routes to `notify-dispatch` for push only |
| `supabase/functions/stripe-kyc-stall-reminder/index.ts` | Edge | Indirect `notify-dispatch` email caller via `emailTo` |
| `supabase/functions/stripe-webhook-health-check/index.ts` | Edge | Ops-only `emailTo` caller (`ops@mingla.app`) |
| `mingla-business/src/constants/stripeNotificationTemplates.ts` | Mobile constants | Catalog of brand-side Stripe notification copy |
| `mingla-business/src/store/brandTeamStore.ts`, `scannerInvitationsStore.ts`, `components/team/InviteBrandMemberSheet.tsx` | Mobile | Future invite email surfaces (not yet implemented) |

## Email Inventory (Complete)

### Tier A — Direct Resend callers (3 functions; only path that actually puts bytes on the wire to `api.resend.com`)

| # | Surface | File | Recipient | Trigger | From (default) | Subject | Body | Attachments | Log |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Buyer ticket confirmation | `supabase/functions/ticket-confirmation-dispatch/index.ts:10-32, 110-117` | Buyer `orders.buyer_email` | Internal POST from `_shared/ticketCheckout.ts:dispatchTicketConfirmation` after `biz_ticket_checkout_finalize` | `RESEND_TICKET_FROM` env, fallback `Mingla <tickets@usemingla.com>` | `Your Mingla tickets for ${eventTitle}` | Four-line plain HTML: greeting, ticket count + event title, order UUID, "Open the Mingla confirmation screen for QR codes." | **NONE** (Resend body has `{from,to,subject,html}` only — no `attachments` field) | `ticket_order_notifications` row (`channel='email'`) |
| A2 | Generic notification email | `supabase/functions/notify-dispatch/index.ts:19-44, 247-254` | Any caller-supplied `emailTo` | Server-side: `stripe-kyc-stall-reminder` (brand `contact_email`), `stripe-webhook-health-check` (`ops@mingla.app`); user-side: none | `RESEND_FROM_EMAIL` env, **fallback `Mingla Business <onboarding@resend.dev>`** (Resend sandbox sender) | Caller-supplied `title` | Caller-supplied `body` as **plain `text:`** (no HTML, no shell) | NONE | `notifications` row only when `userId` present; emailTo-only sends are not ledgered |
| A3 | Admin compose / bulk | `supabase/functions/admin-send-email/index.ts:21-51, 108-203` | Individual `to` or bulk `profiles.email` filtered by segment (limit 500) | Admin EmailPage compose flow | Caller-supplied `fromName <fromEmail>` (UI default `Mingla <noreply@usemingla.com>`; UI helper text warns "only `@usemingla.com` and `@resend.dev` are verified in Resend") | Caller-supplied | Caller-supplied **plain `text:`** with `{name}` substitution in bulk path | NONE | `admin_email_log` row with sent/failed counts |

### Tier B — Indirect Resend callers (`emailTo` payload passed to `notify-dispatch`)

| # | Caller | File | Recipient class | Notes |
|---|---|---|---|---|
| B1 | `stripe-kyc-stall-reminder` | `supabase/functions/stripe-kyc-stall-reminder/index.ts:110, 129, 157` | Brand `contact_email` | Falls back to `emailTo: null` if no contact email → push only |
| B2 | `stripe-webhook-health-check` | `supabase/functions/stripe-webhook-health-check/index.ts:38` | `ops@mingla.app` ops alias | Ops alert, not customer-facing |
| B3 | `_shared/stripeEdgeAuth.ts` notification helper type | `supabase/functions/_shared/stripeEdgeAuth.ts:96` (`emailTo?: string \| null`) | Anywhere the shared `notifyStripeUsers` helper is invoked | The helper accepts an `emailTo` but most Stripe edge callers leave it null; B1 + B2 are the only live populated paths in the current repo |

Both B-tier paths inherit A2's shell: plain text, sender domain defaults that can fall to `onboarding@resend.dev`, no branded HTML, no attachments.

### Tier C — Misleadingly named edge functions (do **not** send email today)

| # | Function | What it actually does | Evidence |
|---|---|---|---|
| C1 | `send-message-email` | OneSignal push only (`sendPush`); strips markdown; logs `"Push notification sent for message"` | `supabase/functions/send-message-email/index.ts:78-90` |
| C2 | `send-friend-request-email` | Calls `notify-dispatch` with NO `emailTo` field — push only | `supabase/functions/send-friend-request-email/index.ts:111-143` |
| C3-C9 | `send-friend-accepted-notification`, `send-pair-accepted-notification`, `send-pair-request`, `send-pair-request-visible`, `send-collaboration-invite`, `send-tag-along`, `send-phone-invite`, `send-otp` | None contain `api.resend.com` or `RESEND_*` env reads (confirmed by `grep -rln 'api.resend.com\|RESEND_API_KEY' supabase/functions`) | grep yields exactly the three Tier-A files; nothing else |

**These names are forensic landmines for any future engineer who searches "send email."** The SPEC must either rename these (B-cycle effort) or carry a permanent comment-header warning so they aren't accidentally extended with Resend logic by drift.

### Tier D — Supabase Auth provider templates (outside repo)

| # | Surface | Source of truth | Notes |
|---|---|---|---|
| D1 | OTP / email magic-link / password-reset / confirm-signup / change-email | Supabase Auth project dashboard (`supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/auth/templates`) | `supabase/config.toml` contains zero `[auth.email.template.*]` overrides → templates are whatever the Auth dashboard holds. Operator must inspect the dashboard during SPEC to know the current brand state. |
| D2 | Resend Email Provider for Auth (custom SMTP / Resend integration) | Project dashboard | Out of repo; treat as a SPEC investigation item, not a code change item. |

### Tier E — Planned but not implemented (future surfaces)

| # | Surface | Evidence | Status |
|---|---|---|---|
| E1 | Brand-team invite email (`invite-brand-member`) | `mingla-business/src/store/brandTeamStore.ts:5-9` ("NO email is sent, NO acceptance flow exists"; future "edge function `invite-brand-member` (writes to brand_invitations + sends Resend email)") | Not built. Mark as future surface that must reuse the new shared renderer once built. |
| E2 | Scanner-team invite email (`invite-scanner`) | `mingla-business/src/store/scannerInvitationsStore.ts:5-14` ("emails ship in B-cycle"; "edge function `invite-scanner` (writes to scanner_invitations + sends Resend email)") | Not built. Same reuse mandate. |
| E3 | Stripe notification template catalog | `mingla-business/src/constants/stripeNotificationTemplates.ts:1-80` (`emailSubject` + `emailBody` per Stripe event; comment claims "HTML wrapped at send time") | The catalog **assumes** an HTML wrapper that does not exist anywhere in the repo. `notify-dispatch` sends them as plain `text:`. Latent drift; flag in SPEC. |
| E4 | Reconciliation PDF email | `mingla-business/src/utils/guestCsvExport.ts:405` ("PDF DEFERRED to B-cycle email-attachment-via-Resend per D-13-7 (no expo-print dep).") | Pre-acknowledged that Mingla has no email-attachment-via-Resend pathway. ORCH-0785 will be the first one to build it. |

## Buyer Ticket Email — Current-State Proof (Root Contract)

Step-by-step trace of what arrives in a buyer's inbox today after `payment_intent.succeeded` (paid) or `biz_ticket_checkout_finalize` (free) completes:

### 1. Order/ticket commit → ledger insert

`supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:615-634`:

```sql
INSERT INTO public.ticket_order_notifications (
  order_id, event_id, channel, recipient, idempotency_key, payload
) VALUES
  (v_order_id, v_session.event_id, 'email', v_session.buyer_email,
   'ticket_confirmation:' || v_order_id::text || ':email',
   jsonb_build_object('checkoutSessionId', v_session.id)),
  (v_order_id, v_session.event_id, 'sms', v_session.buyer_phone_e164,
   'ticket_confirmation:' || v_order_id::text || ':sms',
   jsonb_build_object('checkoutSessionId', v_session.id))
ON CONFLICT (idempotency_key) DO NOTHING;
```

The ledger row carries only `{checkoutSessionId}` in `payload`. No event title, no brand, no event cover, no ticket-tier names, no order line totals, no application-fee context — none of the data a premium email needs is denormalised here. The dispatcher must re-JOIN at render time.

### 2. Dispatcher invocation

`supabase/functions/_shared/ticketCheckout.ts:94-110` (`dispatchTicketConfirmation`) — service-role POST to `${SUPABASE_URL}/functions/v1/ticket-confirmation-dispatch` with `{orderId}` body. Auth header is the literal `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Dispatcher reads order + event title only

`supabase/functions/ticket-confirmation-dispatch/index.ts:93-100`:

```ts
const { data: order } = await supabase
  .from("orders")
  .select("id, event_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, events(title, slug)")
  .eq("id", orderId)
  .maybeSingle();
```

Selected columns: order id, event_id, buyer name/email/phone, total_cents, currency, **and an embed of `events(title, slug)` ONLY**. No cover URL, no event start time, no venue, no brand row, no brand name, no brand slug, no organizer identity. The dispatcher cannot construct a branded email even if it wanted to — it does not fetch the data.

`ticket-confirmation-dispatch/index.ts:102-108` also reads `tickets.id, qr_code, ticket_types(name)` per order. This is sufficient to render a per-ticket block — but the dispatcher does not use the per-ticket data for anything except a count.

### 4. Renderer builds a four-line HTML stub

`supabase/functions/ticket-confirmation-dispatch/index.ts:109-117`:

```ts
const eventTitle = (order.events as { title?: string } | null)?.title ?? "your event";
const subject = `Your Mingla tickets for ${eventTitle}`;
const html = [
  `<p>Hi ${order.buyer_name ?? "there"},</p>`,
  `<p>Your ${ticketCount} ticket${ticketCount === 1 ? "" : "s"} for <strong>${eventTitle}</strong> are confirmed.</p>`,
  `<p>Order: ${order.id}</p>`,
  `<p>Open the Mingla confirmation screen for QR codes. Keep this email for your records.</p>`,
].join("");
```

The literal final paragraph **instructs the buyer to leave the email and open the Mingla app** to get their QR codes. This is the design failure the operator surfaced: the email is a notification of purchase, not a fulfilled ticket.

Additional inspection:

- No `<!doctype html>`, no `<head>`, no `<meta name="viewport">`, no responsive table layout, no Mingla logo, no event cover, no organiser/brand line, no ticket-tier breakdown, no date/time/venue, no currency-aware total, no support footer, no unsubscribe link (acceptable for transactional but worth tracking), no STOP/HELP-style accessibility text for the linkless instruction, no `aria-` attributes (irrelevant in email but indicative of design budget = zero).
- `order.buyer_name` is interpolated raw into HTML. Buyer names are user-supplied at checkout (free-form text from `BuyerStep` in `mingla-business/app/checkout/[eventId]/buyer.tsx`). Any `<`, `>`, `&` or markup characters render as live HTML in Resend. Low practical risk (Resend strips dangerous tags client-side, and we own the recipient inbox renderer), but it is a P2 hygiene flag for the SPEC: HTML-escape user input.

### 5. Resend POST shape (no attachments)

`supabase/functions/ticket-confirmation-dispatch/index.ts:18-25`:

```ts
const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
});
```

The JSON payload has no `attachments` field. Resend's API supports `attachments: [{ filename, content }]` where `content` is base64 — that capability is unused everywhere in the repo (grep `attachment` across `supabase/functions/` returns zero hits).

### 6. SMS counterpart is the same shape

`ticket-confirmation-dispatch/index.ts:117`: `Mingla: your ${ticketCount} ticket${...} for ${eventTitle} are confirmed. Order ${order.id.slice(0,8)}.` No `View tickets: {shortLink}` per SPEC §8.2. Out of strict scope for ORCH-0785 (which is email/PDF), but worth flagging because the SMS is the only "alternate channel" if email fails.

## Branding/Design Gap Proof

Matched against the design contract in `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`:

| Design requirement | Status today | Evidence |
|---|---|---|
| Mingla logo at top | **Missing** | No `<img>` tag in any HTML body across A1/A2/A3 |
| Event cover image | **Missing** | `events.cover_media_url` is not even SELECTed |
| Event name | Partial (subject + bold-tag interpolation only; no header treatment) | `ticket-confirmation-dispatch:113` |
| Event date/time | **Missing** | Not fetched, not rendered |
| Venue/location | **Missing** | Not fetched, not rendered |
| Organiser/brand name | **Missing** | Brand row not fetched |
| Order summary (line items, totals) | **Missing** | `order_line_items` not fetched; `total_cents` fetched but not rendered |
| Ticket PDF attachments | **Missing** | Zero `attachments` field usage in repo |
| QR codes (image or scannable) | **Missing** | `tickets.qr_code` fetched but discarded; literal instruction tells buyer to leave email |
| Responsive 600px layout | **Missing** | No `<table role="presentation">`, no media queries |
| Warm Mingla orange accent + light theme | **Missing** | No inline styles at all |
| Alt text | **N/A — no images to alt-tag** | — |
| Sender domain `tickets@usemingla.com` for tickets | Present in default | `RESEND_TICKET_FROM` env, fallback `Mingla <tickets@usemingla.com>` |
| Sender domain consistency across A2/A3 | **Drifted** | A2 default `onboarding@resend.dev`; A3 UI default `noreply@usemingla.com`; A1 `tickets@usemingla.com`. Three different defaults, no shared constant. |
| Subject/preheader distinguish state (confirmed/pending/failed/refunded) | **Missing** | Single hardcoded `Your Mingla tickets for ${eventTitle}` regardless of `notification_status`/`payment_status` |
| Cancelled/refunded/voided ticket states | **Missing** | Dispatcher only fires from `_shared/ticketCheckout.ts:dispatchTicketConfirmation` after finalize; refund/cancel paths do not invoke any email surface today |
| Shared renderer / template module | **Does not exist** | No `_shared/email*` directory; no React-Email/MJML/Handlebars dependency in any `package.json` (verified by grepping for `mjml\|react-email\|handlebars\|nodemailer`); each function builds raw HTML/text inline |

Net: **every single design requirement except the ticket sender default is currently missing**.

## PDF + QR Technical Feasibility and Risk Analysis

### Constraint inventory

| Constraint | Source | Implication |
|---|---|---|
| Supabase Edge runtime = Deno | Functions run on Deno Deploy via `https://deno.land/std@0.168.0/http/server.ts` | Node-only PDF libs (`pdfkit` requires Node `Buffer`/`fs`; `puppeteer` requires Chromium binary) are non-starters |
| No headless browser available | Edge sandbox | Cannot use `puppeteer-core` or `playwright` |
| Resend max attachment size | Resend public docs (~25MB total per email) | Multiple PDFs per multi-ticket order add up; the SPEC must cap or use combined PDF when ticketCount > N |
| Cold-start budget | Supabase Edge cold-start < 1.5s typical; total request ≤ 150s (per `supabase/config.toml` comment) | A heavy PDF library load on every dispatch is acceptable but not free |
| `qr_code` ground truth | `tickets.qr_code` is the literal `mingla:v1:ticket:{uuid}:sig:{sha256}` payload (see `biz_ticket_checkout_qr_payload`). Pepper-derived signature is server-only. | The QR image embedded in a PDF can be regenerated client-side **from the same `qr_code` string** — no token leakage beyond what the scanner already validates against |
| QR pepper safety | `_shared/ticketCheckout.ts:qrTokenPepper` rejects pepper < 32 chars | Pepper must not appear in the PDF; only the public signed payload string |

### Safe Deno-native PDF candidates (verify in SPEC; do not adopt blind)

| Option | Pros | Cons / risk |
|---|---|---|
| **`jspdf` via `esm.sh`** | Browser-runtime-only, no Node deps, well-trodden; works under Deno when imported via `esm.sh`; small bundle | Manual layout (no flex/grid); QR must be drawn from a separate QR lib |
| **`pdf-lib` via `esm.sh`** | Pure JS; supports image embed via Uint8Array; no Node deps | Manual layout same caveat; library is ~500KB |
| **`qrcode` (TS port) via `esm.sh`** | Generates PNG/SVG from string; works in Deno | Need to pair with PDF lib above |
| **`@react-email/render` (Deno via esm.sh)** | Premium HTML email rendering; component-based; idiomatic in 2026 stack | Solves HTML/email, NOT PDF — orthogonal; consider for the HTML side of the shared renderer |
| **External render service (Browserless / DocRaptor)** | Pixel-perfect via Chromium; no Deno-native limits | Adds a third-party dependency, latency, cost, vendor lock-in, and a new secret — SPEC should treat as a non-goal unless `pdf-lib` proves insufficient |

Recommended SPEC posture: **`pdf-lib` for PDF + `qrcode` for QR image, both via `esm.sh` pinned versions, generated inside `ticket-confirmation-dispatch`**. Falls within the existing edge cold-start budget. Same dispatcher then attaches the base64'd PDF(s) to the Resend POST body's `attachments` array. No new function. No new secret. No external render dependency.

### Combined PDF vs per-ticket PDF

Both are technically feasible. Trade-offs:

- **Combined order PDF (1 attachment, multi-page)** — simpler attachment cap math; buyer has a single file to share/save; scanner sees one QR per page (already supported because each `tickets.qr_code` is independently signed).
- **Per-ticket PDF (N attachments)** — buyer can forward individual tickets; clearer per-attendee semantics in multi-attendee orders.

Reality check: today's product is "buyer = single user buying one or more tickets for themselves." The transfer/per-attendee story is in ORCH-0777 §13 non-goals. Recommend **one combined PDF as the default for the first release**, with the schema/dispatcher contract structured so per-ticket attachments can be enabled later without re-architecting (e.g., the renderer takes a `tickets[]` array and writes one PDF per element OR concatenates pages by config).

### QR credential/privacy contract

`tickets.qr_code` already contains everything `scan-ticket` needs to validate (`mingla:v1:ticket:{uuid}:sig:{sha256}`). The pepper is added inside the SQL helper, never exposed. Putting this string verbatim into a PDF QR is **no weaker than today's behaviour** — the buyer's phone screen already shows the same string in the in-app QR carousel (`mingla-business/src/components/checkout/TicketQrCarousel.tsx` rendering `qrPayload`).

Therefore: the PDF must render a QR encoded from `tickets.qr_code`, exactly the bytes already trusted by `scan-ticket`. Do NOT include `qr_token_hash`, the pepper, or any database id beyond `tickets.id` (already public, already in the QR payload). Do NOT include `buyer_phone_e164` (private), `buyer_phone` (private), `stripe_payment_intent_id` (sensitive identifier), or `stripe_charge_id`.

The PDF MAY include: buyer name (already public to the organiser), event name + cover + date + venue (public), order short id (printable), ticket tier name (`ticket_types.name`), and ticket index within the order.

## Data / Source-of-Truth Map (what the renderer must JOIN)

| Field needed by premium email | Authoritative source | Currently fetched by dispatcher? | Notes |
|---|---|---|---|
| Mingla logo | Repo asset (`mingla-admin/src/assets/mingla-logo.png` is the only mature candidate; mobile `assets/icon.png` differ visually) — **operator confirmation required** | No | Must be served from a public HTTPS URL Resend can fetch (e.g., `https://usemingla.com/email-assets/mingla-logo@2x.png`) OR embedded inline as cid attachment. SPEC chooses one. |
| Event name | `events.title` | Yes (via embed) | OK |
| Event cover | `events.cover_media_url` + `cover_media_type` (image / video / gif) | **No** | Video covers (`cover_media_type='video'`) need a poster image fallback for email; SPEC defines |
| Event date/time | `events.start_at`, `events.timezone` | **No** | Must use brand/event timezone, not UTC |
| Venue / address | `events.venue_name`, `events.venue_address`, `events.location_lat`, `events.location_lng` | **No** | Address can be NULL for hidden-location events; render fallback "Location revealed after confirmation" or similar |
| Organizer / brand name | `brands.name` via `events.brand_id` | **No** | |
| Brand logo (separate from Mingla logo) | `brands.logo_url` (verify exact column name in SPEC) | **No** | Optional secondary identity per design |
| Order short id | `orders.id` (truncate to 8 chars for display) | Yes | OK |
| Line items | `order_line_items` joined to `ticket_types.name` | **No** | Required for premium summary block |
| Ticket array (id, type, qr_code) | `tickets.id`, `tickets.qr_code`, `ticket_types.name` | Yes (fetched but unused beyond count) | OK |
| Total + currency | `orders.total_cents`, `orders.currency` | Yes (fetched but unused) | OK |
| Buyer name | `orders.buyer_name` | Yes | **Must HTML-escape** |
| Status copy variant | `orders.payment_status`, `orders.notification_status`, ticket `status` | Partially (`payment_status` for paid/free already implicit) | Refund/cancel/void paths do not currently invoke the dispatcher; SPEC may extend invocation OR scope the first cycle to confirmed-only |
| Support contact | Static — `support@usemingla.com` (verify operator) | N/A | |

Single SELECT shape the SPEC should mandate (rough sketch — exact column verification belongs to SPEC):

```sql
SELECT
  o.id, o.buyer_name, o.buyer_email, o.total_cents, o.currency,
  o.payment_status, o.notification_status, o.created_at, o.confirmed_at,
  e.id AS event_id, e.title, e.start_at, e.timezone,
  e.venue_name, e.venue_address, e.cover_media_url, e.cover_media_type,
  b.id AS brand_id, b.name AS brand_name, b.logo_url,
  jsonb_agg(jsonb_build_object(
    'ticketId', t.id, 'ticketName', tt.name, 'qrPayload', t.qr_code
  ) ORDER BY t.created_at) AS tickets,
  jsonb_agg(jsonb_build_object(
    'name', tt2.name, 'quantity', li.quantity,
    'unitPriceCents', li.unit_price_cents, 'totalCents', li.total_cents
  ) ORDER BY li.id) AS line_items
FROM public.orders o
JOIN public.events e ON e.id = o.event_id
JOIN public.brands b ON b.id = e.brand_id
JOIN public.tickets t ON t.order_id = o.id
JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
JOIN public.order_line_items li ON li.order_id = o.id
JOIN public.ticket_types tt2 ON tt2.id = li.ticket_type_id
WHERE o.id = :orderId
GROUP BY o.id, e.id, b.id;
```

SPEC must lock the actual column names and confirm none have been renamed since baseline.

## Five-Layer Cross-Check

| Layer | What it says |
|---|---|
| **Docs** (ORCH-0777 SPEC §8.1, UI/UX ORCH-0785 design direction) | Email "must include buyer name, event name, brand/organizer name, date/time, venue/address, order number, ticket names and quantities, link/deep link, support/resend contact copy." Premium direction adds Mingla logo, event cover, PDF attachments with QR per ticket, responsive 600px shell. |
| **Schema** (migration `20260515000013`) | `ticket_order_notifications` has channel CHECK `{email, sms}` and payload jsonb — sufficient to ledger any branded send. `events.cover_media_url`, `brands.logo_url`, `order_line_items`, `tickets.qr_code` all exist. The data IS available. |
| **Code** (`ticket-confirmation-dispatch:93-117`) | SELECTs only `id, event_id, buyer_name, buyer_email, buyer_phone_e164, total_cents, currency, events(title, slug)` and renders four `<p>` tags. No JOIN to brand, cover, line items, ticket detail. |
| **Runtime** (per ORCH-0777 live-fire matrix + QA report) | Operator received the paid-checkout email on 2026-05-11 03:48:20 UTC — verified at the Resend layer, confirming the dispatcher does succeed end-to-end; confirms the unbranded shell is what real buyers actually receive. |
| **Data** (`ticket_order_notifications` payload jsonb default `{}`, `_orch_0777` rows audited in ORCH-0777 investigation) | Ledger rows carry only `{checkoutSessionId}`. The dispatcher must re-JOIN at render time; nothing in the ledger needs schema migration to support a richer renderer. |

**All five layers agree on the truth.** Docs/Design says "premium branded with PDFs and QR codes." Schema can support it. Code does not implement it. Runtime confirms code is what ships. Data ledger is render-only and does not block. The gap is purely renderer-side (and a Resend payload-shape additive).

## Blast Radius

| Surface | Affected by ORCH-0785? | Why |
|---|---|---|
| `ticket-confirmation-dispatch` (A1) | **Primary** | Renderer + attachment payload + JOIN shape |
| `_shared/ticketCheckout.ts:dispatchTicketConfirmation` | Likely no change | Already wires order_id → dispatcher |
| `notify-dispatch` (A2) | **Secondary** | Should opt into the new shared renderer when `emailTo` is supplied. Default sender must move off `onboarding@resend.dev` (the current fallback is a Resend sandbox sender — branding hazard). |
| `admin-send-email` (A3) | **Secondary** | Must accept a `html` payload from EmailPage and wrap in the shared shell; UI default sender must be unified with A1/A2; preview modal must render the shell |
| `mingla-admin/src/pages/EmailPage.jsx` | **Secondary** | Compose UI gains a "use Mingla shell" toggle/default; preview shows shell; templates stored in `email_templates` table need an HTML body field or a migration path |
| `mingla-business/src/services/ticketCheckoutService.ts:resendTicketConfirmation` | Out of scope per ORCH-0782 boundary | The current `supabase.functions.invoke("ticket-confirmation-dispatch", { orderId })` from mobile sends the user JWT, not service-role; the dispatcher's `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` gate at line 84 will reject with 403. ORCH-0782 owns this fix. **Discovery for orchestrator** — see below. |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | Out of scope per ORCH-0782 boundary | Same |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | No change in scope | Buyer-side QR carousel is unchanged. The "Sent to {email} and {phone}" line is a known UX risk already logged in ORCH-0777 investigation §observations. |
| Stripe `payment_intent.succeeded` / webhook router | No change | Already calls `dispatchTicketConfirmation` after finalize |
| Twilio SMS / `twilio-message-status` | No change | SMS channel is unchanged; only the email cell of the ledger gains richer rendering + attachments |
| Supabase Auth email templates (Tier D) | **Investigation in SPEC; provider-side change, not code** | Operator must inspect Supabase project Auth dashboard to surface the current state; SPEC names the operator gate, does not write product code |
| Future surfaces E1/E2 (brand invite, scanner invite) | Forward-compatible | The shared renderer + sender constant must be where those land |
| Stripe notification templates (E3) | Latent fix | The catalog claims "HTML wrapped at send time" — the new shared renderer satisfies that promise and the stripe templates become its first non-ticket caller |
| Reconciliation PDF (E4) | Foundation enabler | Once `ticket-confirmation-dispatch` has a working `pdf-lib` + base64-attachment pattern, ORCH-0785's PDF renderer becomes a shared util the reconciliation export can reuse without re-investigating PDF infra |
| Strict-grep CI (per memory `strict_grep_registry_pattern`) | New gate | Add a rule that any new `api.resend.com` POST must include `attachments`-aware code path or explicitly opt out via a comment; prevent regression of "four-line `<p>` shells re-appearing." |
| `_shared/push-utils.ts` / OneSignal | No change | Push is orthogonal |
| Privacy/PII surface | No widening | The new SELECT joins existing columns only; no new buyer data is surfaced |

## Recommended SPEC Boundaries

**In scope for the ORCH-0785 SPEC:**

1. New `supabase/functions/_shared/email/` module: brand constants (logo URL, sender addresses per surface, support contact), shared HTML shell renderer (responsive 600px table layout with Mingla orange accent, light theme), HTML-escape helper, per-state copy variants (confirmed / pending / partial / failed-with-retry / refunded / cancelled).
2. New `supabase/functions/_shared/ticketPdf.ts`: builds combined order PDF using `pdf-lib` + `qrcode` (Deno via esm.sh, pinned versions); takes the SELECT shape above; returns `{ filename, base64 }`.
3. `ticket-confirmation-dispatch` rewrite:
   - Expand the orders SELECT to the canonical JOIN above.
   - Render branded HTML via the shared shell (event cover + logo + organiser + line items + ticket block).
   - Build PDF via `_shared/ticketPdf.ts` and attach to Resend payload as `attachments[]`.
   - HTML-escape buyer name and any user-provided string.
   - Preserve current ledger transition semantics (`pending`/`failed_retryable` → `sending` → `sent`/`failed_*`). Do NOT widen to `failed_terminal` retry (ORCH-0777 hidden flaw, separate fix path).
4. `notify-dispatch`: accept optional `{ html, useBrandShell }` payload; when set, render through the same shell; default sender constant unified; remove `onboarding@resend.dev` fallback (replace with hard error so a misconfigured deploy fails loudly, not branding-silently).
5. `admin-send-email`: accept `{ html, useBrandShell }`; default sender unified; preview modal in admin EmailPage renders the shell.
6. Logo asset publishing: SPEC picks ONE source (recommend `mingla-admin/src/assets/mingla-logo.png` after operator confirmation) and publishes it to a stable public URL (`https://usemingla.com/email-assets/mingla-logo.png` or `email-assets/mingla-logo@2x.png` for retina); SPEC does NOT mandate a CDN deploy mechanism — just the URL contract. If the operator has no stable hosting, SPEC may inline-embed the logo as a Resend `attachments[].inline_disposition` or a base64 data URI as a transitional fallback.
7. Strict-grep gates (per memory rule on strict-grep registry pattern) — add scripts under `.github/scripts/strict-grep/`:
   - `orch-0785-resend-attachment-aware.mjs` — any new `api.resend.com` POST that lacks an `attachments` key or a `// no-attachment: <reason>` comment fails CI.
   - `orch-0785-no-onboarding-resend-fallback.mjs` — fail if any code path falls back to `onboarding@resend.dev`.
   - `orch-0785-buyer-html-escape.mjs` — any template that interpolates `order.buyer_name`, `order.buyer_email`, or `event.title` into HTML without going through the escape helper fails.
8. Repo-running automated tests (per ORCH-0777 §10 precedent):
   - Renderer snapshot tests for each state variant.
   - PDF render test: produce a PDF for a fixture order, parse with `pdf-lib`, assert page count = 1 (combined) and QR text content equals fixture `qr_code` string; assert no pepper / `qr_token_hash` substring leaks.
   - Resend payload-shape test: assert dispatcher fetch body always includes `attachments`.
   - Strict-grep CI runs on every PR.
9. Manual / provider gates: sandbox Resend send to operator inbox; screenshots / MIME export evidence (per memory operator preference) attached to the implementor report.

**Out of scope (must NOT be absorbed):**

- ORCH-0782 — organiser "Resend ticket" CTA from order detail + notification rollup recompute. The current `resendTicketConfirmation` mobile call IS broken (403 against service-role gate) but fixing it is ORCH-0782's job; the ORCH-0785 SPEC may flag the issue and require that whatever auth/CTA contract ORCH-0782 lands MUST invoke the new dispatcher and inherit the new email shell + PDF attachment automatically. No frontend code change in ORCH-0785.
- Supabase Auth email templates (Tier D) — the SPEC may require an operator-side inspection-and-decision artifact (screenshot or text excerpt of the current Auth templates), but provider-dashboard mutations are operator-owned, not implementor-owned.
- Brand invite / scanner invite emails (E1, E2) — surface the shared renderer + sender constants so future implementation can plug in; do not build the invite functions.
- Stripe notification templates HTML wrapping (E3) — same: surface the shared renderer; do not refactor every Stripe notification caller in ORCH-0785.
- Reconciliation PDF (E4) — same: surface `_shared/ticketPdf.ts` so the future reconciliation feature can reuse it; do not implement the reconciliation email path here.
- Buyer confirmation screen copy `"Sent to {buyer.email} and {buyer.phone}"` — known UX risk from ORCH-0777 investigation; out of strict scope.
- SMS body upgrade with `View tickets: {shortLink}` per SPEC §8.2 — could be added as a small adjacent change in ORCH-0785 because the dispatcher already builds the SMS body, but if it expands testing surface meaningfully it should be deferred.
- Wallet pass (.pkpass / Google Wallet) — already explicitly transitional per `confirm.tsx:54-64`; not an email/PDF concern.

## Findings (Classified)

### 🔴 ROOT CAUSE A — Buyer ticket email is a four-line unbranded HTML stub with zero PDF/QR attachments

| field | proof |
|---|---|
| file + line | `supabase/functions/ticket-confirmation-dispatch/index.ts:109-117` (renderer); `:18-25` (Resend POST body) |
| exact code | HTML = four `<p>` tags joined with `.join("")`; Resend body `{from, to, subject, html}` — no `attachments` key |
| what it does | Sends a textual notification of purchase that explicitly instructs the buyer to open the Mingla app to retrieve their QR codes |
| what it should do | Send a Mingla-branded HTML shell (logo, event cover, organiser, ticket details, order summary, status copy) **plus** one or more PDF attachments containing scannable QR codes derived from `tickets.qr_code` |
| causal chain | Buyer completes free/paid checkout → `biz_ticket_checkout_finalize` writes order/tickets/notification rows → `dispatchTicketConfirmation` POSTs to dispatcher → dispatcher SELECTs minimal data → renders four `<p>` → posts to Resend without `attachments` → buyer receives unbranded email with no usable ticket artifact and "open the app" copy |
| verification step | Read the renderer; cross-reference with ORCH-0777 live-fire confirmation that the dispatcher does succeed (operator received paid email 2026-05-11 03:48:20 UTC). Read the Resend POST body and confirm absence of `attachments`. Grep `attachment` across `supabase/functions/` → zero hits. |

Confidence: **PROVEN**.

### 🔴 ROOT CAUSE B — No shared transactional-email renderer / brand shell exists anywhere

| field | proof |
|---|---|
| file + line | Repository-wide. Functions A1/A2/A3 each build their HTML/text inline. `grep -rln "mjml\|react-email\|handlebars\|nodemailer" supabase/functions` → zero hits. No `_shared/email*` directory. |
| exact code | A1 builds HTML inline; A2 sends plain `text:` only (`notify-dispatch:19-44`); A3 sends plain `text:` only (`admin-send-email:21-51`); E3 Stripe templates' "HTML wrapped at send time" promise is never fulfilled |
| what it does | Three drift-prone shells; sender defaults split three ways (`tickets@usemingla.com` vs `onboarding@resend.dev` vs `noreply@usemingla.com`); future invite emails will drift again |
| what it should do | Single shared renderer module that every customer-facing email is required to use, with a strict-grep CI gate preventing new inline shells |
| causal chain | Each function was added one ORCH at a time without a shared abstraction → every new feature inherits or invents its own shell → eventual brand drift is structural |
| verification step | Grep + read each function head; confirm absence of a shared module |

Confidence: **PROVEN**.

### 🔴 ROOT CAUSE C — `notify-dispatch` fallback sender is `onboarding@resend.dev`

| field | proof |
|---|---|
| file + line | `supabase/functions/notify-dispatch/index.ts:26-27` |
| exact code | `const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "Mingla Business <onboarding@resend.dev>";` |
| what it does | If `RESEND_FROM_EMAIL` is unset in any environment, customer-facing email is sent from Resend's public sandbox sender — visible to recipients, fails SPF/DKIM expectations for `usemingla.com`, and breaks brand trust |
| what it should do | Hard error / throw if `RESEND_FROM_EMAIL` is unset, never silently send from a sandbox |
| causal chain | Misconfigured deploy or unset env → silent branding hazard; cannot be detected by any test that requires successful HTTP 200 from Resend |
| verification step | Read the env-fallback chain |

Confidence: **PROVEN**.

### 🟠 CONTRIBUTING FACTOR D — Ledger `payload jsonb` is not denormalised; renderer must re-JOIN at send time

| field | proof |
|---|---|
| file + line | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:615-634` |
| exact code | `payload jsonb NOT NULL DEFAULT '{}'::jsonb` + insert with only `{checkoutSessionId}` |
| what it does | Forces every render attempt (initial send + future resend) to JOIN order/event/brand/line-items/tickets each time. If any column is later renamed, every render breaks at once. |
| what it should do | The choice is acceptable (current state is the source of truth pattern); SPEC must explicitly accept this and not migrate the ledger to denormalise. The renderer JOIN shape is the contract. |
| causal chain | Render-time JOIN means renderer can serve resend without ledger backfill, but also means schema drift on `events`/`brands` could silently break premium emails |
| verification step | Schema read; confirmed by the dispatcher's existing minimal SELECT being the only render path |

Severity: **🟠 contributing** — not the root cause, but it gates the renderer's reliability story.

### 🟡 HIDDEN FLAW E — Buyer name interpolated into HTML without escape

| field | proof |
|---|---|
| file + line | `ticket-confirmation-dispatch/index.ts:112` |
| exact code | `` `<p>Hi ${order.buyer_name ?? "there"},</p>` `` |
| what it does | Live HTML injection: a buyer named `<b>X</b>` shows as bold; a buyer named `<script>` is sanitised by Resend client-side but still proves the absence of an escape contract |
| what it should do | All user-provided strings flow through an HTML-escape helper (`& → &amp;`, `< → &lt;`, `> → &gt;`, `" → &quot;`, `' → &#39;`) |
| causal chain | Buyer enters name in checkout → name goes to `orders.buyer_name` unescaped → renderer interpolates raw |
| verification step | Read the renderer; confirm no escape function in scope |

Severity: **🟡 hidden flaw** — will surface when a buyer's name contains markup characters, or as a future XSS vector if an email client renders aggressively. Must be addressed in the SPEC's shared renderer.

### 🟡 HIDDEN FLAW F — `send-message-email`, `send-friend-request-email`, and 7 sibling functions have email in their names but only send push

| field | proof |
|---|---|
| file + line | `send-message-email/index.ts:78-90` (push-only via OneSignal); `send-friend-request-email/index.ts:111-143` (notify-dispatch without `emailTo`) |
| exact code | (see above) |
| what it does | Forensic landmine: future engineer searches for "send email" → finds these — adds Resend logic → drift |
| what it should do | Either rename to `send-message-notification` / `send-friend-request-notification`, OR add a permanent header comment "This function does not send email; see `notify-dispatch` for the email path." |
| causal chain | Legacy naming from when these did send email; never renamed |
| verification step | `grep -rln 'api\.resend\.com' supabase/functions` returns exactly three files; none are `send-*-email/*` |

Severity: **🟡 hidden flaw** — naming hygiene; SPEC may handle inline with header comments rather than the more invasive rename.

### 🟡 HIDDEN FLAW G — `mingla-business/src/constants/stripeNotificationTemplates.ts` comment claims "Email body in plain English (HTML wrapped at send time)" — wrapper does not exist

| field | proof |
|---|---|
| file + line | `mingla-business/src/constants/stripeNotificationTemplates.ts:36` |
| exact code | `/** Email body in plain English (HTML wrapped at send time) */` |
| what it does | The wrapping is fictional today; `notify-dispatch` sends them as plain `text:`. Comment lies. |
| what it should do | Either remove the claim, OR — better — make it true by routing all `notify-dispatch` email sends through the new shared shell |
| causal chain | Template catalog assumed a wrapper that was never written |
| verification step | Cross-reference catalog comment vs `notify-dispatch:35` Resend body shape |

Severity: **🟡 hidden flaw** — resolved by the recommended SPEC scope item 4.

### 🔵 OBSERVATION H — Admin EmailPage UI defaults `fromEmail` to `hello@usemingla.com`; Tier-A1 defaults to `tickets@usemingla.com`; Tier-A2 defaults to `onboarding@resend.dev`

`mingla-admin/src/pages/EmailPage.jsx:162` (`useState("hello@usemingla.com")`) — three different sender defaults across three surfaces. SPEC should unify under a shared `EMAIL_SENDERS` constant (e.g., `tickets@usemingla.com` for transactional/ticketing, `hello@usemingla.com` for relational/admin, `notifications@usemingla.com` for system alerts) and remove the `resend.dev` fallback.

### 🔵 OBSERVATION I — Resend API key is the only secret needed; `RESEND_TICKET_FROM` and `RESEND_FROM_EMAIL` are independent env vars

No new secret needed for ORCH-0785. The SPEC inherits the existing keys; only the renderer + sender-constants module changes are new.

### 🔵 OBSERVATION J — The mingla logo file is ambiguous

Candidates found in repo (per dispatch hard guard "If the official logo source is ambiguous, list the exact candidate files and require operator confirmation before implementation"):

- `mingla-admin/src/assets/mingla-logo.png` — mature, used by admin dashboard chrome; also shipped to `mingla-admin/public/mingla-logo.png` and `mingla-admin/dist/`. **Recommended primary candidate.**
- `mingla-admin/public/mingla-logo.png` — duplicate of above.
- `app-mobile/assets/icon.png`, `app-mobile/assets/adaptive-icon.png`, `app-mobile/assets/splash-icon.png` — mobile app icon variants. These are app icons, not the wordmark/logo.
- `mingla-business/assets/images/icon.png` — Mingla Business app icon variant.
- Various build-artifact copies under `.expo/`, `ios/build/`, `android/.../drawable-*/splashscreen_logo.png` — derived, not source.

**Operator must confirm the canonical email logo source file** before any implementation. Recommended default unless overridden: `mingla-admin/src/assets/mingla-logo.png` published to a stable URL on `usemingla.com`.

### 🔵 OBSERVATION K — Supabase Auth email templates live in the project dashboard

`supabase/config.toml` contains no `[auth.email.template.*]` overrides. Therefore the Supabase Auth flows (OTP, magic link, signup confirmation, password reset, change email) use whatever is configured server-side. Operator should screenshot the current Supabase Auth template panel (project `gqnoajqerqhnvulmnyvv`) so the SPEC has a baseline before deciding whether to bring auth templates into brand parity in this cycle or defer to a separate ORCH.

## Regulatory / Compliance Notes

| Requirement | Status today | Notes |
|---|---|---|
| Transactional email exemption from CAN-SPAM unsubscribe | Ticket confirmation (A1) is transactional; no unsubscribe required | Resend documents this distinction; SPEC may include a `mailto:support@usemingla.com` "Need help?" link as soft equivalent |
| Marketing/admin bulk email needs unsubscribe + physical address | A3 admin bulk emails likely qualify when used for marketing segments | Currently no unsubscribe link; no physical address footer. SPEC must add both for bulk path — even if a single `notification_preferences.email_enabled=false` honour check is added at A3 entry. Today the EmailPage Preferences tab shows preferences but A3 does NOT filter on them before sending. (Verified: `admin-send-email:153-165` filters by country/onboarding/status only; never reads `notification_preferences`.) — flag as **🟡 hidden flaw** but it is adjacent scope; SPEC may move to a follow-up ORCH if too large. |
| Provider domain authentication (SPF / DKIM / DMARC) | `usemingla.com` apparently verified in Resend per UI helper text; `resend.dev` is the unverified sandbox | Operator must confirm DKIM/DMARC alignment for `tickets@usemingla.com`, `hello@usemingla.com`, `notifications@usemingla.com` |
| Buyer privacy in PDFs | Today no PDFs; future PDFs must not include phone / Stripe ids / pepper / hash | SPEC asserts this contract |

## Regression Tests Required (Pre/Post Implementation)

| Test id | Covers | Shape | Status today |
|---|---|---|---|
| RT-1 | Branded HTML shell renders for free order | Snapshot test on shared renderer with fixture | **Fails** (renderer does not exist) |
| RT-2 | Branded HTML shell renders for paid order | Same fixture-shape, paid variant | **Fails** |
| RT-3 | Branded HTML shell renders for missing event cover | Fixture with `cover_media_url=null` → branded fallback, no broken-image icon | **Fails** |
| RT-4 | PDF render produces correct page count and QR content | `pdf-lib` parse round-trip; assert `tickets.qr_code` substring present in QR decoded text; assert pepper/hash absent | **Fails** |
| RT-5 | Resend payload always carries `attachments` for ticket-confirmation channel | Static test on dispatcher | **Fails** |
| RT-6 | Buyer-name HTML-escape | Fixture name `<script>alert(1)</script>` → renderer output contains `&lt;script&gt;` not `<script>` | **Fails** |
| RT-7 | `RESEND_FROM_EMAIL` unset → throw, do NOT fall back to `onboarding@resend.dev` | Edge test that asserts the throw | **Fails** |
| RT-8 | Strict-grep gate `orch-0785-resend-attachment-aware` | CI script | New; passes after implementation |
| RT-9 | Strict-grep gate `orch-0785-no-onboarding-resend-fallback` | CI script | New; passes after implementation |
| RT-10 | Strict-grep gate `orch-0785-buyer-html-escape` | CI script | New; passes after implementation |
| RT-11 | Admin EmailPage default sender unified | UI snapshot or constant assertion | **Fails** |
| RT-12 | `notify-dispatch` opt-in to shared shell for `emailTo` callers | Edge test with `{html, useBrandShell:true}` | **Fails** |

## Manual / Provider Gates Required

| Gate | Owner | Evidence |
|---|---|---|
| MG-1 | Operator sends a sandbox Resend free-ticket purchase from the live build; receives the branded HTML + PDF attachment; opens PDF on iOS Mail, iOS Gmail, macOS Mail, Android Gmail; scanner validates QR via real `scan-ticket` flow | Operator + tester | Screenshots of inbox + opened PDF + scanner result |
| MG-2 | Same for paid checkout | Operator + tester | Same |
| MG-3 | Operator inspects Supabase Auth dashboard email templates; confirms whether to in-scope or defer | Operator | Screenshot or text excerpt |
| MG-4 | Operator confirms canonical logo file (recommendation `mingla-admin/src/assets/mingla-logo.png`) and authorises publishing to `usemingla.com/email-assets/mingla-logo.png` or equivalent stable URL | Operator | Operator authorisation prompt |
| MG-5 | Operator confirms sender domain assignment: `tickets@`, `hello@`, `notifications@` — all DKIM-verified in Resend | Operator | DNS + Resend dashboard verification |
| MG-6 | Operator confirms support contact address for footer copy (recommendation `support@usemingla.com`) | Operator | Operator confirmation |

## Discoveries for Orchestrator (Side Issues — Do Not Absorb)

1. **Organiser "Resend ticket" CTA is broken at the auth boundary today.** `mingla-business/app/event/[id]/orders/[oid]/index.tsx:193-204` calls `resendTicketConfirmation(order.id)` which posts to `ticket-confirmation-dispatch` via `supabase.functions.invoke`. The dispatcher rejects anything that is not `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` at line 84 → 403. The UI shows "Could not resend ticket. Try again." This is **ORCH-0782 scope** (organiser resend CTA + rollup recompute); ORCH-0785 must not absorb it, but the ORCH-0782 SPEC must invoke the new dispatcher with whatever auth contract it chooses, and inherit the new shell + PDF attachment automatically.

2. **`admin-send-email` bulk path does not honour `notification_preferences.email_enabled`.** `supabase/functions/admin-send-email/index.ts:153-165` filters by country/onboarding/status only; the EmailPage Preferences tab displays opt-outs but the send path bypasses them. Likely CAN-SPAM / GDPR exposure for marketing bulk. File as a new ORCH ("Admin bulk email must honour notification_preferences and include unsubscribe + physical address footer for marketing segments"). Out of scope for ORCH-0785 because absorbing it bloats the renderer SPEC and brings in legal/compliance copy decisions.

3. **`orders.notification_status` rollup field can lie** (carried over from ORCH-0777 investigation §🟡 hidden flaw). Owned by ORCH-0782.

4. **Stripe notification template catalog claim of "HTML wrapped at send time"** (🟡 hidden flaw G above) — gets resolved automatically by ORCH-0785's shared renderer if `notify-dispatch` opts callers into the brand shell. SPEC must explicitly confirm the resolution path.

5. **Reconciliation PDF email path (`guestCsvExport.ts:405`) and brand/scanner invite emails (`brandTeamStore.ts:5-9`, `scannerInvitationsStore.ts:5-14`) are future surfaces** that will reuse the shared renderer + `_shared/ticketPdf.ts`. SPEC must surface these but not build them.

6. **Build-artifact logo files exist under `app-mobile/ios/build/`, `mingla-business/ios/build/`, etc.** — these are derived, not source. Do not select them as canonical logo. Operator confirmation gate MG-4 prevents this.

7. **No `[auth.email.template.*]` overrides in `supabase/config.toml`** — Supabase Auth email templates are entirely dashboard-managed; not under repo source control. Operator gate MG-3 surfaces the current state.

## Recommended Next Lifecycle Route

**SPEC** in Claude `mingla-forensics`.

Reason: the contract is fully proven, the scope is well-bounded, but the SPEC needs operator decisions on (a) canonical logo file, (b) sender domain assignment, (c) Supabase Auth scope, (d) combined-vs-per-ticket PDF default, and (e) whether to absorb the buyer-name HTML-escape + Stripe template wrapper alongside the shell. Those decisions belong in the SPEC's preflight section, not in implementation.

Confidence on routing: **HIGH**.

## Hard-Guard Compliance

- No raw Resend API key, Twilio auth token, Stripe restricted key, Stripe secret key, Stripe webhook secret, QR pepper, QR pepper digest, raw `qr_token_hash`, full buyer email list, full phone number list, raw `qr_code` payload string, Stripe PaymentIntent client_secret, Stripe charge id, or any provider message id is printed in this report.
- No DB mutation, no migration apply, no edge function deploy, no provider dashboard mutation, no code edit. Investigation only.
- ORCH-0782 scope (organiser resend CTA + notification rollup recompute) is named but NOT absorbed. ORCH-0777 is referenced for closed-scope context only and not reopened.
- Logo source ambiguity is explicitly surfaced with all candidate paths listed and operator confirmation required before implementation (per dispatch hard guard).
- Customer-facing design quality is in scope: the report cites `UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md` and translates each design requirement into acceptance criteria for the SPEC.

## Failure-Honesty Label

`root cause proven` — six-field evidence on all three root causes. Five-layer cross-check holds (docs/schema/code/runtime/data agree on the gap). Resend payload absence of `attachments` confirmed by direct code read. Logo ambiguity surfaced with concrete candidate paths. Edge-runtime PDF feasibility analysis is based on known Deno + esm.sh constraints, not on running a render in this dispatch — the SPEC must lock the exact PDF library after a small spike (acceptable as a SPEC §preflight item).

---

## Next Handoff Paragraph

NEXT HANDOFF — paste into Claude `mingla-forensics` (SPEC mode):

Write `Mingla_Artifacts/specs/SPEC_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md` using this investigation (`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md`) and the design direction (`Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`) as inputs. Lock the bounded scope to: new `supabase/functions/_shared/email/` shared HTML shell renderer + sender constants + HTML-escape helper, new `supabase/functions/_shared/ticketPdf.ts` (recommend `pdf-lib` + `qrcode` via pinned `esm.sh`), `ticket-confirmation-dispatch` rewrite (expanded JOIN, branded HTML, combined PDF attachment, retain ledger transition semantics), opt-in branded shell for `notify-dispatch` and `admin-send-email`, removal of the `onboarding@resend.dev` fallback (hard-error instead), strict-grep CI gates per the memory-encoded registry pattern, and ORCH-0785 regression test set RT-1 through RT-12. Hard guards: do NOT absorb ORCH-0782 (organiser resend CTA + notification rollup recompute), do NOT mutate Supabase Auth templates (operator dashboard gate MG-3), do NOT run `supabase db push`, do NOT deploy edge functions, do NOT touch buyer confirmation screen or wallet pass scope. Resolve the operator preflight decisions explicitly in the SPEC's §Preflight (canonical logo source + publishing URL via gate MG-4; sender domain assignments for `tickets@`/`hello@`/`notifications@` via MG-5; support footer address via MG-6; combined-vs-per-ticket PDF default; Supabase Auth in-scope vs deferred via MG-3; admin bulk-email opt-in compliance — recommend deferring to a separate ORCH per discovery 2). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. After SPEC return, the next dispatch will be Codex `implementor-mingla`, then Claude `mingla-forensics` TEST mode, then Codex `orchestrator-mingla` for CLOSE.
