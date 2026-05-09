import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface CreatorAccountUpdatePatch {
  display_name?: string;
  avatar_url?: string | null;
  marketing_opt_in?: boolean;
  default_brand_id?: string | null;
}

/**
 * Ensures a row exists in public.creator_accounts for the signed-in user.
 * Safe to call on every session / auth state change (idempotent upsert).
 */
export async function ensureCreatorAccount(user: User): Promise<void> {
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email?.split("@")[0] ||
    "Creator";

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ||
    (user.user_metadata?.picture as string | undefined) ||
    null;

  const { error } = await supabase.from("creator_accounts").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      display_name: displayName,
      avatar_url: avatarUrl,
    },
    { onConflict: "id", ignoreDuplicates: false }
  );

  // Const #3 (no silent failures): throw on error. Callers in AuthContext
  // bootstrap + onAuthStateChange wrap the call in try/catch and surface
  // via console.warn (matches the existing getSession error pattern).
  // ORCH-0743 / Note A: replaces the prior silent-swallow `if (error) {}`
  // that fired only on the diagnostic probe path.
  if (error) {
    throw error;
  }
}

/**
 * Update creator_accounts row by id. Throws on error (caller surfaces toast).
 *
 * Cycle 14 NEW per SPEC §4.4.1. Used by useUpdateCreatorAccount mutation
 * (src/hooks/useCreatorAccount.ts) for J-A1 edit-profile + J-A2 marketing
 * toggle double-wire flows.
 *
 * RLS: existing self-write UPDATE policy on creator_accounts (line 42-50 of
 * 20260404000001_creator_accounts.sql) permits auth.uid() = id.
 */
export async function updateCreatorAccount(
  userId: string,
  patch: CreatorAccountUpdatePatch,
): Promise<void> {
  const { data, error } = await supabase
    .from("creator_accounts")
    .update(patch)
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("updateCreatorAccount: no creator account row updated");
  }
}

export async function setCreatorDefaultBrand(
  userId: string,
  brandId: string | null,
): Promise<void> {
  await updateCreatorAccount(userId, { default_brand_id: brandId });
}
