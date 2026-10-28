import { isPlannedOfferingPage, plannedPageIsEmpty } from "../contracts/generated/plannedPages.ts";
import type { SiteBinding } from "./coreGateway";
import { siteOfferings } from "./offeringsFeed";
import type { ArtifactPage } from "./pageRouting";
import { isV2Artifact, type SiteArtifact } from "./siteArtifact";

/**
 * #2829 W9a (SC-29) — an empty planned offering page (Trips, Events,
 * Experiences with nothing on it yet) is `noindex` and left out of the
 * sitemap; the moment Mingla's feed has an offering for it, it is listed
 * again, with no republish. Reads the same 60-second feed cache the page's
 * grids draw from (snapshot when Core is unreachable), for the site Core
 * resolved for this host.
 */
export async function hiddenWhileEmpty(
  site: SiteBinding,
  artifact: SiteArtifact,
  page: ArtifactPage,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isV2Artifact(artifact)) return false;
  const shaped = { kind: page.kind, collection: page.collection, blocks: page.blocks as unknown as Array<{ type: string }> };
  if (!isPlannedOfferingPage(shaped)) return false;
  const view = await siteOfferings(site, artifact);
  return plannedPageIsEmpty(shaped, view.offerings, now);
}
