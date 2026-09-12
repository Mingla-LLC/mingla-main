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
import * as Sentry from "../diagnostics/sentry";

/**
 * #3259 P3-3 — the in-flight sign-out, MODULE-scoped rather than a `useRef`.
 *
 * Two reasons it belongs here and not in a ref. Signing out is a single
 * APP-WIDE teardown (clearAllStores, queryClient.clear, and the AppsFlyer /
 * Mixpanel / PostHog / RevenueCat / OneSignal identity resets), so "is a
 * sign-out running" is a property of the app, not of one mounted screen — two
 * screens cannot meaningfully sign out concurrently. And this hook is called by
 * screens that the node-env suites invoke as plain functions, where `useRef`
 * throws for want of a React dispatcher.
 *
 * Cleared in a `finally`, so a REJECTED sign-out re-arms the button instead of
 * wedging it (measured before the fix: two taps ran the whole teardown twice).
 */
let signOutInFlight: Promise<void> | null = null;

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

  // Stage 1 — does this session carry an email at all?
  const sessionEmail =
    isAuthReady && typeof user?.email === "string" && user.email.length > 0
      ? user.email
      : null;
  // Stage 2 — #3259 P3-1. Is it an ADDRESS, or just blanks? A whitespace-only
  // value is a non-empty string, so stage 1 passes it and the card renders
  // "You're signed in as    ." — an identity block that names nobody.
  const signedInEmail =
    sessionEmail !== null && sessionEmail.trim().length > 0 ? sessionEmail : null;

  const onSwitchAccount = async (): Promise<void> => {
    // NO haptic here: the `Button` primitive already fires
    // `HapticFeedback.buttonPress()` on press-down, so a second call would
    // double-fire — and importing the helper would drag `expo-haptics` (ESM)
    // into every node-env suite that merely loads a host screen.

    // #3259 P3-3 — a second tap JOINS the running sign-out instead of starting
    // another one. Returning the same promise keeps the caller's `await`
    // meaningful: it still resolves exactly when the navigation has happened.
    if (signOutInFlight !== null) return signOutInFlight;

    const run = (async (): Promise<void> => {
      try {
        // THE ORDERING. Sign out FIRST, and WAIT for it.
        await signOut();
      } catch (error) {
        // #3259 P3-4 — `signOut()` does far more than call supabase: it runs
        // clearAllStores, clears the query cache and resets five analytics
        // identities. Any of those can throw AFTER the session is already gone,
        // which strands the user signed out, un-navigated, and staring at a
        // card naming an account they are no longer in. Surface it, then
        // RE-THROW: swallowing it here would let the navigation below run with
        // a live session and start the /auth bounce loop.
        Sentry.captureException(error, {
          tags: { feature: "switch-account", issue: "3259" },
        });
        console.error("[#3259] switch-account sign-out failed", error);
        throw error;
      }
      router.replace("/auth" as never);
    })();

    signOutInFlight = run;
    try {
      await run;
    } finally {
      signOutInFlight = null;
    }
  };

  return { signedInEmail, onSwitchAccount };
}
