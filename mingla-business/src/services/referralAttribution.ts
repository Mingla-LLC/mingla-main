const REFERRAL_VISITOR_COOKIE = "mingla_referral_visitor";
const REFERRAL_VISITOR_KEY = /^[0-9a-f]{64}$/;

/**
 * #3872 — browser-only referral attribution proof.
 *
 * The value is an opaque HMAC returned by `referral-touch`; it never contains
 * a user id, email, phone number or raw device token. Native and SSR callers
 * return null, which keeps their checkout bodies unchanged.
 */
export function getStoredReferralVisitorKey(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFERRAL_VISITOR_COOKIE}=`))
    ?.slice(REFERRAL_VISITOR_COOKIE.length + 1)
    .toLowerCase() ?? "";
  return REFERRAL_VISITOR_KEY.test(value) ? value : null;
}
