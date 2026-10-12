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
 */

import { useCallback, useEffect, useState } from "react";

import { consumeJustPublished } from "../utils/justPublishedSignal";

export interface JustPublishedArrival {
  justPublished: boolean;
  dismiss: () => void;
}

export const useJustPublishedArrival = (
  id: string | null | undefined,
): JustPublishedArrival => {
  const [justPublished, setJustPublished] = useState<boolean>(false);

  useEffect(() => {
    if (consumeJustPublished(id)) setJustPublished(true);
  }, [id]);

  const dismiss = useCallback((): void => {
    setJustPublished(false);
  }, []);

  return { justPublished, dismiss };
};
