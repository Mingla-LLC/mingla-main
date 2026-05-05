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

  if (error) {
    console.warn("[creator_accounts] upsert failed:", error.message);
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
  const { error } = await supabase
    .from("creator_accounts")
    .update(patch)
    .eq("id", userId);
  if (error) throw error;
}
