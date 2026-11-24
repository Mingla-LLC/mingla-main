// issue #4518 — one picture, at most ONE fallback (offeringMediaRoute.ts).
//
//   const media = useOfferingImageUri(url);
//   <Image source={{ uri: media.uri ?? url }} onLoad={media.onLoad}
//          onError={(e) => { if (!media.onError(e)) existingErrorBehaviour(e); }} />
//
// `onError` returns true when it switched the picture to the route's fallback
// (the caller must NOT show its error state); false when nothing is left to
// try (the caller's existing behaviour runs exactly as before). A url change
// resets everything. With a time limit, a first attempt that neither loads
// nor fails in time is treated as failed (a blocked host often hangs); the
// timer is armed only when a fallback exists, so never without a provider.
//
// #3827 HARD: react-native-web's <Image> re-runs its load effect whenever its
// onLoad / onError identity changes (Sentry MINGLA-BUSINESS-22). Both handlers
// change identity only with `url`; state is read through refs.

import React from "react";
import {
  Image,
  type ImageErrorEventData,
  type ImageLoadEventData,
  type ImageProps,
  type NativeSyntheticEvent,
} from "react-native";

import { OfferingMediaRouteContext } from "./offeringMediaRoute";
import { OfferingRenderingReact } from "./offeringRenderingReact";

const { useCallback, useEffect, useRef, useState } = OfferingRenderingReact;

export interface OfferingImageUri {
  uri: string | null;
  onError: (event?: unknown) => boolean;
  onLoad: (event?: unknown) => void;
}

export function useOfferingImageUri(url: string | null): OfferingImageUri {
  const route = React.useContext(OfferingMediaRouteContext);
  // [url asked for, uri shown, fell back]
  const first = (): [string | null, string | null, boolean] => [url, url ? route.resolve(url) : url, false];
  const [state, setState] = useState(first);
  const now = state[0] === url ? state : first();
  if (now !== state) setState(now);
  const ref = useRef(now);
  ref.current = now;
  const routeRef = useRef(route);
  routeRef.current = route;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onError = useCallback(
    (): boolean => {
      clearTimeout(timer.current);
      const [asked, shown, fellBack] = ref.current;
      const r = routeRef.current;
      if (fellBack) r.onFallbackResult?.(false);
      const next = !fellBack && shown ? r.fallback(shown) : null;
      if (next === null || next === shown) return false;
      ref.current = [asked, next, true];
      setState(ref.current);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity follows the url only (#3827)
    [url],
  );

  const onLoad = useCallback(
    (): void => {
      clearTimeout(timer.current);
      if (ref.current[2]) routeRef.current.onFallbackResult?.(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity follows the url only (#3827)
    [url],
  );

  const ms = !now[2] && now[1] && route.fallback(now[1]) !== null ? route.timeLimitMs : null;
  useEffect(() => {
    if (ms === null) return undefined;
    timer.current = setTimeout(onError, ms);
    return () => clearTimeout(timer.current);
  }, [ms, now[1], onError]);

  return { uri: now[1], onError, onLoad };
}

/**
 * A react-native <Image> on the picture road: same props, the `source.uri`
 * routed (one fallback), the caller's own onError running only when nothing
 * is left to try. Use it where a picture has no other error handling to
 * compose with.
 */
export function OfferingRoutedImage(props: ImageProps): React.ReactElement {
  const source = props.source as { uri?: string } | undefined;
  const url = source?.uri ?? null;
  const media = useOfferingImageUri(url);
  const { onError, onLoad } = props;
  const routedError = media.onError;
  const routedLoad = media.onLoad;
  const handleError = useCallback(
    (event: NativeSyntheticEvent<ImageErrorEventData>): void => {
      if (!routedError(event)) onError?.(event);
    },
    [routedError, onError],
  );
  const handleLoad = useCallback(
    (event: NativeSyntheticEvent<ImageLoadEventData>): void => {
      routedLoad(event);
      onLoad?.(event);
    },
    [routedLoad, onLoad],
  );
  return React.createElement(Image, {
    ...props,
    source: url === null ? props.source : { ...source, uri: media.uri ?? url },
    onError: handleError,
    onLoad: handleLoad,
  });
}
