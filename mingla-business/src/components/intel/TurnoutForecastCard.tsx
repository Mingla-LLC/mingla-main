import React, { Suspense } from "react";

import type { TurnoutSurface } from "../../hooks/useTurnoutForecast";
import { useTurnoutIntel } from "./TurnoutIntelContext";

export interface TurnoutForecastCardProps {
  surface: TurnoutSurface;
}

// Keep the ambient card's glass and animated controls out of every wizard
// step's eager module graph. The card still uses the approved shared
// primitives once eligible, while unrelated form/render lanes can load
// without evaluating expo-blur or react-native-reanimated.
const LazyTurnoutForecastCardContent = React.lazy(async () => {
  const module = await import("./PrePublishIntelligenceSurfaces");
  return { default: module.TurnoutForecastCardContent };
});

export const TurnoutForecastCard: React.FC<TurnoutForecastCardProps> = (
  props,
) => {
  const intel = useTurnoutIntel();
  if (intel === null || intel.state === "idle") return null;
  if (intel.state === "error-hidden" && intel.updateFailureCount !== 1) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyTurnoutForecastCardContent {...props} />
    </Suspense>
  );
};
