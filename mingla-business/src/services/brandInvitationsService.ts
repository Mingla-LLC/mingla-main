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
  // ORCH-1111 — 'declined' is the new invitee-driven terminal state.
  status: "pending" | "accepted" | "revoked" | "expired" | "declined";
  created_at?: string;
}

/**
 * ORCH-1111 — curated invitee-side projection returned by
 * `list-my-pending-invites`. NEVER carries token_hash / invited_by / email.
 */
export interface PendingInviteRow {
  id: string;
  brand_id: string;
  brand_name: string;
  role: BrandRole;
  expires_at: string;
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
  // ORCH-1081 — partner-mode extensions. Both optional; either or both can
  // accompany a non-partner invite as well (the edge fn just renders the note).
  personalNote?: string;
  partnerSetup?: boolean;
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
  // ORCH-1081 — surfaced for the celebration screen.
  brandSlug: string | null;
  newOwnerFirstName: string | null;
  partnerSetup: boolean;
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
  // ORCH-1111 — the signed-in user's own pending invites (email-keyed,
  // resolved server-side). Keyed by userId so it invalidates per-account.
  myPending: (
    userId: string,
  ): readonly ["brand-invitations", "my-pending", string] =>
    ["brand-invitations", "my-pending", userId] as const,
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
  // ORCH-1081 — personal_note + partner_setup flow through to the edge fn
  // which renders them in the Mingla brand-shell-wrapped email.
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
        role: input.role,
        ...(note.length > 0 ? { personal_note: note } : {}),
        ...(input.partnerSetup === true ? { partner_setup: true } : {}),
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
    brandSlug: typeof d.brand_slug === "string" ? d.brand_slug : null,
    newOwnerFirstName:
      typeof d.new_owner_first_name === "string" ? d.new_owner_first_name : null,
    partnerSetup: d.partner_setup === true,
  };
}

/**
 * ORCH-1111 — accept one of the signed-in user's OWN pending invites from
 * in-app (email-trusted, tokenless). Reuses the `accept-brand-invitation` edge
 * fn's new `{ invitationId }` branch (the server resolves the stored token_hash
 * and runs the SAME accept RPC). Lower blast than overloading the web token
 * caller (OQ-3 preferred shape).
 */
export async function acceptMyPendingInvitation(
  invitationId: string,
): Promise<AcceptBrandInvitationResult> {
  const { data, error } = await supabase.functions.invoke(
    "accept-brand-invitation",
    { body: { invitationId } },
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
    brandSlug: typeof d.brand_slug === "string" ? d.brand_slug : null,
    newOwnerFirstName:
      typeof d.new_owner_first_name === "string" ? d.new_owner_first_name : null,
    partnerSetup: d.partner_setup === true,
  };
}

/**
 * ORCH-1111 — decline one of the signed-in user's OWN pending invites. On a
 * `410 invite_not_actionable` (already declined / no longer pending) we treat
 * the call as resolved (return normally) — the decline goal (not pending) is
 * already met. Any other non-2xx throws.
 */
export async function declineBrandInvitation(
  invitationId: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    "decline-brand-invitation",
    { body: { invitationId } },
  );
  if (error) {
    const status = extractStatus(error);
    const code = extractErrorCode(data, error) ?? "server";
    // A no-longer-pending invite is the decline goal — treat as success.
    if (status === 410 || code === "invite_not_actionable") {
      return;
    }
    throw new BrandInvitationServiceError(code, status, error.message);
  }
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

/**
 * ORCH-1111 — list the signed-in user's OWN pending invites (email-keyed,
 * resolved server-side from the JWT email). Returns the curated projection;
 * never throws on empty (non-object data → []). Same error envelope as the
 * accept/decline calls.
 */
export async function listMyPendingInvites(): Promise<PendingInviteRow[]> {
  const { data, error } = await supabase.functions.invoke(
    "list-my-pending-invites",
    { body: {} },
  );
  if (error) {
    const status = extractStatus(error);
    const code = extractErrorCode(data, error) ?? "server";
    throw new BrandInvitationServiceError(code, status, error.message);
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  const invites = (data as { invites?: unknown }).invites;
  if (!Array.isArray(invites)) {
    return [];
  }
  return invites.map((raw) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<
      string,
      unknown
    >;
    return {
      id: typeof r.id === "string" ? r.id : "",
      brand_id: typeof r.brand_id === "string" ? r.brand_id : "",
      brand_name: typeof r.brand_name === "string" ? r.brand_name : "your brand",
      role: r.role as BrandRole,
      expires_at: typeof r.expires_at === "string" ? r.expires_at : "",
    };
  });
}

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
