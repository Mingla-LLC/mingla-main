/**
 * #3355 — local cross-platform rendition review route.
 *
 * This route deliberately redirects into the ONE Ari route rather than
 * importing Ari's screen graph a second time. Metro promotes modules shared by
 * two routes into web `__common`; that would charge every public guest for a
 * Host-only 65-state QA catalog. The route is compile-time dev-gated and
 * redirects home in any production bundle.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — redirect-only route renders no screen chrome

import React from "react";
import { Redirect } from "expo-router";

export default function AriRenditionsRoute(): React.ReactElement {
  if (!__DEV__) return <Redirect href="/" />;
  return <Redirect href="/(tabs)/ari?renditions=gallery" />;
}
