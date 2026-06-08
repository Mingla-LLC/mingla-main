/**
 * storedWebSession — ORCH-1100 Wave 3.
 *
 * Shared, side-effect-free probe for "is there a Supabase auth session token
 * persisted in this web browser's localStorage right now?". Used to tell the
 * cold-direct-load WARMING window (a stored session exists, GoTrue just hasn't
 * applied it to `user` yet) apart from a GENUINELY logged-out user (no token).
 *
 * On a cold reload of a deep authed route (/account, /brand/{id}, …) the 3s
 * auth bootstrap can time out and flip `loading`→false while `user` is still
 * null, because the persisted session restores a beat later (late SIGNED_IN /
 * TOKEN_REFRESHED). Route auth-gates that key only off `user === null` then
 * flash the signed-out / not-found branch. Gating those branches additionally
 * on "no stored session" makes them show a LOADING state during the warming
 * window while still rendering correctly for real logged-out users.
 *
 * Native (iOS/Android) has no `window.localStorage`; this returns false there,
 * which is correct — native never runs the web signed-out recovery gate.
 *
 * Mirrors the original local helper in app/_layout.tsx (ORCH-1092); extracted
 * here so app/_layout.tsx and the (tabs)/account route share one definition.
 */

import { Platform } from "react-native";

// Supabase persists its session under a key shaped `sb-<ref>-auth-token`.
const SUPABASE_AUTH_STORAGE_KEY = /^sb-.+-auth-token$/;

export function hasStoredSupabaseWebSession(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    const { localStorage } = window;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || !SUPABASE_AUTH_STORAGE_KEY.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null && value.includes("access_token")) return true;
    }
  } catch {
    return false;
  }
  return false;
}
