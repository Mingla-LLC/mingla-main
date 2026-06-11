import type { User } from "@supabase/supabase-js";

/**
 * ORCH-1110: single source of truth for "the best real email for this user".
 *
 * The GoTrue JS SDK serializes a NULL `auth.users.email` as the empty string
 * `""` on `User.email`. A bare `user.email ?? null` therefore leaks `""` into
 * consumers (provisioning seed, the delete-account gate), which traps the
 * confirmation screen forever and persists empty-string emails. This helper
 * treats empty-string / whitespace-only as ABSENT and falls back to the real
 * email carried in `user_metadata.email` or an identity's `identity_data.email`.
 *
 * Resolution order (first non-empty after trim wins):
 *   1. user.email
 *   2. user.user_metadata?.email
 *   3. user.identities[…].identity_data?.email (first identity with a real email)
 *
 * Returns a non-empty, trimmed email, or `null` when no real email exists.
 * Does NOT lowercase — preserves the user's display casing for the "YOUR EMAIL"
 * box; case-insensitivity is applied only at the comparison site.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-1110_blank-email-undeletable-account.md §4.1
 */
const cleaned = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

export function resolveUserEmail(user: User | null): string | null {
  if (user === null) return null;

  const direct = cleaned(user.email);
  if (direct !== null) return direct;

  const metadata = cleaned(
    (user.user_metadata as { email?: unknown } | undefined)?.email,
  );
  if (metadata !== null) return metadata;

  const identities = user.identities ?? [];
  for (const identity of identities) {
    const identityEmail = cleaned(
      (identity?.identity_data as { email?: unknown } | undefined)?.email,
    );
    if (identityEmail !== null) return identityEmail;
  }

  return null;
}

/**
 * ORCH-1110: pure, unit-testable gate logic for delete.tsx Step 3.
 *
 * Two modes:
 *   - "email": a real email is resolvable → typed input must non-empty and
 *     case-insensitively equal the resolved email.
 *   - "keyword": no real email resolvable → typed input must case-insensitively
 *     equal the DELETE keyword so the destructive action stays reachable.
 *
 * In BOTH modes an empty / whitespace-only input returns false (never
 * mis-enables delete). This is the fails-on-revert anchor for T-G1/T-A1/T-A2.
 *
 * Spec §4.3.1 / §8 testability note.
 */
export const DELETE_KEYWORD = "DELETE";

export function computeConfirmMatches(
  mode: "email" | "keyword",
  resolvedEmail: string | null,
  typed: string,
): boolean {
  const trimmed = typed.trim();
  if (trimmed.length === 0) return false; // blank input NEVER enables delete
  if (mode === "keyword") {
    return trimmed.toUpperCase() === DELETE_KEYWORD;
  }
  // email mode: a resolved email must exist to match against
  if (resolvedEmail === null) return false;
  return trimmed.toLowerCase() === resolvedEmail.toLowerCase();
}
