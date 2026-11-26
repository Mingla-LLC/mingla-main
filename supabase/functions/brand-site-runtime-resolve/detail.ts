/*
 * #4453 milestone 9 (spec v2.1 §1.2) — one offering's detail-page extras for
 * ONE site: a trip's days and inclusions, a room's facts and photos.
 *
 * Core's `brand_site_offering_detail` finds the offering through the site's
 * own feed and binds every read to the site's brand; it answers NULL while
 * SITES_DETAIL_PAGES is off. The answer is re-validated here against the
 * shared contract before it leaves Core (fail closed: a bad answer is "no
 * extras", and the page draws from the feed row alone). Prices, counts and
 * dates never come from here: they stay on the feed row (SC-DP2).
 */
import { type OfferingDetail, parseOfferingDetail } from "../_shared/siteContracts/offeringDetail.ts";
import { OFFERING_KINDS, type OfferingKind } from "../_shared/siteContracts/offerings.ts";

export type DetailRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/;

/** The request body's kind and slug, or null when either is not one a feed row can carry. */
export function parseDetailRequest(value: Record<string, unknown>): { kind: OfferingKind; slug: string } | null {
  const kind = value.kind;
  const slug = value.slug;
  if (typeof kind !== "string" || !(OFFERING_KINDS as readonly string[]).includes(kind)) return null;
  // #4572 venue offers link to their Mingla booking routes. They intentionally
  // have no standalone Sites detail page, even though they share the feed.
  if (kind === "venue") return null;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return null;
  return { kind: kind as OfferingKind, slug };
}

/** Is SITES_DETAIL_PAGES on? Any read failure is "off" (the site keeps linking to Mingla). */
export async function detailPagesEnabled(rpc: DetailRpc): Promise<boolean> {
  try {
    const { data, error } = await rpc("brand_site_detail_pages_enabled", {});
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function answerOfferingDetail(
  rpc: DetailRpc,
  siteId: string,
  request: { kind: OfferingKind; slug: string },
): Promise<OfferingDetail | null> {
  const { data, error } = await rpc("brand_site_offering_detail", { p_site_id: siteId, p_kind: request.kind, p_slug: request.slug });
  if (error) throw new Error("DETAIL_READ_FAILED");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const id = (data as Record<string, unknown>).offering_id;
  if (typeof id !== "string") return null;
  return parseOfferingDetail(data, { id, kind: request.kind });
}
