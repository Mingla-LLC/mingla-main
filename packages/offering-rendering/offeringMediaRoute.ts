// issue #4518 — the road a public-page picture takes, injected by the host app.
//
// THE DEFECT. Buyer pages gained a second road to the database through our
// own site, but pictures (event cover, brand logo, galleries) still loaded
// only from the database host. On a phone that could reach us but not that
// host, the page worked and every picture was missing.
//
// THE CONTRACT. An app may provide an `OfferingMediaRoute`:
//   resolve(url)     the url to try first (an app may rewrite it up front
//                    once it knows this visit needs the second road)
//   fallback(url)    the one alternative to try when `url` fails, or null
//   onFallbackResult whether that one alternative loaded (reporting / memory)
//   timeLimitMs      how long a first attempt may hang before the fallback is
//                    tried (image loads have no time limit of their own), or
//                    null for none
//
// No provider (Explorer, the native Host app) ⇒ PASS_THROUGH: the url as
// given, no fallback, no timer. Behaviour identical to before.
//
// Package isolation (I-MOR-0827-PACKAGE-ISOLATION): props/context only; this
// file knows nothing about any app, database or host name.

import React from "react";

export interface OfferingMediaRoute {
  resolve(url: string): string;
  fallback(url: string): string | null;
  onFallbackResult?(ok: boolean): void;
  timeLimitMs: number | null;
}

export const PASS_THROUGH_MEDIA_ROUTE: OfferingMediaRoute = {
  resolve: (url: string): string => url,
  fallback: (): string | null => null,
  timeLimitMs: null,
};

export const OfferingMediaRouteContext = React.createContext<OfferingMediaRoute>(
  PASS_THROUGH_MEDIA_ROUTE,
);

/** The provided route, or PASS_THROUGH when no app provided one. */
export const useOfferingMediaRoute = (): OfferingMediaRoute =>
  React.useContext(OfferingMediaRouteContext);

// ---- pure steps (the hook in useOfferingImageUri.ts is a thin shell) -------

export interface OfferingImageState {
  /** The url the caller asked for. A change resets everything. */
  url: string | null;
  /** What the <Image> is pointed at now. */
  uri: string | null;
  /** True once the one fallback has been taken (never a second). */
  fellBack: boolean;
}

export const initialOfferingImageState = (
  route: OfferingMediaRoute,
  url: string | null,
): OfferingImageState => ({
  url,
  uri: url === null || url.length === 0 ? url : route.resolve(url),
  fellBack: false,
});

/**
 * The state after the current attempt failed, or null when there is nothing
 * left to try (the caller's own error behaviour then runs, unchanged).
 * At most ONE fallback per image: no loops.
 */
export const offeringImageAfterError = (
  route: OfferingMediaRoute,
  state: OfferingImageState,
): OfferingImageState | null => {
  if (state.fellBack || state.uri === null || state.uri.length === 0) return null;
  const next = route.fallback(state.uri);
  if (next === null || next === state.uri) return null;
  return { ...state, uri: next, fellBack: true };
};

/** Arm the hang timer only when a fallback exists to switch to. */
export const offeringImageTimerMs = (
  route: OfferingMediaRoute,
  state: OfferingImageState,
): number | null =>
  route.timeLimitMs !== null && offeringImageAfterError(route, state) !== null
    ? route.timeLimitMs
    : null;
