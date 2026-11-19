// issue #4518 — one picture, one fallback: the shell around the pure steps in
// offeringMediaRoute.ts.
//
//   const media = useOfferingImageUri(url);
//   <Image source={{ uri: media.uri ?? url }}
//          onLoad={media.onLoad}
//          onError={(e) => { if (!media.onError(e)) existingErrorBehaviour(e); }} />
//
// `onError` returns true when it switched the picture to the route's fallback
// (the caller must NOT show its error state); false when nothing is left to
// try (the caller's existing behaviour runs exactly as before).
//
// #3827 HARD: react-native-web's <Image> re-runs its load effect whenever its
// onLoad / onError identity changes (Sentry MINGLA-BUSINESS-22). Both handlers
// here change identity only when `url` changes; state is read through refs.

import {
  initialOfferingImageState,
  offeringImageAfterError,
  offeringImageTimerMs,
  useOfferingMediaRoute,
  type OfferingImageState,
} from "./offeringMediaRoute";
import { OfferingRenderingReact } from "./offeringRenderingReact";

const { useCallback, useEffect, useRef, useState } = OfferingRenderingReact;

export interface OfferingImageUri {
  uri: string | null;
  onError: (event?: unknown) => boolean;
  onLoad: (event?: unknown) => void;
}

export function useOfferingImageUri(url: string | null): OfferingImageUri {
  const route = useOfferingMediaRoute();
  const [state, setState] = useState<OfferingImageState>(() =>
    initialOfferingImageState(route, url),
  );
  // A url change resets the picture (derived state, set during render).
  const current = state.url === url ? state : initialOfferingImageState(route, url);
  if (current !== state) setState(current);

  const stateRef = useRef<OfferingImageState>(current);
  stateRef.current = current;
  const routeRef = useRef(route);
  routeRef.current = route;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onError = useCallback(
    (_event?: unknown): boolean => {
      clearTimer();
      const activeRoute = routeRef.current;
      const now = stateRef.current;
      if (now.fellBack) {
        // The one fallback failed too: the caller's error state shows.
        activeRoute.onFallbackResult?.(false);
        return false;
      }
      const next = offeringImageAfterError(activeRoute, now);
      if (next === null) return false;
      stateRef.current = next;
      setState(next);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity follows the url only (#3827)
    [url],
  );

  const onLoad = useCallback(
    (_event?: unknown): void => {
      clearTimer();
      if (stateRef.current.fellBack) routeRef.current.onFallbackResult?.(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity follows the url only (#3827)
    [url],
  );

  // A blocked host often hangs instead of failing: after the route's time
  // limit, treat the first attempt as failed. Never armed without a fallback
  // (so never on native, where no route is provided).
  const timerMs = offeringImageTimerMs(route, current);
  useEffect(() => {
    if (timerMs === null) return undefined;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onError();
    }, timerMs);
    return clearTimer;
  }, [timerMs, current.uri, onError, clearTimer]);

  return { uri: current.uri, onError, onLoad };
}
