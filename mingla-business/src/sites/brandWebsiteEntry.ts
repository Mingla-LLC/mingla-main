import { supabase } from "../services/supabase";

type EntrySite = {
  status?: string;
  brand_site_hosts?: {
    hostname?: string;
    status?: string;
    is_primary?: boolean;
  }[];
};

type EntryAvailability = {
  available: boolean;
  site?: EntrySite | null;
};

type EntryEnvelope =
  | { ok: true; data: EntryAvailability }
  | { ok: false; error?: { code?: string } };

function entryContext(site: EntrySite): string {
  if (site.status === "provisioning") return "Setting up…";
  if (site.status === "draft") return "Draft ready";
  if (site.status === "publishing") return "Publishing…";
  if (site.status === "error") return "Publish needs attention";
  const host = site.brand_site_hosts?.find(
    (candidate) => candidate.is_primary && candidate.status === "active",
  );
  return host?.hostname ? `Live at ${host.hostname}` : "Live verification pending";
}

/**
 * Lazy, low-signal Brand Profile projection. This intentionally owns only the
 * one-line entry summary so the full Website workspace service and state owner
 * remain outside the eager Business bundle.
 */
export async function loadBrandWebsiteEntryContext(
  brandId: string,
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<EntryEnvelope>(
    "brand-site-control",
    {
      body: {
        route: `/v1/brands/${brandId}/site-availability`,
        method: "GET",
      },
    },
  );
  if (error) throw new Error("WEBSITE_STATUS_UNAVAILABLE");
  if (!data || data.ok !== true) {
    throw new Error("WEBSITE_STATUS_UNAVAILABLE");
  }
  if (data.data.available !== true) return null;
  if (!data.data.site) return "Not set up";
  return entryContext(data.data.site);
}
