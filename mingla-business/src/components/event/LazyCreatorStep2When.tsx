import React from "react";
import { ActivityIndicator } from "react-native";

import type { StepBodyProps } from "./types";

const DeferredCreatorStep2When = React.lazy(async () => {
  const module = await import("./CreatorStep2When");
  return { default: module.CreatorStep2When };
});

/**
 * The When step is shared by four lazy creator surfaces. Keeping its implementation
 * behind one dynamic boundary prevents Metro from hoisting that route-only editor
 * into the boot payload every public guest downloads.
 */
export const CreatorStep2When: React.FC<StepBodyProps> = (props) => (
  <React.Suspense
    fallback={<ActivityIndicator accessibilityLabel="Loading schedule" />}
  >
    <DeferredCreatorStep2When {...props} />
  </React.Suspense>
);
