// ORCH-0815-B — Marketing email body renderer.
//
// Takes the composer-authored `body_html` + a resolved contact + an
// embedded-events lookup + a signed unsubscribe URL, and produces the
// final Resend-ready HTML by:
//
//   1. Variable substitution: {first_name}, {event_name}, {event_date},
//      {brand_name}, {event_url}, {spots_left}, {event_time}, {doors_open}.
//      Per SPEC §3.4 + §7.1, applied AFTER body_html is composed.
//   2. Event-card token replacement: every `{{event:<uuid>}}` token is
//      swapped for a single styled `<table>` card (Open Question 2 chose
//      the simple-card route over MJML). Unknown event IDs render as
//      empty string (defensive — never crash an email over a stale ID).
//   3. Per-link tracking rewrite: every `href="..."` in the post-
//      substitution HTML is replaced with the per-recipient tracking
//      URL `https://mingla.app/m/<tracking_id>`. The destination URL is
//      returned alongside so marketing-send can INSERT marketing_clicks
//      rows.
//   4. Unsubscribe footer injection: a footer paragraph with a one-click
//      `Unsubscribe` link is appended (idempotent — appended exactly once).
//   5. Brand-shell wrap: the composed body is wrapped through the existing
//      `_shared/email/` shell so marketing email shares the transactional
//      brand frame (logo, colour palette, footer copy disclaimer).
//
// Cross-references:
//   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §7.1
//   - Brand shell: supabase/functions/_shared/email/shell.ts (re-used)
//   - Variable list: SPEC §2 (in-scope) — kept as the canonical reference

import { escapeHtml } from "./email/escape.ts";
import { renderShell, SHELL_TOKENS } from "./email/shell.ts";
import { generateTrackingId } from "./marketingTokens.ts";

const { BRAND_ORANGE, BRAND_INK, BRAND_MUTED, BRAND_BG_SOFT, BRAND_BORDER } =
  SHELL_TOKENS;

export interface MarketingVariables {
  first_name: string;
  event_name: string | null;
  event_date: string | null;
  event_time: string | null;
  doors_open: string | null;
  brand_name: string;
  event_url: string | null;
  spots_left: string | null;
  previous_event_name: string | null;
  next_event_name: string | null;
  event_id: string | null;
}

export interface EmbeddedEvent {
  id: string;
  title: string;
  date_label: string | null;
  location_label: string | null;
  cover_image_url: string | null;
  url: string;
}

export interface RenderedLink {
  tracking_id: string;
  destination_url: string;
}

export interface RenderMarketingEmailInput {
  body_html: string;
  variables: MarketingVariables;
  embedded_events: EmbeddedEvent[];
  unsubscribe_url: string;
  /** Inserted as the email <title> + the shell preheader. */
  subject: string;
  brand_name: string;
  support_email?: string;
}

export interface RenderMarketingEmailResult {
  subject: string;
  html: string;
  text: string;
  /** One entry per href found in the rendered body (after substitution). */
  links: RenderedLink[];
}

