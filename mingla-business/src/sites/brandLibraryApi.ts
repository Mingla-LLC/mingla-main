/**
 * #4572 item 3 (D3) — "Bring in my brand photos": copies the brand's logo,
 * cover still and event flyer stills into the website's photos through Core's
 * owner route (Core re-checks the caller's rank and signs the CMS call). Once
 * each: a second run adds nothing (matched by checksum in the CMS).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBrandSiteOperationId, invokeBrandSiteControl } from "../services/brandSitesService";
import { brandSiteKeys } from "./brandSiteKeys";

export async function importBrandSiteLibrary(brandId: string): Promise<{ imported: number; offered: number }> {
  const data = await invokeBrandSiteControl<{ imported?: unknown; offered?: unknown }>(
    `/v1/brands/${brandId}/site/library-import`,
    "POST",
    { operation_id: createBrandSiteOperationId() },
  );
  return {
    imported: typeof data?.imported === "number" ? data.imported : 0,
    offered: typeof data?.offered === "number" ? data.offered : 0,
  };
}

/** On success or failure the photo list is read again (some may have landed before a failure). */
export function useImportBrandSiteLibrary(brandId: string, siteId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => importBrandSiteLibrary(brandId),
    onSettled: () => client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "media") }),
  });
}
