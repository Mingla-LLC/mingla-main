/**
 * #2099 — Business WEB-ONLY correction RPC owner.
 *
 * SPEC + Amendments 1–5, §D2. This module holds ONLY the two typed RPC calls
 * and the correction types. It is deliberately NOT re-exported from the shared
 * `venueListingsService.ts`, so neither the native import graph nor the eager
 * web boot chunk can reach the correction RPCs through an already-eager module.
 *
 * The database is the single mutation owner (Amendment 1 §A1): these functions
 * add no eligibility logic, no fallbacks, and no direct table writes. Errors
 * are thrown, never swallowed (Constitution #3) — the dialog owns user-facing
 * copy and maps only the server's safe codes.
 */

import { supabase } from "./supabase";
import type { VenueCategory } from "../types/brand";

/** The canonical venue-category domain; the server re-validates it. */
export type PendingVenueIdentityCorrectionCategory = VenueCategory;

export interface PendingVenueIdentityDependencyCount {
  safe_label: string;
  count: number;
  classification: string;
}

export interface PendingVenueIdentityPreview {
  ok: boolean;
  eligible: boolean;
  code: string | null;
  venue_id: string;
  brand_id: string;
  place_pool_id: string;
  current: {
    name: string;
    slug: string;
    category: PendingVenueIdentityCorrectionCategory;
    updated_at: string;
  };
  schema_fingerprint: string;
  state_fingerprint: string;
  dependency_counts: PendingVenueIdentityDependencyCount[];
  safe_fields?: string[];
}

export interface CorrectPendingVenueIdentityInput {
  preview: PendingVenueIdentityPreview;
  name: string;
  slug: string;
  category: PendingVenueIdentityCorrectionCategory;
  reason: string;
  requestId: string;
}

export interface CorrectPendingVenueIdentityResult {
  ok: boolean;
  code?: string;
  audit_id?: string;
}

export async function previewPendingVenueIdentityCorrection(
  venueId: string,
): Promise<PendingVenueIdentityPreview> {
  const { data, error } = await supabase.rpc("preview_pending_venue_identity_correction", {
    p_venue_id: venueId,
  });
  if (error !== null) throw error;
  return data as PendingVenueIdentityPreview;
}

/**
 * FORWARD ONLY, and deliberately so.
 *
 * [TRANSITIONAL] the RPC implements `p_mode='rollback'` (Amendment 1 §A5) and it
 * is proven to work end to end, but NO surface can invoke it and this client
 * does not pretend otherwise. Two things are missing and neither is an
 * implementation detail:
 *   1. no amendment specifies a rollback UI — there is no eligibility rule, no
 *      entry point, no copy, no confirmation semantics (what would the Admin
 *      `confirmPhrase` be for a rollback?), no state matrix and no a11y
 *      contract. §D3 and §E1 specify the CORRECTION flow only;
 *   2. an owner cannot obtain `p_source_audit_id`: reading
 *      `venue_identity_correction_audit` correctly returns 42501 to an
 *      authenticated session, so the preview RPC would have to return the
 *      rollback handle — a change to the server contract, not to this file.
 * EXIT CONDITION: a reviewed amendment either specifies the rollback surface
 * (then this function gains a mode parameter and the preview gains the handle)
 * or rules the rollback leg out of §D6's surface requirement. Until then this
 * signature cannot express a rollback, which is the honest shape.
 */
export async function correctPendingVenueIdentity(
  input: CorrectPendingVenueIdentityInput,
): Promise<CorrectPendingVenueIdentityResult> {
  const p = input.preview;
  const { data, error } = await supabase.rpc("correct_pending_venue_identity", {
    p_venue_id: p.venue_id,
    p_expected_brand_id: p.brand_id,
    p_expected_place_pool_id: p.place_pool_id,
    p_expected_updated_at: p.current.updated_at,
    p_expected_name: p.current.name,
    p_expected_slug: p.current.slug,
    p_expected_category: p.current.category,
    p_new_name: input.name.trim(),
    p_new_slug: input.slug.trim(),
    p_new_category: input.category,
    p_reason: input.reason.trim(),
    p_request_id: input.requestId,
    p_expected_schema_fingerprint: p.schema_fingerprint,
    p_expected_state_fingerprint: p.state_fingerprint,
    p_mode: "forward",
    p_source_audit_id: null,
  });
  if (error !== null) throw error;
  return data as CorrectPendingVenueIdentityResult;
}
