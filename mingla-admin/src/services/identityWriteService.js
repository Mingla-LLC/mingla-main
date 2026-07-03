/**
 * ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — identity write service seam.
 *
 * Thin typed wrappers over the ORCH-1271 audited-write primitive: EVERY mutation
 * routes through callAdminWriteRpc('<audited rpc>', {...}) → { data, error }. The
 * console NEVER calls .update()/.insert()/.delete() on an identity table directly;
 * the SECURITY DEFINER RPCs (guard-first is_admin_user() + admin_write_audit
 * before/after + least-privilege REVOKE) are the ONLY sanctioned write surface.
 * Enforced by I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED (i-1276-identity-admin-write.mjs).
 *
 * mapWriteError() translates RPC error codes → user copy for the modal error slot.
 */

import { callAdminWriteRpc } from "./adminWriteService";

/**
 * Translate an RPC error into human copy for the modal's inline error slot.
 * Falls through to the raw message for anything unmapped.
 */
export function mapWriteError(error) {
  const msg = error?.message || "";
  if (msg.includes("not_authorized")) return "You are not authorized to do this.";
  if (msg.includes("reason_required")) return "A reason is required.";
  if (msg.includes("not_found")) return "That record no longer exists.";
  if (msg.includes("invalid_new_owner")) return "That account can't own a brand (missing or deleted).";
  if (msg.includes("invalid_status") || msg.includes("invalid_role")) return "Invalid selection.";
  if (msg.includes("not_pending")) return "This invite is no longer pending.";
  if (msg.includes("cannot_demote_account_owner") || msg.includes("cannot_remove_account_owner")) {
    return "You can't remove or demote the brand's account owner.";
  }
  // ORCH-1276 P1: the brands.account_id immutability trigger (surfaces if the
  // reassign RPC's transfer-bypass GUC is ever missing) — friendly copy, never a raw DB error.
  if (msg.includes("account_id is immutable") || msg.includes("immutable")) {
    return "Couldn't transfer ownership — please try again.";
  }
  return msg || "Something went wrong. Please try again.";
}

// ── Brand writes (A1–A5) ──────────────────────────────────────────────────────

/** A1 — edit brand profile (LOW, audit-only). `patch` = whitelisted jsonb; `reason` optional. */
export function updateBrand(brandId, patch, reason = null) {
  return callAdminWriteRpc("admin_update_brand", { p_brand_id: brandId, p_patch: patch, p_reason: reason });
}

/** A2 — reassign brand owner (HIGH). */
export function reassignBrandOwner(brandId, newAccountId, reason) {
  return callAdminWriteRpc("admin_reassign_brand_owner", {
    p_brand_id: brandId,
    p_new_account_id: newAccountId,
    p_reason: reason,
  });
}

/** A3/A4 — set brand claim status (HIGH). status ∈ suspended|revoked|verified|none. */
export function setBrandClaimStatus(brandId, status, reason) {
  return callAdminWriteRpc("admin_set_brand_claim_status", {
    p_brand_id: brandId,
    p_status: status,
    p_reason: reason,
  });
}

/** A5 — soft-delete / restore brand (HIGH). */
export function setBrandDeleted(brandId, deleted, reason) {
  return callAdminWriteRpc("admin_set_brand_deleted", {
    p_brand_id: brandId,
    p_deleted: deleted,
    p_reason: reason,
  });
}

// ── Account writes (B1–B2) ────────────────────────────────────────────────────

/** B1 — edit account core (LOW, audit-only). `patch` = whitelisted jsonb; `reason` optional. */
export function updateAccount(userId, patch, reason = null) {
  return callAdminWriteRpc("admin_update_account", { p_user_id: userId, p_patch: patch, p_reason: reason });
}

/** B2 — soft-delete / restore account (HIGH). */
export function setAccountDeleted(userId, deleted, reason) {
  return callAdminWriteRpc("admin_set_account_deleted", {
    p_user_id: userId,
    p_deleted: deleted,
    p_reason: reason,
  });
}

// ── Team / invite writes (C1–C3) ──────────────────────────────────────────────

/** C1 — change team-member role (HIGH). */
export function setTeamMemberRole(memberId, role, reason) {
  return callAdminWriteRpc("admin_set_team_member_role", {
    p_member_id: memberId,
    p_role: role,
    p_reason: reason,
  });
}

/** C2 — remove team member (HIGH). Accepted → removed_at; never-accepted → DELETE. */
export function removeTeamMember(memberId, reason) {
  return callAdminWriteRpc("admin_remove_team_member", { p_member_id: memberId, p_reason: reason });
}

/** C3 — revoke a pending brand invitation (HIGH). */
export function revokeInvitation(invitationId, reason) {
  return callAdminWriteRpc("admin_revoke_brand_invitation", {
    p_invitation_id: invitationId,
    p_reason: reason,
  });
}

// ── User writes (D1–D2) ───────────────────────────────────────────────────────

/** D1 — disable / enable user (HIGH). App-enforced via profiles.active. */
export function setUserActive(userId, active, reason) {
  return callAdminWriteRpc("admin_set_user_active", {
    p_user_id: userId,
    p_active: active,
    p_reason: reason,
  });
}

/** D2 — beta toggle (LOW, audit-only). `reason` optional. */
export function setUserBeta(userId, isBeta, reason = null) {
  return callAdminWriteRpc("admin_set_user_beta", {
    p_user_id: userId,
    p_is_beta: isBeta,
    p_reason: reason,
  });
}
