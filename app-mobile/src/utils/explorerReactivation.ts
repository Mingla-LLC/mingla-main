export interface DeletedExplorerProfile {
  explorer_deleted_at?: string | null;
}

export type ExplorerProfileResolution<T extends DeletedExplorerProfile> =
  | { kind: "active"; profile: T }
  | { kind: "reactivated"; profile: T }
  | { kind: "deleted_session" }
  | { kind: "reactivation_failed"; error: string };

let reactivationIntentDepth = 0;

/**
 * Brackets a user-initiated operation that can establish a new auth session.
 * Supabase also emits SIGNED_IN when an existing session is merely
 * re-established (for example on app focus), so the event name alone is not
 * proof that the user chose to return to Explorer.
 */
export async function withExplorerReactivationIntent<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  reactivationIntentDepth += 1;
  try {
    return await attempt();
  } finally {
    reactivationIntentDepth = Math.max(0, reactivationIntentDepth - 1);
  }
}

/**
 * Must be read synchronously inside onAuthStateChange. The auth method awaits
 * its subscribers before the bracket above closes; deferred profile work can
 * safely use the captured boolean afterward.
 */
export function captureExplorerReactivationIntentForAuthEvent(
  event: string,
): boolean {
  return event === "SIGNED_IN" && reactivationIntentDepth > 0;
}

/**
 * Supabase may deliver the subscription's delayed INITIAL_SESSION while an
 * explicit sign-in is still awaiting its SIGNED_IN subscribers. That passive
 * event must not sign a deleted Explorer side out from underneath the explicit
 * event that is authorized to reactivate it. Capture this synchronously; the
 * deferred profile work runs after the auth attempt's bracket has closed.
 */
export function shouldDeferDeletedExplorerSessionForAuthEvent(
  event: string,
): boolean {
  return event !== "SIGNED_IN" && reactivationIntentDepth > 0;
}

/**
 * #4202 — a retained Business/Creator login may return to Explorer, but an old
 * session must not silently undo account deletion. Only a SIGNED_IN event
 * captured during a user-initiated auth operation may clear the Explorer
 * deletion marker and begin fresh onboarding.
 */
export async function resolveExplorerProfileAfterAuthEvent<
  T extends DeletedExplorerProfile,
>(
  reactivationIntentConfirmed: boolean,
  profile: T,
  reactivate: () => PromiseLike<{
    data: T | null;
    error: { message?: string } | null;
  }>,
): Promise<ExplorerProfileResolution<T>> {
  if (!profile.explorer_deleted_at) {
    return { kind: "active", profile };
  }

  if (!reactivationIntentConfirmed) {
    return { kind: "deleted_session" };
  }

  try {
    const { data, error } = await reactivate();
    if (error || !data || data.explorer_deleted_at) {
      return {
        kind: "reactivation_failed",
        error: error?.message ?? "explorer_reactivation_incomplete",
      };
    }
    return { kind: "reactivated", profile: data };
  } catch (error) {
    return {
      kind: "reactivation_failed",
      error: error instanceof Error ? error.message : "explorer_reactivation_failed",
    };
  }
}
