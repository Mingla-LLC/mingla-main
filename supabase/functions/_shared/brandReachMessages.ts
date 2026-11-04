// #3682 wave 2 — copy for the two brand-reach notifications that go to a
// Mingla ACCOUNT rather than a Book contact:
//   brand_offering_invite  a host invited a follower (or friend of a follower)
//                          while creating an offering
//   brand_campaign_push    a Blast campaign sent by push
// Every message names the brand and says truthfully why it arrived.

export const BRAND_OFFERING_INVITE_CATEGORY = "brand_offering_invite";
export const BRAND_CAMPAIGN_PUSH_CATEGORY = "brand_campaign_push";

export type BrandReachReason = "follower" | "extended" | "book";

interface Rendered {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

function plain(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The receive reason, in the guest's words. */
export function brandReachReasonLine(reason: unknown, brand: string): string {
  if (reason === "extended") return `A friend of yours follows ${brand}.`;
  if (reason === "book") return `You're on ${brand}'s guest list.`;
  return `You follow ${brand}.`;
}

export function isBrandReachCategory(category: string): boolean {
  return category === BRAND_OFFERING_INVITE_CATEGORY ||
    category === BRAND_CAMPAIGN_PUSH_CATEGORY;
}

function inviteLink(payload: Record<string, unknown>): string | null {
  const link = typeof payload.event_url === "string" ? payload.event_url : "";
  return /^https:\/\/[^\s<>"]+$/.test(link) ? link : null;
}

/** How the guest can stop this kind of message, true for the reason it came. */
export function brandReachManageLine(reason: unknown, brand: string): string {
  return reason === "extended"
    ? "You can switch off invites through friends in Mingla settings, under Privacy."
    : `You can mute ${brand} or switch off its emails from its page in Mingla.`;
}

/**
 * #3682 wave 3 (#1781) — the invite email's button. The reason line sits
 * right under the invite (see renderBrandReachMessage); the button opens the
 * offering, and the note under it says how to stop these.
 */
export function brandReachEmailCta(
  category: string,
  payload: Record<string, unknown>,
): { label: string; url: string; note: string } | undefined {
  if (category !== BRAND_OFFERING_INVITE_CATEGORY) return undefined;
  const url = inviteLink(payload);
  if (url === null) return undefined;
  const brand = plain(payload.brand_name, 80) || "A Mingla brand";
  return {
    label: "See the invite",
    url,
    note: brandReachManageLine(payload.reason, brand),
  };
}

export function renderBrandReachMessage(
  category: string,
  payload: Record<string, unknown>,
): Rendered {
  const brand = plain(payload.brand_name, 80) || "A Mingla brand";
  const why = brandReachReasonLine(payload.reason, brand);
  if (category === BRAND_OFFERING_INVITE_CATEGORY) {
    const title = plain(payload.event_title, 90);
    const invite = title ? `You're invited to ${title}.` : "You're invited.";
    // The reason sits directly under the invite. With a link, the button and
    // the manage note come from brandReachEmailCta; without one the manage
    // note closes the body so the guest always learns how to stop these.
    const link = inviteLink(payload);
    return {
      push: { title: brand, body: `${invite} ${why}` },
      email: {
        subject: title
          ? `${brand} invited you to ${title}`
          : `${brand} invited you`,
        body: [
          invite,
          why,
          link ? "" : brandReachManageLine(payload.reason, brand),
        ].filter(Boolean).join("\n\n"),
      },
      sms: "",
    };
  }
  const body = plain(payload.body, 120) || `New from ${brand}.`;
  return {
    push: { title: brand, body: `${body} ${why}` },
    email: { subject: brand, body: `${body}\n\n${why}` },
    sms: "",
  };
}
