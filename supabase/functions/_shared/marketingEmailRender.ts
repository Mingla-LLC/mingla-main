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
// ISSUE-1001 — canonical logo resolution; replaces the silent DEAD-404
// email-assets fallback URL with a live default.
import { minglaLogoUrl } from "./brandAssets.ts";
import { resolveRuntimeString } from "./runtimeConfig.ts";

const { BRAND_ORANGE, BRAND_INK, BRAND_MUTED, BRAND_BG_SOFT, BRAND_BORDER } =
  SHELL_TOKENS;

export interface MarketingVariables {
  first_name: string;
  event_name: string | null;
  event_date: string | null;
  event_time: string | null;
  doors_open: string | null;
  // ORCH-0877 — end-of-event time variable. Templates may include {ends_at}
  // to render the close time alongside doors_open. Null when source is null
  // (Constitution #9 — no fabrication).
  ends_at: string | null;
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
  // ORCH-0877 — end-time label rendered as a sub-line below the date chip
  // in renderEventCard. Null = render no sub-line (Constitution #9). For
  // same-day events this is just the end time (e.g. "Ends 11 PM"); for
  // cross-midnight events it carries the next-day weekday (e.g.
  // "Ends Sun 2 AM").
  ends_at_label: string | null;
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
  /** Server-owned inert marker. It is never rewritten into marketing_clicks. */
  offering_invite_url_marker?: string;
}

export interface RenderMarketingEmailResult {
  subject: string;
  html: string;
  text: string;
  /** One entry per href found in the rendered body (after substitution). */
  links: RenderedLink[];
}

const VARIABLE_RE =
  /\{(first_name|event_name|event_date|event_time|doors_open|ends_at|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g;
// ORCH-0891 M2: extended event token regex to optionally capture a
// `|size` suffix (compact / medium / large). Backwards-compat preserved:
// legacy `{{event:UUID}}` tokens (no suffix) default to `medium`.
//   Group 1: event UUID
//   Group 2: size if present, else undefined
// Per SPEC §3.2 + I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT.
const EVENT_TOKEN_RE =
  /\{\{event:([0-9a-fA-F-]{36})(?:\|(compact|medium|large))?\}\}/g;

/** ORCH-0891 M2 event chip size variants. */
type EventChipSize = "compact" | "medium" | "large";
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
  if (input.offering_invite_url_marker !== undefined) {
    const markerCount = input.body_html.split(input.offering_invite_url_marker)
      .length - 1;
    if (
      markerCount !== 1 || input.offering_invite_url_marker.startsWith("http")
    ) {
      throw new Error("offering_invite_volatile_link_invalid");
    }
  }
  // Step 1 — variable substitution.
  const substituted = input.body_html.replace(VARIABLE_RE, (_match, key) => {
    const value =
      (input.variables as unknown as Record<string, string | null>)[key];
    if (value === null || value === undefined) return "";
    return escapeHtml(value);
  });

  // Step 1.5 — paragraph reflow (#2520).
  //
  // The composer stores body copy as a TOKEN STRING whose paragraph
  // separator is `\n\n` (see `tenTapTokenBridge.bodyHtmlToTenTapDoc`, which
  // splits on `\n` to rebuild editor paragraphs). Nothing downstream ever
  // converted that to HTML: the shell drops the body straight into
  // `<td style="padding:28px;">`, HTML collapses runs of whitespace to a
  // single space, and every campaign shipped as ONE UNBROKEN WALL OF TEXT.
  // Verified against the 189 emails sent for `We Go Again` on 2026-08-24.
  //
  // The conversion belongs HERE and not in storage: writing `<p>` into
  // `body_html` would break the editor bridge, which treats `<p>` as
  // unrecognised HTML and renders the tags as literal text.
  //
  // ORDER IS CONTRACTUAL — this runs BEFORE event-token replacement.
  // A medium/large event card is a `<table>`, which is INVALID inside `<p>`
  // and is dropped or unwrapped by real mail clients. By reflowing while the
  // cards are still `{{event:…}}` tokens we can leave a block-level card
  // unwrapped and still wrap ordinary prose. Compact chips are inline `<a>`
  // pills and stay inside their paragraph, which is what makes
  // "don't miss {{event:x|compact}} on Friday" read as one sentence.
  const reflowed = reflowParagraphs(substituted, eventBlockIsStandalone);

  // Step 2 — event-card token replacement.
  // ORCH-0891 M2: extract optional `|size` suffix and dispatch to size-specific
  // renderer. Legacy size-less tokens default to `medium` (current layout) per
  // I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT.
  const eventLookup = new Map<string, EmbeddedEvent>();
  for (const e of input.embedded_events) eventLookup.set(e.id, e);
  const withEventCards = reflowed.replace(
    EVENT_TOKEN_RE,
    (_match, eventId: string, sizeRaw: string | undefined) => {
      const event = eventLookup.get(eventId);
      if (event === undefined) return "";
      const size = normalizeEventChipSize(sizeRaw);
      return renderEventCard(event, size);
    },
  );

  // Step 3 — collect + rewrite links to trackable URLs.
  // Tracking origin defaults to the Supabase function endpoint so it works
  // without DNS rewrite. Operators who set up a clean `m.usemingla.com` or
  // `host.usemingla.com/m/*` rewrite pointing at the marketing-track-
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
    logoUrl: minglaLogoUrl(),
    footerAddress:
      resolveRuntimeString("mingla_footer_address", "MINGLA_FOOTER_ADDRESS") ??
        "Mingla, hello@usemingla.com",
    brandHeaderImageUrl: input.brand_header_image_url ?? null,
  });

  // Flat-text fallback (strip tags, collapse whitespace). Good-enough
  // baseline; Resend supports plain-text alternative for deliverability.
  // #2520 — the body is now real block markup, so the old "strip every tag"
  // pass would run all 17 paragraphs together in the plain-text alternative
  // exactly the way the HTML used to. Turn block boundaries back into
  // newlines BEFORE stripping, so the text part keeps the author's shape.
  let text = withEventCards
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + `\n\nUnsubscribe: ${input.unsubscribe_url}`;
  if (input.offering_invite_url_marker !== undefined) {
    text += `\n\nEvent link: ${input.offering_invite_url_marker}`;
  }

  return { subject: input.subject, html, text, links };
}

