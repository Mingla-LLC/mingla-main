// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 web stub.
//
// WEB NO-OP PASSTHROUGH for the native PostHogAnalyticsProvider. Metro's
// platform resolution picks this `.web.tsx` over PostHogAnalyticsProvider.tsx
// on the buyer-web export, so the native `posthog-react-native` SDK (and its
// <PostHogProvider>) NEVER enters the web bundle — keeping the ORCH-1083
// __common initial-bundle budget under cap.
//
// It simply renders children. Web analytics is owned by Leg 2's
// webAnalytics.web.ts. Imports NOTHING from posthog-react-native. Same export
// shape as the native file so callers (app/_layout.tsx) are unaffected.

import React from "react";

export function PostHogAnalyticsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
