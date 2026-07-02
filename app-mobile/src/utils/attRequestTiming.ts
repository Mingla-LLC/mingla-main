/**
 * ORCH-1257 (Apple 2.1) — ATT request-timing gate (consumer app-mobile).
 *
 * iOS silently DROPS an App Tracking Transparency request made while the app is
 * not foreground-`active` (e.g. still resolving animations, or briefly
 * backgrounded during onboarding — common on iPad). The reviewer "was unable to
 * locate the ATT permission request" because the prompt was issued off-`active`
 * and never appeared.
 *
 * This pure helper decides whether to fire the request now or wait for the first
 * `active` AppState. Kept dependency-free so it is trivially unit-testable, and
 * intentionally identical to mingla-business/src/utils/attRequestTiming.ts
 * (ORCH-1246) — the proven-good pattern Apple stopped flagging on the business
 * app.
 */
import type { AppStateStatus } from 'react-native';

/**
 * @returns true  → the app is foreground-active; request ATT now.
 *          false → not active; the caller must defer the request to the first
 *                  `active` AppState transition.
 */
export function shouldRequestAttNow(state: AppStateStatus): boolean {
  return state === 'active';
}
