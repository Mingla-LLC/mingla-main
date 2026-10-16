/**
 * #3720 — hold an authenticated push navigation target until Host startup
 * navigation has settled.
 *
 * Cold-start race (production OTA smoke 2026-10-16): OneSignal click replay
 * called `router.push(Community → Roadmap)` as soon as the root subscriber
 * mounted, while `app/index.tsx` still replaced `/` with Home. Home won, so
 * the tap opened Host but never landed on Roadmap.
 *
 * Module-level (not React state) so the click path and the flush effect share
 * one pending target without remount races. At most one held target; a newer
 * tap replaces an older one.
 */

export type BusinessPushLaunchTarget = string;

let _pendingLaunchTarget: BusinessPushLaunchTarget | null = null;

/** True while Host is still on the boot index that auto-redirects signed-in users to Home. */
export function isBusinessBootIndexPath(pathname: string | null | undefined): boolean {
  if (pathname == null) return true;
  return pathname === "/" || pathname === "";
}

/**
 * Auth finished and the boot index → Home redirect is no longer in flight.
 * Safe to `router.push` a push deep link without Home overwriting it.
 */
export function isBusinessNavigationStartupSettled(args: {
  loading: boolean;
  userId: string | null;
  pathname: string | null | undefined;
}): boolean {
  if (args.loading) return false;
  if (args.userId === null) return false;
  if (isBusinessBootIndexPath(args.pathname)) return false;
  return true;
}

export function holdBusinessPushLaunchTarget(
  target: BusinessPushLaunchTarget,
): void {
  if (typeof target !== "string" || target.length === 0) return;
  _pendingLaunchTarget = target;
}

export function peekBusinessPushLaunchTarget(): BusinessPushLaunchTarget | null {
  return _pendingLaunchTarget;
}

/** Take the held target exactly once (or null if none). */
export function consumeBusinessPushLaunchTarget(): BusinessPushLaunchTarget | null {
  const target = _pendingLaunchTarget;
  _pendingLaunchTarget = null;
  return target;
}

/** Test-only reset. */
export function __resetBusinessPushLaunchIntentForTests(): void {
  _pendingLaunchTarget = null;
}
