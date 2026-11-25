import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { useAppStore } from "../store/appStore";

/**
 * #4490 06-W4 fix 2 (W4-D1) — a signed-in screen does not outlive the session.
 *
 * A forced sign-out (the session revoked on the server, signed out on another
 * device, a refresh token that expired) swaps the app root to the welcome
 * screen, but a route pushed on top of it (the venue page, a Purchases detail)
 * stays on screen with its cached reads removed: the device showed "Loading
 * venue…" forever and "This pass isn't on your account." to a signed-out
 * person. When the account a screen was opened for signs out, the screen goes
 * back to the app root (the welcome screen), like any signed-in-only route. A
 * stranger who opened the page signed out never had an account here, so
 * nothing moves for them. Signing in again as the same account brings a kept
 * venue checkout back (`venueCheckoutResume`).
 */
interface RouterLike {
  canGoBack?: () => boolean;
  dismissAll?: () => void;
  replace?: (path: string) => void;
}

/** Back to the app root: every pushed route dismissed, or the root put in place. */
export function returnToStart(router: unknown): void {
  try {
    const r = router as RouterLike;
    if (typeof r.canGoBack === "function" && r.canGoBack() && typeof r.dismissAll === "function") r.dismissAll();
    else if (typeof r.replace === "function") r.replace("/");
  } catch {
    // The root is already showing; nothing to leave.
  }
}

/** True when an account that was signed in is gone (signed out). Pure. */
export function signedOutSince(previousUserId: string | null, userId: string | null): boolean {
  return previousUserId !== null && userId === null;
}

export function useReturnToStartOnSignOut(): void {
  const router = useRouter();
  const userId = useAppStore((s) => s.user?.id ?? null);
  const previous = useRef<string | null>(userId);
  useEffect(() => {
    const was = previous.current;
    previous.current = userId;
    if (signedOutSince(was, userId)) returnToStart(router);
  }, [router, userId]);
}
