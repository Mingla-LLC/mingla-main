# SPEC ORCH-0785 — Premium Transactional Email Branding + Buyer Ticket PDF/QR Attachments

Date: 2026-05-11
Owner: Claude `mingla-forensics` (SPEC mode)
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
Status: READY FOR OPERATOR PREFLIGHT, then implementor.
Priority: P1 launch-quality (no shipped feature is broken; buyer purchase experience is materially below product bar).

## 1. Plain-English Goal

A buyer who finishes free or paid checkout receives a Mingla-branded HTML email that looks like a premium ticket receipt — Mingla logo header, event cover, event name/date/venue/organiser, ticket summary, and a clean ticket block — plus a PDF attachment containing scannable QR codes for every ticket in the order. The buyer can save the PDF, present it at the door, and the existing scanner validates it against the same `tickets.qr_code` already in production. Admin/individual email and generic notification email opt into the same brand shell so every customer-facing send looks like Mingla. The Resend sandbox sender fallback is removed.

## 2. Evidence Cite

- Investigation: [INVESTIGATION_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md](../reports/INVESTIGATION_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md)
- Design: [UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md](../reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md)
- Antecedent: [CLOSE_NOTE_ORCH-0777.md](../CLOSE_NOTE_ORCH-0777.md), [SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md](SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md) §8.1 / §6.4
- Boundary: [FORENSICS_ORCH-0782_ORGANIZER_RESEND_TICKET_CTA_AND_NOTIFICATION_ROLLUP.md](../prompts/FORENSICS_ORCH-0782_ORGANIZER_RESEND_TICKET_CTA_AND_NOTIFICATION_ROLLUP.md)

Root contract proven by the investigation:

| Root cause | Resolution path in this SPEC |
|---|---|
| 🔴 A — Buyer ticket email is a four-line stub with no PDF/QR | §6 (`ticket-confirmation-dispatch` rewrite) + §5 (PDF module) + §4 (shared shell) |
| 🔴 B — No shared transactional-email renderer | §4 (shared `_shared/email/` module) |
| 🔴 C — `notify-dispatch` fallback sender is `onboarding@resend.dev` | §7 (hard-error contract) |
| 🟠 D — Ledger payload is render-time JOIN; no denormalisation | Accepted; renderer JOIN shape locked in §6.3 |
| 🟡 E — Buyer name interpolated unescaped | §4.5 (HTML-escape helper, all callers required) |
| 🟡 F — `send-*-email` functions are push-only | §11 (header-comment fix only; no rename in this cycle) |
| 🟡 G — Stripe template "HTML wrapped at send time" comment lies | Auto-resolved by §7 (notify-dispatch opt-in) |

## 3. Required Operator Preflight (BLOCKING — implementor must not write product code until §3.1–§3.6 are confirmed)

The implementor MUST NOT touch product code (DB, edge, services, hooks, components, admin pages) until the operator confirms each item below or supplies the override. The implementor MAY perform read-only investigation, ESM availability probes, and test scaffolding before that point. Operator may confirm via a single chat reply citing each gate by number.

| # | Decision | Recommended default | Why it matters |
|---|---|---|---|
| 3.1 | **Canonical Mingla logo source file** | `mingla-admin/src/assets/mingla-logo.png` (mature, used by admin dashboard chrome) | All other candidates are app icons or build artifacts; without operator confirmation the implementor may pick the wrong wordmark. |
| 3.2 | **Logo publishing URL** | `https://usemingla.com/email-assets/mingla-logo.png` AND `…@2x.png` for retina, hosted by the operator on the existing `usemingla.com` site infrastructure. If no static-hosting pipeline exists, the SPEC's transitional fallback is inline base64 data URI in the email body until a stable URL is set up. | Resend fetches `<img src>` from a public URL at send time; CDN failure = broken logo across every customer email. |
| 3.3 | **Sender address assignment in Resend (all must be DKIM/SPF/DMARC verified for `usemingla.com`)** | `tickets@usemingla.com` (ticket confirmation, future invite, future receipt); `hello@usemingla.com` (admin compose default); `notifications@usemingla.com` (generic `notify-dispatch` emailTo path; Stripe/system alerts) | Three distinct senders separate transactional vs relational vs system, with consistent DMARC alignment. |
| 3.4 | **Support contact for footer** | `support@usemingla.com` | Required for the trust footer and "Need help?" link. |
| 3.5 | **Combined PDF vs per-ticket PDF for multi-ticket orders** | **Combined** — single `tickets-{shortOrderId}.pdf` with one page per ticket | Simpler attachment math (Resend ~25MB total cap), single artifact for buyer to save/forward. Per-ticket is a future flag; renderer must take a `tickets[]` array so the toggle is trivial later. |
| 3.6 | **Supabase Auth email templates (OTP, magic-link, signup, password-reset, change-email)** | DEFERRED to a separate ORCH (e.g., ORCH-0786) | Operator-only dashboard mutation (provider config); requires the same brand shell published as a Supabase Auth template — orthogonal effort with its own retest matrix. Operator must screenshot current Auth template panel for that future ORCH; not in scope here. |

Operator override of any default is allowed; if §3.6 is flipped IN-scope the SPEC must also be amended to add §16 (auth template content + screenshot harvest gate). Implementor must not silently absorb §3.6 without an explicit operator yes.

## 4. Shared Email Module — `supabase/functions/_shared/email/`

New module. Every customer-facing email Mingla sends after this ORCH MUST go through it.

### 4.1 Files

| File | Purpose |
|---|---|
| `supabase/functions/_shared/email/index.ts` | Public surface: `renderTransactionalEmail`, `EMAIL_SENDERS`, `escapeHtml`, `EmailVariant` type, `RenderInput` type |
| `supabase/functions/_shared/email/shell.ts` | HTML shell renderer (header + footer + body slot) |
| `supabase/functions/_shared/email/ticketBody.ts` | Ticket confirmation body slot (hero cover + event meta + ticket lines + order summary) |
| `supabase/functions/_shared/email/genericBody.ts` | Generic notification body slot (title + body paragraphs + optional CTA) |
| `supabase/functions/_shared/email/escape.ts` | HTML-escape helper |
| `supabase/functions/_shared/email/senders.ts` | Sender constants from env, with hard-error fallback |
| `supabase/functions/_shared/email/copy.ts` | Per-state copy variants (confirmed / pending / partial / failed / refunded / cancelled / generic) |
| `supabase/functions/_shared/email/__tests__/shell.test.ts` | Deno snapshot tests |
| `supabase/functions/_shared/email/__tests__/escape.test.ts` | Escape unit tests |
| `supabase/functions/_shared/email/__tests__/senders.test.ts` | Sender constant hard-error tests |

