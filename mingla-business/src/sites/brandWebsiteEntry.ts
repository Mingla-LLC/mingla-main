import { supabase } from "../services/supabase";

type EntrySite = {
  status?: string;
  brand_site_hosts?: {
    hostname?: string;
    status?: string;
    is_primary?: boolean;
  }[];
};

type EntryEnvelope =
  | { ok: true; data: EntrySite }
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
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<EntryEnvelope>(
    "brand-site-control",
    { body: { route: `/v1/brands/${brandId}/site`, method: "GET" } },
  );
  if (error) throw new Error("WEBSITE_STATUS_UNAVAILABLE");
  if (!data || data.ok !== true) {
    if (data?.error?.code === "NOT_FOUND") return "Not set up";
    throw new Error("WEBSITE_STATUS_UNAVAILABLE");
  }
  return entryContext(data.data);
}
