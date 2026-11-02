import React from "react";
import { ActivityIndicator } from "react-native";

import type { StepBodyProps } from "./types";

const DeferredCreatorStep5Tickets = React.lazy(async () => {
  const module = await import("./CreatorStep5Tickets");
  return { default: module.CreatorStep5Tickets };
});

/**
 * The Tickets step is shared by the create and live-edit surfaces. Keeping it behind
 * one dynamic boundary prevents Metro from hoisting that route-only editor into the
 * boot payload every public guest downloads.
 */
export const CreatorStep5Tickets: React.FC<StepBodyProps> = (props) => (
  <React.Suspense
    fallback={<ActivityIndicator accessibilityLabel="Loading tickets" />}
  >
    <DeferredCreatorStep5Tickets {...props} />
  </React.Suspense>
);
