/**
 * partnerBrandLinksService — ORCH-1081 frontend reader for partner_brand_links,
 * extended by ORCH-1384 with the partner brand-management verbs.
 *
 * INVARIANT CITATION (MANDATORY — SPEC_ORCH-1384 §4.4): this file was on the
 * ORCH-1331 DO-NOT-TOUCH list under I-PROPOSED-1331-LINK-COLUMNS-FROZEN.
 * ORCH-1384 amends that list BY SPEC with orchestrator REVIEW as the
 * sanctioning step. The frozen rule itself is preserved: all reads keep the
 * existing column NAMES; `deriveLinkStatus`'s case tree is UNCHANGED; nothing
 * is renamed.
 *
 * RLS allows partner self-read (partner_account_id = auth.uid()) and — since
 * ORCH-1384 — brand-owner read (brands.account_id = auth.uid(), the
 * partner_brand_links_owner_select policy). Link WRITES stay off the client:
 * INSERT via the invite-brand-member edge fn; lifecycle stamps via DB
 * triggers + the accept RPC; the ORCH-1384 verbs go through SECURITY DEFINER
 * RPCs (cancel / disconnect) and the partner-reissue-invitation edge fn.
 *
 * Derived status is computed client-side from the raw timestamp columns
 * (mirrors public.partner_brand_link_status). We don't rely on the
 * column-function form here because Supabase JS doesn't surface derived
 * column-funcs without a view; computing locally keeps the read path
 * simple and lossless.
 */

import { supabase } from "./supabase";

export type PartnerBrandLinkStatus =
  | "awaiting_owner"
  | "awaiting_stripe"
  | "active"
  | "cancelled";

/** ORCH-1384 — typed cancelled_reason values (SPEC §4.1 CHECK constraint). */
export type PartnerBrandLinkCancelledReason =
  | "partner_cancelled"
  | "owner_declined"
  | "invitation_revoked"
  | "partner_disconnected"
  | "owner_removed";

export interface PartnerBrandLinkRow {
  id: string;
  partner_account_id: string;
  brand_id: string;
  invited_owner_email: string;
  personal_note: string | null;
  invited_at: string;
  accepted_at: string | null;
  owner_stripe_connected_at: string | null;
  first_split_at: string | null;
  cancelled_at: string | null;
  /** ORCH-1384 — why the link terminated. NULL for live rows + legacy stamps. */
  cancelled_reason: string | null;
  // Joined brand metadata (PostgREST embedded select). Optional so the type
  // is reusable without the join.
  brand?: {
    id: string;
    name: string;
    slug: string;
    cover_media_url: string | null;
    cover_media_type: string | null;
    default_currency: string | null;
  } | null;
}

export interface PartnerBrandLinkWithStatus extends PartnerBrandLinkRow {
  status: PartnerBrandLinkStatus;
}

export const partnerBrandLinksKeys = {
  all: ["partnerBrandLinks"] as const,
  // ORCH-1384 — the includeCancelled flag IS part of the key (two distinct
  // cache entries; Const #4 one-key-per-entity via this factory only).
  list: (includeCancelled: boolean) =>
    [...partnerBrandLinksKeys.all, "list", includeCancelled] as const,
  // ORCH-1384 — owner-side read (Team screen partner-row identification).
  brand: (brandId: string) =>
    [...partnerBrandLinksKeys.all, "brand", brandId] as const,
};

export function deriveLinkStatus(
  row: PartnerBrandLinkRow,
): PartnerBrandLinkStatus {
  if (row.cancelled_at !== null) return "cancelled";
  if (row.first_split_at !== null) return "active";
  if (row.owner_stripe_connected_at !== null) return "active";
  if (row.accepted_at !== null) return "awaiting_stripe";
  return "awaiting_owner";
}

// ---------------------------------------------------------------------------
// ORCH-1384 — client-side 7-day invite-expiry derivation (SPEC §4.4-6, D-4's
// "cheapest honest mechanism"). Presentation-level ONLY: the 4-value
// PartnerBrandLinkStatus union and deriveLinkStatus are FROZEN; server truth
// already enforces token death via the accept RPC's P0003 invite_expired.
// ---------------------------------------------------------------------------

/**
 * MUST equal EXPIRY_DAYS in supabase/functions/_shared/brandInviteEmail.ts
 * (the edge-side token expiry). T-5 pins them equal — change BOTH or neither.
 */
