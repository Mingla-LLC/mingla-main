/**
 * issue #4271 — the brand team screen's names and emails. Only the team route
 * reads it, so it lives apart from brandInvitationsService (which several
 * routes load) and stays out of the eager web __common chunk.
 */
import { supabase } from "./supabase";
import {
  parseBrandTeamDirectory,
  type BrandTeamDirectoryEntry,
} from "../utils/brandTeamMemberIdentity";
import { BrandInvitationServiceError } from "./brandInvitationShared";

/**
 * issue #4271 — accepted members' display names and emails, from wherever the
 * server keeps them (SECURITY DEFINER rpc; any accepted member may call it).
 */
export async function listBrandTeamMemberDirectory(
  brandId: string,
): Promise<BrandTeamDirectoryEntry[]> {
  const { data, error } = await supabase.rpc("biz_brand_team_members", {
    p_brand_id: brandId,
  });
  if (error) {
    // The rpc refuses non-members with 42501 brand_access_denied.
    const forbidden =
      error.code === "42501" ||
      (error.message?.includes("brand_access_denied") ?? false) ||
      (error.message?.includes("forbidden") ?? false);
    throw new BrandInvitationServiceError(
      forbidden ? "forbidden" : "server",
      forbidden ? 403 : 500,
      "Couldn't load team names.",
    );
  }
  return parseBrandTeamDirectory(data);
}
