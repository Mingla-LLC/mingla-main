/**
 * #3682 Wave 2.4 / design contract surface d — follow status block in order emails.
 */
import { escapeHtml } from "./escape.ts";
import { SHELL_TOKENS } from "./shell.ts";

const { BRAND_INK, BRAND_MUTED, BRAND_BORDER } = SHELL_TOKENS;
/** Contract d — unfollow link on white (≥4.5:1). */
const UNFOLLOW_LINK = "#6b1420";

export type TicketFollowReason = "purchase" | "rsvp" | "booking";

export type TicketFollowBlockInput = {
  brandName: string;
  /** When set, render "You're following" + Unfollow. */
  unfollowUrl: string | null;
  /** When unfollow is absent, render offer with Follow URL (brand page or token). */
  followUrl: string | null;
  reason?: TicketFollowReason;
};

function reasonDetail(reason: TicketFollowReason | undefined, brand: string): string {
  if (reason === "rsvp") {
    return `You're following ${brand} because you RSVP'd.`;
  }
  if (reason === "booking") {
    return `You're following ${brand} because you booked a table.`;
  }
  return "New dates and offers from them.";
}

export function renderTicketFollowBlockHtml(
  input: TicketFollowBlockInput,
): string {
  const brand = input.brandName.trim().length > 0
    ? input.brandName.trim()
    : "this brand";
  const unfollow = (input.unfollowUrl ?? "").trim();
  const follow = (input.followUrl ?? "").trim();

  if (unfollow.length > 0) {
    const detail = reasonDetail(input.reason, brand);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;border:1px solid #e6e1dc;border-radius:12px;">
  <tr>
    <td style="padding:14px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:14px;line-height:20px;color:${BRAND_INK};font-weight:700;">You're following ${escapeHtml(brand)}</td>
          <td align="right" style="font-size:14px;line-height:20px;font-weight:700;white-space:nowrap;padding-left:12px;">
            <a href="${escapeHtml(unfollow)}" style="color:${UNFOLLOW_LINK};text-decoration:underline;">Unfollow</a>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding-top:4px;font-size:14px;line-height:20px;color:#3f434a;">${escapeHtml(detail)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
  }

  if (follow.length > 0) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;border:1px solid ${BRAND_BORDER};border-radius:12px;">
  <tr>
    <td style="padding:14px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:14px;line-height:20px;color:${BRAND_INK};font-weight:700;">Want new dates from ${escapeHtml(brand)}?</td>
          <td align="right" style="font-size:14px;line-height:20px;font-weight:700;white-space:nowrap;padding-left:12px;">
            <a href="${escapeHtml(follow)}" style="color:${UNFOLLOW_LINK};text-decoration:underline;">Follow</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
  }

  return "";
}

export function ticketFollowTextLines(
  input: TicketFollowBlockInput,
): string[] {
  const brand = input.brandName.trim().length > 0
    ? input.brandName.trim()
    : "this brand";
  const unfollow = (input.unfollowUrl ?? "").trim();
  const follow = (input.followUrl ?? "").trim();
  if (unfollow.length > 0) {
    return [`You're following ${brand}. Unfollow: ${unfollow}`];
  }
  if (follow.length > 0) {
    return [`Want new dates from ${brand}? Follow: ${follow}`];
  }
  return [];
}

export function ticketFollowFooterHtml(input: {
  brandName: string;
  unfollowUrl: string | null;
  preferencesUrl?: string | null;
  reason?: TicketFollowReason;
}): string {
  const brand = input.brandName.trim().length > 0
    ? input.brandName.trim()
    : "this brand";
  const why = input.reason === "rsvp"
    ? `You got this because you RSVP'd with ${escapeHtml(brand)} on Mingla.`
    : input.reason === "booking"
    ? `You got this because you booked with ${escapeHtml(brand)} on Mingla.`
    : `You got this because you bought tickets from ${escapeHtml(brand)} on Mingla.`;
  const unfollow = (input.unfollowUrl ?? "").trim();
  const prefs = (input.preferencesUrl ?? "").trim();
  const followBits: string[] = [];
  if (unfollow.length > 0) {
    followBits.push(
      `You follow ${escapeHtml(brand)}: <a href="${escapeHtml(unfollow)}" style="color:${UNFOLLOW_LINK};text-decoration:underline;">unfollow</a>`,
    );
  }
  if (prefs.length > 0) {
    followBits.push(
      `<a href="${escapeHtml(prefs)}" style="color:${BRAND_MUTED};text-decoration:underline;">email preferences</a>`,
    );
  }
  const trail = followBits.length > 0 ? ` ${followBits.join(" · ")}.` : "";
  return `${why}${trail}`;
}
