import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { canonicalOrigin, loadPublication, requestHost } from "../lib/publication";

export const dynamic = "force-dynamic";

/**
 * #2829 W10 — robots.txt per host. A host that serves a live site names the
 * sitemap on the site's main address (every other address of the site sends
 * visitors there). An address Mingla doesn't serve a site on asks crawlers to
 * stay away and names no sitemap. Previews are private and carry their own
 * noindex, so they are not listed here (a crawler must read that noindex).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  try {
    const { resolution } = await loadPublication(requestHost(await headers()));
    const origin = canonicalOrigin(resolution);
    return { rules: { userAgent: "*", allow: "/" }, sitemap: `${origin}/sitemap.xml` };
  } catch {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
}
