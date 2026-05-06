/**
 * brandsService — Supabase brand CRUD service layer (Cycle 17e-A).
 *
 * Wires create + read + update + soft-delete against `public.brands` with the
 * new 6 columns (kind/address/cover_hue/cover_media_url/cover_media_type/
 * profile_photo_type) added by migration 20260506000000.
 *
 * Per SPEC §3.2 verbatim. Closes forensics F-A (root cause: phone-only CRUD)
 * + F-B (root cause: unused mapper exports). Mappers in brandMapping.ts now
 * have their first consumer.
 *
 * Error contract per Const #3 + `feedback_supabase_neq_null`:
 *   - All reads filter `.is("deleted_at", null)` (NEVER `.neq()`)
 *   - All services throw on Postgrest error
 *   - createBrand throws SlugCollisionError on 23505 unique_violation
 *   - softDeleteBrand returns SoftDeleteRejection (not throw) on workflow rejection
 *
 * Mutation pattern per Decision 10 (DEC-109):
 *   - createBrand + updateBrand: hook layer applies optimistic
 *   - softDeleteBrand: hook layer is pessimistic (avoid show-then-restore on rejection)
 */

import { supabase } from "./supabase";
import {
  mapBrandRowToUi,
  mapUiToBrandInsert,
  mapUiToBrandUpdatePatch,
  joinBrandDescription,
  type BrandRow,
} from "./brandMapping";
import type { Brand, BrandRole } from "../store/currentBrandStore";

/**
 * Thrown by `createBrand` when slug collides with an existing non-deleted brand
 * (Postgrest 23505 unique_violation on `idx_brands_slug_active`).
 *
 * Hook layer maps this to inline form error per Decision 11 (DEC-109).
 */
export class SlugCollisionError extends Error {
  constructor(public attemptedSlug: string) {
    super(`Brand slug "${attemptedSlug}" is already taken by an active brand.`);
    this.name = "SlugCollisionError";
  }
}

// ----- Inputs / Results --------------------------------------------------

export interface CreateBrandInput {
  accountId: string;
  name: string;
  slug: string;
  kind: "physical" | "popup";
  address: string | null;
  coverHue: number;
  // Optional initial fields:
  bio?: string;
  tagline?: string;
  contact?: { email?: string; phone?: string };
  links?: Brand["links"];
}

export interface SoftDeleteRejection {
  rejected: true;
  reason: "upcoming_events";
  upcomingEventCount: number;
}
export interface SoftDeleteSuccess {
  rejected: false;
  brandId: string;
}
export type SoftDeleteResult = SoftDeleteSuccess | SoftDeleteRejection;

// ----- createBrand -------------------------------------------------------

export async function createBrand(
  input: CreateBrandInput,
  role: BrandRole,
): Promise<Brand> {
  const insertPayload = mapUiToBrandInsert({
    accountId: input.accountId,
    brand: {
      displayName: input.name,
      slug: input.slug,
      kind: input.kind,
      address: input.address,
      coverHue: input.coverHue,
      bio: input.bio,
      tagline: input.tagline,
      contact: input.contact,
      links: input.links,
    },
  });

  const { data, error } = await supabase
    .from("brands")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new SlugCollisionError(input.slug);
    }
    throw error;
  }
  if (data === null) {
    throw new Error("createBrand: insert returned null row");
  }

  return mapBrandRowToUi(data as BrandRow, { role });
}

// ----- getBrands (list) --------------------------------------------------

export async function getBrands(accountId: string): Promise<Brand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as BrandRow[]).map((row) =>
    // Default role "owner" — useCurrentBrandRole resolves real role per brand.
    // Service layer cannot know caller's role per-brand without a join.
    mapBrandRowToUi(row, { role: "owner" }),
  );
}

// ----- getBrand (single) -------------------------------------------------

export async function getBrand(brandId: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (data === null) return null;
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}

// ----- updateBrand -------------------------------------------------------