### 4.2 Public types

```ts
export type EmailVariant =
  | "ticket_confirmation_paid"
  | "ticket_confirmation_free"
  | "ticket_confirmation_pending"   // reserved for future paid-pending flow; render copy only, no PDFs
  | "generic_notification"          // notify-dispatch emailTo path
  | "admin_compose";                // admin-send-email path (allows arbitrary subject/body)

export interface SenderIdentity {
  name: string;          // "Mingla"
  address: string;       // "tickets@usemingla.com"
}

export interface RenderInput {
  variant: EmailVariant;
  recipient: { name: string | null; email: string };
  // Per-variant body slot is populated by callers; shell wraps it.
  body: TicketBodyInput | GenericBodyInput;
  // Footer support contact override (defaults to SUPPORT_CONTACT)
  supportEmail?: string;
}

export interface RenderResult {
  subject: string;
  html: string;
  // Plain-text fallback (RFC 8058 + accessibility); always produced.
  text: string;
  // The sender used (constants resolved at render time)
  from: SenderIdentity;
}
```

### 4.3 Shell contract

`renderTransactionalEmail(input: RenderInput): RenderResult`

- Returns one document: `<!doctype html>` + `<html lang="en">` + `<head>` (meta viewport, color-scheme light, preheader hidden span) + `<body>` (single 600px responsive table-layout, white background, dark text, Mingla orange accent `#FF6B2C` per design direction — implementor reads exact token from the design doc).
- Header: Mingla logo `<img src="${MINGLA_LOGO_URL}" alt="Mingla" width="120">` from §3.2.
- Body slot: rendered by the variant-specific renderer (§4.4).
- Footer: `${supportEmail}` link, "Mingla — experience app" tagline (no "dating app" copy per memory rule on Mingla positioning), physical address line (operator-supplied via env `MINGLA_FOOTER_ADDRESS`; if unset hard-error in production, render placeholder in tests), small print "You received this email because you purchased tickets / requested an action with Mingla."
- The shell never imports a body file directly; bodies are rendered by callers and passed in as already-escaped HTML strings.
- The `text` output is a deterministic plain-text version (greeting, event title, ticket lines, support contact). Required for email-client text fallback; same render path computes it.

### 4.4 Body renderers

#### `ticketBody.ts`

```ts
export interface TicketBodyInput {
  variant: "ticket_confirmation_paid" | "ticket_confirmation_free" | "ticket_confirmation_pending";
  event: {
    title: string;
    coverMediaUrl: string | null;
    coverMediaType: "image" | "video" | "gif" | null;
    locationText: string | null;
    isOnline: boolean;
    startAt: string | null;       // ISO 8601 UTC from event_dates (is_master row); null if multi-date master not found
    timezone: string;             // event_dates.timezone || events.timezone
  };
  brand: {
    name: string;
    profilePhotoUrl: string | null;
  };
  order: {
    shortId: string;              // first 8 chars of order.id
    totalCents: number;
    currency: string;             // 3-letter
    lineItems: Array<{
      ticketName: string;
      quantity: number;
      unitPriceCents: number;
      totalCents: number;
    }>;
    tickets: Array<{
      ticketId: string;
      ticketName: string;
      // QR is rendered ONLY into the PDF — never embedded as inline <img> in HTML
    }>;
  };
}
```

Render rules:

- Hero: event cover. If `coverMediaUrl` is null OR `coverMediaType !== 'image'` (video covers need a poster), render a branded orange-tinted fallback block with the event title centred. NEVER show a broken-image icon, NEVER attempt to embed video.
- Event meta block: event title (h1), brand name ("Hosted by {brand.name}"), formatted date in event timezone via the shared `formatDraftDateLine`-equivalent server-side helper (implementor adds a small `_shared/email/dateLine.ts` that uses `Intl.DateTimeFormat` with the event timezone), location text (or "Online event" when `is_online`), conditional fallback `Location revealed after confirmation` if `locationText` is null and `is_online` is false.
- Line items table: 1 row per `lineItems[]` entry, columns `quantity × name`, `unit price`, `line total`; subtotal row; total row formatted via the same shared currency helper Mingla Business uses (`mingla-business/src/utils/currency.ts` — port to `_shared/email/currency.ts` Deno-safe; do NOT cross-import directly).
- Ticket block: per-ticket row with `ticketName` + a small "see attached PDF for QR" badge. No QR `<img>` in the HTML. Only the PDF carries QRs.
- Status copy: variant-driven. `paid` = "You're confirmed.", `free` = "You're in. No payment needed.", `pending` = "Payment is processing — your tickets will be issued and emailed within a few minutes." (reserved for future use; not invoked by §6 in this cycle).
- All caller-supplied strings flow through `escapeHtml` before interpolation. The renderer's signature accepts raw (unescaped) values and escapes internally.

#### `genericBody.ts`

```ts
export interface GenericBodyInput {
  variant: "generic_notification" | "admin_compose";
  title: string;
  paragraphs: string[];           // body split on \n\n; each becomes <p>
  cta?: { label: string; url: string } | null;
}
```

Renders the same shell with a centred title block, paragraphs, and an optional CTA pill button (Mingla orange, white text). Used by §7 (notify-dispatch opt-in) and §8 (admin-send-email opt-in).

### 4.5 `escape.ts`

```ts
export function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- Pure function. No external deps. Always tested independently (RT-6).
- Every renderer that interpolates `event.title`, `brand.name`, `order.buyer_name`, `recipient.name`, `cta.label`, `paragraphs[*]`, `lineItems[*].ticketName`, `tickets[*].ticketName`, or any other dynamic string MUST flow through this helper. Strict-grep gate (§9) enforces this.

### 4.6 `senders.ts`

```ts
export const EMAIL_SENDERS = {
  tickets: resolveSender("RESEND_TICKET_FROM", "Mingla", "tickets@usemingla.com"),
  admin:   resolveSender("RESEND_ADMIN_FROM",  "Mingla", "hello@usemingla.com"),
  system:  resolveSender("RESEND_SYSTEM_FROM", "Mingla", "notifications@usemingla.com"),
} as const;

function resolveSender(envKey: string, defaultName: string, defaultAddress: string): SenderIdentity {
  const raw = Deno.env.get(envKey);
  if (raw === undefined || raw.trim().length === 0) {
    // Production hard-error path: caller bubbles to provider failure.
    return { name: defaultName, address: defaultAddress };
  }
  // Parse "Name <addr>" OR "addr"
  const match = raw.match(/^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/);
  if (match === null) throw new Error(`email_sender_invalid:${envKey}`);
  return { name: (match[1] ?? defaultName).trim(), address: match[2] };
}

