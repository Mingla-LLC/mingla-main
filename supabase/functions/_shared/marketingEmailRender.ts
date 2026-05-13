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
  /**
   * Mirrors `events.cover_media_type`. Email clients can't render `.mov`
   * files in `<img>` tags, so `cover_image_url` is only used as a hero
   * when this is `"image"` (or null/undefined for back-compat).
   * `socialPreview.js` applies the same rule for og:image cards.
   */
  cover_media_type?: "image" | "video" | "gif" | null;
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
  /**
   * Optional brand cover image URL — when set, replaces the centered
   * Mingla logo in the email header with a full-width brand banner.
   * Caller must apply the same video-skip rule used for event covers
   * (`cover_media_type !== 'video'`) — `.mov` URLs render as broken
   * placeholders in Apple Mail iOS.
   */
  brand_header_image_url?: string | null;
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
  // Tracking origin defaults to the Supabase function endpoint so it works
  // without DNS rewrite. Operators who set up a clean `m.usemingla.com` or
  // `business.usemingla.com/m/*` rewrite pointing at the marketing-track-
  // click function can override via the MINGLA_TRACKING_LINK_ORIGIN env.
  const trackingOrigin = getTrackingLinkOrigin();
  const links: RenderedLink[] = [];
  const withTrackingLinks = withEventCards.replace(
    HREF_RE,
    (_match, quote: string, destination: string) => {
      const trackingId = generateTrackingId();
      links.push({ tracking_id: trackingId, destination_url: destination });
      return `href=${quote}${trackingOrigin}/${trackingId}${quote}`;
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
    brandHeaderImageUrl: input.brand_header_image_url ?? null,
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

/**
 * Email event card — mirrors the Mingla og:image card design from
 * `mingla-business/server/socialPreview.js` (cream → orange gradient,
 * orange accent bar with "Featured event" kicker, dark date chip +
 * orange-tinted location chip, large title, prominent Get tickets CTA).
 *
 * Video covers (cover_media_type === 'video') skip the image hero per
 * socialPreview's own rule — there's no server-extracted still in the
 * events schema, and email clients can't render `.mov` files in `<img>`.
 * The card falls back to a clean cream gradient hero with brand emoji
 * placeholder so it still feels designed, not broken.
 *
 * Email-safe HTML: table-based layout, inline styles only, no CSS
 * gradients on `<td>` (Outlook strips them) — gradient is rendered as
 * a solid cream `<td>` with the orange-to-cream transition done in the
 * brand-shell-wrap, NOT inside the card cells.
 */
function renderEventCard(event: EmbeddedEvent): string {
  const title = escapeHtml(event.title);
  const date = escapeHtml(event.date_label ?? "");
  const location = escapeHtml(event.location_label ?? "");
  const url = escapeHtml(event.url);
  // Mingla design tokens from socialPreview.js
  const CREAM = "#FFF7EF";
  const CREAM_DEEP = "#FFE3C8";
  const INK = "#16110D";
  const ORANGE = "#F47C20";
  const ORANGE_MUTED = "#9A430D";
  const ORANGE_TINT = "rgba(244,124,32,0.18)";
  const ORANGE_BORDER = "rgba(244,124,32,0.22)";

  // Cover image — only when present AND it's actually a still image (not
  // a video or unsupported type). socialPreview.js applies the same rule
  // (line 291); videos have no server-extracted still in the events
  // schema, and `<img src=*.mov>` won't render in any email client (Apple
  // Mail iOS replaces it with a blue broken-image placeholder).
  //
  // When there's no usable image, we skip the entire hero `<tr>` rather
  // than render a fake placeholder block. The kicker + chips + title
  // carry enough visual weight on their own and the card stays compact.
  const hasUsableCover = event.cover_image_url !== null &&
    event.cover_image_url.length > 0 &&
    event.cover_media_type !== "video";
  const coverImg = hasUsableCover
    ? `<tr>
        <td style="padding:0;background:${CREAM_DEEP};">
          <img
            src="${escapeHtml(event.cover_image_url ?? "")}"
            alt="${title}"
            width="544"
            style="display:block;width:100%;max-width:544px;height:auto;aspect-ratio:16/9;object-fit:cover;border:0;outline:none;"
          />
        </td>
      </tr>`
    : "";

  // `margin-bottom` on both chips ensures vertical breathing room whether
  // they sit on one line or wrap to two — operator feedback 2026-05-13.
  const dateChip = date.length > 0
    ? `<span style="display:inline-block;padding:7px 14px;border-radius:999px;background:${INK};color:${CREAM};font-size:13px;font-weight:700;letter-spacing:0.2px;margin-right:8px;margin-bottom:8px;">${date}</span>`
    : "";
  const locationChip = location.length > 0
    ? `<span style="display:inline-block;padding:7px 14px;border-radius:999px;background:${ORANGE_TINT};color:${ORANGE_MUTED};font-size:13px;font-weight:600;margin-bottom:8px;">${location}</span>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border:1px solid ${ORANGE_BORDER};border-radius:20px;overflow:hidden;background:${CREAM};">
    ${coverImg}
    <tr>
      <td style="padding:24px 26px 28px 26px;background:${CREAM};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
          <tr>
            <td valign="middle" style="padding-right:12px;">
              <div style="width:42px;height:5px;border-radius:999px;background:${ORANGE};"></div>
            </td>
            <td valign="middle" style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:${ORANGE_MUTED};text-transform:uppercase;">
              Featured event
            </td>
          </tr>
        </table>
        ${dateChip || locationChip ? `<div style="margin:0 0 14px 0;">${dateChip}${locationChip}</div>` : ""}
        <h2 style="margin:0 0 18px 0;font-size:22px;line-height:1.25;color:${INK};font-weight:800;letter-spacing:-0.3px;">${title}</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:${ORANGE};border-radius:999px;box-shadow:0 4px 12px rgba(244,124,32,0.32);">
              <a href="${url}" style="display:inline-block;padding:13px 24px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">Get tickets →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

/**
 * Resolves the origin used to build per-link tracking URLs. Defaults to the
 * Supabase function endpoint so emails work without DNS rewrite. Operators
 * who want clean tracking links (e.g., `m.usemingla.com/<id>`) can set
 * `MINGLA_TRACKING_LINK_ORIGIN` to their preferred prefix (no trailing slash).
 *
 * The default uses the SUPABASE_URL env so it stays correct across projects.
 */
function getTrackingLinkOrigin(): string {
  const override = Deno.env.get("MINGLA_TRACKING_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") ??
    "https://gqnoajqerqhnvulmnyvv.supabase.co";
  return `${supabaseUrl}/functions/v1/marketing-track-click`;
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
