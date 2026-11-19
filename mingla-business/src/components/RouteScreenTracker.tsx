/**
 * #4226 phase 2B — one PostHog `$screen` per expo-router route change, named
 * from the route's segments (placeholders like `[brandId]`, never real ids or
 * tokens). The single hook point for screen views in the Host app. Skipped
 * when the host turned analytics off. Renders nothing; never throws.
 */
import { useEffect } from "react";
import { useSegments } from "expo-router";
import { postHogService } from "../services/postHogService";
import { screenNameForRoute } from "../services/screenTracking";

export function RouteScreenTracker(): null {
  const segments = useSegments();
  const key = segments.join("/");
  useEffect(() => {
    try {
      postHogService.screen(screenNameForRoute(segments));
    } catch (e) {
      console.warn("[RouteScreenTracker] screen view failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
