// #3682 Wave 2.3 — Follow CTA shared by blast email HTML and SMS body append.
// Deep-links to the public brand page with intent=follow so signed-in guests
// land on the Follow control; web follow-by-email (m/n/o) is a later slice.

import { escapeHtml } from "./email/escape.ts";

const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";

export function brandFollowPublicUrl(brandSlug: string): string {
  const slug = brandSlug.trim();
  if (slug.length === 0) {
    throw new Error("brand_follow_slug_empty");
  }
  return `${HOST_PUBLIC_ORIGIN}/b/${encodeURIComponent(slug)}?intent=follow`;
}

/** SMS trailing line — short, one URL, no HTML. */
export function appendSmsFollowLine(
  body: string,
  brandName: string,
  followUrl: string,
): string {
  const trimmed = body.replace(/\s+$/u, "");
  const name = brandName.trim().length > 0 ? brandName.trim() : "this brand";
  const line = `Follow ${name}: ${followUrl}`;
  if (trimmed.includes(followUrl)) return trimmed;
  return trimmed.length === 0 ? line : `${trimmed}\n\n${line}`;
}

/**
 * Email Follow panel injected above the unsubscribe footer.
 * Inline styles only (Gmail strips <head> CSS). Links are http(s) so the
 * existing marketingEmailRender href rewrite can track clicks.
 */
export function renderBlastFollowPanelHtml(
  brandName: string,
  followUrl: string,
): string {
  const safeName = escapeHtml(
    brandName.trim().length > 0 ? brandName.trim() : "this brand",
  );
  const safeUrl = escapeHtml(followUrl);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 0 0;" data-mingla-blast-follow="1">
  <tr>
    <td style="padding:20px 16px;border:1px solid #E8E0D6;border-radius:12px;background:#FFF9F3;text-align:center;">
      <p style="margin:0 0 8px 0;font-size:16px;line-height:1.4;color:#16110D;font-weight:700;">Follow ${safeName} on Mingla</p>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#6B635A;">Hear about new dates first. Unfollow any time.</p>
      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#16110D;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">Follow ${safeName}</a>
    </td>
  </tr>
</table>`;
}
