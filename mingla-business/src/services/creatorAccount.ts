import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

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
  patch: {
    display_name?: string;
    avatar_url?: string | null;
    marketing_opt_in?: boolean;
  },
): Promise<void> {
  // ORCH-0734-RW side discovery D-IMPL-0734-RW-1: this function needs rowcount
  // verification (same RC-0734-RW-A bug class as softDeleteBrand pre-fix; a 0-row
  // UPDATE here returns silent success). TEMPORARY waiver pending a follow-up
  // ORCH-ID that dispatches the small fix: chain `.select("id")`, throw on
  // data===null or data.length===0 — same pattern as softDeleteBrand step 2.
  const { error } = await supabase
    .from("creator_accounts")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0734-RW-FOLLOWUP — temporary; tracked as D-IMPL-0734-RW-1
    .update(patch)
    .eq("id", userId);
  if (error) throw error;
}