// EXPLICIT: there is no resend.dev fallback. If a misconfigured env tries
// to route through Resend's sandbox sender, the constant rejects it.
export function assertNotResendSandbox(sender: SenderIdentity): void {
  if (sender.address.endsWith("@resend.dev")) {
    throw new Error("email_sender_resend_sandbox_forbidden");
  }
}
```

- `senders.tickets` is used by `ticket-confirmation-dispatch`.
- `senders.admin` is used by `admin-send-email`.
- `senders.system` is used by `notify-dispatch` (any `emailTo` path).
- `assertNotResendSandbox` MUST be called before every Resend POST. Strict-grep gate (§9) enforces this.

### 4.7 Footer / address constants

- `MINGLA_FOOTER_ADDRESS` (env, plain text) — operator-supplied physical postal address (compliance footer for marketing-class emails). For pure transactional sends the address is still shown as good-citizen behaviour. If unset in production env, `renderTransactionalEmail` throws `email_footer_address_missing` — implementor must add this env to the Supabase function secrets list in the implementation report.
- `MINGLA_LOGO_URL`, `MINGLA_LOGO_URL_2X` (env, URL) — from §3.2.
- `SUPPORT_EMAIL` (env, default `support@usemingla.com` if unset; soft default acceptable here because footer is operator-overridable per-render anyway).

## 5. Ticket PDF Module — `supabase/functions/_shared/ticketPdf.ts`

### 5.1 Dependencies (Deno via esm.sh, pinned versions)

```ts
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";
```

Implementor must verify both imports resolve under Deno's edge runtime (cold-start test before commit). If either fails at runtime, implementor STOPS and reports back; SPEC's PDF library choice is preflight-checkable but not preflight-confirmable from the orchestrator side.

### 5.2 Public surface

```ts
export interface TicketPdfInput {
  event: { title: string; startAtIso: string | null; timezone: string; locationText: string | null; brandName: string };
  order: { shortId: string };
  tickets: Array<{ ticketId: string; ticketName: string; qrPayload: string }>;
  attendeeNameHint: string | null;   // buyer_name; printed only on the buyer's own ticket(s); never identifies separate attendees in this cycle (per ORCH-0777 §13 non-goals)
}

export interface TicketPdfResult {
  filename: string;             // `tickets-${order.shortId}.pdf`
  contentBase64: string;        // base64 of the PDF bytes; sized for direct Resend `attachments[].content`
  pageCount: number;            // === tickets.length
  byteLength: number;           // raw byte count
}

export async function buildTicketPdf(input: TicketPdfInput): Promise<TicketPdfResult>;
```

### 5.3 Page layout (one ticket per page)

- A4 portrait, 595 × 842 pt (pdf-lib default A4).
- Top band: Mingla orange `#FF6B2C` solid rectangle, 80pt tall; "Mingla" wordmark in white Helvetica-Bold 24pt; "Ticket" label in white Helvetica 14pt right-aligned.
- Event block: event title (Helvetica-Bold 20pt), date line (Helvetica 12pt in event timezone), location line (Helvetica 12pt), brand line "Hosted by {brandName}".
- Ticket block: `{quantity}× {ticketName}` (Helvetica-Bold 14pt), "Order #{shortId}" (Helvetica 11pt, grey).
- QR block: centred QR rendered at 240×240pt via `QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 2 })` decoded to PNG bytes and embedded via `pdfDoc.embedPng`.
- Footer: "Present this ticket at the door. The QR code is unique to this ticket." in Helvetica-Italic 10pt, plus support email.

### 5.4 QR payload privacy contract

The QR encodes EXACTLY `tickets[i].qrPayload`, which is the string from `tickets.qr_code` (format `mingla:v1:ticket:{uuid}:sig:{sha256}` per `biz_ticket_checkout_qr_payload`). The PDF MUST NOT include:

- `tickets.qr_token_hash` (server-only)
- The QR pepper (env `app.qr_token_pepper`)
- `orders.stripe_payment_intent_id`, `stripe_charge_id`, `stripe_payment_intent_status`
- `orders.buyer_phone`, `buyer_phone_e164`
- `orders.metadata` jsonb contents
- Any `auth.users` identifier other than what is already in the QR payload itself

The PDF MAY include: `buyer_name`, `event.title`, `event.startAt`, `event.locationText`, `brand.name`, `order.shortId`, `ticket.ticketId`, `ticket.ticketName`, `ticket.qrPayload`. Strict-grep gate (§9) checks the renderer source for absence of forbidden field names.

### 5.5 Size cap

- Each PDF page should produce ≤ 80KB compressed. A 10-ticket combined PDF should be < 1MB. The renderer throws `ticket_pdf_size_exceeded` if the final byte length > 5MB; that's an early-warning ceiling far below Resend's ~25MB total-attachment cap (which also includes inline images + headers).
- If multi-ticket pages would exceed 5MB, implementor returns an error and the dispatcher falls back to a per-ticket-attachment path (future flag; not built in this cycle — for first release we accept the size envelope and surface the rare overflow as a `failed_retryable` notification row).

### 5.6 Tests

`supabase/functions/_shared/__tests__/ticketPdf.test.ts` (Deno test, no provider creds needed):

- `buildTicketPdf` returns a parseable PDF (re-load via `PDFDocument.load`, assert page count = `tickets.length`).
- QR pixel data decodes back to the original `qrPayload` (use `jsQR` via esm.sh or read embedded PNG and verify image dimensions only — round-trip QR decoding is acceptable as a test-time dep; implementor MAY substitute a simpler "PNG bytes include known marker" assertion if jsQR proves heavy in CI).
- `contentBase64` is valid base64.
- Forbidden field name check: stringify the PDF and assert absence of `qr_token_hash`, `payment_intent`, `_pepper`, raw phone digits.
- Size envelope: 1 ticket < 200KB; 5 tickets < 1MB.

## 6. `ticket-confirmation-dispatch` Rewrite — `supabase/functions/ticket-confirmation-dispatch/index.ts`

### 6.1 Behavioural contract preservation

The following MUST remain identical to the post-ORCH-0777 behaviour (no regression):

