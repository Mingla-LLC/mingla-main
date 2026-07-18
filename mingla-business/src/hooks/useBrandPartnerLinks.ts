/**
 * useBrandPartnerLinks — ORCH-1384 owner-side read of a brand's partner links,
 * used ONLY by the Team screen (matches member rows' user_id against accepted,
 * non-cancelled links' partner_account_id to badge + gate the owner-initiated
 * disconnect). Served by the partner_brand_links_owner_select RLS policy.
 *
 * WHY ITS OWN MODULE (ORCH-1384 web eager-bundle budget fix): this read + its
 * hook are Team-only. Leaving them in the shared partnerBrandLinksService /
 * usePartnerBrandLinks (both pulled into the eager web boot `__common` chunk by
 * the always-loaded partner self-read + account tab) kept their bulk in
 * `__common`. Isolating them here — imported only by the lazy Team route —
 * lands them in the Team chunk instead. LINK_SELECT / deriveLinkStatus /
 * partnerBrandLinksKeys stay in the service (shared) and are imported from there.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  LINK_SELECT,
  deriveLinkStatus,
  partnerBrandLinksKeys,
  type PartnerBrandLinkRow,
  type PartnerBrandLinkWithStatus,
} from "../services/partnerBrandLinksService";
import { supabase } from "../services/supabase";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["partner-brand-links-disabled"] as const;

/**
 * Owner-side read of a brand's partner links (served by the new
 * partner_brand_links_owner_select RLS policy). No cancelled filter — callers
 * decide.
 */
export async function listBrandPartnerLinks(
  brandId: string,
): Promise<PartnerBrandLinkWithStatus[]> {
  const { data, error } = await supabase
    .from("partner_brand_links")
    .select(LINK_SELECT)
    .eq("brand_id", brandId)
    .order("invited_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PartnerBrandLinkRow[];
  return rows.map((row) => ({ ...row, status: deriveLinkStatus(row) }));
}

/**
 * ORCH-1384 — owner-side read of a brand's partner links. The Team screen
 * matches member rows' user_id against accepted, non-cancelled links'
 * partner_account_id to badge + gate the owner-initiated disconnect.
 */
export function useBrandPartnerLinks(
  brandId: string | null,
): UseQueryResult<PartnerBrandLinkWithStatus[], Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;
  return useQuery<PartnerBrandLinkWithStatus[], Error>({
    queryKey: enabled
      ? partnerBrandLinksKeys.brand(brandId as string)
      : DISABLED_KEY,
    queryFn: () => listBrandPartnerLinks(brandId as string),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
