/**
 * returnUrls — ORCH-1295 [chip-in-post-payment-polish].
 *
 * Pure builder for the buyer-WEB hosted-Checkout return URLs of a voluntary RSVP
 * chip-in. The public event route is `/e/{brandSlug}/{eventSlug}` (see
 * mingla-business/app/e/[brandSlug]/[eventSlug].tsx). The ORCH-1291 code emitted
 * `/e/{eventSlug}` — the brandSlug segment was OMITTED — so a guest who paid on
 * web landed on `/e/{eventSlug}` where the router parsed eventSlug AS brandSlug
 * (no eventSlug) → a DEAD page, stranding the guest with no confirmation.
 *
 * This builder ALWAYS includes BOTH path segments in `/e/{brand}/{event}` order,
 * and returns null when brandSlug or eventSlug is missing/blank so the caller can
 * FAIL CLOSED (surface an error) rather than emit a URL missing a path segment.
 *
 * Extracted (vs. inlined in index.ts) so it is unit-testable WITHOUT importing
 * index.ts — index.ts runs serve() at import, which a plain Deno test cannot.
 * See __tests__/orch_1295_web_return_url.test.ts (fails-on-revert guard).
 */

export interface ContributionWebReturnUrls {
  successUrl: string;
  cancelUrl: string;
}

/**
 * Build the success/cancel return URLs for the web hosted-Checkout flow.
 *
 * @param baseUrl   validated https origin (e.g. https://host.usemingla.com)
 * @param brandSlug the brand's URL slug — REQUIRED (the segment ORCH-1291 dropped)
 * @param eventSlug the event's URL slug (the caller may pass the event id as a
 *                  last-resort fallback; still non-empty)
 * @returns the two URLs, or null when either slug is missing/blank (fail closed)
 */
export function buildContributionWebReturnUrls(
  baseUrl: string,
  brandSlug: string | null | undefined,
  eventSlug: string | null | undefined,
): ContributionWebReturnUrls | null {
  const brand = typeof brandSlug === "string" ? brandSlug.trim() : "";
  const event = typeof eventSlug === "string" ? eventSlug.trim() : "";
  if (brand.length === 0 || event.length === 0) return null;
  // Slugs are `[a-z0-9-]` (all URL-unreserved) so encodeURIComponent is a no-op
  // for well-formed slugs and a safety net otherwise.
  const path = `${baseUrl}/e/${encodeURIComponent(brand)}/${encodeURIComponent(event)}`;
  return {
    successUrl: `${path}?contribution=paid`,
    cancelUrl: `${path}?contribution=cancel`,
  };
}

export function buildContributionPaystackReturnUrl(
  baseUrl: string,
  brandSlug: string | null | undefined,
  eventSlug: string | null | undefined,
  contributionId: string,
): string | null {
  const urls = buildContributionWebReturnUrls(baseUrl, brandSlug, eventSlug);
  if (urls === null || contributionId.trim().length === 0) return null;
  const url = new URL(urls.successUrl);
  url.searchParams.set("contribution", "return");
  url.searchParams.set("contrib", contributionId);
  return url.toString();
}
