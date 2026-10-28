import { supabase } from "../services/supabase";

type EntrySite = {
  status?: string;
  owner_offline_at?: string | null;
  brand_site_hosts?: {
    hostname?: string;
    status?: string;
    is_primary?: boolean;
  }[];
};

// #2829 — `available` is now per-brand: a Mingla admin granted Sites to this
// brand (entitlement) and the member is rank 20+. The extra can_* flags are
// read by the workspace, not by this one-line entry.
type EntryAvailability = {
  available: boolean;
  can_publish?: boolean;
  site?: EntrySite | null;
};

type EntryEnvelope =
  | { ok: true; data: EntryAvailability }
  | { ok: false; error?: { code?: string } };

function entryContext(site: EntrySite): string {
  if (site.status === "provisioning") return "Setting up…";
  // #2829 — the owner/admin took it offline; say so before anything "live".
  if (site.owner_offline_at) return "Offline";
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
