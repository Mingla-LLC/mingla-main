/**
 * #4572 item 15 — one read of Core's brand_site_publishing_paused() for every
 * place that offers a site's FIRST Go live (the workspace's Publish panel and
 * the setup step "Check and publish"). A site that has published before is
 * never paused, so it is not read for one.
 */
import { useQuery } from "@tanstack/react-query";
import { getBrandSitePublishingPaused } from "../services/brandSitesService";
import { brandSiteKeys } from "./brandSiteKeys";

export function usePublishingPaused(siteId: string | null | undefined, firstPublish: boolean, enabled = true) {
  const query = useQuery({
    queryKey: brandSiteKeys.siteData(siteId ?? null, "publishing-paused"),
    queryFn: () => getBrandSitePublishingPaused(siteId as string),
    enabled: enabled && firstPublish && typeof siteId === "string",
    staleTime: 30_000,
  });
  return { paused: firstPublish && query.data === true, refetch: query.refetch };
}
