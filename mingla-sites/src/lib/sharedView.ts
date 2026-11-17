import { sharedViewPublicationId } from "./previewPublication";
import { isV2Artifact, type SiteArtifact } from "./siteArtifact";

/*
 * #4453 M8 (spec v2 §7, v2.1 N10) — what a private share link shows.
 *
 * The link opens the SAME renderer as the team's preview, with three
 * differences decided here, on the server, before anything renders:
 *   1. The artifact is re-labelled `preview-shared-…` so the Draft-only hints
 *      (an empty offering grid's "new trips will appear here", drawn only for
 *      the team) are never drawn for a client.
 *   2. A page that is not enabled (a Draft nobody has published or reviewed)
 *      is removed, and every menu entry or footer link that points at it.
 *   3. Nothing about the owner's editor (Draft chips) exists in an artifact,
 *      so none can leak.
 * A new object; the stored preview artifact is never changed.
 */
export function withSharedView<T extends SiteArtifact>(artifact: T): T {
  const relabelled = { ...artifact, publication_id: sharedViewPublicationId(artifact.publication_id) } as T;
  if (!isV2Artifact(relabelled)) return relabelled;
  const hidden = new Set(relabelled.pages.filter((page) => !page.enabled).map((page) => page.path));
  if (hidden.size === 0) return relabelled;
  const reachable = (href: string): boolean => !hidden.has(href.replace(/^\/+|\/+$/g, "").split(/[?#]/)[0] ?? "");
  const pages = relabelled.pages.filter((page) => page.enabled);
  const items = relabelled.navigation.items
    .filter((item) => reachable(item.href))
    .map((item) => (item.children ? { ...item, children: item.children.filter((child) => reachable(child.href)) } : item));
  const columns = relabelled.footer.columns?.map((column) => ({
    ...column,
    links: column.links.filter((link) => reachable(link.href)),
  }));
  return {
    ...relabelled,
    pages,
    navigation: { ...relabelled.navigation, items },
    footer: columns ? { ...relabelled.footer, columns } : relabelled.footer,
  } as T;
}
