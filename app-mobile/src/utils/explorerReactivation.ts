export interface DeletedExplorerProfile {
  explorer_deleted_at?: string | null;
}

export type ExplorerProfileResolution<T extends DeletedExplorerProfile> =
  | { kind: "active"; profile: T }
  | { kind: "reactivated"; profile: T }
  | { kind: "deleted_session" }
  | { kind: "reactivation_failed"; error: string };

let reactivationIntentDepth = 0;
let reactivationIntentGeneration = 0;

/**
 * Brackets a user-initiated operation that can establish a new auth session.
 * Supabase also emits SIGNED_IN when an existing session is merely
 * re-established (for example on app focus), so the event name alone is not
 * proof that the user chose to return to Explorer.
 */
export async function withExplorerReactivationIntent<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  reactivationIntentGeneration += 1;
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
 * Read at the point a passive profile path is about to sign out. Explicit
 * sign-in now keeps the bracket open through its bearer-backed profile PATCH,
 * so an older shared-client read cannot tear down that session mid-repair.
 */
export function isExplorerReactivationIntentActive(): boolean {
  return reactivationIntentDepth > 0;
}

/** Capture before a passive profile read begins. If a user-driven sign-in
 * starts afterward, that older read is no longer allowed to sign the session
 * out even when the explicit PATCH has already completed. */
export function captureExplorerReactivationGeneration(): number {
  return reactivationIntentGeneration;
}

export function shouldDeferDeletedExplorerSessionSince(
  capturedGeneration: number,
): boolean {
  return reactivationIntentDepth > 0 ||
    capturedGeneration !== reactivationIntentGeneration;
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

/**
 * Run the read/PATCH pair inside the explicit sign-in operation itself. The
 * auth listener still mirrors this as a recovery path, but it is no longer the
 * only place a deleted Explorer side can be reactivated.
 */
export async function reactivateExplorerProfileForExplicitSession<
  T extends DeletedExplorerProfile,
>(
  readProfile: () => PromiseLike<{
    data: T | null;
    error: { message?: string } | null;
  }>,
  reactivate: () => PromiseLike<{
    data: T | null;
    error: { message?: string } | null;
  }>,
): Promise<ExplorerProfileResolution<T>> {
  try {
    const { data, error } = await readProfile();
    if (error || !data) {
      return {
        kind: "reactivation_failed",
        error: error?.message ?? "explorer_profile_unavailable",
      };
    }
    return resolveExplorerProfileAfterAuthEvent(true, data, reactivate);
  } catch (error) {
    return {
      kind: "reactivation_failed",
      error: error instanceof Error ? error.message : "explorer_profile_unavailable",
    };
  }
}
