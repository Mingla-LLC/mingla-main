/**
 * issue #3237 — "did the host just publish this?" for a manage screen.
 *
 * Claims the one-shot mark left by the publish route (justPublishedSignal) and
 * holds the answer in local state so the banner stays up until it is dismissed
 * or the screen unmounts. A refresh, a later visit, or coming back to the
 * screen after it unmounted finds no mark, so the banner does not come back.
 *
 * The claim runs in an effect, not a state initialiser: an initialiser is
 * invoked twice under StrictMode and the second call would find the mark
 * already claimed.
 *
 * issue #3645 — the banner says "Published. It's live.", so it must stop
 * saying it the moment that is no longer true:
 *   - the item is returned to draft or cancelled (pass its `status`);
 *   - the screen is reused for a different id (the claim is remembered PER ID,
 *     so another item never inherits it, and going back does not revive it).
 * Live test, 2026-10-13: after "Return to draft" the banner stayed on screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { consumeJustPublished } from "../utils/justPublishedSignal";

export interface JustPublishedArrival {
  justPublished: boolean;
  dismiss: () => void;
  /**
   * issue #3645 — true for a moment after the host lands here from a publish.
   * A Share press in that moment was not made on this screen: it is the tail of
   * the tap or click that confirmed the publish. Share handlers ignore it, so
   * publishing never opens the share sheet by itself. The banner's Share
   * button works as soon as the moment has passed.
   */
  isArrivalPress: () => boolean;
}

/** How long after a just-published arrival a Share press is treated as carried over. */
export const PUBLISH_ARRIVAL_PRESS_GUARD_MS = 600;

export const isWithinPublishArrivalGuard = (
  arrivedAtMs: number | null,
  nowMs: number,
): boolean =>
  arrivedAtMs !== null &&
  nowMs >= arrivedAtMs &&
  nowMs - arrivedAtMs < PUBLISH_ARRIVAL_PRESS_GUARD_MS;

/**
 * Statuses in which "It's live." is false. Anything else — including an
 * unknown or still-loading status — leaves the banner alone.
 */
export const isNoLongerLiveStatus = (
  status: string | null | undefined,
): boolean => status === "draft" || status === "cancelled";

export const useJustPublishedArrival = (
  id: string | null | undefined,
  /** The item's current status, when the screen knows it. */
  status?: string | null,
): JustPublishedArrival => {
  // The id the banner was claimed FOR. Null = no banner.
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const currentId = typeof id === "string" && id.length > 0 ? id : null;
  // When the publish arrival was claimed (null = this mount is not one).
  const arrivedAtMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (consumeJustPublished(currentId)) {
      arrivedAtMsRef.current = Date.now();
      setArrivedId(currentId);
      return;
    }
    // No fresh mark for this id. Keep a claim already made for it (StrictMode
    // re-runs this effect with the same id); drop one made for another id.
    setArrivedId((claimed) => (claimed === currentId ? claimed : null));
  }, [currentId]);

  const noLongerLive = isNoLongerLiveStatus(status);
  useEffect(() => {
    if (noLongerLive) setArrivedId(null);
  }, [noLongerLive]);

  const dismiss = useCallback((): void => {
    setArrivedId(null);
  }, []);

  const isArrivalPress = useCallback(
    (): boolean => isWithinPublishArrivalGuard(arrivedAtMsRef.current, Date.now()),
    [],
  );

  return {
    justPublished:
      arrivedId !== null && arrivedId === currentId && !noLongerLive,
    dismiss,
    isArrivalPress,
  };
};
