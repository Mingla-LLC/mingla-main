/**
 * authNextHandoff — ORCH-1375 [`?next=` resume path]. The sessionStorage
 * hand-off that carries a resume target across the OAuth round-trip.
 *
 * ─── THE PROBLEM THIS EXISTS FOR (SPEC §4.3.2 — the spec's most important
 *     architectural correction) ───────────────────────────────────────────────
 * On the EMAIL-OTP path, `signInWithOtp` + `verifyEmailOtp` never navigate the
 * page, so `?next=` survives in the `/auth` URL and could simply be read there.
 *
 * On the OAUTH path it CANNOT. The browser leaves the page entirely:
 *     /auth?next=X → Google → Supabase → /auth/callback#access_token=…
 * and `AuthContext.buildWebRedirectTo()` returns a BARE `${origin}/auth/callback`
 * with NO query params. So `next` — which lives only in the `/auth` URL — is
 * DESTROYED at the `signInWithOAuth` call, before `/auth/callback` ever exists.
 *
 * An implementor who wires only `auth/index.tsx` therefore ships a resume that
 * works for email and SILENTLY DROPS THE TOKEN FOR EVERY GOOGLE/APPLE INVITEE —
 * reintroducing, through the back door, the exact silent-drop failure this whole
 * ORCH exists to prevent. This module is the leg that makes SC-4 pass.
 *
 * ─── WHY sessionStorage AND NOT `redirectTo` THREADING ─────────────────────
 *  1. Threading `next` into `redirectTo` requires the SUPABASE DASHBOARD
 *     Redirect-URL ALLOWLIST to accept the new URL shape — an operator/config
 *     dependency outside this PR and outside CI's reach. A mismatch fails
 *     SILENTLY AT THE PROVIDER, which is precisely the class of failure this
 *     ORCH exists to kill.
 *  2. sessionStorage is PER-TAB and survives a same-tab redirect — exactly the
 *     lifetime required. It cannot leak across tabs, and it does not persist
 *     after the browser closes (unlike localStorage).
 *  3. It needs NO change to signInWithGoogle / signInWithApple signatures → no
 *     blast radius into every other sign-in caller.
 *
 * ─── SECURITY ──────────────────────────────────────────────────────────────
 * sessionStorage is same-origin WRITABLE, so anything read back is UNTRUSTED
 * INPUT exactly like a URL param. Every consumer RE-VALIDATES through
 * `sanitizeNextRoute` — this module never validates on read, it only stores and
 * returns raw. Storing is gated on the caller having already sanitized.
 */

/** Per-tab key. Namespaced so it can never collide with Supabase's own keys. */
export const AUTH_NEXT_STORAGE_KEY = "mingla.biz.auth.next";

const storage = (): Storage | null => {
  // SSR / native / privacy-mode: all legitimately storage-less. Never throw.
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    // Safari in some privacy configurations throws on mere property access.
    return null;
  }
};

/**
 * Persist an ALREADY-SANITIZED resume target for the round-trip.
 * Passing `null` (i.e. absent or rejected by the validator) CLEARS any stale
 * value rather than leaving it armed — a `next` from a previous, unrelated
 * sign-in attempt must never resurrect.
 */
export const captureNextRoute = (sanitized: string | null): void => {
  const s = storage();
  if (s === null) return;
  try {
    if (sanitized === null) {
      s.removeItem(AUTH_NEXT_STORAGE_KEY);
      return;
    }
    s.setItem(AUTH_NEXT_STORAGE_KEY, sanitized);
  } catch {
    // Quota / disabled storage. Resume degrades to "go home" — never a crash,
    // and never a silent redirect to an unvalidated place.
  }
};

/**
 * Read AND clear the stored value — CONSUME-ONCE (SPEC §4.3.3 step 4).
 *
 * The clear happens on read, before the caller decides whether to use it, so a
 * value is burned whether the consumption SUCCEEDS or is REJECTED by
 * re-validation. A stale `next` must never resume a later, unrelated sign-in.
 *
 * Returns the RAW stored string — the caller MUST re-validate it through
 * `sanitizeNextRoute` (sessionStorage is same-origin writable).
 */
export const consumeNextRoute = (): string | null => {
  const s = storage();
  if (s === null) return null;
  try {
    const raw = s.getItem(AUTH_NEXT_STORAGE_KEY);
    s.removeItem(AUTH_NEXT_STORAGE_KEY);
    return raw;
  } catch {
    return null;
  }
};
