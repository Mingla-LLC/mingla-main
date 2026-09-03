import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { loadPublication, normalizePublicHost } from "../lib/publication";
import { hrefForPage, navigablePages } from "../lib/pageRouting";

export const dynamic = "force-dynamic";

/**
 * #2830 — list the pages that actually exist.
 *
 * This returned a single hardcoded URL, which was truthful only while the site
 * WAS one page. Now that About, Menu, Gallery and Contact are real routes, a
 * sitemap naming just the homepage would hide the whole site from search.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const incoming = await headers();
    const host = normalizePublicHost(
      incoming.get("x-forwarded-host") || incoming.get("host"),
    );
    const { artifact } = await loadPublication(host);
    const origin = `https://${host}`;
    return navigablePages(artifact).map((page) => ({
      url: new URL(hrefForPage(page), origin).toString(),
      changeFrequency: "weekly" as const,
      priority: page.role === "home" ? 1 : 0.7,
    }));
  } catch {
    // Never invent URLs: an unresolvable host gets an empty sitemap, not a
    // guessed one.
    return [];
  }
}