export const INVITE_EXPIRY_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when an awaiting_owner row's invite token has aged past the 7-day
 * expiry (derived from invited_at — reissue refreshes invited_at atomically
 * with the new token's expires_at, keeping this derivation truthful).
 */
export function isInviteExpired(row: PartnerBrandLinkWithStatus): boolean {
  if (row.status !== "awaiting_owner") return false;
  return (
    Date.now() >=
    new Date(row.invited_at).getTime() + INVITE_EXPIRY_DAYS * DAY_MS
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// ORCH-1384 — the brand embed is INTENTIONALLY UNFILTERED on deleted_at:
// cancelled rows must keep rendering their (auto-)soft-deleted brand's real
// name (SPEC §4.4-2 / D-5). The owner SELECT RLS on brands ("Account owner
// can select own brands", qual account_id = auth.uid(), NO deleted_at gate —
// ORCH-0734 by design) admits the tombstone through the embed. Do NOT add
// `.is("deleted_at", null)` to this select string.
// Exported for the team-only useBrandPartnerLinks module (ORCH-1384 bundle-
// budget split — the owner-side read is team-only; the eager service keeps only
// the partner self-read).
export const LINK_SELECT =
  "id, partner_account_id, brand_id, invited_owner_email, personal_note, invited_at, accepted_at, owner_stripe_connected_at, first_split_at, cancelled_at, cancelled_reason, brand:brands(id, name, slug, cover_media_url, cover_media_type, default_currency)";

export interface ListPartnerBrandLinksOptions {
  /**
   * ORCH-1384 — when true, cancelled rows are returned too (OQ-3: the Brands
   * screen shows them greyed + last). Default false keeps the pre-1384
   * behavior byte-compatible for every existing caller (account.tsx counts,
   * earnings.tsx nudge).
   */
  includeCancelled?: boolean;
}

/**
 * Read the caller's partner_brand_links rows. Excludes cancelled rows by
 * default. Embeds the brand row for the list UI (name / cover / currency).
 */
export async function listPartnerBrandLinks(
  opts?: ListPartnerBrandLinksOptions,
): Promise<PartnerBrandLinkWithStatus[]> {
  const includeCancelled = opts?.includeCancelled === true;
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    throw new Error("not_authenticated");
  }
  const userId = userResult.user.id;

  let query = supabase
    .from("partner_brand_links")
    .select(LINK_SELECT)
    .eq("partner_account_id", userId);
  if (!includeCancelled) {
    query = query.is("cancelled_at", null);
  }
  const { data, error } = await query.order("invited_at", {
    ascending: false,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PartnerBrandLinkRow[];
  return rows.map((row) => ({ ...row, status: deriveLinkStatus(row) }));
}

// listBrandPartnerLinks moved to ../hooks/useBrandPartnerLinks (ORCH-1384
// bundle-budget split — the owner-side read is used ONLY by the Team screen, so
// keeping it out of this eager service keeps it out of the web boot __common
// chunk).

// ---------------------------------------------------------------------------
// ORCH-1384 — verbs. Typed error mapping: every failure surfaces as a thrown
// Error whose message is a stable code the UI maps to §5.6 copy — NEVER a
// silent catch (Const #3). has_upcoming_events is a WORKFLOW REJECTION
// result, not a throw (Decision-11 pattern, mirrors SoftDeleteResult).
// ---------------------------------------------------------------------------

/** Stable typed error codes the verb surfaces throw. */
export type PartnerLinkVerbErrorCode =
  | "forbidden"
  | "link_not_found"
  | "link_not_pending"
  | "link_not_active"
  | "email_send_failed"
  | "validation"
  | "server";

// CancelPendingResult / CancelPendingSuccess / CancelPendingRejection moved to
// ./partnerLinkVerbs (ORCH-1384 bundle-budget split — cancel is a sheet-only
// verb).

// Exported for the sheet-only partnerLinkVerbs module (ORCH-1384 bundle-budget
// split) — cancelPendingLink reuses this shape + rpcErrorCode below.
export interface RpcErrorShape {
  message?: string;
  details?: string;
}

const KNOWN_RPC_CODES: readonly string[] = [
  "forbidden",
  "link_not_found",
  "link_not_pending",
  "link_not_active",
  "partner_is_owner",
  "validation",
];

export function rpcErrorCode(error: RpcErrorShape): string {
  const message = error.message ?? "";
  for (const code of KNOWN_RPC_CODES) {
    if (message.includes(code)) return code;
  }
  return "server";
}

// cancelPendingLink moved to ./partnerLinkVerbs (ORCH-1384 bundle-budget split
// — sheet-only verb; it reuses the exported rpcErrorCode + RpcErrorShape).

/**
 * Disconnect an ACTIVE (accepted) link — dual stamp via
 * partner_disconnect_link (link cancelled_at + partner team removed_at, one
 * transaction; I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH). Works for BOTH the
 * partner (reason partner_disconnected) and the brand owner (owner_removed) —
 * the RPC resolves the side from auth.uid().
 */
export async function disconnectLink(linkId: string): Promise<void> {
  const { error } = await supabase.rpc("partner_disconnect_link", {
    p_link_id: linkId,
  });
  if (error !== null) {
    throw new Error(rpcErrorCode(error as RpcErrorShape));
  }
}

// reissueInvitation (+ parseInvokeErrorCode / FunctionsInvokeErrorShape) moved
// to ./partnerLinkVerbs (ORCH-1384 bundle-budget split — sheet-only verb).
