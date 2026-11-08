/**
 * #4339 §5 — the Ari tab's half of the usemingla.com website prompt hand-off.
 *
 * The marketing page stores the visitor's description server-side and sends
 * them to `/auth?next=/ari?draft=<id>`. Only the opaque id is ever in a URL.
 * Pure helpers: no React, no network.
 */

const DRAFT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `draft` route param as a lowercase uuid, or null for anything else. */
export function parseSitePromptDraftId(
  raw: string | string[] | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return DRAFT_ID_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * The host's first Ari message. Their own description, framed as the request
 * they made on usemingla.com (tapping Generate on "Prompt your website into
 * existence"), so Ari starts the website build rather than guessing intent.
 */
export function sitePromptFirstMessage(description: string): string {
  return `Build my website from this description:\n\n${description.trim()}`;
}