/**
 * Normalize the size value from the token suffix. Unknown / undefined
 * values default to `medium` (legacy behavior).
 *
 * ORCH-0891 M2 per I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT.
 */
function normalizeEventChipSize(raw: string | undefined): EventChipSize {
  if (raw === "compact" || raw === "medium" || raw === "large") return raw;
  return "medium";
}

/**
 * Email event card — mirrors the Mingla og:image card design from
 * `mingla-business/server/socialPreview.js` (cream → orange gradient,
 * orange accent bar with "Featured event" kicker, dark date chip +
 * orange-tinted location chip, large title, prominent Get tickets CTA).
 *
 * ORCH-0891 M2 — extended with three size variants:
 *   compact: single-line strip ~48pt — just title + date pill, no kicker,
 *            no CTA button (inline mention reference)
 *   medium (default = legacy):  current layout — orange kicker + chips +
 *            title + CTA (no cover image when hero is unavailable, with
 *            cover when present)
 *   large: medium card + forced cover image emphasis (skipped when video
 *            media or missing URL — falls back to medium-with-cover layout
 *            since the large variant's defining feature is the cover hero)
 *
 * Video covers (cover_media_type === 'video') skip the image hero per
 * socialPreview's own rule — there's no server-extracted still in the
 * events schema, and email clients can't render `.mov` files in `<img>`.
 *
 * Email-safe HTML: table-based layout, inline styles only, no CSS
 * gradients on `<td>` (Outlook strips them) — gradient is rendered as
 * a solid cream `<td>` with the orange-to-cream transition done in the
 * brand-shell-wrap, NOT inside the card cells.
 */
function renderEventCard(
  event: EmbeddedEvent,
  size: EventChipSize = "medium",
): string {
  if (size === "compact") return renderEventCardCompact(event);
  // medium AND large both fall through to the full card; large just
  // emphasizes the cover by skipping the medium fallback when cover is
  // not usable. For inbox email, this difference is subtle but
  // preserves the SPEC-defined size hierarchy.
  return renderEventCardFull(event, size);
}

/**
 * ORCH-0891 M2 — compact card variant.
 *
 * Single-row inline-block strip with just the event title + date pill.
 * No kicker, no chips, no CTA button — the title itself is the link.
 * Use case: mention-style references inside flowing email body text
 * (e.g., "Don't miss [Friday Night] this weekend").
 *
 * ~48pt tall on most clients. Outlook may render slightly differently
 * (older WordView renderer); the inline-block structure stays readable.
 */
function renderEventCardCompact(event: EmbeddedEvent): string {
  const title = escapeHtml(event.title);
  const date = escapeHtml(event.date_label ?? "");
  const url = escapeHtml(event.url);
  const INK = "#16110D";
  const ORANGE = "#F47C20";
  const ORANGE_TINT = "rgba(244, 124, 32, 0.12)";
  const ORANGE_BORDER = "rgba(244, 124, 32, 0.32)";

  const dateSuffix = date.length > 0
    ? `<span style="margin-left:8px;font-weight:600;font-size:12px;color:${ORANGE};">${date}</span>`
    : "";

  return `<a href="${url}" style="display:inline-block;padding:6px 14px;margin:0 2px;border-radius:999px;background:${ORANGE_TINT};border:1px solid ${ORANGE_BORDER};font-size:14px;font-weight:600;color:${INK};text-decoration:none;line-height:1.4;">${title}${dateSuffix}</a>`;
}

/**
 * ORCH-0891 M2 — full (medium + large) card variant.
 *
 * This is the renderer the legacy `renderEventCard()` was. The `size`
 * parameter is reserved for future divergence (e.g., large could
 * render an XL hero image with bigger title typography). For v1 of M2,
 * medium and large share this implementation — the divergence is
 * intentionally minimal to keep the migration risk low. Future polish
 * can expand large's distinct visuals as a separate ORCH.
 */