const VARIABLE_RE = /\{(first_name|event_name|event_date|event_time|doors_open|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g;
const EVENT_TOKEN_RE = /\{\{event:([0-9a-fA-F-]{36})\}\}/g;
// href= followed by single or double quoted URL. We do NOT rewrite
// `mailto:` or anchor (`#…`) links — only http/https destinations.
const HREF_RE = /href=(["'])(https?:\/\/[^"']+)\1/g;

/**
 * Pure, deterministic-by-input renderer. Returns the brand-shell-wrapped
 * HTML, a flat-text fallback, and the list of links it rewrote (so the
 * caller can INSERT marketing_clicks rows in one batch).
 */
export function renderMarketingEmail(
  input: RenderMarketingEmailInput,
): RenderMarketingEmailResult {
  // Step 1 — variable substitution.
  const substituted = input.body_html.replace(VARIABLE_RE, (_match, key) => {
    const value = (input.variables as unknown as Record<string, string | null>)[key];
    if (value === null || value === undefined) return "";
    return escapeHtml(value);
  });

  // Step 2 — event-card token replacement.
  const eventLookup = new Map<string, EmbeddedEvent>();
  for (const e of input.embedded_events) eventLookup.set(e.id, e);
  const withEventCards = substituted.replace(
    EVENT_TOKEN_RE,
    (_match, eventId: string) => {
      const event = eventLookup.get(eventId);
      if (event === undefined) return "";
      return renderEventCard(event);
    },
  );

  // Step 3 — collect + rewrite links to trackable URLs.
  const links: RenderedLink[] = [];
  const withTrackingLinks = withEventCards.replace(
    HREF_RE,
    (_match, quote: string, destination: string) => {
      const trackingId = generateTrackingId();
      links.push({ tracking_id: trackingId, destination_url: destination });
      return `href=${quote}https://mingla.app/m/${trackingId}${quote}`;
    },
  );

  // Step 4 — unsubscribe footer (unsubscribe URL is NOT tracked — must
  // remain a direct link so the unsubscribe edge function receives the
  // signed token verbatim).
  const unsubFooter = renderUnsubscribeFooter(
    input.unsubscribe_url,
    input.brand_name,
  );
  const bodyWithFooter = `${withTrackingLinks}${unsubFooter}`;

  // Step 5 — brand-shell wrap.
  const html = renderShell({
    preheader: input.subject.slice(0, 120),
    bodyHtml: bodyWithFooter,
    supportEmail: input.support_email ??
      Deno.env.get("SUPPORT_EMAIL") ??
      "support@usemingla.com",
    logoUrl: Deno.env.get("MINGLA_LOGO_URL") ??
      "https://usemingla.com/email-assets/mingla-logo.png",
    footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ??
      "Mingla, hello@usemingla.com",
  });

  // Flat-text fallback (strip tags, collapse whitespace). Good-enough
  // baseline; Resend supports plain-text alternative for deliverability.
  const text = withEventCards
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + `\n\nUnsubscribe: ${input.unsubscribe_url}`;

  return { subject: input.subject, html, text, links };
}

function renderEventCard(event: EmbeddedEvent): string {
  const title = escapeHtml(event.title);
  const date = escapeHtml(event.date_label ?? "");
  const location = escapeHtml(event.location_label ?? "");
  const url = escapeHtml(event.url);
  const cover = event.cover_image_url ? escapeHtml(event.cover_image_url) : null;
  const coverImg = cover === null
    ? ""
    : `<tr><td><img src="${cover}" alt="${title}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;outline:none;border-top-left-radius:12px;border-top-right-radius:12px;" /></td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;border:1px solid ${BRAND_BORDER};border-radius:12px;overflow:hidden;background:#FFFFFF;">
    ${coverImg}
    <tr>
      <td style="padding:16px 18px;">
        <p style="margin:0 0 6px 0;font-size:16px;line-height:1.3;color:${BRAND_INK};font-weight:600;">${title}</p>
        ${date.length > 0 ? `<p style="margin:0 0 4px 0;font-size:13px;color:${BRAND_MUTED};">${date}</p>` : ""}
        ${location.length > 0 ? `<p style="margin:0 0 12px 0;font-size:13px;color:${BRAND_MUTED};">${location}</p>` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:${BRAND_ORANGE};border-radius:999px;">
              <a href="${url}" style="display:inline-block;padding:10px 18px;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;">Get tickets</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function renderUnsubscribeFooter(unsubscribeUrl: string, brandName: string): string {
  const safeUrl = escapeHtml(unsubscribeUrl);
  const safeBrand = escapeHtml(brandName);
  return `<p style="margin:32px 0 0 0;padding-top:16px;border-top:1px solid ${BRAND_BORDER};font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
    You're receiving this because you bought tickets from ${safeBrand} on Mingla.
    <a href="${safeUrl}" style="color:${BRAND_MUTED};text-decoration:underline;">Unsubscribe</a>
    — Mingla honours this across all your purchases from ${safeBrand}.
  </p>`;
}
