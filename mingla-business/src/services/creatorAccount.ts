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
    { onConflict: "id" }
  );

  if (error) {
    console.warn("[creator_accounts] upsert failed:", error.message);
  }
}
