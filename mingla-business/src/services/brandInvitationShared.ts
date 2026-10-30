import type { BrandRole } from "../utils/brandRole";

export type VenueAccessProfile =
  | "front_desk"
  | "restaurant_manager"
  | "kitchen_bar"
  | "custom";

export type VenueCapability =
  | "stay.view_reservations"
  | "stay.create_reservations"
  | "stay.manage_reservations"
  | "stay.view_availability"
  | "restaurant.view_orders"
  | "restaurant.manage_orders"
  | "restaurant.manage_menu"
  | "restaurant.manage_qr"
  | "restaurant.manage_reservations";

export interface VenueAccessGrant {
  venueId: string;
  profile: VenueAccessProfile;
  capabilities: VenueCapability[];
}

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
  venueGrants: VenueAccessGrant[];
}

export interface BrandTeamMemberRow {
  id: string;
  brand_id: string;
  user_id: string;
  role: BrandRole;
  invited_at: string;
  accepted_at: string | null;
  removed_at: string | null;
  venueGrants: VenueAccessGrant[];
}

/** #3660 — outgoing owner choice when inviting brand_owner (stored on invite). */
export type OutgoingOwnerDisposition = "leave" | "stay";

export interface InviteBrandMemberInput {
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  role: BrandRole;
  // ORCH-1081 — partner-mode extensions. Both optional; either or both can
  // accompany a non-partner invite as well (the edge fn just renders the note).
  personalNote?: string;
  partnerSetup?: boolean;
  /** #3660 — when inviting brand_owner, outgoing owner chooses leave|stay. */
  outgoingDisposition?: OutgoingOwnerDisposition;
  venueGrants?: VenueAccessGrant[];
}

export interface InviteBrandMemberResult {
  invitationId: string;
}

export class BrandInvitationServiceError extends Error {
  readonly code: string;
  readonly status: number;
  /** #3259 — the address the invitation was sent to, when the server names it. */
  readonly invitedEmail: string | null;
  constructor(
    code: string,
    status: number,
    message?: string,
    invitedEmail: string | null = null,
  ) {
    super(message ?? code);
    this.name = "BrandInvitationServiceError";
    this.code = code;
    this.status = status;
    this.invitedEmail = invitedEmail;
  }
}

/**
 * ORCH-1404 [accept-invite-web-error-recovery] F-2 — the canonical parse of a
 * Supabase edge-function error.
 *
 * A FunctionsHttpError stores its Response directly on `error.context`.
 * Preserve that shape here so invitation and venue-access services share one
 * parser without importing each other.
 * (I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL.)
 */
interface ResponseLike {
  status: number;
  clone?: () => { json: () => Promise<unknown> };
  json?: () => Promise<unknown>;
}

function isResponseLike(value: unknown): value is ResponseLike {
  if (!value || typeof value !== "object") return false;
  const v = value as { status?: unknown; clone?: unknown; json?: unknown };
  return (
    typeof v.status === "number" &&
    (typeof v.clone === "function" || typeof v.json === "function")
  );
}

export async function parseFunctionsError(
  error: unknown,
): Promise<{ status: number; code: string; invitedEmail?: string }> {
  if (error && typeof error === "object") {
    const ctx = (error as { context?: unknown }).context;
    if (isResponseLike(ctx)) {
      const status = ctx.status;
      let code = "server";
      let invitedEmail: string | undefined;
      try {
        const source =
          typeof ctx.clone === "function"
            ? ctx.clone()
            : (ctx as { json: () => Promise<unknown> });
        const body = await source.json();
        if (
          body &&
          typeof body === "object" &&
          typeof (body as { error?: unknown }).error === "string"
        ) {
          code = (body as { error: string }).error;
        }
        const invited = (body as { invited_email?: unknown } | null)
          ?.invited_email;
        if (typeof invited === "string" && invited.trim().length > 0) {
          invitedEmail = invited.trim();
        }
      } catch {
        code = "server";
      }
      return invitedEmail === undefined
        ? { status, code }
        : { status, code, invitedEmail };
    }
    const topStatus = (error as { status?: unknown }).status;
    const topCode = (error as { code?: unknown }).code;
    if (typeof topStatus === "number" || typeof topCode === "string") {
      return {
        status: typeof topStatus === "number" ? topStatus : 0,
        code: typeof topCode === "string" ? topCode : "server",
      };
    }
  }
  return { status: 0, code: "server" };
}