- Auth gate (line 84): `req.headers.get("authorization") === \`Bearer ${SUPABASE_SERVICE_ROLE_KEY}\`` → 403 otherwise. Do not loosen.
- Ledger transition: rows in `pending` or `failed_retryable` are claimed by transitioning to `sending` BEFORE provider call; success → `sent`; failure → `failed_retryable` (retryable) or `failed_terminal` (non-retryable / attempt_count ≥ 3); existing classifier `classifyNotificationProviderFailure` reused unchanged.
- `orders.notification_status` rollup recompute at the end of dispatch — left UNCHANGED (the rollup-lie hidden flaw is owned by ORCH-0782).
- SMS body — left UNCHANGED in this cycle (§13 non-goal).
- Idempotency-key uniqueness in `ticket_order_notifications` — preserved.
- Function still callable from `_shared/ticketCheckout.ts:dispatchTicketConfirmation` after `biz_ticket_checkout_finalize` and from `payment_intent.succeeded` webhook (same invocation surface).

### 6.2 New behaviour

For each `email`-channel ledger row claimed:

1. Run the new JOIN (§6.3) once per order_id (cache within the dispatch invocation; do not re-JOIN per email row).
2. Build `RenderInput` (variant chosen by `orders.payment_method === 'free'` → `ticket_confirmation_free`, else `ticket_confirmation_paid`).
3. Call `renderTransactionalEmail` → `{ subject, html, text, from }`.
4. Build PDF via `buildTicketPdf` → `{ filename, contentBase64 }`.
5. Call `assertNotResendSandbox(from)`.
6. POST to Resend with body shape:
   ```ts
   {
     from: `${from.name} <${from.address}>`,
     to: notification.recipient,
     subject,
     html,
     text,
     attachments: [{ filename, content: contentBase64 }],
   }
   ```
7. On 2xx: ledger row → `sent`, store `provider="resend"`, `provider_message_id=json.id`, `sent_at=now()`.
8. On non-2xx: existing classifier path unchanged.

For each `sms`-channel ledger row — current behaviour unchanged.

### 6.3 Authoritative SELECT (lock this shape — schema confirmed against baseline)

```ts
const { data: order, error: orderError } = await supabase
  .from("orders")
  .select(`
    id,
    event_id,
    buyer_name,
    buyer_email,
    buyer_phone_e164,
    total_cents,
    currency,
    payment_method,
    payment_status,
    confirmed_at,
    notification_status,
    events!inner (
      id,
      title,
      cover_media_url,
      cover_media_type,
      location_text,
      is_online,
      timezone,
      brand_id,
      brands!inner ( id, name, profile_photo_url )
    )
  `)
  .eq("id", orderId)
  .maybeSingle();

const { data: lineItems } = await supabase
  .from("order_line_items")
  .select("quantity, unit_price_cents, total_cents, ticket_types!inner ( name )")
  .eq("order_id", orderId)
  .order("id", { ascending: true });

const { data: ticketRows } = await supabase
  .from("tickets")
  .select("id, qr_code, ticket_types!inner ( name )")
  .eq("order_id", orderId)
  .order("created_at", { ascending: true });

// Resolve event start by reading the master event_dates row.
// First-release contract: single-date events use is_master=true row;
// multi-date events render the master row's start_at (per ORCH-0777 §13 non-goal "no transfer").
const { data: masterDate } = await supabase
  .from("event_dates")
  .select("start_at, end_at, timezone, is_master")
  .eq("event_id", order.events.id)
  .eq("is_master", true)
  .maybeSingle();
```

- Use `!inner` joins so PostgREST fails loudly on missing parent rows rather than silently returning nulls.
- `masterDate` may be null for legacy events lacking an `is_master` row — the renderer treats `event.startAt = null` as "date TBA" and renders the event date line as empty (preferable to fabricated data per Constitution rule 9).
- All field names verified against `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` lines 7761-7790 (brands), 7792-7825 (events), 8209-8225 (event_dates) and `20260515000013_orch_0777_ticket_checkout_core.sql:550-571` (orders post-ORCH-0777 columns). No later migration supersedes these in the current `Seth` branch state (`ls supabase/migrations/*orch_077*` confirms ORCH-0777 is the latest order/ticket migration).

### 6.4 Failure semantics

- PDF render failure (any error from `buildTicketPdf`) → treat as RETRYABLE provider-class failure (`failed_retryable` with `last_error="ticket_pdf_render_failed:{message}"`). PDF failures are deterministic on input — once retry succeeds it always will; the only reason to retry is to give an operator-issued fix-and-redispatch path room. Do NOT mark `failed_terminal` on first PDF failure.
- Resend `attachments` rejection (e.g., size cap) → use existing classifier; HTTP 413 = `retryable=false` (terminal).
- Render-input completeness failure (missing event title, missing brand) → throw `email_render_input_incomplete:{field}` BEFORE provider call; ledger row → `failed_retryable` (operator may have a transient data-state issue worth retrying after fix).

### 6.5 Telemetry

- `console.log` (Deno edge logs only; no external telemetry) the rendered byte sizes for HTML and PDF on success: `[ticket-confirmation-dispatch] order={shortId} html_bytes={n} pdf_bytes={n}`. No PII, no secrets, no provider message IDs printed.

## 7. `notify-dispatch` Opt-In Shell — `supabase/functions/notify-dispatch/index.ts`

### 7.1 Payload extension

Existing payload shape extended with two optional fields:

```ts
{
  // existing fields unchanged: userId, type, title, body, data, brandId, deepLink,
  // emailTo, actorId, relatedId, relatedType, idempotencyKey, expiresAt,
  // pushOverrides, skipPush
  emailVariant?: "generic_notification";    // new — opt-in flag
  emailCta?: { label: string; url: string }; // new — optional CTA pill
}
```

### 7.2 Behavioural change

In the `if (emailTo)` block (current lines 247-254):

```ts
if (emailTo) {
  if (payload.emailVariant === "generic_notification") {
    const { subject, html, text, from } = renderTransactionalEmail({
      variant: "generic_notification",
      recipient: { name: null, email: emailTo },
      body: {
        variant: "generic_notification",
        title,
        paragraphs: body.split("\n\n"),
        cta: payload.emailCta ?? null,
      },
    });
    assertNotResendSandbox(from);
    const result = await sendResendEmail({ from, to: emailTo, subject, html, text });
    emailSent = result.ok;
    if (!result.ok) console.warn("[notify-dispatch] Email send failed:", result.error);
  } else {
    // Legacy path: caller did not opt into the brand shell.
    // Keep existing plain-text behavior for backwards compatibility but
    // route through the new sender constant — NO MORE onboarding@resend.dev.
    const result = await sendEmailViaResend(emailTo, title, body);
    emailSent = result.ok;
    if (!result.ok) console.warn("[notify-dispatch] Email send failed:", result.error);
  }
}
```

