import React from "react";
import { ActivityIndicator } from "react-native";

import type { StepBodyProps } from "./types";

const DeferredCreatorStep1Basics = React.lazy(async () => {
  const module = await import("./CreatorStep1Basics");
  return { default: module.CreatorStep1Basics };
});

/**
 * #4572 bundle movement — the Basics step is shared by the Event wizard, the
 * RSVP wizard and the published-event editor (three on-intent surfaces).
 * Keeping its implementation behind one dynamic boundary stops Metro hoisting
 * it (and the Event type picker #4572 grew) into the eager `__common` chunk
 * every public guest downloads. Same pattern as LazyCreatorStep2When.
 */
export const CreatorStep1Basics: React.FC<StepBodyProps> = (props) => (
  <React.Suspense
    fallback={<ActivityIndicator accessibilityLabel="Loading event basics" />}
  >
    <DeferredCreatorStep1Basics {...props} />
  </React.Suspense>
);
