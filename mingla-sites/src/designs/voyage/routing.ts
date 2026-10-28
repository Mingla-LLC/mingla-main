import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import type { CollectionKind } from "../../contracts/generated/routes.ts";
import { hrefForPage, sitePages, type ArtifactPage } from "../../lib/pageRouting";

/*
 * #2829 W7 — where a collection's index page lives on this site (the trips
 * page, the destinations page, the stories page), or null when the owner has
 * none. Voyage links breadcrumbs, the hero search and the 404's way on to it;
 * with no such page, those simply are not drawn.
 */
export function collectionIndexPage(artifact: ArtifactV2, kind: CollectionKind): ArtifactPage | null {
  return sitePages(artifact).find((page) => page.enabled && page.kind === "collection_index" && page.collection === kind) ?? null;
}

export function collectionIndexPath(artifact: ArtifactV2, kind: CollectionKind): string | null {
  const page = collectionIndexPage(artifact, kind);
  return page ? hrefForPage(page) : null;
}
