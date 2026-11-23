/**
 * #4579 — the one "Mingla Team" entry on a brand's Team & permissions screen.
 * The server never sends Mingla admins' rows, names, emails or a head count:
 * only whether Mingla Team is on, off (removed by the brand) or not there, and
 * what the caller may do about it.
 */
import { supabase } from "./supabase";
import { BrandInvitationServiceError } from "./brandInvitationShared";

export type MinglaTeamStatus = "active" | "removed" | "none";

export interface MinglaTeamState {
  status: MinglaTeamStatus;
  since: string | null;
  canRemove: boolean;
  canRestore: boolean;
}

/** Same root as brandTeamMemberKeys, so a team-wide invalidation refreshes it. */
export const minglaTeamKeys = {
  state: (brandId: string): readonly ["brand-team-members", "mingla-team", string] =>
    ["brand-team-members", "mingla-team", brandId] as const,
};

export function parseMinglaTeamState(data: unknown): MinglaTeamState {
  const r = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const status: MinglaTeamStatus =
    r.status === "active" || r.status === "removed" ? r.status : "none";
  return {
    status,
    since: typeof r.since === "string" ? r.since : null,
    canRemove: status === "active" && r.can_remove === true,
    canRestore: status === "removed" && r.can_restore === true,
  };
}

function serviceError(error: { code?: string | null; message?: string | null }, fallback: string): BrandInvitationServiceError {
  const message = error.message ?? "";
  if (message.includes("forbidden") || error.code === "42501") {
    return new BrandInvitationServiceError("forbidden", 403, fallback);
  }
  if (message.includes("unauthenticated")) {
    return new BrandInvitationServiceError("unauthenticated", 401, fallback);
  }
  return new BrandInvitationServiceError("server", 500, fallback);
}

export async function getMinglaTeamState(brandId: string): Promise<MinglaTeamState> {
  const { data, error } = await supabase.rpc("issue_4579_mingla_team_state", { p_brand_id: brandId });
  if (error) throw serviceError(error, "Couldn't load Mingla Team.");
  return parseMinglaTeamState(data);
}

/** Brand admin and up. Removes every Mingla admin added automatically, and keeps them off. */
export async function removeMinglaTeam(brandId: string): Promise<void> {
  const { error } = await supabase.rpc("issue_4579_remove_mingla_team", { p_brand_id: brandId });
  if (error) throw serviceError(error, "Couldn't remove Mingla Team. Try again.");
}

/** The brand owner only. */
export async function restoreMinglaTeam(brandId: string): Promise<void> {
  const { error } = await supabase.rpc("issue_4579_restore_mingla_team", { p_brand_id: brandId });
  if (error) throw serviceError(error, "Couldn't add Mingla Team back. Try again.");
}
