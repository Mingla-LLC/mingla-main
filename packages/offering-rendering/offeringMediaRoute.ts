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
//   fallback(url)    the ONE alternative to try when `url` fails, or null
//   onFallbackResult whether that alternative loaded (reporting / memory)
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
  resolve: (url) => url,
  fallback: () => null,
  timeLimitMs: null,
};

export const OfferingMediaRouteContext = React.createContext(PASS_THROUGH_MEDIA_ROUTE);