### 7.3 Sender hardening (resolves Root Cause C)

Replace the existing default fallback `"Mingla Business <onboarding@resend.dev>"` with `EMAIL_SENDERS.system`. The new `sendEmailViaResend` helper MUST call `assertNotResendSandbox` before POST. If `RESEND_FROM_EMAIL` env is unset, the function logs `[notify-dispatch] RESEND_FROM_EMAIL unset — using EMAIL_SENDERS.system default` once per cold start; behaviour: the `senders.ts` default `notifications@usemingla.com` is used. The hard-error escape valve `assertNotResendSandbox` ensures even an accidental override to a sandbox sender is rejected.

### 7.4 Stripe template caller update

`stripe-kyc-stall-reminder/index.ts` and `stripe-webhook-health-check/index.ts` MUST pass `emailVariant: "generic_notification"` in their notify-dispatch payloads. CTA (optional): `{ label: "Resolve in Mingla Business", url: <deepLink || "https://usemingla.com/business"> }` for `stripe-kyc-stall-reminder`; no CTA for the ops health-check. This is the resolution path for Hidden Flaw G.

## 8. `admin-send-email` Brand Shell + UI Wiring

### 8.1 Edge function `supabase/functions/admin-send-email/index.ts`

Extend request payload:

```ts
{
  action: "send" | "send_bulk" | "estimate" | "check_provider",
  // existing fields: to, subject, body, fromName, fromEmail, segment
  useBrandShell?: boolean;        // default true for action=send/send_bulk
  cta?: { label: string; url: string };
}
```

- When `useBrandShell !== false`, route through `renderTransactionalEmail({ variant: "admin_compose", ...})` with the `genericBody` slot (title = subject, paragraphs = body split on `\n\n`, cta).
- When `useBrandShell === false`, preserve existing plain-text behaviour (allow operators to send raw plain-text test sends if needed).
- Sender resolution: `from` = `EMAIL_SENDERS.admin` unless caller supplied `fromName`/`fromEmail`. `assertNotResendSandbox` called before each POST.

### 8.2 Admin EmailPage UI `mingla-admin/src/pages/EmailPage.jsx`

- Default `fromName` / `fromEmail` state initial values change to `"Mingla"` / `"hello@usemingla.com"` (currently `"Mingla"` / `"hello@usemingla.com"` — only adjustment: ensure constant matches `EMAIL_SENDERS.admin`; if operator picks a different §3.3 default the UI default tracks the env).
- Add a single toggle below the "From Email" input: "Use Mingla brand shell (logo + footer)" — defaults ON. When ON, the Preview modal renders inside the shell (call a small `mingla-admin/src/lib/emailShellPreview.js` that mirrors a subset of the shell HTML; do NOT import Deno modules client-side).
- The `{name}` placeholder substitution behaviour for bulk sends is unchanged.
- Pass `useBrandShell` and `cta` in the edge function payload.
- Bulk-send recipient filter behaviour UNCHANGED (admin bulk compliance opt-out filter is Discovery 2 / future ORCH per §13 non-goals).

## 9. Strict-Grep Registry Gates

Per memory rule on strict-grep registry pattern, add one script + one job each. All scripts live at `.github/scripts/strict-grep/orch-0785-*.mjs`; all jobs added to `.github/workflows/strict-grep-mingla-business.yml`.

| Gate ID | Script | What it enforces |
|---|---|---|
| ORCH-0785-A | `orch-0785-resend-attachment-aware.mjs` | Any new `fetch("https://api.resend.com/emails"` POST in `supabase/functions/**/*.ts` either includes `attachments` in the JSON body OR has a `// no-attachment: <reason>` comment within 3 lines above. Existing pre-0785 sites are grandfathered by file-path allowlist for `notify-dispatch/index.ts` (line range to be set to the legacy-text-path call inside `useBrandShell === false` branch). |
| ORCH-0785-B | `orch-0785-no-resend-sandbox-fallback.mjs` | Fail if any source file under `supabase/functions/**` or `mingla-admin/**` contains the string `onboarding@resend.dev` outside comments. The investigation referenced `onboarding@resend.dev` in `EmailPage.jsx:450` admin-setup help text — that help text should be updated by §8.2 to instead reference the verified domain workflow. Allowlist `.md` documentation files. |
| ORCH-0785-C | `orch-0785-buyer-string-escape.mjs` | Babel-parser scan of `supabase/functions/**/*.ts`: any template-literal interpolation of identifiers matching `/^(order|event|brand|recipient|attendee|cta|paragraph|line|ticket)/i` inside an HTML context (template-literal containing `<` or assigned to a variable named `html`) must be wrapped in an `escapeHtml(...)` call. Heuristic; implementor provides a small fixture suite of correct/incorrect examples so the parser stays calibrated. |
| ORCH-0785-D | `orch-0785-shell-singleton.mjs` | No new file under `supabase/functions/**/*.ts` may build its own `<!doctype html>` or `<html` string outside `_shared/email/**`. Forces every future customer-facing email to opt into the shared shell. |
| ORCH-0785-E | `orch-0785-pdf-privacy.mjs` | Source-scan of `_shared/ticketPdf.ts` and any caller forbids the strings `qr_token_hash`, `app.qr_token_pepper`, `stripe_payment_intent_id`, `buyer_phone`, `buyer_phone_e164` (case-insensitive) from appearing in PDF render call sites. Existing references in other Edge functions are allowlisted; the gate scopes by file path. |

Each script returns exit code 0 (pass) / 1 (fail). Each script must have a `README` block at top documenting what it checks and how to opt out (escape hatch comment). Follow the 4-step pattern in `.github/scripts/strict-grep/README.md`.

Workflow file additions (5 jobs at the bottom of `strict-grep-mingla-business.yml`):

```yaml
  orch-0785-a-resend-attachment-aware:
    name: "ORCH-0785-A: Resend POST must declare attachments or opt-out"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Run ORCH-0785-A gate
        run: node .github/scripts/strict-grep/orch-0785-resend-attachment-aware.mjs

  orch-0785-b-no-resend-sandbox-fallback:
    # …same shape…
  orch-0785-c-buyer-string-escape:
    # …
  orch-0785-d-shell-singleton:
    # …
  orch-0785-e-pdf-privacy:
    # …
```

Index comment at the top of the workflow file gains the new gate lines per the established convention.

## 10. Schema and Migration Surface

