/**
 * scannerInvitationsService — backend contract for the scanner-team invite
 * flow (ORCH-1051).
 *
 * Replaces the [TRANSITIONAL] local-Zustand-only flow (exit condition: ORCH-1051) with real Supabase
 * persistence + Resend email + branch-on-scope accept RPC. The
 * `scannerInvitationsStore` now lives only as an optimistic-UI cache between
 * "Invite tapped" and "edge fn returned"; canonical state is read from
 * public.scanner_invitations + public.event_scanners +
 * public.brand_team_members via React Query.
 *
 * Layers:
 *   - inviteScanner               → POST /invite-scanner edge fn
 *   - acceptScannerInvitation     → POST /accept-scanner-invitation edge fn
 *   - revokeScannerInvitation     → direct UPDATE under event_manager+ RLS
 *   - listScannerInvitations      → direct SELECT under event_manager+ RLS
 *
 * Mirrors brandInvitationsService.ts (ORCH-1050). Per ORCH-1051 SPEC Layer 4.
 */

import { supabase } from "./supabase";

// ---------- Types ----------

export type ScannerInvitationScope = "event" | "brand";
export type ScannerInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface ScannerInvitationPermissions {
  canScan: boolean;
  canAcceptPayments: boolean;
}

export interface ScannerInvitationRow {
  id: string;
  brand_id: string;
  event_id: string | null;
  scope: ScannerInvitationScope;
  email: string;
  invitee_name: string | null;
  permissions: ScannerInvitationPermissions;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_account_id: string | null;
  revoked_at: string | null;
  status: ScannerInvitationStatus;
  created_at?: string;
}

export interface InviteScannerInput {
  brandId: string;
  eventId: string | null;
  scope: ScannerInvitationScope;
  inviteeEmail: string;
  inviteeName: string;
  canAcceptPayments: boolean;
}

export interface InviteScannerResult {
  invitationId: string;
}

export interface AcceptScannerInvitationResult {
  scope: ScannerInvitationScope;
  brandId: string;
  eventId: string | null;
  userId: string;
}

export class ScannerInvitationServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = "ScannerInvitationServiceError";
    this.code = code;
    this.status = status;
  }
}

// ---------- Cache keys ----------

export const scannerInvitationKeys = {
  all: ["scanner-invitations"] as const,
  listByBrand: (
    brandId: string,
  ): readonly ["scanner-invitations", "brand", string] =>
    ["scanner-invitations", "brand", brandId] as const,
  listByEvent: (
    eventId: string,
  ): readonly ["scanner-invitations", "event", string] =>
    ["scanner-invitations", "event", eventId] as const,
  detail: (
    invitationId: string,
  ): readonly ["scanner-invitations", "detail", string] =>
    ["scanner-invitations", "detail", invitationId] as const,
};

// ---------- Mutations ----------

export async function inviteScanner(
  input: InviteScannerInput,
): Promise<InviteScannerResult> {
  const body: Record<string, unknown> = {
    brand_id: input.brandId,
    scope: input.scope,
    invitee_email: input.inviteeEmail.trim().toLowerCase(),
    invitee_name: input.inviteeName.trim(),
    can_accept_payments: input.canAcceptPayments === true,
  };
  if (input.scope === "event" && input.eventId) {
    body.event_id = input.eventId;
  }

  const { data, error } = await supabase.functions.invoke(
    "invite-scanner",
    { body },
  );
  if (error) {
    const status = extractStatus(error);
    const code = extractErrorCode(data, error) ?? "server";
    throw new ScannerInvitationServiceError(code, status, error.message);
  }
  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { invitation_id?: unknown }).invitation_id !== "string"
  ) {
    throw new ScannerInvitationServiceError("server", 500, "invalid response");
  }
  return {
    invitationId: (data as { invitation_id: string }).invitation_id,
  };
}

export async function acceptScannerInvitation(
  token: string,
): Promise<AcceptScannerInvitationResult> {
  const { data, error } = await supabase.functions.invoke(
    "accept-scanner-invitation",
    { body: { token } },
  );
  if (error) {
    const status = extractStatus(error);
    const code = extractErrorCode(data, error) ?? "server";
    throw new ScannerInvitationServiceError(code, status, error.message);
  }
  if (!data || typeof data !== "object") {
    throw new ScannerInvitationServiceError("server", 500, "invalid response");
  }
  const d = data as Record<string, unknown>;
  return {
    scope: (d.scope as ScannerInvitationScope) ?? "event",
    brandId: typeof d.brand_id === "string" ? d.brand_id : "",
    eventId: typeof d.event_id === "string" ? d.event_id : null,
    userId: typeof d.user_id === "string" ? d.user_id : "",
  };
}

export async function revokeScannerInvitation(
  invitationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("scanner_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id");
  if (error) {
    throw new ScannerInvitationServiceError("server", 500, error.message);
  }
  if (!data || data.length === 0) {
    throw new ScannerInvitationServiceError(
      "not_found_or_not_pending",
      404,
      "invitation not found or no longer pending",
    );
  }
}

// ---------- Queries ----------

const SELECT_COLS =
  "id, brand_id, event_id, scope, email, invitee_name, permissions, invited_by, expires_at, accepted_at, accepted_by_account_id, revoked_at, status, created_at";

export async function listScannerInvitationsForBrand(
  brandId: string,
): Promise<ScannerInvitationRow[]> {
  const { data, error } = await supabase
    .from("scanner_invitations")
    .select(SELECT_COLS)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new ScannerInvitationServiceError("server", 500, error.message);
  }
  return (data ?? []) as ScannerInvitationRow[];
}

export async function listScannerInvitationsForEvent(
  eventId: string,
): Promise<ScannerInvitationRow[]> {
  const { data, error } = await supabase
    .from("scanner_invitations")
    .select(SELECT_COLS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new ScannerInvitationServiceError("server", 500, error.message);
  }
  return (data ?? []) as ScannerInvitationRow[];
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
