/**
 * useSwitchAccount — the one place the wrong-account escape is implemented
 * (#3259 [a wrong account reads as a crash]).
 *
 * Every screen that can show a signed-in user "we can't show you this" needs
 * the same two things: the email to name, and a working way out. Both are
 * small, and both have a trap in them, so they live here once rather than
 * eleven times.
 *
 * TRAP 1 — THE EMAIL MUST BE NULL UNTIL AUTH IS READY. Reading `user.email`
 * before `isAuthReady` paints an identity block that disappears a frame later.
 * Callers get `null` in that window and render nothing.
 *
 * TRAP 2 — THE SIGN-OUT MUST COMPLETE BEFORE THE NAVIGATION. `/auth`'s resume
 * effect fires whenever `!loading && user`, so navigating there while still
 * signed in bounces straight back and re-fails as the SAME account: an infinite
 * loop. `app/accept-brand-invitation.tsx` documents this from the invite flow;
 * the `await` below is the same fix. It is not a style preference — drop it and
 * the recovery action becomes a no-op that looks like a hang.
 *
 * TARGET IS PLAIN `/auth`, deliberately. No `?next=` resume is built:
 * `sanitizeNextRoute` (`src/utils/nextRoute.ts`) allowlists only the
 * invite/create/brand/offering prefixes, and the screens that use this hook are
 * route misses and empty rows — there is no destination worth resuming to.
 * I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE: no new redirector.
 */

import { useRouter } from "expo-router";

import { useAuth } from "../context/AuthContext";

export interface SwitchAccountBinding {
  /**
   * The signed-in account's email, or null when signed out, when the session
   * carries no email, or when auth has not resolved yet. Pass it straight to
   * `SignedInNotFoundNotice`, which renders nothing for null.
   */
  signedInEmail: string | null;
  /** Signs out, THEN navigates to sign-in. Await-ordered; see TRAP 2. */
  onSwitchAccount: () => Promise<void>;
}

export function useSwitchAccount(): SwitchAccountBinding {
  const router = useRouter();
  const { user, isAuthReady, signOut } = useAuth();

  const signedInEmail =
    isAuthReady && typeof user?.email === "string" && user.email.length > 0
      ? user.email
      : null;

  const onSwitchAccount = async (): Promise<void> => {
    // NO haptic here: the `Button` primitive already fires
    // `HapticFeedback.buttonPress()` on press-down, so a second call would
    // double-fire — and importing the helper would drag `expo-haptics` (ESM)
    // into every node-env suite that merely loads a host screen.
    // THE ORDERING. Sign out FIRST, and WAIT for it.
    await signOut();
    router.replace("/auth" as never);
  };

  return { signedInEmail, onSwitchAccount };
}