**No SQL migration is required.** The renderer JOIN reads existing columns only. The `payload jsonb` ledger column is untouched. No new tables, no new constraints. The implementor MUST NOT run `supabase db push` and MUST NOT create a new migration file. Strict-grep gate ORCH-0785-A's allowlist references are configuration, not schema.

## 11. Misleadingly-Named Function Header Comments

Add a one-line header comment to each of these files explaining that they do not send email and pointing to `notify-dispatch` for the email path. No rename, no behaviour change.

- `supabase/functions/send-message-email/index.ts`
- `supabase/functions/send-friend-request-email/index.ts`
- `supabase/functions/send-friend-accepted-notification/index.ts`
- `supabase/functions/send-pair-accepted-notification/index.ts`
- `supabase/functions/send-pair-request/index.ts`
- `supabase/functions/send-pair-request-visible/index.ts`
- `supabase/functions/send-collaboration-invite/index.ts`
- `supabase/functions/send-tag-along/index.ts`
- `supabase/functions/send-phone-invite/index.ts`

Header template:
```ts
// ORCH-0785: This function does NOT send email despite its name.
// The customer email path is `_shared/email/` + `ticket-confirmation-dispatch`
// (transactional) or `notify-dispatch` with `emailVariant: "generic_notification"`
// (system/relational). Rename deferred to a separate ORCH.
```

`send-otp` is excluded — it uses Twilio Verify and its name is consistent.

## 12. Success Criteria

| # | Criterion | Layer | Test |
|---|---|---|---|
| SC-1 | Buyer who completes free checkout receives an email from `tickets@usemingla.com` with branded HTML (Mingla logo + event cover + organiser line + line items + Total line) and a PDF attachment `tickets-{shortId}.pdf` with one page per ticket | Edge / Provider | T-01 + MG-1 |
| SC-2 | Same as SC-1 for paid checkout | Edge / Provider | T-02 + MG-2 |
| SC-3 | Each PDF page contains a QR code that, when scanned by `scan-ticket` against the matching event, returns `result: "success"` | Edge / DB / scanner | T-03 |
| SC-4 | When `events.cover_media_url IS NULL` or `cover_media_type IN ('video','gif')`, the email renders a branded fallback block (orange tint + event title) — no broken-image icon, no `<video>` tag | Edge / Render | T-04 |
| SC-5 | When `event_dates.is_master` row is absent, the email renders without the date line (no fabricated date) | Edge / Render | T-05 |
| SC-6 | Buyer name `<script>alert(1)</script>` renders as escaped text in the HTML email body; PDF buyer-name slot renders the literal string verbatim (PDF text is not HTML) | Edge / Render | T-06 |
| SC-7 | `notify-dispatch` called with `emailVariant: "generic_notification"` and `emailTo` sends a branded HTML email from `notifications@usemingla.com` | Edge / Provider | T-07 |
| SC-8 | Admin EmailPage with the "Use Mingla brand shell" toggle ON sends an HTML email from `hello@usemingla.com` whose preview matches the shell | Admin UI / Edge | T-08 |
| SC-9 | If `EMAIL_SENDERS.system` somehow resolves to `notifications@resend.dev` (mocked env), the dispatcher and notify-dispatch throw `email_sender_resend_sandbox_forbidden` before POST | Edge | T-09 |
| SC-10 | Resend payload size cap: a 10-ticket order produces a `< 5MB` combined PDF; an 11-ticket order may trigger `failed_retryable` with `ticket_pdf_size_exceeded` rather than a runaway send | Edge | T-10 |
| SC-11 | All five strict-grep gates fail on the pre-ORCH-0785 codebase and pass on the post-ORCH-0785 codebase | CI | RT-8/9/10/11/12 |
| SC-12 | `send-*-email` files carry the ORCH-0785 header comment; grep for the comment returns each of the 9 files | Code | T-12 |
| SC-13 | No new SQL migration was added by this ORCH (`git diff main…Seth -- supabase/migrations` for ORCH-0785 work shows zero new files) | Repo | Reviewer manual check |
| SC-14 | `ticket-confirmation-dispatch` behavioural-contract preservation: service-role auth gate unchanged; ledger state-transition rules unchanged (pending/failed_retryable → sending → sent/failed_*); rollup recompute formula unchanged | Edge | T-14 (regression contract) |

## 13. Non-Goals (Hard Guards)

The implementor MUST NOT in this ORCH:

1. Touch `mingla-business/app/event/[id]/orders/[oid]/index.tsx` or `mingla-business/src/services/ticketCheckoutService.ts:resendTicketConfirmation`. The organiser "Resend ticket" CTA is ORCH-0782's scope; that ORCH must invoke this SPEC's new dispatcher contract and inherit the brand shell + PDF automatically.
2. Recompute `orders.notification_status` rollup differently. ORCH-0782 scope.
3. Touch Supabase Auth email templates (OTP / magic-link / signup / password-reset / change-email). Owned by §3.6 future ORCH unless operator flips that gate.
4. Build `invite-brand-member`, `invite-scanner`, or any new email-sending edge function. The shared shell must be ready to host them when their own ORCH runs.
5. Implement the reconciliation PDF email (E4) — `_shared/ticketPdf.ts` is generic enough to be re-used by that future feature, but the feature is not built here.
6. Rewrite admin bulk-email recipient filtering to honour `notification_preferences.email_enabled` or add unsubscribe footer logic for marketing segments. New ORCH per Discovery 2 in the investigation.
7. Touch the SMS body. Same envelope, same content.
8. Touch `mingla-business/app/checkout/[eventId]/confirm.tsx`. The buyer post-purchase screen copy ("Sent to {email} and {phone}") and on-screen QR carousel are out of scope.
9. Run `supabase db push`. No migration is needed; even an empty migration would create a remote-only timestamp.
10. Deploy any edge function until the operator confirms the migration gate is N/A and the §3.x preflight is resolved. The orchestrator memory rule says edge function deploys are operator-gated (`feedback_orchestrator_deploys_edge_functions.md`).
11. Print any provider secret, raw QR pepper, raw `qr_token_hash`, full buyer email list, full phone number, Stripe PaymentIntent client_secret, or full Resend message id in implementor report or test fixtures. Logs use 8-char shortIds and `provider_message_id` may appear only in the ledger row, not in artifacts.

## 14. Invariants Preserved + New

