/**
 * Venue-scoped Team operations for issue #4188.
 *
 * This module is intentionally reached through dynamic imports from the
 * shared invitation service. Resort permission authoring belongs to the Team
 * route and must not increase the eager Business boot payload.
 */

import { supabase } from "./supabase";
import {
  BrandInvitationServiceError,
  parseFunctionsError,
  type BrandInvitationRow,
  type BrandTeamMemberRow,
  type InviteBrandMemberInput,
  type InviteBrandMemberResult,
  type VenueAccessGrant,
  type VenueAccessProfile,
  type VenueCapability,
} from "./brandInvitationsService";

export async function inviteVenueStaffMember(
  input: InviteBrandMemberInput,
): Promise<InviteBrandMemberResult> {
  const note = typeof input.personalNote === "string"
    ? input.personalNote.trim()
    : "";
  const { data, error } = await supabase.functions.invoke(
    "invite-brand-member",
    {
      body: {
        brand_id: input.brandId,
        invitee_email: input.inviteeEmail.trim().toLowerCase(),
        invitee_name: input.inviteeName.trim(),
        role: "venue_staff",
        ...(note.length > 0 ? { personal_note: note } : {}),
        ...(input.partnerSetup === true ? { partner_setup: true } : {}),
        venue_grants: (input.venueGrants ?? []).map((grant) => ({
          venue_id: grant.venueId,
          access_profile: grant.profile,
          capabilities: grant.capabilities,
        })),
      },
    },
  );
  if (error) {
    const parsed = await parseFunctionsError(error);
    throw new BrandInvitationServiceError(
      parsed.code,
      parsed.status,
      error instanceof Error ? error.message : undefined,
    );
  }
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { invitation_id?: unknown }).invitation_id !== "string"
  ) {
    throw new BrandInvitationServiceError("server", 500, "invalid response");
  }
  return { invitationId: (data as { invitation_id: string }).invitation_id };
}

export async function listBrandInvitationsWithVenueGrants(
  brandId: string,
): Promise<BrandInvitationRow[]> {
  const { data, error } = await supabase
    .from("brand_invitations")
    .select(
      "id, brand_id, email, invitee_name, role, invited_by, expires_at, accepted_at, accepted_by_account_id, revoked_at, status, brand_invitation_venue_grants(venue_id, access_profile, capabilities)",
    )
    .eq("brand_id", brandId)
    .order("expires_at", { ascending: false });
  if (error) {
    throw new BrandInvitationServiceError("server", 500, error.message);
  }
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      ...(row as unknown as Omit<BrandInvitationRow, "venueGrants">),
      venueGrants: mapVenueGrants(row.brand_invitation_venue_grants),
    };
  });
}

export async function listBrandTeamMembersWithVenueGrants(
  brandId: string,
): Promise<BrandTeamMemberRow[]> {
  const { data, error } = await supabase
    .from("brand_team_members")
    .select(
      "id, brand_id, user_id, role, invited_at, accepted_at, removed_at, brand_team_member_venue_grants(venue_id, access_profile, capabilities)",
    )
    .eq("brand_id", brandId)
    .is("removed_at", null);
  if (error) {
    throw new BrandInvitationServiceError("server", 500, error.message);
  }
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      ...(row as unknown as Omit<BrandTeamMemberRow, "venueGrants">),
      venueGrants: mapVenueGrants(row.brand_team_member_venue_grants),
    };
  });
}

export async function updateBrandTeamMemberVenueGrants(
  brandId: string,
  memberId: string,
  grants: VenueAccessGrant[],
): Promise<void> {
  const { error } = await supabase.rpc("issue_4188_set_member_venue_grants", {
    p_brand_id: brandId,
    p_member_id: memberId,
    p_grants: grants.map((grant) => ({
      venueId: grant.venueId,
      profile: grant.profile,
      capabilities: grant.capabilities,
    })),
  });
  if (error) {
    const code = error.message?.includes("forbidden")
      ? "forbidden"
      : error.message?.includes("member_not_found")
        ? "member_not_found"
        : error.message?.includes("invalid_venue_grants")
          ? "invalid_venue_grants"
          : "server";
    throw new BrandInvitationServiceError(code, 400, error.message);
  }
}

function mapVenueGrants(value: unknown): VenueAccessGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (
      typeof row.venue_id !== "string" ||
      typeof row.access_profile !== "string" ||
      !Array.isArray(row.capabilities)
    ) return [];
    return [{
      venueId: row.venue_id,
      profile: row.access_profile as VenueAccessProfile,
      capabilities: row.capabilities.filter(
        (capability): capability is VenueCapability =>
          typeof capability === "string",
      ),
    }];
  });
}
