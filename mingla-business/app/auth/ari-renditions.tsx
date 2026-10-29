/**
 * #3355 — local cross-platform rendition review route.
 *
 * `/auth/*` is reachable without a session, which lets browser and simulator
 * QA inspect the visual contract without production credentials. The screen is
 * compile-time dev-gated and redirects in any production bundle.
 */

import React from "react";
import { Redirect } from "expo-router";

import { AriRenditionGalleryScreen } from "../../src/screens/ari/AriRenditionGalleryScreen";

export default function AriRenditionsRoute(): React.ReactElement {
  if (!__DEV__) return <Redirect href="/" />;
  return <AriRenditionGalleryScreen />;
}
