/**
 * #4226 phase 2B — one PostHog `$screen` per expo-router route change, named
 * from the route's segments (placeholders like `[slug]`, never real ids). The
 * root `index` route hosts the in-app pages and is tracked from app/index.tsx
 * with the same tracker, so there is exactly one hook point per navigation
 * system. Renders nothing; never throws.
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
