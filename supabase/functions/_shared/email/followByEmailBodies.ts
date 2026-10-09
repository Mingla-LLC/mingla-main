/**
 * #3682 Wave 2.5 — n1 confirm / n2 confirmed / n4 invite email bodies.
 * All HTML goes through renderShell (ORCH-0785 singleton).
 */
import { escapeHtml } from "./escape.ts";
import { renderShell, SHELL_TOKENS } from "./shell.ts";

const { BRAND_INK, BRAND_MUTED, BRAND_ORANGE_BUTTON } = SHELL_TOKENS;

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
  <tr>
    <td align="center" bgcolor="${BRAND_ORANGE_BUTTON}" style="border-radius:999px;border:1px solid #ffffff;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

export type FollowByEmailRender = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

const SUPPORT = "support@usemingla.com";
const ADDRESS = "700 Corporate Center Dr, Raleigh, NC 27607, USA";
const LOGO =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/brand-assets/mingla-wordmark.png";

function shell(preheader: string, bodyHtml: string): string {
  return renderShell({
    preheader,
    bodyHtml,
    supportEmail: SUPPORT,
    logoUrl: LOGO,
    footerAddress: ADDRESS,
  });
}

export function renderFollowConfirmEmail(input: {
  brandName: string;
  confirmUrl: string;
}): FollowByEmailRender {
  const brand = input.brandName.trim() || "this brand";
  const subject = `Confirm you want to follow ${brand}`;
  const preheader =
    "One tap and you're following. The link works for 24 hours.";
  const bodyHtml = `
<p style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:${BRAND_INK};">Confirm you want to follow ${escapeHtml(brand)}</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${BRAND_MUTED};">Tap below to get ${escapeHtml(brand)}'s new dates and offers on Mingla.</p>
${ctaButton(input.confirmUrl, `Yes, follow ${brand}`)}
<p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:${BRAND_MUTED};">Didn't ask for this? Ignore this email and nothing changes. The link works for 24 hours.</p>
<p style="margin:12px 0 0 0;font-size:12px;line-height:18px;color:${BRAND_MUTED};">Sent by Mingla for ${escapeHtml(brand)}</p>`;
  const text = [
    `Confirm you want to follow ${brand}`,
    "",
    `Tap this link to get ${brand}'s new dates and offers on Mingla:`,
    input.confirmUrl,
    "",
    "Didn't ask for this? Ignore this email and nothing changes. The link works for 24 hours.",
  ].join("\n");
  return { subject, preheader, html: shell(preheader, bodyHtml), text };
}

export function renderFollowConfirmedEmail(input: {
  brandName: string;
  brandUrl: string;
}): FollowByEmailRender {
  const brand = input.brandName.trim() || "this brand";
  const subject = `You now follow ${brand}`;
  const preheader = "You'll hear about new dates first.";
  const bodyHtml = `
<p style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:${BRAND_INK};">You now follow ${escapeHtml(brand)}</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${BRAND_MUTED};">You'll hear about new dates and offers first, by email and in the Mingla app.</p>
${ctaButton(input.brandUrl, "See their page")}`;
  const text = [
    `You now follow ${brand}`,
    "",
    "You'll hear about new dates and offers first, by email and in the Mingla app.",
    input.brandUrl,
  ].join("\n");
  return { subject, preheader, html: shell(preheader, bodyHtml), text };
}

export function renderFollowInviteEmail(input: {
  brandName: string;
  oneLinkUrl: string;
}): FollowByEmailRender {
  const brand = input.brandName.trim() || "this brand";
  const subject = `${brand} invited you to Mingla`;
  const preheader =
    "Get the app to finish following. The link works for 72 hours.";
  const bodyHtml = `
<p style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:${BRAND_INK};">${escapeHtml(brand)} invited you to Mingla</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${BRAND_MUTED};">Get the app to finish following ${escapeHtml(brand)}. You'll hear about new dates first and see who's going.</p>
${ctaButton(input.oneLinkUrl, "Get the app")}
<p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:${BRAND_MUTED};">Already have Mingla? The button opens it. You can also sign in with this email and follow from ${escapeHtml(brand)}'s page.</p>
<p style="margin:12px 0 0 0;font-size:13px;line-height:20px;color:${BRAND_MUTED};">Didn't ask for this? Ignore this email. We won't email you again unless you ask.</p>`;
  const text = [
    `${brand} invited you to Mingla`,
    "",
    `Get the app to finish following ${brand}:`,
    input.oneLinkUrl,
    "",
    "Didn't ask for this? Ignore this email.",
  ].join("\n");
  return { subject, preheader, html: shell(preheader, bodyHtml), text };
}
