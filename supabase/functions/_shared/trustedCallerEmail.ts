// ORCH-1108 loop-back fix [OAuth null-email] — trusted caller-email resolution.
//
// PROBLEM: Google-OAuth users can have `auth.users.email = NULL` while their
// verified email lives only on the OAuth identity row
// (`auth.identities.identity_data->>'email'` with `email_verified='true'`) and
// in `raw_user_meta_data`. The invite surface + accept/decline matched the
// caller off `userResult.user.email` only — NULL for these users → the invite
// never surfaced and accept/decline 403'd.
//
// TRUSTED CHAIN (in order):
//   1. `auth.users.email` (GoTrue-owned, already on the getUser() user object).
//   2. A VERIFIED OAuth identity email from `auth.identities` — provider-
//      asserted, GoTrue-written, NOT user-writable.
//
// EXPLICITLY UNTRUSTED — never used for the identity match:
//   - `raw_user_meta_data->>'email'` / `user_metadata.email`. These are
//     user-writable (the client can set arbitrary user_metadata), so trusting
//     them would let an attacker claim another person's invite. We deliberately
//     do NOT read user_metadata here.
//
// All emails are lower(trim(...))-normalized to match the stored (lowercased)
// invitation email.

/** A single `auth.identities` row's relevant fields (shape-agnostic). */
export interface IdentityLike {
  identity_data?: { email?: unknown; email_verified?: unknown } | null;
  // Some callers pass the flattened service-role projection
  // (select identity_data->>'email' as email, ... ).
  email?: unknown;
  email_verified?: unknown;
  last_sign_in_at?: unknown;
}

/** True when an identity value asserts a provider-verified email. */
function isVerified(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    return ["true", "t", "1"].includes(v.trim().toLowerCase());
  }
  return false;
}

function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * Pure: from a list of OAuth identities, return the first VERIFIED email
 * (lowercased) or "" if none. Accepts both the nested getUser() identity shape
 * (`identity_data.email` / `identity_data.email_verified`) and the flattened
 * service-role projection (`email` / `email_verified`). Ignores any identity
 * whose email is not provider-verified.
 */
export function pickVerifiedIdentityEmail(
  identities: ReadonlyArray<IdentityLike> | null | undefined,
): string {
  if (!Array.isArray(identities)) return "";
  for (const id of identities) {
    const data = (id?.identity_data ?? {}) as {
      email?: unknown;
      email_verified?: unknown;
    };
    const email = normalizeEmail(data.email ?? id?.email);
    const verified = isVerified(
      data.email_verified !== undefined ? data.email_verified : id?.email_verified,
    );
    if (email.length > 0 && verified) return email;
  }
  return "";
}

/**
 * Minimal service-client shape we need for the identities fallback query.
 * Deliberately permissive (the supabase-js builder is deeply generic; pinning
 * it triggers TS2589 "excessively deep" and shape-mismatch errors at the call
 * site). We only ever read `.schema().from().select().eq().order()`.
 */
// deno-lint-ignore no-explicit-any
type ServiceClientLike = any;

/**
 * Build a `fetchIdentities` function bound to a service-role client. Uses the
 * GoTrue ADMIN API (`auth.admin.getUserById`) — the repo-standard way to reach
 * auth data from edge fns (see send-otp / verify-otp / venue-claim) — which
 * returns the user's fully-populated `identities[]` (each with `identity_data`
 * incl. provider-asserted `email` + `email_verified`). This is more reliable
 * than a PostgREST `auth.identities` read (the `auth` schema is not exposed to
 * PostgREST) and than the JWT-derived getUser() identities (omitted on some
 * token paths). Returns [] (never throws) so the caller fails closed.
 */
export function makeAuthIdentitiesFetcher(
  service: ServiceClientLike,
): (userId: string) => Promise<ReadonlyArray<IdentityLike>> {
  return async (userId: string) => {
    try {
      const { data, error } = await service.auth.admin.getUserById(userId);
      if (error || !data?.user) return [];
      const ids = (data.user as { identities?: unknown }).identities;
      return Array.isArray(ids) ? (ids as IdentityLike[]) : [];
    } catch {
      return [];
    }
  };
}

/** Minimal shape of the getUser() user object we rely on. */
export interface AuthUserLike {
  id: string;
  email?: string | null;
  identities?: ReadonlyArray<IdentityLike> | null;
}

/**
 * Resolve the caller's TRUSTED email (lowercased) or "" if none can be trusted.
 *
 *   1. user.email (if present).
 *   2. a verified email off user.identities[] (populated by getUser()).
 *   3. a verified email off a service-role `auth.identities` query — used only
 *      when getUser() did not carry identities (some token/refresh paths omit
 *      them). `fetchIdentities` returns the flattened rows; pass undefined to
 *      skip the DB hop.
 *
 * NEVER consults user_metadata / raw_user_meta_data (user-writable).
 */
export async function resolveTrustedCallerEmail(
  user: AuthUserLike,
  fetchIdentities?: (userId: string) => Promise<ReadonlyArray<IdentityLike>>,
): Promise<string> {
  const direct = normalizeEmail(user?.email);
  if (direct.length > 0) return direct;

  const fromUserIdentities = pickVerifiedIdentityEmail(user?.identities);
  if (fromUserIdentities.length > 0) return fromUserIdentities;

  if (typeof fetchIdentities === "function" && user?.id) {
    try {
      const rows = await fetchIdentities(user.id);
      const fromQuery = pickVerifiedIdentityEmail(rows);
      if (fromQuery.length > 0) return fromQuery;
    } catch {
      // Fail closed — an identities query failure resolves to no trusted email.
    }
  }

  return "";
}