| Invariant | Status | Verifier |
|---|---|---|
| Existing ORCH-0777 ledger transition rules | Preserved | T-14, RT-1 |
| Existing service-role auth on `ticket-confirmation-dispatch` | Preserved | T-14 |
| Constitution rule 3 (no silent failures) | Preserved + tightened — PDF render failure now surfaces as `failed_retryable` instead of crashing the function | T-04, T-10 |
| Constitution rule 9 (no fabricated data) | Preserved + tightened — null cover / null start_at render branded fallback or hidden, never invented | T-04, T-05 |
| Memory: "Mingla is an experience app, not a dating app" | Preserved — footer copy says "experience app" | Code review |
| Memory: "Skill output format — 4 sections only" | Preserved — see §17 | Chat output |
| **NEW** I-PROPOSED-AD `EMAIL_BRAND_SHELL_SINGLETON` | Every customer-facing email rendered server-side MUST go through `_shared/email/` shell; no inline `<!doctype html>` outside that module | ORCH-0785-D strict-grep |
| **NEW** I-PROPOSED-AE `RESEND_NO_SANDBOX_SENDER` | No code path may send Resend email from `*@resend.dev`; `assertNotResendSandbox` runs before every POST | ORCH-0785-B strict-grep + T-09 |
| **NEW** I-PROPOSED-AF `BUYER_INPUT_HTML_ESCAPED` | Any user-provided string interpolated into email HTML must flow through `escapeHtml` | ORCH-0785-C strict-grep + T-06 |
| **NEW** I-PROPOSED-AG `TICKET_PDF_PRIVACY` | Ticket PDFs must not contain `qr_token_hash`, QR pepper, Stripe payment IDs, or buyer phone numbers | ORCH-0785-E strict-grep + T-03 |

The four new I-PROPOSED invariants become ACTIVE on CLOSE of ORCH-0785. Implementor must add them to `Mingla_Artifacts/INVARIANT_REGISTRY.md` in DRAFT state during implementation; orchestrator promotes to ACTIVE in close.

## 15. Test Matrix

### 15.1 Repo-running tests (must fail before, pass after)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 (RT-1) | Free ticket confirmation render | Fixture order with `payment_method='free'`, 1 ticket, event cover URL, brand profile photo URL, master `event_dates` row | `renderTransactionalEmail` returns subject `"Your Mingla tickets for {title}"`, HTML containing logo `<img>`, cover `<img>`, brand name string, line item, total `Free`, "see attached PDF for QR" badge | Edge / Renderer unit |
| T-02 (RT-2) | Paid ticket confirmation render | Same as T-01 but `payment_method='online_card'`, total_cents=5000, currency='USD' | HTML contains `$50.00`, paid copy variant, no "Free" text | Edge / Renderer unit |
| T-03 (RT-4) | PDF QR round-trip | Fixture `tickets[]` with synthetic `qr_code` | PDF page count = `tickets.length`; QR decoded text equals fixture `qr_code` string; no `qr_token_hash` or pepper substring in PDF bytes | Edge / `ticketPdf.test.ts` |
| T-04 (RT-3) | Missing/video cover fallback | `cover_media_url=null` AND `cover_media_url='https://…video.mp4', cover_media_type='video'` | HTML renders fallback block (no `<img src="">`, no `<video>`, no broken-image marker) | Renderer unit |
| T-05 | Missing master event_date | `event_dates` query returns null | HTML omits the date line entirely (no "Date TBA" placeholder unless operator overrides; default is empty) | Renderer unit |
| T-06 (RT-6) | Buyer-name XSS escape | `order.buyer_name = "<script>alert(1)</script>"` | HTML contains `&lt;script&gt;`, not `<script>`; PDF buyer-name slot contains literal `<script>alert(1)</script>` as drawn text (PDF text is not HTML) | Renderer unit + PDF unit |
| T-07 | notify-dispatch generic shell opt-in | POST with `emailTo: "x@y.z"`, `emailVariant: "generic_notification"`, `title: "Heads up"`, `body: "Para1\n\nPara2"` | Resend POST recorded by mock contains branded HTML with two `<p>` paragraphs, from `notifications@usemingla.com` | Edge integration with mocked fetch |
| T-08 | admin-send-email brand shell | POST with `action: "send"`, `useBrandShell: true`, `subject`, `body`, `cta: {label, url}` | Resend POST contains branded HTML with CTA pill, from `hello@usemingla.com`; `admin_email_log` row inserted with status `sent` | Edge integration |
| T-09 (RT-7) | Sender sandbox guard | Env override `RESEND_TICKET_FROM=Mingla <foo@resend.dev>` | `ticket-confirmation-dispatch` throws `email_sender_resend_sandbox_forbidden` BEFORE Resend POST; ledger row → `failed_retryable` with `last_error="email_sender_resend_sandbox_forbidden"` | Edge integration |
| T-10 | PDF size envelope | Fixture order with 11 tickets simulated to force size > 5MB | `buildTicketPdf` throws `ticket_pdf_size_exceeded`; dispatch sets ledger `failed_retryable` with that error string | Edge integration |
| T-11 (RT-5) | Resend attachments present | Snapshot test of dispatcher Resend POST body shape for any happy-path ticket email | Body JSON contains `attachments[0].filename` and `attachments[0].content` (base64) | Static / Edge integration |
| T-12 | send-*-email header comments | grep across 9 files | All contain the ORCH-0785 header comment | Static |
| T-13 (RT-11) | Admin EmailPage default sender unification | Render UI; default `fromEmail` state equals `EMAIL_SENDERS.admin.address` constant string | Pass | UI / Constant assertion |
| T-14 | Behavioural contract preservation | Pre/post diff of `ticket-confirmation-dispatch`: service-role auth string preserved; ledger transition state machine unchanged; rollup recompute formula unchanged | Pass | Static diff |
| RT-8 | Strict-grep ORCH-0785-A | Run script on Seth branch | Exit 0 post-impl; exit 1 against an injected `fetch("api.resend.com/emails")` without `attachments` | CI |
| RT-9 | Strict-grep ORCH-0785-B | Run script | Exit 0; exit 1 on `'onboarding@resend.dev'` outside comments | CI |
| RT-10 | Strict-grep ORCH-0785-C | Run script | Exit 0; exit 1 on raw `${order.buyer_name}` in an HTML template literal | CI |
| RT-11 | Strict-grep ORCH-0785-D | Run script | Exit 0; exit 1 on any new `<!doctype html>` string outside `_shared/email/**` | CI |
| RT-12 | Strict-grep ORCH-0785-E | Run script | Exit 0; exit 1 on `qr_token_hash` or `app.qr_token_pepper` token in a PDF caller file | CI |

### 15.2 Manual / provider gates (operator + tester)

