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
}

export function renderShell(input: ShellInput): string {
  const support = escapeHtml(input.supportEmail);
  const address = escapeHtml(input.footerAddress);
  const preheader = escapeHtml(input.preheader);
  const logo = escapeHtml(input.logoUrl);
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
            <tr>
              <td align="center" style="padding:28px 28px 24px 28px;border-bottom:1px solid ${BRAND_BORDER};">
                <img src="${logo}" alt="Mingla" width="180" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;max-width:180px;" />
              </td>
            </tr>
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
