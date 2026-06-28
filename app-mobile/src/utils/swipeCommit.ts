// ORCH-1240 [Card swipe-hang: fast flicks fail a distance-only commit threshold]
//
// Pure, dependency-free horizontal swipe commit decision for the consumer deck.
// Extracted from SwipeableCards.tsx so the exact thresholds can be unit-tested
// without simulating PanResponder gestures.
//
// THE BUG: the deck's commit-vs-springback gate was distance-only
// (`Math.abs(dx) > 120`). A real-device fling is fast but short (high vx,
// dx < 120 px), so it FAILED the gate and sprang back even though it visually
// crossed the point of no return — the "card hangs" symptom. The fix commits on
// translation OR velocity, mirroring the deliberate recovery swipe.

// px — a deliberate long drag commits on distance alone.
export const SWIPE_COMMIT_DISTANCE = 120;
// px/ms — a firm flick speed (RN PanResponder vx units). ~0.5 is a firm flick.
export const SWIPE_COMMIT_VELOCITY = 0.5;
// px — floor so a stray micro tap-flick (tiny dx, jittery vx) doesn't commit.
export const SWIPE_COMMIT_MIN_DX = 40;

export interface SwipeCommitOpts {
  distance?: number;
  velocity?: number;
  minDx?: number;
}

/**
 * Pure commit decision for a horizontal card swipe.
 *
 * @param dx  total horizontal translation of the gesture (px). +right / -left.
 * @param vx  horizontal velocity at release (px/ms, RN PanResponder units).
 * @returns 'left' | 'right' to commit (fling off-screen), or null to spring back.
 *
 * Commits when EITHER:
 *   - the drag is long enough:           |dx| > distance, OR
 *   - it is a firm flick past a floor:   |vx| > velocity AND |dx| > minDx.
 * A slow short drag (low vx AND short dx) returns null — weak-swipe spring-back
 * is preserved. Direction follows the sign of dx (dominant signal); on the
 * dx===0 edge case it falls back to the sign of vx.
 */
export function shouldCommitSwipe(
  dx: number,
  vx: number,
  opts?: SwipeCommitOpts
): "left" | "right" | null {
  const distance = opts?.distance ?? SWIPE_COMMIT_DISTANCE;
  const velocity = opts?.velocity ?? SWIPE_COMMIT_VELOCITY;
  const minDx = opts?.minDx ?? SWIPE_COMMIT_MIN_DX;

  const absDx = Math.abs(dx);
  const absVx = Math.abs(vx);

  const committed =
    absDx > distance || (absVx > velocity && absDx > minDx);

  if (!committed) return null;

  // dx sign is authoritative; on the pure-velocity dx===0 edge, fall back to vx.
  const sign = dx !== 0 ? dx : vx;
  return sign > 0 ? "right" : "left";
}
