// Issue #4114 Wave 2b — the link and the words in every Mingla invite text.
//
// Every invite text used to link to `https://mingla.app`, which has no DNS
// records, so the link opened nothing. The working consumer smart link is the
// Explorer AppsFlyer OneLink on the branded domain go.usemingla.com, template
// `w36m` (the same base `claim-link`, `shared-card` and the web follow invite
// already use; MARKETING.md § Smart links). AppsFlyer sends the person to the
// right store and keeps the payload through the install, and the app reads it
// on first open (oneLinkResolver.ts).
//
// One domain, one template: never biz.usemingla.com (the Business app), never
// a raw *.onelink.me domain, never mingla.app.

/** The Explorer OneLink: branded domain + template id. */
export const EXPLORER_ONELINK_BASE = "https://go.usemingla.com/w36m";

/**
 * The friend invite text. ONE constant so Seth can approve the final wording in
 * one place. `{name}` is the inviter's display name, `{link}` the OneLink. The
 * SMS adapter appends the opt-out footer itself.
 */
export const FRIEND_INVITE_SMS_TEMPLATE =
  "{name} added you as a friend on Mingla. Join to see each other's plans: {link}";

const TOKEN_RE = /^[0-9a-f]{32,64}$/;
const REFERRAL_CODE_RE = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;

function cleanReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return REFERRAL_CODE_RE.test(trimmed) ? trimmed : null;
}

/**
 * The friend invite OneLink: `deep_link_value=friend_invite`,
 * `deep_link_sub1=<invite token>`, `af_sub1=<inviter referral code>` when the
 * inviter has one. Without a valid token it degrades to a plain install link
 * (never a half-formed friend_invite payload).
 */
export function buildFriendInviteOneLink(input: {
  token?: string | null;
  referralCode?: string | null;
  campaign?: string;
}): string {
  const params = new URLSearchParams({ pid: "friend_invite", c: input.campaign ?? "friend_invite_sms" });
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (TOKEN_RE.test(token)) {
    params.set("deep_link_value", "friend_invite");
    params.set("deep_link_sub1", token);
  }
  const referralCode = cleanReferralCode(input.referralCode);
  if (referralCode) params.set("af_sub1", referralCode);
  return `${EXPLORER_ONELINK_BASE}?${params.toString()}`;
}

/**
 * The group-session invite OneLink (send-phone-invite). Those invites have no
 * token; the link installs the app and carries the inviter's referral code as
 * a `referral` payload, which the app already persists across the install.
 */
export function buildSessionInviteOneLink(input: { referralCode?: string | null }): string {
  const params = new URLSearchParams({ pid: "session_invite", c: "session_invite_sms" });
  const referralCode = cleanReferralCode(input.referralCode);
  if (referralCode) {
    params.set("deep_link_value", "referral");
    params.set("deep_link_sub1", referralCode);
    params.set("af_sub1", referralCode);
  }
  return `${EXPLORER_ONELINK_BASE}?${params.toString()}`;
}

/** The friend invite SMS body, from the one approved template. */
export function buildFriendInviteSms(senderName: string, link: string): string {
  const name = senderName.trim() || "A friend";
  return FRIEND_INVITE_SMS_TEMPLATE.replace("{name}", name).replace("{link}", link);
}
