/**
 * brandInvitationsService — backend contract for the brand-team invite flow
 * (ORCH-1050).
 *
 * Replaces the [TRANSITIONAL] local-Zustand-only flow (exit condition: ORCH-1050) with real Supabase
 * persistence + Resend email + ownership-transfer RPC. The store now lives
 * only as an optimistic-UI cache between "Invite tapped" and "edge fn
 * returned"; canonical state is read from public.brand_invitations and
 * public.brand_team_members via React Query.
 *
 * Layers:
 *   - inviteBrandMember           → POST /invite-brand-member edge fn
 *   - acceptBrandInvitation       → POST /accept-brand-invitation edge fn
 *   - revokeBrandInvitation       → direct UPDATE under brand_admin+ RLS
 *   - listBrandInvitations        → direct SELECT under brand_admin+ RLS
 *   - listBrandTeamMembers        → direct SELECT (mirrors useCurrentBrandRole's
 *                                   policy chain; brand_admin+ on the brand)
 *
 * Cache keys are exported separately so hooks + components can invalidate
 * without re-implementing them. Matches the brandKeys factory shape in
 * hooks/useBrands.ts.
 *
 * Per ORCH-1050 SPEC Layer 4.
 */

import { supabase } from "./supabase";
import type { BrandRole } from "../utils/brandRole";

// ---------- Types ----------

export interface BrandInvitationRow {
  id: string;
  brand_id: string;
  email: string;
  invitee_name: string | null;
  role: BrandRole;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_account_id: string | null;
  revoked_at: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at?: string;
}

export interface BrandTeamMemberRow {
  id: string;
  brand_id: string;
  user_id: string;
  role: BrandRole;
  invited_at: string;
  accepted_at: string | null;
  removed_at: string | null;
}

export interface InviteBrandMemberInput {
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  role: BrandRole;
}

export interface InviteBrandMemberResult {
  invitationId: string;
}

export interface AcceptBrandInvitationResult {
  brandId: string;
  role: BrandRole;
  transferred: boolean;
  previousOwnerAccountId: string | null;
  newOwnerAccountId: string | null;
}

export class BrandInvitationServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = "BrandInvitationServiceError";
    this.code = code;
    this.status = status;
  }
}

// ---------- Cache keys ----------

export const brandInvitationKeys = {
  all: ["brand-invitations"] as const,
  list: (brandId: string): readonly ["brand-invitations", "list", string] =>
    ["brand-invitations", "list", brandId] as const,
  detail: (
    invitationId: string,
  ): readonly ["brand-invitations", "detail", string] =>
    ["brand-invitations", "detail", invitationId] as const,
};

export const brandTeamMemberKeys = {
  all: ["brand-team-members"] as const,
  list: (brandId: string): readonly ["brand-team-members", "list", string] =>
    ["brand-team-members", "list", brandId] as const,
};

// ---------- Mutations ----------

export async function inviteBrandMember(
  input: InviteBrandMemberInput,
): Promise<InviteBrandMemberResult> {
  const { data, error } = await supabase.functions.invoke(
    "invite-brand-member",
    {
      body: {
        brand_id: input.brandId,
        invitee_email: input.inviteeEmail.trim().toLowerCase(),
        invitee_name: input.inviteeName.trim(),
        role: input.role,
      },
    },
  );
  if (error) {
    // supabase-js wraps non-2xx as an Error with `context.response`.
    const status = extractStatus(error);
    const code = extractErrorCode(data, error) ?? "server";
    throw new BrandInvitationServiceError(code, status, error.message);
  }
  if (!data || typeof data !== "object" || typeof (data as { invitation_id?: unknown }).invitation_id !== "string") {
    throw new BrandInvitationServiceError("server", 500, "invalid response");
  }
  return { invitationId: (data as { invitation_id: string }).invitation_id };
}

export async function acceptBrandInvitation(
  token: string,
): Promise<AcceptBrandInvitationResult> {
  const { data, error } = await supabase.functions.invoke(
    "accept-brand-invitation",
    { body: { token } },
  );
  if (error) {
    const status = extractStatus(error);
    const code = extractErrorCode(data, error) ?? "server";
    throw new BrandInvitationServiceError(code, status, error.message);
  }
  if (!data || typeof data !== "object") {
    throw new BrandInvitationServiceError("server", 500, "invalid response");
  }
  const d = data as Record<string, unknown>;
  return {
    brandId: typeof d.brand_id === "string" ? d.brand_id : "",
    role: d.role as BrandRole,
    transferred: d.transferred === true,
    previousOwnerAccountId:
      typeof d.previous_owner_account_id === "string"
        ? d.previous_owner_account_id
        : null,
    newOwnerAccountId:
      typeof d.new_owner_account_id === "string"
        ? d.new_owner_account_id
        : null,
  };
}

export async function revokeBrandInvitation(
  invitationId: string,
): Promise<void> {
  // RLS allows brand_admin+ on the invitation's brand to UPDATE. Verify
  // rowcount via .select() per I-PROPOSED-I.
  const { data, error } = await supabase
    .from("brand_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id");
  if (error) {
    throw new BrandInvitationServiceError("server", 500, error.message);
  }
  if (!data || data.length === 0) {
    throw new BrandInvitationServiceError(
      "not_found_or_not_pending",
      404,
      "invitation not found or no longer pending",
    );
  }
}

// ---------- Queries ----------

export async function listBrandInvitations(
  brandId: string,
): Promise<BrandInvitationRow[]> {
  const { data, error } = await supabase
    .from("brand_invitations")
    .select(
      "id, brand_id, email, invitee_name, role, invited_by, expires_at, accepted_at, accepted_by_account_id, revoked_at, status",
    )
    .eq("brand_id", brandId)
    .order("expires_at", { ascending: false });
  if (error) {
    throw new BrandInvitationServiceError("server", 500, error.message);
  }
  return (data ?? []) as BrandInvitationRow[];
}

export async function listBrandTeamMembers(
  brandId: string,
): Promise<BrandTeamMemberRow[]> {
  const { data, error } = await supabase
    .from("brand_team_members")
    .select(
      "id, brand_id, user_id, role, invited_at, accepted_at, removed_at",
    )
    .eq("brand_id", brandId)
    .is("removed_at", null);
  if (error) {
    throw new BrandInvitationServiceError("server", 500, error.message);
  }
  return (data ?? []) as BrandTeamMemberRow[];
}

// ---------- Internals ----------

function extractStatus(error: unknown): number {
  if (error && typeof error === "object") {
    const ctx = (error as { context?: { response?: { status?: number } } })
      .context;
    if (ctx?.response?.status) return ctx.response.status;
    const s = (error as { status?: number }).status;
    if (typeof s === "number") return s;
  }
  return 500;
}

function extractErrorCode(data: unknown, error: unknown): string | null {
  // Edge fn returns { error: '<code>' } on non-2xx; supabase-js stuffs the
  // parsed body in `data` even when status is non-2xx.
  if (data && typeof data === "object") {
    const code = (data as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}
