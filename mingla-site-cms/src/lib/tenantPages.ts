import type { PayloadRequest, Where } from "payload";
import { MAX_PAGES_PER_SITE } from "../contracts/generated/limits.ts";

/*
 * #2829 — THE ONE WAY TO READ A TENANT'S PAGES.
 *
 * Every page read used to carry `limit: 5` while Studio allowed six pages, so
 * the sixth page was silently missing from publish, preview, Ari's reads and
 * — worst — the media reference scan, which then told retention that a photo
 * used only on that page was unused. A capped read never errors; it just
 * returns fewer rows than exist.
 *
 * This reads EVERY page of the tenant (`pagination: false`) and refuses, with
 * a named reason, a tenant holding more pages than a site may have. It never
 * truncates. A strict gate (tenantPages.issue2829.test.ts) fails the build if
 * any `collection: "pages"` read in this app carries a numeric limit again.
 */
export class PageLimitExceededError extends Error {
  constructor() {
    super("PAGE_LIMIT_EXCEEDED");
  }
}

export type TenantPagesOptions = {
  /** Read drafts (Studio's working copy). Defaults to true. */
  draft?: boolean;
  overrideAccess?: boolean;
  /** Extra conditions ANDed with the tenant condition. */
  where?: Where;
  sort?: string;
};

export async function findAllTenantPages(
  req: PayloadRequest,
  tenantId: string | number,
  options: TenantPagesOptions = {},
) {
  const tenantWhere: Where = { tenant: { equals: tenantId } };
  const result = await req.payload.find({
    collection: "pages",
    req,
    overrideAccess: options.overrideAccess ?? false,
    draft: options.draft ?? true,
    depth: 0,
    pagination: false,
    sort: options.sort ?? "createdAt",
    where: options.where ? { and: [tenantWhere, options.where] } : tenantWhere,
  });
  if (result.docs.length > MAX_PAGES_PER_SITE) throw new PageLimitExceededError();
  return result.docs;
}