| Gate | Owner | Evidence |
|---|---|---|
| MG-1 | Operator runs a real free-ticket purchase from mingla-business on iOS / Android / Web; receives email at `sethogieva@gmail.com`; opens the PDF on iOS Mail + Gmail web; scans the QR via the real Mingla Business scanner → `success` | Operator + tester | Inbox screenshot, PDF screenshot, scanner result screenshot |
| MG-2 | Same flow for a paid-ticket purchase | Operator + tester | Same |
| MG-3 | Operator runs admin EmailPage individual send with brand shell ON, sends to operator email; receives branded HTML | Operator | Inbox screenshot |
| MG-4 | Operator simulates a `stripe-kyc-stall-reminder` (or any `notify-dispatch` emailTo path) and receives branded HTML from `notifications@usemingla.com` | Operator | Inbox screenshot |
| MG-5 | Operator inspects Supabase function secrets dashboard and confirms `MINGLA_LOGO_URL`, `MINGLA_LOGO_URL_2X`, `MINGLA_FOOTER_ADDRESS`, `RESEND_ADMIN_FROM`, `RESEND_SYSTEM_FROM` are set in production after deploy | Operator | Dashboard screenshot |
| MG-6 | Operator confirms Resend DKIM verification status for `tickets@usemingla.com`, `hello@usemingla.com`, `notifications@usemingla.com` | Operator | Resend dashboard screenshot |

## 16. Implementation Order

Each step lists the exact files to create or modify; implementor reports back per-step results in the implementation report.

1. **Preflight stop.** Implementor confirms operator §3.1–§3.6 decisions in chat before proceeding to step 2. If any §3 item is undecided, implementor stops and reports.
2. **Shared escape + sender modules** — create `_shared/email/escape.ts`, `_shared/email/senders.ts`, `_shared/email/copy.ts`, `_shared/email/currency.ts`, `_shared/email/dateLine.ts`, plus their tests. Run Deno tests; report results.
3. **Shared shell renderer** — create `_shared/email/shell.ts`, `_shared/email/ticketBody.ts`, `_shared/email/genericBody.ts`, `_shared/email/index.ts`, plus snapshot tests. Run Deno tests; report.
4. **PDF module** — create `_shared/ticketPdf.ts` plus tests. Verify esm.sh imports load under Deno (cold-start test). Run Deno tests; report.
5. **`ticket-confirmation-dispatch` rewrite** — expand SELECT, wire renderer + PDF + attachments, preserve auth + ledger semantics, add PDF-failure ledger transition. Snapshot the Resend POST body shape. Run Deno tests; report.
6. **`notify-dispatch` opt-in shell + sandbox guard** — add `emailVariant` payload, remove sandbox fallback, route through `EMAIL_SENDERS.system`. Update `stripe-kyc-stall-reminder` and `stripe-webhook-health-check` callers to pass `emailVariant: "generic_notification"`. Run Deno tests; report.
7. **`admin-send-email` brand shell + UI wiring** — extend edge payload; update `mingla-admin/src/pages/EmailPage.jsx` defaults + toggle + preview shell. Update `mingla-business` admin-tab parity if applicable (likely no — admin compose is admin-only). Run admin UI build; report.
8. **Header comments on 9 misleadingly-named functions** — add ORCH-0785 header line.
9. **Strict-grep registry — create 5 scripts + 5 jobs** — add `.github/scripts/strict-grep/orch-0785-*.mjs`, update workflow file with 5 new jobs, update the index comment at the top. Test each script locally with `node .github/scripts/strict-grep/orch-0785-<gate>.mjs` and report exit codes.
10. **Implementation report** — write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md` with old→new receipts for every changed file, per-step test outputs, and the list of Supabase function secrets the operator must set before deploy.
11. **Deploy gate** — implementor lists the Supabase function deploy commands needed (`supabase functions deploy ticket-confirmation-dispatch`, `notify-dispatch`, `admin-send-email`) but does NOT run them. Per `feedback_orchestrator_deploys_edge_functions.md`, the orchestrator owns deploys after operator gate. The implementor's report ends with: "Awaiting operator confirmation of MG-5 (env secrets present in Supabase) before deploy; deploys are orchestrator-owned."

## 17. Output Contract (per memory `feedback_universal_skill_output_format`)

The implementor's chat reply on return must contain exactly:

1. Historical context paragraph (layman) — what this ORCH solved and where it sits in the lifecycle.
2. What was just done — bullet list of files touched and tests run.
3. What needs to happen next — paragraph (layman) on operator deploy gates and orchestrator routing.
4. Exact handoff message — the verbatim Next Handoff paragraph for the operator to paste into Claude `mingla-forensics` (TEST mode).

Detail in files. Chat ≤ 20 lines.

## 18. Failure-Honesty Label

This SPEC is `contract proven, preflight-gated`. Every layer is locked except the operator's §3 preflight decisions, which carry recommended defaults the implementor will adopt by default if the operator chimes in with "use the defaults." The pdf-lib + qrcode esm.sh availability is a one-time runtime probe by the implementor; if either fails the implementor STOPS and reports — SPEC names that as a hard guard, not a hidden assumption.

---

## Next Handoff Paragraph

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md`, following the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0785_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF_INVENTORY.md` and the design direction at `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md`. Begin with §3 preflight: STOP and ask the operator to confirm or override §3.1 canonical logo source, §3.2 logo publishing URL, §3.3 sender domain assignment, §3.4 support contact, §3.5 combined-vs-per-ticket PDF default, §3.6 Supabase Auth scope deferral, before touching any product code. Then execute §16 steps 2–10 in order; stay strictly within §13 hard guards — do not touch the organiser "Resend ticket" CTA (ORCH-0782), do not mutate Supabase Auth templates, do not run `supabase db push`, do not deploy any edge function, do not touch the buyer confirmation screen or wallet pass scope, and do not absorb the admin-bulk compliance opt-out filter. On completion, write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRAND_AND_TICKET_PDF.md` with §17's four-section output, per-file old→new receipts, the list of Supabase function secrets to set (`MINGLA_LOGO_URL`, `MINGLA_LOGO_URL_2X`, `MINGLA_FOOTER_ADDRESS`, `RESEND_TICKET_FROM`, `RESEND_ADMIN_FROM`, `RESEND_SYSTEM_FROM`), and `supabase functions deploy` commands ready for the orchestrator to run. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. The next dispatch will be Claude `mingla-forensics` (TEST mode) for QA against §12 success criteria and §15 test matrix, then Codex `orchestrator-mingla` for CLOSE.
