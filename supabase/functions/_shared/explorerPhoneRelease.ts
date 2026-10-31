import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export class ExplorerPhoneReleaseError extends Error {
  readonly code = "explorer_phone_release_failed";
  readonly stage:
    | "auth_update"
    | "auth_readback"
    | "auth_still_attached"
    | "profile_update";

  constructor(stage: ExplorerPhoneReleaseError["stage"]) {
    super(`explorer_phone_release_failed:${stage}`);
    this.name = "ExplorerPhoneReleaseError";
    this.stage = stage;
  }
}

/**
 * #4202 — releasing a phone is part of Explorer deletion, not best-effort
 * cleanup. The Business login and email deliberately survive, but the deleted
 * Explorer identity must not keep either auth.users.phone or a phone identity.
 *
 * Auth is cleared and read back before profiles.phone. If any auth step fails,
 * the caller must return a deletion failure. A retry is safe: clearing an
 * already-empty auth phone and then the profile phone is idempotent.
 */
export async function clearExplorerPhoneForReuse(
  adminClient: SupabaseClient,
  userId: string,
  userPhone: string | null,
): Promise<void> {
  if (!userPhone) return;

  const { error: authUpdateError } = await adminClient.auth.admin
    .updateUserById(
      userId,
      { phone: "" },
    );
  if (authUpdateError) {
    throw new ExplorerPhoneReleaseError("auth_update");
  }

  const { data: authReadback, error: authReadbackError } = await adminClient
    .auth.admin
    .getUserById(userId);
  if (authReadbackError || !authReadback?.user) {
    throw new ExplorerPhoneReleaseError("auth_readback");
  }

  const authPhoneSurvives = typeof authReadback.user.phone === "string" &&
    authReadback.user.phone.trim() !== "";
  const phoneIdentitySurvives = (authReadback.user.identities ?? []).some((
    identity,
  ) => identity.provider === "phone");
  if (authPhoneSurvives || phoneIdentitySurvives) {
    throw new ExplorerPhoneReleaseError("auth_still_attached");
  }

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update({ phone: null })
    .eq("id", userId);
  if (profileUpdateError) {
    throw new ExplorerPhoneReleaseError("profile_update");
  }
}
