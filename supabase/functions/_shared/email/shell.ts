// ORCH-0785 — Mingla transactional email shell renderer.
// I-PROPOSED-AD EMAIL_BRAND_SHELL_SINGLETON: every customer-facing email
// rendered server-side flows through this shell. No other file under
// supabase/functions/ may build its own <!doctype html> string.

import { escapeHtml } from "./escape.ts";
import { FOOTER_DISCLAIMER } from "./copy.ts";

const BRAND_ORANGE = "#FF6B2C";
const BRAND_INK = "#0F1115";
const BRAND_MUTED = "#5B6172";
const BRAND_BG_SOFT = "#FFF6F1";
const BRAND_BORDER = "#ECECEE";

export interface ShellInput {
  preheader: string;
  bodyHtml: string;
  supportEmail: string;
  logoUrl: string;
  footerAddress: string;
  /**
   * Optional: when set, replaces the centered Mingla logo at the top of
   * the email with a full-width header banner — used by marketing email
   * to brand the email with the sending brand's cover image. Image URL
   * must be a still image (PNG/JPG/WEBP); callers must apply the same
   * video-skip rule socialPreview.js uses (cover_media_type !== 'video').
   * When null/undefined, the standard Mingla-logo header renders.
   */
  brandHeaderImageUrl?: string | null;
}

export function renderShell(input: ShellInput): string {
  const support = escapeHtml(input.supportEmail);
  const address = escapeHtml(input.footerAddress);
  const preheader = escapeHtml(input.preheader);
  const logo = escapeHtml(input.logoUrl);
  // When the caller passes a brand header image, render it as a full-width
  // banner (no inner padding) so the brand's cover fills the email header.
  // Otherwise render the standard centered Mingla logo with the usual
  // 28px chrome padding.
  // escapeHtml(...) is inlined at the call site (not pre-computed into a
  // `brandHeader` variable) so the ORCH-0785-C buyer-string-escape gate
  // sees it as already-escaped. The gate's regex flags any identifier
  // starting with `brand|order|event|...` interpolated in HTML context
  // unless the call-site form is `escapeHtml(...)` directly.
  const hasBrandBanner = input.brandHeaderImageUrl !== null &&
    input.brandHeaderImageUrl !== undefined &&
    input.brandHeaderImageUrl.length > 0;
  const headerRow = hasBrandBanner
    ? `<tr>
              <td style="padding:0;background:#FFFFFF;">
                <img src="${escapeHtml(input.brandHeaderImageUrl ?? "")}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;max-height:240px;object-fit:cover;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>`
    : `<tr>
              <td align="center" style="padding:28px 28px 24px 28px;border-bottom:1px solid ${BRAND_BORDER};">
                <img src="${logo}" alt="Mingla" width="180" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;max-width:180px;" />
              </td>
            </tr>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Mingla</title>
  </head>
  <body style="margin:0;padding:0;background:#F5F5F7;color:${BRAND_INK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;color:transparent;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${BRAND_BORDER};border-radius:16px;overflow:hidden;">
            ${headerRow}
            <tr>
              <td style="padding:28px;">
                ${input.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;border-top:1px solid ${BRAND_BORDER};background:${BRAND_BG_SOFT};font-size:13px;line-height:1.5;color:${BRAND_MUTED};">
                <img src="${logo}" alt="Mingla" width="100" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100px;margin:0 0 10px 0;" />
                <p style="margin:0 0 8px 0;">Need help? <a href="mailto:${support}" style="color:${BRAND_ORANGE};text-decoration:none;">${support}</a></p>
                <p style="margin:0 0 8px 0;">${address}</p>
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
  BRAND_INK,
  BRAND_MUTED,
  BRAND_BG_SOFT,
  BRAND_BORDER,
} as const;
