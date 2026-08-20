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
//
// META-ORCH-1270 — OTA-SAFETY (COMMS-0052 fix). `posthog-react-native` is a
// NATIVE module. A STATIC value-import of `PostHogProvider` throws at
// MODULE-LOAD on any shipped binary that does not contain the native module —
// e.g. an OTA pushed to a pre-PostHog binary — which CRASHES the app on launch
// (this is exactly what froze business OTAs and bricked the ORCH-1254 OTA). We
// therefore import the provider LAZILY + GUARDED: only after
// postHogService.initialize() yields a client (which itself only succeeds when
// the native module is present) do we dynamically import the provider. On a
// binary without the module, getClient() stays null → the dynamic import never
// runs → children render plainly → NO crash (analytics degrades gracefully).
// This mirrors the guarded lazy import already in postHogService.ts:120-144.
// The `import type` below is fully erased at build time (no runtime require).

import React, { useEffect, useState } from "react";
import { useWindowDimensions } from "react-native";
import type { PostHog } from "posthog-react-native";
import { postHogService } from "./postHogService";

type PostHogProviderComponent = React.ComponentType<{
  client: PostHog;
  autocapture?: boolean;
  children?: React.ReactNode;
}>;

export function PostHogAnalyticsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [client, setClient] = useState<PostHog | null>(() =>
    postHogService.getClient(),
  );
  const [Provider, setProvider] = useState<PostHogProviderComponent | null>(
    null,
  );

  // #2211 — reactive, so a text-size change mid-session re-registers rather
  // than leaving a stale value on every later event.
  const { fontScale } = useWindowDimensions();

  useEffect(() => {
    let cancelled = false;
    void postHogService.initialize().then(async () => {
      if (cancelled) return;
      const c = postHogService.getClient();
      if (c === null) return;
      try {
        // Guarded lazy import — only reached when a client exists, i.e. the
        // native module IS present. On binaries without it this never runs.
        const mod = await import("posthog-react-native");
        if (cancelled) return;
        setProvider(() => mod.PostHogProvider as PostHogProviderComponent);
        setClient(c);
      } catch (error) {
        // Native module absent (e.g. OTA on a pre-PostHog binary). Render
        // children with NO provider — analytics degrades, the app never crashes.
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn(
            "[PostHogAnalyticsProvider] native provider unavailable; skipping:",
            error,
          );
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // #2211 — attach the text-size setting to every subsequent event. Depends on
  // `client` rather than the Provider, so it fires even on a binary where the
  // lazy provider import is skipped but the client exists.
  useEffect(() => {
    if (client === null) return;
    postHogService.registerTextSize(fontScale);
  }, [client, fontScale]);

  if (client === null || Provider === null) {
    return <>{children}</>;
  }

  return (
    <Provider client={client} autocapture>
      {children}
    </Provider>
  );
}
