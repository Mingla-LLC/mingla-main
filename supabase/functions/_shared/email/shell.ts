// ORCH-0785 — Mingla transactional email shell renderer.
// I-PROPOSED-AD EMAIL_BRAND_SHELL_SINGLETON: every customer-facing email
// rendered server-side flows through this shell. No other file under
// supabase/functions/ may build its own <!doctype html> string.

import { escapeHtml } from "./escape.ts";
import { FOOTER_DISCLAIMER } from "./copy.ts";
import { type ActionBarInput, renderActionBar, renderButton } from "./actionBar.ts";

// #4452 §5.9: the rebranded frame (paper body, white card, logo pill, serif
// headline, Geist body, ink pill buttons). Token NAMES are kept for the nine
// importers; BRAND_ORANGE_BUTTON is now the ink fill white-label buttons use
// (white on ink is 18.9:1, better than the old 4.93:1).
const BRAND_ORANGE = "#EB7825";
const BRAND_ORANGE_BUTTON = "#111110";
const BRAND_INK = "#111110";
const BRAND_MUTED = "#6B675F";
const BRAND_BG_SOFT = "#F5F4F0";
const BRAND_BORDER = "#E7E3DA";
const BODY_TEXT = "#3F3D39";
export const LOGO_PILL_URL = "https://usemingla.com/brand/mingla-logo-white-on-orange.png";

export interface ShellInput {
  preheader: string;
  bodyHtml: string;
  supportEmail: string;
  logoUrl: string;
  footerAddress: string;
  /**
   * Optional: when set, replaces the logo header row with a full-width
   * banner — used by marketing email to brand the email with the sending
   * brand's cover image (still image only; callers apply the video-skip rule).
   */
  brandHeaderImageUrl?: string | null;
  /**
   * #3682 Wave 2.4 — optional HTML (already escaped) inserted before the
   * generic FOOTER_DISCLAIMER. Used for order-email follow/unfollow footer line.
   */
  footerFollowLineHtml?: string | null;
  /** #4452: the optional label pill on the right of the header (mono, uppercase). */
  label?: string | null;
  /** #4452 §5.10: the two-button action bar above the footer; omitted = none. */
  actionBar?: ActionBarInput | null;
  /** #4452: a visible unsubscribe line in the footer (follow-ups only). */
  unsubscribeUrl?: string | null;
}

/** #4452: the serif headline with its italic ending. */
export function renderHeadline(plain: string, italic?: string | null): string {
  const em = italic ? ` <em>${escapeHtml(italic)}</em>` : "";
  return `<h1 style="margin:0 0 14px 0;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400;font-size:34px;line-height:1.05;color:${BRAND_INK};">${escapeHtml(plain)}${em}</h1>`;
}

/** #4452: a facts list — a mono label, then the value, divided by hairlines. */
export function renderFacts(rows: Array<[string, string]>): string {
  const body = rows.map(([label, value]) =>
    `<tr><td style="padding:10px 0;border-top:1px solid ${BRAND_BORDER};font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND_MUTED};width:40%;" valign="top">${escapeHtml(label)}</td><td style="padding:10px 0;border-top:1px solid ${BRAND_BORDER};font-family:Geist,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:${BODY_TEXT};" valign="top">${escapeHtml(value)}</td></tr>`
  ).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">${body}</table>`;
}

/** #4452: the ink pill button with the orange ring. */
export function renderPrimaryButton(text: string, href: string): string {
  return renderButton(text, href, "primary");
}

export function renderShell(input: ShellInput): string {
  const support = escapeHtml(input.supportEmail);
  const address = escapeHtml(input.footerAddress);
  const preheader = escapeHtml(input.preheader);
  const logo = escapeHtml(input.logoUrl);
  // escapeHtml(...) is inlined at the call site so the ORCH-0785-C
  // buyer-string-escape gate sees brand strings as already-escaped.
  const hasBrandBanner = input.brandHeaderImageUrl !== null &&
    input.brandHeaderImageUrl !== undefined &&
    input.brandHeaderImageUrl.length > 0;
  const labelPill = input.label && input.label.trim()
    ? `<span style="display:inline-block;padding:5px 10px;border:1px solid ${BRAND_BORDER};border-radius:999px;font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:${BRAND_MUTED};">${escapeHtml(input.label.trim())}</span>`
    : "";
  const headerRow = hasBrandBanner
    ? `<tr>
              <td style="padding:0;background:#FFFFFF;">
                <img src="${escapeHtml(input.brandHeaderImageUrl ?? "")}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;max-height:240px;object-fit:cover;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>`
    : `<tr>
              <td style="padding:24px 28px 0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td align="left" valign="middle"><img src="${logo}" alt="Mingla" width="96" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:96px;" /></td>
                  <td align="right" valign="middle">${labelPill}</td>
                </tr></table>
              </td>
            </tr>`;
  const unsubscribe = input.unsubscribeUrl
    ? `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${BRAND_MUTED};">Don't want these emails? <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${BRAND_INK};text-decoration:underline;">Unsubscribe</a>.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Mingla</title>
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&amp;family=Geist+Mono&amp;family=Instrument+Serif:ital@0;1&amp;display=swap" rel="stylesheet" />
    <style>@media (max-width:480px){.mingla-ab-cell{display:block!important;width:100%!important;}.mingla-ab-cell a{display:block!important;text-align:center!important;}}</style>
  </head>
  <body style="margin:0;padding:0;background:${BRAND_BG_SOFT};color:${BRAND_INK};font-family:Geist,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;color:transparent;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_BG_SOFT};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${BRAND_BORDER};border-radius:20px;overflow:hidden;">
            ${headerRow}
            <tr>
              <td style="padding:24px 28px 28px 28px;font-family:Geist,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:${BODY_TEXT};">
                ${input.bodyHtml}
                ${renderActionBar(input.actionBar)}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_BG_SOFT};font-size:13px;line-height:1.5;color:${BRAND_MUTED};">
                <img src="${logo}" alt="Mingla" width="64" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:64px;margin:0 0 10px 0;" />
                <p style="margin:0 0 8px 0;color:${BRAND_INK};">Making real life easier to find.</p>
                <p style="margin:0 0 8px 0;">Questions? Reply to this email or write to <a href="mailto:${support}" style="color:${BRAND_INK};text-decoration:underline;">${support}</a> · ${address}</p>
                ${
                  input.footerFollowLineHtml &&
                    input.footerFollowLineHtml.trim().length > 0
                    ? `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${BRAND_MUTED};">${input.footerFollowLineHtml}</p>`
                    : ""
                }
                ${unsubscribe}
                <p style="margin:0;font-size:12px;color:${BRAND_MUTED};">${escapeHtml(FOOTER_DISCLAIMER)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const SHELL_TOKENS = {
  BRAND_ORANGE,
  BRAND_ORANGE_BUTTON,
  BRAND_INK,
  BRAND_MUTED,
  BRAND_BG_SOFT,
  BRAND_BORDER,
} as const;