function renderEventCardFull(
  event: EmbeddedEvent,
  _size: EventChipSize,
): string {
  const title = escapeHtml(event.title);
  const date = escapeHtml(event.date_label ?? "");
  // ORCH-0877 — end-time sub-line (separate from the date chip per SPEC
  // §4.10 for legibility). Empty string when null — no fabrication.
  const endsAt = escapeHtml(event.ends_at_label ?? "");
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

  // ORCH-0877 — end-time sub-line. Renders BELOW the chip row, ABOVE the
  // title, only when ends_at_label is non-empty. Muted ink, smaller weight
  // so the chips + title stay the visual anchor.
  const endsAtLine = endsAt.length > 0
    ? `<p style="margin:0 0 12px 0;font-size:13px;font-weight:500;color:${ORANGE_MUTED};">${endsAt}</p>`
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
        ${
    dateChip || locationChip
      ? `<div style="margin:0 0 14px 0;">${dateChip}${locationChip}</div>`
      : ""
  }
        ${endsAtLine}
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
 * Resolves the origin used to build per-link tracking URLs.
 *
 * #2470 — this DEFAULTS to the branded Mingla origin, and deliberately does not
 * depend on configuration to do so. It previously defaulted to the raw Supabase
 * function endpoint, on the reasoning that a link which resolves beats a link
 * that does not. But the branded origin was gated behind an env var that was
 * never provisioned, so for the whole life of the marketing hub every brand's
 * email went out carrying `…supabase.co/functions/v1/marketing-track-click/…`
 * — a bare cloud hostname sharing nothing with the `<slug>@usemingla.com` From
 * address. That reads as spam to mailbox providers and as phishing to a person.
 *
 * The lesson is the bug class, not the URL: a fallback nobody configures away
 * IS the production path. So the good value is the default, and the env var is
 * now only an override for non-production projects.
 *
 * `usemingla.com/m/<id>` is served by the marketing app, which rewrites it to
 * `marketing-track-click` (mingla-marketing/next.config.ts). Keep the two in
 * step: changing this origin without the matching rewrite breaks every link.
 */
const BRANDED_TRACKING_LINK_ORIGIN = "https://usemingla.com/m";
function getTrackingLinkOrigin(): string {
  const override = Deno.env.get("MINGLA_TRACKING_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  return BRANDED_TRACKING_LINK_ORIGIN;
}

function renderUnsubscribeFooter(
  unsubscribeUrl: string,
  brandName: string,
): string {
  const safeUrl = escapeHtml(unsubscribeUrl);
  const safeBrand = escapeHtml(brandName);
  return `<p style="margin:32px 0 0 0;padding-top:16px;border-top:1px solid ${BRAND_BORDER};font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
    You're receiving this because you bought tickets from ${safeBrand} on Mingla.
    <a href="${safeUrl}" style="color:${BRAND_MUTED};text-decoration:underline;">Unsubscribe</a>
    — Mingla honours this across all your purchases from ${safeBrand}.
  </p>`;
}

/**
 * #2520 — paragraph reflow for token-string bodies.
 *
 * `\n\n` (or more) separates paragraphs; a single `\n` inside a paragraph is
 * a soft line break. Blocks for which `isStandaloneBlock` returns true are
 * emitted bare so block-level HTML (event card tables) is never illegally
 * nested inside a `<p>`.
 *
 * Inline styles only — Gmail strips `<head>` CSS, so a `<style>` block would
 * silently do nothing in the client that matters most.
 */
export function reflowParagraphs(
  body: string,
  isStandaloneBlock: (block: string) => boolean,
): string {
  // Normalise CRLF so a Windows-authored draft splits identically.
  const normalised = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Already-structured bodies pass through untouched. A body that contains
  // block markup was not authored as a token string, and re-wrapping it would
  // nest blocks illegally.
  if (/<(p|div|table|ul|ol|blockquote|h[1-6])\b/i.test(normalised)) {
    return normalised;
  }
  const blocks = normalised.split(/\n{2,}/);
  const out: string[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (block.length === 0) continue;
    if (isStandaloneBlock(block)) {
      out.push(block);
      continue;
    }
    const withBreaks = block.split("\n").map((line) => line.trim()).join(
      "<br />",
    );
    out.push(`<p style="${PARAGRAPH_STYLE}">${withBreaks}</p>`);
  }
  return out.join("");
}

/** Inline paragraph styling. Matches the shell's 16px/1.6 body rhythm. */
const PARAGRAPH_STYLE =
  "margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#16110D;";

/**
 * A block that is nothing but a medium/large event token renders as a
 * `<table>` and must not be wrapped in `<p>`. Compact tokens are inline and
 * deliberately return false so they keep flowing with their sentence.
 */
export function eventBlockIsStandalone(block: string): boolean {
  const match = /^\{\{event:([0-9a-fA-F-]{36})(?:\|(compact|medium|large))?\}\}$/
    .exec(block.trim());
  if (match === null) return false;
  return match[2] !== "compact";
}
