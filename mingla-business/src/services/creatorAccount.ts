import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface CreatorAccountStatus {
  onboardingCompleted: boolean;
  onboardingStep: number;
  firstName: string | null;
  intent: "place" | "events" | "both" | null;
}

/**
 * Ensures a row exists in public.creator_accounts for the signed-in user.
 * Safe to call on every session / auth state change (idempotent).
 *
 * IMPORTANT: We do NOT upsert display_name/avatar on every call — that would
 * overwrite the name the user entered during onboarding with OAuth metadata.
 * Instead: INSERT if not exists (with OAuth defaults), then SELECT status.
 */
export async function ensureCreatorAccount(
  user: User
): Promise<CreatorAccountStatus> {
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email?.split("@")[0] ||
    "Creator";

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ||
    (user.user_metadata?.picture as string | undefined) ||
    null;

  // INSERT only if row doesn't exist — never overwrite user-entered data
  const { error } = await supabase.from("creator_accounts").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      display_name: displayName,
      avatar_url: avatarUrl,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  if (error) {
    console.warn("[creator_accounts] upsert failed:", error.message);
  }

  // Always update email (it can change via OAuth) but NOT display_name
  await supabase
    .from("creator_accounts")
    .update({ email: user.email ?? null })
    .eq("id", user.id);

  // Fetch onboarding status
  const { data, error: fetchError } = await supabase
    .from("creator_accounts")
    .select("onboarding_completed, onboarding_step, first_name, intent")
    .eq("id", user.id)
    .single();

  if (fetchError || !data) {
    console.warn("[creator_accounts] fetch failed:", fetchError?.message);
    return {
      onboardingCompleted: false,
      onboardingStep: 0,
      firstName: null,
      intent: null,
    };
  }

  return {
    onboardingCompleted: data.onboarding_completed ?? false,
    onboardingStep: data.onboarding_step ?? 0,
    firstName: data.first_name ?? null,
    intent: data.intent as CreatorAccountStatus["intent"],
  };
}

/**
 * Update specific fields on the creator account. Used by onboarding steps.
 */
export async function updateCreatorAccount(
  userId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("creator_accounts")
    .update(fields)
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to update account: ${error.message}`);
  }
}

/**
 * Delete the creator account and the underlying auth user.
 * This is irreversible. The auth.users CASCADE will clean up the creator_accounts row.
 */
export async function deleteCreatorAccount(userId: string): Promise<void> {
  // Delete the auth user — CASCADE deletes creator_accounts row
  const { error } = await supabase.functions.invoke("delete-user", {
    body: { user_id: userId },
  });

  if (error) {
    throw new Error("Couldn't delete account. Please try again.");
  }
}