export async function updateBrand(
  brandId: string,
  patch: Partial<Brand>,
  existingDescription: string | null,
): Promise<Brand> {
  const updatePayload = mapUiToBrandUpdatePatch(patch, { existingDescription });

  // Defensive: empty patch is no-op — return existing row instead of UPDATE
  // with empty SET (which Postgres rejects with syntax error)
  if (Object.keys(updatePayload).length === 0) {
    const existing = await getBrand(brandId);
    if (existing === null) {
      throw new Error("updateBrand: brand not found or soft-deleted");
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("brands")
    .update(updatePayload)
    .eq("id", brandId)
    .is("deleted_at", null) // defensive — RLS already prevents update of soft-deleted
    .select()
    .single();

  if (error) throw error;
  if (data === null) {
    throw new Error(
      "updateBrand: update returned null row (possibly soft-deleted concurrently)",
    );
  }
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}

// ----- softDeleteBrand ---------------------------------------------------

/**
 * Soft-deletes a brand via `UPDATE brands SET deleted_at = now()`.
 *
 * Three-step workflow:
 *   1. Count upcoming + live events for this brand. If > 0, return rejection
 *      (workflow rejection, NOT thrown — UI handles via reject-modal per
 *      Decision 11).
 *   2. UPDATE brands SET deleted_at = <now>. Idempotent — `.is("deleted_at", null)`
 *      makes re-deletes no-ops at the SQL layer.
 *   3. Clear `creator_accounts.default_brand_id` if matches (R-3 / F-H mitigation
 *      per I-PROPOSED-B). Failure here is non-fatal — soft-delete itself succeeded.
 *
 * Per SPEC §3.2.7. NEVER swallows error per Const #3.
 */
export async function softDeleteBrand(brandId: string): Promise<SoftDeleteResult> {
  // Step 1 — count upcoming OR live events (assumption A-1: events.status enum
  // includes 'upcoming' + 'live'). If enum differs, this returns wrong count;
  // verified at IMPL pre-flight.
  const { count, error: countError } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .in("status", ["upcoming", "live"])
    .is("deleted_at", null);

  if (countError) throw countError;

  if (count !== null && count > 0) {
    // Workflow rejection — NOT thrown; UI handles via modal
    return {
      rejected: true,
      reason: "upcoming_events",
      upcomingEventCount: count,
    };
  }

  // Step 2 — soft-delete via UPDATE with rowcount verification.
  // Chains .select("id") to verify exactly 1 row was updated. Without this
  // verification, supabase-js silently returns success when 0 rows match
  // (RLS denial, wrong brandId, already-soft-deleted) — the bug closed by
  // ORCH-0734 REWORK. The .select() chain is safe post-ORCH-0734-v1: the
  // "Account owner can select own brands" policy admits the post-update
  // row regardless of deleted_at state.
  const nowIso = new Date().toISOString();
  // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
  // eslint-disable-next-line no-console
  console.error("[ORCH-0734-RW-DIAG] softDeleteBrand step 2 — UPDATE ATTEMPT", {
    brandId,
    nowIso,
  });
  const { data, error: updateError } = await supabase
    .from("brands")
    .update({ deleted_at: nowIso })
    .eq("id", brandId)
    .is("deleted_at", null) // defensive idempotency
    .select("id");

  if (updateError) throw updateError;
  // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
  // eslint-disable-next-line no-console
  console.error("[ORCH-0734-RW-DIAG] softDeleteBrand step 2 — UPDATE RESULT", {
    brandId,
    rowCount: data?.length ?? 0,
    expected: 1,
  });
  if (data === null || data.length === 0) {
    throw new Error(
      "softDeleteBrand: 0 rows updated — brand may not exist, may already be soft-deleted, or RLS denied. brandId=" +
        brandId,
    );
  }

  // Step 3 — clear default_brand_id pointer if matches (I-PROPOSED-B per SPEC §5.2).
  // ORCH-0734 fire-and-forget cleanup — idempotent by design. If 0 rows match
  // (user didn't have this brand as default), that's the expected NORMAL case.
  // Step 2 already verified the brand soft-delete; step 3 is non-fatal cleanup.
  const { error: clearDefaultError } = await supabase
    .from("creator_accounts")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0734 fire-and-forget cleanup, idempotent
    .update({ default_brand_id: null })
    .eq("default_brand_id", brandId);

  if (clearDefaultError) {
    // Soft-delete already succeeded — log + continue (non-fatal)
    // Const #3: don't swallow silently — surface to console
    console.warn(
      "[softDeleteBrand] clear default_brand_id failed:",
      clearDefaultError.message,
    );
  }

  return { rejected: false, brandId };
}

// ----- Helper re-export --------------------------------------------------

// Re-export for hook-layer convenience when computing existingDescription
// for updateBrand calls.
export { joinBrandDescription };
