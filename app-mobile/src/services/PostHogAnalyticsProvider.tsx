// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 (native, consumer app).
//
// Thin React wrapper that (1) initializes the postHogService singleton client
// and (2) mounts <PostHogProvider client={...} autocapture> over the SAME client
// once it is ready. Using the `client` prop (not apiKey+options) guarantees the
// provider's autocapture + the imperative capture/identify/reset calls at the
// app's call sites all share ONE client instance. Masked session replay + US
// host + opt-out + cost-guard sampling are configured on that client in
// postHogService.initialize() (§4.G/§4.H/§4.I).
//
// Children ALWAYS render (even before the client resolves / when the key is
// absent / on web) — analytics never gates the app. On web and when the key is
// missing, getClient() returns null and we render children with no provider
// (graceful no-op — T-10, web-isolation).

import React, { useEffect, useState } from "react";
import { useWindowDimensions } from "react-native";
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

  // #2211 — reactive. A user who changes their text size while the app is open
  // re-registers rather than leaving a stale value on every later event.
  const { fontScale } = useWindowDimensions();

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

  // #2211 — attach the text-size setting to every subsequent event. Runs once
  // the client exists AND again on any `fontScale` change. Before this, PostHog
  // held zero properties matching font / accessibility / scale / text_size, so
  // the exposure of every Dynamic Type defect was unmeasurable.
  useEffect(() => {
    if (client === null) return;
    postHogService.registerTextSize(fontScale);
  }, [client, fontScale]);

  if (client === null) {
    // Key missing / web / not yet ready — never block the app.
    return <>{children}</>;
  }

  // autocapture: captureScreens + captureTouches; replay is on the client.
  return (
    <PostHogProvider client={client} autocapture>
      {children}
    </PostHogProvider>
  );
}
