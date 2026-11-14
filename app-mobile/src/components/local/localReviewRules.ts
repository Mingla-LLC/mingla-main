/**
 * #4430 L-1 — the Local review link rule, mirrored from the server.
 *
 * `local_review_submit` refuses any link that is not a public post on one of
 * the supported social hosts (`social_post_url_not_allowed`). The screen used
 * to accept any `https://` link and then showed "Something went wrong" when
 * the server refused it. This is the same pattern the server uses, so the
 * Send button only enables for a link the server will take.
 *
 * Pure on purpose (no imports) so the unit suite runs it under node directly.
 */
export const SOCIAL_POST_URL_PATTERN =
  /^https:\/\/((www|m|vm)\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|threads\.net)\/[^\s]+$/i;

/** True when the server will accept this link (after trimming, as the service does). */
export function isAllowedSocialPostUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  return SOCIAL_POST_URL_PATTERN.test(url.trim());
}
