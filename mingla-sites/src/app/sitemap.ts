import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { canonicalOrigin, loadPublication, requestHost } from "../lib/publication";
import { hrefForPage, isIndexable, navigablePages } from "../lib/pageRouting";
import { hrefForPath } from "../contracts/generated/routes.ts";
import { collectionEntryPaths } from "../lib/siteCollections";
import { isV2Artifact } from "../lib/siteArtifact";
import { hiddenWhileEmpty } from "../lib/plannedPageIndexing";

export const dynamic = "force-dynamic";

/**
 * #2830 — list the pages that actually exist.
 *
 * This returned a single hardcoded URL, which was truthful only while the site
 * WAS one page. #2829 W2 — every published page at any depth, on the primary
 * address; a page marked "hide from search" is left out. (Destination and
 * story pages join from W5.)
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const incoming = await headers();
    const { artifact, resolution } = await loadPublication(requestHost(incoming));
    // #2829 — URLs are listed on the site's primary address only.
    const origin = canonicalOrigin(resolution);
    // #2829 W9a (SC-29) — empty planned offering pages join once they have content.
    const indexable = navigablePages(artifact).filter(isIndexable);
    const hidden = await Promise.all(indexable.map((page) => hiddenWhileEmpty(resolution, artifact, page).catch(() => true)));
    const pages = indexable.filter((_, index) => !hidden[index]).map((page) => ({
      url: new URL(hrefForPage(page), origin).toString(),
      changeFrequency: "weekly" as const,
      priority: page.isHome ? 1 : 0.7,
    }));
    // #2829 W5 — every destination and story page (unless hidden from search).
    const entries = isV2Artifact(artifact)
      ? collectionEntryPaths(artifact).map((path) => ({
        url: new URL(hrefForPath(path), origin).toString(),
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }))
      : [];
    return [...pages, ...entries];
  } catch {
    // Never invent URLs: an unresolvable host gets an empty sitemap, not a
    // guessed one.
    return [];
  }
}
