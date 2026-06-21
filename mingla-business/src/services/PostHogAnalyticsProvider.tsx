// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 (native, business app).
//
// Thin React wrapper that (1) initializes the postHogService singleton client
// and (2) mounts <PostHogProvider client={...} autocapture> over the SAME client
// once ready. Using the `client` prop (not apiKey+options) guarantees the
// provider's autocapture + the imperative capture/identify/reset calls at the
// app's call sites all share ONE client. Masked replay + US host + opt-out +
// cost-guard sampling are configured on that client in
// postHogService.initialize() (§4.G/§4.H/§4.I).
//
// Children ALWAYS render (even before the client resolves / when the key is
// absent / on web) — analytics never gates the app. On web and when the key is
// missing, getClient() returns null and we render children with no provider
// (graceful no-op — T-10, web-isolation). Buyer-web capture is a separate leg.

import React, { useEffect, useState } from "react";
import type { PostHog } from "posthog-react-native";
import { PostHogProvider } from "posthog-react-native";
import { postHogService } from "./postHogService";

export function PostHogAnalyticsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [client, setClient] = useState<PostHog | null>(() =>
    postHogService.getClient(),
  );

  useEffect(() => {
    let cancelled = false;
    void postHogService.initialize().then(() => {
      if (cancelled) return;
      const c = postHogService.getClient();
      if (c !== null) setClient(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (client === null) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={client} autocapture>
      {children}
    </PostHogProvider>
  );
}
